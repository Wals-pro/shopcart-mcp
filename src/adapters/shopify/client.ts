import {
  safeFetch,
  SsrfError,
  validateExternalUrl,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import { isSameStoreSite, sanitizeOptionalText } from "../../security/sanitize.js";
import { normalizeCurrency } from "./normalize.js";

export interface DomainMetadata {
  origin: string;
  name: string | null;
  currency: string;
  country: string | null;
  myshopifyDomain: string | null;
  wafRestricted: boolean;
  metaJsonBlocked: boolean;
  productCatalogBlocked: boolean;
  detectedShopify: boolean;
  storefrontMcpTools: string[] | null;
  expiresAt: number;
}

interface MetaJsonPayload {
  name?: string;
  currency?: string;
  country?: string;
  domain?: string;
  url?: string;
  myshopify_domain?: string;
  shop_id?: number;
  id?: number;
}

export type FetcherFn = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResponse>;

const DEFAULT_UA = "Mozilla/5.0 (compatible; shopcart-mcp/0.1; +https://shopcart.wals.pro)";
const META_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

function hasExpectedPathSuffix(rawUrl: string | undefined, suffix: string): boolean {
  if (!rawUrl) return true;
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.toLowerCase().endsWith(suffix);
  } catch {
    return false;
  }
}

function isShopifyMetaPayload(data: MetaJsonPayload): boolean {
  return Boolean(data.currency || data.myshopify_domain || data.shop_id);
}

function isTransientFetchError(err: unknown): boolean {
  return err instanceof SsrfError && (err.code === "CONCURRENCY_LIMIT" || err.code === "TIMEOUT");
}

function isInternalOrCheckoutHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower.endsWith(".myshopify.com") ||
    /(^|\.)checkout\./i.test(lower)
  );
}

function extractCanonicalStoreOrigin(rawUrlOrDomain: string | null | undefined): string | null {
  if (!rawUrlOrDomain || typeof rawUrlOrDomain !== "string") return null;
  const trimmed = rawUrlOrDomain.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = validateExternalUrl(withScheme);
    const host = parsed.hostname.toLowerCase();
    if (isInternalOrCheckoutHost(host)) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

export class ShopifyClient {
  private readonly cache = new Map<string, DomainMetadata>();
  private readonly fetcher: FetcherFn;

  constructor(fetcher: FetcherFn = safeFetch) {
    this.fetcher = fetcher;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCanonicalOrigin(origin: string): string {
    const cached = this.cache.get(origin);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.origin;
    }
    return origin;
  }

  async getJson<T>(
    url: string,
    opts: { timeoutMs?: number; concurrencyKey?: string } = {}
  ): Promise<{ status: number; data: T | null; rawText: string; url: string }> {
    const res = await this.fetcher(url, {
      method: "GET",
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "application/json, text/javascript, */*;q=0.1"
      },
      timeoutMs: opts.timeoutMs ?? 6000,
      maxRedirects: 3,
      maxBytes: 1_048_576,
      concurrencyKey: opts.concurrencyKey
    });

    const finalUrl = res.url || url;

    if (res.status < 200 || res.status >= 300) {
      return { status: res.status, data: null, rawText: res.bodyText, url: finalUrl };
    }

    const trimmed = res.bodyText.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return { status: res.status, data: null, rawText: res.bodyText, url: finalUrl };
    }

    try {
      return {
        status: res.status,
        data: JSON.parse(trimmed) as T,
        rawText: res.bodyText,
        url: finalUrl
      };
    } catch {
      return { status: res.status, data: null, rawText: res.bodyText, url: finalUrl };
    }
  }

  async postJson<T>(
    url: string,
    payload: unknown,
    opts: { timeoutMs?: number; concurrencyKey?: string } = {}
  ): Promise<{ status: number; data: T | null }> {
    const res = await this.fetcher(url, {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_UA,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      timeoutMs: opts.timeoutMs ?? 2500,
      maxRedirects: 2,
      maxBytes: 262_144,
      concurrencyKey: opts.concurrencyKey
    });

    if (res.status < 200 || res.status >= 300) {
      return { status: res.status, data: null };
    }

    try {
      return { status: res.status, data: JSON.parse(res.bodyText) as T };
    } catch {
      return { status: res.status, data: null };
    }
  }

  async getText(
    url: string,
    opts: {
      timeoutMs?: number;
      maxBytes?: number;
      truncateOnMaxBytes?: boolean;
      concurrencyKey?: string;
    } = {}
  ): Promise<{ status: number; text: string; contentType: string; url: string }> {
    const res = await this.fetcher(url, {
      method: "GET",
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.1"
      },
      timeoutMs: opts.timeoutMs ?? 5000,
      maxRedirects: 3,
      maxBytes: opts.maxBytes ?? 1_048_576,
      truncateOnMaxBytes: opts.truncateOnMaxBytes,
      concurrencyKey: opts.concurrencyKey
    });

    return {
      status: res.status,
      text: res.bodyText,
      contentType: res.contentType,
      url: res.url || url
    };
  }

  setStorefrontMcpTools(origin: string, tools: string[]): void {
    const existing = this.cache.get(origin);
    if (existing) {
      existing.storefrontMcpTools = tools;
      if (isSameStoreSite(origin, existing.origin)) {
        const canonical = this.cache.get(existing.origin);
        if (canonical && canonical !== existing) {
          canonical.storefrontMcpTools = tools;
        }
      }
    }
  }

  markProductCatalogBlocked(origin: string): void {
    const existing = this.cache.get(origin);
    if (existing) {
      existing.productCatalogBlocked = true;
      existing.wafRestricted = true;
      if (isSameStoreSite(origin, existing.origin)) {
        const canonical = this.cache.get(existing.origin);
        if (canonical && canonical !== existing) {
          canonical.productCatalogBlocked = true;
          canonical.wafRestricted = true;
        }
      }
    }
  }

  private setCacheEntry(key: string, meta: DomainMetadata, now: number): void {
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

  private applyMetaJsonPayload(
    data: MetaJsonPayload,
    state: {
      name: string | null;
      currency: string | null;
      country: string | null;
      myshopifyDomain: string | null;
      detectedShopify: boolean;
    }
  ): void {
    if (isShopifyMetaPayload(data)) {
      state.detectedShopify = true;
    }
    const nextName = sanitizeOptionalText(data.name, 120);
    if (nextName) state.name = nextName;
    if (data.currency) state.currency = normalizeCurrency(data.currency);
    const nextCountry = sanitizeOptionalText(data.country, 16);
    if (nextCountry) state.country = nextCountry;
    const nextMyshopify = sanitizeOptionalText(data.myshopify_domain, 150);
    if (nextMyshopify) state.myshopifyDomain = nextMyshopify;
  }

  async resolveDomainMetadata(
    origin: string,
    opts: { forceRefresh?: boolean; concurrencyKey?: string } = {}
  ): Promise<DomainMetadata> {
    const now = Date.now();
    const cached = this.cache.get(origin);
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      return cached;
    }

    let canonicalOrigin = origin;
    const state = {
      name: null as string | null,
      currency: null as string | null,
      country: null as string | null,
      myshopifyDomain: null as string | null,
      detectedShopify: false
    };
    let metaJsonBlocked = false;
    let transientFailure = false;
    let concurrencySaturated = false;

    // 1. Primary: /meta.json (follows 301/308 redirects and exposes canonical storefront domain)
    try {
      const metaRes = await this.getJson<MetaJsonPayload>(`${origin}/meta.json`, {
        concurrencyKey: opts.concurrencyKey
      });

      if (
        metaRes.status === 200 &&
        metaRes.data &&
        typeof metaRes.data === "object" &&
        hasExpectedPathSuffix(metaRes.url, "/meta.json")
      ) {
        this.applyMetaJsonPayload(metaRes.data, state);

        // 1a. Capture HTTP redirect target (e.g. 301 apex -> www. or legacy domain -> new domain)
        const redirectedOrigin = extractCanonicalStoreOrigin(metaRes.url);
        if (redirectedOrigin && state.detectedShopify) {
          canonicalOrigin = redirectedOrigin;
        }

        // 1b. If Shopify's meta.json declares a distinct canonical primary domain (e.g. apex -> www.
        // or rebranded storefront where apex /meta.json returns 200 without redirecting), verify it once.
        const declaredOrigin = extractCanonicalStoreOrigin(metaRes.data.domain ?? metaRes.data.url);
        if (state.detectedShopify && declaredOrigin && declaredOrigin !== canonicalOrigin) {
          try {
            const canonicalMetaRes = await this.getJson<MetaJsonPayload>(
              `${declaredOrigin}/meta.json`,
              { concurrencyKey: opts.concurrencyKey, timeoutMs: 4000 }
            );
            if (
              canonicalMetaRes.status === 200 &&
              canonicalMetaRes.data &&
              typeof canonicalMetaRes.data === "object" &&
              hasExpectedPathSuffix(canonicalMetaRes.url, "/meta.json") &&
              isShopifyMetaPayload(canonicalMetaRes.data)
            ) {
              const verifiedOrigin =
                extractCanonicalStoreOrigin(canonicalMetaRes.url) ?? declaredOrigin;
              canonicalOrigin = verifiedOrigin;
              // Reset state before applying verified canonical payload so fields from the initial
              // origin cannot bleed into the verified canonical metadata.
              state.name = null;
              state.currency = null;
              state.country = null;
              state.myshopifyDomain = null;
              state.detectedShopify = false;
              this.applyMetaJsonPayload(canonicalMetaRes.data, state);
            }
          } catch (err) {
            if (isTransientFetchError(err)) {
              transientFailure = true;
            }
            // Keep working origin if canonical probe fails
          }
        }
      } else if (metaRes.status === 403 || metaRes.status === 401) {
        metaJsonBlocked = true;
      }
    } catch (err) {
      if (isTransientFetchError(err)) {
        transientFailure = true;
        if (err instanceof SsrfError && err.code === "CONCURRENCY_LIMIT") {
          concurrencySaturated = true;
        }
      } else {
        metaJsonBlocked = true;
      }
    }

    // 2. Fallback / verification: /cart.js (survives Cloudflare WAF and reveals apex->www 301 redirects)
    if (!concurrencySaturated && (!state.currency || !state.detectedShopify)) {
      try {
        const cartRes = await this.getJson<{
          token?: string;
          currency?: string;
          items?: unknown[];
        }>(`${canonicalOrigin}/cart.js`, { concurrencyKey: opts.concurrencyKey });

        if (
          cartRes.status === 200 &&
          cartRes.data &&
          typeof cartRes.data === "object" &&
          hasExpectedPathSuffix(cartRes.url, "/cart.js") &&
          typeof cartRes.data.currency === "string" &&
          Array.isArray(cartRes.data.items)
        ) {
          state.detectedShopify = true;
          state.currency = state.currency ?? normalizeCurrency(cartRes.data.currency);
          const cartRedirectOrigin = extractCanonicalStoreOrigin(cartRes.url);
          if (cartRedirectOrigin) {
            canonicalOrigin = cartRedirectOrigin;
          }
        }
      } catch (err) {
        if (isTransientFetchError(err)) {
          transientFailure = true;
        }
        // ignore, caller checks detectedShopify
      }
    }

    const meta: DomainMetadata = {
      origin: canonicalOrigin,
      name: state.name,
      currency: state.currency ?? "USD",
      country: state.country,
      myshopifyDomain: state.myshopifyDomain,
      wafRestricted: metaJsonBlocked,
      metaJsonBlocked,
      productCatalogBlocked: cached?.productCatalogBlocked ?? false,
      detectedShopify: state.detectedShopify,
      storefrontMcpTools: cached?.storefrontMcpTools ?? null,
      expiresAt: now + META_CACHE_TTL_MS
    };

    // Never poison or overwrite cached metadata with fallback defaults on transient
    // CONCURRENCY_LIMIT or TIMEOUT failures.
    if (!transientFailure) {
      this.setCacheEntry(origin, meta, now);
      // Only alias canonicalOrigin into the shared cache when it is same-site (apex <-> www)
      // so an attacker domain cannot poison cached metadata for an unrelated store origin.
      if (canonicalOrigin !== origin && isSameStoreSite(origin, canonicalOrigin)) {
        this.setCacheEntry(canonicalOrigin, meta, now);
      }
    }
    return meta;
  }
}
