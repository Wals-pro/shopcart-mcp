import { AsyncLocalStorage } from "node:async_hooks";
import type { LookupAddress, LookupOptions } from "node:dns";
import { Resolver } from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher, type RequestInit as UndiciRequestInit } from "undici";
import { isValidLdhHostname } from "./identifiers.js";

export type SsrfErrorCode =
  | "INVALID_URL"
  | "BLOCKED_HOST"
  | "BLOCKED_IP"
  | "DNS_FAILED"
  | "TOO_MANY_REDIRECTS"
  | "BODY_TOO_LARGE"
  | "TIMEOUT"
  | "ABORTED"
  | "CONCURRENCY_LIMIT";

export const SELFCHECK_GLOBAL_SLOT_KEY = "selfcheck:__global__";
export const SELFCHECK_GLOBAL_MAX_CONCURRENT = 24;
const MAX_DNS_TIMEOUT_MS = 2500;

export interface FetchContext {
  signal?: AbortSignal;
  globalKey?: string;
  globalMaxConcurrent?: number;
}

const fetchContextStorage = new AsyncLocalStorage<FetchContext>();

export function withFetchContext<T>(ctx: FetchContext, fn: () => T): T {
  return fetchContextStorage.run(ctx, fn);
}

export function getActiveFetchContext(): FetchContext | undefined {
  return fetchContextStorage.getStore();
}

export class SsrfError extends Error {
  readonly code: SsrfErrorCode;
  constructor(code: SsrfErrorCode, message: string) {
    super(message);
    this.name = "SsrfError";
    this.code = code;
  }
}

export interface DnsAddress {
  address: string;
  family: 4 | 6;
}

export type DnsLookupFn = (hostname: string) => Promise<DnsAddress[]>;

export interface SafeFetchOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  truncateOnMaxBytes?: boolean;
  concurrencyKey?: string;
  maxConcurrency?: number;
  globalConcurrencyKey?: string;
  globalMaxConcurrency?: number;
  signal?: AbortSignal;
  lookupFn?: DnsLookupFn;
  validateRedirectUrl?: (url: URL) => void;
  fetchImpl?: (url: string, init: UndiciRequestInit) => Promise<{
    status: number;
    headers: { get(name: string): string | null };
    body: AsyncIterable<Uint8Array> | null;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  }>;
}

export interface SafeFetchResponse {
  status: number;
  url: string;
  contentType: string;
  headers: Record<string, string>;
  bodyBuffer: Buffer;
  bodyText: string;
}

const BLOCKED_HOST_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".localdomain",
  ".home.arpa",
  ".arpa"
];

function parseIpv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = parseIpv4ToInt(ip);
  if (n === null) return true;

  const ranges: Array<[number, number]> = [
    [0x00000000, 0x00ffffff], // 0.0.0.0/8
    [0x0a000000, 0x0affffff], // 10.0.0.0/8
    [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
    [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
    [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local / cloud metadata)
    [0xac100000, 0xac1fffff], // 172.16.0.0/12
    [0xc0000000, 0xc00000ff], // 192.0.0.0/24
    [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (TEST-NET-1)
    [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
    [0xc6120000, 0xc613ffff], // 198.18.0.0/15 (benchmarking)
    [0xc6336400, 0xc63364ff], // 198.51.100.0/24 (TEST-NET-2)
    [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (TEST-NET-3)
    [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast)
    [0xf0000000, 0xffffffff]  // 240.0.0.0/4 (reserved + broadcast)
  ];

  return ranges.some(([start, end]) => n >= start && n <= end);
}

function expandIpv6(raw: string): number[] | null {
  let addr = raw.toLowerCase().trim();
  const zoneIdx = addr.indexOf("%");
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx);

  // Handle embedded IPv4 suffix like ::ffff:127.0.0.1
  const lastColon = addr.lastIndexOf(":");
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes(".")) {
    const ipv4 = parseIpv4ToInt(addr.slice(lastColon + 1));
    if (ipv4 === null) return null;
    const hi = ((ipv4 >>> 16) & 0xffff).toString(16);
    const lo = (ipv4 & 0xffff).toString(16);
    addr = `${addr.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const doubleColonParts = addr.split("::");
  if (doubleColonParts.length > 2) return null;

  const left = doubleColonParts[0] ? doubleColonParts[0].split(":") : [];
  const right = doubleColonParts[1] ? doubleColonParts[1].split(":") : [];

  let groups: string[];
  if (doubleColonParts.length === 2) {
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    groups = left;
  }

  if (groups.length !== 8) return null;
  const nums: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    nums.push(Number.parseInt(g, 16));
  }
  return nums;
}

function isBlockedIpv6(ip: string): boolean {
  const g = expandIpv6(ip);
  if (!g) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

  // ::/128 (unspecified) or ::1/128 (loopback)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) {
    return true;
  }
  // IPv4-mapped ::ffff:0:0/96 or IPv4-translated ::ffff:0:0:0/96
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const ipv4 = `${(g6 >>> 8) & 0xff}.${g6 & 0xff}.${(g7 >>> 8) & 0xff}.${g7 & 0xff}`;
    return isBlockedIpv4(ipv4);
  }
  // NAT64 64:ff9b::/96 -> extract embedded IPv4
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    const ipv4 = `${(g6 >>> 8) & 0xff}.${g6 & 0xff}.${(g7 >>> 8) & 0xff}.${g7 & 0xff}`;
    return isBlockedIpv4(ipv4);
  }
  // 100::/64 (discard-only)
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // 2001:db8::/32 (documentation)
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  // fc00::/7 (ULA)
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 (link-local)
  if ((g0 & 0xffc0) === 0xfe80) return true;
  // ff00::/8 (multicast)
  if ((g0 & 0xff00) === 0xff00) return true;

  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

export function validateExternalUrl(rawUrl: string): URL {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new SsrfError("INVALID_URL", "URL is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SsrfError("INVALID_URL", "Invalid URL syntax");
  }

  if (parsed.protocol !== "https:") {
    throw new SsrfError("INVALID_URL", `Only https:// URLs are allowed (got ${parsed.protocol})`);
  }
  if (parsed.username || parsed.password) {
    throw new SsrfError("INVALID_URL", "URL userinfo credentials are not allowed");
  }
  if (parsed.port !== "" && parsed.port !== "443") {
    throw new SsrfError("INVALID_URL", `Non-standard port ${parsed.port} is not allowed`);
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || host.includes("..") || host.startsWith(".") || host.endsWith(".")) {
    throw new SsrfError("BLOCKED_HOST", "Invalid hostname");
  }
  // Reject IP literals (IPv4 or bracketed IPv6)
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (net.isIP(unbracketed) !== 0 || /^\d+$/.test(host)) {
    throw new SsrfError("BLOCKED_HOST", "Direct IP literal hosts are not allowed");
  }
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfError("BLOCKED_HOST", `Blocked hostname: ${host}`);
  }
  if (!host.includes(".")) {
    throw new SsrfError("BLOCKED_HOST", `Single-label hostname not allowed: ${host}`);
  }
  if (!isValidLdhHostname(host)) {
    throw new SsrfError("BLOCKED_HOST", `Invalid hostname characters: ${host}`);
  }

  return parsed;
}

export function normalizeStoreOrigin(storeUrl: string): string {
  const trimmed = storeUrl.trim();
  if (!trimmed) {
    throw new SsrfError("INVALID_URL", "store_url is required");
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = validateExternalUrl(withScheme);
  return `https://${parsed.hostname.toLowerCase().replace(/\.$/, "")}`;
}

function makeAbortSsrfError(signal: AbortSignal, timeoutMs: number): SsrfError {
  const reason = signal.reason;
  if (reason instanceof SsrfError) {
    return reason;
  }
  if (
    reason instanceof Error &&
    (reason.name === "TimeoutError" || reason.name === "StoreCheckTimeoutError")
  ) {
    return new SsrfError("TIMEOUT", `Request timed out after ${timeoutMs}ms`);
  }
  return new SsrfError("ABORTED", "Request was aborted");
}

function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

/**
 * Non-blocking c-ares DNS lookup using `dns.promises.Resolver` (zero libuv threadpool usage).
 * Resolves IPv4 (A) and IPv6 (AAAA) records in parallel and cancels immediately on hop timeout or abort.
 */
async function resolveHostnameWithCares(
  hostname: string,
  budgetMs: number,
  signal?: AbortSignal
): Promise<DnsAddress[]> {
  if (signal?.aborted) {
    throw makeAbortSsrfError(signal, budgetMs);
  }
  if (net.isIP(hostname) !== 0) {
    return [{ address: hostname, family: net.isIP(hostname) === 6 ? 6 : 4 }];
  }

  const effectiveBudgetMs = Math.max(50, Math.min(budgetMs, MAX_DNS_TIMEOUT_MS));
  const resolver = new Resolver({ timeout: effectiveBudgetMs, tries: 1 });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const lookupPromise = Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname)
  ]).then(([v4Res, v6Res]) => {
    const out: DnsAddress[] = [];
    if (v4Res.status === "fulfilled") {
      for (const address of v4Res.value) {
        if (net.isIP(address) === 4) {
          out.push({ address, family: 4 });
        }
      }
    }
    if (v6Res.status === "fulfilled") {
      for (const address of v6Res.value) {
        if (net.isIP(address) === 6) {
          out.push({ address, family: 6 });
        }
      }
    }
    if (out.length === 0) {
      const reasons: string[] = [];
      if (v4Res.status === "rejected") {
        reasons.push(v4Res.reason instanceof Error ? v4Res.reason.message : String(v4Res.reason));
      }
      if (v6Res.status === "rejected") {
        reasons.push(v6Res.reason instanceof Error ? v6Res.reason.message : String(v6Res.reason));
      }
      throw new SsrfError(
        "DNS_FAILED",
        `DNS lookup failed for ${hostname}${reasons.length ? `: ${reasons[0]}` : ""}`
      );
    }
    return out;
  });

  // Prevent unhandled rejections if the race settles via timeout/abort first
  lookupPromise.catch(() => undefined);

  const cancelPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolver.cancel();
      } catch {
        // ignore cancel errors on already-finished resolvers
      }
      reject(new SsrfError("TIMEOUT", `DNS lookup timed out after ${effectiveBudgetMs}ms`));
    }, effectiveBudgetMs);

    if (signal) {
      onAbort = () => {
        try {
          resolver.cancel();
        } catch {
          // ignore
        }
        reject(makeAbortSsrfError(signal, effectiveBudgetMs));
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });

  try {
    return await Promise.race([lookupPromise, cancelPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

async function resolveWithCustomLookup(
  lookupFn: DnsLookupFn,
  hostname: string,
  budgetMs: number,
  signal?: AbortSignal
): Promise<DnsAddress[]> {
  if (signal?.aborted) {
    throw makeAbortSsrfError(signal, budgetMs);
  }
  const effectiveBudgetMs = Math.max(10, Math.min(budgetMs, MAX_DNS_TIMEOUT_MS));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const lookupPromise = Promise.resolve().then(() => lookupFn(hostname));
  lookupPromise.catch(() => undefined);

  const cancelPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new SsrfError("TIMEOUT", `DNS lookup timed out after ${effectiveBudgetMs}ms`));
    }, effectiveBudgetMs);

    if (signal) {
      onAbort = () => {
        reject(makeAbortSsrfError(signal, effectiveBudgetMs));
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });

  try {
    return await Promise.race([lookupPromise, cancelPromise]);
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    throw new SsrfError(
      "DNS_FAILED",
      `DNS lookup failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

const inFlightByKey = new Map<string, number>();

export function getInFlightSlotCount(key: string): number {
  return inFlightByKey.get(key) ?? 0;
}

function acquireSlot(key: string, maxConcurrency: number): () => void {
  const current = inFlightByKey.get(key) ?? 0;
  if (current >= maxConcurrency) {
    throw new SsrfError(
      "CONCURRENCY_LIMIT",
      `Too many concurrent upstream requests (max ${maxConcurrency})`
    );
  }
  inFlightByKey.set(key, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (inFlightByKey.get(key) ?? 1) - 1;
    if (next <= 0) inFlightByKey.delete(key);
    else inFlightByKey.set(key, next);
  };
}

function acquireSlots(
  primaryKey: string,
  primaryMax: number,
  globalKey?: string,
  globalMax?: number
): () => void {
  const releasePrimary = acquireSlot(primaryKey, primaryMax);
  if (!globalKey || globalKey === primaryKey || !globalMax || globalMax <= 0) {
    return releasePrimary;
  }
  let releaseGlobal: () => void;
  try {
    releaseGlobal = acquireSlot(globalKey, globalMax);
  } catch (err) {
    releasePrimary();
    throw err;
  }
  return () => {
    releaseGlobal();
    releasePrimary();
  };
}

export function createPinnedAgent(pinned: DnsAddress): Agent {
  return new Agent({
    // Keep HTTP/1.1-only against untrusted storefronts (undici 8 defaults allowH2=true)
    allowH2: false,
    connect: {
      lookup: (
        _hostname: string,
        options: LookupOptions,
        callback: (
          err: NodeJS.ErrnoException | null,
          address: string | LookupAddress[],
          family?: number
        ) => void
      ) => {
        if (options?.all) {
          callback(null, [{ address: pinned.address, family: pinned.family }]);
          return;
        }
        callback(null, pinned.address, pinned.family);
      }
    }
  });
}

async function cancelResponseBody(body: unknown): Promise<void> {
  if (!body || typeof body !== "object") return;
  const cancelFn = (body as { cancel?: () => Promise<unknown> | unknown }).cancel;
  if (typeof cancelFn === "function") {
    await Promise.resolve(cancelFn.call(body)).catch(() => undefined);
  }
}

async function readBoundedBody(
  res: { body: AsyncIterable<Uint8Array> | null; arrayBuffer?: () => Promise<ArrayBuffer> },
  maxBytes: number,
  truncateOnMaxBytes = false,
  signal?: AbortSignal,
  timeoutMs = 6000
): Promise<{ buffer: Buffer; truncated: boolean }> {
  if (signal?.aborted) {
    throw makeAbortSsrfError(signal, timeoutMs);
  }
  if (!res.body) {
    if (res.arrayBuffer) {
      const ab = await res.arrayBuffer();
      if (signal?.aborted) {
        throw makeAbortSsrfError(signal, timeoutMs);
      }
      if (ab.byteLength > maxBytes) {
        if (truncateOnMaxBytes) {
          return { buffer: Buffer.from(ab, 0, maxBytes), truncated: true };
        }
        throw new SsrfError("BODY_TOO_LARGE", `Upstream response exceeded ${maxBytes} bytes`);
      }
      return { buffer: Buffer.from(ab), truncated: false };
    }
    return { buffer: Buffer.alloc(0), truncated: false };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of res.body) {
    if (signal?.aborted) {
      throw makeAbortSsrfError(signal, timeoutMs);
    }
    const nextTotal = total + chunk.byteLength;
    if (nextTotal > maxBytes) {
      if (truncateOnMaxBytes) {
        const remaining = maxBytes - total;
        if (remaining > 0) {
          chunks.push(Buffer.from(chunk.subarray(0, remaining)));
          total += remaining;
        }
        truncated = true;
        break;
      }
      throw new SsrfError("BODY_TOO_LARGE", `Upstream response exceeded ${maxBytes} bytes`);
    }
    total = nextTotal;
    chunks.push(Buffer.from(chunk));
  }
  return { buffer: Buffer.concat(chunks, total), truncated };
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const timeoutMs = options.timeoutMs ?? 6000;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 1_048_576;
  const concurrencyKey = options.concurrencyKey ?? "global";
  const maxConcurrency = options.maxConcurrency ?? 8;

  const fetchCtx = getActiveFetchContext();
  const callerSignal = combineAbortSignals([options.signal, fetchCtx?.signal]);
  if (callerSignal?.aborted) {
    throw makeAbortSsrfError(callerSignal, timeoutMs);
  }

  const globalKey =
    options.globalConcurrencyKey ??
    fetchCtx?.globalKey ??
    (concurrencyKey.startsWith("selfcheck:") ? SELFCHECK_GLOBAL_SLOT_KEY : undefined);
  const globalMax =
    options.globalMaxConcurrency ??
    fetchCtx?.globalMaxConcurrent ??
    (globalKey ? SELFCHECK_GLOBAL_MAX_CONCURRENT : undefined);

  const release = acquireSlots(concurrencyKey, maxConcurrency, globalKey, globalMax);
  try {
    let currentUrl = validateExternalUrl(rawUrl);
    let method = options.method ?? "GET";
    let body = options.body;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (callerSignal?.aborted) {
        throw makeAbortSsrfError(callerSignal, timeoutMs);
      }

      const hopStart = Date.now();
      const addresses = options.lookupFn
        ? await resolveWithCustomLookup(options.lookupFn, currentUrl.hostname, timeoutMs, callerSignal)
        : await resolveHostnameWithCares(currentUrl.hostname, timeoutMs, callerSignal);

      if (!addresses.length) {
        throw new SsrfError("DNS_FAILED", `No DNS records found for ${currentUrl.hostname}`);
      }
      for (const addr of addresses) {
        if (isBlockedIp(addr.address)) {
          throw new SsrfError(
            "BLOCKED_IP",
            `Blocked private/reserved IP address resolved for ${currentUrl.hostname}`
          );
        }
      }

      if (callerSignal?.aborted) {
        throw makeAbortSsrfError(callerSignal, timeoutMs);
      }

      const remainingHopMs = timeoutMs - (Date.now() - hopStart);
      if (remainingHopMs <= 0) {
        throw new SsrfError("TIMEOUT", `Request timed out after ${timeoutMs}ms`);
      }

      const hopTimeoutSignal = AbortSignal.timeout(remainingHopMs);
      const effectiveSignal = combineAbortSignals([hopTimeoutSignal, callerSignal])!;

      // Prefer IPv4 when available for better compatibility on Cloud Run / Shopify
      const pinned = addresses.find((a) => a.family === 4) ?? addresses[0]!;
      const agent = options.fetchImpl ? undefined : createPinnedAgent(pinned);
      let forceDestroyAgent = false;
      let responseBody: unknown = null;

      try {
        const init: UndiciRequestInit = {
          method,
          headers: options.headers,
          body: method === "GET" || method === "HEAD" ? undefined : body,
          redirect: "manual",
          signal: effectiveSignal,
          dispatcher: agent as unknown as Dispatcher
        };

        const res = options.fetchImpl
          ? await options.fetchImpl(currentUrl.toString(), init)
          : await undiciFetch(currentUrl.toString(), init);
        responseBody = res.body;

        const location = res.headers.get("location");
        if (
          location &&
          (res.status === 301 ||
            res.status === 302 ||
            res.status === 303 ||
            res.status === 307 ||
            res.status === 308)
        ) {
          // Cancel any unconsumed redirect body and destroy the per-hop Agent so
          // a tarpit storefront cannot stall agent.close() past hopTimeoutSignal.
          forceDestroyAgent = true;
          await cancelResponseBody(res.body);
          responseBody = null;
          if (hop >= maxRedirects) {
            throw new SsrfError(
              "TOO_MANY_REDIRECTS",
              `Exceeded maximum redirects (${maxRedirects})`
            );
          }
          const nextUrl = new URL(location, currentUrl).toString();
          currentUrl = validateExternalUrl(nextUrl);
          if (options.validateRedirectUrl) {
            options.validateRedirectUrl(currentUrl);
          }
          if (res.status === 303) {
            method = "GET";
            body = undefined;
          }
          continue;
        }

        let bodyBuffer: Buffer;
        if (method === "HEAD") {
          await cancelResponseBody(res.body);
          responseBody = null;
          bodyBuffer = Buffer.alloc(0);
        } else {
          const { buffer, truncated } = await readBoundedBody(
            res,
            maxBytes,
            Boolean(options.truncateOnMaxBytes),
            effectiveSignal,
            timeoutMs
          );
          bodyBuffer = buffer;
          if (truncated) {
            forceDestroyAgent = true;
            await cancelResponseBody(res.body);
          }
          responseBody = null;
        }
        const contentType = res.headers.get("content-type") ?? "";
        const selectedHeaders: Record<string, string> = {};
        for (const key of [
          "content-type",
          "cache-control",
          "etag",
          "powered-by",
          "x-powered-by",
          "server",
          "x-bc-storefront-type",
          "sw-context-token",
          "x-magento-tags"
        ]) {
          const val = res.headers.get(key);
          if (val !== null) selectedHeaders[key] = val;
        }

        return {
          status: res.status,
          url: currentUrl.toString(),
          contentType,
          headers: selectedHeaders,
          bodyBuffer,
          bodyText: bodyBuffer.toString("utf8")
        };
      } catch (err) {
        forceDestroyAgent = true;
        await cancelResponseBody(responseBody);
        responseBody = null;
        if (err instanceof SsrfError) throw err;
        if (callerSignal?.aborted) {
          throw makeAbortSsrfError(callerSignal, timeoutMs);
        }
        if (
          hopTimeoutSignal.aborted ||
          (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
        ) {
          throw new SsrfError("TIMEOUT", `Request timed out after ${timeoutMs}ms`);
        }
        throw err;
      } finally {
        if (agent) {
          const teardown =
            forceDestroyAgent || effectiveSignal.aborted ? agent.destroy() : agent.close();
          await teardown.catch(() => undefined);
        }
      }
    }

    throw new SsrfError("TOO_MANY_REDIRECTS", `Exceeded maximum redirects (${maxRedirects})`);
  } finally {
    release();
  }
}
