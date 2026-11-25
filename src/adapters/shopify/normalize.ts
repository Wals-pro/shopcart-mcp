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

export function computeDiscount(
  price: Money,
  compareAtPrice: Money | null
): { discount_percent: number | null; savings: Money | null } {
  if (!compareAtPrice || compareAtPrice.amount <= price.amount || compareAtPrice.amount <= 0) {
    return { discount_percent: null, savings: null };
  }
  const diff = compareAtPrice.amount - price.amount;
  const pct = Math.round((diff / compareAtPrice.amount) * 100);
  if (pct <= 0) {
    return { discount_percent: null, savings: null };
  }
  return {
    discount_percent: pct,
    savings: formatMoney(diff, price.currency)
  };
}

export function extractCollectionHandle(handleOrUrl: string): string {
  const trimmed = handleOrUrl.trim();
  if (!trimmed) {
    throw new Error("collection handle is required");
  }

  let candidate = trimmed;
  const isFullUrl = /^https?:\/\//i.test(trimmed);
  const looksLikeCollectionPath =
    isFullUrl ||
    trimmed.includes("/collections/") ||
    /^collections\/[^/?#]+/i.test(trimmed);

  if (looksLikeCollectionPath) {
    let pathname = trimmed;
    if (isFullUrl) {
      pathname = new URL(trimmed).pathname;
    } else if (!pathname.startsWith("/")) {
      pathname = `/${pathname}`;
    }
    const match = pathname.match(/\/collections\/([^/?#]+)/i);
    if (!match?.[1]) {
      throw new Error(`Could not extract collection handle from URL: ${trimmed}`);
    }
    try {
      candidate = decodeURIComponent(match[1]);
    } catch {
      throw new Error(`Invalid percent-encoding in collection handle: ${match[1]}`);
    }
  }

  candidate = candidate.replace(/\.json$/i, "").trim();

  if (
    !candidate ||
    candidate.length > 200 ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    candidate.includes("..") ||
    /[\x00-\x1f\s?#&%]/.test(candidate)
  ) {
    throw new Error(`Invalid collection handle: ${candidate}`);
  }

  return candidate;
}

const DEAL_COLLECTION_PATTERNS: Array<{ tag: string; re: RegExp }> = [
  {
    tag: "black-friday",
    re: /black[-_\s]?friday|black[-_\s]?week|cyber[-_\s]?(week|monday)|bfcm/i
  },
  {
    tag: "sale",
    re: /(?:^|[^a-z0-9])(sale|rabatt|discount|angebot[e]?|outlet|clearance|deals?|promo|aktion|schnaeppchen|reduziert|sparen|3[-_\s]?for[-_\s]?2|2[-_\s]?for[-_\s]?1|bogo)(?:$|[^a-z0-9])|\d{1,2}[-_\s]?(?:%|prozent|rabatt|off)/i
  },
  {
    tag: "adventskalender",
    re: /advent|kalender|weihnacht|christmas|xmas|geschenk|gift/i
  },
  {
    tag: "bestseller",
    re: /best[-_\s]?sell|top[-_\s]?sell|beliebt|favorit|liebling|trending|most[-_\s]?popular/i
  },
  {
    tag: "bundle",
    re: /(?:^|[^a-z0-9])(bundle|bundles|set|sets|sparpaket|sparset|multipack|value[-_\s]?pack)(?:$|[^a-z0-9])/i
  }
];

export function classifyDealCollection(handle: string, title: string): {
  isDeal: boolean;
  tags: string[];
} {
  const haystack = `${foldSearchText(handle)} ${foldSearchText(title)}`;
  const tags: string[] = [];
  for (const rule of DEAL_COLLECTION_PATTERNS) {
    if (rule.re.test(haystack)) {
      tags.push(rule.tag);
    }
  }
  return { isDeal: tags.length > 0, tags };
}

const WORD_DAYS: Record<string, number> = {
  sieben: 7,
  seven: 7,
  vierzehn: 14,
  fourteen: 14,
  dreissig: 30,
  thirty: 30,
  sechzig: 60,
  sixty: 60,
  neunzig: 90,
  ninety: 90,
  hundert: 100
};

const CARRIER_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "DHL GoGreen", re: /\bDHL\s+GoGreen\b/i },
  { name: "DHL", re: /\bDHL\b/i },
  { name: "DPD", re: /\bDPD\b/i },
  { name: "UPS", re: /\bUPS\b/i },
  { name: "Hermes", re: /\bHermes\b/i },
  { name: "GLS", re: /\bGLS\b/i },
  { name: "FedEx", re: /\bFedEx\b/i },
  { name: "USPS", re: /\bUSPS\b/i },
  { name: "Deutsche Post", re: /\bDeutsche\s+Post\b/i },
  { name: "Österreichische Post", re: /\b(?:Österreichische|Oesterreichische|Austrian)\s+Post\b/i },
  { name: "Swiss Post", re: /\b(?:Swiss\s+Post|Schweizerische\s+Post)\b/i }
];

export function extractPolicyHints(texts: Array<string | null | undefined>): {
  free_shipping_threshold: string | null;
  return_window_days: number | null;
  return_window_text: string | null;
  free_returns: boolean | null;
  delivery_time_text: string | null;
  shipping_carriers: string[];
} {
  const combined = texts
    .filter((t): t is string => Boolean(t && t.trim()))
    .join("\n\n");

  if (!combined) {
    return {
      free_shipping_threshold: null,
      return_window_days: null,
      return_window_text: null,
      free_returns: null,
      delivery_time_text: null,
      shipping_carriers: []
    };
  }

  // 1. Free shipping threshold (DE + EN)
  let freeShippingThreshold: string | null = null;
  const amountPattern =
    "(?:(?:€|EUR|\\$|USD|£|GBP|CHF)\\s*\\d{1,4}(?:[.,]\\d{1,2})?|\\d{1,4}(?:[.,]\\d{1,2})?\\s*(?:€|EUR|Euro|\\$|USD|£|GBP|CHF))";
  const thresholdPatterns = [
    new RegExp(
      `(?:versandkostenfrei|kostenlose[rn]?\\s+Versand|kostenfreie[rn]?\\s+Versand|gratis\\s+Versand|kostenlose\\s+Lieferung|free\\s+(?:standard\\s+)?shipping|free\\s+delivery)[^\\n.;]{0,50}?(?:ab|from|over|above)[^\\n.;]{0,30}?(${amountPattern})`,
      "i"
    ),
    new RegExp(
      `(?:ab|from|over|above)\\s+(?:einem\\s+(?:Bestellwert|Warenwert|Einkaufswert)\\s+von\\s+|orders\\s+(?:of|over)\\s+)?(${amountPattern})[^\\n.;]{0,60}?(?:versandkostenfrei|kostenlose[rn]?\\s+Versand|kostenfreie[rn]?\\s+Versand|gratis|kostenlos|übernehmen\\s+wir[^\\n.;]{0,25}?versandkosten|free\\s+(?:standard\\s+)?shipping|free\\s+delivery)`,
      "i"
    )
  ];
  let bestThresholdIdx = Number.POSITIVE_INFINITY;
  for (const re of thresholdPatterns) {
    const m = combined.match(re);
    if (m?.[1] && typeof m.index === "number" && m.index < bestThresholdIdx) {
      bestThresholdIdx = m.index;
      freeShippingThreshold = m[1].replace(/\s+/g, " ").trim();
    }
  }

  // 2. Return window days (DE + EN, numeric or word numbers)
  let returnWindowDays: number | null = null;
  let returnWindowText: string | null = null;
  const folded = foldSearchText(combined);

  const returnDayPatterns = [
    /\b(\d{1,3})\s*(?:tage[n]?|days?)\s*(?:rueckgaberecht|widerrufsrecht|rueckgabe|retoure|umtausch|return|returns|money[- ]back)/i,
    /(?:rueckgaberecht|widerrufsrecht|rueckgabe|retoure|return\s+policy|return\s+window|returns?)[^\n.;]{0,60}?\b(\d{1,3})\s*(?:tage[n]?|days?)/i,
    /(?:binnen|innerhalb(?:\s+von)?|within)\s+(\d{1,3}|sieben|seven|vierzehn|fourteen|dreissig|thirty|sechzig|sixty|neunzig|ninety|hundert)\s*(?:tage[n]?|days?)/i
  ];
  for (const re of returnDayPatterns) {
    const m = folded.match(re);
    if (m?.[1]) {
      const rawToken = m[1].toLowerCase();
      const days = /^\d+$/.test(rawToken)
        ? Number.parseInt(rawToken, 10)
        : (WORD_DAYS[rawToken] ?? null);
      if (days !== null && days >= 7 && days <= 365) {
        returnWindowDays = days;
        returnWindowText = `${days} days`;
        break;
      }
    }
  }

  // 3. Free returns signal
  let freeReturns: boolean | null = null;
  if (
    /(?:kostenlose[rn]?|kostenfreie[rn]?|gratis)\s+(?:ruecksendung|retoure|rueckgabe|umtausch)|free\s+returns?|prepaid\s+return\s+label/i.test(
      folded
    )
  ) {
    freeReturns = true;
  } else if (
    /(?:tragen\s+(?:sie\s+)?die\s+(?:unmittelbaren\s+)?kosten\s+der\s+ruecksendung|ruecksendekosten\s+(?:traegt|tragen)|customer\s+(?:is\s+responsible\s+for|pays)\s+return\s+shipping|return\s+shipping\s+(?:costs?\s+)?(?:are\s+)?(?:not\s+free|deducted|at\s+your\s+expense))/i.test(
      folded
    )
  ) {
    freeReturns = false;
  }

  // 4. Delivery time text
  let deliveryTimeText: string | null = null;
  const deliveryMatch = combined.match(
    /\b(\d{1,2}\s*(?:[-–]|bis|to)\s*\d{1,2}\s*(?:Werktagen?|Arbeitstagen?|business\s+days?|working\s+days?|Tagen?|days?))/i
  );
  if (deliveryMatch?.[1]) {
    deliveryTimeText = deliveryMatch[1].replace(/\s+/g, " ").trim();
  }

  // 5. Shipping carriers
  const shippingCarriers: string[] = [];
  for (const carrier of CARRIER_PATTERNS) {
    if (carrier.re.test(combined)) {
      // Avoid listing both "DHL GoGreen" and "DHL" redundantly
      if (carrier.name === "DHL" && shippingCarriers.includes("DHL GoGreen")) {
        continue;
      }
      shippingCarriers.push(carrier.name);
    }
  }

  return {
    free_shipping_threshold: freeShippingThreshold,
    return_window_days: returnWindowDays,
    return_window_text: returnWindowText,
    free_returns: freeReturns,
    delivery_time_text: deliveryTimeText,
    shipping_carriers: shippingCarriers
  };
}
