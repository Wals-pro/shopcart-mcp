import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "../src/adapters/registry.js";
import type { StoreAdapter, StoreInfo } from "../src/adapters/types.js";
import {
  CLI_VERSION,
  CliUsageError,
  parseCartItemSpec,
  parseCliArgs,
  runCli
} from "../src/cli/oneshot.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_TS_PATH = path.join(ROOT_DIR, "src", "cli.ts");

function makeCaptureStream() {
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

function makeMockRegistry(platform: "shopify" | "woocommerce" | "jsonld" = "shopify") {
  const store: StoreInfo = {
    platform,
    origin: "https://shop.example.com",
    name: "Example Store",
    currency: "EUR",
    country: "DE",
    myshopifyDomain: platform === "shopify" ? "example-store.myshopify.com" : null,
    wafRestricted: false,
    capabilities: {
      predictiveSearch: platform === "shopify",
      productCatalogJson: platform === "shopify",
      storefrontMcp: false,
      storefrontMcpTools: []
    }
  };

  const adapter: StoreAdapter = {
    platform,
    detect: vi.fn(async () => store),
    ...(platform === "shopify"
      ? {
          listCollections: vi.fn(async (origin, opts) => ({
            store_origin: origin,
            waf_restricted: false,
            total_collections: 2,
            highlighted_deals: [
              {
                id: "col-sale",
                handle: "sale",
                title: "Sale",
                products_count: 14,
                url: `${origin}/collections/sale`,
                is_deal_collection: true,
                deal_tags: ["sale"]
              }
            ],
            collections: opts?.dealsOnly
              ? [
                  {
                    id: "col-sale",
                    handle: "sale",
                    title: "Sale",
                    products_count: 14,
                    url: `${origin}/collections/sale`,
                    is_deal_collection: true,
                    deal_tags: ["sale"]
                  }
                ]
              : [
                  {
                    id: "col-sale",
                    handle: "sale",
                    title: "Sale",
                    products_count: 14,
                    url: `${origin}/collections/sale`,
                    is_deal_collection: true,
                    deal_tags: ["sale"]
                  },
                  {
                    id: "col-all",
                    handle: "all",
                    title: "All Products",
                    products_count: 120,
                    url: `${origin}/collections/all`,
                    is_deal_collection: false,
                    deal_tags: []
                  }
                ],
            notices: []
          })),
          getStorePolicies: vi.fn(async (origin) => ({
            store_origin: origin,
            shipping_policy_excerpt: "Free shipping over €50 via DHL.",
            return_policy_excerpt: "30-day free returns.",
            hints: {
              free_shipping_threshold: "€50",
              return_window_days: 30,
              return_window_text: "30 days",
              free_returns: true,
              delivery_time_text: "2-3 business days",
              shipping_carriers: ["DHL"]
            },
            policy_urls: {
              shipping: `${origin}/policies/shipping-policy`,
              returns: `${origin}/policies/refund-policy`
            },
            notices: []
          }))
        }
      : {}),
    searchProducts: vi.fn(async (origin, opts) => ({
      store_origin: origin,
      currency: "EUR",
      collection: opts.collection,
      sort_by: opts.sortBy,
      products: [
        {
          id: "prod-1",
          handle: "sneaker-socken-weiss",
          title: "Sneaker Socken | White",
          vendor: "SNOCKS",
          product_type: "Socks",
          available: true,
          price: { amount: 22.49, formatted: "22.49 EUR", currency: "EUR" },
          price_min: { amount: 22.49, formatted: "22.49 EUR", currency: "EUR" },
          price_max: { amount: 22.49, formatted: "22.49 EUR", currency: "EUR" },
          compare_at_price: { amount: 29.99, formatted: "29.99 EUR", currency: "EUR" },
          discount_percent: 25,
          savings: { amount: 7.5, formatted: "7.50 EUR", currency: "EUR" },
          url: `${origin}/products/sneaker-socken-weiss`,
          image_url: `${origin}/img/socks.jpg`
        }
      ],
      notices: []
    })),
    getProduct: vi.fn(async (origin, handleOrUrl) => ({
      store_origin: origin,
      currency: "EUR",
      product: {
        id: "prod-1",
        handle: handleOrUrl,
        title: "Sneaker Socken | White",
        vendor: "SNOCKS",
        product_type: "Socks",
        description_text: "Organic cotton sneaker socks.",
        available: true,
        url: `${origin}/products/${handleOrUrl}`,
        options: [{ name: "Size", values: ["43-46"] }],
        images: [],
        variants: [
          {
            id: "44434567725323",
            title: "43-46",
            sku: "SN-W-4346",
            available: true,
            price: { amount: 22.49, formatted: "22.49 EUR", currency: "EUR" },
            compare_at_price: null,
            option_values: ["43-46"]
          }
        ]
      }
    })),
    buildCartLink: vi.fn(async (origin, items, opts) => {
      const lineSpec = items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
      const qs = new URLSearchParams();
      if (opts.mode === "cart") qs.set("storefront", "true");
      if (opts.discountCode) qs.set("discount", opts.discountCode);
      const cartUrl =
        platform === "shopify"
          ? `${origin}/cart/${lineSpec}?${qs.toString()}`
          : `${origin}/?add-to-cart=${items[0]!.variantId}&quantity=${items[0]!.quantity}`;
      return {
        store_origin: origin,
        cart_url: cartUrl,
        mode: opts.mode,
        items: items.map((i) => ({
          variant_id: i.variantId,
          quantity: i.quantity,
          verified: Boolean(opts.verifyHandles?.length)
        })),
        warnings: [],
        next_step: "Review and pay in your browser."
      };
    })
  };

  const registry = {
    resolve: vi.fn(async () => ({ adapter, store })),
    resolveAdapter: vi.fn(async () => adapter)
  } as unknown as AdapterRegistry;

  return { registry, adapter, store };
}

function runSpawnedCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI_TS_PATH, ...args], {
      cwd: ROOT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout += d;
    });
    child.stderr.on("data", (d: string) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("One-Shot CLI argument parsing & validation", () => {
  it("parses all subcommands and flags cleanly (including --flag=value syntax)", () => {
    expect(parseCliArgs(["inspect", "snocks.com", "--json"])).toEqual({
      kind: "inspect",
      store: "snocks.com",
      json: true
    });

    expect(
      parseCliArgs([
        "search",
        "snocks.com",
        "socken",
        "--limit",
        "5",
        "--sort=discount_desc",
        "--collection",
        "sale",
        "--min-price",
        "10",
        "--max-price=50.5",
        "--available",
        "--json"
      ])
    ).toEqual({
      kind: "search",
      store: "snocks.com",
      query: "socken",
      collection: "sale",
      sort: "discount_desc",
      limit: 5,
      minPrice: 10,
      maxPrice: 50.5,
      availableOnly: true,
      json: true
    });

    expect(parseCliArgs(["product", "snocks.com", "sneaker-socken-weiss"])).toEqual({
      kind: "product",
      store: "snocks.com",
      handleOrUrl: "sneaker-socken-weiss",
      json: false
    });

    expect(
      parseCliArgs(["policies", "snocks.com", "--topic", "returns", "--question", "Kostenlose Retoure?"])
    ).toEqual({
      kind: "policies",
      store: "snocks.com",
      topic: "returns",
      question: "Kostenlose Retoure?",
      json: false
    });

    expect(parseCliArgs(["collections", "snocks.com", "--limit", "15", "--deals-only"])).toEqual({
      kind: "collections",
      store: "snocks.com",
      limit: 15,
      dealsOnly: true,
      json: false
    });

    expect(
      parseCliArgs([
        "cart",
        "snocks.com",
        "44434567725323:2",
        "19729211981894:1",
        "--discount",
        "SAVE10",
        "--note",
        "Gift wrap please",
        "--mode",
        "checkout",
        "--verify",
        "sneaker-socken-weiss"
      ])
    ).toEqual({
      kind: "cart",
      store: "snocks.com",
      items: [
        { variantId: "44434567725323", quantity: 2 },
        { variantId: "19729211981894", quantity: 1 }
      ],
      mode: "checkout",
      discountCode: "SAVE10",
      note: "Gift wrap please",
      verifyHandles: ["sneaker-socken-weiss"],
      json: false
    });

    expect(parseCliArgs(["--help"])).toEqual({ kind: "help", topic: undefined, json: false });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help", topic: undefined, json: false });
    expect(parseCliArgs(["help"])).toEqual({ kind: "help", topic: undefined, json: false });
    expect(parseCliArgs(["search", "--help"])).toEqual({ kind: "help", topic: "search", json: false });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version", json: false });
    expect(parseCliArgs(["-v", "--json"])).toEqual({ kind: "version", json: true });
  });

  it("supports URL-based variantIds containing colons (Universal JSON-LD stores)", () => {
    expect(parseCartItemSpec("https://store.example.com/products/widget:3")).toEqual({
      variantId: "https://store.example.com/products/widget",
      quantity: 3
    });
  });

  it("rejects invalid arguments with CliUsageError", () => {
    expect(() => parseCliArgs(["unknown-cmd"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["inspect"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["inspect", "snocks.com", "--bogus"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["search", "snocks.com", "socks", "--limit", "0"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["search", "snocks.com", "socks", "--limit", "25"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["search", "snocks.com", "socks", "--sort", "newest"])).toThrow(CliUsageError);
    expect(() =>
      parseCliArgs(["search", "snocks.com", "socks", "--min-price", "100", "--max-price", "50"])
    ).toThrow(CliUsageError);
    expect(() => parseCliArgs(["cart", "snocks.com"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["cart", "snocks.com", "not-valid"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["cart", "snocks.com", "12345:0"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["cart", "snocks.com", "12345:100"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["cart", "snocks.com", "12345:1", "--discount", "BAD CODE;rm"])).toThrow(
      CliUsageError
    );
    expect(() => parseCliArgs(["cart", "snocks.com", "12345:1", "--note", "x".repeat(501)])).toThrow(
      CliUsageError
    );
  });
});

describe("One-Shot CLI execution (mocked registry, exit codes & SSRF guardrails)", () => {
  it("executes inspect, search, product, policies, collections, and cart with clean JSON on stdout", async () => {
    const { registry, adapter } = makeMockRegistry("shopify");

    // 1. inspect
    {
      const stdout = makeCaptureStream();
      const stderr = makeCaptureStream();
      const code = await runCli(["inspect", "shop.example.com"], { registry, stdout, stderr });
      expect(code).toBe(0);
      expect(stderr.text()).toBe("");
      const data = JSON.parse(stdout.text());
      expect(data.store.platform).toBe("shopify");
      expect(data.store.origin).toBe("https://shop.example.com");
      expect(Array.isArray(data.notices)).toBe(true);
    }

    // 2. search
    {
      const stdout = makeCaptureStream();
      const stderr = makeCaptureStream();
      const code = await runCli(
        [
          "search",
          "shop.example.com",
          "socken",
          "--limit",
          "3",
          "--sort",
          "discount_desc",
          "--min-price",
          "10",
          "--max-price",
          "40",
          "--available",
          "--json"
        ],
        { registry, stdout, stderr }
      );
      expect(code).toBe(0);
      expect(stderr.text()).toBe("");
      const data = JSON.parse(stdout.text());
      expect(data.total_returned).toBe(1);
      expect(data.products[0].handle).toBe("sneaker-socken-weiss");
      expect(data.source_notice).toContain("Untrusted");
      expect(adapter.searchProducts).toHaveBeenCalledWith(
        "https://shop.example.com",
        expect.objectContaining({
          query: "socken",
          limit: 3,
          sortBy: "discount_desc",
          minPrice: 10,
          maxPrice: 40,
          availableOnly: true
        })
      );
    }

    // 3. product
    {
      const stdout = makeCaptureStream();
      const stderr = makeCaptureStream();
      const code = await runCli(["product", "shop.example.com", "sneaker-socken-weiss"], {
        registry,
        stdout,
        stderr
      });
      expect(code).toBe(0);
      expect(stderr.text()).toBe("");
      const data = JSON.parse(stdout.text());
      expect(data.product.variants[0].id).toBe("44434567725323");
      expect(data.source_notice).toContain("Untrusted");
    }

    // 4. policies
    {
      const stdout = makeCaptureStream();
      const stderr = makeCaptureStream();
      const code = await runCli(["policies", "shop.example.com", "--topic", "all"], {
        registry,
        stdout,
        stderr
      });
      expect(code).toBe(0);
      expect(stderr.text()).toBe("");
      const data = JSON.parse(stdout.text());
      expect(data.hints.return_window_days).toBe(30);
      expect(data.policy_urls.shipping).toBe("https://shop.example.com/policies/shipping-policy");
    }

    // 5. collections
    {
      const stdout = makeCaptureStream();
      const stderr = makeCaptureStream();
      const code = await runCli(["collections", "shop.example.com", "--deals-only", "--limit", "10"], {
        registry,
        stdout,
        stderr
      });
      expect(code).toBe(0);
      expect(stderr.text()).toBe("");
      const data = JSON.parse(stdout.text());
      expect(data.collections).toHaveLength(1);
      expect(data.collections[0].handle).toBe("sale");
    }

    // 6. cart with multiple items, --discount, --note, --verify
    {
      const stdout = makeCaptureStream();
      const stderr = makeCaptureStream();
      const code = await runCli(
        [
          "cart",
          "shop.example.com",
          "44434567725323:2",
          "19729211981894:1",
          "--discount",
          "SAVE10",
          "--note",
          "Leave at reception",
          "--verify",
          "sneaker-socken-weiss"
        ],
        { registry, stdout, stderr }
      );
      expect(code).toBe(0);
      expect(stderr.text()).toBe("");
      const data = JSON.parse(stdout.text());
      expect(data.cart_url).toContain("https://shop.example.com/cart/44434567725323:2,19729211981894:1");
      expect(data.cart_url).toContain("storefront=true");
      expect(data.cart_url).toContain("discount=SAVE10");
      expect(data.cart_url).toContain("note=Leave+at+reception");
      expect(data.note).toBe("Leave at reception");
      expect(data.items).toHaveLength(2);
      expect(data.items[0].verified).toBe(true);
    }
  });

  it("handles non-Shopify stores gracefully on policies, collections, and cart --note", async () => {
    const { registry } = makeMockRegistry("woocommerce");

    const polOut = makeCaptureStream();
    expect(await runCli(["policies", "shop.example.com"], { registry, stdout: polOut, stderr: makeCaptureStream() })).toBe(0);
    expect(JSON.parse(polOut.text()).notices[0]).toContain("Shopify storefronts only");

    const colOut = makeCaptureStream();
    expect(await runCli(["collections", "shop.example.com"], { registry, stdout: colOut, stderr: makeCaptureStream() })).toBe(0);
    expect(JSON.parse(colOut.text()).notices[0]).toContain("Shopify storefronts only");

    const cartOut = makeCaptureStream();
    expect(
      await runCli(["cart", "shop.example.com", "123:1", "--note", "Gift"], {
        registry,
        stdout: cartOut,
        stderr: makeCaptureStream()
      })
    ).toBe(0);
    const cartData = JSON.parse(cartOut.text());
    expect(cartData.cart_url).not.toContain("note=");
    expect(cartData.warnings[0]).toContain("Shopify permalinks");
  });

  it("enforces SSRF guardrails (exit 1 on stderr, empty stdout) and usage errors (exit 2)", async () => {
    const { registry } = makeMockRegistry("shopify");

    for (const badHost of ["http://127.0.0.1", "localhost", "169.254.169.254", "metadata.google.internal"]) {
      const stdout = makeCaptureStream();
      const stderr = makeCaptureStream();
      const code = await runCli(["inspect", badHost], { registry, stdout, stderr });
      expect(code).toBe(1);
      expect(stdout.text()).toBe("");
      const err = JSON.parse(stderr.text());
      expect(err.error).toBe("url_blocked");
    }

    const usageOut = makeCaptureStream();
    const usageErr = makeCaptureStream();
    expect(await runCli(["cart", "shop.example.com", "bad-spec"], { registry, stdout: usageOut, stderr: usageErr })).toBe(2);
    expect(usageOut.text()).toBe("");
    expect(JSON.parse(usageErr.text()).error).toBe("usage_error");
  });
});

describe("CLI process E2E (one-shot flags + zero-arg stdio MCP backward compatibility)", () => {
  it("prints help & version and returns exit code 2 for invalid arguments", async () => {
    const [helpRes, verRes, badRes, ssrfRes] = await Promise.all([
      runSpawnedCli(["--help"]),
      runSpawnedCli(["--version"]),
      runSpawnedCli(["nope"]),
      runSpawnedCli(["inspect", "127.0.0.1"])
    ]);

    expect(helpRes.code).toBe(0);
    expect(helpRes.stderr).toBe("");
    expect(helpRes.stdout).toContain("shopcart-mcp");
    expect(helpRes.stdout).toContain("stdio MCP server");
    for (const cmd of ["inspect", "search", "product", "policies", "collections", "cart"]) {
      expect(helpRes.stdout).toContain(cmd);
    }

    expect(verRes.code).toBe(0);
    expect(verRes.stdout.trim()).toBe(`shopcart-mcp ${CLI_VERSION}`);

    expect(badRes.code).toBe(2);
    expect(badRes.stdout).toBe("");
    expect(JSON.parse(badRes.stderr).error).toBe("usage_error");

    expect(ssrfRes.code).toBe(1);
    expect(ssrfRes.stdout).toBe("");
    expect(JSON.parse(ssrfRes.stderr).error).toBe("url_blocked");
  }, 30_000);

  it("still enters the stdio MCP server mode unchanged when invoked with zero arguments", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI_TS_PATH], {
      cwd: ROOT_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    const responses = new Map<number, Record<string, unknown>>();
    let stdoutBuf = "";
    let stderrBuf = "";

    const waitForId = (id: number, timeoutMs = 8000) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const existing = responses.get(id);
        if (existing) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for stdio MCP response id=${id}. stderr=${stderrBuf}`));
        }, timeoutMs);
        const onData = () => {
          const msg = responses.get(id);
          if (msg) {
            clearTimeout(timer);
            child.stdout.off("data", onData);
            resolve(msg);
          }
        };
        child.stdout.on("data", onData);
      });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      let idx = stdoutBuf.indexOf("\n");
      while (idx !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line) {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (typeof parsed.id === "number") {
            responses.set(parsed.id, parsed);
          }
        }
        idx = stdoutBuf.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuf += chunk;
    });

    try {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "cli-vitest", version: "1.0.0" }
          }
        })}\n`
      );
      const initRes = await waitForId(1);
      expect(initRes.error).toBeUndefined();
      expect((initRes.result as { serverInfo: { name: string } }).serverInfo.name).toBe("shopcart-mcp");

      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
      const toolsRes = await waitForId(2);
      expect(toolsRes.error).toBeUndefined();
      const toolNames = (toolsRes.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
      expect(toolNames).toEqual([
        "inspect_store",
        "list_collections",
        "search_products",
        "get_product",
        "get_store_policies",
        "find_store_discounts",
        "create_cart_link",
        "compare_prices",
        "find_hot_deals",
        "match_visual_product"
      ]);
    } finally {
      child.kill("SIGTERM");
    }
  });
});
