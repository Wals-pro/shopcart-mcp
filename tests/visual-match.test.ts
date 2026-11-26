import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type {
  AffiliateFeedProduct,
  AffiliateFeedProvider
} from "../src/adapters/affiliate-feed/index.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type {
  CartLinkResult,
  GetProductResult,
  ProductDetail,
  ProductSummary,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreInfo
} from "../src/adapters/types.js";
import { AFFILIATE_DISCLOSURE_NOTE, loadAttributionConfig } from "../src/attribution/links.js";
import { createShopcartMcpServer, SERVER_INSTRUCTIONS } from "../src/mcp/create-server.js";
import {
  findGeminiSchemaViolations,
  GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS
} from "../src/mcp/schema-sanitize.js";
import {
  buildVisualSearchQueries,
  normalizeVisualAttributes,
  scoreVisualCandidate
} from "../src/mcp/visual-match.js";
import { MAX_THUMBNAIL_BYTES, type ThumbnailFetcherFn } from "../src/security/safe-image.js";
import type { SafeFetchResponse } from "../src/security/ssrf.js";

function money(amount: number, currency = "EUR") {
  return {
    amount,
    formatted: `${amount.toFixed(2)} ${currency}`,
    currency
  };
}

function makePngBytes(totalLength = 64): Buffer {
  const buf = Buffer.alloc(totalLength, 0x44);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  return buf;
}

function makeMockStoreAdapter(config: {
  platform: string;
  origins: Record<
    string,
    {
      search?: (opts: SearchProductsOptions) => Promise<SearchProductsResult> | SearchProductsResult;
      product?: (handleOrUrl: string) => Promise<GetProductResult> | GetProductResult;
    }
  >;
}): StoreAdapter {
  return {
    platform: config.platform,
    async detect(origin: string): Promise<StoreInfo | null> {
      if (!Object.hasOwn(config.origins, origin)) return null;
      return {
        platform: config.platform as StoreInfo["platform"],
        origin,
        name: origin,
        currency: "EUR",
        country: "DE",
        myshopifyDomain: null,
        wafRestricted: false,
        capabilities: {
          predictiveSearch: true,
          productCatalogJson: true,
          storefrontMcp: false,
          storefrontMcpTools: []
        }
      };
    },
    async searchProducts(origin: string, opts: SearchProductsOptions): Promise<SearchProductsResult> {
      const entry = config.origins[origin];
      if (!entry?.search) {
        return {
          store_origin: origin,
          currency: "EUR",
          products: [],
          notices: []
        };
      }
      return entry.search(opts);
    },
    async getProduct(origin: string, handleOrUrl: string): Promise<GetProductResult> {
      const entry = config.origins[origin];
      if (!entry?.product) {
        throw new Error(`Product not found: ${handleOrUrl}`);
      }
      return entry.product(handleOrUrl);
    },
    async buildCartLink(origin: string): Promise<CartLinkResult> {
      return {
        store_origin: origin,
        cart_url: `${origin}/cart`,
        mode: "cart",
        items: [],
        warnings: [],
        next_step: "Open cart"
      };
    }
  };
}

function makeProductSummary(overrides: Partial<ProductSummary> & { id: string; title: string; url: string }): ProductSummary {
  return {
    handle: overrides.id,
    vendor: null,
    product_type: null,
    available: true,
    price: money(99.99),
    price_min: money(99.99),
    price_max: money(99.99),
    compare_at_price: null,
    image_url: "https://cdn.shop.example/product.png",
    ...overrides
  };
}

function makeMockAffiliateFeed(products: AffiliateFeedProduct[]): AffiliateFeedProvider {
  return {
    providerName: "awin",
    isConfigured: () => true,
    clearCache: () => undefined,
    listMerchants: async () => Array.from(new Set(products.map((p) => p.merchant_name))),
    resolveStoreTarget: async () => null,
    async search(opts) {
      let filtered = [...products];
      if (opts.ean) {
        const cleanEan = opts.ean.replace(/[\s-]+/g, "");
        filtered = filtered.filter((p) => p.ean === cleanEan || p.gtin === cleanEan);
      } else if (opts.query) {
        const terms = opts.query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
        filtered = filtered.filter((p) => {
          const hay = `${p.title} ${p.brand ?? ""} ${p.category ?? ""} ${p.description_text}`.toLowerCase();
          return terms.some((t) => hay.includes(t));
        });
      }
      if (opts.availableOnly) {
        filtered = filtered.filter((p) => p.available);
      }
      if (opts.minPrice !== undefined) {
        filtered = filtered.filter((p) => p.price.amount >= opts.minPrice!);
      }
      if (opts.maxPrice !== undefined) {
        filtered = filtered.filter((p) => p.price.amount <= opts.maxPrice!);
      }
      return {
        provider: "awin",
        configured: true,
        currency: "EUR",
        merchants_searched: Array.from(new Set(products.map((p) => p.merchant_name))),
        products: filtered.slice(0, opts.limit ?? 10),
        notices: [],
        affiliate_disclosure: filtered.length > 0,
        disclosure_note: filtered.length > 0 ? AFFILIATE_DISCLOSURE_NOTE : undefined
      };
    },
    async searchByEan(ean, opts) {
      return this.search({ ...opts, ean });
    }
  };
}

async function connectClient(opts: Parameters<typeof createShopcartMcpServer>[0]) {
  const server = createShopcartMcpServer(opts);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "visual-match-test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    }
  };
}

describe("visual-match: query building, deterministic ranking & ReDoS safety", () => {
  it("builds bounded primary and fallback queries without duplicating brand/model fragments", () => {
    const attrs = normalizeVisualAttributes({
      product_type: "rolltop backpack",
      brand: "GOT BAG",
      model_or_text: "GOT BAG Rolltop 2.0",
      color: "matte black",
      material: "ocean plastic",
      style_keywords: ["waterproof", "Waterproof", "laptop sleeve"]
    });

    expect(attrs.style_keywords).toEqual(["waterproof", "laptop sleeve"]);
    const queries = buildVisualSearchQueries(attrs);
    expect(queries.primaryQuery.length).toBeLessThanOrEqual(120);
    expect(queries.primaryQuery.toLowerCase()).toContain("got bag");
    expect(queries.primaryQuery.toLowerCase()).toContain("rolltop 2.0");
    expect(queries.fallbackQuery).toBe("GOT BAG rolltop backpack matte black");
  });

  it("ranks exact EAN and strong attribute matches deterministically and stays ReDoS-safe", () => {
    const attrs = normalizeVisualAttributes({
      product_type: "running shoes",
      brand: "Nike",
      model_or_text: "Pegasus 41",
      ean: "406-1234-567890",
      color: "black",
      material: "mesh",
      style_keywords: ["road running", "lightweight"]
    });

    const exactEan = scoreVisualCandidate(attrs, {
      title: "Nike Air Zoom Pegasus 41 Running Shoes Black Mesh",
      vendor: "Nike",
      product_type: "Running Shoes",
      handle: "nike-pegasus-41-black",
      available: true,
      image_url: "https://cdn.shop.example/peg41.jpg",
      ean: "4061234567890"
    });
    const partialMatch = scoreVisualCandidate(attrs, {
      title: "Nike Everyday Running Shoes White",
      vendor: "Nike",
      product_type: "Running Shoes",
      handle: "nike-everyday-white",
      available: true,
      image_url: "https://cdn.shop.example/everyday.jpg"
    });
    const weakOutOfStock = scoreVisualCandidate(attrs, {
      title: "Generic Sneaker Blue",
      vendor: "Other",
      product_type: "Sneaker",
      handle: "generic-sneaker",
      available: false,
      image_url: null
    });

    expect(exactEan.confidence).toBe("high");
    expect(exactEan.reasons).toContain("exact_ean_match");
    expect(exactEan.reasons).toContain("brand_match");
    expect(exactEan.reasons).toContain("model_exact_match");
    expect(exactEan.reasons).toContain("color_match");
    expect(exactEan.reasons).toContain("material_match");
    expect(exactEan.rawScore).toBeGreaterThan(partialMatch.rawScore);
    expect(partialMatch.rawScore).toBeGreaterThan(weakOutOfStock.rawScore);
    expect(weakOutOfStock.confidence).toBe("low");

    // ReDoS safety check: catastrophic regex syntax in inputs must never throw or backtrack
    const t0 = Date.now();
    const hostileAttrs = normalizeVisualAttributes({
      product_type: "(a+)+$ [unclosed",
      brand: "(x+x+)+y",
      model_or_text: ".*.*.*.*.*.*.*!$",
      style_keywords: ["([a-z]+)+$", "a{1,999999}"]
    });
    const hostileScore = scoreVisualCandidate(hostileAttrs, {
      title: `${"a".repeat(300)}!`,
      vendor: "x".repeat(100),
      product_type: "test",
      handle: "test",
      available: true,
      image_url: null
    });
    expect(Date.now() - t0).toBeLessThan(100);
    expect(hostileScore.matchScore).toBeGreaterThanOrEqual(0);
  });
});

describe("MCP integration: match_visual_product & get_product(include_thumbnail)", () => {
  it("runs multi-store parallel search, isolates store errors, deduplicates, uses fallback query, and propagates attribution", async () => {
    const queriesByStore: Record<string, string[]> = {
      "https://shop-a.example": [],
      "https://shop-b.example": []
    };

    const shopifyAdapter = makeMockStoreAdapter({
      platform: "shopify",
      origins: {
        "https://shop-a.example": {
          search: (opts) => {
            queriesByStore["https://shop-a.example"]!.push(opts.query ?? "");
            return {
              store_origin: "https://shop-a.example",
              currency: "EUR",
              products: [
                makeProductSummary({
                  id: "p-exact",
                  handle: "got-bag-rolltop-2-0-black",
                  title: "GOT BAG Rolltop 2.0 Backpack Matte Black Recycled Ocean Plastic",
                  vendor: "GOT BAG",
                  product_type: "Rolltop Backpack",
                  available: true,
                  price: money(149),
                  price_min: money(149),
                  price_max: money(149),
                  url: "https://shop-a.example/products/got-bag-rolltop-2-0-black"
                }),
                // Duplicate ID returned from same store should deduplicate cleanly
                makeProductSummary({
                  id: "p-exact",
                  handle: "got-bag-rolltop-2-0-black",
                  title: "GOT BAG Rolltop 2.0 Backpack Matte Black Recycled Ocean Plastic",
                  vendor: "GOT BAG",
                  product_type: "Rolltop Backpack",
                  available: true,
                  price: money(149),
                  price_min: money(149),
                  price_max: money(149),
                  url: "https://shop-a.example/products/got-bag-rolltop-2-0-black?variant=123"
                })
              ],
              notices: []
            };
          }
        },
        "https://broken-shop.example": {
          search: () => {
            throw new Error("ECONNRESET secret_token=abc123 /internal/path");
          }
        }
      }
    });

    const wooAdapter = makeMockStoreAdapter({
      platform: "woocommerce",
      origins: {
        "https://shop-b.example": {
          search: (opts) => {
            const q = opts.query ?? "";
            queriesByStore["https://shop-b.example"]!.push(q);
            // Primary query returns 0 -> triggers broader fallback query
            if (q.toLowerCase().includes("rolltop 2.0")) {
              return {
                store_origin: "https://shop-b.example",
                currency: "EUR",
                products: [],
                notices: []
              };
            }
            return {
              store_origin: "https://shop-b.example",
              currency: "EUR",
              products: [
                makeProductSummary({
                  id: "woo-10",
                  handle: "city-backpack-black",
                  title: "Urban Rolltop Backpack Black",
                  vendor: "UrbanGear",
                  product_type: "Backpack",
                  available: true,
                  price: money(89),
                  price_min: money(89),
                  price_max: money(89),
                  url: "https://shop-b.example/product/city-backpack-black"
                })
              ],
              notices: []
            };
          }
        }
      }
    });

    const attribution = loadAttributionConfig({
      AFFILIATE_RULES_JSON: JSON.stringify([
        { domain: "shop-a.example", ref: "shopcart_partner", network: "direct_partner" }
      ])
    });

    const { client, close } = await connectClient({
      registry: new AdapterRegistry([shopifyAdapter, wooAdapter]),
      attribution
    });

    try {
      const res = await client.callTool({
        name: "match_visual_product",
        arguments: {
          product_type: "rolltop backpack",
          brand: "GOT BAG",
          model_or_text: "Rolltop 2.0",
          color: "matte black",
          material: "ocean plastic",
          style_keywords: ["rolltop", "waterproof"],
          target_stores: [
            "shop-a.example",
            "https://shop-a.example/collections/all", // duplicate origin -> deduplicated
            "shop-b.example",
            "broken-shop.example"
          ],
          search_affiliate_deals: false
        }
      });

      expect(res.isError).toBe(false);
      const textBlock = (res.content as Array<{ type: string; text?: string }>)[0]!;
      const payload = JSON.parse(textBlock.text!);

      expect(payload.source_notice).toContain("Untrusted merchant catalog data");
      expect(payload.affiliate_disclosure).toBe(true);
      expect(payload.disclosure_note).toContain("Affiliate disclosure");

      // shop-a queried once (origin deduplicated), shop-b ran primary + fallback
      expect(queriesByStore["https://shop-a.example"]).toHaveLength(1);
      expect(queriesByStore["https://shop-b.example"]).toHaveLength(2);

      // Deduplicated 2 unique matches, top match is exact GOT BAG Rolltop 2.0
      expect(payload.total_returned).toBe(2);
      expect(payload.matches[0].rank).toBe(1);
      expect(payload.matches[0].confidence).toBe("high");
      expect(payload.matches[0].product.id).toBe("p-exact");
      expect(payload.matches[0].product.url).toContain("ref=shopcart_partner");
      expect(payload.matches[0].affiliate_disclosure).toBe(true);

      expect(payload.matches[1].rank).toBe(2);
      expect(payload.matches[1].store_origin).toBe("https://shop-b.example");
      expect(payload.matches[1].platform).toBe("woocommerce");

      // Broken store isolated and sanitized (no internal token/path leak)
      expect(payload.store_errors).toHaveLength(1);
      expect(payload.store_errors[0].store_origin).toBe("https://broken-shop.example");
      expect(payload.store_errors[0].message).not.toContain("secret_token");
      expect(payload.store_errors[0].message).not.toContain("/internal/path");

      // < 3 matches -> provides crisp suggested_web_queries
      expect(payload.suggested_web_queries.length).toBeGreaterThanOrEqual(2);
      expect(payload.suggested_web_queries.length).toBeLessThanOrEqual(3);
    } finally {
      await close();
    }
  });

  it("matches exact EAN via configured Awin affiliate feed and returns suggested_web_queries when target_stores omitted", async () => {
    const affiliateFeed = makeMockAffiliateFeed([
      {
        id: "awin-1",
        merchant_product_id: "SONY-XM5-BLK",
        title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black",
        merchant_name: "Cyberport",
        merchant_id: "1234",
        brand: "Sony",
        category: "Headphones",
        description_text: "Over-ear ANC headphones matte black",
        ean: "4548736132610",
        gtin: "4548736132610",
        mpn: "WH1000XM5B",
        available: true,
        stock_quantity: 12,
        price: money(299),
        compare_at_price: money(399),
        url: "https://www.awin1.com/cread.php?awinmid=1234&awinaffid=999&ued=https%3A%2F%2Fcyberport.de%2Fxm5",
        product_url: "https://cyberport.de/xm5",
        merchant_url: "https://cyberport.de",
        image_url: "https://cdn.cyberport.de/xm5.jpg",
        affiliate_network: "awin",
        affiliate_disclosure: true
      }
    ]);

    const { client, close } = await connectClient({
      registry: new AdapterRegistry([]),
      affiliateFeed
    });

    try {
      const res = await client.callTool({
        name: "match_visual_product",
        arguments: {
          product_type: "over-ear headphones",
          brand: "Sony",
          model_or_text: "WH-1000XM5",
          ean: "4548-7361-32610",
          color: "black"
        }
      });

      expect(res.isError).toBe(false);
      const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);

      expect(payload.affiliate_disclosure).toBe(true);
      expect(payload.disclosure_note).toContain("Affiliate disclosure");
      expect(payload.total_returned).toBe(1);
      expect(payload.matches[0].confidence).toBe("high");
      expect(payload.matches[0].match_reasons).toContain("exact_ean_match");
      expect(payload.matches[0].product.ean).toBe("4548736132610");
      expect(payload.matches[0].product.discount_percent).toBe(25);
      expect(payload.suggested_web_queries.length).toBeGreaterThanOrEqual(2);
      expect(payload.suggested_web_queries[0]).toContain("4548736132610");
    } finally {
      await close();
    }
  });

  it("rejects SSRF-blocked target_stores cleanly with url_blocked before querying any adapter", async () => {
    let adapterCalls = 0;
    const spyAdapter = makeMockStoreAdapter({
      platform: "shopify",
      origins: {
        "https://good-shop.example": {
          search: () => {
            adapterCalls++;
            return {
              store_origin: "https://good-shop.example",
              currency: "EUR",
              products: [],
              notices: []
            };
          }
        }
      }
    });

    const { client, close } = await connectClient({
      registry: new AdapterRegistry([spyAdapter])
    });

    try {
      for (const badTarget of [
        "http://127.0.0.1",
        "https://169.254.169.254/latest/meta-data",
        "localhost",
        "metadata.google.internal"
      ]) {
        const res = await client.callTool({
          name: "match_visual_product",
          arguments: {
            product_type: "backpack",
            target_stores: ["good-shop.example", badTarget],
            search_affiliate_deals: false
          }
        });
        expect(res.isError).toBe(true);
        const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
        expect(payload.error).toBe("url_blocked");
      }
      expect(adapterCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("get_product performs zero image fetches by default, returns MCP image block when include_thumbnail=true, and degrades gracefully on SVG/oversized images", async () => {
    const validPng = makePngBytes(128);
    let thumbCalls = 0;

    const thumbResponses: Record<string, SafeFetchResponse> = {
      "https://cdn.shop.example/good.png": {
        status: 200,
        url: "https://cdn.shop.example/good.png",
        contentType: "image/png",
        headers: { "content-type": "image/png" },
        bodyBuffer: validPng,
        bodyText: ""
      },
      "https://cdn.shop.example/vector.svg": {
        status: 200,
        url: "https://cdn.shop.example/vector.svg",
        contentType: "image/svg+xml",
        headers: { "content-type": "image/svg+xml" },
        bodyBuffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        bodyText: '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
      },
      "https://cdn.shop.example/huge.png": {
        status: 200,
        url: "https://cdn.shop.example/huge.png",
        contentType: "image/png",
        headers: { "content-type": "image/png" },
        bodyBuffer: makePngBytes(MAX_THUMBNAIL_BYTES + 100),
        bodyText: ""
      }
    };

    const thumbnailFetcher: ThumbnailFetcherFn = async (url) => {
      thumbCalls++;
      const found = thumbResponses[url];
      if (!found) {
        throw new Error(`Unexpected thumbnail URL: ${url}`);
      }
      return found;
    };

    const makeDetail = (handle: string, images: string[]): ProductDetail => ({
      id: `id-${handle}`,
      handle,
      title: `Demo ${handle}`,
      vendor: "DemoBrand",
      product_type: "Bag",
      description_text: "Verified product",
      available: true,
      url: `https://shop.example/products/${handle}`,
      options: [{ name: "Color", values: ["Black"] }],
      images,
      variants: [
        {
          id: "44001",
          title: "Black",
          sku: "SKU-1",
          available: true,
          price: money(99),
          compare_at_price: null,
          option_values: ["Black"]
        }
      ]
    });

    const adapter = makeMockStoreAdapter({
      platform: "shopify",
      origins: {
        "https://shop.example": {
          product: (handle) => {
            const imageMap: Record<string, string[]> = {
              "good-bag": ["https://cdn.shop.example/good.png"],
              "svg-bag": ["https://cdn.shop.example/vector.svg"],
              "huge-bag": ["https://cdn.shop.example/huge.png"],
              "no-img-bag": []
            };
            return {
              store_origin: "https://shop.example",
              currency: "EUR",
              product: makeDetail(handle, imageMap[handle] ?? [])
            };
          }
        }
      }
    });

    const { client, close } = await connectClient({
      registry: new AdapterRegistry([adapter]),
      thumbnailFetcher
    });

    try {
      // 1. Default (include_thumbnail omitted) -> ZERO fetches, backwards-compatible response
      const defaultRes = await client.callTool({
        name: "get_product",
        arguments: { store_url: "shop.example", handle_or_url: "good-bag" }
      });
      expect(defaultRes.isError).toBe(false);
      expect(thumbCalls).toBe(0);
      const defaultContent = defaultRes.content as Array<{ type: string; text?: string }>;
      expect(defaultContent).toHaveLength(1);
      expect(defaultContent[0]!.type).toBe("text");
      const defaultJson = JSON.parse(defaultContent[0]!.text!);
      expect(defaultJson.thumbnail_status).toBeUndefined();

      // 2. include_thumbnail: false -> ZERO fetches
      const falseRes = await client.callTool({
        name: "get_product",
        arguments: {
          store_url: "shop.example",
          handle_or_url: "good-bag",
          include_thumbnail: false
        }
      });
      expect(falseRes.isError).toBe(false);
      expect(thumbCalls).toBe(0);

      // 3. include_thumbnail: true + valid PNG -> text + image MCP block
      const withThumbRes = await client.callTool({
        name: "get_product",
        arguments: {
          store_url: "shop.example",
          handle_or_url: "good-bag",
          include_thumbnail: true
        }
      });
      expect(withThumbRes.isError).toBe(false);
      expect(thumbCalls).toBe(1);
      const thumbContent = withThumbRes.content as Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
        annotations?: { audience?: string[]; priority?: number };
      }>;
      expect(thumbContent).toHaveLength(2);
      expect(thumbContent[0]!.type).toBe("text");
      const thumbJson = JSON.parse(thumbContent[0]!.text!);
      expect(thumbJson.thumbnail_status).toEqual({
        included: true,
        mime_type: "image/png",
        bytes: 128
      });
      expect(thumbContent[1]!.type).toBe("image");
      expect(thumbContent[1]!.mimeType).toBe("image/png");
      expect(thumbContent[1]!.data).toBe(validPng.toString("base64"));
      expect(thumbContent[1]!.annotations).toEqual({
        audience: ["assistant", "user"],
        priority: 0.7
      });

      // 4. SVG image -> graceful degradation (get_product still succeeds!)
      const svgRes = await client.callTool({
        name: "get_product",
        arguments: {
          store_url: "shop.example",
          handle_or_url: "svg-bag",
          include_thumbnail: true
        }
      });
      expect(svgRes.isError).toBe(false);
      const svgContent = svgRes.content as Array<{ type: string; text?: string }>;
      expect(svgContent).toHaveLength(1);
      const svgJson = JSON.parse(svgContent[0]!.text!);
      expect(svgJson.product.handle).toBe("svg-bag");
      expect(svgJson.thumbnail_status).toEqual({
        included: false,
        reason: "unsupported_content_type"
      });

      // 5. Oversized > 512 KB image -> graceful degradation
      const hugeRes = await client.callTool({
        name: "get_product",
        arguments: {
          store_url: "shop.example",
          handle_or_url: "huge-bag",
          include_thumbnail: true
        }
      });
      expect(hugeRes.isError).toBe(false);
      const hugeContent = hugeRes.content as Array<{ type: string; text?: string }>;
      expect(hugeContent).toHaveLength(1);
      const hugeJson = JSON.parse(hugeContent[0]!.text!);
      expect(hugeJson.thumbnail_status).toEqual({
        included: false,
        reason: "image_too_large"
      });

      // 6. Product without images -> graceful degradation without calling fetcher
      const prevThumbCalls = thumbCalls;
      const noImgRes = await client.callTool({
        name: "get_product",
        arguments: {
          store_url: "shop.example",
          handle_or_url: "no-img-bag",
          include_thumbnail: true
        }
      });
      expect(noImgRes.isError).toBe(false);
      expect(thumbCalls).toBe(prevThumbCalls);
      const noImgJson = JSON.parse((noImgRes.content as Array<{ text: string }>)[0]!.text);
      expect(noImgJson.thumbnail_status).toEqual({
        included: false,
        reason: "no_image"
      });
    } finally {
      await close();
    }
  });

  it("emits 100% Gemini-compatible schemas (zero banned keywords) for match_visual_product and get_product, and documents visual flow in SERVER_INSTRUCTIONS", async () => {
    const { client, close } = await connectClient({});
    try {
      const { tools } = await client.listTools();
      const visualTool = tools.find((t) => t.name === "match_visual_product");
      const productTool = tools.find((t) => t.name === "get_product");

      expect(visualTool).toBeDefined();
      expect(productTool).toBeDefined();

      for (const tool of [visualTool!, productTool!]) {
        expect(findGeminiSchemaViolations(tool.inputSchema, `${tool.name}.inputSchema`)).toEqual([]);
        const serialized = JSON.stringify(tool.inputSchema);
        for (const banned of GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS) {
          expect(serialized, `Banned keyword '${banned}' found in ${tool.name}`).not.toContain(
            `"${banned}"`
          );
        }
      }

      const visualProps = visualTool!.inputSchema.properties as Record<string, unknown>;
      for (const key of [
        "product_type",
        "brand",
        "model_or_text",
        "ean",
        "color",
        "material",
        "style_keywords",
        "target_stores",
        "search_affiliate_deals",
        "available_only",
        "min_price",
        "max_price",
        "limit"
      ]) {
        expect(visualProps).toHaveProperty(key);
      }

      const productProps = productTool!.inputSchema.properties as Record<string, unknown>;
      expect(productProps).toHaveProperty("include_thumbnail");

      expect(SERVER_INSTRUCTIONS).toContain("match_visual_product");
      expect(SERVER_INSTRUCTIONS).toContain("include_thumbnail=true");
    } finally {
      await close();
    }
  });
});
