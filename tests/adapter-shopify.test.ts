import { describe, expect, it } from "vitest";
import { ShopifyAdapter } from "../src/adapters/shopify/adapter.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import type { SafeFetchResponse } from "../src/security/ssrf.js";

function makeFixtureFetcher(routes: Record<string, { status: number; body: unknown; contentType?: string }>) {
  return async (url: string): Promise<SafeFetchResponse> => {
    const parsed = new URL(url);
    const key = `${parsed.pathname}${parsed.search}`;
    const exact = routes[key] ?? routes[parsed.pathname];
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
      url,
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

    // Checkout mode omits ?storefront=true
    const checkout = await adapter.buildCartLink(
      "https://ridge.com",
      [{ variantId: "41234567890123", quantity: 1 }],
      { mode: "checkout" }
    );
    expect(checkout.cart_url).toBe("https://ridge.com/cart/41234567890123:1");
  });
});
