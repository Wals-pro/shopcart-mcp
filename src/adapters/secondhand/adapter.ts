import { enforceShellSafeHttpsUrl } from "../../security/identifiers.js";
import { sanitizeText } from "../../security/sanitize.js";
import { validateExternalUrl } from "../../security/ssrf.js";
import { UniversalJsonLdAdapter } from "../jsonld/adapter.js";
import { sanitizeCatalogOptionalText } from "../jsonld/parser.js";
import { formatMoney } from "../shopify/normalize.js";
import type {
  CartLinkItemInput,
  CartLinkResult,
  GetProductResult,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreInfo
} from "../types.js";
import {
  finalizeMarketplaceUrl,
  mapProductConditionToFilter,
  normalizeSecondhandSearchParams,
  resolveSecondhandMarketplace,
  toWellFormedUtf16,
  type SecondhandMarketplaceDef,
  type SecondhandSortBy
} from "./platforms.js";

export interface SecondhandMarketplaceAdapterOptions {
  env?: NodeJS.ProcessEnv;
  jsonLdAdapter?: UniversalJsonLdAdapter;
}

function mapStoreSortToSecondhand(sortBy?: SearchProductsOptions["sortBy"]): SecondhandSortBy {
  if (sortBy === "price_asc" || sortBy === "price_desc") return sortBy;
  return "relevance";
}

/**
 * Strictly pins listing URLs to the marketplace's explicit `hosts` allowlist
 * (rejects off-host URLs AND arbitrary untrusted subdomains).
 */
function resolvePinnedMarketplaceItemUrl(
  marketplace: SecondhandMarketplaceDef,
  candidate: string
): string | null {
  const trimmed = candidate.trim();
  if (!trimmed || /[\x00-\x1f\s]/.test(trimmed)) return null;

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    const parsed = validateExternalUrl(trimmed);
    const normalizedHost = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const allowedHosts = marketplace.hosts.map((h) => h.toLowerCase().replace(/\.$/, ""));
    if (!allowedHosts.includes(normalizedHost)) {
      throw new Error(
        `Listing URL host '${parsed.hostname}' is not in the allowed hosts for marketplace '${marketplace.canonicalHost}'. Pass the matching store_url for this listing.`
      );
    }
    return enforceShellSafeHttpsUrl(parsed.toString());
  }

  if (trimmed.startsWith("/")) {
    if (trimmed.includes("..") || trimmed.includes("\\")) {
      throw new Error("Invalid listing path: path traversal or backslash is not allowed");
    }
    const parsed = validateExternalUrl(`${marketplace.origin}${trimmed}`);
    return enforceShellSafeHttpsUrl(parsed.toString());
  }

  return null;
}

export class SecondhandMarketplaceAdapter implements StoreAdapter {
  readonly platform = "secondhand";
  private readonly jsonLdAdapter: UniversalJsonLdAdapter;

  constructor(opts: SecondhandMarketplaceAdapterOptions = {}) {
    this.jsonLdAdapter = opts.jsonLdAdapter ?? new UniversalJsonLdAdapter();
  }

  private requireMarketplace(origin: string): SecondhandMarketplaceDef {
    const mp = resolveSecondhandMarketplace(origin);
    if (!mp) {
      throw new Error(`Unsupported secondhand marketplace origin: '${origin}'`);
    }
    return mp;
  }

  /**
   * 0 ms synchronous hostname detection (zero HTTP probes against WAF-protected marketplaces).
   */
  async detect(origin: string): Promise<StoreInfo | null> {
    const mp = resolveSecondhandMarketplace(origin);
    if (!mp) return null;

    return {
      platform: "secondhand",
      origin: mp.origin,
      name: mp.name,
      currency: mp.currency,
      country: mp.country,
      myshopifyDomain: null,
      wafRestricted: !mp.supportsSingleItemLookup,
      capabilities: {
        predictiveSearch: false,
        productCatalogJson: false,
        storefrontMcp: false,
        storefrontMcpTools: [],
        liveSearch: false,
        jsonLdProduct: mp.supportsSingleItemLookup,
        handoffTier: "search_handoff",
        singleItemLookup: mp.supportsSingleItemLookup,
        liveApiConfigured: false,
        marketplaceId: mp.id
      }
    };
  }

  /**
   * 0 ms / 0 HTTP calls: builds a verified deterministic search deep-link (`handoff_tier: "search_handoff"`).
   */
  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const mp = this.requireMarketplace(origin);
    const rawQuery = opts.query?.trim() ?? "";

    let searchUrl: string | null = null;
    const notices: string[] = [
      `${mp.name} (${mp.origin}) is a secondhand/refurbished marketplace handled via deterministic search handoff (0 scraping, 0 bot bypass).`
    ];

    if (rawQuery) {
      const normalized = normalizeSecondhandSearchParams({
        query: rawQuery,
        condition: mapProductConditionToFilter(opts.condition),
        minPrice: opts.minPrice,
        maxPrice: opts.maxPrice,
        sortBy: mapStoreSortToSecondhand(opts.sortBy)
      });
      const built = mp.buildSearchUrl(normalized);
      searchUrl = built.url;
      if (built.note) notices.push(built.note);
    } else {
      searchUrl = finalizeMarketplaceUrl(`${mp.origin}/`, mp.origin);
      notices.push(
        "Pass a non-empty 'query' (or use search_secondhand_marketplaces to search multiple marketplaces in 1 call) to generate pre-filtered search links."
      );
    }

    const singleItemHint = mp.supportsSingleItemLookup
      ? ` If the user shares a specific ${mp.name} listing URL, call get_product(store_url="${mp.origin}", handle_or_url="<listing URL>") to verify live price, title, image, and Schema.org itemCondition.`
      : ` ${mp.name} is WAF-protected — do not attempt scraping; share the search link directly so the user can inspect listings in their browser.`;

    const agentGuidance =
      `Present the verified search link from search_hints.search_url to the user (handoff_tier="search_handoff"). ` +
      `For multi-marketplace secondhand/refurbished discovery in a single tool call, use search_secondhand_marketplaces.${singleItemHint}`;

    return {
      store_origin: mp.origin,
      currency: mp.currency,
      handoff_tier: "search_handoff",
      products: [],
      notices,
      agent_guidance: agentGuidance,
      search_hints: {
        search_url: searchUrl
      }
    };
  }

  /**
   * For JSON-LD-capable single-item marketplaces (`willhaben.at`, `ricardo.ch`, `refurbed.de/.at`,
   * `rebuy.de`, `medimops.de`), strictly pins the URL host against `marketplace.hosts` and
   * delegates cleanly to `UniversalJsonLdAdapter.getProduct()` to read live title, price, image,
   * and Schema.org `itemCondition`.
   *
   * For WAF-protected marketplaces, performs ZERO HTTP requests and returns an honest
   * `search_handoff` link/guidance response without echoing raw caller URLs in prose fields.
   */
  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const mp = this.requireMarketplace(origin);
    const trimmed = handleOrUrl.trim();
    if (!trimmed) {
      throw new Error("handle_or_url is required");
    }

    // Always enforce strict marketplace.hosts pinning for any URL or relative path
    const pinnedUrl = resolvePinnedMarketplaceItemUrl(mp, trimmed);

    if (mp.supportsSingleItemLookup) {
      const target = pinnedUrl ?? trimmed;
      const result = await this.jsonLdAdapter.getProduct(mp.origin, target, {
        currencyHint: opts.currencyHint ?? mp.currency,
        concurrencyKey: opts.concurrencyKey
      });
      return {
        ...result,
        handoff_tier: "direct_product_link"
      };
    }

    // Strictly zero scraping on WAF-protected marketplaces (ebay, etsy, backmarket, tutti, vinted, kleinanzeigen, depop, poshmark, etc.)
    const sanitizedQuery = sanitizeText(toWellFormedUtf16(trimmed), 200) || "angebote";
    const fallbackSearchUrl =
      pinnedUrl ?? mp.buildSearchUrl(normalizeSecondhandSearchParams({ query: sanitizedQuery })).url;

    const safeSearchLabel = sanitizeCatalogOptionalText(toWellFormedUtf16(trimmed), 80);
    const title = pinnedUrl
      ? `${mp.name} Listing`
      : safeSearchLabel
        ? `${mp.name} Search: ${safeSearchLabel}`
        : `${mp.name} Search`;

    const guidance =
      `${mp.name} (${mp.origin}) is WAF-protected and does not expose public unauthenticated JSON-LD product extraction. ` +
      `ShopCart never scrapes or bypasses bot protection — open product.url directly in your browser to inspect live price, condition, and availability.`;

    return {
      store_origin: mp.origin,
      currency: mp.currency,
      handoff_tier: "search_handoff",
      notices: [guidance],
      agent_guidance: guidance,
      product: {
        id: `${mp.id}-handoff`,
        handle: mp.id,
        title,
        vendor: mp.name,
        product_type: "Second-Hand Marketplace Listing",
        description_text: guidance,
        available: false,
        availability: "Unknown",
        condition: "unknown",
        condition_raw: null,
        url: fallbackSearchUrl,
        options: [],
        images: [],
        variants: [
          {
            id: `${mp.id}-handoff`,
            title: "Direct Marketplace Link",
            sku: null,
            available: false,
            availability: "Unknown",
            condition: "unknown",
            condition_raw: null,
            price: formatMoney(0, mp.currency),
            compare_at_price: null,
            option_values: [],
            url: fallbackSearchUrl
          }
        ]
      }
    };
  }

  /**
   * 0 ms / 0 HTTP calls: returns an honest `search_handoff` cart link response.
   */
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
    const mp = this.requireMarketplace(origin);

    if (!items.length || items.length > 20) {
      throw new Error("items must contain between 1 and 20 line items");
    }
    for (const item of items) {
      if (!item.variantId || !item.variantId.trim() || item.variantId.length > 1000) {
        throw new Error(`Invalid variant_id: ${item.variantId}`);
      }
      if (/[\x00-\x1f\s]/.test(item.variantId.trim())) {
        throw new Error("variant_id must not contain whitespace or control characters");
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for variant ${item.variantId}: must be integer 1..99`);
      }
    }
    if (opts.discountCode && !/^[A-Za-z0-9._-]{1,64}$/.test(opts.discountCode)) {
      throw new Error("Invalid discount_code format");
    }

    const warnings: string[] = [
      `${mp.name} does not support pre-filled browser cart permalinks; returning a direct marketplace handoff link (handoff_tier: "search_handoff").`
    ];
    if (opts.discountCode) {
      warnings.push(
        `Discount code '${opts.discountCode}' cannot be pre-applied via URL on ${mp.name}; enter it manually on the marketplace if supported.`
      );
    }

    // Prefer an explicit validated listing URL on the exact allowed marketplace hosts
    let targetUrl: string | null = null;
    for (const candidate of [...(opts.verifyHandles ?? []), ...items.map((i) => i.variantId)]) {
      const resolved = resolvePinnedMarketplaceItemUrl(mp, candidate);
      if (resolved) {
        targetUrl = resolved;
        break;
      }
    }

    if (!targetUrl) {
      const firstId = sanitizeText(toWellFormedUtf16(items[0]!.variantId), 200);
      targetUrl = firstId
        ? mp.buildSearchUrl(normalizeSecondhandSearchParams({ query: firstId })).url
        : finalizeMarketplaceUrl(`${mp.origin}/`, mp.origin);
    }

    return {
      store_origin: mp.origin,
      cart_url: targetUrl,
      mode: "cart",
      cart_mode: "search_handoff",
      handoff_tier: "search_handoff",
      items: items.map((item) => ({
        variant_id: item.variantId.trim(),
        quantity: item.quantity,
        verified: false
      })),
      warnings,
      next_step: `Open this ${mp.name} link in your browser to inspect item condition, seller rating, and complete the purchase directly on ${mp.origin}.`
    };
  }
}
