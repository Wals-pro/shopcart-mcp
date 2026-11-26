import { BigCommerceAdapter } from "./bigcommerce/adapter.js";
import { MagentoAdapter } from "./magento/adapter.js";
import { ShopifyAdapter } from "./shopify/adapter.js";
import { ShopwareAdapter } from "./shopware/adapter.js";
import type { StoreAdapter, StoreInfo } from "./types.js";

interface CachedResolution {
  adapter: StoreAdapter;
  store: StoreInfo;
  expiresAt: number;
}

const REGISTRY_CACHE_TTL_MS = 15 * 60 * 1000;

export class AdapterRegistry {
  private readonly adapters: StoreAdapter[];
  private readonly cache = new Map<string, CachedResolution>();

  constructor(adapters?: StoreAdapter[]) {
    // Fast deterministic order:
    // 1. Shopify (JSON /meta.json, /cart.js, /search/suggest.json, /api/mcp & /api/ucp/mcp)
    // 2. Magento 2 / Adobe Commerce (single fast read-only POST /graphql storeConfig probe)
    // 3. Shopware 6 (Store API /store-api/context + storefront HTML markers)
    // 4. BigCommerce (Stencil HTML / BCData / /cart.php markers)
    this.adapters = adapters ?? [
      new ShopifyAdapter(),
      new MagentoAdapter(),
      new ShopwareAdapter(),
      new BigCommerceAdapter()
    ];
  }

  getDefault(): StoreAdapter {
    return this.adapters[0]!;
  }

  listPlatforms(): string[] {
    return this.adapters.map((a) => a.platform);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async resolve(
    origin: string,
    concurrencyKey?: string
  ): Promise<{ adapter: StoreAdapter; store: StoreInfo | null }> {
    const now = Date.now();
    for (const adapter of this.adapters) {
      const store = await adapter.detect(origin, concurrencyKey);
      if (store) {
        const entry: CachedResolution = {
          adapter,
          store,
          expiresAt: now + REGISTRY_CACHE_TTL_MS
        };
        this.cache.set(origin, entry);
        if (store.origin !== origin) {
          this.cache.set(store.origin, entry);
        }
        return { adapter, store };
      }
    }
    return { adapter: this.getDefault(), store: null };
  }

  async resolveAdapter(origin: string, concurrencyKey?: string): Promise<StoreAdapter> {
    const cached = this.cache.get(origin);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.adapter;
    }
    const { adapter } = await this.resolve(origin, concurrencyKey);
    return adapter;
  }
}
