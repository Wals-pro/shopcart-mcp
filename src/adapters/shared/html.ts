import { sanitizeOptionalText, sanitizeText } from "../../security/sanitize.js";
import { SsrfError } from "../../security/ssrf.js";

const HARD_SSRF_CODES = new Set(["INVALID_URL", "BLOCKED_HOST", "BLOCKED_IP", "CONCURRENCY_LIMIT"]);

export function rethrowIfHardSsrfError(err: unknown): void {
  if (err instanceof SsrfError && HARD_SSRF_CODES.has(err.code)) {
    throw err;
  }
}

export function decodeHtmlEntitiesBasic(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|quot|apos|amp|lt|gt|nbsp|euro|ndash|mdash);/gi, (full, ent: string) => {
    const lower = ent.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    switch (lower) {
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "nbsp":
        return " ";
      case "euro":
        return "€";
      case "ndash":
        return "–";
      case "mdash":
        return "—";
      default:
        return full;
    }
  });
}

export function extractHtmlTitle(html: string): string | null {
  const ogSite = extractMetaContent(html, "og:site_name");
  if (ogSite) return sanitizeOptionalText(ogSite, 120);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch?.[1]) return null;
  const decoded = decodeHtmlEntitiesBasic(titleMatch[1]);
  const cleaned = sanitizeOptionalText(decoded, 120);
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+[|\-–—]\s+/);
  return sanitizeOptionalText(parts[parts.length - 1] ?? cleaned, 120);
}

export function extractMetaContent(html: string, nameOrProp: string): string | null {
  const escaped = nameOrProp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`,
      "i"
    )
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return decodeHtmlEntitiesBasic(m[1]).trim();
    }
  }
  return null;
}

export function extractJsonLdBlocks(html: string): unknown[] {
  const results: unknown[] = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      collectJsonLdNodes(parsed, results);
    } catch {
      // Some storefronts emit unescaped control characters inside JSON-LD strings; retry once after stripping raw control chars
      try {
        const cleaned = raw.replace(/[\x00-\x1f]/g, " ");
        const parsed = JSON.parse(cleaned) as unknown;
        collectJsonLdNodes(parsed, results);
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }
  }
  return results;
}

function collectJsonLdNodes(node: unknown, out: unknown[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdNodes(item, out);
    return;
  }
  out.push(node);
  const record = node as Record<string, unknown>;
  if (Array.isArray(record["@graph"])) {
    for (const item of record["@graph"]) collectJsonLdNodes(item, out);
  }
}

export function hasJsonLdType(node: Record<string, unknown>, targetType: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t.toLowerCase() === targetType.toLowerCase();
  if (Array.isArray(t)) {
    return t.some((entry) => typeof entry === "string" && entry.toLowerCase() === targetType.toLowerCase());
  }
  return false;
}

export function findBestProductJsonLd(
  blocks: unknown[]
): Record<string, unknown> | null {
  const candidates = blocks.filter(
    (b): b is Record<string, unknown> =>
      Boolean(b) && typeof b === "object" && !Array.isArray(b) && hasJsonLdType(b as Record<string, unknown>, "Product")
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Prefer the Product node with offers/price and without obvious store-stub name (e.g. domain-only TrustedShops stub)
  const scored = candidates.map((c) => {
    let score = 0;
    if (c.offers) score += 5;
    if (c.sku) score += 2;
    if (c.description) score += 1;
    if (c.image) score += 1;
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (/^[a-z0-9-]+\.[a-z]{2,}$/i.test(name)) score -= 4;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.c;
}

export interface ParsedOfferInfo {
  price: number | null;
  highPrice: number | null;
  currency: string | null;
  available: boolean | null;
  sku: string | null;
  url: string | null;
}

export function parseJsonLdOffer(rawOffer: unknown): ParsedOfferInfo {
  const empty: ParsedOfferInfo = {
    price: null,
    highPrice: null,
    currency: null,
    available: null,
    sku: null,
    url: null
  };
  if (!rawOffer || typeof rawOffer !== "object") return empty;

  const offers = Array.isArray(rawOffer) ? rawOffer : [rawOffer];
  let bestPrice: number | null = null;
  let highPrice: number | null = null;
  let currency: string | null = null;
  let anyInStock: boolean | null = null;
  let sku: string | null = null;
  let url: string | null = null;

  for (const item of offers) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;

    const priceVal = parseNumberLike(o.price ?? o.lowPrice);
    if (priceVal !== null && (bestPrice === null || priceVal < bestPrice)) {
      bestPrice = priceVal;
    }
    const highVal = parseNumberLike(o.highPrice);
    if (highVal !== null && (highPrice === null || highVal > highPrice)) {
      highPrice = highVal;
    }
    if (!currency && typeof o.priceCurrency === "string" && /^[A-Za-z]{3}$/.test(o.priceCurrency.trim())) {
      currency = o.priceCurrency.trim().toUpperCase();
    }
    if (!sku && typeof o.sku === "string") {
      sku = sanitizeOptionalText(o.sku, 80);
    }
    if (!url && typeof o.url === "string") {
      url = o.url;
    }
    if (typeof o.availability === "string") {
      const avail = o.availability.toLowerCase();
      if (avail.includes("instock") || avail.includes("limitedavailability") || avail.includes("preorder") || avail.includes("onlineonly")) {
        anyInStock = true;
      } else if (avail.includes("outofstock") || avail.includes("soldout") || avail.includes("discontinued")) {
        if (anyInStock === null) anyInStock = false;
      }
    }
    // Nested AggregateOffer.offers
    if (Array.isArray(o.offers)) {
      const nested = parseJsonLdOffer(o.offers);
      if (nested.price !== null && (bestPrice === null || nested.price < bestPrice)) {
        bestPrice = nested.price;
      }
      if (!currency && nested.currency) currency = nested.currency;
      if (nested.available === true) anyInStock = true;
      else if (nested.available === false && anyInStock === null) anyInStock = false;
    }
  }

  return { price: bestPrice, highPrice, currency, available: anyInStock, sku, url };
}

export function parseNumberLike(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const parsed = parseLocalizedPrice(raw);
  return parsed ? parsed.amount : null;
}

export function parseLocalizedPrice(
  raw: string | null | undefined
): { amount: number; currencyHint: string | null } | null {
  if (!raw || typeof raw !== "string") return null;
  const text = decodeHtmlEntitiesBasic(raw).trim();
  if (!text) return null;

  let currencyHint: string | null = null;
  if (/€|\bEUR\b/i.test(text)) currencyHint = "EUR";
  else if (/£|\bGBP\b/i.test(text)) currencyHint = "GBP";
  else if (/\bCHF\b/i.test(text)) currencyHint = "CHF";
  else if (/\bCAD\b|CA\$/i.test(text)) currencyHint = "CAD";
  else if (/\bAUD\b|AU\$/i.test(text)) currencyHint = "AUD";
  else if (/¥|\bJPY\b/i.test(text)) currencyHint = "JPY";
  else if (/\$|\bUSD\b/i.test(text)) currencyHint = "USD";

  const numMatch = text.match(/(\d{1,3}(?:[.,'\s]\d{3})*(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)/);
  if (!numMatch?.[1]) return null;

  let numStr = numMatch[1].replace(/['\s]/g, "");
  const lastComma = numStr.lastIndexOf(",");
  const lastDot = numStr.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // European: 1.299,50 -> 1299.50
      numStr = numStr.replace(/\./g, "").replace(",", ".");
    } else {
      // US/UK: 1,299.50 -> 1299.50
      numStr = numStr.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const decimals = numStr.length - lastComma - 1;
    if (decimals === 1 || decimals === 2) {
      numStr = numStr.replace(",", ".");
    } else {
      numStr = numStr.replace(/,/g, "");
    }
  }

  const amount = Number.parseFloat(numStr);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount, currencyHint };
}

export function computeDiscountPercent(
  finalPrice: number,
  compareAtPrice: number | null | undefined
): number | null {
  if (
    typeof compareAtPrice !== "number" ||
    !Number.isFinite(compareAtPrice) ||
    compareAtPrice <= 0 ||
    finalPrice < 0 ||
    compareAtPrice <= finalPrice
  ) {
    return null;
  }
  const pct = Math.round(((compareAtPrice - finalPrice) / compareAtPrice) * 10000) / 100;
  return pct > 0 ? pct : null;
}

export function extractJsonLdImages(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") out.push(item);
      else if (item && typeof item === "object") {
        const url = (item as Record<string, unknown>).url ?? (item as Record<string, unknown>).contentUrl;
        if (typeof url === "string") out.push(url);
      }
    }
    return out;
  }
  if (typeof raw === "object") {
    const url = (raw as Record<string, unknown>).url ?? (raw as Record<string, unknown>).contentUrl;
    return typeof url === "string" ? [url] : [];
  }
  return [];
}

export function extractJsonLdBrand(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return sanitizeOptionalText(raw, 100);
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const name = (raw as Record<string, unknown>).name;
    if (typeof name === "string") return sanitizeOptionalText(name, 100);
  }
  return null;
}

export function extractSafePathOnOrigin(handleOrUrl: string, origin: string): string {
  const trimmed = handleOrUrl.trim();
  if (!trimmed) {
    throw new Error("handle_or_url is required");
  }
  if (trimmed.includes("..") || trimmed.includes("\\") || /[\x00-\x1f]/.test(trimmed)) {
    throw new Error(`Invalid product handle or path: ${sanitizeText(trimmed, 80)}`);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(`Invalid product URL: ${sanitizeText(trimmed, 80)}`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error("Only https:// product URLs are allowed");
    }
    const storeHost = new URL(origin).hostname.toLowerCase();
    const targetHost = parsed.hostname.toLowerCase();
    const sameStore =
      targetHost === storeHost ||
      targetHost === `www.${storeHost}` ||
      `www.${targetHost}` === storeHost;
    if (!sameStore) {
      throw new Error(`Product URL host '${targetHost}' does not match store '${storeHost}'`);
    }
    return `${parsed.pathname}${parsed.search}`;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
