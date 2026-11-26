import {
  safeFetch,
  validateExternalUrl,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import { isSameStoreSite } from "../../security/sanitize.js";
import { normalizeCurrency } from "../shopify/normalize.js";
import {
  extractHtmlTitle,
  extractJsonLdBlocks,
  extractMetaContent,
  findBestProductJsonLd,
  parseJsonLdOffer,
  rethrowIfHardSsrfError
} from "../shared/html.js";

export interface BigCommerceDomainMetadata {
  origin: string;
  name: string | null;
  currency: string;
  country: string | null;
  wafRestricted: boolean;
  detected: boolean;
  expiresAt: number;
}

export type FetcherFn = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResponse>;

const DEFAULT_UA = "Mozilla/5.0 (compatible; shopcart-mcp/0.1; +https://shopcart.wals.pro)";
const META_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
const MAX_HTML_BYTES = 1_572_864; // 1.5 MiB bounded cap for Stencil storefront HTML

function extractCanonicalOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = validateExternalUrl(rawUrl);
    return `https://${parsed.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function hasBigCommerceMarkers(
  html: string,
  headers: Record<string, string> = {}
): boolean {
  if (headers["x-bc-storefront-type"]) return true;
  if (/cdn\d*\.bigcommerce\.com\/s-[a-z0-9]+/i.test(html)) return true;
  if (/cdn\d*\.bigcommerce\.com/i.test(html)) return true;
  if (/(?:window\.|var\s+|let\s+|const\s+)?BCData\s*=\s*\{/.test(html)) return true;
  if (/stencil-utils|data-stencil|bigcommerce-stencil/i.test(html)) return true;
  if (/\/cart\.php\?action=add/i.test(html) && /bigcommerce/i.test(html)) return true;
  return false;
}

export function extractCurrencyFromHtml(html: string): string | null {
  // 1. BCData currency field
  const bcCurrency = html.match(/"currency"\s*:\s*"([A-Z]{3})"/);
  if (bcCurrency?.[1]) return normalizeCurrency(bcCurrency[1]);

  // 2. JSON-LD priceCurrency
  const ldBlocks = extractJsonLdBlocks(html);
  const prod = findBestProductJsonLd(ldBlocks);
  if (prod?.offers) {
    const offer = parseJsonLdOffer(prod.offers);
    if (offer.currency) return normalizeCurrency(offer.currency);
  }
  const ldCurrency = html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/i);
  if (ldCurrency?.[1]) return normalizeCurrency(ldCurrency[1]);

  // 3. Common currency selector / meta (linear scan)
  const metaCurrency = extractMetaContent(html, "product:price:currency");
  if (metaCurrency && /^[A-Za-z]{3}$/.test(metaCurrency)) {
    return normalizeCurrency(metaCurrency);
  }

  return null;
}

export class BigCommerceClient {
  private readonly cache = new Map<string, BigCommerceDomainMetadata>();
  private readonly fetcher: FetcherFn;

  constructor(fetcher: FetcherFn = safeFetch) {
    this.fetcher = fetcher;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private setCacheEntry(key: string, entry: BigCommerceDomainMetadata, now: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(key)) {
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= now) this.cache.delete(k);
      }
      while (this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, entry);
  }

  getCanonicalOrigin(origin: string): string {
    const cached = this.cache.get(origin);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.origin;
    }
    return origin;
  }

  async getHtml(
    url: string,
    opts: { timeoutMs?: number; concurrencyKey?: string } = {}
  ): Promise<{ status: number; html: string; url: string; headers: Record<string, string> }> {
    const res = await this.fetcher(url, {
      method: "GET",
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1"
      },
      timeoutMs: opts.timeoutMs ?? 6000,
      maxRedirects: 3,
      maxBytes: MAX_HTML_BYTES,
      concurrencyKey: opts.concurrencyKey
    });

    return {
      status: res.status,
      html: res.bodyText,
      url: res.url || url,
      headers: res.headers ?? {}
    };
  }

  async resolveDomainMetadata(
    origin: string,
    opts: { forceRefresh?: boolean; concurrencyKey?: string } = {}
  ): Promise<BigCommerceDomainMetadata> {
    const now = Date.now();
    const cached = this.cache.get(origin);
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      return cached;
    }

    let canonicalOrigin = origin;
    let name: string | null = null;
    let currency: string | null = null;
    let wafRestricted = false;
    let detected = false;

    try {
      const home = await this.getHtml(`${origin}/`, {
        timeoutMs: 5000,
        concurrencyKey: opts.concurrencyKey
      });

      const redirected = extractCanonicalOrigin(home.url);
      if (redirected && isSameStoreSite(origin, redirected)) canonicalOrigin = redirected;

      if (home.status === 401 || home.status === 403) {
        wafRestricted = true;
      } else if (home.status >= 200 && home.status < 400) {
        if (hasBigCommerceMarkers(home.html, home.headers)) {
          detected = true;
          name = extractHtmlTitle(home.html);
          currency = extractCurrencyFromHtml(home.html);
        }
      }
    } catch (err) {
      rethrowIfHardSsrfError(err);
    }

    // Fallback probe: /cart.php response markers (BigCommerce-specific cart controller)
    if (!detected) {
      try {
        const cartRes = await this.getHtml(`${canonicalOrigin}/cart.php`, {
          timeoutMs: 4000,
          concurrencyKey: opts.concurrencyKey
        });
        if (cartRes.status === 401 || cartRes.status === 403) {
          wafRestricted = true;
        } else if (
          cartRes.status === 200 &&
          (hasBigCommerceMarkers(cartRes.html, cartRes.headers) ||
            /data-cart-page|cart-status|page-type=["']cart["']/i.test(cartRes.html))
        ) {
          detected = true;
          const redirected = extractCanonicalOrigin(cartRes.url);
          if (redirected && isSameStoreSite(origin, redirected)) {
            canonicalOrigin = redirected;
          }
          name = name ?? extractHtmlTitle(cartRes.html);
          currency = currency ?? extractCurrencyFromHtml(cartRes.html);
        }
      } catch (err) {
        rethrowIfHardSsrfError(err);
      }
    }

    const meta: BigCommerceDomainMetadata = {
      origin: canonicalOrigin,
      name,
      currency: currency ?? "USD",
      country: null,
      wafRestricted,
      detected,
      expiresAt: now + META_CACHE_TTL_MS
    };

    this.setCacheEntry(origin, meta, now);
    if (canonicalOrigin !== origin && isSameStoreSite(origin, canonicalOrigin)) {
      this.setCacheEntry(canonicalOrigin, meta, now);
    }
    return meta;
  }
}
