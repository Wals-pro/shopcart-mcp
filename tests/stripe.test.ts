import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Stripe from "stripe";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  createProCheckoutSession,
  resolveStripeLocale,
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
});
