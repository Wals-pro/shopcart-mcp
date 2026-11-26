import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import { SITEMAP_PATHS } from "../src/web/discovery.js";
import {
  FOR_MERCHANTS_CSS_PATH,
  FOR_MERCHANTS_DE_PATH,
  FOR_MERCHANTS_EN_PATH,
  INDEPENDENCE_GUARANTEE_DE,
  INDEPENDENCE_GUARANTEE_EN,
  WALSPRO_BOOKING_URL
} from "../src/web/for-merchants.js";
import { extractSitemapUrls } from "../scripts/ping-indexnow.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANALYTICS_JS_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, "public", "assets", "analytics.js"),
  "utf8"
);

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

function extractTitle(html: string): string {
  return html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
}

function extractMetaDescription(html: string): string {
  return html.match(/<meta\s+name="description"\s+content="([^"]*)"\s*>/i)?.[1] ?? "";
}

function createAnalyticsClickHarness(opts: {
  href: string;
  ga4Id: string;
  pageLang: "de" | "en";
  initialConsent?: string | null;
}) {
  const localStore = new Map<string, string>();
  if (opts.initialConsent !== undefined && opts.initialConsent !== null) {
    localStore.set("shopcart_consent_v1", opts.initialConsent);
  }
  const listeners = new Map<string, Array<(ev: any) => void>>();
  const appendedScripts: string[] = [];

  class FakeElement {
    attrs = new Map<string, string>();
    tagName: string;
    id = "";
    open = false;
    constructor(tagName: string, attrs: Record<string, string> = {}) {
      this.tagName = tagName.toUpperCase();
      for (const [k, v] of Object.entries(attrs)) {
        this.attrs.set(k, v);
        if (k === "id") this.id = v;
      }
    }
    getAttribute(name: string): string | null {
      return this.attrs.has(name) ? this.attrs.get(name)! : null;
    }
    setAttribute(name: string, val: string): void {
      this.attrs.set(name, val);
      if (name === "open") this.open = true;
    }
    removeAttribute(name: string): void {
      this.attrs.delete(name);
      if (name === "open") this.open = false;
    }
    closest(selector: string): FakeElement | null {
      for (const part of selector.split(",").map((s) => s.trim())) {
        const attrMatch = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (attrMatch) {
          const [, attr, expected] = attrMatch;
          if (attr && this.attrs.has(attr)) {
            if (expected === undefined || this.attrs.get(attr) === expected) return this;
          }
        }
      }
      return null;
    }
  }

  class FakeHtmlElement extends FakeElement {}
  class FakeScriptElement extends FakeHtmlElement {
    src = "";
    async = false;
  }
  class FakeFormElement extends FakeHtmlElement {}
  class FakeVideoElement extends FakeHtmlElement {}

  const closeBtn = new FakeHtmlElement("button", { "data-consent-close": "", hidden: "" });
  const banner = new FakeHtmlElement("dialog", { id: "sc-consent-banner" }) as FakeHtmlElement & {
    show: () => void;
    close: () => void;
    querySelector: (sel: string) => FakeElement | null;
  };
  banner.show = () => {
    banner.open = true;
  };
  banner.close = () => {
    banner.open = false;
  };
  banner.querySelector = (sel: string) => (sel === "[data-consent-close]" ? closeBtn : null);

  const scriptEl = new FakeScriptElement("script", {
    src: "/assets/analytics.js?v=0.6.0",
    "data-ga4-id": opts.ga4Id,
    "data-page-lang": opts.pageLang,
    "data-page-type": "for_merchants"
  });

  const parsedUrl = new URL(opts.href);
  const fakeWindow: Record<string, any> = {
    location: {
      href: parsedUrl.href,
      origin: parsedUrl.origin,
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      hostname: parsedUrl.hostname,
      protocol: parsedUrl.protocol
    },
    localStorage: {
      getItem: (k: string) => localStore.get(k) ?? null,
      setItem: (k: string, v: string) => localStore.set(k, v)
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {}
    }
  };

  const fakeDocument: Record<string, any> = {
    currentScript: scriptEl,
    referrer: "",
    cookie: "",
    documentElement: { lang: opts.pageLang },
    head: {
      appendChild: (node: FakeScriptElement) => {
        appendedScripts.push(node.src);
        return node;
      }
    },
    getElementById: (id: string) => (id === "sc-consent-banner" ? banner : null),
    querySelector: (sel: string) => (sel.includes("analytics.js") ? scriptEl : null),
    createElement: (tag: string) => new FakeScriptElement(tag),
    addEventListener: (type: string, fn: (ev: any) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    }
  };

  const context = vm.createContext({
    window: fakeWindow,
    document: fakeDocument,
    Element: FakeElement,
    HTMLElement: FakeHtmlElement,
    HTMLScriptElement: FakeScriptElement,
    HTMLFormElement: FakeFormElement,
    HTMLVideoElement: FakeVideoElement,
    URL,
    Date,
    Number,
    Set,
    Object,
    Boolean,
    encodeURIComponent
  });

  vm.runInContext(ANALYTICS_JS_SOURCE, context);

  return {
    window: fakeWindow,
    appendedScripts,
    dispatchClick: (attrs: Record<string, string>) => {
      const el = new FakeHtmlElement("a", attrs);
      const ev = { target: el, preventDefault: () => {} };
      for (const fn of listeners.get("click") ?? []) fn(ev);
    },
    getDataLayerCalls: (): Array<unknown[]> =>
      Array.isArray(fakeWindow.dataLayer)
        ? fakeWindow.dataLayer.map((args: IArguments) => Array.from(args))
        : []
  };
}

describe("B2B /for-merchants (DE) & /en/for-merchants (EN) — Agentic Storefront Readiness (Item #67)", () => {
  it("serves DE and EN pages with HTTP 200, strict CSP, zero inline JS/styles, SEO metadata, hreflang, and safe JSON-LD", async () => {
    const { app } = makeApp();

    const cases = [
      {
        path: FOR_MERCHANTS_DE_PATH,
        lang: "de" as const,
        otherPath: FOR_MERCHANTS_EN_PATH,
        checkPath: "/check",
        locale: "de_DE",
        guarantee: INDEPENDENCE_GUARANTEE_DE,
        selfCheckLabel: "Erst selbst prüfen (kostenlos &amp; ohne Login)",
        bookCallLabel: "Erstgespräch vereinbaren"
      },
      {
        path: FOR_MERCHANTS_EN_PATH,
        lang: "en" as const,
        otherPath: FOR_MERCHANTS_DE_PATH,
        checkPath: "/en/check",
        locale: "en_US",
        guarantee: INDEPENDENCE_GUARANTEE_EN,
        selfCheckLabel: "Check your store first (free &amp; no login)",
        bookCallLabel: "Book an intro call"
      }
    ];

    for (const c of cases) {
      const res = await request(app).get(c.path).expect(200);
      const html = res.text;

      // Security headers & strict CSP
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-language"]).toBe(c.lang);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      const csp = String(res.headers["content-security-policy"] ?? "");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("unsafe-inline");

      // Zero executable inline scripts, zero inline <style>, zero style="", zero on* handlers
      const inlineScripts = html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
      expect(inlineScripts).toEqual(['<script type="application/ld+json">']);
      expect(html).not.toMatch(/<style[\s>]/i);
      expect(html).not.toMatch(/\sstyle="/i);
      expect(html).not.toMatch(/\son[a-z]+="/i);
      expect(html).toContain(`href="${FOR_MERCHANTS_CSS_PATH}`);

      // SEO: title, description, canonical, reciprocal hreflang, OG & Twitter cards
      expect(html).toContain(`<html lang="${c.lang}">`);
      const title = extractTitle(html);
      expect(title.length).toBeGreaterThan(20);
      expect(title.length).toBeLessThanOrEqual(70);
      const desc = extractMetaDescription(html);
      expect(desc.length).toBeGreaterThan(60);
      expect(desc.length).toBeLessThanOrEqual(160);

      expect(html).toContain(`<link rel="canonical" href="https://shopcart.wals.pro${c.path}">`);
      expect(html).toContain(
        `<link rel="alternate" hreflang="de" href="https://shopcart.wals.pro${FOR_MERCHANTS_DE_PATH}">`
      );
      expect(html).toContain(
        `<link rel="alternate" hreflang="en" href="https://shopcart.wals.pro${FOR_MERCHANTS_EN_PATH}">`
      );
      expect(html).toContain(
        `<link rel="alternate" hreflang="x-default" href="https://shopcart.wals.pro${FOR_MERCHANTS_EN_PATH}">`
      );
      expect(html).toContain(`property="og:locale" content="${c.locale}"`);
      expect(html).toContain(`property="og:url" content="https://shopcart.wals.pro${c.path}"`);
      expect(html).toContain('property="og:image" content="https://shopcart.wals.pro/icon-512.png"');
      expect(html).toContain('name="twitter:card" content="summary_large_image"');

      // Language switcher links directly between DE and EN routes
      expect(html).toContain(`href="${c.otherPath}"`);

      // Core product guardrails
      expect(html).toContain(c.guarantee.replace(/'/g, "&#39;"));
      expect(html).toContain(`href="${c.checkPath}"`);
      expect(html).toContain(c.selfCheckLabel);
      expect(html).toContain(
        `href="${WALSPRO_BOOKING_URL}" target="_blank" rel="noopener noreferrer"`
      );
      expect(html).toContain(c.bookCallLabel);
      expect(html).toContain("Wals Professional Services GmbH");
      expect(html).toContain("wals.pro");

      // Target platforms & deliverables
      for (const platform of [
        "Shopify / Shopify Plus",
        "Shopware 6",
        "WooCommerce",
        "Magento 2",
        "BigCommerce",
        "OXID",
        "Custom Storefronts"
      ]) {
        expect(html, `${c.path} platform ${platform}`).toContain(platform);
      }
      expect(html).toContain("/.well-known/ucp");
      expect(html).toContain("Schema.org / JSON-LD");
      expect(html).toContain("Agentic Storefront Audit");

      // Spark-Cart dark-mode branding
      expect(html).toContain('fill="#FF1F4D"');
      expect(html).toContain('class="brand-wordmark"');

      // JSON-LD parses cleanly with WebPage, Service, Organization, FAQPage and zero fake ratings
      const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      expect(ldMatch).not.toBeNull();
      const ldRaw = ldMatch![1]!;
      expect(ldRaw).not.toContain("</script>");
      expect(ldRaw).not.toMatch(/aggregateRating|reviewCount|ratingValue/i);
      const ld = JSON.parse(ldRaw) as { "@context": string; "@graph": Array<Record<string, unknown>> };
      expect(ld["@context"]).toBe("https://schema.org");
      const types = ld["@graph"].map((n) => n["@type"]);
      expect(types).toEqual(["Organization", "WebPage", "Service", "FAQPage"]);

      // HARD BANS: zero Odoo, zero uppercase Wals.pro, zero internal audit metrics or fake star ratings
      expect(html).not.toMatch(/odoo/i);
      expect(html).not.toMatch(/Wals\.pro|WALS\.PRO/);
      expect(html).not.toMatch(/DataForSEO|Suchvolumen|search volume|4\.9\/5|5\/5|500\+ Shops/i);
    }

    // Dedicated CSS served cleanly with dark-mode tokens
    const css = await request(app).get(FOR_MERCHANTS_CSS_PATH).expect(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.headers["x-content-type-options"]).toBe("nosniff");
    expect(css.text).toContain("--walspro-accent: #ff1f4d");
    expect(css.text).toContain("--walspro-bg: #141414");
    expect(css.text).toContain("forced-colors: active");
    expect(css.text).toContain("prefers-reduced-motion");
  });

  it("includes /for-merchants and /en/for-merchants in sitemap.xml, IndexNow URL extraction, and cross-links from homepage & guides", async () => {
    const { app, config } = makeApp();

    // Free-tier limit strictly untouched at 20 calls/day
    expect(config.freeDailyLimit).toBe(20);

    // Sitemap & IndexNow
    expect(SITEMAP_PATHS).toContain(FOR_MERCHANTS_DE_PATH);
    expect(SITEMAP_PATHS).toContain(FOR_MERCHANTS_EN_PATH);
    const sitemap = await request(app).get("/sitemap.xml").expect(200);
    expect(sitemap.text).toContain(`<loc>https://shopcart.wals.pro${FOR_MERCHANTS_DE_PATH}</loc>`);
    expect(sitemap.text).toContain(`<loc>https://shopcart.wals.pro${FOR_MERCHANTS_EN_PATH}</loc>`);
    expect(sitemap.text).toContain(
      `hreflang="de" href="https://shopcart.wals.pro${FOR_MERCHANTS_DE_PATH}"`
    );
    expect(sitemap.text).toContain(
      `hreflang="en" href="https://shopcart.wals.pro${FOR_MERCHANTS_EN_PATH}"`
    );

    const indexNowUrls = extractSitemapUrls(sitemap.text, "shopcart.wals.pro");
    expect(indexNowUrls).toContain(`https://shopcart.wals.pro${FOR_MERCHANTS_DE_PATH}`);
    expect(indexNowUrls).toContain(`https://shopcart.wals.pro${FOR_MERCHANTS_EN_PATH}`);

    // Discreet navigation & homepage cross-links (DE & EN)
    const homeDe = await request(app).get("/?lang=de").expect(200);
    expect(homeDe.text).toContain('href="/for-merchants"');
    expect(homeDe.text).toContain("Für Shops");

    const homeEn = await request(app).get("/?lang=en").expect(200);
    expect(homeEn.text).toContain('href="/en/for-merchants"');
    expect(homeEn.text).toContain("For merchants");

    const guidesDe = await request(app).get("/guides?lang=de").expect(200);
    expect(guidesDe.text).toContain('href="/for-merchants"');

    const guidesEn = await request(app).get("/guides?lang=en").expect(200);
    expect(guidesEn.text).toContain('href="/en/for-merchants"');
  });

  it("integrates GDPR consent banner and fires for_merchants_cta_click strictly after consent with zero PII", async () => {
    const { app } = makeApp({ GA4_MEASUREMENT_ID: "G-TEST123456" });

    for (const [route, lang] of [
      [FOR_MERCHANTS_DE_PATH, "de"],
      [FOR_MERCHANTS_EN_PATH, "en"]
    ] as const) {
      const res = await request(app).get(route).expect(200);
      const csp = String(res.headers["content-security-policy"] ?? "");
      expect(csp).toContain("script-src 'self' https://www.googletagmanager.com");
      expect(csp).not.toContain("unsafe-inline");
      expect(res.text).toContain('<dialog id="sc-consent-banner"');
      expect(res.text).toContain("data-open-consent-settings");
      expect(res.text).toContain(`data-page-lang="${lang}" data-page-type="for_merchants"`);
      expect(res.text).toContain(
        `data-analytics-event="for_merchants_cta_click" data-analytics-cta="self_check" data-analytics-lang="${lang}"`
      );
      expect(res.text).toContain(
        `data-analytics-event="for_merchants_cta_click" data-analytics-cta="book_call" data-analytics-lang="${lang}"`
      );
    }

    // Before consent: clicking CTAs must NOT load gtag or push anything to dataLayer
    const preConsent = createAnalyticsClickHarness({
      href: "https://shopcart.wals.pro/for-merchants",
      ga4Id: "G-TEST123456",
      pageLang: "de"
    });
    preConsent.dispatchClick({
      "data-analytics-event": "for_merchants_cta_click",
      "data-analytics-cta": "self_check",
      "data-analytics-lang": "de"
    });
    expect(preConsent.appendedScripts).toHaveLength(0);
    expect(preConsent.window.dataLayer).toBeUndefined();

    // After explicit consent: valid allowlisted CTAs emit anonymous event; unknown values are dropped
    preConsent.dispatchClick({ "data-consent-action": "accept" });
    preConsent.dispatchClick({
      "data-analytics-event": "for_merchants_cta_click",
      "data-analytics-cta": "self_check",
      "data-analytics-lang": "de"
    });
    preConsent.dispatchClick({
      "data-analytics-event": "for_merchants_cta_click",
      "data-analytics-cta": "book_call",
      "data-analytics-lang": "en"
    });
    preConsent.dispatchClick({
      "data-analytics-event": "for_merchants_cta_click",
      "data-analytics-cta": "user@example.com",
      "data-analytics-lang": "de"
    });

    const events = preConsent
      .getDataLayerCalls()
      .filter((c) => c[0] === "event" && c[1] === "for_merchants_cta_click")
      .map((c) => c[2]);

    expect(events).toEqual([
      {
        page_location: "https://shopcart.wals.pro/for-merchants",
        page_referrer: "",
        cta: "self_check",
        page_language: "de",
        transport_type: "beacon"
      },
      {
        page_location: "https://shopcart.wals.pro/for-merchants",
        page_referrer: "",
        cta: "book_call",
        page_language: "en",
        transport_type: "beacon"
      }
    ]);
    expect(JSON.stringify(events)).not.toContain("user@example.com");
  });
});
