import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createShopcartMcpServer, SERVER_INSTRUCTIONS } from "../src/mcp/create-server.js";
import { findGeminiSchemaViolations } from "../src/mcp/schema-sanitize.js";
import { isValidLdhHostname } from "../src/security/identifiers.js";
import { MemoryStore } from "../src/store/memory.js";
import { STORE_CATEGORIES, resolveCategorySlug } from "../src/stores/categories.js";
import { CURATED_STORES } from "../src/stores/curated-stores.js";
import {
  createCuratedStoreSource,
  discoverStores,
  StoreDirectoryRegistry
} from "../src/stores/directory.js";
import {
  STORE_CATEGORY_IDS,
  STORE_PLATFORMS,
  STORE_SOURCES,
  type StoreDirectoryEntry
} from "../src/stores/types.js";

function makeTestApp(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00",
    ...extraEnv
  });
  return { config, app: createApp({ config, store: new MemoryStore() }) };
}

describe("Global Online Store Directory dataset validation", () => {
  it("contains >= 120 unique canonical stores with valid enums, balanced categories, multi-platform & DACH + Global coverage", () => {
    expect(CURATED_STORES.length).toBeGreaterThanOrEqual(120);

    const seenDomains = new Set<string>();
    const categoryCounts = new Map<string, number>();
    const platformCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();

    for (const store of CURATED_STORES) {
      // Unique, canonical lowercase domain (no protocol, no path, valid hostname)
      expect(store.domain).toBe(store.domain.toLowerCase());
      expect(store.domain).not.toMatch(/^https?:\/\//);
      expect(store.domain).not.toContain("/");
      expect(isValidLdhHostname(store.domain)).toBe(true);
      expect(seenDomains.has(store.domain), `Duplicate domain: ${store.domain}`).toBe(false);
      seenDomains.add(store.domain);

      // Required non-empty metadata
      expect(store.name.trim().length).toBeGreaterThanOrEqual(2);
      expect(STORE_PLATFORMS).toContain(store.platform);
      expect(STORE_SOURCES).toContain(store.source);
      expect(store.source).toBe("curated");
      expect(store.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Countries & categories
      expect(store.countries.length).toBeGreaterThanOrEqual(1);
      for (const c of store.countries) {
        expect(c).toMatch(/^[A-Z]{2}$/);
        countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
      }

      expect(store.categories.length).toBeGreaterThanOrEqual(1);
      expect(store.categories.length).toBeLessThanOrEqual(3);
      for (const cat of store.categories) {
        expect(STORE_CATEGORY_IDS).toContain(cat);
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      }

      // Tags, languages & factual descriptions
      expect(store.tags.length).toBeGreaterThanOrEqual(3);
      expect(store.language.length).toBeGreaterThanOrEqual(1);
      for (const lang of store.language) {
        expect(lang).toMatch(/^[a-z]{2}$/);
      }
      expect(store.description_de.trim().length).toBeGreaterThanOrEqual(20);
      expect(store.description_en.trim().length).toBeGreaterThanOrEqual(20);

      // Accurate cart & discount support flags per platform
      const expectedCart =
        store.platform === "shopify" ||
        store.platform === "woocommerce" ||
        store.platform === "bigcommerce";
      expect(store.cart_supported, `cart_supported mismatch on ${store.domain}`).toBe(expectedCart);
      expect(store.discounts_supported, `discounts_supported mismatch on ${store.domain}`).toBe(
        store.platform === "shopify"
      );

      platformCounts.set(store.platform, (platformCounts.get(store.platform) ?? 0) + 1);
    }

    // All 12 canonical categories must be well populated
    expect(STORE_CATEGORIES).toHaveLength(12);
    for (const catId of STORE_CATEGORY_IDS) {
      expect(
        categoryCounts.get(catId) ?? 0,
        `Category '${catId}' should have strong coverage`
      ).toBeGreaterThanOrEqual(10);
    }

    // Strong DACH + Global coverage
    expect(countryCounts.get("DE") ?? 0).toBeGreaterThanOrEqual(50);
    expect(countryCounts.get("AT") ?? 0).toBeGreaterThanOrEqual(40);
    expect(countryCounts.get("CH") ?? 0).toBeGreaterThanOrEqual(30);
    expect(countryCounts.get("US") ?? 0).toBeGreaterThanOrEqual(30);
    expect(countryCounts.get("UK") ?? 0).toBeGreaterThanOrEqual(25);
    expect(countryCounts.get("EU") ?? 0).toBeGreaterThanOrEqual(40);

    // Multi-platform representation
    for (const plat of ["shopify", "woocommerce", "shopware", "bigcommerce", "magento", "ucp", "other"]) {
      expect(
        platformCounts.get(plat) ?? 0,
        `Platform '${plat}' should have live-verified entries`
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("supports pluggable external feed sources with curated precedence and domain deduplication", () => {
    const extraStore: StoreDirectoryEntry = {
      domain: "example-feed-store.de",
      name: "Example Feed Store",
      platform: "shopify",
      countries: ["DE"],
      categories: ["coffee-tea-food"],
      tags: ["matcha", "tee", "tea"],
      language: ["de"],
      description_de: "Beispiel-Shop aus einem künftigen Affiliate-Feed.",
      description_en: "Example store imported from a future affiliate feed.",
      cart_supported: true,
      discounts_supported: true,
      source: "affiliate_feed",
      verified_at: "2026-11-26"
    };

    const conflictingSnocks: StoreDirectoryEntry = {
      ...extraStore,
      domain: "SNOCKS.COM",
      name: "Overridden Snocks Should Lose"
    };

    const registry = new StoreDirectoryRegistry([
      createCuratedStoreSource(),
      {
        id: "test-affiliate-feed",
        source: "affiliate_feed",
        load: () => [extraStore, conflictingSnocks]
      }
    ]);

    expect(registry.size()).toBe(CURATED_STORES.length + 1);
    expect(registry.getByDomain("snocks.com")?.name).toBe("SNOCKS");
    expect(registry.getByDomain("snocks.com")?.source).toBe("curated");
    expect(registry.getByDomain("example-feed-store.de")?.source).toBe("affiliate_feed");
  });
});

describe("discover_stores search engine, ranking, aliases & MCP tool registration", () => {
  it("ranks relevant stores for realistic DE/EN shopper queries including umlauts and DACH alias", () => {
    const runningAt = discoverStores({
      query: "sustainable running shorts",
      country: "at",
      limit: 8
    });
    expect(runningAt.total_matches).toBeGreaterThan(0);
    expect(runningAt.applied_filters.country).toBe("AT");
    expect(runningAt.stores.every((s) => s.countries.includes("AT"))).toBe(true);
    const runningDomains = runningAt.stores.map((s) => s.domain);
    expect(
      runningDomains.some((d) => ["ryzon.net", "loeffler.at", "on.com", "incylence.com"].includes(d))
    ).toBe(true);

    const matchaDe = discoverStores({
      query: "matcha sets",
      country: "DE",
      limit: 6
    });
    expect(matchaDe.total_matches).toBeGreaterThanOrEqual(3);
    expect(matchaDe.stores.map((s) => s.domain)).toContain("matchashop.de");

    // Umlaut normalization: 'ernährung' and 'ernaehrung' return identical results
    const umlaut = discoverStores({ query: "ernährung", country: "DACH" });
    const ascii = discoverStores({ query: "ernaehrung", country: "dach" });
    expect(umlaut.total_matches).toBeGreaterThan(0);
    expect(umlaut.stores.map((s) => s.domain)).toEqual(ascii.stores.map((s) => s.domain));
    expect(
      umlaut.stores.every((s) =>
        s.countries.some((c) => c === "DE" || c === "AT" || c === "CH")
      )
    ).toBe(true);

    // Friendly category alias mapping
    expect(resolveCategorySlug("coffee")).toBe("coffee-tea-food");
    expect(resolveCategorySlug("skincare")).toBe("beauty-care");
    expect(resolveCategorySlug("refurbished")).toBe("secondhand-refurbished");
    expect(resolveCategorySlug("nachhaltig")).toBe("sustainable-bio");
  });

  it("enforces cart_only, platform filter, limit clamping (1..30), and graceful unknown filter notices", () => {
    const cartOnly = discoverStores({ cart_only: true, limit: 100 });
    expect(cartOnly.returned).toBe(30);
    expect(cartOnly.applied_filters.limit).toBe(30);
    expect(cartOnly.stores.every((s) => s.cart_supported === true)).toBe(true);

    const shopwareCartOnly = discoverStores({ platform: "shopware", cart_only: true });
    expect(shopwareCartOnly.total_matches).toBe(0);

    const wooOnly = discoverStores({ platform: "woocommerce" });
    expect(wooOnly.total_matches).toBeGreaterThanOrEqual(4);
    expect(wooOnly.stores.every((s) => s.platform === "woocommerce" && s.cart_supported)).toBe(true);

    const unknownCat = discoverStores({ category: "nonexistent-category-xyz" });
    expect(unknownCat.total_matches).toBe(0);
    expect(unknownCat.notices.length).toBeGreaterThan(0);
    expect(unknownCat.available_categories).toEqual(STORE_CATEGORY_IDS);
  });

  it("registers discover_stores on MCP server with zero Gemini schema violations and clear SERVER_INSTRUCTIONS", async () => {
    expect(SERVER_INSTRUCTIONS).toContain("discover_stores");
    expect(SERVER_INSTRUCTIONS).toMatch(/ALWAYS call discover_stores first/i);

    const server = createShopcartMcpServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "discover-stores-test", version: "1.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "discover_stores");
    expect(tool).toBeDefined();
    expect(tool!.annotations?.readOnlyHint).toBe(true);
    expect(tool!.annotations?.destructiveHint).toBe(false);
    expect(tool!.annotations?.openWorldHint).toBe(false);
    expect(findGeminiSchemaViolations(tool!.inputSchema, "discover_stores.inputSchema")).toEqual([]);

    const callRes = await client.callTool({
      name: "discover_stores",
      arguments: {
        query: "matcha",
        country: "DE",
        cart_only: true,
        limit: 5
      }
    });
    expect(callRes.isError).toBe(false);
    const text = (callRes.content as Array<{ type: string; text: string }>)[0]!.text;
    const payload = JSON.parse(text) as {
      total_matches: number;
      returned: number;
      directory_size: number;
      applied_filters: Record<string, unknown>;
      available_categories: string[];
      stores: Array<{
        name: string;
        domain: string;
        url: string;
        platform: string;
        countries: string[];
        categories: string[];
        tags: string[];
        language: string[];
        description: string;
        cart_supported: boolean;
        discounts_supported: boolean;
      }>;
      hint: string;
    };

    expect(payload.directory_size).toBe(CURATED_STORES.length);
    expect(payload.returned).toBeGreaterThanOrEqual(2);
    expect(payload.returned).toBeLessThanOrEqual(5);
    expect(payload.available_categories).toEqual(STORE_CATEGORY_IDS);
    expect(payload.hint).toContain("search_products");
    for (const s of payload.stores) {
      expect(s.url).toBe(`https://${s.domain}`);
      expect(s.cart_supported).toBe(true);
      expect(s.countries).toContain("DE");
      expect(s.description.length).toBeGreaterThan(10);
    }

    await client.close();
    await server.close();
  });
});

describe("Web Store Directory (/stores, /en/stores, /api/stores) & CSP/XSS safety", () => {
  it("serves DE /stores and EN /en/stores with strict CSP, zero inline scripts/handlers, CTAs, and opt-out notice", async () => {
    const { app } = makeTestApp();

    const de = await request(app).get("/stores").expect(200);
    expect(de.headers["content-language"]).toBe("de");
    expect(de.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(de.headers["content-security-policy"]).toContain("style-src 'self'");
    expect(de.headers["x-content-type-options"]).toBe("nosniff");
    expect(de.headers["x-frame-options"]).toBe("DENY");

    // Strict CSP: only JSON-LD script block without src; zero inline <style>, style="", or on*=""
    const deInlineScripts = de.text.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
    expect(deInlineScripts).toEqual(['<script type="application/ld+json">']);
    expect(de.text).not.toMatch(/<style[\s>]/i);
    expect(de.text).not.toMatch(/\sstyle="/i);
    expect(de.text).not.toMatch(/\son[a-z]+="/i);

    expect(de.text).toContain('href="/assets/stores.css');
    expect(de.text).toContain('src="/assets/stores.js');
    expect(de.text).toContain("Kostenlos eigenen Shop prüfen &amp; eintragen");
    expect(de.text).toContain('href="/check"');
    expect(de.text).toContain('href="/check?url=https%3A%2F%2Fsnocks.com"');
    expect(de.text).toContain("Shop im Selbstcheck prüfen");
    expect(de.text).toContain("In Claude/ChatGPT testen");
    expect(de.text).toContain("robots.txt");
    expect(de.text).toContain("support@wals.pro");
    expect(de.text).toContain('hreflang="en" href="https://shopcart.wals.pro/en/stores"');

    const en = await request(app).get("/en/stores").expect(200);
    expect(en.headers["content-language"]).toBe("en");
    const enInlineScripts = en.text.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
    expect(enInlineScripts).toEqual(['<script type="application/ld+json">']);
    expect(en.text).not.toMatch(/\sstyle="/i);
    expect(en.text).not.toMatch(/\son[a-z]+="/i);
    expect(en.text).toContain("Verify &amp; list your store for free");
    expect(en.text).toContain('href="/en/check"');
    expect(en.text).toContain('href="/en/check?url=https%3A%2F%2Fallbirds.com"');
    expect(en.text).toContain("Check Storefront");
    expect(en.text).toContain("Test in Claude/ChatGPT");

    // Static assets served cleanly
    const css = await request(app).get("/assets/stores.css").expect(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.headers["x-content-type-options"]).toBe("nosniff");

    const js = await request(app).get("/assets/stores.js").expect(200);
    expect(js.headers["content-type"]).toContain("application/javascript");
    expect(js.headers["x-content-type-options"]).toBe("nosniff");
    expect(js.text).not.toContain("innerHTML");
  });

  it("supports server-side progressive query filtering and safely escapes XSS payloads", async () => {
    const { app } = makeTestApp();

    const filtered = await request(app)
      .get("/stores")
      .query({ q: "matcha", country: "DE", platform: "woocommerce" })
      .expect(200);
    expect(filtered.text).toContain("matchashop.de");
    expect(filtered.text).not.toContain('data-domain="snocks.com"');

    const xssPayload = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const xssRes = await request(app)
      .get("/stores")
      .query({ q: xssPayload, category: xssPayload, country: xssPayload })
      .expect(200);
    expect(xssRes.text).not.toContain("<script>alert(1)</script>");
    expect(xssRes.text).not.toContain("<img src=x onerror=alert(2)>");
    expect(xssRes.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt;");
  });

  it("serves GET /api/stores JSON with filtering, cache/security headers, and updates sitemap & llms.txt", async () => {
    const { app } = makeTestApp();

    const apiRes = await request(app)
      .get("/api/stores")
      .query({ category: "secondhand-refurbished", country: "DACH", limit: "5", lang: "de" })
      .expect(200);
    expect(apiRes.headers["content-type"]).toContain("application/json");
    expect(apiRes.headers["x-content-type-options"]).toBe("nosniff");
    expect(apiRes.headers["cache-control"]).toContain("max-age=300");
    expect(apiRes.body.directory_size).toBe(CURATED_STORES.length);
    expect(apiRes.body.returned).toBeLessThanOrEqual(5);
    expect(apiRes.body.returned).toBeGreaterThan(0);
    expect(apiRes.body.applied_filters.category).toBe("secondhand-refurbished");
    expect(apiRes.body.applied_filters.country).toBe("DACH");
    for (const s of apiRes.body.stores as Array<{ categories: string[]; countries: string[] }>) {
      expect(s.categories).toContain("secondhand-refurbished");
      expect(s.countries.some((c) => ["DE", "AT", "CH"].includes(c))).toBe(true);
    }

    const sitemap = await request(app).get("/sitemap.xml").expect(200);
    expect(sitemap.text).toContain("<loc>https://shopcart.wals.pro/stores</loc>");
    expect(sitemap.text).toContain("<loc>https://shopcart.wals.pro/en/stores</loc>");

    const llms = await request(app).get("/llms.txt").expect(200);
    expect(llms.text).toContain("discover_stores");
    expect(llms.text).toContain("https://shopcart.wals.pro/stores");
  });
});
