import { isSameStoreSite } from "../security/sanitize.js";
import { AmazonAdapter } from "./amazon/adapter.js";
import { ShopifyAdapter } from "./shopify/adapter.js";
import { WooCommerceAdapter } from "./woocommerce/adapter.js";
import type { StoreAdapter, StoreInfo } from "./types.js";

interface CachedResolution {
  adapter: StoreAdapter;
  store: StoreInfo;
  expiresAt: number;
}

const REGISTRY_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

export class AdapterRegistry {
  private readonly adapters: StoreAdapter[];
  private readonly cache = new Map<string, CachedResolution>();

  constructor(adapters?: StoreAdapter[]) {
    // AmazonAdapter is registered first because its domain detection is purely synchronous (0 ms, no network probe),
    // followed by ShopifyAdapter and WooCommerceAdapter.
    this.adapters = adapters ?? [
      new AmazonAdapter(),
      new ShopifyAdapter(),
      new WooCommerceAdapter()
    ];
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

  private setCacheEntry(key: string, entry: CachedResolution, now: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(key)) {
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= now) {
          this.cache.delete(k);
        }
      }
      while (this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, entry);
  }

  private cacheResolution(origin: string, adapter: StoreAdapter, store: StoreInfo, now: number): void {
    const entry: CachedResolution = {
      adapter,
      store,
      expiresAt: now + REGISTRY_CACHE_TTL_MS
    };
    this.setCacheEntry(origin, entry, now);
    // Only alias the canonical origin cache key if it belongs to the same storefront site (apex <-> www)
    // to prevent cross-origin cache poisoning across unrelated domains.
    if (store.origin !== origin && isSameStoreSite(origin, store.origin)) {
      this.setCacheEntry(store.origin, entry, now);
    }
  }

  async resolve(
    origin: string,
    concurrencyKey?: string
  ): Promise<{ adapter: StoreAdapter; store: StoreInfo | null }> {
    const now = Date.now();
    for (const adapter of this.adapters) {
      const store = await adapter.detect(origin, concurrencyKey);
      if (store) {
        this.cacheResolution(origin, adapter, store, now);
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
        this.cacheResolution(origin, adapter, store, now);
        return adapter;
      }
    }

    return this.getDefault();
  }
}
