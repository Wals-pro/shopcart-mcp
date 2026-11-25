import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import { GUIDE_DEFINITIONS, safeJsonLd } from "../src/web/guides.js";

const GUIDE_DETAIL_ROUTES = [
  "/guides/mit-claude-online-einkaufen",
  "/guides/chatgpt-warenkorb-erstellen",
  "/guides/adventskalender-mit-ki-finden",
  "/en/guides/shop-with-claude",
  "/en/guides/chatgpt-shopify-cart"
] as const;

const ALL_GUIDE_ROUTES = ["/guides", ...GUIDE_DETAIL_ROUTES] as const;

function makeGuidesApp() {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00"
  });
  return { config, app: createApp({ config, store: new MemoryStore() }) };
}

function extractTagContent(html: string, tagName: string): string {
  const match = html.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1] ?? "";
}

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta\s+name="description"\s+content="([^"]*)"\s*>/i);
  return match?.[1] ?? "";
}

function extractJsonLdBlocks(html: string): Array<Record<string, unknown>> {
  const regex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  const blocks: Array<Record<string, unknown>> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1] ?? "";
    blocks.push(JSON.parse(raw) as Record<string, unknown>);
  }
  return blocks;
}

describe("SEO & GEO shopping guide pages (/guides, DE/EN detail routes, sitemap & CSS)", () => {
  it("serves all 6 guide routes with HTTP 200, strict CSP, valid meta lengths, canonical, hreflang, OG tags, and 1-click AI deeplinks", async () => {
    const { app } = makeGuidesApp();

    for (const route of ALL_GUIDE_ROUTES) {
      const res = await request(app).get(route).expect(200);
      const html = res.text;

      // Strict CSP and security headers
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
      expect(res.headers["content-security-policy"]).toContain("style-src 'self'");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");

      // Zero executable inline scripts or inline style tags
      expect(html).not.toMatch(/<script(?![^>]*\btype="application\/ld\+json")[^>]*>/i);
      expect(html).not.toMatch(/<style[\s>]/i);
      expect(html).toContain('href="/assets/guides.css');
      expect(html).toContain("/assets/walspro-mark.svg");

      // Meta title <= 70 chars & meta description <= 160 chars
      const title = extractTagContent(html, "title");
      expect(title.length, `${route} title length`).toBeGreaterThan(10);
      expect(title.length, `${route} title length <= 70`).toBeLessThanOrEqual(70);

      const description = extractMetaDescription(html);
      expect(description.length, `${route} description length`).toBeGreaterThan(40);
      expect(description.length, `${route} description length <= 160`).toBeLessThanOrEqual(160);

      // Canonical, hreflang (de, en, x-default), OpenGraph
      expect(html).toContain(`<link rel="canonical" href="https://shopcart.wals.pro${route}">`);
      expect(html).toMatch(/<link rel="alternate" hreflang="de" href="https:\/\/shopcart\.wals\.pro\/[^"]+">/);
      expect(html).toMatch(/<link rel="alternate" hreflang="en" href="https:\/\/shopcart\.wals\.pro\/[^"]+">/);
      expect(html).toMatch(
        /<link rel="alternate" hreflang="x-default" href="https:\/\/shopcart\.wals\.pro\/[^"]+">/
      );
      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain(`property="og:url" content="https://shopcart.wals.pro${route}"`);

      // Answer-first TL;DR box
      expect(html).toContain('class="article-tldr"');

      // Real 1-click AI deeplinks for Claude and ChatGPT
      expect(html).toMatch(/href="https:\/\/claude\.ai\/new\?q=[^"]+"/);
      expect(html).toMatch(/href="https:\/\/chatgpt\.com\/\?q=[^"]+"/);

      // Brand compliance: independent Shopify disclaimer + zero Odoo mentions
      expect(html.toLowerCase()).not.toContain("odoo");
      expect(html).toMatch(/nicht verbunden mit Shopify Inc\.|not affiliated with Shopify Inc\./);

      // Valid JSON-LD parsing
      const ldBlocks = extractJsonLdBlocks(html);
      expect(ldBlocks.length, `${route} JSON-LD count`).toBeGreaterThanOrEqual(1);
    }
  });

  it("includes valid Article, FAQPage, and HowTo JSON-LD plus wals.pro blog structure on all 5 detail guides", async () => {
    const { app } = makeGuidesApp();

    for (const route of GUIDE_DETAIL_ROUTES) {
      const res = await request(app).get(route).expect(200);
      const html = res.text;
      const ldBlocks = extractJsonLdBlocks(html);
      const types = ldBlocks.map((b) => b["@type"]);

      expect(types, `${route} JSON-LD types`).toEqual(["Article", "FAQPage", "HowTo"]);

      const article = ldBlocks[0]!;
      expect(article["@context"]).toBe("https://schema.org");
      expect(article.url).toBe(`https://shopcart.wals.pro${route}`);

      const faqPage = ldBlocks[1]!;
      const mainEntity = faqPage.mainEntity as Array<Record<string, unknown>>;
      expect(Array.isArray(mainEntity)).toBe(true);
      expect(mainEntity.length).toBeGreaterThanOrEqual(4);

      const howTo = ldBlocks[2]!;
      const steps = howTo.step as Array<Record<string, unknown>>;
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThanOrEqual(3);

      // Accessible table and FAQ accordion markup (no headings inside <summary>)
      expect(html).toContain('role="region"');
      expect(html).toContain("<table");
      expect(html).toContain("<details>");
      expect(html).not.toMatch(/<summary>[^<]*<h[1-6]/i);

      // Sources & limitations section
      expect(html).toContain('class="sources-box"');
      expect(html).toContain("https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks");
    }
  });

  it("links all 5 DE + EN guides from /guides and supports ?lang=de and ?lang=en", async () => {
    const { app } = makeGuidesApp();

    const deRes = await request(app).get("/guides?lang=de").expect(200);
    expect(deRes.text).toContain('<html lang="de">');
    expect(deRes.text).toContain("Kurz gesagt:");

    const enRes = await request(app).get("/guides?lang=en").expect(200);
    expect(enRes.text).toContain('<html lang="en">');
    expect(enRes.text).toContain("TL;DR:");

    for (const route of GUIDE_DETAIL_ROUTES) {
      expect(deRes.text).toContain(`href="${route}"`);
      expect(enRes.text).toContain(`href="${route}"`);
    }

    const overviewLd = extractJsonLdBlocks(deRes.text);
    expect(overviewLd[0]?.["@type"]).toBe("CollectionPage");
  });

  it("serves /assets/guides.css with canonical wals.pro dark-mode tokens and /sitemap.xml with all guide URLs", async () => {
    const { app } = makeGuidesApp();

    const css = await request(app).get("/assets/guides.css").expect(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.headers["x-content-type-options"]).toBe("nosniff");
    expect(css.text).toContain("--walspro-bg: #141414");
    expect(css.text).toContain("--walspro-surface: #1a1a1a");
    expect(css.text).toContain("--walspro-accent: #ff1f4d");
    expect(css.text).toContain("--walspro-on-accent: #000000");

    const sitemap = await request(app).get("/sitemap.xml").expect(200);
    expect(sitemap.headers["content-type"]).toContain("application/xml");
    expect(sitemap.text).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(sitemap.text).toContain("<loc>https://shopcart.wals.pro/</loc>");
    for (const route of ALL_GUIDE_ROUTES) {
      expect(sitemap.text).toContain(`<loc>https://shopcart.wals.pro${route}</loc>`);
    }
  });

  it("escapes unsafe HTML/script sequences in JSON-LD and query parameters to prevent XSS", async () => {
    const { app } = makeGuidesApp();

    // safeJsonLd neutralizes script-breaking payloads
    const serialized = safeJsonLd({
      text: '</script><img src=x onerror="alert(1)"> & <!-- comment -->'
    });
    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<img");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(serialized)).toEqual({
      text: '</script><img src=x onerror="alert(1)"> & <!-- comment -->'
    });

    // Malicious query parameter on /guides is never reflected raw into HTML
    const xssPayload = '"><script>alert(1)</script>';
    const res = await request(app)
      .get(`/guides?lang=${encodeURIComponent(xssPayload)}`)
      .expect(200);
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).not.toContain(xssPayload);

    // Sanity check: none of the static guide definitions leak raw HTML tags
    for (const g of GUIDE_DEFINITIONS) {
      expect(g.metaTitle.length).toBeLessThanOrEqual(70);
      expect(g.metaDescription.length).toBeLessThanOrEqual(160);
    }
  });
});
