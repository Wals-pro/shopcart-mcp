import { sha256Base64Url, timingSafeEqualStr } from "./crypto.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function isLoopbackUri(rawUri: string): boolean {
  try {
    const u = new URL(rawUri);
    return u.protocol === "http:" && isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

export function isValidRedirectUri(rawUri: string): boolean {
  if (!rawUri || typeof rawUri !== "string") return false;
  try {
    const u = new URL(rawUri);
    if (u.hash) return false;
    if (u.username || u.password) return false;
    if (u.protocol === "https:") {
      return Boolean(u.hostname && u.hostname.includes("."));
    }
    if (u.protocol === "http:") {
      return isLoopbackHost(u.hostname);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * RFC 8252 §7.3 exact + loopback any-port redirect URI matching.
 * - Scheme must match exactly.
 * - Host must match literally (NO localhost <-> 127.0.0.1 cross-match!).
 * - Path and query must match exactly.
 * - For loopback http:// URIs, any port matches.
 */
export function matchRedirectUri(presented: string, registeredList: string[]): boolean {
  if (!isValidRedirectUri(presented)) return false;
  if (registeredList.includes(presented)) return true;

  let p: URL;
  try {
    p = new URL(presented);
  } catch {
    return false;
  }

  if (p.protocol !== "http:" || !isLoopbackHost(p.hostname)) {
    return false;
  }

  for (const reg of registeredList) {
    let r: URL;
    try {
      r = new URL(reg);
    } catch {
      continue;
    }
    if (r.protocol !== "http:") continue;
    if (r.hostname.toLowerCase() !== p.hostname.toLowerCase()) continue;
    if (r.pathname !== p.pathname) continue;
    if (r.search !== p.search) continue;
    return true;
  }

  return false;
}

/**
 * Cursor sends private-use schemes (cursor://...) alongside loopback/HTTPS.
 * Drop private-use/invalid URIs rather than failing registration, require >= 1 surviving valid URI.
 */
export function filterDcrRedirectUris(rawUris: unknown): {
  accepted: string[];
  dropped: string[];
  hasLoopback: boolean;
} {
  if (!Array.isArray(rawUris)) {
    return { accepted: [], dropped: [], hasLoopback: false };
  }
  const accepted: string[] = [];
  const dropped: string[] = [];
  let hasLoopback = false;

  for (const item of rawUris) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (isValidRedirectUri(trimmed)) {
      if (!accepted.includes(trimmed)) {
        accepted.push(trimmed);
        if (isLoopbackUri(trimmed)) hasLoopback = true;
      }
    } else {
      dropped.push(trimmed);
    }
  }

  return { accepted, dropped, hasLoopback };
}

/**
 * RFC 8707 resource validation:
 * Accept canonical `${APP_ORIGIN}/mcp` (ignoring fragment & single trailing slash) or omitted -> canonical.
 * Reject any foreign/non-canonical resource fail-closed.
 */
export function resolveResourceParam(
  rawResource: string | undefined | null,
  canonicalResource: string
): { ok: true; resource: string } | { ok: false; error: "invalid_target"; description: string } {
  const canonicalUrl = new URL(canonicalResource);
  const canonicalNormalized = `${canonicalUrl.origin}${canonicalUrl.pathname.replace(/\/+$/, "")}`;

  if (!rawResource || rawResource.trim() === "") {
    return { ok: true, resource: canonicalNormalized };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawResource.trim());
  } catch {
    return {
      ok: false,
      error: "invalid_target",
      description: "Malformed resource URI"
    };
  }

  const presentedNormalized = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  if (presentedNormalized !== canonicalNormalized || parsed.search !== "") {
    return {
      ok: false,
      error: "invalid_target",
      description: `Resource must match ${canonicalNormalized}`
    };
  }

  return { ok: true, resource: canonicalNormalized };
}

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (
    !codeVerifier ||
    codeVerifier.length < 43 ||
    codeVerifier.length > 128 ||
    !/^[A-Za-z0-9._~-]+$/.test(codeVerifier)
  ) {
    return false;
  }
  const computed = sha256Base64Url(codeVerifier);
  return timingSafeEqualStr(computed, codeChallenge);
}

export function normalizeScopes(rawScope: string | undefined | null): string[] {
  const trimmed = (rawScope ?? "").trim();
  if (!trimmed) return ["mcp:read"];
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const supported = parts.filter((s) => s === "mcp:read");
  return supported.length > 0 ? Array.from(new Set(supported)) : ["mcp:read"];
}
