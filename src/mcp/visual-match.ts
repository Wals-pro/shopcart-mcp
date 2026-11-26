import {
  normalizeEan,
  type AffiliateFeedProduct,
  type AffiliateFeedProvider
} from "../adapters/affiliate-feed/index.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Money, ProductSummary } from "../adapters/types.js";
import {
  AFFILIATE_DISCLOSURE_NOTE,
  applyAttribution,
  type AttributionConfig
} from "../attribution/links.js";
import { sanitizeText, SOURCE_NOTICE_CATALOG } from "../security/sanitize.js";
import { normalizeStoreOrigin, SsrfError } from "../security/ssrf.js";

const MAX_QUERY_LENGTH = 120;
const MAX_WEB_QUERY_LENGTH = 140;
const MAX_STORE_CONCURRENCY = 3;
const MAX_MATCH_TEXT_LEN = 600;

export interface MatchVisualProductInput {
  product_type: string;
  brand?: string;
  model_or_text?: string;
  ean?: string;
  color?: string;
  material?: string;
  style_keywords?: string[];
  target_stores?: string[];
  search_affiliate_deals?: boolean;
  available_only?: boolean;
  min_price?: number;
  max_price?: number;
  limit?: number;
}

export interface NormalizedVisualAttributes {
  product_type: string;
  brand: string | null;
  model_or_text: string | null;
  ean: string | null;
  color: string | null;
  material: string | null;
  style_keywords: string[];
}

export interface VisualMatchProduct {
  id: string;
  handle: string;
  title: string;
  vendor: string | null;
  product_type: string | null;
  available: boolean;
  price: Money;
  price_min: Money;
  price_max: Money;
  compare_at_price: Money | null;
  discount_percent?: number | null;
  savings?: Money | null;
  url: string;
  image_url: string | null;
  ean?: string | null;
  merchant_name?: string | null;
}

export type VisualMatchConfidence = "high" | "medium" | "low";

export interface VisualProductMatch {
  rank: number;
  confidence: VisualMatchConfidence;
  match_score: number;
  match_reasons: string[];
  store_origin: string;
  platform: string;
  affiliate_disclosure: boolean;
  product: VisualMatchProduct;
}

export interface VisualStoreSearchStatus {
  store_origin: string;
  platform: string;
  status: "ok" | "no_live_search" | "error";
  returned_count: number;
}

export interface VisualStoreError {
  store_origin: string;
  code: string;
  message: string;
}

export interface MatchVisualProductResult {
  source_notice: string;
  affiliate_disclosure: boolean;
  disclosure_note?: string;
  visual_query_summary: {
    attributes: NormalizedVisualAttributes;
    queries_executed: string[];
  };
  stores_searched: VisualStoreSearchStatus[];
  total_returned: number;
  matches: VisualProductMatch[];
  suggested_web_queries: string[];
  next_step: string;
  notices?: string[];
  store_errors?: VisualStoreError[];
}

interface ScoredCandidate {
  store_origin: string;
  platform: string;
  product: VisualMatchProduct;
  affiliate_disclosure: boolean;
  disclosure_note?: string;
  rawScore: number;
  matchScore: number;
  confidence: VisualMatchConfidence;
  reasons: string[];
  dedupKey: string;
}

function normalizeForMatching(value: string | null | undefined): string {
  if (!value) return "";
  const bounded = value.length > MAX_MATCH_TEXT_LEN ? value.slice(0, MAX_MATCH_TEXT_LEN) : value;
  return bounded
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined, allowSingleDigit = false): string[] {
  const norm = normalizeForMatching(value);
  if (!norm) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of norm.split(" ")) {
    if (!part) continue;
    if (part.length < 2 && !(allowSingleDigit && /^\d$/.test(part))) continue;
    if (!seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out;
}

function truncateQuery(parts: Array<string | null | undefined>, maxLen: number): string {
  const deduped: string[] = [];
  const seenLower = new Set<string>();
  for (const raw of parts) {
    if (!raw) continue;
    const cleaned = sanitizeText(raw, maxLen);
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    // Skip fragments already contained verbatim in an earlier fragment (e.g. brand repeated in model)
    let redundant = false;
    for (const prev of seenLower) {
      if (prev.includes(lower)) {
        redundant = true;
        break;
      }
    }
    if (redundant) continue;
    seenLower.add(lower);
    deduped.push(cleaned);
  }

  let joined = deduped.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length <= maxLen) return joined;

  // Truncate cleanly at a word boundary without appending ellipsis characters
  const sliced = joined.slice(0, maxLen).trimEnd();
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLen * 0.5)) {
    joined = sliced.slice(0, lastSpace).trimEnd();
  } else {
    joined = sliced;
  }
  return joined;
}

export function normalizeVisualAttributes(input: MatchVisualProductInput): NormalizedVisualAttributes {
  const product_type = sanitizeText(input.product_type, 120);
  const brand = input.brand ? sanitizeText(input.brand, 80) || null : null;
  const model_or_text = input.model_or_text ? sanitizeText(input.model_or_text, 120) || null : null;
  const ean = input.ean ? normalizeEan(input.ean) : null;
  const color = input.color ? sanitizeText(input.color, 60) || null : null;
  const material = input.material ? sanitizeText(input.material, 60) || null : null;

  const style_keywords: string[] = [];
  const seenKw = new Set<string>();
  for (const rawKw of input.style_keywords ?? []) {
    const cleaned = sanitizeText(rawKw, 40);
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (!seenKw.has(lower)) {
      seenKw.add(lower);
      style_keywords.push(cleaned);
    }
    if (style_keywords.length >= 6) break;
  }

  return {
    product_type,
    brand,
    model_or_text,
    ean,
    color,
    material,
    style_keywords
  };
}

export function buildVisualSearchQueries(attrs: NormalizedVisualAttributes): {
  primaryQuery: string;
  fallbackQuery: string | null;
} {
  const primaryQuery =
    truncateQuery([attrs.brand, attrs.model_or_text, attrs.product_type], MAX_QUERY_LENGTH) ||
    truncateQuery([attrs.product_type], MAX_QUERY_LENGTH);

  const fallbackCandidates = [
    truncateQuery([attrs.brand, attrs.product_type, attrs.color], MAX_QUERY_LENGTH),
    truncateQuery([attrs.brand, attrs.product_type], MAX_QUERY_LENGTH),
    truncateQuery([attrs.product_type, attrs.color], MAX_QUERY_LENGTH),
    truncateQuery([attrs.product_type], MAX_QUERY_LENGTH)
  ];

  const primaryLower = primaryQuery.toLowerCase();
  const fallbackQuery =
    fallbackCandidates.find((q) => q.length > 0 && q.toLowerCase() !== primaryLower) ?? null;

  return { primaryQuery, fallbackQuery };
}

export function buildSuggestedWebQueries(attrs: NormalizedVisualAttributes): string[] {
  const candidates: string[] = [];
  const pushUnique = (q: string) => {
    const cleaned = q.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const lower = cleaned.toLowerCase();
    if (!candidates.some((existing) => existing.toLowerCase() === lower)) {
      candidates.push(cleaned);
    }
  };

  if (attrs.ean) {
    pushUnique(
      truncateQuery([attrs.ean, attrs.brand, attrs.product_type], MAX_WEB_QUERY_LENGTH)
    );
  }

  pushUnique(
    truncateQuery(
      [attrs.brand, attrs.model_or_text, attrs.product_type, attrs.color],
      MAX_WEB_QUERY_LENGTH
    )
  );

  pushUnique(
    truncateQuery(
      [attrs.brand, attrs.model_or_text ?? attrs.product_type, attrs.material, "buy"],
      MAX_WEB_QUERY_LENGTH
    )
  );

  if (attrs.style_keywords.length > 0 || candidates.length < 3) {
    pushUnique(
      truncateQuery(
        [
          attrs.brand,
          attrs.product_type,
          attrs.color,
          ...attrs.style_keywords.slice(0, 2),
          "online shop"
        ],
        MAX_WEB_QUERY_LENGTH
      )
    );
  }

  return candidates.slice(0, 3);
}

/**
 * Deterministic, ReDoS-safe visual candidate scorer using strictly lowercase
 * substring and token matching (never constructs RegExp from user/catalog input).
 */
export function scoreVisualCandidate(
  attrs: NormalizedVisualAttributes,
  candidate: {
    title: string;
    vendor: string | null;
    product_type: string | null;
    handle: string;
    available: boolean;
    image_url: string | null;
    ean?: string | null;
    gtin?: string | null;
    mpn?: string | null;
    description_text?: string | null;
  }
): {
  rawScore: number;
  matchScore: number;
  confidence: VisualMatchConfidence;
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];

  const titleNorm = normalizeForMatching(candidate.title);
  const vendorNorm = normalizeForMatching(candidate.vendor);
  const typeNorm = normalizeForMatching(candidate.product_type);
  const handleNorm = normalizeForMatching(candidate.handle);
  const mpnNorm = normalizeForMatching(candidate.mpn);
  const descNorm = normalizeForMatching(candidate.description_text);

  const combinedNorm = [titleNorm, vendorNorm, typeNorm, handleNorm, mpnNorm, descNorm]
    .filter(Boolean)
    .join(" ");
  const combinedCompact = combinedNorm.replace(/ /g, "");

  // 1. Exact EAN / GTIN match
  let exactEanMatched = false;
  if (attrs.ean) {
    const candEan = candidate.ean ? normalizeEan(candidate.ean) : null;
    const candGtin = candidate.gtin ? normalizeEan(candidate.gtin) : null;
    if (candEan === attrs.ean || candGtin === attrs.ean) {
      score += 60;
      exactEanMatched = true;
      reasons.push("exact_ean_match");
    }
  }

  // 2. Brand / vendor match
  if (attrs.brand) {
    const brandNorm = normalizeForMatching(attrs.brand);
    const brandCompact = brandNorm.replace(/ /g, "");
    if (
      brandNorm &&
      (vendorNorm.includes(brandNorm) ||
        titleNorm.includes(brandNorm) ||
        (brandCompact.length >= 3 && combinedCompact.includes(brandCompact)))
    ) {
      score += 25;
      reasons.push("brand_match");
    } else {
      const brandTokens = tokenize(attrs.brand);
      if (brandTokens.length > 0) {
        const matched = brandTokens.filter((t) => combinedNorm.includes(t)).length;
        if (matched === brandTokens.length) {
          score += 20;
          reasons.push("brand_match");
        } else if (matched > 0) {
          score += 10;
          reasons.push("brand_partial_match");
        }
      }
    }
  }

  // 3. Model / label text / MPN match
  if (attrs.model_or_text) {
    const modelNorm = normalizeForMatching(attrs.model_or_text);
    const modelCompact = modelNorm.replace(/ /g, "");
    if (
      modelNorm &&
      (titleNorm.includes(modelNorm) ||
        mpnNorm.includes(modelNorm) ||
        combinedNorm.includes(modelNorm) ||
        (modelCompact.length >= 3 && combinedCompact.includes(modelCompact)))
    ) {
      score += 30;
      reasons.push("model_exact_match");
    } else {
      const modelTokens = tokenize(attrs.model_or_text, true);
      if (modelTokens.length > 0) {
        const matched = modelTokens.filter((t) => combinedNorm.includes(t)).length;
        if (matched > 0) {
          const pts = Math.round((matched / modelTokens.length) * 24);
          score += pts;
          reasons.push(`model_token_match(${matched}/${modelTokens.length})`);
        }
      }
    }
  }

  // 4. Product type match
  const ptNorm = normalizeForMatching(attrs.product_type);
  if (ptNorm) {
    if (titleNorm.includes(ptNorm) || typeNorm.includes(ptNorm) || combinedNorm.includes(ptNorm)) {
      score += 20;
      reasons.push("product_type_match");
    } else {
      const ptTokens = tokenize(attrs.product_type);
      if (ptTokens.length > 0) {
        const matched = ptTokens.filter((t) => combinedNorm.includes(t)).length;
        if (matched > 0) {
          const pts = Math.round((matched / ptTokens.length) * 16);
          score += pts;
          reasons.push(`product_type_token_match(${matched}/${ptTokens.length})`);
        }
      }
    }
  }

  // 5. Color match
  if (attrs.color) {
    const colorNorm = normalizeForMatching(attrs.color);
    const colorTokens = tokenize(attrs.color);
    if (colorNorm && combinedNorm.includes(colorNorm)) {
      score += 10;
      reasons.push("color_match");
    } else if (colorTokens.some((t) => combinedNorm.includes(t))) {
      score += 7;
      reasons.push("color_partial_match");
    }
  }

  // 6. Material match
  if (attrs.material) {
    const matNorm = normalizeForMatching(attrs.material);
    const matTokens = tokenize(attrs.material);
    if (matNorm && combinedNorm.includes(matNorm)) {
      score += 8;
      reasons.push("material_match");
    } else if (matTokens.some((t) => combinedNorm.includes(t))) {
      score += 5;
      reasons.push("material_partial_match");
    }
  }

  // 7. Style keywords match
  if (attrs.style_keywords.length > 0) {
    let matchedKeywords = 0;
    for (const kw of attrs.style_keywords) {
      const kwNorm = normalizeForMatching(kw);
      if (!kwNorm) continue;
      if (combinedNorm.includes(kwNorm)) {
        matchedKeywords += 1;
      } else {
        const kwTokens = tokenize(kw);
        if (kwTokens.length > 0 && kwTokens.every((t) => combinedNorm.includes(t))) {
          matchedKeywords += 1;
        }
      }
    }
    if (matchedKeywords > 0) {
      score += Math.min(16, matchedKeywords * 4);
      reasons.push(`style_keywords_match(${matchedKeywords}/${attrs.style_keywords.length})`);
    }
  }

  // 8. In-stock & image quality bonuses
  if (candidate.available) {
    score += 5;
    reasons.push("in_stock");
  }
  if (candidate.image_url) {
    score += 3;
    reasons.push("has_image");
  }

  const matchScore = Math.min(100, score);
  const confidence: VisualMatchConfidence =
    exactEanMatched || score >= 55 ? "high" : score >= 30 ? "medium" : "low";

  return {
    rawScore: score,
    matchScore,
    confidence,
    reasons
  };
}

function buildDedupKey(storeOrigin: string, product: { id: string; handle: string; url: string }): string {
  const normOrigin = storeOrigin.trim().toLowerCase();
  const idPart = product.id.trim().toLowerCase();
  if (idPart) return `${normOrigin}::id::${idPart}`;
  const handlePart = product.handle.trim().toLowerCase();
  if (handlePart) return `${normOrigin}::handle::${handlePart}`;
  let urlKey = product.url.trim().toLowerCase();
  try {
    const parsed = new URL(product.url);
    urlKey = `${parsed.origin.toLowerCase()}${parsed.pathname.toLowerCase()}`;
  } catch {
    // keep raw lowercased url
  }
  return `${normOrigin}::url::${urlKey}`;
}

function sanitizeStoreError(err: unknown): { code: string; message: string } {
  if (err instanceof SsrfError) {
    switch (err.code) {
      case "TIMEOUT":
        return { code: "TIMEOUT", message: "Store request timed out." };
      case "CONCURRENCY_LIMIT":
        return { code: "CONCURRENCY_LIMIT", message: "Upstream concurrency limit reached." };
      case "DNS_FAILED":
        return { code: "DNS_FAILED", message: "Store hostname could not be resolved." };
      case "TOO_MANY_REDIRECTS":
        return { code: "TOO_MANY_REDIRECTS", message: "Store exceeded redirect limit." };
      case "BODY_TOO_LARGE":
        return { code: "BODY_TOO_LARGE", message: "Store response exceeded size limit." };
      case "BLOCKED_IP":
      case "BLOCKED_HOST":
      case "INVALID_URL":
        return { code: err.code, message: "Store endpoint blocked by SSRF policy." };
    }
  }
  return {
    code: "STORE_SEARCH_FAILED",
    message: "Store catalog could not be searched (unreachable, WAF-restricted, or unsupported response)."
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIdx = 0;

  const worker = async () => {
    while (nextIdx < items.length) {
      const current = nextIdx++;
      results[current] = await fn(items[current]!);
    }
  };

  const workerCount = Math.min(maxConcurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function affiliateProductToVisualProduct(item: AffiliateFeedProduct): VisualMatchProduct {
  let discountPercent: number | null = null;
  let savings: Money | null = null;
  if (item.compare_at_price && item.compare_at_price.amount > item.price.amount && item.compare_at_price.amount > 0) {
    const diff = item.compare_at_price.amount - item.price.amount;
    discountPercent = Math.round((diff / item.compare_at_price.amount) * 100);
    savings = {
      amount: Number(diff.toFixed(2)),
      formatted: `${diff.toFixed(2)} ${item.price.currency}`,
      currency: item.price.currency
    };
  }

  return {
    id: item.id,
    handle: item.merchant_product_id || item.id,
    title: item.title,
    vendor: item.brand || item.merchant_name,
    product_type: item.category,
    available: item.available,
    price: item.price,
    price_min: item.price,
    price_max: item.price,
    compare_at_price: item.compare_at_price,
    ...(discountPercent !== null ? { discount_percent: discountPercent } : {}),
    ...(savings ? { savings } : {}),
    url: item.url,
    image_url: item.image_url,
    ean: item.ean ?? item.gtin,
    merchant_name: item.merchant_name
  };
}

function storeSummaryToVisualProduct(
  item: ProductSummary,
  attributedUrl: string
): VisualMatchProduct {
  return {
    id: item.id,
    handle: item.handle,
    title: item.title,
    vendor: item.vendor,
    product_type: item.product_type,
    available: item.available,
    price: item.price,
    price_min: item.price_min,
    price_max: item.price_max,
    compare_at_price: item.compare_at_price,
    ...(item.discount_percent !== undefined ? { discount_percent: item.discount_percent } : {}),
    ...(item.savings !== undefined ? { savings: item.savings } : {}),
    url: attributedUrl,
    image_url: item.image_url
  };
}

export async function runMatchVisualProduct(
  input: MatchVisualProductInput,
  deps: {
    registry: AdapterRegistry;
    attribution: AttributionConfig;
    affiliateFeed?: AffiliateFeedProvider;
    concurrencyKey?: string;
  }
): Promise<MatchVisualProductResult> {
  const attrs = normalizeVisualAttributes(input);
  const { primaryQuery, fallbackQuery } = buildVisualSearchQueries(attrs);
  const limit = Math.min(15, Math.max(1, input.limit ?? 8));
  const perSourceLimit = Math.min(20, Math.max(limit, 10));

  // Strictly validate EVERY target_store via normalizeStoreOrigin() before issuing any network calls.
  // Any invalid or SSRF-blocked URL throws SsrfError immediately (fail closed, never bypassed).
  const normalizedOrigins: string[] = [];
  const seenOrigins = new Set<string>();
  for (const rawStore of input.target_stores ?? []) {
    const origin = normalizeStoreOrigin(rawStore);
    if (!seenOrigins.has(origin)) {
      seenOrigins.add(origin);
      normalizedOrigins.push(origin);
    }
  }

  const queriesExecuted = new Set<string>();
  const storesSearched: VisualStoreSearchStatus[] = [];
  const storeErrors: VisualStoreError[] = [];
  const notices: string[] = [];
  const candidates: ScoredCandidate[] = [];

  const shouldSearchAffiliate =
    input.search_affiliate_deals !== false && Boolean(deps.affiliateFeed?.isConfigured());

  // Run validated target stores (bounded concurrency) and optional affiliate feed in parallel
  const storeWork = mapWithConcurrency(normalizedOrigins, MAX_STORE_CONCURRENCY, async (origin) => {
    try {
      const adapter = await deps.registry.resolveAdapter(origin, deps.concurrencyKey);
      queriesExecuted.add(primaryQuery);
      let res = await adapter.searchProducts(origin, {
        query: primaryQuery,
        limit: perSourceLimit,
        availableOnly: input.available_only,
        minPrice: input.min_price,
        maxPrice: input.max_price,
        concurrencyKey: deps.concurrencyKey
      });

      let products = [...res.products];

      // Optional broader fallback query if primary returned 0 hits on a live-search store
      if (products.length === 0 && fallbackQuery && !res.agent_guidance) {
        queriesExecuted.add(fallbackQuery);
        const fallbackRes = await adapter.searchProducts(origin, {
          query: fallbackQuery,
          limit: perSourceLimit,
          availableOnly: input.available_only,
          minPrice: input.min_price,
          maxPrice: input.max_price,
          concurrencyKey: deps.concurrencyKey
        });
        if (fallbackRes.products.length > 0) {
          res = fallbackRes;
          products = [...fallbackRes.products];
        }
      }

      const canonicalOrigin = res.store_origin || origin;
      const status: VisualStoreSearchStatus["status"] =
        products.length === 0 && res.agent_guidance ? "no_live_search" : "ok";

      storesSearched.push({
        store_origin: canonicalOrigin,
        platform: adapter.platform,
        status,
        returned_count: products.length
      });

      if (status === "no_live_search") {
        notices.push(
          `${canonicalOrigin} (${adapter.platform}) does not expose an open catalog search API; discover a product URL via web search and verify it with get_product.`
        );
      }

      for (const product of products) {
        const decorated = applyAttribution(product.url, deps.attribution, { kind: "product" });
        const visualProduct = storeSummaryToVisualProduct(product, decorated.url);
        const scored = scoreVisualCandidate(attrs, {
          title: visualProduct.title,
          vendor: visualProduct.vendor,
          product_type: visualProduct.product_type,
          handle: visualProduct.handle,
          available: visualProduct.available,
          image_url: visualProduct.image_url
        });
        candidates.push({
          store_origin: canonicalOrigin,
          platform: adapter.platform,
          product: visualProduct,
          affiliate_disclosure: decorated.affiliate_disclosure,
          disclosure_note: decorated.disclosure_note,
          rawScore: scored.rawScore,
          matchScore: scored.matchScore,
          confidence: scored.confidence,
          reasons: scored.reasons,
          dedupKey: buildDedupKey(canonicalOrigin, {
            id: product.id,
            handle: product.handle,
            url: product.url
          })
        });
      }
    } catch (err) {
      const safeErr = sanitizeStoreError(err);
      storesSearched.push({
        store_origin: origin,
        platform: "unknown",
        status: "error",
        returned_count: 0
      });
      storeErrors.push({
        store_origin: origin,
        code: safeErr.code,
        message: safeErr.message
      });
    }
  });

  const affiliateWork = (async () => {
    if (!shouldSearchAffiliate || !deps.affiliateFeed) return;
    try {
      const feedProducts: AffiliateFeedProduct[] = [];
      let feedDisclosure = false;
      let feedDisclosureNote: string | undefined;

      if (attrs.ean) {
        queriesExecuted.add(`ean:${attrs.ean}`);
        const eanRes = await deps.affiliateFeed.search({
          ean: attrs.ean,
          limit: perSourceLimit,
          availableOnly: input.available_only,
          minPrice: input.min_price,
          maxPrice: input.max_price,
          concurrencyKey: deps.concurrencyKey
        });
        feedProducts.push(...eanRes.products);
        if (eanRes.affiliate_disclosure) {
          feedDisclosure = true;
          feedDisclosureNote = feedDisclosureNote ?? eanRes.disclosure_note;
        }
      }

      if (feedProducts.length < limit) {
        queriesExecuted.add(primaryQuery);
        const kwRes = await deps.affiliateFeed.search({
          query: primaryQuery,
          limit: perSourceLimit,
          availableOnly: input.available_only,
          minPrice: input.min_price,
          maxPrice: input.max_price,
          concurrencyKey: deps.concurrencyKey
        });
        feedProducts.push(...kwRes.products);
        if (kwRes.affiliate_disclosure) {
          feedDisclosure = true;
          feedDisclosureNote = feedDisclosureNote ?? kwRes.disclosure_note;
        }

        if (feedProducts.length === 0 && fallbackQuery) {
          queriesExecuted.add(fallbackQuery);
          const fbRes = await deps.affiliateFeed.search({
            query: fallbackQuery,
            limit: perSourceLimit,
            availableOnly: input.available_only,
            minPrice: input.min_price,
            maxPrice: input.max_price,
            concurrencyKey: deps.concurrencyKey
          });
          feedProducts.push(...fbRes.products);
          if (fbRes.affiliate_disclosure) {
            feedDisclosure = true;
            feedDisclosureNote = feedDisclosureNote ?? fbRes.disclosure_note;
          }
        }
      }

      storesSearched.push({
        store_origin: "affiliate_feed:awin",
        platform: "affiliate_feed",
        status: "ok",
        returned_count: feedProducts.length
      });

      for (const item of feedProducts) {
        const visualProduct = affiliateProductToVisualProduct(item);
        const storeKey = item.merchant_name
          ? `affiliate_feed:${item.merchant_name.toLowerCase().replace(/\s+/g, "-")}`
          : "affiliate_feed:awin";
        const scored = scoreVisualCandidate(attrs, {
          title: item.title,
          vendor: item.brand || item.merchant_name,
          product_type: item.category,
          handle: visualProduct.handle,
          available: item.available,
          image_url: item.image_url,
          ean: item.ean,
          gtin: item.gtin,
          mpn: item.mpn,
          description_text: item.description_text
        });
        candidates.push({
          store_origin: storeKey,
          platform: "affiliate_feed",
          product: visualProduct,
          affiliate_disclosure: Boolean(item.affiliate_disclosure || feedDisclosure),
          disclosure_note: feedDisclosureNote ?? AFFILIATE_DISCLOSURE_NOTE,
          rawScore: scored.rawScore,
          matchScore: scored.matchScore,
          confidence: scored.confidence,
          reasons: scored.reasons,
          dedupKey: buildDedupKey(storeKey, {
            id: item.id,
            handle: visualProduct.handle,
            url: item.product_url || item.url
          })
        });
      }
    } catch (err) {
      const safeErr = sanitizeStoreError(err);
      storesSearched.push({
        store_origin: "affiliate_feed:awin",
        platform: "affiliate_feed",
        status: "error",
        returned_count: 0
      });
      storeErrors.push({
        store_origin: "affiliate_feed:awin",
        code: safeErr.code,
        message: "Partner affiliate feed search failed."
      });
    }
  })();

  await Promise.all([storeWork, affiliateWork]);

  // Deduplicate keeping the highest-scoring candidate per (store_origin, id/handle/url)
  const dedupedMap = new Map<string, ScoredCandidate>();
  for (const cand of candidates) {
    const existing = dedupedMap.get(cand.dedupKey);
    if (!existing || cand.rawScore > existing.rawScore) {
      dedupedMap.set(cand.dedupKey, cand);
    }
  }

  // Deterministic ranking: rawScore DESC, available DESC, has_image DESC, price ASC, title ASC
  const ranked = Array.from(dedupedMap.values())
    .sort((a, b) => {
      if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
      if (a.product.available !== b.product.available) return a.product.available ? -1 : 1;
      const aImg = Boolean(a.product.image_url);
      const bImg = Boolean(b.product.image_url);
      if (aImg !== bImg) return aImg ? -1 : 1;
      if (a.product.price.amount !== b.product.price.amount) {
        return a.product.price.amount - b.product.price.amount;
      }
      return a.product.title.localeCompare(b.product.title);
    })
    .slice(0, limit);

  let anyAffiliate = false;
  let disclosureNote: string | undefined;
  const matches: VisualProductMatch[] = ranked.map((item, idx) => {
    if (item.affiliate_disclosure) {
      anyAffiliate = true;
      disclosureNote = disclosureNote ?? item.disclosure_note;
    }
    return {
      rank: idx + 1,
      confidence: item.confidence,
      match_score: item.matchScore,
      match_reasons: item.reasons,
      store_origin: item.store_origin,
      platform: item.platform,
      affiliate_disclosure: item.affiliate_disclosure,
      product: item.product
    };
  });

  if (normalizedOrigins.length === 0 && !shouldSearchAffiliate) {
    notices.push(
      "No target_stores were provided and no affiliate partner feeds are configured on this instance. Use suggested_web_queries with web search to find candidate store domains or product URLs, then re-run match_visual_product with target_stores or verify directly via get_product."
    );
  }

  const suggestedWebQueries =
    normalizedOrigins.length === 0 || matches.length < 3 ? buildSuggestedWebQueries(attrs) : [];

  const nextStep =
    matches.length > 0
      ? "Call get_product(store_url, handle_or_url, include_thumbnail=true) on the top candidate(s) to visually confirm the match and retrieve exact variant IDs and live stock, then build a verified handoff with create_cart_link."
      : "Run one of suggested_web_queries with web search to find concrete merchant domains or product URLs, then call match_visual_product(target_stores=[...]) or get_product(store_url, product_url, include_thumbnail=true).";

  return {
    source_notice: SOURCE_NOTICE_CATALOG,
    affiliate_disclosure: anyAffiliate,
    ...(anyAffiliate ? { disclosure_note: disclosureNote ?? AFFILIATE_DISCLOSURE_NOTE } : {}),
    visual_query_summary: {
      attributes: attrs,
      queries_executed: Array.from(queriesExecuted)
    },
    stores_searched: storesSearched,
    total_returned: matches.length,
    matches,
    suggested_web_queries: suggestedWebQueries,
    next_step: nextStep,
    ...(notices.length > 0 ? { notices } : {}),
    ...(storeErrors.length > 0 ? { store_errors: storeErrors } : {})
  };
}
