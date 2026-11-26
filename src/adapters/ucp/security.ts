import {
  enforceShellSafeHttpsUrl,
  isValidLdhHostname,
  sanitizeGenericVariantId
} from "../../security/identifiers.js";
import {
  isSameStoreSite,
  sanitizeOptionalText,
  sanitizeText,
  stripControlAndInvisible,
  stripHtmlToText
} from "../../security/sanitize.js";
import { SsrfError, validateExternalUrl } from "../../security/ssrf.js";

const MAX_UCP_URL_LENGTH = 2048;

const LLM_CONTROL_TOKEN_RE = /<\|[^|\r\n]{1,40}\|>|<<\/?SYS>>|\[\/?INST\]/gi;

/**
 * Known 2-label public suffixes (ccSLDs) where the registrable domain requires 3 labels.
 */
const TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "net.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.nz",
  "org.nz",
  "co.za",
  "com.br",
  "com.mx",
  "com.tr",
  "com.be",
  "co.at",
  "or.at",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.kr",
  "co.in",
  "com.ar",
  "com.co",
  "com.pe",
  "com.pl",
  "com.es",
  "com.fr",
  "com.de",
  "com.cn"
]);

/**
 * Shared multi-tenant hosting/e-commerce platform suffixes where each tenant lives at
 * `<tenant>.<suffix>`. Two different tenants under these suffixes MUST NEVER be treated
 * as same-site (e.g. `evil.myshopify.com` MUST NOT match `victim.myshopify.com`,
 * `evil.wixsite.com` MUST NOT match `victim.wixsite.com`).
 */
const MULTI_TENANT_PLATFORM_SUFFIXES = new Set([
  "myshopify.com",
  "mybigcommerce.com",
  "wixsite.com",
  "wixstudio.com",
  "wixstatic.com",
  "shopware.store",
  "squarespace.com",
  "bigcartel.com",
  "ecwid.com",
  "vercel.app",
  "netlify.app",
  "herokuapp.com",
  "github.io",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "appspot.com",
  "run.app",
  "cloudfront.net",
  "azurewebsites.net",
  "amazonaws.com",
  "fly.dev",
  "railway.app",
  "onrender.com"
]);

/**
 * Compute the tenant-scoped registrable domain (eTLD+1, or tenant+platform suffix for
 * multi-tenant platforms) for a validated RFC 1123 LDH hostname.
 *
 * Returns `null` if the hostname is invalid or is itself a bare public/platform suffix.
 */
export function getTenantRegistrableDomain(rawHostname: string): string | null {
  if (!rawHostname || typeof rawHostname !== "string") return null;
  const host = rawHostname.toLowerCase().replace(/\.$/, "");
  if (!isValidLdhHostname(host)) return null;

  const labels = host.split(".");
  if (labels.length < 2) return null;

  const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
  if (TWO_LABEL_PUBLIC_SUFFIXES.has(lastTwo) || MULTI_TENANT_PLATFORM_SUFFIXES.has(lastTwo)) {
    // Reject bare public/platform suffixes (e.g. "co.uk", "myshopify.com")
    if (labels.length < 3) return null;
    return `${labels[labels.length - 3]}.${lastTwo}`;
  }

  return lastTwo;
}

/**
 * Strict same-site / same-tenant-registrable-domain check for UCP endpoints and
 * checkout `continue_url` handoff links.
 *
 * Allows:
 *  - Exact origin match (`https://shop.example` <-> `https://shop.example`)
 *  - Apex <-> www (`https://shop.example` <-> `https://www.shop.example`)
 *  - Subdomains of the same merchant registrable domain
 *    (`https://shop.brand.example` <-> `https://api.brand.example` / `https://checkout.brand.example`)
 *  - Subdomains of a single tenant on a multi-tenant platform
 *    (`https://acme.myshopify.com` <-> `https://ucp.acme.myshopify.com`)
 *
 * Rejects:
 *  - Different domains (`evil-third-party.example`)
 *  - Lookalike suffixes (`shop.example.evil.com`)
 *  - Cross-tenant siblings on multi-tenant platforms (`evil.myshopify.com` vs `acme.myshopify.com`)
 *  - Any non-HTTPS, IP literal, localhost, internal suffix, or userinfo URL.
 */
export function isSameRegistrableStoreDomain(
  storeOrigin: string,
  candidateOrigin: string
): boolean {
  if (isSameStoreSite(storeOrigin, candidateOrigin)) {
    try {
      const s = validateExternalUrl(storeOrigin);
      const c = validateExternalUrl(candidateOrigin);
      return s.protocol === "https:" && c.protocol === "https:";
    } catch {
      return false;
    }
  }

  try {
    const storeParsed = validateExternalUrl(storeOrigin);
    const candParsed = validateExternalUrl(candidateOrigin);
    if (storeParsed.protocol !== "https:" || candParsed.protocol !== "https:") {
      return false;
    }
    const storeReg = getTenantRegistrableDomain(storeParsed.hostname);
    const candReg = getTenantRegistrableDomain(candParsed.hostname);
    if (!storeReg || !candReg) return false;
    return storeReg === candReg;
  } catch {
    return false;
  }
}

export function assertSameRegistrableStoreDomain(storeOrigin: string, candidateUrl: URL): void {
  if (!isSameRegistrableStoreDomain(storeOrigin, candidateUrl.origin)) {
    throw new SsrfError(
      "BLOCKED_HOST",
      `Cross-site UCP redirect or endpoint host '${candidateUrl.hostname}' does not match store registrable domain`
    );
  }
}

export interface ValidateUcpUrlOptions {
  /** Whether query string parameters are permitted (true for continue_url/product URLs, false for API base endpoints). */
  allowQuery?: boolean;
  /** Whether root-relative paths starting with a single `/` may be resolved against storeOrigin. */
  allowRelativePath?: boolean;
}

/**
 * Strictly validate an untrusted URL from a `/.well-known/ucp` manifest or UCP endpoint response.
 *
 * Enforces:
 *  - HTTPS only (blocks http:, javascript:, data:, file:, vbscript:, etc.)
 *  - No protocol-relative `//host` smuggling
 *  - No embedded credentials (`user:pass@host`)
 *  - No non-standard ports (only default / 443)
 *  - No IP literals (IPv4 or IPv6), localhost, `.internal`, `.local`, or single-label hosts
 *  - Strict same-registrable-domain match against `storeOrigin` (tenant-isolated on shared platforms)
 *  - No control characters, whitespace, fragments, or shell metacharacters
 */
export function validateUcpUrl(
  rawUrl: unknown,
  storeOrigin: string,
  opts: ValidateUcpUrlOptions = {}
): string | null {
  if (typeof rawUrl !== "string") return null;
  const cleaned = stripControlAndInvisible(rawUrl).trim();
  if (!cleaned || cleaned.length > MAX_UCP_URL_LENGTH) return null;
  if (/[\x00-\x1f\x7f\s]/.test(cleaned)) return null;
  // Block protocol-relative URLs and hash fragments
  if (cleaned.startsWith("//") || cleaned.includes("#")) return null;

  let candidate = cleaned;
  if (cleaned.startsWith("/")) {
    if (!opts.allowRelativePath) return null;
    if (cleaned.includes("..") || cleaned.includes("\\")) return null;
    try {
      const base = validateExternalUrl(storeOrigin);
      candidate = `${base.origin}${cleaned}`;
    } catch {
      return null;
    }
  }

  let parsed: URL;
  try {
    parsed = validateExternalUrl(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port !== "" && parsed.port !== "443") return null;
  if (parsed.hash) return null;
  if (!opts.allowQuery && parsed.search) return null;

  if (!isSameRegistrableStoreDomain(storeOrigin, parsed.origin)) {
    return null;
  }

  const shellSafe = enforceShellSafeHttpsUrl(parsed.toString());
  if (!shellSafe || shellSafe.length > MAX_UCP_URL_LENGTH) return null;

  return shellSafe;
}

/**
 * Validate a UCP service/API endpoint URL (REST, MCP, A2A) discovered in `/.well-known/ucp`.
 * Strips trailing slash for deterministic sub-path joining.
 */
export function validateUcpEndpointUrl(rawUrl: unknown, storeOrigin: string): string | null {
  const validated = validateUcpUrl(rawUrl, storeOrigin, {
    allowQuery: false,
    allowRelativePath: false
  });
  if (!validated) return null;
  return validated.replace(/\/+$/, "");
}

/**
 * Validate a `continue_url` / checkout escalation URL returned by a UCP checkout endpoint.
 * Query parameters (e.g. merchant session token) are allowed and shell-escaped,
 * while scheme, credentials, host, IP/metadata, and registrable-domain checks remain strict.
 */
export function validateUcpContinueUrl(rawUrl: unknown, storeOrigin: string): string | null {
  return validateUcpUrl(rawUrl, storeOrigin, {
    allowQuery: true,
    allowRelativePath: true
  });
}

/**
 * Sanitize untrusted merchant text from UCP manifests or responses against prompt injection:
 * strips HTML/comments/tags, invisible Unicode tags & BiDi overrides, and LLM control tokens.
 */
export function sanitizeUcpText(input: unknown, maxLen: number): string {
  if (typeof input !== "string" && typeof input !== "number") return "";
  const raw = String(input);
  const bounded = raw.length > Math.max(maxLen * 16, 32_768)
    ? raw.slice(0, Math.max(maxLen * 16, 32_768))
    : raw;
  const plain = stripHtmlToText(bounded, maxLen + 64).replace(LLM_CONTROL_TOKEN_RE, "");
  return sanitizeText(plain, maxLen);
}

export function sanitizeUcpOptionalText(input: unknown, maxLen: number): string | null {
  const cleaned = sanitizeUcpText(input, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

const UCP_VERSION_RE = /^[0-9A-Za-z._-]{1,32}$/;
const UCP_IDENTIFIER_RE = /^[a-z0-9](?:[a-z0-9._-]{0,118}[a-z0-9])?$/;

export function sanitizeUcpVersion(raw: unknown): string | null {
  const text = sanitizeOptionalText(typeof raw === "string" ? raw : null, 32);
  if (!text) return null;
  return UCP_VERSION_RE.test(text) ? text : null;
}

export function sanitizeUcpIdentifier(raw: unknown): string | null {
  const text = sanitizeOptionalText(typeof raw === "string" ? raw : null, 120);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes("..")) return null;
  return UCP_IDENTIFIER_RE.test(lower) ? lower : null;
}

export function sanitizeUcpSessionId(raw: unknown): string | null {
  return sanitizeGenericVariantId(raw);
}

export function formatSafeUcpErrorUrl(rawUrl: string): string {
  return enforceShellSafeHttpsUrl(rawUrl) ?? "[redacted-url]";
}
