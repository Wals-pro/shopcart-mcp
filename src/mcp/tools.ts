import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  isCrossStoreAlias,
  type AffiliateFeedProvider
} from "../adapters/affiliate-feed/index.js";
import { AdapterRegistry } from "../adapters/registry.js";
import {
  AFFILIATE_DISCLOSURE_NOTE,
  applyAttribution,
  loadAttributionConfig,
  type AttributionConfig
} from "../attribution/links.js";
import { SOURCE_NOTICE_CATALOG, SOURCE_NOTICE_PRODUCT } from "../security/sanitize.js";
import { normalizeStoreOrigin, SsrfError } from "../security/ssrf.js";

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  dayKey: string;
  plan: string;
  promoActive: boolean;
  upgradeUrl?: string;
}

export interface ToolRuntimeContext {
  registry: AdapterRegistry;
  attribution?: AttributionConfig;
  affiliateFeed?: AffiliateFeedProvider;
  concurrencyKey?: string;
  consumeQuota?: (toolName: string) => Promise<QuotaCheckResult>;
}

function makeAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  } as const;
}

function jsonContent(payload: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

async function runGuardedTool<T>(
  ctx: ToolRuntimeContext,
  toolName: string,
  fn: () => Promise<T>
) {
  if (ctx.consumeQuota) {
    const quota = await ctx.consumeQuota(toolName);
    if (!quota.allowed) {
      return jsonContent(
        {
          error: "daily_quota_exceeded",
          message: `Daily tool-call limit reached (${quota.used}/${quota.limit} calls on ${quota.dayKey}, plan: ${quota.plan}).`,
          used: quota.used,
          limit: quota.limit,
          day: quota.dayKey,
          plan: quota.plan,
          upgrade_url: quota.upgradeUrl
        },
        true
      );
    }
  }

  try {
    const data = await fn();
    return jsonContent(data, false);
  } catch (err) {
    if (err instanceof SsrfError) {
      return jsonContent(
        {
          error: "url_blocked",
          code: err.code,
          message: err.message
        },
        true
      );
    }
    return jsonContent(
      {
        error: "tool_execution_error",
        message: err instanceof Error ? err.message : String(err)
      },
      true
    );
  }
}

export function registerShoppingTools(server: McpServer, ctx: ToolRuntimeContext): void {
  const attribution = ctx.attribution ?? loadAttributionConfig();
  const affiliateFeed = ctx.affiliateFeed;

  server.registerTool(
    "inspect_store",
    {
      title: "Inspect Store",
      description:
        "Check whether an HTTPS online store URL is a supported public Shopify storefront and return its currency, country, WAF restrictions, and available catalog endpoints.",
      inputSchema: {
        store_url: z
          .string()
          .min(3)
          .max(256)
          .describe("Store domain or HTTPS URL, e.g. 'snocks.com' or 'https://ridge.com'")
      },
      annotations: makeAnnotations("Inspect Store")
    },
    async ({ store_url }) =>
      runGuardedTool(ctx, "inspect_store", async () => {
        const origin = normalizeStoreOrigin(store_url);
        const { store } = await ctx.registry.resolve(origin, ctx.concurrencyKey);
        if (!store) {
          throw new Error(
            `Store '${origin}' could not be detected as a supported Shopify storefront.`
          );
        }
        const notices: string[] = [];
        if (store.wafRestricted) {
          notices.push(
            "Store uses WAF rules that restrict /meta.json or /products.json; keyword search (/search/suggest.json), product detail (/products/<handle>.js), and cart permalinks remain available."
          );
        }
        return { store, notices };
      })
  );

  server.registerTool(
    "search_products",
    {
      title: "Search Store Products",
      description:
        "Search a Shopify storefront's public catalog by keyword (or browse top items when query is omitted) with optional availability and min/max price filters.",
      inputSchema: {
        store_url: z.string().min(3).max(256).describe("Store domain or HTTPS URL"),
        query: z
          .string()
          .max(120)
          .optional()
          .describe(
            "Search keyword(s). Recommended for all stores; required on WAF-restricted stores."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .optional()
          .describe("Max number of products to return (1-20, default 10)."),
        available_only: z
          .boolean()
          .optional()
          .describe("If true, only return products currently marked available."),
        min_price: z
          .number()
          .min(0)
          .optional()
          .describe("Minimum price filter in store major currency units."),
        max_price: z
          .number()
          .min(0)
          .optional()
          .describe("Maximum price filter in store major currency units.")
      },
      annotations: makeAnnotations("Search Store Products")
    },
    async ({ store_url, query, limit, available_only, min_price, max_price }) =>
      runGuardedTool(ctx, "search_products", async () => {
        const trimmedStore = store_url.trim();
        const feedTarget = affiliateFeed
          ? await affiliateFeed.resolveStoreTarget(trimmedStore, ctx.concurrencyKey)
          : isCrossStoreAlias(trimmedStore)
            ? ({ mode: "all" } as const)
            : null;

        if (feedTarget) {
          if (!affiliateFeed || !affiliateFeed.isConfigured()) {
            return {
              store_origin: "affiliate_feed:unconfigured",
              currency: "EUR",
              source_notice: SOURCE_NOTICE_CATALOG,
              affiliate_disclosure: false,
              total_returned: 0,
              products: [],
              notices: [
                "Cross-store affiliate product feeds are not configured on this instance. Pass a specific online store domain (e.g. 'snocks.com') instead."
              ]
            };
          }

          const feedRes = await affiliateFeed.search({
            query,
            merchant: feedTarget.mode === "merchant" ? feedTarget.merchant : undefined,
            limit: limit ?? 10,
            availableOnly: available_only,
            minPrice: min_price,
            maxPrice: max_price,
            concurrencyKey: ctx.concurrencyKey
          });
          return {
            store_origin:
              feedTarget.mode === "merchant"
                ? `affiliate_feed:${feedTarget.merchant}`
                : "affiliate_feed:awin",
            currency: feedRes.currency,
            source_notice: SOURCE_NOTICE_CATALOG,
            affiliate_disclosure: feedRes.affiliate_disclosure,
            ...(feedRes.disclosure_note ? { disclosure_note: feedRes.disclosure_note } : {}),
            merchants_searched: feedRes.merchants_searched,
            total_returned: feedRes.products.length,
            products: feedRes.products,
            ...(feedRes.notices.length > 0 ? { notices: feedRes.notices } : {})
          };
        }

        const origin = normalizeStoreOrigin(store_url);
        const adapter = ctx.registry.getDefault();
        const result = await adapter.searchProducts(origin, {
          query,
          limit: limit ?? 10,
          availableOnly: available_only,
          minPrice: min_price,
          maxPrice: max_price,
          concurrencyKey: ctx.concurrencyKey
        });

        let anyAffiliate = false;
        let disclosureNote: string | undefined;
        const decoratedProducts = result.products.map((product) => {
          const decorated = applyAttribution(product.url, attribution, { kind: "product" });
          if (decorated.affiliate_disclosure) {
            anyAffiliate = true;
            disclosureNote = disclosureNote ?? decorated.disclosure_note;
          }
          return {
            ...product,
            url: decorated.url
          };
        });

        return {
          store_origin: result.store_origin,
          currency: result.currency,
          source_notice: SOURCE_NOTICE_CATALOG,
          affiliate_disclosure: anyAffiliate,
          ...(anyAffiliate
            ? { disclosure_note: disclosureNote ?? AFFILIATE_DISCLOSURE_NOTE }
            : {}),
          total_returned: decoratedProducts.length,
          products: decoratedProducts,
          ...(result.notices.length > 0 ? { notices: result.notices } : {})
        };
      })
  );

  server.registerTool(
    "get_product",
    {
      title: "Get Product Details & Variants",
      description:
        "Retrieve product details, sanitized description text, options, images, and exact numeric variant IDs, prices, and availability for a Shopify product handle or URL.",
      inputSchema: {
        store_url: z.string().min(3).max(256).describe("Store domain or HTTPS URL"),
        handle_or_url: z
          .string()
          .min(1)
          .max(300)
          .describe("Product handle (e.g. 'rolltop-2-0') or full product URL")
      },
      annotations: makeAnnotations("Get Product Details & Variants")
    },
    async ({ store_url, handle_or_url }) =>
      runGuardedTool(ctx, "get_product", async () => {
        const origin = normalizeStoreOrigin(store_url);
        const adapter = ctx.registry.getDefault();
        const result = await adapter.getProduct(origin, handle_or_url, {
          concurrencyKey: ctx.concurrencyKey
        });
        const decorated = applyAttribution(result.product.url, attribution, { kind: "product" });
        return {
          store_origin: result.store_origin,
          currency: result.currency,
          source_notice: SOURCE_NOTICE_PRODUCT,
          affiliate_disclosure: decorated.affiliate_disclosure,
          ...(decorated.affiliate_disclosure
            ? { disclosure_note: decorated.disclosure_note ?? AFFILIATE_DISCLOSURE_NOTE }
            : {}),
          product: {
            ...result.product,
            url: decorated.url
          }
        };
      })
  );

  server.registerTool(
    "create_cart_link",
    {
      title: "Create Store Cart Link",
      description:
        "Generate a read-only Shopify browser cart or checkout permalink from exact numeric variant IDs and quantities, optionally verifying live availability via verify_handles.",
      inputSchema: {
        store_url: z.string().min(3).max(256).describe("Store domain or HTTPS URL"),
        items: z
          .array(
            z.object({
              variant_id: z
                .string()
                .regex(/^\d{1,20}$/, "variant_id must be a numeric Shopify variant ID"),
              quantity: z.number().int().min(1).max(99)
            })
          )
          .min(1)
          .max(20)
          .describe("Line items with numeric variant_id from get_product and quantity (1..99)"),
        mode: z
          .enum(["cart", "checkout"])
          .default("cart")
          .optional()
          .describe(
            "'cart' opens merchant storefront cart (?storefront=true, default); 'checkout' goes directly to checkout."
          ),
        discount_code: z
          .string()
          .regex(/^[A-Za-z0-9._-]{1,64}$/, "discount_code contains invalid characters")
          .optional()
          .describe("Optional discount/coupon code supplied by the user"),
        verify_handles: z
          .array(z.string().min(1).max(200))
          .max(10)
          .optional()
          .describe(
            "Recommended: product handles whose variants should be verified for stock and price via /products/<handle>.js"
          )
      },
      annotations: makeAnnotations("Create Store Cart Link")
    },
    async ({ store_url, items, mode, discount_code, verify_handles }) =>
      runGuardedTool(ctx, "create_cart_link", async () => {
        const origin = normalizeStoreOrigin(store_url);
        const adapter = ctx.registry.getDefault();
        const result = await adapter.buildCartLink(
          origin,
          items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity })),
          {
            mode: mode ?? "cart",
            discountCode: discount_code,
            verifyHandles: verify_handles,
            concurrencyKey: ctx.concurrencyKey
          }
        );
        const decorated = applyAttribution(result.cart_url, attribution, { kind: "cart" });
        return {
          ...result,
          cart_url: decorated.url,
          affiliate_disclosure: decorated.affiliate_disclosure,
          ...(decorated.affiliate_disclosure
            ? { disclosure_note: decorated.disclosure_note ?? AFFILIATE_DISCLOSURE_NOTE }
            : {})
        };
      })
  );

  if (affiliateFeed?.isConfigured()) {
    server.registerTool(
      "search_affiliate_deals",
      {
        title: "Search Partner Deals & EAN Prices",
        description:
          "Search active Awin partner product feeds across multiple EU/DACH merchants by keyword or EAN/GTIN barcode, returning normalized prices, availability, and disclosed partner links.",
        inputSchema: {
          query: z
            .string()
            .max(120)
            .optional()
            .describe("Product keyword(s) or model name, e.g. 'Sony WH-1000XM5'"),
          ean: z
            .string()
            .regex(/^[\d\s-]{8,20}$/, "ean must be an 8-14 digit EAN/GTIN barcode")
            .optional()
            .describe("Optional 8-14 digit EAN/GTIN barcode for exact cross-merchant price comparison"),
          merchant: z
            .string()
            .max(100)
            .optional()
            .describe("Optional merchant filter, e.g. 'MediaMarkt', 'OTTO', 'Cyberport', 'Alternate', 'Decathlon'"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(10)
            .optional()
            .describe("Max number of offers to return (1-20, default 10)."),
          available_only: z
            .boolean()
            .optional()
            .describe("If true, only return offers currently marked in stock."),
          min_price: z.number().min(0).optional().describe("Minimum price filter in major currency units."),
          max_price: z.number().min(0).optional().describe("Maximum price filter in major currency units.")
        },
        annotations: makeAnnotations("Search Partner Deals & EAN Prices")
      },
      async ({ query, ean, merchant, limit, available_only, min_price, max_price }) =>
        runGuardedTool(ctx, "search_affiliate_deals", async () => {
          const result = await affiliateFeed.search({
            query,
            ean,
            merchant,
            limit: limit ?? 10,
            availableOnly: available_only,
            minPrice: min_price,
            maxPrice: max_price,
            concurrencyKey: ctx.concurrencyKey
          });
          return {
            provider: result.provider,
            currency: result.currency,
            source_notice: SOURCE_NOTICE_CATALOG,
            affiliate_disclosure: result.affiliate_disclosure,
            ...(result.disclosure_note ? { disclosure_note: result.disclosure_note } : {}),
            merchants_searched: result.merchants_searched,
            total_returned: result.products.length,
            products: result.products,
            ...(result.notices.length > 0 ? { notices: result.notices } : {})
          };
        })
    );
  }
}
