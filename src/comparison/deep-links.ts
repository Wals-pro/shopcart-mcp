import { foldSearchText } from "../adapters/shopify/normalize.js";
import {
  AFFILIATE_DISCLOSURE_NOTE,
  applyAttribution,
  loadAttributionConfig,
  validateDeeplinkTemplate,
  type AttributionConfig
} from "../attribution/links.js";
import { enforceShellSafeHttpsUrl } from "../security/identifiers.js";
import { sanitizeText } from "../security/sanitize.js";
import { validateExternalUrl } from "../security/ssrf.js";

export type ComparisonCountry = "DE" | "AT" | "CH" | "UK" | "FR" | "US";
export type ComparisonSortBy = "price_asc" | "relevance";
export type ComparisonMatchMode = "ean_exact" | "keyword";

export const ALLOWED_SOVRN_HOSTS: ReadonlySet<string> = new Set([
  "redirect.viglink.com",
  "sovrn.co"
]);

export interface ComparisonConfig {
  sovrnDeeplinkTemplate?: string;
  kelkooApiToken?: string;
  warnings: string[];
}

export interface ComparisonDeepLink {
  provider: string;
  label: string;
  country: ComparisonCountry;
  url: string;
  match_mode: ComparisonMatchMode;
  tier: "tier_b_deeplink";
  supports_ean_direct: boolean;
  affiliate_disclosure: boolean;
  applied_network?: string;
}

export interface ComparisonLinksResult {
  country: ComparisonCountry;
  match_mode: ComparisonMatchMode;
  search_term: string;
  ean: string | null;
  links: ComparisonDeepLink[];
  affiliate_disclosure: boolean;
  disclosure_note?: string;
}

export interface DealSearchDeepLink {
  provider: string;
  label: string;
  region: ComparisonCountry;
  url: string;
  tier: "tier_b_deeplink";
  note?: string;
  affiliate_disclosure: boolean;
  applied_network?: string;
}

export interface DealSearchLinksResult {
  region: ComparisonCountry;
  query: string | null;
  links: DealSearchDeepLink[];
  affiliate_disclosure: boolean;
  disclosure_note?: string;
}

export interface BuildComparisonLinksOptions {
  query?: string;
  ean?: string;
  country?: ComparisonCountry;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: ComparisonSortBy;
  attribution?: AttributionConfig;
  comparisonConfig?: ComparisonConfig;
}

export interface BuildDealSearchLinksOptions {
  query?: string;
  region?: ComparisonCountry;
  category?: string;
  attribution?: AttributionConfig;
  comparisonConfig?: ComparisonConfig;
}

/**
 * Strips spaces/hyphens and validates an 8–14 digit EAN/GTIN barcode.
 */
export function normalizeEan(input?: string | null): string | null {
  if (!input) return null;
  const digits = String(input).replace(/[\s-]+/g, "").trim();
  if (!/^\d{8,14}$/.test(digits)) return null;
  return digits;
}

/**
 * Validates an optional Sovrn Commerce deeplink wrapper template:
 * - Must pass `validateDeeplinkTemplate` (strict `https://`, `{encoded_url}` only, fixed host).
 * - Host MUST be in `ALLOWED_SOVRN_HOSTS` (`redirect.viglink.com` or `sovrn.co`).
 * - Probe URL MUST pass `enforceShellSafeHttpsUrl`.
 */
export function validateSovrnDeeplinkTemplate(template: string): {
  valid: boolean;
  reason?: string;
} {
  const baseCheck = validateDeeplinkTemplate(template);
  if (!baseCheck.valid) {
    return baseCheck;
  }

  const trimmed = template.trim();
  const probe = trimmed.replaceAll(
    "{encoded_url}",
    encodeURIComponent("https://example.com/item")
  );
  try {
    const parsed = validateExternalUrl(probe);
    if (parsed.protocol !== "https:") {
      return { valid: false, reason: "Sovrn deeplink template must use https://" };
    }
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!ALLOWED_SOVRN_HOSTS.has(host)) {
      return {
        valid: false,
        reason: `Sovrn deeplink host '${host}' is not allowed (must be redirect.viglink.com or sovrn.co)`
      };
    }
    if (!enforceShellSafeHttpsUrl(probe)) {
      return {
        valid: false,
        reason: "Sovrn deeplink template failed shell-safe HTTPS URL validation"
      };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : "Invalid Sovrn deeplink template"
    };
  }
}

export function loadComparisonConfig(
  env: NodeJS.ProcessEnv = process.env
): ComparisonConfig {
  const warnings: string[] = [];
  let sovrnDeeplinkTemplate: string | undefined;

  const rawSovrn = env.SOVRN_COMMERCE_DEEPLINK_TEMPLATE?.trim();
  if (rawSovrn) {
    const check = validateSovrnDeeplinkTemplate(rawSovrn);
    if (check.valid) {
      sovrnDeeplinkTemplate = rawSovrn;
    } else {
      warnings.push(
        `Ignored invalid SOVRN_COMMERCE_DEEPLINK_TEMPLATE: ${check.reason ?? "validation failed"}`
      );
    }
  }

  const rawKelkoo = env.KELKOO_API_TOKEN?.trim();
  const kelkooApiToken = rawKelkoo && rawKelkoo.length > 0 ? rawKelkoo : undefined;

  return {
    sovrnDeeplinkTemplate,
    kelkooApiToken,
    warnings
  };
}

function formatPriceParam(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Generates a strict URL-safe ASCII slug for Toppreise.ch search URLs.
 */
export function toToppreiseSlug(term: string): string {
  const folded = foldSearchText(term)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return folded;
}

interface DecoratedLink {
  url: string;
  affiliate_disclosure: boolean;
  disclosure_note?: string;
  applied_network?: string;
}

function finalizeSafeHttpsUrl(rawUrl: string): string {
  const parsed = validateExternalUrl(rawUrl);
  const safe = enforceShellSafeHttpsUrl(parsed.toString());
  if (!safe) {
    throw new Error("Constructed outbound URL failed shell-safe HTTPS validation");
  }
  return safe;
}

/**
 * Applies configured domain affiliate rules (`AFFILIATE_RULES_JSON`) without injecting
 * noisy `utm_*` params into third-party comparison/deal search URLs, then applies
 * the optional validated `SOVRN_COMMERCE_DEEPLINK_TEMPLATE` wrapper when not already
 * monetized. Plain non-monetized deep-links always return `affiliate_disclosure: false`.
 */
export function decorateComparisonOutboundUrl(
  rawUrl: string,
  attribution: AttributionConfig,
  comparisonConfig: ComparisonConfig
): DecoratedLink {
  const safeInput = finalizeSafeHttpsUrl(rawUrl);

  // Disable universal UTM injection on third-party comparison/deal search engines
  // while keeping explicit domain-matched AFFILIATE_RULES_JSON rules active.
  const noUtmAttribution: AttributionConfig = {
    ...attribution,
    disableUtm: true
  };
  const attributed = applyAttribution(safeInput, noUtmAttribution, { kind: "generic" });

  if (attributed.affiliate_disclosure) {
    return {
      url: finalizeSafeHttpsUrl(attributed.url),
      affiliate_disclosure: true,
      disclosure_note: attributed.disclosure_note ?? AFFILIATE_DISCLOSURE_NOTE,
      applied_network: attributed.applied_network
    };
  }

  if (comparisonConfig.sovrnDeeplinkTemplate) {
    const check = validateSovrnDeeplinkTemplate(comparisonConfig.sovrnDeeplinkTemplate);
    if (check.valid) {
      const currentHost = new URL(attributed.url).hostname.toLowerCase().replace(/\.$/, "");
      if (!ALLOWED_SOVRN_HOSTS.has(currentHost)) {
        const wrapped = comparisonConfig.sovrnDeeplinkTemplate.replaceAll(
          "{encoded_url}",
          encodeURIComponent(attributed.url)
        );
        return {
          url: finalizeSafeHttpsUrl(wrapped),
          affiliate_disclosure: true,
          disclosure_note: AFFILIATE_DISCLOSURE_NOTE,
          applied_network: "sovrn"
        };
      }
    }
  }

  return {
    url: finalizeSafeHttpsUrl(attributed.url),
    affiliate_disclosure: false
  };
}

function buildGeizhalsUrl(
  tld: "at" | "de" | "eu",
  hlocs: readonly string[],
  term: string,
  minPrice: string | null,
  maxPrice: string | null,
  sortBy: ComparisonSortBy
): string {
  const u = new URL(`https://geizhals.${tld}/`);
  u.searchParams.set("fs", term);
  for (const loc of hlocs) {
    u.searchParams.append("hloc", loc);
  }
  if (minPrice !== null) u.searchParams.set("bpmin", minPrice);
  if (maxPrice !== null) u.searchParams.set("bpmax", maxPrice);
  if (sortBy === "price_asc") u.searchParams.set("sort", "p");
  return u.toString();
}

function buildIdealoUrl(
  tld: "at" | "de",
  term: string,
  minPrice: string | null,
  maxPrice: string | null,
  sortBy: ComparisonSortBy
): string {
  const u = new URL(
    `https://www.idealo.${tld}/preisvergleich/MainSearchProductCategory.html`
  );
  u.searchParams.set("q", term);
  if (minPrice !== null) u.searchParams.set("minPrice", minPrice);
  if (maxPrice !== null) u.searchParams.set("maxPrice", maxPrice);
  if (sortBy === "price_asc") u.searchParams.set("sortKey", "minPrice");
  return u.toString();
}

function buildGoogleShoppingUrl(
  gl: string,
  hl: string,
  term: string,
  sortBy: ComparisonSortBy
): string {
  const u = new URL("https://www.google.com/search");
  u.searchParams.set("q", term);
  u.searchParams.set("udm", "28");
  if (sortBy === "price_asc") {
    u.searchParams.set("tbs", "p_ord:p");
  }
  u.searchParams.set("gl", gl);
  u.searchParams.set("hl", hl);
  return u.toString();
}

function buildBilligerDeUrl(term: string): string {
  const u = new URL("https://www.billiger.de/s");
  u.searchParams.set("q", term);
  return u.toString();
}

function buildToppreiseUrl(term: string): string {
  const slug = toToppreiseSlug(term);
  if (slug) {
    return `https://www.toppreise.ch/preisvergleich/${slug}`;
  }
  const fallback = new URL("https://www.toppreise.ch/preisvergleich");
  fallback.searchParams.set("q", term);
  return fallback.toString();
}

/**
 * Deterministic Tier-B 1-click price comparison links (0 outbound server calls).
 * Prefers normalized `ean` when present for direct EAN redirect, otherwise `query`.
 */
export function buildComparisonLinks(
  opts: BuildComparisonLinksOptions
): ComparisonLinksResult {
  const country: ComparisonCountry = opts.country ?? "DE";
  const sortBy: ComparisonSortBy = opts.sortBy ?? "price_asc";
  const attribution = opts.attribution ?? loadAttributionConfig({});
  const comparisonConfig = opts.comparisonConfig ?? loadComparisonConfig({});

  const explicitEan = opts.ean !== undefined ? normalizeEan(opts.ean) : null;
  if (opts.ean !== undefined && !explicitEan) {
    throw new Error(
      "Invalid EAN: must contain 8 to 14 digits (spaces and hyphens are allowed)."
    );
  }

  const cleanQuery = opts.query ? sanitizeText(opts.query, 200) : "";
  const inferredEan = !explicitEan && cleanQuery ? normalizeEan(cleanQuery) : null;
  const effectiveEan = explicitEan ?? inferredEan;

  const searchTerm = effectiveEan ?? cleanQuery;
  if (!searchTerm) {
    throw new Error("At least one of 'query' or 'ean' must be provided.");
  }

  const matchMode: ComparisonMatchMode = effectiveEan ? "ean_exact" : "keyword";
  const minPrice = formatPriceParam(opts.minPrice);
  const maxPrice = formatPriceParam(opts.maxPrice);

  interface RawLinkSpec {
    provider: string;
    label: string;
    url: string;
    supportsEanDirect: boolean;
  }

  const specs: RawLinkSpec[] = [];

  switch (country) {
    case "AT":
      specs.push(
        {
          provider: "geizhals_at",
          label: "Geizhals AT",
          url: buildGeizhalsUrl("at", ["at", "de"], searchTerm, minPrice, maxPrice, sortBy),
          supportsEanDirect: true
        },
        {
          provider: "idealo_at",
          label: "idealo AT",
          url: buildIdealoUrl("at", searchTerm, minPrice, maxPrice, sortBy),
          supportsEanDirect: true
        },
        {
          provider: "google_shopping_at",
          label: "Google Shopping AT",
          url: buildGoogleShoppingUrl("at", "de", searchTerm, sortBy),
          supportsEanDirect: true
        }
      );
      break;
    case "DE":
      specs.push(
        {
          provider: "geizhals_de",
          label: "Geizhals DE",
          url: buildGeizhalsUrl("de", ["de"], searchTerm, minPrice, maxPrice, sortBy),
          supportsEanDirect: true
        },
        {
          provider: "idealo_de",
          label: "idealo DE",
          url: buildIdealoUrl("de", searchTerm, minPrice, maxPrice, sortBy),
          supportsEanDirect: true
        },
        {
          provider: "billiger_de",
          label: "billiger.de",
          url: buildBilligerDeUrl(searchTerm),
          supportsEanDirect: true
        },
        {
          provider: "google_shopping_de",
          label: "Google Shopping DE",
          url: buildGoogleShoppingUrl("de", "de", searchTerm, sortBy),
          supportsEanDirect: true
        }
      );
      break;
    case "CH":
      specs.push(
        {
          provider: "toppreise_ch",
          label: "Toppreise.ch",
          url: buildToppreiseUrl(searchTerm),
          supportsEanDirect: true
        },
        {
          provider: "geizhals_eu",
          label: "Geizhals EU",
          url: buildGeizhalsUrl("eu", ["eu"], searchTerm, minPrice, maxPrice, sortBy),
          supportsEanDirect: true
        },
        {
          provider: "google_shopping_ch",
          label: "Google Shopping CH",
          url: buildGoogleShoppingUrl("ch", "de", searchTerm, sortBy),
          supportsEanDirect: true
        }
      );
      break;
    case "UK":
      specs.push({
        provider: "google_shopping_uk",
        label: "Google Shopping UK",
        url: buildGoogleShoppingUrl("uk", "en", searchTerm, sortBy),
        supportsEanDirect: true
      });
      break;
    case "FR":
      specs.push({
        provider: "google_shopping_fr",
        label: "Google Shopping FR",
        url: buildGoogleShoppingUrl("fr", "fr", searchTerm, sortBy),
        supportsEanDirect: true
      });
      break;
    case "US":
      specs.push({
        provider: "google_shopping_us",
        label: "Google Shopping US",
        url: buildGoogleShoppingUrl("us", "en", searchTerm, sortBy),
        supportsEanDirect: true
      });
      break;
  }

  let anyAffiliate = false;
  let disclosureNote: string | undefined;

  const links: ComparisonDeepLink[] = specs.map((spec) => {
    const decorated = decorateComparisonOutboundUrl(
      spec.url,
      attribution,
      comparisonConfig
    );
    if (decorated.affiliate_disclosure) {
      anyAffiliate = true;
      disclosureNote = disclosureNote ?? decorated.disclosure_note;
    }
    return {
      provider: spec.provider,
      label: spec.label,
      country,
      url: decorated.url,
      match_mode: matchMode,
      tier: "tier_b_deeplink",
      supports_ean_direct: spec.supportsEanDirect,
      affiliate_disclosure: decorated.affiliate_disclosure,
      ...(decorated.applied_network ? { applied_network: decorated.applied_network } : {})
    };
  });

  return {
    country,
    match_mode: matchMode,
    search_term: searchTerm,
    ean: effectiveEan,
    links,
    affiliate_disclosure: anyAffiliate,
    ...(anyAffiliate ? { disclosure_note: disclosureNote ?? AFFILIATE_DISCLOSURE_NOTE } : {})
  };
}

function buildSearchOrHomeUrl(
  baseOrigin: string,
  searchPath: string,
  queryParam: string,
  term: string
): string {
  if (!term) {
    return `${baseOrigin}/`;
  }
  const u = new URL(searchPath, baseOrigin);
  u.searchParams.set(queryParam, term);
  return u.toString();
}

/**
 * Deterministic Tier-B 1-click deal community search links (0 outbound server calls).
 */
export function buildDealSearchLinks(
  opts: BuildDealSearchLinksOptions
): DealSearchLinksResult {
  const region: ComparisonCountry = opts.region ?? "DE";
  const attribution = opts.attribution ?? loadAttributionConfig({});
  const comparisonConfig = opts.comparisonConfig ?? loadComparisonConfig({});

  const cleanQuery = opts.query ? sanitizeText(opts.query, 200) : "";
  const cleanCategory = opts.category ? sanitizeText(opts.category, 80) : "";
  const effectiveTerm = cleanQuery || cleanCategory;

  interface RawDealLinkSpec {
    provider: string;
    label: string;
    url: string;
    note?: string;
  }

  const specs: RawDealLinkSpec[] = [];

  switch (region) {
    case "AT":
      specs.push({
        provider: "preisjaeger_at",
        label: "Preisjäger AT",
        url: buildSearchOrHomeUrl("https://www.preisjaeger.at", "/search", "q", effectiveTerm)
      });
      break;
    case "DE":
      specs.push({
        provider: "mydealz_de",
        label: "mydealz DE",
        url: buildSearchOrHomeUrl("https://www.mydealz.de", "/search", "q", effectiveTerm)
      });
      break;
    case "CH":
      specs.push(
        {
          provider: "preisjaeger_at",
          label: "Preisjäger AT (DACH Deal Community)",
          url: buildSearchOrHomeUrl("https://www.preisjaeger.at", "/search", "q", effectiveTerm),
          note: "DACH deal community (AT/DE/CH deals)"
        },
        {
          provider: "mydealz_de",
          label: "mydealz DE (DACH Deal Community)",
          url: buildSearchOrHomeUrl("https://www.mydealz.de", "/search", "q", effectiveTerm),
          note: "DACH deal community (AT/DE/CH deals)"
        }
      );
      break;
    case "UK":
      specs.push({
        provider: "hotukdeals_uk",
        label: "HotUKDeals UK",
        url: buildSearchOrHomeUrl("https://www.hotukdeals.com", "/search", "q", effectiveTerm)
      });
      break;
    case "FR":
      specs.push({
        provider: "dealabs_fr",
        label: "Dealabs FR",
        url: buildSearchOrHomeUrl("https://www.dealabs.com", "/search", "q", effectiveTerm)
      });
      break;
    case "US":
      specs.push({
        provider: "slickdeals_us",
        label: "Slickdeals US",
        url: buildSearchOrHomeUrl(
          "https://slickdeals.net",
          "/newsearch.php",
          "q",
          effectiveTerm
        )
      });
      break;
  }

  let anyAffiliate = false;
  let disclosureNote: string | undefined;

  const links: DealSearchDeepLink[] = specs.map((spec) => {
    const decorated = decorateComparisonOutboundUrl(
      spec.url,
      attribution,
      comparisonConfig
    );
    if (decorated.affiliate_disclosure) {
      anyAffiliate = true;
      disclosureNote = disclosureNote ?? decorated.disclosure_note;
    }
    return {
      provider: spec.provider,
      label: spec.label,
      region,
      url: decorated.url,
      tier: "tier_b_deeplink",
      ...(spec.note ? { note: spec.note } : {}),
      affiliate_disclosure: decorated.affiliate_disclosure,
      ...(decorated.applied_network ? { applied_network: decorated.applied_network } : {})
    };
  });

  return {
    region,
    query: effectiveTerm || null,
    links,
    affiliate_disclosure: anyAffiliate,
    ...(anyAffiliate ? { disclosure_note: disclosureNote ?? AFFILIATE_DISCLOSURE_NOTE } : {})
  };
}
