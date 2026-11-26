export type Lang = "de" | "en";

export function detectLang(
  queryLang: unknown,
  acceptLanguage: string | undefined
): Lang {
  if (typeof queryLang === "string") {
    const q = queryLang.trim().toLowerCase();
    if (q === "de" || q.startsWith("de-")) return "de";
    if (q === "en" || q.startsWith("en-")) return "en";
  }
  if (acceptLanguage && /\bde\b/i.test(acceptLanguage.split(",")[0] ?? "")) {
    return "de";
  }
  return "en";
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const WALSPRO_DARK_CSS = `
:root {
  color-scheme:dark;
  --walspro-bg:#141414;
  --walspro-surface:#1a1a1a;
  --walspro-surface-2:#222222;
  --walspro-border:#2e2e2e;
  --walspro-border-strong:#444444;
  --walspro-text:#f5f5f5;
  --walspro-muted:#a3a3a3;
  --walspro-accent:#ff1f4d;
  --walspro-accent-hover:#ff3b63;
  --walspro-on-accent:#000000;
  --walspro-ok-bg: rgba(34, 197, 94, 0.14);
  --walspro-ok-border: rgba(34, 197, 94, 0.34);
  --walspro-ok-text: #86efac;
  --walspro-warn-bg: rgba(245, 158, 11, 0.14);
  --walspro-warn-border: rgba(245, 158, 11, 0.36);
  --walspro-warn-text: #fcd34d;
  --walspro-err-bg: rgba(255, 31, 77, 0.14);
  --walspro-err-border: rgba(255, 31, 77, 0.42);
  --walspro-err-text: #ff9eb2;
  --walspro-mono: ui-monospace, "SFMono-Regular", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --walspro-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
  accent-color: var(--walspro-accent);
}
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--walspro-bg); }
body {
  margin: 0;
  min-height: 100dvh;
  font-family: var(--walspro-sans);
  background:
    radial-gradient(60% 45% at 50% 0%, rgba(255, 31, 77, 0.10), transparent 65%),
    var(--walspro-bg);
  color: var(--walspro-text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.auth-body {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.card {
  width: 100%;
  max-width: 460px;
  background: var(--walspro-surface);
  border: 1px solid var(--walspro-border);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  position: relative;
  overflow: hidden;
}
.card::before {
  content: "";
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  height: 3px;
  background: var(--walspro-accent);
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-block-end: 18px;
  gap: 12px;
}
.brand {
  font-weight: 750;
  font-size: 15px;
  letter-spacing: -0.01em;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--walspro-text);
  text-decoration: none;
  white-space: nowrap;
  min-width: 0;
}
.brand img {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: block;
  flex-shrink: 0;
}
.brand-sub {
  color: var(--walspro-muted);
  font-weight: 500;
  font-size: 13px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--walspro-accent);
  box-shadow: 0 0 12px rgba(255, 31, 77, 0.6);
  flex-shrink: 0;
}
.lang {
  font-size: 13px;
  color: var(--walspro-muted);
  text-decoration: none;
  padding: 4px 10px;
  border: 1px solid var(--walspro-border);
  border-radius: 8px;
  white-space: nowrap;
  flex-shrink: 0;
}
.lang:hover {
  color: var(--walspro-text);
  border-color: var(--walspro-border-strong);
}
.steps {
  display: flex;
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  gap: 8px;
  font-size: 12px;
}
.steps li {
  flex: 1;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--walspro-surface-2);
  border: 1px solid var(--walspro-border);
  color: var(--walspro-muted);
  font-weight: 600;
  text-align: center;
}
.steps li[aria-current="step"] {
  border-color: var(--walspro-accent);
  color: var(--walspro-text);
  background: rgba(255, 31, 77, 0.12);
}
h1 {
  font-size: 21px;
  margin: 0 0 6px;
  letter-spacing: -0.02em;
  color: #ffffff;
}
.sub {
  font-size: 14px;
  color: var(--walspro-muted);
  margin: 0 0 18px;
}
.consent-box {
  background: var(--walspro-bg);
  border: 1px solid var(--walspro-border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-block-end: 18px;
  font-size: 13px;
}
.consent-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 4px 0;
}
.consent-row span:first-child { color: var(--walspro-muted); flex-shrink: 0; }
.consent-row span:last-child {
  font-weight: 600;
  text-align: end;
  min-width: 0;
  /* Wrap at spaces and hyphens; only a single over-long token (e.g. a redirect host) may break. */
  word-break: normal;
  overflow-wrap: anywhere;
  color: var(--walspro-text);
}
@media (max-width: 420px) {
  .auth-body { padding: 14px; }
  .card { padding: 24px 20px; }
  .brand { font-size: 14.5px; gap: 7px; }
  .brand-sub { font-size: 12.5px; }
}
.banner {
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 13px;
  margin-block-end: 16px;
  line-height: 1.45;
}
.banner.ok {
  background: var(--walspro-ok-bg);
  border: 1px solid var(--walspro-ok-border);
  color: var(--walspro-ok-text);
}
.banner.warn {
  background: var(--walspro-warn-bg);
  border: 1px solid var(--walspro-warn-border);
  color: var(--walspro-warn-text);
}
.banner.err {
  background: var(--walspro-err-bg);
  border: 1px solid var(--walspro-err-border);
  color: var(--walspro-err-text);
}
.banner.info {
  background: var(--walspro-bg);
  border: 1px solid var(--walspro-border-strong);
  color: var(--walspro-text);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-block-end: 16px;
}
label {
  display: block;
  font-size: 13px;
  font-weight: 650;
  color: var(--walspro-text);
}
.field-hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--walspro-muted);
}
input[type="email"],
input[type="text"] {
  width: 100%;
  font: inherit;
  font-size: max(1rem, 1em);
  min-height: 48px;
  padding: 10px 14px;
  border: 1px solid var(--walspro-border-strong);
  border-radius: 10px;
  background: var(--walspro-bg);
  color: var(--walspro-text);
}
input.otp-input {
  font-family: var(--walspro-mono);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.35em;
  text-align: center;
  min-height: 54px;
  padding: 10px 16px;
}
input::placeholder { color: #737373; }
input:focus-visible,
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--walspro-accent);
  outline-offset: 2px;
}
.hp {
  position: absolute;
  inset-inline-start: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 48px;
  padding: 11px 16px;
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: 0;
  text-decoration: none;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.btn.primary {
  background: var(--walspro-accent);
  color: var(--walspro-on-accent);
}
.btn.primary:hover {
  background: var(--walspro-accent-hover);
}
.btn.secondary {
  background: var(--walspro-surface-2);
  color: var(--walspro-text);
  border: 1px solid var(--walspro-border-strong);
  margin-block-start: 10px;
}
.btn.secondary:hover {
  border-color: var(--walspro-muted);
}
.alt-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-block-start: 14px;
  padding-block-start: 14px;
  border-top: 1px solid var(--walspro-border);
}
.link-row {
  text-align: center;
  font-size: 13px;
  margin-block-start: 4px;
}
.link-row a {
  color: var(--walspro-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.link-row a:hover { color: var(--walspro-text); }
.foot {
  margin-block-start: 18px;
  font-size: 12px;
  color: var(--walspro-muted);
  text-align: center;
}
.foot a {
  color: var(--walspro-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.foot a:hover { color: var(--walspro-text); }
`;

export interface AuthorizePageParams {
  lang: Lang;
  clientName: string;
  clientId: string;
  redirectUri: string;
  redirectHost: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope: string;
  state: string;
  csrfToken: string;
  promoActive: boolean;
  step: "email" | "verify";
  challengeId?: string;
  email?: string;
  error?: string;
  info?: string;
}

export function renderAuthorizePage(p: AuthorizePageParams): string {
  const de = p.lang === "de";
  const title = de
    ? "Verbindung autorisieren — ShopCart MCP"
    : "Authorize Connection — ShopCart MCP";
  const otherLang = de ? "en" : "de";
  const toggleLabel = de ? "English" : "Deutsch";

  const baseParams = {
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_challenge: p.codeChallenge,
    code_challenge_method: p.codeChallengeMethod,
    resource: p.resource,
    scope: p.scope,
    ...(p.state ? { state: p.state } : {})
  };

  const langSwitchQs = new URLSearchParams({ ...baseParams, lang: otherLang }).toString();
  const restartQs = new URLSearchParams({ ...baseParams, lang: p.lang }).toString();

  const hiddenOAuthFields = `
    <input type="hidden" name="_csrf" value="${escapeHtml(p.csrfToken)}">
    <input type="hidden" name="lang" value="${escapeHtml(p.lang)}">
    <input type="hidden" name="client_id" value="${escapeHtml(p.clientId)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(p.redirectUri)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(p.codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(p.codeChallengeMethod)}">
    <input type="hidden" name="resource" value="${escapeHtml(p.resource)}">
    <input type="hidden" name="scope" value="${escapeHtml(p.scope)}">
    <input type="hidden" name="state" value="${escapeHtml(p.state)}">
  `;

  const stepSection =
    p.step === "verify" && p.challengeId
      ? `
  <div class="banner info" role="status">
    ${
      de
        ? `Wir haben einen <strong>6-stelligen Code</strong> und einen <strong>1-Klick-Link</strong> an <strong>${escapeHtml(p.email ?? "")}</strong> gesendet.`
        : `We sent a <strong>6-digit code</strong> and a <strong>1-click link</strong> to <strong>${escapeHtml(p.email ?? "")}</strong>.`
    }
  </div>

  <form method="POST" action="/oauth/authorize" aria-labelledby="auth-heading">
    ${hiddenOAuthFields}
    <input type="hidden" name="step" value="verify">
    <input type="hidden" name="challenge_id" value="${escapeHtml(p.challengeId)}">
    <input type="hidden" name="email" value="${escapeHtml(p.email ?? "")}">

    <div class="hp" aria-hidden="true">
      <label for="website">Website</label>
      <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
    </div>

    <div class="field">
      <label for="otp-code">${de ? "6-stelliger Anmeldecode" : "6-digit sign-in code"}</label>
      <p id="otp-hint" class="field-hint">${
        de
          ? "Gib den 6-stelligen Code aus deiner E-Mail ein (funktioniert in jeder App & jedem Browser) — oder klicke am Desktop den Magic Link."
          : "Enter the 6-digit code from your email (works in every app & browser) — or click the Magic Link on desktop."
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
        aria-describedby="otp-hint"
        required
        autofocus>
    </div>

    <button class="btn primary" type="submit">${de ? "Bestätigen & verbinden" : "Verify & authorize"}</button>
  </form>

  <div class="alt-actions">
    <form method="POST" action="/oauth/authorize">
      ${hiddenOAuthFields}
      <input type="hidden" name="step" value="email">
      <input type="hidden" name="email" value="${escapeHtml(p.email ?? "")}">
      <button class="btn secondary" type="submit">${de ? "Neuen Code senden" : "Send a new code"}</button>
    </form>
    <div class="link-row">
      <a href="/oauth/authorize?${escapeHtml(restartQs)}">${de ? "Andere E-Mail-Adresse verwenden" : "Use a different email address"}</a>
    </div>
  </div>
`
      : `
  <form method="POST" action="/oauth/authorize" aria-labelledby="auth-heading">
    ${hiddenOAuthFields}
    <input type="hidden" name="step" value="email">

    <div class="hp" aria-hidden="true">
      <label for="website">Website</label>
      <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
    </div>

    <div class="field">
      <label for="email">${de ? "E-Mail-Adresse" : "Email address"}</label>
      <p id="email-hint" class="field-hint">${
        de
          ? "Kein Passwort nötig — wir senden dir einen 6-stelligen Einmal-Code und einen Magic Link."
          : "No password required — we'll email you a 6-digit one-time code and a Magic Link."
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
        aria-describedby="email-hint"
        value="${escapeHtml(p.email ?? "")}">
    </div>

    <button class="btn primary" type="submit">${de ? "Code per E-Mail senden" : "Send sign-in code"}</button>
  </form>
`;

  return `<!doctype html>
<html lang="${p.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#141414">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${escapeHtml(title)}</title>
<style>${WALSPRO_DARK_CSS}</style>
</head>
<body class="auth-body">
<main class="card">
  <div class="top">
    <div class="brand"><img src="/assets/walspro-mark.svg" alt="wals.pro" width="24" height="24">ShopCart MCP <span class="brand-sub">by wals.pro</span></div>
    <a class="lang" href="/oauth/authorize?${escapeHtml(langSwitchQs)}">${escapeHtml(toggleLabel)}</a>
  </div>

  <nav aria-label="${de ? "Anmeldeschritte" : "Sign-in progress"}">
    <ol class="steps">
      <li${p.step === "email" ? ' aria-current="step"' : ""}>${de ? "1. E-Mail" : "1. Email"}</li>
      <li${p.step === "verify" ? ' aria-current="step"' : ""}>${de ? "2. Code bestätigen" : "2. Verify code"}</li>
    </ol>
  </nav>

  <h1 id="auth-heading">${de ? "MCP-Verbindung freigeben" : "Connect your AI client"}</h1>
  <p class="sub">${
    de
      ? `<strong>${escapeHtml(p.clientName)}</strong> möchte auf deine ShopCart MCP Shopping-Tools zugreifen.`
      : `<strong>${escapeHtml(p.clientName)}</strong> wants to access your ShopCart MCP shopping tools.`
  }</p>

  <div class="consent-box">
    <div class="consent-row"><span>Client</span><span>${escapeHtml(p.clientName)}</span></div>
    <div class="consent-row"><span>Redirect</span><span>${escapeHtml(p.redirectHost)}</span></div>
    <div class="consent-row"><span>${de ? "Berechtigung" : "Scope"}</span><span>${escapeHtml(p.scope)} (${de ? "Nur-Lesen & Warenkorb-Links" : "Read-only & Cart Links"})</span></div>
  </div>

  ${
    p.promoActive
      ? `<div class="banner ok">${
          de
            ? "Black-Friday-Launch: Bis 06.12.2026 nutzt du automatisch 500 Calls/Tag (Pro) kostenlos."
            : "Black Friday Launch: Automatic 500 calls/day (Pro) free for every account until Dec 6, 2026."
        }</div>`
      : ""
  }

  ${p.error ? `<div class="banner err" role="alert">${escapeHtml(p.error)}</div>` : ""}
  ${p.info ? `<div class="banner ok" role="status">${escapeHtml(p.info)}</div>` : ""}

  ${stepSection}

  <p class="foot">
    ${de ? "Mit der Anmeldung akzeptierst du unsere" : "By continuing you agree to our"}
    <a href="/privacy?lang=${p.lang}" target="_blank" rel="noopener">${de ? "Datenschutzerklärung" : "Privacy Policy"}</a> ·
    <a href="/terms?lang=${p.lang}" target="_blank" rel="noopener">${de ? "Nutzungsbedingungen" : "Terms"}</a> ·
    <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">${de ? "Impressum" : "Legal Notice"}</a>
  </p>
</main>
</body>
</html>`;
}

export interface MagicLinkResultPageParams {
  lang: Lang;
  kind: "browser_mismatch" | "invalid" | "expired" | "used";
  email?: string;
  clientName?: string;
}

export function renderMagicLinkResultPage(p: MagicLinkResultPageParams): string {
  const de = p.lang === "de";
  let heading: string;
  let body: string;
  let bannerClass = "err";

  if (p.kind === "browser_mismatch") {
    bannerClass = "info";
    heading = de ? "Bitte Code in deinem KI-Client eingeben" : "Enter the code in your AI client";
    const clientLabel = p.clientName ? escapeHtml(p.clientName) : de ? "deinem KI-Client" : "your AI client";
    body = de
      ? `<div class="banner info" role="status">Du hast diesen Magic Link in einem anderen Browser geöffnet als <strong>${clientLabel}</strong>.</div>
         <p class="sub">Kein Problem: Dein <strong>6-stelliger Code</strong> aus derselben E-Mail ist weiterhin aktiv! Gib ihn einfach direkt im Anmeldefenster deines KI-Clients ein, um die Verbindung abzuschließen.</p>`
      : `<div class="banner info" role="status">You opened this Magic Link in a different browser than <strong>${clientLabel}</strong>.</div>
         <p class="sub">No problem: the <strong>6-digit code</strong> from the same email is still active! Simply enter it in your AI client's sign-in window to finish connecting.</p>`;
  } else if (p.kind === "expired") {
    heading = de ? "Anmelde-Link abgelaufen" : "Sign-in link expired";
    body = `<div class="banner err" role="alert">${
      de
        ? "Dieser Anmelde-Link ist älter als 10 Minuten und nicht mehr gültig. Bitte fordere einfach einen neuen Code an."
        : "This sign-in link is older than 10 minutes and has expired. Please request a fresh code."
    }</div>`;
  } else if (p.kind === "used") {
    heading = de ? "Link bereits verwendet" : "Link already used";
    body = `<div class="banner warn" role="alert">${
      de
        ? "Dieser Einmal-Link wurde bereits eingelöst. Falls du noch nicht angemeldet bist, fordere bitte einen neuen Code an."
        : "This single-use link has already been used. If you are not signed in yet, please request a new code."
    }</div>`;
  } else {
    heading = de ? "Ungültiger Anmelde-Link" : "Invalid sign-in link";
    body = `<div class="banner err" role="alert">${
      de
        ? "Dieser Anmelde-Link ist ungültig oder wurde gesperrt. Bitte starte die Anmeldung erneut."
        : "This sign-in link is invalid or locked. Please start the sign-in flow again."
    }</div>`;
  }

  const billingHref = p.email
    ? `/billing/login?lang=${p.lang}&email=${encodeURIComponent(p.email)}`
    : `/billing/login?lang=${p.lang}`;

  return `<!doctype html>
<html lang="${p.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#141414">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${escapeHtml(heading)} — ShopCart MCP</title>
<style>${WALSPRO_DARK_CSS}</style>
</head>
<body class="auth-body">
<main class="card" data-state="${escapeHtml(p.kind)}" data-banner="${escapeHtml(bannerClass)}">
  <div class="top">
    <a class="brand" href="/?lang=${p.lang}"><img src="/assets/walspro-mark.svg" alt="wals.pro" width="24" height="24">ShopCart MCP <span class="brand-sub">by wals.pro</span></a>
  </div>

  <h1>${escapeHtml(heading)}</h1>
  ${body}

  <a class="btn primary" href="${escapeHtml(billingHref)}">${
    de ? "Zu Konto & Billing anmelden" : "Sign in to Account & Billing"
  }</a>
  <a class="btn secondary" href="/?lang=${p.lang}">${de ? "Zur Startseite" : "Back to homepage"}</a>

  <p class="foot">
    <a href="/privacy?lang=${p.lang}">${de ? "Datenschutz" : "Privacy Policy"}</a> ·
    <a href="/terms?lang=${p.lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a> ·
    <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">${de ? "Impressum" : "Legal Notice"}</a>
  </p>
</main>
</body>
</html>`;
}
