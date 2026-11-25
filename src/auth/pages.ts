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
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#fafaf9;--card:#ffffff;--ink:#111827;--muted:#57534e;--border:#e7e5e4;--accent:#d92d20;--accent-dark:#b42318;--soft:#fef3f2;--ok-bg:#ecfdf3;--ok-ink:#027a48}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;box-shadow:0 12px 30px rgba(0,0,0,.05)}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.brand{font-weight:700;font-size:15px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.lang{font-size:13px;color:var(--muted);text-decoration:none}
.lang:hover{color:var(--ink)}
h1{font-size:20px;margin:0 0 6px;letter-spacing:-.02em}
.sub{font-size:14px;color:var(--muted);margin:0 0 18px}
.consent-box{background:#f5f5f4;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:18px;font-size:13px}
.consent-row{display:flex;justify-content:space-between;gap:12px;margin:4px 0}
.consent-row span:first-child{color:var(--muted)}
.consent-row span:last-child{font-weight:600;text-align:right;word-break:break-all}
.promo{background:var(--ok-bg);color:var(--ok-ink);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:16px;font-weight:500}
.err{background:var(--soft);color:var(--accent-dark);border:1px solid #fecdca;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:16px}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#f5f5f4;padding:4px;border-radius:10px;margin-bottom:16px}
.tab{display:block;text-align:center;padding:8px;border-radius:7px;font-size:13px;font-weight:600;text-decoration:none;color:var(--muted);cursor:pointer;border:0;background:transparent}
.tab.active{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.06)}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 5px}
input[type=email],input[type=password]{width:100%;padding:10px 12px;border:1px solid #d6d3d1;border-radius:9px;font-size:14px;background:#fff;color:var(--ink)}
input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
button.primary{width:100%;margin-top:18px;padding:11px 16px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
button.primary:hover{background:var(--accent-dark)}
.foot{margin-top:16px;font-size:12px;color:var(--muted);text-align:center}
.foot a{color:var(--muted)}
</style>
</head>
<body>
<main class="card">
  <div class="top">
    <div class="brand"><span class="dot"></span>shopcart-mcp</div>
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
    <a href="https://wals.pro/policies/privacy-policy" target="_blank" rel="noopener">${de ? "Datenschutzerklärung" : "Privacy Policy"}</a> ·
    <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">${de ? "Impressum" : "Legal Notice"}</a>
  </p>
</main>
</body>
</html>`;
}
