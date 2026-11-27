# <img src="public/logo.svg" alt="ShopCart" width="32" height="32" valign="middle"> shopcart-mcp

[![Wals-pro/shopcart-mcp MCP server](https://glama.ai/mcp/servers/Wals-pro/shopcart-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Wals-pro/shopcart-mcp)

**Agentic shopping & cart MCP server for Shopify, WooCommerce, BigCommerce, Amazon, Shopware 6, Magento 2, and any store with Schema.org product data** — built by [wals.pro](https://wals.pro).

Connect **Claude.ai**, **ChatGPT**, **Google Gemini**, **Cursor**, **Claude Code**, **Gemini CLI**, or **VS Code** to public online stores: search products, verify live variants, prices, and stock, check shipping and return policies, and hand the shopper a ready-made cart or verified product link. Strictly read-only, with built-in SSRF protection and prompt-injection sanitization. Checkout and payment always happen in the store itself.

> **Independent open-source tool by wals.pro**, not affiliated with or endorsed by Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware, or Adobe (Magento). All trademarks belong to their respective owners.

Website & hosted server: <https://shopcart.wals.pro> · Store Directory: <https://shopcart.wals.pro/stores> · Guides: <https://shopcart.wals.pro/guides> · For AI agents: [`/llms.txt`](https://shopcart.wals.pro/llms.txt)

---

## English

### Three Modes: One-Shot CLI, Local OSS (`stdio`) & Hosted OAuth 2.1 (`streamable-http`)

| Mode | Auth | Limits | Best For |
|---|---|---|---|
| **One-Shot CLI (`npx -y shopcart-mcp <cmd>`)** | None (zero OAuth popup, JSON on `stdout`) | Unlimited | Instinct (cloud computer), Open Instinct microVMs, OpenClaw, Claude Code, Codex, Manus, Devin, shell scripts |
| **Local `stdio` (`npx -y shopcart-mcp`, no args)** | None (zero telemetry) | Unlimited | Claude Desktop, Cursor, Claude Code, OpenClaw, Goose, Raycast |
| **Hosted MCP (`https://shopcart.wals.pro/mcp`)** | OAuth 2.1 (CIMD + DCR + PKCE S256) | Free: 20 calls/day · Pro (€9/mo): 500 calls/day *(Free Pro launch promo through Dec 6, 2026)* | Claude.ai Web/Mobile, ChatGPT Custom Connectors, Google Gemini (Web, CLI, Enterprise), Open Instinct, MewCP, Agensi |

### Supported Platforms & Capability Matrix

What the shopper gets differs by platform, and ShopCart MCP says so honestly in every tool response:

| Platform | Find products | Verified live | Handoff to the store |
|---|---|---|---|
| **Shopify** | Full-text search, Sale/Black Friday/Bestseller collections, sort by price or discount | Variants, price, stock, compare-at discounts (`discount_percent`, `savings`), shipping & return policies; detects Storefront MCP and UCP (`/api/ucp/mcp`) | **One cart link** for the whole cart (up to 20 line items), optional discount code |
| **WooCommerce** | Full-text search (Store API v1) | Variations, price, stock | One add-to-cart link **per item** (`cart_url` + `additional_cart_links`) |
| **BigCommerce** | Full-text search | Variants, price, availability | One add-to-cart link **per product** (`cart_url` + `additional_cart_links`) |
| **Amazon** (DE, AT, US, UK, FR, IT, ES, NL, CA, JP) | By ASIN; live search and prices only with your own Keepa or PA-API key (local/self-hosted) | ASIN format and marketplace | **One official multi-item cart link** (`/gp/aws/cart/add.html`) |
| **Shopware 6** | Full-text search | Variants, price, availability | Verified direct product links |
| **Magento 2 / Adobe Commerce** | Full-text search (public GraphQL) | Price, stock status, tier discounts | Verified direct product links |
| **Any other store** (Universal Schema.org/JSON-LD) | No catalog search: pass a product URL | Price, currency, availability, SKU/EAN/GTIN from the page's structured data | Verified direct product link (no multi-item cart permalink exists on these stores) |

### Comfort Features for Shoppers

- **Shipping & returns before checkout:** `get_store_policies` answers policy questions from the store's own policy pages (Shopify stores).
- **Deal hunting with real numbers:** `list_collections` finds Sale, Black Friday, and Bestseller collections; `search_products` sorts by price or discount and returns `discount_percent` and `savings` computed from the store's compare-at prices (Shopify stores).
- **1-click Claude Desktop extension:** download [`shopcart-mcp.mcpb`](https://shopcart.wals.pro/downloads/shopcart-mcp.mcpb) and open it. No terminal, no config file.
- **2-step connect for Claude.ai, ChatGPT & Google Gemini:** copy the server URL `https://shopcart.wals.pro/mcp` with one click, paste it as a custom connector/app, or install the Gemini CLI extension in one command.
- **Passwordless login:** 6-digit email code or 1-click magic link. No password to remember.
- **Read-only & EU-hosted:** the server never places orders, never sees payment data, and runs on Google Cloud Run in `europe-west1`.

### Tools & Native MCP Prompts

All 12 core tools are strictly read-only (`readOnlyHint: true, destructiveHint: false, idempotentHint: true`), complemented by 5 native MCP Prompts (`compare-prices`, `find-secondhand`, `hunt-deals`, `shop-and-build-cart`, `discover-shopping-stores`) surfaced via `prompts/list`:

0. **`discover_stores`** — Instant in-memory search across ShopCart's curated, live-verified global store directory (12 categories, DACH + US/UK/EU, multi-platform) whenever the user has not named a specific store domain.
1. **`inspect_store`** — Detects the platform (Shopify, WooCommerce, BigCommerce, Amazon, Secondhand, Shopware 6, Magento 2, UCP, or Universal JSON-LD), resolves currency/country, WAF restrictions, and catalog capabilities including Shopify Storefront MCP and UCP endpoints.
2. **`list_collections`** — Lists a Shopify store's public collections and flags Sale, Black Friday, and Bestseller collections.
3. **`search_products`** — WAF-resilient product search with normalized prices, availability/price filters, `collection` filter, and `sort_by` (`relevance`, `price_asc`, `price_desc`, `discount_desc`).
4. **`get_product`** — Returns exact variant IDs (numeric IDs on Shopify/WooCommerce, ASINs on Amazon), prices in minor units with ISO 4217 exponents, compare-at discounts, and availability. On any other store, verifies a product URL via Schema.org/JSON-LD. Pass optional `include_thumbnail: true` when visually confirming a product match against a user-uploaded photo (SSRF-hardened, JPEG/PNG/WebP only, ≤ 512 KB, zero-retention).
5. **`get_store_policies`** — Shipping, returns, and FAQ answers from the store's public policy pages (Shopify), sanitized and marked as untrusted store content.
6. **`find_store_discounts`** — Discovers official, publicly advertised promo codes and automatic checkout deals on Shopify storefronts plus configured partner rules.
7. **`create_cart_link`** — Generates the deterministic read-only handoff: Shopify cart permalinks (`/cart/<vid>:<qty>` or checkout mode), Amazon multi-item cart links, per-item add-to-cart links on WooCommerce and BigCommerce, or verified direct product links, with optional live variant verification via `verify_handles`.
8. **`compare_prices`** — Compares prices across merchants by keyword or EAN/GTIN barcode, combining live partner offers (when configured) with 1-click regional comparison portal links (Geizhals, idealo, billiger.de, Toppreise.ch, Google Shopping).
9. **`find_hot_deals`** — Discovers active partner promotions and vouchers (when configured) alongside 1-click regional deal community search links (Preisjäger, mydealz, HotUKDeals, Dealabs, Slickdeals).
10. **`match_visual_product`** — Zero-cost visual product search: accepts structured attributes extracted from a user photo or visual description (`product_type`, `brand`, `model_or_text`, `ean`, `color`, `material`, `style_keywords`), queries up to 5 validated `target_stores` in parallel (plus configured partner feeds / exact EAN lookup), and returns deterministically ranked matches with confidence scores and web-search fallback queries.
11. **`search_secondhand_marketplaces`** — Searches up to 16 second-hand, local classifieds (incl. German 5-digit PLZ), vintage, and refurbished marketplaces (willhaben, Kleinanzeigen, Vinted, Ricardo.ch, tutti.ch, refurbed, Back Market, rebuy, medimops, asgoodasnew, eBay, Etsy, Depop, Poshmark, buyZOXS, Vestiaire Collective) in a single call.

Self-hosted only: an optional 13th tool, `search_affiliate_deals`, appears when you configure your own Awin product feed. It is not enabled on the hosted server.

### Google Gemini Setup (Web, CLI, Enterprise & SDK)

All ShopCart MCP tool schemas are automatically sanitized for strict Google Gemini `functionDeclarations` compatibility (zero `$schema`, `additionalProperties`, `oneOf`, or unsupported JSON Schema keywords), and the hosted server supports Google's OAuth 2.1 CIMD, loopback, and Vertex AI Search flows.

#### 1. Gemini CLI & Antigravity (1-Command Extension)

```bash
gemini extensions install https://github.com/Wals-pro/shopcart-mcp
```

Or add the remote Streamable HTTP server directly:

```bash
gemini mcp add --transport http --scope user shopcart https://shopcart.wals.pro/mcp
```

Or configure `~/.gemini/settings.json` (or `.gemini/settings.json`) manually — **important: use `"httpUrl"`, NOT `"url"`** (Gemini CLI treats `"url"` as legacy SSE and will fail to connect):

```json
{
  "mcpServers": {
    "shopcart": {
      "httpUrl": "https://shopcart.wals.pro/mcp",
      "authProviderType": "dynamic_discovery"
    }
  }
}
```

#### 2. Gemini Web (`gemini.google.com`)

1. Open [gemini.google.com](https://gemini.google.com/) → **Settings → Connected Apps** (*Verbundene Apps*) → **Custom apps → Add a custom app** (or test via [gemini.google.com/devmode](https://gemini.google.com/devmode)).
2. Paste `https://shopcart.wals.pro/mcp` and complete the OAuth 2.1 sign-in (CIMD via `accountlinking.google.com`).

> **Prerequisites (Google rollout):** Custom MCP apps in Gemini Web require a personal Google account (**Keep Activity** enabled) and depend on Google's regional/account rollout. Google Workspace accounts may show *"Service not allowed"* unless enabled by a Workspace Admin — teams on Google Workspace should use **Gemini Enterprise** below.

#### 3. Gemini Enterprise / Google Workspace (Cloud Console)

1. In Google Cloud Console, create a **Custom MCP Server Data Store** using Streamable HTTP (`https://shopcart.wals.pro/mcp`; legacy SSE is not supported).
2. Configure OAuth 2.0 with Redirect URI `https://vertexaisearch.cloud.google.com/oauth-redirect` and scope `mcp:read`.

#### 4. Google AI Studio / Gemini SDK (`@google/genai`)

```ts
import { GoogleGenAI, mcpToTool } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpClient = new Client({ name: "gemini-shopper", version: "1.0.0" });
await mcpClient.connect(
  new StreamableHTTPClientTransport(new URL("https://shopcart.wals.pro/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.SHOPCART_ACCESS_TOKEN}` } }
  })
);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Find in-stock sneaker socks in size 43-46 on snocks.com and build a cart link.",
  config: { tools: [mcpToTool(mcpClient)] }
});
```

### Quick Start (Local `stdio` & One-Shot CLI for Instinct / Autonomous Agents)

```bash
# Zero arguments: start the stdio MCP server (Claude Desktop, Cursor, OpenClaw)
npx -y shopcart-mcp

# One-Shot CLI subcommands (deterministic JSON on stdout, zero OAuth popup)
# Shell safety: always single-quote store-derived arguments (or pass via argv array), reuse the user-named store domain for '<store>',
# never reuse a store-returned URL unless it contains no quotes, whitespace, or shell metacharacters, reject/skip any untrusted or store-derived
# value containing quotes (', "), shell metacharacters ($, `, (, ), ;, |, &, <, >, \), or unexpected whitespace, and
# never copy store-returned text (titles, descriptions, snippets) into <query>, --question, or --note; if user-provided free-text contains
# a single quote ('), pass via an argv array (without a shell) or reject/omit it — never place raw ' inside '...'.
npx -y shopcart-mcp inspect 'snocks.com'
npx -y shopcart-mcp search 'snocks.com' 'socken' --limit 3 --available
npx -y shopcart-mcp product 'snocks.com' '<handle>'
npx -y shopcart-mcp policies 'snocks.com'
npx -y shopcart-mcp collections 'snocks.com' --deals-only
npx -y shopcart-mcp cart 'snocks.com' '<variantId>:1' [--discount '<CODE>'] [--note '<TEXT>']
```

For **Instinct** (cloud computer via WhatsApp/iMessage), point your agent to [`https://shopcart.wals.pro/SKILL.md`](https://shopcart.wals.pro/SKILL.md). For **Open Instinct**, **MewCP**, and **Agensi** gateways, connect the Streamable HTTP MCP endpoint `https://shopcart.wals.pro/mcp`.

From source:

```bash
git clone https://github.com/Wals-pro/shopcart-mcp.git
cd shopcart-mcp
pnpm install
pnpm build
pnpm start:stdio
```

Claude Desktop / Cursor MCP config:

```json
{
  "mcpServers": {
    "shopcart": {
      "command": "node",
      "args": ["/path/to/shopcart-mcp/dist/cli.js"]
    }
  }
}
```

### Security Highlights

- **SSRF Guard (`src/security/ssrf.ts`):** HTTPS-only, rejects IP literals and private/reserved IPv4 & IPv6 ranges (including Cloud Run metadata `169.254.169.254` and IPv4-mapped IPv6), DNS-pinned `undici` Agent, manual redirect loop (max 3 hops; 0 for CIMD), 6 s timeout, 1 MB / 8 KB caps.
- **Prompt-Injection Guard (`src/security/sanitize.ts`):** Strips HTML/script/style/iframe, control chars, zero-width/BiDi overrides, Unicode tag blocks (`U+E0000–U+E007F`), enforces hard field length caps, and attaches untrusted catalog data notices.
- **Public Storefront Self-Check (`/check`, `/en/check`, `POST /api/store-check`):** Isolated read-only adapter registry (separate caches, Amazon PA-API/Keepa disabled), strict same-origin/CSRF + `application/json` + 2 KB caps, IPv6 `/64`-grouped per-IP rate limits (10/min & 60/hr), process-wide concurrency cap, and configurable `TRUSTED_PROXY_HOPS` (`0` = ignore `X-Forwarded-For`, `1` = direct Cloud Run default, `2` = CDN/LB in front of Cloud Run).
- **OAuth 2.1 (`src/auth/`):** RFC 9728 Protected Resource Metadata, RFC 8414 AS Metadata (no trailing slash on `issuer`, no `private_key_jwt`), CIMD resolver (Claude.ai, Claude Code, ChatGPT SEP-3149, Google Gemini `accountlinking.google.com`, VS Code), DCR (`/oauth/register` with `cursor://` filtering and Vertex AI Search redirect support), RFC 8252 §7.3 loopback any-port matching (Gemini CLI, Cursor, Claude Code), PKCE S256, RFC 9207 `iss`, RFC 8707 `resource` binding, RFC 6750 §3.1 split `WWW-Authenticate`, refresh token rotation with replay family revocation, and RFC 7009 `/oauth/revoke`.

---

## Deutsch

### Überblick

`shopcart-mcp` verbindet **Claude**, **ChatGPT**, **Google Gemini**, **Cursor** und andere MCP-Clients direkt mit öffentlichen Onlineshops. Deine KI sucht Produkte, prüft Varianten, Preise und Bestand live im Shop und übergibt dir einen fertigen Warenkorb- oder Produktlink. Bezahlt wird immer im Shop selbst, der Server arbeitet ausschließlich lesend.

| Shop-System | Produkte finden | Live geprüft | Übergabe an den Shop |
|---|---|---|---|
| **Shopify** | Volltextsuche, Sale-/Black-Friday-/Bestseller-Kollektionen, Sortierung nach Preis oder Rabatt | Varianten, Preis, Bestand, Streichpreis-Rabatte, Versand- und Rückgaberegeln; erkennt Storefront MCP und UCP | **Ein Warenkorb-Link** für den ganzen Einkauf (bis zu 20 Positionen), optional mit Rabattcode |
| **WooCommerce** | Volltextsuche (Store API v1) | Varianten, Preis, Bestand | Ein In-den-Warenkorb-Link **je Artikel** |
| **BigCommerce** | Volltextsuche | Varianten, Preis, Verfügbarkeit | Ein In-den-Warenkorb-Link **je Produkt** |
| **Amazon** (DE, AT, US, UK, FR, IT, ES, NL, CA, JP) | Per ASIN; Live-Suche und Preise nur mit eigenem Keepa- oder PA-API-Schlüssel (lokal/self-hosted) | ASIN-Format und Marktplatz | **Ein offizieller Warenkorb-Link** für mehrere Artikel |
| **Shopware 6** | Volltextsuche | Varianten, Preis, Verfügbarkeit | Geprüfte direkte Produktlinks |
| **Magento 2 / Adobe Commerce** | Volltextsuche (öffentliches GraphQL) | Preis, Lagerstatus, Staffelrabatte | Geprüfte direkte Produktlinks |
| **Jeder andere Shop** (Schema.org/JSON-LD) | Keine Katalogsuche: Produkt-URL übergeben | Preis, Währung, Verfügbarkeit, SKU/EAN/GTIN aus den strukturierten Daten der Seite | Geprüfter direkter Produktlink (diese Shops bieten keinen Warenkorb-Link für mehrere Artikel) |

**Komfort beim Einkaufen mit KI:** Versand- und Rückgaberegeln vor dem Checkout prüfen (Shopify), Sale-Kollektionen mit echten Rabatten in Prozent und Euro durchsuchen (Shopify), 1-Klick-Erweiterung für Claude Desktop (`.mcpb`), Verbinden in zwei Schritten für ChatGPT und Claude.ai, Login ohne Passwort per E-Mail-Code oder Magic Link, ausschließlich lesend und in der EU gehostet.

So nutzt du den Server:

- **One-Shot CLI (`npx -y shopcart-mcp inspect/search/product/policies/collections/cart`)**: Deterministisches JSON auf `stdout` ohne OAuth-Popup — ideal für Instinct (Cloud-Computer per WhatsApp/iMessage über `https://shopcart.wals.pro/SKILL.md`), Open Instinct, OpenClaw, Claude Code, Codex, Manus und Devin.
- **Lokal (`stdio`, ohne Argumente)**: Kostenlos, unbegrenzt, ohne Login und ohne Telemetrie unter MIT-Lizenz.
- **Gehostet (Streamable HTTP + OAuth 2.1)**: Sofort verbindbar in Claude.ai, ChatGPT Custom Connectors, Google Gemini (Web, Gemini CLI Extension `gemini extensions install https://github.com/Wals-pro/shopcart-mcp` und Gemini Enterprise) sowie MCP-Gateways wie Open Instinct, MewCP und Agensi (`https://shopcart.wals.pro/mcp`).
  - **Free:** 20 Tool-Calls / Tag
  - **Pro (9 €/Monat):** 500 Tool-Calls / Tag
  - **Black-Friday-Launch-Aktion:** Bis einschließlich **06.12.2026** erhalten alle angemeldeten Konten automatisch 500 Calls/Tag kostenlos.

### Entwicklung & Tests

```bash
pnpm install
pnpm test
pnpm build
```

### Hinweis zu Marken

Unabhängiges Open-Source-Tool von wals.pro, nicht verbunden mit oder unterstützt von Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware oder Adobe (Magento). Alle Markennamen gehören ihren jeweiligen Eigentümern.

### Lizenz

[MIT License](./LICENSE) © 2026 wals.pro
