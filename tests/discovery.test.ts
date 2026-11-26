import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, parseIndexNowKey } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import { ALLOWED_CRAWLERS, SITEMAP_PATHS } from "../src/web/discovery.js";
import { GUIDE_DEFINITIONS } from "../src/web/guides.js";
import {
  buildIndexNowPayload,
  extractSitemapUrls,
  isValidIndexNowKey
} from "../scripts/ping-indexnow.mjs";

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

describe("Agent discovery (GEO/AEO): llms.txt, llms-full.txt, robots.txt, sitemap.xml, IndexNow & Link header", () => {
  it("serves /llms.txt as text/plain with summary, MCP endpoint, tools, all guide links, and the start-prompt contract", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/llms.txt").expect(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.text.startsWith("# ShopCart")).toBe(true);
    expect(res.text).toMatch(/^> .+/m);
    expect(res.text).toContain("https://shopcart.wals.pro/mcp");
    expect(res.text).toContain("https://shopcart.wals.pro/llms-full.txt");
    for (const tool of [
      "inspect_store",
      "list_collections",
      "search_products",
      "get_product",
      "get_store_policies",
      "create_cart_link"
    ]) {
      expect(res.text).toContain(tool);
    }
    // Capability matrix: every connected platform is listed with its honest handoff
    expect(res.text).toContain("## Supported Platforms & Capability Matrix");
    for (const platform of ["Shopify", "WooCommerce", "BigCommerce", "Amazon", "Shopware 6", "Magento 2", "JSON-LD"]) {
      expect(res.text).toContain(platform);
    }
    expect(res.text).toContain("/gp/aws/cart/add.html");
    expect(res.text).toContain("## Comfort Features for Shoppers");
    expect(res.text).toMatch(/not affiliated with or endorsed by Shopify, WooCommerce \(Automattic\), Amazon, BigCommerce, Shopware, or Adobe \(Magento\)/);
    expect(res.text).not.toMatch(/all 4 tools|four tools|Shopify Inc\./i);
    for (const guide of GUIDE_DEFINITIONS) {
      expect(res.text).toContain(`https://shopcart.wals.pro${guide.path}`);
    }
    expect(res.text).toContain("Start Prompt");
    expect(res.text).toMatch(/never (places|place) orders|read-only/i);
    // Brand spelling & no internal keyword numbers in public text
    expect(res.text).not.toMatch(/Wals\.pro|WALS\.PRO/);
    expect(res.text).not.toMatch(/search volume|Suchvolumen|DataForSEO|54[.,]3\s*%|30[.,]4\s*%/i);
  });

  it("serves /llms-full.txt as text/plain with full reference, all guides, DE + EN FAQ, and current limits", async () => {
    const { app, config } = makeApp();
    const res = await request(app).get("/llms-full.txt").expect(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.text.startsWith("# ShopCart")).toBe(true);
    expect(res.text.length).toBeGreaterThan(3000);
    expect(res.text).toContain("https://shopcart.wals.pro/mcp");
    expect(res.text).toContain("create_cart_link");
    expect(res.text).toContain(`${config.freeDailyLimit}`);
    expect(res.text).toContain(`${config.proDailyLimit}`);
    for (const guide of GUIDE_DEFINITIONS) {
      expect(res.text).toContain(`https://shopcart.wals.pro${guide.path}`);
    }
    for (const platform of ["Shopify", "WooCommerce", "BigCommerce", "Amazon", "Shopware 6", "Magento 2", "JSON-LD"]) {
      expect(res.text).toContain(platform);
    }
    for (const tool of ["list_collections", "get_store_policies", "search_affiliate_deals"]) {
      expect(res.text).toContain(tool);
    }
    expect(res.text).not.toMatch(/all 4 tools|four tools|4 Read-Only Tools/i);
    expect(res.text).toContain("Kauft die KI über ShopCart automatisch für mich ein?");
    expect(res.text).toContain("Does ShopCart place orders or charge my card automatically?");
    expect(res.text).not.toMatch(/Wals\.pro|WALS\.PRO/);
    expect(res.text).not.toMatch(/search volume|Suchvolumen|DataForSEO|54[.,]3\s*%|30[.,]4\s*%/i);
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

  it("serves a single canonical /sitemap.xml listing landing, language variants, all 11 guides, billing, legal, and llms files", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/sitemap.xml").expect(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(res.text).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    for (const required of ["/", "/?lang=de", "/?lang=en", "/guides", "/billing", "/privacy", "/terms", "/llms.txt", "/llms-full.txt"]) {
      expect(SITEMAP_PATHS).toContain(required);
    }
    for (const guide of GUIDE_DEFINITIONS) {
      expect(SITEMAP_PATHS).toContain(guide.path);
    }
    for (const path of SITEMAP_PATHS) {
      expect(res.text).toContain(`<loc>https://shopcart.wals.pro${path}</loc>`);
    }
    expect(res.text.match(/<url>/g)).toHaveLength(SITEMAP_PATHS.length);
  });

  it("serves GET /<INDEXNOW_KEY>.txt as text/plain when INDEXNOW_KEY is valid and returns 404 otherwise", async () => {
    const validKey = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

    // Unset -> 404
    const { app: unsetApp } = makeApp();
    await request(unsetApp).get(`/${validKey}.txt`).expect(404);

    // Invalid keys -> rejected by parseIndexNowKey and 404
    expect(parseIndexNowKey("short")).toBeUndefined();
    expect(parseIndexNowKey("bad/key/path")).toBeUndefined();
    expect(parseIndexNowKey("a".repeat(129))).toBeUndefined();
    const { app: invalidApp } = makeApp({ INDEXNOW_KEY: "too-sh" });
    await request(invalidApp).get("/too-sh.txt").expect(404);

    // Valid key -> 200 text/plain returning exact key
    const { app: validApp } = makeApp({ INDEXNOW_KEY: validKey });
    const res = await request(validApp).get(`/${validKey}.txt`).expect(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.text).toBe(validKey);
    // Other .txt paths still 404
    await request(validApp).get("/otherkey12345678.txt").expect(404);
  });

  it("extracts sitemap URLs and builds valid IndexNow payloads via scripts/ping-indexnow.mjs helpers", async () => {
    const { app } = makeApp();
    const sitemapRes = await request(app).get("/sitemap.xml").expect(200);

    const urls = extractSitemapUrls(sitemapRes.text, "shopcart.wals.pro");
    expect(urls).toHaveLength(SITEMAP_PATHS.length);
    expect(urls).toContain("https://shopcart.wals.pro/en/guides/chatgpt-instant-checkout-alternative");
    expect(urls).toContain("https://shopcart.wals.pro/guides/shopify-mcp-server-vergleich");

    const key = "0123456789abcdef0123456789abcdef";
    expect(isValidIndexNowKey(key)).toBe(true);
    expect(isValidIndexNowKey("short")).toBe(false);

    const payload = buildIndexNowPayload({
      origin: "https://shopcart.wals.pro",
      key,
      urlList: urls
    });
    expect(payload).toEqual({
      host: "shopcart.wals.pro",
      key,
      keyLocation: `https://shopcart.wals.pro/${key}.txt`,
      urlList: urls
    });
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
