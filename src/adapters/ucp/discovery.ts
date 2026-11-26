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
  MAX_UCP_CACHED_PROFILE_BYTES,
  MAX_UCP_CAPABILITIES_NORMALIZED,
  MAX_UCP_MANIFEST_BYTES,
  MAX_UCP_SERVICES_NORMALIZED,
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
  maxCachedProfiles?: number;
}

interface CachedDiscoveryEntry {
  profile: NormalizedUcpProfile | null;
  expiresAt: number;
}

const DISCOVERY_CACHE_TTL_MS = 15 * 60 * 1000;
export const MAX_CACHED_UCP_PROFILES = 256;

const DEFAULT_UCP_HEADERS: Record<string, string> = {
  Accept: "application/json, application/ucp+json;q=0.9",
  "User-Agent": "ShopCart-MCP/1.0 (+https://shopcart.wals.pro)"
};

/**
 * Distinguish a direct SSRF/concurrency error on the user-supplied store origin itself
 * (which MUST be rethrown) from a redirect-triggered SSRF error emitted when a valid
 * public store's `/.well-known/ucp` redirects to an internal IP or blocked host (which
 * should degrade UCP discovery cleanly to `null`).
 */
function isDirectOriginSsrfError(err: unknown, storeHostname: string): boolean {
  if (!(err instanceof SsrfError)) return false;
  if (err.code === "CONCURRENCY_LIMIT") return true;
  if (err.code === "BLOCKED_IP") {
    // Only rethrow if the user-supplied store hostname itself resolved to a blocked IP
    const expectedSuffix = `for ${storeHostname}`;
    return err.message.toLowerCase().endsWith(expectedSuffix.toLowerCase());
  }
  return false;
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

function isShoppingServiceKey(key: string): boolean {
  return key === "dev.ucp.shopping" || key.endsWith(".shopping");
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

function buildMetadataFromParts(parts: {
  manifestUrl: string;
  version: string;
  capabilities: string[];
  services: Record<string, UcpServiceSummary>;
  endpoints: { rest: string | null; mcp: string | null; a2a: string | null };
  checkoutHandoffSupported: boolean;
  catalogSearchSupported: boolean;
  rejectedEndpointCount: number;
  warnings: string[];
}): UcpMetadata {
  return {
    supported: true,
    manifestUrl: parts.manifestUrl,
    version: parts.version,
    capabilities: parts.capabilities,
    services: parts.services,
    endpoints: {
      ...(parts.endpoints.rest ? { rest: parts.endpoints.rest } : {}),
      ...(parts.endpoints.mcp ? { mcp: parts.endpoints.mcp } : {}),
      ...(parts.endpoints.a2a ? { a2a: parts.endpoints.a2a } : {})
    },
    checkoutHandoffSupported: parts.checkoutHandoffSupported,
    catalogSearchSupported: parts.catalogSearchSupported,
    liabilityModel: "zero_liability_handoff",
    ...(parts.rejectedEndpointCount > 0
      ? { rejectedEndpointCount: parts.rejectedEndpointCount }
      : {}),
    ...(parts.warnings.length > 0 ? { warnings: parts.warnings } : {})
  };
}

function measureProfileBytes(profile: NormalizedUcpProfile): number {
  return Buffer.byteLength(JSON.stringify(profile), "utf8");
}

/**
 * Enforce a hard serialized JSON byte budget (`<= MAX_UCP_CACHED_PROFILE_BYTES`, 8 KB)
 * on the normalized UCP profile so neither the discovery cache nor the registry cache
 * can retain attacker-sized endpoint maps.
 */
function enforceProfileByteBudget(profile: NormalizedUcpProfile): NormalizedUcpProfile {
  if (measureProfileBytes(profile) <= MAX_UCP_CACHED_PROFILE_BYTES) {
    return profile;
  }

  let services: Record<string, UcpServiceSummary> = { ...profile.services };
  let capabilities = [...profile.capabilities];
  let warnings = [...profile.warnings];
  let storeName = profile.storeName;
  let platformHint = profile.platformHint;

  const rebuild = (): NormalizedUcpProfile => {
    const metadata = buildMetadataFromParts({
      manifestUrl: profile.manifestUrl,
      version: profile.version,
      capabilities,
      services,
      endpoints: profile.endpoints,
      checkoutHandoffSupported: profile.checkoutHandoffSupported,
      catalogSearchSupported: profile.catalogSearchSupported,
      rejectedEndpointCount: profile.rejectedEndpointCount,
      warnings
    });
    return {
      ...profile,
      storeName,
      platformHint,
      capabilities,
      services,
      warnings,
      metadata
    };
  };

  // Step 1: Drop non-shopping services first, then trim remaining services if still over budget
  const serviceKeys = Object.keys(services);
  const nonShoppingKeys = serviceKeys.filter((k) => !isShoppingServiceKey(k));
  const shoppingKeys = serviceKeys.filter((k) => isShoppingServiceKey(k));
  const dropOrder = [...nonShoppingKeys.reverse(), ...shoppingKeys.slice(1).reverse(), ...shoppingKeys.slice(0, 1)];

  for (const key of dropOrder) {
    delete services[key];
    const candidate = rebuild();
    if (measureProfileBytes(candidate) <= MAX_UCP_CACHED_PROFILE_BYTES) {
      return candidate;
    }
  }

  // Step 2: Trim warnings
  if (warnings.length > 1) {
    warnings = warnings.slice(0, 1);
    const candidate = rebuild();
    if (measureProfileBytes(candidate) <= MAX_UCP_CACHED_PROFILE_BYTES) {
      return candidate;
    }
  }

  // Step 3: Trim non-core capabilities while keeping checkout/catalog capabilities
  const coreCaps = capabilities.filter((c) => isCheckoutCapability(c) || isCatalogCapability(c));
  const extraCaps = capabilities.filter((c) => !isCheckoutCapability(c) && !isCatalogCapability(c));
  while (extraCaps.length > 0) {
    extraCaps.pop();
    capabilities = [...coreCaps, ...extraCaps];
    const candidate = rebuild();
    if (measureProfileBytes(candidate) <= MAX_UCP_CACHED_PROFILE_BYTES) {
      return candidate;
    }
  }

  // Step 4: Trim optional text fields and warnings if still over budget
  warnings = [];
  storeName = storeName ? storeName.slice(0, 80) : null;
  platformHint = platformHint ? platformHint.slice(0, 40) : null;
  services = {};
  capabilities = coreCaps.slice(0, 4);
  const finalCandidate = rebuild();
  if (measureProfileBytes(finalCandidate) <= MAX_UCP_CACHED_PROFILE_BYTES) {
    return finalCandidate;
  }

  // Guaranteed minimal backstop strictly under 8 KB
  capabilities = [];
  storeName = null;
  platformHint = null;
  return rebuild();
}

/**
 * Parse and validate a raw `/.well-known/ucp` JSON object into a strictly sanitized,
 * SSRF-hardened, byte-budgeted `NormalizedUcpProfile`.
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
      (transport === "rest" ||
      (!transport && flatCandidate && !restCandidate && !mcpCandidate && !a2aCandidate)
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

    const isShopping = isShoppingServiceKey(key);
    if (existing.restEndpoint && (!primaryRest || isShopping)) {
      primaryRest = existing.restEndpoint;
    }
    if (existing.mcpEndpoint && (!primaryMcp || isShopping)) {
      primaryMcp = existing.mcpEndpoint;
    }
    if (existing.a2aEndpoint && (!primaryA2a || isShopping)) {
      primaryA2a = existing.a2aEndpoint;
    }
  }

  // Prioritize shopping services and strictly cap to MAX_UCP_SERVICES_NORMALIZED (8)
  const orderedServiceEntries = Object.entries(services).sort(([a], [b]) => {
    const aShop = isShoppingServiceKey(a) ? 0 : 1;
    const bShop = isShoppingServiceKey(b) ? 0 : 1;
    return aShop - bShop;
  });

  const plainServices: Record<string, UcpServiceSummary> = {};
  for (const [k, v] of orderedServiceEntries.slice(0, MAX_UCP_SERVICES_NORMALIZED)) {
    plainServices[k] = {
      ...(v.version ? { version: v.version } : {}),
      ...(v.restEndpoint ? { restEndpoint: v.restEndpoint } : {}),
      ...(v.mcpEndpoint ? { mcpEndpoint: v.mcpEndpoint } : {}),
      ...(v.a2aEndpoint ? { a2aEndpoint: v.a2aEndpoint } : {})
    };
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

  // Prioritize checkout/catalog capabilities before capping to MAX_UCP_CAPABILITIES_NORMALIZED (16)
  const allCaps = Array.from(capSet);
  const prioritizedCaps = [
    ...allCaps.filter((c) => isCheckoutCapability(c) || isCatalogCapability(c)),
    ...allCaps.filter((c) => !isCheckoutCapability(c) && !isCatalogCapability(c))
  ];
  const capabilities = prioritizedCaps.slice(0, MAX_UCP_CAPABILITIES_NORMALIZED);

  if (rejectedEndpointCount > 0) {
    warnings.push(
      `Ignored ${rejectedEndpointCount} unsafe or cross-site endpoint URL(s) from /.well-known/ucp manifest.`
    );
  }

  const merchantMeta = data.merchant ?? data.business ?? data.store;
  const storeName = sanitizeUcpOptionalText(merchantMeta?.name, 160);
  const rawCurrency = merchantMeta?.currency?.trim().toUpperCase();
  const currency =
    rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? normalizeCurrency(rawCurrency) : null;
  const rawCountry = merchantMeta?.country?.trim().toUpperCase();
  const country = rawCountry && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null;
  const platformHint = sanitizeUcpOptionalText(merchantMeta?.platform, 80);

  const hasCheckoutCap = capabilities.some(isCheckoutCapability);
  const hasCatalogCap = capabilities.some(isCatalogCapability);

  const checkoutHandoffSupported = Boolean(primaryRest && hasCheckoutCap);
  const catalogSearchSupported = Boolean((primaryRest || primaryMcp) && hasCatalogCap);

  const safeManifestUrl =
    manifestUrl && validateUcpEndpointUrl(manifestUrl, validatedOrigin)
      ? validateUcpEndpointUrl(manifestUrl, validatedOrigin)!
      : `${validatedOrigin}/.well-known/ucp`;

  const endpoints = {
    rest: primaryRest,
    mcp: primaryMcp,
    a2a: primaryA2a
  };

  const metadata = buildMetadataFromParts({
    manifestUrl: safeManifestUrl,
    version,
    capabilities,
    services: plainServices,
    endpoints,
    checkoutHandoffSupported,
    catalogSearchSupported,
    rejectedEndpointCount,
    warnings
  });

  const normalized: NormalizedUcpProfile = {
    origin: validatedOrigin,
    manifestUrl: safeManifestUrl,
    version,
    storeName,
    currency,
    country,
    platformHint,
    capabilities,
    services: plainServices,
    endpoints,
    checkoutHandoffSupported,
    catalogSearchSupported,
    rejectedEndpointCount,
    warnings,
    metadata
  };

  return enforceProfileByteBudget(normalized);
}

export class UcpDiscoveryClient {
  private readonly fetcher: UcpFetcherFn;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxCachedProfiles: number;
  private readonly cache = new Map<string, CachedDiscoveryEntry>();

  constructor(opts: UcpDiscoveryOptions = {}) {
    this.fetcher = opts.fetcher ?? safeFetch;
    this.timeoutMs = opts.timeoutMs ?? 3000;
    this.maxBytes = Math.min(
      MAX_UCP_MANIFEST_BYTES,
      Math.max(4096, opts.maxBytes ?? MAX_UCP_MANIFEST_BYTES)
    );
    this.maxCachedProfiles = Math.min(
      MAX_CACHED_UCP_PROFILES,
      Math.max(16, opts.maxCachedProfiles ?? MAX_CACHED_UCP_PROFILES)
    );
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  private setCache(key: string, entry: CachedDiscoveryEntry, now: number): void {
    if (this.cache.size >= this.maxCachedProfiles && !this.cache.has(key)) {
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= now) this.cache.delete(k);
      }
      while (this.cache.size >= this.maxCachedProfiles) {
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
    // Always strictly validate the user-supplied store origin first (direct SSRF always throws)
    const validatedParsed = validateExternalUrl(origin);
    const validatedOrigin = validatedParsed.origin;
    const storeHostname = validatedParsed.hostname.toLowerCase().replace(/\.$/, "");
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
      // Rethrow direct SSRF on the user-supplied store host (e.g. DNS rebinding to private IP) or concurrency limits;
      // degrade redirect-triggered SSRF errors on already-valid public stores cleanly to null.
      if (isDirectOriginSsrfError(err, storeHostname)) {
        throw err;
      }
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

    // Verify final response URL did not escape the store's tenant domain
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
