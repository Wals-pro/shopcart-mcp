# Phase 0.2 — Forensic Code & MCP Protocol Diagnosis (Baseline `main` @ `218810e`)

> **Problem statement (Item #101):** In everyday Claude.ai chats with the ShopCart MCP connector active (without manually loading a separate Skill), Claude ignores ShopCart tools for price comparison, deals, secondhand search, store discovery, and shopping tasks — falling back to built-in `web_search` or parametric knowledge.

This diagnosis inspects the exact unaltered `main` branch (`218810e`) across all five MCP surfaces before any productive description/instruction edits are made.

---

## 1. `initialize` → `SERVER_INSTRUCTIONS` (`src/mcp/create-server.ts:12-18`)

- **Size & structure:** ~3,350 characters (~750 tokens) concatenated with `" "` into a **single unbroken paragraph** (no markdown headings, no bullet list, no routing table).
- **Root Cause 1 — Zero "When to use ShopCart vs. `web_search`" trigger framing:**
  - `SERVER_INSTRUCTIONS` explains *how* the 12 tools work sequentially, never *when* to invoke ShopCart instead of built-in `web_search` or general training knowledge.
  - Opening sentence (`L13`): *"ShopCart MCP is an independent read-only shopping assistant for public online storefronts across Amazon, Second-Hand & Refurbished Marketplaces, Shopify..."* — frames the server narrowly as a storefront reader rather than the primary assistant for price comparison, deals, vouchers, secondhand search, and store shopping.
- **Root Cause 2 — Priority inversion & self-contradictory routing rule:**
  - Sentence 2 (`L14`): *"When the user does not specify a particular online store or domain, ALWAYS call `discover_stores` first..."*
  - Directly conflicts with `compare_prices` (buried at item `8)`, ~2,050 chars in), `find_hot_deals` (item `9)`), `match_visual_product` (item `10)`), and `search_secondhand_marketplaces` (item `11)`).
  - For everyday queries without a domain (*"Preisvergleich Sony WH-1000XM5"*, *"Gebrauchtes iPhone 15 Pro in Wien"*, *"Schnäppchen Gaming-Monitor"*), sentence 2 points Claude toward `discover_stores` instead of the specialized cross-merchant tool — or Claude skips ShopCart altogether.
- **Root Cause 3 — English protocol jargon, zero German/everyday intent cues:**
  - Heavy technical terms (`"UCP"`, `"WAF"`, `"Tier-B"`, `"compare-at"`, `"search_handoff"`, `"Schema.org itemCondition"`, `"permalink"`), zero natural German trigger vocabulary (*Preisvergleich, Schnäppchen, Gutschein, gebraucht, Warenkorb, Versandkosten, Rückgabe*).
- **Root Cause 4 — Claude.ai connector weighting:**
  - In Claude.ai Web/Mobile, Claude's built-in system prompt strongly favors `web_search` for current prices/products/deals. When `server.instructions` is a dense wall of text and individual tool descriptions do not aggressively claim user intent, `web_search` wins the tool-routing decision.

---

## 2. All 12 Core MCP Tools (`src/mcp/tools.ts`) — Descriptions, Schemas & Annotations

Core tools registered by default (12 tools; optional 13th `search_affiliate_deals` at `L1658` only when Awin feed is configured — disabled on hosted prod):

| # | Tool Name | Line | `readOnlyHint` | `openWorldHint` | Key Routing Defect |
|---|---|---|---|---|---|
| 1 | `discover_stores` | `L176` | `true` | `false` | Leads with *"curated, live-verified global online store directory (0 ms in-memory lookup, zero scraping)"* — sounds like a tiny internal catalog rather than *"Use when user asks where to buy / which online stores sell X"*. |
| 2 | `inspect_store` | `L281` | `true` | `true` | Lists 8 platforms + `"WAF restrictions, UCP discovery diagnostics"`; no clear trigger for *"Check a store / what shop system & currency does X use"*. |
| 3 | `list_collections` | `L374` | `true` | `true` | Leads with `"(GET /collections.json)"` and ends with *"Shopify only..."*; technical framing instead of user intent (*browse categories, sales, bestsellers*). |
| 4 | `search_products` | `L433` | `true` | `true` | 430-char run-on sentence enumerating 7 platforms and fallback behavior; buries the core action (*find products in a named store*). |
| 5 | `get_product` | `L601` | `true` | `true` | 410-char sentence listing `handle/slug/url_key, numeric ID, SKU, Shopware UUID, Amazon ASIN`; buries *"always call before confirming size/color or building a cart link"*. |
| 6 | `get_store_policies` | `L709` | `true` | `true` | Leads with *"via native Storefront MCP FAQ search (when supported) plus public /policies endpoints"*; implementation detail before user question (*shipping costs, delivery times, returns*). |
| 7 | `find_store_discounts` | `L777` | `true` | `true` | Buries user intent (*voucher / promo / Gutscheincode for a store*) inside banner-scraping mechanics. |
| 8 | `create_cart_link` | `L813` | **`false` (!)** | `true` | **Annotation bug (`L865-868`):** Sets `readOnlyHint: false, idempotentHint: false` despite its own description stating *"read-only browser cart/checkout permalink ... without mutating server-side carts"* and `README.md:50` / `SERVER_INSTRUCTIONS` claiming all core tools are read-only! Triggers unnecessary confirmation friction in Claude.ai. |
| 9 | `compare_prices` | `L1074` | `true` | `true` | **Self-undermining qualifier:** *"Combines live partner product feed offers (when configured) with instant 1-click regional price comparison links..."* — signals to Claude that it only returns links unless configured, driving Claude straight to `web_search` to "find actual prices". |
| 10 | `find_hot_deals` | `L1236` | `true` | `true` | **Self-undermining qualifier:** *"via the official Awin Publisher Promotions API (when configured) alongside instant 1-click regional deal community search links"* — same escape to `web_search`. |
| 11 | `match_visual_product` | `L1356` | `true` | `true` | Scoped narrowly to *"a user-uploaded photo ... extracted by your vision model"* — misses text descriptions of visual product attributes from a photo/image. |
| 12 | `search_secondhand_marketplaces` | `L1460` | `true` | `true` | Leads with *"Generate verified, pre-filtered search deep-links"* (link generator framing) instead of *"Use whenever the user asks to buy/find used, secondhand, classifieds, vintage, or refurbished items"*. |

### Schema inconsistencies observed
- **Country vs. Region naming drift:** `compare_prices` uses `country` (`DE|AT|CH|UK|FR|US`), `find_hot_deals` uses `region` (`AT|DE|CH|UK|FR|US`), `search_secondhand_marketplaces` uses `region` (`AT|DE|CH|DACH|EU|UK|US`), `discover_stores` uses `country` (free string).
- **Schema payload verbosity:** 12 verbose descriptions + long parameter `.describe()` strings inflate `tools/list` context before the user even speaks.

---

## 3. MCP `prompts/list` (`src/mcp/create-server.ts`)

- **ZERO MCP Prompts registered** (`grep registerPrompt src/` → 0 matches).
- Claude.ai and Claude Desktop natively surface MCP Prompts (`prompts/list`) as discoverable connector actions/slash prompts. Without them, users have zero guided entry points in Claude.ai without installing an external `SKILL.md`.

---

## 4. Tool Response Structure (`src/mcp/tools.ts`)

- **Inconsistent chaining keys:**
  - `discover_stores` emits `hint` (`L273`).
  - `compare_prices` (`L1230`), `find_hot_deals` (`L1350`), `search_secondhand_marketplaces` (`L1652`) emit `agent_guidance`.
  - `create_cart_link` & `match_visual_product` (`src/mcp/visual-match.ts:908`) emit `next_step`.
  - `inspect_store`, `list_collections`, `search_products` (Shopify normal path), `get_product` (Shopify normal path), `get_store_policies`, and `find_store_discounts` emit **NO `next_step`/`agent_guidance` field at all** — breaking multi-step `search_products` → `get_product` → `create_cart_link` chains when no Skill is loaded.
- **Self-sabotaging unconfigured-provider notices:**
  - `compare_prices` (`L1195-1197`) outputs `notices: ["Live partner product feeds are not configured on this instance; returning deterministic 1-click Tier-B price comparison links."]` plus `providers.tier_a_live: { awin_product_feeds: "not_configured", kelkoo: "not_configured" }`.
  - `find_hot_deals` (`L1334-1337`) outputs `live_vouchers: []`, `live_deals: []`, and `awin_promotions: "not_configured"`.
  - Seeing `"not_configured"` and empty arrays invites Claude to mistrust the tool response and run a follow-up `web_search` anyway.
- **Pretty-printed JSON bloat:** `jsonContent` (`L107`) uses `JSON.stringify(payload, null, 2)`, adding ~20–30% token overhead across multi-step tool loops.

---

## 5. Existing Plugin / Skill / Connector Artifacts (Out-of-Sync!)

- **`skills/shopcart-mcp/SKILL.md` (`L10`, `L133`):** Severely outdated — lists only **8 tools**, completely omitting `discover_stores`, `compare_prices`, `find_hot_deals`, and `search_secondhand_marketplaces`.
- **`server.json` (`L5`) & `/.well-known/mcp.json` (`src/app.ts:294-295`):** Server card descriptions mention only storefront search and Shopify/Amazon cart links — zero mention of price comparison, deals, vouchers, secondhand/refurbished, or store discovery.
- **`GEMINI.md`:** Covers `discover_stores` + 8 storefront tools; omits `compare_prices`, `find_hot_deals`, `search_secondhand_marketplaces`.
- **`README.md` (`L50`):** Claims *"All 11 core tools are read-only (`readOnlyHint: true, idempotentHint: true`)"* (actual count is 12 core tools, and `create_cart_link` has `readOnlyHint: false`).
- **`scripts/build-mcpb.mjs` (`L178-240`):** Lists all 12 tools, but mirrors the same implementation-heavy descriptions and has no MCP prompts.
- **`src/web/guides.ts` (`L102`):** Still references *"sechs klar begrenzte Lese-Werkzeuge"* (6 tools) in the German Claude shopping guide.

---

## Summary Hypothesis for Optimization Cycles (Starting After Cycle 0 Baseline)

A normal Claude.ai chat without an external Skill ignores ShopCart MCP because:
1. **`web_search` looks more capable** for prices/deals/secondhand than ShopCart's architecture-heavy, self-undermining tool descriptions (`"(when configured)"`, `"deep-links"`, `"in-memory directory"`).
2. **`SERVER_INSTRUCTIONS` is an unbroken English wall of text** with a priority inversion (`ALWAYS call discover_stores first` before even mentioning `compare_prices`, `find_hot_deals`, or `search_secondhand_marketplaces`) and zero explicit anti-`web_search` routing guidance.
3. **`create_cart_link` has `readOnlyHint: false`**, triggering friction in Claude.ai.
4. **Zero MCP Prompts (`prompts/list`)** exist for native Claude.ai connector discovery.
5. **Tool responses lack consistent `next_step` cues** on core storefront tools and expose `"not_configured"` internals that trigger fallback `web_search` calls.
