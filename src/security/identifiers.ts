/**
 * Strict identifier, hostname, and shell-safe URL allowlists for emitted store
 * handles, variant IDs, origins, and URLs.
 *
 * Defense-in-depth against shell metacharacter propagation when autonomous
 * agents reuse store-derived values in One-Shot CLI commands.
 */

export const SAFE_HANDLE_RE = /^[A-Za-z0-9._~-]{1,200}$/;
export const NUMERIC_VARIANT_ID_RE = /^\d{1,30}$/;
export const SAFE_VARIANT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

const LDH_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_SHELL_SAFE_URL_LENGTH = 2048;

/**
 * Strict RFC 1123 ASCII LDH hostname check (applied after WHATWG punycode conversion).
 * Requires at least two dot-separated labels and rejects quotes, whitespace,
 * underscores, or shell metacharacters.
 */
export function isValidLdhHostname(rawHostname: string): boolean {
  if (!rawHostname || typeof rawHostname !== "string") return false;
  const host = rawHostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => LDH_LABEL_RE.test(label));
}

function pctEncodeChar(ch: string): string {
  return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
}

const SHELL_UNSAFE_PATH_RE = /['"$()`;|&\\<>]/g;
const SHELL_UNSAFE_QUERY_PART_RE = /['"$()`;|\\<>]/g;

export const SHELL_SAFE_HTTPS_URL_RE =
  /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\x00-\x1f\x7f\s'"$`\\;|<>()]*)?(?:\?[^\x00-\x1f\x7f\s'"$`\\;|<>()]*)?$/i;

/**
 * Enforce that a URL is an HTTPS URL on a strict RFC 1123 LDH hostname with no
 * userinfo, control characters, whitespace, quotes, or shell metacharacters.
 * Percent-encodes shell-active characters in pathname and query parameters while
 * preserving standard `?`, `=`, `&` query delimiters.
 */
export function enforceShellSafeHttpsUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_SHELL_SAFE_URL_LENGTH) return null;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port !== "" && parsed.port !== "443") return null;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!isValidLdhHostname(host)) return null;

  const encodedPath = parsed.pathname.replace(SHELL_UNSAFE_PATH_RE, pctEncodeChar);

  let encodedSearch = "";
  if (parsed.search && parsed.search.length > 1) {
    const pairs = parsed.search.slice(1).split("&").map((pair) => {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) {
        return pair.replace(SHELL_UNSAFE_QUERY_PART_RE, pctEncodeChar);
      }
      const k = pair.slice(0, eqIdx).replace(SHELL_UNSAFE_QUERY_PART_RE, pctEncodeChar);
      const v = pair.slice(eqIdx + 1).replace(SHELL_UNSAFE_QUERY_PART_RE, pctEncodeChar);
      return `${k}=${v}`;
    });
    encodedSearch = `?${pairs.join("&")}`;
  }

  const finalUrl = `https://${host}${encodedPath}${encodedSearch}`;
  if (finalUrl.length > MAX_SHELL_SAFE_URL_LENGTH) return null;
  if (!SHELL_SAFE_HTTPS_URL_RE.test(finalUrl)) return null;
  return finalUrl;
}

/**
 * Validate a product or collection handle against the strict allowlist:
 * `^[A-Za-z0-9._~-]{1,200}$` with path traversal (`..`) rejected.
 */
export function sanitizeSafeHandle(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.includes("..")) return null;
  return SAFE_HANDLE_RE.test(trimmed) ? trimmed : null;
}

/**
 * Validate a numeric variant/product ID (Shopify, WooCommerce) against `^\d{1,30}$`.
 */
export function sanitizeNumericVariantId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return NUMERIC_VARIANT_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Validate a generic variant/product identifier (BigCommerce, Shopware, Magento,
 * Amazon ASIN, JSON-LD SKU/ID, CLI gate) against `^[A-Za-z0-9._:-]{1,128}$`
 * with path traversal (`..`) rejected.
 */
export function sanitizeGenericVariantId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.includes("..")) return null;
  return SAFE_VARIANT_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Extract the last non-empty pathname segment from a URL and validate it against
 * `SAFE_HANDLE_RE`. Optionally strips common web file extensions (e.g. `.html`).
 */
export function extractSafeHandleFromUrl(
  rawUrl: string,
  opts: { stripFileExtension?: boolean } = {}
): string | null {
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return null;
    let decoded = last;
    try {
      decoded = decodeURIComponent(last);
    } catch {
      return null;
    }
    const candidate = opts.stripFileExtension
      ? decoded.replace(/\.(html?|php|aspx?)$/i, "")
      : decoded;
    return sanitizeSafeHandle(candidate);
  } catch {
    return null;
  }
}
