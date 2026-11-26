import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { BigCommerceAdapter } from "../src/adapters/bigcommerce/adapter.js";
import { BigCommerceClient } from "../src/adapters/bigcommerce/client.js";
import { UniversalJsonLdAdapter } from "../src/adapters/jsonld/adapter.js";
import { parseProductFromHtml, parseSiteMetadataFromHtml } from "../src/adapters/jsonld/parser.js";
import { MagentoClient } from "../src/adapters/magento/client.js";
import type { AdapterRegistry } from "../src/adapters/registry.js";
import { ShopifyAdapter } from "../src/adapters/shopify/adapter.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import { extractCollectionHandle, extractProductHandle } from "../src/adapters/shopify/normalize.js";
import { ShopwareAdapter } from "../src/adapters/shopware/adapter.js";
import { ShopwareClient } from "../src/adapters/shopware/client.js";
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
  enforceShellSafeHttpsUrl,
  isValidLdhHostname,
  sanitizeGenericVariantId,
  sanitizeNumericVariantId,
  sanitizeSafeHandle
} from "../src/security/identifiers.js";
import { sanitizeSafeUrl } from "../src/security/sanitize.js";
import { validateExternalUrl, type SafeFetchResponse } from "../src/security/ssrf.js";
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
    // Unsafe decoded URL handle and unsafe SKU must never be emitted; fallback IDs are 128-bit product-unique hashes
    expect(parsed!.product.handle).toBe("");
    expect(parsed!.product.id).toMatch(/^product-[0-9a-f]{32}$/);
    expect(parsed!.product.variants[0]!.id).toMatch(/^offer-[0-9a-f]{32}-1$/);

    // Fallback hash is identical regardless of query parameters on the product URL
    const parsedWithQueryA = parseProductFromHtml(
      html,
      "https://merchant.example.com/p/item%24%28id%29%3Bwhoami.html?ref=alpha&color=red"
    );
    const parsedWithQueryB = parseProductFromHtml(
      html,
      "https://merchant.example.com/p/item%24%28id%29%3Bwhoami.html?ref=beta&sort=price"
    );
    expect(parsedWithQueryA!.product.id).toBe(parsed!.product.id);
    expect(parsedWithQueryB!.product.id).toBe(parsed!.product.id);
    expect(parsedWithQueryA!.product.variants[0]!.id).toBe(parsed!.product.variants[0]!.id);
    expect(parsedWithQueryB!.product.variants[0]!.id).toBe(parsed!.product.variants[0]!.id);

    // Legitimate URL handle passes through unchanged
    const okParsed = parseProductFromHtml(
      html.replace("BAD$(id)", "SKU-42"),
      "https://merchant.example.com/p/pack_2.0.html"
    );
    expect(okParsed!.product.handle).toBe("pack_2.0");
    expect(okParsed!.product.variants[0]!.id).toBe("SKU-42");
  });

  it("partitions JSON-LD variantCache per user and uses 128-bit query-stripped fallback IDs across same-last-segment paths", async () => {
    const makeHtml = (name: string, price: string, sku?: string) =>
      `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name,
        ...(sku ? { sku } : {}),
        offers: {
          "@type": "Offer",
          price,
          priceCurrency: "EUR",
          availability: "https://schema.org/InStock"
        }
      })}</script></head><body></body></html>`;

    const urlCatA = "https://merchant.example.com/cat-a/widget";
    const urlCatB = "https://merchant.example.com/cat-b/widget";
    const urlSharedSkuA = "https://merchant.example.com/deals/a";
    const urlSharedSkuB = "https://merchant.example.com/deals/b";

    const mockFetch = async (url: string): Promise<SafeFetchResponse> => {
      let bodyText = makeHtml("Widget A", "29.00");
      if (url.includes("/cat-b/widget")) bodyText = makeHtml("Widget B", "59.00");
      else if (url.includes("/deals/a")) bodyText = makeHtml("Deal A", "19.00", "SHARED-SKU");
      else if (url.includes("/deals/b")) bodyText = makeHtml("Deal B", "99.00", "SHARED-SKU");
      return {
        status: 200,
        url,
        contentType: "text/html; charset=utf-8",
        headers: { "content-type": "text/html; charset=utf-8" },
        bodyBuffer: Buffer.from(bodyText, "utf8"),
        bodyText
      };
    };

    const adapter = new UniversalJsonLdAdapter({ fetcher: mockFetch });

    // 1. Two distinct paths sharing the same last path segment (/cat-a/widget vs /cat-b/widget) get distinct 128-bit IDs
    const prodA = await adapter.getProduct("https://merchant.example.com", `${urlCatA}?src=userA`, {
      concurrencyKey: "user:A"
    });
    const prodB = await adapter.getProduct("https://merchant.example.com", `${urlCatB}?src=userB`, {
      concurrencyKey: "user:B"
    });

    const varA = prodA.product.variants[0]!.id;
    const varB = prodB.product.variants[0]!.id;
    expect(varA).toMatch(/^offer-[0-9a-f]{32}-1$/);
    expect(varB).toMatch(/^offer-[0-9a-f]{32}-1$/);
    expect(varA).not.toBe(varB);
    expect(prodA.product.id).not.toBe(prodB.product.id);

    // Same path with different query params produces the exact same 128-bit fallback ID
    const prodAOtherQuery = await adapter.getProduct(
      "https://merchant.example.com",
      `${urlCatA}?utm_source=different`,
      { concurrencyKey: "user:A" }
    );
    expect(prodAOtherQuery.product.variants[0]!.id).toBe(varA);

    // User A resolves ONLY to User A's product; User B cannot hijack or read User A's bucket
    const cartA = await adapter.buildCartLink(
      "https://merchant.example.com",
      [{ variantId: varA, quantity: 1 }],
      { mode: "cart", concurrencyKey: "user:A" }
    );
    expect(cartA.cart_url).toContain("/cat-a/widget");
    expect(cartA.cart_url).not.toContain("/cat-b/widget");
    expect(cartA.items[0]?.verified).toBe(true);

    // User B trying to use User A's variant ID without verify_handles cannot read User A's cache bucket
    await expect(
      adapter.buildCartLink(
        "https://merchant.example.com",
        [{ variantId: varA, quantity: 1 }],
        { mode: "cart", concurrencyKey: "user:B" }
      )
    ).rejects.toThrow(/without a product URL/i);

    // 2. Even when two products share an identical SKU, User B's getProduct never overwrites User A's cache entry
    await adapter.getProduct("https://merchant.example.com", urlSharedSkuA, {
      concurrencyKey: "user:A"
    });
    await adapter.getProduct("https://merchant.example.com", urlSharedSkuB, {
      concurrencyKey: "user:B"
    });

    const userASkuCart = await adapter.buildCartLink(
      "https://merchant.example.com",
      [{ variantId: "SHARED-SKU", quantity: 1 }],
      { mode: "cart", concurrencyKey: "user:A" }
    );
    expect(userASkuCart.cart_url).toBe(urlSharedSkuA);
    expect(userASkuCart.items[0]?.verified).toBe(true);

    const userBSkuCart = await adapter.buildCartLink(
      "https://merchant.example.com",
      [{ variantId: "SHARED-SKU", quantity: 1 }],
      { mode: "cart", concurrencyKey: "user:B" }
    );
    expect(userBSkuCart.cart_url).toBe(urlSharedSkuB);
    expect(userBSkuCart.items[0]?.verified).toBe(true);
  });

  it("gates searchActionUrl, store.myshopifyDomain, and CLI error messages against quotes and shell metacharacters", async () => {
    const shellUnsafeRe = /['"$()`;|\\<>]/;

    // 1. Unsafe SearchAction templates (quotes, $(...), bad placeholders) are rejected at parse time
    const badSearchHtml = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Unsafe Search Store",
      potentialAction: {
        "@type": "SearchAction",
        target: "https://merchant.example.com/search?q={search_term_string}&x='$(id)'"
      }
    })}</script></head><body></body></html>`;
    expect(parseSiteMetadataFromHtml(badSearchHtml, "https://merchant.example.com/").searchActionTemplate).toBeNull();

    const badPlaceholderHtml = badSearchHtml.replace(
      "https://merchant.example.com/search?q={search_term_string}&x='$(id)'",
      "https://merchant.example.com/search?q={$(whoami)}"
    );
    expect(parseSiteMetadataFromHtml(badPlaceholderHtml, "https://merchant.example.com/").searchActionTemplate).toBeNull();

    // Legitimate SearchAction template with query params and {search_term_string} is preserved
    const goodSearchHtml = badSearchHtml.replace(
      "https://merchant.example.com/search?q={search_term_string}&x='$(id)'",
      "https://merchant.example.com/search?type=product&q={search_term_string}"
    );
    expect(parseSiteMetadataFromHtml(goodSearchHtml, "https://merchant.example.com/").searchActionTemplate).toBe(
      "https://merchant.example.com/search?type=product&q={search_term_string}"
    );

    // 2. sanitizeCliOutput strips unsafe store.myshopifyDomain and unsafe store.capabilities.searchActionUrl
    const cleanedStorePayload = sanitizeCliOutput({
      store: {
        platform: "jsonld",
        origin: "https://merchant.example.com",
        myshopifyDomain: "evil'$(id).myshopify.com",
        capabilities: {
          searchActionUrl: "https://merchant.example.com/search?q={search_term_string}'$(whoami)",
          storefrontMcpEndpoint: "https://evil'host.example.com/api/mcp",
          sitemaps: [
            "https://merchant.example.com/sitemap.xml",
            "https://evil'host.example.com/sitemap.xml"
          ]
        }
      }
    }) as {
      store: {
        origin?: string;
        myshopifyDomain?: string;
        capabilities: {
          searchActionUrl?: string;
          storefrontMcpEndpoint?: string;
          sitemaps?: string[];
        };
      };
    };
    expect(cleanedStorePayload.store.origin).toBe("https://merchant.example.com");
    expect(cleanedStorePayload.store.myshopifyDomain).toBeUndefined();
    expect(cleanedStorePayload.store.capabilities.searchActionUrl).toBeUndefined();
    expect(cleanedStorePayload.store.capabilities.storefrontMcpEndpoint).toBeUndefined();
    expect(cleanedStorePayload.store.capabilities.sitemaps).toEqual([
      "https://merchant.example.com/sitemap.xml"
    ]);
    expect(JSON.stringify(cleanedStorePayload)).not.toMatch(/['$()`;|\\<>]/);

    // Legitimate myshopifyDomain and searchActionUrl survive intact
    const safeStorePayload = sanitizeCliOutput({
      store: {
        platform: "shopify",
        origin: "https://snocks.com",
        myshopifyDomain: "Snocks-Store.myshopify.com",
        capabilities: {
          searchActionUrl: "https://snocks.com/search?q={search_term_string}"
        }
      }
    }) as { store: { myshopifyDomain?: string; capabilities: { searchActionUrl?: string } } };
    expect(safeStorePayload.store.myshopifyDomain).toBe("snocks-store.myshopify.com");
    expect(safeStorePayload.store.capabilities.searchActionUrl).toBe(
      "https://snocks.com/search?q={search_term_string}"
    );

    // 3. Redirect / extraction error in UniversalJsonLdAdapter never leaks raw quotes or shell metacharacters into CLI stderr
    const redirectAdapter = new UniversalJsonLdAdapter({
      fetcher: async (): Promise<SafeFetchResponse> => ({
        status: 200,
        url: "https://merchant.example.com/redirected'$(id);|whoami",
        contentType: "text/html; charset=utf-8",
        headers: { "content-type": "text/html; charset=utf-8" },
        bodyBuffer: Buffer.from("<html><body>No product metadata here</body></html>", "utf8"),
        bodyText: "<html><body>No product metadata here</body></html>"
      })
    });
    const registry = {
      resolve: vi.fn(),
      resolveAdapter: vi.fn(async () => redirectAdapter)
    } as unknown as AdapterRegistry;

    const stdout = makeCapture();
    const stderr = makeCapture();
    const code = await runCli(
      ["product", "merchant.example.com", "https://merchant.example.com/p/item"],
      { registry, stdout, stderr }
    );
    expect(code).toBe(1);
    expect(stdout.text()).toBe("");
    const errPayload = JSON.parse(stderr.text()) as { error: string; message: string };
    expect(errPayload.error).toBe("runtime_error");
    expect(errPayload.message).not.toMatch(shellUnsafeRe);
    expect(errPayload.message).not.toContain("$(id)");
  });

  it("enforces RFC 1123 ASCII LDH hostnames and blocks cross-site canonicalOrigin takeover on redirects", async () => {
    for (const okHost of ["snocks.com", "www.shop-1.example.co.uk", "xn--bcher-kva.example"]) {
      expect(isValidLdhHostname(okHost), okHost).toBe(true);
      expect(validateExternalUrl(`https://${okHost}/`).hostname).toBe(okHost);
    }

    for (const badHost of [
      "evil'quote.example.com",
      "evil$(id).example.com",
      "evil;ls.example.com",
      "evil_under.example.com",
      "-leading.example.com",
      "trailing-.example.com",
      "bad..dots.example.com",
      "has space.example.com"
    ]) {
      expect(isValidLdhHostname(badHost), badHost).toBe(false);
      expect(() => validateExternalUrl(`https://${badHost}/`), badHost).toThrow();
    }

    const htmlResp = (url: string, html: string): SafeFetchResponse => ({
      status: 200,
      url,
      contentType: "text/html; charset=utf-8",
      headers: { "content-type": "text/html; charset=utf-8" },
      bodyBuffer: Buffer.from(html, "utf8"),
      bodyText: html
    });

    // WooCommerce: cross-site redirect must not replace canonicalOrigin, same-site www redirect should
    const wooCross = new WooCommerceAdapter(async (url) => {
      if (url.includes("/wp-json/wc/store/v1/cart")) {
        return makeJsonResp("https://attacker.example.org/wp-json/wc/store/v1/cart", {
          items: [],
          totals: { currency_code: "EUR", currency_minor_unit: 2 }
        });
      }
      return makeJsonResp("https://attacker.example.org/wp-json/", { name: "Hijacked" });
    });
    const wooCrossInfo = await wooCross.detect("https://store.example.com");
    expect(wooCrossInfo?.origin).toBe("https://store.example.com");

    const wooSame = new WooCommerceAdapter(async (url) => {
      if (url.includes("/wp-json/wc/store/v1/cart")) {
        return makeJsonResp("https://www.store.example.com/wp-json/wc/store/v1/cart", {
          items: [],
          totals: { currency_code: "EUR", currency_minor_unit: 2 }
        });
      }
      return makeJsonResp("https://www.store.example.com/wp-json/", { name: "Legit Woo" });
    });
    const wooSameInfo = await wooSame.detect("https://store.example.com");
    expect(wooSameInfo?.origin).toBe("https://www.store.example.com");

    // BigCommerce: cross-site redirect on homepage or /cart.php must not replace canonicalOrigin
    const bcClient = new BigCommerceClient(async () =>
      htmlResp(
        "https://attacker.example.org/",
        '<html><head><title>BC</title></head><body><script>window.BCData = {"currency":"EUR"};</script></body></html>'
      )
    );
    const bcMeta = await bcClient.resolveDomainMetadata("https://bc.example.com");
    expect(bcMeta.origin).toBe("https://bc.example.com");

    // Magento: cross-site redirect must not replace canonicalOrigin
    const magentoClient = new MagentoClient(async () =>
      makeJsonResp("https://attacker.example.org/graphql", {
        data: { storeConfig: { store_name: "M2", default_display_currency_code: "EUR" } }
      })
    );
    const m2Meta = await magentoClient.resolveDomainMetadata("https://m2.example.com");
    expect(m2Meta.origin).toBe("https://m2.example.com");

    // Shopware: cross-site redirect must not replace canonicalOrigin
    const swClient = new ShopwareClient(async (url) => {
      if (url.includes("/store-api/context")) {
        return makeJsonResp("https://attacker.example.org/store-api/context", {
          currency: { isoCode: "EUR" },
          salesChannel: { name: "SW" }
        });
      }
      return htmlResp(
        "https://attacker.example.org/",
        '<html><head><meta name="sw-access-key" content="SWSCABCDEFGHIJKLMNOPQRSTUV" /></head><body>shopware</body></html>'
      );
    });
    const swMeta = await swClient.resolveDomainMetadata("https://sw.example.com");
    expect(swMeta.origin).toBe("https://sw.example.com");
  });

  it("percent-encodes shell-active URL characters across JSON-LD, Shopware, BigCommerce, WooCommerce, and CLI output", async () => {
    const shellUnsafeRe = /['"$()`;|\\<>]/;

    // Direct enforceShellSafeHttpsUrl + sanitizeSafeUrl verification
    const encoded = enforceShellSafeHttpsUrl(
      "https://shop.example.com/p/item'$(id);|test?foo=bar'baz&storefront=true#frag"
    );
    expect(encoded).not.toBeNull();
    expect(encoded).not.toMatch(shellUnsafeRe);
    expect(encoded).toContain("%27");
    expect(encoded).toContain("storefront=true");
    expect(encoded).not.toContain("#frag");

    const preserved = sanitizeSafeUrl(
      "https://shop.example.com/cart/12345:1?storefront=true&discount=SAVE10",
      "https://shop.example.com"
    );
    expect(preserved).toBe("https://shop.example.com/cart/12345:1?storefront=true&discount=SAVE10");
    expect(enforceShellSafeHttpsUrl("http://shop.example.com/p/a")).toBeNull();
    expect(enforceShellSafeHttpsUrl("https://user:pass@shop.example.com/p/a")).toBeNull();
    expect(enforceShellSafeHttpsUrl("https://bad'host.example.com/p/a")).toBeNull();

    // 1. JSON-LD Product.url with single quote / shell chars
    const jsonLdHtml = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Quote Shoe",
      sku: "SHOE-1",
      url: "https://merchant.example.com/p/shoe'$(id);x?color=red'blue",
      offers: {
        "@type": "Offer",
        url: "https://merchant.example.com/p/shoe'offer?size=M'L",
        price: "79.00",
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock"
      }
    })}</script></head><body></body></html>`;
    const jsonLdParsed = parseProductFromHtml(jsonLdHtml, "https://merchant.example.com/p/shoe");
    expect(jsonLdParsed).not.toBeNull();
    expect(jsonLdParsed!.product.url).not.toMatch(shellUnsafeRe);
    expect(jsonLdParsed!.product.variants[0]!.url).not.toMatch(shellUnsafeRe);

    // 2. Shopware seoPathInfo with single quote / shell chars
    const swAdapter = new ShopwareAdapter(
      new ShopwareClient(async (url) => {
        if (url.endsWith("/store-api/context")) {
          return makeJsonResp(url, {
            currency: { isoCode: "EUR" },
            salesChannel: { name: "SW Test" }
          });
        }
        if (url.endsWith("/store-api/search")) {
          return makeJsonResp(url, {
            elements: [
              {
                id: "018f0000000000000000000000000001",
                productNumber: "SW-100",
                name: "SW Quote Item",
                available: true,
                calculatedPrice: { unitPrice: 19.99 },
                seoUrls: [{ seoPathInfo: "detail/item'$(id);ls", isCanonical: true }]
              }
            ]
          });
        }
        return {
          status: 200,
          url,
          contentType: "text/html; charset=utf-8",
          headers: { "content-type": "text/html; charset=utf-8" },
          bodyBuffer: Buffer.from(
            '<html><head><meta name="sw-access-key" content="SWSCABCDEFGHIJKLMNOPQRSTUV" /></head><body>shopware</body></html>',
            "utf8"
          ),
          bodyText:
            '<html><head><meta name="sw-access-key" content="SWSCABCDEFGHIJKLMNOPQRSTUV" /></head><body>shopware</body></html>'
        };
      })
    );
    const swSearch = await swAdapter.searchProducts("https://sw-url.example.com", {
      query: "item",
      limit: 5
    });
    expect(swSearch.products).toHaveLength(1);
    expect(swSearch.products[0]!.url).not.toMatch(shellUnsafeRe);
    expect(swSearch.products[0]!.url).toContain("%27");

    // 3. BigCommerce JSON-LD url with single quote / shell chars
    const bcHtml = `<!doctype html><html><head><title>BC Shop</title><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "BC Quote Item",
      sku: "BC-42",
      url: "https://bc-url.example.com/bc-item'$(whoami);x",
      offers: {
        "@type": "Offer",
        price: "39.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock"
      }
    })}</script></head><body><script>window.BCData = {"product_attributes":{"product_id":42},"currency":"USD"};</script></body></html>`;
    const bcAdapter = new BigCommerceAdapter(
      new BigCommerceClient(async (url) => ({
        status: 200,
        url,
        contentType: "text/html; charset=utf-8",
        headers: { "content-type": "text/html; charset=utf-8" },
        bodyBuffer: Buffer.from(bcHtml, "utf8"),
        bodyText: bcHtml
      }))
    );
    const bcDetail = await bcAdapter.getProduct(
      "https://bc-url.example.com",
      "https://bc-url.example.com/bc-item"
    );
    expect(bcDetail.product.url).not.toMatch(shellUnsafeRe);
    expect(bcDetail.product.url).toContain("%27");

    // 4. WooCommerce permalink with single quote / shell chars
    const wooAdapter = new WooCommerceAdapter(async (url) => {
      if (url.includes("/wp-json/wc/store/v1/cart")) {
        return makeJsonResp(url, { totals: { currency_code: "EUR", currency_minor_unit: 2 } });
      }
      if (url.includes("/wp-json/?_fields=name")) {
        return makeJsonResp(url, { name: "Woo Quote" });
      }
      return makeJsonResp(url, [
        {
          id: 701,
          name: "Woo Quote Item",
          slug: "woo-quote-item",
          permalink: "https://woo-url.example.com/product/item'$(id);x/?ref=a'b",
          type: "simple",
          is_purchasable: true,
          is_in_stock: true,
          prices: { price: "1999", currency_code: "EUR", currency_minor_unit: 2 }
        }
      ]);
    });
    const wooSearch = await wooAdapter.searchProducts("https://woo-url.example.com", {
      query: "quote",
      limit: 5
    });
    expect(wooSearch.products).toHaveLength(1);
    expect(wooSearch.products[0]!.url).not.toMatch(shellUnsafeRe);
    expect(wooSearch.products[0]!.url).toContain("%27");

    // 5. CLI output emission gate re-enforces shell-safe HTTPS URLs and LDH origins on every URL field
    const sanitized = sanitizeCliOutput({
      store_origin: "https://bad'origin.example.com",
      store: { origin: "https://shop.example.com" },
      cart_url: "https://shop.example.com/cart/123:1?storefront=true&note=hi'there",
      products: [
        {
          id: "1",
          handle: "safe-item",
          url: "https://shop.example.com/p/safe'$(id)",
          image_url: "https://shop.example.com/img/a'b.jpg"
        }
      ],
      product: {
        id: "1",
        handle: "safe-item",
        url: "https://shop.example.com/p/safe'$(id)",
        images: ["https://shop.example.com/img/1'2.jpg", "javascript:alert(1)"],
        variants: [{ id: "123", url: "https://shop.example.com/p/safe?v=1'2" }]
      },
      collections: [{ id: "c1", handle: "sale", url: "https://shop.example.com/c/sale'1" }],
      policy_urls: {
        privacy: "https://shop.example.com/policies/privacy'1",
        evil: "https://bad'host.example.com/policies/evil"
      }
    }) as Record<string, unknown>;

    expect(sanitized.store_origin).toBeUndefined();
    expect((sanitized.store as { origin: string }).origin).toBe("https://shop.example.com");
    expect(sanitized.cart_url).toBe("https://shop.example.com/cart/123:1?storefront=true&note=hi%27there");
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("bad'origin");
    expect(serialized).not.toContain("bad'host");
    expect(serialized).not.toContain("javascript:");
    expect(serialized).not.toContain("$(id)");
    expect(serialized).not.toMatch(/'/);
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
      ["/llms.txt", llmsTxt],
      ["/llms-full.txt", llmsFullTxt],
      ["README.md", readmeText],
      ["renderCliHelp()", helpText]
    ] as const) {
      expect(doc, `${name} quoting rule`).toMatch(/single-quote/i);
      expect(doc, `${name} user-named domain rule`).toMatch(/user-named store domain|user-named/i);
      // Catch-all rejection rule
      expect(doc, `${name} catch-all rejection`).toMatch(/reject(?:\s+or\s+|\/)skip\s+any\s+untrusted/i);
      expect(doc, `${name} shell metacharacters`).toMatch(/shell metacharacters/i);
      expect(doc, `${name} unexpected whitespace`).toMatch(/unexpected whitespace/i);
      // Free-text single-quote / argv rule
      expect(doc, `${name} free-text never copy`).toMatch(/never copy store-returned text/i);
      expect(doc, `${name} free-text flags`).toMatch(/--question.*--note/i);
      expect(doc, `${name} free-text single quote argv`).toMatch(/single quote[\s\S]*?argv/i);
      expect(doc, `${name} never raw single quote inside single quotes`).toMatch(/never plac(?:e|ing) raw `?'`? inside/i);
    }

    for (const [name, doc] of [
      ["SKILL.md", skillText],
      ["/SKILL.md", skillHttp],
      ["/llms.txt", llmsTxt]
    ] as const) {
      expect(doc, `${name} single-quoted inspect`).toContain("npx -y shopcart-mcp inspect '<store>'");
      expect(doc, `${name} single-quoted search`).toContain("npx -y shopcart-mcp search '<store>' '<query>'");
      expect(doc, `${name} single-quoted product`).toContain("npx -y shopcart-mcp product '<store>'");
      expect(doc, `${name} single-quoted cart`).toContain("npx -y shopcart-mcp cart '<store>' '<variantId:qty>'");
      expect(doc, `${name} no bare <store> in inspect`).not.toContain("shopcart-mcp inspect <store>");
      expect(doc, `${name} no double-quoted <query>`).not.toContain('"<query>"');
    }

    expect(llmsFullTxt).toContain("npx -y shopcart-mcp inspect '<store>'");

    expect(readmeText).toContain("npx -y shopcart-mcp inspect 'snocks.com'");
    expect(readmeText).toContain("npx -y shopcart-mcp search 'snocks.com' 'socken'");
    expect(readmeText).toContain("npx -y shopcart-mcp product 'snocks.com' '<handle>'");
    expect(readmeText).toContain("npx -y shopcart-mcp cart 'snocks.com' '<variantId>:1'");

    expect(helpText).toContain("shopcart-mcp inspect '<store>'");
    expect(helpText).toContain("shopcart-mcp search '<store>' '<query>'");
    expect(helpText).toContain("shopcart-mcp product '<store>' '<handle-or-url>'");
    expect(helpText).toContain("shopcart-mcp cart '<store>' '<id:qty>'");
  });
});
