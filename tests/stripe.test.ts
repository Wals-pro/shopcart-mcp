import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Stripe from "stripe";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  createProCheckoutSession,
  resolveStripeLocale
} from "../src/billing/stripe.js";
import { hashPassword, sha256Hex } from "../src/auth/crypto.js";
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
  const stripeClient = {
    customers: { create: createCustomer },
    checkout: { sessions: { create: createSession } }
  } as unknown as Pick<Stripe, "customers" | "checkout">;
  return { stripeClient, createCustomer, createSession };
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
});
