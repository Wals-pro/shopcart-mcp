import { Readable } from "node:stream";
import zlib from "node:zlib";
import { AFFILIATE_DISCLOSURE_NOTE } from "../../attribution/links.js";
import {
  sanitizeOptionalText,
  sanitizeText,
  stripControlAndInvisible,
  stripHtmlToText
} from "../../security/sanitize.js";
import {
  safeFetch,
  SsrfError,
  validateExternalUrl,
  type SafeFetchOptions,
  type SafeFetchResponse
} from "../../security/ssrf.js";
import {
  formatMoney,
  matchesSearchQuery,
  moneyFromDecimalString,
  normalizeCurrency
} from "../shopify/normalize.js";
import type {
  AffiliateFeedConfig,
  AffiliateFeedProduct,
  AffiliateFeedProvider,
  AffiliateFeedSearchOptions,
  AffiliateFeedSearchResult
} from "./types.js";

export type AffiliateFetcherFn = (
  url: string,
  opts?: SafeFetchOptions
) => Promise<SafeFetchResponse>;

const AWIN_FEED_UA = "Mozilla/5.0 (compatible; shopcart-mcp/0.3; +https://shopcart.wals.pro)";

const AWIN_COLUMNS = [
  "aw_deep_link",
  "product_name",
  "aw_product_id",
  "merchant_product_id",
  "merchant_image_url",
  "description",
  "merchant_category",
  "search_price",
  "merchant_name",
  "merchant_id",
  "currency",
  "in_stock",
  "stock_quantity",
  "brand_name",
  "ean",
  "gtin",
  "mpn",
  "rrp_price",
  "store_price",
  "merchant_deep_link"
].join(",");

const CROSS_STORE_ALIASES = new Set([
  "compare",
  "deals",
  "awin",
  "affiliate",
  "all",
  "preisvergleich"
]);

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB compressed/download cap
const MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024; // 25 MiB decompressed cap against gzip bombs
const DEFAULT_MAX_FEEDS = 10;
const MAX_CSV_ROWS = 20_000;
const MAX_CSV_COLUMNS = 64;
const MAX_CELL_LENGTH = 8_192;
const MAX_FEED_ITEMS = 20_000;
const MAX_SAFE_URL_LENGTH = 2048;

const ALLOWED_AWIN_FEED_HOSTS = new Set(["productdata.awin.com", "api.awin.com"]);
const ALLOWED_AWIN_CLICK_HOSTS = new Set([
  "www.awin1.com",
  "awin1.com",
  "www.awin.com",
  "productdata.awin.com"
]);

interface FeedListEntry {
  feedId: string;
  advertiserId: string | null;
  advertiserName: string;
  membershipStatus: string;
  url: string;
}

interface CachedFeed {
  feedId: string;
  items: AffiliateFeedProduct[];
  merchants: string[];
  expiresAt: number;
}

interface CachedFeedList {
  entries: FeedListEntry[];
  expiresAt: number;
}

export function loadAffiliateFeedConfig(
  env: NodeJS.ProcessEnv = process.env
): AffiliateFeedConfig {
  const apiToken = env.AWIN_API_TOKEN?.trim() || undefined;
  const publisherId = env.AWIN_PUBLISHER_ID?.trim() || undefined;
  const feedIds = (env.AWIN_FEED_IDS ?? "")
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter((id) => /^\d{1,12}$/.test(id));

  const parsedTtl = Number.parseInt(env.AWIN_FEED_TTL_SECONDS ?? "", 10);
  const ttlSeconds = Number.isFinite(parsedTtl)
    ? Math.min(86400, Math.max(60, parsedTtl))
    : DEFAULT_TTL_SECONDS;

  const parsedMaxBytes = Number.parseInt(env.AWIN_FEED_MAX_BYTES ?? "", 10);
  const maxBytes = Number.isFinite(parsedMaxBytes)
    ? Math.min(25 * 1024 * 1024, Math.max(65_536, parsedMaxBytes))
    : DEFAULT_MAX_BYTES;

  return {
    provider: "awin",
    apiToken,
    publisherId,
    feedIds: Array.from(new Set(feedIds)),
    ttlSeconds,
    maxBytes,
    maxFeeds: DEFAULT_MAX_FEEDS
  };
}

export function isCrossStoreAlias(storeInput: string): boolean {
  const norm = storeInput.trim().toLowerCase();
  return CROSS_STORE_ALIASES.has(norm);
}

export function normalizeEan(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[\s-]+/g, "").trim();
  if (!/^\d{8,14}$/.test(digits)) return null;
  return digits;
}

export function validateAwinFeedUrl(rawUrl: string): string {
  const parsed = validateExternalUrl(rawUrl);
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!ALLOWED_AWIN_FEED_HOSTS.has(host)) {
    throw new SsrfError(
      "BLOCKED_HOST",
      `Awin feed host not in allowlist: ${host}`
    );
  }
  return parsed.toString();
}

function sanitizeExternalLink(
  raw: string | null | undefined,
  opts: { requireAwinClickHost?: boolean } = {}
): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = stripControlAndInvisible(raw).trim();
  if (!trimmed || trimmed.length > MAX_SAFE_URL_LENGTH) return null;
  try {
    const parsed = validateExternalUrl(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (opts.requireAwinClickHost && !ALLOWED_AWIN_CLICK_HOSTS.has(host)) {
      return null;
    }
    const finalUrl = parsed.toString();
    return finalUrl.length <= MAX_SAFE_URL_LENGTH ? finalUrl : null;
  } catch {
    return null;
  }
}

function redactToken(text: string, token?: string): string {
  if (!token) return text;
  let out = text.split(token).join("[REDACTED]");
  const encoded = encodeURIComponent(token);
  if (encoded !== token) {
    out = out.split(encoded).join("[REDACTED]");
  }
  return out;
}

/**
 * Streaming single-pass RFC 4180 CSV parser invoking `onRecord` per row with strict
 * row, column, and cell-length bounds to prevent V8 heap amplification.
 */
function streamCsvRecords(
  input: string,
  onRecord: (record: Record<string, string>) => boolean | void
): void {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let headers: string[] | null = null;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let dataRows = 0;

  const pushCell = (): void => {
    if (row.length < MAX_CSV_COLUMNS) {
      row.push(field.length > MAX_CELL_LENGTH ? field.slice(0, MAX_CELL_LENGTH) : field);
    }
    field = "";
  };

  const flushRow = (): boolean => {
    pushCell();
    const hasContent = row.some((cell) => cell.length > 0);
    const completed = row;
    row = [];
    if (!hasContent) return true;

    if (!headers) {
      headers = completed.slice(0, MAX_CSV_COLUMNS).map((h) => h.trim().toLowerCase());
      return true;
    }

    if (dataRows >= MAX_CSV_ROWS) return false;
    dataRows++;
    const rec: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      rec[key] = completed[c] ?? "";
    }
    return onRecord(rec) !== false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          if (field.length < MAX_CELL_LENGTH) field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (field.length < MAX_CELL_LENGTH) {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      if (!flushRow()) return;
    } else if (ch === "\n") {
      if (!flushRow()) return;
    } else if (field.length < MAX_CELL_LENGTH) {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    flushRow();
  }
}

/**
 * RFC 4180 CSV parser supporting quoted fields, escaped quotes (""),
 * embedded commas/newlines, UTF-8 BOM stripping, and strict row/column/cell bounds.
 */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const records: Array<Record<string, string>> = [];
  streamCsvRecords(input, (rec) => {
    records.push(rec);
  });
  return records;
}

function parseAvailability(rawInStock: unknown, rawQty: unknown): {
  available: boolean;
  stockQuantity: number | null;
} {
  let stockQuantity: number | null = null;
  if (rawQty !== undefined && rawQty !== null && String(rawQty).trim() !== "") {
    const q = Number.parseInt(String(rawQty).trim(), 10);
    if (Number.isFinite(q) && q >= 0) {
      stockQuantity = q;
    }
  }

  const val = String(rawInStock ?? "")
    .trim()
    .toLowerCase();
  if (val === "0" || val === "false" || val === "no" || val === "n" || val === "out of stock") {
    return { available: false, stockQuantity };
  }
  if (val === "1" || val === "true" || val === "yes" || val === "y" || val === "in stock") {
    return { available: stockQuantity === null ? true : stockQuantity > 0, stockQuantity };
  }
  if (stockQuantity !== null) {
    return { available: stockQuantity > 0, stockQuantity };
  }
  return { available: true, stockQuantity };
}

function normalizeMerchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.(de|at|ch|com|eu|co\.uk|fr|nl|it|es)$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeAwinRow(row: Record<string, unknown>): AffiliateFeedProduct | null {
  const get = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const v = row[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        return String(v);
      }
    }
    return undefined;
  };

  const title = sanitizeText(get("product_name", "title", "name"), 220);
  const awDeepLink = sanitizeExternalLink(
    get("aw_deep_link", "click_url", "deep_link", "url"),
    { requireAwinClickHost: true }
  );
  if (!title || !awDeepLink) return null;

  const currency = normalizeCurrency(get("currency") ?? "EUR");
  const price =
    moneyFromDecimalString(get("search_price", "price", "store_price"), currency) ??
    formatMoney(0, currency);
  const rrpRaw = get("rrp_price", "compare_at_price", "saving_price");
  const rrpMoney = moneyFromDecimalString(rrpRaw, currency, true);
  const compareAt = rrpMoney && rrpMoney.amount > price.amount ? rrpMoney : null;

  const { available, stockQuantity } = parseAvailability(
    get("in_stock", "availability", "available"),
    get("stock_quantity")
  );

  const ean = normalizeEan(get("ean", "product_gtin"));
  const gtin = normalizeEan(get("gtin", "product_gtin")) ?? ean;
  const merchantName =
    sanitizeOptionalText(get("merchant_name", "advertiser_name", "merchant"), 120) ?? "Partner Store";
  const merchantId = sanitizeOptionalText(get("merchant_id", "advertiser_id"), 40);
  const awProductId =
    sanitizeOptionalText(get("aw_product_id", "id", "merchant_product_id"), 100) ??
    `${merchantId ?? "awin"}:${ean ?? title.slice(0, 32)}`;

  return {
    id: awProductId,
    merchant_product_id: sanitizeOptionalText(get("merchant_product_id", "sku"), 100),
    title,
    merchant_name: merchantName,
    merchant_id: merchantId,
    brand: sanitizeOptionalText(get("brand_name", "brand"), 100),
    category: sanitizeOptionalText(get("merchant_category", "category_name"), 140),
    description_text: stripHtmlToText(get("description", "product_short_description"), 500),
    ean,
    gtin,
    mpn: sanitizeOptionalText(get("mpn"), 80),
    available,
    stock_quantity: stockQuantity,
    price,
    compare_at_price: compareAt,
    url: awDeepLink,
    product_url: awDeepLink,
    merchant_url: sanitizeExternalLink(get("merchant_deep_link")),
    image_url: sanitizeExternalLink(get("merchant_image_url", "aw_image_url", "image_url")),
    affiliate_network: "awin",
    affiliate_disclosure: true
  };
}

async function decodeBodySafely(
  res: SafeFetchResponse,
  maxUncompressedBytes: number
): Promise<string> {
  const buf = res.bodyBuffer;
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isGzip) {
    if (buf.byteLength > maxUncompressedBytes) {
      throw new SsrfError("BODY_TOO_LARGE", `Feed payload exceeded ${maxUncompressedBytes} bytes`);
    }
    return res.bodyText;
  }

  return new Promise<string>((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      gunzip.destroy();
      reject(err);
    };

    gunzip.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxUncompressedBytes) {
        fail(
          new SsrfError(
            "BODY_TOO_LARGE",
            `Decompressed feed exceeded ${maxUncompressedBytes} bytes`
          )
        );
        return;
      }
      chunks.push(chunk);
    });
    gunzip.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, total).toString("utf8"));
    });
    gunzip.on("error", (err) => fail(err));

    const source = Readable.from([buf]);
    source.on("error", (err) => fail(err));
    source.pipe(gunzip);
  });
}

function parseFeedPayload(bodyText: string): AffiliateFeedProduct[] {
  const trimmed = bodyText.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const rawArr: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { products?: unknown }).products)
          ? (parsed as { products: unknown[] }).products
          : [];
      const products: AffiliateFeedProduct[] = [];
      for (const item of rawArr) {
        if (products.length >= MAX_FEED_ITEMS) break;
        if (item && typeof item === "object") {
          const normalized = normalizeAwinRow(item as Record<string, unknown>);
          if (normalized) products.push(normalized);
        }
      }
      return products;
    } catch {
      return [];
    }
  }

  const products: AffiliateFeedProduct[] = [];
  streamCsvRecords(trimmed, (rec) => {
    if (products.length >= MAX_FEED_ITEMS) return false;
    const normalized = normalizeAwinRow(rec);
    if (normalized) products.push(normalized);
    return products.length < MAX_FEED_ITEMS;
  });
  return products;
}

export class AwinFeedClient implements AffiliateFeedProvider {
  readonly providerName = "awin" as const;
  private readonly config: AffiliateFeedConfig;
  private readonly fetcher: AffiliateFetcherFn;
  private readonly nowFn: () => number;
  private readonly feedCache = new Map<string, CachedFeed>();
  private readonly feedInFlight = new Map<string, Promise<CachedFeed>>();
  private feedListCache: CachedFeedList | null = null;
  private feedListInFlight: Promise<FeedListEntry[]> | null = null;

  constructor(
    config: AffiliateFeedConfig = loadAffiliateFeedConfig(),
    opts: { fetcher?: AffiliateFetcherFn; nowFn?: () => number } = {}
  ) {
    this.config = config;
    this.fetcher = opts.fetcher ?? safeFetch;
    this.nowFn = opts.nowFn ?? Date.now;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiToken && this.config.publisherId);
  }

  clearCache(): void {
    this.feedCache.clear();
    this.feedInFlight.clear();
    this.feedListCache = null;
    this.feedListInFlight = null;
  }

  private buildFeedDownloadUrl(feedId: string): string {
    const token = encodeURIComponent(this.config.apiToken ?? "");
    const safeFeedId = encodeURIComponent(feedId);
    return `https://productdata.awin.com/datafeed/download/apikey/${token}/language/any/fid/${safeFeedId}/columns/${AWIN_COLUMNS}/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/`;
  }

  private buildFeedListUrl(): string {
    const token = encodeURIComponent(this.config.apiToken ?? "");
    return `https://productdata.awin.com/datafeed/list/apikey/${token}`;
  }

  private async fetchFeedList(concurrencyKey?: string): Promise<FeedListEntry[]> {
    const now = this.nowFn();
    if (this.feedListCache && this.feedListCache.expiresAt > now) {
      return this.feedListCache.entries;
    }
    if (this.feedListInFlight) {
      return this.feedListInFlight;
    }

    const work = (async () => {
      const url = validateAwinFeedUrl(this.buildFeedListUrl());
      const res = await this.fetcher(url, {
        method: "GET",
        headers: {
          "User-Agent": AWIN_FEED_UA,
          Accept: "text/csv, application/json, */*;q=0.1"
        },
        timeoutMs: 8000,
        maxRedirects: 2,
        maxBytes: Math.min(this.config.maxBytes, 5 * 1024 * 1024),
        concurrencyKey,
        validateRedirectUrl: (u) => {
          validateAwinFeedUrl(u.toString());
        }
      });

      if (res.url) {
        validateAwinFeedUrl(res.url);
      }

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Awin feed list returned HTTP ${res.status}`);
      }

      const bodyText = await decodeBodySafely(res, MAX_UNCOMPRESSED_BYTES);
      const records = parseCsvRecords(bodyText);
      const entries: FeedListEntry[] = [];

      for (const rec of records) {
        const feedId = (rec["feed id"] ?? rec["feed_id"] ?? rec["fid"] ?? "").trim();
        const status = (rec["membership status"] ?? rec["membership_status"] ?? "joined")
          .trim()
          .toLowerCase();
        const rawUrl = (rec["url"] ?? "").trim();
        const advertiserName =
          sanitizeOptionalText(
            rec["advertiser name"] ?? rec["advertiser_name"] ?? rec["merchant_name"],
            120
          ) ?? `Feed ${feedId}`;
        const advertiserId = sanitizeOptionalText(
          rec["advertiser id"] ?? rec["advertiser_id"],
          40
        );

        if (!/^\d{1,12}$/.test(feedId)) continue;
        if (status && status !== "joined" && status !== "active") continue;

        let safeUrl: string;
        if (rawUrl) {
          try {
            safeUrl = validateAwinFeedUrl(rawUrl);
          } catch {
            safeUrl = this.buildFeedDownloadUrl(feedId);
          }
        } else {
          safeUrl = this.buildFeedDownloadUrl(feedId);
        }

        entries.push({
          feedId,
          advertiserId,
          advertiserName,
          membershipStatus: status || "joined",
          url: safeUrl
        });
      }

      this.feedListCache = {
        entries: entries.slice(0, this.config.maxFeeds),
        expiresAt: now + this.config.ttlSeconds * 1000
      };
      return this.feedListCache.entries;
    })();

    this.feedListInFlight = work;
    try {
      return await work;
    } finally {
      if (this.feedListInFlight === work) {
        this.feedListInFlight = null;
      }
    }
  }

  private async loadSingleFeed(
    feedId: string,
    feedUrl: string,
    concurrencyKey?: string
  ): Promise<CachedFeed> {
    const now = this.nowFn();
    const cached = this.feedCache.get(feedId);
    if (cached && cached.expiresAt > now) {
      return cached;
    }
    const existingInFlight = this.feedInFlight.get(feedId);
    if (existingInFlight) {
      return existingInFlight;
    }

    const work = (async () => {
      const safeUrl = validateAwinFeedUrl(feedUrl);
      const res = await this.fetcher(safeUrl, {
        method: "GET",
        headers: {
          "User-Agent": AWIN_FEED_UA,
          Accept: "text/csv, application/gzip, application/json, */*;q=0.1"
        },
        timeoutMs: 10000,
        maxRedirects: 2,
        maxBytes: this.config.maxBytes,
        concurrencyKey,
        validateRedirectUrl: (u) => {
          validateAwinFeedUrl(u.toString());
        }
      });

      if (res.url) {
        validateAwinFeedUrl(res.url);
      }

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Awin feed ${feedId} returned HTTP ${res.status}`);
      }

      const bodyText = await decodeBodySafely(res, MAX_UNCOMPRESSED_BYTES);
      const items = parseFeedPayload(bodyText);
      const merchants = Array.from(new Set(items.map((item) => item.merchant_name))).sort();

      const entry: CachedFeed = {
        feedId,
        items,
        merchants,
        expiresAt: now + this.config.ttlSeconds * 1000
      };
      this.feedCache.set(feedId, entry);
      return entry;
    })();

    this.feedInFlight.set(feedId, work);
    try {
      return await work;
    } finally {
      if (this.feedInFlight.get(feedId) === work) {
        this.feedInFlight.delete(feedId);
      }
    }
  }

  private async loadAllConfiguredFeeds(concurrencyKey?: string): Promise<{
    items: AffiliateFeedProduct[];
    merchants: string[];
    notices: string[];
  }> {
    if (!this.isConfigured()) {
      return { items: [], merchants: [], notices: [] };
    }

    const notices: string[] = [];
    let targets: Array<{ feedId: string; url: string }> = [];

    if (this.config.feedIds.length > 0) {
      targets = this.config.feedIds.slice(0, this.config.maxFeeds).map((feedId) => ({
        feedId,
        url: this.buildFeedDownloadUrl(feedId)
      }));
    } else {
      try {
        const list = await this.fetchFeedList(concurrencyKey);
        targets = list.map((e) => ({ feedId: e.feedId, url: e.url }));
      } catch (err) {
        const msg = err instanceof Error ? redactToken(err.message, this.config.apiToken) : "feed list error";
        notices.push(`Could not load Awin feed list: ${msg}`);
        return { items: [], merchants: [], notices };
      }
    }

    if (targets.length === 0) {
      notices.push("No active Awin product feeds available.");
      return { items: [], merchants: [], notices };
    }

    const results = await Promise.allSettled(
      targets.map((t) => this.loadSingleFeed(t.feedId, t.url, concurrencyKey))
    );

    const items: AffiliateFeedProduct[] = [];
    const merchantSet = new Set<string>();

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const target = targets[i]!;
      if (r.status === "fulfilled") {
        items.push(...r.value.items);
        for (const m of r.value.merchants) merchantSet.add(m);
      } else {
        const reason =
          r.reason instanceof Error
            ? redactToken(r.reason.message, this.config.apiToken)
            : "download error";
        notices.push(`Skipped Awin feed ${target.feedId}: ${reason}`);
      }
    }

    return {
      items,
      merchants: Array.from(merchantSet).sort(),
      notices
    };
  }

  async listMerchants(concurrencyKey?: string): Promise<string[]> {
    if (!this.isConfigured()) return [];
    const loaded = await this.loadAllConfiguredFeeds(concurrencyKey);
    return loaded.merchants;
  }

  async resolveStoreTarget(
    storeInput: string,
    concurrencyKey?: string
  ): Promise<{ mode: "all" } | { mode: "merchant"; merchant: string } | null> {
    const trimmed = storeInput.trim();
    if (!trimmed) return null;

    if (isCrossStoreAlias(trimmed)) {
      return { mode: "all" };
    }

    if (!this.isConfigured()) {
      return null;
    }

    const needle = normalizeMerchantKey(trimmed);
    if (!needle || needle.length < 3) return null;

    // Explicit URLs/domains (containing '.' or '://') must match a partner merchant key exactly
    // so live storefront domains are never hijacked by short/empty untrusted feed merchant names.
    const looksLikeDomainOrUrl = trimmed.includes("://") || trimmed.includes(".");
    const merchants = await this.listMerchants(concurrencyKey);
    for (const merchant of merchants) {
      const norm = normalizeMerchantKey(merchant);
      if (!norm || norm.length < 3) continue;
      if (norm === needle) {
        return { mode: "merchant", merchant };
      }
      if (!looksLikeDomainOrUrl && norm.includes(needle)) {
        return { mode: "merchant", merchant };
      }
    }
    return null;
  }

  async searchByEan(
    ean: string,
    opts: Omit<AffiliateFeedSearchOptions, "ean"> = {}
  ): Promise<AffiliateFeedSearchResult> {
    return this.search({ ...opts, ean });
  }

  async search(opts: AffiliateFeedSearchOptions): Promise<AffiliateFeedSearchResult> {
    if (!this.isConfigured()) {
      return {
        provider: "awin",
        configured: false,
        currency: "EUR",
        merchants_searched: [],
        products: [],
        notices: [
          "Affiliate product feeds are not configured (set AWIN_API_TOKEN and AWIN_PUBLISHER_ID to enable cross-store deal & EAN search)."
        ],
        affiliate_disclosure: false
      };
    }

    const limit = Math.min(25, Math.max(1, Math.floor(opts.limit ?? 10)));
    const loaded = await this.loadAllConfiguredFeeds(opts.concurrencyKey);
    const notices = [...loaded.notices];

    const explicitEan = normalizeEan(opts.ean);
    const trimmedQuery = opts.query?.trim() ?? "";
    const inferredEan = !explicitEan ? normalizeEan(trimmedQuery) : null;
    const targetEan = explicitEan ?? inferredEan;
    const keywordQuery = inferredEan ? "" : trimmedQuery;
    const rawMerchantFilter = opts.merchant?.trim() ?? "";
    const merchantNeedle = rawMerchantFilter ? normalizeMerchantKey(rawMerchantFilter) : "";

    let filtered = loaded.items;

    if (rawMerchantFilter) {
      if (merchantNeedle.length < 2) {
        filtered = [];
      } else {
        filtered = filtered.filter((p) => {
          const mKey = normalizeMerchantKey(p.merchant_name);
          if (mKey.length < 2) return false;
          return mKey === merchantNeedle || mKey.includes(merchantNeedle);
        });
      }
    }

    if (targetEan) {
      filtered = filtered.filter((p) => p.ean === targetEan || p.gtin === targetEan);
    }

    if (keywordQuery) {
      filtered = filtered.filter((p) => {
        const haystack = `${p.title} ${p.brand ?? ""} ${p.merchant_name} ${p.category ?? ""} ${p.mpn ?? ""} ${p.ean ?? ""} ${p.description_text}`;
        return matchesSearchQuery(haystack, keywordQuery);
      });
    }

    if (opts.availableOnly) {
      const avail = filtered.filter((p) => p.available);
      if (filtered.length > 0 && avail.length === 0) {
        notices.push("All matching affiliate feed offers are currently out of stock.");
      }
      filtered = avail;
    }

    if (typeof opts.minPrice === "number" && Number.isFinite(opts.minPrice)) {
      filtered = filtered.filter((p) => p.price.amount >= opts.minPrice!);
    }
    if (typeof opts.maxPrice === "number" && Number.isFinite(opts.maxPrice)) {
      filtered = filtered.filter((p) => p.price.amount <= opts.maxPrice!);
    }

    // Rank: exact EAN match -> in stock -> title match -> lowest price
    const lowerKeyword = keywordQuery.toLowerCase();
    filtered.sort((a, b) => {
      if (targetEan) {
        const aExact = a.ean === targetEan || a.gtin === targetEan ? 1 : 0;
        const bExact = b.ean === targetEan || b.gtin === targetEan ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
      }
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (lowerKeyword) {
        const aTitle = a.title.toLowerCase().includes(lowerKeyword) ? 1 : 0;
        const bTitle = b.title.toLowerCase().includes(lowerKeyword) ? 1 : 0;
        if (aTitle !== bTitle) return bTitle - aTitle;
      }
      return a.price.amount - b.price.amount;
    });

    const sliced = filtered.slice(0, limit);
    const currency = sliced[0]?.price.currency ?? loaded.items[0]?.price.currency ?? "EUR";

    return {
      provider: "awin",
      configured: true,
      currency,
      merchants_searched: loaded.merchants,
      products: sliced,
      notices,
      affiliate_disclosure: true,
      disclosure_note: AFFILIATE_DISCLOSURE_NOTE
    };
  }
}
