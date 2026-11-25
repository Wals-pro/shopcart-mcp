import express, { type Request, type Response, type Router } from "express";
import type { AppConfig } from "../config.js";
import type { StorageBackend, UserRecord } from "../store/types.js";
import {
  createCsrfPair,
  parseCookies,
  randomToken,
  sha256Hex,
  verifyCsrfPair
} from "../auth/crypto.js";
import {
  EmailOtpService,
  OTP_BIND_COOKIE,
  ensureUserByEmail,
  normalizeEmail
} from "../auth/email-otp.js";
import { WALSPRO_DARK_CSS, detectLang, escapeHtml, type Lang } from "../auth/pages.js";
import { SESSION_COOKIE } from "../auth/router.js";
import { getBerlinDayKey, getEffectiveEntitlement, isPromoFreeProActive } from "../billing/quota.js";
import {
  createBillingPortalSession,
  createProCheckoutSession,
  isStripeCheckoutConfigured
} from "../billing/stripe.js";

const BILLING_CSRF_COOKIE = "sc_billing_csrf";
const WEB_SESSION_TTL_MS = 14 * 24 * 3600 * 1000;

function formatCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    "HttpOnly"
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function setBillingSecurityHeaders(res: Response): void {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

async function getLoggedInUser(req: Request, store: StorageBackend): Promise<UserRecord | null> {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const sess = await store.getWebSession(sha256Hex(raw));
  if (!sess) return null;
  return store.getUserById(sess.userId);
}

const BILLING_EXTRA_CSS = `
.wrap {
  max-width: 560px;
  margin: 36px auto;
  padding: 0 20px;
}
.wrap .card {
  max-width: none;
}
.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 16px 0;
}
@media (max-width: 480px) {
  .stat-grid { grid-template-columns: 1fr; }
}
.stat {
  background: var(--walspro-bg);
  border: 1px solid var(--walspro-border);
  border-radius: 12px;
  padding: 14px;
}
.stat-label {
  font-size: 12px;
  color: var(--walspro-muted);
}
.stat-val {
  font-size: 20px;
  font-weight: 750;
  margin-block-start: 2px;
  color: #ffffff;
}
.endpoint-mono {
  font-family: var(--walspro-mono);
  font-size: 13px;
  word-break: break-all;
  margin-block-start: 4px;
  color: var(--walspro-text);
}
`;

function renderBillingShell(lang: Lang, title: string, langHrefPath: string, bodyHtml: string): string {
  const de = lang === "de";
  const otherLang = de ? "en" : "de";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#141414">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${escapeHtml(title)} — ShopCart MCP</title>
<style>${WALSPRO_DARK_CSS}${BILLING_EXTRA_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="brand" href="/?lang=${lang}"><img src="/assets/walspro-mark.svg" alt="wals.pro" width="24" height="24">ShopCart MCP <span class="brand-sub">by wals.pro</span></a>
    <a class="lang" href="${escapeHtml(langHrefPath)}?lang=${otherLang}">${de ? "English" : "Deutsch"}</a>
  </div>
  <main>
    ${bodyHtml}
  </main>
  <p class="foot">
    <a href="/?lang=${lang}">${de ? "Startseite" : "Home"}</a> ·
    <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy Policy"}</a> ·
    <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a> ·
    <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">${de ? "Impressum" : "Legal Notice"}</a>
  </p>
</div>
</body>
</html>`;
}

function renderBillingLoginStep1(params: {
  lang: Lang;
  csrfToken: string;
  promoActive: boolean;
  email?: string;
  error?: string;
}): string {
  const de = params.lang === "de";
  return `<div class="card">
    <nav aria-label="${de ? "Anmeldeschritte" : "Sign-in progress"}">
      <ol class="steps">
        <li aria-current="step">${de ? "1. E-Mail" : "1. Email"}</li>
        <li>${de ? "2. Code bestätigen" : "2. Verify code"}</li>
      </ol>
    </nav>
    <h1 id="billing-heading">${de ? "Konto & Billing" : "Account & Billing"}</h1>
    <p class="sub">${
      de
        ? "Gib deine E-Mail-Adresse ein — kein Passwort nötig. Wir senden dir einen 6-stelligen Code und einen 1-Klick-Link."
        : "Enter your email address — no password needed. We'll send you a 6-digit code and a 1-click link."
    }</p>
    ${
      params.promoActive
        ? `<div class="banner ok">${
            de
              ? "Black-Friday-Launch aktiv: Alle Konten erhalten bis 06.12.2026 kostenlos 500 Calls/Tag."
              : "Black Friday Launch active: All accounts receive 500 calls/day free until Dec 6, 2026."
          }</div>`
        : ""
    }
    ${params.error ? `<div class="banner err" role="alert">${escapeHtml(params.error)}</div>` : ""}
    <form method="POST" action="/billing/login" aria-labelledby="billing-heading">
      <input type="hidden" name="_csrf" value="${escapeHtml(params.csrfToken)}">
      <input type="hidden" name="lang" value="${params.lang}">
      <div class="hp" aria-hidden="true">
        <label for="website">Website</label>
        <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
      <div class="field">
        <label for="email">${de ? "E-Mail-Adresse" : "Email address"}</label>
        <p id="billing-email-hint" class="field-hint">${
          de
            ? "Nutze dieselbe E-Mail wie in deinem KI-Client, um Kontingent und Pro-Abo zu verwalten."
            : "Use the same email as in your AI client to manage your quota and Pro subscription."
        }</p>
        <input
          id="email"
          name="email"
          type="email"
          required
          autocomplete="email"
          autocorrect="off"
          autocapitalize="none"
          spellcheck="false"
          enterkeyhint="next"
          placeholder="you@example.com"
          aria-describedby="billing-email-hint"
          value="${escapeHtml(params.email ?? "")}">
      </div>
      <button class="btn primary" type="submit">${de ? "Code per E-Mail senden" : "Send sign-in code"}</button>
    </form>
  </div>`;
}

function renderBillingLoginStep2(params: {
  lang: Lang;
  csrfToken: string;
  challengeId: string;
  email: string;
  error?: string;
}): string {
  const de = params.lang === "de";
  return `<div class="card">
    <nav aria-label="${de ? "Anmeldeschritte" : "Sign-in progress"}">
      <ol class="steps">
        <li>${de ? "1. E-Mail" : "1. Email"}</li>
        <li aria-current="step">${de ? "2. Code bestätigen" : "2. Verify code"}</li>
      </ol>
    </nav>
    <h1 id="billing-verify-heading">${de ? "Code bestätigen" : "Verify your code"}</h1>
    <div class="banner info" role="status">
      ${
        de
          ? `Wir haben einen <strong>6-stelligen Code</strong> und einen <strong>1-Klick-Link</strong> an <strong>${escapeHtml(params.email)}</strong> gesendet.`
          : `We sent a <strong>6-digit code</strong> and a <strong>1-click link</strong> to <strong>${escapeHtml(params.email)}</strong>.`
      }
    </div>
    ${params.error ? `<div class="banner err" role="alert">${escapeHtml(params.error)}</div>` : ""}
    <form method="POST" action="/billing/verify" aria-labelledby="billing-verify-heading">
      <input type="hidden" name="_csrf" value="${escapeHtml(params.csrfToken)}">
      <input type="hidden" name="lang" value="${params.lang}">
      <input type="hidden" name="challenge_id" value="${escapeHtml(params.challengeId)}">
      <input type="hidden" name="email" value="${escapeHtml(params.email)}">
      <div class="hp" aria-hidden="true">
        <label for="website">Website</label>
        <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
      <div class="field">
        <label for="otp-code">${de ? "6-stelliger Anmeldecode" : "6-digit sign-in code"}</label>
        <p id="billing-otp-hint" class="field-hint">${
          de
            ? "Gib den 6-stelligen Code aus deiner E-Mail ein — oder klicke einfach den Magic Link in der E-Mail."
            : "Enter the 6-digit code from your email — or simply click the Magic Link in your email."
        }</p>
        <input
          id="otp-code"
          class="otp-input"
          name="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          autocorrect="off"
          autocapitalize="none"
          spellcheck="false"
          enterkeyhint="done"
          pattern="[0-9\\s\\-]{6,9}"
          maxlength="9"
          placeholder="482 917"
          aria-describedby="billing-otp-hint"
          required
          autofocus>
      </div>
      <button class="btn primary" type="submit">${de ? "Anmelden" : "Sign in"}</button>
    </form>

    <div class="alt-actions">
      <form method="POST" action="/billing/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(params.csrfToken)}">
        <input type="hidden" name="lang" value="${params.lang}">
        <input type="hidden" name="email" value="${escapeHtml(params.email)}">
        <button class="btn secondary" type="submit">${de ? "Neuen Code senden" : "Send a new code"}</button>
      </form>
      <div class="link-row">
        <a href="/billing/login?lang=${params.lang}">${de ? "Andere E-Mail-Adresse verwenden" : "Use a different email address"}</a>
      </div>
    </div>
  </div>`;
}

export function createBillingRouter(
  config: AppConfig,
  store: StorageBackend,
  otpService = new EmailOtpService({ config, store })
): Router {
  const router = express.Router();
  const isHttps = config.appOrigin.startsWith("https://");

  router.get("/billing/login", async (req: Request, res: Response) => {
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);
    const de = lang === "de";
    const user = await getLoggedInUser(req, store);
    if (user) {
      res.redirect(303, `/billing?lang=${lang}`);
      return;
    }
    const csrf = createCsrfPair(config.sessionSecret);
    res.setHeader("Set-Cookie", formatCookie(BILLING_CSRF_COOKIE, csrf.cookieValue, 1800, isHttps));
    setBillingSecurityHeaders(res);
    const prefillEmail = typeof req.query.email === "string" ? req.query.email : "";
    const body = renderBillingLoginStep1({
      lang,
      csrfToken: csrf.token,
      promoActive: isPromoFreeProActive(config),
      email: prefillEmail
    });
    res
      .status(200)
      .type("html")
      .send(renderBillingShell(lang, de ? "Anmelden — Konto & Billing" : "Sign in — Account & Billing", "/billing/login", body));
  });

  router.get("/billing", async (req: Request, res: Response) => {
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);
    const de = lang === "de";
    const user = await getLoggedInUser(req, store);
    const csrf = createCsrfPair(config.sessionSecret);
    res.setHeader("Set-Cookie", formatCookie(BILLING_CSRF_COOKIE, csrf.cookieValue, 1800, isHttps));
    setBillingSecurityHeaders(res);

    if (!user) {
      const prefillEmail = typeof req.query.email === "string" ? req.query.email : "";
      const body = renderBillingLoginStep1({
        lang,
        csrfToken: csrf.token,
        promoActive: isPromoFreeProActive(config),
        email: prefillEmail
      });
      res
        .status(200)
        .type("html")
        .send(renderBillingShell(lang, de ? "Konto & Billing" : "Account & Billing", "/billing", body));
      return;
    }

    const dayKey = getBerlinDayKey();
    const usedToday = await store.getDailyUsage(user.id, dayKey);
    const ent = getEffectiveEntitlement(user, config);
    const stripeReady = isStripeCheckoutConfigured(config);
    const checkoutParam = typeof req.query.checkout === "string" ? req.query.checkout : "";

    const planLabel =
      ent.effectivePlan === "pro"
        ? "Pro (Paid)"
        : ent.effectivePlan === "pro_promo"
          ? de
            ? "Pro (Gratis-Promo)"
            : "Pro (Free Promo)"
          : "Free";

    const noticeHtml =
      checkoutParam === "success"
        ? `<div class="banner ok" role="status">${
            de
              ? "Vielen Dank! Dein Pro-Abo wird gerade über Stripe aktiviert."
              : "Thank you! Your Pro subscription is being activated via Stripe."
          }</div>`
        : checkoutParam === "cancel"
          ? `<div class="banner warn" role="status">${de ? "Checkout abgebrochen." : "Checkout cancelled."}</div>`
          : "";

    const body = `<div class="card">
      <h1>${de ? "Dein ShopCart MCP Konto" : "Your ShopCart MCP Account"}</h1>
      <p class="sub">${escapeHtml(user.email)}</p>
      ${noticeHtml}
      ${
        ent.promoActive
          ? `<div class="banner ok">${
              de
                ? "Black-Friday-Launch aktiv bis 06.12.2026: Du nutzt 500 Tool-Calls/Tag kostenlos. Ein Pro-Abo startet erst am 07.12.2026 mit der ersten Abbuchung."
                : "Black Friday Launch active through Dec 6, 2026: You get 500 tool calls/day free. Upgrading starts your paid billing cycle on Dec 7, 2026."
            }</div>`
          : ""
      }
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">${de ? "Aktiver Tarif" : "Active Plan"}</div>
          <div class="stat-val">${escapeHtml(planLabel)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">${de ? `Verbrauch heute (${dayKey})` : `Used today (${dayKey})`}</div>
          <div class="stat-val">${usedToday} / ${ent.dailyLimit}</div>
        </div>
      </div>

      <div class="stat" style="margin-block-end:16px">
        <div class="stat-label">MCP Endpoint URL</div>
        <div class="endpoint-mono">${escapeHtml(`${config.appOrigin}/mcp`)}</div>
      </div>

      ${
        !ent.isPaidPro
          ? stripeReady
            ? `<form method="POST" action="/billing/checkout">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrf.token)}">
                <button class="btn primary" type="submit">${
                  ent.promoActive
                    ? de
                      ? "Pro für 9 €/Monat sichern (Gratis bis 07.12.)"
                      : "Lock in Pro at €9/month (Free until Dec 7)"
                    : de
                      ? "Auf Pro upgraden (9 €/Monat · 500 Calls/Tag)"
                      : "Upgrade to Pro (€9/month · 500 calls/day)"
                }</button>
              </form>`
            : `<div class="banner warn">${
                de
                  ? "Stripe-Checkout wird in Kürze aktiviert. Während der Black-Friday-Gratisphase nutzt du bereits automatisch das volle Pro-Kontingent (500 Calls/Tag)."
                  : "Stripe checkout is being enabled shortly. During the Black Friday promo phase, your account already enjoys the full Pro quota (500 calls/day) automatically."
              }</div>`
          : ""
      }

      ${
        user.stripeCustomerId && stripeReady
          ? `<form method="POST" action="/billing/portal">
              <input type="hidden" name="_csrf" value="${escapeHtml(csrf.token)}">
              <button class="btn secondary" type="submit">${
                de ? "Abo & Rechnungen verwalten (Stripe)" : "Manage Subscription & Invoices (Stripe)"
              }</button>
            </form>`
          : ""
      }

      <form method="POST" action="/billing/logout">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrf.token)}">
        <button class="btn secondary" type="submit">${de ? "Abmelden" : "Sign out"}</button>
      </form>
    </div>`;

    res
      .status(200)
      .type("html")
      .send(renderBillingShell(lang, de ? "Konto & Billing" : "Account & Billing", "/billing", body));
  });

  const handleBillingEmailRequest = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const lang = detectLang(body.lang, req.headers["accept-language"]);
    const de = lang === "de";
    const email = normalizeEmail(body.email ?? "");
    const cookies = parseCookies(req.headers.cookie);

    const renderStep1Error = (msg: string, statusCode = 400) => {
      const freshCsrf = createCsrfPair(config.sessionSecret);
      res.setHeader("Set-Cookie", formatCookie(BILLING_CSRF_COOKIE, freshCsrf.cookieValue, 1800, isHttps));
      setBillingSecurityHeaders(res);
      const html = renderBillingLoginStep1({
        lang,
        csrfToken: freshCsrf.token,
        promoActive: isPromoFreeProActive(config),
        email,
        error: msg
      });
      res
        .status(statusCode)
        .type("html")
        .send(renderBillingShell(lang, de ? "Konto & Billing" : "Account & Billing", "/billing/login", html));
    };

    if ((body.website ?? "").trim() !== "") {
      renderStep1Error(de ? "Anfrage abgelehnt." : "Request rejected.", 400);
      return;
    }

    if (!verifyCsrfPair(config.sessionSecret, cookies[BILLING_CSRF_COOKIE], body._csrf)) {
      renderStep1Error(
        de ? "Sitzung abgelaufen. Bitte erneut absenden." : "Form session expired. Please try again.",
        403
      );
      return;
    }

    const requested = await otpService.requestChallenge({
      email,
      ip: getClientIp(req),
      purpose: "billing",
      lang,
      oauthParams: null
    });

    if (!requested.ok) {
      if (requested.error === "invalid_email") {
        renderStep1Error(
          de ? "Bitte eine gültige E-Mail-Adresse eingeben." : "Please enter a valid email address.",
          400
        );
        return;
      }
      if (requested.error === "rate_limited") {
        renderStep1Error(
          de
            ? "Zu viele Code-Anfragen. Bitte warte einige Minuten."
            : "Too many code requests. Please wait a few minutes.",
          429
        );
        return;
      }
      renderStep1Error(
        de
          ? "Der E-Mail-Versand ist gerade nicht erreichbar. Bitte versuche es gleich erneut."
          : "Email delivery is temporarily unavailable. Please try again shortly.",
        503
      );
      return;
    }

    const freshCsrf = createCsrfPair(config.sessionSecret);
    res.setHeader("Set-Cookie", [
      formatCookie(BILLING_CSRF_COOKIE, freshCsrf.cookieValue, 1800, isHttps),
      formatCookie(OTP_BIND_COOKIE, requested.browserBindCookieValue, 900, isHttps)
    ]);
    setBillingSecurityHeaders(res);

    const html = renderBillingLoginStep2({
      lang,
      csrfToken: freshCsrf.token,
      challengeId: requested.challengeId,
      email: requested.email
    });
    res
      .status(200)
      .type("html")
      .send(renderBillingShell(lang, de ? "Code bestätigen" : "Verify code", "/billing/login", html));
  };

  router.post(
    "/billing/login",
    express.urlencoded({ extended: false, limit: "16kb" }),
    handleBillingEmailRequest
  );

  // Backwards-compatible alias without passwords
  router.post(
    "/billing/auth",
    express.urlencoded({ extended: false, limit: "16kb" }),
    handleBillingEmailRequest
  );

  router.post(
    "/billing/verify",
    express.urlencoded({ extended: false, limit: "16kb" }),
    async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, string | undefined>;
      const lang = detectLang(body.lang, req.headers["accept-language"]);
      const de = lang === "de";
      const email = normalizeEmail(body.email ?? "");
      const challengeId = (body.challenge_id ?? "").trim();
      const otpCode = body.code ?? "";
      const cookies = parseCookies(req.headers.cookie);

      const renderStep1 = (msg: string, statusCode = 400) => {
        const freshCsrf = createCsrfPair(config.sessionSecret);
        res.setHeader("Set-Cookie", formatCookie(BILLING_CSRF_COOKIE, freshCsrf.cookieValue, 1800, isHttps));
        setBillingSecurityHeaders(res);
        const html = renderBillingLoginStep1({
          lang,
          csrfToken: freshCsrf.token,
          promoActive: isPromoFreeProActive(config),
          email,
          error: msg
        });
        res
          .status(statusCode)
          .type("html")
          .send(renderBillingShell(lang, de ? "Konto & Billing" : "Account & Billing", "/billing/login", html));
      };

      const renderStep2 = (msg: string, statusCode = 400) => {
        const freshCsrf = createCsrfPair(config.sessionSecret);
        res.setHeader("Set-Cookie", formatCookie(BILLING_CSRF_COOKIE, freshCsrf.cookieValue, 1800, isHttps));
        setBillingSecurityHeaders(res);
        const html = renderBillingLoginStep2({
          lang,
          csrfToken: freshCsrf.token,
          challengeId,
          email,
          error: msg
        });
        res
          .status(statusCode)
          .type("html")
          .send(renderBillingShell(lang, de ? "Code bestätigen" : "Verify code", "/billing/login", html));
      };

      if ((body.website ?? "").trim() !== "") {
        renderStep1(de ? "Anfrage abgelehnt." : "Request rejected.", 400);
        return;
      }

      if (!verifyCsrfPair(config.sessionSecret, cookies[BILLING_CSRF_COOKIE], body._csrf)) {
        renderStep2(
          de ? "Sitzung abgelaufen. Bitte erneut absenden." : "Form session expired. Please try again.",
          403
        );
        return;
      }

      const verified = await otpService.verifyOtp({ challengeId, code: otpCode });

      if (verified.status === "invalid_format") {
        renderStep2(
          de
            ? "Bitte gib den 6-stelligen Zahlencode aus deiner E-Mail ein."
            : "Please enter the 6-digit numeric code from your email.",
          400
        );
        return;
      }

      if (verified.status === "invalid_code") {
        renderStep2(
          de
            ? `Ungültiger Code. Noch ${verified.remainingAttempts} ${verified.remainingAttempts === 1 ? "Versuch" : "Versuche"}.`
            : `Invalid code. ${verified.remainingAttempts} ${verified.remainingAttempts === 1 ? "attempt" : "attempts"} remaining.`,
          401
        );
        return;
      }

      if (verified.status === "locked") {
        renderStep1(
          de
            ? "Zu viele Fehlversuche — dieser Code wurde gesperrt. Bitte fordere einen neuen Code an."
            : "Too many failed attempts — this code has been locked. Please request a new code.",
          429
        );
        return;
      }

      if (verified.status === "expired") {
        renderStep1(
          de
            ? "Der Code ist abgelaufen (10 Minuten). Bitte fordere einen neuen Code an."
            : "This code has expired (10 minutes). Please request a new code.",
          410
        );
        return;
      }

      if (verified.status !== "ok" || verified.challenge.purpose !== "billing") {
        renderStep1(
          de
            ? "Dieser Code wurde bereits verwendet oder ist ungültig. Bitte fordere einen neuen Code an."
            : "This code has already been used or is invalid. Please request a new code.",
          400
        );
        return;
      }

      const user = await ensureUserByEmail(store, verified.challenge.email);
      const rawSession = `sc_ws_${randomToken(32)}`;
      const now = new Date();
      await store.saveWebSession({
        sessionHash: sha256Hex(rawSession),
        userId: user.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + WEB_SESSION_TTL_MS)
      });

      res.setHeader("Set-Cookie", [
        formatCookie(BILLING_CSRF_COOKIE, "", 0, isHttps),
        formatCookie(OTP_BIND_COOKIE, "", 0, isHttps),
        formatCookie(SESSION_COOKIE, rawSession, Math.floor(WEB_SESSION_TTL_MS / 1000), isHttps)
      ]);
      res.redirect(303, `/billing?lang=${lang}`);
    }
  );

  router.post(
    "/billing/checkout",
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const cookies = parseCookies(req.headers.cookie);
      const body = (req.body ?? {}) as Record<string, string | undefined>;
      if (!verifyCsrfPair(config.sessionSecret, cookies[BILLING_CSRF_COOKIE], body._csrf)) {
        res.status(403).send("Invalid CSRF token");
        return;
      }
      const user = await getLoggedInUser(req, store);
      if (!user) {
        res.redirect(303, "/billing/login");
        return;
      }
      if (!isStripeCheckoutConfigured(config)) {
        res.status(503).json({ error: "stripe_not_configured" });
        return;
      }
      try {
        const session = await createProCheckoutSession(user, config, store);
        res.redirect(303, session.url);
      } catch (err) {
        res.status(500).send(err instanceof Error ? err.message : "Checkout error");
      }
    }
  );

  router.post(
    "/billing/portal",
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const cookies = parseCookies(req.headers.cookie);
      const body = (req.body ?? {}) as Record<string, string | undefined>;
      if (!verifyCsrfPair(config.sessionSecret, cookies[BILLING_CSRF_COOKIE], body._csrf)) {
        res.status(403).send("Invalid CSRF token");
        return;
      }
      const user = await getLoggedInUser(req, store);
      if (!user) {
        res.redirect(303, "/billing/login");
        return;
      }
      try {
        const session = await createBillingPortalSession(user, config);
        res.redirect(303, session.url);
      } catch (err) {
        res.status(500).send(err instanceof Error ? err.message : "Portal error");
      }
    }
  );

  router.post(
    "/billing/logout",
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const cookies = parseCookies(req.headers.cookie);
      const raw = cookies[SESSION_COOKIE];
      if (raw) {
        await store.deleteWebSession(sha256Hex(raw));
      }
      res.setHeader("Set-Cookie", formatCookie(SESSION_COOKIE, "", 0, isHttps));
      res.redirect(303, "/billing/login");
    }
  );

  return router;
}
