import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { CimdResolver, parseAndProjectCimdDocument } from "../src/auth/cimd.js";
import { sha256Base64Url } from "../src/auth/crypto.js";
import { MemoryEmailSender } from "../src/auth/email-otp.js";
import { isValidRedirectUri, matchRedirectUri } from "../src/auth/validation.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import type { SafeFetchResponse } from "../src/security/ssrf.js";
import { buildOAuthCsp, normalizeFormActionOrigin } from "../src/web/analytics.js";

function makeTestApp(cimdMap: Record<string, { status?: number; body: unknown; cacheControl?: string }> = {}) {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00"
  });
  const store = new MemoryStore();
  const emailSender = new MemoryEmailSender();
  let cimdFetches = 0;
  const cimdResolver = new CimdResolver(async (url): Promise<SafeFetchResponse> => {
    cimdFetches++;
    const entry = cimdMap[url];
    if (!entry) {
      throw new Error("Simulated network error");
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
  return { app, store, config, emailSender, getCimdFetches: () => cimdFetches };
}

describe("OAuth 2.1 compliance & MCP auth", () => {
  it("serves RFC 9728 protected resource metadata (path + alias) and RFC 8414 AS metadata without trailing slash or private_key_jwt", async () => {
    const { app } = makeTestApp();

    const prm1 = await request(app).get("/.well-known/oauth-protected-resource/mcp").expect(200);
    const prm2 = await request(app).get("/.well-known/oauth-protected-resource").expect(200);
    expect(prm1.body).toEqual(prm2.body);
    expect(prm1.body.resource).toBe("https://shopcart.wals.pro/mcp");
    expect(prm1.body.authorization_servers).toEqual(["https://shopcart.wals.pro"]);

    const asMeta = await request(app).get("/.well-known/oauth-authorization-server").expect(200);
    expect(asMeta.body.issuer).toBe("https://shopcart.wals.pro");
    expect(asMeta.body.issuer.endsWith("/")).toBe(false);
    expect(asMeta.body.client_id_metadata_document_supported).toBe(true);
    expect(asMeta.body.authorization_response_iss_parameter_supported).toBe(true);
    expect(asMeta.body.token_endpoint_auth_methods_supported).toEqual([
      "none",
      "client_secret_post",
      "client_secret_basic"
    ]);
    expect(asMeta.body.token_endpoint_auth_methods_supported).not.toContain("private_key_jwt");
  });

  it("enforces RFC 6750 §3.1 split WWW-Authenticate on /mcp", async () => {
    const { app } = makeTestApp();

    // Missing Authorization header: NO error="invalid_token"
    const noAuth = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).expect(401);
    const hdrMissing = String(noAuth.headers["www-authenticate"] ?? "");
    expect(hdrMissing).toContain('resource_metadata="https://shopcart.wals.pro/.well-known/oauth-protected-resource/mcp"');
    expect(hdrMissing).toContain('scope="mcp:read"');
    expect(hdrMissing).not.toContain("invalid_token");

    // Invalid Bearer token: MUST include error="invalid_token"
    const badAuth = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer bogus_token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      .expect(401);
    const hdrBad = String(badAuth.headers["www-authenticate"] ?? "");
    expect(hdrBad).toContain('error="invalid_token"');
  });

  it("projects CIMD documents for Claude.ai, ChatGPT SEP-3149, VS Code, and enforces 60s cache floor", async () => {
    // Claude.ai jwt-bearer grant projection
    const claude = parseAndProjectCimdDocument("https://claude.ai/oauth/mcp-oauth-client-metadata", {
      client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: [
        "authorization_code",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:jwt-bearer"
      ],
      token_endpoint_auth_method: "none"
    });
    expect(claude.grantTypes).toEqual(["authorization_code", "refresh_token"]);
    expect(claude.tokenEndpointAuthMethod).toBe("none");

    // ChatGPT SEP-3149 private_key_jwt + none fallback
    const chatgpt = parseAndProjectCimdDocument("https://chatgpt.com/oauth/conn123/client.json", {
      client_id: "https://chatgpt.com/oauth/conn123/client.json",
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector/oauth/conn123"],
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"]
    });
    expect(chatgpt.tokenEndpointAuthMethod).toBe("none");

    // Reject shared-secret CIMD
    expect(() =>
      parseAndProjectCimdDocument("https://bad.example/client.json", {
        client_id: "https://bad.example/client.json",
        redirect_uris: ["https://bad.example/cb"],
        token_endpoint_auth_method: "client_secret_basic"
      })
    ).toThrow();

    // VS Code device_code + mixed native redirect_uris + 60s cache floor despite max-age=0
    const vsUrl = "https://vscode.dev/oauth/client-metadata.json";
    const resolver = new CimdResolver(async () => {
      const body = JSON.stringify({
        client_id: vsUrl,
        client_name: "Visual Studio Code",
        application_type: "native",
        redirect_uris: ["http://127.0.0.1:33418/", "https://vscode.dev/redirect"],
        grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
        token_endpoint_auth_method: "none"
      });
      return {
        status: 200,
        url: vsUrl,
        contentType: "application/json",
        headers: { "cache-control": "no-store, no-cache, max-age=0" },
        bodyBuffer: Buffer.from(body),
        bodyText: body
      };
    });
    const first = await resolver.resolve(vsUrl);
    const second = await resolver.resolve(vsUrl);
    expect(first.redirectUris).toEqual(["http://127.0.0.1:33418/", "https://vscode.dev/redirect"]);
    expect(second.clientName).toBe("Visual Studio Code");
  });

  it("matches RFC 8252 §7.3 loopback any-port without cross-matching localhost and 127.0.0.1", () => {
    expect(matchRedirectUri("http://127.0.0.1:54321/callback", ["http://127.0.0.1/callback"])).toBe(true);
    expect(matchRedirectUri("http://localhost:8999/callback", ["http://localhost/callback"])).toBe(true);
    expect(matchRedirectUri("http://localhost:8999/callback", ["http://127.0.0.1/callback"])).toBe(false);
    expect(matchRedirectUri("http://127.0.0.1:8999/other", ["http://127.0.0.1/callback"])).toBe(false);
  });

  it("drops cursor:// in DCR, forces loopback to 'none', and runs full PKCE S256 + passwordless OTP + refresh rotation + replay revocation + /mcp tools/list", async () => {
    const { app, emailSender } = makeTestApp();

    // 1. DCR with Cursor-style redirect_uris + empty scope
    const reg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Cursor Test",
        redirect_uris: [
          "cursor://anysphere.cursor-mcp/oauth/callback",
          "http://127.0.0.1/callback"
        ],
        token_endpoint_auth_method: "client_secret_post",
        scope: ""
      })
      .expect(201);

    expect(reg.body.redirect_uris).toEqual(["http://127.0.0.1/callback"]);
    expect(reg.body.token_endpoint_auth_method).toBe("none");
    expect(reg.body.client_secret).toBeUndefined();
    const clientId = reg.body.client_id as string;

    // 2. GET /oauth/authorize with RFC 8252 dynamic loopback port + PKCE S256
    const verifier = "verifier_abcdefghijklmnopqrstuvwxyz_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const challenge = sha256Base64Url(verifier);
    const redirectUri = "http://127.0.0.1:41234/callback";

    const authGet = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        state: "st_999"
      })
      .expect(200);

    expect(authGet.text).not.toContain('type="password"');
    const csrfMatch = authGet.text.match(/name="_csrf" value="([^"]+)"/);
    expect(csrfMatch?.[1]).toBeTruthy();
    const csrfToken = csrfMatch![1]!;
    const setCookies = authGet.headers["set-cookie"] as unknown as string[];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");

    // 3a. POST /oauth/authorize (step=email) -> sends 6-digit OTP + Magic Link email
    const step1Post = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", cookieHeader)
      .type("form")
      .send({
        _csrf: csrfToken,
        step: "email",
        lang: "en",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "st_999",
        email: "alice@example.com"
      })
      .expect(200);

    const sentMail = emailSender.lastFor("alice@example.com");
    expect(sentMail).toBeDefined();
    expect(sentMail!.code).toMatch(/^\d{6}$/);

    const csrf2 = step1Post.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const challengeId = step1Post.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;
    const step2Cookies = (step1Post.headers["set-cookie"] as unknown as string[])
      .map((c) => c.split(";")[0])
      .join("; ");

    // 3b. POST /oauth/authorize (step=verify) -> verifies 6-digit OTP & issues code + RFC 9207 iss
    const authPost = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", step2Cookies)
      .type("form")
      .send({
        _csrf: csrf2,
        step: "verify",
        challenge_id: challengeId,
        lang: "en",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "st_999",
        email: "alice@example.com",
        code: sentMail!.formattedCode
      })
      .expect(303);

    const loc = new URL(authPost.headers.location!);
    expect(loc.origin + loc.pathname).toBe(redirectUri);
    expect(loc.searchParams.get("state")).toBe("st_999");
    expect(loc.searchParams.get("iss")).toBe("https://shopcart.wals.pro");
    const code = loc.searchParams.get("code")!;
    expect(code).toMatch(/^sc_code_/);

    // 4. Reject client_assertion fail-closed
    await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        client_assertion: "eyJhbGciOiJSUzI1NiJ9.fake.sig",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
      .expect(401);

    // 5. Exchange code for tokens
    const tok1 = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: "https://shopcart.wals.pro/mcp"
      })
      .expect(200);

    expect(tok1.body.access_token).toMatch(/^sc_at_/);
    expect(tok1.body.refresh_token).toMatch(/^sc_rt_/);

    // 6. Call /mcp tools/list with Bearer token
    const mcpRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${tok1.body.access_token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
      .expect(200);

    const tools = mcpRes.body.result.tools as Array<{
      name: string;
      title?: string;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
      };
    }>;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual([
      "discover_stores",
      "inspect_store",
      "list_collections",
      "search_products",
      "get_product",
      "get_store_policies",
      "find_store_discounts",
      "create_cart_link",
      "compare_prices",
      "find_hot_deals",
      "match_visual_product",
      "search_secondhand_marketplaces"
    ]);
    for (const tool of tools) {
      expect(tool.title && tool.title.length > 0 && tool.title.length <= 64).toBe(true);
      if (tool.name === "create_cart_link") {
        expect(tool.annotations?.readOnlyHint).toBe(false);
        expect(tool.annotations?.idempotentHint).toBe(false);
      } else {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.idempotentHint).toBe(true);
      }
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.openWorldHint).toBe(tool.name !== "discover_stores");
    }

    // Verify initialize returns server instructions
    const initRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${tok1.body.access_token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 10,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" }
        }
      })
      .expect(200);
    expect(String(initRes.body.result.instructions ?? "")).toContain("untrusted");

    // 7. Rotate refresh token -> new pair works
    const tok2 = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tok1.body.refresh_token
      })
      .expect(200);
    expect(tok2.body.refresh_token).not.toBe(tok1.body.refresh_token);

    // 8. Replay old refresh token -> 400 invalid_grant AND entire family revoked!
    await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tok1.body.refresh_token
      })
      .expect(400);

    // New access token from same family must now be rejected with 401 invalid_token!
    await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${tok2.body.access_token}`)
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list" })
      .expect(401);
  });

  it("supports confidential web DCR clients with client_secret_basic and rejects foreign RFC 8707 resource", async () => {
    const { app } = makeTestApp();
    const reg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Confidential Web",
        redirect_uris: ["https://partner.example/oauth/cb"],
        token_endpoint_auth_method: "client_secret_basic"
      })
      .expect(201);

    expect(reg.body.token_endpoint_auth_method).toBe("client_secret_basic");
    expect(reg.body.client_secret).toMatch(/^sc_cs_/);

    // Foreign resource rejected via redirect with invalid_target
    const verifier = "verifier_abcdefghijklmnopqrstuvwxyz_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const badRes = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: reg.body.client_id,
        redirect_uri: "https://partner.example/oauth/cb",
        code_challenge: sha256Base64Url(verifier),
        code_challenge_method: "S256",
        resource: "https://evil.example/mcp"
      })
      .expect(303);
    expect(badRes.headers.location).toContain("error=invalid_target");
  });

  it("serves directory-readiness icons, product-specific /privacy & /terms, security.txt, mcp.json, env challenges, tool titles/annotations, and >=30d DCR TTL", async () => {
    const { app, store } = makeTestApp();

    // 1. Static icons unauthenticated
    const ico = await request(app).get("/favicon.ico").expect(200);
    expect(ico.headers["content-type"]).toContain("image/x-icon");
    const svg = await request(app).get("/favicon.svg").expect(200);
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    await request(app).get("/favicon.png").expect(200);
    await request(app).get("/apple-touch-icon.png").expect(200);
    await request(app).get("/icon-192.png").expect(200);
    await request(app).get("/icon-512.png").expect(200);
    await request(app).get("/logo.svg").expect(200);
    await request(app).get("/manifest.webmanifest").expect(200);

    // 2. Product-specific legal pages & security.txt
    const privacy = await request(app).get("/privacy?lang=en").expect(200);
    expect(privacy.text).toContain("Wals Professional Services GmbH");
    expect(privacy.text).toContain(
      "not affiliated with or endorsed by Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware, or Adobe (Magento)"
    );
    const terms = await request(app).get("/terms?lang=de").expect(200);
    expect(terms.text).toContain("Shopify, WooCommerce, BigCommerce, Shopware 6, Magento 2");
    expect(terms.text).toContain("nicht verbunden mit oder unterstützt von Shopify");
    const sec = await request(app).get("/.well-known/security.txt").expect(200);
    expect(sec.text).toContain("Contact: mailto:security@wals.pro");

    // 3. Server card
    const mcpCard = await request(app).get("/.well-known/mcp.json").expect(200);
    expect(mcpCard.body.name).toBe("io.github.Wals-pro/shopcart-mcp");
    expect(mcpCard.body.privacy_policy_url).toBe("https://shopcart.wals.pro/privacy");

    // 4. Zero-redeploy verification endpoints return 404 when env empty, 200 text/plain exact match when set
    await request(app).get("/.well-known/openai-apps-challenge").expect(404);
    await request(app).get("/.well-known/mcp-registry-auth").expect(404);

    const cfgWithTokens = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      STORAGE_BACKEND: "memory",
      SESSION_SECRET: "test-session-secret-0123456789abcdef",
      OPENAI_APPS_CHALLENGE: "openai-token-12345",
      MCP_REGISTRY_AUTH: "v=MCPv1; k=ed25519; p=AAAA"
    });
    const appWithTokens = createApp({ config: cfgWithTokens, store: new MemoryStore() });
    const oai = await request(appWithTokens).get("/.well-known/openai-apps-challenge").expect(200);
    expect(oai.headers["content-type"]).toContain("text/plain");
    expect(oai.text).toBe("openai-token-12345");
    const regAuth = await request(appWithTokens).get("/.well-known/mcp-registry-auth").expect(200);
    expect(regAuth.headers["content-type"]).toContain("text/plain");
    expect(regAuth.text).toBe("v=MCPv1; k=ed25519; p=AAAA");

    // 5. DCR unactivated TTL >= 30 days (Glama compatibility)
    const reg = await request(app)
      .post("/oauth/register")
      .send({ client_name: "Glama Probe", redirect_uris: ["https://glama.ai/oauth/callback"] })
      .expect(201);
    const savedClient = await store.getOAuthClient(reg.body.client_id);
    expect(savedClient).not.toBeNull();
    const ttlDays = (savedClient!.expiresAt.getTime() - savedClient!.createdAt.getTime()) / (24 * 3600 * 1000);
    expect(ttlDays).toBeGreaterThanOrEqual(30);
  });

  it("supports stateless signed CSRF without cookie + Origin check and sends CSP img-src 'self' data: on /oauth/authorize & /billing/login", async () => {
    const { app, emailSender } = makeTestApp();

    const reg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Safari Webview Client",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none"
      })
      .expect(201);

    const clientId = reg.body.client_id as string;
    const verifier = "verifier_stateless_csrf_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_012345";
    const challenge = sha256Base64Url(verifier);
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";

    // 1. GET /oauth/authorize & /billing/login include img-src 'self' data: in CSP
    const authGet = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        state: "st_csrf"
      })
      .expect(200);

    expect(String(authGet.headers["content-security-policy"] ?? "")).toContain("img-src 'self' data:");
    expect(String(authGet.headers["content-security-policy"] ?? "")).toContain("form-action 'self' https://claude.ai");
    expect(authGet.headers["referrer-policy"]).toBe("same-origin");
    const csrfToken = authGet.text.match(/name="_csrf" value="([^"]+)"/)![1]!;

    const billingGet = await request(app).get("/billing/login?lang=de").expect(200);
    expect(String(billingGet.headers["content-security-policy"] ?? "")).toContain("img-src 'self' data:");
    expect(billingGet.headers["referrer-policy"]).toBe("same-origin");
    const billingCsrf = billingGet.text.match(/name="_csrf" value="([^"]+)"/)![1]!;

    // 2. Foreign Origin is blocked with 403 even with a valid signed CSRF token
    await request(app)
      .post("/oauth/authorize")
      .set("Origin", "https://evil.example")
      .type("form")
      .send({
        _csrf: csrfToken,
        step: "email",
        lang: "en",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "st_csrf",
        email: "stateless@example.com"
      })
      .expect(403);

    await request(app)
      .post("/billing/login")
      .set("Origin", "https://evil.example")
      .type("form")
      .send({
        _csrf: billingCsrf,
        lang: "de",
        email: "stateless@example.com"
      })
      .expect(403);

    // 3. Cross-context replay (different PKCE challenge) is rejected with 403
    await request(app)
      .post("/oauth/authorize")
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({
        _csrf: csrfToken,
        step: "email",
        lang: "en",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: sha256Base64Url("other_verifier_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_012345"),
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "st_csrf",
        email: "stateless@example.com"
      })
      .expect(403);

    // 4. Valid signed CSRF token + matching Origin succeeds WITHOUT any Cookie header
    const step1 = await request(app)
      .post("/oauth/authorize")
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({
        _csrf: csrfToken,
        step: "email",
        lang: "en",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "st_csrf",
        email: "stateless@example.com"
      })
      .expect(200);

    const mail = emailSender.lastFor("stateless@example.com");
    expect(mail).toBeDefined();
    const csrf2 = step1.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const challengeId = step1.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;

    // Step 2 also succeeds WITHOUT any Cookie header when Origin matches and token is valid
    const step2 = await request(app)
      .post("/oauth/authorize")
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({
        _csrf: csrf2,
        step: "verify",
        challenge_id: challengeId,
        lang: "en",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "st_csrf",
        email: "stateless@example.com",
        code: mail!.code
      })
      .expect(303);

    expect(new URL(step2.headers.location!).searchParams.get("code")).toMatch(/^sc_code_/);

    // 5. /billing/login also succeeds WITHOUT Cookie header when Origin matches
    await request(app)
      .post("/billing/login")
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({
        _csrf: billingCsrf,
        lang: "de",
        email: "stateless-billing@example.com"
      })
      .expect(200);
  });

  it("completes OpenAI/ChatGPT CIMD popup flow with ~750-char relay state, allows cross-origin HTTPS redirect hops in CSP form-action, and renders visible errors on invalid/reused OTP", async () => {
    const openaiClientId = "https://chatgpt.com/oauth/client.json";
    const openaiRedirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
    const syntheticRelayPayload = {
      oauth_id: "oauth_s_00000000000000000000000000000001",
      app_id: "asdk_app_00000000000000000000000000000001",
      version_id: "asdk_app_v_00000000000000000000000000000001",
      org_id: "org-exampleOrgId0000000000000001",
      target_uri:
        "https://platform.openai.com/plugins/manage/plugin_asdk_app_00000000000000000000000000000001" +
        "?tab=mcp&version=appsub_00000000000000000000000000000001" +
        "&mcp_connection_app_id=asdk_app_00000000000000000000000000000001" +
        "&mcp_connection_version_id=asdk_app_v_00000000000000000000000000000001",
      purpose: "draft"
    };
    const openaiRelayState = `openai_platform_oauth_relay__${Buffer.from(
      JSON.stringify(syntheticRelayPayload),
      "utf8"
    ).toString("base64")}`;
    expect(openaiRelayState.length).toBeGreaterThan(700);

    const { app, emailSender } = makeTestApp({
      [openaiClientId]: {
        body: {
          client_id: openaiClientId,
          client_uri: "https://chatgpt.com/",
          redirect_uris: [openaiRedirectUri],
          token_endpoint_auth_method: "private_key_jwt",
          token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
          grant_types: [
            "authorization_code",
            "refresh_token",
            "urn:ietf:params:oauth:grant-type:jwt-bearer"
          ],
          response_types: ["code"],
          client_name: "ChatGPT"
        }
      }
    });

    const verifier = "openai_pkce_verifier_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789";
    const challenge = sha256Base64Url(verifier);

    // 1. GET /oauth/authorize with OpenAI's CIMD client_id, redirect_uri, resource & ~750-char state
    const authGet = await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: openaiClientId,
        redirect_uri: openaiRedirectUri,
        scope: "mcp:read",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        state: openaiRelayState,
        lang: "de"
      })
      .expect(200);

    // CSP form-action MUST permit downstream https: hops (e.g. chatgpt.com -> platform.openai.com)
    const getCsp = String(authGet.headers["content-security-policy"] ?? "");
    expect(getCsp).toContain("form-action 'self' https://chatgpt.com https:");
    expect(getCsp).not.toMatch(/form-action[^;]*\bhttp:/);
    expect(authGet.text).toContain(`name="state" value="${openaiRelayState}"`);

    const csrf1 = authGet.text.match(/name="_csrf" value="([^"]+)"/)![1]!;

    // 2. POST /oauth/authorize (step=email) without cookies (popup context) -> 200 OTP form
    const step1 = await request(app)
      .post("/oauth/authorize")
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({
        _csrf: csrf1,
        step: "email",
        lang: "de",
        client_id: openaiClientId,
        redirect_uri: openaiRedirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: openaiRelayState,
        email: "alice@example.com"
      })
      .expect(200);

    // CSP on the OTP verify page (the document submitting the form that receives the 303!)
    // MUST also allow downstream https: hops so Chromium/Safari follow chatgpt.com -> platform.openai.com.
    const step1Csp = String(step1.headers["content-security-policy"] ?? "");
    expect(step1Csp).toContain("form-action 'self' https://chatgpt.com https:");
    expect(step1.text).toContain(`name="state" value="${openaiRelayState}"`);

    const mail = emailSender.lastFor("alice@example.com")!;
    expect(mail).toBeDefined();
    const csrf2 = step1.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const challengeId = step1.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;

    // 3a. Invalid OTP format -> 400 staying on verify step with visible role="alert" banner above consent box
    const badFormat = await request(app)
      .post("/oauth/authorize")
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({
        _csrf: csrf2,
        step: "verify",
        challenge_id: challengeId,
        lang: "de",
        client_id: openaiClientId,
        redirect_uri: openaiRedirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: openaiRelayState,
        email: "alice@example.com",
        code: "abc"
      })
      .expect(400);

    expect(badFormat.text).toContain('class="banner err" role="alert"');
    expect(badFormat.text).toContain("6-stelligen Zahlencode");
    expect(badFormat.text).toContain(`name="challenge_id" value="${challengeId}"`);
    expect(badFormat.text.indexOf('class="banner err"')).toBeLessThan(
      badFormat.text.indexOf('class="consent-box"')
    );
    const csrf3 = badFormat.text.match(/name="_csrf" value="([^"]+)"/)![1]!;

    // 3b. Valid 6-digit OTP -> 303 redirect to chatgpt.com with exact code, ~750-char state & RFC 9207 iss
    const verifyOk = await request(app)
      .post("/oauth/authorize")
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({
        _csrf: csrf3,
        step: "verify",
        challenge_id: challengeId,
        lang: "de",
        client_id: openaiClientId,
        redirect_uri: openaiRedirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: openaiRelayState,
        email: "alice@example.com",
        code: mail.formattedCode
      })
      .expect(303);

    expect(verifyOk.headers["cache-control"]).toBe("no-store");
    const callback = new URL(verifyOk.headers.location!);
    expect(callback.origin + callback.pathname).toBe(openaiRedirectUri);
    expect(callback.searchParams.get("state")).toBe(openaiRelayState);
    expect(callback.searchParams.get("iss")).toBe("https://shopcart.wals.pro");
    const authCode = callback.searchParams.get("code")!;
    expect(authCode).toMatch(/^sc_code_/);

    // 3c. Replaying the already-used OTP -> 400 with visible error banner (never silent reset)
    const replayUsed = await request(app)
      .post("/oauth/authorize")
      .set("Origin", "https://shopcart.wals.pro")
      .type("form")
      .send({
        _csrf: csrf3,
        step: "verify",
        challenge_id: challengeId,
        lang: "de",
        client_id: openaiClientId,
        redirect_uri: openaiRedirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: openaiRelayState,
        email: "alice@example.com",
        code: mail.code
      })
      .expect(400);

    expect(replayUsed.text).toContain('class="banner err" role="alert"');
    expect(replayUsed.text).toContain("bereits verwendet");
    expect(replayUsed.text.indexOf('class="banner err"')).toBeLessThan(
      replayUsed.text.indexOf('class="consent-box"')
    );

    // 4. Token exchange at POST /oauth/token with ChatGPT CIMD client_id (auth method negotiated to "none")
    const tokenRes = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: openaiClientId,
        code: authCode,
        redirect_uri: openaiRedirectUri,
        code_verifier: verifier,
        resource: "https://shopcart.wals.pro/mcp"
      })
      .expect(200);

    expect(tokenRes.body.access_token).toMatch(/^sc_at_/);
    expect(tokenRes.body.refresh_token).toMatch(/^sc_rt_/);

    // 5. Access token works on /mcp tools/list
    await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${tokenRes.body.access_token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);

    // 6. Verify /auth/magic keeps strict form-action 'self' (without https:)
    const magicErr = await request(app).get("/auth/magic?token=invalid").expect(400);
    expect(String(magicErr.headers["content-security-policy"] ?? "")).toContain("form-action 'self';");

    // 7. Verify first-party pin fallback for https://chatgpt.com/oauth/client.json when live fetch fails
    const { app: offlineApp } = makeTestApp({});
    await request(offlineApp)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: openaiClientId,
        redirect_uri: openaiRedirectUri,
        scope: "mcp:read",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        state: openaiRelayState
      })
      .expect(200);
  });

  it("rejects CSP-delimiter/non-LDH redirect_uri hostnames in isValidRedirectUri and normalizeFormActionOrigin/buildOAuthCsp", () => {
    const maliciousRedirects = [
      "https://a.b;frame-ancestors/cb",
      "https://a.b;script-src/cb",
      "https://evil.example,https://other.example/cb",
      "https://-bad.example/cb",
      "https://bad-.example/cb",
      "https://a..b.example/cb",
      "https://bad_host.example/cb",
      "http://evil.example/cb"
    ];

    for (const uri of maliciousRedirects) {
      expect(isValidRedirectUri(uri), `isValidRedirectUri(${uri})`).toBe(false);
      expect(normalizeFormActionOrigin(uri), `normalizeFormActionOrigin(${uri})`).toBeNull();
      const csp = buildOAuthCsp(undefined, uri);
      expect(csp).toContain("form-action 'self';");
      expect(csp).not.toContain("a.b;frame-ancestors");
    }

    // Valid HTTPS LDH & loopback origins still pass cleanly
    expect(isValidRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(isValidRedirectUri("http://127.0.0.1:45678/callback")).toBe(true);
    expect(isValidRedirectUri("http://localhost:8080/callback")).toBe(true);
    expect(isValidRedirectUri("http://[::1]:8080/callback")).toBe(true);
    expect(normalizeFormActionOrigin("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(
      "https://chatgpt.com"
    );
    expect(normalizeFormActionOrigin("http://127.0.0.1:45678/callback")).toBe(
      "http://127.0.0.1:45678"
    );
    expect(normalizeFormActionOrigin("http://[::1]:8080/callback")).toBe("http://[::1]:8080");
  });

  it("prevents leftmost X-Forwarded-For spoofing from bypassing per-IP rate limits on POST /oauth/register and POST /billing/login", async () => {
    const { app } = makeTestApp();

    // 1. DCR rate limit (30 / 15 min): rotating leftmost XFF entries with the same rightmost proxy-appended IP
    for (let i = 1; i <= 30; i++) {
      await request(app)
        .post("/oauth/register")
        .set("X-Forwarded-For", `198.51.100.${i}, 203.0.113.10`)
        .send({
          client_name: `Client ${i}`,
          redirect_uris: ["https://partner.example/oauth/cb"]
        })
        .expect(201);
    }

    const blockedDcr = await request(app)
      .post("/oauth/register")
      .set("X-Forwarded-For", "198.51.100.99, 203.0.113.10")
      .send({
        client_name: "Client 31",
        redirect_uris: ["https://partner.example/oauth/cb"]
      })
      .expect(429);
    expect(blockedDcr.body.error).toBe("too_many_requests");

    // A genuinely different rightmost client IP is still allowed (buckets are per trusted client key)
    await request(app)
      .post("/oauth/register")
      .set("X-Forwarded-For", "198.51.100.1, 203.0.113.20")
      .send({
        client_name: "Other IP Client",
        redirect_uris: ["https://partner.example/oauth/cb"]
      })
      .expect(201);

    // 2. Billing OTP IP rate limit (15 / 10 min): rotating leftmost XFF entries with distinct emails
    const loginPage = await request(app).get("/billing/login?lang=en").expect(200);
    const billingCsrf = loginPage.text.match(/name="_csrf" value="([^"]+)"/)![1]!;

    for (let i = 1; i <= 15; i++) {
      await request(app)
        .post("/billing/login")
        .set("Origin", "https://shopcart.wals.pro")
        .set("X-Forwarded-For", `198.51.100.${i}, 203.0.113.10`)
        .type("form")
        .send({
          _csrf: billingCsrf,
          lang: "en",
          email: `user${i}@example.com`
        })
        .expect(200);
    }

    const blockedBilling = await request(app)
      .post("/billing/login")
      .set("Origin", "https://shopcart.wals.pro")
      .set("X-Forwarded-For", "198.51.100.99, 203.0.113.10")
      .type("form")
      .send({
        _csrf: billingCsrf,
        lang: "en",
        email: "user16@example.com"
      })
      .expect(429);
    expect(blockedBilling.text).toContain("Too many code requests");
  });

  it("rejects duplicate or non-string RFC 8707 resource parameters fail-closed on /oauth/authorize and /oauth/token", async () => {
    const { app } = makeTestApp();
    const redirectUri = "https://partner.example/oauth/cb";
    const reg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Resource Hardening Test",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none"
      })
      .expect(201);
    const clientId = reg.body.client_id as string;
    const verifier = "verifier_resource_hardening_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const challenge = sha256Base64Url(verifier);

    // 1. GET /oauth/authorize with duplicate resource (canonical + evil) -> 303 error=invalid_target
    const dupMixed = await request(app)
      .get(
        `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256` +
          `&state=st_dup1` +
          `&resource=${encodeURIComponent("https://shopcart.wals.pro/mcp")}` +
          `&resource=${encodeURIComponent("https://evil.example/mcp")}`
      )
      .expect(303);
    const dupMixedUrl = new URL(dupMixed.headers.location!);
    expect(dupMixedUrl.origin + dupMixedUrl.pathname).toBe(redirectUri);
    expect(dupMixedUrl.searchParams.get("error")).toBe("invalid_target");
    expect(dupMixedUrl.searchParams.get("state")).toBe("st_dup1");
    expect(dupMixedUrl.searchParams.get("iss")).toBe("https://shopcart.wals.pro");

    // 2. GET /oauth/authorize with two foreign resources -> 303 error=invalid_target
    const dupForeign = await request(app)
      .get(
        `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256` +
          `&state=st_dup2` +
          `&resource=${encodeURIComponent("https://evil1.example/mcp")}` +
          `&resource=${encodeURIComponent("https://evil2.example/mcp")}`
      )
      .expect(303);
    const dupForeignUrl = new URL(dupForeign.headers.location!);
    expect(dupForeignUrl.searchParams.get("error")).toBe("invalid_target");
    expect(dupForeignUrl.searchParams.get("state")).toBe("st_dup2");

    // 3. POST /oauth/authorize with duplicate urlencoded resource field -> 303 error=invalid_target
    const dupPostAuth = await request(app)
      .post("/oauth/authorize")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(
        `step=email&client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256` +
          `&state=st_dup_post` +
          `&resource=${encodeURIComponent("https://shopcart.wals.pro/mcp")}` +
          `&resource=${encodeURIComponent("https://evil.example/mcp")}`
      )
      .expect(303);
    const dupPostUrl = new URL(dupPostAuth.headers.location!);
    expect(dupPostUrl.origin + dupPostUrl.pathname).toBe(redirectUri);
    expect(dupPostUrl.searchParams.get("error")).toBe("invalid_target");
    expect(dupPostUrl.searchParams.get("state")).toBe("st_dup_post");

    // 4. POST /oauth/token with duplicate urlencoded resource field -> 400 invalid_target
    const dupTokForm = await request(app)
      .post("/oauth/token")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(
        `grant_type=authorization_code&client_id=${encodeURIComponent(clientId)}` +
          `&code=sc_code_dummy&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&code_verifier=${encodeURIComponent(verifier)}` +
          `&resource=${encodeURIComponent("https://shopcart.wals.pro/mcp")}` +
          `&resource=${encodeURIComponent("https://evil.example/mcp")}`
      )
      .expect(400);
    expect(dupTokForm.body.error).toBe("invalid_target");

    // 5. POST /oauth/token with JSON array / object resource -> 400 invalid_target
    const dupTokJsonArr = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: "sc_rt_dummy",
        resource: ["https://shopcart.wals.pro/mcp", "https://evil.example/mcp"]
      })
      .expect(400);
    expect(dupTokJsonArr.body.error).toBe("invalid_target");

    const dupTokJsonObj = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code: "sc_code_dummy",
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: { href: "https://shopcart.wals.pro/mcp" }
      })
      .expect(400);
    expect(dupTokJsonObj.body.error).toBe("invalid_target");
  });

  it("enforces atomic refresh rotation against family revocation and refuses to stub deleted clients on activateOAuthClient", async () => {
    const { app, store } = makeTestApp();

    // 1. activateOAuthClient on a non-existent/deleted client MUST NOT create a stub
    await store.activateOAuthClient("dcr_nonexistent", new Date(Date.now() + 3600 * 1000));
    expect(await store.getOAuthClient("dcr_nonexistent")).toBeNull();

    // 2. Register client & seed an active refresh token in family fam_race_1
    const reg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Atomic Rotation Test",
        redirect_uris: ["http://127.0.0.1/callback"]
      })
      .expect(201);
    const clientId = reg.body.client_id as string;

    const now = new Date();
    const exp = new Date(now.getTime() + 3600 * 1000);
    const userId = "user_atomic_rot";
    await store.createUser({
      id: userId,
      email: "atomic@example.com",
      passwordHash: "",
      passwordSalt: "",
      plan: "free",
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      createdAt: now,
      updatedAt: now
    });

    const rt1 = "sc_rt_atomic_initial_token_0123456789";
    await store.saveOAuthToken({
      tokenHash: (await import("../src/auth/crypto.js")).sha256Hex(rt1),
      type: "refresh",
      familyId: "fam_race_1",
      userId,
      clientId,
      resource: "https://shopcart.wals.pro/mcp",
      scopes: ["mcp:read"],
      rotatedAt: null,
      revoked: false,
      createdAt: now,
      expiresAt: exp
    });

    // Rotate once -> succeeds
    const rot1 = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "refresh_token", client_id: clientId, refresh_token: rt1 })
      .expect(200);
    const at2 = rot1.body.access_token as string;
    const rt2 = rot1.body.refresh_token as string;

    // Revoke family -> neither at2 nor rt2 can survive or rotate
    await store.revokeTokenFamily("fam_race_1");

    await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${at2}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      .expect(401);

    await request(app)
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "refresh_token", client_id: clientId, refresh_token: rt2 })
      .expect(400);
  });
});
