import {
  enforceShellSafeHttpsUrl,
  isValidLdhHostname,
  sanitizeGenericVariantId
} from "../../security/identifiers.js";
import {
  sanitizeOptionalText,
  sanitizeText,
  stripControlAndInvisible,
  stripHtmlToText
} from "../../security/sanitize.js";
import { SsrfError, validateExternalUrl } from "../../security/ssrf.js";
import { MAX_UCP_ENDPOINT_URL_LENGTH } from "./schema.js";

const MAX_UCP_URL_LENGTH = 2048;
const MAX_CONTROL_TOKEN_STRIP_PASSES = 10;

const LLM_CONTROL_TOKEN_RE = /<\|[^|\r\n]{0,40}\|>|<<\/?SYS>>|\[\/?INST\]/gi;

/**
 * Comprehensive 2-label public ccSLD and multi-tenant PaaS/cloud/e-commerce suffixes.
 *
 * Defense-in-depth alongside our fail-closed label rule:
 * - Any host with >= 3 labels (outside `www.<non-shared 2-label>`) ALWAYS fails closed
 *   to exact-host or direct-subdomain-of-storeHost only (so even unlisted multi-tenant
 *   suffixes like `a.run.app`, `europe-west1.run.app`, `s3.amazonaws.com`, `r.appspot.com`,
 *   or future PaaS domains NEVER collapse sibling tenants).
 * - Any 2-label host in this set (or `www.<suffix-in-this-set>`) also fails closed so
 *   `www.webflow.io` or `www.co.il` can never match another tenant under that suffix.
 */
const SHARED_OR_PUBLIC_TWO_LABEL_SUFFIXES = new Set([
  // Common 2-label ccSLDs / public suffixes
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "net.uk",
  "co.il",
  "org.il",
  "ac.il",
  "gov.il",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "go.jp",
  "co.nz",
  "org.nz",
  "net.nz",
  "co.za",
  "org.za",
  "com.br",
  "net.br",
  "org.br",
  "com.mx",
  "org.mx",
  "com.tr",
  "org.tr",
  "com.be",
  "co.at",
  "or.at",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.kr",
  "or.kr",
  "co.in",
  "net.in",
  "org.in",
  "com.ar",
  "com.co",
  "com.pe",
  "com.pl",
  "com.es",
  "com.fr",
  "com.de",
  "com.cn",
  "com.ua",
  "com.vn",
  "co.id",
  "co.th",
  "com.my",
  "com.ph",
  "com.sa",
  "com.eg",
  "com.ng",
  "co.ke",
  // Multi-tenant PaaS, cloud, CDN, and e-commerce platform suffixes
  "myshopify.com",
  "mybigcommerce.com",
  "wixsite.com",
  "wixstudio.com",
  "wixstatic.com",
  "shopware.store",
  "squarespace.com",
  "bigcartel.com",
  "ecwid.com",
  "webflow.io",
  "shopifypreview.com",
  "vercel.app",
  "netlify.app",
  "herokuapp.com",
  "github.io",
  "gitlab.io",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "appspot.com",
  "run.app",
  "cloudfront.net",
  "azurewebsites.net",
  "azurestaticapps.net",
  "amazonaws.com",
  "fly.dev",
  "railway.app",
  "onrender.com",
  "deno.dev",
  "replit.app",
  "ngrok.io",
  "trycloudflare.com"
]);

/**
 * Determine whether a validated LDH hostname is a standard custom domain apex (`example.com`)
 * or `www.<standard custom domain apex>` (`www.example.com`) that may safely authorize
 * apex/sibling subdomains (`api.example.com`, `checkout.example.com`).
 *
 * Returns the 2-label custom apex when eligible, or `null` to enforce fail-closed matching
 * (exact host or strict subdomain of `storeHost` only).
 */
function getEligibleCustomApex(host: string): string | null {
  const labels = host.split(".");
  if (labels.length === 2) {
    return SHARED_OR_PUBLIC_TWO_LABEL_SUFFIXES.has(host) ? null : host;
  }
  if (labels.length === 3 && labels[0] === "www") {
    const apex = `${labels[1]}.${labels[2]}`;
    return SHARED_OR_PUBLIC_TWO_LABEL_SUFFIXES.has(apex) ? null : apex;
  }
  // Fail closed for ALL >= 3-label hosts outside `www.<2-label custom domain>`
  return null;
}

/**
 * Compute the fail-closed tenant domain boundary for a validated RFC 1123 LDH hostname.
 *
 * - For a standard 2-label custom domain (`shop.example`) or `www.<2-label>` (`www.shop.example`)
 *   NOT under a shared/public suffix: returns the 2-label apex (`shop.example`).
 * - For a bare shared/public 2-label suffix (`co.uk`, `co.il`, `myshopify.com`, `run.app`,
 *   `webflow.io`, etc.): returns `null`.
 * - For ANY >= 3-label host (including `acme.myshopify.com`, `shop1.co.il`, `svc.a.run.app`,
 *   `shop.europe-west1.run.app`, `bucket.s3.amazonaws.com`, `app.r.appspot.com`, `site.webflow.io`,
 *   or `shop.brand.example`): fails closed to the exact hostname itself so sibling tenants
 *   can never collapse across shared or unlisted suffixes.
 */
export function getTenantRegistrableDomain(rawHostname: string): string | null {
  if (!rawHostname || typeof rawHostname !== "string") return null;
  const host = rawHostname.toLowerCase().replace(/\.$/, "");
  if (!isValidLdhHostname(host)) return null;

  const labels = host.split(".");
  if (labels.length < 2) return null;

  if (labels.length === 2) {
    return SHARED_OR_PUBLIC_TWO_LABEL_SUFFIXES.has(host) ? null : host;
  }

  const customApex = getEligibleCustomApex(host);
  if (customApex) {
    return customApex;
  }

  // Fail closed: tenant boundary is the exact host (no sibling collapsing)
  return host;
}

/**
 * Fail-closed same-store / tenant-isolated host validation for UCP endpoints and
 * checkout `continue_url` handoff links.
 *
 * Allows:
 *  - Exact host match (`candHost === storeHost`)
 *  - Direct subdomain of `storeHost` (`candHost.endsWith('.' + storeHost)`), provided
 *    `storeHost` is not itself a bare 2-label shared/public suffix
 *  - Apex / sibling subdomains (`shop.example` <-> `www.shop.example` / `api.shop.example` /
 *    `checkout.shop.example`) ONLY when `storeHost` is a standard 2-label custom domain
 *    or `www.<2-label custom domain>` NOT under a shared/multi-tenant/ccTLD suffix.
 *
 * Fails closed (rejects sibling collapse) for all >=3-label hosts outside `www.<2-label>`
 * and all shared/multi-tenant/ccTLD suffixes (`co.il`, `a.run.app`, `europe-west1.run.app`,
 * `s3.amazonaws.com`, `r.appspot.com`, `webflow.io`, `myshopify.com`, `wixsite.com`, etc.).
 */
export function isSameRegistrableStoreDomain(
  storeOrigin: string,
  candidateOrigin: string
): boolean {
  try {
    const storeParsed = validateExternalUrl(storeOrigin);
    const candParsed = validateExternalUrl(candidateOrigin);
    if (storeParsed.protocol !== "https:" || candParsed.protocol !== "https:") {
      return false;
    }

    const storeHost = storeParsed.hostname.toLowerCase().replace(/\.$/, "");
    const candHost = candParsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!isValidLdhHostname(storeHost) || !isValidLdhHostname(candHost)) {
      return false;
    }

    // 1. Exact same host
    if (candHost === storeHost) {
      return true;
    }

    // Never allow subdomains of a bare 2-label public/shared suffix (e.g. `https://co.il` or `https://run.app`)
    const storeLabels = storeHost.split(".");
    if (storeLabels.length === 2 && SHARED_OR_PUBLIC_TWO_LABEL_SUFFIXES.has(storeHost)) {
      return false;
    }

    // 2. Direct subdomain of storeHost (safe for every tenant, including multi-tenant hosts)
    if (candHost.endsWith(`.${storeHost}`)) {
      return true;
    }

    // 3. Apex / sibling subdomains ONLY for standard 2-label custom domains or `www.<2-label>`
    const customApex = getEligibleCustomApex(storeHost);
    if (customApex) {
      return candHost === customApex || candHost.endsWith(`.${customApex}`);
    }

    return false;
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
  /** Optional stricter max URL length cap (defaults to 2048; endpoints default to 512). */
  maxLength?: number;
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
 *  - Fail-closed tenant-isolated host match against `storeOrigin`
 *  - No control characters, whitespace, fragments, or shell metacharacters
 */
export function validateUcpUrl(
  rawUrl: unknown,
  storeOrigin: string,
  opts: ValidateUcpUrlOptions = {}
): string | null {
  if (typeof rawUrl !== "string") return null;
  const maxLen = Math.min(MAX_UCP_URL_LENGTH, Math.max(64, opts.maxLength ?? MAX_UCP_URL_LENGTH));
  const cleaned = stripControlAndInvisible(rawUrl).trim();
  if (!cleaned || cleaned.length > maxLen) return null;
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
  if (!shellSafe || shellSafe.length > maxLen) return null;

  return shellSafe;
}

/**
 * Validate a UCP service/API endpoint URL (REST, MCP, A2A) discovered in `/.well-known/ucp`.
 * Enforces a strict 512-char cap and strips trailing slashes for deterministic sub-path joining.
 */
export function validateUcpEndpointUrl(rawUrl: unknown, storeOrigin: string): string | null {
  const validated = validateUcpUrl(rawUrl, storeOrigin, {
    allowQuery: false,
    allowRelativePath: false,
    maxLength: MAX_UCP_ENDPOINT_URL_LENGTH
  });
  if (!validated) return null;
  return validated.replace(/\/+$/, "");
}

/**
 * Validate a `continue_url` / checkout escalation URL returned by a UCP checkout endpoint.
 * Query parameters (e.g. merchant session token) are allowed and shell-escaped,
 * while scheme, credentials, host, IP/metadata, and tenant-isolated domain checks remain strict.
 */
export function validateUcpContinueUrl(rawUrl: unknown, storeOrigin: string): string | null {
  return validateUcpUrl(rawUrl, storeOrigin, {
    allowQuery: true,
    allowRelativePath: true,
    maxLength: MAX_UCP_URL_LENGTH
  });
}

/**
 * Bounded fixpoint loop (max 10 passes) stripping LLM control tokens so nested
 * constructions like `<|<|im_start|>|>` or `[[INST]INST]` cannot reassemble.
 */
export function stripLlmControlTokensFixpoint(input: string): string {
  let current = input;
  for (let pass = 0; pass < MAX_CONTROL_TOKEN_STRIP_PASSES; pass++) {
    const next = current.replace(LLM_CONTROL_TOKEN_RE, "");
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Sanitize untrusted merchant text from UCP manifests or responses against prompt injection:
 * strips HTML/comments/tags, invisible Unicode tags & BiDi overrides, and LLM control tokens
 * (via bounded fixpoint stripping).
 */
export function sanitizeUcpText(input: unknown, maxLen: number): string {
  if (typeof input !== "string" && typeof input !== "number") return "";
  const raw = String(input);
  const bounded = raw.length > Math.max(maxLen * 16, 32_768)
    ? raw.slice(0, Math.max(maxLen * 16, 32_768))
    : raw;
  const preStripped = stripLlmControlTokensFixpoint(bounded);
  const plain = stripLlmControlTokensFixpoint(stripHtmlToText(preStripped, maxLen + 64));
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
