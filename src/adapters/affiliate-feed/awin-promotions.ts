import { AFFILIATE_DISCLOSURE_NOTE } from "../../attribution/links.js";
import type { ComparisonCountry } from "../../comparison/deep-links.js";
import { enforceShellSafeHttpsUrl } from "../../security/identifiers.js";
import {
  sanitizeOptionalText,
  sanitizeText,
  stripControlAndInvisible,
  stripHtmlToText
} from "../../security/sanitize.js";
import { safeFetch, SsrfError, validateExternalUrl } from "../../security/ssrf.js";
import { matchesSearchQuery } from "../shopify/normalize.js";
import { loadAffiliateFeedConfig, type AffiliateFetcherFn } from "./awin.js";
import type { AffiliateFeedConfig } from "./types.js";

const AWIN_PROMOTIONS_UA =
  "Mozilla/5.0 (compatible; shopcart-mcp/0.6; +https://shopcart.wals.pro)";

const ALLOWED_AWIN_PROMOTIONS_HOSTS: ReadonlySet<string> = new Set(["api.awin.com"]);

const DEFAULT_PROMOTIONS_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_CACHE_KEYS = 16;
const PROMOTIONS_TIMEOUT_MS = 8_000;
const PROMOTIONS_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_PROMOTIONS_PARSED = 200;
const MAX_SAFE_URL_LENGTH = 2048;

const PUBLISHER_ID_RE = /^\d{1,12}$/;

const AWIN_REGION_CODES: Record<ComparisonCountry, string> = {
  AT: "AT",
  DE: "DE",
  CH: "CH",
  UK: "GB",
  FR: "FR",
  US: "US"
};

export interface AwinPromotionItem {
  id: string;
  type: "voucher" | "deal";
  title: string;
  description: string;
  terms: string | null;
  advertiser_name: string;
  advertiser_id: string | null;
  voucher_code: string | null;
  exclusive: boolean;
  campaign: string | null;
  categories: string[];
  start_date: string | null;
  end_date: string | null;
  url: string;
  merchant_url: string | null;
  affiliate_network: "awin";
  affiliate_disclosure: true;
}

export interface AwinPromotionsSearchOptions {
  region: ComparisonCountry;
  query?: string;
  category?: string;
  includeVouchers?: boolean;
  limit?: number;
  concurrencyKey?: string;
}

export interface AwinPromotionsSearchResult {
  provider: "awin_promotions";
  configured: boolean;
  region: ComparisonCountry;
  awin_region_code: string;
  live_vouchers: AwinPromotionItem[];
  live_deals: AwinPromotionItem[];
  notices: string[];
  affiliate_disclosure: boolean;
  disclosure_note?: string;
}

export interface AwinPromotionsProvider {
  readonly providerName: "awin_promotions";
  isConfigured(): boolean;
  clearCache(): void;
  search(opts: AwinPromotionsSearchOptions): Promise<AwinPromotionsSearchResult>;
}

interface CachedRegionPromotions {
  items: AwinPromotionItem[];
  expiresAt: number;
}

export function mapRegionToAwinCode(region: ComparisonCountry): string {
  return AWIN_REGION_CODES[region];
}

export function validateAwinPromotionsUrl(rawUrl: string): string {
  const parsed = validateExternalUrl(rawUrl);
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!ALLOWED_AWIN_PROMOTIONS_HOSTS.has(host)) {
    throw new SsrfError(
      "BLOCKED_HOST",
      `Awin promotions API host not in allowlist: ${host}`
    );
  }
  return parsed.toString();
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

function sanitizeExternalPromotionUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = stripControlAndInvisible(raw).trim();
  if (!trimmed || trimmed.length > MAX_SAFE_URL_LENGTH) return null;
  try {
    const parsed = validateExternalUrl(trimmed);
    const safe = enforceShellSafeHttpsUrl(parsed.toString());
    if (!safe || safe.length > MAX_SAFE_URL_LENGTH) return null;
    return safe;
  } catch {
    return null;
  }
}

function sanitizeVoucherCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = stripControlAndInvisible(raw).trim();
  if (!cleaned || cleaned.length > 64) return null;
  // Reject newlines/tabs or obvious HTML/script injection inside voucher codes
  if (/[\r\n\t<>]/.test(cleaned)) return null;
  return cleaned;
}

function extractCategoryNames(rawCategories: unknown): string[] {
  if (!Array.isArray(rawCategories)) return [];
  const names: string[] = [];
  for (const entry of rawCategories.slice(0, 12)) {
    if (typeof entry === "string") {
      const cleaned = sanitizeText(entry, 80);
      if (cleaned) names.push(cleaned);
    } else if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const name = sanitizeText(
        typeof obj.name === "string"
          ? obj.name
          : typeof obj.title === "string"
            ? obj.title
            : "",
        80
      );
      if (name) names.push(name);
    }
  }
  return Array.from(new Set(names));
}

function normalizePromotionEntry(
  raw: Record<string, unknown>,
  index: number
): AwinPromotionItem | null {
  const trackingUrl = sanitizeExternalPromotionUrl(
    raw.urlTracking ?? raw.url_tracking ?? raw.trackingUrl ?? raw.clickUrl
  );
  const directUrl = sanitizeExternalPromotionUrl(raw.url ?? raw.merchantUrl);
  const finalUrl = trackingUrl ?? directUrl;
  if (!finalUrl) return null;

  const advertiser =
    raw.advertiser && typeof raw.advertiser === "object"
      ? (raw.advertiser as Record<string, unknown>)
      : null;

  const advertiserName =
    sanitizeOptionalText(
      typeof advertiser?.name === "string"
        ? advertiser.name
        : typeof raw.advertiserName === "string"
          ? raw.advertiserName
          : undefined,
      120
    ) ?? "Partner Store";

  const advertiserIdRaw = advertiser?.id ?? raw.advertiserId;
  const advertiserId =
    advertiserIdRaw !== undefined && advertiserIdRaw !== null
      ? sanitizeOptionalText(String(advertiserIdRaw), 40)
      : null;

  const rawTitle = typeof raw.title === "string" ? raw.title : "";
  const rawDescription = typeof raw.description === "string" ? raw.description : "";
  const rawTerms = typeof raw.terms === "string" ? raw.terms : "";

  const title = sanitizeText(stripHtmlToText(rawTitle, 240), 200);
  const description = stripHtmlToText(rawDescription, 400);
  const terms = sanitizeOptionalText(stripHtmlToText(rawTerms, 340), 300);

  const voucherObj =
    raw.voucher && typeof raw.voucher === "object"
      ? (raw.voucher as Record<string, unknown>)
      : null;
  const voucherCode = sanitizeVoucherCode(
    voucherObj?.code ?? raw.voucherCode ?? raw.code
  );
  const exclusive = Boolean(voucherObj?.exclusive ?? raw.exclusive ?? false);

  const effectiveTitle = title || (voucherCode ? `${advertiserName} Voucher (${voucherCode})` : "");
  if (!effectiveTitle) return null;

  const rawId = raw.promotionId ?? raw.id;
  const id =
    rawId !== undefined && rawId !== null
      ? sanitizeText(String(rawId), 64)
      : `awin-promo-${index + 1}`;

  return {
    id: id || `awin-promo-${index + 1}`,
    type: voucherCode ? "voucher" : "deal",
    title: effectiveTitle,
    description,
    terms,
    advertiser_name: advertiserName,
    advertiser_id: advertiserId,
    voucher_code: voucherCode,
    exclusive,
    campaign: sanitizeOptionalText(
      typeof raw.campaign === "string" ? raw.campaign : undefined,
      100
    ),
    categories: extractCategoryNames(raw.categories),
    start_date: sanitizeOptionalText(
      typeof raw.startDate === "string" ? raw.startDate : undefined,
      40
    ),
    end_date: sanitizeOptionalText(
      typeof raw.endDate === "string" ? raw.endDate : undefined,
      40
    ),
    url: finalUrl,
    merchant_url: directUrl && directUrl !== finalUrl ? directUrl : null,
    affiliate_network: "awin",
    affiliate_disclosure: true
  };
}

function parsePromotionsPayload(bodyText: string): AwinPromotionItem[] {
  const trimmed = bodyText.trim();
  if (!trimmed) return [];
  const parsed: unknown = JSON.parse(trimmed);
  const rawItems: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : [];

  const items: AwinPromotionItem[] = [];
  for (let i = 0; i < rawItems.length && items.length < MAX_PROMOTIONS_PARSED; i++) {
    const entry = rawItems[i];
    if (!entry || typeof entry !== "object") continue;
    const normalized = normalizePromotionEntry(entry as Record<string, unknown>, i);
    if (normalized) {
      items.push(normalized);
    }
  }
  return items;
}

export class AwinPromotionsClient implements AwinPromotionsProvider {
  readonly providerName = "awin_promotions" as const;
  private readonly config: AffiliateFeedConfig;
  private readonly fetcher: AffiliateFetcherFn;
  private readonly nowFn: () => number;
  private readonly ttlMs: number;
  private readonly maxCacheKeys: number;
  private readonly cache = new Map<string, CachedRegionPromotions>();
  private readonly inFlight = new Map<string, Promise<AwinPromotionItem[]>>();

  constructor(
    config: AffiliateFeedConfig = loadAffiliateFeedConfig(),
    opts: {
      fetcher?: AffiliateFetcherFn;
      nowFn?: () => number;
      ttlMs?: number;
      maxCacheKeys?: number;
    } = {}
  ) {
    this.config = config;
    this.fetcher = opts.fetcher ?? safeFetch;
    this.nowFn = opts.nowFn ?? Date.now;
    this.ttlMs = opts.ttlMs ?? DEFAULT_PROMOTIONS_TTL_MS;
    this.maxCacheKeys = Math.max(1, opts.maxCacheKeys ?? DEFAULT_MAX_CACHE_KEYS);
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.apiToken &&
        this.config.publisherId &&
        PUBLISHER_ID_RE.test(this.config.publisherId)
    );
  }

  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  private putCache(key: string, items: AwinPromotionItem[], now: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCacheKeys) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, {
      items,
      expiresAt: now + this.ttlMs
    });
  }

  private async fetchRegionPromotions(
    awinRegionCode: string,
    concurrencyKey?: string
  ): Promise<AwinPromotionItem[]> {
    const now = this.nowFn();
    const cached = this.cache.get(awinRegionCode);
    if (cached && cached.expiresAt > now) {
      return cached.items;
    }

    const existing = this.inFlight.get(awinRegionCode);
    if (existing) {
      return existing;
    }

    const work = (async () => {
      const publisherId = this.config.publisherId ?? "";
      const token = this.config.apiToken ?? "";
      if (!PUBLISHER_ID_RE.test(publisherId)) {
        throw new Error("Invalid AWIN_PUBLISHER_ID format");
      }

      const url = validateAwinPromotionsUrl(
        `https://api.awin.com/publisher/${encodeURIComponent(publisherId)}/promotions`
      );
      const requestBody = JSON.stringify({
        filters: {
          membership: "joined",
          regionCodes: [awinRegionCode],
          status: "active"
        },
        pagination: {
          page: 1,
          pageSize: 50
        }
      });

      const res = await this.fetcher(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": AWIN_PROMOTIONS_UA
        },
        body: requestBody,
        timeoutMs: PROMOTIONS_TIMEOUT_MS,
        maxRedirects: 0,
        maxBytes: PROMOTIONS_MAX_BYTES,
        concurrencyKey,
        validateRedirectUrl: (u) => {
          validateAwinPromotionsUrl(u.toString());
        }
      });

      if (res.url) {
        validateAwinPromotionsUrl(res.url);
      }

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Awin promotions API returned HTTP ${res.status}`);
      }

      const items = parsePromotionsPayload(res.bodyText);
      this.putCache(awinRegionCode, items, now);
      return items;
    })();

    this.inFlight.set(awinRegionCode, work);
    try {
      return await work;
    } finally {
      if (this.inFlight.get(awinRegionCode) === work) {
        this.inFlight.delete(awinRegionCode);
      }
    }
  }

  async search(opts: AwinPromotionsSearchOptions): Promise<AwinPromotionsSearchResult> {
    const region = opts.region;
    const awinRegionCode = mapRegionToAwinCode(region);

    if (!this.isConfigured()) {
      return {
        provider: "awin_promotions",
        configured: false,
        region,
        awin_region_code: awinRegionCode,
        live_vouchers: [],
        live_deals: [],
        notices: [
          "Live Awin partner promotions & vouchers are not configured on this instance (set AWIN_API_TOKEN and AWIN_PUBLISHER_ID to enable). Tier-B 1-click deal search links remain available."
        ],
        affiliate_disclosure: false
      };
    }

    const limit = Math.min(25, Math.max(1, Math.floor(opts.limit ?? 10)));
    const includeVouchers = opts.includeVouchers !== false;
    const cleanQuery = opts.query ? sanitizeText(opts.query, 200) : "";
    const cleanCategory = opts.category ? sanitizeText(opts.category, 80) : "";
    const notices: string[] = [];

    let rawItems: AwinPromotionItem[];
    try {
      rawItems = await this.fetchRegionPromotions(awinRegionCode, opts.concurrencyKey);
    } catch (err) {
      const safeMsg =
        err instanceof Error
          ? redactToken(err.message, this.config.apiToken)
          : "promotions request error";
      notices.push(`Could not load live Awin promotions: ${safeMsg}`);
      return {
        provider: "awin_promotions",
        configured: true,
        region,
        awin_region_code: awinRegionCode,
        live_vouchers: [],
        live_deals: [],
        notices,
        affiliate_disclosure: false
      };
    }

    let filtered = rawItems;

    if (cleanQuery) {
      filtered = filtered.filter((item) => {
        const haystack = [
          item.title,
          item.description,
          item.advertiser_name,
          item.voucher_code ?? "",
          item.campaign ?? "",
          item.categories.join(" ")
        ].join(" ");
        return matchesSearchQuery(haystack, cleanQuery);
      });
    }

    if (cleanCategory) {
      filtered = filtered.filter((item) => {
        const haystack = [
          item.categories.join(" "),
          item.title,
          item.description,
          item.advertiser_name,
          item.campaign ?? ""
        ].join(" ");
        return matchesSearchQuery(haystack, cleanCategory);
      });
    }

    const liveVouchers = includeVouchers
      ? filtered.filter((item) => item.type === "voucher" && Boolean(item.voucher_code)).slice(0, limit)
      : [];
    const liveDeals = filtered
      .filter((item) => item.type === "deal" || !item.voucher_code)
      .slice(0, limit);

    const hasResults = liveVouchers.length > 0 || liveDeals.length > 0;

    return {
      provider: "awin_promotions",
      configured: true,
      region,
      awin_region_code: awinRegionCode,
      live_vouchers: liveVouchers,
      live_deals: liveDeals,
      notices,
      affiliate_disclosure: hasResults,
      ...(hasResults ? { disclosure_note: AFFILIATE_DISCLOSURE_NOTE } : {})
    };
  }
}

export function createAwinPromotionsProvider(
  config: AffiliateFeedConfig = loadAffiliateFeedConfig(),
  opts: {
    fetcher?: AffiliateFetcherFn;
    nowFn?: () => number;
    ttlMs?: number;
    maxCacheKeys?: number;
  } = {}
): AwinPromotionsProvider {
  return new AwinPromotionsClient(config, opts);
}
