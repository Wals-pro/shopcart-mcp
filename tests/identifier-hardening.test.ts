import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { parseProductFromHtml } from "../src/adapters/jsonld/parser.js";
import type { AdapterRegistry } from "../src/adapters/registry.js";
import { ShopifyAdapter } from "../src/adapters/shopify/adapter.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import { extractCollectionHandle, extractProductHandle } from "../src/adapters/shopify/normalize.js";
import type { StoreAdapter, StoreInfo } from "../src/adapters/types.js";
import { WooCommerceAdapter } from "../src/adapters/woocommerce/adapter.js";
import { createApp } from "../src/app.js";
import {
  CliUsageError,
  parseCartItemSpec,
  parseCliArgs,
  renderCliHelp,
  runCli,
  sanitizeCliOutput
} from "../src/cli/oneshot.js";
import { loadConfig } from "../src/config.js";
import {
  sanitizeGenericVariantId,
  sanitizeNumericVariantId,
  sanitizeSafeHandle
} from "../src/security/identifiers.js";
import type { SafeFetchResponse } from "../src/security/ssrf.js";
import { MemoryStore } from "../src/store/memory.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeJsonResp(url: string, data: unknown, status = 200): SafeFetchResponse {
  const bodyText = JSON.stringify(data);
  return {
    status,
    url,
    contentType: "application/json; charset=utf-8",
    headers: { "content-type": "application/json; charset=utf-8" },
    bodyBuffer: Buffer.from(bodyText, "utf8"),
    bodyText
  };
}

function makeCapture() {
  let buf = "";
  return {
    write(chunk: string) {
      buf += chunk;
    },
    text() {
      return buf;
    }
  };
}

describe("Strict identifier allowlists & adapter emission hardening", () => {
  it("allows legitimate handles and numeric/generic variant IDs while rejecting shell metacharacters", () => {
    for (const ok of ["business-socken-leichte-lange-socken", "pack_2.0", "t-shirt-xl", "tilde~slug"]) {
      expect(sanitizeSafeHandle(ok)).toBe(ok);
    }
    for (const bad of [
      "bad$(id)",
      "bad`id`",
      "bad;rm",
      "bad|cat",
      "bad&echo",
      "bad'quote",
      'bad"quote',
      "bad space",
      "../etc/passwd",
      "a/b",
      ""
    ]) {
      expect(sanitizeSafeHandle(bad), bad).toBeNull();
    }

    expect(sanitizeNumericVariantId("37548706496709")).toBe("37548706496709");
    expect(sanitizeNumericVariantId(123456)).toBe("123456");
    expect(sanitizeNumericVariantId("37548$(id)")).toBeNull();
    expect(sanitizeNumericVariantId("123:456")).toBeNull();

    expect(sanitizeGenericVariantId("37548706496709")).toBe("37548706496709");
    expect(sanitizeGenericVariantId("sku:SN-W_43.46")).toBe("sku:SN-W_43.46");
    expect(sanitizeGenericVariantId("B08N5WRWNW")).toBe("B08N5WRWNW");
    expect(sanitizeGenericVariantId("id$(whoami)")).toBeNull();
    expect(sanitizeGenericVariantId("id;ls")).toBeNull();
    expect(sanitizeGenericVariantId("a..b")).toBeNull();
  });

  it("drops unsafe Shopify handles and non-numeric variant IDs at adapter emission", async () => {
    const mockFetch = async (url: string): Promise<SafeFetchResponse> => {
      if (url.endsWith("/meta.json")) {
        return makeJsonResp(url, { name: "Test Shop", currency: "EUR", country: "DE" });
      }
      if (url.includes("/collections.json")) {
        return makeJsonResp(url, {
          collections: [
            { id: 1, handle: "sale", title: "Sale", products_count: 5 },
            { id: 2, handle: "sale;id", title: "Unsafe Collection", products_count: 2 }
          ]
        });
      }
      if (url.includes("/search/suggest.json")) {
        return makeJsonResp(url, {
          resources: {
            results: {
              products: [
                {
                  id: 101,
                  handle: "business-socken-leichte-lange-socken",
                  title: "Business Socken",
                  price: "25.49",
                  available: true
                },
                {
                  id: 102,
                  handle: "bad$(whoami)",
                  title: "Malicious Product",
                  price: "19.99",
                  available: true
                }
              ]
            }
          }
        });
      }
      if (url.includes("/products/pack_2.0.js")) {
        return makeJsonResp(url, {
          id: 200,
          handle: "bad`id`",
          title: "Pack 2.0",
          available: true,
          variants: [
            { id: 37548706496709, title: "M", available: true, price: 2549 },
            { id: "37548$(id)", title: "Injected", available: true, price: 2549 }
          ]
        });
      }
      return makeJsonResp(url, {}, 404);
    };

    const adapter = new ShopifyAdapter(new ShopifyClient(mockFetch));

    const cols = await adapter.listCollections("https://shop.example.com");
    expect(cols.collections.map((c) => c.handle)).toEqual(["sale"]);

    const search = await adapter.searchProducts("https://shop.example.com", {
      query: "socken",
      limit: 10
    });
    expect(search.products.map((p) => p.handle)).toEqual(["business-socken-leichte-lange-socken"]);

    const detail = await adapter.getProduct("https://shop.example.com", "pack_2.0");
    // Unsafe raw.handle falls back to validated fallbackHandle ("pack_2.0")
    expect(detail.product.handle).toBe("pack_2.0");
    // Non-numeric variant ID is dropped
    expect(detail.product.variants.map((v) => v.id)).toEqual(["37548706496709"]);
  });

  it("drops unsafe WooCommerce slugs and non-numeric simple/variable product IDs at emission", async () => {
    const mockFetch = async (url: string): Promise<SafeFetchResponse> => {
      if (url.includes("/wp-json/wc/store/v1/cart")) {
        return makeJsonResp(url, { totals: { currency_code: "EUR", currency_minor_unit: 2 } });
      }
      if (url.includes("/wp-json/?_fields=name")) {
        return makeJsonResp(url, { name: "Woo Test" });
      }
      if (url.includes("slug=simple-bad-id")) {
        return makeJsonResp(url, [
          {
            id: "99$(id)" as unknown as number,
            name: "Broken Simple Product",
            slug: "bad;slug",
            type: "simple",
            is_purchasable: true,
            is_in_stock: true,
            prices: { price: "1999", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]);
      }
      if (url.includes("slug=t-shirt-xl")) {
        return makeJsonResp(url, [
          {
            id: 501,
            name: "T-Shirt XL",
            slug: "bad|slug",
            type: "simple",
            is_purchasable: true,
            is_in_stock: true,
            prices: { price: "2999", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]);
      }
      if (url.includes("/wp-json/wc/store/v1/products")) {
        return makeJsonResp(url, [
          {
            id: 501,
            name: "T-Shirt XL",
            slug: "t-shirt-xl",
            type: "simple",
            is_purchasable: true,
            is_in_stock: true,
            prices: { price: "2999", currency_code: "EUR", currency_minor_unit: 2 }
          },
          {
            id: 502,
            name: "Unsafe Slug Item",
            slug: "evil$(id)",
            type: "simple",
            is_purchasable: true,
            is_in_stock: true,
            prices: { price: "1999", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]);
      }
      return makeJsonResp(url, {}, 404);
    };

    const adapter = new WooCommerceAdapter(mockFetch);

    const search = await adapter.searchProducts("https://woo.example.com", {
      query: "shirt",
      limit: 10
    });
    expect(search.products.map((p) => p.handle)).toEqual(["t-shirt-xl", "502"]);

    const detail = await adapter.getProduct("https://woo.example.com", "t-shirt-xl");
    expect(detail.product.handle).toBe("501");
    expect(detail.product.variants.map((v) => v.id)).toEqual(["501"]);
  });

  it("drops unsafe percent-encoded URL handles and unsafe SKUs in JSON-LD parser", () => {
    const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Demo Item",
      sku: "BAD$(id)",
      offers: {
        "@type": "Offer",
        price: "49.90",
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock"
      }
    })}</script></head><body></body></html>`;

    const parsed = parseProductFromHtml(
      html,
      "https://merchant.example.com/p/item%24%28id%29%3Bwhoami.html"
    );
    expect(parsed).not.toBeNull();
    // Unsafe decoded URL handle and unsafe SKU must never be emitted
    expect(parsed!.product.handle).toBe("");
    expect(parsed!.product.id).toBe("product");
    expect(parsed!.product.variants[0]!.id).toBe("offer-1");

    // Legitimate URL handle passes through unchanged
    const okParsed = parseProductFromHtml(
      html.replace("BAD$(id)", "SKU-42"),
      "https://merchant.example.com/p/pack_2.0.html"
    );
    expect(okParsed!.product.handle).toBe("pack_2.0");
    expect(okParsed!.product.variants[0]!.id).toBe("SKU-42");
  });

  it("enforces defense-in-depth CLI output emission gate and strict CLI/normalize input validation", async () => {
    // 1. Input validation rejects shell metacharacters
    expect(() => parseCliArgs(["search", "snocks.com", "socken", "--collection", "sale;id"])).toThrow(
      CliUsageError
    );
    expect(() => parseCliArgs(["product", "snocks.com", "bad$(id)"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["cart", "snocks.com", "12345:1", "--verify", "bad`id`"])).toThrow(
      CliUsageError
    );
    expect(() => parseCartItemSpec("123$(id):1")).toThrow(CliUsageError);
    expect(() => extractProductHandle("bad$(id)")).toThrow();
    expect(() => extractCollectionHandle("sale;whoami")).toThrow();

    // Legitimate inputs still pass
    expect(parseCliArgs(["product", "snocks.com", "pack_2.0"])).toMatchObject({
      kind: "product",
      handleOrUrl: "pack_2.0"
    });
    expect(parseCartItemSpec("37548706496709:2")).toEqual({
      variantId: "37548706496709",
      quantity: 2
    });

    // 2. CLI output emission gate strips unsafe handles/variant IDs even if a mock adapter leaks them
    const leakyStore: StoreInfo = {
      platform: "shopify",
      origin: "https://shop.example.com",
      name: "Leaky",
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
    const leakyAdapter: StoreAdapter = {
      platform: "shopify",
      detect: vi.fn(async () => leakyStore),
      searchProducts: vi.fn(async () => ({
        store_origin: "https://shop.example.com",
        currency: "EUR",
        products: [
          {
            id: "1",
            handle: "t-shirt-xl",
            title: "Safe",
            vendor: null,
            product_type: null,
            available: true,
            price: { amount: 20, formatted: "20.00 EUR", currency: "EUR" },
            price_min: { amount: 20, formatted: "20.00 EUR", currency: "EUR" },
            price_max: { amount: 20, formatted: "20.00 EUR", currency: "EUR" },
            compare_at_price: null,
            url: "https://shop.example.com/products/t-shirt-xl",
            image_url: null
          },
          {
            id: "2",
            handle: "evil$(id)",
            title: "Unsafe",
            vendor: null,
            product_type: null,
            available: true,
            price: { amount: 20, formatted: "20.00 EUR", currency: "EUR" },
            price_min: { amount: 20, formatted: "20.00 EUR", currency: "EUR" },
            price_max: { amount: 20, formatted: "20.00 EUR", currency: "EUR" },
            compare_at_price: null,
            url: "https://shop.example.com/products/evil",
            image_url: null
          }
        ],
        notices: []
      })),
      getProduct: vi.fn(async () => ({
        store_origin: "https://shop.example.com",
        currency: "EUR",
        product: {
          id: "bad;id",
          handle: "bad$(handle)",
          title: "Item",
          vendor: null,
          product_type: null,
          description_text: "Desc",
          available: true,
          url: "https://shop.example.com/products/item",
          options: [],
          images: [],
          variants: [
            {
              id: "37548706496709",
              title: "Safe Variant",
              sku: null,
              available: true,
              price: { amount: 20, formatted: "20.00 EUR", currency: "EUR" },
              compare_at_price: null,
              option_values: []
            },
            {
              id: "999;whoami",
              title: "Unsafe Variant",
              sku: null,
              available: true,
              price: { amount: 20, formatted: "20.00 EUR", currency: "EUR" },
              compare_at_price: null,
              option_values: []
            }
          ]
        }
      })),
      buildCartLink: vi.fn(async () => ({
        store_origin: "https://shop.example.com",
        cart_url: "https://shop.example.com/cart/37548706496709:1?storefront=true",
        mode: "cart" as const,
        items: [{ variant_id: "37548706496709", quantity: 1 }],
        warnings: [],
        next_step: "Open link"
      }))
    };
    const registry = {
      resolve: vi.fn(async () => ({ adapter: leakyAdapter, store: leakyStore })),
      resolveAdapter: vi.fn(async () => leakyAdapter)
    } as unknown as AdapterRegistry;

    const searchOut = makeCapture();
    expect(await runCli(["search", "shop.example.com", "shirt"], { registry, stdout: searchOut, stderr: makeCapture() })).toBe(0);
    const searchJson = JSON.parse(searchOut.text());
    expect(searchJson.total_returned).toBe(1);
    expect(searchJson.products.map((p: { handle: string }) => p.handle)).toEqual(["t-shirt-xl"]);
    expect(searchOut.text()).not.toContain("evil$(id)");

    const prodOut = makeCapture();
    expect(await runCli(["product", "shop.example.com", "pack_2.0"], { registry, stdout: prodOut, stderr: makeCapture() })).toBe(0);
    const prodJson = JSON.parse(prodOut.text());
    expect(prodJson.product.handle).toBeUndefined();
    expect(prodJson.product.variants.map((v: { id: string }) => v.id)).toEqual(["37548706496709"]);
    expect(prodOut.text()).not.toContain("999;whoami");
    expect(prodOut.text()).not.toContain("bad$(handle)");

    // Direct sanitizeCliOutput check on collections
    const cleanedCols = sanitizeCliOutput({
      collections: [
        { id: "1", handle: "sale" },
        { id: "2", handle: "sale`id`" }
      ],
      highlighted_deals: [{ id: "2", handle: "sale`id`" }]
    }) as { collections: Array<{ handle: string }>; highlighted_deals: Array<{ handle: string }> };
    expect(cleanedCols.collections.map((c) => c.handle)).toEqual(["sale"]);
    expect(cleanedCols.highlighted_deals).toEqual([]);
  });

  it("uses single-quoted placeholders and documents the safe-quoting rule across SKILL.md, /SKILL.md, /llms*.txt, README.md, and renderCliHelp()", async () => {
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      STORAGE_BACKEND: "memory",
      SESSION_SECRET: "test-session-secret-0123456789abcdef"
    });
    const app = createApp({ config, store: new MemoryStore() });

    const skillText = fs.readFileSync(path.join(ROOT_DIR, "skills", "shopcart-mcp", "SKILL.md"), "utf8");
    const readmeText = fs.readFileSync(path.join(ROOT_DIR, "README.md"), "utf8");
    const helpText = renderCliHelp();
    const skillHttp = (await request(app).get("/SKILL.md").expect(200)).text;
    const llmsTxt = (await request(app).get("/llms.txt").expect(200)).text;
    const llmsFullTxt = (await request(app).get("/llms-full.txt").expect(200)).text;

    for (const [name, doc] of [
      ["SKILL.md", skillText],
      ["/SKILL.md", skillHttp],
      ["/llms.txt", llmsTxt]
    ] as const) {
      expect(doc, `${name} single-quoted inspect`).toContain("npx -y shopcart-mcp inspect '<store>'");
      expect(doc, `${name} single-quoted search`).toContain("npx -y shopcart-mcp search '<store>' '<query>'");
      expect(doc, `${name} single-quoted product`).toContain("npx -y shopcart-mcp product '<store>'");
      expect(doc, `${name} single-quoted cart`).toContain("npx -y shopcart-mcp cart '<store>' '<variantId:qty>'");
      expect(doc, `${name} quoting rule`).toMatch(/single-quote/i);
      expect(doc, `${name} no bare <store> in inspect`).not.toContain("shopcart-mcp inspect <store>");
      expect(doc, `${name} no double-quoted <query>`).not.toContain('"<query>"');
    }

    expect(llmsFullTxt).toContain("npx -y shopcart-mcp inspect '<store>'");
    expect(llmsFullTxt).toMatch(/single-quot/i);

    expect(readmeText).toContain("npx -y shopcart-mcp inspect 'snocks.com'");
    expect(readmeText).toContain("npx -y shopcart-mcp search 'snocks.com' 'socken'");
    expect(readmeText).toContain("npx -y shopcart-mcp product 'snocks.com' '<handle>'");
    expect(readmeText).toContain("npx -y shopcart-mcp cart 'snocks.com' '<variantId>:1'");
    expect(readmeText).toMatch(/single-quote/i);

    expect(helpText).toContain("shopcart-mcp inspect '<store>'");
    expect(helpText).toContain("shopcart-mcp search '<store>' '<query>'");
    expect(helpText).toContain("shopcart-mcp product '<store>' '<handle-or-url>'");
    expect(helpText).toContain("shopcart-mcp cart '<store>' '<id:qty>'");
    expect(helpText).toMatch(/single-quote/i);
  });
});
