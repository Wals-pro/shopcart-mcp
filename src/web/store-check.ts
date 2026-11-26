import { Router, type Request, type Response } from "express";
import type { AdapterRegistry } from "../adapters/registry.js";
import { escapeHtml, type Lang } from "../auth/pages.js";
import { isPromoFreeProActive } from "../billing/quota.js";
import type { AppConfig } from "../config.js";
import { SsrfError } from "../security/ssrf.js";
import {
  buildStoreCheckCsp,
  renderAnalyticsHead,
  renderConsentBanner,
  renderCookieSettingsFooterLink
} from "./analytics.js";
import { renderFaviconHeadLinks, renderShopCartWordmark, renderSparkCartSvg } from "./brand.js";
import { formatPromoEnd, serializeJsonLd } from "./content.js";
import { getTrademarkDisclaimer } from "./platforms.js";
import {
  extractTrustedClientIp,
  INDEPENDENCE_DISCLAIMER,
  isAllowedStoreCheckOrigin,
  isJsonContentType,
  runStoreCheck,
  STORE_CHECK_MAX_BODY_BYTES,
  STORE_CHECK_TIMEOUT_MS,
  StoreCheckRateLimiter,
  StoreCheckTimeoutError,
  validateStoreCheckInput
} from "./store-check-core.js";

export interface StoreCheckRouterDeps {
  config: AppConfig;
  registry: AdapterRegistry;
  rateLimiter?: StoreCheckRateLimiter;
  timeoutMs?: number;
  trustedProxyHops?: number;
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds maximum size");
    this.name = "PayloadTooLargeError";
  }
}

async function readBoundedJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const rawContentLength = req.headers["content-length"];
  if (rawContentLength !== undefined) {
    const declared = Number.parseInt(
      Array.isArray(rawContentLength) ? rawContentLength[0] ?? "" : rawContentLength,
      10
    );
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      total += buf.byteLength;
      if (total > maxBytes) {
        req.pause();
        fail(new PayloadTooLargeError());
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks, total).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new SyntaxError("Invalid JSON"));
      }
    });

    req.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    req.on("aborted", () => fail(new Error("Request aborted")));
  });
}

function buildStoreCheckJsonLd(config: AppConfig, lang: Lang): Record<string, unknown> {
  const de = lang === "de";
  const origin = config.appOrigin;
  const pageUrl = de ? `${origin}/check` : `${origin}/en/check`;
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: de
      ? "ShopCart Storefront-Selbstcheck"
      : "ShopCart Storefront Self-Check",
    url: pageUrl,
    inLanguage: lang,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: de
      ? "Kostenloser lesender Sofort-Check: Prüfe in Sekunden, welche Daten Claude, ChatGPT, Google Gemini und Instinct aus deinem Online-Shop lesen können."
      : "Free read-only instant check: see in seconds what Claude, ChatGPT, Google Gemini, and Instinct can read from your online store.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR"
    },
    publisher: {
      "@type": "Organization",
      name: "Wals Professional Services GmbH",
      url: "https://wals.pro"
    }
  };
}

export function renderStoreCheckPage(config: AppConfig, lang: Lang): string {
  const de = lang === "de";
  const origin = config.appOrigin;
  const assetVersion = encodeURIComponent(config.version);
  const canonicalUrl = de ? `${origin}/check` : `${origin}/en/check`;
  const otherLang: Lang = de ? "en" : "de";
  const otherPath = de ? "/en/check" : "/check";
  const ogImage = `${origin}/icon-512.png`;
  const promoActive = isPromoFreeProActive(config);
  const promoEnd = formatPromoEnd(config, lang);

  const title = de
    ? "Shop prüfen: Ist dein Online-Shop bereit für KI-Shopping? | ShopCart"
    : "Check Store: Is Your Online Store Ready for AI Shopping? | ShopCart";
  const description = de
    ? "Kostenloser Storefront-Selbstcheck ohne Login oder E-Mail: Prüfe sofort, wie Claude, ChatGPT, Gemini & Instinct deinen Shop lesen — inkl. Produkt- & Varianten-Check."
    : "Free storefront self-check with zero login or email gate: instantly see what Claude, ChatGPT, Gemini & Instinct can read from your store — including live product & variant check.";

  const exampleStores = de
    ? ["snocks.com", "got-bag.com", "waterdrop.de"]
    : ["allbirds.com", "snocks.com", "got-bag.com"];

  const promoBarHtml = promoActive
    ? `<div class="promo-bar">
        <div class="wrap promo-inner">
          <span class="promo-pill">Black Friday</span>
          <span class="promo-text">${
            de
              ? `Pro gratis bis ${escapeHtml(promoEnd)} <span class="promo-extra">(${config.proDailyLimit} Abfragen/Tag) · Code <code class="promo-code">BLACKFRIDAY</code></span>`
              : `Pro free until ${escapeHtml(promoEnd)} <span class="promo-extra">(${config.proDailyLimit} lookups/day) · Code <code class="promo-code">BLACKFRIDAY</code></span>`
          }</span>
          <a class="promo-cta" href="/billing?lang=${lang}">${de ? "Gratis sichern →" : "Claim free Pro →"}</a>
        </div>
      </div>`
    : "";

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#090909">
${renderFaviconHeadLinks()}
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<link rel="alternate" hreflang="de" href="${escapeHtml(`${origin}/check`)}">
<link rel="alternate" hreflang="en" href="${escapeHtml(`${origin}/en/check`)}">
<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${origin}/check`)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ShopCart">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:locale" content="${de ? "de_DE" : "en_US"}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="stylesheet" href="/assets/landing.css?v=${assetVersion}">
<link rel="stylesheet" href="/assets/store-check.css?v=${assetVersion}">
<script defer src="/assets/store-check.js?v=${assetVersion}"></script>
${renderAnalyticsHead(config, { lang, pageType: "store_check", promoActive })}
<script type="application/ld+json">${serializeJsonLd(buildStoreCheckJsonLd(config, lang))}</script>
</head>
<body>
<a class="skip-link" href="#check-main">${de ? "Direkt zum Shop-Check" : "Skip to store check"}</a>
${promoBarHtml}

<header class="site-header">
  <div class="wrap nav">
    <a class="brand" href="/?lang=${lang}">
      ${renderSparkCartSvg({ size: 28, className: "brand-logo" })}
      ${renderShopCartWordmark()}
    </a>

    <nav class="nav-links" aria-label="${de ? "Hauptnavigation" : "Main navigation"}">
      <a class="hide-sm" href="/?lang=${lang}">${de ? "Startseite" : "Home"}</a>
      <a class="hide-sm nav-active" href="${de ? "/check" : "/en/check"}" aria-current="page">${de ? "Shop prüfen" : "Check store"}</a>
      <a class="hide-sm" href="/guides?lang=${lang}">${de ? "Ratgeber" : "Guides"}</a>
      <a class="hide-md" href="/?lang=${lang}#shops">${de ? "Shops" : "Stores"}</a>
      <a class="hide-md" href="/?lang=${lang}#pricing">${de ? "Preise" : "Pricing"}</a>
      <div class="nav-actions">
        <a class="btn-nav" href="/billing?lang=${lang}">${de ? "Konto" : "Account"}</a>
        <a class="btn-nav btn-lang" href="${otherPath}" hreflang="${otherLang}" aria-label="${
          de ? "Switch to English" : "Auf Deutsch wechseln"
        }">${de ? "EN" : "DE"}</a>
      </div>
    </nav>
  </div>
</header>

<main id="check-main" class="sc-check-main">
  <section class="sc-check-hero">
    <div class="wrap wrap-narrow">
      <div class="eyebrow">
        <span class="eyebrow-dot" aria-hidden="true"></span>
        <span>${de ? "Storefront-Selbstcheck · kostenlos &amp; ohne Login" : "Storefront self-check · free &amp; zero login"}</span>
      </div>

      <h1 class="sc-check-title">${
        de
          ? `Wie gut können KI-Assistenten <span class="title-accent">deinen Shop lesen?</span>`
          : `How well can AI assistants <span class="title-accent">read your store?</span>`
      }</h1>

      <p class="sc-check-lead">${
        de
          ? "Prüfe in wenigen Sekunden direkt im Browser, was Claude, ChatGPT, Google Gemini und Instinct aus deinem öffentlichen Online-Shop auslesen können — sofort, ohne E-Mail-Gate und strikt lesend."
          : "Check right in your browser in seconds what Claude, ChatGPT, Google Gemini, and Instinct can read from your public online store — instant results, no email gate, strictly read-only."
      }</p>

      <div class="sc-check-card">
        <form
          id="store-check-form"
          class="sc-check-form"
          action="/api/store-check"
          method="POST"
          data-lang="${lang}"
          novalidate
        >
          <div class="sc-field">
            <label class="sc-label" for="sc-store-url">
              <span>${de ? "Öffentliche Shop-URL oder Domain" : "Public store URL or domain"}</span>
              <span class="sc-req" aria-hidden="true">*</span>
            </label>
            <p id="sc-store-url-hint" class="sc-field-hint">${
              de
                ? "Domain genügt, z. B. snocks.com oder https://waterdrop.de"
                : "A domain is enough, e.g. allbirds.com or https://waterdrop.de"
            }</p>
            <input
              id="sc-store-url"
              class="sc-input"
              name="storeUrl"
              type="text"
              inputmode="url"
              required
              maxlength="256"
              autocomplete="url"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
              enterkeyhint="next"
              placeholder="${de ? "snocks.com" : "allbirds.com"}"
              aria-describedby="sc-store-url-hint"
              aria-invalid="false"
              data-error="sc-store-url-error"
            >
            <div id="sc-store-url-error" class="sc-field-error">
              <span role="img" aria-label="${de ? "Fehler" : "Error"}">!</span>
              <span data-error-text>${
                de
                  ? "Bitte gib eine gültige öffentliche Shop-Domain oder HTTPS-URL ein."
                  : "Please enter a valid public store domain or HTTPS URL."
              }</span>
            </div>
          </div>

          <div class="sc-examples-row" role="group" aria-label="${de ? "Beispiel-Shops einfügen" : "Fill example store"}">
            <span class="sc-examples-label">${de ? "Beispiele:" : "Examples:"}</span>
            ${exampleStores
              .map(
                (domain) =>
                  `<button type="button" class="sc-example-chip" data-example-store="${escapeHtml(domain)}">${escapeHtml(domain)}</button>`
              )
              .join("\n            ")}
          </div>

          <div class="sc-field">
            <label class="sc-label" for="sc-product-url">
              <span>${de ? "Produkt-URL für Live-Check auf Preis, Bestand &amp; Varianten" : "Product URL for live price, stock &amp; variant check"}</span>
              <span class="sc-opt-pill">${de ? "Optional" : "Optional"}</span>
            </label>
            <p id="sc-product-url-hint" class="sc-field-hint">${
              de
                ? "Konkrete Produktseite desselben Shops für einen zweiten lesenden Tiefencheck."
                : "A concrete product page from the same store for a second read-only deep check."
            }</p>
            <input
              id="sc-product-url"
              class="sc-input"
              name="productUrl"
              type="text"
              inputmode="url"
              maxlength="1024"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
              enterkeyhint="go"
              placeholder="${de ? "https://snocks.com/products/..." : "https://allbirds.com/products/..."}"
              aria-describedby="sc-product-url-hint"
              aria-invalid="false"
              data-error="sc-product-url-error"
            >
            <div id="sc-product-url-error" class="sc-field-error">
              <span role="img" aria-label="${de ? "Fehler" : "Error"}">!</span>
              <span data-error-text>${
                de
                  ? "Bitte gib eine gültige Produkt-URL derselben Shop-Domain ein."
                  : "Please enter a valid product URL belonging to the same store domain."
              }</span>
            </div>
          </div>

          <div class="sc-form-actions">
            <button
              type="submit"
              id="sc-submit-btn"
              class="btn-launch btn-launch-primary sc-submit-btn"
              data-idle-label="${de ? "Shop jetzt prüfen" : "Check store now"}"
              data-loading-label="${de ? "Prüfe öffentlichen Shop …" : "Checking public store …"}"
            >${de ? "Shop jetzt prüfen" : "Check store now"}</button>
            <p class="sc-form-meta">${
              de
                ? "Sofortergebnis · Kein Login · Keine E-Mail · Rein lesend"
                : "Instant result · No login · No email · Strictly read-only"
            }</p>
          </div>

          <div id="sc-form-alert" class="sc-alert" role="alert" hidden></div>
        </form>

        <p class="sc-disclaimer-box" id="sc-independence-disclaimer">${escapeHtml(INDEPENDENCE_DISCLAIMER[lang])}</p>
      </div>
    </div>
  </section>

  <section id="sc-loading" class="sc-check-section" hidden aria-live="polite">
    <div class="wrap wrap-narrow">
      <div class="sc-loading-card" role="status">
        <span class="sc-spinner" aria-hidden="true"></span>
        <div>
          <p class="sc-loading-title">${de ? "Öffentliche Storefront wird lesend geprüft …" : "Running read-only check on public storefront …"}</p>
          <p class="sc-loading-sub">${
            de
              ? "Erkenne Shop-System, öffentliche Endpunkte, Policies und — falls angegeben — Produktdaten."
              : "Detecting platform, public endpoints, policies, and — if supplied — live product data."
          }</p>
        </div>
      </div>
    </div>
  </section>

  <section id="sc-result" class="sc-check-section" hidden aria-live="polite"></section>

  <section class="sc-check-section sc-how-strip" aria-labelledby="sc-what-checked-heading">
    <div class="wrap wrap-narrow">
      <h2 id="sc-what-checked-heading" class="sc-section-heading">${
        de ? "Was der Selbstcheck prüft" : "What this self-check inspects"
      }</h2>
      <div class="sc-mini-grid">
        <article class="sc-mini-card">
          <h3>${de ? "Shop-System &amp; Erreichbarkeit" : "Platform &amp; reachability"}</h3>
          <p>${
            de
              ? "Erkennt Shopify (inkl. Storefront MCP &amp; UCP), WooCommerce, Shopware 6, Magento 2, BigCommerce, Amazon oder Schema.org/JSON-LD sowie WAF-Regeln."
              : "Detects Shopify (incl. Storefront MCP &amp; UCP), WooCommerce, Shopware 6, Magento 2, BigCommerce, Amazon, or Schema.org/JSON-LD plus WAF rules."
          }</p>
        </article>
        <article class="sc-mini-card">
          <h3>${de ? "Lesbare KI-Shopping-Funktionen" : "Readable AI shopping capabilities"}</h3>
          <p>${
            de
              ? "Zeigt transparent, ob Suche, Varianten/Größen, Live-Preise, Versand-/Rückgaberegeln, Warenkorb-Links und Rabattcodes öffentlich auslesbar sind."
              : "Shows clearly whether search, variants/sizes, live prices, shipping/return policies, cart links, and promo codes can be read publicly."
          }</p>
        </article>
        <article class="sc-mini-card">
          <h3>${de ? "Optionaler 2. Blick auf ein Produkt" : "Optional 2nd look on a product"}</h3>
          <p>${
            de
              ? "Mit einer konkreten Produkt-URL prüft ShopCart zusätzlich Titel, Live-Preis, Währung, Lagerstatus und Varianten."
              : "With a concrete product URL, ShopCart additionally verifies title, live price, currency, stock status, and variants."
          }</p>
        </article>
      </div>

      <p class="sc-optional-note">
        ${
          de
            ? `Du willst deinen Shop für KI-Shopping optimieren? <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">Mehr über wals.pro</a>`
            : `Want to optimize your store for AI shopping? <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">Learn more at wals.pro</a>`
        }
      </p>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="foot-row">
      <div class="foot-brand">
        ${renderSparkCartSvg({ size: 20, className: "foot-mark" })}
        <span><strong>Shop<span class="brand-accent">Cart</span></strong> · by <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">wals.pro</a></span>
      </div>
      <div class="foot-links">
        <a href="/?lang=${lang}">${de ? "Startseite" : "Home"}</a>
        <a href="${de ? "/check" : "/en/check"}">${de ? "Shop prüfen" : "Check store"}</a>
        <a href="/guides?lang=${lang}">${de ? "Ratgeber" : "Guides"}</a>
        <a href="/billing?lang=${lang}">${de ? "Konto &amp; Abo" : "Account &amp; billing"}</a>
        <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy"}</a>
        <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a>
        <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener noreferrer">${
          de ? "Impressum" : "Legal Notice"
        }</a>
        ${renderCookieSettingsFooterLink(config, lang)}
      </div>
    </div>
    <p class="disclaimer">${escapeHtml(getTrademarkDisclaimer(lang))}</p>
  </div>
</footer>
${renderConsentBanner(config, lang)}
</body>
</html>`;
}

export function createStoreCheckRouter(deps: StoreCheckRouterDeps): Router {
  const { config, registry } = deps;
  const rateLimiter = deps.rateLimiter ?? new StoreCheckRateLimiter();
  const timeoutMs = deps.timeoutMs ?? STORE_CHECK_TIMEOUT_MS;
  const trustedProxyHops = deps.trustedProxyHops ?? 1;
  const csp = buildStoreCheckCsp(config.ga4MeasurementId);

  const router = Router();

  const sendCheckHtml = (res: Response, lang: Lang) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    // same-origin ensures browsers always send real Origin/Referer headers on same-origin fetch()
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("Content-Language", lang);
    res.status(200).type("html").send(renderStoreCheckPage(config, lang));
  };

  router.get("/check", (_req: Request, res: Response) => {
    sendCheckHtml(res, "de");
  });

  router.get("/en/check", (_req: Request, res: Response) => {
    sendCheckHtml(res, "en");
  });

  router.post("/api/store-check", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");

    // 1. Same-Origin / CSRF enforcement (reject cross-origin browser requests with 403)
    if (!isAllowedStoreCheckOrigin(req, config.appOrigin)) {
      res.status(403).json({
        error: "forbidden_origin",
        message: "Cross-origin requests are not allowed."
      });
      return;
    }

    // 2. Strict Content-Type: application/json enforcement (415)
    if (!isJsonContentType(req.headers["content-type"])) {
      res.status(415).json({
        error: "unsupported_media_type",
        message: "Content-Type must be application/json."
      });
      return;
    }

    // 3. Strictly bounded request body read (<= 2048 bytes -> 413)
    let rawBody: unknown;
    try {
      rawBody = await readBoundedJsonBody(req, STORE_CHECK_MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        res.status(413).json({
          error: "payload_too_large",
          message: `Request body must not exceed ${STORE_CHECK_MAX_BODY_BYTES} bytes.`
        });
        return;
      }
      res.status(400).json({
        error: "invalid_json",
        message: "Request body must be valid JSON."
      });
      return;
    }

    const reqLang: Lang =
      rawBody && typeof rawBody === "object" && (rawBody as Record<string, unknown>).lang === "en"
        ? "en"
        : "de";
    const de = reqLang === "de";

    // 4. Per-IP dual-window rate limiting (10/min + 60/hour) BEFORE any outbound network call
    const clientIp = extractTrustedClientIp(req, trustedProxyHops);
    const limitResult = rateLimiter.consume(clientIp);
    if (!limitResult.allowed) {
      res.setHeader("Retry-After", String(limitResult.retryAfterSeconds));
      res.status(429).json({
        error: "rate_limited",
        retryAfterSeconds: limitResult.retryAfterSeconds,
        message: de
          ? `Zu viele Prüfungen in kurzer Zeit. Bitte warte ca. ${limitResult.retryAfterSeconds} Sekunden und versuche es erneut.`
          : `Too many store checks in a short time. Please wait about ${limitResult.retryAfterSeconds} seconds and try again.`
      });
      return;
    }

    // 5. Strict Zod + URL + same-store validation
    const validated = validateStoreCheckInput(rawBody);
    if (!validated.ok) {
      res.status(400).json({
        error: validated.code,
        field: validated.field,
        message: validated.message
      });
      return;
    }

    // 6. Execute SSRF-hardened read-only check under hard overall timeout
    try {
      const result = await runStoreCheck({
        registry,
        input: validated.data,
        concurrencyKey: `selfcheck:${clientIp}`,
        timeoutMs
      });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof StoreCheckTimeoutError || (err instanceof SsrfError && err.code === "TIMEOUT")) {
        res.status(504).json({
          error: "timeout",
          message: de
            ? "Der Shop hat nicht innerhalb des Zeitlimits geantwortet. Bitte versuche es in einem Moment erneut."
            : "The store did not respond within the time limit. Please try again in a moment."
        });
        return;
      }
      if (err instanceof SsrfError) {
        if (err.code === "CONCURRENCY_LIMIT") {
          res.setHeader("Retry-After", "5");
          res.status(429).json({
            error: "concurrency_limit",
            retryAfterSeconds: 5,
            message: de
              ? "Es laufen gerade bereits mehrere Prüfungen. Bitte kurz warten und erneut versuchen."
              : "Several checks are already running. Please wait a moment and try again."
          });
          return;
        }
        if (err.code === "BLOCKED_HOST" || err.code === "BLOCKED_IP" || err.code === "INVALID_URL") {
          res.status(400).json({
            error: "url_blocked",
            field: "storeUrl",
            message: de
              ? "Diese Zieladresse ist nicht öffentlich erlaubt (lokale/private Netze oder ungültige Weiterleitung blockiert)."
              : "This target address is not permitted (local/private networks or unsafe redirect blocked)."
          });
          return;
        }
      }
      res.status(502).json({
        error: "store_unreachable",
        message: de
          ? "Der Shop konnte aktuell nicht geprüft werden. Bitte prüfe die Domain und versuche es erneut."
          : "The store could not be checked right now. Please verify the domain and try again."
      });
    }
  });

  return router;
}
