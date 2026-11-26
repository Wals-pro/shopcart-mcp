import { UniversalJsonLdAdapter } from "./jsonld/adapter.js";
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
    // UniversalJsonLdAdapter MUST stay strictly LAST so dedicated platform adapters
    // (Shopify, WooCommerce, Amazon, etc.) always take priority.
    this.adapters = adapters ?? [new ShopifyAdapter(), new UniversalJsonLdAdapter()];
  }

  getDefault(): StoreAdapter {
    return this.adapters.find((a) => a.platform === "shopify") ?? this.adapters[0]!;
  }

  getFallback(): StoreAdapter {
    return this.adapters[this.adapters.length - 1]!;
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
      // If only the universal JSON-LD fallback remains, skip an extra homepage probe
      // so direct get_product(url) calls work in a single request.
      if (i === this.adapters.length - 1 && adapter.platform === "jsonld") {
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

    return this.getFallback();
  }
}
