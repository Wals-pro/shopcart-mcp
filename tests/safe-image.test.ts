import { describe, expect, it } from "vitest";
import {
  detectImageMagicMime,
  fetchVerifiedThumbnail,
  MAX_THUMBNAIL_BYTES,
  MAX_THUMBNAIL_URL_LENGTH,
  parseAllowedImageMimeType
} from "../src/security/safe-image.js";
import type { DnsLookupFn, SafeFetchOptions } from "../src/security/ssrf.js";

const PUBLIC_DNS: DnsLookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

function makeJpegBytes(totalLength = 64): Buffer {
  const buf = Buffer.alloc(totalLength, 0x11);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  buf[totalLength - 2] = 0xff;
  buf[totalLength - 1] = 0xd9;
  return buf;
}

function makePngBytes(totalLength = 64): Buffer {
  const buf = Buffer.alloc(totalLength, 0x22);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  return buf;
}

function makeWebpBytes(totalLength = 64): Buffer {
  const buf = Buffer.alloc(totalLength, 0x33);
  Buffer.from("RIFF", "ascii").copy(buf, 0);
  buf.writeUInt32LE(totalLength - 8, 4);
  Buffer.from("WEBP", "ascii").copy(buf, 8);
  Buffer.from("VP8 ", "ascii").copy(buf, 12);
  return buf;
}

function makeMockFetchImpl(opts: {
  status?: number;
  contentType?: string;
  body?: Buffer;
  location?: string;
  throwError?: Error;
}): NonNullable<SafeFetchOptions["fetchImpl"]> {
  return async () => {
    if (opts.throwError) {
      throw opts.throwError;
    }
    const body = opts.body ?? Buffer.alloc(0);
    const headersMap = new Map<string, string>();
    if (opts.contentType !== undefined) {
      headersMap.set("content-type", opts.contentType);
    }
    if (opts.location !== undefined) {
      headersMap.set("location", opts.location);
    }
    async function* streamChunks() {
      if (body.length > 0) {
        yield new Uint8Array(body);
      }
    }
    return {
      status: opts.status ?? 200,
      headers: {
        get: (name: string) => headersMap.get(name.toLowerCase()) ?? null
      },
      body: streamChunks()
    };
  };
}

describe("safe-image: SSRF-hardened zero-retention thumbnail verification", () => {
  it("accepts valid JPEG (including image/jpg & charset params), PNG, and WebP images", async () => {
    const jpeg = makeJpegBytes(128);
    const jpegRes = await fetchVerifiedThumbnail("https://cdn.shop.example/img/shoe.jpg", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/jpg; charset=binary",
        body: jpeg
      })
    });
    expect(jpegRes).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      base64: jpeg.toString("base64"),
      bytes: 128
    });

    const png = makePngBytes(256);
    const pngRes = await fetchVerifiedThumbnail("https://cdn.shop.example/img/bag.png", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/png",
        body: png
      })
    });
    expect(pngRes).toEqual({
      ok: true,
      mimeType: "image/png",
      base64: png.toString("base64"),
      bytes: 256
    });

    const webp = makeWebpBytes(192);
    const webpRes = await fetchVerifiedThumbnail("https://cdn.shop.example/img/mug.webp", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/webp",
        body: webp
      })
    });
    expect(webpRes).toEqual({
      ok: true,
      mimeType: "image/webp",
      base64: webp.toString("base64"),
      bytes: 192
    });
  });

  it("blocks SVG, HTML, GIF, and octet-stream content types", async () => {
    const blockedTypes = [
      { ct: "image/svg+xml", body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') },
      { ct: "text/html; charset=utf-8", body: Buffer.from("<html><body>hi</body></html>") },
      { ct: "image/gif", body: Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00") },
      { ct: "application/octet-stream", body: makePngBytes(64) },
      { ct: "", body: makeJpegBytes(64) }
    ];

    for (const testCase of blockedTypes) {
      const res = await fetchVerifiedThumbnail("https://cdn.shop.example/item", {
        lookupFn: PUBLIC_DNS,
        fetchImpl: makeMockFetchImpl({
          status: 200,
          contentType: testCase.ct,
          body: testCase.body
        })
      });
      expect(res).toEqual({ ok: false, reason: "unsupported_content_type" });
    }

    expect(parseAllowedImageMimeType("image/svg+xml")).toBeNull();
    expect(parseAllowedImageMimeType("text/html")).toBeNull();
    expect(parseAllowedImageMimeType("image/gif")).toBeNull();
  });

  it("fails closed on spoofed Content-Type or magic-bytes mismatch", async () => {
    // Declared image/jpeg but body is HTML/SVG
    const htmlAsJpeg = await fetchVerifiedThumbnail("https://cdn.shop.example/spoof1.jpg", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/jpeg",
        body: Buffer.from("<svg onload=alert(1)>not a real jpeg image</svg>")
      })
    });
    expect(htmlAsJpeg).toEqual({ ok: false, reason: "invalid_image_signature" });

    // Declared image/png but body is JPEG
    const jpegAsPng = await fetchVerifiedThumbnail("https://cdn.shop.example/spoof2.png", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/png",
        body: makeJpegBytes(64)
      })
    });
    expect(jpegAsPng).toEqual({ ok: false, reason: "invalid_image_signature" });

    // Declared image/webp but body is RIFF....WAVE (not WEBP)
    const wavBuf = Buffer.alloc(64, 0x00);
    Buffer.from("RIFF", "ascii").copy(wavBuf, 0);
    Buffer.from("WAVE", "ascii").copy(wavBuf, 8);
    const wavAsWebp = await fetchVerifiedThumbnail("https://cdn.shop.example/spoof3.webp", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/webp",
        body: wavBuf
      })
    });
    expect(wavAsWebp).toEqual({ ok: false, reason: "invalid_image_signature" });

    // Truncated body (< 16 bytes)
    const tinyJpeg = await fetchVerifiedThumbnail("https://cdn.shop.example/tiny.jpg", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/jpeg",
        body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
      })
    });
    expect(tinyJpeg).toEqual({ ok: false, reason: "invalid_image_signature" });
    expect(detectImageMagicMime(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("rejects images larger than 512 KB and accepts exact 512 KB boundary", async () => {
    const exactLimit = makePngBytes(MAX_THUMBNAIL_BYTES);
    const okRes = await fetchVerifiedThumbnail("https://cdn.shop.example/exact.png", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/png",
        body: exactLimit
      })
    });
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.bytes).toBe(MAX_THUMBNAIL_BYTES);
    }

    const oversized = makePngBytes(MAX_THUMBNAIL_BYTES + 1);
    const tooLarge = await fetchVerifiedThumbnail("https://cdn.shop.example/huge.png", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/png",
        body: oversized
      })
    });
    expect(tooLarge).toEqual({ ok: false, reason: "image_too_large" });
  });

  it("blocks HTTP, localhost, private/metadata IPs, DNS rebinding to private IPs, and oversized URLs", async () => {
    let networkCalls = 0;
    const spyFetch: NonNullable<SafeFetchOptions["fetchImpl"]> = async () => {
      networkCalls++;
      throw new Error("should not reach network");
    };

    const blockedUrls = [
      "http://cdn.shop.example/img.jpg",
      "https://localhost/img.jpg",
      "https://127.0.0.1/img.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://printer.local/image.png",
      "https://[::1]/img.png",
      "https://user:pass@cdn.shop.example/img.jpg",
      `https://cdn.shop.example/${"a".repeat(MAX_THUMBNAIL_URL_LENGTH)}.jpg`
    ];

    for (const url of blockedUrls) {
      const res = await fetchVerifiedThumbnail(url, {
        lookupFn: PUBLIC_DNS,
        fetchImpl: spyFetch
      });
      expect(res, `Expected url_blocked for ${url}`).toEqual({ ok: false, reason: "url_blocked" });
    }
    expect(networkCalls).toBe(0);

    // DNS resolves to private/metadata IP -> blocked by safeFetch
    const privateDns: DnsLookupFn = async () => [{ address: "169.254.169.254", family: 4 }];
    const rebindRes = await fetchVerifiedThumbnail("https://rebind.shop.example/img.jpg", {
      lookupFn: privateDns,
      fetchImpl: spyFetch
    });
    expect(rebindRes).toEqual({ ok: false, reason: "url_blocked" });
    expect(networkCalls).toBe(0);
  });

  it("handles missing URLs, non-200 responses, empty bodies, and timeouts cleanly", async () => {
    expect(await fetchVerifiedThumbnail(null)).toEqual({ ok: false, reason: "no_image" });
    expect(await fetchVerifiedThumbnail("   ")).toEqual({ ok: false, reason: "no_image" });

    const notFound = await fetchVerifiedThumbnail("https://cdn.shop.example/missing.jpg", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 404,
        contentType: "image/jpeg",
        body: makeJpegBytes(64)
      })
    });
    expect(notFound).toEqual({ ok: false, reason: "fetch_failed" });

    const emptyBody = await fetchVerifiedThumbnail("https://cdn.shop.example/empty.jpg", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        status: 200,
        contentType: "image/jpeg",
        body: Buffer.alloc(0)
      })
    });
    expect(emptyBody).toEqual({ ok: false, reason: "fetch_failed" });

    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    const timedOut = await fetchVerifiedThumbnail("https://cdn.shop.example/slow.jpg", {
      lookupFn: PUBLIC_DNS,
      fetchImpl: makeMockFetchImpl({
        throwError: timeoutErr
      })
    });
    expect(timedOut).toEqual({ ok: false, reason: "timeout" });
  });
});
