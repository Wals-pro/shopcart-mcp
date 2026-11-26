/**
 * Strict identifier allowlists for emitted store handles and variant IDs.
 *
 * Defense-in-depth against shell metacharacter propagation when autonomous
 * agents reuse store-derived identifiers in One-Shot CLI commands.
 */

export const SAFE_HANDLE_RE = /^[A-Za-z0-9._~-]{1,200}$/;
export const NUMERIC_VARIANT_ID_RE = /^\d{1,30}$/;
export const SAFE_VARIANT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

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
