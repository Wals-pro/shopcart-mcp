import type { Money } from "../types.js";

export interface AffiliateFeedConfig {
  provider: "awin";
  apiToken: string | undefined;
  publisherId: string | undefined;
  feedIds: string[];
  ttlSeconds: number;
  maxBytes: number;
  maxFeeds: number;
}

export interface AffiliateFeedProduct {
  id: string;
  merchant_product_id: string | null;
  title: string;
  merchant_name: string;
  merchant_id: string | null;
  brand: string | null;
  category: string | null;
  description_text: string;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  available: boolean;
  stock_quantity: number | null;
  price: Money;
  compare_at_price: Money | null;
  url: string;
  product_url: string;
  merchant_url: string | null;
  image_url: string | null;
  affiliate_network: "awin";
  affiliate_disclosure: true;
}

export interface AffiliateFeedSearchOptions {
  query?: string;
  ean?: string;
  merchant?: string;
  limit?: number;
  availableOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  concurrencyKey?: string;
}

export interface AffiliateFeedSearchResult {
  provider: "awin";
  configured: boolean;
  currency: string;
  merchants_searched: string[];
  products: AffiliateFeedProduct[];
  notices: string[];
  affiliate_disclosure: boolean;
  disclosure_note?: string;
}

export interface AffiliateFeedProvider {
  readonly providerName: "awin";
  isConfigured(): boolean;
  clearCache(): void;
  listMerchants(concurrencyKey?: string): Promise<string[]>;
  resolveStoreTarget(
    storeInput: string,
    concurrencyKey?: string
  ): Promise<{ mode: "all" } | { mode: "merchant"; merchant: string } | null>;
  search(opts: AffiliateFeedSearchOptions): Promise<AffiliateFeedSearchResult>;
  searchByEan(
    ean: string,
    opts?: Omit<AffiliateFeedSearchOptions, "ean">
  ): Promise<AffiliateFeedSearchResult>;
}
