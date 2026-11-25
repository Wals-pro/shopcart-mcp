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
  mode: "login" | "register";
  email?: string;
  error?: string;
}

export function renderAuthorizePage(p: AuthorizePageParams): string {
  const de = p.lang === "de";
  const title = de ? "Verbindung autorisieren — shopcart-mcp" : "Authorize Connection — shopcart-mcp";
  const otherLang = de ? "en" : "de";
  const toggleLabel = de ? "English" : "Deutsch";

  const qs = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_challenge: p.codeChallenge,
    code_challenge_method: p.codeChallengeMethod,
    resource: p.resource,
    scope: p.scope,
    ...(p.state ? { state: p.state } : {}),
    lang: otherLang
  }).toString();

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
<style>
:root{
  color-scheme:dark;
  --walspro-accent:#ff1f4d;--walspro-accent-rgb:255,31,77;--walspro-on-accent:#000000;
  --walspro-bg:#141414;--walspro-bg-2:#0d0d0d;--walspro-bg-deep:#090909;
  --walspro-surface:#1a1a1a;--walspro-surface-raised:#1e1e1e;
  --walspro-border:#2a2a2a;--walspro-border-strong:#3a3a3a;
  --walspro-ink:#e0e0e0;--walspro-muted:#a7adb4;--walspro-hint:#7e848e;
  --walspro-tone-positive-fg:#7bd88f;--walspro-tone-positive-bg:rgba(76,175,80,.12);--walspro-tone-positive-border:rgba(76,175,80,.3);
  --walspro-danger:#ff6b7f;--walspro-danger-bg:rgba(255,107,127,.12);--walspro-danger-border:rgba(255,107,127,.32);
}
*{box-sizing:border-box}
body{margin:0;font-family:"WALSPRO Body","Inter","Avenir Next",system-ui,sans-serif;background:radial-gradient(60% 42% at 85% 0%,rgba(255,31,77,.11),transparent 60%),var(--walspro-bg);color:var(--walspro-ink);line-height:1.5;display:flex;min-height:100dvh;align-items:center;justify-content:center;padding:20px;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:450px;background:var(--walspro-surface);border:1px solid var(--walspro-border);border-radius:16px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.55)}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.brand{font-family:"WALSPRO Display","Inter",system-ui,sans-serif;font-weight:750;font-size:15px;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:9px;color:#fff}
.brand img{width:24px;height:24px;border-radius:6px;display:block}
.lang{font-size:12.5px;color:var(--walspro-muted);text-decoration:none;padding:5px 10px;border-radius:10px;border:1px solid var(--walspro-border-strong);background:var(--walspro-bg-2)}
.lang:hover{color:#fff;border-color:rgba(var(--walspro-accent-rgb),.4)}
h1{font-family:"WALSPRO Display","Inter",system-ui,sans-serif;font-size:21px;margin:0 0 6px;letter-spacing:-.02em;color:#fff}
.sub{font-size:14px;color:var(--walspro-muted);margin:0 0 18px}
.sub strong{color:#fff}
.consent-box{background:var(--walspro-bg-2);border:1px solid var(--walspro-border);border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:13px}
.consent-row{display:flex;justify-content:space-between;gap:12px;margin:5px 0}
.consent-row span:first-child{color:var(--walspro-muted)}
.consent-row span:last-child{font-weight:600;text-align:right;word-break:break-all;color:var(--walspro-ink)}
.promo{background:var(--walspro-tone-positive-bg);color:var(--walspro-tone-positive-fg);border:1px solid var(--walspro-tone-positive-border);border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:16px;font-weight:500}
.err{background:var(--walspro-danger-bg);color:var(--walspro-danger);border:1px solid var(--walspro-danger-border);border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:16px}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--walspro-bg-deep);border:1px solid var(--walspro-border);padding:4px;border-radius:14px;margin-bottom:16px}
.tab{display:block;text-align:center;padding:8px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:var(--walspro-muted);cursor:pointer;border:1px solid transparent;background:transparent}
.tab.active{background:var(--walspro-surface-raised);color:#fff;border-color:var(--walspro-border-strong)}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px;color:var(--walspro-ink)}
input[type=email],input[type=password]{width:100%;height:44px;padding:0 14px;border:1px solid var(--walspro-border-strong);border-radius:14px;font-size:14px;background:var(--walspro-bg-deep);color:var(--walspro-ink)}
input:focus{outline:2px solid var(--walspro-accent);outline-offset:1px;border-color:var(--walspro-accent)}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
button.primary{width:100%;min-height:44px;margin-top:18px;padding:0 16px;border:0;border-radius:14px;background:var(--walspro-accent);color:var(--walspro-on-accent);font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(255,31,77,.25)}
button.primary:hover{filter:brightness(1.08)}
.foot{margin-top:18px;font-size:12px;color:var(--walspro-hint);text-align:center}
.foot a{color:var(--walspro-muted);text-decoration:none}
.foot a:hover{color:#fff;text-decoration:underline}
</style>
</head>
<body>
<main class="card">
  <div class="top">
    <div class="brand"><img src="/assets/walspro-mark.svg" alt="wals.pro" width="24" height="24"><span>shopcart-mcp</span></div>
    <a class="lang" href="/oauth/authorize?${escapeHtml(qs)}">${escapeHtml(toggleLabel)}</a>
  </div>

  <h1>${de ? "MCP-Verbindung freigeben" : "Connect your AI client"}</h1>
  <p class="sub">${
    de
      ? `<strong>${escapeHtml(p.clientName)}</strong> möchte auf deine shopcart-mcp Shopping-Tools zugreifen.`
      : `<strong>${escapeHtml(p.clientName)}</strong> wants to access your shopcart-mcp shopping tools.`
  }</p>

  <div class="consent-box">
    <div class="consent-row"><span>${de ? "Client" : "Client"}</span><span>${escapeHtml(p.clientName)}</span></div>
    <div class="consent-row"><span>${de ? "Redirect" : "Redirect"}</span><span>${escapeHtml(p.redirectHost)}</span></div>
    <div class="consent-row"><span>${de ? "Berechtigung" : "Scope"}</span><span>${escapeHtml(p.scope)} (${de ? "Nur-Lesen & Warenkorb-Links" : "Read-only & Cart Links"})</span></div>
  </div>

  ${
    p.promoActive
      ? `<div class="promo">${
          de
            ? "Black-Friday-Launch: Bis 06.12.2026 nutzt du automatisch 500 Calls/Tag (Pro) kostenlos."
            : "Black Friday Launch: Automatic 500 calls/day (Pro) free for every account until Dec 6, 2026."
        }</div>`
      : ""
  }

  ${p.error ? `<div class="err">${escapeHtml(p.error)}</div>` : ""}

  <div class="tabs">
    <a class="tab ${p.mode === "register" ? "active" : ""}" href="/oauth/authorize?${escapeHtml(
      new URLSearchParams({
        response_type: "code",
        client_id: p.clientId,
        redirect_uri: p.redirectUri,
        code_challenge: p.codeChallenge,
        code_challenge_method: p.codeChallengeMethod,
        resource: p.resource,
        scope: p.scope,
        ...(p.state ? { state: p.state } : {}),
        lang: p.lang,
        mode: "register"
      }).toString()
    )}">${de ? "Neu registrieren" : "Create account"}</a>
    <a class="tab ${p.mode === "login" ? "active" : ""}" href="/oauth/authorize?${escapeHtml(
      new URLSearchParams({
        response_type: "code",
        client_id: p.clientId,
        redirect_uri: p.redirectUri,
        code_challenge: p.codeChallenge,
        code_challenge_method: p.codeChallengeMethod,
        resource: p.resource,
        scope: p.scope,
        ...(p.state ? { state: p.state } : {}),
        lang: p.lang,
        mode: "login"
      }).toString()
    )}">${de ? "Anmelden" : "Sign in"}</a>
  </div>

  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="_csrf" value="${escapeHtml(p.csrfToken)}">
    <input type="hidden" name="lang" value="${escapeHtml(p.lang)}">
    <input type="hidden" name="mode" value="${escapeHtml(p.mode)}">
    <input type="hidden" name="client_id" value="${escapeHtml(p.clientId)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(p.redirectUri)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(p.codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(p.codeChallengeMethod)}">
    <input type="hidden" name="resource" value="${escapeHtml(p.resource)}">
    <input type="hidden" name="scope" value="${escapeHtml(p.scope)}">
    <input type="hidden" name="state" value="${escapeHtml(p.state)}">

    <div class="hp" aria-hidden="true">
      <label for="website">Website</label>
      <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
    </div>

    <label for="email">${de ? "E-Mail-Adresse" : "Email address"}</label>
    <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com" value="${escapeHtml(p.email ?? "")}">

    <label for="password">${de ? "Passwort (mind. 8 Zeichen)" : "Password (min. 8 characters)"}</label>
    <input id="password" name="password" type="password" required minlength="8" maxlength="128" autocomplete="${p.mode === "register" ? "new-password" : "current-password"}">

    <button class="primary" type="submit">${
      p.mode === "register"
        ? de
          ? "Konto anlegen & verbinden"
          : "Create account & authorize"
        : de
          ? "Anmelden & verbinden"
          : "Sign in & authorize"
    }</button>
  </form>

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
