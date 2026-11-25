import type { AppConfig } from "../config.js";
import { escapeHtml, type Lang } from "../auth/pages.js";

function renderLegalShell(lang: Lang, title: string, path: string, bodyHtml: string): string {
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
<style>
:root{
  color-scheme:dark;
  --walspro-accent:#ff1f4d;--walspro-bg:#141414;--walspro-bg-2:#0d0d0d;--walspro-bg-deep:#090909;
  --walspro-surface:#1a1a1a;--walspro-border:#2a2a2a;--walspro-divider:#242424;--walspro-border-strong:#3a3a3a;
  --walspro-ink:#e0e0e0;--walspro-muted:#a7adb4;--walspro-hint:#7e848e;
}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;font-family:"WALSPRO Body","Inter","Avenir Next",system-ui,sans-serif;background:radial-gradient(58% 36% at 85% 0%,rgba(255,31,77,.09),transparent 60%),var(--walspro-bg);color:var(--walspro-ink);line-height:1.65;-webkit-font-smoothing:antialiased}
.wrap{max-width:780px;margin:0 auto;padding:28px 22px 56px}
.top{display:flex;justify-content:space-between;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--walspro-divider);margin-bottom:28px;gap:14px;flex-wrap:wrap}
.brand{font-family:"WALSPRO Display","Inter",system-ui,sans-serif;font-weight:750;text-decoration:none;color:#fff;display:inline-flex;align-items:center;gap:10px;font-size:16px}
.brand img{width:26px;height:26px;border-radius:7px;display:block}
.nav{display:flex;gap:16px;font-size:13px;color:var(--walspro-muted);align-items:center;flex-wrap:wrap}
.nav a{text-decoration:none;color:inherit}
.nav a:hover{color:#fff}
.card{background:var(--walspro-surface);border:1px solid var(--walspro-border);border-radius:16px;padding:30px;box-shadow:0 16px 48px rgba(0,0,0,.4)}
h1{margin:0 0 6px;font-family:"WALSPRO Display","Inter",system-ui,sans-serif;font-size:26px;letter-spacing:-.025em;color:#fff}
.updated{font-size:13px;color:var(--walspro-muted);margin:0 0 22px}
h2{margin:24px 0 8px;font-family:"WALSPRO Display","Inter",system-ui,sans-serif;font-size:17px;letter-spacing:-.01em;color:#fff}
p,li{font-size:14.5px;color:var(--walspro-ink)}
ul{padding-left:20px}
li{margin:6px 0}
code{font-family:"SFMono-Regular","Cascadia Code",monospace;background:var(--walspro-bg-deep);border:1px solid var(--walspro-border);padding:1px 6px;border-radius:6px;font-size:13px}
.disclaimer{margin-top:24px;padding:12px 14px;background:var(--walspro-bg-2);border:1px solid var(--walspro-border);border-radius:12px;font-size:13px;color:var(--walspro-muted)}
a{color:#ff6b7a}
a:hover{color:#fff}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="brand" href="/?lang=${lang}"><img src="/assets/walspro-mark.svg" alt="wals.pro" width="26" height="26"><span>ShopCart MCP</span></a>
    <nav class="nav">
      <a href="/?lang=${lang}">${de ? "Startseite" : "Home"}</a>
      <a href="/billing?lang=${lang}">${de ? "Konto & Billing" : "Billing"}</a>
      <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy"}</a>
      <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a>
      <a href="${escapeHtml(path)}?lang=${otherLang}">${de ? "English" : "Deutsch"}</a>
    </nav>
  </div>
  <main class="card">
    ${bodyHtml}
  </main>
</div>
</body>
</html>`;
}

export function renderPrivacyPage(config: AppConfig, lang: Lang): string {
  const de = lang === "de";
  const body = de
    ? `
<h1>Datenschutzerklärung — ShopCart MCP</h1>
<p class="updated">Stand: 25.11.2026 · Gilt für den gehosteten Dienst (${escapeHtml(config.appOrigin)}) und die Open-Source-CLI (<code>shopcart-mcp</code>)</p>

<h2>1. Verantwortlicher</h2>
<p><strong>Wals Professional Services GmbH</strong>, Wien, Österreich (EU).<br>
Support &amp; Datenschutzanfragen: <a href="mailto:support@wals.pro">support@wals.pro</a> · Sicherheitsmeldungen: <a href="mailto:security@wals.pro">security@wals.pro</a> · <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">Impressum</a>.</p>

<h2>2. Datenkategorien &amp; Zwecke</h2>
<ul>
  <li><strong>Konto &amp; OAuth-2.1-Authentifizierung:</strong> E-Mail-Adresse, gesalzener Passwort-Hash (<code>scrypt</code>) sowie kryptografische Hashes (<code>SHA-256</code>) von OAuth-Access-/Refresh-Tokens (niemals Klartext-Tokens), um Verbindungen mit KI-Clients (z. B. Claude, ChatGPT, Cursor) abzusichern.</li>
  <li><strong>Tool-Eingaben &amp; -Ausgaben:</strong> Vom Nutzer übergebene öffentliche Shop-URLs, Suchbegriffe, Produkthandles und Varianten-IDs werden in Echtzeit per HTTPS-GET an den jeweils angefragten öffentlichen Online-Shop weitergeleitet, um Katalogdaten zu normalisieren und Warenkorb-Links zu erzeugen. Wir speichern <strong>keine</strong> Chat-Verläufe, keine Lieferadressen, keine Shop-Logins und keine Zahlungsdaten.</li>
  <li><strong>Nutzungszähler &amp; Billing:</strong> Pro Konto wird ein rein numerischer Tageszähler (<code>tool_calls</code> pro Tag) zur Einhaltung des Free-/Pro-Tageskontingents geführt. Bei Abschluss eines Pro-Abos erfolgt die Zahlungsabwicklung ausschließlich über <strong>Stripe</strong>; bei Wals.pro werden lediglich die Stripe-Customer-ID, Subscription-ID und der Abo-Status gespeichert (keine Kreditkarten- oder Bankdaten).</li>
  <li><strong>Lokaler Open-Source-Modus (<code>npx -y shopcart-mcp</code>):</strong> Läuft zu 100 % lokal über <code>stdio</code> auf dem Gerät des Nutzers — <strong>null Datenübertragung an Wals.pro, null Telemetrie, kein Konto erforderlich</strong>.</li>
</ul>

<h2>3. Empfänger &amp; Auftragsverarbeiter</h2>
<ul>
  <li><strong>Google Cloud Platform (Region <code>europe-west1</code>, EU):</strong> Hosting (Cloud Run) und Datenbank (Cloud Firestore).</li>
  <li><strong>Stripe Payments Europe Ltd.:</strong> Zahlungs- und Abo-Verwaltung (nur bei aktivem Pro-Upgrade).</li>
  <li><strong>Angefragter Online-Shop:</strong> Ausschließlich öffentliche HTTPS-Abfragen an die vom Nutzer ausdrücklich genannte Shop-Domain (geschützt durch DNS-gepinnten SSRF-Blocker).</li>
</ul>

<h2>4. Speicherdauer</h2>
<ul>
  <li>OAuth Access Tokens: <strong>1 Stunde</strong> (automatische Firestore-TTL-Löschung).</li>
  <li>OAuth Refresh Tokens: <strong>30 Tage</strong> (Single-Use-Rotation, sofortige Family-Revocation bei Replay).</li>
  <li>OAuth Authorization Codes: <strong>5 Minuten</strong> (einmalige Verwendung).</li>
  <li>Dynamisch registrierte OAuth-Clients (DCR): <strong>30 Tage</strong> unaktiviert / <strong>90 Tage</strong> nach Aktivierung.</li>
  <li>Kontodaten (E-Mail, Passwort-Hash, Kontingentstatus): Bis zur Löschung durch den Nutzer.</li>
</ul>

<h2>5. Nutzerkontrolle &amp; DSGVO-Rechte (Art. 15–21 DSGVO)</h2>
<p>Du kannst jede KI-Client-Verbindung jederzeit über deinen Client oder <code>/oauth/revoke</code> widerrufen. Auskunft, Berichtigung, Datenexport oder vollständige Kontolöschung erhältst du jederzeit formlos per E-Mail an <a href="mailto:support@wals.pro">support@wals.pro</a>.</p>

<div class="disclaimer">Unabhängiges Community-Tool für Shopify-Shops — nicht verbunden mit oder unterstützt von Shopify Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern.</div>
`
    : `
<h1>Privacy Policy — ShopCart MCP</h1>
<p class="updated">Last updated: 2026-11-25 · Applies to the hosted service (${escapeHtml(config.appOrigin)}) and the open-source CLI (<code>shopcart-mcp</code>)</p>

<h2>1. Data Controller</h2>
<p><strong>Wals Professional Services GmbH</strong>, Vienna, Austria (EU).<br>
Support &amp; privacy requests: <a href="mailto:support@wals.pro">support@wals.pro</a> · Security contact: <a href="mailto:security@wals.pro">security@wals.pro</a> · <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">Legal Notice</a>.</p>

<h2>2. Data Categories &amp; Purposes</h2>
<ul>
  <li><strong>Account &amp; OAuth 2.1 Authentication:</strong> Email address, per-user salted password hash (<code>scrypt</code>), and cryptographic hashes (<code>SHA-256</code>) of OAuth access/refresh tokens (never plaintext tokens) used strictly to authenticate your AI clients (such as Claude, ChatGPT, or Cursor).</li>
  <li><strong>Tool Inputs &amp; Outputs:</strong> Public store URLs, search keywords, product handles, and variant IDs you pass to tools are forwarded live over HTTPS GET to the requested public online store to normalize catalog metadata and build browser cart links. We do <strong>not</strong> store chat transcripts, shipping addresses, merchant store logins, or payment credentials.</li>
  <li><strong>Usage Counters &amp; Billing:</strong> A numeric daily tool-call counter per account is stored to enforce Free/Pro daily quotas. If you upgrade to Pro, payment processing is handled solely by <strong>Stripe</strong>; Wals.pro stores only your Stripe Customer ID, Subscription ID, and subscription status (zero credit card or bank details).</li>
  <li><strong>Local Open-Source Mode (<code>npx -y shopcart-mcp</code>):</strong> Runs 100% locally over <code>stdio</code> on your machine — <strong>zero data sent to Wals.pro, zero telemetry, no account required</strong>.</li>
</ul>

<h2>3. Recipients &amp; Subprocessors</h2>
<ul>
  <li><strong>Google Cloud Platform (Region <code>europe-west1</code>, EU):</strong> Application hosting (Cloud Run) and database storage (Cloud Firestore).</li>
  <li><strong>Stripe Payments Europe Ltd.:</strong> Subscription checkout and billing portal (only when upgrading to Pro).</li>
  <li><strong>Requested Public Storefront:</strong> Public read-only HTTPS catalog queries to the store domain explicitly requested by the user (protected by DNS-pinned SSRF controls).</li>
</ul>

<h2>4. Data Retention</h2>
<ul>
  <li>OAuth Access Tokens: <strong>1 hour</strong> (automatic Firestore TTL expiration).</li>
  <li>OAuth Refresh Tokens: <strong>30 days</strong> (single-use rotation with automatic family revocation on replay).</li>
  <li>OAuth Authorization Codes: <strong>5 minutes</strong> (single-use).</li>
  <li>Dynamic OAuth Clients (DCR): <strong>30 days</strong> if unactivated / <strong>90 days</strong> once activated.</li>
  <li>Account records (email, password hash, plan status): Retained until you request account deletion.</li>
</ul>

<h2>5. User Controls &amp; GDPR Rights (Articles 15–21)</h2>
<p>You can revoke any connected AI client at any time in your AI client settings or via <code>/oauth/revoke</code>. To request access, correction, export, or permanent deletion of your account and all associated data, email <a href="mailto:support@wals.pro">support@wals.pro</a>.</p>

<div class="disclaimer">Independent community tool for Shopify stores — not affiliated with or endorsed by Shopify Inc. All trademarks belong to their respective owners.</div>
`;

  return renderLegalShell(lang, de ? "Datenschutz" : "Privacy Policy", "/privacy", body);
}

export function renderTermsPage(config: AppConfig, lang: Lang): string {
  const de = lang === "de";
  const body = de
    ? `
<h1>Nutzungsbedingungen — ShopCart MCP</h1>
<p class="updated">Stand: 25.11.2026 · Betreiber: Wals Professional Services GmbH (Wien, Österreich)</p>

<h2>1. Leistungsbeschreibung (Nur-Lesen)</h2>
<p>ShopCart MCP (${escapeHtml(config.appOrigin)}) ist ein eigenständiger Katalog-Normalisierer, Varianten-Prüfer und Warenkorb-Link-Generator für öffentliche Online-Shops (erster Adapter: öffentliche Shopify-Storefronts). Alle MCP-Tools arbeiten <strong>rein lesend</strong>: ShopCart MCP löst niemals Bestellungen aus, nimmt keine Zahlungen entgegen und greift auf keine Händler-Admin-Konten zu. Kaufverträge kommen ausschließlich direkt zwischen dir und dem jeweiligen Händler im Browser zustande.</p>

<h2>2. Tarife, Kontingente &amp; Open-Source-Lizenz</h2>
<ul>
  <li><strong>Lokale OSS-CLI (<code>shopcart-mcp</code>):</strong> Steht unter der <a href="${escapeHtml(config.repoUrl)}/blob/main/LICENSE" target="_blank" rel="noopener">MIT-Lizenz</a> und ist lokal unbegrenzt kostenfrei nutzbar.</li>
  <li><strong>Gehosteter Free-Tarif:</strong> ${config.freeDailyLimit} Tool-Calls pro Tag kostenfrei.</li>
  <li><strong>Gehosteter Pro-Tarif:</strong> 9 € / Monat (inkl. ${config.proDailyLimit} Tool-Calls pro Tag), monatlich jederzeit kündbar über das Stripe-Kundenportal. Während der Black-Friday-Launch-Aktion bis einschließlich 06.12.2026 steht das Pro-Kontingent allen angemeldeten Konten kostenlos zur Verfügung.</li>
</ul>

<h2>3. Zulässige Nutzung</h2>
<p>Untersagt sind automatisiertes Massen-Scraping, Umgehung technischer Schutzmechanismen, Angriffe auf interne Netze/Metadaten-Endpunkte sowie missbräuchliche Umgehung von Tageskontingenten. Wals.pro darf Konten bei Missbrauch sperren.</p>

<h2>4. Verfügbarkeit &amp; Haftung</h2>
<p>Katalogdaten, Preise und Verfügbarkeiten stammen direkt von dritten Online-Shops und können sich jederzeit ändern. Wir übernehmen keine Gewähr für Preis- oder Bestandsangaben von Drittanbietern. Im Übrigen haftet die Wals Professional Services GmbH nach Maßgabe des österreichischen Rechts (Vorsatz und grobe Fahrlässigkeit unbeschränkt).</p>

<h2>5. Kontakt</h2>
<p>Support: <a href="mailto:support@wals.pro">support@wals.pro</a> · <a href="/privacy?lang=de">Datenschutzerklärung</a> · <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">Impressum</a>.</p>

<div class="disclaimer">Unabhängiges Community-Tool für Shopify-Shops — nicht verbunden mit oder unterstützt von Shopify Inc.</div>
`
    : `
<h1>Terms of Service — ShopCart MCP</h1>
<p class="updated">Last updated: 2026-11-25 · Operator: Wals Professional Services GmbH (Vienna, Austria)</p>

<h2>1. Service Description (Strictly Read-Only)</h2>
<p>ShopCart MCP (${escapeHtml(config.appOrigin)}) is an independent storefront catalog normalizer, variant availability checker, and deterministic cart link generator for public online stores (initial adapter: public Shopify storefronts). All MCP tools are <strong>strictly read-only</strong>: ShopCart MCP never places orders, never processes checkout payments, and never accesses merchant admin accounts. Any purchase takes place solely between you and the respective merchant in your browser.</p>

<h2>2. Plans, Quotas &amp; Open-Source License</h2>
<ul>
  <li><strong>Local OSS CLI (<code>shopcart-mcp</code>):</strong> Released under the <a href="${escapeHtml(config.repoUrl)}/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a>; free and unlimited when run locally.</li>
  <li><strong>Hosted Free Tier:</strong> ${config.freeDailyLimit} tool calls per day at no cost.</li>
  <li><strong>Hosted Pro Tier:</strong> €9 / month (${config.proDailyLimit} tool calls per day), cancelable anytime via the Stripe Billing Portal. During our Black Friday Launch Promo through December 6, 2026, all signed-in accounts receive the Pro daily quota at no charge.</li>
</ul>

<h2>3. Acceptable Use</h2>
<p>You agree not to abuse the service for high-volume automated scraping, attempt to probe private networks or metadata endpoints, bypass rate limits or quotas, or disrupt third-party storefronts. Wals.pro may suspend accounts engaged in abuse.</p>

<h2>4. Third-Party Data &amp; Liability</h2>
<p>Product titles, prices, discounts, and stock availability come live from third-party public storefronts and may change at any time. Always verify final prices and items on the merchant's cart page before purchasing. Liability is governed by Austrian law.</p>

<h2>5. Contact</h2>
<p>Support: <a href="mailto:support@wals.pro">support@wals.pro</a> · <a href="/privacy?lang=en">Privacy Policy</a> · <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">Legal Notice</a>.</p>

<div class="disclaimer">Independent community tool for Shopify stores — not affiliated with or endorsed by Shopify Inc.</div>
`;

  return renderLegalShell(lang, de ? "Nutzungsbedingungen" : "Terms of Service", "/terms", body);
}

export function renderSecurityTxt(config: AppConfig): string {
  return [
    "Contact: mailto:security@wals.pro",
    "Expires: 2027-12-31T23:59:59.000Z",
    "Preferred-Languages: en, de",
    `Canonical: ${config.appOrigin}/.well-known/security.txt`,
    `Policy: ${config.appOrigin}/privacy`
  ].join("\n") + "\n";
}
