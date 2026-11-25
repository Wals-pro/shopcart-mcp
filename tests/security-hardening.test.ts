import { describe, expect, it } from "vitest";
import { keepaSearchProducts } from "../src/adapters/amazon/keepa.js";
import { resolveAmazonMarketplace, tryExtractAsin } from "../src/adapters/amazon/marketplaces.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { ShopifyAdapter } from "../src/adapters/shopify/adapter.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import { WooCommerceAdapter } from "../src/adapters/woocommerce/adapter.js";
import { decodeWooEntities, sanitizeWooDescription, sanitizeWooText } from "../src/adapters/woocommerce/normalize.js";
import { stripHiddenStyleBlocksLinear, stripHtmlToText } from "../src/security/sanitize.js";
import type { SafeFetchOptions, SafeFetchResponse } from "../src/security/ssrf.js";

function makeResponse(url: string, status: number, body: unknown): SafeFetchResponse {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return {
    url,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    bodyText
  };
}

describe("Wave 3 security hardening regressions", () => {
  it("strips adversarial ReDoS HTML, hidden-style, comment, and shortcode payloads in linear time", () => {
    const start = performance.now();

    const quarticHiddenPayload =
      `${'<div style="opacity:0;opacity:0;opacity:0;display:none;" '.repeat(4000)}${"x".repeat(50_000)}`;
    const unclosedSvgPayload = `${"<svg>".repeat(40_000)}safe tail`;
    const bareLtPayload = `${"<".repeat(100_000)}safe`;
    const unclosedShortcodePayload = `${"[vc_".repeat(40_000)}visible text`;
    const unclosedCommentPayload = `${"<!--".repeat(40_000)}tail`;

    stripHiddenStyleBlocksLinear(quarticHiddenPayload);
    stripHtmlToText(unclosedSvgPayload, 500);
    stripHtmlToText(bareLtPayload, 500);
    stripHtmlToText(unclosedCommentPayload, 500);
    sanitizeWooText(unclosedSvgPayload, 200);
    sanitizeWooDescription(unclosedShortcodePayload, null, 500);

    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(500);
  });

  it("prevents cross-origin redirect cache poisoning across AdapterRegistry and ShopifyClient", async () => {
    const fetcher = async (url: string, _opts?: SafeFetchOptions): Promise<SafeFetchResponse> => {
      // Attacker domain redirects /meta.json to a victim WooCommerce product JSON with `{ id: 123 }`
      if (url === "https://evil.example/meta.json") {
        return makeResponse(
          "https://victim-woo.example/wp-json/wc/store/v1/products/123",
          200,
          { id: 123, name: "Victim Bike" }
        );
      }
      if (url === "https://victim-woo.example/wp-json/wc/store/v1/products?per_page=1") {
        return makeResponse(url, 200, [
          {
            id: 123,
            name: "Victim Bike",
            slug: "victim-bike",
            type: "simple",
            is_in_stock: true,
            is_purchasable: true,
            prices: { price: "50000", regular_price: "50000", currency_code: "EUR", currency_minor_unit: 2 }
          }
        ]);
      }
      if (url === "https://victim-woo.example/wp-json/wc/store/v1/cart") {
        return makeResponse(url, 200, {
          items: [],
          totals: { currency_code: "EUR", currency_minor_unit: 2 },
          shipping_address: { country: "DE" }
        });
      }
      return makeResponse(url, 404, { error: "not_found" });
    };

    const shopifyAdapter = new ShopifyAdapter(new ShopifyClient(fetcher));
    const wooAdapter = new WooCommerceAdapter(fetcher);
    const registry = new AdapterRegistry([shopifyAdapter, wooAdapter]);

    // Attacker probes evil.example first
    await registry.resolve("https://evil.example");

    // Victim WooCommerce store MUST still resolve cleanly to WooCommerceAdapter, never ShopifyAdapter
    const victimAdapter = await registry.resolveAdapter("https://victim-woo.example");
    expect(victimAdapter.platform).toBe("woocommerce");
  });

  it("sanitizes and bounds Shopify id fields and enforces listCollections limit", async () => {
    const smuggledId = `12345\u{E0049}\u{E0067}\u{E006E}${"A".repeat(200)}`;
    const fetcher = async (url: string): Promise<SafeFetchResponse> => {
      if (url.endsWith("/meta.json")) {
        return makeResponse(url, 200, { name: "Test Shop", currency: "EUR", country: "DE" });
      }
      if (url.includes("/collections.json")) {
        return makeResponse(url, 200, {
          collections: [
            { id: smuggledId, handle: "sale", title: "Sale", products_count: 10 },
            { id: "2", handle: "new", title: "New", products_count: 5 },
            { id: "3", handle: "extra", title: "Extra", products_count: 3 }
          ]
        });
      }
      return makeResponse(url, 404, {});
    };

    const adapter = new ShopifyAdapter(new ShopifyClient(fetcher));
    const result = await adapter.listCollections("https://clean.example", { limit: 2 });
    expect(result.collections).toHaveLength(2);
    expect(result.collections[0]!.id.length).toBeLessThanOrEqual(64);
    expect(result.collections[0]!.id).not.toContain("\u{E0049}");
  });

  it("blocks Object.prototype allowlist bypasses in Amazon marketplace and Woo entity lookups", () => {
    expect(resolveAmazonMarketplace("constructor")).toBeNull();
    expect(resolveAmazonMarketplace("m.constructor")).toBeNull();
    expect(resolveAmazonMarketplace("smile.__proto__")).toBeNull();
    expect(tryExtractAsin("https://m.constructor/dp/B08N5WRWNW")).toBeNull();
    expect(tryExtractAsin("//evil.example/dp/B08N5WRWNW")).toBeNull();
    expect(decodeWooEntities("&constructor;&toString;")).toBe("&constructor;&toString;");
  });

  it("redacts KEEPA_API_KEY from thrown Keepa fetch errors", async () => {
    const marketplace = resolveAmazonMarketplace("https://amazon.de")!;
    const secretKey = "keepa-super-secret-key-9999";
    await expect(
      keepaSearchProducts({
        marketplace,
        query: "powerbank",
        limit: 5,
        apiKey: secretKey,
        fetcher: async (url) => {
          throw new Error(`network error reaching ${url}`);
        }
      })
    ).rejects.toThrow(/\[REDACTED\]/);

    await expect(
      keepaSearchProducts({
        marketplace,
        query: "powerbank",
        limit: 5,
        apiKey: secretKey,
        fetcher: async (url) => {
          throw new Error(`network error reaching ${url}`);
        }
      })
    ).rejects.not.toThrow(secretKey);
  });
});
