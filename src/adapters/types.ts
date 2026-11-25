export interface Money {
  amount: number;
  formatted: string;
  currency: string;
}

export interface StoreInfo {
  platform: "shopify";
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
  };
}

export interface ProductSummary {
  id: string;
  handle: string;
  title: string;
  vendor: string | null;
  product_type: string | null;
  available: boolean;
  price: Money;
  price_min: Money;
  price_max: Money;
  compare_at_price: Money | null;
  discount_percent: number | null;
  savings: Money | null;
  url: string;
  image_url: string | null;
}

export interface ProductVariant {
  id: string;
  title: string;
  sku: string | null;
  available: boolean;
  price: Money;
  compare_at_price: Money | null;
  discount_percent: number | null;
  savings: Money | null;
  option_values: string[];
}

export interface ProductDetail {
  id: string;
  handle: string;
  title: string;
  vendor: string | null;
  product_type: string | null;
  description_text: string;
  available: boolean;
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
  currencyHint?: string;
  concurrencyKey?: string;
}

export interface SearchProductsResult {
  store_origin: string;
  currency: string;
  collection?: string;
  sort_by?: ProductSortBy;
  products: ProductSummary[];
  notices: string[];
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

export interface CartLinkResult {
  store_origin: string;
  cart_url: string;
  mode: "cart" | "checkout";
  items: CartLinkItemResult[];
  warnings: string[];
  next_step: string;
}

export interface StoreAdapter {
  readonly platform: string;
  detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null>;
  listCollections(origin: string, opts?: ListCollectionsOptions): Promise<ListCollectionsResult>;
  searchProducts(origin: string, opts: SearchProductsOptions): Promise<SearchProductsResult>;
  getProduct(
    origin: string,
    handleOrUrl: string,
    opts?: { currencyHint?: string; concurrencyKey?: string }
  ): Promise<GetProductResult>;
  getStorePolicies(origin: string, opts?: StorePoliciesOptions): Promise<StorePoliciesResult>;
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
