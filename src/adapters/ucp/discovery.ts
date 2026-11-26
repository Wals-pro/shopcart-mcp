import { isSameStoreSite } from "../../security/sanitize.js";
import {
  safeFetch,
  SsrfError,
  validateExternalUrl,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import { normalizeCurrency } from "../shopify/normalize.js";
import type { UcpMetadata, UcpServiceSummary } from "../types.js";
import {
  MAX_UCP_MANIFEST_BYTES,
  UcpManifestSchema,
  type NormalizedUcpProfile,
  type RawUcpManifest
} from "./schema.js";
import {
  isSameRegistrableStoreDomain,
  sanitizeUcpIdentifier,
  sanitizeUcpOptionalText,
  sanitizeUcpVersion,
  validateUcpEndpointUrl
} from "./security.js";

class CrossSiteUcpRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossSiteUcpRedirectError";
  }
}

export type UcpFetcherFn = (
  url: string,
  opts?: SafeFetchOptions
) => Promise<SafeFetchResponse>;

export interface UcpDiscoveryOptions {
  fetcher?: UcpFetcherFn;
  timeoutMs?: number;
  maxBytes?: number;
}

interface CachedDiscoveryEntry {
  profile: NormalizedUcpProfile | null;
  expiresAt: number;
}

const DISCOVERY_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHED_PROFILES = 1000;

const HARD_SSRF_CODES = new Set([
  "INVALID_URL",
  "BLOCKED_HOST",
  "BLOCKED_IP",
  "CONCURRENCY_LIMIT"
]);

const DEFAULT_UCP_HEADERS: Record<string, string> = {
  Accept: "application/json, application/ucp+json;q=0.9",
  "User-Agent": "ShopCart-MCP/1.0 (+https://shopcart.wals.pro)"
};

function isHardSsrfError(err: unknown): boolean {
  return err instanceof SsrfError && HARD_SSRF_CODES.has(err.code);
}

function looksLikeJsonContentType(contentType: string, bodyText: string): boolean {
  const ct = contentType.toLowerCase().trim();
  if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) {
    return false;
  }
  if (ct.includes("application/json") || ct.includes("+json")) {
    return true;
  }
  // Allow missing or generic content-type only if body clearly begins with a JSON object
  const trimmed = bodyText.trimStart();
  return trimmed.startsWith("{");
}

function isCheckoutCapability(cap: string): boolean {
  return (
    cap === "dev.ucp.shopping.checkout" ||
    cap.endsWith(".checkout") ||
    cap.includes(".shopping.checkout")
  );
}

function isCatalogCapability(cap: string): boolean {
  return (
    cap === "dev.ucp.shopping.catalog" ||
    cap === "dev.ucp.shopping.product" ||
    cap === "dev.ucp.shopping.products" ||
    cap === "dev.ucp.shopping.search" ||
    cap.endsWith(".catalog") ||
    cap.endsWith(".product") ||
    cap.endsWith(".products") ||
    cap.endsWith(".catalog_search")
  );
}

export function buildUnsupportedUcpMetadata(origin: string): UcpMetadata {
  const normalizedOrigin = validateExternalUrl(origin).origin;
  return {
    supported: false,
    manifestUrl: `${normalizedOrigin}/.well-known/ucp`,
    version: null,
    capabilities: [],
    services: {},
    endpoints: {},
    checkoutHandoffSupported: false,
    catalogSearchSupported: false,
    liabilityModel: "zero_liability_handoff"
  };
}

/**
 * Parse and validate a raw `/.well-known/ucp` JSON object into a strictly sanitized,
 * SSRF-hardened `NormalizedUcpProfile`.
 */
export function parseUcpManifest(
  rawJson: unknown,
  storeOrigin: string,
  manifestUrl?: string
): NormalizedUcpProfile | null {
  const validatedOrigin = validateExternalUrl(storeOrigin).origin;
  const parsedResult = UcpManifestSchema.safeParse(rawJson);
  if (!parsedResult.success) {
    return null;
  }

  const data: RawUcpManifest = parsedResult.data;
  const version = sanitizeUcpVersion(data.ucp.version);
  if (!version) {
    return null;
  }

  const warnings: string[] = [];
  let rejectedEndpointCount = 0;

  const validateCandidateEndpoint = (rawUrl: unknown): string | null => {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
    const safe = validateUcpEndpointUrl(rawUrl, validatedOrigin);
    if (!safe) {
      rejectedEndpointCount += 1;
      return null;
    }
    return safe;
  };

  // Normalize services (supports both object/map-style and array-style UCP manifests)
  const services: Record<string, UcpServiceSummary> = Object.create(null) as Record<
    string,
    UcpServiceSummary
  >;
  const serviceEntries: Array<{
    key: string;
    entry: {
      version?: string;
      transport?: string;
      endpoint?: string;
      url?: string;
      rest?: { endpoint?: string; url?: string };
      mcp?: { endpoint?: string; url?: string };
      a2a?: { endpoint?: string; url?: string };
    };
  }> = [];

  if (Array.isArray(data.ucp.services)) {
    for (const entry of data.ucp.services) {
      const key = sanitizeUcpIdentifier(entry.name) ?? "dev.ucp.shopping";
      serviceEntries.push({ key, entry });
    }
  } else if (data.ucp.services) {
    for (const [rawKey, val] of Object.entries(data.ucp.services)) {
      const key = sanitizeUcpIdentifier(rawKey);
      if (!key) continue;
      const list = Array.isArray(val) ? val : [val];
      for (const entry of list) {
        serviceEntries.push({ key, entry });
      }
    }
  }

  let primaryRest: string | null = null;
  let primaryMcp: string | null = null;
  let primaryA2a: string | null = null;

  for (const { key, entry } of serviceEntries) {
    const existing: UcpServiceSummary = Object.hasOwn(services, key)
      ? services[key]!
      : {
          version: null,
          restEndpoint: null,
          mcpEndpoint: null,
          a2aEndpoint: null
        };

    const entryVersion = sanitizeUcpVersion(entry.version);
    if (entryVersion && !existing.version) {
      existing.version = entryVersion;
    }

    const restCandidate = entry.rest?.endpoint ?? entry.rest?.url;
    const mcpCandidate = entry.mcp?.endpoint ?? entry.mcp?.url;
    const a2aCandidate = entry.a2a?.endpoint ?? entry.a2a?.url;
    const flatCandidate = entry.endpoint ?? entry.url;
    const transport = entry.transport?.trim().toLowerCase();

    const safeRest =
      validateCandidateEndpoint(restCandidate) ??
      (transport === "rest" || (!transport && flatCandidate && !restCandidate && !mcpCandidate && !a2aCandidate)
        ? validateCandidateEndpoint(flatCandidate)
        : null);
    const safeMcp =
      validateCandidateEndpoint(mcpCandidate) ??
      (transport === "mcp" ? validateCandidateEndpoint(flatCandidate) : null);
    const safeA2a =
      validateCandidateEndpoint(a2aCandidate) ??
      (transport === "a2a" ? validateCandidateEndpoint(flatCandidate) : null);

    if (safeRest && !existing.restEndpoint) existing.restEndpoint = safeRest;
    if (safeMcp && !existing.mcpEndpoint) existing.mcpEndpoint = safeMcp;
    if (safeA2a && !existing.a2aEndpoint) existing.a2aEndpoint = safeA2a;

    services[key] = existing;

    const isShoppingService = key === "dev.ucp.shopping" || key.endsWith(".shopping");
    if (existing.restEndpoint && (!primaryRest || isShoppingService)) {
      primaryRest = existing.restEndpoint;
    }
    if (existing.mcpEndpoint && (!primaryMcp || isShoppingService)) {
      primaryMcp = existing.mcpEndpoint;
    }
    if (existing.a2aEndpoint && (!primaryA2a || isShoppingService)) {
      primaryA2a = existing.a2aEndpoint;
    }
  }

  // Normalize capabilities (supports both array-style and object/map-style UCP manifests)
  const capSet = new Set<string>();
  if (Array.isArray(data.ucp.capabilities)) {
    for (const item of data.ucp.capabilities) {
      const rawName = typeof item === "string" ? item : item.name;
      const clean = sanitizeUcpIdentifier(rawName);
      if (clean) capSet.add(clean);
    }
  } else if (data.ucp.capabilities) {
    for (const [rawKey, val] of Object.entries(data.ucp.capabilities)) {
      if (val === false) continue;
      const cleanKey = sanitizeUcpIdentifier(rawKey);
      if (cleanKey) capSet.add(cleanKey);
      if (Array.isArray(val)) {
        for (const sub of val) {
          const subName = sanitizeUcpIdentifier(sub.name);
          if (subName) capSet.add(subName);
        }
      } else if (typeof val === "object" && val !== null) {
        const subName = sanitizeUcpIdentifier(val.name);
        if (subName) capSet.add(subName);
      }
    }
  }

  const capabilities = Array.from(capSet).slice(0, 64);

  if (rejectedEndpointCount > 0) {
    warnings.push(
      `Ignored ${rejectedEndpointCount} unsafe or cross-site endpoint URL(s) from /.well-known/ucp manifest.`
    );
  }

  const merchantMeta = data.merchant ?? data.business ?? data.store;
  const storeName = sanitizeUcpOptionalText(merchantMeta?.name, 160);
  const rawCurrency = merchantMeta?.currency?.trim().toUpperCase();
  const currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? normalizeCurrency(rawCurrency) : null;
  const rawCountry = merchantMeta?.country?.trim().toUpperCase();
  const country = rawCountry && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null;
  const platformHint = sanitizeUcpOptionalText(merchantMeta?.platform, 80);

  const hasCheckoutCap = capabilities.some(isCheckoutCapability);
  const hasCatalogCap = capabilities.some(isCatalogCapability);

  const checkoutHandoffSupported = Boolean(primaryRest && hasCheckoutCap);
  const catalogSearchSupported = Boolean((primaryRest || primaryMcp) && hasCatalogCap);

  // Copy null-prototype services map into a clean plain object for JSON serialization
  const plainServices: Record<string, UcpServiceSummary> = {};
  for (const [k, v] of Object.entries(services)) {
    plainServices[k] = {
      ...(v.version ? { version: v.version } : {}),
      ...(v.restEndpoint ? { restEndpoint: v.restEndpoint } : {}),
      ...(v.mcpEndpoint ? { mcpEndpoint: v.mcpEndpoint } : {}),
      ...(v.a2aEndpoint ? { a2aEndpoint: v.a2aEndpoint } : {})
    };
  }

  const safeManifestUrl =
    manifestUrl && validateUcpEndpointUrl(manifestUrl, validatedOrigin)
      ? validateUcpEndpointUrl(manifestUrl, validatedOrigin)!
      : `${validatedOrigin}/.well-known/ucp`;

  const metadata: UcpMetadata = {
    supported: true,
    manifestUrl: safeManifestUrl,
    version,
    capabilities,
    services: plainServices,
    endpoints: {
      ...(primaryRest ? { rest: primaryRest } : {}),
      ...(primaryMcp ? { mcp: primaryMcp } : {}),
      ...(primaryA2a ? { a2a: primaryA2a } : {})
    },
    checkoutHandoffSupported,
    catalogSearchSupported,
    liabilityModel: "zero_liability_handoff",
    ...(rejectedEndpointCount > 0 ? { rejectedEndpointCount } : {}),
    ...(warnings.length > 0 ? { warnings } : {})
  };

  return {
    origin: validatedOrigin,
    manifestUrl: safeManifestUrl,
    version,
    storeName,
    currency,
    country,
    platformHint,
    capabilities,
    services: plainServices,
    endpoints: {
      rest: primaryRest,
      mcp: primaryMcp,
      a2a: primaryA2a
    },
    checkoutHandoffSupported,
    catalogSearchSupported,
    rejectedEndpointCount,
    warnings,
    metadata
  };
}

export class UcpDiscoveryClient {
  private readonly fetcher: UcpFetcherFn;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly cache = new Map<string, CachedDiscoveryEntry>();

  constructor(opts: UcpDiscoveryOptions = {}) {
    this.fetcher = opts.fetcher ?? safeFetch;
    this.timeoutMs = opts.timeoutMs ?? 3000;
    this.maxBytes = Math.min(
      MAX_UCP_MANIFEST_BYTES,
      Math.max(4096, opts.maxBytes ?? MAX_UCP_MANIFEST_BYTES)
    );
  }

  clearCache(): void {
    this.cache.clear();
  }

  private setCache(key: string, entry: CachedDiscoveryEntry, now: number): void {
    if (this.cache.size >= MAX_CACHED_PROFILES && !this.cache.has(key)) {
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= now) this.cache.delete(k);
      }
      while (this.cache.size >= MAX_CACHED_PROFILES) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  async discover(
    origin: string,
    opts: { forceRefresh?: boolean; concurrencyKey?: string } = {}
  ): Promise<NormalizedUcpProfile | null> {
    const validatedOrigin = validateExternalUrl(origin).origin;
    const now = Date.now();

    if (!opts.forceRefresh) {
      const cached = this.cache.get(validatedOrigin);
      if (cached && cached.expiresAt > now) {
        return cached.profile;
      }
    }

    const manifestUrl = `${validatedOrigin}/.well-known/ucp`;
    let res: SafeFetchResponse;
    try {
      res = await this.fetcher(manifestUrl, {
        method: "GET",
        headers: DEFAULT_UCP_HEADERS,
        timeoutMs: this.timeoutMs,
        maxRedirects: 2,
        maxBytes: this.maxBytes,
        truncateOnMaxBytes: false,
        concurrencyKey: opts.concurrencyKey,
        validateRedirectUrl: (nextUrl) => {
          if (!isSameRegistrableStoreDomain(validatedOrigin, nextUrl.origin)) {
            throw new CrossSiteUcpRedirectError(
              `Refused cross-site UCP redirect to '${nextUrl.hostname}'`
            );
          }
        }
      });
    } catch (err) {
      if (err instanceof CrossSiteUcpRedirectError) {
        this.setCache(validatedOrigin, { profile: null, expiresAt: now + DISCOVERY_CACHE_TTL_MS }, now);
        return null;
      }
      if (isHardSsrfError(err)) {
        throw err;
      }
      // Network timeouts, BODY_TOO_LARGE, DNS errors mean UCP is unavailable
      this.setCache(validatedOrigin, { profile: null, expiresAt: now + DISCOVERY_CACHE_TTL_MS }, now);
      return null;
    }

    if (res.status !== 200 || !res.bodyText) {
      this.setCache(validatedOrigin, { profile: null, expiresAt: now + DISCOVERY_CACHE_TTL_MS }, now);
      return null;
    }

    // Double-check response size cap even when a custom test fetcher omits maxBytes enforcement
    if (Buffer.byteLength(res.bodyText, "utf8") > this.maxBytes) {
      this.setCache(validatedOrigin, { profile: null, expiresAt: now + DISCOVERY_CACHE_TTL_MS }, now);
      return null;
    }

    if (!looksLikeJsonContentType(res.contentType, res.bodyText)) {
      this.setCache(validatedOrigin, { profile: null, expiresAt: now + DISCOVERY_CACHE_TTL_MS }, now);
      return null;
    }

    // Verify final response URL did not escape the store's registrable domain
    let effectiveOrigin = validatedOrigin;
    let effectiveManifestUrl = manifestUrl;
    if (res.url) {
      try {
        const finalParsed = validateExternalUrl(res.url);
        if (!isSameRegistrableStoreDomain(validatedOrigin, finalParsed.origin)) {
          this.setCache(validatedOrigin, { profile: null, expiresAt: now + DISCOVERY_CACHE_TTL_MS }, now);
          return null;
        }
        if (isSameStoreSite(validatedOrigin, finalParsed.origin)) {
          effectiveOrigin = finalParsed.origin;
        }
        effectiveManifestUrl = `${effectiveOrigin}/.well-known/ucp`;
      } catch {
        this.setCache(validatedOrigin, { profile: null, expiresAt: now + DISCOVERY_CACHE_TTL_MS }, now);
        return null;
      }
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(res.bodyText);
    } catch {
      this.setCache(validatedOrigin, { profile: null, expiresAt: now + DISCOVERY_CACHE_TTL_MS }, now);
      return null;
    }

    const profile = parseUcpManifest(rawJson, effectiveOrigin, effectiveManifestUrl);
    const entry: CachedDiscoveryEntry = {
      profile,
      expiresAt: now + DISCOVERY_CACHE_TTL_MS
    };
    this.setCache(validatedOrigin, entry, now);
    if (effectiveOrigin !== validatedOrigin && isSameStoreSite(validatedOrigin, effectiveOrigin)) {
      this.setCache(effectiveOrigin, entry, now);
    }
    return profile;
  }
}
