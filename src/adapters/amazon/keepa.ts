import { sanitizeOptionalText, sanitizeText } from "../../security/sanitize.js";
import { safeFetch } from "../../security/ssrf.js";
import { formatMoney, moneyFromMinorUnits } from "../shopify/normalize.js";
import type { Money, ProductDetail, ProductSummary } from "../types.js";
import {
  sanitizeAmazonImageUrl,
  tryExtractAsin,
  type AmazonMarketplace
} from "./marketplaces.js";
import type { AmazonFetcher } from "./paapi.js";

const KEEPA_API_ORIGIN = "https://api.keepa.com";

export interface KeepaProductRaw {
  asin?: string;
  title?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  productGroup?: string | null;
  description?: string | null;
  features?: string[] | null;
  imagesCSV?: string | null;
  availabilityAmazon?: number;
  stats?: {
    current?: Array<number | null>;
    buyBoxPrice?: number | null;
    buyBoxShipping?: number | null;
  } | null;
}

interface KeepaApiResponse {
  products?: KeepaProductRaw[];
  error?: { message?: string };
}

function extractKeepaPrice(
  product: KeepaProductRaw,
  currency: string
): { price: Money; compareAt: Money | null; available: boolean } {
  const current = product.stats?.current ?? [];
  const buyBoxPrice = product.stats?.buyBoxPrice;
  const amazonPrice = current[0];
  const newPrice = current[1];
  const newFbaPrice = current[10];
  const buyBoxWithShipping = current[18];
  const listPrice = current[4];

  const candidates = [buyBoxPrice, amazonPrice, newFbaPrice, newPrice, buyBoxWithShipping];
  const rawPrice = candidates.find((v): v is number => typeof v === "number" && v > 0);

  const price =
    rawPrice !== undefined
      ? (moneyFromMinorUnits(rawPrice, currency) ?? formatMoney(0, currency))
      : formatMoney(0, currency);

  const compareAt =
    typeof listPrice === "number" && listPrice > 0 && (rawPrice === undefined || listPrice > rawPrice)
      ? moneyFromMinorUnits(listPrice, currency, true)
      : null;

  const available = rawPrice !== undefined && rawPrice > 0;
  return { price, compareAt, available };
}

function extractKeepaRatingNote(product: KeepaProductRaw): string | null {
  const current = product.stats?.current ?? [];
  const rawRating = current[16];
  const rawCount = current[17];
  if (typeof rawRating === "number" && rawRating > 0) {
    const stars = (rawRating / 10).toFixed(1);
    if (typeof rawCount === "number" && rawCount > 0) {
      return `Rating: ${stars}/5 (${rawCount} reviews)`;
    }
    return `Rating: ${stars}/5`;
  }
  return null;
}

function extractKeepaImages(imagesCsv: string | null | undefined): string[] {
  if (!imagesCsv || typeof imagesCsv !== "string") return [];
  const images: string[] = [];
  for (const part of imagesCsv.split(",")) {
    const filename = part.trim();
    if (!filename || !/^[A-Za-z0-9._+-]{4,120}$/.test(filename)) continue;
    const url = sanitizeAmazonImageUrl(`https://m.media-amazon.com/images/I/${filename}`);
    if (url && !images.includes(url) && images.length < 10) {
      images.push(url);
    }
  }
  return images;
}

export function mapKeepaProductSummary(
  marketplace: AmazonMarketplace,
  raw: KeepaProductRaw
): ProductSummary | null {
  const asin = raw.asin ? tryExtractAsin(raw.asin) : null;
  const title = sanitizeText(raw.title, 200);
  if (!asin || !title) return null;

  const { price, compareAt, available } = extractKeepaPrice(raw, marketplace.currency);
  const images = extractKeepaImages(raw.imagesCSV);

  return {
    id: asin,
    handle: asin,
    title,
    vendor: sanitizeOptionalText(raw.brand ?? raw.manufacturer, 100),
    product_type: sanitizeOptionalText(raw.productGroup, 100),
    available,
    price,
    price_min: price,
    price_max: price,
    compare_at_price: compareAt,
    url: `${marketplace.origin}/dp/${asin}`,
    image_url: images[0] ?? null
  };
}

export function mapKeepaProductDetail(
  marketplace: AmazonMarketplace,
  raw: KeepaProductRaw
): ProductDetail | null {
  const summary = mapKeepaProductSummary(marketplace, raw);
  if (!summary) return null;

  const images = extractKeepaImages(raw.imagesCSV);
  const parts: string[] = [];
  const ratingNote = extractKeepaRatingNote(raw);
  if (ratingNote) parts.push(ratingNote);
  if (raw.description) parts.push(sanitizeText(raw.description, 800));
  if (Array.isArray(raw.features) && raw.features.length > 0) {
    parts.push(
      raw.features
        .map((f) => sanitizeText(f, 250))
        .filter(Boolean)
        .join(" • ")
    );
  }

  return {
    id: summary.id,
    handle: summary.handle,
    title: summary.title,
    vendor: summary.vendor,
    product_type: summary.product_type,
    description_text: sanitizeText(parts.join(" | "), 1500),
    available: summary.available,
    url: summary.url,
    options: [],
    images,
    variants: [
      {
        id: summary.id,
        title: `ASIN ${summary.id}`,
        sku: summary.id,
        available: summary.available,
        price: summary.price,
        compare_at_price: summary.compare_at_price,
        option_values: []
      }
    ]
  };
}

export async function keepaSearchProducts(params: {
  marketplace: AmazonMarketplace;
  query: string;
  limit: number;
  apiKey: string;
  fetcher?: AmazonFetcher;
  concurrencyKey?: string;
}): Promise<ProductSummary[]> {
  if (params.marketplace.keepaDomainId === null) {
    throw new Error(`Keepa API does not support marketplace ${params.marketplace.canonicalHost}`);
  }
  const fetcher = params.fetcher ?? safeFetch;
  const qs = new URLSearchParams({
    key: params.apiKey,
    domain: String(params.marketplace.keepaDomainId),
    type: "product",
    term: params.query,
    stats: "90"
  });
  const url = `${KEEPA_API_ORIGIN}/search?${qs.toString()}`;
  const res = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    timeoutMs: 8000,
    maxBytes: 2_097_152,
    concurrencyKey: params.concurrencyKey
  });

  let parsed: KeepaApiResponse | null = null;
  try {
    parsed = JSON.parse(res.bodyText) as KeepaApiResponse;
  } catch {
    parsed = null;
  }

  if (res.status !== 200 || !parsed) {
    const errMsg = parsed?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Keepa search failed: ${errMsg}`);
  }
  if (parsed.error?.message) {
    throw new Error(`Keepa search error: ${parsed.error.message}`);
  }

  return (parsed.products ?? [])
    .map((p) => mapKeepaProductSummary(params.marketplace, p))
    .filter((p): p is ProductSummary => p !== null)
    .slice(0, params.limit);
}

export async function keepaGetProduct(params: {
  marketplace: AmazonMarketplace;
  asin: string;
  apiKey: string;
  fetcher?: AmazonFetcher;
  concurrencyKey?: string;
}): Promise<ProductDetail | null> {
  if (params.marketplace.keepaDomainId === null) {
    throw new Error(`Keepa API does not support marketplace ${params.marketplace.canonicalHost}`);
  }
  const fetcher = params.fetcher ?? safeFetch;
  const qs = new URLSearchParams({
    key: params.apiKey,
    domain: String(params.marketplace.keepaDomainId),
    asin: params.asin,
    stats: "90",
    buybox: "1",
    rating: "1"
  });
  const url = `${KEEPA_API_ORIGIN}/product?${qs.toString()}`;
  const res = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    timeoutMs: 8000,
    maxBytes: 2_097_152,
    concurrencyKey: params.concurrencyKey
  });

  let parsed: KeepaApiResponse | null = null;
  try {
    parsed = JSON.parse(res.bodyText) as KeepaApiResponse;
  } catch {
    parsed = null;
  }

  if (res.status !== 200 || !parsed) {
    const errMsg = parsed?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Keepa product lookup failed: ${errMsg}`);
  }
  if (parsed.error?.message) {
    throw new Error(`Keepa product error: ${parsed.error.message}`);
  }

  const first = parsed.products?.[0];
  if (!first) return null;
  return mapKeepaProductDetail(params.marketplace, first);
}
