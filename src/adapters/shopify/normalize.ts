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

export function extractProductHandle(handleOrUrl: string): string {
  const trimmed = handleOrUrl.trim();
  if (!trimmed) {
    throw new Error("handle_or_url is required");
  }

  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/products/")) {
    let pathname = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      pathname = parsed.pathname;
    }
    const match = pathname.match(/\/products\/([^/?#]+)/i);
    if (!match?.[1]) {
      throw new Error(`Could not extract product handle from URL: ${trimmed}`);
    }
    candidate = decodeURIComponent(match[1]);
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

  return candidate;
}
