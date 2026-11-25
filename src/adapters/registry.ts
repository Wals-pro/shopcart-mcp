import { AmazonAdapter } from "./amazon/adapter.js";
import { ShopifyAdapter } from "./shopify/adapter.js";
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
    // AmazonAdapter is registered first because its domain detection is purely synchronous (0 ms, no network probe).
    this.adapters = adapters ?? [new AmazonAdapter(), new ShopifyAdapter()];
  }

  getDefault(): StoreAdapter {
    return this.adapters.find((a) => a.platform === "shopify") ?? this.adapters[0]!;
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

    const now = Date.now();
    for (let i = 0; i < this.adapters.length; i++) {
      const adapter = this.adapters[i]!;
      // If only the default fallback adapter remains, skip redundant network detection probes
      if (i === this.adapters.length - 1 && adapter === this.getDefault()) {
        return adapter;
      }
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
        return adapter;
      }
    }

    return this.getDefault();
  }
}
