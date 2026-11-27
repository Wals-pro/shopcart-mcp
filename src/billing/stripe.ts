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

export type CheckoutLocale = "de" | "en";

export type BillingStripeClient = Pick<Stripe, "customers" | "checkout" | "billingPortal">;

export interface CreateProCheckoutSessionOptions {
  lang?: string;
  now?: Date;
  stripeClient?: Pick<Stripe, "customers" | "checkout">;
}

export function resolveStripeLocale(lang?: string): CheckoutLocale {
  return lang === "de" ? "de" : "en";
}

export async function createProCheckoutSession(
  user: UserRecord,
  config: AppConfig,
  store: StorageBackend,
  optionsOrNow: CreateProCheckoutSessionOptions | Date = {}
): Promise<{ url: string }> {
  if (!config.stripeProPriceId) {
    throw new Error("Stripe Pro price is not configured (STRIPE_PRO_PRICE_ID missing)");
  }

  const opts: CreateProCheckoutSessionOptions =
    optionsOrNow instanceof Date ? { now: optionsOrNow } : optionsOrNow;
  const now = opts.now ?? new Date();
  const locale = resolveStripeLocale(opts.lang);
  const stripe = opts.stripeClient ?? getStripeClient(config);

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id }
    });
    customerId = customer.id;
    await store.updateUser(user.id, { stripeCustomerId: customerId });
  }

  // Black Friday Launch Promo: trial_end at 2026-12-07T00:00:00+01:00 if still >48h in the future.
  // Stripe allows allow_promotion_codes: true alongside subscription_data.trial_end (as long as no
  // discounts array is passed), so users can also enter BLACKFRIDAY visibly at Checkout.
  const usePromoTrial =
    config.promoTrialEnd !== null &&
    config.promoTrialEnd.getTime() - now.getTime() >= MIN_STRIPE_TRIAL_LEAD_MS;

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    locale,
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: config.stripeProPriceId, quantity: 1 }],
    success_url: `${config.appOrigin}/billing?checkout=success&lang=${locale}`,
    cancel_url: `${config.appOrigin}/billing?checkout=cancel&lang=${locale}`,
    metadata: { user_id: user.id },
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { user_id: user.id },
      ...(usePromoTrial && config.promoTrialEnd
        ? { trial_end: Math.floor(config.promoTrialEnd.getTime() / 1000) }
        : {})
    }
  };

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL");
  }
  return { url: session.url };
}

export async function createBillingPortalSession(
  user: UserRecord,
  config: AppConfig,
  stripeClient?: Pick<Stripe, "billingPortal">
): Promise<{ url: string }> {
  if (!user.stripeCustomerId) {
    throw new Error("No Stripe customer linked to this account yet");
  }
  const stripe = stripeClient ?? getStripeClient(config);
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${config.appOrigin}/billing`
  });
  return { url: session.url };
}

const MAX_STRIPE_UNIX_SECONDS = 253402300799; // 9999-12-31T23:59:59Z (valid JS Date & Firestore Timestamp bound)

/**
 * Extract subscription period end across both Stripe API >= 2025-03-31.basil
 * (`items.data[].current_period_end`) and legacy pre-basil webhook payloads
 * (top-level `current_period_end`).
 */
export function extractSubscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const items = Array.isArray(sub.items?.data) ? sub.items.data : [];
  let maxItemEnd = 0;
  for (const item of items) {
    const candidate: unknown = item?.current_period_end;
    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > maxItemEnd &&
      candidate <= MAX_STRIPE_UNIX_SECONDS
    ) {
      maxItemEnd = candidate;
    }
  }
  if (maxItemEnd > 0) {
    return new Date(maxItemEnd * 1000);
  }

  // Fallback for webhook endpoints pinned to pre-2025-03-31.basil API versions
  const legacyEnd: unknown = (sub as unknown as { current_period_end?: unknown })
    .current_period_end;
  if (
    typeof legacyEnd === "number" &&
    Number.isFinite(legacyEnd) &&
    legacyEnd > 0 &&
    legacyEnd <= MAX_STRIPE_UNIX_SECONDS
  ) {
    return new Date(legacyEnd * 1000);
  }

  return null;
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

export class StripeWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeWebhookSignatureError";
  }
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
    throw new StripeWebhookSignatureError("Missing Stripe-Signature header");
  }

  const stripe = getStripeClient(config);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret!);
  } catch (err) {
    throw new StripeWebhookSignatureError(
      err instanceof Error ? err.message : "Invalid Stripe webhook signature"
    );
  }

  const claimed = await store.claimStripeEvent(event.id, event.type);
  if (!claimed) {
    return { received: true, duplicate: true, type: event.type };
  }

  const eventCreated =
    typeof event.created === "number" && Number.isFinite(event.created) && event.created > 0
      ? Math.floor(event.created)
      : Math.floor(Date.now() / 1000);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;
        if (session.mode !== "subscription" || !subscriptionId) {
          break;
        }

        const userId = session.client_reference_id ?? session.metadata?.user_id;
        const customerId = typeof session.customer === "string" ? session.customer : null;
        let user = userId ? await store.getUserById(userId) : null;
        if (!user && customerId) {
          user = await store.getUserByStripeCustomerId(customerId);
        }
        if (!user) break;

        if (
          session.payment_status === "paid" ||
          session.payment_status === "no_payment_required"
        ) {
          await store.applyStripeWebhookUpdate(user.id, {
            eventCreated,
            kind: "activate",
            plan: "pro",
            status: "active",
            stripeCustomerId: customerId,
            subscriptionId
          });
        } else if (customerId && !user.stripeCustomerId) {
          // Delayed payment method (payment_status === "unpaid"): bind customer without granting Pro
          await store.applyStripeWebhookUpdate(user.id, {
            eventCreated,
            kind: "bind_customer",
            stripeCustomerId: customerId
          });
        }
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;
        if (session.mode !== "subscription" || !subscriptionId) {
          break;
        }
        if (
          session.payment_status !== "paid" &&
          session.payment_status !== "no_payment_required"
        ) {
          break;
        }

        const userId = session.client_reference_id ?? session.metadata?.user_id;
        const customerId = typeof session.customer === "string" ? session.customer : null;
        let user = userId ? await store.getUserById(userId) : null;
        if (!user && customerId) {
          user = await store.getUserByStripeCustomerId(customerId);
        }
        if (user) {
          await store.applyStripeWebhookUpdate(user.id, {
            eventCreated,
            kind: "activate",
            plan: "pro",
            status: "active",
            stripeCustomerId: customerId,
            subscriptionId
          });
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") {
          break;
        }
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;
        const userId = session.client_reference_id ?? session.metadata?.user_id;
        const customerId = typeof session.customer === "string" ? session.customer : null;
        let user = userId ? await store.getUserById(userId) : null;
        if (!user && customerId) {
          user = await store.getUserByStripeCustomerId(customerId);
        }
        if (user) {
          await store.applyStripeWebhookUpdate(user.id, {
            eventCreated,
            kind: "payment_failed",
            plan: "free",
            status: "past_due",
            stripeCustomerId: customerId,
            subscriptionId
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
          const periodEnd = extractSubscriptionPeriodEnd(sub);
          const mapped = mapStripeSubscriptionState(sub.status, periodEnd);
          await store.applyStripeWebhookUpdate(user.id, {
            eventCreated,
            kind: "subscription_update",
            plan: mapped.plan,
            status: mapped.status,
            stripeCustomerId: customerId,
            subscriptionId: sub.id,
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
          await store.applyStripeWebhookUpdate(user.id, {
            eventCreated,
            kind: "subscription_delete",
            subscriptionId: sub.id
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
        const user = customerId ? await store.getUserByStripeCustomerId(customerId) : null;
        if (user) {
          await store.applyStripeWebhookUpdate(user.id, {
            eventCreated,
            kind: "payment_failed",
            status: "past_due"
          });
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    await store.releaseStripeEvent(event.id).catch(() => undefined);
    throw err;
  }

  return { received: true, type: event.type };
}
