import type { Money } from "../types.js";

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

export function normalizeCurrency(raw: string | null | undefined, fallback = "USD"): string {
  const cleaned = (raw ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(cleaned)) return cleaned;
  return fallback;
}

export function getCurrencyExponent(currency: string): number {
  const code = normalizeCurrency(currency);
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

export function formatMoney(amount: number, currency: string): Money {
  const code = normalizeCurrency(currency);
  const exp = getCurrencyExponent(code);
  const factor = 10 ** exp;
  const rounded = Math.round(amount * factor) / factor;
  const safeAmount = Object.is(rounded, -0) ? 0 : rounded;
  return {
    amount: safeAmount,
    formatted: `${safeAmount.toFixed(exp)} ${code}`,
    currency: code
  };
}

export function moneyFromDecimalString(
  raw: string | number | null | undefined,
  currency: string,
  treatNonPositiveAsNull = false
): Money | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (treatNonPositiveAsNull && raw <= 0) return null;
    return formatMoney(raw, currency);
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (treatNonPositiveAsNull && parsed <= 0) return null;
  return formatMoney(parsed, currency);
}

export function moneyFromMinorUnits(
  raw: number | string | null | undefined,
  currency: string,
  treatNonPositiveAsNull = false
): Money | null {
  if (raw === null || raw === undefined) return null;
  const numeric = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(numeric)) return null;
  if (treatNonPositiveAsNull && numeric <= 0) return null;
  const exp = getCurrencyExponent(currency);
  const amount = numeric / 10 ** exp;
  return formatMoney(amount, currency);
}

export interface ProductPathInfo {
  handle: string;
  localePrefix: string | null;
}

const LOCALE_PREFIX_RE = /^\/([a-z]{2}(?:-[a-z]{2,4})?)(?=\/(?:products|collections)\/)/i;

export function extractProductPathInfo(handleOrUrl: string): ProductPathInfo {
  const trimmed = handleOrUrl.trim();
  if (!trimmed) {
    throw new Error("handle_or_url is required");
  }

  let candidate = trimmed;
  let localePrefix: string | null = null;

  const isFullUrl = /^https?:\/\//i.test(trimmed);
  const looksLikeProductPath =
    isFullUrl ||
    trimmed.includes("/products/") ||
    /^products\/[^/?#]+/i.test(trimmed);

  if (looksLikeProductPath) {
    let pathname = trimmed;
    if (isFullUrl) {
      const parsed = new URL(trimmed);
      pathname = parsed.pathname;
    } else if (!pathname.startsWith("/")) {
      pathname = `/${pathname}`;
    }

    const localeMatch = pathname.match(LOCALE_PREFIX_RE);
    if (localeMatch?.[1]) {
      localePrefix = `/${localeMatch[1].toLowerCase()}`;
    }

    const match = pathname.match(/\/products\/([^/?#]+)/i);
    if (!match?.[1]) {
      throw new Error(`Could not extract product handle from URL: ${trimmed}`);
    }
    try {
      candidate = decodeURIComponent(match[1]);
    } catch {
      throw new Error(`Invalid percent-encoding in product handle: ${match[1]}`);
    }
  }

  // Remove optional .js / .json suffix
  candidate = candidate.replace(/\.(js|json)$/i, "").trim();

  if (
    !candidate ||
    candidate.length > 200 ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    candidate.includes("..") ||
    /[\x00-\x1f\s]/.test(candidate)
  ) {
    throw new Error(`Invalid product handle: ${candidate}`);
  }

  return { handle: candidate, localePrefix };
}

export function extractProductHandle(handleOrUrl: string): string {
  return extractProductPathInfo(handleOrUrl).handle;
}

export function foldSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractTokens(text: string): string[] {
  const all = text
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter(Boolean);
  const longTokens = all.filter((t) => t.length >= 2);
  return longTokens.length > 0 ? longTokens : all;
}

export function matchesSearchQuery(haystack: string, query: string): boolean {
  const rawQuery = query.trim().toLowerCase();
  if (!rawQuery) return false;

  const rawTokens = extractTokens(rawQuery);
  if (rawTokens.length === 0) return false;

  const lowerHaystack = haystack.toLowerCase();
  if (rawTokens.every((tok) => lowerHaystack.includes(tok))) {
    return true;
  }

  const foldedHaystack = foldSearchText(haystack);
  const foldedTokens = extractTokens(foldSearchText(rawQuery));
  return foldedTokens.length > 0 && foldedTokens.every((tok) => foldedHaystack.includes(tok));
}

export function simplifySearchQueryForRetry(query: string): string | null {
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
  const folded = foldSearchText(trimmed).replace(/\s+/g, " ").trim();
  if (folded && folded !== trimmed.toLowerCase()) {
    return folded;
  }
  return null;
}
