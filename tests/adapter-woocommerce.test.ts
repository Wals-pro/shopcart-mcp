import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { ShopifyAdapter } from "../src/adapters/shopify/adapter.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import { WooCommerceAdapter } from "../src/adapters/woocommerce/adapter.js";
import {
  decodeWooEntities,
  extractWooProductIdentifier,
  extractWooProductPrices,
  isValidWooCart,
  isValidWooStoreProduct,
  sanitizeWooDescription,
  sanitizeWooText,
  wooMoneyFromMinorUnits
} from "../src/adapters/woocommerce/normalize.js";
import { SsrfError, type SafeFetchResponse } from "../src/security/ssrf.js";

interface FixtureRoute {
  status: number;
  body: unknown;
  contentType?: string;
  finalUrl?: string;
}

function makeFixtureFetcher(routes: Record<string, FixtureRoute>, calls?: string[]) {
  return async (url: string): Promise<SafeFetchResponse> => {
    calls?.push(url);
    const parsed = new URL(url);
    const fullKey = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    const fullPathKey = `${parsed.origin}${parsed.pathname}`;
    const key = `${parsed.pathname}${parsed.search}`;
    const exact =
      routes[fullKey] ?? routes[fullPathKey] ?? routes[key] ?? routes[parsed.pathname];
    if (!exact) {
      return {
        status: 404,
        url,
        contentType: "application/json",
        headers: {},
        bodyBuffer: Buffer.from(
          JSON.stringify({ code: "rest_no_route", message: "No route was found", data: { status: 404 } })
        ),
        bodyText: JSON.stringify({
          code: "rest_no_route",
          message: "No route was found",
          data: { status: 404 }
        })
      };
    }
    const text = typeof exact.body === "string" ? exact.body : JSON.stringify(exact.body);
    return {
      status: exact.status,
      url: exact.finalUrl ?? url,
      contentType: exact.contentType ?? "application/json",
      headers: { "content-type": exact.contentType ?? "application/json" },
      bodyBuffer: Buffer.from(text),
      bodyText: text
    };
  };
}

describe("WooCommerce normalization (prices, entities, slugs, validation)", () => {
  it("converts minor-unit price strings across 0, 2, and 3 decimal currencies", () => {
    expect(wooMoneyFromMinorUnits("2999", "EUR", 2)).toEqual({
      amount: 29.99,
      formatted: "29.99 EUR",
      currency: "EUR"
    });
    expect(wooMoneyFromMinorUnits("2500", "JPY", 0)).toEqual({
      amount: 2500,
      formatted: "2500 JPY",
      currency: "JPY"
    });
    expect(wooMoneyFromMinorUnits("1250", "KWD", 3)).toEqual({
      amount: 1.25,
      formatted: "1.250 KWD",
      currency: "KWD"
    });
    expect(wooMoneyFromMinorUnits("0", "EUR", 2, true)).toBeNull();
    expect(wooMoneyFromMinorUnits("", "EUR", 2)).toBeNull();
    expect(wooMoneyFromMinorUnits("not-a-number", "EUR", 2)).toBeNull();
  });

  it("extracts sale_price, regular_price -> compare_at_price, and price_range accurately", () => {
    const salePrices = extractWooProductPrices(
      {
        id: 254829,
        name: "Gravel Groupset",
        on_sale: true,
        prices: {
          price: "130000",
          regular_price: "160000",
          sale_price: "130000",
          price_range: { min_amount: "130000", max_amount: "135000" },
          currency_code: "EUR",
          currency_minor_unit: 2
        }
      },
      "USD",
      2
    );

    expect(salePrices.currency).toBe("EUR");
    expect(salePrices.price).toEqual({ amount: 1300, formatted: "1300.00 EUR", currency: "EUR" });
    expect(salePrices.compareAtPrice).toEqual({
      amount: 1600,
      formatted: "1600.00 EUR",
      currency: "EUR"
    });
    expect(salePrices.priceMin).toEqual({
      amount: 1300,
      formatted: "1300.00 EUR",
      currency: "EUR"
    });
    expect(salePrices.priceMax).toEqual({
      amount: 1350,
      formatted: "1350.00 EUR",
      currency: "EUR"
    });

    // When regular_price === price (not discounted), compareAtPrice must be null
    const regularPrices = extractWooProductPrices(
      {
        id: 34907,
        name: "Flannel Shirt",
        on_sale: false,
        prices: {
          price: "4400",
          regular_price: "4400",
          sale_price: "4400",
          price_range: null,
          currency_code: "USD",
          currency_minor_unit: 2
        }
      },
      "USD",
      2
    );
    expect(regularPrices.price).toEqual({ amount: 44, formatted: "44.00 USD", currency: "USD" });
    expect(regularPrices.compareAtPrice).toBeNull();
  });

  it("decodes HTML entities, strips WP shortcodes, scripts, and invisible Unicode prompt-injection chars", () => {
    const tagSmuggled = String.fromCodePoint(0xe0049, 0xe0067, 0xe006e);
    expect(decodeWooEntities("MTB &#8211; 1&#215;13 &amp; Co.")).toBe("MTB – 1×13 & Co.");
    expect(
      sanitizeWooText(`<b>MTB &#8211; 1&#215;13</b><script>evil()</script>${tagSmuggled}\u202E`, 100)
    ).toBe("MTB – 1×13");

    const desc = sanitizeWooDescription(
      `<p>[vc_row][vc_column width=&#8220;1/1&#8243;]Handbuilt steel frame[/vc_column][/vc_row]</p><script>alert(1)</script>`,
      `<p>Fallback short desc</p>`,
      500
    );
    expect(desc).toBe("Handbuilt steel frame");
    expect(desc).not.toContain("vc_row");
    expect(desc).not.toContain("alert");

    // Falls back to short_description when description is empty
    expect(sanitizeWooDescription("", "<p>Short summary &amp; specs</p>", 500)).toBe(
      "Short summary & specs"
    );
  });

  it("extracts WooCommerce numeric IDs, slugs, and full product URLs while rejecting path traversal", () => {
    expect(extractWooProductIdentifier("34907")).toEqual({ kind: "id", value: "34907" });
    expect(extractWooProductIdentifier("blue-flannel-shirt")).toEqual({
      kind: "slug",
      value: "blue-flannel-shirt"
    });
    expect(
      extractWooProductIdentifier(
        "https://www.veloheld.de/produkt/veloheld-icon-rahmenset-groesse-xl/"
      )
    ).toEqual({ kind: "slug", value: "veloheld-icon-rahmenset-groesse-xl" });
    expect(
      extractWooProductIdentifier(
        "https://8bar-bikes.com/shop/mtb-1x13-sram-rival/?utm_source=google"
      )
    ).toEqual({ kind: "slug", value: "mtb-1x13-sram-rival" });
    expect(extractWooProductIdentifier("https://example.com/?product=coffee-beans")).toEqual({
      kind: "slug",
      value: "coffee-beans"
    });
    expect(extractWooProductIdentifier("https://example.com/?p=9876")).toEqual({
      kind: "id",
      value: "9876"
    });

    expect(() => extractWooProductIdentifier("../etc/passwd")).toThrow();
    expect(() => extractWooProductIdentifier("https://example.com/")).toThrow();
    expect(() => extractWooProductIdentifier("   ")).toThrow();
  });

  it("validates Store API product and cart shapes strictly to prevent false positives", () => {
    expect(
      isValidWooStoreProduct({
        id: 10,
        name: "Test",
        prices: { currency_code: "EUR", currency_minor_unit: 2 }
      })
    ).toBe(true);
    // Plain WordPress blog post lacks prices.currency_code & currency_minor_unit
    expect(
      isValidWooStoreProduct({
        id: 10,
        title: { rendered: "Hello World" }
      })
    ).toBe(false);
    expect(
      isValidWooCart({
        items: [],
        totals: { currency_code: "EUR", currency_minor_unit: 2 }
      })
    ).toBe(true);
    expect(isValidWooCart({ items: [], totals: {} })).toBe(false);
  });
});

describe("WooCommerceAdapter (detect, search, variable products, cart links)", () => {
  it("detects WooCommerce stores, canonicalizes apex -> www. redirects, and rejects non-Woo WordPress blogs", async () => {
    const fetcher = makeFixtureFetcher({
      // Apex veloheld.de redirects to www.veloheld.de
      "https://veloheld.de/wp-json/wc/store/v1/products?per_page=1": {
        status: 200,
        finalUrl: "https://www.veloheld.de/wp-json/wc/store/v1/products?per_page=1",
        body: [
          {
            id: 182926,
            name: "veloheld.icon Rahmenset – Größe XL",
            slug: "veloheld-icon-rahmenset-groesse-xl",
            type: "simple",
            permalink: "https://www.veloheld.de/produkt/veloheld-icon-rahmenset-groesse-xl/",
            is_in_stock: true,
            is_purchasable: true,
            prices: {
              price: "119900",
              regular_price: "119900",
              sale_price: "119900",
              currency_code: "EUR",
              currency_minor_unit: 2
            }
          }
        ]
      },
      "https://veloheld.de/wp-json/wc/store/v1/cart": {
        status: 200,
        finalUrl: "https://www.veloheld.de/wp-json/wc/store/v1/cart",
        body: {
          items: [],
          totals: { currency_code: "EUR", currency_minor_unit: 2, total_price: "0" },
          shipping_address: { country: "DE" }
        }
      },
      "https://www.veloheld.de/wp-json/?_fields=name": {
        status: 200,
        body: { name: "VELOHELD" }
      },
      // Regular WordPress blog without WooCommerce: 404 rest_no_route on wc/store/v1
      "https://wpblog.example/wp-json/": {
        status: 200,
        body: { name: "Just a WordPress Blog", namespaces: ["wp/v2"] }
      },
      // Parked domain returning 200 HTML on every path
      "https://parked.example/wp-json/wc/store/v1/products?per_page=1": {
        status: 200,
        contentType: "text/html",
        body: "<!DOCTYPE html><html><body>Parked domain</body></html>"
      },
      "https://parked.example/wp-json/wc/store/v1/cart": {
        status: 200,
        contentType: "text/html",
        body: "<!DOCTYPE html><html><body>Parked domain</body></html>"
      },
      // Non-Woo API returning arbitrary JSON array without Woo prices
      "https://fakeapi.example/wp-json/wc/store/v1/products?per_page=1": {
        status: 200,
        body: [{ id: 1, name: "Blog Post", slug: "hello-world" }]
      }
    });

    const adapter = new WooCommerceAdapter(fetcher);

    const store = await adapter.detect("https://veloheld.de");
    expect(store).not.toBeNull();
    expect(store!.platform).toBe("woocommerce");
    expect(store!.origin).toBe("https://www.veloheld.de");
    expect(store!.name).toBe("VELOHELD");
    expect(store!.currency).toBe("EUR");
    expect(store!.country).toBe("DE");
    expect(store!.myshopifyDomain).toBeNull();
    expect(store!.capabilities.wooStoreApi).toBe(true);
    expect(store!.capabilities.productCatalogJson).toBe(true);

    // Non-Woo sites must return null
    expect(await adapter.detect("https://wpblog.example")).toBeNull();
    expect(await adapter.detect("https://parked.example")).toBeNull();
    expect(await adapter.detect("https://fakeapi.example")).toBeNull();

    // Canonical origin is reused in buildCartLink
    const cart = await adapter.buildCartLink(
      "https://veloheld.de",
      [{ variantId: "182926", quantity: 1 }],
      { mode: "cart" }
    );
    expect(cart.store_origin).toBe("https://www.veloheld.de");
    expect(cart.cart_url).toBe("https://www.veloheld.de/cart/?add-to-cart=182926&quantity=1");
  });

  it("searches & browses catalog with price/availability filters and umlaut retry", async () => {
    const fetcher = makeFixtureFetcher({
      "/wp-json/wc/store/v1/products?per_page=1": {
        status: 200,
        body: [
          {
            id: 101,
            name: "Bio Kaffee",
            slug: "bio-kaffee",
            type: "simple",
            is_in_stock: true,
            is_purchasable: true,
            prices: { price: "1490", regular_price: "1490", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]
      },
      "/wp-json/wc/store/v1/cart": {
        status: 200,
        body: { items: [], totals: { currency_code: "EUR", currency_minor_unit: 2 } }
      },
      "/wp-json/wc/store/v1/products?per_page=20&search=Kaffee": {
        status: 200,
        body: [
          {
            id: 101,
            name: "Bio Kaffee &#8211; Espresso",
            slug: "bio-kaffee-espresso",
            type: "simple",
            permalink: "https://roaster.example/produkt/bio-kaffee-espresso/?utm_source=test",
            is_in_stock: true,
            is_purchasable: true,
            categories: [{ id: 1, name: "Espresso" }],
            brands: [{ id: 2, name: "Roaster Co" }],
            images: [{ src: "https://roaster.example/wp-content/uploads/espresso.jpg" }],
            prices: {
              price: "1290",
              regular_price: "1590",
              sale_price: "1290",
              currency_code: "EUR",
              currency_minor_unit: 2
            }
          },
          {
            id: 102,
            name: "Decaf Kaffee (Ausverkauft)",
            slug: "decaf-kaffee",
            type: "simple",
            permalink: "https://roaster.example/produkt/decaf-kaffee/",
            is_in_stock: false,
            is_purchasable: true,
            images: [{ src: "https://evil.example/phish.jpg" }],
            prices: {
              price: "990",
              regular_price: "990",
              currency_code: "EUR",
              currency_minor_unit: 2
            }
          }
        ]
      },
      "/wp-json/wc/store/v1/products?per_page=20": {
        status: 200,
        body: [
          {
            id: 101,
            name: "Bio Kaffee",
            slug: "bio-kaffee",
            type: "simple",
            permalink: "https://roaster.example/produkt/bio-kaffee/",
            is_in_stock: true,
            is_purchasable: true,
            prices: { price: "1290", regular_price: "1290", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]
      },
      "/wp-json/wc/store/v1/products?per_page=20&search=R%C3%B6stung": {
        status: 200,
        body: []
      },
      "/wp-json/wc/store/v1/products?per_page=20&search=roestung": {
        status: 200,
        body: [
          {
            id: 103,
            name: "Helle Roestung",
            slug: "helle-roestung",
            type: "simple",
            permalink: "https://roaster.example/produkt/helle-roestung/",
            is_in_stock: true,
            is_purchasable: true,
            prices: { price: "1850", regular_price: "1850", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]
      }
    });

    const adapter = new WooCommerceAdapter(fetcher);

    const search = await adapter.searchProducts("https://roaster.example", {
      query: "Kaffee",
      limit: 10
    });
    expect(search.currency).toBe("EUR");
    expect(search.products).toHaveLength(2);
    expect(search.products[0]).toMatchObject({
      id: "101",
      handle: "bio-kaffee-espresso",
      title: "Bio Kaffee – Espresso",
      vendor: "Roaster Co",
      product_type: "Espresso",
      available: true,
      price: { amount: 12.9, formatted: "12.90 EUR", currency: "EUR" },
      compare_at_price: { amount: 15.9, formatted: "15.90 EUR", currency: "EUR" },
      url: "https://roaster.example/produkt/bio-kaffee-espresso/",
      image_url: "https://roaster.example/wp-content/uploads/espresso.jpg"
    });
    expect(search.products[1]!.available).toBe(false);
    expect(search.products[1]!.image_url).toBeNull(); // external host rejected

    const availableOnly = await adapter.searchProducts("https://roaster.example", {
      query: "Kaffee",
      limit: 10,
      availableOnly: true,
      minPrice: 10,
      maxPrice: 15
    });
    expect(availableOnly.products).toHaveLength(1);
    expect(availableOnly.products[0]!.id).toBe("101");

    // Browse mode without query
    const browse = await adapter.searchProducts("https://roaster.example", { limit: 5 });
    expect(browse.products).toHaveLength(1);
    expect(browse.products[0]!.id).toBe("101");

    // Umlaut retry
    const retry = await adapter.searchProducts("https://roaster.example", {
      query: "Röstung",
      limit: 5
    });
    expect(retry.products).toHaveLength(1);
    expect(retry.notices.some((n) => n.includes("roestung"))).toBe(true);
  });

  it("loads variable products with concrete variation IDs, option labels, prices, and stock (batch + bounded fallback)", async () => {
    const calls: string[] = [];
    const fetcher = makeFixtureFetcher(
      {
        "/wp-json/wc/store/v1/products?per_page=1": {
          status: 200,
          body: [
            {
              id: 34907,
              name: "Flannel Shirt",
              slug: "flannel-shirt",
              type: "variable",
              prices: { price: "4400", currency_code: "USD", currency_minor_unit: 2 }
            }
          ]
        },
        "/wp-json/wc/store/v1/cart": {
          status: 200,
          body: { items: [], totals: { currency_code: "USD", currency_minor_unit: 2 } }
        },
        "/wp-json/wc/store/v1/products?slug=flannel-shirt&per_page=5": {
          status: 200,
          body: [
            {
              id: 34907,
              name: "Flannel Shirt",
              slug: "flannel-shirt",
              type: "variable",
              permalink: "https://swag.example/product/flannel-shirt/",
              short_description: "<p>Soft organic cotton</p>",
              description: "<p>Brushed flannel button-down shirt.</p>",
              is_in_stock: true,
              is_purchasable: true,
              images: [{ src: "https://swag.example/wp-content/uploads/shirt.png" }],
              attributes: [
                {
                  id: 1,
                  name: "Size",
                  taxonomy: "pa_size",
                  has_variations: true,
                  terms: [
                    { id: 10, name: "XS", slug: "xs" },
                    { id: 11, name: "MD", slug: "md" },
                    { id: 12, name: "XL", slug: "xl" }
                  ]
                }
              ],
              variations: [
                { id: 34914, attributes: [{ name: "Size", value: "xs" }] },
                { id: 34916, attributes: [{ name: "Size", value: "md" }] },
                { id: 34918, attributes: [{ name: "Size", value: "xl" }] }
              ],
              prices: {
                price: "4400",
                regular_price: "4400",
                price_range: { min_amount: "4400", max_amount: "4800" },
                currency_code: "USD",
                currency_minor_unit: 2
              }
            }
          ]
        },
        // Batch endpoint returns 2 of 3 variations; 34918 falls back to single endpoint
        "/wp-json/wc/store/v1/products?include=34914%2C34916%2C34918&type=variation&per_page=3": {
          status: 200,
          body: [
            {
              id: 34914,
              name: "Flannel Shirt",
              parent: 34907,
              type: "variation",
              variation: "Size: XS",
              sku: "SHIRT-XS",
              is_in_stock: true,
              is_purchasable: true,
              prices: {
                price: "4400",
                regular_price: "4400",
                sale_price: "4400",
                currency_code: "USD",
                currency_minor_unit: 2
              }
            },
            {
              id: 34916,
              name: "Flannel Shirt",
              parent: 34907,
              type: "variation",
              variation: "Size: MD",
              sku: "SHIRT-MD",
              is_in_stock: false,
              is_purchasable: true,
              prices: {
                price: "4400",
                regular_price: "4400",
                sale_price: "4400",
                currency_code: "USD",
                currency_minor_unit: 2
              }
            }
          ]
        },
        "/wp-json/wc/store/v1/products/34918": {
          status: 200,
          body: {
            id: 34918,
            name: "Flannel Shirt",
            parent: 34907,
            type: "variation",
            variation: "Size: XL",
            sku: "SHIRT-XL",
            on_sale: true,
            is_in_stock: true,
            is_purchasable: true,
            prices: {
              price: "4200",
              regular_price: "4800",
              sale_price: "4200",
              currency_code: "USD",
              currency_minor_unit: 2
            }
          }
        },
        // Product with 20 variations -> must be bounded to max 15
        "/wp-json/wc/store/v1/products/90000": {
          status: 200,
          body: {
            id: 90000,
            name: "Many Sizes Hoodie",
            slug: "many-sizes-hoodie",
            type: "variable",
            is_in_stock: true,
            is_purchasable: true,
            attributes: [{ name: "Size", terms: [] }],
            variations: Array.from({ length: 20 }, (_, i) => ({
              id: 90100 + i,
              attributes: [{ name: "Size", value: `S${i + 1}` }]
            })),
            prices: { price: "5000", regular_price: "5000", currency_code: "USD", currency_minor_unit: 2 }
          }
        }
      },
      calls
    );

    const adapter = new WooCommerceAdapter(fetcher);

    const detail = await adapter.getProduct(
      "https://swag.example",
      "https://swag.example/product/flannel-shirt/"
    );
    expect(detail.currency).toBe("USD");
    expect(detail.product.id).toBe("34907");
    expect(detail.product.options).toEqual([{ name: "Size", values: ["XS", "MD", "XL"] }]);
    expect(detail.product.variants).toHaveLength(3);
    expect(detail.product.variants[0]).toEqual({
      id: "34914",
      title: "XS",
      sku: "SHIRT-XS",
      available: true,
      price: { amount: 44, formatted: "44.00 USD", currency: "USD" },
      compare_at_price: null,
      option_values: ["XS"]
    });
    expect(detail.product.variants[1]).toMatchObject({
      id: "34916",
      title: "MD",
      available: false
    });
    expect(detail.product.variants[2]).toEqual({
      id: "34918",
      title: "XL",
      sku: "SHIRT-XL",
      available: true,
      price: { amount: 42, formatted: "42.00 USD", currency: "USD" },
      compare_at_price: { amount: 48, formatted: "48.00 USD", currency: "USD" },
      option_values: ["XL"]
    });

    // Bounded max 15 variations on large variable product
    const bigProduct = await adapter.getProduct("https://swag.example", "90000");
    expect(bigProduct.product.variants).toHaveLength(15);
    expect(bigProduct.product.variants[14]!.id).toBe("90114");
  });

  it("builds deterministic single-item cart/checkout links and transparent multi-item additional_cart_links", async () => {
    const fetcher = makeFixtureFetcher({
      "/wp-json/wc/store/v1/products?per_page=1": {
        status: 200,
        body: [
          {
            id: 34907,
            name: "Flannel Shirt",
            slug: "flannel-shirt",
            type: "variable",
            prices: { price: "4400", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]
      },
      "/wp-json/wc/store/v1/cart": {
        status: 200,
        body: { items: [], totals: { currency_code: "EUR", currency_minor_unit: 2 } }
      },
      "/wp-json/wc/store/v1/products?slug=flannel-shirt&per_page=5": {
        status: 200,
        body: [
          {
            id: 34907,
            name: "Flannel Shirt",
            slug: "flannel-shirt",
            type: "variable",
            is_in_stock: true,
            is_purchasable: true,
            attributes: [
              {
                name: "Size",
                terms: [
                  { name: "XS", slug: "xs" },
                  { name: "MD", slug: "md" }
                ]
              }
            ],
            variations: [
              { id: 34914, attributes: [{ name: "Size", value: "xs" }] },
              { id: 34916, attributes: [{ name: "Size", value: "md" }] }
            ],
            prices: { price: "4400", regular_price: "4400", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]
      },
      "/wp-json/wc/store/v1/products?include=34914%2C34916&type=variation&per_page=2": {
        status: 200,
        body: [
          {
            id: 34914,
            name: "Flannel Shirt",
            parent: 34907,
            type: "variation",
            variation: "Size: XS",
            is_in_stock: true,
            is_purchasable: true,
            prices: { price: "4400", regular_price: "4400", currency_code: "EUR", currency_minor_unit: 2 }
          },
          {
            id: 34916,
            name: "Flannel Shirt",
            parent: 34907,
            type: "variation",
            variation: "Size: MD",
            is_in_stock: false,
            is_purchasable: true,
            prices: { price: "4400", regular_price: "4400", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]
      }
    });

    const adapter = new WooCommerceAdapter(fetcher);

    // 1. Single item - cart mode
    const singleCart = await adapter.buildCartLink(
      "https://shop.example",
      [{ variantId: "34914", quantity: 2 }],
      { mode: "cart", verifyHandles: ["flannel-shirt"] }
    );
    expect(singleCart.cart_url).toBe("https://shop.example/cart/?add-to-cart=34914&quantity=2");
    expect(singleCart.additional_cart_links).toBeUndefined();
    expect(singleCart.warnings).toHaveLength(0);
    expect(singleCart.items[0]).toMatchObject({
      variant_id: "34914",
      quantity: 2,
      verified: true,
      available: true,
      title: "Flannel Shirt — XS"
    });

    // 2. Single item - checkout mode
    const singleCheckout = await adapter.buildCartLink(
      "https://shop.example",
      [{ variantId: "34914", quantity: 1 }],
      { mode: "checkout", discountCode: "WELCOME10" }
    );
    expect(singleCheckout.cart_url).toBe(
      "https://shop.example/checkout/?add-to-cart=34914&quantity=1"
    );
    expect(singleCheckout.warnings.some((w) => w.includes("WELCOME10"))).toBe(true);

    // 3. Multi-item (>1 item) returns primary link + transparent additional_cart_links + warnings
    const multiCart = await adapter.buildCartLink(
      "https://shop.example",
      [
        { variantId: "34914", quantity: 1 },
        { variantId: "34916", quantity: 3 }
      ],
      { mode: "cart", verifyHandles: ["flannel-shirt"] }
    );
    expect(multiCart.cart_url).toBe("https://shop.example/cart/?add-to-cart=34914&quantity=1");
    expect(multiCart.additional_cart_links).toEqual([
      {
        variant_id: "34916",
        quantity: 3,
        title: "Flannel Shirt — MD",
        cart_url: "https://shop.example/cart/?add-to-cart=34916&quantity=3"
      }
    ]);
    expect(
      multiCart.warnings.some((w) =>
        w.includes("only supports adding one product/variation per GET URL")
      )
    ).toBe(true);
    expect(multiCart.warnings.some((w) => w.includes("out of stock"))).toBe(true);
    expect(multiCart.warnings.some((w) => w.includes("XS (34914)"))).toBe(true);

    // 4. Passing variable parent ID instead of variation ID triggers clear guidance warning
    const parentIdCart = await adapter.buildCartLink(
      "https://shop.example",
      [{ variantId: "34907", quantity: 1 }],
      { mode: "cart", verifyHandles: ["flannel-shirt"] }
    );
    expect(parentIdCart.items[0]!.verified).toBe(false);
    expect(parentIdCart.warnings.some((w) => w.includes("variable parent product"))).toBe(true);
    expect(parentIdCart.warnings.some((w) => w.includes("XS (34914)"))).toBe(true);
  });

  it("rethrows hard SSRF errors and handles BODY_TOO_LARGE gracefully in search", async () => {
    const blockedAdapter = new WooCommerceAdapter(async () => {
      throw new SsrfError("BLOCKED_IP", "Blocked private/reserved IP");
    });
    await expect(blockedAdapter.detect("https://internal.example")).rejects.toThrow(SsrfError);

    const oversizedAdapter = new WooCommerceAdapter(async (url) => {
      if (url.includes("/cart")) {
        return {
          status: 200,
          url,
          contentType: "application/json",
          headers: {},
          bodyBuffer: Buffer.from(
            JSON.stringify({ items: [], totals: { currency_code: "EUR", currency_minor_unit: 2 } })
          ),
          bodyText: JSON.stringify({
            items: [],
            totals: { currency_code: "EUR", currency_minor_unit: 2 }
          })
        };
      }
      throw new SsrfError("BODY_TOO_LARGE", "Upstream response exceeded 1048576 bytes");
    });

    const search = await oversizedAdapter.searchProducts("https://huge.example", {
      query: "bike",
      limit: 5
    });
    expect(search.products).toHaveLength(0);
    expect(search.notices.some((n) => n.includes("oversized or invalid"))).toBe(true);
  });
});

describe("AdapterRegistry auto-routing (Amazon, Shopify & WooCommerce)", () => {
  it("registers all 8 adapters in deterministic priority order and routes each platform automatically", async () => {
    const defaultRegistry = new AdapterRegistry();
    expect(defaultRegistry.listPlatforms()).toEqual([
      "amazon",
      "secondhand",
      "shopify",
      "woocommerce",
      "bigcommerce",
      "shopware",
      "magento",
      "ucp",
      "jsonld"
    ]);

    const fetcher = makeFixtureFetcher({
      // Shopify store
      "https://myshopify-store.example/meta.json": {
        status: 200,
        body: { id: 1, name: "Shopify Store", currency: "USD", country: "US" }
      },
      "https://myshopify-store.example/search/suggest.json?q=a&resources[type]=product&resources[limit]=1": {
        status: 200,
        body: { resources: { results: { products: [] } } }
      },
      "https://myshopify-store.example/products.json?limit=1": {
        status: 200,
        body: { products: [] }
      },
      // WooCommerce store (all Shopify probes 404 -> falls through to WooCommerceAdapter)
      "https://mywoo-store.example/wp-json/wc/store/v1/products?per_page=1": {
        status: 200,
        body: [
          {
            id: 500,
            name: "Gravel Frame",
            slug: "gravel-frame",
            type: "simple",
            is_in_stock: true,
            is_purchasable: true,
            prices: { price: "99900", regular_price: "99900", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]
      },
      "https://mywoo-store.example/wp-json/wc/store/v1/cart": {
        status: 200,
        body: {
          items: [],
          totals: { currency_code: "EUR", currency_minor_unit: 2 },
          shipping_address: { country: "DE" }
        }
      },
      "https://mywoo-store.example/wp-json/?_fields=name": {
        status: 200,
        body: { name: "Woo Bike Shop" }
      }
    });

    const registry = new AdapterRegistry([
      new ShopifyAdapter(new ShopifyClient(fetcher)),
      new WooCommerceAdapter(fetcher)
    ]);

    const shopifyRes = await registry.resolve("https://myshopify-store.example");
    expect(shopifyRes.store?.platform).toBe("shopify");
    expect(shopifyRes.adapter.platform).toBe("shopify");

    const wooRes = await registry.resolve("https://mywoo-store.example");
    expect(wooRes.store?.platform).toBe("woocommerce");
    expect(wooRes.store?.name).toBe("Woo Bike Shop");
    expect(wooRes.adapter.platform).toBe("woocommerce");

    // Subsequent resolveAdapter hits cache directly and returns WooCommerceAdapter
    const cachedAdapter = await registry.resolveAdapter("https://mywoo-store.example");
    expect(cachedAdapter.platform).toBe("woocommerce");

    // Unknown / non-commerce site returns store: null
    const unknownRes = await registry.resolve("https://plain-blog.example");
    expect(unknownRes.store).toBeNull();

    // WooCommerce strictly rejects Amazon ASINs in buildCartLink
    const wooAdapter = new WooCommerceAdapter(fetcher);
    await expect(
      wooAdapter.buildCartLink("https://mywoo-store.example", [{ variantId: "B08N5WRWNW", quantity: 1 }], {
        mode: "cart"
      })
    ).rejects.toThrow("Invalid WooCommerce product/variation ID");
  });
});
