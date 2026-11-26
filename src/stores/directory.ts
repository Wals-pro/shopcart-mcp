import { sanitizeText } from "../security/sanitize.js";
import {
  STORE_CATEGORIES,
  normalizeLookupToken,
  resolveCategorySlug
} from "./categories.js";
import { CURATED_STORES } from "./curated-stores.js";
import {
  STORE_CATEGORY_IDS,
  STORE_PLATFORMS,
  type StoreCategoryId,
  type StoreDirectoryEntry,
  type StoreDirectoryFacets,
  type StoreDirectorySourceProvider,
  type StoreDiscoveryAppliedFilters,
  type StoreDiscoveryFilters,
  type StoreDiscoveryItem,
  type StoreDiscoveryResult,
  type StorePlatform,
  type StoreSource
} from "./types.js";

const SOURCE_PRIORITY: Readonly<Record<StoreSource, number>> = {
  curated: 0,
  self_check: 1,
  affiliate_feed: 2,
  open_crawl: 3
};

const DACH_COUNTRIES = new Set(["DE", "AT", "CH"]);

const PLATFORM_ALIASES: Readonly<Record<string, StorePlatform>> = {
  shopify: "shopify",
  woocommerce: "woocommerce",
  woo: "woocommerce",
  shopware: "shopware",
  shopware6: "shopware",
  "shopware-6": "shopware",
  bigcommerce: "bigcommerce",
  bc: "bigcommerce",
  magento: "magento",
  magento2: "magento",
  "magento-2": "magento",
  adobe: "magento",
  ucp: "ucp",
  other: "other",
  jsonld: "other",
  "json-ld": "other"
};

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "buy",
  "das",
  "de",
  "der",
  "die",
  "ein",
  "eine",
  "einen",
  "for",
  "from",
  "fuer",
  "fur",
  "good",
  "gute",
  "guten",
  "im",
  "in",
  "kaufen",
  "mit",
  "of",
  "on",
  "online",
  "or",
  "oder",
  "shop",
  "shops",
  "store",
  "stores",
  "the",
  "to",
  "und",
  "von",
  "where",
  "with",
  "wo",
  "aus",
  "bei"
]);

const MAX_QUERY_TOKENS = 12;

export function normalizeSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokenizeQuery(raw: string): string[] {
  const cleaned = normalizeSearchText(sanitizeText(raw, 200));
  const rawTokens = cleaned
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  if (rawTokens.length === 0) {
    const singleChars = cleaned
      .split(/[^a-z0-9]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return singleChars.slice(0, MAX_QUERY_TOKENS);
  }

  const meaningful = rawTokens.filter((t) => !QUERY_STOP_WORDS.has(t));
  const selected = meaningful.length > 0 ? meaningful : rawTokens;
  return Array.from(new Set(selected)).slice(0, MAX_QUERY_TOKENS);
}

export function normalizeCanonicalDomain(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith("https://")) host = host.slice(8);
  else if (host.startsWith("http://")) host = host.slice(7);
  const slashIdx = host.indexOf("/");
  if (slashIdx !== -1) host = host.slice(0, slashIdx);
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

export function resolveCountryFilter(raw: string | undefined): {
  canonical: string | null;
  codes: readonly string[] | null;
  invalid: boolean;
} {
  if (!raw) return { canonical: null, codes: null, invalid: false };
  const cleaned = sanitizeText(raw, 32).trim().toUpperCase();
  if (!cleaned || cleaned === "ALL" || cleaned === "ALLE") {
    return { canonical: null, codes: null, invalid: false };
  }
  if (cleaned === "DACH") {
    return { canonical: "DACH", codes: ["DE", "AT", "CH"], invalid: false };
  }
  if (cleaned === "GB" || cleaned === "UNITED KINGDOM") {
    return { canonical: "UK", codes: ["UK"], invalid: false };
  }
  if (cleaned === "USA" || cleaned === "UNITED STATES") {
    return { canonical: "US", codes: ["US"], invalid: false };
  }
  if (cleaned === "GERMANY" || cleaned === "DEUTSCHLAND") {
    return { canonical: "DE", codes: ["DE"], invalid: false };
  }
  if (cleaned === "AUSTRIA" || cleaned === "ÖSTERREICH" || cleaned === "OESTERREICH") {
    return { canonical: "AT", codes: ["AT"], invalid: false };
  }
  if (cleaned === "SWITZERLAND" || cleaned === "SCHWEIZ") {
    return { canonical: "CH", codes: ["CH"], invalid: false };
  }
  if (/^[A-Z]{2}$/.test(cleaned)) {
    return { canonical: cleaned, codes: [cleaned], invalid: false };
  }
  return { canonical: null, codes: null, invalid: true };
}

export function resolvePlatformFilter(raw: string | undefined): {
  platform: StorePlatform | null;
  invalid: boolean;
} {
  if (!raw) return { platform: null, invalid: false };
  const cleaned = normalizeLookupToken(sanitizeText(raw, 40));
  if (!cleaned || cleaned === "all" || cleaned === "alle") {
    return { platform: null, invalid: false };
  }
  const mapped = PLATFORM_ALIASES[cleaned] ?? PLATFORM_ALIASES[cleaned.replace(/-/g, "")];
  if (mapped) {
    return { platform: mapped, invalid: false };
  }
  return { platform: null, invalid: true };
}

interface IndexedStore {
  readonly entry: StoreDirectoryEntry;
  readonly domainNorm: string;
  readonly nameNorm: string;
  readonly tagsNorm: readonly string[];
  readonly categoryTextNorm: string;
  readonly descriptionNorm: string;
  readonly countrySet: ReadonlySet<string>;
  readonly categorySet: ReadonlySet<StoreCategoryId>;
}

function buildIndexedStore(entry: StoreDirectoryEntry): IndexedStore {
  const categoryLabels = entry.categories
    .map((catId) => {
      const def = STORE_CATEGORIES.find((c) => c.id === catId);
      if (!def) return catId;
      return `${catId} ${def.label_de} ${def.label_en} ${def.aliases.join(" ")}`;
    })
    .join(" ");

  return {
    entry,
    domainNorm: normalizeSearchText(entry.domain),
    nameNorm: normalizeSearchText(entry.name),
    tagsNorm: entry.tags.map((t) => normalizeSearchText(t)),
    categoryTextNorm: normalizeSearchText(categoryLabels),
    descriptionNorm: normalizeSearchText(`${entry.description_de} ${entry.description_en}`),
    countrySet: new Set(entry.countries.map((c) => c.toUpperCase())),
    categorySet: new Set(entry.categories)
  };
}

function scoreTokenAgainstStore(token: string, item: IndexedStore): number {
  let score = 0;

  if (item.domainNorm === token || item.nameNorm === token) {
    score += 40;
  } else if (item.nameNorm.startsWith(token) || item.domainNorm.startsWith(token)) {
    score += 25;
  } else if (item.nameNorm.includes(token) || item.domainNorm.includes(token)) {
    score += 18;
  }

  let bestTagScore = 0;
  for (const tag of item.tagsNorm) {
    if (tag === token) {
      bestTagScore = Math.max(bestTagScore, 18);
    } else if (tag.startsWith(token) || token.startsWith(tag)) {
      bestTagScore = Math.max(bestTagScore, 13);
    } else if (tag.includes(token) || (token.length >= 4 && tag.length >= 4 && token.includes(tag))) {
      bestTagScore = Math.max(bestTagScore, 10);
    }
  }
  score += bestTagScore;

  if (item.categoryTextNorm.includes(token)) {
    score += 11;
  }

  if (item.descriptionNorm.includes(token)) {
    score += 7;
  }

  return score;
}

function scoreStoreForQuery(tokens: readonly string[], item: IndexedStore): number {
  if (tokens.length === 0) return 1;

  let totalScore = 0;
  let matchedCount = 0;

  for (const token of tokens) {
    const tokenScore = scoreTokenAgainstStore(token, item);
    if (tokenScore > 0) {
      totalScore += tokenScore;
      matchedCount++;
    }
  }

  if (matchedCount === 0) return 0;

  // Strongly boost stores matching all query terms
  if (matchedCount === tokens.length) {
    totalScore += 24;
  } else {
    // Proportional bonus for multi-token coverage
    totalScore += Math.round((matchedCount / tokens.length) * 12);
  }

  return totalScore;
}

function toDiscoveryItem(entry: StoreDirectoryEntry, lang: "de" | "en"): StoreDiscoveryItem {
  return {
    name: entry.name,
    domain: entry.domain,
    url: `https://${entry.domain}`,
    platform: entry.platform,
    countries: entry.countries,
    categories: entry.categories,
    tags: entry.tags,
    language: entry.language,
    description: lang === "de" ? entry.description_de : entry.description_en,
    description_de: entry.description_de,
    description_en: entry.description_en,
    cart_supported: entry.cart_supported,
    discounts_supported: entry.discounts_supported,
    source: entry.source,
    verified_at: entry.verified_at
  };
}

function computeFacets(items: readonly IndexedStore[]): StoreDirectoryFacets {
  const categories = Object.fromEntries(
    STORE_CATEGORY_IDS.map((id) => [id, 0])
  ) as Record<StoreCategoryId, number>;
  const platforms = Object.fromEntries(
    STORE_PLATFORMS.map((p) => [p, 0])
  ) as Record<StorePlatform, number>;
  const countries: Record<string, number> = {};
  let cartSupported = 0;

  for (const item of items) {
    for (const cat of item.entry.categories) {
      categories[cat] = (categories[cat] ?? 0) + 1;
    }
    platforms[item.entry.platform] = (platforms[item.entry.platform] ?? 0) + 1;
    let inDach = false;
    for (const c of item.countrySet) {
      countries[c] = (countries[c] ?? 0) + 1;
      if (DACH_COUNTRIES.has(c)) inDach = true;
    }
    if (inDach) {
      countries.DACH = (countries.DACH ?? 0) + 1;
    }
    if (item.entry.cart_supported) {
      cartSupported++;
    }
  }

  return {
    categories,
    countries,
    platforms,
    cart_supported: cartSupported
  };
}

export function createCuratedStoreSource(): StoreDirectorySourceProvider {
  return {
    id: "curated-seed-v1",
    source: "curated",
    load: () => CURATED_STORES
  };
}

export class StoreDirectoryRegistry {
  private readonly sources: StoreDirectorySourceProvider[] = [];
  private indexed: IndexedStore[] = [];
  private byDomain = new Map<string, IndexedStore>();

  constructor(sources: readonly StoreDirectorySourceProvider[] = [createCuratedStoreSource()]) {
    for (const src of sources) {
      this.sources.push(src);
    }
    this.rebuildIndex();
  }

  registerSource(provider: StoreDirectorySourceProvider): void {
    const existingIdx = this.sources.findIndex((s) => s.id === provider.id);
    if (existingIdx >= 0) {
      this.sources[existingIdx] = provider;
    } else {
      this.sources.push(provider);
    }
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    const deduped = new Map<string, StoreDirectoryEntry>();
    const orderedSources = [...this.sources].sort(
      (a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
    );

    for (const provider of orderedSources) {
      for (const rawEntry of provider.load()) {
        const domain = normalizeCanonicalDomain(rawEntry.domain);
        if (!domain) continue;
        if (!deduped.has(domain)) {
          deduped.set(domain, {
            ...rawEntry,
            domain
          });
        }
      }
    }

    this.indexed = Array.from(deduped.values()).map(buildIndexedStore);
    this.byDomain = new Map(this.indexed.map((item) => [item.entry.domain, item]));
  }

  size(): number {
    return this.indexed.length;
  }

  listAll(): readonly StoreDirectoryEntry[] {
    return this.indexed.map((item) => item.entry);
  }

  getByDomain(domain: string): StoreDirectoryEntry | null {
    const canonical = normalizeCanonicalDomain(domain);
    return this.byDomain.get(canonical)?.entry ?? null;
  }

  getFacets(): StoreDirectoryFacets {
    return computeFacets(this.indexed);
  }

  discover(
    filters: StoreDiscoveryFilters = {},
    opts: { defaultLimit?: number; maxLimit?: number } = {}
  ): StoreDiscoveryResult {
    const defaultLimit = opts.defaultLimit ?? 10;
    const maxLimit = opts.maxLimit ?? 30;
    const lang: "de" | "en" = filters.lang === "de" ? "de" : "en";
    const notices: string[] = [];

    const rawLimit = typeof filters.limit === "number" && Number.isFinite(filters.limit)
      ? Math.trunc(filters.limit)
      : defaultLimit;
    const clampedLimit = Math.max(1, Math.min(maxLimit, rawLimit));

    const cleanQuery = filters.query ? sanitizeText(filters.query, 200) : "";
    const queryTokens = cleanQuery ? tokenizeQuery(cleanQuery) : [];

    let resolvedCategory: StoreCategoryId | null = null;
    let invalidCategory = false;
    if (filters.category && filters.category.trim()) {
      const cleanCat = sanitizeText(filters.category, 80);
      const lowered = cleanCat.toLowerCase();
      if (lowered !== "all" && lowered !== "alle") {
        resolvedCategory = resolveCategorySlug(cleanCat);
        if (!resolvedCategory) {
          invalidCategory = true;
          notices.push(
            `Unknown category '${cleanCat}'. Valid categories: ${STORE_CATEGORY_IDS.join(", ")}.`
          );
        }
      }
    }

    const countryFilter = resolveCountryFilter(filters.country);
    if (countryFilter.invalid) {
      notices.push(
        `Unknown country filter '${sanitizeText(filters.country, 32)}'. Use ISO-2 codes like DE, AT, CH, US, UK, EU, or 'DACH'.`
      );
    }

    const platformFilter = resolvePlatformFilter(filters.platform);
    if (platformFilter.invalid) {
      notices.push(
        `Unknown platform filter '${sanitizeText(filters.platform, 40)}'. Valid platforms: ${STORE_PLATFORMS.join(", ")}.`
      );
    }

    const cartOnly = Boolean(filters.cart_only);

    const appliedFilters: StoreDiscoveryAppliedFilters = {
      query: cleanQuery || null,
      category: resolvedCategory,
      country: countryFilter.canonical,
      platform: platformFilter.platform,
      cart_only: cartOnly,
      limit: clampedLimit
    };

    if (invalidCategory || countryFilter.invalid || platformFilter.invalid) {
      return {
        total_matches: 0,
        returned: 0,
        directory_size: this.indexed.length,
        applied_filters: appliedFilters,
        available_categories: STORE_CATEGORY_IDS,
        stores: [],
        facets: computeFacets([]),
        notices
      };
    }

    const scored: Array<{ item: IndexedStore; score: number }> = [];

    for (const item of this.indexed) {
      if (resolvedCategory && !item.categorySet.has(resolvedCategory)) {
        continue;
      }
      if (countryFilter.codes) {
        const matchesCountry = countryFilter.codes.some((code) => item.countrySet.has(code));
        if (!matchesCountry) continue;
      }
      if (platformFilter.platform && item.entry.platform !== platformFilter.platform) {
        continue;
      }
      if (cartOnly && !item.entry.cart_supported) {
        continue;
      }

      const queryScore = scoreStoreForQuery(queryTokens, item);
      if (queryTokens.length > 0 && queryScore === 0) {
        continue;
      }

      const qualityBoost =
        (item.entry.cart_supported ? 2 : 0) + (item.entry.discounts_supported ? 1 : 0);

      scored.push({
        item,
        score: queryScore * 10 + qualityBoost
      });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.entry.name.localeCompare(b.item.entry.name, "en");
    });

    const matchedItems = scored.map((s) => s.item);
    const sliced = matchedItems.slice(0, clampedLimit);

    return {
      total_matches: matchedItems.length,
      returned: sliced.length,
      directory_size: this.indexed.length,
      applied_filters: appliedFilters,
      available_categories: STORE_CATEGORY_IDS,
      stores: sliced.map((s) => toDiscoveryItem(s.entry, lang)),
      facets: computeFacets(matchedItems),
      notices
    };
  }
}

let defaultDirectory: StoreDirectoryRegistry | null = null;

export function getStoreDirectory(): StoreDirectoryRegistry {
  if (!defaultDirectory) {
    defaultDirectory = new StoreDirectoryRegistry();
  }
  return defaultDirectory;
}

export function discoverStores(
  filters: StoreDiscoveryFilters = {},
  opts?: { defaultLimit?: number; maxLimit?: number }
): StoreDiscoveryResult {
  return getStoreDirectory().discover(filters, opts);
}
