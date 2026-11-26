import {
  sanitizeOptionalText,
  sanitizeSafeUrl,
  sanitizeText,
  stripHtmlToText
} from "../../security/sanitize.js";
import type {
  AdditionalCartLink,
  CartLinkItemInput,
  CartLinkItemResult,
  CartLinkResult,
  GetProductResult,
  ProductDetail,
  ProductSummary,
  ProductVariant,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreInfo
} from "../types.js";
import { formatMoney, normalizeCurrency } from "../shopify/normalize.js";
import {
  computeDiscountPercent,
  decodeHtmlEntitiesBasic,
  extractJsonLdBrand,
  extractJsonLdBlocks,
  extractJsonLdImages,
  extractMetaContent,
  extractSafePathOnOrigin,
  extractSectionSlicesLinear,
  extractTagBlocksLinear,
  extractTextByClassLinear,
  findBestProductJsonLd,
  parseJsonLdOffer,
  parseLocalizedPrice,
  rethrowIfHardSsrfError,
  scanOpeningTagsLinear
} from "../shared/html.js";
import { ShopwareClient } from "./client.js";

interface ShopwarePriceRaw {
  unitPrice?: number;
  totalPrice?: number;
  listPrice?: {
    price?: number;
    discount?: number;
    percentage?: number;
  } | null;
}

interface ShopwareProductRaw {
  id?: string;
  productNumber?: string;
  name?: string;
  description?: string | null;
  available?: boolean;
  stock?: number;
  availableStock?: number;
  isCloseout?: boolean;
  translated?: {
    name?: string;
    description?: string | null;
  };
  manufacturer?: {
    name?: string;
    translated?: { name?: string };
  } | null;
  calculatedPrice?: ShopwarePriceRaw | null;
  calculatedCheapestPrice?: ShopwarePriceRaw | null;
  cover?: { media?: { url?: string } } | null;
  media?: Array<{ media?: { url?: string } }>;
  seoUrls?: Array<{ seoPathInfo?: string; isCanonical?: boolean }>;
  options?: Array<{
    name?: string;
    translated?: { name?: string };
    group?: { name?: string; translated?: { name?: string } };
  }>;
}

interface ShopwareSearchResponseRaw {
  total?: number;
  elements?: ShopwareProductRaw[];
}

interface ShopwareProductDetailResponseRaw {
  product?: ShopwareProductRaw;
  configurator?: Array<{
    name?: string;
    translated?: { name?: string };
    options?: Array<{
      name?: string;
      translated?: { name?: string };
    }>;
  }>;
}

const SHOPWARE_UUID_RE = /^[0-9a-f]{32}$/i;

function handleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return sanitizeText(parsed.pathname.replace(/^\/+|\/+$/g, ""), 200) || "product";
  } catch {
    return sanitizeText(url.replace(/^\/+|\/+$/g, ""), 200) || "product";
  }
}

function buildShopwareProductUrl(
  origin: string,
  raw: ShopwareProductRaw
): string {
  const seo =
    raw.seoUrls?.find((u) => u.isCanonical && u.seoPathInfo)?.seoPathInfo ??
    raw.seoUrls?.find((u) => u.seoPathInfo)?.seoPathInfo ??
    null;
  if (seo) {
    const cleaned = seo.replace(/^\/+/, "");
    const safe = sanitizeSafeUrl(`${origin}/${cleaned}`, origin, { stripTracking: true });
    if (safe) return safe;
  }
  if (raw.id) {
    return `${origin}/detail/${encodeURIComponent(raw.id)}`;
  }
  return origin;
}

function extractProductInfoAttr(html: string): {
  id?: string;
  name?: string;
  brand?: string;
  price?: number;
  sku?: string;
} | null {
  const m = html.match(/data-product-information=["']([^"']+)["']/i);
  if (!m?.[1]) return null;
  try {
    const decoded = decodeHtmlEntitiesBasic(m[1]);
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    return {
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      brand: typeof parsed.brand === "string" ? parsed.brand : undefined,
      price: typeof parsed.price === "number" ? parsed.price : undefined,
      sku: typeof parsed.sku === "string" ? parsed.sku : undefined
    };
  } catch {
    return null;
  }
}

export class ShopwareAdapter implements StoreAdapter {
  readonly platform = "shopware";
  private readonly client: ShopwareClient;

  constructor(client = new ShopwareClient()) {
    this.client = client;
  }

  async detect(origin: string, concurrencyKey?: string): Promise<StoreInfo | null> {
    const meta = await this.client.resolveDomainMetadata(origin, {
      forceRefresh: true,
      concurrencyKey
    });

    if (!meta.detected) {
      return null;
    }

    return {
      platform: "shopware",
      origin: meta.origin,
      name: meta.name,
      currency: meta.currency,
      country: meta.country,
      myshopifyDomain: null,
      wafRestricted: meta.wafRestricted,
      capabilities: {
        predictiveSearch: meta.storefrontSuggestAvailable,
        productCatalogJson: meta.storeApiAvailable,
        storefrontMcp: false,
        storefrontMcpTools: [],
        shopwareStoreApi: meta.storeApiAvailable,
        shopwareStorefrontSuggest: meta.storefrontSuggestAvailable
      }
    };
  }

  private mapStoreApiProductSummary(
    origin: string,
    apiOrigin: string,
    currency: string,
    raw: ShopwareProductRaw
  ): ProductSummary | null {
    const id = sanitizeText(raw.id, 80);
    const title = sanitizeText(raw.translated?.name ?? raw.name, 200);
    if (!id || !title) return null;

    const calc = raw.calculatedPrice ?? raw.calculatedCheapestPrice;
    const unitPrice = typeof calc?.unitPrice === "number" && Number.isFinite(calc.unitPrice)
      ? calc.unitPrice
      : 0;
    const cheapestPrice =
      typeof raw.calculatedCheapestPrice?.unitPrice === "number" &&
      Number.isFinite(raw.calculatedCheapestPrice.unitPrice)
        ? Math.min(unitPrice, raw.calculatedCheapestPrice.unitPrice)
        : unitPrice;

    const priceMoney = formatMoney(unitPrice, currency);
    const minMoney = formatMoney(cheapestPrice, currency);
    const listPriceVal = calc?.listPrice?.price;
    const compareMoney =
      typeof listPriceVal === "number" && Number.isFinite(listPriceVal) && listPriceVal > unitPrice
        ? formatMoney(listPriceVal, currency)
        : null;
    const discountPct =
      compareMoney
        ? typeof calc?.listPrice?.percentage === "number" && calc.listPrice.percentage > 0
          ? Math.round(calc.listPrice.percentage * 100) / 100
          : computeDiscountPercent(unitPrice, compareMoney.amount)
        : null;

    const url = buildShopwareProductUrl(origin, raw);
    const handle = handleFromUrl(url);
    const allowedMediaHosts = [new URL(apiOrigin).hostname];
    const imageUrl = sanitizeSafeUrl(raw.cover?.media?.url, origin, {
      allowStoreSubdomains: true,
      allowedHosts: allowedMediaHosts
    });

    const available =
      raw.available === false
        ? false
        : raw.isCloseout === true && typeof raw.availableStock === "number" && raw.availableStock <= 0
          ? false
          : true;

    return {
      id,
      handle,
      title,
      vendor: sanitizeOptionalText(
        raw.manufacturer?.translated?.name ?? raw.manufacturer?.name,
        100
      ),
      product_type: null,
      available,
      price: priceMoney,
      price_min: minMoney,
      price_max: priceMoney,
      compare_at_price: compareMoney,
      discount_percent: discountPct,
      url,
      image_url: imageUrl
    };
  }

  private mapStoreApiProductDetail(
    origin: string,
    apiOrigin: string,
    currency: string,
    raw: ShopwareProductRaw,
    configurator?: ShopwareProductDetailResponseRaw["configurator"]
  ): ProductDetail {
    const id = sanitizeText(raw.id, 80) || "product";
    const title = sanitizeText(raw.translated?.name ?? raw.name, 200) || id;
    const url = buildShopwareProductUrl(origin, raw);
    const handle = handleFromUrl(url);
    const calc = raw.calculatedPrice ?? raw.calculatedCheapestPrice;
    const unitPrice = typeof calc?.unitPrice === "number" && Number.isFinite(calc.unitPrice)
      ? calc.unitPrice
      : 0;
    const priceMoney = formatMoney(unitPrice, currency);
    const listPriceVal = calc?.listPrice?.price;
    const compareMoney =
      typeof listPriceVal === "number" && Number.isFinite(listPriceVal) && listPriceVal > unitPrice
        ? formatMoney(listPriceVal, currency)
        : null;
    const discountPct = compareMoney
      ? typeof calc?.listPrice?.percentage === "number" && calc.listPrice.percentage > 0
        ? Math.round(calc.listPrice.percentage * 100) / 100
        : computeDiscountPercent(unitPrice, compareMoney.amount)
      : null;

    const available =
      raw.available === false
        ? false
        : raw.isCloseout === true && typeof raw.availableStock === "number" && raw.availableStock <= 0
          ? false
          : true;

    const allowedMediaHosts = [new URL(apiOrigin).hostname];
    const imageUrls = new Set<string>();
    const cover = sanitizeSafeUrl(raw.cover?.media?.url, origin, {
      allowStoreSubdomains: true,
      allowedHosts: allowedMediaHosts
    });
    if (cover) imageUrls.add(cover);
    for (const m of raw.media ?? []) {
      const safe = sanitizeSafeUrl(m.media?.url, origin, {
        allowStoreSubdomains: true,
        allowedHosts: allowedMediaHosts
      });
      if (safe) imageUrls.add(safe);
    }

    const options = (configurator ?? [])
      .slice(0, 10)
      .map((grp) => ({
        name: sanitizeText(grp.translated?.name ?? grp.name, 80),
        values: (grp.options ?? [])
          .slice(0, 50)
          .map((o) => sanitizeText(o.translated?.name ?? o.name, 80))
          .filter(Boolean)
      }))
      .filter((g) => g.name.length > 0 && g.values.length > 0);

    const optValues = (raw.options ?? [])
      .map((o) => sanitizeText(o.translated?.name ?? o.name, 80))
      .filter(Boolean);

    const sku = sanitizeOptionalText(raw.productNumber, 80);

    const variant: ProductVariant = {
      id,
      title: optValues.length > 0 ? optValues.join(" / ") : "Default",
      sku,
      available,
      price: priceMoney,
      compare_at_price: compareMoney,
      discount_percent: discountPct,
      option_values: optValues
    };

    return {
      id,
      handle,
      title,
      vendor: sanitizeOptionalText(
        raw.manufacturer?.translated?.name ?? raw.manufacturer?.name,
        100
      ),
      product_type: null,
      description_text: stripHtmlToText(raw.translated?.description ?? raw.description, 1500),
      available,
      url,
      options,
      images: Array.from(imageUrls).slice(0, 10),
      variants: [variant]
    };
  }

  private parseSuggestHtml(
    origin: string,
    defaultCurrency: string,
    html: string
  ): ProductSummary[] {
    const products: ProductSummary[] = [];
    const seen = new Set<string>();

    const liBlocks = extractTagBlocksLinear(html, "li", {
      maxBlocks: 30,
      maxBodyLen: 6144,
      attrFilter: (attrs) => {
        const cls = (attrs["class"] ?? "").toLowerCase();
        return cls.includes("search-suggest-product") || cls.includes("search-suggest-item");
      }
    });
    for (const item of liBlocks) {
      if (products.length >= 30) break;
      const block = item.body;
      const anchors = scanOpeningTagsLinear(block, "a", { maxTags: 10 });
      const firstAnchor = anchors.find((a) => a.attrs["href"]);
      const safeUrl = sanitizeSafeUrl(
        firstAnchor?.attrs["href"] ? decodeHtmlEntitiesBasic(firstAnchor.attrs["href"]) : null,
        origin,
        { stripTracking: true }
      );
      if (!safeUrl || seen.has(safeUrl)) continue;

      const titleAttr = firstAnchor?.attrs["title"]
        ? decodeHtmlEntitiesBasic(firstAnchor.attrs["title"])
        : null;
      const nameSpan = extractTextByClassLinear(block, "search-suggest-product-name", {
        maxBodyLen: 512
      });
      const title = stripHtmlToText(titleAttr ?? nameSpan ?? "", 200);
      if (!title) continue;

      const priceSpan =
        extractTextByClassLinear(block, "search-suggest-product-price", {
          closingTag: "div",
          maxBodyLen: 256
        }) ??
        extractTextByClassLinear(block, "product-price", { maxBodyLen: 256 }) ??
        null;
      const parsedPrice = parseLocalizedPrice(priceSpan ? stripHtmlToText(priceSpan, 60) : null);
      const currency = normalizeCurrency(parsedPrice?.currencyHint ?? defaultCurrency);
      const priceMoney = formatMoney(parsedPrice?.amount ?? 0, currency);

      const imgs = scanOpeningTagsLinear(block, "img", { maxTags: 5 });
      const rawImg =
        imgs.find((im) => im.attrs["data-src"])?.attrs["data-src"] ??
        imgs.find((im) => im.attrs["src"])?.attrs["src"] ??
        null;
      const imageUrl = sanitizeSafeUrl(rawImg ? decodeHtmlEntitiesBasic(rawImg) : null, origin, {
        allowStoreSubdomains: true
      });

      const handle = handleFromUrl(safeUrl);
      seen.add(safeUrl);
      products.push({
        id: handle,
        handle,
        title,
        vendor: null,
        product_type: null,
        available: true,
        price: priceMoney,
        price_min: priceMoney,
        price_max: priceMoney,
        compare_at_price: null,
        discount_percent: null,
        url: safeUrl,
        image_url: imageUrl
      });
    }

    return products;
  }

  private parseStorefrontListingHtml(
    origin: string,
    defaultCurrency: string,
    html: string
  ): ProductSummary[] {
    const products: ProductSummary[] = [];
    const seen = new Set<string>();

    // Standard Shopware 6 .product-box cards (linear-time O(N) scan)
    const cards = extractSectionSlicesLinear(
      html,
      "div",
      (attrs) => /\bproduct-box\b/i.test(attrs["class"] ?? ""),
      { maxSections: 30, maxChunkLen: 6000, stopMarkers: ["</section>", "</main>"] }
    );
    for (const card of cards) {
      if (products.length >= 30) break;
      const chunk = card.body;
      const info = extractProductInfoAttr(chunk);
      const anchors = scanOpeningTagsLinear(chunk, "a", { maxTags: 20 });
      const preferredAnchor =
        anchors.find((a) => {
          const cls = (a.attrs["class"] ?? "").toLowerCase();
          return (cls.includes("product-name") || cls.includes("product-image-link")) && a.attrs["href"];
        }) ?? anchors.find((a) => a.attrs["href"]);
      const safeUrl = sanitizeSafeUrl(
        preferredAnchor?.attrs["href"] ? decodeHtmlEntitiesBasic(preferredAnchor.attrs["href"]) : null,
        origin,
        { stripTracking: true }
      );
      if (!safeUrl || seen.has(safeUrl)) continue;

      const nameBlock = extractTagBlocksLinear(chunk, "a", {
        maxBlocks: 1,
        maxBodyLen: 512,
        attrFilter: (attrs) => (attrs["class"] ?? "").toLowerCase().includes("product-name")
      })[0]?.body;
      const title = sanitizeText(info?.name ?? (nameBlock ? stripHtmlToText(nameBlock, 200) : ""), 200);
      if (!title) continue;

      const priceSpan = extractTextByClassLinear(chunk, "product-price", { maxBodyLen: 256 });
      const parsedPrice = parseLocalizedPrice(priceSpan ? stripHtmlToText(priceSpan, 60) : null);
      const currency = normalizeCurrency(parsedPrice?.currencyHint ?? defaultCurrency);
      const amount = typeof info?.price === "number" && Number.isFinite(info.price)
        ? info.price
        : (parsedPrice?.amount ?? 0);
      const priceMoney = formatMoney(amount, currency);

      const listPriceSpan = extractTextByClassLinear(chunk, "list-price-price", { maxBodyLen: 256 });
      const parsedList = parseLocalizedPrice(listPriceSpan ? stripHtmlToText(listPriceSpan, 60) : null);
      const compareMoney =
        parsedList && parsedList.amount > priceMoney.amount
          ? formatMoney(parsedList.amount, currency)
          : null;

      const imgs = scanOpeningTagsLinear(chunk, "img", { maxTags: 5 });
      const rawImg =
        imgs.find((im) => im.attrs["data-src"])?.attrs["data-src"] ??
        imgs.find((im) => im.attrs["src"])?.attrs["src"] ??
        null;
      const imageUrl = sanitizeSafeUrl(rawImg ? decodeHtmlEntitiesBasic(rawImg) : null, origin, {
        allowStoreSubdomains: true
      });

      const handle = handleFromUrl(safeUrl);
      seen.add(safeUrl);
      products.push({
        id: sanitizeOptionalText(info?.id ?? info?.sku, 80) ?? handle,
        handle,
        title,
        vendor: sanitizeOptionalText(info?.brand, 100),
        product_type: null,
        available: !/ausverkauft|nicht mehr verfügbar|out of stock/i.test(chunk),
        price: priceMoney,
        price_min: priceMoney,
        price_max: priceMoney,
        compare_at_price: compareMoney,
        discount_percent: computeDiscountPercent(priceMoney.amount, compareMoney?.amount),
        url: safeUrl,
        image_url: imageUrl
      });
    }

    return products;
  }

  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const limit = Math.min(20, Math.max(1, Math.floor(opts.limit || 10)));
    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const currency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    const notices: string[] = [];
    const query = opts.query?.trim() ?? "";

    let items: ProductSummary[] = [];
    let blocked = false;

    // Mode A: Read-only Shopware 6 Store API (when public sw-access-key is intentionally exposed)
    if (meta.storeApiAvailable && meta.accessKey) {
      try {
        const endpoint = query
          ? `${meta.apiOrigin}/store-api/search`
          : `${meta.apiOrigin}/store-api/product`;
        const payload = query
          ? { search: query, limit: Math.min(25, limit * 2) }
          : { limit: Math.min(25, limit * 2) };

        const res = await this.client.storeApiRequest<ShopwareSearchResponseRaw>(endpoint, {
          method: "POST",
          accessKey: meta.accessKey,
          body: payload,
          concurrencyKey: opts.concurrencyKey
        });

        if (res.status === 401 || res.status === 403) {
          blocked = true;
          notices.push(
            `Shopware Store API returned HTTP ${res.status} (access restricted). ShopCart does not bypass authentication or WAF protection.`
          );
        } else if (res.status === 400 && query.length < 2) {
          notices.push(
            "Shopware 6 Store API search requires at least 2 characters in 'query'."
          );
        } else if (res.status === 200 && Array.isArray(res.data?.elements)) {
          items = res.data.elements
            .map((el) => this.mapStoreApiProductSummary(effectiveOrigin, meta.apiOrigin, currency, el))
            .filter((p): p is ProductSummary => p !== null);
        }
      } catch (err) {
        rethrowIfHardSsrfError(err);
      }
    }

    // Mode B: Classic server-rendered Shopware 6 storefront (/suggest & /search HTML fallback)
    if (items.length === 0 && !meta.storeApiAvailable) {
      if (query) {
        try {
          const suggestRes = await this.client.getHtml(
            `${effectiveOrigin}/suggest?search=${encodeURIComponent(query)}`,
            { concurrencyKey: opts.concurrencyKey }
          );
          if (suggestRes.status === 401 || suggestRes.status === 403) {
            blocked = true;
          } else if (suggestRes.status === 200 && suggestRes.html) {
            items = this.parseSuggestHtml(effectiveOrigin, currency, suggestRes.html);
          }
        } catch (err) {
          rethrowIfHardSsrfError(err);
        }

        if (items.length === 0 && !blocked) {
          try {
            const searchRes = await this.client.getHtml(
              `${effectiveOrigin}/search?search=${encodeURIComponent(query)}`,
              { concurrencyKey: opts.concurrencyKey }
            );
            if (searchRes.status === 401 || searchRes.status === 403) {
              blocked = true;
            } else if (searchRes.status === 200 && searchRes.html) {
              items = this.parseStorefrontListingHtml(effectiveOrigin, currency, searchRes.html);
            }
          } catch (err) {
            rethrowIfHardSsrfError(err);
          }
        }
      } else {
        try {
          const homeRes = await this.client.getHtml(`${effectiveOrigin}/`, {
            concurrencyKey: opts.concurrencyKey
          });
          if (homeRes.status === 401 || homeRes.status === 403) {
            blocked = true;
          } else if (homeRes.status === 200 && homeRes.html) {
            items = this.parseStorefrontListingHtml(effectiveOrigin, currency, homeRes.html);
          }
        } catch (err) {
          rethrowIfHardSsrfError(err);
        }
      }

      if (blocked) {
        notices.push(
          "Store WAF or access controls blocked storefront search (HTTP 401/403). ShopCart does not bypass WAF or authentication."
        );
      }
    }

    let filtered = items;
    if (opts.availableOnly) {
      const avail = filtered.filter((p) => p.available);
      if (filtered.length > 0 && avail.length === 0) {
        notices.push("All matching products are currently sold out (filtered out by available_only=true).");
      }
      filtered = avail;
    }
    if (typeof opts.minPrice === "number" && Number.isFinite(opts.minPrice)) {
      filtered = filtered.filter((p) => p.price.amount >= opts.minPrice!);
    }
    if (typeof opts.maxPrice === "number" && Number.isFinite(opts.maxPrice)) {
      filtered = filtered.filter((p) => p.price.amount <= opts.maxPrice!);
    }

    const sliced = filtered.slice(0, limit);
    if (sliced.length > 0 && sliced.every((p) => !p.available)) {
      notices.push("Note: All matching products are currently marked sold out.");
    }

    return {
      store_origin: effectiveOrigin,
      currency,
      products: sliced,
      notices
    };
  }

  async getProduct(
    origin: string,
    handleOrUrl: string,
    opts: { currencyHint?: string; concurrencyKey?: string } = {}
  ): Promise<GetProductResult> {
    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const currency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    const trimmed = handleOrUrl.trim();

    // Mode A: Read-only POST /store-api/product/<id> when Store API is publicly exposed
    if (meta.storeApiAvailable && meta.accessKey) {
      const uuidFromPath = trimmed.match(/\/detail\/([0-9a-f]{32})\b/i)?.[1];
      const productId = SHOPWARE_UUID_RE.test(trimmed) ? trimmed : uuidFromPath ?? null;

      if (productId) {
        const res = await this.client.storeApiRequest<ShopwareProductDetailResponseRaw>(
          `${meta.apiOrigin}/store-api/product/${encodeURIComponent(productId)}`,
          {
            method: "POST",
            accessKey: meta.accessKey,
            body: {},
            concurrencyKey: opts.concurrencyKey
          }
        );
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `Shopware Store API returned HTTP ${res.status} for product '${productId}'. ShopCart does not bypass authentication or WAF protection.`
          );
        }
        if (res.status === 200 && res.data?.product) {
          return {
            store_origin: effectiveOrigin,
            currency,
            product: this.mapStoreApiProductDetail(
              effectiveOrigin,
              meta.apiOrigin,
              currency,
              res.data.product,
              res.data.configurator
            )
          };
        }
      }
    }

    // Mode B: Storefront HTML + JSON-LD + data-product-information extraction
    const path = extractSafePathOnOrigin(trimmed, effectiveOrigin);
    const targetUrl = `${effectiveOrigin}${path}`;
    const res = await this.client.getHtml(targetUrl, {
      concurrencyKey: opts.concurrencyKey
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Store WAF blocked product page '${targetUrl}' (HTTP ${res.status}). ShopCart does not bypass WAF or authentication.`
      );
    }
    if (res.status < 200 || res.status >= 300 || !res.html) {
      throw new Error(`Product '${handleOrUrl}' not found on ${effectiveOrigin} (HTTP ${res.status})`);
    }

    const html = res.html;
    const ldBlocks = extractJsonLdBlocks(html);
    const productLd = findBestProductJsonLd(ldBlocks);
    const offer = productLd ? parseJsonLdOffer(productLd.offers) : parseJsonLdOffer(null);
    const infoAttr = extractProductInfoAttr(html);

    const resolvedCurrency = normalizeCurrency(
      opts.currencyHint ?? offer.currency ?? meta.currency
    );

    const priceVal =
      offer.price ??
      (typeof infoAttr?.price === "number" && Number.isFinite(infoAttr.price) ? infoAttr.price : null) ??
      parseLocalizedPrice(
        extractTextByClassLinear(html, "product-detail-price", { maxBodyLen: 256 })
      )?.amount ??
      0;
    const priceMoney = formatMoney(priceVal, resolvedCurrency);

    const listPriceMatch = extractTextByClassLinear(html, "list-price-price", { maxBodyLen: 256 });
    const parsedList = parseLocalizedPrice(listPriceMatch ? stripHtmlToText(listPriceMatch, 60) : null);
    const compareMoney =
      parsedList && parsedList.amount > priceMoney.amount
        ? formatMoney(parsedList.amount, resolvedCurrency)
        : offer.highPrice && offer.highPrice > priceMoney.amount
          ? formatMoney(offer.highPrice, resolvedCurrency)
          : null;

    const h1Blocks = extractTagBlocksLinear(html, "h1", { maxBlocks: 5, maxBodyLen: 512 });
    const h1 =
      h1Blocks.find((b) => (b.attrs["class"] ?? "").toLowerCase().includes("product-detail-name"))?.body ??
      h1Blocks[0]?.body ??
      null;
    const title =
      sanitizeText(typeof productLd?.name === "string" ? productLd.name : "", 200) ||
      (h1 ? stripHtmlToText(h1, 200) : "") ||
      sanitizeText(infoAttr?.name, 200) ||
      handleFromUrl(res.url || targetUrl);

    const sku = sanitizeOptionalText(
      (typeof productLd?.sku === "string" ? productLd.sku : null) ??
        offer.sku ??
        infoAttr?.sku ??
        extractTextByClassLinear(html, "product-detail-ordernumber", { maxBodyLen: 128 }),
      80
    );

    const descriptionRaw =
      typeof productLd?.description === "string"
        ? productLd.description
        : extractTextByClassLinear(html, "product-detail-description-text", {
            closingTag: "div",
            maxBodyLen: 16_384
          }) ?? "";
    const descriptionText = stripHtmlToText(descriptionRaw, 1500);

    const available =
      offer.available !== null
        ? offer.available
        : !/nicht mehr verfügbar|ausverkauft|out of stock/i.test(html.slice(0, 50_000));

    const canonicalUrl =
      sanitizeSafeUrl(
        typeof productLd?.url === "string" ? productLd.url : res.url || targetUrl,
        effectiveOrigin,
        { stripTracking: true }
      ) ?? targetUrl;
    const handle = handleFromUrl(canonicalUrl);

    const rawImages = extractJsonLdImages(productLd?.image);
    const ogImage = extractMetaContent(html, "og:image");
    if (ogImage) rawImages.push(ogImage);
    const images = Array.from(
      new Set(
        rawImages
          .map((img) => sanitizeSafeUrl(img, effectiveOrigin, { allowStoreSubdomains: true }))
          .filter((u): u is string => Boolean(u))
      )
    ).slice(0, 10);

    // Extract Shopware 6 variant configurator groups if present (linear-time O(N) scan)
    const options: Array<{ name: string; values: string[] }> = [];
    const groups = extractSectionSlicesLinear(
      html,
      "div",
      (attrs) => (attrs["class"] ?? "").toLowerCase().includes("product-detail-configurator-group"),
      { maxSections: 10, maxChunkLen: 8192, stopMarkers: ["</form>"] }
    );
    for (const grp of groups) {
      const grpBlock = grp.body;
      const grpTitle = extractTextByClassLinear(grpBlock, "product-detail-configurator-group-title", {
        maxBodyLen: 256
      });
      const name = grpTitle ? stripHtmlToText(grpTitle, 80) : "";
      if (!name) continue;
      const vals = new Set<string>();
      const optLabels = extractTagBlocksLinear(grpBlock, "label", {
        maxBlocks: 50,
        maxBodyLen: 256,
        attrFilter: (attrs) =>
          (attrs["class"] ?? "").toLowerCase().includes("product-detail-configurator-option-label")
      });
      for (const lbl of optLabels) {
        if (vals.size >= 50) break;
        const t = stripHtmlToText(lbl.body, 80);
        if (t) vals.add(t);
      }
      if (vals.size > 0) {
        options.push({ name, values: Array.from(vals) });
      }
    }

    const id = sanitizeOptionalText(infoAttr?.id, 80) ?? sku ?? handle;
    const variant: ProductVariant = {
      id,
      title: "Default",
      sku,
      available,
      price: priceMoney,
      compare_at_price: compareMoney,
      discount_percent: computeDiscountPercent(priceMoney.amount, compareMoney?.amount),
      option_values: []
    };

    const product: ProductDetail = {
      id,
      handle,
      title,
      vendor: extractJsonLdBrand(productLd?.brand) ?? sanitizeOptionalText(infoAttr?.brand, 100),
      product_type: sanitizeOptionalText(
        typeof productLd?.category === "string" ? productLd.category : null,
        100
      ),
      description_text: descriptionText,
      available,
      url: canonicalUrl,
      options,
      images,
      variants: [variant]
    };

    return {
      store_origin: effectiveOrigin,
      currency: resolvedCurrency,
      product
    };
  }

  async buildCartLink(
    origin: string,
    items: CartLinkItemInput[],
    opts: {
      mode: "cart" | "checkout";
      discountCode?: string;
      verifyHandles?: string[];
      concurrencyKey?: string;
    }
  ): Promise<CartLinkResult> {
    if (!items.length || items.length > 20) {
      throw new Error("items must contain between 1 and 20 line items");
    }

    for (const item of items) {
      if (!/^[A-Za-z0-9._/-]{1,128}$/.test(item.variantId) || item.variantId.includes("..")) {
        throw new Error(`Invalid Shopware product identifier: ${item.variantId}`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for item ${item.variantId}: must be integer 1..99`);
      }
    }

    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;
    const warnings: string[] = [];

    const verifiedById = new Map<
      string,
      { available: boolean; title: string; unitPrice: ProductVariant["price"]; url: string }
    >();

    const handlesToCheck = Array.from(
      new Set([
        ...(opts.verifyHandles ?? []),
        ...items
          .map((i) => i.variantId)
          .filter((id) => SHOPWARE_UUID_RE.test(id) || id.includes("/"))
      ])
    ).slice(0, 10);

    await Promise.all(
      handlesToCheck.map(async (h) => {
        try {
          const detail = await this.getProduct(origin, h, {
            concurrencyKey: opts.concurrencyKey
          });
          for (const v of detail.product.variants) {
            const info = {
              available: v.available,
              title: detail.product.title,
              unitPrice: v.price,
              url: detail.product.url
            };
            verifiedById.set(v.id, info);
            verifiedById.set(detail.product.handle, info);
            if (v.sku) verifiedById.set(v.sku, info);
          }
        } catch (err) {
          warnings.push(
            `Could not verify Shopware product '${h}': ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })
    );

    const resultItems: CartLinkItemResult[] = [];
    const productLinks: AdditionalCartLink[] = [];

    for (const item of items) {
      const found = verifiedById.get(item.variantId);
      if (found) {
        if (!found.available) {
          warnings.push(`Product ${item.variantId} (${found.title}) is currently out of stock.`);
        }
        resultItems.push({
          variant_id: item.variantId,
          quantity: item.quantity,
          verified: true,
          available: found.available,
          title: found.title,
          unit_price: found.unitPrice
        });
        productLinks.push({
          variant_id: item.variantId,
          quantity: item.quantity,
          title: found.title,
          cart_url: found.url
        });
      } else {
        const rawFallback = SHOPWARE_UUID_RE.test(item.variantId)
          ? `${effectiveOrigin}/detail/${encodeURIComponent(item.variantId)}`
          : `${effectiveOrigin}/${item.variantId.replace(/^\/+/, "")}`;
        const fallbackUrl =
          sanitizeSafeUrl(rawFallback, effectiveOrigin, { stripTracking: true }) ?? effectiveOrigin;
        resultItems.push({
          variant_id: item.variantId,
          quantity: item.quantity,
          ...(opts.verifyHandles?.length ? { verified: false } : {})
        });
        productLinks.push({
          variant_id: item.variantId,
          quantity: item.quantity,
          cart_url: fallbackUrl
        });
      }
    }

    warnings.push(
      "Shopware 6 storefront carts require a browser session and CSRF token; ShopCart stays strictly read-only and returns verified direct product page link(s) instead of mutating server-side carts."
    );

    const additionalCartLinks = productLinks.length > 1 ? productLinks.slice(1) : undefined;

    return {
      store_origin: effectiveOrigin,
      cart_url: productLinks[0]!.cart_url,
      mode: opts.mode,
      items: resultItems,
      ...(additionalCartLinks ? { additional_cart_links: additionalCartLinks } : {}),
      warnings,
      next_step:
        "Present the verified Shopware product link(s) to the user so they can select options, add the item(s) to their cart, and complete checkout in their browser."
    };
  }
}
