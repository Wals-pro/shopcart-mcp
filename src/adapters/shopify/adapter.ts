import {
  sanitizeOptionalText,
  sanitizeSafeUrl,
  sanitizeText,
  stripHtmlToText
} from "../../security/sanitize.js";
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
  extractProductHandle,
  formatMoney,
  moneyFromDecimalString,
  moneyFromMinorUnits,
  normalizeCurrency
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

    const [suggestProbe, productsProbe, mcpProbe] = await Promise.all([
      this.probePredictiveSearch(origin, concurrencyKey),
      this.probeProductsJson(origin, concurrencyKey),
      this.probeStorefrontMcp(origin, concurrencyKey)
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
      origin,
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

  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const limit = Math.min(20, Math.max(1, Math.floor(opts.limit || 10)));
    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const currency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    const notices: string[] = [];

    const query = opts.query?.trim() ?? "";
    let items: ProductSummary[] = [];

    if (query) {
      // Primary: WAF-resilient predictive search (/search/suggest.json works 5/5)
      const suggestLimit = Math.min(10, Math.max(limit, 10));
      const url = `${origin}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=${suggestLimit}`;
      const suggestRes = await this.client.getJson<{
        resources?: { results?: { products?: SuggestProductRaw[] } };
      }>(url, { concurrencyKey: opts.concurrencyKey });

      let suggestBlocked = false;
      if (suggestRes.status === 200 && Array.isArray(suggestRes.data?.resources?.results?.products)) {
        items = suggestRes.data.resources.results.products
          .map((p) => this.mapSuggestProduct(origin, currency, p))
          .filter((p): p is ProductSummary => p !== null);
      } else if (suggestRes.status === 403 || suggestRes.status === 401) {
        suggestBlocked = true;
      }

      // Optional fallback scan on /products.json if predictive search returned nothing and not known blocked
      let catalogBlocked = meta.productCatalogBlocked;
      if (items.length === 0 && !meta.productCatalogBlocked) {
        const fallback = await this.fetchProductsJsonCatalog(origin, currency, 50, opts.concurrencyKey);
        if (fallback.blocked) {
          catalogBlocked = true;
          this.client.markProductCatalogBlocked(origin);
        } else {
          const tokens = query
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length >= 2);
          items = fallback.products.filter((p) => {
            const haystack = `${p.title} ${p.handle} ${p.vendor ?? ""} ${p.product_type ?? ""}`.toLowerCase();
            return tokens.every((tok) => haystack.includes(tok));
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
      }
    } else {
      // Browse mode without query: /products.json
      const browse = await this.fetchProductsJsonCatalog(origin, currency, Math.min(50, limit * 2), opts.concurrencyKey);
      if (browse.blocked) {
        this.client.markProductCatalogBlocked(origin);
        throw new Error(
          `This store blocks /products.json via WAF. Provide a non-empty 'query' parameter to use /search/suggest.json instead.`
        );
      }
      items = browse.products;
    }

    // Apply filters
    let filtered = items;
    if (opts.availableOnly) {
      filtered = filtered.filter((p) => p.available);
    }
    if (typeof opts.minPrice === "number" && Number.isFinite(opts.minPrice)) {
      filtered = filtered.filter((p) => p.price.amount >= opts.minPrice!);
    }
    if (typeof opts.maxPrice === "number" && Number.isFinite(opts.maxPrice)) {
      filtered = filtered.filter((p) => p.price.amount <= opts.maxPrice!);
    }

    return {
      store_origin: origin,
      currency,
      products: filtered.slice(0, limit),
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
  ): Promise<{ products: ProductSummary[]; blocked: boolean }> {
    const res = await this.client.getJson<ProductsJsonRaw>(
      `${origin}/products.json?limit=${Math.min(250, Math.max(1, limit))}`,
      { concurrencyKey }
    );
    if (res.status === 403 || res.status === 401) {
      return { products: [], blocked: true };
    }
    if (res.status !== 200 || !Array.isArray(res.data?.products)) {
      return { products: [], blocked: false };
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

    return { products, blocked: false };
  }

  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const handle = extractProductHandle(handleOrUrl);
    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const currency = normalizeCurrency(opts.currencyHint ?? meta.currency);

    // Primary: /products/<handle>.js (works 5/5 even behind strict WAF; minor units!)
    const jsRes = await this.client.getJson<ProductJsRaw>(
      `${origin}/products/${encodeURIComponent(handle)}.js`,
      { concurrencyKey: opts.concurrencyKey }
    );

    if (jsRes.status === 200 && jsRes.data && jsRes.data.id !== undefined) {
      return {
        store_origin: origin,
        currency,
        product: this.mapProductJs(origin, currency, handle, jsRes.data)
      };
    }

    // Fallback: /products/<handle>.json (decimal strings)
    const jsonRes = await this.client.getJson<ProductSingleJsonRaw>(
      `${origin}/products/${encodeURIComponent(handle)}.json`,
      { concurrencyKey: opts.concurrencyKey }
    );

    if (jsonRes.status === 200 && jsonRes.data?.product) {
      return {
        store_origin: origin,
        currency,
        product: this.mapProductJson(origin, currency, handle, jsonRes.data.product)
      };
    }

    throw new Error(
      `Product '${handle}' not found on ${origin} (HTTP ${jsRes.status} / ${jsonRes.status})`
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
    const variants: ProductVariant[] = rawVariants.map((v) => {
      const optValues = (
        Array.isArray(v.options)
          ? v.options
          : [v.option1, v.option2, v.option3].filter((o): o is string => Boolean(o))
      )
        .map((o) => sanitizeText(o, 100))
        .filter(Boolean);

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

    const options = (raw.options ?? []).slice(0, 10).map((opt, idx) => {
      if (typeof opt === "string") {
        const vals = Array.from(
          new Set(variants.map((v) => v.option_values[idx]).filter((v): v is string => Boolean(v)))
        );
        return { name: sanitizeText(opt, 80), values: vals };
      }
      return {
        name: sanitizeText(opt.name, 80),
        values: (opt.values ?? []).slice(0, 100).map((v) => sanitizeText(v, 80)).filter(Boolean)
      };
    });

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
        .filter((o): o is string => Boolean(o))
        .map((o) => sanitizeText(o, 100));
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

    const options = (raw.options ?? []).slice(0, 10).map((opt) => ({
      name: sanitizeText(opt.name, 80),
      values: (opt.values ?? []).slice(0, 100).map((v) => sanitizeText(v, 80)).filter(Boolean)
    }));

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
      { available: boolean; title: string; unitPrice: ProductVariant["price"] }
    >();

    if (opts.verifyHandles && opts.verifyHandles.length > 0) {
      const uniqueHandles = Array.from(new Set(opts.verifyHandles)).slice(0, 10);
      await Promise.all(
        uniqueHandles.map(async (h) => {
          try {
            const detail = await this.getProduct(origin, h, {
              concurrencyKey: opts.concurrencyKey
            });
            for (const v of detail.product.variants) {
              verifiedVariantMap.set(v.id, {
                available: v.available,
                title: `${detail.product.title} — ${v.title}`,
                unitPrice: v.price
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
          warnings.push(`Variant ${item.variantId} (${found.title}) is currently sold out.`);
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

    const lineSpec = items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
    const params = new URLSearchParams();
    if (opts.mode === "cart") {
      params.set("storefront", "true");
    }
    if (opts.discountCode) {
      params.set("discount", opts.discountCode);
    }
    const qs = params.toString();
    const cartUrl = `${origin}/cart/${lineSpec}${qs ? `?${qs}` : ""}`;

    return {
      store_origin: origin,
      cart_url: cartUrl,
      mode: opts.mode,
      items: resultItems,
      warnings,
      next_step:
        "Present this link to the user so they can review the cart and complete checkout in their browser."
    };
  }
}
