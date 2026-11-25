import { isSameStoreSite, sanitizeSafeUrl } from "../../security/sanitize.js";
import {
  safeFetch,
  SsrfError,
  validateExternalUrl,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import type {
  AdditionalCartLink,
  CartLinkItemInput,
  CartLinkItemResult,
  CartLinkResult,
  GetProductResult,
  ProductDetail,
  ProductSummary,
  ProductVariant,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreInfo
} from "../types.js";
import {
  extractWooProductIdentifier,
  extractWooProductPrices,
  isValidWooCart,
  isValidWooStoreProduct,
  isWooProductAvailable,
  normalizeCountryCode,
  normalizeWooCurrency,
  sanitizeWooDescription,
  sanitizeWooOptionalText,
  sanitizeWooText,
  simplifyWooSearchQueryForRetry,
  type WooAttributeRaw,
  type WooCartRaw,
  type WooProductRaw,
  type WooVariationStubRaw
} from "./normalize.js";

export type WooFetcherFn = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResponse>;

interface WooDomainMetadata {
  origin: string;
  name: string | null;
  currency: string;
  minorUnit: number;
  country: string | null;
  wafRestricted: boolean;
  productsAvailable: boolean;
  detectedWoo: boolean;
  expiresAt: number;
}

const DEFAULT_UA = "Mozilla/5.0 (compatible; shopcart-mcp/0.1; +https://shopcart.wals.pro)";
const META_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
const MAX_VARIATIONS_TO_FETCH = 15;
const VARIATION_FALLBACK_BATCH_SIZE = 4;
const HARD_SSRF_CODES = new Set(["INVALID_URL", "BLOCKED_HOST", "BLOCKED_IP", "CONCURRENCY_LIMIT"]);

function rethrowIfHardSsrfError(err: unknown): void {
  if (err instanceof SsrfError && HARD_SSRF_CODES.has(err.code)) {
    throw err;
  }
}

function extractCanonicalOriginFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const parsed = validateExternalUrl(rawUrl);
    return `https://${parsed.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

function buildAttributeLookup(
  attributes: WooAttributeRaw[] | undefined
): Map<string, Map<string, string>> {
  const byAttr = new Map<string, Map<string, string>>();
  for (const attr of attributes ?? []) {
    const attrName = sanitizeWooText(attr.name, 80).toLowerCase();
    const attrTaxonomy = sanitizeWooText(attr.taxonomy, 80).toLowerCase();
    const termMap = new Map<string, string>();
    for (const term of attr.terms ?? []) {
      const displayName = sanitizeWooText(term.name, 80);
      const slug = sanitizeWooText(term.slug, 80).toLowerCase();
      if (displayName) {
        if (slug) termMap.set(slug, displayName);
        termMap.set(displayName.toLowerCase(), displayName);
      }
    }
    if (attrName) byAttr.set(attrName, termMap);
    if (attrTaxonomy) byAttr.set(attrTaxonomy, termMap);
  }
  return byAttr;
}

function parseVariationStringOptions(variationText: string | null | undefined): string[] {
  const cleaned = sanitizeWooText(variationText, 200);
  if (!cleaned) return [];
  return cleaned
    .split(",")
    .map((part) => {
      const idx = part.indexOf(":");
      return (idx >= 0 ? part.slice(idx + 1) : part).trim();
    })
    .filter(Boolean);
}

function resolveVariationOptionValues(
  stub: WooVariationStubRaw,
  detail: WooProductRaw | undefined,
  attrLookup: Map<string, Map<string, string>>
): string[] {
  const resolved: string[] = [];
  for (const attr of stub.attributes ?? []) {
    const rawVal = sanitizeWooText(attr.value, 100);
    if (!rawVal) continue;
    const attrKey = sanitizeWooText(attr.name, 80).toLowerCase();
    const termMap = attrLookup.get(attrKey);
    const display = termMap?.get(rawVal.toLowerCase()) ?? rawVal;
    resolved.push(display);
  }
  if (resolved.length > 0) return resolved;
  return parseVariationStringOptions(detail?.variation);
}

function buildWooCartUrl(
  origin: string,
  mode: "cart" | "checkout",
  item: CartLinkItemInput
): string {
  const path = mode === "checkout" ? "/checkout/" : "/cart/";
  return `${origin}${path}?add-to-cart=${encodeURIComponent(item.variantId)}&quantity=${item.quantity}`;
}

export class WooCommerceAdapter implements StoreAdapter {
  readonly platform = "woocommerce";
  private readonly fetcher: WooFetcherFn;
  private readonly cache = new Map<string, WooDomainMetadata>();

  constructor(fetcher: WooFetcherFn = safeFetch) {
    this.fetcher = fetcher;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private getCanonicalOrigin(origin: string): string {
    const cached = this.cache.get(origin);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.origin;
    }
    return origin;
  }

  private async getJson<T>(
    url: string,
    opts: { timeoutMs?: number; concurrencyKey?: string } = {}
  ): Promise<{ status: number; data: T | null; url: string }> {
    const res = await this.fetcher(url, {
      method: "GET",
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "application/json"
      },
      timeoutMs: opts.timeoutMs ?? 6000,
      maxRedirects: 3,
      maxBytes: 1_048_576,
      concurrencyKey: opts.concurrencyKey
    });

    const finalUrl = res.url || url;

    if (res.status < 200 || res.status >= 300) {
      return { status: res.status, data: null, url: finalUrl };
    }

    const trimmed = res.bodyText.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return { status: res.status, data: null, url: finalUrl };
    }

    try {
      return {
        status: res.status,
        data: JSON.parse(trimmed) as T,
        url: finalUrl
      };
    } catch {
      return { status: res.status, data: null, url: finalUrl };
    }
  }

  private async fetchStoreName(
    origin: string,
    concurrencyKey?: string
  ): Promise<string | null> {
    try {
      const res = await this.getJson<{ name?: string }>(
        `${origin}/wp-json/?_fields=name`,
        { timeoutMs: 3000, concurrencyKey }
      );
      if (res.status === 200 && res.data && typeof res.data.name === "string") {
        return sanitizeWooOptionalText(res.data.name, 120);
      }
      return null;
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return null;
    }
  }

  private async resolveDomainMetadata(
    origin: string,
    opts: { forceRefresh?: boolean; concurrencyKey?: string } = {}
  ): Promise<WooDomainMetadata> {
    const now = Date.now();
    const cached = this.cache.get(origin);
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      return cached;
    }

    const [productsProbe, cartProbe] = await Promise.all([
      this.getJson<unknown>(`${origin}/wp-json/wc/store/v1/products?per_page=1`, {
        concurrencyKey: opts.concurrencyKey
      }).catch((err) => {
        rethrowIfHardSsrfError(err);
        return { status: 0, data: null, url: origin };
      }),
      this.getJson<unknown>(`${origin}/wp-json/wc/store/v1/cart`, {
        concurrencyKey: opts.concurrencyKey
      }).catch((err) => {
        rethrowIfHardSsrfError(err);
        return { status: 0, data: null, url: origin };
      })
    ]);

    const firstProduct =
      productsProbe.status === 200 &&
      Array.isArray(productsProbe.data) &&
      productsProbe.data.length > 0 &&
      isValidWooStoreProduct(productsProbe.data[0])
        ? (productsProbe.data[0] as WooProductRaw)
        : null;

    const validCart =
      cartProbe.status === 200 && isValidWooCart(cartProbe.data)
        ? (cartProbe.data as WooCartRaw)
        : null;

    const productsAvailable =
      firstProduct !== null ||
      (productsProbe.status === 200 && Array.isArray(productsProbe.data) && validCart !== null);
    const detectedWoo = firstProduct !== null || validCart !== null;

    if (!detectedWoo) {
      return {
        origin,
        name: null,
        currency: "USD",
        minorUnit: 2,
        country: null,
        wafRestricted: false,
        productsAvailable: false,
        detectedWoo: false,
        expiresAt: now
      };
    }

    const redirectedOrigin =
      (firstProduct ? extractCanonicalOriginFromUrl(productsProbe.url) : null) ??
      (validCart ? extractCanonicalOriginFromUrl(cartProbe.url) : null) ??
      origin;

    const currency = normalizeWooCurrency(
      firstProduct?.prices?.currency_code ?? validCart?.totals?.currency_code,
      "USD"
    );
    const minorUnit =
      typeof firstProduct?.prices?.currency_minor_unit === "number"
        ? firstProduct.prices.currency_minor_unit
        : typeof validCart?.totals?.currency_minor_unit === "number"
          ? validCart.totals.currency_minor_unit
          : 2;
    const country =
      normalizeCountryCode(validCart?.shipping_address?.country) ??
      normalizeCountryCode(validCart?.billing_address?.country);

    const name = await this.fetchStoreName(redirectedOrigin, opts.concurrencyKey);

    const meta: WooDomainMetadata = {
      origin: redirectedOrigin,
      name,
      currency,
      minorUnit,
      country,
      wafRestricted: !productsAvailable && validCart !== null,
      productsAvailable,
      detectedWoo: true,
      expiresAt: now + META_CACHE_TTL_MS
    };

    this.setCacheEntry(origin, meta, now);
    // Only alias redirectedOrigin in shared cache when same-site (apex <-> www)
    if (redirectedOrigin !== origin && isSameStoreSite(origin, redirectedOrigin)) {
      this.setCacheEntry(redirectedOrigin, meta, now);
    }
    return meta;
  }

  private setCacheEntry(key: string, meta: WooDomainMetadata, now: number): void {
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
    this.cache.set(key, meta);
  }

  async detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null> {
    const meta = await this.resolveDomainMetadata(origin, {
      forceRefresh: true,
      concurrencyKey
    });
    if (!meta.detectedWoo) {
      return null;
    }

    return {
      platform: "woocommerce",
      origin: meta.origin,
      name: meta.name,
      currency: meta.currency,
      country: meta.country,
      myshopifyDomain: null,
      wafRestricted: meta.wafRestricted,
      capabilities: {
        predictiveSearch: false,
        productCatalogJson: meta.productsAvailable,
        storefrontMcp: false,
        storefrontMcpTools: [],
        wooStoreApi: true
      }
    };
  }

  private mapProductSummary(
    origin: string,
    fallbackCurrency: string,
    fallbackMinorUnit: number,
    raw: WooProductRaw
  ): ProductSummary | null {
    const title = sanitizeWooText(raw.name, 200);
    const id = raw.id !== undefined ? String(raw.id) : "";
    if (!title || !id) return null;

    const handle = sanitizeWooText(raw.slug, 200) || id;
    const { price, priceMin, priceMax, compareAtPrice } = extractWooProductPrices(
      raw,
      fallbackCurrency,
      fallbackMinorUnit
    );
    const url =
      sanitizeSafeUrl(raw.permalink, origin, { stripTracking: true }) ??
      `${origin}/?p=${encodeURIComponent(id)}`;
    const imageUrl = sanitizeSafeUrl(
      raw.images?.[0]?.src ?? raw.images?.[0]?.thumbnail ?? null,
      origin
    );

    return {
      id,
      handle,
      title,
      vendor: sanitizeWooOptionalText(raw.brands?.[0]?.name, 100),
      product_type: sanitizeWooOptionalText(raw.categories?.[0]?.name, 100),
      available: isWooProductAvailable(raw),
      price,
      price_min: priceMin,
      price_max: priceMax,
      compare_at_price: compareAtPrice,
      url,
      image_url: imageUrl
    };
  }

  private async queryStoreProducts(
    origin: string,
    params: URLSearchParams,
    concurrencyKey?: string
  ): Promise<{ products: WooProductRaw[]; status: number; transportError: boolean }> {
    try {
      const res = await this.getJson<unknown>(
        `${origin}/wp-json/wc/store/v1/products?${params.toString()}`,
        { concurrencyKey }
      );
      if (res.status !== 200 || !Array.isArray(res.data)) {
        return { products: [], status: res.status, transportError: false };
      }
      const valid = res.data.filter(isValidWooStoreProduct);
      return { products: valid, status: res.status, transportError: false };
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return { products: [], status: 0, transportError: true };
    }
  }

  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const limit = Math.min(20, Math.max(1, Math.floor(opts.limit || 10)));
    const meta = await this.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    let currency = normalizeWooCurrency(opts.currencyHint ?? meta.currency);
    const minorUnit = meta.minorUnit;
    const notices: string[] = [];

    const query = opts.query?.trim() ?? "";
    const perPage = Math.min(50, Math.max(limit * 2, 20));

    const params = new URLSearchParams();
    params.set("per_page", String(perPage));
    if (query) {
      params.set("search", query);
    }

    let rawResult = await this.queryStoreProducts(
      effectiveOrigin,
      params,
      opts.concurrencyKey
    );

    // Retry once with simplified/umlaut-folded query when search returned 0 hits
    if (
      query &&
      rawResult.status === 200 &&
      rawResult.products.length === 0 &&
      !rawResult.transportError
    ) {
      const retryQuery = simplifyWooSearchQueryForRetry(query);
      if (retryQuery) {
        const retryParams = new URLSearchParams();
        retryParams.set("per_page", String(perPage));
        retryParams.set("search", retryQuery);
        const retried = await this.queryStoreProducts(
          effectiveOrigin,
          retryParams,
          opts.concurrencyKey
        );
        if (retried.products.length > 0) {
          rawResult = retried;
          notices.push(`Matched via normalized query '${retryQuery}'.`);
        }
      }
    }

    if (rawResult.transportError) {
      notices.push(
        "WooCommerce Store API returned an oversized or invalid response; try get_product with a direct product slug, ID, or URL."
      );
    } else if (rawResult.status === 401 || rawResult.status === 403) {
      notices.push(
        "Store WAF blocked /wp-json/wc/store/v1/products; if you know a numeric product/variation ID, create_cart_link remains available."
      );
    }

    if (!opts.currencyHint && rawResult.products[0]?.prices?.currency_code) {
      currency = normalizeWooCurrency(rawResult.products[0].prices.currency_code, currency);
    }

    const mapped = rawResult.products
      .map((raw) => this.mapProductSummary(effectiveOrigin, currency, minorUnit, raw))
      .filter((p): p is ProductSummary => p !== null);

    let filtered = mapped;
    if (opts.availableOnly) {
      const availableFiltered = filtered.filter((p) => p.available);
      if (filtered.length > 0 && availableFiltered.length === 0) {
        notices.push(
          "All matching products are currently sold out (filtered out by available_only=true)."
        );
      }
      filtered = availableFiltered;
    }
    if (typeof opts.minPrice === "number" && Number.isFinite(opts.minPrice)) {
      filtered = filtered.filter((p) => p.price.amount >= opts.minPrice!);
    }
    if (typeof opts.maxPrice === "number" && Number.isFinite(opts.maxPrice)) {
      filtered = filtered.filter((p) => p.price.amount <= opts.maxPrice!);
    }

    const sliced = filtered.slice(0, limit);
    if (sliced.length > 0 && sliced.every((p) => !p.available)) {
      notices.push("Note: All matching products are currently marked out of stock.");
    }

    return {
      store_origin: effectiveOrigin,
      currency,
      products: sliced,
      notices
    };
  }

  private async fetchVariationDetails(
    origin: string,
    stubs: WooVariationStubRaw[],
    concurrencyKey?: string
  ): Promise<Map<string, WooProductRaw>> {
    const details = new Map<string, WooProductRaw>();
    const boundedIds = stubs
      .map((s) => (s.id !== undefined ? String(s.id) : ""))
      .filter((id) => /^\d{1,20}$/.test(id))
      .slice(0, MAX_VARIATIONS_TO_FETCH);

    if (boundedIds.length === 0) return details;

    // Primary: single batch query (?include=...&type=variation)
    try {
      const params = new URLSearchParams();
      params.set("include", boundedIds.join(","));
      params.set("type", "variation");
      params.set("per_page", String(boundedIds.length));
      const batchRes = await this.getJson<unknown>(
        `${origin}/wp-json/wc/store/v1/products?${params.toString()}`,
        { concurrencyKey }
      );
      if (batchRes.status === 200 && Array.isArray(batchRes.data)) {
        for (const item of batchRes.data) {
          if (isValidWooStoreProduct(item)) {
            details.set(String(item.id), item);
          }
        }
      }
    } catch (err) {
      rethrowIfHardSsrfError(err);
    }

    // Fallback: bounded parallel detail calls for any variations not returned by the batch query
    const missingIds = boundedIds.filter((id) => !details.has(id));
    for (let i = 0; i < missingIds.length; i += VARIATION_FALLBACK_BATCH_SIZE) {
      const slice = missingIds.slice(i, i + VARIATION_FALLBACK_BATCH_SIZE);
      await Promise.all(
        slice.map(async (varId) => {
          try {
            const res = await this.getJson<unknown>(
              `${origin}/wp-json/wc/store/v1/products/${encodeURIComponent(varId)}`,
              { concurrencyKey }
            );
            if (res.status === 200 && isValidWooStoreProduct(res.data)) {
              details.set(varId, res.data);
            }
          } catch (err) {
            rethrowIfHardSsrfError(err);
          }
        })
      );
    }

    return details;
  }

  private async mapProductDetail(
    origin: string,
    currency: string,
    minorUnit: number,
    raw: WooProductRaw,
    concurrencyKey?: string
  ): Promise<ProductDetail> {
    const id = String(raw.id ?? "");
    const handle = sanitizeWooText(raw.slug, 200) || id;
    const title = sanitizeWooText(raw.name, 200);
    const parentPrices = extractWooProductPrices(raw, currency, minorUnit);
    const attrLookup = buildAttributeLookup(raw.attributes);

    const options = (raw.attributes ?? [])
      .slice(0, 10)
      .map((attr) => ({
        name: sanitizeWooText(attr.name, 80),
        values: (attr.terms ?? [])
          .slice(0, 100)
          .map((t) => sanitizeWooText(t.name, 80))
          .filter(Boolean)
      }))
      .filter((opt) => opt.name.length > 0);

    let variants: ProductVariant[];

    if (raw.type === "variable" && Array.isArray(raw.variations) && raw.variations.length > 0) {
      const boundedStubs = raw.variations.slice(0, MAX_VARIATIONS_TO_FETCH);
      const variationDetails = await this.fetchVariationDetails(
        origin,
        boundedStubs,
        concurrencyKey
      );

      variants = boundedStubs
        .map((stub): ProductVariant | null => {
          const varId = stub.id !== undefined ? String(stub.id) : "";
          if (!/^\d{1,20}$/.test(varId)) return null;
          const detail = variationDetails.get(varId);
          const optionValues = resolveVariationOptionValues(stub, detail, attrLookup);
          const variantPrices = detail
            ? extractWooProductPrices(detail, parentPrices.currency, parentPrices.minorUnit)
            : parentPrices;
          const varTitle =
            optionValues.join(" / ") ||
            sanitizeWooText(detail?.variation, 120) ||
            `Variation ${varId}`;

          return {
            id: varId,
            title: varTitle,
            sku: sanitizeWooOptionalText(detail?.sku ?? raw.sku, 80),
            available: detail ? isWooProductAvailable(detail) : isWooProductAvailable(raw),
            price: variantPrices.price,
            compare_at_price: variantPrices.compareAtPrice,
            option_values: optionValues
          };
        })
        .filter((v): v is ProductVariant => v !== null);
    } else {
      const optionValues = parseVariationStringOptions(raw.variation);
      variants = [
        {
          id,
          title: optionValues.join(" / ") || sanitizeWooText(raw.variation, 120) || "Default",
          sku: sanitizeWooOptionalText(raw.sku, 80),
          available: isWooProductAvailable(raw),
          price: parentPrices.price,
          compare_at_price: parentPrices.compareAtPrice,
          option_values: optionValues
        }
      ];
    }

    const images = (raw.images ?? [])
      .map((img) => sanitizeSafeUrl(img.src ?? img.thumbnail ?? null, origin))
      .filter((u): u is string => Boolean(u))
      .slice(0, 10);

    return {
      id,
      handle,
      title,
      vendor: sanitizeWooOptionalText(raw.brands?.[0]?.name, 100),
      product_type: sanitizeWooOptionalText(raw.categories?.[0]?.name, 100),
      description_text: sanitizeWooDescription(raw.description, raw.short_description, 1500),
      available:
        variants.length > 0 ? variants.some((v) => v.available) : isWooProductAvailable(raw),
      url:
        sanitizeSafeUrl(raw.permalink, origin, { stripTracking: true }) ??
        `${origin}/?p=${encodeURIComponent(id)}`,
      options,
      images,
      variants
    };
  }

  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const identifier = extractWooProductIdentifier(handleOrUrl);
    const meta = await this.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const fallbackCurrency = normalizeWooCurrency(opts.currencyHint ?? meta.currency);
    const minorUnit = meta.minorUnit;

    let rawProduct: WooProductRaw | null = null;
    let lastStatus = 0;

    if (identifier.kind === "id") {
      const byIdRes = await this.getJson<unknown>(
        `${effectiveOrigin}/wp-json/wc/store/v1/products/${encodeURIComponent(identifier.value)}`,
        { concurrencyKey: opts.concurrencyKey }
      );
      lastStatus = byIdRes.status;
      if (byIdRes.status === 200 && isValidWooStoreProduct(byIdRes.data)) {
        rawProduct = byIdRes.data;
      }
    }

    if (!rawProduct) {
      const params = new URLSearchParams();
      params.set("slug", identifier.value);
      params.set("per_page", "5");
      const bySlugRes = await this.getJson<unknown>(
        `${effectiveOrigin}/wp-json/wc/store/v1/products?${params.toString()}`,
        { concurrencyKey: opts.concurrencyKey }
      );
      lastStatus = bySlugRes.status;
      if (bySlugRes.status === 200 && Array.isArray(bySlugRes.data)) {
        const validItems = bySlugRes.data.filter(isValidWooStoreProduct);
        rawProduct =
          validItems.find(
            (p) => (p.slug ?? "").toLowerCase() === identifier.value.toLowerCase()
          ) ??
          validItems[0] ??
          null;
      }
    }

    if (!rawProduct) {
      throw new Error(
        `Product '${identifier.value}' not found on ${effectiveOrigin} (HTTP ${lastStatus})`
      );
    }

    const currency = opts.currencyHint
      ? normalizeWooCurrency(opts.currencyHint, fallbackCurrency)
      : normalizeWooCurrency(rawProduct.prices?.currency_code, fallbackCurrency);

    const product = await this.mapProductDetail(
      effectiveOrigin,
      currency,
      rawProduct.prices?.currency_minor_unit ?? minorUnit,
      rawProduct,
      opts.concurrencyKey
    );

    return {
      store_origin: effectiveOrigin,
      currency,
      product
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
    if (!items.length || items.length > 20) {
      throw new Error("items must contain between 1 and 20 line items");
    }

    for (const item of items) {
      if (!/^\d{1,20}$/.test(item.variantId)) {
        throw new Error(`Invalid WooCommerce product/variation ID: ${item.variantId}`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for ID ${item.variantId}: must be integer 1..99`);
      }
    }

    if (opts.discountCode && !/^[A-Za-z0-9._-]{1,64}$/.test(opts.discountCode)) {
      throw new Error("Invalid discount_code format");
    }

    const warnings: string[] = [];
    const verifiedVariantMap = new Map<
      string,
      {
        available: boolean;
        title: string;
        unitPrice: ProductVariant["price"];
        availableAlternatives: Array<{ id: string; title: string }>;
      }
    >();
    const variableParentMap = new Map<
      string,
      { title: string; availableVariations: Array<{ id: string; title: string }> }
    >();

    if (opts.verifyHandles && opts.verifyHandles.length > 0) {
      const uniqueHandles = Array.from(new Set(opts.verifyHandles)).slice(0, 10);
      await Promise.all(
        uniqueHandles.map(async (h) => {
          try {
            const detail = await this.getProduct(origin, h, {
              concurrencyKey: opts.concurrencyKey
            });
            const availableVariants = detail.product.variants
              .filter((v) => v.available)
              .map((v) => ({ id: v.id, title: v.title }));

            // Track variable parent ID separately so we can warn if caller passed parent ID instead of variation ID
            const isVariableParent =
              detail.product.variants.length > 0 &&
              !detail.product.variants.some((v) => v.id === detail.product.id);
            if (isVariableParent) {
              variableParentMap.set(detail.product.id, {
                title: detail.product.title,
                availableVariations: availableVariants.slice(0, 5)
              });
            }

            for (const v of detail.product.variants) {
              const displayTitle =
                v.title && v.title !== "Default"
                  ? `${detail.product.title} — ${v.title}`
                  : detail.product.title;
              verifiedVariantMap.set(v.id, {
                available: v.available,
                title: displayTitle,
                unitPrice: v.price,
                availableAlternatives: availableVariants
                  .filter((alt) => alt.id !== v.id)
                  .slice(0, 5)
              });
            }
          } catch (err) {
            warnings.push(
              `Could not verify handle '${h}': ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })
      );
    }

    const resultItems: CartLinkItemResult[] = items.map((item) => {
      if (opts.verifyHandles && opts.verifyHandles.length > 0) {
        const parentMatch = variableParentMap.get(item.variantId);
        if (parentMatch) {
          const varList = parentMatch.availableVariations
            .map((v) => `${v.title} (${v.id})`)
            .join(", ");
          warnings.push(
            `ID ${item.variantId} is the variable parent product '${parentMatch.title}'. WooCommerce requires a concrete variation ID for direct add-to-cart.${varList ? ` Available variations: ${varList}.` : ""}`
          );
          return {
            variant_id: item.variantId,
            quantity: item.quantity,
            verified: false,
            title: parentMatch.title
          };
        }

        const found = verifiedVariantMap.get(item.variantId);
        if (!found) {
          warnings.push(`Product/variation ID ${item.variantId} was not found in verified handles.`);
          return {
            variant_id: item.variantId,
            quantity: item.quantity,
            verified: false
          };
        }
        if (!found.available) {
          if (found.availableAlternatives.length > 0) {
            const altList = found.availableAlternatives
              .map((alt) => `${alt.title} (${alt.id})`)
              .join(", ");
            warnings.push(
              `Variation ${item.variantId} (${found.title}) is currently out of stock. Available alternatives: ${altList}.`
            );
          } else {
            warnings.push(
              `Product/variation ${item.variantId} (${found.title}) is currently out of stock (all variants of this product are currently out of stock).`
            );
          }
        }
        return {
          variant_id: item.variantId,
          quantity: item.quantity,
          verified: true,
          available: found.available,
          title: found.title,
          unit_price: found.unitPrice
        };
      }

      return {
        variant_id: item.variantId,
        quantity: item.quantity
      };
    });

    if (opts.discountCode) {
      warnings.push(
        `Standard WooCommerce does not apply coupon codes via GET URL parameters. Enter coupon code '${opts.discountCode}' manually during checkout.`
      );
    }

    const effectiveOrigin = this.getCanonicalOrigin(origin);
    const firstItem = items[0]!;
    const primaryUrl = buildWooCartUrl(effectiveOrigin, opts.mode, firstItem);

    if (items.length === 1) {
      return {
        store_origin: effectiveOrigin,
        cart_url: primaryUrl,
        mode: opts.mode,
        items: resultItems,
        warnings,
        next_step:
          "Present this link to the user so they can add the item to their WooCommerce cart and complete checkout in their browser."
      };
    }

    const additionalLinks: AdditionalCartLink[] = items.slice(1).map((item, idx) => {
      const mappedItem = resultItems[idx + 1];
      return {
        variant_id: item.variantId,
        quantity: item.quantity,
        ...(mappedItem?.title ? { title: mappedItem.title } : {}),
        cart_url: buildWooCartUrl(effectiveOrigin, opts.mode, item)
      };
    });

    warnings.push(
      `Standard WooCommerce only supports adding one product/variation per GET URL (?add-to-cart=...). The primary cart_url adds item 1 (${firstItem.variantId} × ${firstItem.quantity}); open the ${additionalLinks.length} link(s) in additional_cart_links sequentially in the same browser session to add the remaining items.`
    );

    return {
      store_origin: effectiveOrigin,
      cart_url: primaryUrl,
      mode: opts.mode,
      items: resultItems,
      additional_cart_links: additionalLinks,
      warnings,
      next_step:
        "Standard WooCommerce adds one item per link. Present cart_url (item 1) followed by each link in additional_cart_links in order so the user can click them sequentially in the same browser session before checkout."
    };
  }
}
