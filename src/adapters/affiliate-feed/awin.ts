import zlib from "node:zlib";
import { AFFILIATE_DISCLOSURE_NOTE } from "../../attribution/links.js";
import {
  sanitizeOptionalText,
  sanitizeText,
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
  if (host !== "productdata.awin.com" && host !== "api.awin.com" && !host.endsWith(".awin.com")) {
    throw new SsrfError(
      "BLOCKED_HOST",
      `Awin feed host not in allowlist: ${host}`
    );
  }
  return parsed.toString();
}

function sanitizeExternalLink(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = validateExternalUrl(trimmed);
    return parsed.toString();
  } catch {
    return null;
  }
}

function redactToken(text: string, token?: string): string {
  if (!token) return text;
  return text.split(token).join("[REDACTED]");
}

/**
 * RFC 4180 CSV parser supporting quoted fields, escaped quotes (""),
 * embedded commas/newlines, and UTF-8 BOM stripping.
 */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  const records: Array<Record<string, string>> = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const rec: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      rec[key] = cells[c] ?? "";
    }
    records.push(rec);
  }
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
  const awDeepLink = sanitizeExternalLink(get("aw_deep_link", "click_url", "deep_link", "url"));
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

function decodeBodySafely(res: SafeFetchResponse, maxUncompressedBytes: number): string {
  const buf = res.bodyBuffer;
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isGzip) {
    return res.bodyText;
  }
  const inflated = zlib.gunzipSync(buf, { maxOutputLength: maxUncompressedBytes });
  return inflated.toString("utf8");
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

  const records = parseCsvRecords(trimmed);
  const products: AffiliateFeedProduct[] = [];
  for (const rec of records) {
    const normalized = normalizeAwinRow(rec);
    if (normalized) products.push(normalized);
  }
  return products;
}

export class AwinFeedClient implements AffiliateFeedProvider {
  readonly providerName = "awin" as const;
  private readonly config: AffiliateFeedConfig;
  private readonly fetcher: AffiliateFetcherFn;
  private readonly nowFn: () => number;
  private readonly feedCache = new Map<string, CachedFeed>();
  private feedListCache: CachedFeedList | null = null;

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
    this.feedListCache = null;
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
      concurrencyKey
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Awin feed list returned HTTP ${res.status}`);
    }

    const bodyText = decodeBodySafely(res, MAX_UNCOMPRESSED_BYTES);
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
      concurrencyKey
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Awin feed ${feedId} returned HTTP ${res.status}`);
    }

    const bodyText = decodeBodySafely(res, MAX_UNCOMPRESSED_BYTES);
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
    if (!needle || needle.length < 2) return null;

    const merchants = await this.listMerchants(concurrencyKey);
    for (const merchant of merchants) {
      const norm = normalizeMerchantKey(merchant);
      if (norm === needle || norm.includes(needle) || needle.includes(norm)) {
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

    const limit = Math.min(20, Math.max(1, Math.floor(opts.limit ?? 10)));
    const loaded = await this.loadAllConfiguredFeeds(opts.concurrencyKey);
    const notices = [...loaded.notices];

    const explicitEan = normalizeEan(opts.ean);
    const trimmedQuery = opts.query?.trim() ?? "";
    const inferredEan = !explicitEan ? normalizeEan(trimmedQuery) : null;
    const targetEan = explicitEan ?? inferredEan;
    const keywordQuery = inferredEan ? "" : trimmedQuery;
    const merchantNeedle = opts.merchant ? normalizeMerchantKey(opts.merchant) : "";

    let filtered = loaded.items;

    if (merchantNeedle) {
      filtered = filtered.filter((p) => {
        const mKey = normalizeMerchantKey(p.merchant_name);
        return mKey.includes(merchantNeedle) || merchantNeedle.includes(mKey);
      });
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
