import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  createProCheckoutSession,
  extractSubscriptionPeriodEnd,
  processStripeWebhook,
  resolveStripeLocale,
  StripeWebhookSignatureError,
  type BillingStripeClient
} from "../src/billing/stripe.js";
import { createCsrfPair, hashPassword, sha256Hex } from "../src/auth/crypto.js";
import { MemoryStore } from "../src/store/memory.js";
import type { UserRecord } from "../src/store/types.js";

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  const now = new Date("2026-11-25T12:00:00Z");
  return {
    id: "user_test_1",
    email: "kunde@example.de",
    passwordHash: "hash",
    passwordSalt: "salt",
    plan: "free",
    status: "active",
    stripeCustomerId: "cus_existing_123",
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makeStripeMock() {
  const createCustomer = vi.fn().mockResolvedValue({ id: "cus_created_999" });
  const createSession = vi.fn().mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/cs_test_123"
  });
  const createPortalSession = vi.fn().mockResolvedValue({
    url: "https://billing.stripe.com/p/session/bps_test_123"
  });
  const stripeClient = {
    customers: { create: createCustomer },
    checkout: { sessions: { create: createSession } },
    billingPortal: { sessions: { create: createPortalSession } }
  } as unknown as BillingStripeClient;
  return { stripeClient, createCustomer, createSession, createPortalSession };
}

describe("Stripe checkout polish (locale + allow_promotion_codes)", () => {
  it("resolves locale strictly to 'de' or 'en'", () => {
    expect(resolveStripeLocale("de")).toBe("de");
    expect(resolveStripeLocale("en")).toBe("en");
    expect(resolveStripeLocale(undefined)).toBe("en");
    expect(resolveStripeLocale("fr")).toBe("en");
  });

  it("passes locale='de' and allow_promotion_codes=true alongside Black Friday trial_end", async () => {
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      SESSION_SECRET: "a".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9",
      PROMO_TRIAL_END: "2026-12-07T00:00:00+01:00"
    });
    const store = new MemoryStore();
    const user = makeUser();
    await store.createUser(user);

    const { stripeClient, createCustomer, createSession } = makeStripeMock();
    const res = await createProCheckoutSession(user, config, store, {
      lang: "de",
      now: new Date("2026-11-26T10:00:00+01:00"),
      stripeClient
    });

    expect(res.url).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
    expect(createCustomer).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);

    const params = createSession.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams;
    expect(params.locale).toBe("de");
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.discounts).toBeUndefined();
    expect(params.subscription_data?.trial_end).toBe(
      Math.floor(new Date("2026-12-07T00:00:00+01:00").getTime() / 1000)
    );
    expect(params.success_url).toBe("https://shopcart.wals.pro/billing?checkout=success&lang=de");
    expect(params.cancel_url).toBe("https://shopcart.wals.pro/billing?checkout=cancel&lang=de");
  });

  it("passes locale='en', creates Stripe customer when missing, and keeps allow_promotion_codes=true after promo window", async () => {
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      SESSION_SECRET: "a".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9",
      PROMO_TRIAL_END: "2026-12-07T00:00:00+01:00"
    });
    const store = new MemoryStore();
    const user = makeUser({ stripeCustomerId: null });
    await store.createUser(user);

    const { stripeClient, createCustomer, createSession } = makeStripeMock();
    await createProCheckoutSession(user, config, store, {
      lang: "en",
      now: new Date("2026-12-06T12:00:00+01:00"), // < 48h before trial_end -> no trial_end
      stripeClient
    });

    expect(createCustomer).toHaveBeenCalledWith({
      email: "kunde@example.de",
      metadata: { user_id: "user_test_1" }
    });
    const updatedUser = await store.getUserById(user.id);
    expect(updatedUser?.stripeCustomerId).toBe("cus_created_999");

    const params = createSession.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams;
    expect(params.locale).toBe("en");
    expect(params.customer).toBe("cus_created_999");
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.discounts).toBeUndefined();
    expect(params.subscription_data?.trial_end).toBeUndefined();
    expect(params.success_url).toBe("https://shopcart.wals.pro/billing?checkout=success&lang=en");
    expect(params.cancel_url).toBe("https://shopcart.wals.pro/billing?checkout=cancel&lang=en");
  });

  it("embeds hidden lang field in /billing checkout form for DE and EN", async () => {
    const config = loadConfig({
      APP_ORIGIN: "http://127.0.0.1:8080",
      SESSION_SECRET: "a".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9"
    });
    const store = new MemoryStore();
    const { hash, salt } = await hashPassword("supersecret123");
    const user = makeUser({ passwordHash: hash, passwordSalt: salt });
    await store.createUser(user);

    const rawSession = "sc_ws_test_session_token";
    await store.saveWebSession({
      sessionHash: sha256Hex(rawSession),
      userId: user.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });

    const app = createApp({ config, store });
    const deRes = await request(app)
      .get("/billing?lang=de")
      .set("Cookie", `sc_session=${rawSession}`);
    expect(deRes.status).toBe(200);
    expect(deRes.text).toContain('action="/billing/checkout"');
    expect(deRes.text).toContain('<input type="hidden" name="lang" value="de">');

    const enRes = await request(app)
      .get("/billing?lang=en")
      .set("Cookie", `sc_session=${rawSession}`);
    expect(enRes.status).toBe(200);
    expect(enRes.text).toContain('<input type="hidden" name="lang" value="en">');
  });

  it("allows authenticated /billing/checkout, /billing/portal, and /billing/logout without csrf cookie and sets same-origin Referrer-Policy + Stripe form-action CSP", async () => {
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      SESSION_SECRET: "b".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9",
      PROMO_TRIAL_END: "2026-12-07T00:00:00+01:00"
    });
    const store = new MemoryStore();
    const user = makeUser({ id: "user_billing_1", email: "markus@wals.pro" });
    await store.createUser(user);

    const rawSession = "sc_ws_billing_csrf_test_1";
    await store.saveWebSession({
      sessionHash: sha256Hex(rawSession),
      userId: user.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });

    const { stripeClient, createSession, createPortalSession } = makeStripeMock();
    const app = createApp({ config, store, stripeClient });

    // 1. GET /billing sends Referrer-Policy: same-origin (so browsers never send Origin: null)
    //    and allows Stripe Checkout/Portal redirects in CSP form-action
    const billingRes = await request(app)
      .get("/billing?lang=de")
      .set("Cookie", `sc_session=${rawSession}`)
      .expect(200);

    expect(billingRes.headers["referrer-policy"]).toBe("same-origin");
    const csp = String(billingRes.headers["content-security-policy"] ?? "");
    expect(csp).toContain("form-action 'self' https://checkout.stripe.com https://billing.stripe.com");

    const checkoutCsrf = billingRes.text.match(
      /action="\/billing\/checkout"[\s\S]*?name="_csrf" value="([^"]+)"/
    )?.[1];
    const portalCsrf = billingRes.text.match(
      /action="\/billing\/portal"[\s\S]*?name="_csrf" value="([^"]+)"/
    )?.[1];
    const logoutCsrf = billingRes.text.match(
      /action="\/billing\/logout"[\s\S]*?name="_csrf" value="([^"]+)"/
    )?.[1];
    expect(checkoutCsrf).toBeTruthy();
    expect(portalCsrf).toBeTruthy();
    expect(logoutCsrf).toBeTruthy();

    // 2. POST /billing/checkout with valid stateless CSRF token + matching Origin and NO sc_billing_csrf cookie
    const checkoutRes = await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${rawSession}`)
      .set("Origin", "https://shopcart.wals.pro")
      .set("Sec-Fetch-Site", "same-origin")
      .type("form")
      .send({ _csrf: checkoutCsrf, lang: "de" })
      .expect(303);

    expect(checkoutRes.headers.location).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
    expect(createSession).toHaveBeenCalledTimes(1);

    // 3. POST /billing/checkout with Origin: null + Sec-Fetch-Site: same-origin (legacy tab / privacy extension)
    const nullOriginSameSiteRes = await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${rawSession}`)
      .set("Origin", "null")
      .set("Sec-Fetch-Site", "same-origin")
      .type("form")
      .send({ _csrf: checkoutCsrf, lang: "de" })
      .expect(303);

    expect(nullOriginSameSiteRes.headers.location).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
    expect(createSession).toHaveBeenCalledTimes(2);

    // 4. POST /billing/portal with NO sc_billing_csrf cookie
    const portalRes = await request(app)
      .post("/billing/portal")
      .set("Cookie", `sc_session=${rawSession}`)
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({ _csrf: portalCsrf })
      .expect(303);

    expect(portalRes.headers.location).toBe("https://billing.stripe.com/p/session/bps_test_123");
    expect(createPortalSession).toHaveBeenCalledTimes(1);

    // 5. POST /billing/logout with NO sc_billing_csrf cookie deletes session
    const logoutRes = await request(app)
      .post("/billing/logout")
      .set("Cookie", `sc_session=${rawSession}`)
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({ _csrf: logoutCsrf })
      .expect(303);

    expect(logoutRes.headers.location).toBe("/billing/login");
    expect(await store.getWebSession(sha256Hex(rawSession))).toBeNull();
  });

  it("rejects foreign Origin, cross-site/null-Origin CSRF, missing/tampered/expired tokens, and cross-user token replay on billing POST routes", async () => {
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      SESSION_SECRET: "c".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9"
    });
    const store = new MemoryStore();
    const userA = makeUser({ id: "user_a", email: "a@example.de" });
    const userB = makeUser({ id: "user_b", email: "b@example.de" });
    await store.createUser(userA);
    await store.createUser(userB);

    const sessA = "sc_ws_session_user_a";
    const sessB = "sc_ws_session_user_b";
    await store.saveWebSession({
      sessionHash: sha256Hex(sessA),
      userId: userA.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });
    await store.saveWebSession({
      sessionHash: sha256Hex(sessB),
      userId: userB.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });

    const { stripeClient, createSession, createPortalSession } = makeStripeMock();
    const app = createApp({ config, store, stripeClient });

    const pageA = await request(app)
      .get("/billing?lang=de")
      .set("Cookie", `sc_session=${sessA}`)
      .expect(200);
    const csrfA = pageA.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const csrfCookieA = (pageA.headers["set-cookie"] as unknown as string[])
      .map((c) => c.split(";")[0])
      .join("; ");

    // Login-page CSRF token (unauthenticated context "billing")
    const loginPage = await request(app).get("/billing/login?lang=de").expect(200);
    const loginCsrf = loginPage.text.match(/name="_csrf" value="([^"]+)"/)![1]!;

    // Expired token paired with matching cookie
    const expiredPair = createCsrfPair(config.sessionSecret, `billing:user:${userA.id}`, Date.now() - 3600 * 1000);

    // Foreign Origin -> 403
    await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${sessA}`)
      .set("Origin", "https://evil.example")
      .type("form")
      .send({ _csrf: csrfA, lang: "de" })
      .expect(403);

    // Origin: null + Sec-Fetch-Site: cross-site (sandboxed iframe CSRF) -> 403
    await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${sessA}`)
      .set("Origin", "null")
      .set("Sec-Fetch-Site", "cross-site")
      .type("form")
      .send({ _csrf: csrfA, lang: "de" })
      .expect(403);

    // Origin: null without Sec-Fetch-Site -> 403 (fail-closed)
    await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${sessA}`)
      .set("Origin", "null")
      .type("form")
      .send({ _csrf: csrfA, lang: "de" })
      .expect(403);

    // Sec-Fetch-Site: cross-site without Origin -> 403
    await request(app)
      .post("/billing/portal")
      .set("Cookie", `sc_session=${sessA}`)
      .set("Sec-Fetch-Site", "cross-site")
      .type("form")
      .send({ _csrf: csrfA })
      .expect(403);

    // Missing token -> 403
    await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${sessA}`)
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({ lang: "de" })
      .expect(403);

    // Tampered token -> 403
    await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${sessA}`)
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({ _csrf: `${csrfA}tampered`, lang: "de" })
      .expect(403);

    // Expired signed token even with matching sc_billing_csrf cookie -> 403
    await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${sessA}; sc_billing_csrf=${encodeURIComponent(expiredPair.cookieValue)}`)
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({ _csrf: expiredPair.token, lang: "de" })
      .expect(403);

    // Login-context token replayed against authenticated /billing/checkout -> 403
    await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${sessA}`)
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({ _csrf: loginCsrf, lang: "de" })
      .expect(403);

    // User A's token + cookie replayed against User B's session -> 403
    await request(app)
      .post("/billing/checkout")
      .set("Cookie", `sc_session=${sessB}; ${csrfCookieA}`)
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({ _csrf: csrfA, lang: "de" })
      .expect(403);

    // Logout CSRF protection -> 403 and session preserved
    await request(app)
      .post("/billing/logout")
      .set("Cookie", `sc_session=${sessA}`)
      .set("Origin", "https://evil.example")
      .type("form")
      .send({ _csrf: csrfA })
      .expect(403);
    expect(await store.getWebSession(sha256Hex(sessA))).not.toBeNull();

    expect(createSession).not.toHaveBeenCalled();
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it("releases stripe_events claim on transient storage failure so webhook retry applies downgrade, returns 500 without leaking internals, and deduplicates subsequent deliveries", async () => {
    const webhookSecret = "whsec_test_retry_hardening_secret_123";
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      SESSION_SECRET: "d".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9"
    });
    const store = new MemoryStore();
    const user = makeUser({
      id: "user_retry_1",
      email: "pro@example.de",
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_retry_1",
      stripeSubscriptionId: "sub_retry_1"
    });
    await store.createUser(user);

    const origApply = store.applyStripeWebhookUpdate.bind(store);
    let failOnce = true;
    store.applyStripeWebhookUpdate = async (userId, params) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("Simulated Firestore DEADLINE_EXCEEDED internal detail");
      }
      return origApply(userId, params);
    };

    const app = createApp({ config, store });
    const stripeHelper = new Stripe("sk_test_dummy");
    const payload = JSON.stringify({
      id: "evt_sub_deleted_retry_1",
      object: "event",
      created: 1700000100,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_retry_1",
          object: "subscription",
          customer: "cus_retry_1",
          status: "canceled",
          metadata: { user_id: "user_retry_1" }
        }
      }
    });
    const validSig = stripeHelper.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret
    });

    // Invalid signature -> 400 webhook_error
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "t=123,v1=invalid")
      .send(payload)
      .expect(400);

    // Attempt 1: transient storage failure -> 500 (triggers Stripe retry), no raw internal error leaked, claim released
    const res1 = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", validSig)
      .send(payload)
      .expect(500);
    expect(res1.body.error).toBe("webhook_processing_error");
    expect(JSON.stringify(res1.body)).not.toContain("DEADLINE_EXCEEDED");
    expect((await store.getUserById(user.id))?.plan).toBe("pro");

    // Attempt 2 (Stripe retry of exact same event): claim was released, so downgrade is cleanly applied
    const res2 = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", validSig)
      .send(payload)
      .expect(200);
    expect(res2.body).toEqual({ received: true, type: "customer.subscription.deleted" });
    const downgraded = await store.getUserById(user.id);
    expect(downgraded?.plan).toBe("free");
    expect(downgraded?.status).toBe("canceled");
    expect(downgraded?.stripeSubscriptionId).toBeNull();

    // Attempt 3 (true duplicate delivery): returns duplicate: true
    const res3 = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", validSig)
      .send(payload)
      .expect(200);
    expect(res3.body).toEqual({
      received: true,
      duplicate: true,
      type: "customer.subscription.deleted"
    });
  });

  it("extracts current_period_end across basil+/endive (single & multi-item max), legacy pre-basil, and invalid payloads", () => {
    const t1 = 1800000000;
    const t2 = 1805000000;

    // 1. Basil+/endive multi-item subscription -> picks max item current_period_end
    const basilSub = {
      id: "sub_basil_1",
      items: {
        object: "list",
        data: [
          { id: "si_1", current_period_end: t1 },
          { id: "si_2", current_period_end: t2 }
        ]
      }
    } as unknown as Stripe.Subscription;
    expect(extractSubscriptionPeriodEnd(basilSub)?.getTime()).toBe(t2 * 1000);

    // 2. Legacy pre-basil subscription (top-level current_period_end, empty items)
    const legacySub = {
      id: "sub_legacy_1",
      current_period_end: t1,
      items: { object: "list", data: [] }
    } as unknown as Stripe.Subscription;
    expect(extractSubscriptionPeriodEnd(legacySub)?.getTime()).toBe(t1 * 1000);

    // 3. Missing / invalid / zero / negative / NaN / overflow (> 9999-12-31) period end -> null
    const badSub = {
      id: "sub_bad_1",
      current_period_end: -5,
      items: {
        object: "list",
        data: [
          { id: "si_nan", current_period_end: Number.NaN },
          { id: "si_inf", current_period_end: Number.POSITIVE_INFINITY },
          { id: "si_overflow", current_period_end: 253402300800 },
          { id: "si_zero", current_period_end: 0 }
        ]
      }
    } as unknown as Stripe.Subscription;
    expect(extractSubscriptionPeriodEnd(badSub)).toBeNull();

    const overflowLegacy = {
      id: "sub_overflow_legacy",
      current_period_end: 1e15,
      items: { object: "list", data: [] }
    } as unknown as Stripe.Subscription;
    expect(extractSubscriptionPeriodEnd(overflowLegacy)).toBeNull();

    // 4. Exact upper bound (253402300799 = 9999-12-31T23:59:59Z) is accepted
    const maxBoundSub = {
      id: "sub_max_bound",
      items: { object: "list", data: [{ id: "si_max", current_period_end: 253402300799 }] }
    } as unknown as Stripe.Subscription;
    expect(extractSubscriptionPeriodEnd(maxBoundSub)?.toISOString()).toBe(
      "9999-12-31T23:59:59.000Z"
    );
  });

  it("verifies Stripe 23 HMAC signatures and processes checkout.session.completed, basil+ & legacy customer.subscription.updated, and invoice.payment_failed", async () => {
    const webhookSecret = "whsec_test_stripe23_full_coverage_secret";
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      SESSION_SECRET: "e".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9"
    });
    const store = new MemoryStore();
    const user = makeUser({
      id: "user_wh_1",
      email: "webhook@example.de",
      plan: "free",
      status: "active",
      stripeCustomerId: "cus_wh_1",
      stripeSubscriptionId: null,
      currentPeriodEnd: null
    });
    await store.createUser(user);

    const app = createApp({ config, store });
    const stripeHelper = new Stripe("sk_test_dummy");

    const sign = (eventObj: Record<string, unknown>) => {
      const payload = JSON.stringify(eventObj);
      const sig = stripeHelper.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret
      });
      return { payload, sig };
    };

    // 1. Missing signature -> StripeWebhookSignatureError / HTTP 400
    await expect(
      processStripeWebhook(Buffer.from("{}"), undefined, config, store)
    ).rejects.toBeInstanceOf(StripeWebhookSignatureError);
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send("{}")
      .expect(400);

    // 2. checkout.session.completed (mode=subscription, payment_status=paid) activates Pro + duplicate is idempotent
    const checkoutEv = sign({
      id: "evt_checkout_1",
      object: "event",
      created: 1700000100,
      api_version: "2026-11-18.endive",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "paid",
          client_reference_id: user.id,
          customer: "cus_wh_1",
          subscription: "sub_wh_1",
          metadata: { user_id: user.id }
        }
      }
    });
    const rCheckout = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", checkoutEv.sig)
      .send(checkoutEv.payload)
      .expect(200);
    expect(rCheckout.body).toEqual({ received: true, type: "checkout.session.completed" });
    let u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("pro");
    expect(u.status).toBe("active");
    expect(u.stripeSubscriptionId).toBe("sub_wh_1");

    const rCheckoutDup = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", checkoutEv.sig)
      .send(checkoutEv.payload)
      .expect(200);
    expect(rCheckoutDup.body).toEqual({
      received: true,
      duplicate: true,
      type: "checkout.session.completed"
    });

    // 3. customer.subscription.updated (basil+/endive format: items.data[].current_period_end)
    const futureSec = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const pastSec = Math.floor(Date.now() / 1000) - 3600;

    // 3a. trialing with multi-item max
    const subTrial = sign({
      id: "evt_sub_trial_basil",
      object: "event",
      created: 1700000110,
      api_version: "2026-11-18.endive",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_wh_1",
          object: "subscription",
          customer: "cus_wh_1",
          status: "trialing",
          metadata: { user_id: user.id },
          items: {
            object: "list",
            data: [
              { id: "si_a", current_period_end: futureSec - 100 },
              { id: "si_b", current_period_end: futureSec }
            ]
          }
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", subTrial.sig)
      .send(subTrial.payload)
      .expect(200);
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("pro");
    expect(u.status).toBe("trialing");
    expect(u.currentPeriodEnd?.getTime()).toBe(futureSec * 1000);

    // 3b. past_due still in grace period (basil+ item period end in future -> stays pro)
    const subGrace = sign({
      id: "evt_sub_pastdue_grace_basil",
      object: "event",
      created: 1700000120,
      api_version: "2026-11-18.endive",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_wh_1",
          object: "subscription",
          customer: "cus_wh_1",
          status: "past_due",
          metadata: { user_id: user.id },
          items: { object: "list", data: [{ id: "si_a", current_period_end: futureSec }] }
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", subGrace.sig)
      .send(subGrace.payload)
      .expect(200);
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("pro");
    expect(u.status).toBe("past_due");

    // 3c. past_due with expired period end (basil+ -> downgraded to free)
    const subExpired = sign({
      id: "evt_sub_pastdue_expired_basil",
      object: "event",
      created: 1700000130,
      api_version: "2026-11-18.endive",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_wh_1",
          object: "subscription",
          customer: "cus_wh_1",
          status: "past_due",
          metadata: { user_id: user.id },
          items: { object: "list", data: [{ id: "si_a", current_period_end: pastSec }] }
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", subExpired.sig)
      .send(subExpired.payload)
      .expect(200);
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("free");
    expect(u.status).toBe("past_due");
    expect(u.currentPeriodEnd?.getTime()).toBe(pastSec * 1000);

    // 4. Legacy pre-basil customer.subscription.updated (top-level current_period_end)
    const subLegacy = sign({
      id: "evt_sub_active_legacy",
      object: "event",
      created: 1700000140,
      api_version: "2025-02-24.acacia",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_wh_1",
          object: "subscription",
          customer: "cus_wh_1",
          status: "past_due",
          current_period_end: futureSec,
          metadata: { user_id: user.id },
          items: { object: "list", data: [] }
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", subLegacy.sig)
      .send(subLegacy.payload)
      .expect(200);
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("pro");
    expect(u.status).toBe("past_due");
    expect(u.currentPeriodEnd?.getTime()).toBe(futureSec * 1000);

    // 5. Missing period_end -> currentPeriodEnd = null
    const subNoPeriod = sign({
      id: "evt_sub_active_noperiod",
      object: "event",
      created: 1700000150,
      api_version: "2026-11-18.endive",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_wh_1",
          object: "subscription",
          customer: "cus_wh_1",
          status: "active",
          metadata: { user_id: user.id },
          items: { object: "list", data: [] }
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", subNoPeriod.sig)
      .send(subNoPeriod.payload)
      .expect(200);
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("pro");
    expect(u.status).toBe("active");
    expect(u.currentPeriodEnd).toBeNull();

    // 6. invoice.payment_failed -> marks user past_due by stripeCustomerId
    const invFailed = sign({
      id: "evt_inv_failed_1",
      object: "event",
      created: 1700000160,
      api_version: "2026-11-18.endive",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_test_1",
          object: "invoice",
          customer: "cus_wh_1"
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", invFailed.sig)
      .send(invFailed.payload)
      .expect(200);
    u = (await store.getUserById(user.id))!;
    expect(u.status).toBe("past_due");
  });

  it("blocks unpaid and non-subscription checkout sessions from granting Pro and handles async_payment_succeeded / async_payment_failed", async () => {
    const webhookSecret = "whsec_test_unpaid_checkout_guard_secret";
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      SESSION_SECRET: "f".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9"
    });
    const store = new MemoryStore();
    const user = makeUser({
      id: "user_async_1",
      email: "sepa@example.de",
      plan: "free",
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null
    });
    await store.createUser(user);

    const app = createApp({ config, store });
    const stripeHelper = new Stripe("sk_test_dummy");
    const postEvent = async (eventObj: Record<string, unknown>) => {
      const payload = JSON.stringify(eventObj);
      const sig = stripeHelper.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret
      });
      return request(app)
        .post("/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", sig)
        .send(payload)
        .expect(200);
    };

    // 1. mode=setup -> ignored, stays free
    await postEvent({
      id: "evt_mode_setup",
      object: "event",
      created: 1700000100,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_setup_1",
          object: "checkout.session",
          mode: "setup",
          payment_status: "no_payment_required",
          client_reference_id: user.id,
          customer: "cus_sepa_1",
          subscription: null
        }
      }
    });
    let u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("free");
    expect(u.stripeCustomerId).toBeNull();

    // 2. mode=payment -> ignored, stays free
    await postEvent({
      id: "evt_mode_payment",
      object: "event",
      created: 1700000105,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_pay_1",
          object: "checkout.session",
          mode: "payment",
          payment_status: "paid",
          client_reference_id: user.id,
          customer: "cus_sepa_1",
          subscription: "sub_bogus"
        }
      }
    });
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("free");

    // 3. mode=subscription, payment_status=unpaid (SEPA pending) -> binds customer only, NO Pro grant!
    await postEvent({
      id: "evt_sub_unpaid",
      object: "event",
      created: 1700000110,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sepa_1",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "unpaid",
          client_reference_id: user.id,
          customer: "cus_sepa_1",
          subscription: "sub_sepa_1"
        }
      }
    });
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("free");
    expect(u.status).toBe("active");
    expect(u.stripeCustomerId).toBe("cus_sepa_1");
    expect(u.stripeSubscriptionId).toBeNull();

    // 4. async_payment_failed -> keeps plan=free, marks status=past_due
    await postEvent({
      id: "evt_async_failed",
      object: "event",
      created: 1700000120,
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: "cs_sepa_1",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "unpaid",
          client_reference_id: user.id,
          customer: "cus_sepa_1",
          subscription: "sub_sepa_1"
        }
      }
    });
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("free");
    expect(u.status).toBe("past_due");

    // 5. async_payment_succeeded (mode=subscription, payment_status=paid) -> grants Pro
    await postEvent({
      id: "evt_async_succeeded",
      object: "event",
      created: 1700000130,
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          id: "cs_sepa_2",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "paid",
          client_reference_id: user.id,
          customer: "cus_sepa_1",
          subscription: "sub_sepa_2"
        }
      }
    });
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("pro");
    expect(u.status).toBe("active");
    expect(u.stripeSubscriptionId).toBe("sub_sepa_2");
  });

  it("prevents out-of-order and same-second webhook entitlement resurrection after cancel while allowing genuine resubscription", async () => {
    const webhookSecret = "whsec_test_out_of_order_guard_secret";
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      SESSION_SECRET: "g".repeat(40),
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_PRO_PRICE_ID: "price_pro_eur_9"
    });
    const store = new MemoryStore();
    const user = makeUser({
      id: "user_ooo_1",
      email: "ooo@example.de",
      plan: "free",
      status: "active",
      stripeCustomerId: "cus_ooo_1",
      stripeSubscriptionId: null
    });
    await store.createUser(user);

    const origApply = store.applyStripeWebhookUpdate.bind(store);
    let failCheckoutOnce = true;
    store.applyStripeWebhookUpdate = async (userId, params) => {
      if (failCheckoutOnce && params.kind === "activate" && params.subscriptionId === "sub_1") {
        failCheckoutOnce = false;
        throw new Error("Simulated transient storage error on T=100 checkout");
      }
      return origApply(userId, params);
    };

    const app = createApp({ config, store });
    const stripeHelper = new Stripe("sk_test_dummy");
    const sign = (eventObj: Record<string, unknown>) => {
      const payload = JSON.stringify(eventObj);
      const sig = stripeHelper.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret
      });
      return { payload, sig };
    };

    // 1. T=100 checkout.session.completed (sub_1) fails transiently -> 500 + claim released
    const checkoutT100 = sign({
      id: "evt_ooo_checkout_100",
      object: "event",
      created: 100,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_ooo_1",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "paid",
          client_reference_id: user.id,
          customer: "cus_ooo_1",
          subscription: "sub_1"
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", checkoutT100.sig)
      .send(checkoutT100.payload)
      .expect(500);

    // 2. T=105 customer.subscription.deleted (sub_1) arrives -> cancels + tombstones sub_1
    const deleteT105 = sign({
      id: "evt_ooo_delete_105",
      object: "event",
      created: 105,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1",
          object: "subscription",
          customer: "cus_ooo_1",
          status: "canceled",
          metadata: { user_id: user.id }
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", deleteT105.sig)
      .send(deleteT105.payload)
      .expect(200);
    let u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("free");
    expect(u.status).toBe("canceled");
    expect(u.currentPeriodEnd).toBeNull();
    expect(u.deletedStripeSubscriptionIds).toContain("sub_1");

    // 3. Delayed retry of T=100 checkout.session.completed (sub_1) MUST NOT resurrect Pro!
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", checkoutT100.sig)
      .send(checkoutT100.payload)
      .expect(200);
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("free");
    expect(u.status).toBe("canceled");

    // 4. Delayed T=101 AND same-second T=105 customer.subscription.updated (sub_1, active) MUST NOT resurrect Pro!
    for (const [id, created] of [
      ["evt_ooo_update_101", 101],
      ["evt_ooo_update_105_same_sec", 105]
    ] as const) {
      const upd = sign({
        id,
        object: "event",
        created,
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            object: "subscription",
            customer: "cus_ooo_1",
            status: "active",
            metadata: { user_id: user.id },
            items: { object: "list", data: [{ id: "si_1", current_period_end: 1900000000 }] }
          }
        }
      });
      await request(app)
        .post("/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", upd.sig)
        .send(upd.payload)
        .expect(200);
      u = (await store.getUserById(user.id))!;
      expect(u.plan).toBe("free");
      expect(u.status).toBe("canceled");
    }

    // 5. Genuine resubscription with NEW subscription sub_2 at T=200 cleanly activates Pro!
    const resubT200 = sign({
      id: "evt_ooo_resub_200",
      object: "event",
      created: 200,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_ooo_2",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "paid",
          client_reference_id: user.id,
          customer: "cus_ooo_1",
          subscription: "sub_2"
        }
      }
    });
    await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", resubT200.sig)
      .send(resubT200.payload)
      .expect(200);
    u = (await store.getUserById(user.id))!;
    expect(u.plan).toBe("pro");
    expect(u.status).toBe("active");
    expect(u.stripeSubscriptionId).toBe("sub_2");
    expect(u.lastStripeEventCreated).toBe(200);
  });
});
