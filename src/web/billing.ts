import express, { type Request, type Response, type Router } from "express";
import type { AppConfig } from "../config.js";
import type { StorageBackend, UserRecord } from "../store/types.js";
import {
  createCsrfPair,
  hashPassword,
  parseCookies,
  randomToken,
  sha256Hex,
  verifyCsrfPair,
  verifyPassword
} from "../auth/crypto.js";
import { detectLang, escapeHtml, type Lang } from "../auth/pages.js";
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
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${maxAge}`, "SameSite=Lax", "HttpOnly"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function getLoggedInUser(req: Request, store: StorageBackend): Promise<UserRecord | null> {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const sess = await store.getWebSession(sha256Hex(raw));
  if (!sess) return null;
  return store.getUserById(sess.userId);
}

function renderBillingShell(lang: Lang, title: string, bodyHtml: string): string {
  const de = lang === "de";
  const otherLang = de ? "en" : "de";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${escapeHtml(title)} — shopcart-mcp</title>
<style>
:root{--bg:#fafaf9;--card:#fff;--ink:#141413;--muted:#57534e;--border:#e7e5e4;--accent:#d92d20;--accent-dark:#b42318;--ok-bg:#ecfdf3;--ok-ink:#027a48;--warn-bg:#fffaeb;--warn-ink:#b54708}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
.wrap{max-width:560px;margin:40px auto;padding:0 20px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.brand{font-weight:750;text-decoration:none;color:var(--ink);display:flex;align-items:center;gap:8px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;box-shadow:0 8px 24px rgba(0,0,0,.04)}
h1{margin:0 0 8px;font-size:22px;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:14px;margin:0 0 18px}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}
.stat{background:#f5f5f4;border-radius:12px;padding:14px}
.stat-label{font-size:12px;color:var(--muted)}
.stat-val{font-size:20px;font-weight:750;margin-top:2px}
.banner{border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px}
.banner.ok{background:var(--ok-bg);color:var(--ok-ink)}
.banner.warn{background:var(--warn-bg);color:var(--warn-ink)}
.banner.err{background:#fef3f2;color:var(--accent-dark);border:1px solid #fecdca}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}
input[type=email],input[type=password]{width:100%;padding:10px 12px;border:1px solid #d6d3d1;border-radius:9px;font-size:14px}
.btn{display:inline-flex;align-items:center;justify-content:center;width:100%;padding:11px 16px;border-radius:10px;font-size:14px;font-weight:650;cursor:pointer;border:0;text-decoration:none;margin-top:12px}
.btn.primary{background:var(--accent);color:#fff}
.btn.primary:hover{background:var(--accent-dark)}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--border)}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#f5f5f4;padding:4px;border-radius:10px;margin-bottom:16px}
.tab{text-align:center;padding:8px;border-radius:7px;font-size:13px;font-weight:600;text-decoration:none;color:var(--muted)}
.tab.active{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.06)}
.hp{position:absolute;left:-9999px}
.foot{margin-top:22px;text-align:center;font-size:12px;color:var(--muted)}
.foot a{color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="brand" href="/?lang=${lang}"><span class="dot"></span>shopcart-mcp</a>
    <a style="font-size:13px;color:var(--muted);text-decoration:none" href="/billing?lang=${otherLang}">${de ? "English" : "Deutsch"}</a>
  </div>
  ${bodyHtml}
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

export function createBillingRouter(config: AppConfig, store: StorageBackend): Router {
  const router = express.Router();
  const isHttps = config.appOrigin.startsWith("https://");

  router.get("/billing", async (req: Request, res: Response) => {
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);
    const de = lang === "de";
    const user = await getLoggedInUser(req, store);
    const csrf = createCsrfPair(config.sessionSecret);
    res.setHeader("Set-Cookie", formatCookie(BILLING_CSRF_COOKIE, csrf.cookieValue, 1800, isHttps));
    res.setHeader("Cache-Control", "no-store");

    if (!user) {
      const mode = req.query.mode === "register" ? "register" : "login";
      const prefillEmail = typeof req.query.email === "string" ? req.query.email : "";
      const body = `<div class="card">
        <h1>${de ? "Konto & Billing" : "Account & Billing"}</h1>
        <p class="sub">${
          de
            ? "Melde dich an, um dein Tageskontingent zu prüfen oder auf Pro zu wechseln."
            : "Sign in to view your daily quota or manage your Pro subscription."
        }</p>
        ${
          isPromoFreeProActive(config)
            ? `<div class="banner ok">${
                de
                  ? "Black-Friday-Launch aktiv: Alle Konten erhalten bis 06.12.2026 kostenlos 500 Calls/Tag."
                  : "Black Friday Launch active: All accounts receive 500 calls/day free until Dec 6, 2026."
              }</div>`
            : ""
        }
        <div class="tabs">
          <a class="tab ${mode === "login" ? "active" : ""}" href="/billing?mode=login&lang=${lang}">${de ? "Anmelden" : "Sign in"}</a>
          <a class="tab ${mode === "register" ? "active" : ""}" href="/billing?mode=register&lang=${lang}">${de ? "Registrieren" : "Create account"}</a>
        </div>
        <form method="POST" action="/billing/auth">
          <input type="hidden" name="_csrf" value="${escapeHtml(csrf.token)}">
          <input type="hidden" name="lang" value="${lang}">
          <input type="hidden" name="mode" value="${mode}">
          <div class="hp"><input name="website" type="text" tabindex="-1"></div>
          <label for="email">E-Mail</label>
          <input id="email" name="email" type="email" required value="${escapeHtml(prefillEmail)}">
          <label for="password">${de ? "Passwort (mind. 8 Zeichen)" : "Password (min. 8 characters)"}</label>
          <input id="password" name="password" type="password" required minlength="8" maxlength="128">
          <button class="btn primary" type="submit">${
            mode === "register"
              ? de
                ? "Konto anlegen"
                : "Create account"
              : de
                ? "Anmelden"
                : "Sign in"
          }</button>
        </form>
      </div>`;
      res.status(200).type("html").send(renderBillingShell(lang, de ? "Konto & Billing" : "Account & Billing", body));
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
        ? `<div class="banner ok">${
            de
              ? "Vielen Dank! Dein Pro-Abo wird gerade über Stripe aktiviert."
              : "Thank you! Your Pro subscription is being activated via Stripe."
          }</div>`
        : checkoutParam === "cancel"
          ? `<div class="banner warn">${de ? "Checkout abgebrochen." : "Checkout cancelled."}</div>`
          : "";

    const body = `<div class="card">
      <h1>${de ? "Dein shopcart-mcp Konto" : "Your shopcart-mcp Account"}</h1>
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

      <div class="stat" style="margin-bottom:16px">
        <div class="stat-label">MCP Endpoint URL</div>
        <div style="font-family:ui-monospace,monospace;font-size:13px;word-break:break-all;margin-top:4px">${escapeHtml(`${config.appOrigin}/mcp`)}</div>
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

    res.status(200).type("html").send(renderBillingShell(lang, de ? "Konto & Billing" : "Account & Billing", body));
  });

  router.post(
    "/billing/auth",
    express.urlencoded({ extended: false, limit: "16kb" }),
    async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, string | undefined>;
      const lang = detectLang(body.lang, req.headers["accept-language"]);
      const de = lang === "de";
      const mode = body.mode === "register" ? "register" : "login";
      const email = (body.email ?? "").trim().toLowerCase();
      const password = body.password ?? "";
      const cookies = parseCookies(req.headers.cookie);

      if ((body.website ?? "").trim() !== "") {
        res.status(400).send("Rejected");
        return;
      }
      if (!verifyCsrfPair(config.sessionSecret, cookies[BILLING_CSRF_COOKIE], body._csrf)) {
        res.redirect(303, `/billing?lang=${lang}&mode=${mode}`);
        return;
      }

      const failPage = (msg: string, code = 400) => {
        const freshCsrf = createCsrfPair(config.sessionSecret);
        res.setHeader("Set-Cookie", formatCookie(BILLING_CSRF_COOKIE, freshCsrf.cookieValue, 1800, isHttps));
        const html = `<div class="card">
          <h1>${de ? "Konto & Billing" : "Account & Billing"}</h1>
          <div class="banner err">${escapeHtml(msg)}</div>
          <a class="btn secondary" href="/billing?mode=${mode}&lang=${lang}&email=${encodeURIComponent(email)}">${
            de ? "Zurück" : "Back"
          }</a>
        </div>`;
        res.status(code).type("html").send(renderBillingShell(lang, "Billing", html));
      };

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
        failPage(
          de
            ? "Bitte gültige E-Mail und Passwort (mind. 8 Zeichen) eingeben."
            : "Please enter a valid email and password (at least 8 characters)."
        );
        return;
      }

      let user: UserRecord | null = null;
      if (mode === "register") {
        const existing = await store.getUserByEmail(email);
        if (existing) {
          failPage(de ? "E-Mail bereits registriert. Bitte anmelden." : "Email already registered. Please sign in.");
          return;
        }
        const { hash, salt } = await hashPassword(password);
        const now = new Date();
        const createdUser: UserRecord = {
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
        await store.createUser(createdUser);
        user = createdUser;
      } else {
        const existing = await store.getUserByEmail(email);
        if (!existing || !(await verifyPassword(password, existing.passwordHash, existing.passwordSalt))) {
          failPage(de ? "E-Mail oder Passwort ungültig." : "Invalid email or password.", 401);
          return;
        }
        user = existing;
      }

      const rawSession = `sc_ws_${randomToken(32)}`;
      const now = new Date();
      await store.saveWebSession({
        sessionHash: sha256Hex(rawSession),
        userId: user.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + WEB_SESSION_TTL_MS)
      });

      res.setHeader(
        "Set-Cookie",
        formatCookie(SESSION_COOKIE, rawSession, Math.floor(WEB_SESSION_TTL_MS / 1000), isHttps)
      );
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
        res.redirect(303, "/billing");
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
        res.redirect(303, "/billing");
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
      res.redirect(303, "/billing");
    }
  );

  return router;
}
