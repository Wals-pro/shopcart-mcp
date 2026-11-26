import { asciiLowerCase, sanitizeOptionalText, sanitizeText } from "../../security/sanitize.js";
import { SsrfError } from "../../security/ssrf.js";

const HARD_SSRF_CODES = new Set(["INVALID_URL", "BLOCKED_HOST", "BLOCKED_IP", "CONCURRENCY_LIMIT"]);
const MAX_JSONLD_DEPTH = 8;
const MAX_JSONLD_NODES = 200;
const MAX_JSONLD_OFFERS = 100;
const MAX_JSONLD_IMAGES = 20;
const MAX_ATTR_WINDOW = 2048;

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
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : full;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : full;
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

function isTagNameBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === ">" || ch === "/" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Linear-time O(N) HTML attribute parser on a bounded single-tag slice.
 */
export function parseTagAttributesLinear(attrSlice: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const len = Math.min(attrSlice.length, MAX_ATTR_WINDOW);
  let i = 0;

  while (i < len) {
    while (i < len && (attrSlice[i] === " " || attrSlice[i] === "\t" || attrSlice[i] === "\n" || attrSlice[i] === "\r" || attrSlice[i] === "/")) {
      i++;
    }
    if (i >= len) break;

    const nameStart = i;
    while (i < len) {
      const ch = attrSlice[i]!;
      if (ch === "=" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "/" || ch === ">") break;
      i++;
    }
    const name = attrSlice.slice(nameStart, i).toLowerCase();
    if (!name) {
      i++;
      continue;
    }

    while (i < len && (attrSlice[i] === " " || attrSlice[i] === "\t" || attrSlice[i] === "\n" || attrSlice[i] === "\r")) {
      i++;
    }

    if (attrSlice[i] !== "=") {
      attrs[name] = "";
      continue;
    }
    i++; // skip '='

    while (i < len && (attrSlice[i] === " " || attrSlice[i] === "\t" || attrSlice[i] === "\n" || attrSlice[i] === "\r")) {
      i++;
    }
    if (i >= len) {
      attrs[name] = "";
      break;
    }

    const quote = attrSlice[i];
    if (quote === '"' || quote === "'") {
      i++;
      const valStart = i;
      const closeIdx = attrSlice.indexOf(quote, valStart);
      if (closeIdx === -1 || closeIdx >= len) {
        attrs[name] = attrSlice.slice(valStart, len);
        break;
      }
      attrs[name] = attrSlice.slice(valStart, closeIdx);
      i = closeIdx + 1;
    } else {
      const valStart = i;
      while (i < len && attrSlice[i] !== " " && attrSlice[i] !== "\t" && attrSlice[i] !== "\n" && attrSlice[i] !== "\r" && attrSlice[i] !== ">") {
        i++;
      }
      attrs[name] = attrSlice.slice(valStart, i);
    }
  }

  return attrs;
}

/**
 * Finds the end '>' of an opening tag starting at `attrStart`, bounded to `maxAttrLen`
 * and never crossing another `<` outside quotes (O(1) bounded window).
 */
function findOpenTagEndLinear(html: string, attrStart: number, maxAttrLen = MAX_ATTR_WINDOW): number {
  const limit = Math.min(html.length, attrStart + maxAttrLen);
  let quote: string | null = null;
  for (let i = attrStart; i < limit; i++) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    } else if (ch === "<") {
      return -1;
    }
  }
  return -1;
}

/**
 * Linear-time O(N) scanner for opening tags of `tagName` (e.g. "meta", "input", "a", "img").
 */
export function scanOpeningTagsLinear(
  html: string,
  tagName: string,
  opts: { maxTags?: number; maxAttrLen?: number } = {}
): Array<{ openAttrs: string; attrs: Record<string, string>; start: number; end: number }> {
  const results: Array<{ openAttrs: string; attrs: Record<string, string>; start: number; end: number }> = [];
  if (!html || !html.includes("<")) return results;
  const maxTags = opts.maxTags ?? 200;
  const maxAttrLen = opts.maxAttrLen ?? MAX_ATTR_WINDOW;
  const target = tagName.toLowerCase();
  const needle = `<${target}`;
  const lower = asciiLowerCase(html);
  let pos = 0;

  while (pos < lower.length && results.length < maxTags) {
    const idx = lower.indexOf(needle, pos);
    if (idx === -1) break;
    const afterName = idx + needle.length;
    if (!isTagNameBoundary(lower[afterName])) {
      pos = afterName;
      continue;
    }
    const openEnd = findOpenTagEndLinear(html, afterName, maxAttrLen);
    if (openEnd === -1) {
      pos = afterName;
      continue;
    }
    const openAttrs = html.slice(afterName, openEnd);
    results.push({
      openAttrs,
      attrs: parseTagAttributesLinear(openAttrs),
      start: idx,
      end: openEnd + 1
    });
    pos = openEnd + 1;
  }

  return results;
}

/**
 * Linear-time O(N) extractor for paired `<tagName ...>body</tagName>` blocks with
 * bounded attribute windows, bounded body slices, and memoized missing-close-tag protection.
 */
export function extractTagBlocksLinear(
  html: string,
  tagName: string,
  opts: {
    maxBlocks?: number;
    maxAttrLen?: number;
    maxBodyLen?: number;
    attrFilter?: (attrs: Record<string, string>, openAttrs: string) => boolean;
  } = {}
): Array<{ openAttrs: string; attrs: Record<string, string>; body: string; start: number; end: number }> {
  const results: Array<{ openAttrs: string; attrs: Record<string, string>; body: string; start: number; end: number }> = [];
  if (!html || !html.includes("<")) return results;
  const maxBlocks = opts.maxBlocks ?? 40;
  const maxAttrLen = opts.maxAttrLen ?? MAX_ATTR_WINDOW;
  const maxBodyLen = opts.maxBodyLen ?? 16_384;
  const target = tagName.toLowerCase();
  const openNeedle = `<${target}`;
  const closeNeedle = `</${target}`;
  const lower = asciiLowerCase(html);
  let pos = 0;
  let noMoreClose = false;

  while (pos < lower.length && results.length < maxBlocks) {
    const idx = lower.indexOf(openNeedle, pos);
    if (idx === -1) break;
    const afterName = idx + openNeedle.length;
    if (!isTagNameBoundary(lower[afterName])) {
      pos = afterName;
      continue;
    }
    const openEnd = findOpenTagEndLinear(html, afterName, maxAttrLen);
    if (openEnd === -1) {
      pos = afterName;
      continue;
    }
    const openAttrs = html.slice(afterName, openEnd);
    const attrs = parseTagAttributesLinear(openAttrs);
    if (opts.attrFilter && !opts.attrFilter(attrs, openAttrs)) {
      pos = openEnd + 1;
      continue;
    }
    if (noMoreClose) break;

    let closeIdx = lower.indexOf(closeNeedle, openEnd + 1);
    while (closeIdx !== -1 && !isTagNameBoundary(lower[closeIdx + closeNeedle.length])) {
      closeIdx = lower.indexOf(closeNeedle, closeIdx + closeNeedle.length);
    }
    if (closeIdx === -1) {
      noMoreClose = true;
      break;
    }
    const closeEnd = lower.indexOf(">", closeIdx + closeNeedle.length);
    const endPos = closeEnd === -1 ? html.length : closeEnd + 1;
    const bodyEnd = Math.min(closeIdx, openEnd + 1 + maxBodyLen);
    results.push({
      openAttrs,
      attrs,
      body: html.slice(openEnd + 1, bodyEnd),
      start: idx,
      end: endPos
    });
    pos = endPos;
  }

  return results;
}

/**
 * Linear-time O(N) extractor for repeated marker `<tagName ...>` sections whose end is delimited
 * by the next matching sibling marker or a bounded maxChunkLen window (e.g. `.product-box`,
 * `data-product-attribute`, `product-detail-configurator-group`).
 */
export function extractSectionSlicesLinear(
  html: string,
  tagName: string,
  attrFilter: (attrs: Record<string, string>, openAttrs: string) => boolean,
  opts: {
    maxSections?: number;
    maxChunkLen?: number;
    stopMarkers?: readonly string[];
  } = {}
): Array<{ openAttrs: string; attrs: Record<string, string>; body: string }> {
  const matches: Array<{ openAttrs: string; attrs: Record<string, string>; start: number; bodyStart: number }> = [];
  if (!html || !html.includes("<")) return [];
  const maxSections = opts.maxSections ?? 40;
  const maxChunkLen = opts.maxChunkLen ?? 8192;
  const stopMarkers = (opts.stopMarkers ?? []).map((m) => m.toLowerCase());
  const target = tagName.toLowerCase();
  const openNeedle = `<${target}`;
  const lower = asciiLowerCase(html);
  let pos = 0;

  while (pos < lower.length && matches.length <= maxSections) {
    const idx = lower.indexOf(openNeedle, pos);
    if (idx === -1) break;
    const afterName = idx + openNeedle.length;
    if (!isTagNameBoundary(lower[afterName])) {
      pos = afterName;
      continue;
    }
    const openEnd = findOpenTagEndLinear(html, afterName, MAX_ATTR_WINDOW);
    if (openEnd === -1) {
      pos = afterName;
      continue;
    }
    const openAttrs = html.slice(afterName, openEnd);
    const attrs = parseTagAttributesLinear(openAttrs);
    if (attrFilter(attrs, openAttrs)) {
      matches.push({ openAttrs, attrs, start: idx, bodyStart: openEnd + 1 });
    }
    pos = openEnd + 1;
  }

  const results: Array<{ openAttrs: string; attrs: Record<string, string>; body: string }> = [];
  const count = Math.min(matches.length, maxSections);
  for (let i = 0; i < count; i++) {
    const cur = matches[i]!;
    const nextStart = i + 1 < matches.length ? matches[i + 1]!.start : html.length;
    let sliceEnd = Math.min(nextStart, cur.bodyStart + maxChunkLen);
    if (stopMarkers.length > 0) {
      const lowerSlice = lower.slice(cur.bodyStart, sliceEnd);
      for (const marker of stopMarkers) {
        const stopIdx = lowerSlice.indexOf(marker);
        if (stopIdx !== -1 && cur.bodyStart + stopIdx < sliceEnd) {
          sliceEnd = cur.bodyStart + stopIdx;
        }
      }
    }
    results.push({
      openAttrs: cur.openAttrs,
      attrs: cur.attrs,
      body: html.slice(cur.bodyStart, sliceEnd)
    });
  }

  return results;
}

/**
 * Linear-time O(N) helper to extract text inside the first element whose `class` attribute
 * contains `classFragment` (e.g. `product-detail-price`, `list-price-price`).
 */
export function extractTextByClassLinear(
  html: string,
  classFragment: string,
  opts: { closingTag?: string; maxBodyLen?: number } = {}
): string | null {
  if (!html || !html.includes("<")) return null;
  const maxBodyLen = opts.maxBodyLen ?? 4096;
  const needle = classFragment.toLowerCase();
  const lower = asciiLowerCase(html);
  let pos = 0;

  while (pos < lower.length) {
    const idx = lower.indexOf(needle, pos);
    if (idx === -1) return null;

    // Walk back at most MAX_ATTR_WINDOW to find enclosing '<'
    const searchStart = Math.max(0, idx - MAX_ATTR_WINDOW);
    const lt = lower.lastIndexOf("<", idx);
    if (lt === -1 || lt < searchStart) {
      pos = idx + needle.length;
      continue;
    }
    const openEnd = findOpenTagEndLinear(html, lt + 1, MAX_ATTR_WINDOW);
    if (openEnd === -1 || openEnd < idx) {
      pos = idx + needle.length;
      continue;
    }
    // Verify the class attribute actually contains needle
    let nameEnd = lt + 1;
    while (nameEnd < openEnd && !isTagNameBoundary(lower[nameEnd])) {
      nameEnd++;
    }
    const attrs = parseTagAttributesLinear(html.slice(nameEnd, openEnd));
    const cls = (attrs["class"] ?? "").toLowerCase();
    if (!cls.includes(needle)) {
      pos = openEnd + 1;
      continue;
    }

    const bodyStart = openEnd + 1;
    const bodyLimit = Math.min(html.length, bodyStart + maxBodyLen);
    const closeNeedle = opts.closingTag ? `</${opts.closingTag.toLowerCase()}` : "</";
    const closeIdx = lower.indexOf(closeNeedle, bodyStart);
    const bodyEnd = closeIdx !== -1 && closeIdx < bodyLimit ? closeIdx : bodyLimit;
    return html.slice(bodyStart, bodyEnd);
  }
  return null;
}

export function extractHtmlTitle(html: string): string | null {
  const ogSite = extractMetaContent(html, "og:site_name");
  if (ogSite) return sanitizeOptionalText(ogSite, 120);
  const blocks = extractTagBlocksLinear(html, "title", { maxBlocks: 1, maxBodyLen: 512 });
  const rawTitle = blocks[0]?.body;
  if (!rawTitle) return null;
  const decoded = decodeHtmlEntitiesBasic(rawTitle);
  const cleaned = sanitizeOptionalText(decoded, 120);
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+[|\-–—]\s+/);
  return sanitizeOptionalText(parts[parts.length - 1] ?? cleaned, 120);
}

export function extractMetaContent(html: string, nameOrProp: string): string | null {
  const target = nameOrProp.toLowerCase();
  const tags = scanOpeningTagsLinear(html, "meta", { maxTags: 300 });
  for (const tag of tags) {
    const key = (tag.attrs["name"] ?? tag.attrs["property"] ?? "").trim().toLowerCase();
    if (key === target && tag.attrs["content"]) {
      return decodeHtmlEntitiesBasic(tag.attrs["content"]).trim();
    }
  }
  return null;
}

export function extractJsonLdBlocks(html: string): unknown[] {
  const results: unknown[] = [];
  const blocks = extractTagBlocksLinear(html, "script", {
    maxBlocks: 40,
    maxBodyLen: 524_288,
    attrFilter: (attrs) => (attrs["type"] ?? "").trim().toLowerCase().startsWith("application/ld+json")
  });
  for (const block of blocks) {
    if (results.length >= MAX_JSONLD_NODES) break;
    const raw = block.body.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      collectJsonLdNodes(parsed, results, 0);
    } catch {
      // Some storefronts emit unescaped control characters inside JSON-LD strings; retry once after stripping raw control chars
      try {
        const cleaned = raw.replace(/[\x00-\x1f]/g, " ");
        const parsed = JSON.parse(cleaned) as unknown;
        collectJsonLdNodes(parsed, results, 0);
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }
  }
  return results;
}

function collectJsonLdNodes(node: unknown, out: unknown[], depth: number): void {
  if (depth > MAX_JSONLD_DEPTH || out.length >= MAX_JSONLD_NODES) return;
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (out.length >= MAX_JSONLD_NODES) break;
      collectJsonLdNodes(item, out, depth + 1);
    }
    return;
  }
  out.push(node);
  const record = node as Record<string, unknown>;
  if (Array.isArray(record["@graph"])) {
    for (const item of record["@graph"]) {
      if (out.length >= MAX_JSONLD_NODES) break;
      collectJsonLdNodes(item, out, depth + 1);
    }
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

export function parseJsonLdOffer(rawOffer: unknown, depth = 0): ParsedOfferInfo {
  const empty: ParsedOfferInfo = {
    price: null,
    highPrice: null,
    currency: null,
    available: null,
    sku: null,
    url: null
  };
  if (depth > MAX_JSONLD_DEPTH || !rawOffer || typeof rawOffer !== "object") return empty;

  const offers = (Array.isArray(rawOffer) ? rawOffer : [rawOffer]).slice(0, MAX_JSONLD_OFFERS);
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
    // Nested AggregateOffer.offers (depth-capped)
    if (Array.isArray(o.offers) && depth < MAX_JSONLD_DEPTH) {
      const nested = parseJsonLdOffer(o.offers, depth + 1);
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
  const text = decodeHtmlEntitiesBasic(raw.slice(0, 256)).trim();
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
      if (out.length >= MAX_JSONLD_IMAGES) break;
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
