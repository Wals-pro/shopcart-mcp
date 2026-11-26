import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getInFlightSlotCount,
  isBlockedIp,
  normalizeStoreOrigin,
  safeFetch,
  SELFCHECK_GLOBAL_SLOT_KEY,
  SsrfError,
  validateExternalUrl,
  withFetchContext
} from "../src/security/ssrf.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

  it("uses non-blocking c-ares Resolver (zero dns.lookup) and enforces timeout/abort on hanging DNS lookups while releasing slots", async () => {
    const ssrfSource = fs.readFileSync(path.join(REPO_ROOT, "src", "security", "ssrf.ts"), "utf8");
    expect(ssrfSource).not.toMatch(/\bdns\.lookup\b/);
    expect(ssrfSource).toContain("new Resolver(");

    // 1. Hanging DNS lookup aborts within hop budget and releases both per-key and global SSRF slots
    const hangingLookup = () => new Promise<Array<{ address: string; family: 4 | 6 }>>(() => undefined);
    const start = Date.now();
    await expect(
      safeFetch("https://tarpit-dns.example/meta.json", {
        timeoutMs: 60,
        concurrencyKey: "selfcheck:dns-timeout-test",
        lookupFn: hangingLookup
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(getInFlightSlotCount("selfcheck:dns-timeout-test")).toBe(0);
    expect(getInFlightSlotCount(SELFCHECK_GLOBAL_SLOT_KEY)).toBe(0);

    // 2. AbortSignal via withFetchContext aborts a hanging DNS lookup immediately and releases slots
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("client_disconnected")), 25);
    await expect(
      withFetchContext({ signal: ac.signal }, () =>
        safeFetch("https://tarpit-dns-abort.example/meta.json", {
          timeoutMs: 5000,
          concurrencyKey: "selfcheck:dns-abort-test",
          lookupFn: hangingLookup
        })
      )
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(getInFlightSlotCount("selfcheck:dns-abort-test")).toBe(0);
    expect(getInFlightSlotCount(SELFCHECK_GLOBAL_SLOT_KEY)).toBe(0);
  });

  it("enforces global selfcheck slot cap across distinct client keys and rolls back primary slot on rejection", async () => {
    const resolvers: Array<() => void> = [];
    const lookupFn = async () => [{ address: "23.227.38.65", family: 4 as const }];
    const deferredFetch = async () => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      return {
        status: 200,
        headers: { get: () => "application/json" },
        body: null,
        arrayBuffer: async () => new TextEncoder().encode("{}").buffer
      };
    };

    const customGlobalKey = "selfcheck:__test_global__";
    const p1 = safeFetch("https://shop-a.example/meta.json", {
      concurrencyKey: "selfcheck:203.0.113.1",
      globalConcurrencyKey: customGlobalKey,
      globalMaxConcurrency: 2,
      lookupFn,
      fetchImpl: deferredFetch
    });
    const p2 = safeFetch("https://shop-b.example/meta.json", {
      concurrencyKey: "selfcheck:2001:db8:abcd:12::/64",
      globalConcurrencyKey: customGlobalKey,
      globalMaxConcurrency: 2,
      lookupFn,
      fetchImpl: deferredFetch
    });

    for (let i = 0; i < 30 && resolvers.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(resolvers.length).toBe(2);
    expect(getInFlightSlotCount(customGlobalKey)).toBe(2);

    // 3rd request from a completely different client key hits the global cap and must NOT leak its primary slot
    await expect(
      safeFetch("https://shop-c.example/meta.json", {
        concurrencyKey: "selfcheck:203.0.113.99",
        globalConcurrencyKey: customGlobalKey,
        globalMaxConcurrency: 2,
        lookupFn,
        fetchImpl: deferredFetch
      })
    ).rejects.toMatchObject({ code: "CONCURRENCY_LIMIT" });
    expect(getInFlightSlotCount("selfcheck:203.0.113.99")).toBe(0);
    expect(getInFlightSlotCount(customGlobalKey)).toBe(2);

    for (const r of resolvers) r();
    await Promise.all([p1, p2]);
    expect(getInFlightSlotCount("selfcheck:203.0.113.1")).toBe(0);
    expect(getInFlightSlotCount("selfcheck:2001:db8:abcd:12::/64")).toBe(0);
    expect(getInFlightSlotCount(customGlobalKey)).toBe(0);
  });
});
