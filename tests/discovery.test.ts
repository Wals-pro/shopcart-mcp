import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildProCheckoutParams } from "../src/billing/stripe.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import { ALLOWED_CRAWLERS, SITEMAP_PATHS } from "../src/web/discovery.js";

function makeApp(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00",
    ...extraEnv
  });
  return { config, app: createApp({ config, store: new MemoryStore() }) };
}

describe("Agent discovery (GEO/AEO): llms.txt, llms-full.txt, robots.txt, sitemap.xml, Link header", () => {
  it("serves /llms.txt as text/plain with summary, MCP endpoint, tools, and the start-prompt contract", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/llms.txt").expect(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.text.startsWith("# ShopCart")).toBe(true);
    expect(res.text).toMatch(/^> .+/m);
    expect(res.text).toContain("https://shopcart.wals.pro/mcp");
    expect(res.text).toContain("https://shopcart.wals.pro/llms-full.txt");
    for (const tool of ["inspect_store", "search_products", "get_product", "create_cart_link"]) {
      expect(res.text).toContain(tool);
    }
    expect(res.text).toContain("Start Prompt");
    expect(res.text).toMatch(/never (places|place) orders|read-only/i);
    // Brand spelling & no internal keyword numbers in public text
    expect(res.text).not.toMatch(/Wals\.pro|WALS\.PRO/);
    expect(res.text).not.toMatch(/search volume|Suchvolumen|DataForSEO/i);
  });

  it("serves /llms-full.txt as text/plain with full reference, DE + EN FAQ, and current limits", async () => {
    const { app, config } = makeApp();
    const res = await request(app).get("/llms-full.txt").expect(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.text.startsWith("# ShopCart")).toBe(true);
    expect(res.text.length).toBeGreaterThan(3000);
    expect(res.text).toContain("https://shopcart.wals.pro/mcp");
    expect(res.text).toContain("create_cart_link");
    expect(res.text).toContain(`${config.freeDailyLimit}`);
    expect(res.text).toContain(`${config.proDailyLimit}`);
    expect(res.text).toContain("Kauft die KI über ShopCart automatisch für mich ein?");
    expect(res.text).toContain("Does ShopCart place orders or charge my card automatically?");
    expect(res.text).not.toMatch(/Wals\.pro|WALS\.PRO/);
    expect(res.text).not.toMatch(/search volume|Suchvolumen|DataForSEO/i);
  });

  it("serves /robots.txt that explicitly allows AI & search crawlers and points at the sitemap", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/robots.txt").expect(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    for (const bot of [
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-Web",
      "PerplexityBot",
      "Googlebot",
      "Bingbot",
      "Applebot"
    ]) {
      expect(ALLOWED_CRAWLERS).toContain(bot);
      expect(res.text).toMatch(new RegExp(`User-agent: ${bot}\\nAllow: /\\n`));
    }
    expect(res.text).toMatch(/User-agent: \*\nAllow: \/\n/);
    expect(res.text.trimEnd().endsWith("Sitemap: https://shopcart.wals.pro/sitemap.xml")).toBe(true);
    // The public landing page is never disallowed
    expect(res.text).not.toMatch(/^Disallow: \/$/m);
  });

  it("serves /sitemap.xml as application/xml listing landing, language variants, billing, legal, and llms files", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/sitemap.xml").expect(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(SITEMAP_PATHS).toEqual([
      "/",
      "/?lang=de",
      "/?lang=en",
      "/billing",
      "/privacy",
      "/terms",
      "/llms.txt",
      "/llms-full.txt"
    ]);
    for (const path of SITEMAP_PATHS) {
      expect(res.text).toContain(`<loc>https://shopcart.wals.pro${path}</loc>`);
    }
    expect(res.text.match(/<url>/g)).toHaveLength(SITEMAP_PATHS.length);
  });

  it("derives every discovery URL from APP_ORIGIN", async () => {
    const { app } = makeApp({ APP_ORIGIN: "https://staging.example.test" });
    const robots = await request(app).get("/robots.txt").expect(200);
    expect(robots.text).toContain("Sitemap: https://staging.example.test/sitemap.xml");
    const sitemap = await request(app).get("/sitemap.xml").expect(200);
    expect(sitemap.text).toContain("<loc>https://staging.example.test/llms.txt</loc>");
    expect(sitemap.text).not.toContain("shopcart.wals.pro");
    const llms = await request(app).get("/llms.txt").expect(200);
    expect(llms.text).toContain("https://staging.example.test/mcp");
  });

  it("advertises llms.txt via Link header and <link rel=alternate> on the landing page", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/").expect(200);
    expect(res.headers.link).toContain('<https://shopcart.wals.pro/llms.txt>; rel="alternate"; type="text/plain"');
    expect(res.headers.vary).toContain("Accept-Language");
    expect(res.text).toContain('<link rel="alternate" type="text/plain" title="llms.txt" href="https://shopcart.wals.pro/llms.txt">');
    expect(res.text).toContain('<link rel="canonical" href="https://shopcart.wals.pro/?lang=');
    expect(res.text).toContain('hreflang="de" href="https://shopcart.wals.pro/?lang=de"');
    expect(res.text).toContain('hreflang="en" href="https://shopcart.wals.pro/?lang=en"');
  });
});

describe("Stripe Checkout locale", () => {
  const { config } = makeApp({ STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_PRO_PRICE_ID: "price_test_pro" });
  const user = { id: "user_123" };
  const now = new Date("2026-11-25T10:00:00+01:00");

  it("opens a German Stripe Checkout for /billing?lang=de and an English one otherwise", () => {
    const de = buildProCheckoutParams(user, "cus_1", config, { lang: "de", now });
    expect(de.locale).toBe("de");
    expect(de.success_url).toBe("https://shopcart.wals.pro/billing?checkout=success&lang=de");
    expect(de.cancel_url).toBe("https://shopcart.wals.pro/billing?checkout=cancel&lang=de");

    const en = buildProCheckoutParams(user, "cus_1", config, { lang: "en", now });
    expect(en.locale).toBe("en");

    const fallback = buildProCheckoutParams(user, "cus_1", config, { now });
    expect(fallback.locale).toBe("en");
  });

  it("keeps the subscription, customer, and promo-trial behaviour unchanged", () => {
    const params = buildProCheckoutParams(user, "cus_1", config, { lang: "de", now });
    expect(params.mode).toBe("subscription");
    expect(params.customer).toBe("cus_1");
    expect(params.client_reference_id).toBe("user_123");
    expect(params.line_items).toEqual([{ price: "price_test_pro", quantity: 1 }]);
    expect(params.metadata).toEqual({ user_id: "user_123" });
    if (config.promoTrialEnd && config.promoTrialEnd.getTime() - now.getTime() >= 48 * 3600 * 1000) {
      expect(params.subscription_data?.trial_end).toBe(Math.floor(config.promoTrialEnd.getTime() / 1000));
      expect(params.allow_promotion_codes).toBeUndefined();
    } else {
      expect(params.allow_promotion_codes).toBe(true);
    }
  });

  it("renders the checkout form with the page language so the POST can pass it on", async () => {
    // The form itself is only shown to signed-in users; the handler reads body.lang (see src/web/billing.ts).
    const { app } = makeApp();
    const res = await request(app).get("/billing?lang=de").expect(200);
    expect(res.text).toContain('lang="de"');
  });
});
