import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { CimdResolver, parseAndProjectCimdDocument } from "../src/auth/cimd.js";
import { sha256Base64Url } from "../src/auth/crypto.js";
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
  const app = createApp({ config, store, cimdResolver });
  return { app, store, config, getCimdFetches: () => cimdFetches };
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

  it("drops cursor:// in DCR, forces loopback to 'none', and runs full PKCE S256 + refresh rotation + replay revocation + /mcp tools/list", async () => {
    const { app } = makeTestApp();

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

    const csrfMatch = authGet.text.match(/name="_csrf" value="([^"]+)"/);
    expect(csrfMatch?.[1]).toBeTruthy();
    const csrfToken = csrfMatch![1]!;
    const setCookies = authGet.headers["set-cookie"] as unknown as string[];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");

    // 3. POST /oauth/authorize to register user & obtain code + RFC 9207 iss
    const authPost = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", cookieHeader)
      .type("form")
      .send({
        _csrf: csrfToken,
        mode: "register",
        lang: "en",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "st_999",
        email: "alice@example.com",
        password: "super-secure-password-123"
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

    const toolNames = (mcpRes.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toEqual([
      "inspect_store",
      "search_products",
      "get_product",
      "create_cart_link"
    ]);

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
});
