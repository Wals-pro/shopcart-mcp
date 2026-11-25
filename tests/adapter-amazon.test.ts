import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { AmazonAdapter } from "../src/adapters/amazon/adapter.js";
import {
  AMAZON_DOMAINS,
  extractAsin,
  resolveAmazonMarketplace,
  resolveAssociateTag,
  tryExtractAsin
} from "../src/adapters/amazon/marketplaces.js";
import { signPaApiRequest } from "../src/adapters/amazon/paapi.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { ShopifyAdapter } from "../src/adapters/shopify/adapter.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import { createShopcartMcpServer } from "../src/mcp/create-server.js";
import type { SafeFetchOptions, SafeFetchResponse } from "../src/security/ssrf.js";

function makeJsonResponse(url: string, body: unknown, status = 200): SafeFetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    url,
    contentType: "application/json",
    headers: { "content-type": "application/json" },
    bodyBuffer: Buffer.from(text),
    bodyText: text
  };
}

describe("AmazonAdapter — Marketplaces & ASIN extraction", () => {
  it("detects all supported Amazon marketplaces synchronously without network requests and canonicalizes amazon.at -> www.amazon.de", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("detect() must not perform any network request");
    });
    const adapter = new AmazonAdapter({ env: {}, fetcher });

    const cases: Array<{
      input: string;
      expectedOrigin: string;
      expectedCurrency: string;
      expectedCountry: string;
    }> = [
      { input: "https://amazon.de", expectedOrigin: "https://www.amazon.de", expectedCurrency: "EUR", expectedCountry: "DE" },
      { input: "https://www.amazon.de", expectedOrigin: "https://www.amazon.de", expectedCurrency: "EUR", expectedCountry: "DE" },
      { input: "https://amazon.at", expectedOrigin: "https://www.amazon.de", expectedCurrency: "EUR", expectedCountry: "AT" },
      { input: "https://www.amazon.at", expectedOrigin: "https://www.amazon.de", expectedCurrency: "EUR", expectedCountry: "AT" },
      { input: "https://amazon.com", expectedOrigin: "https://www.amazon.com", expectedCurrency: "USD", expectedCountry: "US" },
      { input: "https://amazon.co.uk", expectedOrigin: "https://www.amazon.co.uk", expectedCurrency: "GBP", expectedCountry: "GB" },
      { input: "https://amazon.fr", expectedOrigin: "https://www.amazon.fr", expectedCurrency: "EUR", expectedCountry: "FR" },
      { input: "https://amazon.it", expectedOrigin: "https://www.amazon.it", expectedCurrency: "EUR", expectedCountry: "IT" },
      { input: "https://amazon.es", expectedOrigin: "https://www.amazon.es", expectedCurrency: "EUR", expectedCountry: "ES" },
      { input: "https://amazon.nl", expectedOrigin: "https://www.amazon.nl", expectedCurrency: "EUR", expectedCountry: "NL" },
      { input: "https://amazon.ca", expectedOrigin: "https://www.amazon.ca", expectedCurrency: "CAD", expectedCountry: "CA" },
      { input: "https://amazon.co.jp", expectedOrigin: "https://www.amazon.co.jp", expectedCurrency: "JPY", expectedCountry: "JP" }
    ];

    for (const c of cases) {
      const store = await adapter.detect(c.input);
      expect(store).not.toBeNull();
      expect(store!.platform).toBe("amazon");
      expect(store!.origin).toBe(c.expectedOrigin);
      expect(store!.currency).toBe(c.expectedCurrency);
      expect(store!.country).toBe(c.expectedCountry);
      expect(store!.capabilities.asinCartPermalink).toBe(true);
      expect(store!.capabilities.liveSearch).toBe(false);
      expect(store!.capabilities.searchProvider).toBe("none");
      expect(store!.capabilities.affiliateTagConfigured).toBe(false);
    }

    // Non-Amazon domains return null
    expect(await adapter.detect("https://snocks.com")).toBeNull();
    expect(await adapter.detect("https://notamazon.de")).toBeNull();
    expect(await adapter.detect("https://amazon.de.evil.com")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();

    // Exported AMAZON_DOMAINS contains expected keys
    expect(Object.keys(AMAZON_DOMAINS)).toContain("amazon.de");
    expect(Object.keys(AMAZON_DOMAINS)).toContain("amazon.at");
    expect(Object.keys(AMAZON_DOMAINS)).toContain("amazon.co.jp");
  });

  it("extracts and validates 10-char ASINs from direct ASIN and 5 URL formats while rejecting invalid inputs", () => {
    // 1. Direct ASIN (case-insensitive -> uppercased)
    expect(extractAsin("B08N5WRWNW")).toBe("B08N5WRWNW");
    expect(extractAsin("b08n5wrwnw")).toBe("B08N5WRWNW");

    // 2. /dp/<ASIN> (with slug & query params)
    expect(
      extractAsin("https://www.amazon.de/Echo-Dot-4th-Gen/dp/B08N5WRWNW/ref=sr_1_1?keywords=echo")
    ).toBe("B08N5WRWNW");
    expect(extractAsin("https://amazon.com/dp/B09G9FPHY6")).toBe("B09G9FPHY6");

    // 3. /gp/product/<ASIN>
    expect(extractAsin("https://www.amazon.de/gp/product/B07FZ8S74R?th=1&psc=1")).toBe("B07FZ8S74R");

    // 4. /gp/aw/d/<ASIN> (mobile URL)
    expect(extractAsin("https://www.amazon.co.uk/gp/aw/d/B08N5WRWNW/")).toBe("B08N5WRWNW");

    // 5. /exec/obidos/ASIN/<ASIN>
    expect(extractAsin("https://www.amazon.com/exec/obidos/ASIN/0132350882/ref=nosim")).toBe("0132350882");

    // Relative path
    expect(extractAsin("/dp/B08N5WRWNW")).toBe("B08N5WRWNW");

    // Invalid inputs MUST be rejected
    const invalidInputs = [
      "",
      "B08N5WRWN", // 9 chars
      "B08N5WRWNWX", // 11 chars
      "B08N5-RWNW", // hyphen
      "https://www.amazon.de/s?k=headphones", // search URL without ASIN
      "https://evil.example/dp/B08N5WRWNW", // non-Amazon host
      "javascript:alert(1)"
    ];
    for (const bad of invalidInputs) {
      expect(tryExtractAsin(bad)).toBeNull();
      expect(() => extractAsin(bad)).toThrow(/Invalid Amazon ASIN/);
    }
  });
});

describe("AmazonAdapter — Stage 1 Cart Permalink & AssociateTag", () => {
  it("builds official multi-item Add-to-Cart permalink without AssociateTag and canonicalizes amazon.at -> www.amazon.de", async () => {
    const adapter = new AmazonAdapter({ env: {} });
    const result = await adapter.buildCartLink(
      "https://amazon.at",
      [
        { variantId: "B08N5WRWNW", quantity: 2 },
        { variantId: "https://www.amazon.de/Some-Product/dp/B09G9FPHY6/ref=sr_1_2", quantity: 1 }
      ],
      { mode: "cart" }
    );

    expect(result.store_origin).toBe("https://www.amazon.de");
    expect(result.mode).toBe("cart");
    expect(result.affiliate_disclosure).toBeUndefined();
    expect(result.cart_url).toBe(
      "https://www.amazon.de/gp/aws/cart/add.html?ASIN.1=B08N5WRWNW&Quantity.1=2&ASIN.2=B09G9FPHY6&Quantity.2=1"
    );
    expect(result.items).toEqual([
      { variant_id: "B08N5WRWNW", quantity: 2 },
      { variant_id: "B09G9FPHY6", quantity: 1 }
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.next_step).toContain("Add to Cart");
  });

  it("attaches AssociateTag (marketplace-specific override + global fallback) and sets affiliate_disclosure: true", async () => {
    const env: NodeJS.ProcessEnv = {
      AMAZON_ASSOCIATE_TAG: "walspro-global-21",
      AMAZON_ASSOCIATE_TAG_DE: "walspro-de-21",
      AMAZON_ASSOCIATE_TAG_US: "walspro-us-20",
      AMAZON_ASSOCIATE_TAG_UK: "walspro-uk-21"
    };
    const adapter = new AmazonAdapter({ env });

    const deCart = await adapter.buildCartLink(
      "https://amazon.de",
      [{ variantId: "B08N5WRWNW", quantity: 1 }],
      { mode: "cart" }
    );
    expect(deCart.cart_url).toBe(
      "https://www.amazon.de/gp/aws/cart/add.html?ASIN.1=B08N5WRWNW&Quantity.1=1&AssociateTag=walspro-de-21"
    );
    expect(deCart.affiliate_disclosure).toBe(true);

    // amazon.at falls back to AMAZON_ASSOCIATE_TAG_DE before global
    expect(resolveAssociateTag(resolveAmazonMarketplace("amazon.at")!, env)).toBe("walspro-de-21");

    const usCart = await adapter.buildCartLink(
      "https://amazon.com",
      [{ variantId: "B08N5WRWNW", quantity: 3 }],
      { mode: "checkout", discountCode: "SAVE10" }
    );
    expect(usCart.cart_url).toBe(
      "https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B08N5WRWNW&Quantity.1=3&AssociateTag=walspro-us-20"
    );
    expect(usCart.affiliate_disclosure).toBe(true);
    expect(usCart.mode).toBe("cart");
    expect(usCart.warnings.some((w) => w.includes("/gp/aws/cart/add.html"))).toBe(true);
    expect(usCart.warnings.some((w) => w.includes("SAVE10"))).toBe(true);

    const ukCart = await adapter.buildCartLink(
      "https://amazon.co.uk",
      [{ variantId: "B08N5WRWNW", quantity: 1 }],
      { mode: "cart" }
    );
    expect(ukCart.cart_url).toContain("AssociateTag=walspro-uk-21");

    // FR has no _FR override -> falls back to global AMAZON_ASSOCIATE_TAG
    const frCart = await adapter.buildCartLink(
      "https://amazon.fr",
      [{ variantId: "B08N5WRWNW", quantity: 1 }],
      { mode: "cart" }
    );
    expect(frCart.cart_url).toContain("AssociateTag=walspro-global-21");
    expect(frCart.affiliate_disclosure).toBe(true);
  });

  it("rejects invalid ASINs, invalid quantities, and item counts outside 1..20", async () => {
    const adapter = new AmazonAdapter({ env: {} });

    await expect(
      adapter.buildCartLink("https://amazon.de", [{ variantId: "NOT_AN_ASIN", quantity: 1 }], { mode: "cart" })
    ).rejects.toThrow(/Invalid Amazon ASIN/);

    await expect(
      adapter.buildCartLink("https://amazon.de", [{ variantId: "B08N5WRWNW", quantity: 0 }], { mode: "cart" })
    ).rejects.toThrow(/Invalid quantity/);

    await expect(
      adapter.buildCartLink("https://amazon.de", [{ variantId: "B08N5WRWNW", quantity: 100 }], { mode: "cart" })
    ).rejects.toThrow(/Invalid quantity/);

    await expect(adapter.buildCartLink("https://amazon.de", [], { mode: "cart" })).rejects.toThrow(
      /between 1 and 20/
    );

    const tooMany = Array.from({ length: 21 }, (_, idx) => ({
      variantId: `B08N5WRW${String(idx).padStart(2, "0")}`,
      quantity: 1
    }));
    await expect(adapter.buildCartLink("https://amazon.de", tooMany, { mode: "cart" })).rejects.toThrow(
      /between 1 and 20/
    );
  });
});

describe("AmazonAdapter — Graceful Degradation without API keys", () => {
  it("returns structured agent_guidance from searchProducts and canonical product+ASIN from getProduct without throwing", async () => {
    const adapter = new AmazonAdapter({ env: {} });

    const search = await adapter.searchProducts("https://amazon.de", {
      query: "USB-C Ladegerät",
      limit: 5
    });
    expect(search.store_origin).toBe("https://www.amazon.de");
    expect(search.currency).toBe("EUR");
    expect(search.products).toEqual([]);
    expect(search.agent_guidance).toBeDefined();
    expect(search.agent_guidance).toContain("PA-API or Keepa");
    expect(search.agent_guidance).toContain("https://www.amazon.de");
    expect(search.agent_guidance).toContain("create_cart_link");

    const detail = await adapter.getProduct(
      "https://amazon.de",
      "https://www.amazon.de/Anker-Charger/dp/B08N5WRWNW?ref=sr_1_1"
    );
    expect(detail.store_origin).toBe("https://www.amazon.de");
    expect(detail.currency).toBe("EUR");
    expect(detail.product.id).toBe("B08N5WRWNW");
    expect(detail.product.url).toBe("https://www.amazon.de/dp/B08N5WRWNW");
    expect(detail.product.variants).toHaveLength(1);
    expect(detail.product.variants[0]!.id).toBe("B08N5WRWNW");
  });
});

describe("AmazonAdapter — Stage 2 PA-API 5.0 (SigV4) & Keepa Fixtures", () => {
  it("produces a cryptographically valid AWS SigV4 signature and parses PA-API SearchItems / GetItems responses", async () => {
    const marketplace = resolveAmazonMarketplace("amazon.de")!;
    const fixedNow = new Date("2026-11-25T12:34:56.000Z");
    const credentials = {
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      partnerTag: "walspro-de-21"
    };
    const payload = {
      Keywords: "kopfhoerer",
      PartnerTag: credentials.partnerTag,
      PartnerType: "Associates",
      Marketplace: "www.amazon.de",
      ItemCount: 5
    };

    const signed = signPaApiRequest({
      marketplace,
      operation: "SearchItems",
      payload,
      credentials,
      now: fixedNow
    });

    expect(signed.url).toBe("https://webservices.amazon.de/paapi5/searchitems");
    expect(signed.headers["X-Amz-Date"]).toBe("20261125T123456Z");
    expect(signed.headers["X-Amz-Target"]).toBe(
      "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems"
    );
    expect(signed.headers["Content-Encoding"]).toBe("amz-1.0");
    expect(signed.headers.Authorization).toContain(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261125/eu-west-1/ProductAdvertisingAPI/aws4_request"
    );
    expect(signed.headers.Authorization).toContain(
      "SignedHeaders=content-encoding;content-type;host;x-amz-date;x-amz-target"
    );

    // Independent SigV4 verification
    const hmac = (key: string | Buffer, data: string) =>
      crypto.createHmac("sha256", key).update(data, "utf8").digest();
    const kDate = hmac(`AWS4${credentials.secretKey}`, "20261125");
    const kRegion = hmac(kDate, "eu-west-1");
    const kService = hmac(kRegion, "ProductAdvertisingAPI");
    const kSigning = hmac(kService, "aws4_request");
    const expectedSig = crypto
      .createHmac("sha256", kSigning)
      .update(signed.stringToSign, "utf8")
      .digest("hex");
    expect(signed.signature).toBe(expectedSig);
    expect(signed.headers.Authorization).toContain(`Signature=${expectedSig}`);

    // End-to-end PA-API fixture test via AmazonAdapter
    const seenRequests: Array<{ url: string; options?: SafeFetchOptions }> = [];
    const fetcher = async (url: string, options?: SafeFetchOptions): Promise<SafeFetchResponse> => {
      seenRequests.push({ url, options });
      if (url.endsWith("/paapi5/searchitems")) {
        return makeJsonResponse(url, {
          SearchResult: {
            Items: [
              {
                ASIN: "B08N5WRWNW",
                Images: {
                  Primary: { Large: { URL: "https://m.media-amazon.com/images/I/71echo.jpg" } }
                },
                ItemInfo: {
                  Title: { DisplayValue: "Echo Dot Smart Speaker" },
                  ByLineInfo: { Brand: { DisplayValue: "Amazon" } },
                  Classifications: { ProductGroup: { DisplayValue: "Electronics" } }
                },
                Offers: {
                  Listings: [
                    {
                      Price: { Amount: 39.99, Currency: "EUR" },
                      SavingBasis: { Amount: 59.99, Currency: "EUR" },
                      Availability: { Type: "Now" }
                    }
                  ]
                }
              },
              {
                ASIN: "B09G9FPHY6",
                ItemInfo: {
                  Title: { DisplayValue: "Expensive Studio Monitor" }
                },
                Offers: {
                  Listings: [
                    {
                      Price: { Amount: 249.0, Currency: "EUR" },
                      Availability: { Type: "OutOfStock" }
                    }
                  ]
                }
              }
            ]
          }
        });
      }
      if (url.endsWith("/paapi5/getitems")) {
        return makeJsonResponse(url, {
          ItemsResult: {
            Items: [
              {
                ASIN: "B08N5WRWNW",
                Images: {
                  Primary: { Large: { URL: "https://m.media-amazon.com/images/I/71echo.jpg" } },
                  Variants: [{ Large: { URL: "https://evil.example/tracker.jpg" } }]
                },
                ItemInfo: {
                  Title: { DisplayValue: "Echo Dot Smart Speaker" },
                  ByLineInfo: { Brand: { DisplayValue: "Amazon" } },
                  Features: { DisplayValues: ["Compact design", "Alexa built-in"] }
                },
                Offers: {
                  Listings: [
                    {
                      Price: { Amount: 39.99, Currency: "EUR" },
                      Availability: { Type: "Now" }
                    }
                  ]
                }
              }
            ]
          }
        });
      }
      return makeJsonResponse(url, {}, 404);
    };

    const adapter = new AmazonAdapter({
      env: {
        AMAZON_PAAPI_ACCESS_KEY: credentials.accessKey,
        AMAZON_PAAPI_SECRET_KEY: credentials.secretKey,
        AMAZON_ASSOCIATE_TAG_DE: credentials.partnerTag
      },
      fetcher,
      now: () => fixedNow
    });

    const store = await adapter.detect("https://amazon.de");
    expect(store!.capabilities.liveSearch).toBe(true);
    expect(store!.capabilities.searchProvider).toBe("paapi");

    const search = await adapter.searchProducts("https://amazon.de", {
      query: "smart speaker",
      limit: 5,
      availableOnly: true,
      maxPrice: 100
    });
    expect(search.products).toHaveLength(1);
    expect(search.products[0]!.id).toBe("B08N5WRWNW");
    expect(search.products[0]!.price).toEqual({
      amount: 39.99,
      formatted: "39.99 EUR",
      currency: "EUR"
    });
    expect(search.products[0]!.compare_at_price).toEqual({
      amount: 59.99,
      formatted: "59.99 EUR",
      currency: "EUR"
    });
    expect(seenRequests[0]!.options?.headers?.Authorization).toContain("AWS4-HMAC-SHA256");

    const detail = await adapter.getProduct("https://amazon.de", "B08N5WRWNW");
    expect(detail.product.title).toBe("Echo Dot Smart Speaker");
    expect(detail.product.description_text).toContain("Alexa built-in");
    // Foreign image host must be stripped by Amazon image sanitizer
    expect(detail.product.images).toEqual(["https://m.media-amazon.com/images/I/71echo.jpg"]);
  });

  it("queries Keepa REST API (/search and /product) when KEEPA_API_KEY is set and handles amazon.nl gracefully", async () => {
    const requestedUrls: string[] = [];
    const fetcher = async (url: string): Promise<SafeFetchResponse> => {
      requestedUrls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === "/search") {
        const current = new Array<number>(20).fill(-1);
        current[0] = 2999; // 29.99 EUR
        current[4] = 3999; // 39.99 EUR list price
        current[16] = 46; // 4.6 stars
        current[17] = 1234; // 1234 reviews
        return makeJsonResponse(url, {
          products: [
            {
              asin: "B08N5WRWNW",
              title: "Anker Nano USB-C Ladegerät 30W",
              brand: "Anker",
              productGroup: "CE",
              imagesCSV: "61anker1.jpg,61anker2.jpg",
              stats: { current, buyBoxPrice: 2999 }
            }
          ]
        });
      }
      if (parsed.pathname === "/product") {
        const current = new Array<number>(20).fill(-1);
        current[0] = 2999;
        current[4] = 3999;
        current[16] = 46;
        current[17] = 1234;
        return makeJsonResponse(url, {
          products: [
            {
              asin: "B08N5WRWNW",
              title: "Anker Nano USB-C Ladegerät 30W",
              brand: "Anker",
              productGroup: "CE",
              description: "Compact GaN fast charger",
              features: ["30W Power Delivery", "ActiveShield 2.0"],
              imagesCSV: "61anker1.jpg",
              stats: { current, buyBoxPrice: 2999 }
            }
          ]
        });
      }
      return makeJsonResponse(url, {}, 404);
    };

    const adapter = new AmazonAdapter({
      env: { KEEPA_API_KEY: "test_keepa_key_123" },
      fetcher
    });

    const deStore = await adapter.detect("https://amazon.de");
    expect(deStore!.capabilities.liveSearch).toBe(true);
    expect(deStore!.capabilities.searchProvider).toBe("keepa");

    const search = await adapter.searchProducts("https://amazon.de", {
      query: "Anker 30W",
      limit: 5
    });
    expect(requestedUrls[0]).toContain("https://api.keepa.com/search?");
    expect(requestedUrls[0]).toContain("domain=3");
    expect(requestedUrls[0]).toContain("type=product");
    expect(search.products).toHaveLength(1);
    expect(search.products[0]!.price).toEqual({
      amount: 29.99,
      formatted: "29.99 EUR",
      currency: "EUR"
    });
    expect(search.products[0]!.compare_at_price).toEqual({
      amount: 39.99,
      formatted: "39.99 EUR",
      currency: "EUR"
    });
    expect(search.products[0]!.image_url).toBe("https://m.media-amazon.com/images/I/61anker1.jpg");

    const detail = await adapter.getProduct("https://amazon.de", "B08N5WRWNW");
    expect(requestedUrls[1]).toContain("https://api.keepa.com/product?");
    expect(requestedUrls[1]).toContain("asin=B08N5WRWNW");
    expect(detail.product.description_text).toContain("Rating: 4.6/5 (1234 reviews)");
    expect(detail.product.description_text).toContain("30W Power Delivery");

    // amazon.nl is not supported by Keepa -> degrades gracefully instead of calling Keepa with an invalid domain
    const nlStore = await adapter.detect("https://amazon.nl");
    expect(nlStore!.capabilities.liveSearch).toBe(false);
    expect(nlStore!.capabilities.searchProvider).toBe("none");
    const nlSearch = await adapter.searchProducts("https://amazon.nl", { query: "charger", limit: 5 });
    expect(nlSearch.products).toEqual([]);
    expect(nlSearch.agent_guidance).toContain("https://www.amazon.nl");
  });
});

describe("AdapterRegistry & MCP Tools integration (Amazon + Shopify isolation)", () => {
  it("routes Amazon before Shopify without triggering any Shopify network probe, while keeping Shopify as default fallback", async () => {
    const shopifyFetcher = vi.fn(async () => {
      throw new Error("Shopify network probe must NOT run for Amazon domains");
    });
    const shopifyAdapter = new ShopifyAdapter(new ShopifyClient(shopifyFetcher));
    const amazonAdapter = new AmazonAdapter({ env: { AMAZON_ASSOCIATE_TAG_DE: "shopcart-21" } });
    const registry = new AdapterRegistry([amazonAdapter, shopifyAdapter]);

    expect(registry.listPlatforms()).toEqual(["amazon", "shopify"]);
    expect(registry.getDefault().platform).toBe("shopify");

    const resolved = await registry.resolve("https://amazon.de");
    expect(resolved.adapter.platform).toBe("amazon");
    expect(resolved.store?.origin).toBe("https://www.amazon.de");
    expect(shopifyFetcher).not.toHaveBeenCalled();

    // End-to-end MCP tool calls via InMemoryTransport
    const server = createShopcartMcpServer({ registry });
    const client = new Client({ name: "amazon-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      // 1. inspect_store on amazon.de
      const inspectRes = await client.callTool({
        name: "inspect_store",
        arguments: { store_url: "amazon.de" }
      });
      expect(inspectRes.isError).toBe(false);
      const inspectData = JSON.parse((inspectRes.content as Array<{ text: string }>)[0]!.text);
      expect(inspectData.store.platform).toBe("amazon");
      expect(inspectData.store.origin).toBe("https://www.amazon.de");
      expect(inspectData.store.capabilities.affiliateTagConfigured).toBe(true);

      // 2. search_products on amazon.de without live search keys -> structured agent_guidance
      const searchRes = await client.callTool({
        name: "search_products",
        arguments: { store_url: "amazon.de", query: "Powerbank" }
      });
      expect(searchRes.isError).toBe(false);
      const searchData = JSON.parse((searchRes.content as Array<{ text: string }>)[0]!.text);
      expect(searchData.products).toEqual([]);
      expect(searchData.agent_guidance).toContain("create_cart_link");

      // 3. create_cart_link on amazon.de with ASIN + Amazon product URL
      const cartRes = await client.callTool({
        name: "create_cart_link",
        arguments: {
          store_url: "amazon.at",
          items: [
            { variant_id: "B08N5WRWNW", quantity: 1 },
            { variant_id: "https://www.amazon.de/dp/B09G9FPHY6", quantity: 2 }
          ]
        }
      });
      expect(cartRes.isError).toBe(false);
      const cartData = JSON.parse((cartRes.content as Array<{ text: string }>)[0]!.text);
      expect(cartData.cart_url).toBe(
        "https://www.amazon.de/gp/aws/cart/add.html?ASIN.1=B08N5WRWNW&Quantity.1=1&ASIN.2=B09G9FPHY6&Quantity.2=2&AssociateTag=shopcart-21"
      );
      expect(cartData.affiliate_disclosure).toBe(true);

      // 3b. list_collections & get_store_policies return graceful notices on Amazon (no crash)
      const colRes = await client.callTool({
        name: "list_collections",
        arguments: { store_url: "amazon.de" }
      });
      expect(colRes.isError).toBe(false);
      const colData = JSON.parse((colRes.content as Array<{ text: string }>)[0]!.text);
      expect(colData.collections).toEqual([]);
      expect(colData.notices[0]).toContain("Shopify storefronts only");
      expect(colData.notices[0]).toContain("amazon");

      const polRes = await client.callTool({
        name: "get_store_policies",
        arguments: { store_url: "amazon.de" }
      });
      expect(polRes.isError).toBe(false);
      const polData = JSON.parse((polRes.content as Array<{ text: string }>)[0]!.text);
      expect(polData.shipping_policy_excerpt).toBeNull();
      expect(polData.notices[0]).toContain("Shopify storefronts only");
      expect(polData.notices[0]).toContain("amazon");

      // 4. Shopify still strictly rejects ASIN variant_id even though Zod allows ASINs for Amazon
      const shopifyOnlyRegistry = new AdapterRegistry([shopifyAdapter]);
      const shopifyServer = createShopcartMcpServer({ registry: shopifyOnlyRegistry });
      const shopifyClient = new Client({ name: "shopify-strict-test", version: "1.0.0" });
      const [c2, s2] = InMemoryTransport.createLinkedPair();
      await Promise.all([shopifyServer.connect(s2), shopifyClient.connect(c2)]);
      try {
        const badShopifyCart = await shopifyClient.callTool({
          name: "create_cart_link",
          arguments: {
            store_url: "snocks.com",
            items: [{ variant_id: "B08N5WRWNW", quantity: 1 }]
          }
        });
        expect(badShopifyCart.isError).toBe(true);
        const errPayload = JSON.parse((badShopifyCart.content as Array<{ text: string }>)[0]!.text);
        expect(errPayload.message).toContain("Invalid Shopify variant_id");
      } finally {
        await shopifyClient.close();
        await shopifyServer.close();
      }
    } finally {
      await client.close();
      await server.close();
    }

    expect(shopifyFetcher).not.toHaveBeenCalled();
  });
});
