import { isSameStoreSite } from "../security/sanitize.js";
import { AmazonAdapter } from "./amazon/adapter.js";
import { BigCommerceAdapter } from "./bigcommerce/adapter.js";
import { UniversalJsonLdAdapter } from "./jsonld/adapter.js";
import { MagentoAdapter } from "./magento/adapter.js";
import { ShopifyAdapter } from "./shopify/adapter.js";
import { ShopwareAdapter } from "./shopware/adapter.js";
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
    // Deterministic priority order:
    // 1. Amazon (0 ms synchronous hostname match)
    // 2. Shopify (incl. Smart-Shopper & UCP /api/ucp/mcp)
    // 3. WooCommerce (Store API v1)
    // 4. BigCommerce (Stencil / BCData / /cart.php)
    // 5. Shopware 6 (Store API / storefront markers)
    // 6. Magento 2 / Adobe Commerce (read-only GraphQL)
    // 7. Universal JSON-LD / Schema.org (STRICTLY LAST FALLBACK)
    this.adapters = adapters ?? [
      new AmazonAdapter(),
      new ShopifyAdapter(),
      new WooCommerceAdapter(),
      new BigCommerceAdapter(),
      new ShopwareAdapter(),
      new MagentoAdapter(),
      new UniversalJsonLdAdapter()
    ];
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
    concurrencyKey?: string,
    signal?: AbortSignal
  ): Promise<{ adapter: StoreAdapter; store: StoreInfo | null }> {
    const now = Date.now();
    for (const adapter of this.adapters) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Store resolution aborted");
      }
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
      // If only the universal JSON-LD fallback (or single default adapter) remains, skip redundant homepage probe
      // so direct get_product(url) calls work in a single request.
      if (i === this.adapters.length - 1 && (adapter.platform === "jsonld" || adapter === this.getDefault())) {
        return adapter;
      }
      const store = await adapter.detect(origin, concurrencyKey);
      if (store) {
        this.cacheResolution(origin, adapter, store, now);
        return adapter;
      }
    }

    return this.getFallback();
  }
}

/**
 * Isolated AdapterRegistry for the anonymous public Storefront Self-Check (/api/store-check).
 * Uses dedicated adapter & client cache instances separate from authenticated /mcp traffic,
 * and instantiates AmazonAdapter with empty env ({}) so operator PA-API/Keepa quotas can never
 * be spent by anonymous callers.
 */
export function createIsolatedStoreCheckRegistry(): AdapterRegistry {
  return new AdapterRegistry([
    new AmazonAdapter({ env: {} }),
    new ShopifyAdapter(),
    new WooCommerceAdapter(),
    new BigCommerceAdapter(),
    new ShopwareAdapter(),
    new MagentoAdapter(),
    new UniversalJsonLdAdapter()
  ]);
}
