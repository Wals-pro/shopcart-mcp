import { sanitizeOptionalText, sanitizeText, stripHtmlToText } from "../../security/sanitize.js";
import type { Money } from "../types.js";

export interface WooPricesRaw {
  price?: string | number | null;
  regular_price?: string | number | null;
  sale_price?: string | number | null;
  price_range?: {
    min_amount?: string | number | null;
    max_amount?: string | number | null;
  } | null;
  currency_code?: string;
  currency_symbol?: string;
  currency_minor_unit?: number;
}

export interface WooImageRaw {
  id?: number | string;
  src?: string | null;
  thumbnail?: string | null;
  name?: string | null;
  alt?: string | null;
}

export interface WooTermRaw {
  id?: number | string;
  name?: string | null;
  slug?: string | null;
}

export interface WooAttributeRaw {
  id?: number | string;
  name?: string | null;
  taxonomy?: string | null;
  has_variations?: boolean;
  terms?: WooTermRaw[];
}

export interface WooVariationAttributeRaw {
  name?: string | null;
  value?: string | null;
}

export interface WooVariationStubRaw {
  id?: number | string;
  attributes?: WooVariationAttributeRaw[];
}

export interface WooProductRaw {
  id?: number | string;
  name?: string | null;
  slug?: string | null;
  parent?: number;
  type?: string | null;
  variation?: string | null;
  permalink?: string | null;
  sku?: string | null;
  short_description?: string | null;
  description?: string | null;
  on_sale?: boolean;
  prices?: WooPricesRaw | null;
  images?: WooImageRaw[];
  categories?: WooTermRaw[];
  brands?: WooTermRaw[];
  attributes?: WooAttributeRaw[];
  variations?: WooVariationStubRaw[];
  is_in_stock?: boolean;
  is_purchasable?: boolean;
}

export interface WooCartRaw {
  items?: unknown[];
  totals?: {
    currency_code?: string;
    currency_minor_unit?: number;
    total_price?: string;
  } | null;
  shipping_address?: { country?: string | null } | null;
  billing_address?: { country?: string | null } | null;
}

export interface WooProductIdentifier {
  kind: "id" | "slug";
  value: string;
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF"
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND"
]);

const WOO_NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  times: "×",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  hellip: "…",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß"
};

export function decodeWooEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return full;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return full;
    }
    return WOO_NAMED_ENTITIES[entity] ?? WOO_NAMED_ENTITIES[entity.toLowerCase()] ?? full;
  });
}

export function sanitizeWooText(input: string | null | undefined, maxLen: number): string {
  if (!input) return "";
  const noTags = String(input)
    .replace(/<(script|style|iframe|noscript|svg|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return sanitizeText(decodeWooEntities(noTags), maxLen);
}

export function sanitizeWooOptionalText(
  input: string | null | undefined,
  maxLen: number
): string | null {
  const cleaned = sanitizeWooText(input, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

export function sanitizeWooDescription(
  description: string | null | undefined,
  shortDescription: string | null | undefined,
  maxLen = 1500
): string {
  const stripShortcodes = (html: string | null | undefined): string => {
    if (!html) return "";
    // Remove common WordPress page-builder shortcodes (WPBakery, Divi, Avada, Elementor)
    const withoutShortcodes = String(html).replace(
      /\[\/?(?:vc_|et_pb_|fusion_|elementor-)[^\]]*\]/gi,
      " "
    );
    return stripHtmlToText(decodeWooEntities(withoutShortcodes), maxLen);
  };

  const mainText = stripShortcodes(description);
  if (mainText.length > 0) return mainText;
  return stripShortcodes(shortDescription);
}

export function normalizeWooCurrency(
  raw: string | null | undefined,
  fallback = "USD"
): string {
  const cleaned = (raw ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(cleaned)) return cleaned;
  return fallback;
}

export function getWooCurrencyExponent(currency: string): number {
  const code = normalizeWooCurrency(currency);
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

export function resolveMinorUnit(
  currencyMinorUnit: number | null | undefined,
  currency: string
): number {
  if (
    typeof currencyMinorUnit === "number" &&
    Number.isInteger(currencyMinorUnit) &&
    currencyMinorUnit >= 0 &&
    currencyMinorUnit <= 6
  ) {
    return currencyMinorUnit;
  }
  return getWooCurrencyExponent(currency);
}

export function formatWooMoney(
  amount: number,
  currency: string,
  currencyMinorUnit?: number | null
): Money {
  const code = normalizeWooCurrency(currency);
  const exp = resolveMinorUnit(currencyMinorUnit, code);
  const factor = 10 ** exp;
  const rounded = Math.round(amount * factor) / factor;
  const safeAmount = Object.is(rounded, -0) ? 0 : rounded;
  return {
    amount: safeAmount,
    formatted: `${safeAmount.toFixed(exp)} ${code}`,
    currency: code
  };
}

export function wooMoneyFromMinorUnits(
  raw: string | number | null | undefined,
  currency: string,
  currencyMinorUnit?: number | null,
  treatNonPositiveAsNull = false
): Money | null {
  if (raw === null || raw === undefined) return null;
  let numeric: number;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    numeric = Math.trunc(raw);
  } else {
    const trimmed = String(raw).trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) return null;
    numeric = Number(trimmed);
    if (!Number.isSafeInteger(numeric)) return null;
  }
  if (treatNonPositiveAsNull && numeric <= 0) return null;
  const exp = resolveMinorUnit(currencyMinorUnit, currency);
  const amount = numeric / 10 ** exp;
  return formatWooMoney(amount, currency, exp);
}

export interface NormalizedWooPrices {
  currency: string;
  minorUnit: number;
  price: Money;
  priceMin: Money;
  priceMax: Money;
  compareAtPrice: Money | null;
}

export function extractWooProductPrices(
  raw: WooProductRaw,
  fallbackCurrency: string,
  fallbackMinorUnit?: number | null
): NormalizedWooPrices {
  const prices = raw.prices ?? {};
  const currency = normalizeWooCurrency(prices.currency_code, fallbackCurrency);
  const minorUnit = resolveMinorUnit(prices.currency_minor_unit ?? fallbackMinorUnit, currency);

  const saleMoney = wooMoneyFromMinorUnits(prices.sale_price, currency, minorUnit, true);
  const regularMoney = wooMoneyFromMinorUnits(prices.regular_price, currency, minorUnit, true);
  const activeMoney = wooMoneyFromMinorUnits(prices.price, currency, minorUnit, false);

  const price = raw.on_sale
    ? saleMoney ?? activeMoney ?? regularMoney ?? formatWooMoney(0, currency, minorUnit)
    : activeMoney ?? regularMoney ?? saleMoney ?? formatWooMoney(0, currency, minorUnit);

  const compareAtPrice =
    regularMoney !== null && regularMoney.amount > price.amount ? regularMoney : null;

  const rangeMin = wooMoneyFromMinorUnits(
    prices.price_range?.min_amount,
    currency,
    minorUnit,
    false
  );
  const rangeMax = wooMoneyFromMinorUnits(
    prices.price_range?.max_amount,
    currency,
    minorUnit,
    false
  );

  return {
    currency,
    minorUnit,
    price,
    priceMin: rangeMin ?? price,
    priceMax: rangeMax ?? price,
    compareAtPrice
  };
}

export function isWooProductAvailable(raw: Pick<WooProductRaw, "is_in_stock" | "is_purchasable">): boolean {
  if (raw.is_in_stock === false) return false;
  if (raw.is_purchasable === false) return false;
  return raw.is_in_stock === true;
}

export function isValidWooStoreProduct(item: unknown): item is WooProductRaw {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const rec = item as Record<string, unknown>;
  const idValid =
    (typeof rec.id === "number" && Number.isInteger(rec.id) && rec.id > 0) ||
    (typeof rec.id === "string" && /^\d{1,20}$/.test(rec.id));
  if (!idValid) return false;
  if (typeof rec.name !== "string") return false;
  if (!rec.prices || typeof rec.prices !== "object" || Array.isArray(rec.prices)) return false;
  const prices = rec.prices as Record<string, unknown>;
  if (typeof prices.currency_code !== "string" || !/^[A-Za-z]{3}$/.test(prices.currency_code.trim())) {
    return false;
  }
  if (
    typeof prices.currency_minor_unit !== "number" ||
    !Number.isInteger(prices.currency_minor_unit) ||
    prices.currency_minor_unit < 0 ||
    prices.currency_minor_unit > 6
  ) {
    return false;
  }
  return true;
}

export function isValidWooCart(data: unknown): data is WooCartRaw {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const rec = data as Record<string, unknown>;
  if (!Array.isArray(rec.items)) return false;
  if (!rec.totals || typeof rec.totals !== "object" || Array.isArray(rec.totals)) return false;
  const totals = rec.totals as Record<string, unknown>;
  if (typeof totals.currency_code !== "string" || !/^[A-Za-z]{3}$/.test(totals.currency_code.trim())) {
    return false;
  }
  if (
    typeof totals.currency_minor_unit !== "number" ||
    !Number.isInteger(totals.currency_minor_unit) ||
    totals.currency_minor_unit < 0 ||
    totals.currency_minor_unit > 6
  ) {
    return false;
  }
  return true;
}

function validateSlug(rawSlug: string): string {
  const candidate = rawSlug.trim();
  if (
    !candidate ||
    candidate.length > 200 ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    candidate.includes("..") ||
    /[\x00-\x1f\s]/.test(candidate)
  ) {
    throw new Error(`Invalid WooCommerce product slug or ID: ${candidate}`);
  }
  return candidate;
}

export function extractWooProductIdentifier(handleOrUrl: string): WooProductIdentifier {
  const trimmed = handleOrUrl.trim();
  if (!trimmed) {
    throw new Error("handle_or_url is required");
  }

  // Pure numeric product/variation ID
  if (/^\d{1,20}$/.test(trimmed)) {
    return { kind: "id", value: trimmed };
  }

  const isFullUrl = /^https?:\/\//i.test(trimmed);
  if (isFullUrl || trimmed.includes("/")) {
    let pathname = trimmed;
    let searchParams: URLSearchParams | null = null;
    if (isFullUrl) {
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new Error(`Invalid product URL: ${trimmed}`);
      }
      pathname = parsed.pathname;
      searchParams = parsed.searchParams;
    }

    // Handle ?product=<slug> or ?p=<id> query-style WordPress permalinks
    if (searchParams) {
      const productParam = searchParams.get("product")?.trim();
      if (productParam) {
        return { kind: "slug", value: validateSlug(productParam) };
      }
      const pParam = searchParams.get("p")?.trim();
      if (pParam && /^\d{1,20}$/.test(pParam)) {
        return { kind: "id", value: pParam };
      }
    }

    // Reject path traversal segments before normalizing
    const rawSegments = pathname.split("/").filter(Boolean);
    if (rawSegments.some((seg) => seg === ".." || seg === ".")) {
      throw new Error(`Invalid product path: ${trimmed}`);
    }

    const lastSegment = rawSegments[rawSegments.length - 1];
    if (!lastSegment) {
      throw new Error(`Could not extract product slug from URL: ${trimmed}`);
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(lastSegment);
    } catch {
      throw new Error(`Invalid percent-encoding in product URL: ${lastSegment}`);
    }

    if (/^\d{1,20}$/.test(decoded)) {
      return { kind: "id", value: decoded };
    }
    return { kind: "slug", value: validateSlug(decoded) };
  }

  return { kind: "slug", value: validateSlug(trimmed) };
}

export function simplifyWooSearchQueryForRetry(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/[®™©]/g, "")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned && cleaned.toLowerCase() !== trimmed.toLowerCase()) {
    return cleaned;
  }
  const folded = trimmed
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (folded && folded !== trimmed.toLowerCase()) {
    return folded;
  }
  return null;
}

export function normalizeCountryCode(raw: string | null | undefined): string | null {
  const cleaned = sanitizeOptionalText(raw, 8)?.toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(cleaned) ? cleaned : null;
}
