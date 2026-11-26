import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AdapterRegistry } from "../adapters/registry.js";
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
  server.registerTool(
    "inspect_store",
    {
      title: "Inspect Store",
      description:
        "Check whether an HTTPS online store URL is a supported public storefront (Shopify, BigCommerce, Shopware 6, or Magento 2 / Adobe Commerce) and return its platform, currency, country, WAF restrictions, and available catalog endpoints.",
      inputSchema: {
        store_url: z
          .string()
          .min(3)
          .max(256)
          .describe("Store domain or HTTPS URL, e.g. 'snocks.com', 'ridge.com', or 'coxandcox.co.uk'")
      },
      annotations: makeAnnotations("Inspect Store")
    },
    async ({ store_url }) =>
      runGuardedTool(ctx, "inspect_store", async () => {
        const origin = normalizeStoreOrigin(store_url);
        const { store } = await ctx.registry.resolve(origin, ctx.concurrencyKey);
        if (!store) {
          throw new Error(
            `Store '${origin}' could not be detected as a supported storefront (Shopify, Magento 2, Shopware 6, BigCommerce).`
          );
        }
        const notices: string[] = [];
        if (store.wafRestricted) {
          if (store.platform === "shopify") {
            notices.push(
              "Store uses WAF rules that restrict /meta.json or /products.json; keyword search (/search/suggest.json), product detail (/products/<handle>.js), and cart permalinks remain available."
            );
          } else if (store.platform === "bigcommerce") {
            notices.push(
              "Store uses WAF rules that may restrict catalog pages; direct product URLs and /cart.php?action=add permalinks remain available when you know the product_id or SKU."
            );
          } else if (store.platform === "shopware") {
            notices.push(
              "Store restricts Store API or storefront endpoints via WAF/auth; ShopCart stays strictly read-only and never bypasses access controls."
            );
          } else {
            notices.push(
              "Store restricts GraphQL/catalog endpoints via WAF/auth; ShopCart stays strictly read-only and never bypasses access controls."
            );
          }
        }
        return { store, notices };
      })
  );

  server.registerTool(
    "search_products",
    {
      title: "Search Store Products",
      description:
        "Search a supported storefront's public catalog (Shopify, BigCommerce, Shopware 6, or Magento 2) by keyword (or browse top items when query is omitted) with optional availability and min/max price filters.",
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
        const origin = normalizeStoreOrigin(store_url);
        const adapter = await ctx.registry.resolveAdapter(origin, ctx.concurrencyKey);
        const result = await adapter.searchProducts(origin, {
          query,
          limit: limit ?? 10,
          availableOnly: available_only,
          minPrice: min_price,
          maxPrice: max_price,
          concurrencyKey: ctx.concurrencyKey
        });
        return {
          store_origin: result.store_origin,
          currency: result.currency,
          source_notice: SOURCE_NOTICE_CATALOG,
          total_returned: result.products.length,
          products: result.products,
          ...(result.notices.length > 0 ? { notices: result.notices } : {})
        };
      })
  );

  server.registerTool(
    "get_product",
    {
      title: "Get Product Details & Variants",
      description:
        "Retrieve product details, sanitized description text, options, images, and exact variant/SKU IDs, prices, discounts, and availability for a supported store product handle, SKU, ID, or URL.",
      inputSchema: {
        store_url: z.string().min(3).max(256).describe("Store domain or HTTPS URL"),
        handle_or_url: z
          .string()
          .min(1)
          .max(300)
          .describe("Product handle/slug/url_key, SKU, Shopware UUID, or full product URL")
      },
      annotations: makeAnnotations("Get Product Details & Variants")
    },
    async ({ store_url, handle_or_url }) =>
      runGuardedTool(ctx, "get_product", async () => {
        const origin = normalizeStoreOrigin(store_url);
        const adapter = await ctx.registry.resolveAdapter(origin, ctx.concurrencyKey);
        const result = await adapter.getProduct(origin, handle_or_url, {
          concurrencyKey: ctx.concurrencyKey
        });
        return {
          store_origin: result.store_origin,
          currency: result.currency,
          source_notice: SOURCE_NOTICE_PRODUCT,
          product: result.product
        };
      })
  );

  server.registerTool(
    "create_cart_link",
    {
      title: "Create Store Cart Link",
      description:
        "Generate a read-only browser cart permalink (Shopify /cart/<id>:<qty>, BigCommerce /cart.php?action=add&product_id=<id>&qty=<qty>) or verified direct product link(s) (Shopware 6, Magento 2) without mutating server-side carts.",
      inputSchema: {
        store_url: z.string().min(3).max(256).describe("Store domain or HTTPS URL"),
        items: z
          .array(
            z.object({
              variant_id: z
                .string()
                .regex(
                  /^[A-Za-z0-9._:/-]{1,128}$/,
                  "variant_id must be a valid numeric variant/product ID, SKU, or platform product identifier"
                ),
              quantity: z.number().int().min(1).max(99)
            })
          )
          .min(1)
          .max(20)
          .describe("Line items with variant_id/product_id/SKU from get_product and quantity (1..99)"),
        mode: z
          .enum(["cart", "checkout"])
          .default("cart")
          .optional()
          .describe(
            "'cart' opens merchant storefront cart (default); 'checkout' goes directly to checkout where supported."
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
            "Recommended: product handles/paths/SKUs whose variants should be verified for stock and price."
          )
      },
      annotations: makeAnnotations("Create Store Cart Link")
    },
    async ({ store_url, items, mode, discount_code, verify_handles }) =>
      runGuardedTool(ctx, "create_cart_link", async () => {
        const origin = normalizeStoreOrigin(store_url);
        const adapter = await ctx.registry.resolveAdapter(origin, ctx.concurrencyKey);
        return adapter.buildCartLink(
          origin,
          items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity })),
          {
            mode: mode ?? "cart",
            discountCode: discount_code,
            verifyHandles: verify_handles,
            concurrencyKey: ctx.concurrencyKey
          }
        );
      })
  );
}
