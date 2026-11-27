import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizeText } from "../security/sanitize.js";

/**
 * Native MCP Prompts (`prompts/list`) surfaced directly in Claude.ai, Claude Desktop,
 * and other MCP clients so shoppers have discoverable 1-click entry points without
 * needing an external skill file.
 */
export function registerShoppingPrompts(server: McpServer): void {
  server.registerPrompt(
    "compare-prices",
    {
      title: "Compare Prices Across Merchants",
      description:
        "Compare prices for any product or EAN/GTIN across regional price-comparison portals (Geizhals, idealo, billiger.de, Toppreise.ch, Google Shopping) and live partner offers.",
      argsSchema: {
        product: z.string().min(1).max(200).describe("Product name, model, or 8-14 digit EAN/GTIN"),
        country: z
          .enum(["DE", "AT", "CH", "UK", "FR", "US"])
          .optional()
          .describe("Target country (DE, AT, CH, UK, FR, US)")
      }
    },
    ({ product, country }) => {
      const safeProduct = sanitizeText(product, 200);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Compare prices for "${safeProduct}"${country ? ` in ${country}` : ""} using ShopCart's compare_prices tool. Present every verified comparison link verbatim (do not strip query parameters) and summarize the best next steps without placing any order.`
            }
          }
        ]
      };
    }
  );

  server.registerPrompt(
    "find-secondhand",
    {
      title: "Search Second-Hand & Refurbished Marketplaces",
      description:
        "Find used, local classifieds, vintage, or refurbished listings across up to 16 marketplaces (willhaben, Kleinanzeigen, refurbed, Back Market, Vinted, eBay, Ricardo.ch, rebuy, etc.).",
      argsSchema: {
        product: z.string().min(1).max(200).describe("Product, brand, or model to search"),
        region: z
          .enum(["AT", "DE", "CH", "DACH", "EU", "UK", "US"])
          .optional()
          .describe("Target region (default DACH)"),
        postal_code: z
          .string()
          .max(12)
          .optional()
          .describe("Optional postal code (e.g. 5-digit German PLZ for local Kleinanzeigen radius)")
      }
    },
    ({ product, region, postal_code }) => {
      const safeProduct = sanitizeText(product, 200);
      const safePostal = postal_code ? sanitizeText(postal_code, 12) : "";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Find secondhand or refurbished options for "${safeProduct}"${region ? ` in region ${region}` : ""}${safePostal ? ` near postal code ${safePostal}` : ""} using search_secondhand_marketplaces. Copy all returned marketplace links verbatim.`
            }
          }
        ]
      };
    }
  );

  server.registerPrompt(
    "hunt-deals",
    {
      title: "Find Hot Deals & Vouchers",
      description:
        "Discover active deals, promotions, and regional deal communities (mydealz, Preisjäger, HotUKDeals, Dealabs, Slickdeals) for a product or category.",
      argsSchema: {
        topic: z.string().min(1).max(200).describe("Product, brand, or category to find deals for"),
        region: z
          .enum(["AT", "DE", "CH", "UK", "FR", "US"])
          .optional()
          .describe("Target region (default DE)")
      }
    },
    ({ topic, region }) => {
      const safeTopic = sanitizeText(topic, 200);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Find current hot deals, vouchers, and active promotions for "${safeTopic}"${region ? ` in ${region}` : ""} using find_hot_deals. Copy all returned deal links verbatim and never invent coupon codes.`
            }
          }
        ]
      };
    }
  );

  server.registerPrompt(
    "shop-and-build-cart",
    {
      title: "Search Store & Build Verified Cart Link",
      description:
        "Search a specific online store, verify live variants, sizes, prices, and stock, check discounts, and build a verified browser cart link (never places orders or processes payments).",
      argsSchema: {
        store_url: z.string().min(3).max(256).describe("Store domain or HTTPS URL (e.g. allbirds.com)"),
        item: z.string().min(1).max(200).describe("Product, size/color, and quantity you want")
      }
    },
    ({ store_url, item }) => {
      const safeStore = sanitizeText(store_url, 256);
      const safeItem = sanitizeText(item, 200);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Search "${safeStore}" for "${safeItem}" using search_products, verify exact variant IDs, live price, and stock via get_product, and generate a verified browser cart link via create_cart_link with verify_handles. Remind me to review and complete checkout in my browser.`
            }
          }
        ]
      };
    }
  );

  server.registerPrompt(
    "discover-shopping-stores",
    {
      title: "Discover Verified Online Stores",
      description:
        "Find verified online shops by product category, niche, or region from ShopCart's curated global store directory.",
      argsSchema: {
        query: z.string().min(1).max(200).describe("Product or store category (DE or EN)"),
        country: z
          .string()
          .max(32)
          .optional()
          .describe("Optional country/region filter (DE, AT, CH, DACH, EU, UK, US)")
      }
    },
    ({ query, country }) => {
      const safeQuery = sanitizeText(query, 200);
      const safeCountry = country ? sanitizeText(country, 32) : "";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Find verified online stores for "${safeQuery}"${safeCountry ? ` in ${safeCountry}` : ""} using discover_stores and summarize the best matching shops with their URLs.`
            }
          }
        ]
      };
    }
  );
}
