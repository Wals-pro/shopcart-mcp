import { parseGa4MeasurementId, type AppConfig } from "../config.js";
import { escapeHtml, type Lang } from "../auth/pages.js";

export type AnalyticsPageType =
  | "landing"
  | "guide"
  | "guides_index"
  | "billing"
  | "oauth"
  | "legal";

export const GA4_CSP_SCRIPT_SRC = "https://www.googletagmanager.com";
export const GA4_CSP_CONNECT_SRC =
  "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com";
export const GA4_CSP_IMG_SRC =
  "https://*.google-analytics.com https://www.googletagmanager.com";

function hasValidGa4Id(raw: string | undefined): boolean {
  return Boolean(parseGa4MeasurementId(raw));
}

function normalizeFormActionOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function buildLandingCsp(ga4MeasurementId: string | undefined): string {
  const enabled = hasValidGa4Id(ga4MeasurementId);
  const scriptSrc = enabled ? `script-src 'self' ${GA4_CSP_SCRIPT_SRC}` : "script-src 'self'";
  const imgSrc = enabled ? `img-src 'self' data: https: ${GA4_CSP_IMG_SRC}` : "img-src 'self' data: https:";
  const connectSrc = enabled ? `connect-src 'self' ${GA4_CSP_CONNECT_SRC}` : "connect-src 'self'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self'",
    imgSrc,
    "media-src 'self' https:",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com https://www.tiktok.com",
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export function buildGuidesCsp(ga4MeasurementId: string | undefined): string {
  const enabled = hasValidGa4Id(ga4MeasurementId);
  const scriptSrc = enabled ? `script-src 'self' ${GA4_CSP_SCRIPT_SRC}` : "script-src 'self'";
  const imgSrc = enabled ? `img-src 'self' data: https: ${GA4_CSP_IMG_SRC}` : "img-src 'self' data: https:";
  const connectSrc = enabled ? `connect-src 'self' ${GA4_CSP_CONNECT_SRC}` : "connect-src 'self'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self'",
    imgSrc,
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export function buildLegalCsp(ga4MeasurementId: string | undefined): string {
  const enabled = hasValidGa4Id(ga4MeasurementId);
  const scriptSrc = enabled ? `script-src 'self' ${GA4_CSP_SCRIPT_SRC}` : "script-src 'self'";
  const imgSrc = enabled ? `img-src 'self' data: ${GA4_CSP_IMG_SRC}` : "img-src 'self' data:";
  const connectSrc = enabled ? `connect-src 'self' ${GA4_CSP_CONNECT_SRC}` : "connect-src 'self'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self'",
    imgSrc,
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export function buildBillingCsp(ga4MeasurementId: string | undefined): string {
  if (!hasValidGa4Id(ga4MeasurementId)) {
    return "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; frame-ancestors 'none'; base-uri 'none'";
  }
  return [
    "default-src 'none'",
    `script-src 'self' ${GA4_CSP_SCRIPT_SRC}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${GA4_CSP_IMG_SRC}`,
    `connect-src ${GA4_CSP_CONNECT_SRC}`,
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'none'"
  ].join("; ");
}

export function buildOAuthCsp(
  ga4MeasurementId: string | undefined,
  formActionOrigin?: string
): string {
  const safeOrigin = normalizeFormActionOrigin(formActionOrigin);
  const formAction = safeOrigin ? `'self' ${safeOrigin}` : "'self'";
  if (!hasValidGa4Id(ga4MeasurementId)) {
    return `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`;
  }
  return [
    "default-src 'none'",
    `script-src 'self' ${GA4_CSP_SCRIPT_SRC}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${GA4_CSP_IMG_SRC}`,
    `connect-src ${GA4_CSP_CONNECT_SRC}`,
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
    "base-uri 'none'"
  ].join("; ");
}

export function renderAnalyticsHead(
  config: AppConfig,
  opts: { lang: Lang; pageType: AnalyticsPageType; promoActive?: boolean }
): string {
  const validId = parseGa4MeasurementId(config.ga4MeasurementId);
  if (!validId) return "";
  const v = encodeURIComponent(config.version);
  const id = escapeHtml(validId);
  const lang = escapeHtml(opts.lang);
  const pageType = escapeHtml(opts.pageType);
  const promoAttr = opts.promoActive ? ' data-promo-active="true"' : "";
  return [
    `<meta name="shopcart-ga4" content="${id}">`,
    `<link rel="stylesheet" href="/assets/analytics.css?v=${v}">`,
    `<script defer src="/assets/analytics.js?v=${v}" data-ga4-id="${id}" data-page-lang="${lang}" data-page-type="${pageType}"${promoAttr}></script>`
  ].join("\n");
}

export function renderConsentBanner(config: AppConfig, lang: Lang): string {
  if (!hasValidGa4Id(config.ga4MeasurementId)) return "";
  const de = lang === "de";
  const privacyHref = `/privacy?lang=${lang}`;

  const title = de ? "Datenschutz & Analyse" : "Privacy & Analytics";
  const bodyText = de
    ? "Wir nutzen Google Analytics 4 nur nach deiner ausdrücklichen Zustimmung, um ShopCart zu verbessern — ohne E-Mail-, Zahlungs- oder Warenkorbdaten. Ohne Zustimmung werden keine Google-Skripte geladen und keine Analyse-Cookies gesetzt."
    : "We only use Google Analytics 4 with your explicit consent to improve ShopCart — with zero email, payment, or cart PII. Without consent, no Google scripts are loaded and no analytics cookies are set.";
  const privacyLabel = de ? "Datenschutzerklärung" : "Privacy Policy";
  const essentialLabel = de ? "Nur notwendige" : "Essential only";
  const acceptLabel = de ? "Alle akzeptieren" : "Accept all";
  const closeLabel = de ? "Banner schließen" : "Close banner";

  return `<dialog id="sc-consent-banner" class="sc-consent" aria-labelledby="sc-consent-title" aria-describedby="sc-consent-desc">
  <div class="sc-consent-inner">
    <div class="sc-consent-copy">
      <div class="sc-consent-head">
        <span class="sc-consent-dot" aria-hidden="true"></span>
        <h2 id="sc-consent-title" class="sc-consent-title">${escapeHtml(title)}</h2>
        <button type="button" class="sc-consent-close" data-consent-close aria-label="${escapeHtml(closeLabel)}" hidden>&times;</button>
      </div>
      <p id="sc-consent-desc" class="sc-consent-desc">${escapeHtml(bodyText)} <a class="sc-consent-link" href="${privacyHref}">${escapeHtml(privacyLabel)}</a></p>
    </div>
    <div class="sc-consent-actions">
      <button type="button" class="sc-consent-btn sc-consent-btn-essential" data-consent-action="essential">${escapeHtml(essentialLabel)}</button>
      <button type="button" class="sc-consent-btn sc-consent-btn-accept" data-consent-action="accept">${escapeHtml(acceptLabel)}</button>
    </div>
  </div>
</dialog>`;
}

export function renderCookieSettingsFooterLink(
  config: AppConfig,
  lang: Lang,
  opts?: { separator?: string }
): string {
  if (!hasValidGa4Id(config.ga4MeasurementId)) return "";
  const label = lang === "de" ? "Cookie-Einstellungen" : "Cookie settings";
  const sep = opts?.separator ? escapeHtml(opts.separator) : "";
  return `${sep}<button type="button" class="sc-cookie-settings-btn" data-open-consent-settings>${label}</button>`;
}
