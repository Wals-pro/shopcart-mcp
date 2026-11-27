# ShopCart MCP — Empirical Product & Capability Gaps Report (Handoff for `bot:Idea Validator`)

> **Scope & Separation:** This report documents **genuine product & capability limitations (`product_gaps`)** observed empirically across 180 live Claude Haiku 4.5 evaluations (`cycle-0-baseline` through `cycle-2` + stability runs) and forensic inspection of all 12 MCP tools. Routing/prompting defects (`routing_gaps`) were already fixed in Optimization Cycles 1–2 (achieving 100% proactive triggering and 0% `web_search` escape across `pure-mcp` and `claude-web-harsh`). The items below require **product/backend evolution**, not prompt tweaks.

---

## Prioritized Product Gaps Summary

| Rank | Gap Category | Severity | Observed In (Live Scenarios) | Affected Tools | Core User Friction |
|---:|---|:---:|---|---|---|
| 1 | `live_price_data` | **HIGH** | 10/20 scenarios (`price-compare-*`, `hot-deals-*`, `combo-new-vs-used-de`, `discover-stores-de`, `safety-readonly-order`) | `compare_prices`, `find_hot_deals` | Assistant returns comparison/deal **search links** (`live_offers: []`, `live_deals: []`) instead of quoting concrete live prices, cheapest merchant, or active voucher savings inline. |
| 2 | `shipping_and_total_cost` | **HIGH** | 10/20 scenarios (`price-compare-*`, `multistep-cart-*`, `combo-new-vs-used-de`, `discover-stores-de`) | `compare_prices`, `create_cart_link`, `get_product` | No normalized shipping cost or landed total price (`item + shipping`) — "cheapest offer" often flips once 5–10 EUR shipping is added. |
| 3 | `secondhand_live_listings` | **MEDIUM** | 4/20 scenarios (`secondhand-*`, `combo-new-vs-used-de`) | `search_secondhand_marketplaces` | Returns `search_handoff` deep-links only (`live_api_configured: false`); cannot tell the user what a used/refurbished MacBook Air M3 or iPhone 15 Pro actually costs right now or how many listings exist. |
| 4 | `catalog_variant_filter` | **MEDIUM** | 3/20 scenarios (`discover-stores-de`, `multistep-cart-de`, `multistep-cart-en`) | `search_products` | User specifies a size upfront (*"Größe 44"*, *"Größe 42"*, *"size M"*), but `search_products` has no size/color filter and returns no variant IDs — forcing multi-turn `get_product` round-trips per candidate. |
| 5 | `visual_discovery` | **MEDIUM** | 1/20 scenarios (`visual-match-de`) | `match_visual_product` | Calling `match_visual_product` without `target_stores` (and without an affiliate feed) returns `matches: []` and forces the agent through 4–7 fallback hops (`discover_stores` + `web_search` + `search_products`). |
| 6 | `directory_coverage` | **MEDIUM** | 3/20 scenarios (`price-compare-de` Stapelsteine, `discover-stores-de` Socken, `visual-match-de` Thermosflasche) | `discover_stores` | Curated directory has blind spots in mainstream DACH family/home/niche categories (e.g. wooden toys/Stapelsteine, insulated bottles, kids' mattresses, regional appliance shops), returning 0 matches on compound queries. |
| 7 | `multi_store_cart` | **MEDIUM** | 2/20 scenarios (`combo-new-vs-used-de`, `discover-stores-de`) | `compare_prices`, `search_secondhand_marketplaces`, `create_cart_link` | No unified cross-merchant basket or side-by-side landed-cost comparison (New vs. Refurbished, or Store A + Store B basket split). |
| 8 | `delivery_and_reviews` | **LOW** | 3/20 scenarios (`multistep-cart-de`, `multistep-cart-en`, `visual-match-de`) | `get_product`, `search_products` | Product payloads omit Schema.org `AggregateRating` (star ratings/review counts) and per-SKU delivery ETAs — key decision factors for *"wo kaufe ich am besten?"*. |
| 9 | `storefront_waf_resilience` | **MEDIUM** | Real-world DACH/global stores (code audit of `src/mcp/tools.ts:329-356`) | `inspect_store`, `search_products`, `list_collections` | WAF-protected stores restrict `/products.json` and `/collections.json`; graceful degradation works, but users lose browsing/discount discovery without a UCP or partner-feed fallback. |

---

## Detailed Evidence & Product Hypotheses for `bot:Idea Validator`

### 1. `live_price_data` (HIGH — Top Revenue & Retention Lever)
- **Example Everyday Prompts:**
  - *"Wir suchen für unseren Sohn Stapelsteine — wo krieg ich die aktuell am fairsten?"* (`price-compare-de`)
  - *"Was kostet ein MacBook Air M3 gerade? Lohnt sich auch gebraucht oder refurbished?"* (`combo-new-vs-used-de`)
  - *"Ich überlege mir heute einen neuen Gaming-Monitor zu holen — gibt es gerade irgendwo gute Aktionen?"* (`hot-deals-de`)
- **Empirical Evidence:** Across all 10 price/deal scenarios on hosted defaults, `compare_prices` returned `live_offers: []` and `find_hot_deals` returned `live_vouchers: []` & `live_deals: []`. In Cycle 0, this directly caused Haiku to panic-loop 11 times and escape to `web_search` on `price-compare-de` because the user asked *"wo krieg ich die am fairsten?"* and got zero concrete prices.
- **Technical Solution Hypothesis:** Activate and cache structured Tier-A live offer feeds on the hosted server (Kelkoo Shopping API, Awin Publisher Product Feeds & Promotions API, Idealo/Geizhals partner feeds, or Google Shopping / UCP merchant feeds) returning Top-5 live offers (merchant, price, currency, stock, affiliate-disclosed URL) alongside the 1-click comparison links.

### 2. `shipping_and_total_cost` (HIGH)
- **Example Everyday Prompts:**
  - *"Ich suche die Sony WH-1000XM5 in Österreich — wo kaufe ich die aktuell am besten?"* (`price-compare-at`)
  - *"Such mir bei allbirds.com den Wool Runner in Größe 42 ... und erstelle mir einen Warenkorb-Link."* (`multistep-cart-de`)
- **Empirical Evidence:** Neither `compare_prices`, `get_product`, nor `create_cart_link` exposes normalized `shipping_cost` or `landed_total`. In Austria/Switzerland especially, German merchants frequently add 9.90–19.90 EUR cross-border shipping, invalidating item-only price rankings.
- **Technical Solution Hypothesis:** In `create_cart_link` / `get_product`, enrich Shopify responses with cached `free_shipping_threshold` and standard shipping from `get_store_policies` to emit `estimated_shipping` + `estimated_total`; in `compare_prices`, include shipping cost from Tier-A feeds and sort by `landed_price_asc`.

### 3. `secondhand_live_listings` (MEDIUM)
- **Example Everyday Prompts:**
  - *"Mein Budget für ein iPhone 15 Pro in Wien ist begrenzt — wo finde ich seriöse gebrauchte oder generalüberholte Geräte?"* (`secondhand-at-willhaben`)
  - *"Was kostet ein MacBook Air M3 gerade? Lohnt sich auch gebraucht oder refurbished?"* (`combo-new-vs-used-de`)
- **Empirical Evidence:** `search_secondhand_marketplaces` always returns `live_api_configured: false` and `handoff_tier: "search_handoff"`. Users asking *"Lohnt sich gebraucht/refurbished?"* get great pre-filtered links, but no quantitative savings benchmark (e.g. *"ab ~820 € refurbished vs. ~1.049 € neu"*).
- **Technical Solution Hypothesis:** Integrate official zero-scraping APIs (eBay Browse API, Back Market / refurbed / rebuy affiliate feeds) to surface real price ranges (min/median), listing counts, and warranty duration inline next to the 16-marketplace search links.

### 4. `catalog_variant_filter` (MEDIUM)
- **Example Everyday Prompts:**
  - *"Ich brauche gute Sneaker-Socken in Größe 44, am liebsten mit Rabatt."* (`discover-stores-de`)
  - *"Find a classic black t-shirt on gymshark.com ... direct cart link for size M."* (`multistep-cart-en`)
- **Empirical Evidence:** `search_products` accepts `min_price`/`max_price`/`available_only` but has no `size`, `color`, or `variant` parameter and omits variant IDs. On size-constrained queries, Haiku must run `search_products` followed by multiple `get_product` calls (consuming 2–3 extra LLM turns and tokens).
- **Technical Solution Hypothesis:** Add optional `variant_query` / `size` filter on `search_products` (matching Shopify/WooCommerce `/products.json` variant options when available) and include a compact `in_stock_variants` summary (up to 6 matching variants with `variant_id`) so simple single-item cart flows drop from 3 turns to 2.

### 5. `visual_discovery` Auto-Store-Chaining (MEDIUM)
- **Example Everyday Prompt:**
  - *"Ich habe ein Foto von einer roten minimalistischen Thermosflasche mit Holzdeckel (500 ml, matte Oberfläche, kein sichtbares Logo)..."* (`visual-match-de`)
- **Empirical Evidence:** Even in Cycle 2 (`100%` pass), `visual-match-de` required **5–7 tool calls** (`match_visual_product` → `discover_stores` → `web_search` → `discover_stores` → `match_visual_product` → `get_product` ×2) because `match_visual_product` returns `matches: []` whenever the caller omits `target_stores`.
- **Technical Solution Hypothesis:** Inside `runMatchVisualProduct`, when `target_stores` is omitted, automatically call `discoverStores({ query: attrs.product_type, limit: 3 })` in-process and search those top 3 verified stores in parallel — turning a 7-call waterfall into a single 1-call instant match!

### 6. `directory_coverage` & Fuzzy Tokenization (MEDIUM)
- **Example Everyday Prompts:**
  - *"Wir suchen für unseren Sohn Stapelsteine — wo krieg ich die aktuell am fairsten?"* (`price-compare-de`)
  - *"Thermosflasche rot Holzdeckel minimalistisch"* (`visual-match-de` → `discover_stores` returned `total_matches: 0`)
- **Empirical Evidence:** Long descriptive queries (e.g. `"Thermosflasche rot Holzdeckel minimalistisch"`) returned `0` matches from `discover_stores` even though `waterdrop.com` (tagged `trinkflasche`, `water-bottle`) is in `CURATED_STORES`, because compound German nouns & multi-token AND matching are too rigid, and mainstream DACH categories (toys/kids, household appliances, mattresses) are under-represented.
- **Technical Solution Hypothesis:** Add German compound-word/synonym expansion (`thermosflasche` → `trinkflasche`/`bottle`, `stapelsteine` → `spielzeug`/`kinder`) + soft OR-scoring fallback in `src/stores/directory.ts`, plus grow `CURATED_STORES` from verified `/api/store-check` submissions.

### 7. `multi_store_cart` / Unified New-vs-Used Comparison View (MEDIUM)
- **Example Everyday Prompt:**
  - *"Was kostet ein MacBook Air M3 gerade? Lohnt sich auch gebraucht oder refurbished?"* (`combo-new-vs-used-de`)
- **Empirical Evidence:** Requires manually orchestrating `compare_prices` + `search_secondhand_marketplaces` (and optionally `create_cart_link` per merchant), with no normalized summary comparing landed new price vs. refurbished price + warranty.
- **Technical Solution Hypothesis:** Evaluate a high-level `compare_new_vs_used` or unified `compare_prices(include_secondhand: true)` option with Idea Validator to deliver 1-call total-cost comparison.

### 8. `delivery_and_reviews` Signals (LOW)
- **Example Everyday Prompts:**
  - *"Allbirds Wool Runner Größe 42 suchen, Details prüfen..."* (`multistep-cart-de`)
  - *"Wo kaufe ich die Sony WH-1000XM5 am besten?"* (`price-compare-at`)
- **Empirical Evidence:** `get_product` returns price, stock, and EAN, but zero rating/review count or delivery-time metadata.
- **Technical Solution Hypothesis:** Extract public Schema.org `AggregateRating` (`ratingValue`, `reviewCount`) and `OfferShippingDetails` (`deliveryTime`) in the JSON-LD and Shopify adapters when publicly present (sanitized as untrusted merchant data).
