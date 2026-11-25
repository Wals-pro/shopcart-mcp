import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { CimdResolver, parseAndProjectCimdDocument } from "../src/auth/cimd.js";
import { sha256Base64Url } from "../src/auth/crypto.js";
import { MemoryEmailSender } from "../src/auth/email-otp.js";
import { matchRedirectUri } from "../src/auth/validation.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import type { SafeFetchResponse } from "../src/security/ssrf.js";

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
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
    }>;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual([
      "inspect_store",
      "search_products",
      "get_product",
      "create_cart_link"
    ]);
    for (const tool of tools) {
      expect(tool.title && tool.title.length > 0 && tool.title.length <= 64).toBe(true);
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.openWorldHint).toBe(true);
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
    await request(app).get("/icon-512.png").expect(200);

    // 2. Product-specific legal pages & security.txt
    const privacy = await request(app).get("/privacy?lang=en").expect(200);
    expect(privacy.text).toContain("Wals Professional Services GmbH");
    expect(privacy.text).toContain("not affiliated with or endorsed by Shopify Inc.");
    const terms = await request(app).get("/terms?lang=de").expect(200);
    expect(terms.text).toContain("Shopify Inc.");
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
});
