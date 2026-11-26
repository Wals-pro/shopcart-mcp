import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AffiliateFeedProvider } from "../src/adapters/affiliate-feed/index.js";
import { createApp } from "../src/app.js";
import { CimdResolver, isCimdClientId } from "../src/auth/cimd.js";
import { sha256Base64Url } from "../src/auth/crypto.js";
import { MemoryEmailSender } from "../src/auth/email-otp.js";
import { matchRedirectUri } from "../src/auth/validation.js";
import { loadConfig } from "../src/config.js";
import { createShopcartMcpServer } from "../src/mcp/create-server.js";
import {
  findGeminiSchemaViolations,
  GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS,
  sanitizeSchemaForGemini
} from "../src/mcp/schema-sanitize.js";
import { safeFetch, SsrfError, type SafeFetchResponse } from "../src/security/ssrf.js";
import { MemoryStore } from "../src/store/memory.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeMockAffiliateFeed(): AffiliateFeedProvider {
  return {
    isConfigured: () => true,
    resolveStoreTarget: async () => null,
    search: async () => ({
      provider: "awin",
      currency: "EUR",
      affiliate_disclosure: true,
      disclosure_note: "Partner feed",
      merchants_searched: ["DemoStore"],
      products: [],
      notices: []
    })
  };
}

function makeGeminiTestApp(
  cimdMap: Record<string, { status?: number; body: unknown; cacheControl?: string }> = {}
) {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00"
  });
  const store = new MemoryStore();
  const emailSender = new MemoryEmailSender();
  const cimdResolver = new CimdResolver(async (url): Promise<SafeFetchResponse> => {
    const entry = cimdMap[url];
    if (!entry) {
      throw new Error(`Unexpected CIMD URL: ${url}`);
    }
    const text = JSON.stringify(entry.body);
    return {
      status: entry.status ?? 200,
      url,
      contentType: "application/json",
      headers: {
        "content-type": "application/json",
        ...(entry.cacheControl ? { "cache-control": entry.cacheControl } : {})
      },
      bodyBuffer: Buffer.from(text),
      bodyText: text
    };
  });
  const app = createApp({ config, store, cimdResolver, emailSender });
  return { app, store, config, emailSender };
}

async function completeAuthorizeAndGetCode(params: {
  app: ReturnType<typeof createApp>;
  emailSender: MemoryEmailSender;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  email: string;
  state: string;
  resource?: string;
}) {
  const authGet = await request(params.app)
    .get("/oauth/authorize")
    .query({
      response_type: "code",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      ...(params.resource ? { resource: params.resource } : {}),
      scope: "mcp:read",
      state: params.state
    })
    .expect(200);

  const csrf1 = authGet.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
  const cookies1 = (authGet.headers["set-cookie"] as unknown as string[])
    .map((c) => c.split(";")[0])
    .join("; ");

  const step1 = await request(params.app)
    .post("/oauth/authorize")
    .set("Cookie", cookies1)
    .type("form")
    .send({
      _csrf: csrf1,
      step: "email",
      lang: "en",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      resource: params.resource ?? "https://shopcart.wals.pro/mcp",
      scope: "mcp:read",
      state: params.state,
      email: params.email
    })
    .expect(200);

  const sentMail = params.emailSender.lastFor(params.email)!;
  const csrf2 = step1.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
  const challengeId = step1.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;
  const cookies2 = (step1.headers["set-cookie"] as unknown as string[])
    .map((c) => c.split(";")[0])
    .join("; ");

  const step2 = await request(params.app)
    .post("/oauth/authorize")
    .set("Cookie", cookies2)
    .type("form")
    .send({
      _csrf: csrf2,
      step: "verify",
      challenge_id: challengeId,
      lang: "en",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      resource: params.resource ?? "https://shopcart.wals.pro/mcp",
      scope: "mcp:read",
      state: params.state,
      email: params.email,
      code: sentMail.code
    })
    .expect(303);

  return { authGet, callbackUrl: new URL(step2.headers.location!) };
}

describe("Google Gemini JSON Schema compliance (dynamic tools/list)", () => {
  it("returns ZERO Gemini-unsupported schema keywords across all registered MCP tools (default & affiliate feed)", async () => {
    for (const includeAffiliate of [false, true]) {
      const server = createShopcartMcpServer({
        affiliateFeed: includeAffiliate ? makeMockAffiliateFeed() : undefined
      });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "gemini-schema-audit", version: "1.0.0" });
      await Promise.all([server.connect(st), client.connect(ct)]);

      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(includeAffiliate ? 12 : 11);
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("discover_stores");
      expect(toolNames).toContain("find_store_discounts");
      expect(toolNames).toContain("create_cart_link");
      expect(toolNames).toContain("compare_prices");
      expect(toolNames).toContain("find_hot_deals");
      expect(toolNames).toContain("match_visual_product");
      const cartTool = tools.find((t) => t.name === "create_cart_link");
      expect((cartTool?.inputSchema.properties as Record<string, unknown> | undefined)).toHaveProperty(
        "auto_apply_discount"
      );

      for (const tool of tools) {
        const violations = findGeminiSchemaViolations(tool.inputSchema, `${tool.name}.inputSchema`);
        expect(violations, `Gemini schema violations for ${tool.name}`).toEqual([]);
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema).not.toHaveProperty("$schema");
        expect(tool.inputSchema).not.toHaveProperty("additionalProperties");
      }

      // Verify server-side Zod validation on tools/call still rejects invalid payloads
      const invalidCall = await client.callTool({
        name: "create_cart_link",
        arguments: {
          store_url: "snocks.com",
          items: [] // violates min(1)
        }
      });
      expect(invalidCall.isError).toBe(true);

      await client.close();
      await server.close();
    }
  });

  it("dynamically sanitizes future tools added after server creation and strips every Gemini-banned keyword", async () => {
    const server = createShopcartMcpServer();
    // Simulate a future tool (e.g. find_store_discounts) registered dynamically
    server.registerTool(
      "future_discount_probe",
      {
        title: "Future Discount Probe",
        description: "Synthetic future tool to verify dynamic Gemini schema sanitization",
        inputSchema: {
          store_url: z.string().min(3),
          min_percent: z.number().gt(0).lt(100).optional(),
          mode: z.literal("auto").optional(),
          tags: z.array(z.string()).optional()
        }
      },
      async () => ({ content: [{ type: "text" as const, text: "{}" }] })
    );

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "gemini-dynamic-audit", version: "1.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);

    const { tools } = await client.listTools();
    const probe = tools.find((t) => t.name === "future_discount_probe");
    expect(probe).toBeDefined();
    expect(findGeminiSchemaViolations(probe!.inputSchema, "future_discount_probe.inputSchema")).toEqual([]);

    await client.close();
    await server.close();

    // Unit test sanitizer directly against every Gemini-rejected keyword in one nested schema
    const hostileSchema: Record<string, unknown> = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.test/schema.json",
      $defs: {
        Item: {
          type: "object",
          additionalProperties: false,
          properties: {
            sku: { type: ["string", "null"] },
            qty: { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 100 }
          }
        }
      },
      type: "object",
      additionalProperties: false,
      propertyNames: { pattern: "^[a-z_]+$" },
      patternProperties: { "^x_": { type: "string" } },
      properties: {
        kind: { const: "cart" },
        choice: { oneOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }] },
        tags: { type: "array", uniqueItems: true },
        item: { $ref: "#/$defs/Item" }
      }
    };

    const sanitized = sanitizeSchemaForGemini(hostileSchema);
    expect(findGeminiSchemaViolations(sanitized)).toEqual([]);
    for (const banned of GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS) {
      expect(JSON.stringify(sanitized)).not.toContain(`"${banned}"`);
    }
    const props = sanitized.properties as Record<string, Record<string, unknown>>;
    expect(props.kind).toEqual({ type: "string", enum: ["cart"] });
    expect(props.choice).toEqual({ type: "string", enum: ["a", "b"] });
    expect(props.tags).toEqual({ type: "array", items: { type: "string" } });
    const itemProps = (props.item as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(itemProps.sku.type).toBe("string");
    expect(itemProps.qty.minimum).toBe(1);
    expect(itemProps.qty.maximum).toBe(99);
  });
});

describe("Google Gemini OAuth 2.1 (CIMD, Enterprise, CLI Loopback) & Streamable HTTP", () => {
  it("supports Gemini Web CIMD (accountlinking.google.com) with all three googleusercontent redirect URI patterns", async () => {
    const cimdUrl = "https://accountlinking.google.com/clientidmetadata/shopcart-gemini-prod";
    const googleRedirects = [
      "https://oauth-redirect.googleusercontent.com/r/shopcart-prod",
      "https://oauth-redirect-sandbox.googleusercontent.com/r/shopcart-sandbox",
      "https://oauth-redirect.googleusercontent.com/a/shopcart-app"
    ];

    expect(isCimdClientId(cimdUrl)).toBe(true);

    const { app, emailSender } = makeGeminiTestApp({
      [cimdUrl]: {
        body: {
          client_id: cimdUrl,
          client_name: "Google Gemini",
          redirect_uris: googleRedirects,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none"
        },
        cacheControl: "public, max-age=180"
      }
    });

    for (const [idx, redirectUri] of googleRedirects.entries()) {
      const verifier = `gemini_web_verifier_${idx}_abcdefghijklmnopqrstuvwxyz_0123456789_ABCD`;
      const challenge = sha256Base64Url(verifier);
      const { authGet, callbackUrl } = await completeAuthorizeAndGetCode({
        app,
        emailSender,
        clientId: cimdUrl,
        redirectUri,
        codeChallenge: challenge,
        email: `gemini-user-${idx}@example.com`,
        state: `gstate_${idx}`,
        resource: "https://shopcart.wals.pro/mcp"
      });

      const expectedOrigin = new URL(redirectUri).origin;
      expect(String(authGet.headers["content-security-policy"] ?? "")).toContain(
        `form-action 'self' ${expectedOrigin}`
      );
      expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
      expect(callbackUrl.searchParams.get("state")).toBe(`gstate_${idx}`);
      expect(callbackUrl.searchParams.get("iss")).toBe("https://shopcart.wals.pro");

      const tokenRes = await request(app)
        .post("/oauth/token")
        .type("form")
        .send({
          grant_type: "authorization_code",
          client_id: cimdUrl,
          code: callbackUrl.searchParams.get("code"),
          redirect_uri: redirectUri,
          code_verifier: verifier,
          resource: "https://shopcart.wals.pro/mcp"
        })
        .expect(200);

      expect(tokenRes.body.access_token).toMatch(/^sc_at_/);

      // Verify Streamable HTTP tools/list with this Gemini Web Bearer token returns zero Gemini schema violations
      const toolsRes = await request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${tokenRes.body.access_token}`)
        .set("Accept", "application/json, text/event-stream")
        .set("MCP-Protocol-Version", "2025-03-26")
        .send({ jsonrpc: "2.0", id: idx + 1, method: "tools/list", params: {} })
        .expect(200);

      const tools = toolsRes.body.result.tools as Array<{ name: string; inputSchema: unknown }>;
      expect(tools.length).toBeGreaterThanOrEqual(6);
      for (const tool of tools) {
        expect(findGeminiSchemaViolations(tool.inputSchema, tool.name)).toEqual([]);
      }
    }

    // Negative open-redirect check: unregistered googleusercontent project path MUST be rejected (400, no redirect!)
    await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: cimdUrl,
        redirect_uri: "https://oauth-redirect.googleusercontent.com/r/attacker-project",
        code_challenge: sha256Base64Url("attacker_verifier_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123"),
        code_challenge_method: "S256",
        state: "evil"
      })
      .expect(400);
  });

  it("supports Gemini Enterprise / Vertex AI Search (vertexaisearch.cloud.google.com/oauth-redirect) and Gemini CLI loopback redirects", async () => {
    const { app, emailSender } = makeGeminiTestApp();

    // 1. Gemini Enterprise DCR (confidential client_secret_basic)
    const entReg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Gemini Enterprise Data Store",
        redirect_uris: ["https://vertexaisearch.cloud.google.com/oauth-redirect"],
        token_endpoint_auth_method: "client_secret_basic",
        scope: "mcp:read"
      })
      .expect(201);

    const entVerifier = "gemini_enterprise_verifier_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const entChallenge = sha256Base64Url(entVerifier);
    const { callbackUrl: entCallback } = await completeAuthorizeAndGetCode({
      app,
      emailSender,
      clientId: entReg.body.client_id,
      redirectUri: "https://vertexaisearch.cloud.google.com/oauth-redirect",
      codeChallenge: entChallenge,
      email: "enterprise@example.com",
      state: "ent_state"
    });

    const basicHeader = Buffer.from(
      `${entReg.body.client_id}:${entReg.body.client_secret}`,
      "utf8"
    ).toString("base64");
    const entToken = await request(app)
      .post("/oauth/token")
      .set("Authorization", `Basic ${basicHeader}`)
      .type("form")
      .send({
        grant_type: "authorization_code",
        code: entCallback.searchParams.get("code"),
        redirect_uri: "https://vertexaisearch.cloud.google.com/oauth-redirect",
        code_verifier: entVerifier
      })
      .expect(200);
    expect(entToken.body.access_token).toMatch(/^sc_at_/);

    // 2. Gemini CLI dynamic_discovery loopback DCR (both localhost and 127.0.0.1 with ephemeral ports)
    const cliReg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Gemini CLI",
        redirect_uris: [
          "http://localhost:7777/oauth2callback",
          "http://127.0.0.1:7777/oauth2callback"
        ],
        token_endpoint_auth_method: "client_secret_post",
        scope: "mcp:read"
      })
      .expect(201);

    // RFC 8252 §8.4: loopback clients forced to public auth "none"
    expect(cliReg.body.token_endpoint_auth_method).toBe("none");
    expect(cliReg.body.client_secret).toBeUndefined();

    // Ephemeral port on localhost matches localhost registration (and 127.0.0.1 matches 127.0.0.1)
    const cliVerifier = "gemini_cli_verifier_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234";
    const cliChallenge = sha256Base64Url(cliVerifier);
    const dynamicLocalhostUri = "http://localhost:51842/oauth2callback";
    const { callbackUrl: cliCallback } = await completeAuthorizeAndGetCode({
      app,
      emailSender,
      clientId: cliReg.body.client_id,
      redirectUri: dynamicLocalhostUri,
      codeChallenge: cliChallenge,
      email: "cli-dev@example.com",
      state: "cli_state"
    });
    expect(cliCallback.origin + cliCallback.pathname).toBe(dynamicLocalhostUri);

    const cliToken = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: cliReg.body.client_id,
        code: cliCallback.searchParams.get("code"),
        redirect_uri: dynamicLocalhostUri,
        code_verifier: cliVerifier
      })
      .expect(200);
    expect(cliToken.body.access_token).toMatch(/^sc_at_/);

    // Strict RFC 8252 non-cross-matching & open-redirect protection
    expect(matchRedirectUri("http://127.0.0.1:51842/oauth2callback", ["http://localhost:7777/oauth2callback"])).toBe(false);
    expect(matchRedirectUri("http://localhost:51842/evil", ["http://localhost:7777/oauth2callback"])).toBe(false);
    expect(matchRedirectUri("http://evil.example/oauth2callback", ["http://localhost:7777/oauth2callback"])).toBe(false);
    expect(matchRedirectUri("https://vertexaisearch.cloud.google.com/oauth-redirect#frag", ["https://vertexaisearch.cloud.google.com/oauth-redirect"])).toBe(false);
  });

  it("enforces Streamable HTTP CORS/method semantics and preserves SSRF protections on CIMD fetches", async () => {
    const { app } = makeGeminiTestApp();

    // OPTIONS /mcp CORS preflight works unauthenticated with MCP headers
    const preflight = await request(app)
      .options("/mcp")
      .set("Origin", "https://gemini.google.com")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id")
      .expect(204);

    expect(preflight.headers["access-control-allow-origin"]).toBe("*");
    expect(preflight.headers["access-control-allow-headers"]).toContain("MCP-Protocol-Version");
    expect(preflight.headers["access-control-allow-headers"]).toContain("Mcp-Session-Id");
    expect(preflight.headers["access-control-expose-headers"]).toContain("WWW-Authenticate");

    // GET /mcp and DELETE /mcp return 401 unauthenticated (with WWW-Authenticate discovery)
    const getUnauth = await request(app).get("/mcp").expect(401);
    expect(String(getUnauth.headers["www-authenticate"])).toContain(
      'resource_metadata="https://shopcart.wals.pro/.well-known/oauth-protected-resource/mcp"'
    );
    await request(app).delete("/mcp").expect(401);

    // CIMD SSRF guards remain strict: reject http://, IP literals, metadata IPs, localhost, redirects
    expect(isCimdClientId("http://accountlinking.google.com/clientidmetadata/1")).toBe(false);
    expect(isCimdClientId("https://accountlinking.google.com/")).toBe(false);
    const liveResolver = new CimdResolver(safeFetch);
    await expect(liveResolver.resolve("https://169.254.169.254/latest/meta-data")).rejects.toThrow(SsrfError);
    await expect(liveResolver.resolve("https://localhost/client.json")).rejects.toThrow(SsrfError);
    await expect(liveResolver.resolve("https://metadata.google.internal/client.json")).rejects.toThrow(SsrfError);
  });
});

describe("Gemini CLI Extension manifest (gemini-extension.json) & GEMINI.md", () => {
  it("validates gemini-extension.json schema, package.json version sync, httpUrl (never url), and GEMINI.md", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      version: string;
      keywords: string[];
    };
    const extPath = path.join(REPO_ROOT, "gemini-extension.json");
    expect(fs.existsSync(extPath)).toBe(true);

    const ext = JSON.parse(fs.readFileSync(extPath, "utf8")) as {
      name: string;
      version: string;
      description: string;
      contextFileName: string;
      mcpServers: {
        shopcart: {
          httpUrl?: string;
          url?: string;
          authProviderType?: string;
        };
      };
    };

    expect(ext.name).toBe("shopcart-mcp");
    expect(ext.version).toBe(pkg.version);
    expect(ext.description.length).toBeGreaterThan(20);
    expect(ext.contextFileName).toBe("GEMINI.md");
    expect(ext.mcpServers.shopcart.httpUrl).toBe("https://shopcart.wals.pro/mcp");
    expect(ext.mcpServers.shopcart.url).toBeUndefined();
    expect(ext.mcpServers.shopcart.authProviderType).toBe("dynamic_discovery");

    const geminiMdPath = path.join(REPO_ROOT, ext.contextFileName);
    expect(fs.existsSync(geminiMdPath)).toBe(true);
    const geminiMd = fs.readFileSync(geminiMdPath, "utf8");
    for (const required of [
      "inspect_store",
      "list_collections",
      "search_products",
      "get_product",
      "get_store_policies",
      "find_store_discounts",
      "create_cart_link",
      "verify_handles",
      "read-only"
    ]) {
      expect(geminiMd).toContain(required);
    }

    // server.json stays MCP-Registry valid (description <= 100 chars, version synced)
    const serverJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "server.json"), "utf8")) as {
      version: string;
      description: string;
    };
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
    expect(pkg.keywords).toContain("gemini");
  });
});
