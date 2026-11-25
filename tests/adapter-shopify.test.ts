import { describe, expect, it } from "vitest";
import { ShopifyAdapter } from "../src/adapters/shopify/adapter.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import {
  extractProductHandle,
  extractProductPathInfo,
  matchesSearchQuery,
  simplifySearchQueryForRetry
} from "../src/adapters/shopify/normalize.js";
import { SsrfError, type SafeFetchResponse } from "../src/security/ssrf.js";

interface FixtureRoute {
  status: number;
  body: unknown;
  contentType?: string;
  finalUrl?: string;
}

function makeFixtureFetcher(routes: Record<string, FixtureRoute>) {
  return async (url: string): Promise<SafeFetchResponse> => {
    const parsed = new URL(url);
    const fullKey = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    const fullPathKey = `${parsed.origin}${parsed.pathname}`;
    const key = `${parsed.pathname}${parsed.search}`;
    const exact = routes[fullKey] ?? routes[fullPathKey] ?? routes[key] ?? routes[parsed.pathname];
    if (!exact) {
      return {
        status: 404,
        url,
        contentType: "text/html",
        headers: {},
        bodyBuffer: Buffer.from("Not Found"),
        bodyText: "Not Found"
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

describe("ShopifyAdapter (standard + Cloudflare WAF 403 Ridge pattern)", () => {
  it("survives WAF blocking /meta.json, /products.json, and /api/mcp (Ridge pattern)", async () => {
    const fetcher = makeFixtureFetcher({
      "/meta.json": { status: 403, body: "<html>Cloudflare</html>", contentType: "text/html" },
      "/products.json?limit=1": { status: 403, body: "<html>Cloudflare</html>", contentType: "text/html" },
      "/api/mcp": { status: 403, body: "<html>Cloudflare</html>", contentType: "text/html" },
      "/cart.js": {
        status: 200,
        body: { token: "abc", currency: "USD", items: [] }
      },
      "/search/suggest.json?q=a&resources[type]=product&resources[limit]=1": {
        status: 200,
        body: { resources: { results: { products: [{ id: 1, handle: "wallet", title: "Wallet", price: "95.00" }] } } }
      },
      "/search/suggest.json?q=wallet&resources[type]=product&resources[limit]=10": {
        status: 200,
        body: {
          resources: {
            results: {
              products: [
                {
                  id: 101,
                  handle: "ridge-wallet-carbon",
                  title: "Carbon Fiber Wallet",
                  vendor: "Ridge",
                  type: "Wallet",
                  available: true,
                  price: "125.00",
                  price_min: "125.00",
                  price_max: "125.00",
                  compare_at_price_min: "0.00",
                  url: "/products/ridge-wallet-carbon?_pos=1&_psq=wallet&_ss=e",
                  image: "//cdn.shopify.com/s/files/1/wallet.jpg"
                }
              ]
            }
          }
        }
      },
      "/products/ridge-wallet-carbon.js": {
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        body: {
          id: 101,
          handle: "ridge-wallet-carbon",
          title: "Carbon Fiber Wallet",
          vendor: "Ridge",
          type: "Wallet",
          description: "<p>Slim RFID wallet</p><script>bad()</script>",
          available: true,
          url: "/products/ridge-wallet-carbon",
          images: ["//cdn.shopify.com/s/files/1/wallet.jpg"],
          options: ["Style"],
          variants: [
            {
              id: 41234567890123,
              title: "Cash Strap",
              sku: "RW-CF-CS",
              available: true,
              price: 12500,
              compare_at_price: null,
              options: ["Cash Strap"]
            },
            {
              id: 41234567890124,
              title: "Money Clip",
              sku: "RW-CF-MC",
              available: false,
              price: 12500,
              compare_at_price: 14500,
              options: ["Money Clip"]
            }
          ]
        }
      }
    });

    const adapter = new ShopifyAdapter(new ShopifyClient(fetcher));

    const store = await adapter.detect("https://ridge.com");
    expect(store).not.toBeNull();
    expect(store!.currency).toBe("USD");
    expect(store!.wafRestricted).toBe(true);
    expect(store!.capabilities.predictiveSearch).toBe(true);
    expect(store!.capabilities.productCatalogJson).toBe(false);

    const search = await adapter.searchProducts("https://ridge.com", {
      query: "wallet",
      limit: 5
    });
    expect(search.currency).toBe("USD");
    expect(search.products).toHaveLength(1);
    expect(search.products[0]!.compare_at_price).toBeNull(); // "0.00" -> null
    expect(search.products[0]!.url).toBe("https://ridge.com/products/ridge-wallet-carbon");

    const detail = await adapter.getProduct("https://ridge.com", "ridge-wallet-carbon");
    expect(detail.product.description_text).toBe("Slim RFID wallet");
    expect(detail.product.variants[0]!.price).toEqual({
      amount: 125,
      formatted: "125.00 USD",
      currency: "USD"
    });
    expect(detail.product.variants[1]!.compare_at_price).toEqual({
      amount: 145,
      formatted: "145.00 USD",
      currency: "USD"
    });

    const cart = await adapter.buildCartLink(
      "https://ridge.com",
      [
        { variantId: "41234567890123", quantity: 1 },
        { variantId: "41234567890124", quantity: 2 }
      ],
      {
        mode: "cart",
        discountCode: "BF2026",
        verifyHandles: ["ridge-wallet-carbon"]
      }
    );

    expect(cart.cart_url).toBe(
      "https://ridge.com/cart/41234567890123:1,41234567890124:2?storefront=true&discount=BF2026"
    );
    expect(cart.items[0]!.verified).toBe(true);
    expect(cart.items[0]!.available).toBe(true);
    expect(cart.items[1]!.available).toBe(false);
    expect(cart.warnings.some((w) => w.includes("sold out"))).toBe(true);
    expect(cart.warnings.some((w) => w.includes("Cash Strap (41234567890123)"))).toBe(true);

    // Checkout mode omits ?storefront=true
    const checkout = await adapter.buildCartLink(
      "https://ridge.com",
      [{ variantId: "41234567890123", quantity: 1 }],
      { mode: "checkout" }
    );
    expect(checkout.cart_url).toBe("https://ridge.com/cart/41234567890123:1");
  });

  it("canonicalizes apex -> www. and cross-domain 301 redirects (waterdrop.de / yfood.eu pattern) while ignoring checkout subdomains", async () => {
    const fetcher = makeFixtureFetcher({
      // yfood.eu pattern: apex /meta.json returns 200 pointing to www.yfood.eu, which 301s to yfood.com
      "https://yfood.eu/meta.json": {
        status: 200,
        body: {
          id: 21194153,
          name: "yfood",
          currency: "EUR",
          country: "DE",
          domain: "www.yfood.eu",
          myshopify_domain: "yfood-drink.myshopify.com"
        }
      },
      "https://www.yfood.eu/meta.json": {
        status: 200,
        finalUrl: "https://yfood.com/meta.json",
        body: {
          id: 87069032760,
          name: "yfood Labs",
          currency: "EUR",
          country: "DE",
          domain: "yfood.com",
          myshopify_domain: "yfood-labs.myshopify.com"
        }
      },
      "https://yfood.com/search/suggest.json?q=a&resources[type]=product&resources[limit]=1": {
        status: 200,
        body: { resources: { results: { products: [] } } }
      },
      "https://yfood.com/products.json?limit=1": {
        status: 200,
        body: { products: [] }
      },
      "https://yfood.com/search/suggest.json?q=Adventskalender&resources[type]=product&resources[limit]=10": {
        status: 200,
        body: {
          resources: {
            results: {
              products: [
                {
                  id: 500,
                  handle: "adventskalender-2026",
                  title: "yfood Adventskalender",
                  available: true,
                  price: "59.99",
                  url: "/products/adventskalender-2026"
                }
              ]
            }
          }
        }
      },
      "https://yfood.com/products/adventskalender-2026.js": {
        status: 200,
        body: {
          id: 500,
          handle: "adventskalender-2026",
          title: "yfood Adventskalender",
          available: true,
          url: "/products/adventskalender-2026",
          options: ["Title"],
          variants: [
            {
              id: 999000111222,
              title: "Default Title",
              available: true,
              price: 5999,
              option1: "Default Title",
              option2: null,
              option3: null
            }
          ]
        }
      },
      // gymshark.com pattern: meta.json points to checkout subdomain -> must keep gymshark.com
      "https://gymshark.com/meta.json": {
        status: 200,
        body: {
          id: 1,
          name: "Gymshark",
          currency: "USD",
          country: "US",
          domain: "us.checkout.gymshark.com",
          myshopify_domain: "gymsharkusa.myshopify.com"
        }
      },
      "https://gymshark.com/search/suggest.json?q=a&resources[type]=product&resources[limit]=1": {
        status: 200,
        body: { resources: { results: { products: [] } } }
      },
      "https://gymshark.com/products.json?limit=1": {
        status: 200,
        body: { products: [] }
      }
    });

    const adapter = new ShopifyAdapter(new ShopifyClient(fetcher));

    const yfood = await adapter.detect("https://yfood.eu");
    expect(yfood).not.toBeNull();
    expect(yfood!.origin).toBe("https://yfood.com");
    expect(yfood!.name).toBe("yfood Labs");
    expect(yfood!.capabilities.predictiveSearch).toBe(true);

    const search = await adapter.searchProducts("https://yfood.eu", {
      query: "Adventskalender",
      limit: 5
    });
    expect(search.store_origin).toBe("https://yfood.com");
    expect(search.products[0]!.url).toBe("https://yfood.com/products/adventskalender-2026");

    const cart = await adapter.buildCartLink(
      "https://yfood.eu",
      [{ variantId: "999000111222", quantity: 1 }],
      { mode: "cart", verifyHandles: ["adventskalender-2026"] }
    );
    expect(cart.store_origin).toBe("https://yfood.com");
    expect(cart.cart_url).toBe("https://yfood.com/cart/999000111222:1?storefront=true");
    // Single-variant Default Title omits redundant suffix
    expect(cart.items[0]!.title).toBe("yfood Adventskalender");

    const gymshark = await adapter.detect("https://gymshark.com");
    expect(gymshark).not.toBeNull();
    expect(gymshark!.origin).toBe("https://gymshark.com");
  });

  it("extracts handles and locale prefixes from localized subpaths and tries localized .js before root fallback", async () => {
    expect(extractProductPathInfo("https://got-bag.com/de/products/rolltop-2-0?variant=1")).toEqual({
      handle: "rolltop-2-0",
      localePrefix: "/de"
    });
    expect(extractProductPathInfo("https://got-bag.com/en-de/collections/all/products/rolltop-2-0")).toEqual({
      handle: "rolltop-2-0",
      localePrefix: "/en-de"
    });
    expect(extractProductPathInfo("de/products/rolltop-2-0.js")).toEqual({
      handle: "rolltop-2-0",
      localePrefix: "/de"
    });
    expect(extractProductHandle("products/rolltop-2-0")).toBe("rolltop-2-0");

    const fetcher = makeFixtureFetcher({
      "/meta.json": {
        status: 200,
        body: { id: 10, name: "GOT BAG", currency: "EUR", country: "DE", domain: "got-bag.com" }
      },
      "/en/products/rolltop-2-0.js": {
        status: 200,
        body: {
          id: 1001,
          handle: "rolltop-2-0",
          title: "ROLLTOP 2.0 (EN)",
          description: "<p>Waterproof backpack</p>",
          available: true,
          url: "/en/products/rolltop-2-0",
          options: ["Color"],
          variants: [
            {
              id: 777001,
              title: "Black",
              available: true,
              price: 11900,
              option1: "Black",
              option2: null,
              option3: null
            }
          ]
        }
      },
      "/products/fallback-only.js": {
        status: 200,
        body: {
          id: 1002,
          handle: "fallback-only",
          title: "Fallback Product",
          available: true,
          options: ["Size", "Edition"],
          variants: [
            {
              id: 777002,
              title: "One Size",
              available: true,
              price: 2999,
              options: ["M", null, null]
            }
          ]
        }
      }
    });

    const adapter = new ShopifyAdapter(new ShopifyClient(fetcher));

    const localized = await adapter.getProduct(
      "https://got-bag.com",
      "https://got-bag.com/en/products/rolltop-2-0?variant=777001"
    );
    expect(localized.product.title).toBe("ROLLTOP 2.0 (EN)");
    expect(localized.product.variants[0]!.option_values).toEqual(["Black"]);

    // When /de/products/fallback-only.js is 404, gracefully falls back to /products/fallback-only.js
    const fallback = await adapter.getProduct(
      "https://got-bag.com",
      "https://got-bag.com/de/products/fallback-only"
    );
    expect(fallback.product.title).toBe("Fallback Product");
    expect(fallback.product.variants[0]!.option_values).toEqual(["M"]);
    expect(fallback.product.options).toEqual([
      { name: "Size", values: ["M"] },
      { name: "Edition", values: [] }
    ]);
  });

  it("handles German umlauts, special characters, sold-out notices, and oversized non-JSON responses gracefully", async () => {
    expect(matchesSearchQuery("Gebrannte Mandeln – Nuesse Mix", "Nüsse")).toBe(true);
    expect(matchesSearchQuery("Weihnachtsgeschenk MandelgeNUSS – Mandeln", "MandelgeNUSS!")).toBe(true);
    expect(matchesSearchQuery("Adventskalender", "   !!!  ")).toBe(false);
    expect(simplifySearchQueryForRetry("MandelgeNUSS – Set®")).toBe("MandelgeNUSS Set");
    expect(simplifySearchQueryForRetry("Nüsse")).toBe("nuesse");

    const fetcher = makeFixtureFetcher({
      "/meta.json": {
        status: 200,
        body: { id: 42, name: "KERNenergie", currency: "EUR", country: "DE", domain: "kern-energie.com" }
      },
      // Punctuated query returns empty -> adapter retries with simplified query
      "/search/suggest.json?q=MandelgeNUSS%20%E2%80%93%20Set%C2%AE&resources[type]=product&resources[limit]=10": {
        status: 200,
        body: { resources: { results: { products: [] } } }
      },
      "/search/suggest.json?q=MandelgeNUSS%20Set&resources[type]=product&resources[limit]=10": {
        status: 200,
        body: {
          resources: {
            results: {
              products: [
                {
                  id: 301,
                  handle: "weihnachtsgeschenkset-mandelgenuss",
                  title: "Weihnachtsgeschenk MandelgeNUSS",
                  available: false,
                  price: "24.95",
                  url: "/products/weihnachtsgeschenkset-mandelgenuss"
                }
              ]
            }
          }
        }
      },
      // Umlaut query not found in suggest -> falls back to /products.json with umlaut folding
      "/search/suggest.json?q=N%C3%BCsse&resources[type]=product&resources[limit]=10": {
        status: 200,
        body: { resources: { results: { products: [] } } }
      },
      "/search/suggest.json?q=nuesse&resources[type]=product&resources[limit]=10": {
        status: 200,
        body: { resources: { results: { products: [] } } }
      },
      "/products.json?limit=50": {
        status: 200,
        body: {
          products: [
            {
              id: 302,
              handle: "karamellisierte-nuesse",
              title: "Gebrannte Mandeln",
              vendor: "KERNenergie",
              variants: [{ id: 8881, price: "7.95", available: true }]
            }
          ]
        }
      },
      "/products/sold-out-item.js": {
        status: 200,
        body: {
          id: 303,
          handle: "sold-out-item",
          title: "Limited Adventskalender",
          available: false,
          options: ["Color"],
          variants: [
            { id: 9001, title: "Gold", available: false, price: 9900, options: ["Gold"] },
            { id: 9002, title: "Silver", available: false, price: 9900, options: ["Silver"] }
          ]
        }
      }
    });

    const adapter = new ShopifyAdapter(new ShopifyClient(fetcher));

    const retried = await adapter.searchProducts("https://kern-energie.com", {
      query: "MandelgeNUSS – Set®",
      limit: 5
    });
    expect(retried.products).toHaveLength(1);
    expect(retried.notices.some((n) => n.includes("normalized query"))).toBe(true);
    expect(retried.notices.some((n) => n.includes("sold out"))).toBe(true);

    const availableOnly = await adapter.searchProducts("https://kern-energie.com", {
      query: "MandelgeNUSS – Set®",
      limit: 5,
      availableOnly: true
    });
    expect(availableOnly.products).toHaveLength(0);
    expect(availableOnly.notices.some((n) => n.includes("available_only=true"))).toBe(true);

    const umlautFallback = await adapter.searchProducts("https://kern-energie.com", {
      query: "Nüsse",
      limit: 5
    });
    expect(umlautFallback.products).toHaveLength(1);
    expect(umlautFallback.products[0]!.handle).toBe("karamellisierte-nuesse");
    expect(umlautFallback.notices).toContain("Matched via /products.json catalog fallback.");

    const allSoldOutCart = await adapter.buildCartLink(
      "https://kern-energie.com",
      [{ variantId: "9001", quantity: 1 }],
      { mode: "cart", verifyHandles: ["sold-out-item"] }
    );
    expect(
      allSoldOutCart.warnings.some((w) => w.includes("all variants of this product are currently out of stock"))
    ).toBe(true);

    // Oversized HTML response (BODY_TOO_LARGE) is handled gracefully without throwing
    const oversizedAdapter = new ShopifyAdapter(
      new ShopifyClient(async (url) => {
        if (url.endsWith("/cart.js")) {
          return {
            status: 200,
            url,
            contentType: "application/json",
            headers: {},
            bodyBuffer: Buffer.from('{"currency":"USD","items":[]}'),
            bodyText: '{"currency":"USD","items":[]}'
          };
        }
        throw new SsrfError("BODY_TOO_LARGE", "Upstream response exceeded 1048576 bytes");
      })
    );
    const oversizedSearch = await oversizedAdapter.searchProducts("https://anker.com", {
      query: "Powerbank",
      limit: 5
    });
    expect(oversizedSearch.products).toHaveLength(0);
    expect(oversizedSearch.notices.some((n) => n.includes("oversized or non-JSON"))).toBe(true);
  });
});
