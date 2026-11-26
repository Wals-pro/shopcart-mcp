import {
  safeFetch,
  validateExternalUrl,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import { isSameStoreSite, sanitizeOptionalText } from "../../security/sanitize.js";
import { normalizeCurrency } from "../shopify/normalize.js";
import { rethrowIfHardSsrfError } from "../shared/html.js";

export interface MagentoDomainMetadata {
  origin: string;
  name: string | null;
  currency: string;
  country: string | null;
  storeCode: string | null;
  productUrlSuffix: string;
  wafRestricted: boolean;
  detected: boolean;
  expiresAt: number;
}

interface StoreConfigGraphqlResponse {
  data?: {
    storeConfig?: {
      store_code?: string | null;
      store_name?: string | null;
      base_currency_code?: string | null;
      default_display_currency_code?: string | null;
      secure_base_url?: string | null;
      product_url_suffix?: string | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

export type FetcherFn = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResponse>;

const DEFAULT_UA = "Mozilla/5.0 (compatible; shopcart-mcp/0.1; +https://shopcart.wals.pro)";
const META_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
const SAFE_PRODUCT_URL_SUFFIX_RE = /^(?:\/|\.[a-z0-9]{1,10})?$/i;

export function sanitizeMagentoUrlSuffix(raw: string | null | undefined, fallback = ""): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return SAFE_PRODUCT_URL_SUFFIX_RE.test(trimmed) ? trimmed : fallback;
}

const STORE_CONFIG_QUERY = `{
  storeConfig {
    store_code
    store_name
    base_currency_code
    default_display_currency_code
    secure_base_url
    product_url_suffix
  }
}`;

function extractCanonicalOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = validateExternalUrl(rawUrl);
    return `https://${parsed.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export class MagentoClient {
  private readonly cache = new Map<string, MagentoDomainMetadata>();
  private readonly fetcher: FetcherFn;

  constructor(fetcher: FetcherFn = safeFetch) {
    this.fetcher = fetcher;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private setCacheEntry(key: string, entry: MagentoDomainMetadata, now: number): void {
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

  async graphql<T>(
    origin: string,
    query: string,
    variables: Record<string, unknown> = {},
    opts: { timeoutMs?: number; concurrencyKey?: string } = {}
  ): Promise<{ status: number; data: T | null; url: string; rawText: string }> {
    const trimmedQuery = query.trim();
    if (/^mutation\b/i.test(trimmedQuery)) {
      throw new Error("MagentoClient is strictly read-only: GraphQL mutations are forbidden");
    }

    const res = await this.fetcher(`${origin}/graphql`, {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_UA,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(
        Object.keys(variables).length > 0 ? { query: trimmedQuery, variables } : { query: trimmedQuery }
      ),
      timeoutMs: opts.timeoutMs ?? 6000,
      maxRedirects: 2,
      maxBytes: 1_048_576,
      concurrencyKey: opts.concurrencyKey
    });

    const trimmed = res.bodyText.trim();
    let data: T | null = null;
    if (res.status >= 200 && res.status < 300 && trimmed.startsWith("{")) {
      try {
        data = JSON.parse(trimmed) as T;
      } catch {
        data = null;
      }
    }

    return {
      status: res.status,
      data,
      url: res.url || `${origin}/graphql`,
      rawText: res.bodyText
    };
  }

  async resolveDomainMetadata(
    origin: string,
    opts: { forceRefresh?: boolean; concurrencyKey?: string } = {}
  ): Promise<MagentoDomainMetadata> {
    const now = Date.now();
    const cached = this.cache.get(origin);
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      return cached;
    }

    let canonicalOrigin = origin;
    let name: string | null = null;
    let currency = "USD";
    let storeCode: string | null = null;
    let productUrlSuffix = ".html";
    let wafRestricted = false;
    let detected = false;

    try {
      const res = await this.graphql<StoreConfigGraphqlResponse>(
        origin,
        STORE_CONFIG_QUERY,
        {},
        { timeoutMs: 3500, concurrencyKey: opts.concurrencyKey }
      );

      if (res.status === 401 || res.status === 403) {
        wafRestricted = true;
      } else if (res.status === 200 && res.data?.data?.storeConfig) {
        const cfg = res.data.data.storeConfig;
        if (cfg.store_code || cfg.base_currency_code || cfg.default_display_currency_code) {
          detected = true;
          const redirected = extractCanonicalOrigin(res.url);
          if (redirected && isSameStoreSite(origin, redirected)) canonicalOrigin = redirected;
          name = sanitizeOptionalText(cfg.store_name, 120);
          currency = normalizeCurrency(
            cfg.default_display_currency_code ?? cfg.base_currency_code ?? "USD"
          );
          storeCode = sanitizeOptionalText(cfg.store_code, 64);
          if (typeof cfg.product_url_suffix === "string") {
            productUrlSuffix = sanitizeMagentoUrlSuffix(cfg.product_url_suffix, ".html");
          }
        }
      }
    } catch (err) {
      rethrowIfHardSsrfError(err);
    }

    const meta: MagentoDomainMetadata = {
      origin: canonicalOrigin,
      name,
      currency,
      country: null,
      storeCode,
      productUrlSuffix,
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
