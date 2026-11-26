import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AmazonAdapter } from "../src/adapters/amazon/adapter.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import type {
  GetProductResult,
  StoreAdapter,
  StoreDiscountsResult,
  StoreInfo,
  StorePoliciesResult
} from "../src/adapters/types.js";
import { createApp } from "../src/app.js";
import { loadConfig, parseTrustedProxyHops } from "../src/config.js";
import {
  getInFlightSlotCount,
  safeFetch,
  SELFCHECK_GLOBAL_SLOT_KEY,
  SsrfError
} from "../src/security/ssrf.js";
import { MemoryStore } from "../src/store/memory.js";
import { createStoreCheckRouter } from "../src/web/store-check.js";
import {
  buildStoreCheckAssessment,
  extractTrustedClientIp,
  INDEPENDENCE_DISCLAIMER,
  normalizeClientRateLimitKey,
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
  maxConcurrentChecks?: number;
  extraEnv?: Record<string, string>;
}) {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00",
    ...opts?.extraEnv
  });
  const storeCheckRegistry = opts?.adapters ? new AdapterRegistry(opts.adapters) : undefined;
  const app = createApp({
    config,
    store: new MemoryStore(),
    storeCheckRegistry,
    storeCheckRateLimiter: opts?.rateLimiter,
    storeCheckTimeoutMs: opts?.timeoutMs,
    storeCheckMaxConcurrent: opts?.maxConcurrentChecks
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

  it("never spends operator Amazon PA-API or Keepa budgets via anonymous /api/store-check (isolated registry + skip getProduct)", async () => {
    const prevEnv = {
      AMAZON_PAAPI_ACCESS_KEY: process.env.AMAZON_PAAPI_ACCESS_KEY,
      AMAZON_PAAPI_SECRET_KEY: process.env.AMAZON_PAAPI_SECRET_KEY,
      AMAZON_ASSOCIATE_TAG_DE: process.env.AMAZON_ASSOCIATE_TAG_DE,
      KEEPA_API_KEY: process.env.KEEPA_API_KEY
    };
    process.env.AMAZON_PAAPI_ACCESS_KEY = "dummy_paapi_access_key";
    process.env.AMAZON_PAAPI_SECRET_KEY = "dummy_paapi_secret_key";
    process.env.AMAZON_ASSOCIATE_TAG_DE = "dummytag-21";
    process.env.KEEPA_API_KEY = "dummy_keepa_key";

    try {
      // 1. Default isolated production registry ignores process.env Amazon keys completely
      const { app: prodIsolatedApp } = makeTestApp();
      const isolatedRes = await request(prodIsolatedApp)
        .post("/api/store-check")
        .set("Origin", "https://shopcart.wals.pro")
        .set("Content-Type", "application/json")
        .send({
          storeUrl: "amazon.de",
          productUrl: "https://www.amazon.de/dp/B08N5WRWNW",
          lang: "de"
        })
        .expect(200);

      expect(isolatedRes.body.platform).toBe("amazon");
      expect(isolatedRes.body.status).toBe("partially_readable");
      expect(isolatedRes.body.productCheck.ok).toBe(false);
      expect(isolatedRes.body.productCheck.errorMessage).toMatch(/PA-API|Keepa/);
      // Search capability must NOT claim liveSearch is active even with process.env keys set
      expect(
        isolatedRes.body.capabilities.find((c: { key: string }) => c.key === "product_search")?.state
      ).toBe("limited");

      // 2. Defense-in-depth: even if an AmazonAdapter had a live fetcher/credentials, runStoreCheck skips getProduct
      let providerCalls = 0;
      const spyAmazonAdapter = new AmazonAdapter({
        env: {
          AMAZON_PAAPI_ACCESS_KEY: "dummy_paapi_access_key",
          AMAZON_PAAPI_SECRET_KEY: "dummy_paapi_secret_key",
          AMAZON_ASSOCIATE_TAG_DE: "dummytag-21",
          KEEPA_API_KEY: "dummy_keepa_key"
        },
        fetcher: async () => {
          providerCalls += 1;
          throw new Error("Paid Amazon provider must never be called from /api/store-check");
        }
      });

      const { app: spyApp } = makeTestApp({ adapters: [spyAmazonAdapter] });
      const spyRes = await request(spyApp)
        .post("/api/store-check")
        .set("Origin", "https://shopcart.wals.pro")
        .set("Content-Type", "application/json")
        .send({
          storeUrl: "amazon.de",
          productUrl: "https://www.amazon.de/dp/B08N5WRWNW",
          lang: "en"
        })
        .expect(200);

      expect(providerCalls).toBe(0);
      expect(spyRes.body.platform).toBe("amazon");
      expect(spyRes.body.productCheck.ok).toBe(false);
      expect(spyRes.body.productCheck.errorMessage).toMatch(/PA-API|Keepa/);
    } finally {
      for (const [key, val] of Object.entries(prevEnv)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
    }
  });

  it("does not cache poisoned Shopify metadata defaults or overwrite valid cache on transient CONCURRENCY_LIMIT / TIMEOUT errors", async () => {
    // Case A: Cold cache + CONCURRENCY_LIMIT -> must NOT cache USD/wafRestricted defaults
    let failMode: "concurrency" | "timeout" | "ok" = "concurrency";
    const clientA = new ShopifyClient(async (url) => {
      if (failMode === "concurrency") {
        throw new SsrfError("CONCURRENCY_LIMIT", "Too many concurrent requests");
      }
      if (failMode === "timeout") {
        throw new SsrfError("TIMEOUT", "Request timed out");
      }
      return {
        status: 200,
        url,
        contentType: "application/json",
        headers: {},
        bodyBuffer: Buffer.from(
          JSON.stringify({
            name: "Clean DE Shop",
            currency: "EUR",
            country: "DE",
            myshopify_domain: "clean-de.myshopify.com"
          })
        ),
        bodyText: JSON.stringify({
          name: "Clean DE Shop",
          currency: "EUR",
          country: "DE",
          myshopify_domain: "clean-de.myshopify.com"
        })
      };
    });

    const transientMeta = await clientA.resolveDomainMetadata("https://clean-de.example", {
      concurrencyKey: "selfcheck:attacker"
    });
    expect(transientMeta.detectedShopify).toBe(false);
    expect(transientMeta.wafRestricted).toBe(false);

    // Next normal call must NOT hit a poisoned cache entry; it must resolve fresh EUR metadata
    failMode = "ok";
    const freshMeta = await clientA.resolveDomainMetadata("https://clean-de.example", {
      concurrencyKey: "user:legit"
    });
    expect(freshMeta.detectedShopify).toBe(true);
    expect(freshMeta.currency).toBe("EUR");
    expect(freshMeta.name).toBe("Clean DE Shop");
    expect(freshMeta.wafRestricted).toBe(false);

    // Case B: Warm valid cache + forceRefresh hitting TIMEOUT -> existing valid cache stays intact
    failMode = "timeout";
    const failedRefresh = await clientA.resolveDomainMetadata("https://clean-de.example", {
      forceRefresh: true,
      concurrencyKey: "selfcheck:attacker"
    });
    expect(failedRefresh.detectedShopify).toBe(false);

    // Subsequent cached read returns the intact pre-existing EUR metadata (no overwrite)
    failMode = "concurrency";
    const preserved = await clientA.resolveDomainMetadata("https://clean-de.example", {
      concurrencyKey: "user:legit"
    });
    expect(preserved.detectedShopify).toBe(true);
    expect(preserved.currency).toBe("EUR");
    expect(preserved.name).toBe("Clean DE Shop");
    expect(preserved.wafRestricted).toBe(false);
  });

  it("supports configurable TRUSTED_PROXY_HOPS (0, 1, 2) and prevents leftmost XFF spoofing across topologies", async () => {
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops("0")).toBe(0);
    expect(parseTrustedProxyHops("2")).toBe(2);
    expect(parseTrustedProxyHops("10")).toBe(10);
    expect(parseTrustedProxyHops("-1")).toBe(1);
    expect(parseTrustedProxyHops("11")).toBe(1);
    expect(parseTrustedProxyHops("abc")).toBe(1);

    const makeFakeReq = (xff: string | undefined, remoteAddress: string) =>
      ({
        headers: xff !== undefined ? { "x-forwarded-for": xff } : {},
        socket: { remoteAddress }
      }) as unknown as import("express").Request;

    // hops = 0 -> ignore XFF completely, use socket remoteAddress
    expect(extractTrustedClientIp(makeFakeReq("198.51.100.1, 203.0.113.42", "192.0.2.9"), 0)).toBe(
      "192.0.2.9"
    );
    // hops = 1 -> rightmost XFF entry (Cloud Run direct)
    expect(extractTrustedClientIp(makeFakeReq("198.51.100.1, 203.0.113.42", "10.0.0.1"), 1)).toBe(
      "203.0.113.42"
    );
    // hops = 2 -> 2nd from right (CDN/LB -> Cloud Run): skips LB 34.120.0.1 and ignores leftmost spoof 198.51.100.1
    expect(
      extractTrustedClientIp(makeFakeReq("198.51.100.1, 203.0.113.42, 34.120.0.1", "10.0.0.1"), 2)
    ).toBe("203.0.113.42");

    // End-to-end with TRUSTED_PROXY_HOPS=2: two distinct users behind the same LB get separate buckets,
    // while leftmost spoofing by one user still shares that user's bucket
    const { app } = makeTestApp({
      adapters: [makeMockAdapter({ platform: "shopify", store: makeShopifyStore() })],
      extraEnv: { TRUSTED_PROXY_HOPS: "2" }
    });

    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/store-check")
        .set("Origin", "https://shopcart.wals.pro")
        .set("X-Forwarded-For", `198.51.100.${i + 1}, 203.0.113.50, 34.120.0.1`)
        .set("Content-Type", "application/json")
        .send({ storeUrl: "snocks.com", lang: "de" })
        .expect(200);
    }

    // 11th request for 203.0.113.50 (different spoofed leftmost IP, same LB) -> 429
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "198.51.100.250, 203.0.113.50, 34.120.0.1")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" })
      .expect(429);

    // Different user (203.0.113.51) behind the same LB 34.120.0.1 -> still allowed (200)
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "203.0.113.51, 34.120.0.1")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" })
      .expect(200);
  });

  it("groups IPv6 clients by canonical /64 prefix for both rate-limit buckets and selfcheck concurrency keys", async () => {
    expect(normalizeClientRateLimitKey("2001:db8:abcd:12::1")).toBe("2001:db8:abcd:12::/64");
    expect(normalizeClientRateLimitKey("2001:0db8:abcd:0012:0000:0000:0000:ffff")).toBe(
      "2001:db8:abcd:12::/64"
    );
    expect(normalizeClientRateLimitKey("2001:DB8:ABCD:12:1111:2222:3333:4444")).toBe(
      "2001:db8:abcd:12::/64"
    );
    expect(normalizeClientRateLimitKey("2001:db8:abcd:13::1")).toBe("2001:db8:abcd:13::/64");
    // IPv4-mapped IPv6 (both dotted and hex forms) map to canonical IPv4
    expect(normalizeClientRateLimitKey("::ffff:203.0.113.42")).toBe("203.0.113.42");
    expect(normalizeClientRateLimitKey("::ffff:cb00:712a")).toBe("203.0.113.42");

    const observedConcurrencyKeys: string[] = [];
    const trackingAdapter: StoreAdapter = {
      platform: "shopify",
      async detect(_origin, concurrencyKey) {
        if (concurrencyKey) observedConcurrencyKeys.push(concurrencyKey);
        return makeShopifyStore();
      },
      async searchProducts(origin) {
        return { store_origin: origin, currency: "EUR", products: [], notices: [] };
      },
      async getProduct() {
        throw new Error("not used");
      },
      async buildCartLink(origin) {
        return { store_origin: origin, cart_url: `${origin}/cart`, mode: "cart", items: [], warnings: [], next_step: "" };
      }
    };

    const { app } = makeTestApp({ adapters: [trackingAdapter] });
    const rotatingIpv6SameSlash64 = [
      "2001:db8:abcd:12::1",
      "2001:0db8:abcd:0012:0000:0000:0000:0002",
      "2001:db8:abcd:12::3",
      "2001:DB8:ABCD:12:0:0:0:4",
      "2001:db8:abcd:12:aaaa::5",
      "2001:db8:abcd:12:bbbb::6",
      "2001:db8:abcd:12:cccc::7",
      "2001:db8:abcd:12:dddd::8",
      "2001:db8:abcd:12:eeee::9",
      "2001:db8:abcd:12:ffff::a"
    ];

    for (const ip of rotatingIpv6SameSlash64) {
      await request(app)
        .post("/api/store-check")
        .set("Origin", "https://shopcart.wals.pro")
        .set("X-Forwarded-For", ip)
        .set("Content-Type", "application/json")
        .send({ storeUrl: "snocks.com", lang: "de" })
        .expect(200);
    }

    // All 10 rotated addresses within the same /64 shared the exact same selfcheck concurrency key
    expect(new Set(observedConcurrencyKeys)).toEqual(new Set(["selfcheck:2001:db8:abcd:12::/64"]));

    // 11th request from a new host ID in the same /64 -> 429 rate limited
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "2001:db8:abcd:12:9999::beef")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" })
      .expect(429);

    // Request from a distinct /64 subnet -> allowed (200)
    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "2001:db8:abcd:13::1")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" })
      .expect(200);
  });

  it("enforces process-wide concurrent self-check limit and releases slots cleanly after completion", async () => {
    const resolvers: Array<() => void> = [];
    const deferredAdapter = makeMockAdapter({
      platform: "shopify",
      store: makeShopifyStore(),
      async onDetect() {
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        return makeShopifyStore();
      }
    });

    const { app } = makeTestApp({
      adapters: [deferredAdapter],
      maxConcurrentChecks: 2
    });

    const req1 = request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "203.0.113.101")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" });
    const req2 = request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "203.0.113.102")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" });

    // Start both requests and wait until both are inside detect()
    const p1 = req1.then((r) => r);
    const p2 = req2.then((r) => r);
    for (let i = 0; i < 40 && resolvers.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(resolvers.length).toBe(2);

    // 3rd simultaneous request (from a 3rd distinct IP) hits process-wide cap -> 429 + Retry-After
    const overflowRes = await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "203.0.113.103")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "en" })
      .expect(429);
    expect(overflowRes.body.error).toBe("concurrency_limit");
    expect(Number(overflowRes.headers["retry-after"])).toBeGreaterThanOrEqual(1);

    // Release both in-flight checks
    for (const resolve of resolvers) resolve();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // After slots are freed in finally, a subsequent check succeeds immediately
    const quickAdapter = makeMockAdapter({ platform: "shopify", store: makeShopifyStore() });
    const { app: quickApp } = makeTestApp({ adapters: [quickAdapter], maxConcurrentChecks: 1 });
    await request(quickApp)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" })
      .expect(200);
    await request(quickApp)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "de" })
      .expect(200);
  });

  it("aborts sequential follow-up adapter probes once the overall timeout expires", async () => {
    let secondAdapterCalled = 0;
    const slowNullAdapter = makeMockAdapter({
      platform: "shopify",
      store: null,
      delayMs: 120
    });
    const secondAdapter = makeMockAdapter({
      platform: "woocommerce",
      store: null,
      async onDetect() {
        secondAdapterCalled += 1;
        return null;
      }
    });

    const { app } = makeTestApp({
      adapters: [slowNullAdapter, secondAdapter],
      timeoutMs: 40
    });

    await request(app)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "slow-store.example", lang: "en" })
      .expect(504);

    // Wait past slowNullAdapter's 120ms delay to verify the abort signal stopped the loop
    await new Promise((r) => setTimeout(r, 160));
    expect(secondAdapterCalled).toBe(0);
  });

  it("keeps activeChecks held until underlying workPromise settles and propagates AbortSignal end-to-end into safeFetch", async () => {
    // Part A: An uncooperative adapter that stays running after the 40ms HTTP timeout must keep
    // activeChecks occupied until its workPromise actually settles (preventing cap bypass via timeout).
    let releaseSlowWork!: () => void;
    const uncooperativeAdapter = makeMockAdapter({
      platform: "shopify",
      store: makeShopifyStore(),
      async onDetect() {
        await new Promise<void>((resolve) => {
          releaseSlowWork = resolve;
        });
        return makeShopifyStore();
      }
    });

    const { app: capApp } = makeTestApp({
      adapters: [uncooperativeAdapter],
      timeoutMs: 40,
      maxConcurrentChecks: 1
    });

    // First request times out at 40ms with HTTP 504 while workPromise is still running
    await request(capApp)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "203.0.113.201")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "en" })
      .expect(504);

    // Immediately sending a 2nd request while the 1st workPromise is still active MUST still hit the cap (429)!
    await request(capApp)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "203.0.113.202")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "en" })
      .expect(429);

    // Release the underlying workPromise and allow settled.finally() to run
    releaseSlowWork();
    await new Promise((r) => setTimeout(r, 30));

    // Part B: Real safeFetch inside an adapter receives the aborted AbortSignal via withFetchContext
    // on timeout, aborts the hung fetch immediately, and releases all SSRF slots (0 leaks).
    let fetchSignalAborted = false;
    const safeFetchAdapter: StoreAdapter = {
      platform: "shopify",
      async detect(origin, concurrencyKey) {
        await safeFetch(`${origin}/meta.json`, {
          timeoutMs: 5000,
          concurrencyKey,
          lookupFn: async () => [{ address: "23.227.38.65", family: 4 as const }],
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              const sig = init.signal;
              if (sig?.aborted) {
                fetchSignalAborted = true;
                reject(sig.reason ?? Object.assign(new Error("Aborted"), { name: "AbortError" }));
                return;
              }
              sig?.addEventListener(
                "abort",
                () => {
                  fetchSignalAborted = true;
                  reject(sig.reason ?? Object.assign(new Error("Aborted"), { name: "AbortError" }));
                },
                { once: true }
              );
            })
        });
        return makeShopifyStore();
      },
      async searchProducts(origin) {
        return { store_origin: origin, currency: "EUR", products: [], notices: [] };
      },
      async getProduct() {
        throw new Error("unused");
      },
      async buildCartLink(origin) {
        return { store_origin: origin, cart_url: `${origin}/cart`, mode: "cart", items: [], warnings: [], next_step: "" };
      }
    };

    const { app: abortApp } = makeTestApp({
      adapters: [safeFetchAdapter],
      timeoutMs: 50,
      maxConcurrentChecks: 1
    });

    await request(abortApp)
      .post("/api/store-check")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "203.0.113.203")
      .set("Content-Type", "application/json")
      .send({ storeUrl: "snocks.com", lang: "en" })
      .expect(504);

    await new Promise((r) => setTimeout(r, 30));
    expect(fetchSignalAborted).toBe(true);
    expect(getInFlightSlotCount("selfcheck:203.0.113.203")).toBe(0);
    expect(getInFlightSlotCount(SELFCHECK_GLOBAL_SLOT_KEY)).toBe(0);
  });

  it("handles early client disconnect (res.destroyed / req.socket.destroyed) before listener registration by aborting immediately", async () => {
    let observedAbortedOnEntry = false;
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      STORAGE_BACKEND: "memory",
      SESSION_SECRET: "test-session-secret-0123456789abcdef"
    });
    const registry = new AdapterRegistry([
      {
        platform: "shopify",
        async detect(origin, concurrencyKey) {
          try {
            await safeFetch(`${origin}/meta.json`, {
              timeoutMs: 5000,
              concurrencyKey,
              lookupFn: async () => [{ address: "23.227.38.65", family: 4 as const }],
              fetchImpl: async () => {
                throw new Error("Should never reach fetchImpl when already aborted");
              }
            });
          } catch (err) {
            if (err instanceof SsrfError && (err.code === "TIMEOUT" || err.code === "ABORTED")) {
              observedAbortedOnEntry = true;
            }
            throw err;
          }
          return null;
        },
        async searchProducts(origin) {
          return { store_origin: origin, currency: "EUR", products: [], notices: [] };
        },
        async getProduct() {
          throw new Error("unused");
        },
        async buildCartLink(origin) {
          return { store_origin: origin, cart_url: `${origin}/cart`, mode: "cart", items: [], warnings: [], next_step: "" };
        }
      }
    ]);

    const router = createStoreCheckRouter({ config, registry, timeoutMs: 2000 });
    const postLayer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: any, res: any, next: () => void) => Promise<void> | void }> } }> }).stack.find(
      (l) => l.route?.path === "/api/store-check"
    );
    expect(postLayer).toBeDefined();

    const fakeReq = Object.assign(new EventEmitter(), {
      method: "POST",
      url: "/api/store-check",
      headers: {
        origin: "https://shopcart.wals.pro",
        "content-type": "application/json"
      },
      socket: { remoteAddress: "203.0.113.220", destroyed: true },
      pause: () => undefined
    });

    const headers = new Map<string, string>();
    let statusCode = 0;
    let responseJson: unknown = null;
    const fakeRes = Object.assign(new EventEmitter(), {
      destroyed: true,
      writableEnded: false,
      headersSent: false,
      setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        responseJson = body;
        this.headersSent = true;
        return this;
      }
    });

    const handlerPromise = postLayer!.route!.stack[0]!.handle(fakeReq, fakeRes, () => undefined);
    // Emit JSON body synchronously after handler attaches listeners
    fakeReq.emit("data", Buffer.from(JSON.stringify({ storeUrl: "snocks.com", lang: "en" })));
    fakeReq.emit("end");
    await handlerPromise;

    // Early-disconnect guard triggered reqAbort immediately before registry.resolve / safeFetch ran
    expect(statusCode).toBe(504);
    expect((responseJson as { error?: string })?.error).toBe("timeout");
    expect(observedAbortedOnEntry).toBe(false);
    expect(getInFlightSlotCount("selfcheck:203.0.113.220")).toBe(0);
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
