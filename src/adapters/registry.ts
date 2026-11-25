import { ShopifyAdapter } from "./shopify/adapter.js";
import type { StoreAdapter } from "./types.js";

export class AdapterRegistry {
  private readonly adapters: StoreAdapter[];

  constructor(adapters?: StoreAdapter[]) {
    this.adapters = adapters ?? [new ShopifyAdapter()];
  }

  getDefault(): StoreAdapter {
    return this.adapters[0]!;
  }

  listPlatforms(): string[] {
    return this.adapters.map((a) => a.platform);
  }

  async resolve(origin: string, concurrencyKey?: string): Promise<{ adapter: StoreAdapter; store: Awaited<ReturnType<StoreAdapter["detect"]>> }> {
    for (const adapter of this.adapters) {
      const store = await adapter.detect(origin, concurrencyKey);
      if (store) {
        return { adapter, store };
      }
    }
    return { adapter: this.getDefault(), store: null };
  }
}
