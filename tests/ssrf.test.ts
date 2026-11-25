import { describe, expect, it } from "vitest";
import {
  isBlockedIp,
  normalizeStoreOrigin,
  safeFetch,
  SsrfError,
  validateExternalUrl
} from "../src/security/ssrf.js";

describe("SSRF guardrails", () => {
  it("blocks private, loopback, link-local, metadata, and reserved IPv4 addresses", () => {
    const blocked = [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "127.0.0.53",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.254",
      "192.0.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255"
    ];
    for (const ip of blocked) {
      expect(isBlockedIp(ip), `expected ${ip} blocked`).toBe(true);
    }

    expect(isBlockedIp("23.227.38.65")).toBe(false); // Shopify public IP
    expect(isBlockedIp("1.1.1.1")).toBe(false);
  });

  it("blocks loopback, ULA, link-local, multicast, and IPv4-mapped IPv6 addresses", () => {
    const blocked = [
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:10.0.0.5",
      "::ffff:7f00:1",
      "64:ff9b::10.0.0.1"
    ];
    for (const ip of blocked) {
      expect(isBlockedIp(ip), `expected ${ip} blocked`).toBe(true);
    }
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("::ffff:23.227.38.65")).toBe(false);
  });

  it("rejects non-HTTPS, userinfo, non-443 ports, localhost, .internal, and IP literals", () => {
    expect(() => validateExternalUrl("http://snocks.com")).toThrow(SsrfError);
    expect(() => validateExternalUrl("file:///etc/passwd")).toThrow(SsrfError);
    expect(() => validateExternalUrl("https://user:pass@snocks.com")).toThrow(SsrfError);
    expect(() => validateExternalUrl("https://snocks.com:8443")).toThrow(SsrfError);
    expect(() => validateExternalUrl("https://169.254.169.254/latest")).toThrow(SsrfError);
    expect(() => validateExternalUrl("https://[::1]/")).toThrow(SsrfError);
    expect(() => validateExternalUrl("https://localhost/")).toThrow(SsrfError);
    expect(() => validateExternalUrl("https://metadata.google.internal/")).toThrow(SsrfError);
    expect(() => validateExternalUrl("https://printer.local/")).toThrow(SsrfError);

    expect(normalizeStoreOrigin("snocks.com/products/foo")).toBe("https://snocks.com");
    expect(normalizeStoreOrigin("https://RIDGE.com/")).toBe("https://ridge.com");
  });

  it("blocks redirect hops that point to private/metadata IPs", async () => {
    const lookupFn = async (host: string) => {
      if (host === "public-shop.example") return [{ address: "23.227.38.65", family: 4 as const }];
      return [{ address: "169.254.169.254", family: 4 as const }];
    };

    const fetchImpl = async () => ({
      status: 302,
      headers: {
        get: (k: string) => (k.toLowerCase() === "location" ? "https://evil-internal.example/meta" : null)
      },
      body: null
    });

    await expect(
      safeFetch("https://public-shop.example/meta.json", {
        lookupFn,
        fetchImpl,
        maxRedirects: 3
      })
    ).rejects.toMatchObject({ code: "BLOCKED_IP" });
  });

  it("enforces maxRedirects=0 for CIMD and maxBytes body cap", async () => {
    const lookupFn = async () => [{ address: "23.227.38.65", family: 4 as const }];

    await expect(
      safeFetch("https://client.example/meta.json", {
        lookupFn,
        maxRedirects: 0,
        fetchImpl: async () => ({
          status: 302,
          headers: { get: (k: string) => (k === "location" ? "https://client.example/v2" : null) },
          body: null
        })
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });

    async function* hugeBody() {
      yield new Uint8Array(5000);
      yield new Uint8Array(5000);
    }

    await expect(
      safeFetch("https://client.example/meta.json", {
        lookupFn,
        maxBytes: 8192,
        fetchImpl: async () => ({
          status: 200,
          headers: { get: () => "application/json" },
          body: hugeBody()
        })
      })
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
});
