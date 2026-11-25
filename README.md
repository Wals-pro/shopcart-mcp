# shopcart-mcp

**Agentic Shopping & Cart MCP for Shopify (and more)** — built by [Wals.pro](https://wals.pro).

Connect **Claude.ai**, **ChatGPT**, **Cursor**, **Claude Code**, or **VS Code** directly to Shopify storefronts to search products, inspect live variants & pricing, and build deterministic cart permalinks — with built-in SSRF protection and prompt-injection sanitization.

> **Independent Open-Source Project:** `shopcart-mcp` is an independent open-source project by Wals.pro and is not affiliated with or endorsed by Shopify Inc.

---

## English

### Dual Mode: Local OSS (`stdio`) & Hosted OAuth 2.1 (`streamable-http`)

| Mode | Auth | Limits | Best For |
|---|---|---|---|
| **Local `stdio` (`npx shopcart-mcp`)** | None (zero telemetry) | Unlimited | Claude Desktop, Cursor, Claude Code, local agents |
| **Hosted MCP (`https://shopcart.wals.pro/mcp`)** | OAuth 2.1 (CIMD + DCR + PKCE S256) | Free: 20 calls/day · Pro (€9/mo): 500 calls/day *(Free Pro launch promo through Dec 6, 2026)* | Claude.ai Web/Mobile, ChatGPT Custom Connectors |

### Tools

All 4 tools are read-only (`readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true`):

1. **`inspect_store`** — Detects Shopify compatibility, resolves currency/country (`/meta.json` → `/cart.js` fallback), WAF restrictions, and optional native `/api/mcp` tools.
2. **`search_products`** — WAF-resilient product search via `/search/suggest.json` (with `/products.json` browse/fallback), normalized prices, and availability/price filters.
3. **`get_product`** — Fetches `/products/<handle>.js` (minor-unit currency conversion with ISO 4217 exponents), strips HTML & invisible Unicode tag blocks, returns exact numeric `variant_id`s.
4. **`create_cart_link`** — Generates deterministic Shopify cart permalinks (`/cart/<vid>:<qty>?storefront=true` or checkout mode) with optional live variant verification via `verify_handles`.

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

`shopcart-mcp` verbindet **Claude**, **ChatGPT**, **Cursor** und andere MCP-Clients direkt mit Shopify-Onlineshops:

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

### Lizenz

[MIT License](./LICENSE) © 2026 Wals.pro
