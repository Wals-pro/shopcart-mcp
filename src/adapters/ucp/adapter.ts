import { safeFetch, SsrfError, validateExternalUrl } from "../../security/ssrf.js";
import { UniversalJsonLdAdapter } from "../jsonld/adapter.js";

const HARD_SSRF_CODES = new Set([
  "INVALID_URL",
  "BLOCKED_HOST",
  "BLOCKED_IP",
  "CONCURRENCY_LIMIT"
]);

function rethrowIfHardSsrfError(err: unknown): void {
  if (err instanceof SsrfError && HARD_SSRF_CODES.has(err.code)) {
    throw err;
  }
}
import { inferCurrencyFromUrl } from "../jsonld/parser.js";
import type {
  CartLinkItemInput,
  CartLinkItemResult,
  CartLinkResult,
  GetProductResult,
  Money,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreInfo
} from "../types.js";
import { UcpApiClient } from "./client.js";
import {
  buildUnsupportedUcpMetadata,
  UcpDiscoveryClient,
  type UcpFetcherFn
} from "./discovery.js";
import type { NormalizedUcpProfile } from "./schema.js";

export interface UniversalUcpAdapterOptions {
  fetcher?: UcpFetcherFn;
  discoveryTimeoutMs?: number;
  apiTimeoutMs?: number;
  maxManifestBytes?: number;
  maxApiBytes?: number;
  jsonLdFallback?: UniversalJsonLdAdapter;
}

export class UniversalUcpAdapter implements StoreAdapter {
  readonly platform = "ucp";
  private readonly discovery: UcpDiscoveryClient;
  private readonly client: UcpApiClient;
  private readonly jsonLdFallback: UniversalJsonLdAdapter;

  constructor(opts: UniversalUcpAdapterOptions = {}) {
    const fetcher = opts.fetcher ?? safeFetch;
    this.discovery = new UcpDiscoveryClient({
      fetcher,
      timeoutMs: opts.discoveryTimeoutMs ?? 3000,
      maxBytes: opts.maxManifestBytes
    });
    this.client = new UcpApiClient({
      fetcher,
      timeoutMs: opts.apiTimeoutMs ?? 6000,
      maxBytes: opts.maxApiBytes
    });
    this.jsonLdFallback = opts.jsonLdFallback ?? new UniversalJsonLdAdapter({ fetcher });
  }

  clearCache(): void {
    this.discovery.clearCache();
    this.jsonLdFallback.clearCache();
  }

  async discoverProfile(
    origin: string,
    opts: { forceRefresh?: boolean; concurrencyKey?: string } = {}
  ): Promise<NormalizedUcpProfile | null> {
    return this.discovery.discover(origin, opts);
  }

  /**
   * Enrich a `StoreInfo` produced by any native adapter (Shopify, WooCommerce, BigCommerce,
   * Shopware, Magento) or fallback adapter with structured `/.well-known/ucp` diagnostics.
   */
  async enrichStoreInfo(store: StoreInfo, concurrencyKey?: string): Promise<StoreInfo> {
    if (store.platform === "amazon" || store.platform === "ucp") {
      return store;
    }

    // Validate the already-resolved store origin before optional UCP probing
    validateExternalUrl(store.origin);

    let profile: NormalizedUcpProfile | null;
    try {
      profile = await this.discovery.discover(store.origin, {
        forceRefresh: false,
        concurrencyKey
      });
    } catch (err) {
      if (err instanceof SsrfError && err.code === "CONCURRENCY_LIMIT") {
        throw err;
      }
      // Degrade optional /.well-known/ucp enrichment cleanly without breaking inspect_store
      profile = null;
    }

    if (!profile) {
      return {
        ...store,
        ucp: store.ucp ?? buildUnsupportedUcpMetadata(store.origin)
      };
    }

    return {
      ...store,
      capabilities: {
        ...store.capabilities,
        ucp: true,
        ucpVersion: profile.version,
        ucpCapabilities: profile.capabilities,
        ucpCheckoutHandoff: profile.checkoutHandoffSupported,
        ucpCatalogSearch: profile.catalogSearchSupported,
        storefrontUcp: store.capabilities.storefrontUcp || true,
        storefrontUcpEndpoint:
          store.capabilities.storefrontUcpEndpoint ??
          profile.endpoints.mcp ??
          profile.endpoints.rest ??
          null
      },
      ucp: profile.metadata
    };
  }

  async detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null> {
    const profile = await this.discovery.discover(origin, {
      forceRefresh: true,
      concurrencyKey
    });
    if (!profile) {
      return null;
    }

    // Grab lightweight storefront metadata (name/currency/country) only if missing from manifest
    let fallbackStore: StoreInfo | null = null;
    if (!profile.storeName || !profile.currency) {
      try {
        fallbackStore = await this.jsonLdFallback.detect(profile.origin, concurrencyKey);
      } catch (err) {
        rethrowIfHardSsrfError(err);
        fallbackStore = null;
      }
    }

    const currency =
      profile.currency ?? fallbackStore?.currency ?? inferCurrencyFromUrl(profile.origin);
    const name = profile.storeName ?? fallbackStore?.name ?? null;
    const country = profile.country ?? fallbackStore?.country ?? null;

    return {
      platform: "ucp",
      origin: profile.origin,
      name,
      currency,
      country,
      myshopifyDomain: null,
      wafRestricted: fallbackStore?.wafRestricted ?? false,
      capabilities: {
        predictiveSearch: profile.catalogSearchSupported,
        productCatalogJson: false,
        storefrontMcp: Boolean(profile.endpoints.mcp),
        storefrontMcpTools: [],
        storefrontUcp: true,
        storefrontUcpEndpoint: profile.endpoints.mcp ?? profile.endpoints.rest ?? null,
        ucp: true,
        ucpVersion: profile.version,
        ucpCapabilities: profile.capabilities,
        ucpCheckoutHandoff: profile.checkoutHandoffSupported,
        ucpCatalogSearch: profile.catalogSearchSupported,
        jsonLdProduct: true,
        searchActionUrl: fallbackStore?.capabilities.searchActionUrl ?? null,
        sitemaps: fallbackStore?.capabilities.sitemaps ?? []
      },
      ucp: profile.metadata
    };
  }

  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const validatedOrigin = validateExternalUrl(origin).origin;
    const profile = await this.discovery.discover(validatedOrigin, {
      concurrencyKey: opts.concurrencyKey
    });

    if (profile && profile.catalogSearchSupported) {
      const catalogRes = await this.client.searchCatalog(profile, opts);
      if (catalogRes.supported) {
        const notices = [...catalogRes.notices, ...profile.warnings];
        if (profile.checkoutHandoffSupported) {
          notices.push(
            "Zero-liability UCP checkout handoff is available via create_cart_link (merchant remains Merchant of Record)."
          );
        }
        return {
          store_origin: profile.origin,
          currency: catalogRes.currency,
          sort_by: opts.sortBy,
          products: catalogRes.products,
          notices
        };
      }
    }

    // Graceful fallback to Universal JSON-LD search hints when UCP only advertises checkout
    const fallback = await this.jsonLdFallback.searchProducts(validatedOrigin, opts);
    const ucpNotices: string[] = [];
    if (profile) {
      ucpNotices.push(
        `Discovered UCP v${profile.version} manifest (/.well-known/ucp), but this store does not expose a public UCP catalog search endpoint; falling back to Universal JSON-LD product URL inspection.`
      );
      if (profile.checkoutHandoffSupported) {
        ucpNotices.push(
          "Once you verify product/variant IDs via get_product, create_cart_link can initiate a zero-liability UCP checkout handoff directly to the merchant."
        );
      }
      ucpNotices.push(...profile.warnings);
    }

    return {
      ...fallback,
      notices: [...ucpNotices, ...fallback.notices]
    };
  }

  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const validatedOrigin = validateExternalUrl(origin).origin;
    const trimmed = handleOrUrl.trim();
    const isFullOrRelativeUrl =
      /^https?:\/\//i.test(trimmed) || trimmed.startsWith("/");

    const profile = await this.discovery.discover(validatedOrigin, {
      concurrencyKey: opts.concurrencyKey
    });

    if (profile && !isFullOrRelativeUrl && profile.catalogSearchSupported) {
      const ucpProduct = await this.client.getProductById(profile, trimmed, opts);
      if (ucpProduct) {
        return ucpProduct;
      }
    }

    return this.jsonLdFallback.getProduct(validatedOrigin, handleOrUrl, opts);
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
    const validatedOrigin = validateExternalUrl(origin).origin;

    if (!items.length || items.length > 20) {
      throw new Error("items must contain between 1 and 20 line items");
    }
    for (const item of items) {
      if (!item.variantId || !item.variantId.trim() || item.variantId.length > 1000) {
        throw new Error(`Invalid variant_id: ${item.variantId}`);
      }
      if (/[\x00-\x1f\s]/.test(item.variantId)) {
        throw new Error("variant_id must not contain whitespace or control characters");
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for variant ${item.variantId}: must be integer 1..99`);
      }
    }
    if (opts.discountCode && !/^[A-Za-z0-9._-]{1,64}$/.test(opts.discountCode)) {
      throw new Error("Invalid discount_code format");
    }

    const profile = await this.discovery.discover(validatedOrigin, {
      concurrencyKey: opts.concurrencyKey
    });

    // Optional live verification of product handles / URLs before checkout handoff
    const warnings: string[] = [...(profile?.warnings ?? [])];
    const verifiedLookup = new Map<
      string,
      { available: boolean; title: string; unitPrice: Money }
    >();
    let detectedCurrency: string | undefined = profile?.currency ?? undefined;

    for (const handle of (opts.verifyHandles ?? []).slice(0, 10)) {
      const clean = handle.trim();
      if (!clean) continue;
      try {
        const detail = await this.getProduct(validatedOrigin, clean, {
          concurrencyKey: opts.concurrencyKey
        });
        detectedCurrency = detectedCurrency ?? detail.currency;
        for (const v of detail.product.variants) {
          const displayTitle =
            v.title && v.title !== "Default"
              ? `${detail.product.title} — ${v.title}`
              : detail.product.title;
          const entry = {
            available: v.available,
            title: displayTitle,
            unitPrice: v.price
          };
          for (const key of [
            v.id,
            v.sku,
            v.gtin,
            v.ean,
            v.url,
            detail.product.url,
            detail.product.handle
          ]) {
            if (key && !verifiedLookup.has(key)) {
              verifiedLookup.set(key, entry);
            }
          }
        }
      } catch (err) {
        rethrowIfHardSsrfError(err);
        warnings.push(`Could not live-verify handle '${clean}' prior to checkout handoff.`);
      }
    }

    // Attempt Zero-Liability UCP Checkout Handoff when supported
    if (profile && profile.checkoutHandoffSupported) {
      const handoff = await this.client.createCheckoutHandoff(profile, {
        items,
        currency: detectedCurrency,
        discountCode: opts.discountCode,
        concurrencyKey: opts.concurrencyKey
      });

      if (handoff.ok) {
        warnings.push(...handoff.warnings);
        const resultItems: CartLinkItemResult[] = items.map((item) => {
          const matched = verifiedLookup.get(item.variantId.trim());
          if (!matched) {
            return {
              variant_id: item.variantId,
              quantity: item.quantity,
              verified: false
            };
          }
          if (!matched.available) {
            warnings.push(
              `Item '${matched.title}' (${item.variantId}) is currently reported out of stock.`
            );
          }
          return {
            variant_id: item.variantId,
            quantity: item.quantity,
            verified: true,
            available: matched.available,
            title: matched.title,
            unit_price: matched.unitPrice
          };
        });

        return {
          store_origin: profile.origin,
          cart_url: handoff.continueUrl,
          mode: opts.mode,
          cart_mode: "ucp_checkout_handoff",
          items: resultItems,
          ...(opts.discountCode ? { applied_discount_code: opts.discountCode } : {}),
          ucp_checkout: {
            ...(handoff.sessionId ? { session_id: handoff.sessionId } : {}),
            status: handoff.status,
            continue_url: handoff.continueUrl,
            merchant_of_record: "merchant",
            liability_model: "zero_liability_handoff"
          },
          warnings,
          next_step:
            "Open the merchant checkout handoff URL in your browser to review items, enter shipping/payment details, and complete your purchase directly with the merchant. ShopCart never collects payment details or acts as Merchant of Record."
        };
      }

      warnings.push(handoff.reason);
      // If a malicious continue_url was explicitly rejected AND no JSON-LD product URLs are provided to fall back cleanly, throw
      const hasFallbackProductHint =
        (opts.verifyHandles ?? []).some((h) => /^https?:\/\//i.test(h.trim()) || h.trim().startsWith("/")) ||
        items.some((i) => /^https?:\/\//i.test(i.variantId.trim()) || i.variantId.trim().startsWith("/"));
      if (handoff.rejectedUnsafeContinueUrl && !hasFallbackProductHint) {
        throw new Error(handoff.reason);
      }
    }

    // Fallback to verified direct_product_link via UniversalJsonLdAdapter
    const fallbackResult = await this.jsonLdFallback.buildCartLink(validatedOrigin, items, opts);
    return {
      ...fallbackResult,
      warnings: [...warnings, ...fallbackResult.warnings]
    };
  }
}
