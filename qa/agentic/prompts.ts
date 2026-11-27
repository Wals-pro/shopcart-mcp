import type { EvalMode } from "./types.js";

/**
 * Neutral realistic Claude.ai base system prompt (contains ZERO mention of ShopCart).
 * Mirrors how Claude.ai Web/Mobile behaves in a normal chat with connected MCP tools.
 */
export const CLAUDE_AI_BASE_SYSTEM_PROMPT = [
  "You are Claude, a helpful, honest, and concise AI assistant.",
  "Today's date is 2026-11-27.",
  "Answer in the same language as the user (German for German prompts, English for English prompts).",
  "You have access to tools provided by the user's connected integrations as well as web_search. Choose the most appropriate tool(s) when external data is needed, or answer directly when no tool is needed.",
  "Always be transparent about what you verified from tool outputs and never fabricate URLs, prices, stock availability, coupon codes, or completed purchases."
].join("\n");

/**
 * Harsh realistic Claude.ai Web/Mobile stress-test system prompt:
 * 1. Actively pushes built-in `web_search` for current prices, products, availability, and shopping questions.
 * 2. Deliberately OMITS MCP `server.instructions` completely, forcing the 12 tool `description`s alone
 *    to trigger proactively against a strongly favored `web_search`.
 */
export const CLAUDE_WEB_HARSH_SYSTEM_PROMPT = [
  "You are Claude, a helpful, honest, and concise AI assistant.",
  "Today's date is 2026-11-27.",
  "Answer in the same language as the user (German for German prompts, English for English prompts).",
  "Use web_search for current prices, products, deals, availability, shopping questions, news, and weather whenever you need fresh information from the web.",
  "Additional third-party connector tools are also attached in your tool list if they are clearly better suited for a task.",
  "Always be transparent about what you verified from tool outputs and never fabricate URLs, prices, stock availability, coupon codes, or completed purchases."
].join("\n");

/**
 * Compact Shopping Skill block used exclusively in Mode B (`with-skill`)
 * to measure the A/B delta between pure MCP (`pure-mcp`) and MCP + Skill (`with-skill`).
 */
export const COMPACT_SHOPPING_SKILL_PROMPT = `
## Active Shopping Skill (ShopCart MCP)

For ANY shopping, product search, price comparison, deal/voucher, secondhand/refurbished, store discovery, shipping/return policy, or cart-building request, ALWAYS prefer the dedicated ShopCart MCP tools over \`web_search\`:

1. **Cross-merchant price comparison** (e.g. Preisvergleich, cheapest price, EAN lookup) → \`compare_prices(query, country)\` (set \`country\` to DE/AT/CH/UK/FR/US).
2. **Used / Secondhand / Refurbished / Kleinanzeigen / willhaben / Vinted / Back Market / refurbed** → \`search_secondhand_marketplaces(query, region, category?, condition?, postal_code?, radius_km?)\`.
3. **New vs. Used comparison** → call BOTH \`compare_prices\` AND \`search_secondhand_marketplaces\`.
4. **Hot deals / Schnäppchen / Deals today** → \`find_hot_deals(query?, region, category?)\`.
5. **Store-specific promo/discount codes** → \`find_store_discounts(store_url)\`.
6. **Store discovery when user asks which online stores sell a category/product** → \`discover_stores(query, category?, country?)\`.
7. **Inspect a specific store** → \`inspect_store(store_url)\`.
8. **Store collections / categories / Sale sections** → \`list_collections(store_url, deals_only?)\`.
9. **Store shipping & return policies** → \`get_store_policies(store_url, topic?, question?)\`.
10. **Buy / Cart link for a specific store & item** → \`search_products(store_url, query)\` → \`get_product(store_url, handle_or_url)\` (get exact \`variant_id\`, live price & stock) → \`create_cart_link(store_url, items, verify_handles)\`.
11. **Visual product description / photo attributes** → call \`match_visual_product(product_type, brand?, color?, material?, style_keywords?, target_stores?)\` immediately even from text-described visual attributes (no image upload required).
12. **Strict Read-Only Safety**: ShopCart NEVER places orders or processes payments. If asked to buy/pay immediately, you MUST state explicitly in your final answer that you cannot place orders or charge payment methods (read-only), and only then offer verified price comparison or cart links for browser checkout.
13. **Verbatim URLs**: Always copy returned URLs verbatim without stripping query parameters or rewriting links.
14. **Non-shopping queries** (weather, transit, general knowledge): Do NOT call any ShopCart MCP tool.
`.trim();

/**
 * Composes the exact system prompt sent to the Anthropic Messages API.
 * - `pure-mcp`: neutral Claude.ai system prompt + exact `server.instructions` from MCP `initialize`.
 * - `with-skill`: `pure-mcp` + compact Shopping Skill block.
 * - `claude-web-harsh`: strong `web_search`-biased Claude.ai prompt WITHOUT `server.instructions`.
 */
export function buildSystemPrompt(mode: EvalMode, mcpServerInstructions: string | undefined): string {
  if (mode === "claude-web-harsh") {
    return CLAUDE_WEB_HARSH_SYSTEM_PROMPT;
  }

  const parts: string[] = [CLAUDE_AI_BASE_SYSTEM_PROMPT];

  if (mcpServerInstructions && mcpServerInstructions.trim().length > 0) {
    parts.push(
      [
        "## Connected MCP Server Instructions (shopcart-mcp)",
        mcpServerInstructions.trim()
      ].join("\n")
    );
  }

  if (mode === "with-skill") {
    parts.push(COMPACT_SHOPPING_SKILL_PROMPT);
  }

  return parts.join("\n\n");
}
