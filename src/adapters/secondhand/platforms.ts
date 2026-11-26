import { foldSearchText } from "../shopify/normalize.js";
import { enforceShellSafeHttpsUrl } from "../../security/identifiers.js";
import { sanitizeText } from "../../security/sanitize.js";
import { validateExternalUrl } from "../../security/ssrf.js";
import type { ProductCondition } from "../types.js";

export type SecondhandRegion = "AT" | "DE" | "CH" | "DACH" | "EU" | "UK" | "US";
export type SecondhandCategory =
  | "all"
  | "classifieds"
  | "refurbished"
  | "electronics"
  | "fashion"
  | "books"
  | "handmade";
export type SecondhandConditionFilter = "any" | "used" | "refurbished" | "like_new" | "new";
export type SecondhandSortBy = "relevance" | "newest" | "price_asc" | "price_desc";
export type SecondhandAppliedFilter =
  | "query"
  | "min_price"
  | "max_price"
  | "condition"
  | "sort_by"
  | "postal_code"
  | "radius_km";

export const MAX_SECONDHAND_PRICE = 1_000_000;

export interface SecondhandSearchParams {
  query: string;
  condition?: SecondhandConditionFilter;
  minPrice?: number;
  maxPrice?: number;
  postalCode?: string;
  radiusKm?: number;
  sortBy?: SecondhandSortBy;
}

export interface BuiltMarketplaceSearchUrl {
  url: string;
  appliedFilters: SecondhandAppliedFilter[];
  note?: string;
}

export interface SecondhandMarketplaceDef {
  id: string;
  groupId: string;
  name: string;
  origin: string;
  canonicalHost: string;
  hosts: readonly string[];
  country: string;
  currency: string;
  regions: readonly SecondhandRegion[];
  /** Regions where this entry is included in automatic regional searches (avoids duplicates in DACH). */
  autoRegions: readonly SecondhandRegion[];
  categories: readonly Exclude<SecondhandCategory, "all">[];
  supportedConditions: readonly Exclude<SecondhandConditionFilter, "any">[];
  supportsSingleItemLookup: boolean;
  liveApiEnvVars: readonly string[];
  buildSearchUrl: (params: NormalizedSearchParams) => BuiltMarketplaceSearchUrl;
}

export interface NormalizedSearchParams {
  query: string;
  condition: SecondhandConditionFilter;
  minPrice?: number;
  maxPrice?: number;
  postalCode?: string;
  radiusKm?: number;
  sortBy: SecondhandSortBy;
}

const GERMAN_PLZ_RE = /^\d{5}$/;
const GENERAL_POSTAL_RE = /^(?:\d{4,5}|[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2})$/;

/**
 * Replaces lone UTF-16 surrogates so `encodeURIComponent` never throws `URIError`.
 */
export function toWellFormedUtf16(input: string): string {
  const maybeWellFormed = (input as string & { toWellFormed?: () => string }).toWellFormed;
  if (typeof maybeWellFormed === "function") {
    return maybeWellFormed.call(input);
  }
  return input.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD"
  );
}

function formatQueryPrice(value: number | undefined): string | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_SECONDHAND_PRICE
  ) {
    return null;
  }
  const rounded = Math.round(value * 100) / 100;
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_SECONDHAND_PRICE) {
    return null;
  }
  return String(rounded);
}

/**
 * Normalizes a query into a strict lowercase ASCII hyphen slug suitable for path-based
 * search routes (e.g. kleinanzeigen.de). Guaranteed free of `..`, `/`, `\`, quotes, or control chars.
 */
export function toSafeMarketplaceSlug(rawQuery: string): string {
  const cleaned = sanitizeText(toWellFormedUtf16(rawQuery), 200);
  const folded = foldSearchText(cleaned)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
  return folded;
}

/**
 * Sanitizes a query for inclusion as a single encoded URL path segment (e.g. ricardo.ch/de/s/{q}/).
 * Replaces lone UTF-16 surrogates and strips path separators, `..`, backslashes, and control
 * characters before percent-encoding so `encodeURIComponent` never throws and decoded pathnames
 * can never introduce path traversal or extra path segments.
 */
export function toSafeEncodedPathSegment(rawQuery: string): string {
  const cleaned = sanitizeText(toWellFormedUtf16(rawQuery), 200)
    .replace(/\.{2,}/g, " ")
    .replace(/[\/\\]+/g, " ")
    .replace(/['"$()`;|<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === ".") return "";
  return encodeURIComponent(toWellFormedUtf16(cleaned));
}

/**
 * Validates and normalizes search parameters shared by single-store and multi-marketplace builders.
 */
export function normalizeSecondhandSearchParams(
  input: SecondhandSearchParams,
  opts: { requireGermanPostalCode?: boolean } = {}
): NormalizedSearchParams {
  const query = sanitizeText(toWellFormedUtf16(input.query), 200);
  if (!query) {
    throw new Error("'query' must be a non-empty search string (1-200 characters).");
  }

  let minPrice = input.minPrice;
  let maxPrice = input.maxPrice;
  if (minPrice !== undefined) {
    if (
      typeof minPrice !== "number" ||
      !Number.isFinite(minPrice) ||
      minPrice < 0 ||
      minPrice > MAX_SECONDHAND_PRICE
    ) {
      throw new Error(`'min_price' must be a finite number between 0 and ${MAX_SECONDHAND_PRICE}.`);
    }
    const rounded = Math.round(minPrice * 100) / 100;
    if (!Number.isFinite(rounded) || rounded > MAX_SECONDHAND_PRICE) {
      throw new Error(`'min_price' must be a finite number between 0 and ${MAX_SECONDHAND_PRICE}.`);
    }
    minPrice = rounded;
  }
  if (maxPrice !== undefined) {
    if (
      typeof maxPrice !== "number" ||
      !Number.isFinite(maxPrice) ||
      maxPrice < 0 ||
      maxPrice > MAX_SECONDHAND_PRICE
    ) {
      throw new Error(`'max_price' must be a finite number between 0 and ${MAX_SECONDHAND_PRICE}.`);
    }
    const rounded = Math.round(maxPrice * 100) / 100;
    if (!Number.isFinite(rounded) || rounded > MAX_SECONDHAND_PRICE) {
      throw new Error(`'max_price' must be a finite number between 0 and ${MAX_SECONDHAND_PRICE}.`);
    }
    maxPrice = rounded;
  }
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new Error("'min_price' must be less than or equal to 'max_price'.");
  }

  let postalCode: string | undefined;
  if (input.postalCode !== undefined && input.postalCode.trim() !== "") {
    const rawPostal = sanitizeText(toWellFormedUtf16(input.postalCode), 12);
    if (
      !rawPostal ||
      rawPostal.includes("..") ||
      rawPostal.includes("/") ||
      rawPostal.includes("\\") ||
      !GENERAL_POSTAL_RE.test(rawPostal)
    ) {
      throw new Error(
        "Invalid 'postal_code': expected a valid 4-5 digit postal code (e.g. '10115', '1010', '8001') or UK postcode."
      );
    }
    if (opts.requireGermanPostalCode && !GERMAN_PLZ_RE.test(rawPostal)) {
      throw new Error(
        "Invalid German 'postal_code': expected exactly 5 digits (e.g. '10115')."
      );
    }
    postalCode = rawPostal;
  }

  let radiusKm: number | undefined;
  if (input.radiusKm !== undefined) {
    if (typeof input.radiusKm !== "number" || !Number.isFinite(input.radiusKm)) {
      throw new Error("'radius_km' must be an integer between 1 and 500.");
    }
    radiusKm = Math.min(500, Math.max(1, Math.round(input.radiusKm)));
  }

  return {
    query,
    condition: input.condition ?? "any",
    minPrice,
    maxPrice,
    postalCode,
    radiusKm,
    sortBy: input.sortBy ?? "relevance"
  };
}

/**
 * Enforces that a generated marketplace URL is valid HTTPS, passes SSRF checks,
 * matches the platform's exact canonical origin, and is shell-safe.
 */
export function finalizeMarketplaceUrl(rawUrl: string, expectedOrigin: string): string {
  const parsed = validateExternalUrl(rawUrl);
  const expected = new URL(expectedOrigin);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin.toLowerCase() !== expected.origin.toLowerCase()
  ) {
    throw new Error(
      `Constructed marketplace URL origin '${parsed.origin}' does not match canonical origin '${expected.origin}'.`
    );
  }
  const safe = enforceShellSafeHttpsUrl(parsed.toString());
  if (!safe) {
    throw new Error("Constructed marketplace URL failed shell-safe HTTPS validation.");
  }
  return safe;
}

function buildWillhabenUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz");
  const appliedFilters: SecondhandAppliedFilter[] = ["query"];
  u.searchParams.set("keyword", params.query);
  // willhaben.at requires UPPERCASE PRICE_FROM / PRICE_TO query parameters
  const min = formatQueryPrice(params.minPrice);
  const max = formatQueryPrice(params.maxPrice);
  if (min !== null) {
    u.searchParams.set("PRICE_FROM", min);
    appliedFilters.push("min_price");
  }
  if (max !== null) {
    u.searchParams.set("PRICE_TO", max);
    appliedFilters.push("max_price");
  }
  if (params.sortBy === "newest") {
    u.searchParams.set("sort", "1");
    appliedFilters.push("sort_by");
  } else if (params.sortBy === "price_asc") {
    u.searchParams.set("sort", "3");
    appliedFilters.push("sort_by");
  } else if (params.sortBy === "price_desc") {
    u.searchParams.set("sort", "4");
    appliedFilters.push("sort_by");
  }
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://www.willhaben.at"),
    appliedFilters
  };
}

function buildKleinanzeigenUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const slug = toSafeMarketplaceSlug(params.query) || "angebote";
  const appliedFilters: SecondhandAppliedFilter[] = ["query"];

  const safeMin =
    params.minPrice !== undefined &&
    Number.isFinite(params.minPrice) &&
    params.minPrice >= 0 &&
    params.minPrice <= MAX_SECONDHAND_PRICE
      ? Math.min(MAX_SECONDHAND_PRICE, Math.floor(params.minPrice))
      : null;
  const safeMax =
    params.maxPrice !== undefined &&
    Number.isFinite(params.maxPrice) &&
    params.maxPrice >= 0 &&
    params.maxPrice <= MAX_SECONDHAND_PRICE
      ? Math.min(MAX_SECONDHAND_PRICE, Math.ceil(params.maxPrice))
      : null;

  const hasMin = safeMin !== null;
  const hasMax = safeMax !== null;
  if (hasMin) appliedFilters.push("min_price");
  if (hasMax) appliedFilters.push("max_price");

  const priceSegment =
    hasMin || hasMax
      ? `preis:${hasMin ? String(safeMin) : ""}:${hasMax ? String(safeMax) : ""}`
      : null;

  let note: string | undefined;
  const hasValidDePlz = Boolean(params.postalCode && GERMAN_PLZ_RE.test(params.postalCode));
  if (params.postalCode && !hasValidDePlz) {
    note =
      "Kleinanzeigen location filter requires a 5-digit German postal code (omitted non-DE postal code).";
  }

  let path: string;
  if (hasValidDePlz) {
    appliedFilters.push("postal_code");
    const radiusSuffix = params.radiusKm !== undefined ? `r${params.radiusKm}` : "";
    if (params.radiusKm !== undefined) {
      appliedFilters.push("radius_km");
    }
    path = priceSegment
      ? `/s-${params.postalCode}/${priceSegment}/${slug}/k0${radiusSuffix}`
      : `/s-${params.postalCode}/${slug}/k0${radiusSuffix}`;
  } else {
    path = priceSegment ? `/s-${priceSegment}/${slug}/k0` : `/s-${slug}/k0`;
  }

  return {
    url: finalizeMarketplaceUrl(
      `https://www.kleinanzeigen.de${path}`,
      "https://www.kleinanzeigen.de"
    ),
    appliedFilters,
    ...(note ? { note } : {})
  };
}

function buildVintedUrl(
  tld: "at" | "de",
  params: NormalizedSearchParams
): BuiltMarketplaceSearchUrl {
  const origin = `https://www.vinted.${tld}`;
  const u = new URL(`${origin}/catalog`);
  const appliedFilters: SecondhandAppliedFilter[] = ["query"];
  u.searchParams.set("search_text", params.query);
  const min = formatQueryPrice(params.minPrice);
  const max = formatQueryPrice(params.maxPrice);
  if (min !== null) {
    u.searchParams.set("price_from", min);
    appliedFilters.push("min_price");
  }
  if (max !== null) {
    u.searchParams.set("price_to", max);
    appliedFilters.push("max_price");
  }
  const orderMap: Record<SecondhandSortBy, string> = {
    newest: "newest_first",
    price_asc: "price_low_to_high",
    price_desc: "price_high_to_low",
    relevance: "relevance"
  };
  u.searchParams.set("order", orderMap[params.sortBy]);
  appliedFilters.push("sort_by");
  return { url: finalizeMarketplaceUrl(u.toString(), origin), appliedFilters };
}

function buildRicardoUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const segment = toSafeEncodedPathSegment(params.query) || encodeURIComponent("suche");
  const u = new URL(`https://www.ricardo.ch/de/s/${segment}/`);
  const appliedFilters: SecondhandAppliedFilter[] = ["query"];
  const min = formatQueryPrice(params.minPrice);
  const max = formatQueryPrice(params.maxPrice);
  if (min !== null) {
    u.searchParams.set("range_min", min);
    appliedFilters.push("min_price");
  }
  if (max !== null) {
    u.searchParams.set("range_max", max);
    appliedFilters.push("max_price");
  }
  if (
    params.sortBy === "newest" ||
    params.sortBy === "price_asc" ||
    params.sortBy === "price_desc"
  ) {
    u.searchParams.set("sort", params.sortBy);
    appliedFilters.push("sort_by");
  }
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://www.ricardo.ch"),
    appliedFilters
  };
}

function buildTuttiUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://www.tutti.ch/de/q/suche");
  const appliedFilters: SecondhandAppliedFilter[] = ["query"];
  u.searchParams.set("q", params.query);
  const min = formatQueryPrice(params.minPrice);
  const max = formatQueryPrice(params.maxPrice);
  if (min !== null) {
    u.searchParams.set("price_min", min);
    appliedFilters.push("min_price");
  }
  if (max !== null) {
    u.searchParams.set("price_max", max);
    appliedFilters.push("max_price");
  }
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://www.tutti.ch"),
    appliedFilters
  };
}

function buildRefurbedUrl(
  tld: "at" | "de",
  params: NormalizedSearchParams
): BuiltMarketplaceSearchUrl {
  const origin = `https://www.refurbed.${tld}`;
  // Exact verified path is /search/?q= (NOT /s/?q= which returns 404)
  const u = new URL(`${origin}/search/`);
  u.searchParams.set("q", params.query);
  return {
    url: finalizeMarketplaceUrl(u.toString(), origin),
    appliedFilters: ["query"]
  };
}

function buildBackMarketUrl(
  origin: string,
  localePath: string,
  params: NormalizedSearchParams
): BuiltMarketplaceSearchUrl {
  const u = new URL(`${origin}${localePath}`);
  u.searchParams.set("q", params.query);
  return {
    url: finalizeMarketplaceUrl(u.toString(), origin),
    appliedFilters: ["query"]
  };
}

function buildRebuyUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://www.rebuy.de/kaufen/suchen");
  u.searchParams.set("q", params.query);
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://www.rebuy.de"),
    appliedFilters: ["query"]
  };
}

function buildMedimopsUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://www.medimops.de/produkte-C0/");
  u.searchParams.set("fcIsSearch", "1");
  u.searchParams.set("searchparam", params.query);
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://www.medimops.de"),
    appliedFilters: ["query"]
  };
}

function buildAsGoodAsNewUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://asgoodasnew.de/index.php");
  u.searchParams.set("cl", "search");
  u.searchParams.set("searchparam", params.query);
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://asgoodasnew.de"),
    appliedFilters: ["query"]
  };
}

function buildEbayUrl(
  tld: "at" | "de" | "ch" | "co.uk" | "com",
  params: NormalizedSearchParams
): BuiltMarketplaceSearchUrl {
  const origin = `https://www.ebay.${tld}`;
  const u = new URL(`${origin}/sch/i.html`);
  const appliedFilters: SecondhandAppliedFilter[] = ["query"];
  u.searchParams.set("_nkw", params.query);
  const min = formatQueryPrice(params.minPrice);
  const max = formatQueryPrice(params.maxPrice);
  if (min !== null) {
    u.searchParams.set("_udlo", min);
    appliedFilters.push("min_price");
  }
  if (max !== null) {
    u.searchParams.set("_udhi", max);
    appliedFilters.push("max_price");
  }

  const conditionMap: Partial<Record<SecondhandConditionFilter, string>> = {
    used: "3000",
    refurbished: "2000",
    like_new: "2500",
    new: "1000"
  };
  const ebayCond = conditionMap[params.condition];
  if (ebayCond) {
    u.searchParams.set("LH_ItemCondition", ebayCond);
    appliedFilters.push("condition");
  }

  const sortMap: Partial<Record<SecondhandSortBy, string>> = {
    price_asc: "15",
    price_desc: "16",
    newest: "10"
  };
  const sop = sortMap[params.sortBy];
  if (sop) {
    u.searchParams.set("_sop", sop);
    appliedFilters.push("sort_by");
  }

  return { url: finalizeMarketplaceUrl(u.toString(), origin), appliedFilters };
}

function buildEtsyUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://www.etsy.com/search");
  const appliedFilters: SecondhandAppliedFilter[] = ["query"];
  u.searchParams.set("q", params.query);
  const min = formatQueryPrice(params.minPrice);
  const max = formatQueryPrice(params.maxPrice);
  if (min !== null) {
    u.searchParams.set("min", min);
    appliedFilters.push("min_price");
  }
  if (max !== null) {
    u.searchParams.set("max", max);
    appliedFilters.push("max_price");
  }
  if (
    params.condition === "used" ||
    params.condition === "like_new" ||
    params.condition === "refurbished"
  ) {
    u.searchParams.set("is_vintage", "true");
    appliedFilters.push("condition");
  }
  const orderMap: Record<SecondhandSortBy, string> = {
    price_asc: "price_asc",
    price_desc: "price_desc",
    newest: "most_recent",
    relevance: "most_relevant"
  };
  u.searchParams.set("order", orderMap[params.sortBy]);
  appliedFilters.push("sort_by");
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://www.etsy.com"),
    appliedFilters
  };
}

function buildDepopUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://www.depop.com/search/");
  const appliedFilters: SecondhandAppliedFilter[] = ["query"];
  u.searchParams.set("q", params.query);
  const min = formatQueryPrice(params.minPrice);
  const max = formatQueryPrice(params.maxPrice);
  if (min !== null) {
    u.searchParams.set("priceMin", min);
    appliedFilters.push("min_price");
  }
  if (max !== null) {
    u.searchParams.set("priceMax", max);
    appliedFilters.push("max_price");
  }
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://www.depop.com"),
    appliedFilters
  };
}

function buildPoshmarkUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://poshmark.com/search");
  u.searchParams.set("query", params.query);
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://poshmark.com"),
    appliedFilters: ["query"]
  };
}

function buildBuyZoxsUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://www.buyzoxs.de/kaufen/suche.html");
  u.searchParams.set("q", params.query);
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://www.buyzoxs.de"),
    appliedFilters: ["query"]
  };
}

function buildVestiaireUrl(params: NormalizedSearchParams): BuiltMarketplaceSearchUrl {
  const u = new URL("https://de.vestiairecollective.com/search/");
  u.searchParams.set("q", params.query);
  return {
    url: finalizeMarketplaceUrl(u.toString(), "https://de.vestiairecollective.com"),
    appliedFilters: ["query"]
  };
}

export const SECONDHAND_MARKETPLACES: readonly SecondhandMarketplaceDef[] = [
  {
    id: "willhaben_at",
    groupId: "willhaben",
    name: "willhaben",
    origin: "https://www.willhaben.at",
    canonicalHost: "www.willhaben.at",
    hosts: ["willhaben.at", "www.willhaben.at", "m.willhaben.at"],
    country: "AT",
    currency: "EUR",
    regions: ["AT", "DACH", "EU"],
    autoRegions: ["AT", "DACH", "EU"],
    categories: ["classifieds", "electronics", "fashion", "books"],
    supportedConditions: ["used", "like_new", "refurbished", "new"],
    supportsSingleItemLookup: true,
    liveApiEnvVars: [],
    buildSearchUrl: buildWillhabenUrl
  },
  {
    id: "kleinanzeigen_de",
    groupId: "kleinanzeigen",
    name: "Kleinanzeigen",
    origin: "https://www.kleinanzeigen.de",
    canonicalHost: "www.kleinanzeigen.de",
    hosts: [
      "kleinanzeigen.de",
      "www.kleinanzeigen.de",
      "m.kleinanzeigen.de",
      "ebay-kleinanzeigen.de",
      "www.ebay-kleinanzeigen.de"
    ],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "DACH", "EU"],
    autoRegions: ["DE", "DACH", "EU"],
    categories: ["classifieds", "electronics", "fashion", "books"],
    supportedConditions: ["used", "like_new", "refurbished", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: buildKleinanzeigenUrl
  },
  {
    id: "vinted_at",
    groupId: "vinted",
    name: "Vinted AT",
    origin: "https://www.vinted.at",
    canonicalHost: "www.vinted.at",
    hosts: ["vinted.at", "www.vinted.at"],
    country: "AT",
    currency: "EUR",
    regions: ["AT", "DACH", "EU"],
    autoRegions: ["AT"],
    categories: ["fashion", "classifieds"],
    supportedConditions: ["used", "like_new", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: (p) => buildVintedUrl("at", p)
  },
  {
    id: "vinted_de",
    groupId: "vinted",
    name: "Vinted DE",
    origin: "https://www.vinted.de",
    canonicalHost: "www.vinted.de",
    hosts: ["vinted.de", "www.vinted.de"],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "DACH", "EU"],
    autoRegions: ["DE", "DACH", "EU"],
    categories: ["fashion", "classifieds"],
    supportedConditions: ["used", "like_new", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: (p) => buildVintedUrl("de", p)
  },
  {
    id: "ricardo_ch",
    groupId: "ricardo",
    name: "Ricardo.ch",
    origin: "https://www.ricardo.ch",
    canonicalHost: "www.ricardo.ch",
    hosts: ["ricardo.ch", "www.ricardo.ch"],
    country: "CH",
    currency: "CHF",
    regions: ["CH", "DACH"],
    autoRegions: ["CH", "DACH"],
    categories: ["classifieds", "electronics", "fashion", "books"],
    supportedConditions: ["used", "like_new", "refurbished", "new"],
    supportsSingleItemLookup: true,
    liveApiEnvVars: [],
    buildSearchUrl: buildRicardoUrl
  },
  {
    id: "tutti_ch",
    groupId: "tutti",
    name: "tutti.ch",
    origin: "https://www.tutti.ch",
    canonicalHost: "www.tutti.ch",
    hosts: ["tutti.ch", "www.tutti.ch"],
    country: "CH",
    currency: "CHF",
    regions: ["CH", "DACH"],
    autoRegions: ["CH", "DACH"],
    categories: ["classifieds", "electronics", "fashion", "books"],
    supportedConditions: ["used", "like_new", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: buildTuttiUrl
  },
  {
    id: "refurbed_at",
    groupId: "refurbed",
    name: "refurbed AT",
    origin: "https://www.refurbed.at",
    canonicalHost: "www.refurbed.at",
    hosts: ["refurbed.at", "www.refurbed.at"],
    country: "AT",
    currency: "EUR",
    regions: ["AT", "DACH", "EU"],
    autoRegions: ["AT"],
    categories: ["refurbished", "electronics"],
    supportedConditions: ["refurbished", "like_new", "used"],
    supportsSingleItemLookup: true,
    liveApiEnvVars: [],
    buildSearchUrl: (p) => buildRefurbedUrl("at", p)
  },
  {
    id: "refurbed_de",
    groupId: "refurbed",
    name: "refurbed DE",
    origin: "https://www.refurbed.de",
    canonicalHost: "www.refurbed.de",
    hosts: ["refurbed.de", "www.refurbed.de"],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "DACH", "EU"],
    autoRegions: ["DE", "DACH", "EU"],
    categories: ["refurbished", "electronics"],
    supportedConditions: ["refurbished", "like_new", "used"],
    supportsSingleItemLookup: true,
    liveApiEnvVars: [],
    buildSearchUrl: (p) => buildRefurbedUrl("de", p)
  },
  {
    id: "backmarket_at",
    groupId: "backmarket",
    name: "Back Market AT",
    origin: "https://www.backmarket.at",
    canonicalHost: "www.backmarket.at",
    hosts: ["backmarket.at", "www.backmarket.at"],
    country: "AT",
    currency: "EUR",
    regions: ["AT", "DACH", "EU"],
    autoRegions: ["AT"],
    categories: ["refurbished", "electronics"],
    supportedConditions: ["refurbished", "like_new", "used"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: (p) => buildBackMarketUrl("https://www.backmarket.at", "/de-at/search", p)
  },
  {
    id: "backmarket_de",
    groupId: "backmarket",
    name: "Back Market DE",
    origin: "https://www.backmarket.de",
    canonicalHost: "www.backmarket.de",
    hosts: ["backmarket.de", "www.backmarket.de"],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "DACH", "EU"],
    autoRegions: ["DE", "DACH", "EU"],
    categories: ["refurbished", "electronics"],
    supportedConditions: ["refurbished", "like_new", "used"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: (p) => buildBackMarketUrl("https://www.backmarket.de", "/de-de/search", p)
  },
  {
    id: "backmarket_com",
    groupId: "backmarket",
    name: "Back Market US",
    origin: "https://www.backmarket.com",
    canonicalHost: "www.backmarket.com",
    hosts: ["backmarket.com", "www.backmarket.com"],
    country: "US",
    currency: "USD",
    regions: ["US"],
    autoRegions: ["US"],
    categories: ["refurbished", "electronics"],
    supportedConditions: ["refurbished", "like_new", "used"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: (p) => buildBackMarketUrl("https://www.backmarket.com", "/en-us/search", p)
  },
  {
    id: "rebuy_de",
    groupId: "rebuy",
    name: "rebuy",
    origin: "https://www.rebuy.de",
    canonicalHost: "www.rebuy.de",
    hosts: ["rebuy.de", "www.rebuy.de"],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "AT", "DACH", "EU"],
    autoRegions: ["DE", "AT", "DACH", "EU"],
    categories: ["refurbished", "electronics", "books"],
    supportedConditions: ["refurbished", "like_new", "used"],
    supportsSingleItemLookup: true,
    liveApiEnvVars: [],
    buildSearchUrl: buildRebuyUrl
  },
  {
    id: "medimops_de",
    groupId: "medimops",
    name: "medimops (momox)",
    origin: "https://www.medimops.de",
    canonicalHost: "www.medimops.de",
    hosts: ["medimops.de", "www.medimops.de"],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "AT", "DACH", "EU"],
    autoRegions: ["DE", "AT", "DACH", "EU"],
    categories: ["books"],
    supportedConditions: ["used", "like_new"],
    supportsSingleItemLookup: true,
    liveApiEnvVars: [],
    buildSearchUrl: buildMedimopsUrl
  },
  {
    id: "asgoodasnew_de",
    groupId: "asgoodasnew",
    name: "asgoodasnew",
    origin: "https://asgoodasnew.de",
    canonicalHost: "asgoodasnew.de",
    hosts: ["asgoodasnew.de", "www.asgoodasnew.de"],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "AT", "DACH", "EU"],
    autoRegions: ["DE", "AT", "DACH", "EU"],
    categories: ["refurbished", "electronics"],
    supportedConditions: ["refurbished", "like_new", "used"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: buildAsGoodAsNewUrl
  },
  {
    id: "ebay_at",
    groupId: "ebay",
    name: "eBay AT",
    origin: "https://www.ebay.at",
    canonicalHost: "www.ebay.at",
    hosts: ["ebay.at", "www.ebay.at", "m.ebay.at"],
    country: "AT",
    currency: "EUR",
    regions: ["AT", "DACH", "EU"],
    autoRegions: ["AT"],
    categories: ["classifieds", "refurbished", "electronics", "fashion", "books", "handmade"],
    supportedConditions: ["used", "like_new", "refurbished", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    buildSearchUrl: (p) => buildEbayUrl("at", p)
  },
  {
    id: "ebay_de",
    groupId: "ebay",
    name: "eBay DE",
    origin: "https://www.ebay.de",
    canonicalHost: "www.ebay.de",
    hosts: ["ebay.de", "www.ebay.de", "m.ebay.de"],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "DACH", "EU"],
    autoRegions: ["DE", "DACH", "EU"],
    categories: ["classifieds", "refurbished", "electronics", "fashion", "books", "handmade"],
    supportedConditions: ["used", "like_new", "refurbished", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    buildSearchUrl: (p) => buildEbayUrl("de", p)
  },
  {
    id: "ebay_ch",
    groupId: "ebay",
    name: "eBay CH",
    origin: "https://www.ebay.ch",
    canonicalHost: "www.ebay.ch",
    hosts: ["ebay.ch", "www.ebay.ch", "m.ebay.ch"],
    country: "CH",
    currency: "CHF",
    regions: ["CH", "DACH"],
    autoRegions: ["CH"],
    categories: ["classifieds", "refurbished", "electronics", "fashion", "books", "handmade"],
    supportedConditions: ["used", "like_new", "refurbished", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    buildSearchUrl: (p) => buildEbayUrl("ch", p)
  },
  {
    id: "ebay_uk",
    groupId: "ebay",
    name: "eBay UK",
    origin: "https://www.ebay.co.uk",
    canonicalHost: "www.ebay.co.uk",
    hosts: ["ebay.co.uk", "www.ebay.co.uk", "m.ebay.co.uk"],
    country: "GB",
    currency: "GBP",
    regions: ["UK", "EU"],
    autoRegions: ["UK"],
    categories: ["classifieds", "refurbished", "electronics", "fashion", "books", "handmade"],
    supportedConditions: ["used", "like_new", "refurbished", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    buildSearchUrl: (p) => buildEbayUrl("co.uk", p)
  },
  {
    id: "ebay_us",
    groupId: "ebay",
    name: "eBay US",
    origin: "https://www.ebay.com",
    canonicalHost: "www.ebay.com",
    hosts: ["ebay.com", "www.ebay.com", "m.ebay.com"],
    country: "US",
    currency: "USD",
    regions: ["US"],
    autoRegions: ["US"],
    categories: ["classifieds", "refurbished", "electronics", "fashion", "books", "handmade"],
    supportedConditions: ["used", "like_new", "refurbished", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    buildSearchUrl: (p) => buildEbayUrl("com", p)
  },
  {
    id: "etsy_com",
    groupId: "etsy",
    name: "Etsy",
    origin: "https://www.etsy.com",
    canonicalHost: "www.etsy.com",
    hosts: ["etsy.com", "www.etsy.com"],
    country: "US",
    currency: "EUR",
    regions: ["AT", "DE", "CH", "DACH", "EU", "UK", "US"],
    autoRegions: ["AT", "DE", "CH", "DACH", "EU", "UK", "US"],
    categories: ["handmade", "fashion"],
    supportedConditions: ["used", "like_new", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: ["ETSY_KEYSTRING", "ETSY_SHARED_SECRET"],
    buildSearchUrl: buildEtsyUrl
  },
  {
    id: "depop_com",
    groupId: "depop",
    name: "Depop",
    origin: "https://www.depop.com",
    canonicalHost: "www.depop.com",
    hosts: ["depop.com", "www.depop.com"],
    country: "GB",
    currency: "GBP",
    regions: ["UK", "US", "EU", "DE", "AT", "CH", "DACH"],
    autoRegions: ["UK", "US", "EU"],
    categories: ["fashion"],
    supportedConditions: ["used", "like_new", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: buildDepopUrl
  },
  {
    id: "poshmark_com",
    groupId: "poshmark",
    name: "Poshmark",
    origin: "https://poshmark.com",
    canonicalHost: "poshmark.com",
    hosts: ["poshmark.com", "www.poshmark.com"],
    country: "US",
    currency: "USD",
    regions: ["US"],
    autoRegions: ["US"],
    categories: ["fashion"],
    supportedConditions: ["used", "like_new", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: buildPoshmarkUrl
  },
  {
    id: "buyzoxs_de",
    groupId: "buyzoxs",
    name: "buyZOXS",
    origin: "https://www.buyzoxs.de",
    canonicalHost: "www.buyzoxs.de",
    hosts: ["buyzoxs.de", "www.buyzoxs.de"],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "AT", "DACH", "EU"],
    autoRegions: ["DE", "AT", "DACH", "EU"],
    categories: ["refurbished", "electronics", "books"],
    supportedConditions: ["refurbished", "like_new", "used"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: buildBuyZoxsUrl
  },
  {
    id: "vestiairecollective_com",
    groupId: "vestiairecollective",
    name: "Vestiaire Collective",
    origin: "https://de.vestiairecollective.com",
    canonicalHost: "de.vestiairecollective.com",
    hosts: [
      "vestiairecollective.com",
      "www.vestiairecollective.com",
      "de.vestiairecollective.com",
      "us.vestiairecollective.com",
      "uk.vestiairecollective.com",
      "fr.vestiairecollective.com"
    ],
    country: "DE",
    currency: "EUR",
    regions: ["DE", "AT", "CH", "DACH", "EU", "UK", "US"],
    autoRegions: ["DE", "AT", "CH", "DACH", "EU", "UK", "US"],
    categories: ["fashion"],
    supportedConditions: ["used", "like_new", "new"],
    supportsSingleItemLookup: false,
    liveApiEnvVars: [],
    buildSearchUrl: buildVestiaireUrl
  }
];

const HOST_TO_MARKETPLACE = new Map<string, SecondhandMarketplaceDef>();
const ID_TO_MARKETPLACE = new Map<string, SecondhandMarketplaceDef>();

for (const mp of SECONDHAND_MARKETPLACES) {
  ID_TO_MARKETPLACE.set(mp.id, mp);
  for (const host of mp.hosts) {
    HOST_TO_MARKETPLACE.set(host.toLowerCase(), mp);
  }
}

/**
 * 0 ms synchronous hostname match for supported secondhand & refurbished marketplaces.
 */
export function resolveSecondhandMarketplace(
  originOrHost: string
): SecondhandMarketplaceDef | null {
  const trimmed = originOrHost.trim();
  if (!trimmed) return null;

  let hostname = trimmed.toLowerCase();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return null;
      }
      hostname = parsed.hostname.toLowerCase();
    } catch {
      return null;
    }
  } else {
    hostname = hostname.split(/[/?#]/, 1)[0] ?? "";
  }

  hostname = hostname.replace(/\.$/, "");
  return HOST_TO_MARKETPLACE.get(hostname) ?? null;
}

/**
 * Wave 1 always uses deterministic `search_handoff` without probing `process.env` as an oracle.
 * Live API integrations (e.g. eBay Browse / Etsy Open API v3) will activate in Wave 2.
 */
export function isMarketplaceLiveApiConfigured(
  _mp: SecondhandMarketplaceDef,
  _env?: NodeJS.ProcessEnv
): boolean {
  return false;
}

/**
 * Resolves an explicit marketplace selector (exact ID like `ebay_at`, domain like `willhaben.at`,
 * or short group alias like `ebay`, `refurbed`, `vinted`, `backmarket`) using `region` to pick
 * the best regional variant for multi-TLD groups.
 */
export function resolveMarketplaceSelector(
  selector: string,
  region: SecondhandRegion
): SecondhandMarketplaceDef | null {
  const norm = selector.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (!norm) return null;

  const exactId = ID_TO_MARKETPLACE.get(norm);
  if (exactId) return exactId;

  const byHost = HOST_TO_MARKETPLACE.get(norm) ?? HOST_TO_MARKETPLACE.get(`www.${norm}`);
  if (byHost) return byHost;

  const groupMatches = SECONDHAND_MARKETPLACES.filter((mp) => mp.groupId === norm);
  if (groupMatches.length === 0) return null;
  if (groupMatches.length === 1) return groupMatches[0]!;

  // Pick regional variant for multi-TLD marketplaces (ebay, vinted, refurbed, backmarket)
  const regionPreferred = groupMatches.find((mp) => mp.autoRegions.includes(region));
  if (regionPreferred) return regionPreferred;
  const regionFallback = groupMatches.find((mp) => mp.regions.includes(region));
  return regionFallback ?? groupMatches[0]!;
}

/**
 * Selects matching marketplaces for `search_secondhand_marketplaces` based on region,
 * category, condition, or explicit `marketplaces` filter.
 */
export function selectSecondhandMarketplaces(opts: {
  region: SecondhandRegion;
  category: SecondhandCategory;
  condition: SecondhandConditionFilter;
  marketplaces?: readonly string[];
}): { selected: SecondhandMarketplaceDef[]; unknownSelectors: string[] } {
  if (opts.marketplaces && opts.marketplaces.length > 0) {
    const selected: SecondhandMarketplaceDef[] = [];
    const seen = new Set<string>();
    const unknownSelectors: string[] = [];

    for (const raw of opts.marketplaces) {
      const mp = resolveMarketplaceSelector(raw, opts.region);
      if (!mp) {
        unknownSelectors.push(sanitizeText(toWellFormedUtf16(raw), 40));
        continue;
      }
      if (!seen.has(mp.id)) {
        seen.add(mp.id);
        selected.push(mp);
      }
    }
    return { selected, unknownSelectors };
  }

  const selected = SECONDHAND_MARKETPLACES.filter((mp) => {
    if (!mp.autoRegions.includes(opts.region)) return false;
    if (opts.category !== "all" && !mp.categories.includes(opts.category)) return false;
    if (opts.condition !== "any" && !mp.supportedConditions.includes(opts.condition)) return false;
    return true;
  });

  return { selected, unknownSelectors: [] };
}

export function mapProductConditionToFilter(
  condition?: ProductCondition
): SecondhandConditionFilter {
  if (!condition || condition === "unknown" || condition === "damaged") return "any";
  return condition;
}
