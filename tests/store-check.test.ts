import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type {
  GetProductResult,
  StoreAdapter,
  StoreDiscountsResult,
  StoreInfo,
  StorePoliciesResult
} from "../src/adapters/types.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { safeFetch } from "../src/security/ssrf.js";
import { MemoryStore } from "../src/store/memory.js";
import {
  buildStoreCheckAssessment,
  INDEPENDENCE_DISCLAIMER,
  STORE_CHECK_MAX_BODY_BYTES,
  StoreCheckRateLimiter
} from "../src/web/store-check-core.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANALYTICS_JS_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, "public", "assets", "analytics.js"),
  "utf8"
);

function makeMockAdapter(opts: {
  platform: StoreInfo["platform"];
  store: StoreInfo | null;
  productResult?: GetProductResult | null;
  productError?: Error;
  policiesResult?: StorePoliciesResult;
  discountsResult?: StoreDiscountsResult;
  delayMs?: number;
  onDetect?: (origin: string) => Promise<StoreInfo | null>;
}): StoreAdapter {
  return {
    platform: opts.platform,
    async detect(origin) {
      if (opts.onDetect) return opts.onDetect(origin);
      if (opts.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      return opts.store;
    },
    async searchProducts(origin) {
      return { store_origin: origin, currency: "EUR", products: [], notices: [] };
    },
    async getProduct(origin) {
      if (opts.productError) throw opts.productError;
      if (!opts.productResult) {
        throw new Error("Product not found");
      }
      return { ...opts.productResult, store_origin: origin };
    },
    ...(opts.policiesResult
      ? {
          async getStorePolicies() {
            return opts.policiesResult!;
          }
        }
      : {}),
    ...(opts.discountsResult
      ? {
          async findStoreDiscounts() {
            return opts.discountsResult!;
          }
        }
      : {}),
    async buildCartLink(origin) {
      return {
        store_origin: origin,
        cart_url: `${origin}/cart`,
        mode: "cart",
        items: [],
        warnings: [],
        next_step: "Review cart"
      };
    }
  };
}

function makeTestApp(opts?: {
  adapters?: StoreAdapter[];
  rateLimiter?: StoreCheckRateLimiter;
  timeoutMs?: number;
  extraEnv?: Record<string, string>;
}) {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00",
    ...opts?.extraEnv
  });
  const registry = opts?.adapters ? new AdapterRegistry(opts.adapters) : new AdapterRegistry();
  const app = createApp({
    config,
    store: new MemoryStore(),
    registry,
    storeCheckRateLimiter: opts?.rateLimiter,
    storeCheckTimeoutMs: opts?.timeoutMs
  });
  return { config, app };
}

function makeShopifyStore(overrides: Partial<StoreInfo> = {}): StoreInfo {
  return {
    platform: "shopify",
    origin: "https://snocks.com",
    name: "SNOCKS",
    currency: "EUR",
    country: "DE",
    myshopifyDomain: "snocks.myshopify.com",
    wafRestricted: false,
    capabilities: {
      predictiveSearch: true,
      productCatalogJson: true,
      storefrontMcp: true,
      storefrontMcpTools: ["search_shop_catalog", "search_shop_policies_and_faqs"],
      storefrontUcp: true
    },
    ...overrides
  };
}

describe("Storefront Self-Check Pages (/check & /en/check), Navigation, SEO & CSP", () => {
  it("serves DE (/check) and EN (/en/check) with strict CSP, zero inline JS/styles, SEO metadata, disclaimer, and static assets", async () => {
    const { app } = makeTestApp({ extraEnv: { GA4_MEASUREMENT_ID: "G-TEST123456" } });

    const de = await request(app).get("/check").expect(200);
    expect(de.headers["content-language"]).toBe("de");
    expect(de.headers["x-content-type-options"]).toBe("nosniff");
    expect(de.headers["x-frame-options"]).toBe("DENY");
    expect(de.headers["referrer-policy"]).toBe("same-origin");
    expect(de.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(de.headers["content-security-policy"]).toContain("style-src 'self'");
    expect(de.headers["content-security-policy"]).not.toContain("unsafe-inline");
    expect(de.headers["content-security-policy"]).toContain("frame-ancestors 'none'");

    // Strict zero-inline-JS & zero-inline-styles check
    const inlineScriptsDe = de.text.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
    expect(inlineScriptsDe).toEqual(['<script type="application/ld+json">']);
    expect(de.text).not.toMatch(/<style[\s>]/i);
    expect(de.text).not.toMatch(/\sstyle="/i);
    expect(de.text).not.toMatch(/\son[a-z]+="/i);

    // SEO & i18n
    expect(de.text).toContain('<link rel="canonical" href="https://shopcart.wals.pro/check">');
    expect(de.text).toContain('<link rel="alternate" hreflang="de" href="https://shopcart.wals.pro/check">');
    expect(de.text).toContain('<link rel="alternate" hreflang="en" href="https://shopcart.wals.pro/en/check">');
    expect(de.text).toContain('<link rel="alternate" hreflang="x-default" href="https://shopcart.wals.pro/check">');
    expect(de.text).toContain('property="og:title"');
    expect(de.text).toContain('name="twitter:card"');
    expect(de.text).toContain('href="/en/check" hreflang="en"');
    expect(de.text).toContain('src="/assets/store-check.js');
    expect(de.text).toContain('href="/assets/store-check.css');
    expect(de.text).toContain('data-page-type="store_check"');

    // Independence disclaimer & subtle optional wals.pro footer note
    expect(de.text).toContain(INDEPENDENCE_DISCLAIMER.de);
    expect(de.text).toContain("Du willst deinen Shop für KI-Shopping optimieren?");
    expect(de.text).toContain('href="https://wals.pro" target="_blank" rel="noopener noreferrer">Mehr über wals.pro</a>');

    // EN page
    const en = await request(app).get("/en/check").expect(200);
    expect(en.headers["content-language"]).toBe("en");
    expect(en.text).toContain('<link rel="canonical" href="https://shopcart.wals.pro/en/check">');
    expect(en.text).toContain('href="/check" hreflang="de"');
    expect(en.text).toContain(INDEPENDENCE_DISCLAIMER.en);
    expect(en.text).toContain("Want to optimize your store for AI shopping?");
    expect(en.text).toContain('href="https://wals.pro" target="_blank" rel="noopener noreferrer">Learn more at wals.pro</a>');
    const inlineScriptsEn = en.text.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
    expect(inlineScriptsEn).toEqual(['<script type="application/ld+json">']);

    // Static assets & XSS-safe JS verification (no innerHTML / outerHTML / document.write)
    const cssRes = await request(app).get("/assets/store-check.css").expect(200);
    expect(cssRes.headers["content-type"]).toContain("text/css");
    expect(cssRes.headers["x-content-type-options"]).toBe("nosniff");
    expect(cssRes.text).toContain(":user-invalid");

    const jsRes = await request(app).get("/assets/store-check.js").expect(200);
    expect(jsRes.headers["content-type"]).toContain("application/javascript");
    expect(jsRes.headers["x-content-type-options"]).toBe("nosniff");
    expect(jsRes.text).not.toMatch(/\.innerHTML\b|\.outerHTML\b|document\.write\b|insertAdjacentHTML\b/);

    // Navigation & homepage teaser links
    const homeDe = await request(app).get("/?lang=de").expect(200);
    expect(homeDe.text).toContain('href="/check">Shop prüfen</a>');
    expect(homeDe.text).toContain('class="check-teaser"');

    const homeEn = await request(app).get("/?lang=en").expect(200);
    expect(homeEn.text).toContain('href="/en/check">Check store</a>');
    expect(homeEn.text).toContain('class="check-teaser"');

    const guidesDe = await request(app).get("/guides?lang=de").expect(200);
    expect(guidesDe.text).toContain('href="/check">Shop prüfen</a>');

    const privacyEn = await request(app).get("/privacy?lang=en").expect(200);
    expect(privacyEn.text).toContain('href="/en/check">Check store</a>');
  });
});

describe("Storefront Self-Check Core Assessment & Platform Mapping (DE & EN)", () => {
  it("maps Shopify AI-Ready, WAF-restricted, WooCommerce, Shopware, Magento, BigCommerce, Amazon, JSON-LD, and unreachable stores accurately", () => {
    const shopifyReady = buildStoreCheckAssessment({
      requestedOrigin: "https://snocks.com",
      requestedDomain: "snocks.com",
      store: makeShopifyStore(),
      productUrl: null,
      productResult: null,
      productError: null,
      policyProbe: { checked: true, hasShipping: true, hasReturns: true },
      discountProbe: { checked: true, codesFound: 1, automaticDealsFound: 0 },
      lang: "de"
    });
    expect(shopifyReady.status).toBe("ai_ready");
    expect(shopifyReady.statusLabel).toBe("AI-Ready");
    expect(shopifyReady.platformLabel).toBe("Shopify");
    expect(shopifyReady.capabilities).toHaveLength(6);
    expect(shopifyReady.capabilities.every((c) => c.state === "supported")).toBe(true);
    expect(shopifyReady.disclaimer).toBe(INDEPENDENCE_DISCLAIMER.de);
    expect(shopifyReady.examplePrompt.text).toContain("snocks.com");

    // Shopify WAF-restricted + missing policies
    const shopifyWaf = buildStoreCheckAssessment({
      requestedOrigin: "https://example-shop.de",
      requestedDomain: "example-shop.de",
      store: makeShopifyStore({ origin: "https://example-shop.de", wafRestricted: true }),
      productUrl: null,
      productResult: null,
      productError: null,
      policyProbe: { checked: true, hasShipping: false, hasReturns: false },
      discountProbe: null,
      lang: "en"
    });
    expect(shopifyWaf.status).toBe("partially_readable");
    expect(shopifyWaf.statusLabel).toBe("Partially readable");
    expect(shopifyWaf.hints.some((h) => h.title.includes("WAF"))).toBe(true);
    expect(shopifyWaf.hints.some((h) => h.title.toLowerCase().includes("policy"))).toBe(true);
    expect(shopifyWaf.disclaimer).toBe(INDEPENDENCE_DISCLAIMER.en);

    // WooCommerce AI-Ready
    const woo = buildStoreCheckAssessment({
      requestedOrigin: "https://8bar-bikes.com",
      requestedDomain: "8bar-bikes.com",
      store: {
        platform: "woocommerce",
        origin: "https://8bar-bikes.com",
        name: "8bar bikes",
        currency: "EUR",
        country: "DE",
        myshopifyDomain: null,
        wafRestricted: false,
        capabilities: {
          predictiveSearch: false,
          productCatalogJson: false,
          storefrontMcp: false,
          storefrontMcpTools: [],
          wooStoreApi: true
        }
      },
      productUrl: null,
      productResult: null,
      productError: null,
      policyProbe: null,
      discountProbe: null,
      lang: "de"
    });
    expect(woo.status).toBe("ai_ready");
    expect(woo.platformLabel).toBe("WooCommerce");
    expect(woo.capabilities.find((c) => c.key === "cart_links")?.state).toBe("limited");

    // Universal JSON-LD (normal vs WAF-blocked)
    const jsonld = buildStoreCheckAssessment({
      requestedOrigin: "https://example-retailer.de",
      requestedDomain: "example-retailer.de",
      store: {
        platform: "jsonld",
        origin: "https://example-retailer.de",
        name: "Example Retailer",
        currency: "EUR",
        country: "DE",
        myshopifyDomain: null,
        wafRestricted: false,
        capabilities: {
          predictiveSearch: false,
          productCatalogJson: false,
          storefrontMcp: false,
          storefrontMcpTools: [],
          jsonLdProduct: true
        }
      },
      productUrl: null,
      productResult: null,
      productError: null,
      policyProbe: null,
      discountProbe: null,
      lang: "de"
    });
    expect(jsonld.status).toBe("partially_readable");
    expect(jsonld.statusLabel).toBe("Eingeschränkt lesbar");
    expect(jsonld.hints.some((h) => h.title.includes("JSON-LD"))).toBe(true);

    const jsonldBlocked = buildStoreCheckAssessment({
      requestedOrigin: "https://blocked.example",
      requestedDomain: "blocked.example",
      store: {
        platform: "jsonld",
        origin: "https://blocked.example",
        name: null,
        currency: "EUR",
        country: null,
        myshopifyDomain: null,
        wafRestricted: true,
        capabilities: {
          predictiveSearch: false,
          productCatalogJson: false,
          storefrontMcp: false,
          storefrontMcpTools: []
        }
      },
      productUrl: null,
      productResult: null,
      productError: null,
      policyProbe: null,
      discountProbe: null,
      lang: "de"
    });
    expect(jsonldBlocked.status).toBe("not_publicly_readable");
    expect(jsonldBlocked.statusLabel).toBe("Nicht öffentlich lesbar");

    // Unreachable store
    const unreachable = buildStoreCheckAssessment({
      requestedOrigin: "https://down.example",
      requestedDomain: "down.example",
      store: null,
      productUrl: null,
      productResult: null,
      productError: null,
      policyProbe: null,
      discountProbe: null,
      lang: "en"
    });
    expect(unreachable.status).toBe("not_publicly_readable");
    expect(unreachable.statusLabel).toBe("Not publicly readable");
  });
});

describe("POST /api/store-check — Security, Abuse Hardening & Functional API", () => {
  it("accepts bare domains and optional same-store productUrl, sanitizes XSS payloads, and bounds variants", async () => {
    const manyVariants = Array.from({ length: 18 }, (_, i) => ({
      id: `${1000 + i}`,
      title: i === 0 ? `<svg onload=alert(1)>Size ${40 + i}` : `Size ${40 + i}`,
      sku: i === 0 ? "<b>SKU-1</b>\x07" : `SKU-${i + 1}`,
      available: i % 2 === 0,
      price: { amount: 22.49, formatted: "22,49 €", currency: "EUR" },
      compare_at_price: i === 0 ? { amount: 29.99, formatted: "29,99 €", currency: "EUR" } : null,
      discount_percent: i === 0 ? 25 : null,
      option_values: [`Size ${40 + i}`]
    }));

    const adapter = makeMockAdapter({
      platform: "shopify",
      store: makeShopifyStore({
        name: `<script>alert("xss")</script>SNOCKS <b>Official</b>`
      }),
      productResult: {
        store_origin: "https://snocks.com",
        currency: "EUR",
        product: {
          id: "prod-1",
          handle: "sneaker-socken",
          title: `<img src=x onerror=alert(1)>Sneaker Socken`,
          vendor: `<iframe src="evil"></iframe>SNOCKS`,
          product_type: "Socks",
          description_text: "Clean text",
          sku: "SN-01",
          gtin: "4260000000001",
          available: true,
          availability: "InStock",
          price_min: { amount: 22.49, formatted: "22,49 €", currency: "EUR" },
          price_max: { amount: 22.49, formatted: "22,49 €", currency: "EUR" },
          url: "https://snocks.com/products/sneaker-socken",
          options: [{ name: "Size", values: ["43-46"] }],
          images: [],
          variants: manyVariants
        }
      },
      policiesResult: {
        store_origin: "https://snocks.com",
        shipping_policy_excerpt: "Free shipping over 39 EUR",
        return_policy_excerpt: "30 days return policy",
        hints: {
          free_shipping_threshold: "39 €",
          return_window_days: 30,
          return_window_text: "30 Tage",
          free_returns: true,
          delivery_time_text: "1-3 Werktage",
          shipping_carriers: ["DHL"]
        },
        policy_urls: {
          shipping: "https://snocks.com/policies/shipping-policy",
          returns: "https://snocks.com/policies/refund-policy"
        },
        notices: []
      },
      discountsResult: {
        store_origin: "https://snocks.com",
        codes: [
          {
            code: "SAVE10",
            context_snippet: "10% off",
            source: "homepage_announcement",
            confidence: "high"
          }
        ],
        automatic_deals: [],
        checked_sources: ["homepage"],
        source_notice: "Untrusted",
        disclaimer: "Merchant validates"
      }
    });

    const { app } = makeTestApp({ adapters: [adapter] });

    const res = await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Content-Type", "application/json")
      .send({
        storeUrl: "snocks.com",
        productUrl: "https://www.snocks.com/products/sneaker-socken",
        lang: "de"
      })
      .expect(200);

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body.status).toBe("ai_ready");
    expect(res.body.platform).toBe("shopify");
    // XSS payloads stripped cleanly
    expect(res.body.store.name).toBe("SNOCKS Official");
    expect(res.body.store.name).not.toContain("<script>");
    expect(res.body.productCheck.ok).toBe(true);
    expect(res.body.productCheck.product.title).toBe("Sneaker Socken");
    expect(res.body.productCheck.product.title).not.toContain("<img");
    expect(res.body.productCheck.product.vendor).toBe("SNOCKS");
    // Variants bounded to 12 displayed while total reports 18
    expect(res.body.productCheck.product.variantCount).toBe(18);
    expect(res.body.productCheck.product.variants).toHaveLength(12);
    expect(res.body.productCheck.product.variants[0].title).toBe("Size 40");
    expect(res.body.productCheck.product.variants[0].sku).toBe("SKU-1");
    expect(res.body.examplePrompt.text).toContain("Sneaker Socken");
    expect(res.body.disclaimer).toBe(INDEPENDENCE_DISCLAIMER.de);
  });

  it("rejects wrong Content-Type (415), oversized bodies (413), malformed JSON (400), and cross-origin CSRF (403)", async () => {
    const { app } = makeTestApp({ adapters: [makeMockAdapter({ platform: "shopify", store: makeShopifyStore() })] });

    // 415 wrong Content-Type
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "text/plain")
      .send('{"storeUrl":"snocks.com"}')
      .expect(415);

    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("storeUrl=snocks.com")
      .expect(415);

    // 413 oversized body (> 2048 bytes)
    const oversized = JSON.stringify({ storeUrl: "snocks.com", pad: "a".repeat(STORE_CHECK_MAX_BODY_BYTES + 100) });
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/json")
      .send(oversized)
      .expect(413);

    // 400 invalid JSON
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/json")
      .send("{not-valid-json")
      .expect(400);

    // 403 cross-origin Origin header
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://evil.example")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com" })
      .expect(403);

    // 403 cross-origin Referer header
    await request(app)
      .post("/api/store-check")
      .set("Referer", "https://evil.example/attack")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com" })
      .expect(403);

    // 403 Sec-Fetch-Site: cross-site and same-site
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com" })
      .expect(403);

    await request(app)
      .post("/api/store-check")
      .set("Sec-Fetch-Site", "same-site")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com" })
      .expect(403);

    // 403 Origin: null without Sec-Fetch-Site: same-origin
    await request(app)
      .post("/api/store-check")
      .set("Origin", "null")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com" })
      .expect(403);
  });

  it("blocks SSRF targets, invalid URL schemes, credentials, cross-site productUrl, and private-IP redirects", async () => {
    const ssrfTargets = [
      "localhost",
      "http://localhost/admin",
      "127.0.0.1",
      "https://127.0.0.1",
      "https://169.254.169.254/latest/meta-data/",
      "10.0.0.1",
      "192.168.1.1",
      "172.16.0.5",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "metadata.google.internal",
      "printer.local",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://example.com",
      "https://user:pass@snocks.com",
      "user:pass@snocks.com"
    ];

    const rateLimiter = new StoreCheckRateLimiter({ maxPerMinute: 100, maxPerHour: 200 });
    const { app } = makeTestApp({
      adapters: [makeMockAdapter({ platform: "shopify", store: makeShopifyStore() })],
      rateLimiter
    });

    for (const badUrl of ssrfTargets) {
      const res = await request(app)
        .post("/api/store-check")
        .set("Origin", "https://shopcart.wals.pro")
        .set("Content-Type", "application/json")
        .send({ storeUrl: badUrl, lang: "en" })
        .expect(400);
      expect(res.body.field).toBe("storeUrl");
    }

    // Cross-site productUrl rejected
    const crossSite = await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/json")
      .send({
        storeUrl: "snocks.com",
        productUrl: "https://other-store.example/products/sneaker",
        lang: "de"
      })
      .expect(400);
    expect(crossSite.body.error).toBe("product_url_cross_site");
    expect(crossSite.body.field).toBe("productUrl");

    // Redirect to private IP via real safeFetch blocked and does not leak internal IP
    const redirectAdapter = makeMockAdapter({
      platform: "jsonld",
      store: null,
      async onDetect(origin) {
        await safeFetch(origin, {
          lookupFn: async (hostname) =>
            hostname === "evil-redirect.example"
              ? [{ address: "93.184.216.34", family: 4 }]
              : [{ address: "169.254.169.254", family: 4 }],
          fetchImpl: async () => ({
            status: 302,
            headers: { get: (k) => (k.toLowerCase() === "location" ? "https://internal-hop.example/secret" : null) },
            body: null
          })
        });
        return null;
      }
    });

    const { app: redirectApp } = makeTestApp({ adapters: [redirectAdapter] });
    const redirectRes = await request(redirectApp)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "evil-redirect.example", lang: "en" })
      .expect(400);
    expect(redirectRes.body.error).toBe("url_blocked");
    expect(JSON.stringify(redirectRes.body)).not.toContain("169.254.169.254");
    expect(JSON.stringify(redirectRes.body)).not.toContain("internal-hop.example");
  });

  it("enforces 10/min and 60/hour IP rate limits, resists Cloud Run X-Forwarded-For spoofing, and bounds memory", async () => {
    let fakeNow = 1_700_000_000_000;
    const rateLimiter = new StoreCheckRateLimiter({
      maxPerMinute: 10,
      maxPerHour: 60,
      maxEntries: 50,
      nowFn: () => fakeNow
    });

    const { app } = makeTestApp({
      adapters: [makeMockAdapter({ platform: "shopify", store: makeShopifyStore() })],
      rateLimiter
    });

    // Simulate attacker rotating spoofed leftmost X-Forwarded-For while real Cloud Run client IP is rightmost
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/store-check")
        .set("Origin", "https://shopcart.wals.pro")
        .set("X-Forwarded-For", `198.51.100.${i + 1}, 203.0.113.42`)
        .set("Content-Type", "application/json")
        .send({ storeUrl: "snocks.com", lang: "de" })
        .expect(200);
    }

    // 11th check within 1 minute from same real IP (even with new spoofed prefix) -> 429 + Retry-After
    const blockedMinute = await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "198.51.100.99, 203.0.113.42")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" })
      .expect(429);
    expect(Number(blockedMinute.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(blockedMinute.body.error).toBe("rate_limited");
    expect(blockedMinute.body.message).toContain("Zu viele Prüfungen");

    // Advance 61s across 5 more batches of 10 (total 60 in 1 hour) -> 61st hits hourly limit
    for (let batch = 0; batch < 5; batch++) {
      fakeNow += 61_000;
      for (let i = 0; i < 10; i++) {
        const r = rateLimiter.consume("203.0.113.42");
        expect(r.allowed).toBe(true);
      }
    }
    fakeNow += 61_000;
    const blockedHour = rateLimiter.consume("203.0.113.42");
    expect(blockedHour.allowed).toBe(false);
    expect(blockedHour.limitType).toBe("hour");
    expect(blockedHour.retryAfterSeconds).toBeGreaterThan(60);

    // Bounded memory cap under IP flooding
    for (let i = 0; i < 120; i++) {
      rateLimiter.consume(`203.0.114.${i}`);
    }
    expect(rateLimiter.size).toBeLessThanOrEqual(50);
  });

  it("enforces hard overall execution timeout (504) on slow/tarpit stores", async () => {
    const slowAdapter = makeMockAdapter({
      platform: "shopify",
      store: makeShopifyStore(),
      delayMs: 500
    });
    const { app } = makeTestApp({
      adapters: [slowAdapter],
      timeoutMs: 80
    });

    const res = await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "en" })
      .expect(504);

    expect(res.body.error).toBe("timeout");
    expect(res.body.message).toContain("did not respond");
  });
});

describe("GA4 Consent Integration for storefront_self_check_run (Zero Pre-Consent, Zero PII)", () => {
  it("fires storefront_self_check_run ONLY after explicit consent and ONLY with allowlisted categorical fields", () => {
    const localStore = new Map<string, string>();
    const listeners = new Map<string, Array<(ev: any) => void>>();
    const gtagCalls: any[] = [];

    class FakeEl {
      attrs = new Map<string, string>();
      constructor(attrs: Record<string, string> = {}) {
        for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
      }
      getAttribute(k: string) {
        return this.attrs.get(k) ?? null;
      }
      setAttribute(k: string, v: string) {
        this.attrs.set(k, v);
      }
      removeAttribute(k: string) {
        this.attrs.delete(k);
      }
      closest() {
        return null;
      }
    }
    class FakeScript extends FakeEl {
      src = "";
      async = false;
    }

    const scriptEl = new FakeScript({
      src: "/assets/analytics.js?v=0.6.0",
      "data-ga4-id": "G-CHECKTEST1",
      "data-page-lang": "de",
      "data-page-type": "store_check"
    });

    const fakeWindow: Record<string, any> = {
      location: {
        href: "https://shopcart.wals.pro/check",
        origin: "https://shopcart.wals.pro",
        pathname: "/check",
        search: "",
        hostname: "shopcart.wals.pro",
        protocol: "https:"
      },
      localStorage: {
        getItem: (k: string) => localStore.get(k) ?? null,
        setItem: (k: string, v: string) => localStore.set(k, v)
      },
      sessionStorage: { getItem: () => null, setItem: () => undefined }
    };

    const fakeDocument: Record<string, any> = {
      currentScript: scriptEl,
      referrer: "",
      documentElement: { lang: "de" },
      head: { appendChild: (n: any) => n },
      cookie: "",
      getElementById: () => null,
      querySelector: (sel: string) => (sel.includes("analytics.js") ? scriptEl : null),
      createElement: () => new FakeScript(),
      addEventListener: (type: string, fn: (ev: any) => void) => {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
      }
    };

    const runWithConsent = (granted: boolean) => {
      localStore.clear();
      listeners.clear();
      gtagCalls.length = 0;
      delete fakeWindow.dataLayer;
      delete fakeWindow.gtag;
      if (granted) {
        localStore.set("shopcart_consent_v1", JSON.stringify({ version: 1, analytics: true }));
      }
      const ctx = vm.createContext({
        window: fakeWindow,
        document: fakeDocument,
        Element: FakeEl,
        HTMLElement: FakeEl,
        HTMLScriptElement: FakeScript,
        HTMLFormElement: FakeEl,
        HTMLVideoElement: FakeEl,
        URL,
        Date,
        Number,
        Object,
        Array,
        Set,
        Boolean,
        JSON,
        encodeURIComponent
      });
      vm.runInContext(ANALYTICS_JS_SOURCE, ctx);
      if (typeof fakeWindow.gtag === "function") {
        const orig = fakeWindow.gtag;
        fakeWindow.gtag = (...args: any[]) => {
          gtagCalls.push(args);
          return orig(...args);
        };
      }
      for (const fn of listeners.get("shopcart:store_check_run") ?? []) {
        fn({
          detail: {
            platform: "shopify",
            status: "ai_ready",
            has_product_url: true,
            // Attempt to sneak PII / URLs — must NEVER be forwarded!
            storeUrl: "https://secret-merchant.example",
            productUrl: "https://secret-merchant.example/products/secret"
          }
        });
      }
    };

    // Without consent -> zero events
    runWithConsent(false);
    expect(gtagCalls).toHaveLength(0);

    // With consent -> fires strictly non-PII categorical payload
    runWithConsent(true);
    const checkEvent = gtagCalls.find((c) => c[0] === "event" && c[1] === "storefront_self_check_run");
    expect(checkEvent).toBeDefined();
    expect(checkEvent[2]).toEqual({
      page_location: "https://shopcart.wals.pro/check",
      page_referrer: "",
      platform: "shopify",
      status: "ai_ready",
      has_product_url: true
    });
    expect(JSON.stringify(checkEvent[2])).not.toContain("secret-merchant.example");
  });
});
