import Stripe from "stripe";
import type { AppConfig } from "../config.js";
import type { StorageBackend, UserPlan, UserRecord, UserStatus } from "../store/types.js";

const MIN_STRIPE_TRIAL_LEAD_MS = 48 * 3600 * 1000;

export function isStripeCheckoutConfigured(config: AppConfig): boolean {
  return Boolean(config.stripeSecretKey && config.stripeProPriceId);
}

export function isStripeWebhookConfigured(config: AppConfig): boolean {
  return Boolean(config.stripeSecretKey && config.stripeWebhookSecret);
}

function getStripeClient(config: AppConfig): Stripe {
  if (!config.stripeSecretKey) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing)");
  }
  return new Stripe(config.stripeSecretKey);
}

export async function createProCheckoutSession(
  user: UserRecord,
  config: AppConfig,
  store: StorageBackend,
  now = new Date()
): Promise<{ url: string }> {
  if (!config.stripeProPriceId) {
    throw new Error("Stripe Pro price is not configured (STRIPE_PRO_PRICE_ID missing)");
  }
  const stripe = getStripeClient(config);

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id }
    });
    customerId = customer.id;
    await store.updateUser(user.id, { stripeCustomerId: customerId });
  }

  // Black Friday Launch Promo: trial_end at 2026-12-07T00:00:00+01:00 if still >48h in the future;
  // otherwise enable promotion codes.
  const usePromoTrial =
    config.promoTrialEnd !== null &&
    config.promoTrialEnd.getTime() - now.getTime() >= MIN_STRIPE_TRIAL_LEAD_MS;

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: config.stripeProPriceId, quantity: 1 }],
    success_url: `${config.appOrigin}/billing?checkout=success`,
    cancel_url: `${config.appOrigin}/billing?checkout=cancel`,
    metadata: { user_id: user.id },
    subscription_data: {
      metadata: { user_id: user.id },
      ...(usePromoTrial && config.promoTrialEnd
        ? { trial_end: Math.floor(config.promoTrialEnd.getTime() / 1000) }
        : {})
    },
    ...(usePromoTrial ? {} : { allow_promotion_codes: true })
  };

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL");
  }
  return { url: session.url };
}

export async function createBillingPortalSession(
  user: UserRecord,
  config: AppConfig
): Promise<{ url: string }> {
  if (!user.stripeCustomerId) {
    throw new Error("No Stripe customer linked to this account yet");
  }
  const stripe = getStripeClient(config);
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${config.appOrigin}/billing`
  });
  return { url: session.url };
}

function mapStripeSubscriptionState(
  subStatus: string,
  periodEnd: Date | null,
  now = new Date()
): { plan: UserPlan; status: UserStatus } {
  if (subStatus === "active") return { plan: "pro", status: "active" };
  if (subStatus === "trialing") return { plan: "pro", status: "trialing" };
  if (subStatus === "past_due") {
    const inGrace = periodEnd !== null && periodEnd.getTime() > now.getTime();
    return { plan: inGrace ? "pro" : "free", status: "past_due" };
  }
  return { plan: "free", status: "canceled" };
}

export async function processStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  config: AppConfig,
  store: StorageBackend
): Promise<{ received: boolean; duplicate?: boolean; type?: string }> {
  if (!isStripeWebhookConfigured(config)) {
    throw new Error("Stripe webhook is not configured");
  }
  if (!signature) {
    throw new Error("Missing Stripe-Signature header");
  }

  const stripe = getStripeClient(config);
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret!);

  const claimed = await store.claimStripeEvent(event.id, event.type);
  if (!claimed) {
    return { received: true, duplicate: true, type: event.type };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id ?? session.metadata?.user_id;
      const customerId = typeof session.customer === "string" ? session.customer : null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : null;

      let user = userId ? await store.getUserById(userId) : null;
      if (!user && customerId) {
        user = await store.getUserByStripeCustomerId(customerId);
      }
      if (user) {
        await store.updateUser(user.id, {
          plan: "pro",
          status: "active",
          stripeCustomerId: customerId ?? user.stripeCustomerId,
          stripeSubscriptionId: subscriptionId ?? user.stripeSubscriptionId
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : null;
      const userId = sub.metadata?.user_id;
      const user =
        (userId ? await store.getUserById(userId) : null) ??
        (customerId ? await store.getUserByStripeCustomerId(customerId) : null);

      if (user) {
        const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
        const mapped = mapStripeSubscriptionState(sub.status, periodEnd);
        await store.updateUser(user.id, {
          plan: mapped.plan,
          status: mapped.status,
          stripeCustomerId: customerId ?? user.stripeCustomerId,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: periodEnd
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : null;
      const userId = sub.metadata?.user_id;
      const user =
        (userId ? await store.getUserById(userId) : null) ??
        (customerId ? await store.getUserByStripeCustomerId(customerId) : null);

      if (user) {
        await store.updateUser(user.id, {
          plan: "free",
          status: "canceled",
          stripeSubscriptionId: null
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      const user = customerId ? await store.getUserByStripeCustomerId(customerId) : null;
      if (user) {
        await store.updateUser(user.id, { status: "past_due" });
      }
      break;
    }

    default:
      break;
  }

  return { received: true, type: event.type };
}
