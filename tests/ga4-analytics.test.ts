import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { sha256Base64Url, sha256Hex } from "../src/auth/crypto.js";
import { loadConfig, parseGa4MeasurementId } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import type { UserRecord } from "../src/store/types.js";

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
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_PRO_PRICE_ID: "price_pro_eur_9",
    ...extraEnv
  });
  const store = new MemoryStore();
  return { config, store, app: createApp({ config, store }) };
}

async function openOAuthPage(app: ReturnType<typeof createApp>, lang: "de" | "en") {
  const reg = await request(app)
    .post("/oauth/register")
    .send({
      client_name: "Claude Desktop",
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none"
    })
    .expect(201);

  return request(app)
    .get("/oauth/authorize")
    .query({
      response_type: "code",
      client_id: reg.body.client_id,
      redirect_uri: "http://127.0.0.1:45678/callback",
      code_challenge: sha256Base64Url("verifier_ga4_test_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123"),
      code_challenge_method: "S256",
      resource: "https://shopcart.wals.pro/mcp",
      state: "st_ga4",
      lang
    })
    .expect(200);
}

// Minimal DOM + browser harness to unit-test public/assets/analytics.js in isolation
function createAnalyticsHarness(opts: {
  href: string;
  ga4Id: string;
  pageLang: "de" | "en";
  pageType: string;
  promoActive?: boolean;
  initialConsent?: string | null;
  initialSession?: Record<string, string>;
  initialCookies?: string[];
  checkoutSuccessEl?: { value?: string } | null;
}) {
  const localStore = new Map<string, string>();
  if (opts.initialConsent !== undefined && opts.initialConsent !== null) {
    localStore.set("shopcart_consent_v1", opts.initialConsent);
  }
  const sessionStore = new Map<string, string>(Object.entries(opts.initialSession ?? {}));

  const appendedScripts: Array<{ src: string; async: boolean }> = [];
  const cookieWrites: string[] = [];
  let activeCookies: string[] = [...(opts.initialCookies ?? [])];
  const listeners = new Map<string, Array<(ev: any) => void>>();

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
        if (part.startsWith("#") && this.id === part.slice(1)) return this;
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
  class FakeFormElement extends FakeHtmlElement {
    valid = true;
    checkValidity(): boolean {
      return this.valid;
    }
  }
  class FakeVideoElement extends FakeHtmlElement {
    inDemoShell = true;
    override closest(selector: string): FakeElement | null {
      if (this.inDemoShell && selector.includes("#demo-shell")) return this;
      return super.closest(selector);
    }
  }

  const closeBtn = new FakeHtmlElement("button", { "data-consent-close": "", hidden: "" });
  const banner = new FakeHtmlElement("dialog", { id: "sc-consent-banner" }) as FakeHtmlElement & {
    show: () => void;
    close: () => void;
    querySelector: (sel: string) => FakeElement | null;
  };
  banner.show = () => {
    banner.open = true;
    banner.setAttribute("open", "");
  };
  banner.close = () => {
    banner.open = false;
    banner.removeAttribute("open");
  };
  banner.querySelector = (sel: string) => (sel === "[data-consent-close]" ? closeBtn : null);

  const scriptEl = new FakeScriptElement("script", {
    src: "/assets/analytics.js?v=0.6.0",
    "data-ga4-id": opts.ga4Id,
    "data-page-lang": opts.pageLang,
    "data-page-type": opts.pageType,
    ...(opts.promoActive ? { "data-promo-active": "true" } : {})
  });
  const metaEl = new FakeElement("meta", { name: "shopcart-ga4", content: opts.ga4Id });
  const checkoutEl = opts.checkoutSuccessEl
    ? new FakeHtmlElement("div", {
        "data-checkout-success": "true",
        ...(opts.checkoutSuccessEl.value !== undefined
          ? { "data-checkout-value": opts.checkoutSuccessEl.value }
          : {})
      })
    : null;

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
      setItem: (k: string, v: string) => {
        localStore.set(k, v);
      }
    },
    sessionStorage: {
      getItem: (k: string) => sessionStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        sessionStore.set(k, v);
      }
    }
  };

  const fakeDocument: Record<string, any> = {
    currentScript: scriptEl,
    documentElement: { lang: opts.pageLang },
    head: {
      appendChild: (node: FakeScriptElement) => {
        appendedScripts.push({ src: node.src, async: node.async });
        return node;
      }
    },
    get cookie() {
      return activeCookies.join("; ");
    },
    set cookie(val: string) {
      cookieWrites.push(val);
      const [pair] = val.split(";");
      const name = pair?.split("=")[0]?.trim();
      if (name && (val.includes("Max-Age=0") || val.includes("1970"))) {
        activeCookies = activeCookies.filter((c) => c.split("=")[0]?.trim() !== name);
      } else if (pair) {
        activeCookies.push(pair.trim());
      }
    },
    getElementById: (id: string) => (id === "sc-consent-banner" ? banner : null),
    querySelector: (sel: string) => {
      if (sel.includes("analytics.js")) return scriptEl;
      if (sel.includes("shopcart-ga4")) return metaEl;
      if (sel.includes("data-checkout-success")) return checkoutEl;
      return null;
    },
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
    URLSearchParams,
    Date,
    Number,
    Set,
    Object,
    Boolean,
    encodeURIComponent
  });

  vm.runInContext(ANALYTICS_JS_SOURCE, context);

  const dispatchClick = (attrs: Record<string, string>) => {
    const el = new FakeHtmlElement("button", attrs);
    const ev = { target: el, preventDefault: () => {} };
    for (const fn of listeners.get("click") ?? []) fn(ev);
  };

  const dispatchSubmit = (attrs: Record<string, string>, valid = true) => {
    const form = new FakeFormElement("form", attrs);
    form.valid = valid;
    const ev = { target: form, preventDefault: () => {} };
    for (const fn of listeners.get("submit") ?? []) fn(ev);
  };

  const dispatchVideoPlay = () => {
    const video = new FakeVideoElement("video");
    const ev = { target: video };
    for (const fn of listeners.get("play") ?? []) fn(ev);
  };

  const getDataLayerCalls = (): Array<unknown[]> =>
    Array.isArray(fakeWindow.dataLayer)
      ? fakeWindow.dataLayer.map((args: IArguments) => Array.from(args))
      : [];

  return {
    window: fakeWindow,
    document: fakeDocument,
    banner,
    closeBtn,
    localStore,
    sessionStore,
    appendedScripts,
    cookieWrites,
    getActiveCookies: () => activeCookies,
    dispatchClick,
    dispatchSubmit,
    dispatchVideoPlay,
    getDataLayerCalls
  };
}

describe("GA4 env validation, CSP, consent banner, privacy policy & zero-pre-consent analytics", () => {
  it("strictly validates GA4_MEASUREMENT_ID against /^G-[A-Z0-9]{4,20}$/", () => {
    expect(parseGa4MeasurementId("G-TEST123456")).toBe("G-TEST123456");
    expect(parseGa4MeasurementId("  G-ABCD  ")).toBe("G-ABCD");
    expect(parseGa4MeasurementId("G-1234567890ABCDEF1234")).toBe("G-1234567890ABCDEF1234");

    for (const bad of [
      undefined,
      "",
      "   ",
      "G-123",
      "G-123456789012345678901",
      "g-abcd1234",
      "UA-123456-1",
      "GTM-ABCDEF",
      "G-TEST<script>",
      "G-TEST&x=1",
      "G-TEST 123"
    ]) {
      expect(parseGa4MeasurementId(bad), String(bad)).toBeUndefined();
    }

    const cfgInvalid = loadConfig({ GA4_MEASUREMENT_ID: "not-valid" });
    expect(cfgInvalid.ga4MeasurementId).toBeUndefined();
    const cfgValid = loadConfig({ GA4_MEASUREMENT_ID: "G-WALSPRO123" });
    expect(cfgValid.ga4MeasurementId).toBe("G-WALSPRO123");
  });

  it("stays completely inactive with zero GA4 CSP entries, scripts, or banner when GA4_MEASUREMENT_ID is unset or invalid", async () => {
    const { app } = makeApp({ GA4_MEASUREMENT_ID: "invalid-id" });

    for (const route of ["/?lang=de", "/guides?lang=en", "/privacy?lang=de", "/terms?lang=en", "/billing/login?lang=de"]) {
      const res = await request(app).get(route).expect(200);
      const csp = String(res.headers["content-security-policy"] ?? "");
      expect(csp, `${route} CSP`).not.toContain("googletagmanager.com");
      expect(csp, `${route} CSP`).not.toContain("google-analytics.com");
      expect(res.text, `${route} HTML`).not.toContain("/assets/analytics.js");
      expect(res.text, `${route} HTML`).not.toContain("sc-consent-banner");
      expect(res.text, `${route} HTML`).not.toContain("data-open-consent-settings");
    }

    const oauth = await openOAuthPage(app, "de");
    expect(String(oauth.headers["content-security-policy"] ?? "")).not.toContain("googletagmanager.com");
    expect(oauth.text).not.toContain("/assets/analytics.js");
  });

  it("sets strict GA4 CSP without unsafe-inline on scripts, serves static analytics assets, and renders DE/EN banner + footer trigger on all pages", async () => {
    const { app, store } = makeApp({ GA4_MEASUREMENT_ID: "G-TEST123456" });

    // Static assets served with strict MIME & nosniff
    const js = await request(app).get("/assets/analytics.js").expect(200);
    expect(js.headers["content-type"]).toContain("application/javascript");
    expect(js.headers["x-content-type-options"]).toBe("nosniff");

    const css = await request(app).get("/assets/analytics.css").expect(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.headers["x-content-type-options"]).toBe("nosniff");

    const legalCss = await request(app).get("/assets/legal.css").expect(200);
    expect(legalCss.headers["content-type"]).toContain("text/css");
    expect(legalCss.headers["x-content-type-options"]).toBe("nosniff");

    // Seed logged-in billing user for /billing?checkout=success check
    const user: UserRecord = {
      id: "user_ga4_1",
      email: "buyer@example.de",
      passwordHash: "h",
      passwordSalt: "s",
      plan: "free",
      status: "active",
      stripeCustomerId: "cus_ga4",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await store.createUser(user);
    const rawSession = "sc_ws_ga4_session";
    await store.saveWebSession({
      sessionHash: sha256Hex(rawSession),
      userId: user.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });

    const pages: Array<{
      name: string;
      res: request.Response;
      lang: "de" | "en";
      pageType: string;
      strictStyle: boolean;
    }> = [
      { name: "landing DE", res: await request(app).get("/?lang=de").expect(200), lang: "de", pageType: "landing", strictStyle: true },
      { name: "landing EN", res: await request(app).get("/?lang=en").expect(200), lang: "en", pageType: "landing", strictStyle: true },
      { name: "guides index DE", res: await request(app).get("/guides?lang=de").expect(200), lang: "de", pageType: "guides_index", strictStyle: true },
      { name: "guide detail EN", res: await request(app).get("/en/guides/shop-with-claude").expect(200), lang: "en", pageType: "guide", strictStyle: true },
      { name: "privacy DE", res: await request(app).get("/privacy?lang=de").expect(200), lang: "de", pageType: "legal", strictStyle: true },
      { name: "terms EN", res: await request(app).get("/terms?lang=en").expect(200), lang: "en", pageType: "legal", strictStyle: true },
      { name: "billing login DE", res: await request(app).get("/billing/login?lang=de").expect(200), lang: "de", pageType: "billing", strictStyle: false },
      {
        name: "billing success EN",
        res: await request(app).get("/billing?checkout=success&lang=en").set("Cookie", `sc_session=${rawSession}`).expect(200),
        lang: "en",
        pageType: "billing",
        strictStyle: false
      },
      { name: "oauth DE", res: await openOAuthPage(app, "de"), lang: "de", pageType: "oauth", strictStyle: false },
      { name: "oauth EN", res: await openOAuthPage(app, "en"), lang: "en", pageType: "oauth", strictStyle: false }
    ];

    for (const p of pages) {
      const csp = String(p.res.headers["content-security-policy"] ?? "");
      expect(csp, `${p.name} script-src`).toContain("script-src 'self' https://www.googletagmanager.com");
      expect(csp, `${p.name} no script unsafe-inline`).not.toMatch(/script-src[^;]*unsafe-inline/);
      expect(csp, `${p.name} connect-src`).toContain(
        "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com"
      );
      expect(csp, `${p.name} img-src`).toContain(
        "https://*.google-analytics.com https://www.googletagmanager.com"
      );
      if (p.strictStyle) {
        expect(csp, `${p.name} no unsafe-inline anywhere`).not.toContain("unsafe-inline");
      }

      // Zero executable inline scripts or inline event handlers
      const inlineScripts = p.res.text.match(/<script(?![^>]*\bsrc=)(?![^>]*\btype="application\/ld\+json")[^>]*>/gi) ?? [];
      expect(inlineScripts, `${p.name} zero executable inline scripts`).toEqual([]);
      expect(p.res.text, `${p.name} zero inline handlers`).not.toMatch(/\son[a-z]+="/i);

      // Meta + external analytics script + external analytics CSS
      expect(p.res.text, `${p.name} meta`).toContain('<meta name="shopcart-ga4" content="G-TEST123456">');
      expect(p.res.text, `${p.name} script`).toContain(
        `data-ga4-id="G-TEST123456" data-page-lang="${p.lang}" data-page-type="${p.pageType}"`
      );
      expect(p.res.text, `${p.name} css`).toContain('href="/assets/analytics.css');

      // Consent banner + equal-weight buttons + privacy link + footer trigger
      expect(p.res.text, `${p.name} banner`).toContain('<dialog id="sc-consent-banner"');
      expect(p.res.text, `${p.name} footer trigger`).toContain("data-open-consent-settings");
      if (p.lang === "de") {
        expect(p.res.text).toContain("Nur notwendige");
        expect(p.res.text).toContain("Alle akzeptieren");
        expect(p.res.text).toContain("Cookie-Einstellungen");
        expect(p.res.text).toContain('href="/privacy?lang=de"');
      } else {
        expect(p.res.text).toContain("Essential only");
        expect(p.res.text).toContain("Accept all");
        expect(p.res.text).toContain("Cookie settings");
        expect(p.res.text).toContain('href="/privacy?lang=en"');
      }
    }

    // Verify checkout success data attributes on /billing?checkout=success
    const billingSuccess = pages.find((p) => p.name === "billing success EN")!.res.text;
    expect(billingSuccess).toContain('data-checkout-success="true"');
    expect(billingSuccess).toContain('data-track-submit="begin_checkout"');
  });

  it("documents Google Analytics 4 transparently on /privacy in DE and EN (GDPR Art. 6(1)(a) & § 165(3) TKG 2021)", async () => {
    const { app } = makeApp();

    const de = await request(app).get("/privacy?lang=de").expect(200);
    expect(de.text).toContain("Google Analytics 4");
    expect(de.text).toContain("Google Ireland Limited");
    expect(de.text).toContain("Art. 6 Abs. 1 lit. a DSGVO");
    expect(de.text).toContain("§ 165 Abs. 3 TKG 2021");
    expect(de.text).toContain("anonymize_ip: true");
    expect(de.text).toContain("allow_google_signals: false");
    expect(de.text).toContain("allow_ad_personalization_signals: false");
    expect(de.text).toContain("Cookie-Einstellungen");
    expect(de.text).toContain("shopcart_consent_v1");

    const en = await request(app).get("/privacy?lang=en").expect(200);
    expect(en.text).toContain("Google Analytics 4");
    expect(en.text).toContain("Google Ireland Limited");
    expect(en.text).toContain("Art. 6(1)(a) GDPR");
    expect(en.text).toContain("§ 165(3) Austrian TKG 2021");
    expect(en.text).toContain("anonymize_ip: true");
    expect(en.text).toContain("allow_google_signals: false");
    expect(en.text).toContain("allow_ad_personalization_signals: false");
    expect(en.text).toContain("Cookie settings");
    expect(en.text).toContain("shopcart_consent_v1");
  });

  it("enforces zero-pre-consent, exact Consent Mode v2 order, URL sanitization, revocation & cookie deletion in analytics.js", () => {
    const h = createAnalyticsHarness({
      href: "https://shopcart.wals.pro/oauth/authorize?code=SECRET_CODE&email=user@example.com&token=TOK123",
      ga4Id: "G-TEST123456",
      pageLang: "de",
      pageType: "oauth",
      initialCookies: ["_ga=GA1.1.123456.7890", "_ga_TEST123456=GS1.1.abc", "sc_session=keepme"]
    });

    // 1. Before consent: banner open, zero dataLayer, zero gtag, zero external scripts
    expect(h.banner.open).toBe(true);
    expect(h.window.dataLayer).toBeUndefined();
    expect(h.window.gtag).toBeUndefined();
    expect(h.appendedScripts).toHaveLength(0);

    // Tracked clicks before consent emit NOTHING
    h.dispatchClick({
      "data-track-event": "connect_ai_click",
      "data-track-client": "claude",
      "data-track-location": "hero"
    });
    expect(h.window.dataLayer).toBeUndefined();

    // 2. User clicks "Accept all" -> exact Consent Mode v2 sequence + sanitized page_location
    h.dispatchClick({ "data-consent-action": "accept" });
    expect(h.banner.open).toBe(false);
    expect(JSON.parse(h.localStore.get("shopcart_consent_v1")!).analytics).toBe(true);
    expect(h.appendedScripts).toEqual([
      { src: "https://www.googletagmanager.com/gtag/js?id=G-TEST123456", async: true }
    ]);

    const calls = h.getDataLayerCalls();
    expect(calls[0]).toEqual([
      "consent",
      "default",
      {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      }
    ]);
    expect(calls[1]).toEqual(["consent", "update", { analytics_storage: "granted" }]);
    expect(calls[2]?.[0]).toBe("js");
    expect(calls[2]?.[1]).toBeInstanceOf(Date);
    expect(calls[3]).toEqual([
      "config",
      "G-TEST123456",
      {
        anonymize_ip: true,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        send_page_view: false,
        page_location: "https://shopcart.wals.pro/oauth/authorize"
      }
    ]);
    expect(calls[4]).toEqual([
      "event",
      "page_view",
      {
        page_location: "https://shopcart.wals.pro/oauth/authorize",
        page_path: "/oauth/authorize",
        page_language: "de",
        page_type: "oauth"
      }
    ]);
    // Zero query string / PII anywhere in dataLayer
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("SECRET_CODE");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("TOK123");

    // 3. Reopening settings and clicking Accept again does NOT double-fire page_view or reload gtag/js
    h.dispatchClick({ "data-open-consent-settings": "" });
    expect(h.banner.open).toBe(true);
    h.dispatchClick({ "data-consent-action": "accept" });
    expect(h.appendedScripts).toHaveLength(1);
    const pageViews = h.getDataLayerCalls().filter((c) => c[0] === "event" && c[1] === "page_view");
    expect(pageViews).toHaveLength(1);

    // 4. Revocation via "Essential only": ga-disable flag, consent update denied, _ga* cookies deleted, sc_session preserved
    h.dispatchClick({ "data-open-consent-settings": "" });
    h.dispatchClick({ "data-consent-action": "essential" });
    expect(h.window["ga-disable-G-TEST123456"]).toBe(true);
    expect(JSON.parse(h.localStore.get("shopcart_consent_v1")!).analytics).toBe(false);
    const lastCall = h.getDataLayerCalls().at(-1);
    expect(lastCall).toEqual([
      "consent",
      "update",
      {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      }
    ]);
    expect(h.getActiveCookies()).toEqual(["sc_session=keepme"]);
    expect(h.cookieWrites.some((w) => w.startsWith("_ga=;") && w.includes("Domain=.wals.pro"))).toBe(true);
    expect(h.cookieWrites.some((w) => w.startsWith("_ga_TEST123456=;") && w.includes("Max-Age=0"))).toBe(true);

    // Subsequent clicks after revocation emit no further events
    const countAfterRevoke = h.getDataLayerCalls().length;
    h.dispatchClick({
      "data-track-event": "connect_ai_click",
      "data-track-client": "claude",
      "data-track-location": "hero"
    });
    expect(h.getDataLayerCalls().length).toBe(countAfterRevoke);
  });

  it("tracks all funnel events without PII and deduplicates purchase via sessionStorage", () => {
    const grantedJson = JSON.stringify({ version: 1, analytics: true, updatedAt: "2026-11-26T00:00:00Z" });
    const h = createAnalyticsHarness({
      href: "https://shopcart.wals.pro/?lang=de",
      ga4Id: "G-TEST123456",
      pageLang: "de",
      pageType: "landing",
      initialConsent: grantedJson
    });

    h.dispatchClick({ "data-track-event": "connect_ai_click", "data-track-client": "claude", "data-track-location": "hero" });
    h.dispatchClick({ "data-track-event": "copy_setup_snippet", "data-track-client": "gemini", "data-track-snippet-type": "cli_extension" });
    h.dispatchClick({ "data-track-event": "download_mcpb", "data-track-source": "hero" });
    h.dispatchClick({ "data-track-event": "setup_tab_select", "data-track-client": "gemini" });
    h.dispatchClick({ "data-track-event": "try_prompt_click", "data-track-prompt-id": "hero_wish_1" });
    h.dispatchVideoPlay();
    h.dispatchVideoPlay(); // deduplicated per page load
    h.dispatchSubmit({ "data-track-submit": "signup_start", "data-track-surface": "billing" });
    h.dispatchSubmit({ "data-track-submit": "oauth_authorize_complete" }, false); // invalid form -> skipped
    h.dispatchSubmit({ "data-track-submit": "oauth_authorize_complete" }, true);
    h.dispatchSubmit({ "data-track-submit": "begin_checkout", "data-track-value": "9" });

    const events = h
      .getDataLayerCalls()
      .filter((c) => c[0] === "event")
      .map((c) => ({ name: c[1], params: c[2] as Record<string, unknown> }));

    expect(events.map((e) => e.name)).toEqual([
      "page_view",
      "connect_ai_click",
      "copy_setup_snippet",
      "download_mcpb",
      "setup_tab_select",
      "try_prompt_click",
      "demo_video_play",
      "signup_start",
      "oauth_authorize_complete",
      "begin_checkout"
    ]);
    expect(events.find((e) => e.name === "connect_ai_click")?.params).toMatchObject({
      client: "claude",
      location: "hero"
    });
    expect(events.find((e) => e.name === "begin_checkout")?.params).toMatchObject({
      currency: "EUR",
      value: 9
    });

    // Purchase tracking on /billing?checkout=success (promo value 0) + sessionStorage deduplication
    const billing1 = createAnalyticsHarness({
      href: "https://shopcart.wals.pro/billing?checkout=success&lang=de",
      ga4Id: "G-TEST123456",
      pageLang: "de",
      pageType: "billing",
      promoActive: true,
      initialConsent: grantedJson,
      checkoutSuccessEl: { value: "0" }
    });
    const purchases1 = billing1.getDataLayerCalls().filter((c) => c[0] === "event" && c[1] === "purchase");
    expect(purchases1).toHaveLength(1);
    expect(purchases1[0]?.[2]).toMatchObject({
      currency: "EUR",
      value: 0,
      page_location: "https://shopcart.wals.pro/billing"
    });

    // Second load with same sessionStorage must NOT fire a duplicate purchase event
    const billing2 = createAnalyticsHarness({
      href: "https://shopcart.wals.pro/billing?checkout=success&lang=de",
      ga4Id: "G-TEST123456",
      pageLang: "de",
      pageType: "billing",
      promoActive: true,
      initialConsent: grantedJson,
      initialSession: Object.fromEntries(billing1.sessionStore.entries()),
      checkoutSuccessEl: { value: "0" }
    });
    const purchases2 = billing2.getDataLayerCalls().filter((c) => c[0] === "event" && c[1] === "purchase");
    expect(purchases2).toHaveLength(0);

    // Non-promo purchase sends value: 9
    const billingPaid = createAnalyticsHarness({
      href: "https://shopcart.wals.pro/billing?checkout=success&lang=en",
      ga4Id: "G-TEST123456",
      pageLang: "en",
      pageType: "billing",
      promoActive: false,
      initialConsent: grantedJson,
      checkoutSuccessEl: { value: "9" }
    });
    const purchasesPaid = billingPaid.getDataLayerCalls().filter((c) => c[0] === "event" && c[1] === "purchase");
    expect(purchasesPaid).toHaveLength(1);
    expect(purchasesPaid[0]?.[2]).toMatchObject({ currency: "EUR", value: 9 });
  });
});
