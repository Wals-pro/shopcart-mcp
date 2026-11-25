import { safeFetch, type SafeFetchOptions, type SafeFetchResponse } from "../../security/ssrf.js";
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
  expiresAt: number;
}

export type FetcherFn = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResponse>;

const DEFAULT_UA = "Mozilla/5.0 (compatible; shopcart-mcp/0.1; +https://shopcart.wals.pro)";
const META_CACHE_TTL_MS = 15 * 60 * 1000;

export class ShopifyClient {
  private readonly cache = new Map<string, DomainMetadata>();
  private readonly fetcher: FetcherFn;

  constructor(fetcher: FetcherFn = safeFetch) {
    this.fetcher = fetcher;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async getJson<T>(
    url: string,
    opts: { timeoutMs?: number; concurrencyKey?: string } = {}
  ): Promise<{ status: number; data: T | null; rawText: string }> {
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

    if (res.status < 200 || res.status >= 300) {
      return { status: res.status, data: null, rawText: res.bodyText };
    }

    const trimmed = res.bodyText.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return { status: res.status, data: null, rawText: res.bodyText };
    }

    try {
      return { status: res.status, data: JSON.parse(trimmed) as T, rawText: res.bodyText };
    } catch {
      return { status: res.status, data: null, rawText: res.bodyText };
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

  markProductCatalogBlocked(origin: string): void {
    const existing = this.cache.get(origin);
    if (existing) {
      existing.productCatalogBlocked = true;
      existing.wafRestricted = true;
    }
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

    let name: string | null = null;
    let currency: string | null = null;
    let country: string | null = null;
    let myshopifyDomain: string | null = null;
    let metaJsonBlocked = false;
    let detectedShopify = false;

    // 1. Primary: /meta.json
    try {
      const metaRes = await this.getJson<{
        name?: string;
        currency?: string;
        country?: string;
        myshopify_domain?: string;
        shop_id?: number;
      }>(`${origin}/meta.json`, { concurrencyKey: opts.concurrencyKey });

      if (metaRes.status === 200 && metaRes.data && typeof metaRes.data === "object") {
        if (metaRes.data.currency || metaRes.data.myshopify_domain || metaRes.data.shop_id) {
          detectedShopify = true;
        }
        name = sanitizeOptionalText(metaRes.data.name, 120);
        if (metaRes.data.currency) currency = normalizeCurrency(metaRes.data.currency);
        country = sanitizeOptionalText(metaRes.data.country, 16);
        myshopifyDomain = sanitizeOptionalText(metaRes.data.myshopify_domain, 150);
      } else if (metaRes.status === 403 || metaRes.status === 401) {
        metaJsonBlocked = true;
      }
    } catch {
      metaJsonBlocked = true;
    }

    // 2. Fallback / verification: /cart.js (survives Cloudflare WAF 5/5!)
    if (!currency || !detectedShopify) {
      try {
        const cartRes = await this.getJson<{
          token?: string;
          currency?: string;
          items?: unknown[];
        }>(`${origin}/cart.js`, { concurrencyKey: opts.concurrencyKey });

        if (
          cartRes.status === 200 &&
          cartRes.data &&
          typeof cartRes.data === "object" &&
          typeof cartRes.data.currency === "string" &&
          Array.isArray(cartRes.data.items)
        ) {
          detectedShopify = true;
          currency = currency ?? normalizeCurrency(cartRes.data.currency);
        }
      } catch {
        // ignore, caller checks detectedShopify
      }
    }

    const meta: DomainMetadata = {
      origin,
      name,
      currency: currency ?? "USD",
      country,
      myshopifyDomain,
      wafRestricted: metaJsonBlocked,
      metaJsonBlocked,
      productCatalogBlocked: cached?.productCatalogBlocked ?? false,
      detectedShopify,
      expiresAt: now + META_CACHE_TTL_MS
    };

    this.cache.set(origin, meta);
    return meta;
  }
}
