import { safeFetch, type SafeFetchOptions, type SafeFetchResponse } from "../security/ssrf.js";
import type { ClientAuthMethod } from "../store/types.js";
import { isValidRedirectUri } from "./validation.js";

export interface ResolvedOAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: ClientAuthMethod;
  clientSecretHash: string | null;
  grantTypes: string[];
  isCimd: boolean;
  applicationType: "web" | "native";
}

interface CimdCacheEntry {
  client: ResolvedOAuthClient;
  freshUntil: number;
  staleUntil: number;
}

const MIN_CACHE_SECONDS = 60;
const MAX_CACHE_SECONDS = 300;
const STALE_FALLBACK_MS = 12 * 60 * 60 * 1000;
const MAX_CIMD_BYTES = 8192;

const SHARED_SECRET_METHODS = new Set([
  "client_secret_basic",
  "client_secret_post",
  "client_secret_jwt"
]);

const FIRST_PARTY_PINS: Record<string, ResolvedOAuthClient> = {
  "https://claude.ai/oauth/mcp-oauth-client-metadata": {
    clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
    clientName: "Claude",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    tokenEndpointAuthMethod: "none",
    clientSecretHash: null,
    grantTypes: ["authorization_code", "refresh_token"],
    isCimd: true,
    applicationType: "web"
  },
  "https://claude.ai/oauth/claude-code-client-metadata": {
    clientId: "https://claude.ai/oauth/claude-code-client-metadata",
    clientName: "Claude Code",
    redirectUris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    tokenEndpointAuthMethod: "none",
    clientSecretHash: null,
    grantTypes: ["authorization_code", "refresh_token"],
    isCimd: true,
    applicationType: "native"
  },
  "https://chatgpt.com/oauth/client.json": {
    clientId: "https://chatgpt.com/oauth/client.json",
    clientName: "ChatGPT",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    tokenEndpointAuthMethod: "none",
    clientSecretHash: null,
    grantTypes: ["authorization_code", "refresh_token"],
    isCimd: true,
    applicationType: "web"
  }
};

export function isCimdClientId(clientId: string): boolean {
  if (!clientId || !clientId.startsWith("https://")) return false;
  try {
    const u = new URL(clientId);
    if (u.protocol !== "https:") return false;
    if (!u.pathname || u.pathname === "/") return false;
    if (u.username || u.password || u.hash) return false;
    if (u.port !== "" && u.port !== "443") return false;
    return true;
  } catch {
    return false;
  }
}

function parseCacheSeconds(cacheControl: string | undefined): number {
  if (!cacheControl) return MIN_CACHE_SECONDS;
  const match = cacheControl.match(/max-age\s*=\s*(\d+)/i);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : 0;
  return Math.max(MIN_CACHE_SECONDS, Math.min(MAX_CACHE_SECONDS, parsed));
}

export function parseAndProjectCimdDocument(
  expectedClientId: string,
  rawDoc: unknown
): ResolvedOAuthClient {
  if (!rawDoc || typeof rawDoc !== "object" || Array.isArray(rawDoc)) {
    throw new Error("CIMD document must be a JSON object");
  }
  const doc = rawDoc as Record<string, unknown>;

  if (doc.client_id !== expectedClientId) {
    throw new Error("CIMD client_id does not match fetched URL");
  }

  // Auth method validation & SEP-3149 ChatGPT projection
  const declaredMethod =
    typeof doc.token_endpoint_auth_method === "string"
      ? doc.token_endpoint_auth_method
      : "none";

  if (SHARED_SECRET_METHODS.has(declaredMethod)) {
    throw new Error(`CIMD cannot declare shared-secret auth method: ${declaredMethod}`);
  }

  let resolvedAuthMethod: ClientAuthMethod = "none";
  if (declaredMethod === "none") {
    resolvedAuthMethod = "none";
  } else if (declaredMethod === "private_key_jwt") {
    const supported = Array.isArray(doc.token_endpoint_auth_methods_supported)
      ? doc.token_endpoint_auth_methods_supported.map(String)
      : [];
    if (supported.includes("none")) {
      // SEP-3149 (ChatGPT): client supports negotiating "none"
      resolvedAuthMethod = "none";
    } else {
      throw new Error("CIMD requires unsupported private_key_jwt without 'none' fallback");
    }
  } else {
    throw new Error(`Unsupported CIMD token_endpoint_auth_method: ${declaredMethod}`);
  }

  // Grant projection (ignore unsupported grants like jwt-bearer or device_code)
  const rawGrants = Array.isArray(doc.grant_types)
    ? doc.grant_types.map(String)
    : ["authorization_code", "refresh_token"];
  const projectedGrants = rawGrants.filter(
    (g) => g === "authorization_code" || g === "refresh_token"
  );
  if (!projectedGrants.includes("authorization_code")) {
    throw new Error("CIMD must support authorization_code grant");
  }

  // Redirect URIs (allow explicit native to mix loopback + https, e.g. VS Code)
  const rawRedirects = Array.isArray(doc.redirect_uris) ? doc.redirect_uris : [];
  const validRedirects = rawRedirects
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(isValidRedirectUri);

  if (validRedirects.length === 0) {
    throw new Error("CIMD has no valid redirect_uris");
  }

  const appType = doc.application_type === "native" ? "native" : "web";
  const clientName =
    typeof doc.client_name === "string" && doc.client_name.trim()
      ? doc.client_name.trim().slice(0, 120)
      : new URL(expectedClientId).hostname;

  return {
    clientId: expectedClientId,
    clientName,
    redirectUris: Array.from(new Set(validRedirects)),
    tokenEndpointAuthMethod: resolvedAuthMethod,
    clientSecretHash: null,
    grantTypes: Array.from(new Set(projectedGrants)),
    isCimd: true,
    applicationType: appType
  };
}

export type CimdFetcher = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResponse>;

export class CimdResolver {
  private readonly cache = new Map<string, CimdCacheEntry>();
  private readonly fetcher: CimdFetcher;

  constructor(fetcher: CimdFetcher = safeFetch) {
    this.fetcher = fetcher;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async resolve(clientId: string): Promise<ResolvedOAuthClient> {
    if (!isCimdClientId(clientId)) {
      throw new Error("Invalid CIMD client_id URL");
    }

    const now = Date.now();
    const cached = this.cache.get(clientId);
    if (cached && cached.freshUntil > now) {
      return cached.client;
    }

    try {
      const res = await this.fetcher(clientId, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "shopcart-mcp/0.1 (OAuth CIMD Resolver)"
        },
        maxRedirects: 0,
        maxBytes: MAX_CIMD_BYTES,
        timeoutMs: 5000,
        concurrencyKey: "cimd"
      });

      if (res.status !== 200) {
        throw new Error(`CIMD fetch returned HTTP ${res.status}`);
      }
      if (!res.contentType.toLowerCase().includes("json")) {
        throw new Error(`CIMD returned non-JSON content-type: ${res.contentType}`);
      }

      const parsed = JSON.parse(res.bodyText) as unknown;
      const client = parseAndProjectCimdDocument(clientId, parsed);
      const ttlSeconds = parseCacheSeconds(res.headers["cache-control"]);

      this.cache.set(clientId, {
        client,
        freshUntil: now + ttlSeconds * 1000,
        staleUntil: now + STALE_FALLBACK_MS
      });

      return client;
    } catch (err) {
      // Stale-while-error fallback up to 12 hours
      if (cached && cached.staleUntil > now) {
        return cached.client;
      }
      // First-party pin fallback for Claude.ai & Claude Code
      const pin = FIRST_PARTY_PINS[clientId];
      if (pin) {
        this.cache.set(clientId, {
          client: pin,
          freshUntil: now + MIN_CACHE_SECONDS * 1000,
          staleUntil: now + STALE_FALLBACK_MS
        });
        return pin;
      }
      throw err;
    }
  }
}
