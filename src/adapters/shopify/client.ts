import {
  safeFetch,
  validateExternalUrl,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import { sanitizeOptionalText } from "../../security/sanitize.js";
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
    opts: { timeoutMs?: number; maxBytes?: number; concurrencyKey?: string } = {}
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
      const canonical = this.cache.get(existing.origin);
      if (canonical && canonical !== existing) {
        canonical.storefrontMcpTools = tools;
      }
    }
  }

  markProductCatalogBlocked(origin: string): void {
    const existing = this.cache.get(origin);
    if (existing) {
      existing.productCatalogBlocked = true;
      existing.wafRestricted = true;
      const canonical = this.cache.get(existing.origin);
      if (canonical && canonical !== existing) {
        canonical.productCatalogBlocked = true;
        canonical.wafRestricted = true;
      }
    }
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
    if (data.currency || data.myshopify_domain || data.shop_id || data.id) {
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

    // 1. Primary: /meta.json (follows 301/308 redirects and exposes canonical storefront domain)
    try {
      const metaRes = await this.getJson<MetaJsonPayload>(`${origin}/meta.json`, {
        concurrencyKey: opts.concurrencyKey
      });

      if (metaRes.status === 200 && metaRes.data && typeof metaRes.data === "object") {
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
              (canonicalMetaRes.data.currency ||
                canonicalMetaRes.data.myshopify_domain ||
                canonicalMetaRes.data.shop_id ||
                canonicalMetaRes.data.id)
            ) {
              const verifiedOrigin =
                extractCanonicalStoreOrigin(canonicalMetaRes.url) ?? declaredOrigin;
              canonicalOrigin = verifiedOrigin;
              this.applyMetaJsonPayload(canonicalMetaRes.data, state);
            }
          } catch {
            // Keep working origin if canonical probe fails
          }
        }
      } else if (metaRes.status === 403 || metaRes.status === 401) {
        metaJsonBlocked = true;
      }
    } catch {
      metaJsonBlocked = true;
    }

    // 2. Fallback / verification: /cart.js (survives Cloudflare WAF and reveals apex->www 301 redirects)
    if (!state.currency || !state.detectedShopify) {
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
      } catch {
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

    this.cache.set(origin, meta);
    if (canonicalOrigin !== origin) {
      this.cache.set(canonicalOrigin, meta);
    }
    return meta;
  }
}
