import crypto from "node:crypto";
import { sanitizeOptionalText, sanitizeText } from "../../security/sanitize.js";
import { safeFetch, type SafeFetchOptions, type SafeFetchResponse } from "../../security/ssrf.js";
import { formatMoney, moneyFromDecimalString } from "../shopify/normalize.js";
import type { ProductDetail, ProductSummary } from "../types.js";
import {
  sanitizeAmazonImageUrl,
  tryExtractAsin,
  type AmazonMarketplace
} from "./marketplaces.js";

export type AmazonFetcher = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResponse>;

export interface PaApiCredentials {
  accessKey: string;
  secretKey: string;
  partnerTag: string;
}

export interface SignedPaApiRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

const PAAPI_SERVICE = "ProductAdvertisingAPI";
const PAAPI_ALGORITHM = "AWS4-HMAC-SHA256";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

export function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  const dateStamp = iso.slice(0, 10).replace(/-/g, "");
  const timeStamp = iso.slice(11, 19).replace(/:/g, "");
  return {
    amzDate: `${dateStamp}T${timeStamp}Z`,
    dateStamp
  };
}

/**
 * Signs an Amazon Product Advertising API 5.0 POST request using pure node:crypto AWS SigV4.
 */
export function signPaApiRequest(params: {
  marketplace: AmazonMarketplace;
  operation: "SearchItems" | "GetItems";
  payload: Record<string, unknown>;
  credentials: PaApiCredentials;
  now?: Date;
}): SignedPaApiRequest {
  const { marketplace, operation, payload, credentials } = params;
  const path = operation === "SearchItems" ? "/paapi5/searchitems" : "/paapi5/getitems";
  const target = `com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${operation}`;
  const host = marketplace.paApiHost;
  const region = marketplace.paApiRegion;
  const body = JSON.stringify(payload);
  const { amzDate, dateStamp } = formatAmzDate(params.now ?? new Date());

  const canonicalHeadersMap: Record<string, string> = {
    "content-encoding": "amz-1.0",
    "content-type": "application/json; charset=utf-8",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": target
  };

  const sortedHeaderNames = Object.keys(canonicalHeadersMap).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((k) => `${k}:${canonicalHeadersMap[k]}\n`)
    .join("");
  const signedHeaders = sortedHeaderNames.join(";");
  const payloadHash = sha256Hex(body);

  const canonicalRequest = [
    "POST",
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${PAAPI_SERVICE}/aws4_request`;
  const stringToSign = [
    PAAPI_ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = hmacSha256(`AWS4${credentials.secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, PAAPI_SERVICE);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization = `${PAAPI_ALGORITHM} Credential=${credentials.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${path}`,
    method: "POST",
    headers: {
      "Content-Encoding": "amz-1.0",
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      Authorization: authorization,
      Accept: "application/json"
    },
    body,
    canonicalRequest,
    stringToSign,
    signature
  };
}

interface PaApiPriceRaw {
  Amount?: number;
  Currency?: string;
}

interface PaApiListingRaw {
  Price?: PaApiPriceRaw;
  SavingBasis?: PaApiPriceRaw;
  Availability?: {
    Type?: string;
    Message?: string;
  };
}

interface PaApiItemRaw {
  ASIN?: string;
  DetailPageURL?: string;
  Images?: {
    Primary?: { Large?: { URL?: string }; Medium?: { URL?: string } };
    Variants?: Array<{ Large?: { URL?: string }; Medium?: { URL?: string } }>;
  };
  ItemInfo?: {
    Title?: { DisplayValue?: string };
    ByLineInfo?: {
      Brand?: { DisplayValue?: string };
      Manufacturer?: { DisplayValue?: string };
    };
    Classifications?: {
      ProductGroup?: { DisplayValue?: string };
    };
    Features?: { DisplayValues?: string[] };
  };
  Offers?: {
    Listings?: PaApiListingRaw[];
  };
}

interface PaApiSearchResponse {
  SearchResult?: {
    Items?: PaApiItemRaw[];
  };
  Errors?: Array<{ Code?: string; Message?: string }>;
}

interface PaApiGetItemsResponse {
  ItemsResult?: {
    Items?: PaApiItemRaw[];
  };
  Errors?: Array<{ Code?: string; Message?: string }>;
}

function mapPaApiItemSummary(
  marketplace: AmazonMarketplace,
  item: PaApiItemRaw
): ProductSummary | null {
  const asin = item.ASIN ? tryExtractAsin(item.ASIN) : null;
  const title = sanitizeText(item.ItemInfo?.Title?.DisplayValue, 200);
  if (!asin || !title) return null;

  const listing = item.Offers?.Listings?.[0];
  const currency = listing?.Price?.Currency ?? marketplace.currency;
  const price =
    moneyFromDecimalString(listing?.Price?.Amount, currency) ?? formatMoney(0, currency);
  const compareAt = moneyFromDecimalString(listing?.SavingBasis?.Amount, currency, true);

  const availType = listing?.Availability?.Type?.toLowerCase();
  const available = listing ? availType !== "outofstock" && availType !== "unavailable" : false;

  const vendor = sanitizeOptionalText(
    item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ??
      item.ItemInfo?.ByLineInfo?.Manufacturer?.DisplayValue,
    100
  );
  const productType = sanitizeOptionalText(
    item.ItemInfo?.Classifications?.ProductGroup?.DisplayValue,
    100
  );
  const imageUrl = sanitizeAmazonImageUrl(
    item.Images?.Primary?.Large?.URL ?? item.Images?.Primary?.Medium?.URL
  );

  return {
    id: asin,
    handle: asin,
    title,
    vendor,
    product_type: productType,
    available,
    price,
    price_min: price,
    price_max: price,
    compare_at_price: compareAt,
    url: `${marketplace.origin}/dp/${asin}`,
    image_url: imageUrl
  };
}

function mapPaApiItemDetail(
  marketplace: AmazonMarketplace,
  item: PaApiItemRaw
): ProductDetail | null {
  const summary = mapPaApiItemSummary(marketplace, item);
  if (!summary) return null;

  const features = (item.ItemInfo?.Features?.DisplayValues ?? [])
    .map((f) => sanitizeText(f, 300))
    .filter(Boolean);
  const descriptionText = sanitizeText(features.join(" • "), 1500);

  const images: string[] = [];
  const pushImg = (raw: string | undefined) => {
    const safe = sanitizeAmazonImageUrl(raw);
    if (safe && !images.includes(safe) && images.length < 10) {
      images.push(safe);
    }
  };
  pushImg(item.Images?.Primary?.Large?.URL ?? item.Images?.Primary?.Medium?.URL);
  for (const variantImg of item.Images?.Variants ?? []) {
    pushImg(variantImg.Large?.URL ?? variantImg.Medium?.URL);
  }

  return {
    id: summary.id,
    handle: summary.handle,
    title: summary.title,
    vendor: summary.vendor,
    product_type: summary.product_type,
    description_text: descriptionText,
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

export async function paApiSearchItems(params: {
  marketplace: AmazonMarketplace;
  query: string;
  limit: number;
  credentials: PaApiCredentials;
  fetcher?: AmazonFetcher;
  concurrencyKey?: string;
  now?: Date;
}): Promise<ProductSummary[]> {
  const fetcher = params.fetcher ?? safeFetch;
  const itemCount = Math.min(10, Math.max(1, params.limit));
  const signed = signPaApiRequest({
    marketplace: params.marketplace,
    operation: "SearchItems",
    credentials: params.credentials,
    now: params.now,
    payload: {
      Keywords: params.query,
      PartnerTag: params.credentials.partnerTag,
      PartnerType: "Associates",
      Marketplace: params.marketplace.paApiMarketplace,
      ItemCount: itemCount,
      Resources: [
        "Images.Primary.Large",
        "ItemInfo.Title",
        "ItemInfo.ByLineInfo",
        "ItemInfo.Classifications",
        "ItemInfo.Features",
        "Offers.Listings.Price",
        "Offers.Listings.Availability.Type",
        "Offers.Listings.SavingBasis"
      ]
    }
  });

  const res = await fetcher(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: signed.body,
    timeoutMs: 8000,
    maxBytes: 1_048_576,
    maxRedirects: 0,
    concurrencyKey: params.concurrencyKey
  });

  let parsed: PaApiSearchResponse | null = null;
  try {
    parsed = JSON.parse(res.bodyText) as PaApiSearchResponse;
  } catch {
    parsed = null;
  }

  if (res.status !== 200 || !parsed) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Amazon PA-API SearchItems authentication failed (HTTP ${res.status})`);
    }
    const errMsg = parsed?.Errors?.[0]?.Message
      ? sanitizeText(parsed.Errors[0].Message, 200)
      : `HTTP ${res.status}`;
    throw new Error(`Amazon PA-API SearchItems failed: ${errMsg}`);
  }

  const rawItems = parsed.SearchResult?.Items ?? [];
  return rawItems
    .map((item) => mapPaApiItemSummary(params.marketplace, item))
    .filter((p): p is ProductSummary => p !== null);
}

export async function paApiGetItem(params: {
  marketplace: AmazonMarketplace;
  asin: string;
  credentials: PaApiCredentials;
  fetcher?: AmazonFetcher;
  concurrencyKey?: string;
  now?: Date;
}): Promise<ProductDetail | null> {
  const fetcher = params.fetcher ?? safeFetch;
  const signed = signPaApiRequest({
    marketplace: params.marketplace,
    operation: "GetItems",
    credentials: params.credentials,
    now: params.now,
    payload: {
      ItemIds: [params.asin],
      PartnerTag: params.credentials.partnerTag,
      PartnerType: "Associates",
      Marketplace: params.marketplace.paApiMarketplace,
      Resources: [
        "Images.Primary.Large",
        "Images.Variants.Large",
        "ItemInfo.Title",
        "ItemInfo.ByLineInfo",
        "ItemInfo.Classifications",
        "ItemInfo.Features",
        "Offers.Listings.Price",
        "Offers.Listings.Availability.Type",
        "Offers.Listings.SavingBasis"
      ]
    }
  });

  const res = await fetcher(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: signed.body,
    timeoutMs: 8000,
    maxBytes: 1_048_576,
    maxRedirects: 0,
    concurrencyKey: params.concurrencyKey
  });

  let parsed: PaApiGetItemsResponse | null = null;
  try {
    parsed = JSON.parse(res.bodyText) as PaApiGetItemsResponse;
  } catch {
    parsed = null;
  }

  if (res.status !== 200 || !parsed) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Amazon PA-API GetItems authentication failed (HTTP ${res.status})`);
    }
    const errMsg = parsed?.Errors?.[0]?.Message
      ? sanitizeText(parsed.Errors[0].Message, 200)
      : `HTTP ${res.status}`;
    throw new Error(`Amazon PA-API GetItems failed: ${errMsg}`);
  }

  const first = parsed.ItemsResult?.Items?.[0];
  if (!first) return null;
  return mapPaApiItemDetail(params.marketplace, first);
}
