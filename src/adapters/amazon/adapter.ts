import { formatMoney } from "../shopify/normalize.js";
import type {
  CartLinkItemInput,
  CartLinkItemResult,
  CartLinkResult,
  GetProductResult,
  ProductDetail,
  ProductSummary,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreInfo
} from "../types.js";
import { keepaGetProduct, keepaSearchProducts } from "./keepa.js";
import {
  extractAsin,
  resolveAmazonMarketplace,
  resolveAssociateTag,
  tryExtractAsin,
  type AmazonMarketplace
} from "./marketplaces.js";
import { paApiGetItem, paApiSearchItems, type AmazonFetcher, type PaApiCredentials } from "./paapi.js";

export type AmazonSearchProvider = "paapi" | "keepa" | "none";

export interface AmazonAdapterOptions {
  env?: NodeJS.ProcessEnv;
  fetcher?: AmazonFetcher;
  now?: () => Date;
}

export function buildAmazonSearchGuidance(origin: string): string {
  return (
    `Amazon live search requires PA-API or Keepa credentials (not configured on this server). ` +
    `Use your built-in web search to find the matching Amazon product URLs or 10-character ASINs on ${origin}, ` +
    `then pass those ASINs directly into create_cart_link(store_url='${origin}', items=[{variant_id: '<ASIN>', quantity: 1}]) ` +
    `to generate a real multi-item Amazon Add-to-Cart link!`
  );
}

export class AmazonAdapter implements StoreAdapter {
  readonly platform = "amazon";
  private readonly envOverride?: NodeJS.ProcessEnv;
  private readonly fetcher?: AmazonFetcher;
  private readonly nowFn?: () => Date;

  constructor(options: AmazonAdapterOptions = {}) {
    this.envOverride = options.env;
    this.fetcher = options.fetcher;
    this.nowFn = options.now;
  }

  private getEnv(): NodeJS.ProcessEnv {
    return this.envOverride ?? process.env;
  }

  private resolvePaApiCredentials(marketplace: AmazonMarketplace): PaApiCredentials | null {
    const env = this.getEnv();
    const accessKey = env.AMAZON_PAAPI_ACCESS_KEY?.trim();
    const secretKey = env.AMAZON_PAAPI_SECRET_KEY?.trim();
    const partnerTag = resolveAssociateTag(marketplace, env);
    if (!accessKey || !secretKey || !partnerTag) {
      return null;
    }
    return { accessKey, secretKey, partnerTag };
  }

  private resolveKeepaApiKey(marketplace: AmazonMarketplace): string | null {
    if (marketplace.keepaDomainId === null) return null;
    const key = this.getEnv().KEEPA_API_KEY?.trim();
    return key || null;
  }

  private getActiveSearchProvider(marketplace: AmazonMarketplace): AmazonSearchProvider {
    if (this.resolvePaApiCredentials(marketplace)) return "paapi";
    if (this.resolveKeepaApiKey(marketplace)) return "keepa";
    return "none";
  }

  private requireMarketplace(origin: string): AmazonMarketplace {
    const marketplace = resolveAmazonMarketplace(origin);
    if (!marketplace) {
      throw new Error(`Unsupported Amazon marketplace origin: '${origin}'`);
    }
    return marketplace;
  }

  async detect(origin: string): Promise<StoreInfo | null> {
    const marketplace = resolveAmazonMarketplace(origin);
    if (!marketplace) {
      return null;
    }

    const searchProvider = this.getActiveSearchProvider(marketplace);
    const liveSearch = searchProvider !== "none";
    const associateTag = resolveAssociateTag(marketplace, this.getEnv());

    return {
      platform: "amazon",
      origin: marketplace.origin,
      name: marketplace.name,
      currency: marketplace.currency,
      country: marketplace.country,
      myshopifyDomain: null,
      wafRestricted: false,
      capabilities: {
        predictiveSearch: liveSearch,
        productCatalogJson: false,
        storefrontMcp: false,
        storefrontMcpTools: [],
        liveSearch,
        searchProvider,
        asinCartPermalink: true,
        affiliateTagConfigured: Boolean(associateTag)
      }
    };
  }

  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const marketplace = this.requireMarketplace(origin);
    const limit = Math.min(20, Math.max(1, Math.floor(opts.limit || 10)));
    const query = opts.query?.trim() ?? "";
    const provider = this.getActiveSearchProvider(marketplace);

    if (provider === "none") {
      const guidance = buildAmazonSearchGuidance(marketplace.origin);
      return {
        store_origin: marketplace.origin,
        currency: marketplace.currency,
        products: [],
        notices: [guidance],
        agent_guidance: guidance
      };
    }

    if (!query) {
      const guidance =
        `Provide a non-empty 'query' parameter to search ${marketplace.origin} via ${provider === "paapi" ? "Amazon PA-API 5.0" : "Keepa"}, ` +
        `or pass known 10-character ASINs directly into create_cart_link.`;
      return {
        store_origin: marketplace.origin,
        currency: marketplace.currency,
        products: [],
        notices: [guidance],
        agent_guidance: guidance
      };
    }

    let items: ProductSummary[] = [];
    const notices: string[] = [];

    if (provider === "paapi") {
      const credentials = this.resolvePaApiCredentials(marketplace)!;
      items = await paApiSearchItems({
        marketplace,
        query,
        limit,
        credentials,
        fetcher: this.fetcher,
        concurrencyKey: opts.concurrencyKey,
        now: this.nowFn?.()
      });
    } else if (provider === "keepa") {
      const apiKey = this.resolveKeepaApiKey(marketplace)!;
      items = await keepaSearchProducts({
        marketplace,
        query,
        limit,
        apiKey,
        fetcher: this.fetcher,
        concurrencyKey: opts.concurrencyKey
      });
    }

    let filtered = items;
    if (opts.availableOnly) {
      const avail = filtered.filter((p) => p.available);
      if (filtered.length > 0 && avail.length === 0) {
        notices.push("All matching products are currently unavailable (filtered out by available_only=true).");
      }
      filtered = avail;
    }
    if (typeof opts.minPrice === "number" && Number.isFinite(opts.minPrice)) {
      filtered = filtered.filter((p) => p.price.amount >= opts.minPrice!);
    }
    if (typeof opts.maxPrice === "number" && Number.isFinite(opts.maxPrice)) {
      filtered = filtered.filter((p) => p.price.amount <= opts.maxPrice!);
    }

    return {
      store_origin: marketplace.origin,
      currency: marketplace.currency,
      products: filtered.slice(0, limit),
      notices
    };
  }

  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const marketplace = this.requireMarketplace(origin);
    const asin = extractAsin(handleOrUrl);
    const provider = this.getActiveSearchProvider(marketplace);

    if (provider === "paapi") {
      const credentials = this.resolvePaApiCredentials(marketplace)!;
      const detail = await paApiGetItem({
        marketplace,
        asin,
        credentials,
        fetcher: this.fetcher,
        concurrencyKey: opts.concurrencyKey,
        now: this.nowFn?.()
      });
      if (detail) {
        return {
          store_origin: marketplace.origin,
          currency: detail.variants[0]?.price.currency ?? marketplace.currency,
          product: detail
        };
      }
    } else if (provider === "keepa") {
      const apiKey = this.resolveKeepaApiKey(marketplace)!;
      const detail = await keepaGetProduct({
        marketplace,
        asin,
        apiKey,
        fetcher: this.fetcher,
        concurrencyKey: opts.concurrencyKey
      });
      if (detail) {
        return {
          store_origin: marketplace.origin,
          currency: detail.variants[0]?.price.currency ?? marketplace.currency,
          product: detail
        };
      }
    }

    // Stage 1 canonical ASIN fallback when no live search provider is configured (or item absent)
    const canonicalProduct: ProductDetail = {
      id: asin,
      handle: asin,
      title: `Amazon Product ${asin}`,
      vendor: null,
      product_type: null,
      description_text:
        `Canonical Amazon product reference for ASIN ${asin} on ${marketplace.origin}. ` +
        `Live price and availability require PA-API or Keepa credentials. ` +
        `Pass variant_id '${asin}' into create_cart_link(store_url='${marketplace.origin}', items=[{variant_id: '${asin}', quantity: 1}]) to generate an official Amazon Add-to-Cart confirmation link.`,
      available: true,
      url: `${marketplace.origin}/dp/${asin}`,
      options: [],
      images: [],
      variants: [
        {
          id: asin,
          title: `ASIN ${asin}`,
          sku: asin,
          available: true,
          price: formatMoney(0, marketplace.currency),
          compare_at_price: null,
          option_values: []
        }
      ]
    };

    return {
      store_origin: marketplace.origin,
      currency: marketplace.currency,
      product: canonicalProduct
    };
  }

  async buildCartLink(
    origin: string,
    items: CartLinkItemInput[],
    opts: {
      mode: "cart" | "checkout";
      discountCode?: string;
      verifyHandles?: string[];
      concurrencyKey?: string;
    }
  ): Promise<CartLinkResult> {
    const marketplace = this.requireMarketplace(origin);

    if (!items.length || items.length > 20) {
      throw new Error("items must contain between 1 and 20 line items");
    }

    const normalizedItems: Array<{ asin: string; quantity: number }> = [];
    for (const item of items) {
      const asin = extractAsin(item.variantId);
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for ASIN ${asin}: must be integer 1..99`);
      }
      normalizedItems.push({ asin, quantity: item.quantity });
    }

    const warnings: string[] = [];
    if (opts.mode === "checkout") {
      warnings.push(
        "Amazon cart permalinks (/gp/aws/cart/add.html) always open Amazon's official Add-to-Cart confirmation page first rather than direct checkout."
      );
    }
    if (opts.discountCode) {
      warnings.push(
        `Amazon cart permalinks do not support URL discount codes; enter '${opts.discountCode}' during Amazon checkout.`
      );
    }

    // Optional live verification when PA-API or Keepa is configured and verifyHandles is provided
    const verifiedMap = new Map<string, ProductDetail>();
    const provider = this.getActiveSearchProvider(marketplace);
    if (provider !== "none" && opts.verifyHandles && opts.verifyHandles.length > 0) {
      const uniqueAsins = Array.from(
        new Set(
          opts.verifyHandles
            .map((h) => tryExtractAsin(h))
            .filter((a): a is string => Boolean(a))
        )
      ).slice(0, 10);

      await Promise.all(
        uniqueAsins.map(async (asin) => {
          try {
            const detail = await this.getProduct(marketplace.origin, asin, {
              concurrencyKey: opts.concurrencyKey
            });
            verifiedMap.set(asin, detail.product);
          } catch (err) {
            warnings.push(
              `Could not verify ASIN '${asin}': ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })
      );
    }

    const params = new URLSearchParams();
    normalizedItems.forEach((item, index) => {
      const slot = index + 1;
      params.set(`ASIN.${slot}`, item.asin);
      params.set(`Quantity.${slot}`, String(item.quantity));
    });

    const associateTag = resolveAssociateTag(marketplace, this.getEnv());
    if (associateTag) {
      params.set("AssociateTag", associateTag);
    }

    const cartUrl = `${marketplace.origin}/gp/aws/cart/add.html?${params.toString()}`;

    const resultItems: CartLinkItemResult[] = normalizedItems.map((item) => {
      const verified = verifiedMap.get(item.asin);
      if (verified) {
        const firstVariant = verified.variants[0];
        if (!verified.available) {
          warnings.push(`ASIN ${item.asin} (${verified.title}) is currently reported unavailable.`);
        }
        return {
          variant_id: item.asin,
          quantity: item.quantity,
          verified: true,
          available: verified.available,
          title: verified.title,
          unit_price: firstVariant?.price
        };
      }
      return {
        variant_id: item.asin,
        quantity: item.quantity
      };
    });

    return {
      store_origin: marketplace.origin,
      cart_url: cartUrl,
      mode: "cart",
      items: resultItems,
      ...(associateTag ? { affiliate_disclosure: true } : {}),
      warnings,
      next_step:
        "Present this link to the user. Opening it loads Amazon's official 'Add to Cart?' confirmation page where the user can add all items to their Amazon shopping cart with one click (no purchase is completed automatically)."
    };
  }
}
