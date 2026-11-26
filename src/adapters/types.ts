export interface Money {
  amount: number;
  formatted: string;
  currency: string;
}

export type StorePlatform = "shopify" | "bigcommerce" | "shopware" | "magento";

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
    storefrontMcpEndpoint?: string | null;
    storefrontUcp?: boolean;
    storefrontUcpTools?: string[];
    storefrontUcpEndpoint?: string | null;
    bigcommerceStorefront?: boolean;
    bigcommerceCartPermalink?: boolean;
    shopwareStoreApi?: boolean;
    shopwareStorefrontSuggest?: boolean;
    magentoGraphql?: boolean;
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
  discount_percent?: number | null;
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
  discount_percent?: number | null;
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

export interface SearchProductsOptions {
  query?: string;
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
  products: ProductSummary[];
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

export interface AdditionalCartLink {
  variant_id: string;
  quantity: number;
  title?: string;
  cart_url: string;
}

export interface CartLinkResult {
  store_origin: string;
  cart_url: string;
  mode: "cart" | "checkout";
  items: CartLinkItemResult[];
  additional_cart_links?: AdditionalCartLink[];
  warnings: string[];
  next_step: string;
}

export interface StoreAdapter {
  readonly platform: string;
  detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null>;
  searchProducts(origin: string, opts: SearchProductsOptions): Promise<SearchProductsResult>;
  getProduct(
    origin: string,
    handleOrUrl: string,
    opts?: { currencyHint?: string; concurrencyKey?: string }
  ): Promise<GetProductResult>;
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
