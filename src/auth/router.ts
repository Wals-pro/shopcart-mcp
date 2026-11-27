import express, { type Request, type Response, type Router } from "express";
import type { AppConfig } from "../config.js";
import type { ClientAuthMethod, OAuthClientRecord, StorageBackend } from "../store/types.js";
import { isPromoFreeProActive } from "../billing/quota.js";
import { buildOAuthCsp } from "../web/analytics.js";
import { extractTrustedClientKey } from "../web/store-check-core.js";
import { CimdResolver, isCimdClientId, type ResolvedOAuthClient } from "./cimd.js";
import {
  createCsrfPair,
  parseCookies,
  randomToken,
  sha256Hex,
  timingSafeEqualStr,
  verifyCsrfRequest
} from "./crypto.js";
import {
  EmailOtpService,
  OTP_BIND_COOKIE,
  ensureUserByEmail,
  normalizeEmail
} from "./email-otp.js";
import { detectLang, renderAuthorizePage, renderMagicLinkResultPage } from "./pages.js";
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

function setSecurityHeadersForHtml(
  res: Response,
  config: AppConfig,
  opts?: {
    formActionOrigin?: string;
    referrerPolicy?: "same-origin" | "no-referrer";
    allowAnalytics?: boolean;
  }
): void {
  res.setHeader(
    "Content-Security-Policy",
    buildOAuthCsp(
      opts?.allowAnalytics === false ? undefined : config.ga4MeasurementId,
      opts?.formActionOrigin
    )
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", opts?.referrerPolicy ?? "same-origin");
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
  cimdResolver = new CimdResolver(),
  otpService = new EmailOtpService({ config, store })
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
    scopes_supported: ["mcp:read"],
    logo_uri: `${issuer}/icon-512.png`
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
    const ip = extractTrustedClientKey(req, config.trustedProxyHops);
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

  async function completeOAuthAuthorization(params: {
    res: Response;
    email: string;
    client: ResolvedOAuthClient;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
    scopeStr: string;
    state: string;
  }): Promise<void> {
    const user = await ensureUserByEmail(store, params.email);

    if (!params.client.isCimd) {
      await store.activateOAuthClient(
        params.client.clientId,
        new Date(Date.now() + DCR_ACTIVATED_TTL_MS)
      );
    }

    const rawCode = `sc_code_${randomToken(32)}`;
    const now = new Date();
    await store.saveOAuthCode({
      codeHash: sha256Hex(rawCode),
      userId: user.id,
      clientId: params.client.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: "S256",
      resource: params.resource,
      scopes: normalizeScopes(params.scopeStr),
      used: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_SECONDS * 1000)
    });

    const rawSession = `sc_ws_${randomToken(32)}`;
    await store.saveWebSession({
      sessionHash: sha256Hex(rawSession),
      userId: user.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + WEB_SESSION_TTL_MS)
    });

    params.res.setHeader("Cache-Control", "no-store");
    params.res.setHeader("Set-Cookie", [
      formatCookie(CSRF_COOKIE, "", { maxAge: 0, secure: isHttps }),
      formatCookie(OTP_BIND_COOKIE, "", { maxAge: 0, secure: isHttps }),
      formatCookie(SESSION_COOKIE, rawSession, {
        maxAge: Math.floor(WEB_SESSION_TTL_MS / 1000),
        secure: isHttps
      })
    ]);

    // RFC 9207: include exact issuer (no trailing slash) as `iss`
    const callback = new URL(params.redirectUri);
    callback.searchParams.set("code", rawCode);
    if (params.state) callback.searchParams.set("state", params.state);
    callback.searchParams.set("iss", issuer);

    params.res.redirect(303, callback.toString());
  }

  // 3. Authorization endpoint (Passwordless 2-step DE/EN Email OTP + Magic Link)
  router.get("/oauth/authorize", async (req, res) => {
    const responseType = String(req.query.response_type ?? "");
    const clientId = String(req.query.client_id ?? "").trim();
    const redirectUri = String(req.query.redirect_uri ?? "").trim();
    const codeChallenge = String(req.query.code_challenge ?? "").trim();
    const codeChallengeMethod = String(req.query.code_challenge_method ?? "").trim();
    const state = String(req.query.state ?? "");
    const queryResource: unknown = req.query.resource;
    const rawScope = typeof req.query.scope === "string" ? req.query.scope : "";
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

    if (queryResource !== undefined && typeof queryResource !== "string") {
      redirectError("invalid_target", "Multiple or invalid resource parameters are not supported");
      return;
    }

    const resolvedRes = resolveResourceParam(queryResource, canonicalResource);
    if (!resolvedRes.ok) {
      redirectError(resolvedRes.error, resolvedRes.description);
      return;
    }

    const scopes = normalizeScopes(rawScope);
    const csrfContext = `oauth:${client.clientId}:${codeChallenge}`;
    const csrf = createCsrfPair(config.sessionSecret, csrfContext);
    const redirectUrl = new URL(redirectUri);
    res.setHeader(
      "Set-Cookie",
      formatCookie(CSRF_COOKIE, csrf.cookieValue, { maxAge: 1800, secure: isHttps })
    );
    setSecurityHeadersForHtml(res, config, {
      formActionOrigin: redirectUrl.origin,
      referrerPolicy: "same-origin"
    });

    const redirectHost = redirectUrl.host;
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
        step: "email",
        config
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
      const step: "email" | "verify" = body.step === "verify" ? "verify" : "email";
      const clientId = (body.client_id ?? "").trim();
      const redirectUri = (body.redirect_uri ?? "").trim();
      const codeChallenge = (body.code_challenge ?? "").trim();
      const codeChallengeMethod = (body.code_challenge_method ?? "").trim();
      const rawResource: unknown = (req.body as Record<string, unknown> | undefined)?.resource;
      const scopeStr = normalizeScopes(body.scope).join(" ");
      const state = typeof body.state === "string" ? body.state : "";
      const email = normalizeEmail(body.email ?? "");
      const challengeId = (body.challenge_id ?? "").trim();
      const otpCode = body.code ?? "";
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

      if (rawResource !== undefined && typeof rawResource !== "string") {
        const target = new URL(redirectUri);
        target.searchParams.set("error", "invalid_target");
        target.searchParams.set(
          "error_description",
          "Multiple or invalid resource parameters are not supported"
        );
        if (state) target.searchParams.set("state", state);
        target.searchParams.set("iss", issuer);
        res.redirect(303, target.toString());
        return;
      }

      const resolvedRes = resolveResourceParam(rawResource, canonicalResource);
      if (!resolvedRes.ok) {
        res.status(400).send(resolvedRes.description);
        return;
      }

      const csrfContext = `oauth:${client.clientId}:${codeChallenge}`;
      const renderStep = (opts: {
        renderStep: "email" | "verify";
        statusCode?: number;
        error?: string;
        info?: string;
        challengeId?: string;
        extraCookies?: string[];
      }) => {
        const freshCsrf = createCsrfPair(config.sessionSecret, csrfContext);
        const cookiesToSet = [
          formatCookie(CSRF_COOKIE, freshCsrf.cookieValue, { maxAge: 1800, secure: isHttps }),
          ...(opts.extraCookies ?? [])
        ];
        const redirectUrl = new URL(redirectUri);
        res.setHeader("Set-Cookie", cookiesToSet);
        setSecurityHeadersForHtml(res, config, {
          formActionOrigin: redirectUrl.origin,
          referrerPolicy: "same-origin"
        });
        res.status(opts.statusCode ?? 200).type("html").send(
          renderAuthorizePage({
            lang,
            clientName: client.clientName,
            clientId: client.clientId,
            redirectUri,
            redirectHost: redirectUrl.host,
            codeChallenge,
            codeChallengeMethod: "S256",
            resource: resolvedRes.resource,
            scope: scopeStr,
            state,
            csrfToken: freshCsrf.token,
            promoActive: isPromoFreeProActive(config),
            step: opts.renderStep,
            challengeId: opts.challengeId,
            email,
            error: opts.error,
            info: opts.info,
            config
          })
        );
      };

      // Honeypot check
      if (honeypot.length > 0) {
        renderStep({
          renderStep: "email",
          statusCode: 400,
          error: de ? "Anfrage abgelehnt." : "Request rejected."
        });
        return;
      }

      // CSRF verification (stateless HMAC-signed + time-bound token + Origin check + cookie fallback)
      const cookies = parseCookies(req.headers.cookie);
      if (
        !verifyCsrfRequest({
          secret: config.sessionSecret,
          appOrigin: config.appOrigin,
          originHeader: req.headers.origin,
          secFetchSiteHeader: req.headers["sec-fetch-site"],
          formToken: body._csrf,
          cookieValue: cookies[CSRF_COOKIE],
          context: csrfContext
        })
      ) {
        renderStep({
          renderStep: step === "verify" && challengeId ? "verify" : "email",
          challengeId: step === "verify" ? challengeId : undefined,
          statusCode: 403,
          error: de
            ? "Sitzung abgelaufen. Bitte erneut absenden."
            : "Form session expired. Please try again."
        });
        return;
      }

      const ip = extractTrustedClientKey(req, config.trustedProxyHops);

      if (step === "email") {
        const requested = await otpService.requestChallenge({
          email,
          ip,
          purpose: "oauth",
          lang,
          oauthParams: {
            clientId: client.clientId,
            clientName: client.clientName,
            redirectUri,
            codeChallenge,
            codeChallengeMethod: "S256",
            resource: resolvedRes.resource,
            scope: scopeStr,
            state
          }
        });

        if (!requested.ok) {
          if (requested.error === "invalid_email") {
            renderStep({
              renderStep: "email",
              statusCode: 400,
              error: de
                ? "Bitte eine gültige E-Mail-Adresse eingeben."
                : "Please enter a valid email address."
            });
            return;
          }
          if (requested.error === "rate_limited") {
            renderStep({
              renderStep: "email",
              statusCode: 429,
              error: de
                ? "Zu viele Code-Anfragen. Bitte warte einige Minuten."
                : "Too many code requests. Please wait a few minutes."
            });
            return;
          }
          renderStep({
            renderStep: "email",
            statusCode: 503,
            error: de
              ? "Der E-Mail-Versand ist gerade nicht erreichbar. Bitte versuche es gleich erneut."
              : "Email delivery is temporarily unavailable. Please try again shortly."
          });
          return;
        }

        renderStep({
          renderStep: "verify",
          statusCode: 200,
          challengeId: requested.challengeId,
          extraCookies: [
            formatCookie(OTP_BIND_COOKIE, requested.browserBindCookieValue, {
              maxAge: 900,
              secure: isHttps
            })
          ]
        });
        return;
      }

      // Step 2: Verify 6-digit OTP
      if (!rateLimiter.check(`otp-verify:ip:${ip}`, 30, 10 * 60 * 1000)) {
        renderStep({
          renderStep: "verify",
          challengeId,
          statusCode: 429,
          error: de
            ? "Zu viele Versuche. Bitte warte einige Minuten."
            : "Too many attempts. Please wait a few minutes."
        });
        return;
      }

      const verified = await otpService.verifyOtp({ challengeId, code: otpCode });

      if (verified.status === "invalid_format") {
        renderStep({
          renderStep: "verify",
          challengeId,
          statusCode: 400,
          error: de
            ? "Bitte gib den 6-stelligen Zahlencode aus deiner E-Mail ein."
            : "Please enter the 6-digit numeric code from your email."
        });
        return;
      }

      if (verified.status === "invalid_code") {
        renderStep({
          renderStep: "verify",
          challengeId,
          statusCode: 401,
          error: de
            ? `Ungültiger Code. Noch ${verified.remainingAttempts} ${verified.remainingAttempts === 1 ? "Versuch" : "Versuche"}.`
            : `Invalid code. ${verified.remainingAttempts} ${verified.remainingAttempts === 1 ? "attempt" : "attempts"} remaining.`
        });
        return;
      }

      if (verified.status === "locked") {
        renderStep({
          renderStep: "email",
          statusCode: 429,
          error: de
            ? "Zu viele Fehlversuche — dieser Code wurde gesperrt. Bitte fordere einen neuen Code an."
            : "Too many failed attempts — this code has been locked. Please request a new code."
        });
        return;
      }

      if (verified.status === "expired") {
        renderStep({
          renderStep: "email",
          statusCode: 410,
          error: de
            ? "Der Code ist abgelaufen (10 Minuten). Bitte fordere einen neuen Code an."
            : "This code has expired (10 minutes). Please request a new code."
        });
        return;
      }

      if (verified.status !== "ok") {
        renderStep({
          renderStep: "email",
          statusCode: 400,
          error: de
            ? "Dieser Code wurde bereits verwendet oder ist ungültig. Bitte fordere einen neuen Code an."
            : "This code has already been used or is invalid. Please request a new code."
        });
        return;
      }

      const ch = verified.challenge;
      if (
        ch.purpose !== "oauth" ||
        !ch.oauthParams ||
        ch.oauthParams.clientId !== client.clientId ||
        ch.oauthParams.redirectUri !== redirectUri ||
        ch.oauthParams.codeChallenge !== codeChallenge ||
        ch.oauthParams.resource !== resolvedRes.resource
      ) {
        renderStep({
          renderStep: "email",
          statusCode: 400,
          error: de
            ? "Anmelde-Sitzung passt nicht zur Anfrage. Bitte starte erneut."
            : "Sign-in challenge does not match this request. Please start again."
        });
        return;
      }

      await completeOAuthAuthorization({
        res,
        email: ch.email,
        client,
        redirectUri,
        codeChallenge,
        resource: resolvedRes.resource,
        scopeStr,
        state
      });
    }
  );

  // 3b. Magic Link endpoint (1-click convenience for desktop browser & /billing)
  router.head("/auth/magic", (_req, res) => {
    // Do NOT consume single-use magic tokens on HEAD prefetchers (e.g. email scanners)
    res.setHeader("Cache-Control", "no-store");
    res.status(200).end();
  });

  router.get("/auth/magic", async (req, res) => {
    // Keep /auth/magic strictly zero-script so an unconsumed magic-link token in
    // window.location.search (browser_mismatch HTTP 200) is never exposed to third-party scripts.
    setSecurityHeadersForHtml(res, config, {
      referrerPolicy: "no-referrer",
      allowAnalytics: false
    });
    const rawToken = typeof req.query.token === "string" ? req.query.token : undefined;
    const cookies = parseCookies(req.headers.cookie);
    const fallbackLang = detectLang(req.query.lang, req.headers["accept-language"]);

    const verified = await otpService.verifyMagicLink({
      rawToken,
      browserBindCookie: cookies[OTP_BIND_COOKIE]
    });

    if (verified.status === "browser_mismatch") {
      res.status(200).type("html").send(
        renderMagicLinkResultPage({
          lang: verified.challenge.lang,
          kind: "browser_mismatch",
          email: verified.challenge.email,
          clientName: verified.challenge.oauthParams?.clientName
        })
      );
      return;
    }

    if (verified.status === "expired") {
      res.status(410).type("html").send(
        renderMagicLinkResultPage({ lang: fallbackLang, kind: "expired" })
      );
      return;
    }

    if (verified.status === "used") {
      res.status(410).type("html").send(
        renderMagicLinkResultPage({ lang: fallbackLang, kind: "used" })
      );
      return;
    }

    if (verified.status !== "ok") {
      res.status(400).type("html").send(
        renderMagicLinkResultPage({ lang: fallbackLang, kind: "invalid" })
      );
      return;
    }

    const ch = verified.challenge;
    if (ch.purpose === "billing") {
      const user = await ensureUserByEmail(store, ch.email);
      const now = new Date();
      const rawSession = `sc_ws_${randomToken(32)}`;
      await store.saveWebSession({
        sessionHash: sha256Hex(rawSession),
        userId: user.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + WEB_SESSION_TTL_MS)
      });
      res.setHeader("Set-Cookie", [
        formatCookie(OTP_BIND_COOKIE, "", { maxAge: 0, secure: isHttps }),
        formatCookie(SESSION_COOKIE, rawSession, {
          maxAge: Math.floor(WEB_SESSION_TTL_MS / 1000),
          secure: isHttps
        })
      ]);
      res.redirect(303, `/billing?lang=${ch.lang}`);
      return;
    }

    // OAuth Magic Link in the same browser -> complete OAuth flow in 1 click!
    const oauthParams = ch.oauthParams;
    if (!oauthParams) {
      res.status(400).type("html").send(
        renderMagicLinkResultPage({ lang: ch.lang, kind: "invalid" })
      );
      return;
    }

    const client = await resolveClient(oauthParams.clientId);
    if (!client || !matchRedirectUri(oauthParams.redirectUri, client.redirectUris)) {
      res.status(400).type("html").send(
        renderMagicLinkResultPage({ lang: ch.lang, kind: "invalid" })
      );
      return;
    }

    await completeOAuthAuthorization({
      res,
      email: ch.email,
      client,
      redirectUri: oauthParams.redirectUri,
      codeChallenge: oauthParams.codeChallenge,
      resource: oauthParams.resource,
      scopeStr: oauthParams.scope,
      state: oauthParams.state
    });
  });

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

      const rawBodyResource: unknown = (req.body as Record<string, unknown> | undefined)?.resource;
      if (rawBodyResource !== undefined && typeof rawBodyResource !== "string") {
        res.status(400).json({
          error: "invalid_target",
          error_description: "Multiple or invalid resource parameters are not supported"
        });
        return;
      }

      const grantType = (body.grant_type ?? "").trim();

      if (grantType === "authorization_code") {
        const code = (body.code ?? "").trim();
        const redirectUri = (body.redirect_uri ?? "").trim();
        const codeVerifier = (body.code_verifier ?? "").trim();
        const rawResource = rawBodyResource;

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
        const rawResource = rawBodyResource;
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
