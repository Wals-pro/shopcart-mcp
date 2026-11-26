import net from "node:net";
import type { Request } from "express";
import { z } from "zod";
import type { AdapterRegistry } from "../adapters/registry.js";
import type {
  GetProductResult,
  ProductAvailability,
  StoreDiscountsResult,
  StoreInfo,
  StorePlatform,
  StorePoliciesResult
} from "../adapters/types.js";
import type { Lang } from "../auth/pages.js";
import {
  isSameStoreSite,
  sanitizeText,
  stripHtmlToText
} from "../security/sanitize.js";
import { SsrfError, validateExternalUrl } from "../security/ssrf.js";

export const STORE_CHECK_MAX_BODY_BYTES = 2048;
export const STORE_CHECK_TIMEOUT_MS = 9000;
export const STORE_CHECK_PER_MINUTE_LIMIT = 10;
export const STORE_CHECK_PER_HOUR_LIMIT = 60;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DEFAULT_MAX_RATE_LIMIT_ENTRIES = 5000;
const MAX_DISPLAY_VARIANTS = 12;
const MAX_HINTS = 6;

export const INDEPENDENCE_DISCLAIMER: Record<Lang, string> = {
  de: "Lesender Erstbefund auf Basis öffentlich abrufbarer Daten aus ShopCart-Sicht. Platzierung und Funktion in ShopCart sind vollständig unabhängig von einer Zusammenarbeit.",
  en: "Read-only initial check based on publicly accessible data from ShopCart’s perspective. Listing and behavior in ShopCart are completely independent of any commercial relationship."
};

export type StoreCheckStatus = "ai_ready" | "partially_readable" | "not_publicly_readable";
export type StoreCheckPlatform = StorePlatform | "unknown";
export type CapabilityState = "supported" | "limited" | "unsupported";

export interface StoreCheckCapability {
  key:
    | "product_search"
    | "variants_sizes"
    | "prices_availability"
    | "store_policies"
    | "cart_links"
    | "discount_codes";
  label: string;
  state: CapabilityState;
  stateLabel: string;
  detail: string;
}

export interface StoreCheckVariantSummary {
  title: string;
  price: string;
  compareAtPrice: string | null;
  available: boolean;
  sku: string | null;
}

export interface StoreCheckProductSummary {
  checkedUrl: string;
  ok: boolean;
  errorMessage?: string;
  product?: {
    title: string;
    vendor: string | null;
    price: string | null;
    compareAtPrice: string | null;
    discountPercent: number | null;
    currency: string;
    available: boolean;
    availabilityLabel: string;
    sku: string | null;
    gtin: string | null;
    metadataSource: string | null;
    variantCount: number;
    inStockVariantCount: number;
    variants: StoreCheckVariantSummary[];
  };
}

export interface StoreCheckHint {
  title: string;
  text: string;
}

export interface StoreCheckResult {
  status: StoreCheckStatus;
  statusLabel: string;
  statusSummary: string;
  platform: StoreCheckPlatform;
  platformLabel: string;
  store: {
    origin: string;
    domain: string;
    name: string | null;
    currency: string | null;
    country: string | null;
    wafRestricted: boolean;
    storefrontMcp: boolean;
    storefrontUcp: boolean;
  };
  capabilities: StoreCheckCapability[];
  productCheck: StoreCheckProductSummary | null;
  hints: StoreCheckHint[];
  examplePrompt: {
    heading: string;
    text: string;
  };
  disclaimer: string;
  checkedAt: string;
}

export interface ValidatedStoreCheckInput {
  storeOrigin: string;
  storeDomain: string;
  productUrl: string | null;
  lang: Lang;
}

export type StoreCheckValidationResult =
  | { ok: true; data: ValidatedStoreCheckInput }
  | { ok: false; code: string; field: "storeUrl" | "productUrl" | "body"; message: string };

const rawRequestSchema = z.object({
  storeUrl: z.string().trim().min(1).max(256),
  productUrl: z.string().trim().max(1024).optional(),
  lang: z.enum(["de", "en"]).optional()
});

function sanitizeDisplayText(raw: string | null | undefined, maxLen: number): string {
  if (!raw) return "";
  // Strip any HTML tags first so external strings never carry markup, then normalize whitespace/control chars.
  return sanitizeText(stripHtmlToText(raw, Math.max(maxLen * 2, 256)), maxLen);
}

function sanitizeOptionalDisplayText(raw: string | null | undefined, maxLen: number): string | null {
  const val = sanitizeDisplayText(raw, maxLen);
  return val.length > 0 ? val : null;
}

/**
 * Normalize and strictly validate a user-entered store or product URL.
 * Accepts bare domains (e.g. `snocks.com`) and `http:` / `https:` URLs,
 * upgrades `http:` to `https:` for outbound SSRF-safe requests, and rejects
 * credentials, non-HTTP(S) schemes, non-standard ports, IP literals, and private hosts.
 */
export function normalizeCheckedUrl(
  raw: string,
  opts: { allowPath: boolean }
): { ok: true; url: URL; origin: string; hostname: string } | { ok: false; reason: "invalid_scheme" | "credentials" | "blocked_host" | "invalid_url" } {
  const trimmed = raw.trim();
  if (!trimmed || /[\x00-\x1f\x7f\s]/.test(trimmed)) {
    return { ok: false, reason: "invalid_url" };
  }
  if (trimmed.startsWith("//")) {
    return { ok: false, reason: "invalid_url" };
  }

  let candidate = trimmed;
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase();
    if (scheme !== "https" && scheme !== "http") {
      return { ok: false, reason: "invalid_scheme" };
    }
    if (!trimmed.toLowerCase().startsWith(`${scheme}://`)) {
      return { ok: false, reason: "invalid_url" };
    }
    let parsedInitial: URL;
    try {
      parsedInitial = new URL(trimmed);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    if (parsedInitial.username || parsedInitial.password) {
      return { ok: false, reason: "credentials" };
    }
    if (
      parsedInitial.port !== "" &&
      !(scheme === "https" && parsedInitial.port === "443") &&
      !(scheme === "http" && parsedInitial.port === "80")
    ) {
      return { ok: false, reason: "invalid_url" };
    }
    const normalizedHost = parsedInitial.hostname.toLowerCase().replace(/\.$/, "");
    candidate = opts.allowPath
      ? `https://${normalizedHost}${parsedInitial.pathname}${parsedInitial.search}`
      : `https://${normalizedHost}`;
  } else {
    // Reject bare user:pass@host or embedded credentials before prepending https://
    const authority = trimmed.split(/[/?#]/, 1)[0] ?? "";
    if (authority.includes("@")) {
      return { ok: false, reason: "credentials" };
    }
    if (authority.includes(":")) {
      // Bare host:port or IPv6 literal without scheme
      return { ok: false, reason: "invalid_url" };
    }
    candidate = `https://${trimmed}`;
  }

  try {
    const validated = validateExternalUrl(candidate);
    const hostname = validated.hostname.toLowerCase().replace(/\.$/, "");
    const origin = `https://${hostname}`;
    return {
      ok: true,
      url: opts.allowPath ? validated : new URL(origin),
      origin,
      hostname
    };
  } catch (err) {
    if (err instanceof SsrfError) {
      if (err.code === "BLOCKED_HOST" || err.code === "BLOCKED_IP") {
        return { ok: false, reason: "blocked_host" };
      }
      if (err.message.toLowerCase().includes("credential")) {
        return { ok: false, reason: "credentials" };
      }
    }
    return { ok: false, reason: "invalid_url" };
  }
}

export function validateStoreCheckInput(rawBody: unknown): StoreCheckValidationResult {
  const rawLang: Lang =
    rawBody &&
    typeof rawBody === "object" &&
    (rawBody as Record<string, unknown>).lang === "en"
      ? "en"
      : "de";
  const de = rawLang === "de";

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return {
      ok: false,
      code: "invalid_body",
      field: "body",
      message: de
        ? "Ungültiges Anfrageformat. Bitte eine gültige Shop-URL angeben."
        : "Invalid request payload. Please enter a valid store URL."
    };
  }

  const parsed = rawRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const fieldName = firstIssue?.path[0];
    if (fieldName === "productUrl") {
      return {
        ok: false,
        code: "invalid_product_url",
        field: "productUrl",
        message: de
          ? "Die Produkt-URL ist zu lang oder ungültig (maximal 1024 Zeichen)."
          : "The product URL is too long or invalid (maximum 1024 characters)."
      };
    }
    return {
      ok: false,
      code: "invalid_store_url",
      field: "storeUrl",
      message: de
        ? "Bitte gib eine gültige öffentliche Shop-Domain oder HTTPS-URL ein (z. B. snocks.com)."
        : "Please enter a valid public store domain or HTTPS URL (e.g. snocks.com)."
    };
  }

  const lang: Lang = parsed.data.lang ?? "de";
  const isDe = lang === "de";
  const storeNorm = normalizeCheckedUrl(parsed.data.storeUrl, { allowPath: false });
  if (!storeNorm.ok) {
    const msgMap: Record<typeof storeNorm.reason, string> = {
      invalid_scheme: isDe
        ? "Nur öffentliche http://- oder https://-Shop-URLs sind erlaubt."
        : "Only public http:// or https:// store URLs are allowed.",
      credentials: isDe
        ? "URLs mit Zugangsdaten (Benutzername/Passwort) sind nicht erlaubt."
        : "URLs containing credentials (username/password) are not allowed.",
      blocked_host: isDe
        ? "Lokale, private oder direkte IP-Adressen können nicht geprüft werden."
        : "Local, private, or direct IP addresses cannot be checked.",
      invalid_url: isDe
        ? "Bitte gib eine gültige öffentliche Shop-Domain oder URL ein (z. B. waterdrop.de)."
        : "Please enter a valid public store domain or URL (e.g. waterdrop.de)."
    };
    return {
      ok: false,
      code: storeNorm.reason,
      field: "storeUrl",
      message: msgMap[storeNorm.reason]
    };
  }

  let normalizedProductUrl: string | null = null;
  const rawProductUrl = parsed.data.productUrl?.trim() ?? "";
  if (rawProductUrl.length > 0) {
    const prodNorm = normalizeCheckedUrl(rawProductUrl, { allowPath: true });
    if (!prodNorm.ok) {
      const msgMap: Record<typeof prodNorm.reason, string> = {
        invalid_scheme: isDe
          ? "Die Produkt-URL muss mit http:// oder https:// beginnen."
          : "The product URL must use http:// or https://.",
        credentials: isDe
          ? "Produkt-URLs mit Zugangsdaten sind nicht erlaubt."
          : "Product URLs containing credentials are not allowed.",
        blocked_host: isDe
          ? "Lokale, private oder direkte IP-Adressen sind als Produkt-URL nicht erlaubt."
          : "Local, private, or direct IP addresses are not allowed as a product URL.",
        invalid_url: isDe
          ? "Bitte gib eine vollständige, gültige Produkt-URL desselben Shops ein."
          : "Please enter a complete, valid product URL from the same store."
      };
      return {
        ok: false,
        code: `product_${prodNorm.reason}`,
        field: "productUrl",
        message: msgMap[prodNorm.reason]
      };
    }

    if (!isSameStoreSite(storeNorm.origin, prodNorm.origin)) {
      return {
        ok: false,
        code: "product_url_cross_site",
        field: "productUrl",
        message: isDe
          ? `Die Produkt-URL muss zur selben Shop-Domain (${storeNorm.hostname}) gehören.`
          : `The product URL must belong to the same store domain (${storeNorm.hostname}).`
      };
    }

    normalizedProductUrl = prodNorm.url.toString();
  }

  return {
    ok: true,
    data: {
      storeOrigin: storeNorm.origin,
      storeDomain: storeNorm.hostname,
      productUrl: normalizedProductUrl,
      lang
    }
  };
}

function normalizeIpString(raw: string): string | null {
  let cleaned = raw.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    cleaned = cleaned.slice(1, -1);
  }
  // Normalize IPv4-mapped IPv6 addresses like ::ffff:203.0.113.5
  if (cleaned.toLowerCase().startsWith("::ffff:")) {
    const tail = cleaned.slice(7);
    if (net.isIP(tail) === 4) {
      return tail;
    }
  }
  return net.isIP(cleaned) !== 0 ? cleaned.toLowerCase() : null;
}

/**
 * Cloud-Run-safe client IP extraction.
 * Behind Google Front End / Cloud Run, the real connecting client IP is appended to the RIGHT
 * of X-Forwarded-For (`<client-spoofed>, <real-ip>`). Reading the rightmost trusted hop
 * (default hopCount = 1) prevents attackers from bypassing per-IP rate limits by rotating
 * spoofed leftmost X-Forwarded-For entries.
 */
export function extractTrustedClientIp(req: Request, trustedProxyHops = 1): string {
  const hops = Math.max(1, Math.floor(trustedProxyHops));
  const rawXff = req.headers["x-forwarded-for"];
  const xffString = Array.isArray(rawXff) ? rawXff.join(",") : rawXff;
  if (typeof xffString === "string" && xffString.trim().length > 0) {
    const parts = xffString
      .split(",")
      .map((part) => normalizeIpString(part))
      .filter((ip): ip is string => ip !== null);
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - hops);
      return parts[idx]!;
    }
  }

  const socketIp = req.socket?.remoteAddress ? normalizeIpString(req.socket.remoteAddress) : null;
  return socketIp ?? "unknown";
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  limitType?: "minute" | "hour";
}

interface RateLimitBucket {
  timestamps: number[];
  lastSeen: number;
}

export class StoreCheckRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly maxPerMinute: number;
  private readonly maxPerHour: number;
  private readonly maxEntries: number;
  private readonly nowFn: () => number;

  constructor(opts?: {
    maxPerMinute?: number;
    maxPerHour?: number;
    maxEntries?: number;
    nowFn?: () => number;
  }) {
    this.maxPerMinute = opts?.maxPerMinute ?? STORE_CHECK_PER_MINUTE_LIMIT;
    this.maxPerHour = opts?.maxPerHour ?? STORE_CHECK_PER_HOUR_LIMIT;
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_RATE_LIMIT_ENTRIES;
    this.nowFn = opts?.nowFn ?? (() => Date.now());
  }

  get size(): number {
    return this.buckets.size;
  }

  private pruneAndBound(now: number): void {
    const hourCutoff = now - HOUR_MS;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeen <= hourCutoff) {
        this.buckets.delete(key);
      }
    }
    while (this.buckets.size >= this.maxEntries) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) break;
      this.buckets.delete(oldestKey);
    }
  }

  consume(clientIp: string): RateLimitCheckResult {
    const now = this.nowFn();
    const key = clientIp.trim() || "unknown";
    const hourCutoff = now - HOUR_MS;
    const minuteCutoff = now - MINUTE_MS;

    const existing = this.buckets.get(key);
    let timestamps: number[] = [];
    if (existing) {
      timestamps = existing.timestamps.filter((t) => t > hourCutoff);
      // Refresh LRU insertion order
      this.buckets.delete(key);
    } else if (this.buckets.size >= this.maxEntries) {
      this.pruneAndBound(now);
    }

    const recentMinute = timestamps.filter((t) => t > minuteCutoff);
    if (recentMinute.length >= this.maxPerMinute) {
      this.buckets.set(key, { timestamps, lastSeen: now });
      const oldestMinute = recentMinute[0] ?? now;
      const retryMs = Math.max(1000, oldestMinute + MINUTE_MS - now);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryMs / 1000),
        limitType: "minute"
      };
    }

    if (timestamps.length >= this.maxPerHour) {
      this.buckets.set(key, { timestamps, lastSeen: now });
      const oldestHour = timestamps[0] ?? now;
      const retryMs = Math.max(1000, oldestHour + HOUR_MS - now);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryMs / 1000),
        limitType: "hour"
      };
    }

    timestamps.push(now);
    this.buckets.set(key, { timestamps, lastSeen: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Strict same-origin check for browser POST requests to /api/store-check.
 * Rejects any cross-site or same-site (subdomain) Sec-Fetch-Site header,
 * any mismatching Origin header, and any mismatching Referer origin.
 */
export function isAllowedStoreCheckOrigin(req: Request, appOrigin: string): boolean {
  const expected = appOrigin.trim().replace(/\/+$/, "").toLowerCase();

  const rawSecFetchSite = req.headers["sec-fetch-site"];
  const secFetchSite = (Array.isArray(rawSecFetchSite) ? rawSecFetchSite[0] : rawSecFetchSite)
    ?.trim()
    .toLowerCase();
  if (secFetchSite && secFetchSite !== "same-origin") {
    return false;
  }

  const rawOrigin = req.headers.origin;
  const originHeader = (Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin)?.trim();
  if (originHeader) {
    const normalizedOrigin = originHeader.replace(/\/+$/, "").toLowerCase();
    if (normalizedOrigin === "null") {
      return secFetchSite === "same-origin";
    }
    if (normalizedOrigin !== expected) {
      return false;
    }
  }

  const rawReferer = req.headers.referer;
  const refererHeader = (Array.isArray(rawReferer) ? rawReferer[0] : rawReferer)?.trim();
  if (refererHeader) {
    try {
      const refOrigin = new URL(refererHeader).origin.toLowerCase();
      if (refOrigin !== expected) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export function isJsonContentType(header: string | string[] | undefined): boolean {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return false;
  const mediaType = raw.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

function getPlatformLabel(platform: StoreCheckPlatform, lang: Lang): string {
  switch (platform) {
    case "shopify":
      return "Shopify";
    case "woocommerce":
      return "WooCommerce";
    case "shopware":
      return "Shopware 6";
    case "magento":
      return "Magento 2 / Adobe Commerce";
    case "bigcommerce":
      return "BigCommerce";
    case "amazon":
      return "Amazon";
    case "jsonld":
      return "Schema.org / JSON-LD";
    default:
      return lang === "de" ? "Nicht erkannt" : "Not detected";
  }
}

function getStatusLabel(status: StoreCheckStatus, lang: Lang): string {
  const de = lang === "de";
  if (status === "ai_ready") return "AI-Ready";
  if (status === "partially_readable") return de ? "Eingeschränkt lesbar" : "Partially readable";
  return de ? "Nicht öffentlich lesbar" : "Not publicly readable";
}

function getCapabilityStateLabel(state: CapabilityState, lang: Lang): string {
  const de = lang === "de";
  if (state === "supported") return de ? "Lesbar" : "Readable";
  if (state === "limited") return de ? "Eingeschränkt" : "Limited";
  return de ? "Nicht verfügbar" : "Unavailable";
}

function getAvailabilityLabel(
  available: boolean,
  availability: ProductAvailability | undefined,
  lang: Lang
): string {
  const de = lang === "de";
  if (availability === "PreOrder") return de ? "Vorbestellbar" : "Pre-order";
  if (availability === "LimitedAvailability") return de ? "Begrenzt verfügbar" : "Limited availability";
  if (available || availability === "InStock") return de ? "Verfügbar" : "In stock";
  if (availability === "OutOfStock" || !available) return de ? "Derzeit ausverkauft" : "Currently out of stock";
  return de ? "Unbekannt" : "Unknown";
}

export interface PolicyProbeSummary {
  checked: boolean;
  hasShipping: boolean;
  hasReturns: boolean;
}

export interface DiscountProbeSummary {
  checked: boolean;
  codesFound: number;
  automaticDealsFound: number;
}

export function buildStoreCheckAssessment(params: {
  requestedOrigin: string;
  requestedDomain: string;
  store: StoreInfo | null;
  productUrl: string | null;
  productResult: GetProductResult | null;
  productError: string | null;
  policyProbe: PolicyProbeSummary | null;
  discountProbe: DiscountProbeSummary | null;
  lang: Lang;
  checkedAt?: string;
}): StoreCheckResult {
  const {
    requestedOrigin,
    requestedDomain,
    store,
    productUrl,
    productResult,
    productError,
    policyProbe,
    discountProbe,
    lang
  } = params;
  const de = lang === "de";
  const checkedAt = params.checkedAt ?? new Date().toISOString();

  // Sanitize external store fields
  const platform: StoreCheckPlatform = store ? store.platform : "unknown";
  const canonicalOrigin = store?.origin ?? requestedOrigin;
  let canonicalDomain = requestedDomain;
  try {
    canonicalDomain = new URL(canonicalOrigin).hostname.toLowerCase();
  } catch {
    canonicalDomain = requestedDomain;
  }
  const storeName = sanitizeOptionalDisplayText(store?.name, 100);
  const currency = sanitizeOptionalDisplayText(store?.currency, 12);
  const country = sanitizeOptionalDisplayText(store?.country, 12);
  const wafRestricted = Boolean(store?.wafRestricted);
  const storefrontMcp = Boolean(store?.capabilities?.storefrontMcp);
  const storefrontUcp = Boolean(store?.capabilities?.storefrontUcp);

  // Format optional product check safely
  let productCheck: StoreCheckProductSummary | null = null;
  if (productUrl) {
    if (productResult?.product) {
      const p = productResult.product;
      const safeTitle = sanitizeDisplayText(p.title, 160) || (de ? "Ohne Titel" : "Untitled product");
      const safeVendor = sanitizeOptionalDisplayText(p.vendor, 80);
      const safeSku = sanitizeOptionalDisplayText(p.sku, 64);
      const safeGtin = sanitizeOptionalDisplayText(p.gtin ?? p.ean, 64);
      const safeCurrency = sanitizeDisplayText(productResult.currency || currency || "EUR", 12) || "EUR";
      const firstVariant = p.variants[0];
      const priceFormatted = sanitizeOptionalDisplayText(
        p.price_min?.formatted ?? firstVariant?.price?.formatted,
        40
      );
      const priceMaxFormatted = sanitizeOptionalDisplayText(p.price_max?.formatted, 40);
      const displayPrice =
        priceFormatted && priceMaxFormatted && priceFormatted !== priceMaxFormatted
          ? `${priceFormatted} – ${priceMaxFormatted}`
          : priceFormatted;

      const bestCompareAt = sanitizeOptionalDisplayText(
        firstVariant?.compare_at_price?.formatted,
        40
      );
      const bestDiscount =
        typeof firstVariant?.discount_percent === "number" &&
        Number.isFinite(firstVariant.discount_percent) &&
        firstVariant.discount_percent > 0
          ? Math.round(firstVariant.discount_percent)
          : null;

      const safeVariants: StoreCheckVariantSummary[] = p.variants
        .slice(0, MAX_DISPLAY_VARIANTS)
        .map((v) => ({
          title: sanitizeDisplayText(v.title, 100) || (de ? "Standard" : "Default"),
          price: sanitizeDisplayText(v.price?.formatted, 40),
          compareAtPrice: sanitizeOptionalDisplayText(v.compare_at_price?.formatted, 40),
          available: Boolean(v.available),
          sku: sanitizeOptionalDisplayText(v.sku, 64)
        }));

      const inStockCount = p.variants.filter((v) => v.available).length;

      productCheck = {
        checkedUrl: productUrl,
        ok: true,
        product: {
          title: safeTitle,
          vendor: safeVendor,
          price: displayPrice,
          compareAtPrice: bestCompareAt,
          discountPercent: bestDiscount,
          currency: safeCurrency,
          available: Boolean(p.available),
          availabilityLabel: getAvailabilityLabel(Boolean(p.available), p.availability, lang),
          sku: safeSku,
          gtin: safeGtin,
          metadataSource: p.metadata_source ?? null,
          variantCount: p.variants.length,
          inStockVariantCount: inStockCount,
          variants: safeVariants
        }
      };
    } else {
      productCheck = {
        checkedUrl: productUrl,
        ok: false,
        errorMessage:
          productError ??
          (de
            ? "Für diese Produkt-URL konnten keine öffentlichen Produktdaten (z. B. JSON-LD Product/Offer oder Storefront-API) ausgelesen werden."
            : "No public product data (such as JSON-LD Product/Offer or storefront API data) could be read from this product URL.")
      };
    }
  }

  // Determine overall status
  let status: StoreCheckStatus;
  if (!store) {
    status = "not_publicly_readable";
  } else if (platform === "shopify") {
    status = wafRestricted ? "partially_readable" : "ai_ready";
  } else if (platform === "woocommerce") {
    const canSearch = Boolean(store.capabilities.wooStoreApi) && !wafRestricted;
    status = canSearch ? "ai_ready" : "partially_readable";
  } else if (platform === "bigcommerce") {
    status = wafRestricted ? "partially_readable" : "ai_ready";
  } else if (platform === "shopware") {
    const hasSearch = Boolean(
      store.capabilities.shopwareStoreApi || store.capabilities.shopwareStorefrontSuggest
    );
    status = !wafRestricted && hasSearch ? "ai_ready" : "partially_readable";
  } else if (platform === "magento") {
    status = !wafRestricted && Boolean(store.capabilities.magentoGraphql) ? "ai_ready" : "partially_readable";
  } else if (platform === "amazon") {
    status = "partially_readable";
  } else {
    // Universal JSON-LD
    if (wafRestricted) {
      status = "not_publicly_readable";
    } else {
      status = "partially_readable";
    }
  }

  // Build the 6 capability assessments
  const capabilities = buildCapabilities({
    platform,
    store,
    currency,
    wafRestricted,
    policyProbe,
    discountProbe,
    productCheck,
    lang
  });

  // Build status summary
  const statusSummary = buildStatusSummary({
    platform,
    status,
    wafRestricted,
    canonicalDomain,
    lang
  });

  // Build actionable, factual, non-sales hints
  const hints = buildActionableHints({
    platform,
    store,
    wafRestricted,
    policyProbe,
    productCheck,
    lang
  }).slice(0, MAX_HINTS);

  // Build tailored copyable example prompt
  const examplePrompt = buildExamplePrompt({
    platform,
    canonicalDomain,
    productTitle: productCheck?.ok ? productCheck.product?.title ?? null : null,
    productUrl: productCheck?.ok ? productUrl : null,
    lang
  });

  return {
    status,
    statusLabel: getStatusLabel(status, lang),
    statusSummary,
    platform,
    platformLabel: getPlatformLabel(platform, lang),
    store: {
      origin: canonicalOrigin,
      domain: canonicalDomain,
      name: storeName,
      currency,
      country,
      wafRestricted,
      storefrontMcp,
      storefrontUcp
    },
    capabilities,
    productCheck,
    hints,
    examplePrompt,
    disclaimer: INDEPENDENCE_DISCLAIMER[lang],
    checkedAt
  };
}

function buildStatusSummary(params: {
  platform: StoreCheckPlatform;
  status: StoreCheckStatus;
  wafRestricted: boolean;
  canonicalDomain: string;
  lang: Lang;
}): string {
  const { platform, status, wafRestricted, canonicalDomain, lang } = params;
  const de = lang === "de";

  if (status === "not_publicly_readable") {
    if (wafRestricted) {
      return de
        ? `${canonicalDomain} blockiert automatische Lesezugriffe (z. B. per WAF oder Bot-Challenge). KI-Assistenten können den Shop aktuell nicht zuverlässig auslesen.`
        : `${canonicalDomain} blocks automated read-only requests (e.g. via WAF or bot challenge). AI assistants cannot reliably read this storefront right now.`;
    }
    return de
      ? `${canonicalDomain} war öffentlich nicht erreichbar oder liefert keine auslesbare Storefront-Antwort.`
      : `${canonicalDomain} could not be reached publicly or did not return a readable storefront response.`;
  }

  if (status === "ai_ready") {
    if (platform === "shopify") {
      return de
        ? `Öffentlicher Shopify-Shop erkannt: Claude, ChatGPT, Gemini & Instinct können Produkte suchen, Varianten/Bestand prüfen und direkte Warenkorb-Links erstellen.`
        : `Public Shopify storefront detected: Claude, ChatGPT, Gemini & Instinct can search products, verify variants/stock, and build direct cart links.`;
    }
    if (platform === "woocommerce") {
      return de
        ? `Öffentliche WooCommerce Store API erkannt: KI-Assistenten können Katalog, Varianten, Preise und Lagerbestand live lesen und Add-to-Cart-Links je Artikel erzeugen.`
        : `Public WooCommerce Store API detected: AI assistants can read catalog, variants, prices, and stock live and generate per-item add-to-cart links.`;
    }
    if (platform === "bigcommerce") {
      return de
        ? `Öffentlicher BigCommerce-Shop erkannt: Produktsuche, Live-Preise, Varianten und Add-to-Cart-Links je Produkt sind öffentlich lesbar.`
        : `Public BigCommerce storefront detected: product search, live prices, variants, and per-product add-to-cart links are publicly readable.`;
    }
    if (platform === "shopware") {
      return de
        ? `Öffentlicher Shopware-6-Shop erkannt: Produktsuche, Varianten, Live-Preise und direkte Produktlinks funktionieren öffentlich lesend.`
        : `Public Shopware 6 storefront detected: product search, variants, live prices, and verified direct product links work read-only.`;
    }
    if (platform === "magento") {
      return de
        ? `Öffentliche Magento-2-GraphQL-Storefront erkannt: Produktsuche, Varianten, Preise, Bestand und direkte Produktlinks sind öffentlich lesbar.`
        : `Public Magento 2 GraphQL storefront detected: product search, variants, prices, stock, and verified direct product links are publicly readable.`;
    }
  }

  // partially_readable
  if (platform === "shopify" && wafRestricted) {
    return de
      ? `Shopify-Shop erkannt, aber einzelne Endpunkte (/meta.json oder /products.json) sind per WAF eingeschränkt. Stichwortsuche, Produktdetails und Warenkorb-Links bleiben meist nutzbar.`
      : `Shopify storefront detected, but some endpoints (/meta.json or /products.json) are WAF-restricted. Keyword search, product details, and cart links usually remain usable.`;
  }
  if (platform === "amazon") {
    return de
      ? `Amazon-Marktplatz erkannt: Offizielle Multi-Artikel-Warenkorb-Links per ASIN funktionieren; Live-Katalogsuche erfordert im Self-Hosting eigene API-Zugangsdaten.`
      : `Amazon marketplace detected: official multi-item cart links by ASIN work; live catalog search requires your own API credentials when self-hosting.`;
  }
  if (platform === "jsonld") {
    return de
      ? `Kein direkt angebundenes Shop-System erkannt — ShopCart prüft Produktseiten per Schema.org/JSON-LD (Preis, Verfügbarkeit, EAN) bei Angabe einer konkreten Produkt-URL.`
      : `No native storefront API detected — ShopCart verifies individual product pages via Schema.org/JSON-LD (price, availability, EAN) when given a direct product URL.`;
  }

  return de
    ? `Shop erkannt, aber einzelne öffentliche Storefront-Endpunkte sind eingeschränkt oder per WAF geschützt.`
    : `Storefront detected, but some public storefront endpoints are restricted or protected by a WAF.`;
}

function buildCapabilities(params: {
  platform: StoreCheckPlatform;
  store: StoreInfo | null;
  currency: string | null;
  wafRestricted: boolean;
  policyProbe: PolicyProbeSummary | null;
  discountProbe: DiscountProbeSummary | null;
  productCheck: StoreCheckProductSummary | null;
  lang: Lang;
}): StoreCheckCapability[] {
  const { platform, store, currency, wafRestricted, policyProbe, discountProbe, productCheck, lang } = params;
  const de = lang === "de";
  const make = (
    key: StoreCheckCapability["key"],
    labelDe: string,
    labelEn: string,
    state: CapabilityState,
    detailDe: string,
    detailEn: string
  ): StoreCheckCapability => ({
    key,
    label: de ? labelDe : labelEn,
    state,
    stateLabel: getCapabilityStateLabel(state, lang),
    detail: de ? detailDe : detailEn
  });

  if (!store || (platform === "jsonld" && wafRestricted)) {
    return [
      make(
        "product_search",
        "Produktsuche",
        "Product search",
        "unsupported",
        "Keine öffentliche Katalogsuche erreichbar.",
        "No public catalog search reachable."
      ),
      make(
        "variants_sizes",
        "Varianten & Größen",
        "Variants & sizes",
        "unsupported",
        "Varianten konnten öffentlich nicht ausgelesen werden.",
        "Variants could not be read publicly."
      ),
      make(
        "prices_availability",
        "Preise & Verfügbarkeit",
        "Prices & availability",
        "unsupported",
        "Preise und Lagerstatus konnten nicht öffentlich abgerufen werden.",
        "Prices and stock status could not be fetched publicly."
      ),
      make(
        "store_policies",
        "Versand & Rückgabe",
        "Shipping & returns",
        "unsupported",
        "Keine öffentlichen Policy-Endpunkte erkannt.",
        "No public policy endpoints detected."
      ),
      make(
        "cart_links",
        "Direkte Warenkorb-Links",
        "Direct cart links",
        "unsupported",
        "Kein automatischer Warenkorb-Link verfügbar.",
        "No automatic cart link available."
      ),
      make(
        "discount_codes",
        "Automatische Rabattcodes",
        "Automatic discount codes",
        "unsupported",
        "Keine öffentliche Rabattcode-Erkennung verfügbar.",
        "No public discount code detection available."
      )
    ];
  }

  // 1. Product search
  let searchState: CapabilityState = "unsupported";
  let searchDe = "Keine öffentliche Katalogsuche (nur Direktprüfung per Produkt-URL).";
  let searchEn = "No public catalog search (direct verification via product URL only).";
  if (platform === "shopify") {
    if (wafRestricted) {
      searchState = "limited";
      searchDe = "Stichwortsuche (/search/suggest.json) verfügbar; offenes Katalog-Browsing per WAF eingeschränkt.";
      searchEn = "Keyword search (/search/suggest.json) available; open catalog browsing is WAF-restricted.";
    } else {
      searchState = "supported";
      searchDe = store.capabilities.storefrontMcp
        ? "Vollständige Katalogsuche inkl. Sale-/Kollektionsfilter & nativem Storefront MCP."
        : "Vollständige öffentliche Katalogsuche inkl. Preis-, Bestands- & Kollektionsfilter.";
      searchEn = store.capabilities.storefrontMcp
        ? "Full catalog search including sale/collection filters & native Storefront MCP."
        : "Full public catalog search including price, stock & collection filters.";
    }
  } else if (platform === "woocommerce") {
    if (store.capabilities.wooStoreApi && !wafRestricted) {
      searchState = "supported";
      searchDe = "Öffentliche WooCommerce Store API v1 für Live-Katalogsuche aktiv.";
      searchEn = "Public WooCommerce Store API v1 active for live catalog search.";
    } else {
      searchState = "limited";
      searchDe = "Store API eingeschränkt — direkte Produkt- oder Varianten-IDs weiterhin nutzbar.";
      searchEn = "Store API restricted — direct product or variation IDs may still work.";
    }
  } else if (platform === "bigcommerce") {
    searchState = wafRestricted ? "limited" : "supported";
    searchDe = wafRestricted
      ? "Katalogseiten teils durch WAF eingeschränkt."
      : "Öffentliche Storefront-Suche verfügbar.";
    searchEn = wafRestricted
      ? "Catalog pages partially restricted by WAF."
      : "Public storefront search available.";
  } else if (platform === "shopware") {
    const hasSwSearch = Boolean(
      store.capabilities.shopwareStoreApi || store.capabilities.shopwareStorefrontSuggest
    );
    searchState = !wafRestricted && hasSwSearch ? "supported" : "limited";
    searchDe =
      searchState === "supported"
        ? "Öffentliche Shopware-6-Suche (Store API / Suggest) lesbar."
        : "Shopware-Suchendpunkt per WAF oder Authentifizierung eingeschränkt.";
    searchEn =
      searchState === "supported"
        ? "Public Shopware 6 search (Store API / suggest) readable."
        : "Shopware search endpoint restricted by WAF or authentication.";
  } else if (platform === "magento") {
    searchState = !wafRestricted && store.capabilities.magentoGraphql ? "supported" : "limited";
    searchDe =
      searchState === "supported"
        ? "Öffentliche lesende Magento-2-GraphQL-Produktsuche verfügbar."
        : "Magento-GraphQL-Endpunkt eingeschränkt oder nicht öffentlich erreichbar.";
    searchEn =
      searchState === "supported"
        ? "Public read-only Magento 2 GraphQL product search available."
        : "Magento GraphQL endpoint restricted or not publicly reachable.";
  } else if (platform === "amazon") {
    searchState = store.capabilities.liveSearch ? "supported" : "limited";
    searchDe = store.capabilities.liveSearch
      ? "Live-Suche über konfigurierte API-Anbindung aktiv."
      : "Keine gehostete Live-Suche; ASINs oder Produkt-URLs können direkt übergeben werden.";
    searchEn = store.capabilities.liveSearch
      ? "Live search active via configured API integration."
      : "No hosted live search; ASINs or product URLs can be passed directly.";
  }

  // 2. Variants / sizes
  let variantsState: CapabilityState = "limited";
  let variantsDe = "Abhängig von strukturierten Angebotsdaten auf der Produktseite.";
  let variantsEn = "Depends on structured offer data on individual product pages.";
  if (platform === "shopify" || platform === "woocommerce" || platform === "bigcommerce" || platform === "shopware" || platform === "magento") {
    variantsState = wafRestricted ? "limited" : "supported";
    variantsDe =
      variantsState === "supported"
        ? "Größen, Farben, Optionen und Varianten-IDs sind live auslesbar."
        : "Per direkter Produkt-URL meist auslesbar, Katalogabruf teils eingeschränkt.";
    variantsEn =
      variantsState === "supported"
        ? "Sizes, colors, options, and variant IDs can be read live."
        : "Usually readable via direct product URL; catalog discovery partially restricted.";
  } else if (platform === "amazon") {
    variantsState = "limited";
    variantsDe = "Je ASIN eindeutig identifizierbar; Variantenwechsel erfolgt über Produkt-URLs.";
    variantsEn = "Identified per ASIN; variant selection relies on specific product URLs.";
  } else if (platform === "jsonld") {
    if (productCheck?.ok && (productCheck.product?.variantCount ?? 0) > 1) {
      variantsState = "supported";
      variantsDe = `Im Produkt-Check wurden ${productCheck.product!.variantCount} Varianten über Schema.org/JSON-LD erkannt.`;
      variantsEn = `${productCheck.product!.variantCount} variants were detected via Schema.org/JSON-LD in the product check.`;
    } else {
      variantsState = "limited";
      variantsDe = "Auslesbar, sofern Produktseiten Schema.org ProductGroup/hasVariant-Daten enthalten.";
      variantsEn = "Readable when product pages expose Schema.org ProductGroup/hasVariant data.";
    }
  }

  // 3. Prices & availability
  let priceState: CapabilityState = "limited";
  let priceDe = "Per Produkt-URL über Schema.org/JSON-LD prüfbar (sofern gepflegt).";
  let priceEn = "Verifiable per product URL via Schema.org/JSON-LD (when present).";
  if (platform === "shopify" || platform === "woocommerce" || platform === "bigcommerce" || platform === "shopware" || platform === "magento") {
    priceState = wafRestricted ? "limited" : "supported";
    priceDe =
      priceState === "supported"
        ? `Live-Preise${currency ? ` (${currency})` : ""}, Streichpreise und Verfügbarkeit sind direkt lesbar.`
        : "Preise und Bestand sind bei direkter Produktabfrage meist lesbar, teils WAF-geschützt.";
    priceEn =
      priceState === "supported"
        ? `Live prices${currency ? ` (${currency})` : ""}, compare-at prices, and stock availability are directly readable.`
        : "Prices and stock are usually readable on direct product lookup, partially WAF-protected.";
  } else if (platform === "amazon") {
    priceState = store.capabilities.liveSearch ? "supported" : "limited";
    priceDe = store.capabilities.liveSearch
      ? "Live-Preise & Verfügbarkeit per API abrufbar."
      : "Endpreis und Verfügbarkeit werden direkt auf der Amazon-Bestätigungsseite geprüft.";
    priceEn = store.capabilities.liveSearch
      ? "Live prices & availability available via API."
      : "Final price and availability are confirmed directly on Amazon's confirmation page.";
  } else if (platform === "jsonld") {
    if (productCheck?.ok && productCheck.product?.price) {
      priceState = "supported";
      priceDe = `Live-Preis (${productCheck.product.price}) und Verfügbarkeit über JSON-LD bestätigt.`;
      priceEn = `Live price (${productCheck.product.price}) and availability confirmed via JSON-LD.`;
    } else if (productCheck && !productCheck.ok) {
      priceState = "unsupported";
      priceDe = "Auf der geprüften Produktseite wurden keine lesbaren JSON-LD Preis-/Angebotsdaten gefunden.";
      priceEn = "No readable JSON-LD price/offer data was found on the checked product page.";
    }
  }

  // 4. Store policies (shipping / returns)
  let policiesState: CapabilityState = "unsupported";
  let policiesDe = "Automatische Policy-Auswertung wird aktuell primär für Shopify unterstützt.";
  let policiesEn = "Automated policy extraction is currently supported primarily for Shopify.";
  if (platform === "shopify") {
    if (policyProbe?.checked) {
      if (policyProbe.hasShipping && policyProbe.hasReturns) {
        policiesState = "supported";
        policiesDe = "Versand- und Rückgaberegeln sind unter /policies öffentlich auslesbar.";
        policiesEn = "Shipping and return policies are publicly readable under /policies.";
      } else if (policyProbe.hasShipping || policyProbe.hasReturns) {
        policiesState = "limited";
        policiesDe = policyProbe.hasShipping
          ? "Versandregeln lesbar; Rückgabe-/Widerrufsseite unter /policies fehlt oder ist leer."
          : "Rückgaberegeln lesbar; Versandseite unter /policies fehlt oder ist leer.";
        policiesEn = policyProbe.hasShipping
          ? "Shipping policy readable; returns/refund policy under /policies is missing or empty."
          : "Return policy readable; shipping policy under /policies is missing or empty.";
      } else {
        policiesState = "limited";
        policiesDe = "Keine Standard-Policies unter /policies gefunden (ggf. unter eigenen CMS-Seiten hinterlegt).";
        policiesEn = "No standard policies found under /policies (may be hosted on custom pages).";
      }
    } else {
      policiesState = wafRestricted ? "limited" : "supported";
      policiesDe = "Versand- & Rückgaberegeln können über /policies und Storefront MCP gelesen werden.";
      policiesEn = "Shipping & return policies can be read via /policies and Storefront MCP.";
    }
  }

  // 5. Direct cart links (/cart/...)
  let cartState: CapabilityState = "unsupported";
  let cartDe = "Verifizierte direkte Produktlinks (kein Mehrartikel-Warenkorb-Link durch das Shop-System).";
  let cartEn = "Verified direct product links (multi-item cart permalink not supported by this platform).";
  if (platform === "shopify") {
    cartState = "supported";
    cartDe = "Ein direkter Warenkorb-Link (/cart/...) für bis zu 20 Positionen auf einmal.";
    cartEn = "One direct cart link (/cart/...) for up to 20 line items at once.";
  } else if (platform === "amazon") {
    cartState = "supported";
    cartDe = "Offizieller Multi-Artikel-Bestätigungslink (/gp/aws/cart/add.html).";
    cartEn = "Official multi-item confirmation link (/gp/aws/cart/add.html).";
  } else if (platform === "woocommerce") {
    cartState = "limited";
    cartDe = "Add-to-Cart-Link pro Artikel (?add-to-cart=...) — bei mehreren Artikeln nacheinander anklickbar.";
    cartEn = "One add-to-cart link per item (?add-to-cart=...) — clicked sequentially for multiple items.";
  } else if (platform === "bigcommerce") {
    cartState = "limited";
    cartDe = "Add-to-Cart-Link pro Produkt (/cart.php?action=add) — bei mehreren Produkten je ein Link.";
    cartEn = "One add-to-cart link per product (/cart.php?action=add) — one link per item.";
  } else if (platform === "shopware" || platform === "magento" || platform === "jsonld") {
    cartState = "limited";
    cartDe = "Geprüfte direkte Produktlinks (Warenkorb erfordert eine Browser-Session im Shop).";
    cartEn = "Verified direct product links (cart addition requires a browser session in the store).";
  }

  // 6. Automatic discount codes
  let discountState: CapabilityState = "unsupported";
  let discountDe = "Automatische Gutschein-Erkennung & URL-Übergabe wird aktuell für Shopify unterstützt.";
  let discountEn = "Automatic promo code discovery & URL attachment is currently supported for Shopify.";
  if (platform === "shopify") {
    if (discountProbe?.checked) {
      if (discountProbe.codesFound > 0) {
        discountState = "supported";
        discountDe = `${discountProbe.codesFound} öffentlich beworbene(r) Rabattcode(s) erkannt — per Warenkorb-Link automatisch anhängbar.`;
        discountEn = `${discountProbe.codesFound} publicly advertised discount code(s) detected — automatically attachable to cart links.`;
      } else if (discountProbe.automaticDealsFound > 0) {
        discountState = "supported";
        discountDe = "Automatische Checkout-Aktion erkannt; öffentliche Rabattcodes werden bei Bedarf automatisch angehängt.";
        discountEn = "Automatic checkout promotion detected; public promo codes are attached automatically when available.";
      } else {
        discountState = "supported";
        discountDe = "Unterstützt: öffentlich beworbene Codes auf der Startseite oder in Sale-Kollektionen werden automatisch erkannt.";
        discountEn = "Supported: publicly advertised codes on the homepage or deal collections are detected automatically.";
      }
    } else {
      discountState = "supported";
      discountDe = "Öffentlich beworbene Rabattcodes können erkannt und direkt an den /cart/-Link übergeben werden.";
      discountEn = "Publicly advertised discount codes can be detected and passed directly via the /cart/ link.";
    }
  }

  return [
    make("product_search", "Produktsuche", "Product search", searchState, searchDe, searchEn),
    make("variants_sizes", "Varianten & Größen", "Variants & sizes", variantsState, variantsDe, variantsEn),
    make("prices_availability", "Preise & Verfügbarkeit", "Prices & availability", priceState, priceDe, priceEn),
    make("store_policies", "Versand & Rückgabe", "Shipping & returns", policiesState, policiesDe, policiesEn),
    make("cart_links", "Direkte Warenkorb-Links", "Direct cart links", cartState, cartDe, cartEn),
    make("discount_codes", "Automatische Rabattcodes", "Automatic discount codes", discountState, discountDe, discountEn)
  ];
}

function buildActionableHints(params: {
  platform: StoreCheckPlatform;
  store: StoreInfo | null;
  wafRestricted: boolean;
  policyProbe: PolicyProbeSummary | null;
  productCheck: StoreCheckProductSummary | null;
  lang: Lang;
}): StoreCheckHint[] {
  const { platform, store, wafRestricted, policyProbe, productCheck, lang } = params;
  const de = lang === "de";
  const hints: StoreCheckHint[] = [];

  if (!store) {
    hints.push({
      title: de ? "Storefront öffentlich erreichbar machen" : "Ensure public storefront reachability",
      text: de
        ? "Prüfe, ob die Domain ohne Login/Passwortschutz über HTTPS (Port 443) erreichbar ist und nicht alle automatisierten Lesezugriffe blockiert."
        : "Check whether the domain is reachable over HTTPS (port 443) without a storefront password and does not block all automated read-only requests."
    });
    return hints;
  }

  if (wafRestricted) {
    hints.push({
      title: de ? "WAF / Bot-Schutz schränkt öffentliche Katalog-Endpunkte ein" : "WAF / bot protection restricts public catalog endpoints",
      text:
        platform === "shopify"
          ? de
            ? "Öffentliche Lese-Endpunkte wie /meta.json oder /products.json liefern eine Sperrseite. Falls KI-Shopping-Assistenten deinen Katalog vollständiger lesen sollen, prüfe deine Firewall-/Bot-Regeln für lesende GET-Anfragen."
            : "Public read endpoints like /meta.json or /products.json returned a blocked response. If you want AI shopping assistants to read your catalog more reliably, review WAF/bot rules for read-only GET requests."
          : de
            ? "Der Shop antwortet auf öffentliche Leseabrufe mit einer WAF- oder Bot-Challenge (HTTP 403/429/503). Lesende Produktabfragen durch KI-Assistenten schlagen dadurch oft fehl."
            : "The store responds to public read requests with a WAF or bot challenge (HTTP 403/429/503), which often prevents AI assistants from verifying prices and stock."
    });
  }

  if (platform === "shopify" && policyProbe?.checked && (!policyProbe.hasShipping || !policyProbe.hasReturns)) {
    const missingLabel = !policyProbe.hasShipping && !policyProbe.hasReturns
      ? de
        ? "Versand- und Rückgaberegeln"
        : "shipping and return policies"
      : !policyProbe.hasShipping
        ? de
          ? "Versandregeln (/policies/shipping-policy)"
          : "shipping policy (/policies/shipping-policy)"
        : de
          ? "Rückgabe- und Widerrufsregeln (/policies/refund-policy)"
          : "return/refund policy (/policies/refund-policy)";
    hints.push({
      title: de ? "Shopify-Standard-Policies ergänzen" : "Publish standard Shopify policy pages",
      text: de
        ? `Unter den Standard-Shopify-Pfaden fehlen öffentlich lesbare ${missingLabel}. Wenn sie in den Shopify-Einstellungen unter „Richtlinien“ gepflegt sind, können KI-Assistenten Versandkosten und Rückgabefristen direkt vor dem Checkout beantworten.`
        : `Publicly readable ${missingLabel} were not found on the standard Shopify policy paths. Publishing them under Shopify Settings → Policies lets AI assistants answer shipping and return questions accurately before checkout.`
    });
  }

  if (platform === "jsonld") {
    hints.push({
      title: de ? "Strukturierte Schema.org/JSON-LD Produktdaten pflegen" : "Maintain structured Schema.org/JSON-LD product data",
      text: de
        ? "Für Shops außerhalb direkt angebundener Plattformen lesen KI-Assistenten Preis, Währung, Lagerstatus, SKU/GTIN und Varianten aus <script type=\"application/ld+json\"> (Schema.org Product / ProductGroup + Offer). Teste am besten eine konkrete Produkt-URL im optionalen Feld oben."
        : "For stores outside natively connected platforms, AI assistants read price, currency, stock availability, SKU/GTIN, and variants from <script type=\"application/ld+json\"> (Schema.org Product / ProductGroup + Offer). Test a concrete product URL in the optional field above."
    });
  }

  if (productCheck && !productCheck.ok) {
    hints.push({
      title: de ? "Produktseite liefert keine auslesbaren Strukturdaten" : "Product page returned no readable structured data",
      text: de
        ? "Auf der angegebenen Produkt-URL fehlten öffentliche Product-/Offer-Daten (Preis, Währung, Verfügbarkeit) oder der Abruf wurde blockiert. Prüfe, ob Schema.org Product-JSON-LD im initialen Server-HTML (ohne Client-JS) ausgeliefert wird."
        : "The supplied product URL did not expose readable Product/Offer data (price, currency, availability) or blocked the request. Ensure Schema.org Product JSON-LD is rendered in the initial server HTML (without requiring client-side JS)."
    });
  }

  if (productCheck?.ok && productCheck.product && !productCheck.product.gtin) {
    hints.push({
      title: de ? "GTIN / EAN im Produkt-Schema ergänzen" : "Include GTIN / EAN in product metadata",
      text: de
        ? "Auf der geprüften Produktseite wurde keine GTIN/EAN gefunden. Eine saubere GTIN/EAN im Schema.org-Markup hilft KI-Assistenten beim eindeutigen Produktabgleich."
        : "No GTIN/EAN was found on the checked product page. Adding a clean GTIN/EAN in Schema.org markup helps AI assistants match products unambiguously."
    });
  }

  if (platform === "woocommerce" && !store.capabilities.wooStoreApi) {
    hints.push({
      title: de ? "WooCommerce Store API v1 öffentlich lesbar halten" : "Keep WooCommerce Store API v1 publicly readable",
      text: de
        ? "Der Endpunkt /wp-json/wc/store/v1/products war nicht öffentlich lesbar. Sicherheits-Plugins deaktivieren manchmal pauschal die REST-API — für KI-Suche reicht lesender Zugriff auf die öffentliche Store API."
        : "The /wp-json/wc/store/v1/products endpoint was not publicly readable. Security plugins sometimes block the entire REST API — read-only access to the public Store API is sufficient for AI search."
    });
  }

  if (platform === "shopware" || platform === "magento") {
    hints.push({
      title: de ? "Übergabe per geprüften Produktlinks" : "Handoff via verified product links",
      text: de
        ? `${getPlatformLabel(platform, lang)} bindet Warenkörbe an eine Browser-Session. KI-Assistenten können Produkte, Preise und Varianten live prüfen und verlinken direkt auf die passende Produktseite.`
        : `${getPlatformLabel(platform, lang)} ties carts to a browser session. AI assistants verify products, prices, and variants live and hand off directly to the matching product page.`
    });
  }

  if (platform === "shopify" && !store.capabilities.storefrontMcp && !wafRestricted) {
    hints.push({
      title: de ? "Optional: Natives Shopify Storefront MCP prüfen" : "Optional: Check native Shopify Storefront MCP",
      text: de
        ? "Dein Shop funktioniert bereits vollständig über ShopCart. Zusätzlich stellt Shopify auf vielen Shops einen nativen /api/mcp-Endpunkt bereit, der Shop-FAQs und Richtlinien strukturiert beantworten kann."
        : "Your store already works cleanly via ShopCart. Shopify also offers a native /api/mcp endpoint on many storefronts that can answer store FAQs and policy questions."
    });
  }

  return hints;
}

function buildExamplePrompt(params: {
  platform: StoreCheckPlatform;
  canonicalDomain: string;
  productTitle: string | null;
  productUrl: string | null;
  lang: Lang;
}): { heading: string; text: string } {
  const { platform, canonicalDomain, productTitle, productUrl, lang } = params;
  const de = lang === "de";
  const heading = de
    ? "Teste deinen Shop jetzt in Claude / ChatGPT / Gemini"
    : "Test your store now in Claude / ChatGPT / Gemini";

  if (productTitle && productUrl) {
    const text = de
      ? `Nutze ShopCart MCP (https://shopcart.wals.pro/mcp): Prüfe auf ${canonicalDomain} das Produkt „${productTitle}“ (${productUrl}) auf Live-Preis, verfügbare Varianten/Größen und Versandregeln und gib mir den passenden Warenkorb- bzw. Produktlink.`
      : `Use ShopCart MCP (https://shopcart.wals.pro/mcp): Check "${productTitle}" (${productUrl}) on ${canonicalDomain} for live price, available variants/sizes, and shipping terms, and return the verified cart or product link.`;
    return { heading, text };
  }

  if (platform === "shopify") {
    const text = de
      ? `Nutze ShopCart MCP (https://shopcart.wals.pro/mcp): Durchsuche ${canonicalDomain} nach aktuellen Bestsellern oder Angeboten, prüfe verfügbare Varianten und Versandregeln und bau mir einen fertigen Warenkorb-Link für 1 Artikel meiner Wahl.`
      : `Use ShopCart MCP (https://shopcart.wals.pro/mcp): Search ${canonicalDomain} for current bestsellers or deals, verify available variants and shipping policies, and build me a ready-to-review cart link for 1 item of my choice.`;
    return { heading, text };
  }

  if (platform === "woocommerce" || platform === "bigcommerce") {
    const text = de
      ? `Nutze ShopCart MCP (https://shopcart.wals.pro/mcp): Suche auf ${canonicalDomain} nach lieferbaren Produkten, prüfe Live-Preise und Varianten und gib mir den geprüften Warenkorb-Link.`
      : `Use ShopCart MCP (https://shopcart.wals.pro/mcp): Search ${canonicalDomain} for in-stock products, verify live prices and variants, and give me the verified add-to-cart link.`;
    return { heading, text };
  }

  if (platform === "amazon") {
    const text = de
      ? `Nutze ShopCart MCP (https://shopcart.wals.pro/mcp): Erstelle mir aus meinen Wunsch-ASINs auf ${canonicalDomain} einen offiziellen Multi-Artikel-Warenkorb-Link zum Prüfen im Browser.`
      : `Use ShopCart MCP (https://shopcart.wals.pro/mcp): Build an official multi-item cart link on ${canonicalDomain} from my chosen ASINs so I can review and check out in my browser.`;
    return { heading, text };
  }

  const text = de
    ? `Nutze ShopCart MCP (https://shopcart.wals.pro/mcp): Prüfe ${canonicalDomain} mit inspect_store und verifiziere mir für eine konkrete Produkt-URL Live-Preis, Verfügbarkeit und Varianten.`
    : `Use ShopCart MCP (https://shopcart.wals.pro/mcp): Inspect ${canonicalDomain} with inspect_store and verify live price, stock availability, and variants for a concrete product URL.`;
  return { heading, text };
}

export class StoreCheckTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Store check timed out after ${timeoutMs}ms`);
    this.name = "StoreCheckTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    throw new StoreCheckTimeoutError(0);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new StoreCheckTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

const HARD_SSRF_CODES = new Set(["INVALID_URL", "BLOCKED_HOST", "BLOCKED_IP"]);

function isHardSsrfError(err: unknown): err is SsrfError {
  return err instanceof SsrfError && HARD_SSRF_CODES.has(err.code);
}

export interface RunStoreCheckOptions {
  registry: AdapterRegistry;
  input: ValidatedStoreCheckInput;
  concurrencyKey: string;
  timeoutMs?: number;
}

export async function runStoreCheck(opts: RunStoreCheckOptions): Promise<StoreCheckResult> {
  const totalTimeoutMs = opts.timeoutMs ?? STORE_CHECK_TIMEOUT_MS;
  const deadline = Date.now() + totalTimeoutMs;
  const { registry, input, concurrencyKey } = opts;

  const work = async (): Promise<StoreCheckResult> => {
    const remainingForResolve = Math.max(100, deadline - Date.now());
    const { adapter, store } = await withTimeout(
      registry.resolve(input.storeOrigin, concurrencyKey),
      remainingForResolve
    );

    if (!store) {
      return buildStoreCheckAssessment({
        requestedOrigin: input.storeOrigin,
        requestedDomain: input.storeDomain,
        store: null,
        productUrl: input.productUrl,
        productResult: null,
        productError: input.productUrl
          ? input.lang === "de"
            ? "Produkt-Check übersprungen, da der Shop öffentlich nicht erreichbar war."
            : "Product check skipped because the store was not publicly reachable."
          : null,
        policyProbe: null,
        discountProbe: null,
        lang: input.lang
      });
    }

    const effectiveOrigin = isSameStoreSite(input.storeOrigin, store.origin)
      ? store.origin
      : input.storeOrigin;

    const remainingMs = deadline - Date.now();
    let productResult: GetProductResult | null = null;
    let productError: string | null = null;
    let policyProbe: PolicyProbeSummary | null = null;
    let discountProbe: DiscountProbeSummary | null = null;

    if (remainingMs > 400) {
      const secondaryTimeout = Math.min(remainingMs - 150, 3500);
      const tasks: Array<Promise<void>> = [];

      if (input.productUrl) {
        tasks.push(
          (async () => {
            try {
              productResult = await withTimeout(
                adapter.getProduct(effectiveOrigin, input.productUrl!, {
                  currencyHint: store.currency,
                  concurrencyKey
                }),
                Math.min(remainingMs - 100, 4500)
              );
            } catch (err) {
              if (isHardSsrfError(err)) throw err;
              if (err instanceof StoreCheckTimeoutError || (err instanceof SsrfError && err.code === "TIMEOUT")) {
                productError =
                  input.lang === "de"
                    ? "Zeitüberschreitung beim Abrufen der Produktseite."
                    : "Timed out while fetching the product page.";
              } else {
                productError =
                  input.lang === "de"
                    ? "Die Produktseite konnte nicht ausgelesen werden (keine öffentlichen Produktdaten oder Zugriff blockiert)."
                    : "The product page could not be read (no public product data or access blocked).";
              }
            }
          })()
        );
      }

      if (store.platform === "shopify" && !store.wafRestricted) {
        if (adapter.getStorePolicies) {
          tasks.push(
            (async () => {
              try {
                const pol: StorePoliciesResult = await withTimeout(
                  adapter.getStorePolicies!(effectiveOrigin, { topic: "all", concurrencyKey }),
                  Math.min(secondaryTimeout, 2500)
                );
                policyProbe = {
                  checked: true,
                  hasShipping: Boolean(pol.shipping_policy_excerpt),
                  hasReturns: Boolean(pol.return_policy_excerpt)
                };
              } catch (err) {
                if (isHardSsrfError(err)) throw err;
                policyProbe = null;
              }
            })()
          );
        }

        if (adapter.findStoreDiscounts) {
          tasks.push(
            (async () => {
              try {
                const disc: StoreDiscountsResult = await withTimeout(
                  adapter.findStoreDiscounts!(effectiveOrigin, {
                    fastMode: true,
                    timeoutMs: Math.min(secondaryTimeout, 2000),
                    concurrencyKey
                  }),
                  Math.min(secondaryTimeout, 2500)
                );
                discountProbe = {
                  checked: true,
                  codesFound: disc.codes.length,
                  automaticDealsFound: disc.automatic_deals.length
                };
              } catch (err) {
                if (isHardSsrfError(err)) throw err;
                discountProbe = null;
              }
            })()
          );
        }
      }

      if (tasks.length > 0) {
        const results = await Promise.allSettled(tasks);
        for (const r of results) {
          if (r.status === "rejected" && isHardSsrfError(r.reason)) {
            throw r.reason;
          }
        }
      }
    }

    return buildStoreCheckAssessment({
      requestedOrigin: input.storeOrigin,
      requestedDomain: input.storeDomain,
      store,
      productUrl: input.productUrl,
      productResult,
      productError,
      policyProbe,
      discountProbe,
      lang: input.lang
    });
  };

  return withTimeout(work(), totalTimeoutMs);
}
