import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AdapterRegistry } from "./adapters/registry.js";
import { createBearerAuthMiddleware } from "./auth/bearer.js";
import { CimdResolver } from "./auth/cimd.js";
import { detectLang } from "./auth/pages.js";
import { createOAuthRouter } from "./auth/router.js";
import { consumeUserToolQuota } from "./billing/quota.js";
import { isStripeWebhookConfigured, processStripeWebhook } from "./billing/stripe.js";
import type { AppConfig } from "./config.js";
import { createShopcartMcpServer } from "./mcp/create-server.js";
import type { StorageBackend } from "./store/types.js";
import { createBillingRouter } from "./web/billing.js";
import { renderLandingPage } from "./web/landing.js";
import { renderPrivacyPage, renderSecurityTxt, renderTermsPage } from "./web/legal.js";

export interface CreateAppDeps {
  config: AppConfig;
  store: StorageBackend;
  registry?: AdapterRegistry;
  cimdResolver?: CimdResolver;
}

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const STATIC_ICONS: Array<{ route: string; file: string; contentType: string }> = [
  { route: "/favicon.ico", file: "favicon.ico", contentType: "image/x-icon" },
  { route: "/favicon.svg", file: "favicon.svg", contentType: "image/svg+xml; charset=utf-8" },
  { route: "/favicon.png", file: "favicon.png", contentType: "image/png" },
  { route: "/apple-touch-icon.png", file: "apple-touch-icon.png", contentType: "image/png" },
  { route: "/icon-512.png", file: "icon-512.png", contentType: "image/png" }
];

const STATIC_LANDING_ASSETS: Array<{ route: string; file: string; contentType: string }> = [
  { route: "/assets/landing.css", file: "assets/landing.css", contentType: "text/css; charset=utf-8" },
  {
    route: "/assets/hero-flow.js",
    file: "assets/hero-flow.js",
    contentType: "application/javascript; charset=utf-8"
  },
  {
    route: "/assets/walspro-mark.svg",
    file: "assets/walspro-mark.svg",
    contentType: "image/svg+xml; charset=utf-8"
  }
];

const LANDING_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com https://www.tiktok.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join("; ");

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id"
  );
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

export function createApp(deps: CreateAppDeps): Express {
  const { config, store } = deps;
  const registry = deps.registry ?? new AdapterRegistry();
  const cimdResolver = deps.cimdResolver ?? new CimdResolver();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  // 1. Stripe Webhook MUST be mounted before express.json() so raw body HMAC verifies cleanly
  app.post(
    "/webhooks/stripe",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      if (!isStripeWebhookConfigured(config)) {
        res.status(503).json({ error: "stripe_webhook_not_configured" });
        return;
      }
      try {
        const sig = req.headers["stripe-signature"];
        const signature = Array.isArray(sig) ? sig[0] : sig;
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
        const result = await processStripeWebhook(rawBody, signature, config, store);
        res.status(200).json(result);
      } catch (err) {
        res.status(400).json({
          error: "webhook_error",
          message: err instanceof Error ? err.message : "Invalid webhook payload"
        });
      }
    }
  );

  // 2. Health & Readiness probes
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: config.appName,
      version: config.version
    });
  });

  app.get("/ready", async (_req, res) => {
    const ok = await store.ping();
    if (!ok) {
      res.status(503).json({
        status: "not_ready",
        storage: config.storageBackend
      });
      return;
    }
    res.status(200).json({
      status: "ready",
      storage: config.storageBackend
    });
  });

  // 3. Static Icons & Landing Assets (same-origin, strict CSP friendly)
  for (const icon of STATIC_ICONS) {
    const filePath = path.join(PUBLIC_DIR, icon.file);
    const cachedBuffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    app.get(icon.route, (_req, res) => {
      if (!cachedBuffer) {
        res.status(404).end();
        return;
      }
      res.setHeader("Content-Type", icon.contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(cachedBuffer);
    });
  }

  for (const asset of STATIC_LANDING_ASSETS) {
    const filePath = path.join(PUBLIC_DIR, asset.file);
    const cachedBuffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    app.get(asset.route, (_req, res) => {
      if (!cachedBuffer) {
        res.status(404).end();
        return;
      }
      res.setHeader("Content-Type", asset.contentType);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(cachedBuffer);
    });
  }

  // Claude Desktop 1-click Extension (.mcpb) download
  const mcpbFilePath = path.join(PUBLIC_DIR, "downloads", "shopcart-mcp.mcpb");
  const cachedMcpbBuffer = fs.existsSync(mcpbFilePath) ? fs.readFileSync(mcpbFilePath) : null;
  app.get("/downloads/shopcart-mcp.mcpb", (_req, res) => {
    if (!cachedMcpbBuffer) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="shopcart-mcp.mcpb"');
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(cachedMcpbBuffer);
  });

  // 4. CORS on discovery, OAuth JSON endpoints, and /mcp
  app.use("/.well-known", corsMiddleware);
  app.use("/oauth/token", corsMiddleware);
  app.use("/oauth/register", corsMiddleware);
  app.use("/oauth/revoke", corsMiddleware);
  app.use("/mcp", corsMiddleware);

  // 5. Well-known Directory Verification, Security & MCP Server Card
  app.get("/.well-known/openai-apps-challenge", (_req, res) => {
    if (!config.openaiAppsChallenge) {
      res.status(404).type("text/plain; charset=utf-8").send("Not configured");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).type("text/plain; charset=utf-8").send(config.openaiAppsChallenge);
  });

  app.get("/.well-known/mcp-registry-auth", (_req, res) => {
    if (!config.mcpRegistryAuth) {
      res.status(404).type("text/plain; charset=utf-8").send("Not configured");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).type("text/plain; charset=utf-8").send(config.mcpRegistryAuth);
  });

  app.get("/.well-known/security.txt", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).type("text/plain; charset=utf-8").send(renderSecurityTxt(config));
  });

  app.get("/.well-known/mcp.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({
      name: "io.github.Wals-pro/shopcart-mcp",
      title: "ShopCart MCP",
      description:
        "Search Shopify stores, inspect product variants, and create cart links from your AI assistant.",
      version: config.version,
      websiteUrl: config.appOrigin,
      endpoint: `${config.appOrigin}/mcp`,
      transport: "streamable-http",
      authentication: {
        type: "oauth2",
        protected_resource_metadata: `${config.appOrigin}/.well-known/oauth-protected-resource/mcp`,
        authorization_server_metadata: `${config.appOrigin}/.well-known/oauth-authorization-server`
      },
      icons: [
        { src: `${config.appOrigin}/apple-touch-icon.png`, mimeType: "image/png", sizes: ["180x180"] },
        { src: `${config.appOrigin}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] }
      ],
      privacy_policy_url: `${config.appOrigin}/privacy`,
      terms_of_service_url: `${config.appOrigin}/terms`,
      support_email: "support@wals.pro"
    });
  });

  // 6. OAuth 2.1 Discovery + Authorize + Register + Token + Revoke
  app.use(createOAuthRouter(config, store, cimdResolver));

  // 7. Stateless Streamable HTTP MCP endpoint (/mcp) with RFC 6750 §3.1 Bearer Guard
  const requireBearer = createBearerAuthMiddleware(config, store);

  app.post("/mcp", requireBearer, express.json({ limit: "256kb" }), async (req, res) => {
    const auth = req.mcpAuth!;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    const server = createShopcartMcpServer({
      version: config.version,
      registry,
      concurrencyKey: `user:${auth.userId}`,
      consumeQuota: () => consumeUserToolQuota(auth.user, config, store)
    });

    res.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Internal MCP server error"
          },
          id: null
        });
      }
    }
  });

  app.get("/mcp", requireBearer, (_req, res) => {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed in stateless Streamable HTTP mode; use POST /mcp"
      },
      id: null
    });
  });

  app.delete("/mcp", requireBearer, (_req, res) => {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Sessions are stateless; DELETE /mcp is not required"
      },
      id: null
    });
  });

  // 8. Landing Page (DE/EN), Product-specific Legal Routes, & Account/Billing Portal
  app.get("/", (req, res) => {
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);
    res.setHeader("Content-Security-Policy", LANDING_CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).type("html").send(renderLandingPage(config, lang));
  });

  app.get("/privacy", (req, res) => {
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).type("html").send(renderPrivacyPage(config, lang));
  });

  app.get("/terms", (req, res) => {
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).type("html").send(renderTermsPage(config, lang));
  });

  app.use(createBillingRouter(config, store));

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
