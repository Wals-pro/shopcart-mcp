import {
  sanitizeGenericVariantId,
  sanitizeSafeHandle
} from "../../security/identifiers.js";
import {
  sanitizeOptionalText,
  sanitizeSafeUrl,
  sanitizeText,
  stripHtmlToText
} from "../../security/sanitize.js";
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
import { formatMoney, normalizeCurrency } from "../shopify/normalize.js";
import { computeDiscountPercent, rethrowIfHardSsrfError } from "../shared/html.js";
import { MagentoClient, sanitizeMagentoUrlSuffix } from "./client.js";

interface MagentoMoneyRaw {
  value?: number;
  currency?: string;
}

interface MagentoPriceTierRaw {
  regular_price?: MagentoMoneyRaw | null;
  final_price?: MagentoMoneyRaw | null;
  discount?: {
    amount_off?: number | null;
    percent_off?: number | null;
  } | null;
}

interface MagentoProductVariantRaw {
  product?: {
    id?: number | string;
    sku?: string;
    name?: string;
    stock_status?: string;
    price_range?: {
      minimum_price?: MagentoPriceTierRaw | null;
    } | null;
  } | null;
  attributes?: Array<{
    code?: string;
    label?: string;
    value_index?: number | string;
  }>;
}

interface MagentoProductRaw {
  id?: number | string;
  sku?: string;
  name?: string;
  url_key?: string;
  url_suffix?: string | null;
  stock_status?: string;
  small_image?: { url?: string | null } | null;
  image?: { url?: string | null } | null;
  media_gallery?: Array<{ url?: string | null; label?: string | null; disabled?: boolean }>;
  description?: { html?: string | null } | null;
  short_description?: { html?: string | null } | null;
  price_range?: {
    minimum_price?: MagentoPriceTierRaw | null;
    maximum_price?: MagentoPriceTierRaw | null;
  } | null;
  configurable_options?: Array<{
    attribute_code?: string;
    label?: string;
    values?: Array<{ value_index?: number | string; label?: string }>;
  }>;
  variants?: MagentoProductVariantRaw[];
}

interface MagentoProductsResponse {
  data?: {
    products?: {
      total_count?: number;
      items?: MagentoProductRaw[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

const SEARCH_PRODUCTS_QUERY = `query ShopCartMagentoSearch($q: String!, $limit: Int!) {
  products(search: $q, pageSize: $limit) {
    total_count
    items {
      id
      sku
      name
      url_key
      url_suffix
      stock_status
      small_image { url }
      price_range {
        minimum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
        maximum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
      }
      ... on ConfigurableProduct {
        configurable_options {
          attribute_code
          label
          values { value_index label }
        }
        variants {
          product {
            id
            sku
            name
            stock_status
            price_range {
              minimum_price {
                regular_price { value currency }
                final_price { value currency }
                discount { amount_off percent_off }
              }
            }
          }
          attributes { code label value_index }
        }
      }
    }
  }
}`;

const SEARCH_PRODUCTS_LEAN_QUERY = `query ShopCartMagentoSearchLean($q: String!, $limit: Int!) {
  products(search: $q, pageSize: $limit) {
    total_count
    items {
      sku
      name
      url_key
      stock_status
      small_image { url }
      price_range {
        minimum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
      }
    }
  }
}`;

const BROWSE_PRODUCTS_QUERY = `query ShopCartMagentoBrowse($limit: Int!) {
  products(filter: {}, pageSize: $limit) {
    total_count
    items {
      id
      sku
      name
      url_key
      url_suffix
      stock_status
      small_image { url }
      price_range {
        minimum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
        maximum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
      }
    }
  }
}`;

const PRODUCT_BY_URL_KEY_QUERY = `query ShopCartMagentoByUrlKey($key: String!) {
  products(filter: { url_key: { eq: $key } }, pageSize: 1) {
    items {
      id
      sku
      name
      url_key
      url_suffix
      stock_status
      description { html }
      short_description { html }
      small_image { url }
      image { url }
      media_gallery { url label disabled }
      price_range {
        minimum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
        maximum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
      }
      ... on ConfigurableProduct {
        configurable_options {
          attribute_code
          label
          values { value_index label }
        }
        variants {
          product {
            id
            sku
            name
            stock_status
            price_range {
              minimum_price {
                regular_price { value currency }
                final_price { value currency }
                discount { amount_off percent_off }
              }
            }
          }
          attributes { code label value_index }
        }
      }
    }
  }
}`;

const PRODUCT_BY_SKU_QUERY = `query ShopCartMagentoBySku($sku: String!) {
  products(filter: { sku: { eq: $sku } }, pageSize: 1) {
    items {
      id
      sku
      name
      url_key
      url_suffix
      stock_status
      description { html }
      short_description { html }
      small_image { url }
      image { url }
      media_gallery { url label disabled }
      price_range {
        minimum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
        maximum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
      }
      ... on ConfigurableProduct {
        configurable_options {
          attribute_code
          label
          values { value_index label }
        }
        variants {
          product {
            id
            sku
            name
            stock_status
            price_range {
              minimum_price {
                regular_price { value currency }
                final_price { value currency }
                discount { amount_off percent_off }
              }
            }
          }
          attributes { code label value_index }
        }
      }
    }
  }
}`;

const PRODUCTS_BY_SKUS_QUERY = `query ShopCartMagentoBySkus($skus: [String!]) {
  products(filter: { sku: { in: $skus } }, pageSize: 20) {
    items {
      sku
      name
      url_key
      url_suffix
      stock_status
      price_range {
        minimum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { amount_off percent_off }
        }
      }
    }
  }
}`;

function buildMagentoProductUrl(
  origin: string,
  urlKey: string,
  urlSuffix: string | null | undefined,
  defaultSuffix: string
): string {
  const safeKey = sanitizeText(urlKey, 200).replace(/^\/+|\/+$/g, "");
  if (!safeKey) return origin;
  const segments = safeKey
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .map((s) => encodeURIComponent(s));
  if (segments.length === 0) return origin;
  const safeDefault = sanitizeMagentoUrlSuffix(defaultSuffix, "");
  const suffix =
    typeof urlSuffix === "string"
      ? sanitizeMagentoUrlSuffix(urlSuffix, safeDefault)
      : safeDefault;
  const candidate =
    suffix === "/"
      ? `${origin}/${segments.join("/")}/`
      : `${origin}/${segments.join("/")}${suffix}`;
  return sanitizeSafeUrl(candidate, origin, { stripTracking: true }) ?? origin;
}

function extractUrlKeyCandidate(handleOrUrl: string, defaultSuffix: string): string {
  let raw = handleOrUrl.trim();
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    raw = parsed.pathname;
  }
  raw = raw.replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "");
  if (defaultSuffix && defaultSuffix !== "/" && raw.toLowerCase().endsWith(defaultSuffix.toLowerCase())) {
    raw = raw.slice(0, -defaultSuffix.length);
  }
  if (raw.toLowerCase().endsWith(".html")) {
    raw = raw.slice(0, -5);
  }
  const segments = raw.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? raw;
}

function parsePriceTier(
  tier: MagentoPriceTierRaw | null | undefined,
  fallbackCurrency: string
): {
  price: ReturnType<typeof formatMoney>;
  compareAt: ReturnType<typeof formatMoney> | null;
  discountPercent: number | null;
  currency: string;
} {
  const currency = normalizeCurrency(
    tier?.final_price?.currency ?? tier?.regular_price?.currency ?? fallbackCurrency
  );
  const finalVal =
    typeof tier?.final_price?.value === "number" && Number.isFinite(tier.final_price.value)
      ? tier.final_price.value
      : typeof tier?.regular_price?.value === "number" && Number.isFinite(tier.regular_price.value)
        ? tier.regular_price.value
        : 0;
  const regVal =
    typeof tier?.regular_price?.value === "number" && Number.isFinite(tier.regular_price.value)
      ? tier.regular_price.value
      : null;

  const price = formatMoney(finalVal, currency);
  const compareAt =
    regVal !== null && regVal > finalVal ? formatMoney(regVal, currency) : null;

  const gqlPercent = tier?.discount?.percent_off;
  const discountPercent =
    compareAt
      ? typeof gqlPercent === "number" && Number.isFinite(gqlPercent) && gqlPercent > 0
        ? Math.round(gqlPercent * 100) / 100
        : computeDiscountPercent(finalVal, compareAt.amount)
      : null;

  return { price, compareAt, discountPercent, currency };
}

export class MagentoAdapter implements StoreAdapter {
  readonly platform = "magento";
  private readonly client: MagentoClient;

  constructor(client = new MagentoClient()) {
    this.client = client;
  }

  async detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null> {
    const meta = await this.client.resolveDomainMetadata(origin, {
      forceRefresh: true,
      concurrencyKey
    });

    if (!meta.detected) {
      return null;
    }

    return {
      platform: "magento",
      origin: meta.origin,
      name: meta.name,
      currency: meta.currency,
      country: meta.country,
      myshopifyDomain: null,
      wafRestricted: meta.wafRestricted,
      capabilities: {
        predictiveSearch: false,
        productCatalogJson: true,
        storefrontMcp: false,
        storefrontMcpTools: [],
        magentoGraphql: true
      }
    };
  }

  private mapProductSummary(
    origin: string,
    defaultCurrency: string,
    defaultSuffix: string,
    raw: MagentoProductRaw
  ): ProductSummary | null {
    const sku = sanitizeGenericVariantId(sanitizeText(raw.sku, 80));
    const title = sanitizeText(raw.name, 200);
    if (!sku || !title) return null;

    const urlKey =
      sanitizeSafeHandle(sanitizeText(raw.url_key, 200)) ?? sanitizeSafeHandle(sku);
    if (!urlKey) return null;
    const minTier = parsePriceTier(raw.price_range?.minimum_price, defaultCurrency);
    const maxTier = raw.price_range?.maximum_price
      ? parsePriceTier(raw.price_range.maximum_price, minTier.currency)
      : minTier;

    const url = buildMagentoProductUrl(origin, urlKey, raw.url_suffix, defaultSuffix);
    const imageUrl = sanitizeSafeUrl(raw.small_image?.url ?? raw.image?.url, origin, {
      allowStoreSubdomains: true
    });

    return {
      id: sku,
      handle: urlKey,
      title,
      vendor: null,
      product_type: null,
      available: raw.stock_status !== "OUT_OF_STOCK",
      price: minTier.price,
      price_min: minTier.price,
      price_max: maxTier.price,
      compare_at_price: minTier.compareAt,
      discount_percent: minTier.discountPercent,
      url,
      image_url: imageUrl
    };
  }

  private mapProductDetail(
    origin: string,
    defaultCurrency: string,
    defaultSuffix: string,
    raw: MagentoProductRaw
  ): { currency: string; product: ProductDetail } {
    const sku =
      sanitizeGenericVariantId(sanitizeText(raw.sku, 80)) ??
      sanitizeGenericVariantId(
        raw.id !== undefined && raw.id !== null ? sanitizeText(String(raw.id), 80) : ""
      ) ??
      "";
    const title = sanitizeText(raw.name, 200) || sku || "product";
    const urlKey =
      sanitizeSafeHandle(sanitizeText(raw.url_key, 200)) ?? sanitizeSafeHandle(sku) ?? "";
    const url = buildMagentoProductUrl(origin, urlKey || "product", raw.url_suffix, defaultSuffix);
    const baseTier = parsePriceTier(raw.price_range?.minimum_price, defaultCurrency);

    const options = (raw.configurable_options ?? [])
      .slice(0, 10)
      .map((opt) => ({
        name: sanitizeText(opt.label ?? opt.attribute_code, 80),
        values: (opt.values ?? [])
          .slice(0, 100)
          .map((v) => sanitizeText(v.label, 80))
          .filter(Boolean)
      }))
      .filter((o) => o.name.length > 0);

    const variants: ProductVariant[] = [];
    if (Array.isArray(raw.variants) && raw.variants.length > 0) {
      for (const v of raw.variants.slice(0, 100)) {
        if (!v.product) continue;
        const vSku =
          sanitizeGenericVariantId(sanitizeText(v.product.sku, 80)) ??
          sanitizeGenericVariantId(
            v.product.id !== undefined && v.product.id !== null
              ? sanitizeText(String(v.product.id), 80)
              : ""
          );
        if (!vSku) continue;
        const vTier = parsePriceTier(
          v.product.price_range?.minimum_price ?? raw.price_range?.minimum_price,
          baseTier.currency
        );
        const optVals = (v.attributes ?? [])
          .map((a) => sanitizeText(a.label, 80))
          .filter(Boolean);
        variants.push({
          id: vSku,
          title: optVals.length > 0 ? optVals.join(" / ") : sanitizeText(v.product.name, 120) || vSku,
          sku: vSku,
          available: v.product.stock_status !== "OUT_OF_STOCK",
          price: vTier.price,
          compare_at_price: vTier.compareAt,
          discount_percent: vTier.discountPercent,
          option_values: optVals
        });
      }
    }

    if (variants.length === 0 && sku) {
      variants.push({
        id: sku,
        title: "Default",
        sku,
        available: raw.stock_status !== "OUT_OF_STOCK",
        price: baseTier.price,
        compare_at_price: baseTier.compareAt,
        discount_percent: baseTier.discountPercent,
        option_values: []
      });
    }

    const imageSet = new Set<string>();
    for (const entry of raw.media_gallery ?? []) {
      if (entry.disabled) continue;
      const safe = sanitizeSafeUrl(entry.url, origin, { allowStoreSubdomains: true });
      if (safe) imageSet.add(safe);
    }
    for (const fallback of [raw.image?.url, raw.small_image?.url]) {
      const safe = sanitizeSafeUrl(fallback, origin, { allowStoreSubdomains: true });
      if (safe) imageSet.add(safe);
    }

    const descriptionHtml = raw.description?.html ?? raw.short_description?.html ?? "";
    const available =
      raw.stock_status !== "OUT_OF_STOCK" && variants.some((v) => v.available);

    return {
      currency: baseTier.currency,
      product: {
        id: sku,
        handle: urlKey,
        title,
        vendor: null,
        product_type: null,
        description_text: stripHtmlToText(descriptionHtml, 1500),
        available,
        url,
        options,
        images: Array.from(imageSet).slice(0, 10),
        variants
      }
    };
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
    let currency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    const notices: string[] = [];
    const query = opts.query?.trim() ?? "";

    let rawItems: MagentoProductRaw[] = [];
    try {
      const gqlQuery = query ? SEARCH_PRODUCTS_QUERY : BROWSE_PRODUCTS_QUERY;
      const variables = query
        ? { q: query, limit: Math.min(25, limit * 2) }
        : { limit: Math.min(25, limit * 2) };

      let res = await this.client.graphql<MagentoProductsResponse>(
        effectiveOrigin,
        gqlQuery,
        variables,
        { concurrencyKey: opts.concurrencyKey }
      );

      // Retry once with lean query if a custom/older Magento schema rejected optional fields
      if (
        query &&
        res.status === 200 &&
        res.data?.errors?.length &&
        !res.data?.data?.products?.items
      ) {
        res = await this.client.graphql<MagentoProductsResponse>(
          effectiveOrigin,
          SEARCH_PRODUCTS_LEAN_QUERY,
          variables,
          { concurrencyKey: opts.concurrencyKey }
        );
      }

      if (res.status === 401 || res.status === 403) {
        notices.push(
          `Magento GraphQL endpoint returned HTTP ${res.status} (access restricted). ShopCart does not bypass WAF or authentication.`
        );
      } else if (res.status === 429) {
        notices.push(
          "Magento GraphQL endpoint rate-limited the request (HTTP 429). Retry after a short pause."
        );
      } else if (res.status === 200 && Array.isArray(res.data?.data?.products?.items)) {
        rawItems = res.data.data.products.items;
      }
    } catch (err) {
      rethrowIfHardSsrfError(err);
      notices.push("Magento GraphQL search request failed due to an upstream network or timeout error.");
    }

    const mapped = rawItems
      .map((item) => this.mapProductSummary(effectiveOrigin, currency, meta.productUrlSuffix, item))
      .filter((p): p is ProductSummary => p !== null);

    if (!opts.currencyHint && mapped[0]?.price.currency) {
      currency = mapped[0].price.currency;
    }

    let filtered = mapped;
    if (opts.availableOnly) {
      const avail = filtered.filter((p) => p.available);
      if (filtered.length > 0 && avail.length === 0) {
        notices.push("All matching products are currently sold out (filtered out by available_only=true).");
      }
      filtered = avail;
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

  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const trimmed = handleOrUrl.trim();
    if (!trimmed) {
      throw new Error("handle_or_url is required");
    }

    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const defaultCurrency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    const urlKeyCandidate = extractUrlKeyCandidate(trimmed, meta.productUrlSuffix);

    // 1. Lookup by url_key
    const byKeyRes = await this.client.graphql<MagentoProductsResponse>(
      effectiveOrigin,
      PRODUCT_BY_URL_KEY_QUERY,
      { key: urlKeyCandidate },
      { concurrencyKey: opts.concurrencyKey }
    );

    if (byKeyRes.status === 401 || byKeyRes.status === 403) {
      throw new Error(
        `Magento GraphQL endpoint returned HTTP ${byKeyRes.status}. ShopCart does not bypass WAF or authentication.`
      );
    }

    const foundByKey = byKeyRes.data?.data?.products?.items?.[0];
    if (foundByKey) {
      const mapped = this.mapProductDetail(
        effectiveOrigin,
        defaultCurrency,
        meta.productUrlSuffix,
        foundByKey
      );
      return {
        store_origin: effectiveOrigin,
        currency: mapped.currency,
        product: mapped.product
      };
    }

    // 2. Fallback lookup by exact SKU
    const skuCandidate = sanitizeText(trimmed, 80);
    if (skuCandidate && !skuCandidate.includes("/")) {
      const bySkuRes = await this.client.graphql<MagentoProductsResponse>(
        effectiveOrigin,
        PRODUCT_BY_SKU_QUERY,
        { sku: skuCandidate },
        { concurrencyKey: opts.concurrencyKey }
      );
      const foundBySku = bySkuRes.data?.data?.products?.items?.[0];
      if (foundBySku) {
        const mapped = this.mapProductDetail(
          effectiveOrigin,
          defaultCurrency,
          meta.productUrlSuffix,
          foundBySku
        );
        return {
          store_origin: effectiveOrigin,
          currency: mapped.currency,
          product: mapped.product
        };
      }
    }

    throw new Error(`Product '${handleOrUrl}' not found on ${effectiveOrigin} via Magento GraphQL`);
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
      if (!/^[A-Za-z0-9._/-]{1,128}$/.test(item.variantId) || item.variantId.includes("..")) {
        throw new Error(`Invalid Magento SKU or url_key: ${item.variantId}`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for item ${item.variantId}: must be integer 1..99`);
      }
    }

    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const warnings: string[] = [];

    const verifiedMap = new Map<
      string,
      { available: boolean; title: string; unitPrice: ProductVariant["price"]; url: string }
    >();

    // Strictly read-only verification via verifyHandles and/or batch SKU lookup (NEVER createEmptyCart mutation!)
    if (opts.verifyHandles && opts.verifyHandles.length > 0) {
      const uniqueHandles = Array.from(new Set(opts.verifyHandles)).slice(0, 10);
      await Promise.all(
        uniqueHandles.map(async (h) => {
          try {
            const detail = await this.getProduct(origin, h, {
              concurrencyKey: opts.concurrencyKey
            });
            for (const v of detail.product.variants) {
              const displayTitle =
                v.title && v.title !== "Default"
                  ? `${detail.product.title} — ${v.title}`
                  : detail.product.title;
              const info = {
                available: v.available,
                title: displayTitle,
                unitPrice: v.price,
                url: detail.product.url
              };
              verifiedMap.set(v.id, info);
              if (v.sku) verifiedMap.set(v.sku, info);
            }
            const firstVariant = detail.product.variants[0];
            if (firstVariant) {
              verifiedMap.set(detail.product.handle, {
                available: detail.product.available,
                title: detail.product.title,
                unitPrice: firstVariant.price,
                url: detail.product.url
              });
            }
          } catch (err) {
            warnings.push(
              `Could not verify Magento product '${h}': ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })
      );
    }

    const unverifiedSkus = items
      .map((i) => i.variantId)
      .filter((id) => !verifiedMap.has(id) && !id.includes("/"));
    if (unverifiedSkus.length > 0) {
      try {
        const res = await this.client.graphql<MagentoProductsResponse>(
          effectiveOrigin,
          PRODUCTS_BY_SKUS_QUERY,
          { skus: Array.from(new Set(unverifiedSkus)) },
          { concurrencyKey: opts.concurrencyKey }
        );
        for (const raw of res.data?.data?.products?.items ?? []) {
          const sku = sanitizeText(raw.sku, 80);
          const urlKey = sanitizeText(raw.url_key, 200);
          if (!sku || !urlKey) continue;
          const tier = parsePriceTier(raw.price_range?.minimum_price, meta.currency);
          const url = buildMagentoProductUrl(
            effectiveOrigin,
            urlKey,
            raw.url_suffix,
            meta.productUrlSuffix
          );
          verifiedMap.set(sku, {
            available: raw.stock_status !== "OUT_OF_STOCK",
            title: sanitizeText(raw.name, 200) || sku,
            unitPrice: tier.price,
            url
          });
        }
      } catch (err) {
        rethrowIfHardSsrfError(err);
      }
    }

    const resultItems: CartLinkItemResult[] = [];
    const productLinks: AdditionalCartLink[] = [];

    for (const item of items) {
      const found = verifiedMap.get(item.variantId);
      if (found) {
        if (!found.available) {
          warnings.push(`SKU ${item.variantId} (${found.title}) is currently out of stock.`);
        }
        resultItems.push({
          variant_id: item.variantId,
          quantity: item.quantity,
          verified: true,
          available: found.available,
          title: found.title,
          unit_price: found.unitPrice
        });
        productLinks.push({
          variant_id: item.variantId,
          quantity: item.quantity,
          title: found.title,
          cart_url: found.url
        });
      } else {
        const fallbackUrl = buildMagentoProductUrl(
          effectiveOrigin,
          item.variantId,
          meta.productUrlSuffix,
          meta.productUrlSuffix
        );
        resultItems.push({
          variant_id: item.variantId,
          quantity: item.quantity,
          verified: false
        });
        productLinks.push({
          variant_id: item.variantId,
          quantity: item.quantity,
          cart_url: fallbackUrl
        });
      }
    }

    warnings.push(
      "Magento 2 guest carts require stateful server-side session tokens. To stay strictly read-only without creating orphaned guest carts in the store database, ShopCart returns direct verified product page link(s)."
    );

    const additionalCartLinks = productLinks.length > 1 ? productLinks.slice(1) : undefined;

    return {
      store_origin: effectiveOrigin,
      cart_url: productLinks[0]!.cart_url,
      mode: opts.mode,
      items: resultItems,
      ...(additionalCartLinks ? { additional_cart_links: additionalCartLinks } : {}),
      warnings,
      next_step:
        "Present the verified direct Magento product page link(s) to the user so they can choose options, add the item(s) to their cart, and complete checkout in their browser."
    };
  }
}
