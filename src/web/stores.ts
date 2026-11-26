import { Router, type Request, type Response } from "express";
import { escapeHtml, type Lang } from "../auth/pages.js";
import { isPromoFreeProActive } from "../billing/quota.js";
import type { AppConfig } from "../config.js";
import { sanitizeText } from "../security/sanitize.js";
import { getCategoryLabel, STORE_CATEGORIES } from "../stores/categories.js";
import { getStoreDirectory } from "../stores/directory.js";
import {
  STORE_PLATFORMS,
  type StoreCategoryId,
  type StoreDiscoveryItem,
  type StorePlatform
} from "../stores/types.js";
import {
  buildGuidesCsp,
  renderAnalyticsHead,
  renderConsentBanner,
  renderCookieSettingsFooterLink
} from "./analytics.js";
import { renderFaviconHeadLinks, renderShopCartWordmark, renderSparkCartSvg } from "./brand.js";
import { serializeJsonLd } from "./content.js";
import { getTrademarkDisclaimer } from "./platforms.js";

const PLATFORM_LABELS: Readonly<Record<StorePlatform, { de: string; en: string }>> = {
  shopify: { de: "Shopify", en: "Shopify" },
  woocommerce: { de: "WooCommerce", en: "WooCommerce" },
  shopware: { de: "Shopware 6", en: "Shopware 6" },
  bigcommerce: { de: "BigCommerce", en: "BigCommerce" },
  magento: { de: "Magento 2", en: "Magento 2" },
  ucp: { de: "UCP", en: "UCP" },
  other: { de: "JSON-LD / Weitere", en: "JSON-LD / Other" }
};

const COUNTRY_OPTIONS: readonly { value: string; label_de: string; label_en: string }[] = [
  { value: "", label_de: "Alle Länder", label_en: "All countries" },
  { value: "DACH", label_de: "DACH (DE, AT, CH)", label_en: "DACH (DE, AT, CH)" },
  { value: "DE", label_de: "Deutschland (DE)", label_en: "Germany (DE)" },
  { value: "AT", label_de: "Österreich (AT)", label_en: "Austria (AT)" },
  { value: "CH", label_de: "Schweiz (CH)", label_en: "Switzerland (CH)" },
  { value: "US", label_de: "USA (US)", label_en: "United States (US)" },
  { value: "UK", label_de: "Großbritannien (UK)", label_en: "United Kingdom (UK)" },
  { value: "EU", label_de: "Europa (EU)", label_en: "Europe (EU)" }
];

const PLATFORM_OPTIONS: readonly { value: string; label_de: string; label_en: string }[] = [
  { value: "", label_de: "Alle Plattformen", label_en: "All platforms" },
  { value: "shopify", label_de: "Shopify", label_en: "Shopify" },
  { value: "woocommerce", label_de: "WooCommerce", label_en: "WooCommerce" },
  { value: "shopware", label_de: "Shopware 6", label_en: "Shopware 6" },
  { value: "bigcommerce", label_de: "BigCommerce", label_en: "BigCommerce" },
  { value: "magento", label_de: "Magento 2", label_en: "Magento 2" },
  { value: "ucp", label_de: "UCP", label_en: "UCP" },
  { value: "other", label_de: "JSON-LD / Weitere", label_en: "JSON-LD / Other" }
];

function firstQueryString(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return "";
}

function parseBoolParam(raw: string): boolean {
  const lowered = raw.trim().toLowerCase();
  return lowered === "true" || lowered === "1" || lowered === "yes" || lowered === "on";
}

function parseOptionalInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function getPlatformLabel(platform: StorePlatform, lang: Lang): string {
  return lang === "de" ? PLATFORM_LABELS[platform].de : PLATFORM_LABELS[platform].en;
}

function buildFilterUrl(
  basePath: string,
  params: {
    q?: string | null;
    category?: string | null;
    country?: string | null;
    platform?: string | null;
    cart_only?: boolean;
  }
): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.category) sp.set("category", params.category);
  if (params.country) sp.set("country", params.country);
  if (params.platform) sp.set("platform", params.platform);
  if (params.cart_only) sp.set("cart_only", "true");
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function renderStoreCard(store: StoreDiscoveryItem, lang: Lang): string {
  const de = lang === "de";
  const checkBase = de ? "/check" : "/en/check";
  const checkHref = `${checkBase}?url=${encodeURIComponent(store.url)}`;
  const testHref = `/?lang=${lang}#start`;
  const platformLabel = getPlatformLabel(store.platform, lang);

  const countriesHtml = store.countries
    .map((code) => `<span class="badge badge-country">${escapeHtml(code)}</span>`)
    .join("");

  const categoriesHtml = store.categories
    .map(
      (catId) =>
        `<span class="badge badge-cat">${escapeHtml(getCategoryLabel(catId, lang))}</span>`
    )
    .join("");

  const cartBadge = store.cart_supported
    ? `<span class="badge badge-cap badge-cap-yes"><span aria-hidden="true">✓</span> ${
        de ? "Warenkorb-Link" : "Cart link"
      }</span>`
    : `<span class="badge badge-cap badge-cap-link"><span aria-hidden="true">↗</span> ${
        de ? "Produktlink" : "Product link"
      }</span>`;

  const discountBadge = store.discounts_supported
    ? `<span class="badge badge-cap badge-cap-discount"><span aria-hidden="true">%</span> ${
        de ? "Rabatt-Check" : "Discounts"
      }</span>`
    : "";

  return `<li class="store-card" data-domain="${escapeHtml(store.domain)}">
  <div class="store-card-head">
    <div class="store-title-wrap">
      <h3 class="store-name">${escapeHtml(store.name)}</h3>
      <a class="store-domain" href="${escapeHtml(store.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(store.domain)}<span class="visually-hidden"> (${
        de ? "öffnet Shop in neuem Tab" : "opens store in new tab"
      })</span></a>
    </div>
    <span class="badge badge-platform badge-platform-${escapeHtml(store.platform)}">${escapeHtml(platformLabel)}</span>
  </div>
  <p class="store-desc">${escapeHtml(store.description)}</p>
  <div class="store-meta-row" aria-label="${de ? "Länder und Funktionen" : "Countries and capabilities"}">
    ${countriesHtml}
    ${cartBadge}
    ${discountBadge}
  </div>
  <div class="store-cats-row">
    ${categoriesHtml}
  </div>
  <div class="store-actions">
    <a class="store-btn store-btn-secondary" href="${escapeHtml(checkHref)}">${
      de ? "Shop im Selbstcheck prüfen" : "Check Storefront"
    }<span class="visually-hidden"> (${escapeHtml(store.name)})</span></a>
    <a class="store-btn store-btn-primary" href="${escapeHtml(testHref)}">${
      de ? "In Claude/ChatGPT testen" : "Test in Claude/ChatGPT"
    }<span class="visually-hidden"> (${escapeHtml(store.name)})</span></a>
  </div>
</li>`;
}

export interface StoreDirectoryPageFilters {
  q?: string;
  category?: string;
  country?: string;
  platform?: string;
  cart_only?: boolean;
}

export function renderStoresDirectoryPage(
  config: AppConfig,
  lang: Lang,
  rawFilters: StoreDirectoryPageFilters = {}
): string {
  const de = lang === "de";
  const otherLang: Lang = de ? "en" : "de";
  const basePath = de ? "/stores" : "/en/stores";
  const otherBasePath = de ? "/en/stores" : "/stores";
  const checkPath = de ? "/check" : "/en/check";
  const origin = config.appOrigin;
  const canonicalUrl = `${origin}${basePath}`;
  const assetVersion = encodeURIComponent(config.version);
  const promoActive = isPromoFreeProActive(config);

  const directory = getStoreDirectory();
  const totalDirectorySize = directory.size();

  const cleanQ = rawFilters.q ? sanitizeText(rawFilters.q, 200) : "";
  const cleanCategory = rawFilters.category ? sanitizeText(rawFilters.category, 80) : "";
  const cleanCountry = rawFilters.country ? sanitizeText(rawFilters.country, 32) : "";
  const cleanPlatform = rawFilters.platform ? sanitizeText(rawFilters.platform, 40) : "";
  const cartOnly = Boolean(rawFilters.cart_only);

  const discovery = directory.discover(
    {
      query: cleanQ || undefined,
      category: cleanCategory || undefined,
      country: cleanCountry || undefined,
      platform: cleanPlatform || undefined,
      cart_only: cartOnly,
      limit: totalDirectorySize,
      lang
    },
    { defaultLimit: totalDirectorySize, maxLimit: Math.max(totalDirectorySize, 500) }
  );

  // Facet counts without category filter so users can switch between categories with live counts
  const categoryContext = directory.discover(
    {
      query: cleanQ || undefined,
      country: cleanCountry || undefined,
      platform: cleanPlatform || undefined,
      cart_only: cartOnly,
      limit: totalDirectorySize,
      lang
    },
    { defaultLimit: totalDirectorySize, maxLimit: Math.max(totalDirectorySize, 500) }
  );

  const activeCategory: StoreCategoryId | null = discovery.applied_filters.category;
  const activeCountry = discovery.applied_filters.country ?? "";
  const activePlatform = discovery.applied_filters.platform ?? "";
  const hasAnyFilter = Boolean(
    cleanQ || activeCategory || activeCountry || activePlatform || cartOnly
  );

  const metaTitle = de
    ? `Online-Shop-Verzeichnis (${totalDirectorySize}+ geprüfte Shops) | ShopCart MCP`
    : `Global Online Store Directory (${totalDirectorySize}+ Verified Stores) | ShopCart MCP`;
  const metaDescription = de
    ? `Durchsuche über ${totalDirectorySize} live geprüfte Online-Shops in DACH & weltweit nach Kategorie, Land und Shop-System für Claude, ChatGPT & Google Gemini.`
    : `Browse ${totalDirectorySize}+ live-verified online stores across DACH & worldwide by category, country, and platform for Claude, ChatGPT & Google Gemini.`;

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: metaTitle,
    description: metaDescription,
    url: canonicalUrl,
    inLanguage: lang,
    publisher: {
      "@type": "Organization",
      name: "Wals Professional Services GmbH",
      url: "https://wals.pro"
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: totalDirectorySize,
      itemListElement: discovery.stores.slice(0, 30).map((s, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        name: s.name,
        url: s.url
      }))
    }
  };

  const allChipHref = buildFilterUrl(basePath, {
    q: cleanQ || null,
    country: activeCountry || null,
    platform: activePlatform || null,
    cart_only: cartOnly
  });

  const categoryChipsHtml = [
    `<a class="cat-chip${activeCategory === null ? " is-active" : ""}" href="${escapeHtml(allChipHref)}" data-category="" aria-current="${
      activeCategory === null ? "true" : "false"
    }"><span>${de ? "Alle Kategorien" : "All categories"}</span> <span class="cat-count" data-cat-count="">${categoryContext.total_matches}</span></a>`,
    ...STORE_CATEGORIES.map((cat) => {
      const count = categoryContext.facets.categories[cat.id] ?? 0;
      const isSelected = activeCategory === cat.id;
      const href = buildFilterUrl(basePath, {
        q: cleanQ || null,
        category: cat.id,
        country: activeCountry || null,
        platform: activePlatform || null,
        cart_only: cartOnly
      });
      return `<a class="cat-chip${isSelected ? " is-active" : ""}" href="${escapeHtml(href)}" data-category="${escapeHtml(cat.id)}" aria-current="${
        isSelected ? "true" : "false"
      }"><span>${escapeHtml(de ? cat.label_de : cat.label_en)}</span> <span class="cat-count" data-cat-count="${escapeHtml(cat.id)}">${count}</span></a>`;
    })
  ].join("\n          ");

  const countryOptionsHtml = COUNTRY_OPTIONS.map((opt) => {
    const selected = activeCountry === opt.value ? " selected" : "";
    return `<option value="${escapeHtml(opt.value)}"${selected}>${escapeHtml(
      de ? opt.label_de : opt.label_en
    )}</option>`;
  }).join("\n            ");

  const platformOptionsHtml = PLATFORM_OPTIONS.map((opt) => {
    const selected = activePlatform === opt.value ? " selected" : "";
    return `<option value="${escapeHtml(opt.value)}"${selected}>${escapeHtml(
      de ? opt.label_de : opt.label_en
    )}</option>`;
  }).join("\n            ");

  const cardsHtml =
    discovery.stores.length > 0
      ? discovery.stores.map((s) => renderStoreCard(s, lang)).join("\n        ")
      : "";

  const statusText = de
    ? `${discovery.total_matches} von ${totalDirectorySize} live geprüften Online-Shops`
    : `${discovery.total_matches} of ${totalDirectorySize} live-verified online stores`;

  const switchHref = buildFilterUrl(otherBasePath, {
    q: cleanQ || null,
    category: activeCategory,
    country: activeCountry || null,
    platform: activePlatform || null,
    cart_only: cartOnly
  });

  const promoHtml = promoActive
    ? `<div class="promo-bar">
  <div class="wrap promo-inner">
    <span class="promo-pill">Black Friday Launch</span>
    <span>${
      de
        ? `Hosted Pro kostenlos bis 06.12.2026 (${config.proDailyLimit} Calls/Tag) · Code <code>BLACKFRIDAY</code>`
        : `Hosted Pro free until Dec 6, 2026 (${config.proDailyLimit} calls/day) · Code <code>BLACKFRIDAY</code>`
    }</span>
    <a class="promo-cta" href="/billing?lang=${lang}">${de ? "Gratis aktivieren →" : "Claim free Pro →"}</a>
  </div>
</div>`
    : "";

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#141414">
${renderFaviconHeadLinks()}
<title>${escapeHtml(metaTitle)}</title>
<meta name="description" content="${escapeHtml(metaDescription)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<link rel="alternate" hreflang="de" href="${escapeHtml(`${origin}/stores`)}">
<link rel="alternate" hreflang="en" href="${escapeHtml(`${origin}/en/stores`)}">
<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${origin}/stores`)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ShopCart MCP by wals.pro">
<meta property="og:locale" content="${de ? "de_DE" : "en_US"}">
<meta property="og:title" content="${escapeHtml(metaTitle)}">
<meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(`${origin}/icon-512.png`)}">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/assets/stores.css?v=${assetVersion}">
<script defer src="/assets/stores.js?v=${assetVersion}"></script>
${renderAnalyticsHead(config, { lang, pageType: "stores_directory", promoActive })}
<script type="application/ld+json">${serializeJsonLd(collectionLd)}</script>
</head>
<body data-lang="${lang}" data-base-path="${basePath}" data-check-path="${checkPath}" data-total-stores="${totalDirectorySize}">
<a class="skip-link" href="#stores-heading">${de ? "Direkt zum Shop-Verzeichnis" : "Skip to store directory"}</a>
${promoHtml}

<header class="site-header">
  <div class="wrap nav">
    <a class="brand" href="/?lang=${lang}">
      ${renderSparkCartSvg({ size: 26, className: "brand-logo" })}
      ${renderShopCartWordmark("MCP")}
      <span class="brand-badge">&gt; MCP_</span>
    </a>
    <nav class="nav-links" aria-label="${de ? "Hauptnavigation" : "Main navigation"}">
      <a href="/?lang=${lang}">${de ? "Startseite" : "Home"}</a>
      <a href="${basePath}" aria-current="page">${de ? "Shop-Verzeichnis" : "Store Directory"}</a>
      <a href="/guides?lang=${lang}">${de ? "Ratgeber" : "Guides"}</a>
      <a href="${checkPath}">${de ? "Selbstcheck" : "Self-Check"}</a>
      <a href="/billing?lang=${lang}">${de ? "Konto &amp; Billing" : "Account &amp; Billing"}</a>
      <a class="btn-nav" href="${escapeHtml(switchHref)}" hreflang="${otherLang}">${de ? "EN" : "DE"}</a>
    </nav>
  </div>
</header>

<main class="stores-main">
  <div class="wrap">
    <section class="stores-hero">
      <div class="kicker-row">
        <span class="kicker">${de ? "Globales Shop-Verzeichnis" : "Global Store Directory"}</span>
        <span class="meta-pill">${totalDirectorySize} ${de ? "live geprüfte Shops · 12 Kategorien" : "live-verified stores · 12 categories"}</span>
      </div>
      <h1 id="stores-heading" tabindex="-1">${
        de
          ? "Live geprüfte Online-Shops für Claude, ChatGPT &amp; Gemini"
          : "Live-verified online stores for Claude, ChatGPT &amp; Gemini"
      }</h1>
      <p class="hero-lead">${
        de
          ? "Finde geprüfte Online-Shops aus DACH und weltweit nach Kategorie, Land und Shop-System. In deiner KI wählt ShopCart passende Shops automatisch über das Tool discover_stores – rein lesend, ohne Scraping."
          : "Explore verified online stores across DACH and worldwide by category, country, and platform. Inside your AI assistant, ShopCart automatically recommends matching stores via discover_stores — strictly read-only, with zero runtime scraping."
      }</p>

      <div class="merchant-cta-banner">
        <div class="merchant-cta-copy">
          <h2>${de ? "Kostenlos eigenen Shop prüfen &amp; eintragen" : "Verify &amp; list your store for free"}</h2>
          <p>${
            de
              ? "Betreibst du einen Online-Shop auf Shopify, WooCommerce, Shopware 6, BigCommerce, Magento 2 oder mit Schema.org? Prüfe die KI-Lesbarkeit in Sekunden im kostenlosen Selbstcheck."
              : "Run a storefront on Shopify, WooCommerce, Shopware 6, BigCommerce, Magento 2, or Schema.org? Test AI readiness in seconds with our free storefront self-check."
          }</p>
        </div>
        <a class="btn-cta" href="${checkPath}">${
          de ? "Kostenlos eigenen Shop prüfen &amp; eintragen →" : "Verify &amp; list your store for free →"
        }</a>
      </div>
    </section>

    <search class="filter-panel" aria-label="${de ? "Shops durchsuchen und filtern" : "Search and filter stores"}">
      <form id="stores-filter-form" class="filter-form" method="GET" action="${basePath}">
        <input type="hidden" id="stores-category-input" name="category" value="${escapeHtml(activeCategory ?? "")}">
        <div class="filter-controls-row">
          <div class="field field-search">
            <label for="stores-q">${de ? "Suche nach Shop, Produkt oder Stichwort" : "Search by store, product, or keyword"}</label>
            <input
              type="search"
              id="stores-q"
              name="q"
              value="${escapeHtml(cleanQ)}"
              maxlength="120"
              placeholder="${de ? "z. B. Matcha, Laufshorts, Refurbished, SNOCKS …" : "e.g. matcha, running shorts, refurbished, Allbirds …"}"
              enterkeyhint="search"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
            >
          </div>

          <div class="field field-select">
            <label for="stores-country">${de ? "Land / Region" : "Country / Region"}</label>
            <select id="stores-country" name="country">
              ${countryOptionsHtml}
            </select>
          </div>

          <div class="field field-select">
            <label for="stores-platform">${de ? "Shop-System" : "Platform"}</label>
            <select id="stores-platform" name="platform">
              ${platformOptionsHtml}
            </select>
          </div>

          <div class="field field-check">
            <input
              type="checkbox"
              id="stores-cart-only"
              name="cart_only"
              value="true"${cartOnly ? " checked" : ""}
            >
            <label for="stores-cart-only">${de ? "Nur mit Warenkorb-Link" : "Cart-link ready only"}</label>
          </div>

          <div class="field field-submit">
            <button type="submit" class="btn-filter-submit">${de ? "Filtern" : "Filter"}</button>
            <a
              id="stores-reset-link"
              class="btn-filter-reset${hasAnyFilter ? "" : " is-hidden"}"
              href="${basePath}"
            >${de ? "Zurücksetzen" : "Reset"}</a>
          </div>
        </div>
      </form>

      <div class="cat-chips-wrap" role="group" aria-label="${de ? "Nach Kategorie filtern" : "Filter by category"}">
        ${categoryChipsHtml}
      </div>

      <div class="results-bar">
        <p id="stores-status" class="results-status" role="status" aria-live="polite">${escapeHtml(statusText)}</p>
        <p class="results-api-hint">${
          de
            ? 'MCP-Tool: <code>discover_stores</code> · JSON-API: <a href="/api/stores">/api/stores</a>'
            : 'MCP tool: <code>discover_stores</code> · JSON API: <a href="/api/stores">/api/stores</a>'
        }</p>
      </div>
    </search>

    <section class="stores-results" aria-label="${de ? "Gefundene Online-Shops" : "Matching online stores"}">
      <ul id="stores-grid" class="store-grid" role="list">
        ${cardsHtml}
      </ul>
      <div id="stores-empty" class="empty-state${discovery.stores.length === 0 ? "" : " is-hidden"}">
        <h3>${de ? "Keine passenden Shops für diese Filter gefunden" : "No stores match these filters"}</h3>
        <p>${
          de
            ? "Entferne einen Filter oder probiere ein kürzeres Stichwort (z. B. Kaffee, Running, Naturkosmetik)."
            : "Try removing a filter or using a shorter keyword (e.g. coffee, running, skincare)."
        }</p>
        <a class="btn-cta" href="${basePath}">${de ? "Alle Shops anzeigen" : "Show all stores"}</a>
      </div>
    </section>

    <aside class="index-notice" aria-labelledby="index-notice-heading">
      <h2 id="index-notice-heading">${
        de ? "Transparenter Fakten-Index &amp; Opt-out" : "Transparent Factual Index &amp; Opt-Out"
      }</h2>
      <p>${
        de
          ? 'Dieses Verzeichnis listet öffentlich erreichbare Online-Shops mit sachlichen Angaben (Domain, Shop-System, Lieferregionen, Kategorien). ShopCart respektiert <code>robots.txt</code>, speichert keine fremden Produktkataloge und steht in keiner wirtschaftlichen Verbindung zu den gelisteten Händlern, sofern nicht ausdrücklich gekennzeichnet. Korrekturen, Aktualisierungen oder sofortige Austragung (Opt-out) jederzeit per E-Mail an <a href="mailto:support@wals.pro">support@wals.pro</a>.'
          : 'This directory lists publicly accessible online stores with factual metadata (domain, platform, regions, categories). ShopCart respects <code>robots.txt</code>, does not scrape or store third-party catalogs, and has no commercial affiliation with listed merchants unless explicitly disclosed. Request corrections, updates, or immediate removal (opt-out) anytime via <a href="mailto:support@wals.pro">support@wals.pro</a>.'
      }</p>
    </aside>
  </div>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="foot-row">
      <div class="foot-brand">
        ${renderSparkCartSvg({ size: 20, className: "foot-mark" })}
        <span><strong>Shop<span class="brand-accent">Cart</span> MCP</strong> · by <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">wals.pro</a></span>
      </div>
      <div class="foot-links">
        <a href="${basePath}">${de ? "Shop-Verzeichnis" : "Store Directory"}</a>
        <a href="/guides?lang=${lang}">${de ? "Ratgeber" : "Guides"}</a>
        <a href="${checkPath}">${de ? "Selbstcheck" : "Self-Check"}</a>
        <a href="/billing?lang=${lang}">${de ? "Konto &amp; Billing" : "Account &amp; Billing"}</a>
        <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy"}</a>
        <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a>
        <a href="/sitemap.xml">Sitemap</a>
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

function sendStoresHtml(res: Response, html: string, csp: string, lang: Lang): void {
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Content-Language", lang);
  res.status(200).type("html").send(html);
}

export function createStoresRouter(config: AppConfig): Router {
  const router = Router();
  const storesCsp = buildGuidesCsp(config.ga4MeasurementId);

  const handleHtml = (lang: Lang) => (req: Request, res: Response) => {
    const q = firstQueryString(req.query.q);
    const category = firstQueryString(req.query.category);
    const country = firstQueryString(req.query.country);
    const platform = firstQueryString(req.query.platform);
    const cartOnly = parseBoolParam(firstQueryString(req.query.cart_only));

    const html = renderStoresDirectoryPage(config, lang, {
      q,
      category,
      country,
      platform,
      cart_only: cartOnly
    });
    sendStoresHtml(res, html, storesCsp, lang);
  };

  router.get("/stores", handleHtml("de"));
  router.get("/en/stores", handleHtml("en"));

  router.get("/api/stores", (req: Request, res: Response) => {
    const directory = getStoreDirectory();
    const totalSize = directory.size();

    const rawQ = firstQueryString(req.query.q) || firstQueryString(req.query.query);
    const rawCategory = firstQueryString(req.query.category);
    const rawCountry = firstQueryString(req.query.country);
    const rawPlatform = firstQueryString(req.query.platform);
    const rawCartOnly = firstQueryString(req.query.cart_only);
    const rawLimit = firstQueryString(req.query.limit);
    const rawLang = firstQueryString(req.query.lang).trim().toLowerCase();
    const lang: Lang = rawLang === "de" ? "de" : "en";

    const parsedLimit = parseOptionalInt(rawLimit);
    const result = directory.discover(
      {
        query: rawQ || undefined,
        category: rawCategory || undefined,
        country: rawCountry || undefined,
        platform: rawPlatform || undefined,
        cart_only: parseBoolParam(rawCartOnly),
        limit: parsedLimit ?? totalSize,
        lang
      },
      { defaultLimit: totalSize, maxLimit: Math.max(totalSize, 500) }
    );

    const categoryContext = directory.discover(
      {
        query: rawQ || undefined,
        country: rawCountry || undefined,
        platform: rawPlatform || undefined,
        cart_only: parseBoolParam(rawCartOnly),
        limit: totalSize,
        lang
      },
      { defaultLimit: totalSize, maxLimit: Math.max(totalSize, 500) }
    );

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      total_matches: result.total_matches,
      returned: result.returned,
      directory_size: result.directory_size,
      applied_filters: result.applied_filters,
      available_categories: result.available_categories,
      available_platforms: STORE_PLATFORMS,
      category_counts: categoryContext.facets.categories,
      category_total: categoryContext.total_matches,
      stores: result.stores,
      ...(result.notices.length > 0 ? { notices: result.notices } : {})
    });
  });

  return router;
}
