import {
  extractSafeHandleFromUrl,
  sanitizeGenericVariantId,
  sanitizeSafeHandle
} from "../../security/identifiers.js";
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
  hasJsonLdType,
  parseJsonLdOffer,
  parseLocalizedPrice,
  rethrowIfHardSsrfError,
  scanOpeningTagsLinear
} from "../shared/html.js";
import { BigCommerceClient, extractCurrencyFromHtml } from "./client.js";

interface BcPriceBlock {
  value?: number;
  formatted?: string;
  currency?: string;
}

interface BcDataPayload {
  product_attributes?: {
    sku?: string | null;
    stock?: number | null;
    instock?: boolean;
    purchasable?: boolean;
    stock_message?: string | null;
    price?: {
      without_tax?: BcPriceBlock;
      with_tax?: BcPriceBlock;
      rrp_without_tax?: BcPriceBlock;
      rrp_with_tax?: BcPriceBlock;
      non_sale_price_without_tax?: BcPriceBlock;
      non_sale_price_with_tax?: BcPriceBlock;
      saved?: BcPriceBlock;
    };
  };
}

function extractBalancedJsonObject(source: string, startBraceIndex: number): string | null {
  if (source[startBraceIndex] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const maxScan = Math.min(source.length, startBraceIndex + 65_536);

  for (let i = startBraceIndex; i < maxScan; i++) {
    const ch = source[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(startBraceIndex, i + 1);
      }
    }
  }
  return null;
}

const MAX_BCDATA_ATTEMPTS = 16;

export function extractBcData(html: string): BcDataPayload | null {
  const re = /(?:window\.|var\s+|let\s+|const\s+)?BCData\s*=\s*\{/g;
  let match: RegExpExecArray | null;
  let attempts = 0;
  while ((match = re.exec(html)) !== null && attempts++ < MAX_BCDATA_ATTEMPTS) {
    const braceIdx = match.index + match[0].length - 1;
    const rawJson = extractBalancedJsonObject(html, braceIdx);
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson) as BcDataPayload;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // ignore malformed BCData block
    }
  }
  return null;
}

function extractAttr(tag: string, attrName: string): string | null {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  const val = m?.[1] ?? m?.[2];
  return val !== undefined ? decodeHtmlEntitiesBasic(val).trim() : null;
}

function handleFromProductUrl(url: string): string {
  return (
    extractSafeHandleFromUrl(url, { stripFileExtension: true }) ??
    sanitizeSafeHandle(url.replace(/^\/+|\/+$/g, "")) ??
    ""
  );
}

function extractBigCommerceProductIdFromHtml(html: string): string | null {
  const inputs = scanOpeningTagsLinear(html, "input", { maxTags: 200 });
  for (const inp of inputs) {
    if (
      (inp.attrs["name"] ?? "").toLowerCase() === "product_id" &&
      inp.attrs["value"] &&
      /^\d{1,20}$/.test(inp.attrs["value"].trim())
    ) {
      return inp.attrs["value"].trim();
    }
  }
  const simplePatterns = [
    /\bdata-entity-id=["'](\d{1,20})["']/i,
    /\bdata-product-id=["'](\d{1,20})["']/i,
    /"productId"\s*:\s*(\d{1,20})/
  ];
  for (const re of simplePatterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractBigCommerceOptions(html: string): Array<{ name: string; values: string[] }> {
  const options: Array<{ name: string; values: string[] }> = [];
  const sections = extractSectionSlicesLinear(
    html,
    "div",
    (attrs) => Object.hasOwn(attrs, "data-product-attribute"),
    { maxSections: 10, maxChunkLen: 8192, stopMarkers: ["</form>"] }
  );
  for (const sec of sections) {
    const block = sec.body;
    const labels = extractTagBlocksLinear(block, "label", {
      maxBlocks: 3,
      maxBodyLen: 512,
      attrFilter: (attrs) => (attrs["class"] ?? "").toLowerCase().includes("form-label")
    });
    const rawName = labels[0]?.body
      ? stripHtmlToText(labels[0].body, 80)
          .replace(/\s*Required$/i, "")
          .replace(/:\s*$/, "")
          .trim()
      : "";
    if (!rawName) continue;

    const vals = new Set<string>();
    const optBlocks = extractTagBlocksLinear(block, "option", {
      maxBlocks: 50,
      maxBodyLen: 256,
      attrFilter: (attrs) => Boolean((attrs["value"] ?? "").trim())
    });
    for (const ob of optBlocks) {
      if (vals.size >= 50) break;
      const text = stripHtmlToText(ob.body, 80);
      if (text && !/^(choose|select|pick)\b/i.test(text)) vals.add(text);
    }

    const spanBlocks = extractTagBlocksLinear(block, "span", {
      maxBlocks: 50,
      maxBodyLen: 256,
      attrFilter: (attrs) => (attrs["class"] ?? "").toLowerCase().includes("form-option-variant")
    });
    for (const sb of spanBlocks) {
      if (vals.size >= 50) break;
      const text = stripHtmlToText(sb.body, 80);
      if (text) vals.add(text);
    }

    if (vals.size > 0) {
      options.push({ name: rawName, values: Array.from(vals) });
    }
  }
  return options;
}

export class BigCommerceAdapter implements StoreAdapter {
  readonly platform = "bigcommerce";
  private readonly client: BigCommerceClient;

  constructor(client = new BigCommerceClient()) {
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
      platform: "bigcommerce",
      origin: meta.origin,
      name: meta.name,
      currency: meta.currency,
      country: meta.country,
      myshopifyDomain: null,
      wafRestricted: meta.wafRestricted,
      capabilities: {
        predictiveSearch: false,
        productCatalogJson: false,
        storefrontMcp: false,
        storefrontMcpTools: [],
        bigcommerceStorefront: true,
        bigcommerceCartPermalink: true
      }
    };
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
    const notices: string[] = [];
    const query = opts.query?.trim() ?? "";

    let html = "";
    let currency = normalizeCurrency(opts.currencyHint ?? meta.currency);
    let blocked = false;

    const urlsToTry = query
      ? [
          `${effectiveOrigin}/search.php?search_query=${encodeURIComponent(query)}&section=product`,
          `${effectiveOrigin}/search.php?search_query=${encodeURIComponent(query)}`
        ]
      : [`${effectiveOrigin}/`];

    let parsedItems: ProductSummary[] = [];

    for (const targetUrl of urlsToTry) {
      try {
        const res = await this.client.getHtml(targetUrl, {
          concurrencyKey: opts.concurrencyKey
        });
        if (res.status === 401 || res.status === 403) {
          blocked = true;
          break;
        }
        if (res.status === 200 && res.html) {
          html = res.html;
          const detectedCurrency = extractCurrencyFromHtml(html);
          if (!opts.currencyHint && detectedCurrency) {
            currency = detectedCurrency;
          }
          parsedItems = this.parseSearchCards(effectiveOrigin, currency, html);
          if (parsedItems.length > 0) break;
        }
      } catch (err) {
        rethrowIfHardSsrfError(err);
      }
    }

    if (blocked) {
      notices.push(
        "Store WAF restricted /search.php (HTTP 401/403). Direct product URLs or /cart.php?action=add permalinks remain available when you have a product ID or SKU."
      );
    } else if (!query && parsedItems.length === 0) {
      notices.push(
        "No featured product cards were found on the homepage. Provide a non-empty 'query' parameter to search via /search.php."
      );
    }

    let filtered = parsedItems;
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

  private parseSearchCards(
    origin: string,
    defaultCurrency: string,
    html: string
  ): ProductSummary[] {
    const products: ProductSummary[] = [];
    const seenUrls = new Set<string>();

    // Primary: BigCommerce Stencil <article class="card ..."> blocks (linear-time O(N) scan)
    const articles = extractTagBlocksLinear(html, "article", {
      maxBlocks: 40,
      maxBodyLen: 12_288
    });
    for (const art of articles) {
      if (products.length >= 40) break;
      const openAttrs = art.openAttrs;
      const body = art.body;
      const className = art.attrs["class"] ?? "";
      const rawEntityAttr =
        art.attrs["data-entity-id"] ??
        art.attrs["data-product-id"] ??
        art.attrs["data-test"]?.match(/^card-(\d{1,20})$/i)?.[1] ??
        null;
      const numericEntityAttr =
        rawEntityAttr && /^\d{1,20}$/.test(rawEntityAttr.trim()) ? rawEntityAttr.trim() : null;
      const entityId =
        numericEntityAttr ??
        body.match(/\bdata-product-id=["'](\d{1,20})["']/i)?.[1] ??
        body.match(/cart\.php\?action=add&(?:amp;)?product_id=(\d{1,20})/i)?.[1] ??
        null;

      if (!entityId && !/\bcard\b/i.test(className)) continue;

      const anchors = scanOpeningTagsLinear(body, "a", { maxTags: 30 });
      const cardFigureLink = anchors.find((a) =>
        (a.attrs["class"] ?? "").toLowerCase().includes("card-figure__link") && a.attrs["href"]
      );
      let headingLink: string | null = null;
      let headingTitle: string | null = null;
      for (const hTag of ["h2", "h3", "h4", "h5"]) {
        const hBlocks = extractTagBlocksLinear(body, hTag, {
          maxBlocks: 2,
          maxBodyLen: 1024,
          attrFilter: (attrs) => (attrs["class"] ?? "").toLowerCase().includes("card-title")
        });
        if (hBlocks[0]) {
          headingTitle = hBlocks[0].body;
          const innerAnchors = scanOpeningTagsLinear(hBlocks[0].body, "a", { maxTags: 3 });
          headingLink = innerAnchors.find((a) => a.attrs["href"])?.attrs["href"] ?? null;
          break;
        }
      }
      const rawHref =
        cardFigureLink?.attrs["href"] ??
        headingLink ??
        anchors.find((a) => a.attrs["href"])?.attrs["href"] ??
        null;
      const safeUrl = sanitizeSafeUrl(
        rawHref ? decodeHtmlEntitiesBasic(rawHref) : null,
        origin,
        { stripTracking: true }
      );
      if (!safeUrl || seenUrls.has(safeUrl)) continue;

      const imgs = scanOpeningTagsLinear(body, "img", { maxTags: 10 });
      const imgAlt = imgs.find((im) => im.attrs["alt"])?.attrs["alt"] ?? null;
      const titleRaw =
        (art.attrs["data-name"] ? decodeHtmlEntitiesBasic(art.attrs["data-name"]) : null) ??
        headingTitle ??
        (imgAlt ? decodeHtmlEntitiesBasic(imgAlt) : null);
      const title = titleRaw ? stripHtmlToText(titleRaw, 200) : "";
      if (!title) continue;

      const vendorRaw =
        (art.attrs["data-product-brand"]
          ? decodeHtmlEntitiesBasic(art.attrs["data-product-brand"])
          : null) ??
        extractTextByClassLinear(body, "card-text--brand", { maxBodyLen: 256 }) ??
        null;
      const categoryRaw = art.attrs["data-product-category"]
        ? decodeHtmlEntitiesBasic(art.attrs["data-product-category"])
        : null;

      const priceAttr = art.attrs["data-product-price"]
        ? decodeHtmlEntitiesBasic(art.attrs["data-product-price"])
        : null;
      const priceSpan =
        body.match(/data-product-price-(?:without|with)-tax\b[^<>]{0,200}>([^<]{1,80})<\//i)?.[1] ??
        extractTextByClassLinear(body, "price--withouttax", { maxBodyLen: 128 }) ??
        extractTextByClassLinear(body, "price--withtax", { maxBodyLen: 128 }) ??
        extractTextByClassLinear(body, "price--main", { maxBodyLen: 128 }) ??
        null;
      const parsedPrice =
        parseLocalizedPrice(priceSpan) ??
        parseLocalizedPrice(priceAttr);

      const currency = normalizeCurrency(parsedPrice?.currencyHint ?? defaultCurrency);
      const priceMoney = formatMoney(parsedPrice?.amount ?? 0, currency);

      const compareSpan =
        body.match(/data-product-rrp-(?:without|with)-tax\b[^<>]{0,200}>([^<]{1,80})<\//i)?.[1] ??
        body.match(/data-product-non-sale-price-(?:without|with)-tax\b[^<>]{0,200}>([^<]{1,80})<\//i)?.[1] ??
        extractTextByClassLinear(body, "price--rrp", { maxBodyLen: 128 }) ??
        extractTextByClassLinear(body, "price--non-sale", { maxBodyLen: 128 }) ??
        null;
      const parsedCompare = parseLocalizedPrice(compareSpan);
      const compareMoney =
        parsedCompare && parsedCompare.amount > priceMoney.amount
          ? formatMoney(parsedCompare.amount, currency)
          : null;

      const rawImgSrc =
        imgs.find((im) => im.attrs["data-src"])?.attrs["data-src"] ??
        imgs.find((im) => im.attrs["src"])?.attrs["src"] ??
        null;
      const imageUrl = sanitizeSafeUrl(
        rawImgSrc ? decodeHtmlEntitiesBasic(rawImgSrc) : null,
        origin,
        {
          allowBigCommerceCdn: true,
          allowStoreSubdomains: true
        }
      );

      const lowerBody = body.toLowerCase();
      const outOfStock =
        /data-out-of-stock=["']true["']/i.test(body) ||
        lowerBody.includes("sold-out") ||
        lowerBody.includes("out-of-stock") ||
        />\s*(?:out of stock|sold out|ausverkauft)\s*</i.test(body);

      const handle = handleFromProductUrl(safeUrl);
      if (!handle) continue;
      seenUrls.add(safeUrl);

      products.push({
        id: sanitizeGenericVariantId(entityId) ?? handle,
        handle,
        title,
        vendor: vendorRaw ? sanitizeOptionalText(stripHtmlToText(vendorRaw, 100), 100) : null,
        product_type: categoryRaw ? sanitizeOptionalText(categoryRaw, 100) : null,
        available: !outOfStock,
        price: priceMoney,
        price_min: priceMoney,
        price_max: priceMoney,
        compare_at_price: compareMoney,
        discount_percent: computeDiscountPercent(priceMoney.amount, compareMoney?.amount),
        url: safeUrl,
        image_url: imageUrl
      });
    }

    // Fallback: JSON-LD ItemList / Product blocks if no Stencil cards matched
    if (products.length === 0) {
      const ldBlocks = extractJsonLdBlocks(html);
      for (const block of ldBlocks) {
        if (!block || typeof block !== "object" || Array.isArray(block)) continue;
        const rec = block as Record<string, unknown>;
        const items: Record<string, unknown>[] = [];
        if (hasJsonLdType(rec, "Product")) {
          items.push(rec);
        } else if (hasJsonLdType(rec, "ItemList") && Array.isArray(rec.itemListElement)) {
          for (const el of rec.itemListElement) {
            if (el && typeof el === "object") {
              const inner = (el as Record<string, unknown>).item ?? el;
              if (inner && typeof inner === "object") items.push(inner as Record<string, unknown>);
            }
          }
        }
        for (const item of items) {
          const title = sanitizeText(typeof item.name === "string" ? item.name : "", 200);
          const offer = parseJsonLdOffer(item.offers);
          const safeUrl = sanitizeSafeUrl(
            typeof item.url === "string" ? item.url : offer.url,
            origin,
            { stripTracking: true }
          );
          if (!title || !safeUrl || seenUrls.has(safeUrl)) continue;
          const currency = normalizeCurrency(offer.currency ?? defaultCurrency);
          const priceMoney = formatMoney(offer.price ?? 0, currency);
          const compareMoney =
            offer.highPrice && offer.highPrice > priceMoney.amount
              ? formatMoney(offer.highPrice, currency)
              : null;
          const imgs = extractJsonLdImages(item.image);
          const imageUrl = imgs[0]
            ? sanitizeSafeUrl(imgs[0], origin, {
                allowBigCommerceCdn: true,
                allowStoreSubdomains: true
              })
            : null;
          const handle = handleFromProductUrl(safeUrl);
          if (!handle) continue;
          seenUrls.add(safeUrl);
          const rawSku = sanitizeOptionalText(typeof item.sku === "string" ? item.sku : offer.sku, 80);
          products.push({
            id: sanitizeGenericVariantId(rawSku) ?? handle,
            handle,
            title,
            vendor: extractJsonLdBrand(item.brand),
            product_type: sanitizeOptionalText(typeof item.category === "string" ? item.category : null, 100),
            available: offer.available !== false,
            price: priceMoney,
            price_min: priceMoney,
            price_max: priceMoney,
            compare_at_price: compareMoney,
            discount_percent: computeDiscountPercent(priceMoney.amount, compareMoney?.amount),
            url: safeUrl,
            image_url: imageUrl
          });
        }
      }
    }

    return products;
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
    const path = extractSafePathOnOrigin(handleOrUrl, effectiveOrigin);
    const productUrl = `${effectiveOrigin}${path}`;

    const res = await this.client.getHtml(productUrl, {
      concurrencyKey: opts.concurrencyKey
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Store WAF blocked product page '${productUrl}' (HTTP ${res.status}). ShopCart does not bypass WAF protection.`
      );
    }
    if (res.status < 200 || res.status >= 300 || !res.html) {
      throw new Error(`Product '${handleOrUrl}' not found on ${effectiveOrigin} (HTTP ${res.status})`);
    }

    const html = res.html;
    const bcData = extractBcData(html);
    const ldBlocks = extractJsonLdBlocks(html);
    const productLd = findBestProductJsonLd(ldBlocks);
    const offer = productLd ? parseJsonLdOffer(productLd.offers) : parseJsonLdOffer(null);

    const attrs = bcData?.product_attributes;
    const bcPrice = attrs?.price?.without_tax ?? attrs?.price?.with_tax;
    const bcCompare =
      attrs?.price?.non_sale_price_without_tax ??
      attrs?.price?.non_sale_price_with_tax ??
      attrs?.price?.rrp_without_tax ??
      attrs?.price?.rrp_with_tax;

    const currency = normalizeCurrency(
      opts.currencyHint ??
        bcPrice?.currency ??
        offer.currency ??
        extractCurrencyFromHtml(html) ??
        meta.currency
    );

    const priceAmount =
      typeof bcPrice?.value === "number" && Number.isFinite(bcPrice.value)
        ? bcPrice.value
        : (offer.price ?? 0);
    const priceMoney = formatMoney(priceAmount, currency);

    let compareAtMoney = null;
    if (
      typeof bcCompare?.value === "number" &&
      Number.isFinite(bcCompare.value) &&
      bcCompare.value > priceMoney.amount
    ) {
      compareAtMoney = formatMoney(bcCompare.value, currency);
    } else if (offer.highPrice && offer.highPrice > priceMoney.amount) {
      compareAtMoney = formatMoney(offer.highPrice, currency);
    }

    const productId = extractBigCommerceProductIdFromHtml(html);
    const sku = sanitizeOptionalText(
      attrs?.sku ?? (typeof productLd?.sku === "string" ? productLd.sku : offer.sku),
      80
    );

    const h1Blocks = extractTagBlocksLinear(html, "h1", { maxBlocks: 5, maxBodyLen: 512 });
    const titleFromHtml =
      h1Blocks.find((b) => (b.attrs["class"] ?? "").toLowerCase().includes("productview-title"))?.body ??
      h1Blocks[0]?.body ??
      null;
    const title =
      sanitizeText(typeof productLd?.name === "string" ? productLd.name : "", 200) ||
      (titleFromHtml ? stripHtmlToText(titleFromHtml, 200) : "") ||
      handleFromProductUrl(res.url || productUrl);

    const descBlock =
      typeof productLd?.description === "string"
        ? productLd.description
        : extractTagBlocksLinear(html, "div", {
            maxBlocks: 1,
            maxBodyLen: 16_384,
            attrFilter: (attrs) => (attrs["id"] ?? "").toLowerCase() === "tab-description"
          })[0]?.body ?? "";
    const descriptionText = stripHtmlToText(descBlock, 1500);

    const available =
      typeof attrs?.instock === "boolean" && typeof attrs?.purchasable === "boolean"
        ? attrs.instock && attrs.purchasable
        : typeof attrs?.instock === "boolean"
          ? attrs.instock
          : offer.available !== false;

    const canonicalUrl =
      sanitizeSafeUrl(
        typeof productLd?.url === "string" ? productLd.url : res.url || productUrl,
        effectiveOrigin,
        { stripTracking: true }
      ) ?? productUrl;
    const handle = handleFromProductUrl(canonicalUrl);

    const rawImages = extractJsonLdImages(productLd?.image);
    const ogImage = extractMetaContent(html, "og:image");
    if (ogImage) rawImages.push(ogImage);
    const images = Array.from(
      new Set(
        rawImages
          .map((img) =>
            sanitizeSafeUrl(img, effectiveOrigin, {
              allowBigCommerceCdn: true,
              allowStoreSubdomains: true
            })
          )
          .filter((u): u is string => Boolean(u))
      )
    ).slice(0, 10);

    const options = extractBigCommerceOptions(html);
    const variantId =
      sanitizeGenericVariantId(productId) ??
      sanitizeGenericVariantId(sku) ??
      sanitizeGenericVariantId(handle);

    const variants: ProductVariant[] = variantId
      ? [
          {
            id: variantId,
            title: "Default",
            sku,
            available,
            price: priceMoney,
            compare_at_price: compareAtMoney,
            discount_percent: computeDiscountPercent(priceMoney.amount, compareAtMoney?.amount),
            option_values: []
          }
        ]
      : [];

    const product: ProductDetail = {
      id: variantId ?? "",
      handle,
      title,
      vendor: extractJsonLdBrand(productLd?.brand),
      product_type: sanitizeOptionalText(
        typeof productLd?.category === "string" ? productLd.category : null,
        100
      ),
      description_text: descriptionText,
      available,
      url: canonicalUrl,
      options,
      images,
      variants
    };

    return {
      store_origin: effectiveOrigin,
      currency,
      product
    };
  }

  private buildSingleItemCartUrl(origin: string, variantId: string, quantity: number): string {
    if (variantId.startsWith("product:")) {
      const id = variantId.slice("product:".length);
      return `${origin}/cart.php?action=add&product_id=${encodeURIComponent(id)}&qty=${quantity}`;
    }
    if (variantId.startsWith("sku:")) {
      const sku = variantId.slice("sku:".length);
      return `${origin}/cart.php?action=add&sku=${encodeURIComponent(sku)}&qty=${quantity}`;
    }
    if (/^\d{1,20}$/.test(variantId)) {
      return `${origin}/cart.php?action=add&product_id=${encodeURIComponent(variantId)}&qty=${quantity}`;
    }
    return `${origin}/cart.php?action=add&sku=${encodeURIComponent(variantId)}&qty=${quantity}`;
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
      if (!/^(?:(?:product|sku):)?[A-Za-z0-9._-]{1,80}$/.test(item.variantId)) {
        throw new Error(`Invalid BigCommerce product_id or sku: ${item.variantId}`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new Error(`Invalid quantity for item ${item.variantId}: must be integer 1..99`);
      }
    }

    if (opts.discountCode && !/^[A-Za-z0-9._-]{1,64}$/.test(opts.discountCode)) {
      throw new Error("Invalid discount_code format");
    }

    const warnings: string[] = [];
    const verifiedMap = new Map<
      string,
      { available: boolean; title: string; unitPrice: ProductVariant["price"] }
    >();

    if (opts.verifyHandles && opts.verifyHandles.length > 0) {
      const uniqueHandles = Array.from(new Set(opts.verifyHandles)).slice(0, 10);
      await Promise.all(
        uniqueHandles.map(async (h) => {
          try {
            const detail = await this.getProduct(origin, h, {
              concurrencyKey: opts.concurrencyKey
            });
            for (const v of detail.product.variants) {
              const info = {
                available: v.available,
                title: detail.product.title,
                unitPrice: v.price
              };
              verifiedMap.set(v.id, info);
              verifiedMap.set(`product:${v.id}`, info);
              if (v.sku) {
                verifiedMap.set(v.sku, info);
                verifiedMap.set(`sku:${v.sku}`, info);
              }
            }
          } catch (err) {
            warnings.push(
              `Could not verify handle '${h}': ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })
      );
    }

    const meta = await this.client.resolveDomainMetadata(origin, {
      concurrencyKey: opts.concurrencyKey
    });
    const effectiveOrigin = meta.origin;

    const resultItems: CartLinkItemResult[] = items.map((item) => {
      if (opts.verifyHandles && opts.verifyHandles.length > 0) {
        const found = verifiedMap.get(item.variantId);
        if (!found) {
          warnings.push(`Item ${item.variantId} was not found in verified product handles.`);
          return { variant_id: item.variantId, quantity: item.quantity, verified: false };
        }
        if (!found.available) {
          warnings.push(`Item ${item.variantId} (${found.title}) is currently out of stock.`);
        }
        return {
          variant_id: item.variantId,
          quantity: item.quantity,
          verified: true,
          available: found.available,
          title: found.title,
          unit_price: found.unitPrice
        };
      }
      return { variant_id: item.variantId, quantity: item.quantity };
    });

    const perItemUrls = items.map((item, idx) => ({
      variant_id: item.variantId,
      quantity: item.quantity,
      title: resultItems[idx]?.title,
      cart_url: this.buildSingleItemCartUrl(effectiveOrigin, item.variantId, item.quantity)
    }));

    if (opts.discountCode) {
      warnings.push(
        `BigCommerce cart permalinks do not pre-apply coupon codes; enter '${opts.discountCode}' manually on the cart or checkout page.`
      );
    }

    const additionalCartLinks: AdditionalCartLink[] | undefined =
      perItemUrls.length > 1 ? perItemUrls.slice(1) : undefined;

    if (additionalCartLinks) {
      warnings.push(
        `BigCommerce /cart.php?action=add supports one product per URL. Open cart_url first, then click each link in additional_cart_links sequentially in the same browser session to add all ${items.length} items.`
      );
    }

    return {
      store_origin: effectiveOrigin,
      cart_url: perItemUrls[0]!.cart_url,
      mode: opts.mode,
      items: resultItems,
      ...(additionalCartLinks ? { additional_cart_links: additionalCartLinks } : {}),
      warnings,
      next_step: additionalCartLinks
        ? "Open cart_url first, then open each link in additional_cart_links sequentially so BigCommerce adds every item to your browser cart before checkout."
        : "Present this BigCommerce cart permalink to the user so they can add the item directly to their cart and complete checkout in their browser."
    };
  }
}
