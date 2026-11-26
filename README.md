# <img src="public/logo.svg" alt="ShopCart" width="32" height="32" valign="middle"> shopcart-mcp

[![Wals-pro/shopcart-mcp MCP server](https://glama.ai/mcp/servers/Wals-pro/shopcart-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Wals-pro/shopcart-mcp)

**Agentic shopping & cart MCP server for Shopify, WooCommerce, BigCommerce, Amazon, Shopware 6, Magento 2, and any store with Schema.org product data** — built by [wals.pro](https://wals.pro).

Connect **Claude.ai**, **ChatGPT**, **Cursor**, **Claude Code**, or **VS Code** to public online stores: search products, verify live variants, prices, and stock, check shipping and return policies, and hand the shopper a ready-made cart or verified product link. Strictly read-only, with built-in SSRF protection and prompt-injection sanitization. Checkout and payment always happen in the store itself.

> **Independent open-source tool by wals.pro**, not affiliated with or endorsed by Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware, or Adobe (Magento). All trademarks belong to their respective owners.

Website & hosted server: <https://shopcart.wals.pro> · Guides: <https://shopcart.wals.pro/guides> · For AI agents: [`/llms.txt`](https://shopcart.wals.pro/llms.txt)

---

## English

### Dual Mode: Local OSS (`stdio`) & Hosted OAuth 2.1 (`streamable-http`)

| Mode | Auth | Limits | Best For |
|---|---|---|---|
| **Local `stdio` (`npx shopcart-mcp`)** | None (zero telemetry) | Unlimited | Claude Desktop, Cursor, Claude Code, local agents |
| **Hosted MCP (`https://shopcart.wals.pro/mcp`)** | OAuth 2.1 (CIMD + DCR + PKCE S256) | Free: 20 calls/day · Pro (€9/mo): 500 calls/day *(Free Pro launch promo through Dec 6, 2026)* | Claude.ai Web/Mobile, ChatGPT Custom Connectors |

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
- **2-step connect for ChatGPT & Claude.ai:** copy the server URL `https://shopcart.wals.pro/mcp` with one click, paste it as a custom connector, and start with a ready-made start prompt.
- **Passwordless login:** 6-digit email code or 1-click magic link. No password to remember.
- **Read-only & EU-hosted:** the server never places orders, never sees payment data, and runs on Google Cloud Run in `europe-west1`.

### Tools

All 6 tools are read-only (`readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true`):

1. **`inspect_store`** — Detects the platform (Shopify, WooCommerce, BigCommerce, Amazon, Shopware 6, Magento 2, or Universal JSON-LD), resolves currency/country, WAF restrictions, and catalog capabilities including Shopify Storefront MCP and UCP endpoints.
2. **`list_collections`** — Lists a Shopify store's public collections and flags Sale, Black Friday, and Bestseller collections.
3. **`search_products`** — WAF-resilient product search with normalized prices, availability/price filters, `collection` filter, and `sort_by` (`relevance`, `price_asc`, `price_desc`, `discount_desc`).
4. **`get_product`** — Returns exact variant IDs (numeric IDs on Shopify/WooCommerce, ASINs on Amazon), prices in minor units with ISO 4217 exponents, compare-at discounts, and availability. On any other store, verifies a product URL via Schema.org/JSON-LD.
5. **`get_store_policies`** — Shipping, returns, and FAQ answers from the store's public policy pages (Shopify), sanitized and marked as untrusted store content.
6. **`create_cart_link`** — Generates the deterministic handoff: Shopify cart permalinks (`/cart/<vid>:<qty>` or checkout mode), Amazon multi-item cart links, per-item add-to-cart links on WooCommerce and BigCommerce, or verified direct product links, with optional live variant verification via `verify_handles`.

Self-hosted only: an optional seventh tool, `search_affiliate_deals`, appears when you configure your own Awin product feed. It is not enabled on the hosted server.

### Quick Start (Local `stdio`)

```bash
# Run directly via npx (once published) or from source
npx -y shopcart-mcp
```

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
- **OAuth 2.1 (`src/auth/`):** RFC 9728 Protected Resource Metadata, RFC 8414 AS Metadata (no trailing slash on `issuer`, no `private_key_jwt`), CIMD resolver (Claude.ai, Claude Code, ChatGPT SEP-3149, VS Code), DCR (`/oauth/register` with `cursor://` filtering), RFC 8252 §7.3 loopback any-port matching, PKCE S256, RFC 9207 `iss`, RFC 8707 `resource` binding, RFC 6750 §3.1 split `WWW-Authenticate`, refresh token rotation with replay family revocation, and RFC 7009 `/oauth/revoke`.

---

## Deutsch

### Überblick

`shopcart-mcp` verbindet **Claude**, **ChatGPT**, **Cursor** und andere MCP-Clients direkt mit öffentlichen Onlineshops. Deine KI sucht Produkte, prüft Varianten, Preise und Bestand live im Shop und übergibt dir einen fertigen Warenkorb- oder Produktlink. Bezahlt wird immer im Shop selbst, der Server arbeitet ausschließlich lesend.

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

- **Lokal (`stdio`)**: Kostenlos, unbegrenzt, ohne Login und ohne Telemetrie unter MIT-Lizenz.
- **Gehostet (OAuth 2.1)**: Sofort verbindbar in Claude.ai und ChatGPT Custom Connectors.
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
