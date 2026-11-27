# Phase 0.2 — Forensic Code & MCP Protocol Diagnosis (Baseline `main` @ `218810e`)

> **Live Feedback (Item #101):**
> - **Anthropic Directory Status (Confirmed):** All 12 core ShopCart MCP tools are already **Approved & Published** and **Connected** in Claude.ai. Tool availability is NOT the issue.
> - **User Symptom (Markus):** *„Shopcart kann mir Preisvergleich Links geben, was geil ist, aber macht das nur auf Zuruf.“*
> - **Core Problem:** Missing **proactive triggering** on natural everyday shopping queries without explicit user commands ("ohne Zuruf"), compounded by concrete **product/capability gaps** in the tool payloads themselves.

This diagnosis inspects the exact unaltered `main` branch (`218810e`) across the three proactive-routing levers, existing artifacts, and real product/capability gaps before any productive edits are made.

---

## Part 1 — Routing Gaps: Why ShopCart Only Triggers "auf Zuruf" (3 Levers)

### Lever 1: `initialize` → `SERVER_INSTRUCTIONS` (`src/mcp/create-server.ts:12-18`)
- **Unbroken 3,350-char wall of text:** Five dense strings joined by `" "` (~750 tokens) with zero headings, bullet points, or decision table.
- **No proactive shopping playbook vs. `web_search`:** `SERVER_INSTRUCTIONS` never states *when* Claude should proactively choose ShopCart instead of built-in `web_search` or parametric knowledge. Opening sentence (`L13`) frames ShopCart passively as *"an independent read-only shopping assistant for public online storefronts"* — not as the primary engine for everyday *"wo kaufe ich X am besten / am fairsten?"*, *"was kostet X gerade?"*, *"gibt's gerade gute Angebote?"*, or *"lohnt sich gebraucht?"* queries.
- **Priority inversion & conflict:** Sentence 2 (`L14`) mandates *"When the user does not specify a particular online store or domain, ALWAYS call `discover_stores` first..."*, directly colliding with cross-merchant tools `compare_prices` (`8)`), `find_hot_deals` (`9)`), `match_visual_product` (`10)`), and `search_secondhand_marketplaces` (`11)`), which are buried ~2,000+ chars deep in the paragraph.
- **Zero German/everyday buying vocabulary:** Pure English protocol terms (`"UCP"`, `"WAF"`, `"Tier-B"`, `"compare-at"`, `"search_handoff"`, `"permalink"`), missing natural consumer triggers (*wo kaufen, am fairsten, was kostet, gebraucht/refurbished, Angebote, Rabatt, Versandkosten, Rückgabe*).

### Lever 2: All 12 Core Tool Descriptions, Schemas & Annotations (`src/mcp/tools.ts`)
Core tools registered by default (12 tools; optional 13th `search_affiliate_deals` at `L1658` is disabled on hosted prod):

| # | Tool Name | Line | `readOnlyHint` | `openWorldHint` | Passive / Self-Undermining Defect |
|---|---|---|---|---|---|
| 1 | `discover_stores` | `L176` | `true` | `false` | Framed as *"curated, live-verified global online store directory (0 ms in-memory lookup)"* — sounds like an internal directory, not *"Use proactively when user asks where to buy a product/category online"*. |
| 2 | `inspect_store` | `L281` | `true` | `true` | Lists 8 platforms + `"WAF restrictions, UCP discovery diagnostics"` instead of *"check store platform, currency, and shopping capabilities"*. |
| 3 | `list_collections` | `L374` | `true` | `true` | Leads with `"(GET /collections.json)"` and ends with *"Shopify only"*. |
| 4 | `search_products` | `L433` | `true` | `true` | 430-char sentence listing 7 platforms; buries core consumer action (*find products & prices inside a store*). |
| 5 | `get_product` | `L601` | `true` | `true` | 410-char sentence listing `handle/slug/url_key, numeric ID, SKU, Shopware UUID, Amazon ASIN`; buries *"always call to check exact size/color availability & variant IDs"*. |
| 6 | `get_store_policies` | `L709` | `true` | `true` | Leads with *"via native Storefront MCP FAQ search (when supported) plus public /policies endpoints"* instead of *"answer shipping cost, free-shipping, delivery time, and return questions"*. |
| 7 | `find_store_discounts` | `L777` | `true` | `true` | Leads with banner-scraping mechanics rather than *"check whether a user can save money / use a verified promo code at a store"*. |
| 8 | `create_cart_link` | `L813` | `false` *(intentional for UCP POST)* | `true` | Intentionally keeps `readOnlyHint: false, idempotentHint: false` because `UniversalUcpAdapter.buildCartLink` sends a non-idempotent `POST /checkout-sessions` handoff on UCP stores (never places orders/payments); description was overly verbose/technical and misaligned with README wording. |
| 9 | `compare_prices` | `L1074` | `true` | `true` | **Self-undermining:** *"Combines live partner product feed offers (when configured) with instant 1-click regional price comparison links..."* — signals to Claude it is just a link generator unless configured, so Claude reflexively runs `web_search` on natural *"wo kaufe ich X am fairsten?"* prompts. |
| 10 | `find_hot_deals` | `L1236` | `true` | `true` | **Self-undermining:** *"via the official Awin Publisher Promotions API (when configured) alongside instant 1-click regional deal community search links"* — drives Claude to `web_search` on *"gibt's gerade gute Angebote?"*. |
| 11 | `match_visual_product` | `L1356` | `true` | `true` | Narrowly scoped to *"a user-uploaded photo ... extracted by your vision model"* — misses visual attribute descriptions without an attached image. |
| 12 | `search_secondhand_marketplaces` | `L1460` | `true` | `true` | Framed passively as *"Generate verified, pre-filtered search deep-links"* instead of *"Use proactively whenever the user considers buying used, secondhand, local classifieds, vintage, or refurbished items"*. |

- **Schema naming drift:** `compare_prices` & `discover_stores` use `country`, whereas `find_hot_deals` & `search_secondhand_marketplaces` use `region`.
- **Zero MCP Prompts (`prompts/list`):** `grep registerPrompt src/` returns 0 matches — Claude.ai gets zero native connector slash-prompts / quick-start templates.

### Lever 3: Tool Response Structure & Missing `next_step` Chaining (`src/mcp/tools.ts`)
- **Missing proactive chaining hints:** `inspect_store`, `list_collections`, `search_products` (Shopify normal path), `get_product` (Shopify normal path), `get_store_policies`, and `find_store_discounts` return **no `next_step` / `agent_guidance` field at all**.
  - After `search_products`, nothing prompts Claude to call `get_product` for exact sizes/stock or `compare_prices` (via EAN) / `find_store_discounts` to check savings.
  - After `get_product`, nothing prompts Claude to offer `compare_prices(ean=...)` or `create_cart_link(...)`.
  - Meanwhile, the few tools that do emit chaining hints use three different key names: `hint` (`discover_stores`, `L273`), `agent_guidance` (`compare_prices` `L1230`, `find_hot_deals` `L1350`, `search_secondhand_marketplaces` `L1652`), and `next_step` (`create_cart_link`, `match_visual_product` `L908`).
- **Self-sabotaging `"not_configured"` notices:**
  - `compare_prices` (`L1195-1197`) emits `notices: ["Live partner product feeds are not configured on this instance..."]` + `providers.tier_a_live: { awin_product_feeds: "not_configured", kelkoo: "not_configured" }`.
  - `find_hot_deals` (`L1334-1337`) emits `live_vouchers: []`, `live_deals: []`, `awin_promotions: "not_configured"`.
  - These internal operator diagnostics tell Claude the tool returned "incomplete" data, prompting an immediate fallback `web_search`.
- **Token bloat:** `JSON.stringify(payload, null, 2)` (`L107`) adds ~20–30% whitespace overhead per tool call.
- **Mode A (`pure-mcp`) vs. Mode B (`with-skill`):** Because `pure-mcp` relies exclusively on Levers 1–3, comparing against Mode B (`with-skill`) isolates how much proactive triggering can be achieved purely inside the MCP server without requiring users to install a separate Skill.

---

## Part 2 — Out-of-Sync Plugin / Skill / Connector Artifacts

- **`skills/shopcart-mcp/SKILL.md` (`L10`, `L133`):** Outdated — lists only **8 tools** (missing `discover_stores`, `compare_prices`, `find_hot_deals`, `search_secondhand_marketplaces`).
- **`server.json` (`L5`) & `/.well-known/mcp.json` (`src/app.ts:294-295`):** Only mention storefront search and Shopify/Amazon cart links; zero mention of price comparison, deals, vouchers, secondhand/refurbished, or store discovery.
- **`GEMINI.md`:** Missing `compare_prices`, `find_hot_deals`, `search_secondhand_marketplaces`.
- **`README.md` (`L50`):** Claims *"All 11 core tools are read-only (`readOnlyHint: true, idempotentHint: true`)"* (actually 12 core tools, and `create_cart_link` has `readOnlyHint: false`).
- **`scripts/build-mcpb.mjs` (`L178-240`):** Lists all 12 tools with the same technical phrasing and no MCP prompts.
- **`src/web/guides.ts` (`L102`):** Still mentions *"sechs klar begrenzte Lese-Werkzeuge"*.

---

## Part 3 — Real Product & Capability Gaps (Handoff Input for `bot:Idea Validator`)

Beyond routing/prompting fixes (Cycles 1..N), inspecting all 12 tool implementations & return payloads reveals **8 genuine product/capability gaps** that limit end-user value in Claude.ai:

| # | Gap Category | Severity | Evidence in Code / Payloads | User Impact & Product Opportunity |
|---|---|---|---|---|
| 1 | `live_price_data` | **high** | `compare_prices` (`src/mcp/tools.ts:1173-1212`) & `find_hot_deals` (`L1300-1333`): on hosted prod without Awin/Kelkoo keys, `live_offers: []`, `live_vouchers: []`, `live_deals: []` — only Tier-B search deep-links are returned. | User asks *"Was kostet ein MacBook Air M3 gerade?"* or *"Wo kriege ich Stapelsteine am fairsten?"* and gets clickable portal links instead of concrete live prices + cheapest merchant. **Opportunity:** Integrate live price-offer APIs (Kelkoo, Awin feeds, Idealo/Geizhals partner feeds, or UCP merchant feeds). |
| 2 | `shipping_and_total_cost` | **high** | `compare_prices` (`src/comparison/deep-links.ts`), `search_products`, `get_product`, and `create_cart_link` (`src/adapters/types.ts`) have no normalized shipping-cost or landed-total field (`item_price + shipping_cost`). | *"Günstigster Preis"* often flips once 5–10 € shipping is included; requires separate `get_store_policies` call (Shopify-only) and manual math. **Opportunity:** Compute estimated total price incl. shipping threshold in `get_product` / `create_cart_link` / `compare_prices`. |
| 3 | `secondhand_live_listings` | **medium** | `search_secondhand_marketplaces` (`src/mcp/tools.ts:1626`) hardcodes `live_api_configured: false` and `handoff_tier: "search_handoff"`. | Users comparing *"Neu vs. Gebraucht/Refurbished"* cannot see real used price ranges, listing counts, or warranty grades without clicking through 3–5 links. **Opportunity:** Official eBay Browse API / Back Market / refurbed partner feeds for live secondhand price benchmarks. |
| 4 | `catalog_variant_filter` | **medium** | `search_products` (`src/mcp/tools.ts:439-485`) supports `min_price`, `max_price`, `available_only`, `sort_by`, but has **no `size`, `color`, or `variant` filter** and returns no variant IDs. | Prompts like *"Sneaker-Socken in Größe 44"* or *"Wool Runner Größe 42"* require multi-turn `search_products` → N×`get_product` calls just to check whether a requested size is in stock. **Opportunity:** Optional variant/size pre-filtering or top-N variant availability preview in `search_products`. |
| 5 | `directory_coverage` | **medium** | `CURATED_STORES` (`src/stores/curated-stores.ts`) is a static seed list; everyday DACH niches (e.g. *Stapelsteine / Holzspielzeug*, *Kindermatratzen*, *Haushaltsgeräte*, regional specialist shops) return 0 or sparse matches from `discover_stores`. | Forces fallback to `web_search` on mainstream family/home/electronics purchases when no store domain is named. **Opportunity:** Expand curated DACH/EU directory + self-check verified store index + live category/tag coverage telemetry. |
| 6 | `multi_store_cart` | **medium** | `create_cart_link` operates strictly on a single `store_url`; WooCommerce/BigCommerce produce 1 link per item, Shopware/Magento/JSON-LD produce direct product links only. | Multi-item or cross-store comparison baskets (e.g. comparing total basket across 2 stores) cannot be assembled in one structured response. **Opportunity:** Multi-store basket comparison / summary helper tool. |
| 7 | `visual_discovery` | **medium** | `match_visual_product` (`src/mcp/visual-match.ts:882-894`) returns `matches: []` whenever neither `target_stores` nor an affiliate feed is configured, telling the agent to run `web_search` manually. | Visual queries without a known shop name fail to produce instant matches. **Opportunity:** Auto-chain `discover_stores` inside `match_visual_product` when `target_stores` is omitted! |
| 8 | `delivery_and_reviews` | **low** | `ProductSummary` / `ProductDetail` (`src/adapters/types.ts:107-167`) do not surface ratings, review counts, or per-SKU delivery ETAs (even when present in JSON-LD `AggregateRating` / `OfferShippingDetails`). | Shoppers asking *"wo kaufe ich am besten?"* weigh delivery speed and merchant/product ratings alongside price. **Opportunity:** Extract Schema.org `AggregateRating` & shipping ETA where publicly present. |
