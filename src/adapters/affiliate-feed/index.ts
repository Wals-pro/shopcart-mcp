import {
  AwinFeedClient,
  isCrossStoreAlias,
  loadAffiliateFeedConfig,
  normalizeEan,
  parseCsvRecords,
  validateAwinFeedUrl,
  type AffiliateFetcherFn
} from "./awin.js";
import type {
  AffiliateFeedConfig,
  AffiliateFeedProduct,
  AffiliateFeedProvider,
  AffiliateFeedSearchOptions,
  AffiliateFeedSearchResult
} from "./types.js";

export {
  AwinFeedClient,
  isCrossStoreAlias,
  loadAffiliateFeedConfig,
  normalizeEan,
  parseCsvRecords,
  validateAwinFeedUrl
};

export type {
  AffiliateFeedConfig,
  AffiliateFeedProduct,
  AffiliateFeedProvider,
  AffiliateFeedSearchOptions,
  AffiliateFeedSearchResult,
  AffiliateFetcherFn
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
