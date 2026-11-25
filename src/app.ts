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

export interface CreateAppDeps {
  config: AppConfig;
  store: StorageBackend;
  registry?: AdapterRegistry;
  cimdResolver?: CimdResolver;
}

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

  // 3. CORS on discovery, OAuth JSON endpoints, and /mcp
  app.use("/.well-known", corsMiddleware);
  app.use("/oauth/token", corsMiddleware);
  app.use("/oauth/register", corsMiddleware);
  app.use("/oauth/revoke", corsMiddleware);
  app.use("/mcp", corsMiddleware);

  // 4. OAuth 2.1 Discovery + Authorize + Register + Token + Revoke
  app.use(createOAuthRouter(config, store, cimdResolver));

  // 5. Stateless Streamable HTTP MCP endpoint (/mcp) with RFC 6750 §3.1 Bearer Guard
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

  // 6. Landing Page (DE/EN) & Account/Billing Portal
  app.get("/", (req, res) => {
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).type("html").send(renderLandingPage(config, lang));
  });

  app.use(createBillingRouter(config, store));

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
