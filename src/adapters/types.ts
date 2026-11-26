export interface Money {
  amount: number;
  formatted: string;
  currency: string;
}

export type StorePlatform =
  | "shopify"
  | "woocommerce"
  | "amazon"
  | "secondhand"
  | "bigcommerce"
  | "shopware"
  | "magento"
  | "jsonld";

export type ProductCondition =
  | "new"
  | "refurbished"
  | "like_new"
  | "used"
  | "damaged"
  | "unknown";

export type HandoffTier =
  | "cart_permalink"
  | "item_cart_sequence"
  | "direct_product_link"
  | "search_handoff";

export type ProductAvailability =
  | "InStock"
  | "OutOfStock"
  | "PreOrder"
  | "LimitedAvailability"
  | "Unknown";

export interface StoreInfo {
  platform: StorePlatform;
  origin: string;
  name: string | null;
  currency: string;
  country: string | null;
  myshopifyDomain: string | null;
  wafRestricted: boolean;
  capabilities: {
    predictiveSearch: boolean;
    productCatalogJson: boolean;
    storefrontMcp: boolean;
    storefrontMcpTools: string[];
    wooStoreApi?: boolean;
    liveSearch?: boolean;
    searchProvider?: "paapi" | "keepa" | "none";
    asinCartPermalink?: boolean;
    affiliateTagConfigured?: boolean;
    jsonLdProduct?: boolean;
    searchActionUrl?: string | null;
    sitemaps?: string[];
    storefrontMcpEndpoint?: string | null;
    storefrontUcp?: boolean;
    storefrontUcpTools?: string[];
    storefrontUcpEndpoint?: string | null;
    bigcommerceStorefront?: boolean;
    bigcommerceCartPermalink?: boolean;
    shopwareStoreApi?: boolean;
    shopwareStorefrontSuggest?: boolean;
    magentoGraphql?: boolean;
    handoffTier?: HandoffTier;
    singleItemLookup?: boolean;
    liveApiConfigured?: boolean;
    marketplaceId?: string;
  };
}

export interface ProductSummary {
  id: string;
  handle: string;
  title: string;
  vendor: string | null;
  product_type: string | null;
  available: boolean;
  condition?: ProductCondition;
  condition_raw?: string | null;
  price: Money;
  price_min: Money;
  price_max: Money;
  compare_at_price: Money | null;
  discount_percent?: number | null;
  savings?: Money | null;
  url: string;
  image_url: string | null;
}

export interface ProductVariant {
  id: string;
  title: string;
  sku: string | null;
  gtin?: string | null;
  ean?: string | null;
  mpn?: string | null;
  available: boolean;
  availability?: ProductAvailability;
  condition?: ProductCondition;
  condition_raw?: string | null;
  price: Money;
  compare_at_price: Money | null;
  discount_percent?: number | null;
  savings?: Money | null;
  option_values: string[];
  url?: string | null;
}

export interface ProductDetail {
  id: string;
  handle: string;
  title: string;
  vendor: string | null;
  product_type: string | null;
  description_text: string;
  sku?: string | null;
  gtin?: string | null;
  ean?: string | null;
  mpn?: string | null;
  available: boolean;
  availability?: ProductAvailability;
  condition?: ProductCondition;
  condition_raw?: string | null;
  price_min?: Money;
  price_max?: Money;
  metadata_source?: "jsonld" | "jsonld+opengraph" | "opengraph";
  url: string;
  options: Array<{ name: string; values: string[] }>;
  images: string[];
  variants: ProductVariant[];
}

export type ProductSortBy = "relevance" | "price_asc" | "price_desc" | "discount_desc";

export interface SearchProductsOptions {
  query?: string;
  collection?: string;
  sortBy?: ProductSortBy;
  limit: number;
  availableOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  condition?: ProductCondition;
  currencyHint?: string;
  concurrencyKey?: string;
}

export interface SearchHints {
  search_url?: string | null;
  sitemaps?: string[];
}

export interface SearchProductsResult {
  store_origin: string;
  currency: string;
  collection?: string;
  sort_by?: ProductSortBy;
  handoff_tier?: HandoffTier;
  affiliate_disclosure?: boolean;
  products: ProductSummary[];
  notices: string[];
  agent_guidance?: string;
  search_hints?: SearchHints;
}

export interface CollectionSummary {
  id: string;
  handle: string;
  title: string;
  products_count: number | null;
  url: string;
  is_deal_collection: boolean;
  deal_tags: string[];
}

export interface ListCollectionsOptions {
  limit?: number;
  dealsOnly?: boolean;
  concurrencyKey?: string;
}

export interface ListCollectionsResult {
  store_origin: string;
  waf_restricted: boolean;
  total_collections: number;
  highlighted_deals: CollectionSummary[];
  collections: CollectionSummary[];
  notices: string[];
}

export type PolicyTopic = "shipping" | "returns" | "all";

export interface PolicyHints {
  free_shipping_threshold: string | null;
  return_window_days: number | null;
  return_window_text: string | null;
  free_returns: boolean | null;
  delivery_time_text: string | null;
  shipping_carriers: string[];
}

export interface StorePoliciesOptions {
  topic?: PolicyTopic;
  question?: string;
  concurrencyKey?: string;
}

export interface StorePoliciesResult {
  store_origin: string;
  shipping_policy_excerpt: string | null;
  return_policy_excerpt: string | null;
  mcp_faq_answer?: string;
  hints: PolicyHints;
  policy_urls: {
    shipping: string;
    returns: string;
  };
  notices: string[];
}

export interface GetProductResult {
  store_origin: string;
  currency: string;
  product: ProductDetail;
  handoff_tier?: HandoffTier;
  affiliate_disclosure?: boolean;
  notices?: string[];
  agent_guidance?: string;
}

export interface CartLinkItemInput {
  variantId: string;
  quantity: number;
}

export interface CartLinkItemResult {
  variant_id: string;
  quantity: number;
  verified?: boolean;
  available?: boolean;
  title?: string;
  unit_price?: Money;
}

export interface AdditionalCartLink {
  variant_id: string;
  quantity: number;
  title?: string;
  cart_url: string;
}

export type DiscountSource =
  | "homepage_announcement"
  | "homepage_banner"
  | "homepage_text"
  | "collection_description"
  | "partner_rule";

export type DiscountConfidence = "high" | "medium";

export interface ExtractedDiscountCode {
  code: string;
  context_snippet: string;
  source: DiscountSource;
  estimated_discount_text?: string;
  confidence: DiscountConfidence;
}

export interface AutomaticDeal {
  text: string;
  source: Exclude<DiscountSource, "partner_rule">;
}

export interface FindStoreDiscountsOptions {
  timeoutMs?: number;
  fastMode?: boolean;
  forceRefresh?: boolean;
  concurrencyKey?: string;
}

export interface StoreDiscountsResult {
  store_origin: string;
  codes: ExtractedDiscountCode[];
  automatic_deals: AutomaticDeal[];
  checked_sources: string[];
  source_notice: string;
  disclaimer: string;
  notices?: string[];
}

export type CartMode =
  | "cart_permalink"
  | "checkout_permalink"
  | "direct_product_link"
  | "search_handoff";

export interface CartLinkResult {
  store_origin: string;
  cart_url: string;
  mode: "cart" | "checkout";
  cart_mode?: CartMode;
  handoff_tier?: HandoffTier;
  items: CartLinkItemResult[];
  additional_cart_links?: AdditionalCartLink[];
  applied_discount_code?: string;
  discount_source?: DiscountSource | "user_supplied";
  discount_context?: string;
  discount_notice?: string;
  source_notice?: string;
  affiliate_disclosure?: boolean;
  warnings: string[];
  next_step: string;
}

export interface StoreAdapter {
  readonly platform: string;
  detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null>;
  listCollections?(origin: string, opts?: ListCollectionsOptions): Promise<ListCollectionsResult>;
  findStoreDiscounts?(
    origin: string,
    opts?: FindStoreDiscountsOptions
  ): Promise<StoreDiscountsResult>;
  searchProducts(origin: string, opts: SearchProductsOptions): Promise<SearchProductsResult>;
  getProduct(
    origin: string,
    handleOrUrl: string,
    opts?: { currencyHint?: string; concurrencyKey?: string }
  ): Promise<GetProductResult>;
  getStorePolicies?(origin: string, opts?: StorePoliciesOptions): Promise<StorePoliciesResult>;
  buildCartLink(
    origin: string,
    items: CartLinkItemInput[],
    opts: {
      mode: "cart" | "checkout";
      discountCode?: string;
      verifyHandles?: string[];
      concurrencyKey?: string;
    }
  ): Promise<CartLinkResult>;
}
