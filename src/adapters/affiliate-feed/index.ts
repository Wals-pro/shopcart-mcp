import {
  AwinFeedClient,
  isCrossStoreAlias,
  loadAffiliateFeedConfig,
  normalizeEan,
  parseCsvRecords,
  validateAwinFeedUrl,
  type AffiliateFetcherFn
} from "./awin.js";
import {
  AwinPromotionsClient,
  createAwinPromotionsProvider,
  mapRegionToAwinCode,
  validateAwinPromotionsUrl,
  type AwinPromotionItem,
  type AwinPromotionsProvider,
  type AwinPromotionsSearchOptions,
  type AwinPromotionsSearchResult
} from "./awin-promotions.js";
import type {
  AffiliateFeedConfig,
  AffiliateFeedProduct,
  AffiliateFeedProvider,
  AffiliateFeedSearchOptions,
  AffiliateFeedSearchResult
} from "./types.js";

export {
  AwinFeedClient,
  AwinPromotionsClient,
  createAwinPromotionsProvider,
  isCrossStoreAlias,
  loadAffiliateFeedConfig,
  mapRegionToAwinCode,
  normalizeEan,
  parseCsvRecords,
  validateAwinFeedUrl,
  validateAwinPromotionsUrl
};

export type {
  AffiliateFeedConfig,
  AffiliateFeedProduct,
  AffiliateFeedProvider,
  AffiliateFeedSearchOptions,
  AffiliateFeedSearchResult,
  AffiliateFetcherFn,
  AwinPromotionItem,
  AwinPromotionsProvider,
  AwinPromotionsSearchOptions,
  AwinPromotionsSearchResult
};

export function createAffiliateFeedProvider(
  config: AffiliateFeedConfig = loadAffiliateFeedConfig(),
  opts: { fetcher?: AffiliateFetcherFn; nowFn?: () => number } = {}
): AffiliateFeedProvider {
  return new AwinFeedClient(config, opts);
}

export async function searchAffiliateDeals(
  provider: AffiliateFeedProvider,
  opts: AffiliateFeedSearchOptions
): Promise<AffiliateFeedSearchResult> {
  return provider.search(opts);
}
