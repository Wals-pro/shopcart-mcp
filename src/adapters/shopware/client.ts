import {
  safeFetch,
  validateExternalUrl,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import {
  isSameStoreSite,
  isSameStoreSiteOrSubdomain,
  sanitizeOptionalText
} from "../../security/sanitize.js";
import { normalizeCurrency } from "../shopify/normalize.js";
import {
  extractHtmlTitle,
  extractMetaContent,
  rethrowIfHardSsrfError
} from "../shared/html.js";

export interface ShopwareDomainMetadata {
  origin: string;
  apiOrigin: string;
  name: string | null;
  currency: string;
  country: string | null;
  accessKey: string | null;
  storeApiAvailable: boolean;
  storefrontSuggestAvailable: boolean;
  wafRestricted: boolean;
  detected: boolean;
  expiresAt: number;
}

interface ShopwareContextPayload {
  currency?: { isoCode?: string };
  salesChannel?: { name?: string; translated?: { name?: string } };
  shippingLocation?: { country?: { iso?: string } };
  errors?: Array<{ code?: string; detail?: string; title?: string }>;
  apiAlias?: string;
}

export type FetcherFn = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResponse>;

const DEFAULT_UA = "Mozilla/5.0 (compatible; shopcart-mcp/0.1; +https://shopcart.wals.pro)";
const META_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
const MAX_HTML_BYTES = 1_572_864;

function extractCanonicalOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = validateExternalUrl(rawUrl);
    return `https://${parsed.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function extractPublicShopwareAccessKey(html: string): {
  accessKey: string | null;
  apiOrigin: string | null;
} {
  let accessKey: string | null = null;

  const metaKey = extractMetaContent(html, "sw-access-key");
  if (metaKey && /^SWSC[A-Za-z0-9]{16,40}$/.test(metaKey)) {
    accessKey = metaKey;
  }

  if (!accessKey) {
    const jsonKeyMatch = html.match(
      /["'](?:sw-access-key|accessKey|shopwareAccessToken)["']\s*[:=]\s*["'](SWSC[A-Za-z0-9]{16,40})["']/i
    );
    if (jsonKeyMatch?.[1]) {
      accessKey = jsonKeyMatch[1];
    }
  }

  if (!accessKey && /shopware|store-api|sw-access-key/i.test(html)) {
    const bareMatch = html.match(/\b(SWSC[A-Z0-9]{22})\b/);
    if (bareMatch?.[1]) {
      accessKey = bareMatch[1];
    }
  }

  let apiOrigin: string | null = null;
  if (accessKey) {
    const endpointMatch = html.match(/https:\/\/[a-z0-9.-]+\/store-api\b/i);
    if (endpointMatch?.[0]) {
      apiOrigin = extractCanonicalOrigin(endpointMatch[0]);
    }
  }

  return { accessKey, apiOrigin };
}

export function hasShopwareHtmlMarkers(html: string): boolean {
  if (extractMetaContent(html, "sw-access-key")) return true;
  if (/\/bundles\/storefront\//i.test(html)) return true;
  if (/frontend\.search\.suggest|frontend\.checkout\.line-item\.add/i.test(html)) return true;
  if (/data-shopware|sw-csrf-mode|shopware-pwa|shopware-frontends/i.test(html)) return true;
  const generator = extractMetaContent(html, "generator");
  if (generator && /shopware/i.test(generator)) return true;
  if (/\bSWSC[A-Z0-9]{22}\b/.test(html) && /store-api|shopware/i.test(html)) return true;
  return false;
}

export function isShopwareContextResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string>
): boolean {
  if (headers["sw-context-token"]) return true;
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as ShopwareContextPayload;
    if (status === 200 && (parsed.currency?.isoCode || parsed.salesChannel || parsed.apiAlias)) {
      return true;
    }
    if ((status === 400 || status === 401) && Array.isArray(parsed.errors)) {
      return parsed.errors.some((e) => {
        const text = `${e.code ?? ""} ${e.detail ?? ""} ${e.title ?? ""}`;
        return /sw-access-key|SALES_CHANNEL_ACCESS_KEY/i.test(text);
      });
    }
  } catch {
    return false;
  }
  return false;
}

export class ShopwareClient {
  private readonly cache = new Map<string, ShopwareDomainMetadata>();
  private readonly fetcher: FetcherFn;

  constructor(fetcher: FetcherFn = safeFetch) {
    this.fetcher = fetcher;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private setCacheEntry(key: string, entry: ShopwareDomainMetadata, now: number): void {
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

  async storeApiRequest<T>(
    url: string,
    opts: {
      method: "GET" | "POST";
      accessKey?: string | null;
      body?: unknown;
      timeoutMs?: number;
      concurrencyKey?: string;
    }
  ): Promise<{
    status: number;
    data: T | null;
    rawText: string;
    url: string;
    headers: Record<string, string>;
  }> {
    const headers: Record<string, string> = {
      "User-Agent": DEFAULT_UA,
      Accept: "application/json"
    };
    if (opts.method === "POST") {
      headers["Content-Type"] = "application/json";
    }
    if (opts.accessKey) {
      headers["sw-access-key"] = opts.accessKey;
    }

    const res = await this.fetcher(url, {
      method: opts.method,
      headers,
      body: opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
      timeoutMs: opts.timeoutMs ?? 5000,
      maxRedirects: 2,
      maxBytes: 1_048_576,
      concurrencyKey: opts.concurrencyKey
    });

    const trimmed = res.bodyText.trim();
    let data: T | null = null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        data = JSON.parse(trimmed) as T;
      } catch {
        data = null;
      }
    }

    return {
      status: res.status,
      data,
      rawText: res.bodyText,
      url: res.url || url,
      headers: res.headers ?? {}
    };
  }

  async resolveDomainMetadata(
    origin: string,
    opts: { forceRefresh?: boolean; concurrencyKey?: string } = {}
  ): Promise<ShopwareDomainMetadata> {
    const now = Date.now();
    const cached = this.cache.get(origin);
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      return cached;
    }

    let canonicalOrigin = origin;
    let apiOrigin = origin;
    let name: string | null = null;
    let currency: string | null = null;
    let country: string | null = null;
    let accessKey: string | null = null;
    let storeApiAvailable = false;
    let storefrontSuggestAvailable = false;
    let wafRestricted = false;
    let detected = false;

    const [homeRes, ctxRes] = await Promise.all([
      this.getHtml(`${origin}/`, {
        timeoutMs: 5000,
        concurrencyKey: opts.concurrencyKey
      }).catch((err) => {
        rethrowIfHardSsrfError(err);
        return null;
      }),
      this.storeApiRequest<ShopwareContextPayload>(`${origin}/store-api/context`, {
        method: "GET",
        timeoutMs: 3500,
        concurrencyKey: opts.concurrencyKey
      }).catch((err) => {
        rethrowIfHardSsrfError(err);
        return null;
      })
    ]);

    if (homeRes) {
      const redirected = extractCanonicalOrigin(homeRes.url);
      if (redirected) {
        canonicalOrigin = redirected;
        apiOrigin = redirected;
      }
      if (homeRes.status === 401 || homeRes.status === 403) {
        wafRestricted = true;
      } else if (homeRes.status >= 200 && homeRes.status < 400) {
        if (hasShopwareHtmlMarkers(homeRes.html)) {
          detected = true;
        }
        const extracted = extractPublicShopwareAccessKey(homeRes.html);
        if (extracted.accessKey) {
          accessKey = extracted.accessKey;
          detected = true;
        }
        if (
          extracted.apiOrigin &&
          isSameStoreSiteOrSubdomain(canonicalOrigin, extracted.apiOrigin)
        ) {
          apiOrigin = extracted.apiOrigin;
        }
        name = extractHtmlTitle(homeRes.html);
        const ldCurrency = homeRes.html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/i)?.[1];
        if (ldCurrency) currency = normalizeCurrency(ldCurrency);
        if (!currency && /€|EUR/i.test(homeRes.html)) currency = "EUR";
      }
    }

    if (ctxRes) {
      const ctxOrigin = extractCanonicalOrigin(ctxRes.url) ?? origin;
      const ctxSameSite = isSameStoreSiteOrSubdomain(canonicalOrigin, ctxOrigin);
      if (ctxSameSite && isShopwareContextResponse(ctxRes.status, ctxRes.rawText, ctxRes.headers)) {
        detected = true;
        if (ctxRes.status === 200 && ctxRes.data) {
          storeApiAvailable = true;
          if (ctxRes.data.currency?.isoCode) {
            currency = normalizeCurrency(ctxRes.data.currency.isoCode);
          }
          const scName = sanitizeOptionalText(
            ctxRes.data.salesChannel?.translated?.name ?? ctxRes.data.salesChannel?.name,
            120
          );
          if (scName) name = scName;
          const iso = sanitizeOptionalText(ctxRes.data.shippingLocation?.country?.iso, 16);
          if (iso) country = iso;
        }
      } else if (ctxSameSite && ctxRes.status === 403) {
        wafRestricted = true;
      }
    }

    // If a public sw-access-key was intentionally published on the storefront, validate Store API context once (read-only)
    if (detected && accessKey && !storeApiAvailable) {
      try {
        const verifiedCtx = await this.storeApiRequest<ShopwareContextPayload>(
          `${apiOrigin}/store-api/context`,
          {
            method: "GET",
            accessKey,
            timeoutMs: 4000,
            concurrencyKey: opts.concurrencyKey
          }
        );
        if (verifiedCtx.status === 200 && verifiedCtx.data) {
          storeApiAvailable = true;
          if (verifiedCtx.data.currency?.isoCode) {
            currency = normalizeCurrency(verifiedCtx.data.currency.isoCode);
          }
          const scName = sanitizeOptionalText(
            verifiedCtx.data.salesChannel?.translated?.name ??
              verifiedCtx.data.salesChannel?.name,
            120
          );
          if (scName) name = scName;
          const iso = sanitizeOptionalText(verifiedCtx.data.shippingLocation?.country?.iso, 16);
          if (iso) country = iso;
        } else if (verifiedCtx.status === 401 || verifiedCtx.status === 403) {
          storeApiAvailable = false;
          wafRestricted = true;
        }
      } catch (err) {
        rethrowIfHardSsrfError(err);
      }
    }

    // For classic server-rendered Shopware 6 stores without public Store API, check /suggest availability
    if (detected && !storeApiAvailable) {
      try {
        const suggestProbe = await this.getHtml(`${canonicalOrigin}/suggest?search=test`, {
          timeoutMs: 3500,
          concurrencyKey: opts.concurrencyKey
        });
        if (
          suggestProbe.status === 200 &&
          /search-suggest|suggest-product|js-search-result/i.test(suggestProbe.html)
        ) {
          storefrontSuggestAvailable = true;
        } else if (suggestProbe.status === 401 || suggestProbe.status === 403) {
          wafRestricted = true;
        }
      } catch (err) {
        rethrowIfHardSsrfError(err);
      }
    }

    const meta: ShopwareDomainMetadata = {
      origin: canonicalOrigin,
      apiOrigin,
      name,
      currency: currency ?? "EUR",
      country,
      accessKey,
      storeApiAvailable,
      storefrontSuggestAvailable,
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
