import {
  sanitizeOptionalText,
  sanitizeSafeUrl,
  sanitizeText,
  stripHtmlToText
} from "../../security/sanitize.js";
import { SsrfError } from "../../security/ssrf.js";
import type {
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
import { ShopifyClient } from "./client.js";
import {
  extractProductPathInfo,
  formatMoney,
  matchesSearchQuery,
  moneyFromDecimalString,
  moneyFromMinorUnits,
  normalizeCurrency,
  simplifySearchQueryForRetry
} from "./normalize.js";

interface SuggestProductRaw {
  id?: number | string;
  handle?: string;
  title?: string;
  vendor?: string;
  type?: string;
  available?: boolean;
  price?: string | number;
  price_min?: string | number;
  price_max?: string | number;
  compare_at_price_min?: string | number | null;
  compare_at_price_max?: string | number | null;
  url?: string;
  image?: string | null;
  featured_image?: { url?: string | null } | null;
}

interface ProductsJsonRaw {
  products?: Array<{
    id?: number | string;
    handle?: string;
    title?: string;
    vendor?: string;
    product_type?: string;
    body_html?: string | null;
    images?: Array<{ src?: string }>;
    options?: Array<{ name?: string; values?: string[] }>;
    variants?: Array<{
      id?: number | string;
      title?: string;
      sku?: string | null;
      available?: boolean;
      price?: string | number;
      compare_at_price?: string | number | null;
      option1?: string | null;
      option2?: string | null;
      option3?: string | null;
    }>;
  }>;
}

interface ProductJsRaw {
  id?: number | string;
  handle?: string;
  title?: string;
  vendor?: string;
  type?: string;
  description?: string | null;
  available?: boolean;
  url?: string;
  images?: string[];
  options?: Array<string | { name?: string; values?: string[] }>;
  variants?: Array<{
    id?: number | string;
    title?: string;
    sku?: string | null;
    available?: boolean;
    price?: number;
    compare_at_price?: number | null;
    options?: string[];
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
  }>;
}

interface ProductSingleJsonRaw {
  product?: NonNullable<ProductsJsonRaw["products"]>[number];
}

const HARD_SSRF_CODES = new Set(["INVALID_URL", "BLOCKED_HOST", "BLOCKED_IP", "CONCURRENCY_LIMIT"]);

function rethrowIfHardSsrfError(err: unknown): void {
  if (err instanceof SsrfError && HARD_SSRF_CODES.has(err.code)) {
    throw err;
  }
}

export class ShopifyAdapter implements StoreAdapter {
  readonly platform = "shopify";
  private readonly client: ShopifyClient;

  constructor(client = new ShopifyClient()) {
    this.client = client;
  }

  async detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null> {
    const meta = await this.client.resolveDomainMetadata(origin, {
      forceRefresh: true,
      concurrencyKey
    });
    const effectiveOrigin = meta.origin;

    const [suggestProbe, productsProbe, mcpProbe] = await Promise.all([
      this.probePredictiveSearch(effectiveOrigin, concurrencyKey),
      this.probeProductsJson(effectiveOrigin, concurrencyKey),
      this.probeStorefrontMcp(effectiveOrigin, concurrencyKey)
    ]);

    const isShopify = meta.detectedShopify || suggestProbe || productsProbe.available;
    if (!isShopify) {
      return null;
    }

    if (productsProbe.blocked) {
      this.client.markProductCatalogBlocked(origin);
    }

    return {
      platform: "shopify",
      origin: effectiveOrigin,
      name: meta.name,
      currency: meta.currency,
      country: meta.country,
      myshopifyDomain: meta.myshopifyDomain,
      wafRestricted: meta.wafRestricted || productsProbe.blocked,
      capabilities: {
        predictiveSearch: suggestProbe,
        productCatalogJson: productsProbe.available,
        storefrontMcp: mcpProbe.supported,
        storefrontMcpTools: mcpProbe.tools
      }
    };
  }

  private async probePredictiveSearch(origin: string, concurrencyKey?: string): Promise<boolean> {
    try {
      const res = await this.client.getJson<{
        resources?: { results?: { products?: unknown[] } };
      }>(
        `${origin}/search/suggest.json?q=a&resources[type]=product&resources[limit]=1`,
        { concurrencyKey }
      );
      return (
        res.status === 200 &&
        Array.isArray(res.data?.resources?.results?.products)
      );
    } catch {
      return false;
    }
  }

  private async probeProductsJson(
    origin: string,
    concurrencyKey?: string
  ): Promise<{ available: boolean; blocked: boolean }> {
    try {
      const res = await this.client.getJson<ProductsJsonRaw>(
        `${origin}/products.json?limit=1`,
        { concurrencyKey }
      );
      if (res.status === 200 && Array.isArray(res.data?.products)) {
        return { available: true, blocked: false };
      }
      return { available: false, blocked: res.status === 403 || res.status === 401 };
    } catch {
      return { available: false, blocked: false };
    }
  }

  private async probeStorefrontMcp(
    origin: string,
    concurrencyKey?: string
  ): Promise<{ supported: boolean; tools: string[] }> {
    try {
      const res = await this.client.postJson<{
        result?: { tools?: Array<{ name?: string }> };
      }>(
        `${origin}/api/mcp`,
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { timeoutMs: 2500, concurrencyKey }
      );
      if (res.status === 200 && Array.isArray(res.data?.result?.tools)) {
        const tools = res.data.result.tools
          .map((t) => sanitizeOptionalText(t.name, 80))
          .filter((t): t is string => Boolean(t));
        return { supported: true, tools };
      }
      return { supported: false, tools: [] };
    } catch {
      return { supported: false, tools: [] };
    }
  }

  private async queryPredictiveSearch(
    origin: string,
    currency: string,
    query: string,
    suggestLimit: number,
    concurrencyKey?: string
  ): Promise<{ items: ProductSummary[]; blocked: boolean; transportError: boolean }> {
    try {
      const url = `${origin}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=${suggestLimit}`;
      const suggestRes = await this.client.getJson<{
        resources?: { results?: { products?: SuggestProductRaw[] } };
      }>(url, { concurrencyKey });

      if (suggestRes.status === 200 && Array.isArray(suggestRes.data?.resources?.results?.products)) {
        const items = suggestRes.data.resources.results.products
          .map((p) => this.mapSuggestProduct(origin, currency, p))
          .filter((p): p is ProductSummary => p !== null);
        return { items, blocked: false, transportError: false };
      }
      if (suggestRes.status === 403 || suggestRes.status === 401) {
        return { items: [], blocked: true, transportError: false };
      }
      return { items: [], blocked: false, transportError: false };
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return { items: [], blocked: false, transportError: true };
    }
  }

  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const limit = Math.min(20, Math.max(1, Math.floor(opts.limit || 10)));
    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const currency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    const notices: string[] = [];

    const query = opts.query?.trim() ?? "";
    let items: ProductSummary[] = [];

    if (query) {
      // Primary: WAF-resilient predictive search (/search/suggest.json)
      const suggestLimit = Math.min(10, Math.max(limit, 10));
      const primary = await this.queryPredictiveSearch(
        effectiveOrigin,
        currency,
        query,
        suggestLimit,
        opts.concurrencyKey
      );
      items = primary.items;
      const suggestBlocked = primary.blocked;

      // Retry once with simplified/umlaut-folded query if predictive search succeeded with 0 hits
      if (items.length === 0 && !suggestBlocked && !primary.transportError) {
        const retryQuery = simplifySearchQueryForRetry(query);
        if (retryQuery) {
          const retried = await this.queryPredictiveSearch(
            effectiveOrigin,
            currency,
            retryQuery,
            suggestLimit,
            opts.concurrencyKey
          );
          if (retried.items.length > 0) {
            items = retried.items;
            notices.push(`Matched via normalized query '${retryQuery}'.`);
          }
        }
      }

      // Optional fallback scan on /products.json if predictive search returned nothing and not known blocked
      let catalogBlocked = meta.productCatalogBlocked;
      let catalogTransportError = false;
      if (items.length === 0 && !meta.productCatalogBlocked) {
        const fallback = await this.fetchProductsJsonCatalog(
          effectiveOrigin,
          currency,
          50,
          opts.concurrencyKey
        );
        if (fallback.blocked) {
          catalogBlocked = true;
          this.client.markProductCatalogBlocked(origin);
        } else if (fallback.transportError) {
          catalogTransportError = true;
        } else {
          items = fallback.products.filter((p) => {
            const haystack = `${p.title} ${p.handle} ${p.vendor ?? ""} ${p.product_type ?? ""}`;
            return matchesSearchQuery(haystack, query);
          });
          if (items.length > 0) {
            notices.push("Matched via /products.json catalog fallback.");
          }
        }
      }

      if (items.length === 0 && suggestBlocked && catalogBlocked) {
        notices.push(
          "Store WAF blocked both /search/suggest.json and /products.json; if you have a direct product handle or URL, get_product and create_cart_link remain available."
        );
      } else if (items.length === 0 && primary.transportError && (catalogBlocked || catalogTransportError)) {
        notices.push(
          "Store catalog endpoints returned oversized or non-JSON responses; if you have a direct product handle or URL, get_product and create_cart_link remain available."
        );
      }
    } else {
      // Browse mode without query: /products.json
      const browse = await this.fetchProductsJsonCatalog(
        effectiveOrigin,
        currency,
        Math.min(50, limit * 2),
        opts.concurrencyKey
      );
      if (browse.blocked) {
        this.client.markProductCatalogBlocked(origin);
        throw new Error(
          `This store blocks /products.json via WAF. Provide a non-empty 'query' parameter to use /search/suggest.json instead.`
        );
      }
      if (browse.transportError) {
        throw new Error(
          `This store's /products.json endpoint did not return a valid catalog response. Provide a non-empty 'query' parameter instead.`
        );
      }
      items = browse.products;
    }

    // Apply filters
    let filtered = items;
    if (opts.availableOnly) {
      const availableFiltered = filtered.filter((p) => p.available);
      if (filtered.length > 0 && availableFiltered.length === 0) {
        notices.push("All matching products are currently sold out (filtered out by available_only=true).");
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
      notices.push("Note: All matching products are currently marked sold out.");
    }

    return {
      store_origin: effectiveOrigin,
      currency,
      products: sliced,
      notices
    };
  }

  private mapSuggestProduct(
    origin: string,
    currency: string,
    raw: SuggestProductRaw
  ): ProductSummary | null {
    const handle = sanitizeText(raw.handle, 200);
    const title = sanitizeText(raw.title, 200);
    if (!handle || !title) return null;

    const price = moneyFromDecimalString(raw.price, currency) ?? formatMoney(0, currency);
    const priceMin = moneyFromDecimalString(raw.price_min, currency) ?? price;
    const priceMax = moneyFromDecimalString(raw.price_max, currency) ?? price;
    const compareAt =
      moneyFromDecimalString(raw.compare_at_price_min, currency, true) ??
      moneyFromDecimalString(raw.compare_at_price_max, currency, true);

    const url =
      sanitizeSafeUrl(raw.url, origin, { stripTracking: true }) ??
      `${origin}/products/${encodeURIComponent(handle)}`;
    const imageRaw = raw.image ?? raw.featured_image?.url ?? null;
    const imageUrl = sanitizeSafeUrl(imageRaw, origin, { allowShopifyCdn: true });

    return {
      id: String(raw.id ?? handle),
      handle,
      title,
      vendor: sanitizeOptionalText(raw.vendor, 100),
      product_type: sanitizeOptionalText(raw.type, 100),
      available: raw.available !== false,
      price,
      price_min: priceMin,
      price_max: priceMax,
      compare_at_price: compareAt,
      url,
      image_url: imageUrl
    };
  }

  private async fetchProductsJsonCatalog(
    origin: string,
    currency: string,
    limit: number,
    concurrencyKey?: string
  ): Promise<{ products: ProductSummary[]; blocked: boolean; transportError: boolean }> {
    let res: { status: number; data: ProductsJsonRaw | null; rawText: string; url: string };
    try {
      res = await this.client.getJson<ProductsJsonRaw>(
        `${origin}/products.json?limit=${Math.min(250, Math.max(1, limit))}`,
        { concurrencyKey }
      );
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return { products: [], blocked: false, transportError: true };
    }
    if (res.status === 403 || res.status === 401) {
      return { products: [], blocked: true, transportError: false };
    }
    if (res.status !== 200 || !Array.isArray(res.data?.products)) {
      return { products: [], blocked: false, transportError: false };
    }

    const products: ProductSummary[] = [];
    for (const raw of res.data.products) {
      const handle = sanitizeText(raw.handle, 200);
      const title = sanitizeText(raw.title, 200);
      if (!handle || !title) continue;

      const variants = raw.variants ?? [];
      const prices = variants
        .map((v) => moneyFromDecimalString(v.price, currency))
        .filter((m): m is NonNullable<typeof m> => m !== null);
      const minMoney =
        prices.length > 0
          ? prices.reduce((a, b) => (b.amount < a.amount ? b : a))
          : formatMoney(0, currency);
      const maxMoney =
        prices.length > 0
          ? prices.reduce((a, b) => (b.amount > a.amount ? b : a))
          : minMoney;
      const firstCompare =
        variants
          .map((v) => moneyFromDecimalString(v.compare_at_price, currency, true))
          .find((m) => m !== null) ?? null;
      const available = variants.length > 0 ? variants.some((v) => v.available !== false) : true;

      products.push({
        id: String(raw.id ?? handle),
        handle,
        title,
        vendor: sanitizeOptionalText(raw.vendor, 100),
        product_type: sanitizeOptionalText(raw.product_type, 100),
        available,
        price: minMoney,
        price_min: minMoney,
        price_max: maxMoney,
        compare_at_price: firstCompare,
        url: `${origin}/products/${encodeURIComponent(handle)}`,
        image_url: sanitizeSafeUrl(raw.images?.[0]?.src, origin, { allowShopifyCdn: true })
      });
    }

    return { products, blocked: false, transportError: false };
  }

  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const { handle, localePrefix } = extractProductPathInfo(handleOrUrl);
    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const currency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    const encodedHandle = encodeURIComponent(handle);

    // Primary: /products/<handle>.js (preserving localized subpath like /de/products/<handle>.js when provided)
    const jsPaths = localePrefix
      ? [`${localePrefix}/products/${encodedHandle}.js`, `/products/${encodedHandle}.js`]
      : [`/products/${encodedHandle}.js`];

    let lastJsStatus = 0;
    for (const path of jsPaths) {
      const jsRes = await this.client.getJson<ProductJsRaw>(`${effectiveOrigin}${path}`, {
        concurrencyKey: opts.concurrencyKey
      });
      lastJsStatus = jsRes.status;
      if (jsRes.status === 200 && jsRes.data && jsRes.data.id !== undefined) {
        return {
          store_origin: effectiveOrigin,
          currency,
          product: this.mapProductJs(effectiveOrigin, currency, handle, jsRes.data)
        };
      }
    }

    // Fallback: /products/<handle>.json (decimal strings)
    const jsonPaths = localePrefix
      ? [`${localePrefix}/products/${encodedHandle}.json`, `/products/${encodedHandle}.json`]
      : [`/products/${encodedHandle}.json`];

    let lastJsonStatus = 0;
    for (const path of jsonPaths) {
      const jsonRes = await this.client.getJson<ProductSingleJsonRaw>(`${effectiveOrigin}${path}`, {
        concurrencyKey: opts.concurrencyKey
      });
      lastJsonStatus = jsonRes.status;
      if (jsonRes.status === 200 && jsonRes.data?.product) {
        return {
          store_origin: effectiveOrigin,
          currency,
          product: this.mapProductJson(effectiveOrigin, currency, handle, jsonRes.data.product)
        };
      }
    }

    throw new Error(
      `Product '${handle}' not found on ${effectiveOrigin} (HTTP ${lastJsStatus} / ${lastJsonStatus})`
    );
  }

  private mapProductJs(
    origin: string,
    currency: string,
    fallbackHandle: string,
    raw: ProductJsRaw
  ): ProductDetail {
    const handle = sanitizeText(raw.handle, 200) || fallbackHandle;
    const rawVariants = (raw.variants ?? []).slice(0, 100);
    const positionalSlots: Array<Array<string | null>> = [];

    const variants: ProductVariant[] = rawVariants.map((v) => {
      const slots: Array<string | null> = (
        Array.isArray(v.options) ? v.options : [v.option1, v.option2, v.option3]
      ).map((o) => {
        const cleaned = sanitizeText(o, 100);
        return cleaned || null;
      });
      positionalSlots.push(slots);

      const optValues = slots.filter((o): o is string => o !== null);

      return {
        id: String(v.id ?? ""),
        title: sanitizeText(v.title, 120) || "Default",
        sku: sanitizeOptionalText(v.sku, 80),
        available: v.available !== false,
        price: moneyFromMinorUnits(v.price, currency) ?? formatMoney(0, currency),
        compare_at_price: moneyFromMinorUnits(v.compare_at_price, currency, true),
        option_values: optValues
      };
    });

    const options = (raw.options ?? [])
      .slice(0, 10)
      .map((opt, idx) => {
        if (typeof opt === "string") {
          const vals = Array.from(
            new Set(
              positionalSlots
                .map((slots) => slots[idx] ?? null)
                .filter((v): v is string => v !== null)
            )
          );
          return { name: sanitizeText(opt, 80), values: vals };
        }
        return {
          name: sanitizeText(opt?.name, 80),
          values: (opt?.values ?? []).slice(0, 100).map((v) => sanitizeText(v, 80)).filter(Boolean)
        };
      })
      .filter((opt) => opt.name.length > 0);

    const images = (raw.images ?? [])
      .map((img) => sanitizeSafeUrl(img, origin, { allowShopifyCdn: true }))
      .filter((u): u is string => Boolean(u))
      .slice(0, 10);

    return {
      id: String(raw.id ?? handle),
      handle,
      title: sanitizeText(raw.title, 200),
      vendor: sanitizeOptionalText(raw.vendor, 100),
      product_type: sanitizeOptionalText(raw.type, 100),
      description_text: stripHtmlToText(raw.description, 1500),
      available: raw.available !== false && variants.some((v) => v.available),
      url:
        sanitizeSafeUrl(raw.url, origin, { stripTracking: true }) ??
        `${origin}/products/${encodeURIComponent(handle)}`,
      options,
      images,
      variants
    };
  }

  private mapProductJson(
    origin: string,
    currency: string,
    fallbackHandle: string,
    raw: NonNullable<ProductsJsonRaw["products"]>[number]
  ): ProductDetail {
    const handle = sanitizeText(raw.handle, 200) || fallbackHandle;
    const rawVariants = (raw.variants ?? []).slice(0, 100);
    const variants: ProductVariant[] = rawVariants.map((v) => {
      const optValues = [v.option1, v.option2, v.option3]
        .map((o) => sanitizeText(o, 100))
        .filter(Boolean);
      return {
        id: String(v.id ?? ""),
        title: sanitizeText(v.title, 120) || "Default",
        sku: sanitizeOptionalText(v.sku, 80),
        available: v.available !== false,
        price: moneyFromDecimalString(v.price, currency) ?? formatMoney(0, currency),
        compare_at_price: moneyFromDecimalString(v.compare_at_price, currency, true),
        option_values: optValues
      };
    });

    const options = (raw.options ?? [])
      .slice(0, 10)
      .map((opt) => ({
        name: sanitizeText(opt?.name, 80),
        values: (opt?.values ?? []).slice(0, 100).map((v) => sanitizeText(v, 80)).filter(Boolean)
      }))
      .filter((opt) => opt.name.length > 0);

    const images = (raw.images ?? [])
      .map((img) => sanitizeSafeUrl(img.src, origin, { allowShopifyCdn: true }))
      .filter((u): u is string => Boolean(u))
      .slice(0, 10);

    return {
      id: String(raw.id ?? handle),
      handle,
      title: sanitizeText(raw.title, 200),
      vendor: sanitizeOptionalText(raw.vendor, 100),
      product_type: sanitizeOptionalText(raw.product_type, 100),
      description_text: stripHtmlToText(raw.body_html, 1500),
      available: variants.some((v) => v.available),
      url: `${origin}/products/${encodeURIComponent(handle)}`,
      options,
      images,
      variants
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
        throw new Error(`Invalid Shopify variant_id: ${item.variantId}`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for variant ${item.variantId}: must be integer 1..99`);
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

            for (const v of detail.product.variants) {
              const displayTitle =
                v.title && v.title !== "Default Title"
                  ? `${detail.product.title} — ${v.title}`
                  : detail.product.title;
              verifiedVariantMap.set(v.id, {
                available: v.available,
                title: displayTitle,
                unitPrice: v.price,
                availableAlternatives: availableVariants.filter((alt) => alt.id !== v.id).slice(0, 5)
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
      const found = verifiedVariantMap.get(item.variantId);
      if (opts.verifyHandles && opts.verifyHandles.length > 0) {
        if (!found) {
          warnings.push(`Variant ${item.variantId} was not found in verified handles.`);
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
              `Variant ${item.variantId} (${found.title}) is currently sold out. Available alternatives: ${altList}.`
            );
          } else {
            warnings.push(
              `Variant ${item.variantId} (${found.title}) is currently sold out (all variants of this product are currently out of stock).`
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

    const effectiveOrigin = this.client.getCanonicalOrigin(origin);
    const lineSpec = items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
    const params = new URLSearchParams();
    if (opts.mode === "cart") {
      params.set("storefront", "true");
    }
    if (opts.discountCode) {
      params.set("discount", opts.discountCode);
    }
    const qs = params.toString();
    const cartUrl = `${effectiveOrigin}/cart/${lineSpec}${qs ? `?${qs}` : ""}`;

    return {
      store_origin: effectiveOrigin,
      cart_url: cartUrl,
      mode: opts.mode,
      items: resultItems,
      warnings,
      next_step:
        "Present this link to the user so they can review the cart and complete checkout in their browser."
    };
  }
}
