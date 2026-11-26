import { isSameStoreSite } from "../../security/sanitize.js";
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
  Money,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreInfo
} from "../types.js";
import {
  inferCurrencyFromUrl,
  isSameStoreHost,
  MAX_HTML_PARSE_BYTES,
  parseProductFromHtml,
  parseSiteMetadataFromHtml,
  sanitizeUniversalProductUrl
} from "./parser.js";

export type JsonLdFetcherFn = (
  url: string,
  opts?: SafeFetchOptions
) => Promise<SafeFetchResponse>;

export interface UniversalJsonLdAdapterOptions {
  fetcher?: JsonLdFetcherFn;
  maxHtmlBytes?: number;
  timeoutMs?: number;
}

interface CachedSiteHints {
  origin: string;
  name: string | null;
  currency: string;
  country: string | null;
  wafRestricted: boolean;
  searchActionTemplate: string | null;
  sitemaps: string[];
  expiresAt: number;
}

interface CachedVariantPointer {
  productUrl: string;
  variantUrl: string;
  title: string;
  available: boolean;
  price: Money;
  expiresAt: number;
}

const DEFAULT_HTML_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7"
};

const HARD_SSRF_CODES = new Set([
  "INVALID_URL",
  "BLOCKED_HOST",
  "BLOCKED_IP",
  "CONCURRENCY_LIMIT"
]);

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHED_VARIANTS_PER_ORIGIN = 200;

function rethrowIfHardSsrfError(err: unknown): void {
  if (err instanceof SsrfError && HARD_SSRF_CODES.has(err.code)) {
    throw err;
  }
}

function looksLikeBotChallengeHtml(html: string, finalUrl?: string): boolean {
  if (finalUrl) {
    try {
      const path = new URL(finalUrl).pathname.toLowerCase();
      if (
        path === "/captcha" ||
        path.startsWith("/captcha/") ||
        path.includes("/cdn-cgi/challenge") ||
        path.includes("/bot-challenge")
      ) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  if (!html) return false;
  const sample = html.slice(0, 16_384).toLowerCase();
  return (
    sample.includes("just a moment...") ||
    sample.includes("cf-browser-verification") ||
    sample.includes("challenge-platform") ||
    sample.includes("attention required! | cloudflare") ||
    sample.includes("datadome") ||
    sample.includes("px-captcha") ||
    sample.includes("access denied</title>") ||
    sample.includes("enable javascript and cookies to continue")
  );
}

function parseSitemapsFromRobotsTxt(robotsTxt: string, origin: string): string[] {
  const sitemaps: string[] = [];
  const seen = new Set<string>();
  const lines = robotsTxt.split(/\r?\n/);
  for (const rawLine of lines) {
    if (sitemaps.length >= 5) break;
    const line = rawLine.trim();
    if (!/^sitemap\s*:/i.test(line)) continue;
    const rawUrl = line.slice(line.indexOf(":") + 1).trim();
    const safeUrl = sanitizeUniversalProductUrl(rawUrl, origin);
    if (safeUrl && !seen.has(safeUrl)) {
      seen.add(safeUrl);
      sitemaps.push(safeUrl);
    }
  }
  return sitemaps;
}

function buildSearchUrlFromTemplate(
  template: string | null,
  query: string,
  origin: string
): string | null {
  if (!template || !query.trim()) return null;
  const replaced = template.replace(/\{[^}]{1,64}\}/g, encodeURIComponent(query.trim()));
  return sanitizeUniversalProductUrl(replaced, origin);
}

const MAX_CACHED_ORIGINS = 1000;

export class UniversalJsonLdAdapter implements StoreAdapter {
  readonly platform = "jsonld";
  private readonly fetcher: JsonLdFetcherFn;
  private readonly maxHtmlBytes: number;
  private readonly timeoutMs: number;
  private readonly siteCache = new Map<string, CachedSiteHints>();
  private readonly variantCache = new Map<string, Map<string, CachedVariantPointer>>();

  constructor(opts: UniversalJsonLdAdapterOptions = {}) {
    this.fetcher = opts.fetcher ?? safeFetch;
    this.maxHtmlBytes = Math.min(
      MAX_HTML_PARSE_BYTES,
      Math.max(65_536, opts.maxHtmlBytes ?? MAX_HTML_PARSE_BYTES)
    );
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  clearCache(): void {
    this.siteCache.clear();
    this.variantCache.clear();
  }

  private setSiteCacheEntry(key: string, entry: CachedSiteHints, now: number): void {
    if (this.siteCache.size >= MAX_CACHED_ORIGINS && !this.siteCache.has(key)) {
      for (const [k, v] of this.siteCache) {
        if (v.expiresAt <= now) this.siteCache.delete(k);
      }
      while (this.siteCache.size >= MAX_CACHED_ORIGINS) {
        const oldest = this.siteCache.keys().next().value;
        if (oldest === undefined) break;
        this.siteCache.delete(oldest);
      }
    }
    this.siteCache.set(key, entry);
  }

  private getOrCreateVariantMap(originKey: string): Map<string, CachedVariantPointer> {
    const existing = this.variantCache.get(originKey);
    if (existing) return existing;
    while (this.variantCache.size >= MAX_CACHED_ORIGINS) {
      const oldest = this.variantCache.keys().next().value;
      if (oldest === undefined) break;
      this.variantCache.delete(oldest);
    }
    const created = new Map<string, CachedVariantPointer>();
    this.variantCache.set(originKey, created);
    return created;
  }

  private resolveTargetProductUrl(origin: string, handleOrUrl: string): string {
    const originParsed = validateExternalUrl(origin);
    const trimmed = handleOrUrl.trim();
    if (!trimmed) {
      throw new Error("handle_or_url is required");
    }
    if (/[\x00-\x1f\s]/.test(trimmed)) {
      throw new Error("handle_or_url contains invalid whitespace or control characters");
    }

    let resolved: string;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      const targetParsed = validateExternalUrl(trimmed);
      if (!isSameStoreHost(targetParsed.hostname, originParsed.hostname)) {
        throw new Error(
          `Product URL host '${targetParsed.hostname}' does not match store_url host '${originParsed.hostname}'. Pass the matching store_url for this product.`
        );
      }
      resolved = targetParsed.toString();
    } else {
      if (trimmed.includes("..") || trimmed.includes("\\")) {
        throw new Error(`Invalid product path: ${trimmed}`);
      }
      const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      const targetParsed = validateExternalUrl(`${originParsed.origin}${path}`);
      resolved = targetParsed.toString();
    }

    return resolved;
  }

  private async fetchRobotsSitemaps(origin: string, concurrencyKey?: string): Promise<string[]> {
    try {
      const res = await this.fetcher(`${origin}/robots.txt`, {
        method: "GET",
        headers: {
          "User-Agent": DEFAULT_HTML_HEADERS["User-Agent"]!,
          Accept: "text/plain,*/*;q=0.1"
        },
        timeoutMs: 3000,
        maxRedirects: 3,
        maxBytes: 65_536,
        concurrencyKey
      });
      if (res.status >= 200 && res.status < 300 && res.bodyText) {
        let robotsBase = origin;
        if (res.url) {
          try {
            const finalOrigin = validateExternalUrl(res.url).origin;
            if (!isSameStoreSite(origin, finalOrigin)) {
              return [];
            }
            robotsBase = res.url;
          } catch {
            return [];
          }
        }
        return parseSitemapsFromRobotsTxt(res.bodyText, robotsBase);
      }
      return [];
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return [];
    }
  }

  private async resolveSiteHints(
    origin: string,
    opts: { includeSitemaps?: boolean; forceRefresh?: boolean; concurrencyKey?: string } = {}
  ): Promise<CachedSiteHints | null> {
    const parsedOrigin = validateExternalUrl(origin);
    const normalizedOrigin = parsedOrigin.origin;
    const now = Date.now();

    const cached = this.siteCache.get(normalizedOrigin);
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      if (opts.includeSitemaps && cached.sitemaps.length === 0) {
        cached.sitemaps = await this.fetchRobotsSitemaps(cached.origin, opts.concurrencyKey);
      }
      return cached;
    }

    let res: SafeFetchResponse;
    try {
      res = await this.fetcher(normalizedOrigin, {
        method: "GET",
        headers: DEFAULT_HTML_HEADERS,
        timeoutMs: Math.min(this.timeoutMs, 6000),
        maxRedirects: 4,
        maxBytes: this.maxHtmlBytes,
        concurrencyKey: opts.concurrencyKey
      });
    } catch (err) {
      rethrowIfHardSsrfError(err);
      return null;
    }

    let finalOrigin = normalizedOrigin;
    try {
      const finalParsed = validateExternalUrl(res.url || normalizedOrigin);
      if (isSameStoreSite(normalizedOrigin, finalParsed.origin)) {
        finalOrigin = finalParsed.origin;
      }
    } catch {
      finalOrigin = normalizedOrigin;
    }

    const isWafStatus = res.status === 403 || res.status === 429 || res.status === 503;
    const isSoftWaf =
      res.status >= 200 && res.status < 300 && looksLikeBotChallengeHtml(res.bodyText, res.url);

    if (res.status >= 400 && !isWafStatus) {
      return null;
    }

    const sameSiteResponseUrl = (() => {
      try {
        if (res.url && isSameStoreSite(normalizedOrigin, validateExternalUrl(res.url).origin)) {
          return res.url;
        }
      } catch {
        // fall back to finalOrigin
      }
      return finalOrigin;
    })();

    const meta =
      res.status >= 200 && res.status < 300 && !isSoftWaf
        ? parseSiteMetadataFromHtml(res.bodyText, sameSiteResponseUrl)
        : null;

    const sitemaps = opts.includeSitemaps
      ? await this.fetchRobotsSitemaps(finalOrigin, opts.concurrencyKey)
      : [];

    const candidateCanonical = meta?.canonicalOrigin ?? finalOrigin;
    const safeCanonicalOrigin = isSameStoreSite(normalizedOrigin, candidateCanonical)
      ? candidateCanonical
      : finalOrigin;

    const hints: CachedSiteHints = {
      origin: safeCanonicalOrigin,
      name: meta?.name ?? null,
      currency: meta?.currency ?? inferCurrencyFromUrl(safeCanonicalOrigin),
      country: meta?.country ?? null,
      wafRestricted: isWafStatus || isSoftWaf,
      searchActionTemplate: meta?.searchActionTemplate ?? null,
      sitemaps,
      expiresAt: now + CACHE_TTL_MS
    };

    this.setSiteCacheEntry(normalizedOrigin, hints, now);
    if (hints.origin !== normalizedOrigin && isSameStoreSite(normalizedOrigin, hints.origin)) {
      this.setSiteCacheEntry(hints.origin, hints, now);
    }

    return hints;
  }

  private rememberProductVariants(origin: string, result: GetProductResult): void {
    const now = Date.now();
    const canonicalProductUrl = result.product.url;

    const writeToOriginMap = (originKey: string): void => {
      const map = this.getOrCreateVariantMap(originKey);
      for (const v of result.product.variants) {
        const pointer: CachedVariantPointer = {
          productUrl: canonicalProductUrl,
          variantUrl: v.url ?? canonicalProductUrl,
          title:
            v.title && v.title !== "Default"
              ? `${result.product.title} — ${v.title}`
              : result.product.title,
          available: v.available,
          price: v.price,
          expiresAt: now + CACHE_TTL_MS
        };

        const keys = [v.id, v.sku, v.gtin, v.ean, v.url, canonicalProductUrl].filter(
          (k): k is string => Boolean(k)
        );
        for (const key of keys) {
          map.set(key, pointer);
        }
      }

      // Evict oldest keys if cache grows large
      while (map.size > MAX_CACHED_VARIANTS_PER_ORIGIN) {
        const firstKey = map.keys().next().value;
        if (firstKey === undefined) break;
        map.delete(firstKey);
      }
    };

    writeToOriginMap(origin);
    // Never share the same Map reference across origins; only mirror into a separate map if apex <-> www same site
    if (result.store_origin !== origin && isSameStoreSite(origin, result.store_origin)) {
      writeToOriginMap(result.store_origin);
    }
  }

  private lookupRememberedVariant(origin: string, variantId: string): CachedVariantPointer | null {
    const map = this.variantCache.get(origin);
    if (!map) return null;
    const entry = map.get(variantId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      map.delete(variantId);
      return null;
    }
    return entry;
  }

  async detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null> {
    const hints = await this.resolveSiteHints(origin, {
      forceRefresh: true,
      includeSitemaps: false,
      concurrencyKey
    });
    if (!hints) {
      return null;
    }

    return {
      platform: "jsonld",
      origin: hints.origin,
      name: hints.name,
      currency: hints.currency,
      country: hints.country,
      myshopifyDomain: null,
      wafRestricted: hints.wafRestricted,
      capabilities: {
        predictiveSearch: false,
        productCatalogJson: false,
        storefrontMcp: false,
        storefrontMcpTools: [],
        jsonLdProduct: true,
        searchActionUrl: hints.searchActionTemplate,
        sitemaps: hints.sitemaps
      }
    };
  }

  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const parsedOrigin = validateExternalUrl(origin);
    const hints = await this.resolveSiteHints(parsedOrigin.origin, {
      includeSitemaps: true,
      concurrencyKey: opts.concurrencyKey
    });

    const effectiveOrigin = hints?.origin ?? parsedOrigin.origin;
    const host = new URL(effectiveOrigin).hostname;
    const currency = opts.currencyHint ?? hints?.currency ?? inferCurrencyFromUrl(effectiveOrigin);
    const query = opts.query?.trim() ?? "";

    const searchUrl = buildSearchUrlFromTemplate(
      hints?.searchActionTemplate ?? null,
      query,
      effectiveOrigin
    );
    const sitemaps = hints?.sitemaps ?? [];

    const notices: string[] = [
      "This storefront is handled via the Universal Schema.org JSON-LD fallback adapter and does not expose a public catalog search API."
    ];
    if (hints?.wafRestricted) {
      notices.push(
        "Homepage returned a WAF/bot-protection response; direct product URL inspection via get_product may also be restricted by the store."
      );
    }
    if (searchUrl) {
      notices.push(`Store exposes a Schema.org SearchAction endpoint: ${searchUrl}`);
    }
    if (sitemaps.length > 0) {
      notices.push(`Discovered sitemap hint(s) in robots.txt: ${sitemaps.join(", ")}`);
    }

    const webSearchHint = query ? `site:${host} ${query}` : `site:${host}`;
    const guidanceParts = [
      `This non-Shopify/non-WooCommerce store (${effectiveOrigin}) does not expose an open catalog search API.`,
      `Find the exact product page URL using web search (e.g. "${webSearchHint}")${
        searchUrl ? ` or the store search URL (${searchUrl})` : ""
      }, then call get_product(store_url="${effectiveOrigin}", handle_or_url="<full product URL>") to verify the live price, currency, stock availability, and SKU/EAN.`,
      "Never guess or fabricate prices or stock status without verifying the live product page via get_product."
    ];

    return {
      store_origin: effectiveOrigin,
      currency,
      products: [],
      notices,
      agent_guidance: guidanceParts.join(" "),
      search_hints: {
        search_url: searchUrl,
        sitemaps
      }
    };
  }

  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const targetUrl = this.resolveTargetProductUrl(origin, handleOrUrl);

    const res = await this.fetcher(targetUrl, {
      method: "GET",
      headers: DEFAULT_HTML_HEADERS,
      timeoutMs: this.timeoutMs,
      maxRedirects: 4,
      maxBytes: this.maxHtmlBytes,
      concurrencyKey: opts.concurrencyKey
    });

    if (res.status === 403 || res.status === 401 || res.status === 429 || res.status === 503) {
      throw new Error(
        `Store WAF/bot protection blocked automated access to ${targetUrl} (HTTP ${res.status}). Never guess or fabricate prices — ask the user to open the product URL directly in their browser.`
      );
    }
    if (res.status === 404 || res.status === 410) {
      throw new Error(`Product page not found at ${targetUrl} (HTTP ${res.status}).`);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Failed to fetch product page ${targetUrl} (upstream returned HTTP ${res.status}).`
      );
    }

    const parsedOrigin = validateExternalUrl(origin);
    const finalUrl = res.url || targetUrl;
    const finalParsed = validateExternalUrl(finalUrl);
    if (!isSameStoreHost(finalParsed.hostname, parsedOrigin.hostname)) {
      throw new Error(
        `Product page redirected to unrelated host '${finalParsed.hostname}' (expected '${parsedOrigin.hostname}').`
      );
    }

    const parsed = parseProductFromHtml(res.bodyText, finalUrl, {
      currencyHint: opts.currencyHint
    });

    if (!parsed) {
      if (looksLikeBotChallengeHtml(res.bodyText, finalUrl)) {
        throw new Error(
          `Store WAF/bot challenge page blocked automated extraction on ${finalUrl}. Never guess or fabricate prices — ask the user to open the URL directly in their browser.`
        );
      }
      throw new Error(
        `No verified Schema.org Product JSON-LD or OpenGraph product price metadata found on ${finalUrl}. Ensure handle_or_url points to a specific product detail page.`
      );
    }

    let effectiveOrigin = finalParsed.origin;
    try {
      const productOrigin = validateExternalUrl(parsed.product.url).origin;
      if (isSameStoreSite(finalParsed.origin, productOrigin)) {
        effectiveOrigin = productOrigin;
      }
    } catch {
      effectiveOrigin = finalParsed.origin;
    }

    const result: GetProductResult = {
      store_origin: effectiveOrigin,
      currency: parsed.currency,
      product: parsed.product
    };

    this.rememberProductVariants(parsedOrigin.origin, result);
    return result;
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
    const parsedOrigin = validateExternalUrl(origin);
    const normalizedOrigin = parsedOrigin.origin;

    if (!items.length || items.length > 20) {
      throw new Error("items must contain between 1 and 20 line items");
    }
    for (const item of items) {
      if (!item.variantId || !item.variantId.trim() || item.variantId.length > 1000) {
        throw new Error(`Invalid variant_id: ${item.variantId}`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for variant ${item.variantId}: must be integer 1..99`);
      }
    }
    if (opts.discountCode && !/^[A-Za-z0-9._-]{1,64}$/.test(opts.discountCode)) {
      throw new Error("Invalid discount_code format");
    }

    // Collect candidate product URLs to live-verify (from verifyHandles, variantId URLs/paths, or recent getProduct cache)
    const candidateUrls = new Set<string>();
    for (const h of opts.verifyHandles ?? []) {
      if (h.trim()) candidateUrls.add(h.trim());
    }

    const itemUrlHint = new Map<string, string>();
    for (const item of items) {
      const vid = item.variantId.trim();
      if (/^https?:\/\//i.test(vid) || vid.startsWith("/")) {
        candidateUrls.add(vid);
        itemUrlHint.set(vid, vid);
      } else {
        const remembered = this.lookupRememberedVariant(normalizedOrigin, vid);
        if (remembered) {
          candidateUrls.add(remembered.productUrl);
          itemUrlHint.set(vid, remembered.variantUrl);
        }
      }
    }

    if (candidateUrls.size === 0) {
      throw new Error(
        `Cannot build a verified product link for ${normalizedOrigin} without a product URL. Pass the full product URL in verify_handles (or as variant_id) after calling get_product.`
      );
    }

    const warnings: string[] = [];
    const verifiedProducts: GetProductResult[] = [];
    const verifiedVariantLookup = new Map<
      string,
      {
        url: string;
        available: boolean;
        title: string;
        unitPrice: Money;
      }
    >();

    for (const candidate of Array.from(candidateUrls).slice(0, 10)) {
      const detail = await this.getProduct(normalizedOrigin, candidate, {
        concurrencyKey: opts.concurrencyKey
      });
      verifiedProducts.push(detail);

      for (const v of detail.product.variants) {
        const displayTitle =
          v.title && v.title !== "Default"
            ? `${detail.product.title} — ${v.title}`
            : detail.product.title;
        const entry = {
          url: v.url ?? detail.product.url,
          available: v.available,
          title: displayTitle,
          unitPrice: v.price
        };
        const keys = [
          v.id,
          v.sku,
          v.gtin,
          v.ean,
          v.url,
          detail.product.url,
          detail.product.handle,
          candidate
        ].filter((k): k is string => Boolean(k));
        for (const key of keys) {
          if (!verifiedVariantLookup.has(key)) {
            verifiedVariantLookup.set(key, entry);
          }
        }
      }
    }

    const fallbackProduct = verifiedProducts[0]!;
    const fallbackVariant = fallbackProduct.product.variants[0]!;

    const resultItems: CartLinkItemResult[] = [];
    const resolvedUrls: Array<{ variantId: string; quantity: number; title: string; url: string }> =
      [];

    for (const item of items) {
      const vid = item.variantId.trim();
      const matched =
        verifiedVariantLookup.get(vid) ??
        (itemUrlHint.has(vid) ? verifiedVariantLookup.get(itemUrlHint.get(vid)!) : undefined) ??
        (verifiedProducts.length === 1 && fallbackProduct.product.variants.length === 1
          ? {
              url: fallbackVariant.url ?? fallbackProduct.product.url,
              available: fallbackVariant.available,
              title: fallbackProduct.product.title,
              unitPrice: fallbackVariant.price
            }
          : undefined);

      if (!matched) {
        warnings.push(
          `Variant '${vid}' was not matched in verified product pages; falling back to primary verified product link.`
        );
        resultItems.push({
          variant_id: vid,
          quantity: item.quantity,
          verified: false
        });
        continue;
      }

      if (!matched.available) {
        warnings.push(
          `Item '${matched.title}' (${vid}) is currently reported out of stock on the live product page.`
        );
      }

      resultItems.push({
        variant_id: vid,
        quantity: item.quantity,
        verified: true,
        available: matched.available,
        title: matched.title,
        unit_price: matched.unitPrice
      });
      resolvedUrls.push({
        variantId: vid,
        quantity: item.quantity,
        title: matched.title,
        url: matched.url
      });
    }

    const primaryUrl = resolvedUrls[0]?.url ?? fallbackProduct.product.url;
    const seenAdditional = new Set<string>([primaryUrl]);
    const additionalCartLinks: AdditionalCartLink[] = [];

    for (const entry of resolvedUrls.slice(1)) {
      if (!seenAdditional.has(entry.url)) {
        seenAdditional.add(entry.url);
        additionalCartLinks.push({
          variant_id: entry.variantId,
          quantity: entry.quantity,
          title: entry.title,
          cart_url: entry.url
        });
      }
    }

    if (items.length > 1 || items.some((i) => i.quantity > 1)) {
      warnings.push(
        "Direct product link mode cannot pre-bundle multiple items or quantities into a single cart permalink; select the desired quantity on the store page."
      );
    }
    if (opts.discountCode) {
      warnings.push(
        `Discount code '${opts.discountCode}' cannot be pre-applied via URL on this store; enter it manually at checkout.`
      );
    }

    return {
      store_origin: fallbackProduct.store_origin,
      cart_url: primaryUrl,
      mode: opts.mode,
      cart_mode: "direct_product_link",
      items: resultItems,
      ...(additionalCartLinks.length > 0 ? { additional_cart_links: additionalCartLinks } : {}),
      warnings,
      next_step:
        "Verified live product link — this store does not expose a public multi-item cart permalink; open link to add to cart and checkout"
    };
  }
}
