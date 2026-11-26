export const STORE_CATEGORY_IDS = [
  "fashion",
  "sports-outdoor",
  "nutrition-supplements",
  "beauty-care",
  "home-living",
  "tech-gadgets",
  "coffee-tea-food",
  "kids-family",
  "sustainable-bio",
  "pets",
  "gifts-lifestyle",
  "secondhand-refurbished"
] as const;

export type StoreCategoryId = (typeof STORE_CATEGORY_IDS)[number];

export const STORE_PLATFORMS = [
  "shopify",
  "woocommerce",
  "shopware",
  "bigcommerce",
  "magento",
  "ucp",
  "other"
] as const;

export type StorePlatform = (typeof STORE_PLATFORMS)[number];

export const STORE_SOURCES = [
  "curated",
  "self_check",
  "affiliate_feed",
  "open_crawl"
] as const;

export type StoreSource = (typeof STORE_SOURCES)[number];

export interface StoreCategoryDefinition {
  readonly id: StoreCategoryId;
  readonly label_de: string;
  readonly label_en: string;
  readonly aliases: readonly string[];
}

export interface StoreDirectoryEntry {
  readonly domain: string;
  readonly name: string;
  readonly platform: StorePlatform;
  readonly countries: readonly string[];
  readonly categories: readonly StoreCategoryId[];
  readonly tags: readonly string[];
  readonly language: readonly string[];
  readonly description_de: string;
  readonly description_en: string;
  readonly cart_supported: boolean;
  readonly discounts_supported: boolean;
  readonly source: StoreSource;
  readonly verified_at: string;
}

/**
 * Pluggable feed/source adapter interface so future automated imports
 * (self_check opt-ins, Awin/Sovrn/Kelkoo feeds, HTTP Archive open crawls)
 * integrate into StoreDirectoryRegistry without modifying MCP or web consumers.
 */
export interface StoreDirectorySourceProvider {
  readonly id: string;
  readonly source: StoreSource;
  load(): readonly StoreDirectoryEntry[];
}

export interface StoreDiscoveryFilters {
  query?: string;
  category?: string;
  country?: string;
  platform?: string;
  cart_only?: boolean;
  limit?: number;
  lang?: "de" | "en";
}

export interface StoreDiscoveryItem {
  readonly name: string;
  readonly domain: string;
  readonly url: string;
  readonly platform: StorePlatform;
  readonly countries: readonly string[];
  readonly categories: readonly StoreCategoryId[];
  readonly tags: readonly string[];
  readonly language: readonly string[];
  readonly description: string;
  readonly description_de: string;
  readonly description_en: string;
  readonly cart_supported: boolean;
  readonly discounts_supported: boolean;
  readonly source: StoreSource;
  readonly verified_at: string;
}

export interface StoreDiscoveryAppliedFilters {
  readonly query: string | null;
  readonly category: StoreCategoryId | null;
  readonly country: string | null;
  readonly platform: StorePlatform | null;
  readonly cart_only: boolean;
  readonly limit: number;
}

export interface StoreDirectoryFacets {
  readonly categories: Readonly<Record<StoreCategoryId, number>>;
  readonly countries: Readonly<Record<string, number>>;
  readonly platforms: Readonly<Record<StorePlatform, number>>;
  readonly cart_supported: number;
}

export interface StoreDiscoveryResult {
  readonly total_matches: number;
  readonly returned: number;
  readonly directory_size: number;
  readonly applied_filters: StoreDiscoveryAppliedFilters;
  readonly available_categories: readonly StoreCategoryId[];
  readonly stores: readonly StoreDiscoveryItem[];
  readonly facets: StoreDirectoryFacets;
  readonly notices: readonly string[];
}
