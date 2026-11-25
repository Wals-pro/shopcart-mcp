import express, { type Request, type Response, type Router } from "express";
import type { AppConfig } from "../config.js";
import type { ClientAuthMethod, OAuthClientRecord, StorageBackend, UserRecord } from "../store/types.js";
import { isPromoFreeProActive } from "../billing/quota.js";
import { CimdResolver, isCimdClientId, type ResolvedOAuthClient } from "./cimd.js";
import {
  createCsrfPair,
  hashPassword,
  parseCookies,
  randomToken,
  sha256Hex,
  timingSafeEqualStr,
  verifyCsrfPair,
  verifyPassword
} from "./crypto.js";
import { detectLang, renderAuthorizePage } from "./pages.js";
import {
  filterDcrRedirectUris,
  matchRedirectUri,
  normalizeScopes,
  resolveResourceParam,
  verifyPkceS256
} from "./validation.js";

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
const AUTH_CODE_TTL_SECONDS = 300;
const DCR_UNACTIVATED_TTL_MS = 30 * 24 * 3600 * 1000;
const DCR_ACTIVATED_TTL_MS = 90 * 24 * 3600 * 1000;
const WEB_SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
const CSRF_COOKIE = "sc_oauth_csrf";
export const SESSION_COOKIE = "sc_session";

class SimpleRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  check(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const existing = this.hits.get(key);
    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      if (this.hits.size > 5000) {
        for (const [k, v] of this.hits) {
          if (v.resetAt <= now) this.hits.delete(k);
        }
      }
      return true;
    }
    if (existing.count >= maxRequests) return false;
    existing.count += 1;
    return true;
  }
}

function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function setSecurityHeadersForHtml(res: Response): void {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

function formatCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean; httpOnly?: boolean; sameSite?: "Lax" | "Strict" }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${opts.maxAge}`,
    `SameSite=${opts.sameSite ?? "Lax"}`
  ];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

function parseBasicAuthHeader(
  header: string | undefined
): { clientId: string; clientSecret: string } | null {
  if (!header) return null;
  const match = header.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  const rawId = decoded.slice(0, idx);
  const rawSecret = decoded.slice(idx + 1);
  // RFC 6749 §2.3.1: Basic credentials may be application/x-www-form-urlencoded
  try {
    return {
      clientId: decodeURIComponent(rawId.replace(/\+/g, " ")),
      clientSecret: decodeURIComponent(rawSecret.replace(/\+/g, " "))
    };
  } catch {
    return { clientId: rawId, clientSecret: rawSecret };
  }
}

export function createOAuthRouter(
  config: AppConfig,
  store: StorageBackend,
  cimdResolver = new CimdResolver()
): Router {
  const router = express.Router();
  const rateLimiter = new SimpleRateLimiter();
  const issuer = config.appOrigin; // guaranteed no trailing slash!
  const canonicalResource = `${issuer}/mcp`;
  const isHttps = issuer.startsWith("https://");

  const protectedResourcePayload = {
    resource: canonicalResource,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:read"],
    resource_name: "shopcart-mcp"
  };

  const authServerMetadataPayload = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic"
    ],
    scopes_supported: ["mcp:read"]
  };

  async function resolveClient(clientId: string): Promise<ResolvedOAuthClient | null> {
    if (!clientId) return null;
    if (isCimdClientId(clientId)) {
      try {
        return await cimdResolver.resolve(clientId);
      } catch {
        return null;
      }
    }
    const dcr = await store.getOAuthClient(clientId);
    if (!dcr) return null;
    return {
      clientId: dcr.clientId,
      clientName: dcr.clientName,
      redirectUris: dcr.redirectUris,
      tokenEndpointAuthMethod: dcr.tokenEndpointAuthMethod,
      clientSecretHash: dcr.clientSecretHash,
      grantTypes: ["authorization_code", "refresh_token"],
      isCimd: false,
      applicationType: "web"
    };
  }

  // 1. Discovery endpoints (RFC 9728 + alias + RFC 8414)
  router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(protectedResourcePayload);
  });

  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(protectedResourcePayload);
  });

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(authServerMetadataPayload);
  });

  // 2. Dynamic Client Registration (RFC 7591)
  router.post("/oauth/register", express.json({ limit: "32kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const ip = getClientIp(req);
    if (!rateLimiter.check(`dcr:${ip}`, 30, 15 * 60 * 1000)) {
      res.status(429).json({
        error: "too_many_requests",
        error_description: "Rate limit exceeded for client registration"
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { accepted, hasLoopback } = filterDcrRedirectUris(body.redirect_uris);
    if (accepted.length === 0) {
      res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: "At least one valid https:// or loopback redirect_uri is required"
      });
      return;
    }

    const requestedMethod =
      typeof body.token_endpoint_auth_method === "string"
        ? body.token_endpoint_auth_method
        : "none";

    // RFC 8252 §8.4: force loopback-containing native clients to "none"
    let authMethod: ClientAuthMethod = "none";
    if (!hasLoopback) {
      if (
        requestedMethod === "client_secret_basic" ||
        requestedMethod === "client_secret_post" ||
        requestedMethod === "none"
      ) {
        authMethod = requestedMethod;
      } else {
        res.status(400).json({
          error: "invalid_client_metadata",
          error_description: `Unsupported token_endpoint_auth_method: ${requestedMethod}`
        });
        return;
      }
    }

    const clientId = `dcr_${randomToken(18)}`;
    const clientName =
      typeof body.client_name === "string" && body.client_name.trim()
        ? body.client_name.trim().slice(0, 120)
        : "MCP Client";
    const scopes = normalizeScopes(typeof body.scope === "string" ? body.scope : "");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DCR_UNACTIVATED_TTL_MS);

    let plaintextSecret: string | undefined;
    let clientSecretHash: string | null = null;
    if (authMethod !== "none") {
      plaintextSecret = `sc_cs_${randomToken(28)}`;
      clientSecretHash = sha256Hex(plaintextSecret);
    }

    const record: OAuthClientRecord = {
      clientId,
      clientName,
      redirectUris: accepted,
      tokenEndpointAuthMethod: authMethod,
      clientSecretHash,
      scope: scopes.join(" "),
      activated: false,
      createdAt: now,
      expiresAt
    };

    await store.saveOAuthClient(record);

    res.status(201).json({
      client_id: record.clientId,
      ...(plaintextSecret ? { client_secret: plaintextSecret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      client_name: record.clientName,
      redirect_uris: record.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: record.tokenEndpointAuthMethod,
      scope: record.scope
    });
  });

  // 3. Authorization endpoint (GET renders DE/EN Login+Register+Consent; POST authenticates & issues code)
  router.get("/oauth/authorize", async (req, res) => {
    const responseType = String(req.query.response_type ?? "");
    const clientId = String(req.query.client_id ?? "").trim();
    const redirectUri = String(req.query.redirect_uri ?? "").trim();
    const codeChallenge = String(req.query.code_challenge ?? "").trim();
    const codeChallengeMethod = String(req.query.code_challenge_method ?? "").trim();
    const state = String(req.query.state ?? "");
    const rawResource = typeof req.query.resource === "string" ? req.query.resource : undefined;
    const rawScope = typeof req.query.scope === "string" ? req.query.scope : "";
    const mode = req.query.mode === "login" ? "login" : "register";
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);

    if (responseType !== "code") {
      res.status(400).send("Invalid response_type: expected 'code'");
      return;
    }

    const client = await resolveClient(clientId);
    if (!client) {
      res.status(400).send("Unknown or invalid client_id");
      return;
    }

    if (!matchRedirectUri(redirectUri, client.redirectUris)) {
      res.status(400).send("redirect_uri does not match registered client redirect_uris");
      return;
    }

    const redirectError = (error: string, description: string) => {
      const target = new URL(redirectUri);
      target.searchParams.set("error", error);
      target.searchParams.set("error_description", description);
      if (state) target.searchParams.set("state", state);
      target.searchParams.set("iss", issuer);
      res.redirect(303, target.toString());
    };

    if (!codeChallenge || codeChallengeMethod !== "S256") {
      redirectError("invalid_request", "PKCE S256 code_challenge is required");
      return;
    }

    const resolvedRes = resolveResourceParam(rawResource, canonicalResource);
    if (!resolvedRes.ok) {
      redirectError(resolvedRes.error, resolvedRes.description);
      return;
    }

    const scopes = normalizeScopes(rawScope);
    const csrf = createCsrfPair(config.sessionSecret);
    res.setHeader(
      "Set-Cookie",
      formatCookie(CSRF_COOKIE, csrf.cookieValue, { maxAge: 1800, secure: isHttps })
    );
    setSecurityHeadersForHtml(res);

    const redirectHost = new URL(redirectUri).host;
    res.status(200).type("html").send(
      renderAuthorizePage({
        lang,
        clientName: client.clientName,
        clientId: client.clientId,
        redirectUri,
        redirectHost,
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: resolvedRes.resource,
        scope: scopes.join(" "),
        state,
        csrfToken: csrf.token,
        promoActive: isPromoFreeProActive(config),
        mode
      })
    );
  });

  router.post(
    "/oauth/authorize",
    express.urlencoded({ extended: false, limit: "16kb" }),
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, string | undefined>;
      const lang = detectLang(body.lang, req.headers["accept-language"]);
      const de = lang === "de";
      const mode: "login" | "register" = body.mode === "login" ? "login" : "register";
      const clientId = (body.client_id ?? "").trim();
      const redirectUri = (body.redirect_uri ?? "").trim();
      const codeChallenge = (body.code_challenge ?? "").trim();
      const codeChallengeMethod = (body.code_challenge_method ?? "").trim();
      const rawResource = body.resource;
      const scopeStr = normalizeScopes(body.scope).join(" ");
      const state = body.state ?? "";
      const email = (body.email ?? "").trim().toLowerCase();
      const password = body.password ?? "";
      const honeypot = (body.website ?? "").trim();

      const client = await resolveClient(clientId);
      if (!client || !matchRedirectUri(redirectUri, client.redirectUris)) {
        res.status(400).send("Invalid OAuth authorization request");
        return;
      }

      if (!codeChallenge || codeChallengeMethod !== "S256") {
        res.status(400).send("PKCE S256 required");
        return;
      }

      const resolvedRes = resolveResourceParam(rawResource, canonicalResource);
      if (!resolvedRes.ok) {
        res.status(400).send(resolvedRes.description);
        return;
      }

      const rerenderError = (errorMsg: string, statusCode = 400) => {
        const freshCsrf = createCsrfPair(config.sessionSecret);
        res.setHeader(
          "Set-Cookie",
          formatCookie(CSRF_COOKIE, freshCsrf.cookieValue, { maxAge: 1800, secure: isHttps })
        );
        setSecurityHeadersForHtml(res);
        res.status(statusCode).type("html").send(
          renderAuthorizePage({
            lang,
            clientName: client.clientName,
            clientId: client.clientId,
            redirectUri,
            redirectHost: new URL(redirectUri).host,
            codeChallenge,
            codeChallengeMethod: "S256",
            resource: resolvedRes.resource,
            scope: scopeStr,
            state,
            csrfToken: freshCsrf.token,
            promoActive: isPromoFreeProActive(config),
            mode,
            email,
            error: errorMsg
          })
        );
      };

      // Honeypot check
      if (honeypot.length > 0) {
        rerenderError(de ? "Anfrage abgelehnt." : "Request rejected.", 400);
        return;
      }

      // CSRF verification
      const cookies = parseCookies(req.headers.cookie);
      if (!verifyCsrfPair(config.sessionSecret, cookies[CSRF_COOKIE], body._csrf)) {
        rerenderError(
          de
            ? "Sitzung abgelaufen. Bitte erneut absenden."
            : "Form session expired. Please try again.",
          403
        );
        return;
      }

      // Rate limit per IP + email
      const ip = getClientIp(req);
      if (
        !rateLimiter.check(`auth:ip:${ip}`, 25, 10 * 60 * 1000) ||
        !rateLimiter.check(`auth:email:${email}`, 12, 10 * 60 * 1000)
      ) {
        rerenderError(
          de
            ? "Zu viele Versuche. Bitte warte ein paar Minuten."
            : "Too many attempts. Please wait a few minutes.",
          429
        );
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        rerenderError(de ? "Bitte eine gültige E-Mail-Adresse eingeben." : "Please enter a valid email address.");
        return;
      }
      if (password.length < 8 || password.length > 128) {
        rerenderError(
          de
            ? "Das Passwort muss mindestens 8 Zeichen lang sein."
            : "Password must be at least 8 characters long."
        );
        return;
      }

      let user: UserRecord | null = null;
      if (mode === "register") {
        const existing = await store.getUserByEmail(email);
        if (existing) {
          rerenderError(
            de
              ? "Diese E-Mail ist bereits registriert. Bitte wechsle auf 'Anmelden'."
              : "This email is already registered. Please switch to 'Sign in'."
          );
          return;
        }
        const { hash, salt } = await hashPassword(password);
        const now = new Date();
        const newUser: UserRecord = {
          id: sha256Hex(email),
          email,
          passwordHash: hash,
          passwordSalt: salt,
          plan: "free",
          status: "active",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          createdAt: now,
          updatedAt: now
        };
        const created = await store.createUser(newUser);
        if (!created) {
          rerenderError(
            de
              ? "Diese E-Mail ist bereits registriert. Bitte wechsle auf 'Anmelden'."
              : "This email is already registered. Please switch to 'Sign in'."
          );
          return;
        }
        user = newUser;
      } else {
        const existing = await store.getUserByEmail(email);
        if (!existing || !(await verifyPassword(password, existing.passwordHash, existing.passwordSalt))) {
          rerenderError(
            de ? "E-Mail oder Passwort ungültig." : "Invalid email or password.",
            401
          );
          return;
        }
        user = existing;
      }

      // Activate DCR client if applicable
      if (!client.isCimd) {
        await store.activateOAuthClient(
          client.clientId,
          new Date(Date.now() + DCR_ACTIVATED_TTL_MS)
        );
      }

      // Issue single-use authorization code
      const rawCode = `sc_code_${randomToken(32)}`;
      const now = new Date();
      await store.saveOAuthCode({
        codeHash: sha256Hex(rawCode),
        userId: user.id,
        clientId: client.clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: resolvedRes.resource,
        scopes: normalizeScopes(scopeStr),
        used: false,
        createdAt: now,
        expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_SECONDS * 1000)
      });

      // Set convenient web session cookie for /billing
      const rawSession = `sc_ws_${randomToken(32)}`;
      await store.saveWebSession({
        sessionHash: sha256Hex(rawSession),
        userId: user.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + WEB_SESSION_TTL_MS)
      });

      res.setHeader("Set-Cookie", [
        formatCookie(CSRF_COOKIE, "", { maxAge: 0, secure: isHttps }),
        formatCookie(SESSION_COOKIE, rawSession, {
          maxAge: Math.floor(WEB_SESSION_TTL_MS / 1000),
          secure: isHttps
        })
      ]);

      // RFC 9207: include exact issuer (no trailing slash) as `iss`
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", rawCode);
      if (state) callback.searchParams.set("state", state);
      callback.searchParams.set("iss", issuer);

      res.redirect(303, callback.toString());
    }
  );

  // 4. Token endpoint (authorization_code + refresh_token with rotation & replay family revocation)
  router.post(
    "/oauth/token",
    express.urlencoded({ extended: false, limit: "32kb" }),
    express.json({ limit: "32kb" }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");

      const body = (req.body ?? {}) as Record<string, string | undefined>;

      // Fail closed if private_key_jwt client_assertion is sent
      if (body.client_assertion || body.client_assertion_type) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "client_assertion / private_key_jwt is not supported"
        });
        return;
      }

      const basicCreds = parseBasicAuthHeader(req.headers.authorization);
      const clientId = (basicCreds?.clientId ?? body.client_id ?? "").trim();
      const clientSecret = basicCreds?.clientSecret ?? body.client_secret;

      if (!clientId) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "Missing client_id"
        });
        return;
      }

      const client = await resolveClient(clientId);
      if (!client) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "Unknown client_id"
        });
        return;
      }

      // Authenticate confidential clients (client_secret_basic / client_secret_post)
      if (client.tokenEndpointAuthMethod !== "none") {
        if (!clientSecret || !client.clientSecretHash) {
          res.status(401).json({
            error: "invalid_client",
            error_description: "Client authentication required"
          });
          return;
        }
        if (!timingSafeEqualStr(sha256Hex(clientSecret), client.clientSecretHash)) {
          res.status(401).json({
            error: "invalid_client",
            error_description: "Invalid client_secret"
          });
          return;
        }
      }

      const grantType = (body.grant_type ?? "").trim();

      if (grantType === "authorization_code") {
        const code = (body.code ?? "").trim();
        const redirectUri = (body.redirect_uri ?? "").trim();
        const codeVerifier = (body.code_verifier ?? "").trim();
        const rawResource = body.resource;

        if (!code || !redirectUri || !codeVerifier) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "code, redirect_uri, and code_verifier are required"
          });
          return;
        }

        const consumed = await store.consumeOAuthCode(sha256Hex(code));
        if (!consumed) {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "Authorization code is invalid, expired, or already used"
          });
          return;
        }

        if (consumed.clientId !== client.clientId || consumed.redirectUri !== redirectUri) {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "Authorization code binding mismatch"
          });
          return;
        }

        if (!verifyPkceS256(codeVerifier, consumed.codeChallenge)) {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "PKCE code_verifier verification failed"
          });
          return;
        }

        if (rawResource) {
          const resolved = resolveResourceParam(rawResource, canonicalResource);
          if (!resolved.ok || resolved.resource !== consumed.resource) {
            res.status(400).json({
              error: "invalid_target",
              error_description: "Resource mismatch with authorization request"
            });
            return;
          }
        }

        const familyId = `fam_${randomToken(18)}`;
        const now = new Date();
        const accessToken = `sc_at_${randomToken(32)}`;
        const refreshToken = `sc_rt_${randomToken(32)}`;

        await Promise.all([
          store.saveOAuthToken({
            tokenHash: sha256Hex(accessToken),
            type: "access",
            familyId,
            userId: consumed.userId,
            clientId: client.clientId,
            resource: consumed.resource,
            scopes: consumed.scopes,
            rotatedAt: null,
            revoked: false,
            createdAt: now,
            expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000)
          }),
          store.saveOAuthToken({
            tokenHash: sha256Hex(refreshToken),
            type: "refresh",
            familyId,
            userId: consumed.userId,
            clientId: client.clientId,
            resource: consumed.resource,
            scopes: consumed.scopes,
            rotatedAt: null,
            revoked: false,
            createdAt: now,
            expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000)
          })
        ]);

        res.status(200).json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: refreshToken,
          scope: consumed.scopes.join(" ")
        });
        return;
      }

      if (grantType === "refresh_token") {
        const rawRefresh = (body.refresh_token ?? "").trim();
        const rawResource = body.resource;
        if (!rawRefresh) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "refresh_token is required"
          });
          return;
        }

        const rotation = await store.rotateRefreshToken(sha256Hex(rawRefresh));
        if (rotation.status === "replayed") {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "Refresh token replay detected; token family revoked"
          });
          return;
        }
        if (rotation.status !== "ok") {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "Refresh token is invalid, revoked, or expired"
          });
          return;
        }

        const prev = rotation.record;
        if (prev.clientId !== client.clientId) {
          await store.revokeTokenFamily(prev.familyId);
          res.status(400).json({
            error: "invalid_grant",
            error_description: "Refresh token client mismatch"
          });
          return;
        }

        if (rawResource) {
          const resolved = resolveResourceParam(rawResource, canonicalResource);
          if (!resolved.ok || resolved.resource !== prev.resource) {
            res.status(400).json({
              error: "invalid_target",
              error_description: "Resource mismatch with token grant"
            });
            return;
          }
        }

        const now = new Date();
        const newAccess = `sc_at_${randomToken(32)}`;
        const newRefresh = `sc_rt_${randomToken(32)}`;

        await Promise.all([
          store.saveOAuthToken({
            tokenHash: sha256Hex(newAccess),
            type: "access",
            familyId: prev.familyId,
            userId: prev.userId,
            clientId: prev.clientId,
            resource: prev.resource,
            scopes: prev.scopes,
            rotatedAt: null,
            revoked: false,
            createdAt: now,
            expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000)
          }),
          store.saveOAuthToken({
            tokenHash: sha256Hex(newRefresh),
            type: "refresh",
            familyId: prev.familyId,
            userId: prev.userId,
            clientId: prev.clientId,
            resource: prev.resource,
            scopes: prev.scopes,
            rotatedAt: null,
            revoked: false,
            createdAt: now,
            expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000)
          })
        ]);

        res.status(200).json({
          access_token: newAccess,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: newRefresh,
          scope: prev.scopes.join(" ")
        });
        return;
      }

      res.status(400).json({
        error: "unsupported_grant_type",
        error_description: `Unsupported grant_type: ${grantType}`
      });
    }
  );

  // 5. Token Revocation (RFC 7009)
  router.post(
    "/oauth/revoke",
    express.urlencoded({ extended: false, limit: "16kb" }),
    express.json({ limit: "16kb" }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const body = (req.body ?? {}) as Record<string, string | undefined>;
      const token = (body.token ?? "").trim();
      if (token) {
        await store.revokeToken(sha256Hex(token));
      }
      res.status(200).json({ revoked: true });
    }
  );

  return router;
}
