import {
  asciiLowerCase,
  isSameStoreSite,
  isSameStoreSiteOrSubdomain,
  sanitizeOptionalText,
  sanitizeText,
  stripControlAndInvisible,
  stripHtmlToText,
  stripTagBlocksLinear
} from "../../security/sanitize.js";
import { validateExternalUrl } from "../../security/ssrf.js";
import { formatMoney, normalizeCurrency } from "../shopify/normalize.js";
import type { Money, ProductAvailability, ProductDetail, ProductVariant } from "../types.js";

export const MAX_HTML_PARSE_BYTES = 2 * 1024 * 1024; // 2 MB strict parser cap
const MAX_JSONLD_BLOCKS = 32;
const MAX_JSONLD_NODES = 600;
const MAX_GRAPH_DEPTH = 16;
const MAX_VARIANTS = 100;
const MAX_OFFER_VISITS = 500;
const MAX_IMAGES = 10;
const MAX_SAFE_URL_LENGTH = 2048;

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_"
]);

const LLM_CONTROL_TOKEN_RE = /<\|[^|\r\n]{1,40}\|>|<<\/?SYS>>|\[\/?INST\]/gi;
const LLM_CONTROL_TOKEN_TEST_RE = /<\|[^|\r\n]{1,40}\|>|<<\/?SYS>>|\[\/?INST\]/i;

type JsonObject = Record<string, unknown>;

export interface ParsedProductOutput {
  currency: string;
  product: ProductDetail;
}

export interface SiteMetadataOutput {
  name: string | null;
  currency: string;
  country: string | null;
  hasJsonLd: boolean;
  hasProductJsonLd: boolean;
  searchActionTemplate: string | null;
  openSearchUrl: string | null;
  canonicalOrigin: string | null;
}

interface HtmlMetaHints {
  title: string | null;
  lang: string | null;
  canonicalUrl: string | null;
  openSearchUrl: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImages: string[];
  ogUrl: string | null;
  ogSiteName: string | null;
  ogType: string | null;
  ogPriceAmount: string | null;
  ogPriceCurrency: string | null;
  ogAvailability: string | null;
  productBrand: string | null;
  productSku: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
}

interface ExtractedIdentifiers {
  sku: string | null;
  gtin: string | null;
  ean: string | null;
  mpn: string | null;
}

interface ExtractedOffer {
  idHint: string | null;
  title: string | null;
  sku: string | null;
  gtin: string | null;
  ean: string | null;
  mpn: string | null;
  priceAmount: number | null;
  compareAtAmount: number | null;
  highPriceAmount: number | null;
  currency: string | null;
  availability: ProductAvailability;
  available: boolean;
  url: string | null;
  optionValues: string[];
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function capHtmlInput(html: string): string {
  if (!html) return "";
  // Fast character pre-check before UTF-8 byte-length inspection
  if (html.length <= MAX_HTML_PARSE_BYTES / 4) return html;
  const buf = Buffer.from(html, "utf8");
  if (buf.byteLength <= MAX_HTML_PARSE_BYTES) return html;
  return buf.subarray(0, MAX_HTML_PARSE_BYTES).toString("utf8");
}

function stripPromptInjectionTokens(input: string): string {
  return input.replace(LLM_CONTROL_TOKEN_RE, "");
}

export function sanitizeCatalogText(input: string | null | undefined, maxLen: number): string {
  if (!input) return "";
  const raw = String(input);
  const maxRaw = Math.max(maxLen * 16, 65_536);
  const bounded = raw.length > maxRaw ? raw.slice(0, maxRaw) : raw;
  const noTemplates = stripTagBlocksLinear(bounded, ["template"]);
  const stripped = stripPromptInjectionTokens(stripHtmlToText(noTemplates, maxLen + 64));
  return sanitizeText(stripped, maxLen);
}

export function sanitizeCatalogOptionalText(
  input: string | null | undefined,
  maxLen: number
): string | null {
  const cleaned = sanitizeCatalogText(input, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

export function sanitizeCatalogDescription(
  input: string | null | undefined,
  maxLen = 1500
): string {
  if (!input) return "";
  const raw = String(input);
  const maxRaw = Math.max(maxLen * 16, 65_536);
  const bounded = raw.length > maxRaw ? raw.slice(0, maxRaw) : raw;
  const noTemplates = stripTagBlocksLinear(bounded, ["template"]);
  const stripped = stripPromptInjectionTokens(stripHtmlToText(noTemplates, maxLen + 64));
  const cleaned = stripControlAndInvisible(stripped)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

/**
 * Linear-time HTML attribute parser (no nested-quantifier regexes, immune to ReDoS).
 */
function parseHtmlTagAttributes(attrSlice: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const len = attrSlice.length;
  let i = 0;

  while (i < len) {
    // Skip whitespace and stray slashes
    while (i < len && (attrSlice.charCodeAt(i) <= 32 || attrSlice[i] === "/")) i++;
    if (i >= len) break;

    const nameStart = i;
    while (i < len && attrSlice.charCodeAt(i) > 32 && attrSlice[i] !== "=" && attrSlice[i] !== "/") {
      i++;
    }
    const name = attrSlice.slice(nameStart, i).toLowerCase();
    if (!name) {
      i++;
      continue;
    }

    while (i < len && attrSlice.charCodeAt(i) <= 32) i++;
    if (i >= len || attrSlice[i] !== "=") {
      attrs[name] = "";
      continue;
    }
    i++; // consume '='
    while (i < len && attrSlice.charCodeAt(i) <= 32) i++;
    if (i >= len) {
      attrs[name] = "";
      break;
    }

    const quote = attrSlice[i];
    if (quote === '"' || quote === "'") {
      i++;
      const valStart = i;
      const closeIdx = attrSlice.indexOf(quote, i);
      if (closeIdx === -1) {
        attrs[name] = attrSlice.slice(valStart);
        break;
      }
      attrs[name] = attrSlice.slice(valStart, closeIdx);
      i = closeIdx + 1;
    } else {
      const valStart = i;
      while (i < len && attrSlice.charCodeAt(i) > 32) i++;
      attrs[name] = attrSlice.slice(valStart, i);
    }
  }

  return attrs;
}

/**
 * Find the closing '>' of an HTML start tag starting at openPos, respecting quoted attributes.
 */
function findTagClose(html: string, openPos: number): number {
  let quote: string | null = null;
  const len = html.length;
  for (let i = openPos; i < len; i++) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * Linear-time extractor for <script type="application/ld+json"> bodies.
 * Zero backtracking regexes -> completely safe against ReDoS on adversarial HTML.
 */
export function extractJsonLdScriptBodies(rawHtml: string): string[] {
  const html = capHtmlInput(rawHtml);
  const lower = asciiLowerCase(html);
  const bodies: string[] = [];
  let pos = 0;

  while (pos < lower.length && bodies.length < MAX_JSONLD_BLOCKS) {
    const start = lower.indexOf("<script", pos);
    if (start === -1) break;

    const afterTag = lower[start + 7];
    if (afterTag && afterTag !== ">" && afterTag !== "/" && afterTag.charCodeAt(0) > 32) {
      pos = start + 7;
      continue;
    }

    const openEnd = findTagClose(html, start + 7);
    if (openEnd === -1) break;

    const attrSlice = html.slice(start + 7, openEnd);
    const attrs = parseHtmlTagAttributes(attrSlice);
    const scriptType = (attrs["type"] ?? "").trim().toLowerCase();
    const isJsonLd =
      scriptType === "application/ld+json" ||
      scriptType.startsWith("application/ld+json;");

    const closeStart = lower.indexOf("</script", openEnd + 1);
    if (closeStart === -1) break;
    const closeEnd = lower.indexOf(">", closeStart + 8);
    pos = closeEnd === -1 ? closeStart + 8 : closeEnd + 1;

    if (!isJsonLd) continue;

    let body = html.slice(openEnd + 1, closeStart).trim();
    if (!body) continue;

    // Unwrap optional CDATA / HTML comment wrappers around JSON-LD
    if (body.startsWith("//<![CDATA[")) body = body.slice(11).trim();
    else if (body.startsWith("<![CDATA[")) body = body.slice(9).trim();
    if (body.endsWith("//]]>")) body = body.slice(0, -5).trim();
    else if (body.endsWith("]]>")) body = body.slice(0, -3).trim();
    if (body.startsWith("<!--")) body = body.slice(4).trim();
    if (body.endsWith("-->")) body = body.slice(0, -3).trim();

    if (body) bodies.push(body);
  }

  return bodies;
}

/**
 * Linear-time extractor for <meta>, <link>, <title>, and <html lang> tags.
 */
function extractHtmlMetaHints(rawHtml: string): HtmlMetaHints {
  const html = capHtmlInput(rawHtml);
  const lower = asciiLowerCase(html);
  const hints: HtmlMetaHints = {
    title: null,
    lang: null,
    canonicalUrl: null,
    openSearchUrl: null,
    metaDescription: null,
    ogTitle: null,
    ogDescription: null,
    ogImages: [],
    ogUrl: null,
    ogSiteName: null,
    ogType: null,
    ogPriceAmount: null,
    ogPriceCurrency: null,
    ogAvailability: null,
    productBrand: null,
    productSku: null,
    twitterTitle: null,
    twitterDescription: null,
    twitterImage: null
  };

  // Extract <html lang="...">
  const htmlTagIdx = lower.indexOf("<html");
  if (htmlTagIdx !== -1) {
    const htmlTagEnd = findTagClose(html, htmlTagIdx + 5);
    if (htmlTagEnd !== -1) {
      const attrs = parseHtmlTagAttributes(html.slice(htmlTagIdx + 5, htmlTagEnd));
      if (attrs["lang"]) hints.lang = attrs["lang"].trim();
    }
  }

  // Extract <title>...</title>
  const titleIdx = lower.indexOf("<title");
  if (titleIdx !== -1) {
    const titleOpenEnd = findTagClose(html, titleIdx + 6);
    if (titleOpenEnd !== -1) {
      const titleClose = lower.indexOf("</title", titleOpenEnd + 1);
      if (titleClose !== -1 && titleClose - titleOpenEnd < 2000) {
        hints.title = sanitizeCatalogOptionalText(html.slice(titleOpenEnd + 1, titleClose), 200);
      }
    }
  }

  // Scan <meta ...> tags linearly
  let pos = 0;
  let tagCount = 0;
  while (pos < lower.length && tagCount < 500) {
    const idx = lower.indexOf("<meta", pos);
    if (idx === -1) break;
    const nextCh = lower[idx + 5];
    if (nextCh && nextCh !== ">" && nextCh !== "/" && nextCh.charCodeAt(0) > 32) {
      pos = idx + 5;
      continue;
    }
    const end = findTagClose(html, idx + 5);
    if (end === -1) break;
    pos = end + 1;
    tagCount++;

    const attrs = parseHtmlTagAttributes(html.slice(idx + 5, end));
    const key = (attrs["property"] || attrs["name"] || attrs["itemprop"] || "").trim().toLowerCase();
    const content = attrs["content"];
    if (!key || content === undefined || content.trim() === "") continue;

    switch (key) {
      case "og:title":
        hints.ogTitle ??= content;
        break;
      case "og:description":
        hints.ogDescription ??= content;
        break;
      case "og:image":
      case "og:image:secure_url":
      case "og:image:url":
        if (hints.ogImages.length < MAX_IMAGES) hints.ogImages.push(content);
        break;
      case "og:url":
        hints.ogUrl ??= content;
        break;
      case "og:site_name":
        hints.ogSiteName ??= content;
        break;
      case "og:type":
        hints.ogType ??= content.trim().toLowerCase();
        break;
      case "product:price:amount":
      case "og:price:amount":
      case "price":
        if (key === "product:price:amount" || !hints.ogPriceAmount) {
          hints.ogPriceAmount = content;
        }
        break;
      case "product:price:currency":
      case "og:price:currency":
      case "pricecurrency":
        if (key === "product:price:currency" || !hints.ogPriceCurrency) {
          hints.ogPriceCurrency = content;
        }
        break;
      case "product:availability":
      case "og:availability":
      case "availability":
        if (key === "product:availability" || !hints.ogAvailability) {
          hints.ogAvailability = content;
        }
        break;
      case "product:brand":
      case "brand":
        hints.productBrand ??= content;
        break;
      case "product:retailer_item_id":
      case "sku":
        hints.productSku ??= content;
        break;
      case "description":
        hints.metaDescription ??= content;
        break;
      case "twitter:title":
        hints.twitterTitle ??= content;
        break;
      case "twitter:description":
        hints.twitterDescription ??= content;
        break;
      case "twitter:image":
        hints.twitterImage ??= content;
        break;
      default:
        break;
    }
  }

  // Scan <link ...> tags linearly for canonical & opensearch
  pos = 0;
  tagCount = 0;
  while (pos < lower.length && tagCount < 300) {
    const idx = lower.indexOf("<link", pos);
    if (idx === -1) break;
    const nextCh = lower[idx + 5];
    if (nextCh && nextCh !== ">" && nextCh !== "/" && nextCh.charCodeAt(0) > 32) {
      pos = idx + 5;
      continue;
    }
    const end = findTagClose(html, idx + 5);
    if (end === -1) break;
    pos = end + 1;
    tagCount++;

    const attrs = parseHtmlTagAttributes(html.slice(idx + 5, end));
    const rel = (attrs["rel"] ?? "").trim().toLowerCase();
    const href = (attrs["href"] ?? "").trim();
    if (!rel || !href) continue;

    const relTokens = rel.split(/\s+/);
    if (relTokens.includes("canonical") && !hints.canonicalUrl) {
      hints.canonicalUrl = href;
    } else if (
      relTokens.includes("search") &&
      (attrs["type"] ?? "").toLowerCase().includes("opensearchdescription") &&
      !hints.openSearchUrl
    ) {
      hints.openSearchUrl = href;
    }
  }

  return hints;
}

function safeParseJsonLd(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    // Tolerate raw unescaped control chars inside merchant JSON-LD strings
    const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ");
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function normalizeSchemaType(rawType: string): string {
  const trimmed = rawType.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("https://schema.org/")) return trimmed.slice(19).toLowerCase();
  if (lower.startsWith("http://schema.org/")) return trimmed.slice(18).toLowerCase();
  if (lower.startsWith("schema:")) return trimmed.slice(7).toLowerCase();
  const hashIdx = trimmed.lastIndexOf("#");
  if (hashIdx !== -1) return trimmed.slice(hashIdx + 1).toLowerCase();
  const slashIdx = trimmed.lastIndexOf("/");
  if (slashIdx !== -1) return trimmed.slice(slashIdx + 1).toLowerCase();
  return lower;
}

function getSchemaTypes(node: JsonObject): string[] {
  const raw = node["@type"];
  if (typeof raw === "string") return [normalizeSchemaType(raw)];
  if (Array.isArray(raw)) {
    return raw
      .filter((t): t is string => typeof t === "string")
      .map(normalizeSchemaType);
  }
  return [];
}

function hasSchemaType(node: JsonObject, targets: string[]): boolean {
  const types = getSchemaTypes(node);
  return types.some((t) => targets.includes(t));
}

const PRODUCT_TYPES = ["product", "productmodel", "individualproduct", "someproducts"];
const PRODUCT_GROUP_TYPES = ["productgroup"];
const OFFER_TYPES = ["offer", "aggregateoffer"];

export function normalizeSchemaCurrency(raw: string | null | undefined, fallback = "USD"): string {
  if (!raw || typeof raw !== "string") return normalizeCurrency(undefined, fallback);
  const trimmed = raw.trim();
  if (!trimmed) return normalizeCurrency(undefined, fallback);
  if (trimmed === "€" || trimmed.toLowerCase() === "euro") return "EUR";
  if (trimmed === "$" || trimmed.toLowerCase() === "us$") return "USD";
  if (trimmed === "£") return "GBP";
  if (trimmed === "¥") return "JPY";
  if (trimmed.toLowerCase() === "fr." || trimmed.toLowerCase() === "sfr" || trimmed.toLowerCase() === "sfr.") {
    return "CHF";
  }
  return normalizeCurrency(trimmed, fallback);
}

export function inferCurrencyFromUrl(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host.endsWith(".ch")) return "CHF";
    if (host.endsWith(".uk") || host.endsWith(".co.uk")) return "GBP";
    if (host.endsWith(".jp") || host.endsWith(".co.jp")) return "JPY";
    if (host.endsWith(".se")) return "SEK";
    if (host.endsWith(".dk")) return "DKK";
    if (host.endsWith(".no")) return "NOK";
    if (host.endsWith(".pl")) return "PLN";
    if (host.endsWith(".cz")) return "CZK";
    if (
      host.endsWith(".de") ||
      host.endsWith(".at") ||
      host.endsWith(".fr") ||
      host.endsWith(".it") ||
      host.endsWith(".es") ||
      host.endsWith(".nl") ||
      host.endsWith(".be") ||
      host.endsWith(".eu") ||
      host.endsWith(".ie") ||
      host.endsWith(".pt") ||
      host.endsWith(".fi") ||
      host.endsWith(".lu")
    ) {
      return "EUR";
    }
  } catch {
    // ignore
  }
  return "USD";
}

export function inferCountryFromHints(rawUrl: string, lang: string | null): string | null {
  if (lang) {
    const parts = lang.split(/[-_]/);
    if (parts.length >= 2 && /^[a-zA-Z]{2}$/.test(parts[1]!)) {
      return parts[1]!.toUpperCase();
    }
  }
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const tld = host.slice(host.lastIndexOf(".") + 1);
    if (
      ["de", "at", "ch", "fr", "it", "es", "nl", "be", "pl", "se", "dk", "no", "fi", "ie", "pt", "jp"].includes(
        tld
      )
    ) {
      return tld.toUpperCase();
    }
    if (tld === "uk") return "GB";
  } catch {
    // ignore
  }
  return null;
}

export function parseSchemaPrice(
  raw: unknown,
  currencyHint?: string
): { amount: number; detectedCurrency: string | null } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > 1_000_000_000) return null;
    return { amount: raw, detectedCurrency: null };
  }
  if (typeof raw !== "string") return null;

  let text = stripControlAndInvisible(raw).trim();
  if (!text) return null;

  let detectedCurrency: string | null = null;
  if (text.includes("€")) detectedCurrency = "EUR";
  else if (text.includes("£")) detectedCurrency = "GBP";
  else if (/\bCHF\b/i.test(text) || /SFr\.?/i.test(text)) detectedCurrency = "CHF";
  else if (text.includes("$")) detectedCurrency = "USD";
  else if (/\bEUR\b/i.test(text)) detectedCurrency = "EUR";
  else if (/\bUSD\b/i.test(text)) detectedCurrency = "USD";
  else if (/\bGBP\b/i.test(text)) detectedCurrency = "GBP";

  // Handle German/EU trailing dash conventions like "299,-" or "299.--"
  text = text.replace(/([.,])-{1,2}(?=\s|$|€)/g, "");
  // Remove spaces, NBSP, thin spaces, apostrophe thousands separators, currency text
  text = text
    .replace(/[\s\u00A0\u202F']/g, "")
    .replace(/[^0-9.,-]/g, "");

  if (!text || text === "-" || text.startsWith("-")) return null;
  // Strip any stray trailing minus
  text = text.replace(/-/g, "");

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");

  let normalized: string;
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      // European format: 1.299,99
      normalized = text.replace(/\./g, "").replace(",", ".");
    } else {
      // US/UK format: 1,299.99
      normalized = text.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const commaCount = (text.match(/,/g) ?? []).length;
    const digitsAfter = text.length - lastComma - 1;
    const isThreeDecCurrency = currencyHint
      ? ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currencyHint.toUpperCase())
      : false;
    if (commaCount === 1 && (digitsAfter === 1 || digitsAfter === 2 || (digitsAfter === 3 && isThreeDecCurrency))) {
      normalized = text.replace(",", ".");
    } else {
      normalized = text.replace(/,/g, "");
    }
  } else if (lastDot !== -1) {
    const dotCount = (text.match(/\./g) ?? []).length;
    if (dotCount > 1) {
      normalized = text.replace(/\./g, "");
    } else {
      normalized = text;
    }
  } else {
    normalized = text;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000) return null;
  return { amount: parsed, detectedCurrency };
}

export function normalizeSchemaAvailability(
  raw: unknown,
  defaultWhenMissing: { status: ProductAvailability; available: boolean } = {
    status: "Unknown",
    available: true
  }
): { status: ProductAvailability; available: boolean } {
  if (typeof raw !== "string" || !raw.trim()) {
    return defaultWhenMissing;
  }
  const stripped = normalizeSchemaType(raw).replace(/[^a-z]/g, "");
  switch (stripped) {
    case "instock":
    case "available":
    case "onlineonly":
    case "instoreonly":
    case "availablefororder":
      return { status: "InStock", available: true };
    case "limitedavailability":
    case "lowstock":
      return { status: "LimitedAvailability", available: true };
    case "preorder":
    case "presale":
    case "backorder":
      return { status: "PreOrder", available: true };
    case "outofstock":
    case "soldout":
    case "discontinued":
    case "unavailable":
    case "oos":
      return { status: "OutOfStock", available: false };
    default:
      return defaultWhenMissing;
  }
}

export function isSameStoreHost(candidateHost: string, storeHost: string): boolean {
  const a = candidateHost.toLowerCase().replace(/\.$/, "");
  const b = storeHost.toLowerCase().replace(/\.$/, "");
  if (!a || !b) return false;
  return isSameStoreSiteOrSubdomain(`https://${b}`, `https://${a}`);
}

export function sanitizeUniversalProductUrl(
  rawUrl: unknown,
  pageUrl: string
): string | null {
  if (typeof rawUrl !== "string") return null;
  const cleaned = stripControlAndInvisible(rawUrl).trim();
  if (!cleaned || cleaned.length > MAX_SAFE_URL_LENGTH) return null;

  let resolved: string;
  try {
    resolved = new URL(cleaned, pageUrl).toString();
  } catch {
    return null;
  }
  if (resolved.length > MAX_SAFE_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = validateExternalUrl(resolved);
  } catch {
    return null;
  }

  try {
    const pageHost = new URL(pageUrl).hostname;
    if (!isSameStoreHost(parsed.hostname, pageHost)) {
      return null;
    }
  } catch {
    return null;
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.hash = "";
  const finalUrl = parsed.toString();
  return finalUrl.length <= MAX_SAFE_URL_LENGTH ? finalUrl : null;
}

export function sanitizeUniversalImageUrl(rawUrl: unknown, pageUrl: string): string | null {
  let candidate: string | null = null;
  if (typeof rawUrl === "string") {
    candidate = rawUrl;
  } else if (isObject(rawUrl)) {
    const u = rawUrl["url"] ?? rawUrl["contentUrl"] ?? rawUrl["@id"];
    if (typeof u === "string") candidate = u;
  }
  if (!candidate) return null;

  let trimmed = stripControlAndInvisible(candidate).trim();
  if (!trimmed || trimmed.length > MAX_SAFE_URL_LENGTH) return null;
  if (trimmed.startsWith("//")) {
    trimmed = `https:${trimmed}`;
  }

  let resolved: string;
  try {
    resolved = new URL(trimmed, pageUrl).toString();
  } catch {
    return null;
  }
  if (resolved.length > MAX_SAFE_URL_LENGTH) return null;

  try {
    const parsed = validateExternalUrl(resolved);
    const finalUrl = parsed.toString();
    return finalUrl.length <= MAX_SAFE_URL_LENGTH ? finalUrl : null;
  } catch {
    return null;
  }
}

function extractImages(rawImage: unknown, pageUrl: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const item of asArray(rawImage)) {
    const url = sanitizeUniversalImageUrl(item, pageUrl);
    if (url && !seen.has(url)) {
      seen.add(url);
      results.push(url);
      if (results.length >= MAX_IMAGES) break;
    }
  }
  return results;
}

function extractBrandName(rawBrand: unknown): string | null {
  if (typeof rawBrand === "string") {
    return sanitizeCatalogOptionalText(rawBrand, 100);
  }
  if (Array.isArray(rawBrand)) {
    for (const item of rawBrand) {
      const found = extractBrandName(item);
      if (found) return found;
    }
    return null;
  }
  if (isObject(rawBrand)) {
    const name = rawBrand["name"] ?? rawBrand["alternateName"];
    if (typeof name === "string") {
      return sanitizeCatalogOptionalText(name, 100);
    }
  }
  return null;
}

function extractCategory(rawCategory: unknown): string | null {
  if (typeof rawCategory === "string") {
    return sanitizeCatalogOptionalText(rawCategory, 100);
  }
  if (isObject(rawCategory) && typeof rawCategory["name"] === "string") {
    return sanitizeCatalogOptionalText(rawCategory["name"], 100);
  }
  if (Array.isArray(rawCategory)) {
    for (const item of rawCategory) {
      const found = extractCategory(item);
      if (found) return found;
    }
  }
  return null;
}

function extractIdentifiers(node: JsonObject): ExtractedIdentifiers {
  const readId = (key: string): string | null => {
    const val = node[key];
    if (typeof val === "string" || typeof val === "number") {
      return sanitizeCatalogOptionalText(String(val), 80);
    }
    return null;
  };

  const sku = readId("sku") ?? readId("productID");
  const gtin13 = readId("gtin13");
  const gtin14 = readId("gtin14");
  const gtin12 = readId("gtin12");
  const gtin8 = readId("gtin8");
  const gtinRaw = readId("gtin");
  const eanRaw = readId("ean") ?? readId("isbn");
  const mpn = readId("mpn");

  const gtin = gtin13 ?? gtin14 ?? gtinRaw ?? gtin12 ?? gtin8 ?? eanRaw ?? null;
  const ean =
    eanRaw ??
    gtin13 ??
    (gtinRaw && /^\d{13}$/.test(gtinRaw) ? gtinRaw : null);

  return { sku, gtin, ean, mpn };
}

function resolveRef(value: unknown, idMap: Map<string, JsonObject>): unknown {
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (typeof value["@id"] === "string" && keys.length <= 2) {
      const target = idMap.get(value["@id"]);
      if (target) return target;
    }
  }
  return value;
}

function collectJsonLdGraph(parsedBlocks: unknown[]): {
  nodes: JsonObject[];
  idMap: Map<string, JsonObject>;
  primaryNodes: Set<JsonObject>;
  deprioritizedNodes: Set<JsonObject>;
} {
  const nodes: JsonObject[] = [];
  const idMap = new Map<string, JsonObject>();
  const primaryNodes = new Set<JsonObject>();
  const deprioritizedNodes = new Set<JsonObject>();
  const visited = new Set<unknown>();

  const walk = (
    value: unknown,
    depth: number,
    isPrimaryContext: boolean,
    isDeprioritized: boolean
  ): void => {
    if (depth > MAX_GRAPH_DEPTH || nodes.length >= MAX_JSONLD_NODES || !value) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, depth + 1, isPrimaryContext, isDeprioritized);
      }
      return;
    }
    if (!isObject(value)) return;
    if (visited.has(value)) return;
    visited.add(value);

    nodes.push(value);
    if (typeof value["@id"] === "string" && value["@id"].trim()) {
      // Prefer richer node if same @id appears both as stub reference and full definition
      const existing = idMap.get(value["@id"]);
      if (!existing || Object.keys(value).length > Object.keys(existing).length) {
        idMap.set(value["@id"], value);
      }
    }
    if (isPrimaryContext && !isDeprioritized) {
      primaryNodes.add(value);
    }
    if (isDeprioritized) {
      deprioritizedNodes.add(value);
    }

    if (Array.isArray(value["@graph"])) {
      walk(value["@graph"], depth + 1, true, isDeprioritized);
    }
    if (value["mainEntity"]) {
      walk(value["mainEntity"], depth + 1, true, false);
    }
    if (value["mainEntityOfPage"]) {
      walk(value["mainEntityOfPage"], depth + 1, false, isDeprioritized);
    }

    for (const [k, v] of Object.entries(value)) {
      if (k === "@graph" || k === "mainEntity" || k === "mainEntityOfPage") continue;
      if (v === null || typeof v !== "object") continue;
      const lowerKey = k.toLowerCase();
      const childDeprioritized =
        isDeprioritized ||
        lowerKey === "isrelatedto" ||
        lowerKey === "issimilarto" ||
        lowerKey === "itemlistelement";
      walk(v, depth + 1, false, childDeprioritized);
    }
  };

  for (const block of parsedBlocks) {
    walk(block, 0, true, false);
  }

  return { nodes, idMap, primaryNodes, deprioritizedNodes };
}

function extractOfferPriceSpec(
  offer: JsonObject,
  currencyHint?: string
): {
  priceAmount: number | null;
  compareAtAmount: number | null;
  currency: string | null;
} {
  let priceAmount: number | null = null;
  let compareAtAmount: number | null = null;
  let currency: string | null =
    typeof offer["priceCurrency"] === "string" ? offer["priceCurrency"] : null;

  const directPrice = parseSchemaPrice(offer["price"], currency ?? currencyHint);
  if (directPrice) {
    priceAmount = directPrice.amount;
    currency ??= directPrice.detectedCurrency;
  }

  const specs = asArray(offer["priceSpecification"]);
  for (const rawSpec of specs) {
    if (!isObject(rawSpec)) continue;
    const specCurrency =
      typeof rawSpec["priceCurrency"] === "string" ? rawSpec["priceCurrency"] : currency;
    const specPrice = parseSchemaPrice(rawSpec["price"], specCurrency ?? currencyHint);
    if (!specPrice) continue;

    const priceType =
      typeof rawSpec["priceType"] === "string"
        ? normalizeSchemaType(rawSpec["priceType"])
        : "";

    if (priceType.includes("listprice") || priceType.includes("strikethroughprice") || priceType.includes("msrp")) {
      compareAtAmount = specPrice.amount;
    } else if (priceAmount === null) {
      priceAmount = specPrice.amount;
      currency = specCurrency ?? specPrice.detectedCurrency ?? currency;
    } else if (specPrice.amount > priceAmount && compareAtAmount === null && priceType) {
      compareAtAmount = specPrice.amount;
    }
  }

  return { priceAmount, compareAtAmount, currency };
}

function extractOffersFromField(
  rawOffers: unknown,
  idMap: Map<string, JsonObject>,
  pageUrl: string,
  currencyHint: string,
  fallbackAvailability?: { status: ProductAvailability; available: boolean }
): ExtractedOffer[] {
  const results: ExtractedOffer[] = [];
  const visited = new Set<JsonObject>();
  let totalVisits = 0;

  const processOfferNode = (rawNode: unknown, depth: number): void => {
    if (depth > 4 || results.length >= MAX_VARIANTS || totalVisits >= MAX_OFFER_VISITS) return;
    totalVisits++;
    const resolved = resolveRef(rawNode, idMap);
    if (Array.isArray(resolved)) {
      for (const item of resolved) {
        if (results.length >= MAX_VARIANTS || totalVisits >= MAX_OFFER_VISITS) break;
        processOfferNode(item, depth + 1);
      }
      return;
    }
    if (!isObject(resolved)) return;
    if (visited.has(resolved)) return;
    visited.add(resolved);

    const types = getSchemaTypes(resolved);
    const isAggregate = types.includes("aggregateoffer");

    // AggregateOffer may contain an explicit nested `offers` list — prefer individual offers when present
    if (isAggregate && resolved["offers"]) {
      const nestedCountBefore = results.length;
      processOfferNode(resolved["offers"], depth + 1);
      if (results.length > nestedCountBefore) {
        return;
      }
    }

    const offerIds = extractIdentifiers(resolved);
    const offerUrl = sanitizeUniversalProductUrl(resolved["url"], pageUrl);
    const offerName = sanitizeCatalogOptionalText(
      typeof resolved["name"] === "string" ? resolved["name"] : null,
      120
    );

    const avail = normalizeSchemaAvailability(
      resolved["availability"],
      fallbackAvailability ?? { status: "Unknown", available: true }
    );

    if (isAggregate) {
      const offerCurrencyRaw =
        typeof resolved["priceCurrency"] === "string" ? resolved["priceCurrency"] : null;
      const lowParsed = parseSchemaPrice(resolved["lowPrice"], offerCurrencyRaw ?? currencyHint);
      const highParsed = parseSchemaPrice(resolved["highPrice"], offerCurrencyRaw ?? currencyHint);
      const directParsed = parseSchemaPrice(resolved["price"], offerCurrencyRaw ?? currencyHint);
      const priceAmount = lowParsed?.amount ?? directParsed?.amount ?? highParsed?.amount ?? null;
      const currency =
        offerCurrencyRaw ??
        lowParsed?.detectedCurrency ??
        directParsed?.detectedCurrency ??
        highParsed?.detectedCurrency ??
        null;

      if (priceAmount !== null) {
        results.push({
          idHint: offerIds.sku ?? offerIds.gtin ?? null,
          title: offerName,
          sku: offerIds.sku,
          gtin: offerIds.gtin,
          ean: offerIds.ean,
          mpn: offerIds.mpn,
          priceAmount,
          compareAtAmount: null,
          highPriceAmount: highParsed?.amount ?? null,
          currency,
          availability: avail.status,
          available: avail.available,
          url: offerUrl,
          optionValues: []
        });
      }
      return;
    }

    // Standard Offer (or untyped offer object with price/priceSpecification)
    if (
      types.length === 0 ||
      hasSchemaType(resolved, OFFER_TYPES) ||
      resolved["price"] !== undefined ||
      resolved["priceSpecification"] !== undefined
    ) {
      const { priceAmount, compareAtAmount, currency } = extractOfferPriceSpec(
        resolved,
        currencyHint
      );
      if (priceAmount !== null) {
        results.push({
          idHint: offerIds.sku ?? offerIds.gtin ?? null,
          title: offerName,
          sku: offerIds.sku,
          gtin: offerIds.gtin,
          ean: offerIds.ean,
          mpn: offerIds.mpn,
          priceAmount,
          compareAtAmount:
            compareAtAmount !== null && compareAtAmount > priceAmount ? compareAtAmount : null,
          highPriceAmount: null,
          currency,
          availability: avail.status,
          available: avail.available,
          url: offerUrl,
          optionValues: []
        });
      }
    }
  };

  processOfferNode(rawOffers, 0);
  return results;
}

function extractVariantAttributes(node: JsonObject): Array<{ name: string; value: string }> {
  const attrs: Array<{ name: string; value: string }> = [];
  const namedFields: Array<[string, string]> = [
    ["color", "Color"],
    ["size", "Size"],
    ["material", "Material"],
    ["pattern", "Pattern"]
  ];
  for (const [field, label] of namedFields) {
    const raw = node[field];
    if (typeof raw === "string") {
      const val = sanitizeCatalogOptionalText(raw, 80);
      if (val) attrs.push({ name: label, value: val });
    } else if (isObject(raw) && typeof raw["name"] === "string") {
      const val = sanitizeCatalogOptionalText(raw["name"], 80);
      if (val) attrs.push({ name: label, value: val });
    }
  }

  for (const prop of asArray(node["additionalProperty"])) {
    if (!isObject(prop)) continue;
    const name = sanitizeCatalogOptionalText(
      typeof prop["name"] === "string" ? prop["name"] : null,
      60
    );
    const value = sanitizeCatalogOptionalText(
      typeof prop["value"] === "string" || typeof prop["value"] === "number"
        ? String(prop["value"])
        : null,
      80
    );
    if (name && value && attrs.length < 6) {
      attrs.push({ name, value });
    }
  }

  return attrs;
}

function deriveHandleFromUrl(url: string, fallbackSku: string | null): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      let decoded = last;
      try {
        decoded = decodeURIComponent(last);
      } catch {
        // keep raw segment
      }
      const cleaned = sanitizeCatalogText(decoded.replace(/\.(html?|php|aspx?)$/i, ""), 200);
      if (cleaned) return cleaned;
    }
  } catch {
    // ignore
  }
  return fallbackSku ?? "product";
}

function scoreProductCandidate(
  node: JsonObject,
  pageUrl: string,
  primaryNodes: Set<JsonObject>,
  deprioritizedNodes: Set<JsonObject>,
  idMap: Map<string, JsonObject>
): number {
  let score = 0;
  const isGroup = hasSchemaType(node, PRODUCT_GROUP_TYPES);
  if (isGroup && node["hasVariant"]) score += 45;
  if (primaryNodes.has(node)) score += 30;
  if (deprioritizedNodes.has(node)) score -= 40;
  if (typeof node["name"] === "string" && node["name"].trim()) score += 10;
  if (node["offers"]) score += 25;
  if (node["sku"] || node["gtin13"] || node["gtin"] || node["mpn"]) score += 8;
  if (typeof node["description"] === "string" && node["description"].trim()) score += 5;

  const nodeUrl = sanitizeUniversalProductUrl(node["url"], pageUrl);
  if (nodeUrl) {
    try {
      const a = new URL(nodeUrl);
      const b = new URL(pageUrl);
      if (a.pathname === b.pathname) score += 20;
    } catch {
      // ignore
    }
  }

  // If ProductGroup has variants with offers, give extra boost
  if (isGroup) {
    const variants = asArray(node["hasVariant"])
      .map((v) => resolveRef(v, idMap))
      .filter(isObject);
    if (variants.some((v) => Boolean(v["offers"]))) {
      score += 25;
    }
  }

  return score;
}

function buildFromProductGroup(
  group: JsonObject,
  idMap: Map<string, JsonObject>,
  hints: HtmlMetaHints,
  pageUrl: string,
  fallbackCurrency: string
): ParsedProductOutput | null {
  const groupTitle =
    sanitizeCatalogOptionalText(typeof group["name"] === "string" ? group["name"] : null, 200) ??
    sanitizeCatalogOptionalText(hints.ogTitle ?? hints.twitterTitle ?? hints.title, 200);
  if (!groupTitle) return null;

  const groupBrand =
    extractBrandName(group["brand"] ?? group["manufacturer"]) ??
    sanitizeCatalogOptionalText(hints.productBrand, 100);
  const groupCategory = extractCategory(group["category"]);
  const groupIds = extractIdentifiers(group);
  const groupDesc =
    sanitizeCatalogDescription(
      typeof group["description"] === "string" ? group["description"] : null,
      1500
    ) ||
    sanitizeCatalogDescription(hints.ogDescription ?? hints.metaDescription, 1500);

  const canonicalUrl =
    sanitizeUniversalProductUrl(group["url"], pageUrl) ??
    sanitizeUniversalProductUrl(hints.canonicalUrl, pageUrl) ??
    sanitizeUniversalProductUrl(hints.ogUrl, pageUrl) ??
    sanitizeUniversalProductUrl(pageUrl, pageUrl) ??
    pageUrl;

  const images = extractImages(group["image"], pageUrl);
  const optionMap = new Map<string, Set<string>>();
  const variants: ProductVariant[] = [];
  let resolvedCurrency: string | null = null;
  let usedOpenGraphFallback = false;

  const ogAvailFallback = hints.ogAvailability
    ? normalizeSchemaAvailability(hints.ogAvailability)
    : undefined;

  const seenVariantNodes = new Set<JsonObject>();
  const rawVariants: JsonObject[] = [];
  for (const v of asArray(group["hasVariant"])) {
    if (rawVariants.length >= MAX_VARIANTS) break;
    const resolved = resolveRef(v, idMap);
    if (isObject(resolved) && !seenVariantNodes.has(resolved)) {
      seenVariantNodes.add(resolved);
      rawVariants.push(resolved);
    }
  }

  for (let i = 0; i < rawVariants.length; i++) {
    const vNode = rawVariants[i]!;
    const vIds = extractIdentifiers(vNode);
    const vTitle = sanitizeCatalogOptionalText(
      typeof vNode["name"] === "string" ? vNode["name"] : null,
      120
    );
    const vUrl = sanitizeUniversalProductUrl(vNode["url"], pageUrl);
    for (const img of extractImages(vNode["image"], pageUrl)) {
      if (images.length < MAX_IMAGES && !images.includes(img)) images.push(img);
    }

    const attrs = extractVariantAttributes(vNode);
    for (const attr of attrs) {
      let set = optionMap.get(attr.name);
      if (!set) {
        set = new Set<string>();
        optionMap.set(attr.name, set);
      }
      set.add(attr.value);
    }
    const optionValues = attrs.map((a) => a.value);

    const offers = extractOffersFromField(
      vNode["offers"],
      idMap,
      pageUrl,
      fallbackCurrency,
      ogAvailFallback
    );

    for (const offer of offers) {
      if (offer.priceAmount === null) continue;
      const offerCurrency = normalizeSchemaCurrency(
        offer.currency ?? hints.ogPriceCurrency,
        resolvedCurrency ?? fallbackCurrency
      );
      resolvedCurrency ??= offerCurrency;
      const sku = offer.sku ?? vIds.sku ?? groupIds.sku;
      const gtin = offer.gtin ?? vIds.gtin ?? groupIds.gtin;
      const ean = offer.ean ?? vIds.ean ?? groupIds.ean;
      const mpn = offer.mpn ?? vIds.mpn ?? groupIds.mpn;
      const id =
        sku ?? gtin ?? mpn ?? `variant-${variants.length + 1}`;
      const displayTitle =
        optionValues.length > 0
          ? optionValues.join(" / ")
          : offer.title ?? vTitle ?? `Variant ${variants.length + 1}`;

      variants.push({
        id,
        title: displayTitle,
        sku,
        gtin,
        ean,
        mpn,
        available: offer.available,
        availability: offer.availability,
        price: formatMoney(offer.priceAmount, offerCurrency),
        compare_at_price:
          offer.compareAtAmount !== null
            ? formatMoney(offer.compareAtAmount, offerCurrency)
            : null,
        option_values: optionValues,
        url: offer.url ?? vUrl ?? canonicalUrl
      });
    }
  }

  // Fallback to group-level offers if variants had no offers
  if (variants.length === 0 && group["offers"]) {
    const groupOffers = extractOffersFromField(
      group["offers"],
      idMap,
      pageUrl,
      fallbackCurrency,
      ogAvailFallback
    );
    for (const offer of groupOffers) {
      if (offer.priceAmount === null) continue;
      const offerCurrency = normalizeSchemaCurrency(
        offer.currency ?? hints.ogPriceCurrency,
        resolvedCurrency ?? fallbackCurrency
      );
      resolvedCurrency ??= offerCurrency;
      const sku = offer.sku ?? groupIds.sku;
      const gtin = offer.gtin ?? groupIds.gtin;
      const ean = offer.ean ?? groupIds.ean;
      const mpn = offer.mpn ?? groupIds.mpn;
      variants.push({
        id: sku ?? gtin ?? mpn ?? `variant-${variants.length + 1}`,
        title: offer.title ?? "Default",
        sku,
        gtin,
        ean,
        mpn,
        available: offer.available,
        availability: offer.availability,
        price: formatMoney(offer.priceAmount, offerCurrency),
        compare_at_price:
          offer.compareAtAmount !== null
            ? formatMoney(offer.compareAtAmount, offerCurrency)
            : null,
        option_values: [],
        url: offer.url ?? canonicalUrl
      });
    }
  }

  if (images.length === 0) {
    for (const ogImg of [...hints.ogImages, hints.twitterImage]) {
      const safe = sanitizeUniversalImageUrl(ogImg, pageUrl);
      if (safe && !images.includes(safe) && images.length < MAX_IMAGES) {
        images.push(safe);
        usedOpenGraphFallback = true;
      }
    }
  }

  if (variants.length === 0) {
    return null;
  }

  const finalCurrency = resolvedCurrency ?? fallbackCurrency;
  const priceMin = variants.reduce(
    (min, v) => (v.price.amount < min.amount ? v.price : min),
    variants[0]!.price
  );
  const priceMax = variants.reduce(
    (max, v) => (v.price.amount > max.amount ? v.price : max),
    variants[0]!.price
  );
  const overallAvailability = pickOverallAvailability(variants);

  const options = Array.from(optionMap.entries()).map(([name, valSet]) => ({
    name,
    values: Array.from(valSet)
  }));

  const handle = deriveHandleFromUrl(canonicalUrl, groupIds.sku ?? variants[0]?.sku ?? null);
  const productId =
    sanitizeCatalogOptionalText(
      typeof group["productGroupID"] === "string" ? group["productGroupID"] : null,
      80
    ) ??
    groupIds.sku ??
    groupIds.gtin ??
    handle;

  return {
    currency: finalCurrency,
    product: {
      id: productId,
      handle,
      title: groupTitle,
      vendor: groupBrand,
      product_type: groupCategory,
      description_text: groupDesc,
      sku: groupIds.sku ?? variants[0]?.sku ?? null,
      gtin: groupIds.gtin ?? variants[0]?.gtin ?? null,
      ean: groupIds.ean ?? variants[0]?.ean ?? null,
      mpn: groupIds.mpn ?? variants[0]?.mpn ?? null,
      available: variants.some((v) => v.available),
      availability: overallAvailability,
      price_min: priceMin,
      price_max: priceMax,
      metadata_source: usedOpenGraphFallback ? "jsonld+opengraph" : "jsonld",
      url: canonicalUrl,
      options,
      images,
      variants
    }
  };
}

function pickOverallAvailability(variants: ProductVariant[]): ProductAvailability {
  const statuses = variants.map((v) => v.availability ?? (v.available ? "InStock" : "OutOfStock"));
  if (statuses.includes("InStock")) return "InStock";
  if (statuses.includes("LimitedAvailability")) return "LimitedAvailability";
  if (statuses.includes("PreOrder")) return "PreOrder";
  if (statuses.includes("OutOfStock")) return "OutOfStock";
  return "Unknown";
}

function buildFromProductNode(
  node: JsonObject,
  idMap: Map<string, JsonObject>,
  hints: HtmlMetaHints,
  pageUrl: string,
  fallbackCurrency: string
): ParsedProductOutput | null {
  let usedOpenGraphFallback = false;

  const jsonLdTitle = sanitizeCatalogOptionalText(
    typeof node["name"] === "string" ? node["name"] : null,
    200
  );
  const title =
    jsonLdTitle ??
    sanitizeCatalogOptionalText(hints.ogTitle ?? hints.twitterTitle ?? hints.title, 200);
  if (!title) return null;
  if (!jsonLdTitle) usedOpenGraphFallback = true;

  const jsonLdBrand = extractBrandName(node["brand"] ?? node["manufacturer"]);
  const brand = jsonLdBrand ?? sanitizeCatalogOptionalText(hints.productBrand, 100);
  if (!jsonLdBrand && brand) usedOpenGraphFallback = true;

  const category = extractCategory(node["category"]);
  const productIds = extractIdentifiers(node);
  const skuFallback = productIds.sku ?? sanitizeCatalogOptionalText(hints.productSku, 80);

  const jsonLdDesc = sanitizeCatalogDescription(
    typeof node["description"] === "string" ? node["description"] : null,
    1500
  );
  const description =
    jsonLdDesc ||
    sanitizeCatalogDescription(hints.ogDescription ?? hints.twitterDescription ?? hints.metaDescription, 1500);
  if (!jsonLdDesc && description) usedOpenGraphFallback = true;

  const images = extractImages(node["image"], pageUrl);
  if (images.length === 0) {
    for (const ogImg of [...hints.ogImages, hints.twitterImage]) {
      const safe = sanitizeUniversalImageUrl(ogImg, pageUrl);
      if (safe && !images.includes(safe) && images.length < MAX_IMAGES) {
        images.push(safe);
        usedOpenGraphFallback = true;
      }
    }
  }

  const ogAvailFallback = hints.ogAvailability
    ? normalizeSchemaAvailability(hints.ogAvailability)
    : undefined;

  const offers = extractOffersFromField(
    node["offers"],
    idMap,
    pageUrl,
    fallbackCurrency,
    ogAvailFallback
  );

  // Determine canonical URL (Product.url -> first offer url -> link[rel=canonical] -> og:url -> pageUrl)
  const canonicalUrl =
    sanitizeUniversalProductUrl(node["url"], pageUrl) ??
    offers.find((o) => o.url)?.url ??
    sanitizeUniversalProductUrl(hints.canonicalUrl, pageUrl) ??
    sanitizeUniversalProductUrl(hints.ogUrl, pageUrl) ??
    sanitizeUniversalProductUrl(pageUrl, pageUrl) ??
    pageUrl;

  const attrs = extractVariantAttributes(node);
  const optionValues = attrs.map((a) => a.value);
  const options = attrs.map((a) => ({ name: a.name, values: [a.value] }));

  let resolvedCurrency: string | null = null;
  let aggregateHighPrice: Money | null = null;
  const variants: ProductVariant[] = [];

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i]!;
    if (offer.priceAmount === null) continue;
    const offerCurrency = normalizeSchemaCurrency(
      offer.currency ?? hints.ogPriceCurrency,
      resolvedCurrency ?? fallbackCurrency
    );
    resolvedCurrency ??= offerCurrency;
    if (!offer.currency && hints.ogPriceCurrency) usedOpenGraphFallback = true;

    const vSku = offer.sku ?? skuFallback;
    const vGtin = offer.gtin ?? productIds.gtin;
    const vEan = offer.ean ?? productIds.ean;
    const vMpn = offer.mpn ?? productIds.mpn;

    if (offer.highPriceAmount !== null && offer.highPriceAmount >= offer.priceAmount) {
      const candidateHigh = formatMoney(offer.highPriceAmount, offerCurrency);
      if (!aggregateHighPrice || candidateHigh.amount > aggregateHighPrice.amount) {
        aggregateHighPrice = candidateHigh;
      }
    }

    variants.push({
      id: vSku ?? vGtin ?? vMpn ?? (offers.length === 1 ? deriveHandleFromUrl(canonicalUrl, null) : `offer-${i + 1}`),
      title: offer.title ?? (optionValues.length > 0 ? optionValues.join(" / ") : "Default"),
      sku: vSku,
      gtin: vGtin,
      ean: vEan,
      mpn: vMpn,
      available: offer.available,
      availability: offer.availability,
      price: formatMoney(offer.priceAmount, offerCurrency),
      compare_at_price:
        offer.compareAtAmount !== null
          ? formatMoney(offer.compareAtAmount, offerCurrency)
          : null,
      option_values: optionValues,
      url: offer.url ?? canonicalUrl
    });
  }

  // Partial JSON-LD fallback: if JSON-LD Product lacked price/offers, try OpenGraph product:price:amount
  if (variants.length === 0 && hints.ogPriceAmount) {
    const ogCurrencyHint = hints.ogPriceCurrency ?? fallbackCurrency;
    const parsedOgPrice = parseSchemaPrice(hints.ogPriceAmount, ogCurrencyHint);
    if (parsedOgPrice) {
      const finalCurr = normalizeSchemaCurrency(
        hints.ogPriceCurrency ?? parsedOgPrice.detectedCurrency,
        fallbackCurrency
      );
      resolvedCurrency = finalCurr;
      const avail = normalizeSchemaAvailability(hints.ogAvailability);
      usedOpenGraphFallback = true;
      variants.push({
        id: skuFallback ?? productIds.gtin ?? deriveHandleFromUrl(canonicalUrl, null),
        title: optionValues.length > 0 ? optionValues.join(" / ") : "Default",
        sku: skuFallback,
        gtin: productIds.gtin,
        ean: productIds.ean,
        mpn: productIds.mpn,
        available: avail.available,
        availability: avail.status,
        price: formatMoney(parsedOgPrice.amount, finalCurr),
        compare_at_price: null,
        option_values: optionValues,
        url: canonicalUrl
      });
    }
  }

  if (variants.length === 0) {
    return null;
  }

  const finalCurrency = resolvedCurrency ?? fallbackCurrency;
  const priceMin = variants.reduce(
    (min, v) => (v.price.amount < min.amount ? v.price : min),
    variants[0]!.price
  );
  let priceMax = variants.reduce(
    (max, v) => (v.price.amount > max.amount ? v.price : max),
    variants[0]!.price
  );
  if (aggregateHighPrice && aggregateHighPrice.amount > priceMax.amount) {
    priceMax = aggregateHighPrice;
  }

  const handle = deriveHandleFromUrl(canonicalUrl, skuFallback);
  const productId = skuFallback ?? productIds.gtin ?? productIds.mpn ?? handle;
  const overallAvailability = pickOverallAvailability(variants);

  return {
    currency: finalCurrency,
    product: {
      id: productId,
      handle,
      title,
      vendor: brand,
      product_type: category,
      description_text: description,
      sku: skuFallback,
      gtin: productIds.gtin,
      ean: productIds.ean,
      mpn: productIds.mpn,
      available: variants.some((v) => v.available),
      availability: overallAvailability,
      price_min: priceMin,
      price_max: priceMax,
      metadata_source: usedOpenGraphFallback ? "jsonld+opengraph" : "jsonld",
      url: canonicalUrl,
      options,
      images,
      variants
    }
  };
}

function buildFromOpenGraphOnly(
  hints: HtmlMetaHints,
  pageUrl: string,
  fallbackCurrency: string
): ParsedProductOutput | null {
  if (!hints.ogPriceAmount) return null;

  const title = sanitizeCatalogOptionalText(
    hints.ogTitle ?? hints.twitterTitle ?? hints.title,
    200
  );
  if (!title) return null;

  const parsedPrice = parseSchemaPrice(
    hints.ogPriceAmount,
    hints.ogPriceCurrency ?? fallbackCurrency
  );
  if (!parsedPrice) return null;

  const currency = normalizeSchemaCurrency(
    hints.ogPriceCurrency ?? parsedPrice.detectedCurrency,
    fallbackCurrency
  );
  const avail = normalizeSchemaAvailability(hints.ogAvailability);
  const canonicalUrl =
    sanitizeUniversalProductUrl(hints.canonicalUrl, pageUrl) ??
    sanitizeUniversalProductUrl(hints.ogUrl, pageUrl) ??
    sanitizeUniversalProductUrl(pageUrl, pageUrl) ??
    pageUrl;

  const sku = sanitizeCatalogOptionalText(hints.productSku, 80);
  const handle = deriveHandleFromUrl(canonicalUrl, sku);
  const images: string[] = [];
  for (const img of [...hints.ogImages, hints.twitterImage]) {
    const safe = sanitizeUniversalImageUrl(img, pageUrl);
    if (safe && !images.includes(safe) && images.length < MAX_IMAGES) {
      images.push(safe);
    }
  }

  const money = formatMoney(parsedPrice.amount, currency);

  return {
    currency,
    product: {
      id: sku ?? handle,
      handle,
      title,
      vendor: sanitizeCatalogOptionalText(hints.productBrand ?? hints.ogSiteName, 100),
      product_type: null,
      description_text: sanitizeCatalogDescription(
        hints.ogDescription ?? hints.twitterDescription ?? hints.metaDescription,
        1500
      ),
      sku,
      gtin: null,
      ean: null,
      mpn: null,
      available: avail.available,
      availability: avail.status,
      price_min: money,
      price_max: money,
      metadata_source: "opengraph",
      url: canonicalUrl,
      options: [],
      images,
      variants: [
        {
          id: sku ?? handle,
          title: "Default",
          sku,
          gtin: null,
          ean: null,
          mpn: null,
          available: avail.available,
          availability: avail.status,
          price: money,
          compare_at_price: null,
          option_values: [],
          url: canonicalUrl
        }
      ]
    }
  };
}

/**
 * Pure Schema.org JSON-LD + OpenGraph product parser.
 * Never throws on malformed HTML or broken JSON-LD blocks; returns null when no verified product & price exists.
 */
export function parseProductFromHtml(
  rawHtml: string,
  pageUrl: string,
  opts: { currencyHint?: string } = {}
): ParsedProductOutput | null {
  if (!rawHtml || typeof rawHtml !== "string") return null;

  const html = capHtmlInput(rawHtml);
  const fallbackCurrency = normalizeSchemaCurrency(
    opts.currencyHint,
    inferCurrencyFromUrl(pageUrl)
  );
  const hints = extractHtmlMetaHints(html);
  const scriptBodies = extractJsonLdScriptBodies(html);

  const parsedBlocks: unknown[] = [];
  for (const body of scriptBodies) {
    const parsed = safeParseJsonLd(body);
    if (parsed !== null) parsedBlocks.push(parsed);
  }

  if (parsedBlocks.length > 0) {
    const { nodes, idMap, primaryNodes, deprioritizedNodes } = collectJsonLdGraph(parsedBlocks);

    const candidates = nodes
      .filter((n) => hasSchemaType(n, PRODUCT_GROUP_TYPES) || hasSchemaType(n, PRODUCT_TYPES))
      .map((node) => ({
        node,
        score: scoreProductCandidate(node, pageUrl, primaryNodes, deprioritizedNodes, idMap)
      }))
      .sort((a, b) => b.score - a.score);

    for (const { node } of candidates) {
      const result = hasSchemaType(node, PRODUCT_GROUP_TYPES)
        ? buildFromProductGroup(node, idMap, hints, pageUrl, fallbackCurrency)
        : buildFromProductNode(node, idMap, hints, pageUrl, fallbackCurrency);
      if (result) {
        return result;
      }
    }
  }

  return buildFromOpenGraphOnly(hints, pageUrl, fallbackCurrency);
}

function extractSearchActionTemplate(
  nodes: JsonObject[],
  pageUrl: string
): string | null {
  for (const node of nodes) {
    if (!hasSchemaType(node, ["website", "searchaction"])) continue;
    const actions = hasSchemaType(node, ["searchaction"])
      ? [node]
      : asArray(node["potentialAction"]).filter(isObject);

    for (const action of actions) {
      if (!hasSchemaType(action, ["searchaction"])) continue;
      const target = action["target"];
      let template: string | null = null;
      if (typeof target === "string") {
        template = target;
      } else if (isObject(target) && typeof target["urlTemplate"] === "string") {
        template = target["urlTemplate"];
      }
      if (!template) continue;

      const cleaned = stripControlAndInvisible(template).trim();
      if (!cleaned || cleaned.length > 500) continue;
      if (/[\s#\\]/.test(cleaned)) continue;
      if (LLM_CONTROL_TOKEN_TEST_RE.test(cleaned)) continue;
      if (!cleaned.startsWith("https://") && !(cleaned.startsWith("/") && !cleaned.startsWith("//"))) {
        continue;
      }

      // Forbid placeholders inside scheme/authority (must appear only in path or query)
      if (cleaned.startsWith("https://")) {
        const afterScheme = cleaned.slice("https://".length);
        const pathOrQueryIdx = afterScheme.search(/[/?]/);
        const braceIdx = afterScheme.indexOf("{");
        if (braceIdx !== -1 && (pathOrQueryIdx === -1 || braceIdx < pathOrQueryIdx)) {
          continue;
        }
      }

      // Validate the base URL (replacing placeholder token with "test")
      const probeUrl = cleaned.replace(/\{[^}]{1,64}\}/g, "test");
      const safeProbe = sanitizeUniversalProductUrl(probeUrl, pageUrl);
      if (safeProbe) {
        try {
          const pageOrigin = new URL(pageUrl).origin;
          const probeOrigin = new URL(safeProbe).origin;
          if (!isSameStoreSite(pageOrigin, probeOrigin)) continue;
        } catch {
          continue;
        }
        return cleaned;
      }
    }
  }
  return null;
}

/**
 * Pure site-level metadata parser for homepage inspection & search guidance.
 */
export function parseSiteMetadataFromHtml(
  rawHtml: string,
  pageUrl: string
): SiteMetadataOutput {
  const html = capHtmlInput(rawHtml);
  const hints = extractHtmlMetaHints(html);
  const scriptBodies = extractJsonLdScriptBodies(html);

  const parsedBlocks: unknown[] = [];
  for (const body of scriptBodies) {
    const parsed = safeParseJsonLd(body);
    if (parsed !== null) parsedBlocks.push(parsed);
  }

  let siteName: string | null = null;
  let hasProductJsonLd = false;
  let searchActionTemplate: string | null = null;

  if (parsedBlocks.length > 0) {
    const { nodes } = collectJsonLdGraph(parsedBlocks);
    for (const node of nodes) {
      if (hasSchemaType(node, [...PRODUCT_TYPES, ...PRODUCT_GROUP_TYPES])) {
        hasProductJsonLd = true;
      }
      if (!siteName && hasSchemaType(node, ["onlinestore", "store", "organization", "website"])) {
        if (typeof node["name"] === "string") {
          siteName = sanitizeCatalogOptionalText(node["name"], 120);
        }
      }
    }
    searchActionTemplate = extractSearchActionTemplate(nodes, pageUrl);
  }

  siteName ??=
    sanitizeCatalogOptionalText(hints.ogSiteName, 120) ??
    sanitizeCatalogOptionalText(hints.title, 120);

  let canonicalOrigin: string | null = null;
  const canonical = sanitizeUniversalProductUrl(hints.canonicalUrl ?? pageUrl, pageUrl);
  if (canonical) {
    try {
      const candidateOrigin = new URL(canonical).origin;
      const pageOrigin = new URL(pageUrl).origin;
      canonicalOrigin = isSameStoreSite(pageOrigin, candidateOrigin) ? candidateOrigin : pageOrigin;
    } catch {
      canonicalOrigin = null;
    }
  }

  const openSearchUrl = hints.openSearchUrl
    ? sanitizeUniversalProductUrl(hints.openSearchUrl, pageUrl)
    : null;

  return {
    name: siteName,
    currency: inferCurrencyFromUrl(canonicalOrigin ?? pageUrl),
    country: inferCountryFromHints(canonicalOrigin ?? pageUrl, hints.lang),
    hasJsonLd: parsedBlocks.length > 0,
    hasProductJsonLd,
    searchActionTemplate,
    openSearchUrl,
    canonicalOrigin
  };
}
