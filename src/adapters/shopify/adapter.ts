import {
  sanitizeOptionalText,
  sanitizeSafeUrl,
  sanitizeText,
  stripHiddenStyleBlocksLinear,
  stripHtmlCommentsLinear,
  stripHtmlToText,
  stripTagBlocksLinear
} from "../../security/sanitize.js";
import { SsrfError } from "../../security/ssrf.js";
import type {
  CartLinkItemInput,
  CartLinkItemResult,
  CartLinkResult,
  CollectionSummary,
  GetProductResult,
  ListCollectionsOptions,
  ListCollectionsResult,
  ProductDetail,
  ProductSortBy,
  ProductSummary,
  ProductVariant,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreInfo,
  StorePoliciesOptions,
  StorePoliciesResult
} from "../types.js";
import { ShopifyClient } from "./client.js";
import {
  classifyDealCollection,
  computeDiscount,
  extractCollectionHandle,
  extractPolicyHints,
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

interface CollectionsJsonRaw {
  collections?: Array<{
    id?: number | string;
    handle?: string;
    title?: string;
    products_count?: number;
  }>;
}

interface PolicyJsonRaw {
  policy?: {
    body?: string | null;
    title?: string | null;
    url?: string | null;
  };
}

interface McpToolCallResponseRaw {
  result?: {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
}

const POLICY_EXCERPT_MAX_CHARS = 2000;

const DEAL_TAG_PRIORITY: Record<string, number> = {
  "black-friday": 0,
  sale: 1,
  adventskalender: 2,
  bundle: 3,
  bestseller: 4
};

const POLICY_CHROME_TAGS = [
  "head",
  "header",
  "nav",
  "footer",
  "aside",
  "template",
  "script",
  "style",
  "iframe",
  "noscript",
  "svg",
  "object",
  "embed"
] as const;

const POLICY_HTML_SCAN_MAX_CHARS = 131_072;

function extractPolicyHtmlToCleanText(html: string, maxLen = POLICY_EXCERPT_MAX_CHARS): string {
  if (!html) return "";
  const raw = String(html);
  const lowerRaw = raw.toLowerCase();

  // Locate <main> or Shopify's standard policy container in O(N) using indexOf before slicing
  let slice = raw;
  const mainStart = lowerRaw.indexOf("<main");
  if (mainStart !== -1) {
    const mainTagEnd = lowerRaw.indexOf(">", mainStart + 5);
    const mainClose = mainTagEnd !== -1 ? lowerRaw.indexOf("</main>", mainTagEnd + 1) : -1;
    if (mainTagEnd !== -1 && mainClose !== -1) {
      slice = raw.slice(mainTagEnd + 1, mainClose);
    } else if (mainTagEnd !== -1) {
      slice = raw.slice(mainTagEnd + 1);
    }
  } else {
    const policyMarker =
      lowerRaw.indexOf("shopify-policy__body") !== -1
        ? lowerRaw.indexOf("shopify-policy__body")
        : lowerRaw.indexOf("shopify-policy__container");
    if (policyMarker !== -1) {
      const openTagStart = raw.lastIndexOf("<", policyMarker);
      if (openTagStart !== -1) {
        slice = raw.slice(openTagStart);
      }
    }
  }

  if (slice.length > POLICY_HTML_SCAN_MAX_CHARS) {
    slice = slice.slice(0, POLICY_HTML_SCAN_MAX_CHARS);
  }

  // Strip comments, document chrome, scripts/styles, and inline-hidden blocks in strictly linear O(N) time
  const noComments = stripHtmlCommentsLinear(slice);
  const noChrome = stripTagBlocksLinear(noComments, POLICY_CHROME_TAGS);
  const noHidden = stripHiddenStyleBlocksLinear(noChrome);

  return stripHtmlToText(noHidden, maxLen);
}

function parseMcpPolicyPayload(rawText: string): {
  answer: string | null;
  shippingBody: string | null;
  refundBody: string | null;
} {
  const trimmed = rawText.trim();
  if (!trimmed || trimmed === "[]" || trimmed === "{}") {
    return { answer: null, shippingBody: null, refundBody: null };
  }

  let shippingBody: string | null = null;
  let refundBody: string | null = null;
  const parts: string[] = [];

  const collectRecord = (item: unknown): void => {
    if (!item) return;
    if (typeof item === "string") {
      const clean = stripHtmlToText(stripHiddenStyleBlocksLinear(item), POLICY_EXCERPT_MAX_CHARS);
      if (clean) parts.push(clean);
      return;
    }
    if (Array.isArray(item)) {
      for (const el of item) collectRecord(el);
      return;
    }
    if (typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const q = typeof obj.question === "string" ? sanitizeText(obj.question, 240) : null;
      const a = typeof obj.answer === "string" ? stripHtmlToText(stripHiddenStyleBlocksLinear(obj.answer), 1200) : null;
      if (q && a) {
        parts.push(`Q: ${q}\nA: ${a}`);
      } else if (a) {
        parts.push(a);
      }

      const rawType = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
      const rawTitle = typeof obj.title === "string" ? sanitizeText(obj.title, 160) : null;
      const rawBody =
        typeof obj.body === "string"
          ? obj.body
          : typeof obj.content === "string"
            ? obj.content
            : typeof obj.text === "string"
              ? obj.text
              : null;

      if (rawBody) {
        const cleanBody = stripHtmlToText(stripHiddenStyleBlocksLinear(rawBody), POLICY_EXCERPT_MAX_CHARS);
        if (cleanBody) {
          if (rawType.includes("ship")) {
            shippingBody = shippingBody ?? cleanBody;
          } else if (rawType.includes("refund") || rawType.includes("return")) {
            refundBody = refundBody ?? cleanBody;
          }
          parts.push(rawTitle ? `${rawTitle}: ${cleanBody}` : cleanBody);
        }
      }

      if (Array.isArray(obj.faqs)) collectRecord(obj.faqs);
      if (Array.isArray(obj.policies)) collectRecord(obj.policies);
      if (Array.isArray(obj.results)) collectRecord(obj.results);
      if (Array.isArray(obj.items)) collectRecord(obj.items);
    }
  };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      collectRecord(parsed);
    } catch {
      const fallback = stripHtmlToText(trimmed, POLICY_EXCERPT_MAX_CHARS);
      if (fallback) parts.push(fallback);
    }
  } else {
    const plain = stripHtmlToText(trimmed, POLICY_EXCERPT_MAX_CHARS);
    if (plain) parts.push(plain);
  }

  const joined = parts.join("\n\n").trim();
  const answer = joined ? stripHtmlToText(joined, POLICY_EXCERPT_MAX_CHARS) : null;
  return { answer, shippingBody, refundBody };
}

function sortProducts(products: ProductSummary[], sortBy: ProductSortBy | undefined): ProductSummary[] {
  if (!sortBy || sortBy === "relevance") {
    return products;
  }
  const indexed = products.map((item, idx) => ({ item, idx }));
  indexed.sort((a, b) => {
    if (sortBy === "price_asc") {
      return a.item.price.amount - b.item.price.amount || a.idx - b.idx;
    }
    if (sortBy === "price_desc") {
      return b.item.price.amount - a.item.price.amount || a.idx - b.idx;
    }
    if (sortBy === "discount_desc") {
      const pctDiff = (b.item.discount_percent ?? 0) - (a.item.discount_percent ?? 0);
      if (pctDiff !== 0) return pctDiff;
      const savingsDiff = (b.item.savings?.amount ?? 0) - (a.item.savings?.amount ?? 0);
      if (savingsDiff !== 0) return savingsDiff;
      return a.idx - b.idx;
    }
    return a.idx - b.idx;
  });
  return indexed.map((entry) => entry.item);
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
    this.client.setStorefrontMcpTools(origin, mcpProbe.tools);

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

  async listCollections(
    origin: string,
    opts: ListCollectionsOptions = {}
  ): Promise<ListCollectionsResult> {
    const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 30)));
    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const notices: string[] = [];

    let res: { status: number; data: CollectionsJsonRaw | null; rawText: string; url: string };
    try {
      res = await this.client.getJson<CollectionsJsonRaw>(
        `${effectiveOrigin}/collections.json?limit=${limit}`,
        { concurrencyKey: opts.concurrencyKey }
      );
    } catch (err) {
      rethrowIfHardSsrfError(err);
      notices.push(
        "Could not fetch /collections.json (timeout or oversized response). Use search_products with a keyword query instead."
      );
      return {
        store_origin: effectiveOrigin,
        waf_restricted: meta.wafRestricted,
        total_collections: 0,
        highlighted_deals: [],
        collections: [],
        notices
      };
    }

    if (res.status === 403 || res.status === 401) {
      this.client.markProductCatalogBlocked(origin);
      notices.push(
        "Store WAF blocked /collections.json (HTTP 403/401). Use search_products with a keyword query (e.g. 'sale', 'black friday', or product name) instead."
      );
      return {
        store_origin: effectiveOrigin,
        waf_restricted: true,
        total_collections: 0,
        highlighted_deals: [],
        collections: [],
        notices
      };
    }

    if (res.status !== 200 || !Array.isArray(res.data?.collections)) {
      notices.push(
        `Store did not expose public /collections.json (HTTP ${res.status}). Use search_products with a keyword query instead.`
      );
      return {
        store_origin: effectiveOrigin,
        waf_restricted: meta.wafRestricted,
        total_collections: 0,
        highlighted_deals: [],
        collections: [],
        notices
      };
    }

    const mapped: CollectionSummary[] = [];
    for (const raw of res.data.collections.slice(0, limit)) {
      const handle = sanitizeText(raw.handle, 200);
      const title = sanitizeText(raw.title, 200);
      if (!handle || !title) continue;
      const productsCount =
        typeof raw.products_count === "number" && Number.isFinite(raw.products_count)
          ? raw.products_count
          : null;
      const { isDeal, tags } = classifyDealCollection(handle, title);
      mapped.push({
        id: sanitizeText(raw.id != null ? String(raw.id) : handle, 64) || handle,
        handle,
        title,
        products_count: productsCount,
        url: `${effectiveOrigin}/collections/${encodeURIComponent(handle)}`,
        is_deal_collection: isDeal,
        deal_tags: tags
      });
    }

    const highlightedDeals = mapped
      .filter((c) => c.is_deal_collection)
      .sort((a, b) => {
        const aPrio = Math.min(...a.deal_tags.map((t) => DEAL_TAG_PRIORITY[t] ?? 99));
        const bPrio = Math.min(...b.deal_tags.map((t) => DEAL_TAG_PRIORITY[t] ?? 99));
        if (aPrio !== bPrio) return aPrio - bPrio;
        return (b.products_count ?? 0) - (a.products_count ?? 0);
      });

    if (opts.dealsOnly && highlightedDeals.length === 0) {
      notices.push(
        "No obvious Sale, Black Friday, Bestseller, or Advent calendar collection names were found in the first page of /collections.json."
      );
    }

    return {
      store_origin: effectiveOrigin,
      waf_restricted: meta.wafRestricted,
      total_collections: mapped.length,
      highlighted_deals: highlightedDeals,
      collections: opts.dealsOnly ? highlightedDeals : mapped,
      notices
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
    const currency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    const notices: string[] = [];

    const query = opts.query?.trim() ?? "";
    const collectionHandle = opts.collection ? extractCollectionHandle(opts.collection) : undefined;
    const sortBy = opts.sortBy;
    let items: ProductSummary[] = [];
    let collectionBlockedFallback = false;

    if (collectionHandle) {
      const fetchLimit = Math.min(100, Math.max(limit * 3, 50));
      const colRes = await this.fetchProductsJsonEndpoint(
        `${effectiveOrigin}/collections/${encodeURIComponent(collectionHandle)}/products.json?limit=${fetchLimit}`,
        effectiveOrigin,
        currency,
        opts.concurrencyKey
      );
      if (colRes.blocked) {
        this.client.markProductCatalogBlocked(origin);
        if (query) {
          collectionBlockedFallback = true;
          notices.push(
            `Store WAF blocked /collections/${collectionHandle}/products.json; fell back to keyword search.`
          );
        } else {
          throw new Error(
            `This store blocks /collections/${collectionHandle}/products.json via WAF. Provide a non-empty 'query' parameter to use /search/suggest.json instead.`
          );
        }
      } else if (colRes.status === 404) {
        notices.push(
          `Collection '${collectionHandle}' was not found on ${effectiveOrigin} (HTTP 404). Call list_collections to see available collection handles.`
        );
      } else if (colRes.transportError) {
        if (query) {
          collectionBlockedFallback = true;
          notices.push(
            `Collection '${collectionHandle}' endpoint returned an oversized or invalid response; fell back to keyword search.`
          );
        } else {
          throw new Error(
            `Collection '${collectionHandle}' endpoint did not return a valid catalog response. Provide a non-empty 'query' parameter instead.`
          );
        }
      } else {
        items = colRes.products;
        if (query) {
          items = items.filter((p) => {
            const haystack = `${p.title} ${p.handle} ${p.vendor ?? ""} ${p.product_type ?? ""}`;
            return matchesSearchQuery(haystack, query);
          });
        }
      }
    }

    if ((!collectionHandle || collectionBlockedFallback) && query) {
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
    } else if (!collectionHandle) {
      // Browse mode without query: /products.json
      const browseLimit =
        sortBy && sortBy !== "relevance"
          ? Math.min(100, Math.max(limit * 3, 50))
          : Math.min(50, limit * 2);
      const browse = await this.fetchProductsJsonCatalog(
        effectiveOrigin,
        currency,
        browseLimit,
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

    const sorted = sortProducts(filtered, sortBy);
    const sliced = sorted.slice(0, limit);
    if (sliced.length > 0 && sliced.every((p) => !p.available)) {
      notices.push("Note: All matching products are currently marked sold out.");
    }
    if (sortBy === "discount_desc" && sliced.length > 0 && sliced.every((p) => !p.discount_percent)) {
      notices.push("No returned products currently have a compare_at_price discount.");
    }

    return {
      store_origin: effectiveOrigin,
      currency,
      ...(collectionHandle ? { collection: collectionHandle } : {}),
      ...(sortBy ? { sort_by: sortBy } : {}),
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
    const { discount_percent, savings } = computeDiscount(price, compareAt);

    const url =
      sanitizeSafeUrl(raw.url, origin, { stripTracking: true }) ??
      `${origin}/products/${encodeURIComponent(handle)}`;
    const imageRaw = raw.image ?? raw.featured_image?.url ?? null;
    const imageUrl = sanitizeSafeUrl(imageRaw, origin, { allowShopifyCdn: true });

    return {
      id: sanitizeText(raw.id != null ? String(raw.id) : handle, 64) || handle,
      handle,
      title,
      vendor: sanitizeOptionalText(raw.vendor, 100),
      product_type: sanitizeOptionalText(raw.type, 100),
      available: raw.available !== false,
      price,
      price_min: priceMin,
      price_max: priceMax,
      compare_at_price: compareAt,
      discount_percent,
      savings,
      url,
      image_url: imageUrl
    };
  }

  private async fetchProductsJsonCatalog(
    origin: string,
    currency: string,
    limit: number,
    concurrencyKey?: string
  ): Promise<{ products: ProductSummary[]; blocked: boolean; transportError: boolean; status: number }> {
    return this.fetchProductsJsonEndpoint(
      `${origin}/products.json?limit=${Math.min(250, Math.max(1, limit))}`,
      origin,
      currency,
      concurrencyKey
    );
  }

  private async fetchProductsJsonEndpoint(
    url: string,
    origin: string,
    currency: string,
    concurrencyKey?: string
  ): Promise<{ products: ProductSummary[]; blocked: boolean; transportError: boolean; status: number }> {
    let res: { status: number; data: ProductsJsonRaw | null; rawText: string; url: string };
    try {
      res = await this.client.getJson<ProductsJsonRaw>(url, { concurrencyKey });
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return { products: [], blocked: false, transportError: true, status: 0 };
    }
    if (res.status === 403 || res.status === 401) {
      return { products: [], blocked: true, transportError: false, status: res.status };
    }
    if (res.status !== 200 || !Array.isArray(res.data?.products)) {
      return { products: [], blocked: false, transportError: false, status: res.status };
    }

    const products: ProductSummary[] = [];
    for (const raw of res.data.products) {
      const handle = sanitizeText(raw.handle, 200);
      const title = sanitizeText(raw.title, 200);
      if (!handle || !title) continue;

      const variants = raw.variants ?? [];
      const pricedVariants = variants
        .map((v) => {
          const vPrice = moneyFromDecimalString(v.price, currency);
          const vCompare = moneyFromDecimalString(v.compare_at_price, currency, true);
          return {
            available: v.available !== false,
            price: vPrice,
            compareAt: vCompare,
            discount: vPrice ? computeDiscount(vPrice, vCompare) : { discount_percent: null, savings: null }
          };
        })
        .filter((v): v is {
          available: boolean;
          price: NonNullable<typeof v.price>;
          compareAt: typeof v.compareAt;
          discount: ReturnType<typeof computeDiscount>;
        } => v.price !== null);

      const minMoney =
        pricedVariants.length > 0
          ? pricedVariants.reduce((a, b) => (b.price.amount < a.price.amount ? b : a)).price
          : formatMoney(0, currency);
      const maxMoney =
        pricedVariants.length > 0
          ? pricedVariants.reduce((a, b) => (b.price.amount > a.price.amount ? b : a)).price
          : minMoney;

      // Prefer an available variant with a genuine compare_at_price > price discount
      const preferredPool = pricedVariants.some((v) => v.available)
        ? pricedVariants.filter((v) => v.available)
        : pricedVariants;
      const bestDiscounted = preferredPool
        .filter((v) => v.discount.discount_percent !== null)
        .sort(
          (a, b) =>
            (b.discount.discount_percent ?? 0) - (a.discount.discount_percent ?? 0) ||
            (b.discount.savings?.amount ?? 0) - (a.discount.savings?.amount ?? 0)
        )[0];

      const firstCompare =
        bestDiscounted?.compareAt ??
        pricedVariants.find((v) => v.compareAt !== null)?.compareAt ??
        null;
      const discount_percent = bestDiscounted?.discount.discount_percent ?? null;
      const savings = bestDiscounted?.discount.savings ?? null;
      const available = variants.length > 0 ? variants.some((v) => v.available !== false) : true;

      products.push({
        id: sanitizeText(raw.id != null ? String(raw.id) : handle, 64) || handle,
        handle,
        title,
        vendor: sanitizeOptionalText(raw.vendor, 100),
        product_type: sanitizeOptionalText(raw.product_type, 100),
        available,
        price: minMoney,
        price_min: minMoney,
        price_max: maxMoney,
        compare_at_price: firstCompare,
        discount_percent,
        savings,
        url: `${origin}/products/${encodeURIComponent(handle)}`,
        image_url: sanitizeSafeUrl(raw.images?.[0]?.src, origin, { allowShopifyCdn: true })
      });
    }

    return { products, blocked: false, transportError: false, status: res.status };
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
      const price = moneyFromMinorUnits(v.price, currency) ?? formatMoney(0, currency);
      const compareAt = moneyFromMinorUnits(v.compare_at_price, currency, true);
      const { discount_percent, savings } = computeDiscount(price, compareAt);

      return {
        id: sanitizeText(v.id != null ? String(v.id) : "", 64),
        title: sanitizeText(v.title, 120) || "Default",
        sku: sanitizeOptionalText(v.sku, 80),
        available: v.available !== false,
        price,
        compare_at_price: compareAt,
        discount_percent,
        savings,
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
      id: sanitizeText(raw.id != null ? String(raw.id) : handle, 64) || handle,
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
      const price = moneyFromDecimalString(v.price, currency) ?? formatMoney(0, currency);
      const compareAt = moneyFromDecimalString(v.compare_at_price, currency, true);
      const { discount_percent, savings } = computeDiscount(price, compareAt);
      return {
        id: sanitizeText(v.id != null ? String(v.id) : "", 64),
        title: sanitizeText(v.title, 120) || "Default",
        sku: sanitizeOptionalText(v.sku, 80),
        available: v.available !== false,
        price,
        compare_at_price: compareAt,
        discount_percent,
        savings,
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
      id: sanitizeText(raw.id != null ? String(raw.id) : handle, 64) || handle,
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

  private async fetchSinglePublicPolicy(
    origin: string,
    slug: "shipping-policy" | "refund-policy",
    concurrencyKey?: string
  ): Promise<{ excerpt: string | null; blocked: boolean; notFound: boolean; url: string }> {
    const defaultUrl = `${origin}/policies/${slug}`;

    // 1. Prefer Shopify's lightweight JSON policy endpoint (/policies/<slug>.json)
    try {
      const jsonRes = await this.client.getJson<PolicyJsonRaw>(
        `${origin}/policies/${slug}.json`,
        { timeoutMs: 4000, concurrencyKey }
      );
      if (jsonRes.status === 200 && typeof jsonRes.data?.policy?.body === "string") {
        const excerpt = extractPolicyHtmlToCleanText(jsonRes.data.policy.body, POLICY_EXCERPT_MAX_CHARS);
        if (excerpt) {
          const policyUrl =
            sanitizeSafeUrl(jsonRes.data.policy.url, origin, { stripTracking: true }) ?? defaultUrl;
          return { excerpt, blocked: false, notFound: false, url: policyUrl };
        }
      }
      if (jsonRes.status === 403 || jsonRes.status === 401) {
        // Still try HTML fallback in case WAF only blocks .json endpoints
      }
    } catch (err) {
      rethrowIfHardSsrfError(err);
    }

    // 2. Fallback: public HTML page (/policies/<slug>)
    try {
      const htmlRes = await this.client.getText(defaultUrl, {
        timeoutMs: 5000,
        maxBytes: 1_048_576,
        concurrencyKey
      });
      if (htmlRes.status === 200 && htmlRes.text) {
        const excerpt = extractPolicyHtmlToCleanText(htmlRes.text, POLICY_EXCERPT_MAX_CHARS);
        const finalUrl =
          sanitizeSafeUrl(htmlRes.url, origin, { stripTracking: true }) ?? defaultUrl;
        return {
          excerpt: excerpt || null,
          blocked: false,
          notFound: !excerpt,
          url: finalUrl
        };
      }
      if (htmlRes.status === 403 || htmlRes.status === 401) {
        return { excerpt: null, blocked: true, notFound: false, url: defaultUrl };
      }
      if (htmlRes.status === 404) {
        return { excerpt: null, blocked: false, notFound: true, url: defaultUrl };
      }
      return { excerpt: null, blocked: false, notFound: false, url: defaultUrl };
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return { excerpt: null, blocked: false, notFound: false, url: defaultUrl };
    }
  }

  private async queryStorefrontMcpPolicies(
    origin: string,
    cachedTools: string[] | null,
    topic: "shipping" | "returns" | "all",
    question?: string,
    concurrencyKey?: string
  ): Promise<{ answer: string | null; shippingBody: string | null; refundBody: string | null }> {
    let tools = cachedTools;
    if (tools === null) {
      const probe = await this.probeStorefrontMcp(origin, concurrencyKey);
      tools = probe.tools;
      this.client.setStorefrontMcpTools(origin, tools);
    }

    if (!tools.includes("search_shop_policies_and_faqs")) {
      return { answer: null, shippingBody: null, refundBody: null };
    }

    const queryText =
      sanitizeOptionalText(question, 240) ??
      (topic === "shipping"
        ? "What are your shipping costs, free shipping threshold, and delivery times?"
        : topic === "returns"
          ? "What is your return and refund policy and return window?"
          : "What are your shipping costs, delivery times, and return policy?");

    const policyTypes =
      topic === "shipping"
        ? ["shipping"]
        : topic === "returns"
          ? ["refund"]
          : ["shipping", "refund"];

    const invoke = async (args: Record<string, unknown>) =>
      this.client.postJson<McpToolCallResponseRaw>(
        `${origin}/api/mcp`,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "search_shop_policies_and_faqs",
            arguments: args
          }
        },
        { timeoutMs: 4000, concurrencyKey }
      );

    try {
      let res = await invoke({ query: queryText, policy_types: policyTypes });
      // Graceful retry without policy_types if store uses an older MCP schema
      if (res.status === 200 && res.data?.result?.isError) {
        res = await invoke({ query: queryText });
      }
      if (res.status !== 200 || !res.data?.result || res.data.result.isError) {
        return { answer: null, shippingBody: null, refundBody: null };
      }
      const combinedText = (res.data.result.content ?? [])
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join("\n\n");
      return parseMcpPolicyPayload(combinedText);
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return { answer: null, shippingBody: null, refundBody: null };
    }
  }

  async getStorePolicies(
    origin: string,
    opts: StorePoliciesOptions = {}
  ): Promise<StorePoliciesResult> {
    const topic = opts.topic ?? "all";
    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const notices: string[] = [];

    const wantShipping = topic === "shipping" || topic === "all";
    const wantReturns = topic === "returns" || topic === "all";

    const [mcpResult, shippingResult, returnsResult] = await Promise.all([
      this.queryStorefrontMcpPolicies(
        effectiveOrigin,
        meta.storefrontMcpTools,
        topic,
        opts.question,
        opts.concurrencyKey
      ),
      wantShipping
        ? this.fetchSinglePublicPolicy(effectiveOrigin, "shipping-policy", opts.concurrencyKey)
        : Promise.resolve(null),
      wantReturns
        ? this.fetchSinglePublicPolicy(effectiveOrigin, "refund-policy", opts.concurrencyKey)
        : Promise.resolve(null)
    ]);

    const shippingExcerpt = shippingResult?.excerpt ?? (wantShipping ? mcpResult.shippingBody : null);
    const returnExcerpt = returnsResult?.excerpt ?? (wantReturns ? mcpResult.refundBody : null);

    if (wantShipping && !shippingExcerpt) {
      if (shippingResult?.blocked) {
        notices.push("Shipping policy page (/policies/shipping-policy) was blocked by store WAF (HTTP 403/401).");
      } else {
        notices.push("Public shipping policy was not found at /policies/shipping-policy; verify shipping details in checkout.");
      }
    }
    if (wantReturns && !returnExcerpt) {
      if (returnsResult?.blocked) {
        notices.push("Return/refund policy page (/policies/refund-policy) was blocked by store WAF (HTTP 403/401).");
      } else {
        notices.push("Public return/refund policy was not found at /policies/refund-policy; verify return terms in checkout.");
      }
    }

    const hints = extractPolicyHints([shippingExcerpt, returnExcerpt, mcpResult.answer]);

    return {
      store_origin: effectiveOrigin,
      shipping_policy_excerpt: shippingExcerpt,
      return_policy_excerpt: returnExcerpt,
      ...(mcpResult.answer ? { mcp_faq_answer: mcpResult.answer } : {}),
      hints,
      policy_urls: {
        shipping: shippingResult?.url ?? `${effectiveOrigin}/policies/shipping-policy`,
        returns: returnsResult?.url ?? `${effectiveOrigin}/policies/refund-policy`
      },
      notices
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
