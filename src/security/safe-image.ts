import {
  safeFetch,
  SsrfError,
  validateExternalUrl,
  type DnsLookupFn,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "./ssrf.js";

export const MAX_THUMBNAIL_BYTES = 512 * 1024;
export const MIN_THUMBNAIL_BYTES = 16;
export const MAX_THUMBNAIL_URL_LENGTH = 2048;
export const THUMBNAIL_TIMEOUT_MS = 4000;
export const THUMBNAIL_MAX_REDIRECTS = 3;

export type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type ThumbnailFailureReason =
  | "no_image"
  | "url_blocked"
  | "image_too_large"
  | "unsupported_content_type"
  | "invalid_image_signature"
  | "timeout"
  | "fetch_failed";

export type ThumbnailFetcherFn = (
  url: string,
  opts?: SafeFetchOptions
) => Promise<SafeFetchResponse>;

export interface FetchVerifiedThumbnailOptions {
  concurrencyKey?: string;
  timeoutMs?: number;
  fetcher?: ThumbnailFetcherFn;
  lookupFn?: DnsLookupFn;
  fetchImpl?: SafeFetchOptions["fetchImpl"];
}

export type VerifiedThumbnailResult =
  | {
      ok: true;
      mimeType: AllowedImageMimeType;
      base64: string;
      bytes: number;
    }
  | {
      ok: false;
      reason: ThumbnailFailureReason;
    };

/**
 * Normalizes a raw HTTP Content-Type header against the strict raster-image allowlist.
 * Only JPEG, PNG, and WebP are accepted; SVG, HTML, GIF, octet-stream, etc. are rejected.
 */
export function parseAllowedImageMimeType(rawContentType: string | null | undefined): AllowedImageMimeType | null {
  if (!rawContentType || typeof rawContentType !== "string") {
    return null;
  }
  const mediaType = rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType === "image/jpeg" || mediaType === "image/jpg") {
    return "image/jpeg";
  }
  if (mediaType === "image/png") {
    return "image/png";
  }
  if (mediaType === "image/webp") {
    return "image/webp";
  }
  return null;
}

/**
 * Inspects binary magic bytes for JPEG, PNG, or WebP signatures.
 * Returns null for any unrecognized, truncated, or non-allowlisted format (including SVG/HTML/GIF).
 */
export function detectImageMagicMime(buf: Buffer): AllowedImageMimeType | null {
  if (!Buffer.isBuffer(buf) || buf.length < MIN_THUMBNAIL_BYTES) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: RIFF....WEBP (bytes 0..3 == "RIFF" and bytes 8..11 == "WEBP")
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Strictly SSRF-hardened, zero-retention thumbnail fetcher for opt-in visual product verification.
 *
 * Security invariants:
 * - HTTPS only, validated via validateExternalUrl(), length <= 2048 chars (including redirects)
 * - Bounded fetch: 4s timeout, max 3 redirects, max 512 KB (no truncation)
 * - HTTP 200 only, body between 16 bytes and 512 KB
 * - Strict Content-Type allowlist: image/jpeg, image/png, image/webp only
 * - Magic-bytes signature must strictly match the declared Content-Type (fail closed)
 * - In-memory only: never persisted to disk or logged
 */
export async function fetchVerifiedThumbnail(
  rawUrl: string | null | undefined,
  opts: FetchVerifiedThumbnailOptions = {}
): Promise<VerifiedThumbnailResult> {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { ok: false, reason: "no_image" };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, reason: "no_image" };
  }
  if (trimmed.length > MAX_THUMBNAIL_URL_LENGTH) {
    return { ok: false, reason: "url_blocked" };
  }

  try {
    validateExternalUrl(trimmed);
  } catch {
    return { ok: false, reason: "url_blocked" };
  }

  const fetcher = opts.fetcher ?? safeFetch;
  let response: SafeFetchResponse;
  try {
    response = await fetcher(trimmed, {
      method: "GET",
      timeoutMs: opts.timeoutMs ?? THUMBNAIL_TIMEOUT_MS,
      maxRedirects: THUMBNAIL_MAX_REDIRECTS,
      maxBytes: MAX_THUMBNAIL_BYTES,
      truncateOnMaxBytes: false,
      concurrencyKey: opts.concurrencyKey,
      lookupFn: opts.lookupFn,
      fetchImpl: opts.fetchImpl,
      headers: {
        Accept: "image/jpeg,image/png,image/webp;q=0.9"
      },
      validateRedirectUrl: (redirectUrl) => {
        if (redirectUrl.toString().length > MAX_THUMBNAIL_URL_LENGTH) {
          throw new SsrfError("INVALID_URL", "Image redirect URL exceeded maximum length");
        }
      }
    });
  } catch (err) {
    if (err instanceof SsrfError) {
      if (err.code === "INVALID_URL" || err.code === "BLOCKED_HOST" || err.code === "BLOCKED_IP") {
        return { ok: false, reason: "url_blocked" };
      }
      if (err.code === "BODY_TOO_LARGE") {
        return { ok: false, reason: "image_too_large" };
      }
      if (err.code === "TIMEOUT") {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "fetch_failed" };
    }
    return { ok: false, reason: "fetch_failed" };
  }

  if (response.status !== 200) {
    return { ok: false, reason: "fetch_failed" };
  }

  const declaredMime = parseAllowedImageMimeType(
    response.contentType || response.headers["content-type"]
  );
  if (!declaredMime) {
    return { ok: false, reason: "unsupported_content_type" };
  }

  const buf = response.bodyBuffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, reason: "fetch_failed" };
  }
  if (buf.length > MAX_THUMBNAIL_BYTES) {
    return { ok: false, reason: "image_too_large" };
  }
  if (buf.length < MIN_THUMBNAIL_BYTES) {
    return { ok: false, reason: "invalid_image_signature" };
  }

  const magicMime = detectImageMagicMime(buf);
  if (!magicMime || magicMime !== declaredMime) {
    return { ok: false, reason: "invalid_image_signature" };
  }

  return {
    ok: true,
    mimeType: declaredMime,
    base64: buf.toString("base64"),
    bytes: buf.length
  };
}
