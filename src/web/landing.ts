import type { AppConfig } from "../config.js";
import { escapeHtml, type Lang } from "../auth/pages.js";
import { isPromoFreeProActive } from "../billing/quota.js";

export function renderLandingPage(config: AppConfig, lang: Lang): string {
  const de = lang === "de";
  const mcpUrl = `${config.appOrigin}/mcp`;
  const promoActive = isPromoFreeProActive(config);
  const otherLang = de ? "en" : "de";

  const title = de
    ? "shopcart-mcp — Agentic Shopping & Cart MCP für Shopify-Shops"
    : "shopcart-mcp — Agentic Shopping & Cart MCP for Shopify Stores";

  const description = de
    ? "Verbinde Claude, ChatGPT oder Cursor direkt mit tausenden Shopify-Shops: Produkte suchen, Varianten prüfen, sichere Warenkorb-Links erstellen. Open Source (MIT) oder gehostet mit OAuth 2.1."
    : "Connect Claude, ChatGPT, or Cursor directly to Shopify storefronts: search products, verify variants, and generate deterministic cart links. Open-source (MIT) or hosted with OAuth 2.1.";

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<style>
:root{
  --bg:#fafaf9;--surface:#ffffff;--ink:#141413;--muted:#57534e;--border:#e7e5e4;
  --accent:#d92d20;--accent-hover:#b42318;--accent-soft:#fef3f2;
  --ok-bg:#ecfdf3;--ok-ink:#027a48;--code-bg:#1c1917;--code-ink:#f5f5f4;
}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1040px;margin:0 auto;padding:0 22px}
.promo-bar{background:#141413;color:#fafaf9;font-size:13px;padding:10px 16px;text-align:center}
.promo-bar strong{color:#fda29b}
.promo-bar a{color:#fff;text-decoration:underline;margin-left:8px}
header{border-bottom:1px solid var(--border);background:rgba(250,250,249,.9);backdrop-filter:blur(8px);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;height:62px;gap:16px}
.brand{font-weight:750;font-size:16px;letter-spacing:-.02em;text-decoration:none;display:flex;align-items:center;gap:9px}
.brand-dot{width:11px;height:11px;border-radius:50%;background:var(--accent)}
.nav-links{display:flex;align-items:center;gap:18px;font-size:14px;color:var(--muted)}
.nav-links a{text-decoration:none}
.nav-links a:hover{color:var(--ink)}
.btn-sm{padding:7px 13px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--ink);font-weight:600;font-size:13px;text-decoration:none}
.btn-sm:hover{border-color:#a8a29e}
.hero{padding:64px 0 44px;text-align:center}
.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;background:var(--accent-soft);color:var(--accent-hover);font-size:12px;font-weight:650;margin-bottom:18px}
h1{font-size:clamp(30px,5vw,48px);line-height:1.1;letter-spacing:-.035em;margin:0 auto 16px;max-width:780px}
.lead{font-size:18px;color:var(--muted);max-width:650px;margin:0 auto 28px}
.endpoint-box{max-width:640px;margin:0 auto 18px;display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:8px 8px 8px 16px;box-shadow:0 8px 24px rgba(0,0,0,.04)}
.endpoint-url{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;text-align:left;overflow-x:auto;white-space:nowrap;color:var(--ink)}
.btn-primary{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:650;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn-primary:hover{background:var(--accent-hover)}
.btn-secondary{background:var(--surface);color:var(--ink);border:1px solid var(--border);border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.btn-secondary:hover{border-color:#a8a29e}
.hero-actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:16px}
section{padding:44px 0}
h2{font-size:26px;letter-spacing:-.025em;margin:0 0 8px}
.sec-sub{color:var(--muted);margin:0 0 24px;font-size:15px}
.grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
.grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px}
.card.featured{border-color:var(--accent);box-shadow:0 12px 32px rgba(217,45,32,.08)}
.step-num{width:28px;height:28px;border-radius:8px;background:var(--accent-soft);color:var(--accent-hover);font-weight:750;font-size:13px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px}
.card h3{margin:0 0 8px;font-size:17px;letter-spacing:-.015em}
.card p{margin:0;color:var(--muted);font-size:14px}
.tool-tag{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:650;background:#f5f5f4;padding:3px 8px;border-radius:6px;margin-bottom:10px}
pre{background:var(--code-bg);color:var(--code-ink);padding:16px;border-radius:12px;overflow-x:auto;font-size:13px;line-height:1.5;margin:14px 0 0}
.price{font-size:34px;font-weight:800;letter-spacing:-.03em;margin:10px 0 4px}
.price span{font-size:14px;font-weight:500;color:var(--muted)}
ul.feat{list-style:none;padding:0;margin:16px 0 20px;font-size:14px;color:var(--muted)}
ul.feat li{padding:5px 0}
ul.feat li::before{content:"✓ ";color:var(--ok-ink);font-weight:700}
.pill-ok{display:inline-block;background:var(--ok-bg);color:var(--ok-ink);font-size:12px;font-weight:650;padding:4px 10px;border-radius:999px;margin-bottom:8px}
footer{border-top:1px solid var(--border);padding:32px 0 44px;color:var(--muted);font-size:13px;margin-top:24px}
.foot-row{display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;align-items:center}
.foot-links{display:flex;gap:18px;flex-wrap:wrap}
.foot-links a{text-decoration:none}
.foot-links a:hover{text-decoration:underline;color:var(--ink)}
.disclaimer{margin-top:14px;font-size:12px;color:#78716c}
@media(max-width:640px){.endpoint-box{flex-direction:column;align-items:stretch;padding:12px}.btn-primary{justify-content:center}.nav-links a.hide-sm{display:none}}
</style>
</head>
<body>
${
  promoActive
    ? `<div class="promo-bar"><strong>${de ? "BLACK FRIDAY LAUNCH" : "BLACK FRIDAY LAUNCH"}:</strong> ${
        de
          ? "Gratis Pro (500 Tool-Calls/Tag) für alle eingeloggten Nutzer bis 06.12.2026 — keine Kreditkarte nötig."
          : "Free Pro (500 tool calls/day) for all signed-in users until Dec 6, 2026 — no credit card required."
      } <a href="/billing?lang=${lang}">${de ? "Konto öffnen" : "Open account"}</a></div>`
    : ""
}

<header>
  <div class="wrap nav">
    <a class="brand" href="/?lang=${lang}"><span class="brand-dot"></span>shopcart-mcp</a>
    <nav class="nav-links">
      <a class="hide-sm" href="#setup">${de ? "Setup" : "Setup"}</a>
      <a class="hide-sm" href="#tools">Tools</a>
      <a class="hide-sm" href="#pricing">${de ? "Preise" : "Pricing"}</a>
      <a href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener">GitHub</a>
      <a class="btn-sm" href="/billing?lang=${lang}">${de ? "Konto & Billing" : "Account & Billing"}</a>
      <a class="btn-sm" href="/?lang=${otherLang}">${de ? "EN" : "DE"}</a>
    </nav>
  </div>
</header>

<main class="wrap">
  <section class="hero">
    <div class="badge">${
      de
        ? "Open Source (MIT) · OAuth 2.1 Ready · Claude, ChatGPT & Cursor"
        : "Open Source (MIT) · OAuth 2.1 Ready · Claude, ChatGPT & Cursor"
    }</div>
    <h1>${
      de
        ? "Agentic Shopping & Cart MCP für Shopify-Shops"
        : "Agentic Shopping & Cart MCP for Shopify Stores"
    }</h1>
    <p class="lead">${
      de
        ? "Lass Claude, ChatGPT oder Cursor Produkte in beliebigen Shopify-Shops suchen, echte Varianten & Preise prüfen und sichere Warenkorb-Links bauen — WAF-resilient und geschützt gegen SSRF & Prompt-Injection."
        : "Let Claude, ChatGPT, or Cursor search products across Shopify storefronts, inspect live variants & prices, and build deterministic cart links — WAF-resilient with built-in SSRF & prompt-injection guards."
    }</p>

    <div class="endpoint-box">
      <div class="endpoint-url" id="mcp-url">${escapeHtml(mcpUrl)}</div>
      <button class="btn-primary" id="copy-btn" type="button">${de ? "MCP-URL kopieren" : "Copy MCP URL"}</button>
    </div>

    <div class="hero-actions">
      <a class="btn-secondary" href="/billing?lang=${lang}">${
        de ? "Kostenloses Konto erstellen" : "Create free account"
      }</a>
      <a class="btn-secondary" href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener">${
        de ? "GitHub (MIT Open Source)" : "GitHub (MIT Open Source)"
      }</a>
    </div>
  </section>

  <section id="setup">
    <h2>${de ? "In 3 Schritten verbinden" : "Connect in 3 steps"}</h2>
    <p class="sec-sub">${
      de
        ? "Funktioniert direkt per OAuth 2.1 (CIMD & DCR + PKCE S256) — kein API-Key-Gefummel."
        : "Works out of the box via OAuth 2.1 (CIMD & DCR + PKCE S256) — no manual API keys."
    }</p>
    <div class="grid-3">
      <div class="card">
        <div class="step-num">1</div>
        <h3>Claude.ai / Claude Desktop</h3>
        <p>${
          de
            ? "Öffne <strong>Settings → Connectors → Add custom connector</strong>, füge die MCP-URL oben ein und melde dich im Browser-Popup an."
            : "Open <strong>Settings → Connectors → Add custom connector</strong>, paste the MCP URL above, and sign in through the browser popup."
        }</p>
      </div>
      <div class="card">
        <div class="step-num">2</div>
        <h3>ChatGPT Custom Connectors</h3>
        <p>${
          de
            ? "Öffne <strong>Settings → Connectors → Create</strong>, wähle MCP-Server, trage die URL oben ein und autorisiere per OAuth 2.1."
            : "Open <strong>Settings → Connectors → Create</strong>, choose MCP server, enter the URL above, and authorize via OAuth 2.1."
        }</p>
      </div>
      <div class="card">
        <div class="step-num">3</div>
        <h3>Cursor / Claude Code / VS Code</h3>
        <p>${
          de
            ? "Füge den Remote-URL-Server hinzu (DCR + Loopback-OAuth) — oder nutze die lokale <code>stdio</code>-CLI komplett ohne Login."
            : "Add the remote HTTP MCP URL (DCR + loopback OAuth) — or run the local <code>stdio</code> CLI with zero authentication."
        }</p>
      </div>
    </div>
  </section>

  <section id="tools">
    <h2>${de ? "4 fokussierte Shopping-Tools" : "4 focused shopping tools"}</h2>
    <p class="sec-sub">${
      de
        ? "Nur-Lesen, deterministische Warenkorb-Permalinks, DNS-gepinnter SSRF-Schutz und Prompt-Injection-Sanitizing."
        : "Read-only, deterministic cart permalinks, DNS-pinned SSRF protection, and prompt-injection sanitization."
    }</p>
    <div class="grid-2">
      <div class="card">
        <span class="tool-tag">inspect_store</span>
        <h3>${de ? "Shop & Währung erkennen" : "Detect store & currency"}</h3>
        <p>${
          de
            ? "Prüft Shopify-Kompatibilität, Währung, Land, WAF-Verhalten und optionale native Storefront-MCP-Tools."
            : "Verifies Shopify compatibility, currency, country, WAF restrictions, and optional native Storefront MCP tools."
        }</p>
      </div>
      <div class="card">
        <span class="tool-tag">search_products</span>
        <h3>${de ? "WAF-resiliente Produktsuche" : "WAF-resilient product search"}</h3>
        <p>${
          de
            ? "Nutzt primär <code>/search/suggest.json</code> mit Preis- & Verfügbarkeitsfiltern sowie sauber normalisierten Beträgen."
            : "Uses <code>/search/suggest.json</code> primarily with price & availability filters and cleanly normalized amounts."
        }</p>
      </div>
      <div class="card">
        <span class="tool-tag">get_product</span>
        <h3>${de ? "Varianten, Optionen & Bestand" : "Variants, options & stock"}</h3>
        <p>${
          de
            ? "Liest <code>/products/&lt;handle&gt;.js</code>, konvertiert Minor-Units währungsgenau und entfernt HTML/Hidden-Unicode."
            : "Fetches <code>/products/&lt;handle&gt;.js</code>, converts minor units accurately by currency, and strips HTML/invisible Unicode."
        }</p>
      </div>
      <div class="card">
        <span class="tool-tag">create_cart_link</span>
        <h3>${de ? "Deterministischer Warenkorb-Link" : "Deterministic cart permalink"}</h3>
        <p>${
          de
            ? "Erzeugt prüfbare <code>/cart/&lt;id&gt;:&lt;qty&gt;?storefront=true</code> Links inkl. optionaler Varianten-Verifikation."
            : "Builds verifiable <code>/cart/&lt;id&gt;:&lt;qty&gt;?storefront=true</code> links with optional live variant verification."
        }</p>
      </div>
    </div>
  </section>

  <section id="oss">
    <div class="card">
      <h2>${de ? "Open Source & Self-Hosting (MIT)" : "Open Source & Self-Hosting (MIT)"}</h2>
      <p class="sec-sub" style="margin-bottom:10px">${
        de
          ? "Lokal via <code>stdio</code> kostenlos, unbegrenzt, ohne Login und ohne Telemetrie — oder als eigener Docker-Container."
          : "Run locally via <code>stdio</code> for free with unlimited calls, zero auth, and zero telemetry — or self-host via Docker."
      }</p>
      <pre><code># Local stdio MCP (Claude Desktop / Cursor / Claude Code)
npx -y shopcart-mcp

# Or clone &amp; run from source
git clone ${escapeHtml(config.repoUrl)}.git &amp;&amp; cd shopcart-mcp
pnpm install &amp;&amp; pnpm build &amp;&amp; pnpm start:stdio</code></pre>
    </div>
  </section>

  <section id="pricing">
    <h2>${de ? "Transparente Preise" : "Simple pricing"}</h2>
    <p class="sec-sub">${
      de
        ? "Lokal immer gratis. Gehostet als sofort nutzbarer OAuth-2.1-Endpoint für Claude.ai & ChatGPT."
        : "Always free locally. Hosted as a ready-to-use OAuth 2.1 endpoint for Claude.ai & ChatGPT."
    }</p>
    <div class="grid-3">
      <div class="card">
        <h3>Open Source (stdio)</h3>
        <div class="price">0 € <span>/ ${de ? "immer" : "forever"}</span></div>
        <ul class="feat">
          <li>${de ? "Unbegrenzte Tool-Calls" : "Unlimited tool calls"}</li>
          <li>${de ? "Kein Login, keine Telemetrie" : "No login, no telemetry"}</li>
          <li>${de ? "MIT-Lizenz, eigener Host" : "MIT licensed, self-hostable"}</li>
        </ul>
        <a class="btn-secondary" style="width:100%;justify-content:center" href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener">GitHub</a>
      </div>

      <div class="card">
        <h3>Hosted Free</h3>
        <div class="price">0 € <span>/ ${de ? "Monat" : "month"}</span></div>
        <ul class="feat">
          <li>${de ? `${config.freeDailyLimit} Tool-Calls / Tag` : `${config.freeDailyLimit} tool calls / day`}</li>
          <li>${de ? "OAuth 2.1 für Claude & ChatGPT" : "OAuth 2.1 for Claude & ChatGPT"}</li>
          <li>${de ? "Sofort startklar ohne Kreditkarte" : "Instant start, no credit card"}</li>
        </ul>
        <a class="btn-secondary" style="width:100%;justify-content:center" href="/billing?lang=${lang}">${
          de ? "Kostenlos starten" : "Start free"
        }</a>
      </div>

      <div class="card featured">
        ${
          promoActive
            ? `<div class="pill-ok">${de ? "Gratis bis 06.12.2026" : "Free until Dec 6, 2026"}</div>`
            : ""
        }
        <h3>Hosted Pro</h3>
        <div class="price">9 € <span>/ ${de ? "Monat" : "month"}</span></div>
        <ul class="feat">
          <li>${de ? `${config.proDailyLimit} Tool-Calls / Tag` : `${config.proDailyLimit} tool calls / day`}</li>
          <li>${
            promoActive
              ? de
                ? "Black-Friday-Launch: Jetzt kostenlos inkl. 500/Tag!"
                : "Black Friday Launch: Free 500/day automatically active!"
              : de
                ? "Jederzeit monatlich kündbar"
                : "Cancel anytime via Stripe Portal"
          }</li>
          <li>${de ? "Priorisierte EU Cloud Run Infrastruktur" : "EU Cloud Run infrastructure (europe-west1)"}</li>
        </ul>
        <a class="btn-primary" style="width:100%;justify-content:center" href="/billing?lang=${lang}">${
          promoActive
            ? de
              ? "Pro kostenlos sichern"
              : "Claim free Pro access"
            : de
              ? "Auf Pro upgraden"
              : "Upgrade to Pro"
        }</a>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="wrap">
    <div class="foot-row">
      <div><strong>shopcart-mcp</strong> · by <a href="https://wals.pro" target="_blank" rel="noopener">Wals.pro</a></div>
      <div class="foot-links">
        <a href="/billing?lang=${lang}">${de ? "Konto & Billing" : "Account & Billing"}</a>
        <a href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener">GitHub</a>
        <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy Policy"}</a>
        <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a>
        <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">${de ? "Impressum" : "Legal Notice"}</a>
      </div>
    </div>
    <p class="disclaimer">${
      de
        ? "Unabhängiges Open-Source-Projekt von Wals.pro. Nicht verbunden mit oder unterstützt von Shopify Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern."
        : "Independent open-source project by Wals.pro. Not affiliated with or endorsed by Shopify Inc. All trademarks belong to their respective owners."
    }</p>
  </div>
</footer>

<script>
document.getElementById("copy-btn")?.addEventListener("click", async () => {
  const url = document.getElementById("mcp-url")?.textContent?.trim();
  const btn = document.getElementById("copy-btn");
  if (!url || !btn) return;
  try {
    await navigator.clipboard.writeText(url);
    const prev = btn.textContent;
    btn.textContent = ${JSON.stringify(de ? "Kopiert ✓" : "Copied ✓")};
    setTimeout(() => { btn.textContent = prev; }, 1800);
  } catch {
    window.prompt(${JSON.stringify(de ? "MCP-URL kopieren:" : "Copy MCP URL:")}, url);
  }
});
</script>
</body>
</html>`;
}
