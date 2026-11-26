import {
  extractSafeHandleFromUrl,
  sanitizeGenericVariantId,
  sanitizeSafeHandle
} from "../../security/identifiers.js";
import { sanitizeSafeUrl } from "../../security/sanitize.js";
import {
  safeFetch,
  SsrfError,
  validateExternalUrl,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import {
  computeDiscount,
  formatMoney,
  moneyFromDecimalString,
  moneyFromMinorUnits,
  normalizeCurrency
} from "../shopify/normalize.js";
import type {
  CartLinkItemInput,
  GetProductResult,
  Money,
  ProductAvailability,
  ProductDetail,
  ProductSummary,
  ProductVariant,
  SearchProductsOptions
} from "../types.js";
import type { UcpFetcherFn } from "./discovery.js";
import {
  MAX_UCP_API_BYTES,
  UcpCatalogSearchResponseSchema,
  UcpCheckoutSessionResponseSchema,
  UcpProductLookupResponseSchema,
  type NormalizedUcpProfile,
  type RawUcpProduct
} from "./schema.js";
import {
  assertSameRegistrableStoreDomain,
  sanitizeUcpOptionalText,
  sanitizeUcpSessionId,
  sanitizeUcpText,
  validateUcpContinueUrl,
  validateUcpEndpointUrl
} from "./security.js";

const HARD_SSRF_CODES = new Set([
  "INVALID_URL",
  "BLOCKED_HOST",
  "BLOCKED_IP",
  "CONCURRENCY_LIMIT"
]);

const DEFAULT_API_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "ShopCart-MCP/1.0 (+https://shopcart.wals.pro)"
};

const READ_ONLY_MCP_SEARCH_TOOLS = new Set([
  "search_shop_catalog",
  "search_products",
  "catalog_search",
  "ucp_search_products"
]);

export interface UcpApiClientOptions {
  fetcher?: UcpFetcherFn;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface UcpCatalogSearchResult {
  supported: boolean;
  currency: string;
  products: ProductSummary[];
  notices: string[];
}

export type UcpCheckoutHandoffResult =
  | {
      ok: true;
      continueUrl: string;
      status: string;
      sessionId: string | null;
      warnings: string[];
    }
  | {
      ok: false;
      rejectedUnsafeContinueUrl?: boolean;
      reason: string;
    };

function rethrowIfHardSsrfError(err: unknown): void {
  if (err instanceof SsrfError && HARD_SSRF_CODES.has(err.code)) {
    throw err;
  }
}

function parseMoneyValue(
  raw: unknown,
  fallbackCurrency: string,
  treatNonPositiveAsNull = false
): Money | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" || typeof raw === "string") {
    return moneyFromDecimalString(raw, fallbackCurrency, treatNonPositiveAsNull);
  }
  if (typeof raw === "object") {
    const obj = raw as {
      amount?: number | string;
      value?: number | string;
      minor_units?: number;
      cents?: number;
      currency?: string;
      currency_code?: string;
    };
    const currency = normalizeCurrency(obj.currency ?? obj.currency_code, fallbackCurrency);
    if (typeof obj.minor_units === "number") {
      return moneyFromMinorUnits(obj.minor_units, currency, treatNonPositiveAsNull);
    }
    if (typeof obj.cents === "number") {
      return moneyFromMinorUnits(obj.cents, currency, treatNonPositiveAsNull);
    }
    const val = obj.amount ?? obj.value;
    if (val !== undefined) {
      return moneyFromDecimalString(val, currency, treatNonPositiveAsNull);
    }
  }
  return null;
}

function normalizeAvailability(raw: {
  available?: boolean;
  in_stock?: boolean;
  availability?: string;
}): { available: boolean; availability: ProductAvailability } {
  if (typeof raw.available === "boolean") {
    return {
      available: raw.available,
      availability: raw.available ? "InStock" : "OutOfStock"
    };
  }
  if (typeof raw.in_stock === "boolean") {
    return {
      available: raw.in_stock,
      availability: raw.in_stock ? "InStock" : "OutOfStock"
    };
  }
  const text = (raw.availability ?? "").toLowerCase();
  if (text.includes("instock") || text.includes("in_stock") || text === "available") {
    return { available: true, availability: "InStock" };
  }
  if (text.includes("preorder") || text.includes("pre_order")) {
    return { available: true, availability: "PreOrder" };
  }
  if (text.includes("limited")) {
    return { available: true, availability: "LimitedAvailability" };
  }
  if (text.includes("outofstock") || text.includes("out_of_stock") || text === "unavailable") {
    return { available: false, availability: "OutOfStock" };
  }
  return { available: true, availability: "Unknown" };
}

function sanitizeProductImageUrl(raw: unknown, storeOrigin: string): string | null {
  if (typeof raw !== "string") return null;
  return sanitizeSafeUrl(raw, storeOrigin, {
    allowStoreSubdomains: true,
    allowShopifyCdn: true,
    allowBigCommerceCdn: true
  });
}

function normalizeRawUcpProductSummary(
  item: RawUcpProduct,
  storeOrigin: string,
  fallbackCurrency: string
): ProductSummary | null {
  const id = sanitizeGenericVariantId(item.id);
  const title = sanitizeUcpText(item.title ?? item.name, 240);
  if (!id || !title) return null;

  const validatedUrl = item.url ? validateUcpContinueUrl(item.url, storeOrigin) : null;
  const handle =
    sanitizeSafeHandle(item.handle ?? item.slug) ??
    (validatedUrl ? extractSafeHandleFromUrl(validatedUrl, { stripFileExtension: true }) : null) ??
    sanitizeSafeHandle(id);
  if (!handle) return null;

  const url = validatedUrl ?? `${storeOrigin}/products/${encodeURIComponent(handle)}`;
  const currency = normalizeCurrency(item.currency, fallbackCurrency);

  const variantPrices: Money[] = [];
  for (const v of item.variants ?? []) {
    const vp = parseMoneyValue(v.price, normalizeCurrency(v.currency, currency));
    if (vp) variantPrices.push(vp);
  }

  const directPrice = parseMoneyValue(item.price, currency);
  const price = directPrice ?? variantPrices[0] ?? formatMoney(0, currency);
  const effectiveCurrency = price.currency;

  const minAmt =
    variantPrices.length > 0
      ? Math.min(...variantPrices.map((p) => p.amount))
      : price.amount;
  const maxAmt =
    variantPrices.length > 0
      ? Math.max(...variantPrices.map((p) => p.amount))
      : price.amount;

  const compareAt = parseMoneyValue(item.compare_at_price, effectiveCurrency, true);
  const { discount_percent, savings } = computeDiscount(price, compareAt);

  const avail = normalizeAvailability(item);
  const firstImage =
    sanitizeProductImageUrl(item.image_url, storeOrigin) ??
    (item.images ?? [])
      .map((img) => sanitizeProductImageUrl(typeof img === "string" ? img : img.url, storeOrigin))
      .find((u): u is string => Boolean(u)) ??
    null;

  return {
    id,
    handle,
    title,
    vendor: sanitizeUcpOptionalText(item.vendor ?? item.brand, 120),
    product_type: sanitizeUcpOptionalText(item.product_type ?? item.category, 120),
    available: avail.available,
    price,
    price_min: formatMoney(minAmt, effectiveCurrency),
    price_max: formatMoney(maxAmt, effectiveCurrency),
    compare_at_price: compareAt,
    discount_percent,
    savings,
    url,
    image_url: firstImage
  };
}

function normalizeRawUcpProductDetail(
  item: RawUcpProduct,
  storeOrigin: string,
  fallbackCurrency: string
): { currency: string; product: ProductDetail } | null {
  const summary = normalizeRawUcpProductSummary(item, storeOrigin, fallbackCurrency);
  if (!summary) return null;

  const currency = summary.price.currency;
  const images: string[] = [];
  const seenImages = new Set<string>();
  const addImage = (raw: unknown) => {
    if (images.length >= 10) return;
    const safe = sanitizeProductImageUrl(raw, storeOrigin);
    if (safe && !seenImages.has(safe)) {
      seenImages.add(safe);
      images.push(safe);
    }
  };
  addImage(item.image_url);
  for (const img of item.images ?? []) {
    addImage(typeof img === "string" ? img : img.url);
  }

  const variants: ProductVariant[] = [];
  for (const rawVar of item.variants ?? []) {
    const vid = sanitizeGenericVariantId(rawVar.id);
    if (!vid) continue;
    const vCurrency = normalizeCurrency(rawVar.currency, currency);
    const vPrice = parseMoneyValue(rawVar.price, vCurrency) ?? summary.price;
    const vCompare = parseMoneyValue(rawVar.compare_at_price, vPrice.currency, true);
    const { discount_percent, savings } = computeDiscount(vPrice, vCompare);
    const vAvail = normalizeAvailability(rawVar);
    const vUrl = rawVar.url ? validateUcpContinueUrl(rawVar.url, storeOrigin) : null;
    variants.push({
      id: vid,
      title: sanitizeUcpText(rawVar.title, 160) || "Default",
      sku: sanitizeUcpOptionalText(rawVar.sku, 80),
      gtin: sanitizeUcpOptionalText(rawVar.gtin, 32),
      ean: sanitizeUcpOptionalText(rawVar.ean, 32),
      mpn: sanitizeUcpOptionalText(rawVar.mpn, 80),
      available: vAvail.available,
      availability: vAvail.availability,
      price: vPrice,
      compare_at_price: vCompare,
      discount_percent,
      savings,
      option_values: (rawVar.option_values ?? [])
        .map((v) => sanitizeUcpText(v, 80))
        .filter(Boolean),
      url: vUrl ?? summary.url
    });
  }

  if (variants.length === 0) {
    const avail = normalizeAvailability(item);
    variants.push({
      id: summary.id,
      title: "Default",
      sku: sanitizeUcpOptionalText(item.sku, 80),
      gtin: sanitizeUcpOptionalText(item.gtin, 32),
      ean: sanitizeUcpOptionalText(item.ean, 32),
      mpn: sanitizeUcpOptionalText(item.mpn, 80),
      available: avail.available,
      availability: avail.availability,
      price: summary.price,
      compare_at_price: summary.compare_at_price,
      discount_percent: summary.discount_percent,
      savings: summary.savings,
      option_values: [],
      url: summary.url
    });
  }

  const avail = normalizeAvailability(item);
  const anyVariantAvailable = variants.some((v) => v.available);

  return {
    currency,
    product: {
      id: summary.id,
      handle: summary.handle,
      title: summary.title,
      vendor: summary.vendor,
      product_type: summary.product_type,
      description_text: sanitizeUcpText(item.description, 1500),
      sku: sanitizeUcpOptionalText(item.sku, 80),
      gtin: sanitizeUcpOptionalText(item.gtin, 32),
      ean: sanitizeUcpOptionalText(item.ean, 32),
      mpn: sanitizeUcpOptionalText(item.mpn, 80),
      available: variants.length > 0 ? anyVariantAvailable : avail.available,
      availability: avail.availability,
      price_min: summary.price_min,
      price_max: summary.price_max,
      metadata_source: "ucp",
      url: summary.url,
      options: [],
      images,
      variants
    }
  };
}

export class UcpApiClient {
  private readonly fetcher: UcpFetcherFn;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(opts: UcpApiClientOptions = {}) {
    this.fetcher = opts.fetcher ?? safeFetch;
    this.timeoutMs = opts.timeoutMs ?? 6000;
    this.maxBytes = Math.min(
      MAX_UCP_API_BYTES,
      Math.max(8192, opts.maxBytes ?? MAX_UCP_API_BYTES)
    );
  }

  private async fetchJsonSafe(
    url: string,
    storeOrigin: string,
    opts: {
      method: "GET" | "POST";
      body?: unknown;
      concurrencyKey?: string;
    }
  ): Promise<{ status: number; data: unknown } | null> {
    const validatedOrigin = validateExternalUrl(storeOrigin).origin;
    // Defense-in-depth: validate the exact target URL before every outbound fetch
    const safeUrl = validateUcpContinueUrl(url, validatedOrigin);
    if (!safeUrl) {
      throw new SsrfError(
        "BLOCKED_HOST",
        "Refused outbound UCP request to unvalidated or cross-site endpoint URL"
      );
    }

    let res: SafeFetchResponse;
    try {
      res = await this.fetcher(safeUrl, {
        method: opts.method,
        headers: {
          ...DEFAULT_API_HEADERS,
          ...(opts.method === "POST" ? { "Content-Type": "application/json" } : {})
        },
        body: opts.method === "POST" ? JSON.stringify(opts.body) : undefined,
        timeoutMs: this.timeoutMs,
        maxRedirects: opts.method === "POST" ? 0 : 2,
        maxBytes: this.maxBytes,
        truncateOnMaxBytes: false,
        concurrencyKey: opts.concurrencyKey,
        validateRedirectUrl: (nextUrl) =>
          assertSameRegistrableStoreDomain(validatedOrigin, nextUrl)
      });
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return null;
    }

    if (res.bodyText && Buffer.byteLength(res.bodyText, "utf8") > this.maxBytes) {
      return null;
    }

    if (res.url) {
      const finalParsed = validateExternalUrl(res.url);
      assertSameRegistrableStoreDomain(validatedOrigin, finalParsed);
    }

    let parsed: unknown = null;
    if (res.bodyText) {
      try {
        parsed = JSON.parse(res.bodyText);
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, data: parsed };
  }

  async searchCatalog(
    profile: NormalizedUcpProfile,
    opts: SearchProductsOptions
  ): Promise<UcpCatalogSearchResult> {
    const fallbackCurrency = normalizeCurrency(opts.currencyHint ?? profile.currency ?? "USD");
    const notices: string[] = [];

    // 1. Try UCP REST catalog search if advertised & endpoint validated
    if (profile.catalogSearchSupported && profile.endpoints.rest) {
      const restBase = validateUcpEndpointUrl(profile.endpoints.rest, profile.origin);
      if (restBase) {
        const searchParams = new URLSearchParams();
        if (opts.query?.trim()) searchParams.set("q", opts.query.trim());
        searchParams.set("limit", String(Math.min(50, Math.max(1, opts.limit * 2))));
        const searchUrl = `${restBase}/products?${searchParams.toString()}`;

        const res = await this.fetchJsonSafe(searchUrl, profile.origin, {
          method: "GET",
          concurrencyKey: opts.concurrencyKey
        });

        if (res && res.status === 200 && res.data !== null) {
          const parsed = UcpCatalogSearchResponseSchema.safeParse(res.data);
          if (parsed.success) {
            const rawItems =
              parsed.data.products ?? parsed.data.items ?? parsed.data.results ?? [];
            const currency = normalizeCurrency(parsed.data.currency, fallbackCurrency);
            const products = this.filterAndSortProducts(
              rawItems
                .map((item) => normalizeRawUcpProductSummary(item, profile.origin, currency))
                .filter((p): p is ProductSummary => p !== null),
              opts
            );
            return { supported: true, currency, products, notices };
          }
        }
      }
    }

    // 2. Try read-only UCP MCP catalog search tool if advertised & endpoint validated
    if (profile.catalogSearchSupported && profile.endpoints.mcp) {
      const mcpEndpoint = validateUcpEndpointUrl(profile.endpoints.mcp, profile.origin);
      if (mcpEndpoint) {
        const mcpRes = await this.searchViaMcp(mcpEndpoint, profile.origin, fallbackCurrency, opts);
        if (mcpRes) {
          return mcpRes;
        }
      }
    }

    return { supported: false, currency: fallbackCurrency, products: [], notices };
  }

  private async searchViaMcp(
    mcpEndpoint: string,
    storeOrigin: string,
    fallbackCurrency: string,
    opts: SearchProductsOptions
  ): Promise<UcpCatalogSearchResult | null> {
    const listRes = await this.fetchJsonSafe(mcpEndpoint, storeOrigin, {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      concurrencyKey: opts.concurrencyKey
    });
    if (!listRes || listRes.status !== 200 || !listRes.data || typeof listRes.data !== "object") {
      return null;
    }

    const toolsRaw = (listRes.data as { result?: { tools?: Array<{ name?: unknown }> } }).result
      ?.tools;
    if (!Array.isArray(toolsRaw)) return null;

    const searchToolName = toolsRaw
      .map((t) => (typeof t?.name === "string" ? t.name.trim() : ""))
      .find((name) => READ_ONLY_MCP_SEARCH_TOOLS.has(name));
    if (!searchToolName) return null;

    const callRes = await this.fetchJsonSafe(mcpEndpoint, storeOrigin, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: searchToolName,
          arguments: {
            query: opts.query?.trim() ?? "",
            limit: Math.min(20, Math.max(1, opts.limit))
          }
        }
      },
      concurrencyKey: opts.concurrencyKey
    });
    if (!callRes || callRes.status !== 200 || !callRes.data || typeof callRes.data !== "object") {
      return null;
    }

    const resultObj = (callRes.data as {
      result?: {
        structuredContent?: unknown;
        content?: Array<{ type?: string; text?: string }>;
      };
    }).result;

    let candidatePayload: unknown = resultObj?.structuredContent ?? null;
    if (!candidatePayload && Array.isArray(resultObj?.content)) {
      const firstText = resultObj.content.find((c) => c.type === "text" && typeof c.text === "string");
      if (firstText?.text) {
        try {
          candidatePayload = JSON.parse(firstText.text);
        } catch {
          candidatePayload = null;
        }
      }
    }

    if (!candidatePayload) return null;
    const parsed = UcpCatalogSearchResponseSchema.safeParse(candidatePayload);
    if (!parsed.success) return null;

    const rawItems = parsed.data.products ?? parsed.data.items ?? parsed.data.results ?? [];
    const currency = normalizeCurrency(parsed.data.currency, fallbackCurrency);
    const products = this.filterAndSortProducts(
      rawItems
        .map((item) => normalizeRawUcpProductSummary(item, storeOrigin, currency))
        .filter((p): p is ProductSummary => p !== null),
      opts
    );
    return { supported: true, currency, products, notices: [] };
  }

  private filterAndSortProducts(
    products: ProductSummary[],
    opts: SearchProductsOptions
  ): ProductSummary[] {
    let filtered = products;
    if (opts.availableOnly) {
      filtered = filtered.filter((p) => p.available);
    }
    if (typeof opts.minPrice === "number") {
      filtered = filtered.filter((p) => p.price.amount >= opts.minPrice!);
    }
    if (typeof opts.maxPrice === "number") {
      filtered = filtered.filter((p) => p.price.amount <= opts.maxPrice!);
    }

    if (opts.sortBy === "price_asc") {
      filtered = [...filtered].sort((a, b) => a.price.amount - b.price.amount);
    } else if (opts.sortBy === "price_desc") {
      filtered = [...filtered].sort((a, b) => b.price.amount - a.price.amount);
    } else if (opts.sortBy === "discount_desc") {
      filtered = [...filtered].sort(
        (a, b) => (b.discount_percent ?? 0) - (a.discount_percent ?? 0)
      );
    }

    return filtered.slice(0, Math.min(20, Math.max(1, opts.limit)));
  }

  async getProductById(
    profile: NormalizedUcpProfile,
    handleOrId: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult | null> {
    if (!profile.catalogSearchSupported || !profile.endpoints.rest) return null;
    const restBase = validateUcpEndpointUrl(profile.endpoints.rest, profile.origin);
    if (!restBase) return null;

    const safeId = sanitizeSafeHandle(handleOrId) ?? sanitizeGenericVariantId(handleOrId);
    if (!safeId) return null;

    const res = await this.fetchJsonSafe(
      `${restBase}/products/${encodeURIComponent(safeId)}`,
      profile.origin,
      {
        method: "GET",
        concurrencyKey: opts.concurrencyKey
      }
    );
    if (!res || res.status !== 200 || !res.data) return null;

    const parsed = UcpProductLookupResponseSchema.safeParse(res.data);
    if (!parsed.success) return null;

    const rawProduct = "product" in parsed.data ? parsed.data.product : parsed.data;
    const rawCurrency =
      "product" in parsed.data ? parsed.data.currency : parsed.data.currency;
    const fallbackCurrency = normalizeCurrency(
      rawCurrency ?? opts.currencyHint ?? profile.currency ?? "USD"
    );

    const normalized = normalizeRawUcpProductDetail(rawProduct, profile.origin, fallbackCurrency);
    if (!normalized) return null;

    return {
      store_origin: profile.origin,
      currency: normalized.currency,
      product: normalized.product
    };
  }

  /**
   * Zero-Liability Checkout-Handoff (`POST /checkout-sessions`).
   *
   * SECURITY & COMPLIANCE INVARIANT (0% MoR Liability):
   * - Sends ONLY line_items (variant_id + quantity), optional currency, and optional discount code.
   * - NEVER collects, accepts, transmits, or stores buyer PII (name, email, address, phone)
   *   or payment credentials/tokens.
   * - NEVER completes/captures an order — always escalates via a strictly validated HTTPS
   *   `continue_url` on the merchant's registrable domain so the merchant remains Merchant of Record.
   */
  async createCheckoutHandoff(
    profile: NormalizedUcpProfile,
    params: {
      items: CartLinkItemInput[];
      currency?: string;
      discountCode?: string;
      concurrencyKey?: string;
    }
  ): Promise<UcpCheckoutHandoffResult> {
    if (!profile.checkoutHandoffSupported || !profile.endpoints.rest) {
      return {
        ok: false,
        reason: "Store UCP manifest does not advertise a validated REST checkout handoff endpoint."
      };
    }

    const restBase = validateUcpEndpointUrl(profile.endpoints.rest, profile.origin);
    if (!restBase) {
      return {
        ok: false,
        reason: "UCP REST checkout endpoint failed security validation."
      };
    }

    // Strict allowlist payload: ZERO PII, ZERO payment details
    const requestPayload: {
      line_items: Array<{ item: { id: string }; quantity: number }>;
      currency?: string;
      discounts?: { codes: string[] };
    } = {
      line_items: params.items.map((item) => ({
        item: { id: item.variantId },
        quantity: item.quantity
      })),
      ...(params.currency ? { currency: normalizeCurrency(params.currency) } : {}),
      ...(params.discountCode ? { discounts: { codes: [params.discountCode] } } : {})
    };

    const res = await this.fetchJsonSafe(`${restBase}/checkout-sessions`, profile.origin, {
      method: "POST",
      body: requestPayload,
      concurrencyKey: params.concurrencyKey
    });

    if (!res) {
      return {
        ok: false,
        reason: "UCP checkout-sessions endpoint did not respond or returned an invalid payload."
      };
    }

    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        reason: `UCP checkout-sessions endpoint returned HTTP ${res.status}.`
      };
    }

    const parsed = UcpCheckoutSessionResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "UCP checkout-sessions response did not match the expected UCP schema."
      };
    }

    const session = parsed.data;
    const linkCandidate = session.links?.find((l) => {
      const rel = (l.rel ?? l.type ?? "").toLowerCase();
      return (
        rel === "continue" ||
        rel === "continue_url" ||
        rel === "checkout" ||
        rel === "escalation"
      );
    });
    const rawContinueUrl =
      session.continue_url ??
      session.escalation_url ??
      session.checkout_url ??
      session.url ??
      linkCandidate?.href ??
      linkCandidate?.url;

    if (!rawContinueUrl) {
      return {
        ok: false,
        reason: "UCP checkout session response did not include a merchant continue_url for handoff."
      };
    }

    // CRITICAL: Validate continue_url against scheme, credentials, IP/metadata, and registrable domain
    const safeContinueUrl = validateUcpContinueUrl(rawContinueUrl, profile.origin);
    if (!safeContinueUrl) {
      return {
        ok: false,
        rejectedUnsafeContinueUrl: true,
        reason:
          "Blocked unsafe or cross-site continue_url returned by the store's UCP checkout endpoint."
      };
    }

    const rawStatus = sanitizeUcpOptionalText(session.status, 64)?.toLowerCase() ?? "requires_escalation";
    const status = /^[a-z0-9_-]{1,64}$/.test(rawStatus) ? rawStatus : "requires_escalation";
    const sessionId = sanitizeUcpSessionId(session.id);

    const warnings: string[] = [];
    for (const msg of session.messages ?? []) {
      const text = sanitizeUcpOptionalText(msg.content ?? msg.message, 240);
      if (text) {
        warnings.push(`Merchant checkout notice: ${text}`);
      }
    }

    return {
      ok: true,
      continueUrl: safeContinueUrl,
      status,
      sessionId,
      warnings
    };
  }
}
