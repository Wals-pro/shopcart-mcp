/* ShopCart MCP — Zero-Pre-Consent GA4 + Consent Mode v2 + Funnel Tracking
 * Strict CSP compliant: external script only, zero inline handlers, zero PII.
 * Compliant with EU/AT DSGVO (Art. 6 Abs. 1 lit. a) & § 165 Abs. 3 TKG 2021.
 */
(() => {
  "use strict";

  const CONSENT_STORAGE_KEY = "shopcart_consent_v1";
  const PURCHASE_DEDUP_KEY = "shopcart_ga4_purchase_sent_v1";
  const GA4_ID_RE = /^G-[A-Z0-9]{4,20}$/;

  const ALLOWED_PAGE_LANGS = new Set(["de", "en"]);
  const ALLOWED_PAGE_TYPES = new Set([
    "landing",
    "guide",
    "guides_index",
    "for_merchants",
    "stores_directory",
    "billing",
    "oauth",
    "legal"
  ]);
  const ALLOWED_FOR_MERCHANTS_CTAS = new Set(["self_check", "book_call"]);
  const ALLOWED_CLIENTS = new Set([
    "claude",
    "chatgpt",
    "gemini",
    "cursor",
    "vscode",
    "instinct",
    "claude_desktop",
    "claude_code",
    "perplexity",
    "local",
    "generic"
  ]);
  const ALLOWED_LOCATIONS = new Set(["hero", "one_click", "setup_tab", "guide"]);
  const ALLOWED_SNIPPET_TYPES = new Set([
    "mcp_url",
    "cli_extension",
    "mcp_add",
    "settings_json",
    "oneshot_cli",
    "prompt"
  ]);
  const ALLOWED_SOURCES = new Set(["hero", "one_click", "guide"]);
  const ALLOWED_SURFACES = new Set(["billing", "oauth"]);
  const SAFE_ID_RE = /^[a-z0-9_-]{1,64}$/;

  /**
   * Read script configuration from <script data-ga4-id="..."> or <meta name="shopcart-ga4">.
   */
  const readConfig = () => {
    const scriptEl =
      document.currentScript instanceof HTMLScriptElement
        ? document.currentScript
        : document.querySelector('script[src*="/assets/analytics.js"]');
    const metaEl = document.querySelector('meta[name="shopcart-ga4"]');
    const rawId =
      (scriptEl && scriptEl.getAttribute("data-ga4-id")) ||
      (metaEl && metaEl.getAttribute("content")) ||
      "";
    const ga4Id = rawId.trim();
    if (!GA4_ID_RE.test(ga4Id)) return null;

    const rawLang = (
      (scriptEl && scriptEl.getAttribute("data-page-lang")) ||
      document.documentElement.lang ||
      "en"
    )
      .trim()
      .toLowerCase();
    const pageLang = ALLOWED_PAGE_LANGS.has(rawLang) ? rawLang : "en";

    const rawType = ((scriptEl && scriptEl.getAttribute("data-page-type")) || "landing")
      .trim()
      .toLowerCase();
    const pageType = ALLOWED_PAGE_TYPES.has(rawType) ? rawType : "landing";

    const promoActive =
      (scriptEl && scriptEl.getAttribute("data-promo-active") === "true") || false;

    return { ga4Id, pageLang, pageType, promoActive };
  };

  /**
   * Strip query strings and hash fragments so OAuth codes, tokens, session IDs,
   * or email query parameters are NEVER transmitted to Google Analytics.
   */
  const sanitizePageLocation = (href) => {
    try {
      const parsed = new URL(href || window.location.href);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return `${window.location.origin || ""}${window.location.pathname || "/"}`;
    }
  };

  const getCleanPath = (href) => {
    try {
      return new URL(href || window.location.href).pathname || "/";
    } catch {
      return window.location.pathname || "/";
    }
  };

  /**
   * Strip query strings and fragments from document.referrer so same-origin
   * navigations from /oauth/authorize?... or /billing/login?email=... NEVER leak
   * OAuth parameters, tokens, or email PII to Google Analytics via dr / page_referrer.
   */
  const sanitizeReferrer = (rawRef) => {
    if (!rawRef || typeof rawRef !== "string") return "";
    try {
      const parsed = new URL(rawRef);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "";
    }
  };

  const readStoredConsent = () => {
    try {
      const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.analytics === "boolean") {
        return parsed.analytics;
      }
    } catch {
      // Storage disabled or corrupt JSON -> treat as undecided
    }
    return null;
  };

  const writeStoredConsent = (granted) => {
    try {
      window.localStorage.setItem(
        CONSENT_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          analytics: Boolean(granted),
          updatedAt: new Date().toISOString()
        })
      );
    } catch {
      // Ignore storage quota / private-mode errors
    }
  };

  /**
   * Delete all _ga, _ga_*, _gid, _gat* cookies across host-only and valid parent domain variants.
   */
  const deleteGaCookies = () => {
    const cookieStr = document.cookie || "";
    if (!cookieStr) return;

    const names = [];
    const parts = cookieStr.split(";");
    for (let i = 0; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf("=");
      const name = (eqIdx >= 0 ? parts[i].slice(0, eqIdx) : parts[i]).trim();
      if (/^(_ga(?:_|$)|_gid$|_gat(?:_|$))/.test(name)) {
        names.push(name);
      }
    }
    if (!names.length) return;

    const hostname = (window.location && window.location.hostname) || "";
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
    const domainCandidates = [""];
    if (hostname && !isIp && hostname.includes(".")) {
      const labels = hostname.split(".");
      for (let i = 0; i <= labels.length - 2; i++) {
        const domain = labels.slice(i).join(".");
        domainCandidates.push(domain);
        domainCandidates.push(`.${domain}`);
      }
    }

    const secureFlag = window.location && window.location.protocol === "https:" ? "; Secure" : "";
    const expiry = "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/; SameSite=Lax";

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      for (let j = 0; j < domainCandidates.length; j++) {
        const dom = domainCandidates[j];
        const domAttr = dom ? `; Domain=${dom}` : "";
        document.cookie = `${name}=; ${expiry}${domAttr}${secureFlag}`;
      }
    }
  };

  const cfg = readConfig();
  if (!cfg) return;

  const cleanLocation = sanitizePageLocation(window.location.href);
  const cleanPath = getCleanPath(window.location.href);
  const cleanReferrer = sanitizeReferrer(document.referrer);

  let analyticsEnabled = false;
  let consentDefaultPushed = false;
  let gaConfigured = false;
  let scriptLoaded = false;
  let initialPageViewSent = false;
  let purchaseSent = false;
  let demoVideoPlaySent = false;

  const ensureGtag = () => {
    if (!Array.isArray(window.dataLayer)) {
      window.dataLayer = [];
    }
    if (typeof window.gtag !== "function") {
      window.gtag = function gtag() {
        window.dataLayer.push(arguments);
      };
    }
  };

  const trackEvent = (eventName, params) => {
    if (!analyticsEnabled || typeof window.gtag !== "function") return;
    const payload = Object.assign(
      { page_location: cleanLocation, page_referrer: cleanReferrer },
      params || {}
    );
    window.gtag("event", eventName, payload);
  };

  const maybeTrackPurchase = () => {
    if (!analyticsEnabled || purchaseSent || cfg.pageType !== "billing") return;
    const successEl = document.querySelector('[data-checkout-success="true"]');
    if (!successEl) return;

    const dedupToken = `${cleanPath}:success`;
    try {
      if (window.sessionStorage.getItem(PURCHASE_DEDUP_KEY) === dedupToken) {
        purchaseSent = true;
        return;
      }
      window.sessionStorage.setItem(PURCHASE_DEDUP_KEY, dedupToken);
    } catch {
      // sessionStorage unavailable -> purchaseSent boolean prevents duplicate firing in page lifetime
    }
    purchaseSent = true;

    let rawValue = successEl.getAttribute("data-checkout-value");
    if (rawValue === null || rawValue === "") {
      rawValue = cfg.promoActive ? "0" : "9";
    }
    const parsedValue = Number(rawValue);
    const value = Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 9;

    trackEvent("purchase", {
      currency: "EUR",
      value,
      items: [
        {
          item_id: "shopcart_pro_monthly",
          item_name: "ShopCart MCP Pro",
          price: value,
          quantity: 1
        }
      ]
    });
  };

  /**
   * Enable GA4 strictly AFTER explicit user opt-in using Google Consent Mode v2:
   * 1. dataLayer + gtag
   * 2. consent default (all denied)
   * 3. consent update (analytics_storage: granted)
   * 4. js + config (anonymize_ip, no google signals, no ad personalization, send_page_view: false)
   * 5. dynamic script injection of gtag/js
   * 6. single initial page_view event with sanitized page_location
   */
  const enableGa4 = () => {
    window[`ga-disable-${cfg.ga4Id}`] = false;
    analyticsEnabled = true;

    ensureGtag();

    if (!consentDefaultPushed) {
      window.gtag("consent", "default", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      });
      consentDefaultPushed = true;
    }

    window.gtag("consent", "update", {
      analytics_storage: "granted"
    });

    if (!gaConfigured) {
      const cookieFlags =
        window.location && window.location.protocol === "https:"
          ? "SameSite=Lax;Secure"
          : "SameSite=Lax";
      window.gtag("js", new Date());
      window.gtag("config", cfg.ga4Id, {
        anonymize_ip: true,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        send_page_view: false,
        cookie_flags: cookieFlags,
        page_location: cleanLocation,
        page_referrer: cleanReferrer
      });
      gaConfigured = true;
    }

    if (!scriptLoaded) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.ga4Id)}`;
      (document.head || document.documentElement).appendChild(script);
      scriptLoaded = true;
    }

    if (!initialPageViewSent) {
      initialPageViewSent = true;
      trackEvent("page_view", {
        page_path: cleanPath,
        page_language: cfg.pageLang,
        page_type: cfg.pageType
      });
    }

    maybeTrackPurchase();
  };

  const revokeGa4 = () => {
    analyticsEnabled = false;
    window[`ga-disable-${cfg.ga4Id}`] = true;
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      });
    }
    deleteGaCookies();
  };

  // =========================================================================
  // Consent Banner UI Controller (non-modal native <dialog>)
  // =========================================================================
  const banner = document.getElementById("sc-consent-banner");
  const closeBtn = banner ? banner.querySelector("[data-consent-close]") : null;

  const openBanner = (allowClose, focusDialog) => {
    if (!banner) return;
    if (closeBtn instanceof HTMLElement) {
      if (allowClose) closeBtn.removeAttribute("hidden");
      else closeBtn.setAttribute("hidden", "");
    }
    if (focusDialog && typeof banner.show === "function") {
      if (!banner.open) banner.show();
    } else {
      banner.setAttribute("open", "");
    }
  };

  const closeBanner = () => {
    if (!banner) return;
    if (typeof banner.close === "function") {
      if (banner.open) banner.close();
    } else {
      banner.removeAttribute("open");
    }
  };

  const handleConsentChoice = (granted) => {
    writeStoredConsent(granted);
    closeBanner();
    if (granted) {
      enableGa4();
    } else {
      revokeGa4();
    }
  };

  // =========================================================================
  // Delegated Event Tracking (0 PII, zero inline handlers)
  // =========================================================================
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    // 1. Consent banner actions
    const consentBtn = target.closest("[data-consent-action]");
    if (consentBtn) {
      const action = consentBtn.getAttribute("data-consent-action");
      if (action === "accept") {
        handleConsentChoice(true);
      } else if (action === "essential") {
        handleConsentChoice(false);
      }
      return;
    }

    if (target.closest("[data-consent-close]")) {
      closeBanner();
      return;
    }

    // 2. Footer "Cookie-Einstellungen" / "Cookie settings" trigger
    if (target.closest("[data-open-consent-settings]")) {
      event.preventDefault();
      openBanner(readStoredConsent() !== null, true);
      return;
    }

    // 3. Conversion & funnel click tracking (only active after explicit consent)
    if (!analyticsEnabled) return;

    const tracked = target.closest("[data-track-event]");
    if (tracked) {
      const eventName = tracked.getAttribute("data-track-event") || "";

      if (eventName === "connect_ai_click") {
        const client = (tracked.getAttribute("data-track-client") || "").trim().toLowerCase();
        const location = (tracked.getAttribute("data-track-location") || "").trim().toLowerCase();
        if (ALLOWED_CLIENTS.has(client) && ALLOWED_LOCATIONS.has(location)) {
          trackEvent("connect_ai_click", { client, location, transport_type: "beacon" });
        }
        return;
      }

      if (eventName === "copy_setup_snippet") {
        const client = (tracked.getAttribute("data-track-client") || "generic").trim().toLowerCase();
        const snippetType = (tracked.getAttribute("data-track-snippet-type") || "")
          .trim()
          .toLowerCase();
        if (ALLOWED_CLIENTS.has(client) && ALLOWED_SNIPPET_TYPES.has(snippetType)) {
          trackEvent("copy_setup_snippet", { client, snippet_type: snippetType });
        }
        return;
      }

      if (eventName === "download_mcpb") {
        const source = (tracked.getAttribute("data-track-source") || "one_click").trim().toLowerCase();
        if (ALLOWED_SOURCES.has(source)) {
          trackEvent("download_mcpb", { source, transport_type: "beacon" });
        }
        return;
      }

      if (eventName === "setup_tab_select") {
        const client = (tracked.getAttribute("data-track-client") || "").trim().toLowerCase();
        if (ALLOWED_CLIENTS.has(client)) {
          trackEvent("setup_tab_select", { client });
        }
        return;
      }

      if (eventName === "try_prompt_click") {
        const promptId = (tracked.getAttribute("data-track-prompt-id") || "").trim().toLowerCase();
        if (SAFE_ID_RE.test(promptId)) {
          trackEvent("try_prompt_click", { prompt_id: promptId, transport_type: "beacon" });
        }
        return;
      }
    }

    const analyticsEl = target.closest("[data-analytics-event]");
    if (analyticsEl) {
      const analyticsEvent = (analyticsEl.getAttribute("data-analytics-event") || "").trim();
      if (analyticsEvent === "for_merchants_cta_click") {
        const cta = (analyticsEl.getAttribute("data-analytics-cta") || "").trim().toLowerCase();
        const rawCtaLang = (analyticsEl.getAttribute("data-analytics-lang") || cfg.pageLang)
          .trim()
          .toLowerCase();
        const ctaLang = ALLOWED_PAGE_LANGS.has(rawCtaLang) ? rawCtaLang : cfg.pageLang;
        if (ALLOWED_FOR_MERCHANTS_CTAS.has(cta)) {
          trackEvent("for_merchants_cta_click", {
            cta,
            page_language: ctaLang,
            transport_type: "beacon"
          });
        }
        return;
      }
    }

    // 4. Simulation play / replay button triggers demo_video_play once
    const simTrigger = target.closest("#sim-play-btn, #sim-replay-btn");
    if (simTrigger && !demoVideoPlaySent) {
      demoVideoPlaySent = true;
      trackEvent("demo_video_play", { lang: cfg.pageLang });
    }
  });

  // Video play tracking (capture phase because media 'play' events do not bubble)
  document.addEventListener(
    "play",
    (event) => {
      if (!analyticsEnabled || demoVideoPlaySent) return;
      const el = event.target;
      if (el instanceof HTMLVideoElement && el.closest("#demo-shell, .media-frame")) {
        demoVideoPlaySent = true;
        trackEvent("demo_video_play", { lang: cfg.pageLang });
      }
    },
    true
  );

  // Form submit tracking: signup_start, oauth_authorize_complete, begin_checkout (ZERO PII)
  document.addEventListener("submit", (event) => {
    if (!analyticsEnabled) return;
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;

    const eventName = form.getAttribute("data-track-submit") || "";
    if (!eventName) return;

    if (eventName === "signup_start") {
      const surface = (form.getAttribute("data-track-surface") || cfg.pageType).trim().toLowerCase();
      if (ALLOWED_SURFACES.has(surface)) {
        trackEvent("signup_start", {
          surface,
          page_language: cfg.pageLang,
          transport_type: "beacon"
        });
      }
      return;
    }

    if (eventName === "oauth_authorize_complete") {
      if (typeof form.checkValidity === "function" && !form.checkValidity()) return;
      trackEvent("oauth_authorize_complete", {
        method: "otp",
        page_language: cfg.pageLang,
        transport_type: "beacon"
      });
      return;
    }

    if (eventName === "begin_checkout") {
      const rawVal = Number(form.getAttribute("data-track-value") || "9");
      const value = Number.isFinite(rawVal) && rawVal >= 0 ? rawVal : 9;
      trackEvent("begin_checkout", {
        currency: "EUR",
        value,
        transport_type: "beacon"
      });
    }
  });

  // =========================================================================
  // Initialization: strict zero-pre-consent state machine
  // =========================================================================
  const stored = readStoredConsent();
  if (stored === true) {
    enableGa4();
  } else if (stored === null) {
    openBanner(false, false);
  }
})();
