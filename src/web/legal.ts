import type { AppConfig } from "../config.js";
import { escapeHtml, type Lang } from "../auth/pages.js";
import {
  renderAnalyticsHead,
  renderConsentBanner,
  renderCookieSettingsFooterLink
} from "./analytics.js";
import { renderFaviconHeadLinks, renderShopCartWordmark, renderSparkCartSvg } from "./brand.js";
import { getTrademarkDisclaimer } from "./platforms.js";

function renderLegalShell(
  lang: Lang,
  title: string,
  path: string,
  bodyHtml: string,
  config?: AppConfig
): string {
  const de = lang === "de";
  const otherLang = de ? "en" : "de";
  const version = encodeURIComponent(config?.version ?? "0.6.0");
  const analyticsHead = config ? renderAnalyticsHead(config, { lang, pageType: "legal" }) : "";
  const cookieSettings = config ? renderCookieSettingsFooterLink(config, lang, { separator: " · " }) : "";
  const consentBanner = config ? renderConsentBanner(config, lang) : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#141414">
${renderFaviconHeadLinks()}
<title>${escapeHtml(title)} — ShopCart MCP</title>
<link rel="stylesheet" href="/assets/legal.css?v=${version}">
${analyticsHead}
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="brand" href="/?lang=${lang}">${renderSparkCartSvg({ size: 26, className: "brand-logo" })}${renderShopCartWordmark("MCP")}</a>
    <nav class="nav">
      <a href="/?lang=${lang}">${de ? "Startseite" : "Home"}</a>
      <a href="${de ? "/for-merchants" : "/en/for-merchants"}">${de ? "Für Shops" : "For merchants"}</a>
      <a href="${de ? "/check" : "/en/check"}">${de ? "Shop prüfen" : "Check store"}</a>
      <a href="/billing?lang=${lang}">${de ? "Konto & Billing" : "Billing"}</a>
      <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy"}</a>
      <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a>
      <a href="${escapeHtml(path)}?lang=${otherLang}">${de ? "English" : "Deutsch"}</a>
    </nav>
  </div>
  <main class="card">
    ${bodyHtml}
  </main>
  <p class="foot-note">ShopCart MCP · by <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">wals.pro</a>${cookieSettings}</p>
</div>
${consentBanner}
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
  <li><strong>Konto &amp; OAuth-2.1-Authentifizierung:</strong> Passwortloser E-Mail-Login per einmaligem 6-stelligen Code und Magic Link (ausschließlich als <code>HMAC-SHA-256</code>-Hash mit 10 Minuten TTL gespeichert, keine Passwörter) sowie kryptografische Hashes (<code>SHA-256</code>) von OAuth-Access-/Refresh-Tokens (niemals Klartext-Tokens), um Verbindungen mit KI-Clients (z. B. Claude, ChatGPT, Cursor) abzusichern.</li>
  <li><strong>Tool-Eingaben &amp; -Ausgaben:</strong> Vom Nutzer übergebene öffentliche Shop-URLs, Suchbegriffe, Produkthandles und Varianten-IDs werden in Echtzeit per HTTPS-GET an den jeweils angefragten öffentlichen Online-Shop weitergeleitet, um Katalogdaten zu normalisieren und Warenkorb-Links zu erzeugen. Wir speichern <strong>keine</strong> Chat-Verläufe, keine Lieferadressen, keine Shop-Logins und keine Zahlungsdaten.</li>
  <li><strong>Nutzungszähler &amp; Billing:</strong> Pro Konto wird ein rein numerischer Tageszähler (<code>tool_calls</code> pro Tag) zur Einhaltung des Free-/Pro-Tageskontingents geführt. Bei Abschluss eines Pro-Abos erfolgt die Zahlungsabwicklung ausschließlich über <strong>Stripe</strong>; bei wals.pro werden lediglich die Stripe-Customer-ID, Subscription-ID und der Abo-Status gespeichert (keine Kreditkarten- oder Bankdaten).</li>
  <li><strong>Lokaler Open-Source-Modus (<code>npx -y shopcart-mcp</code>):</strong> Läuft zu 100 % lokal über <code>stdio</code> auf dem Gerät des Nutzers — <strong>null Datenübertragung an wals.pro, null Telemetrie, kein Konto erforderlich</strong>.</li>
</ul>

<h2>3. Empfänger &amp; Auftragsverarbeiter</h2>
<ul>
  <li><strong>Google Cloud Platform (Region <code>europe-west1</code>, EU):</strong> Hosting (Cloud Run) und Datenbank (Cloud Firestore).</li>
  <li><strong>Stripe Payments Europe Ltd.:</strong> Zahlungs- und Abo-Verwaltung (nur bei aktivem Pro-Upgrade).</li>
  <li><strong>Google Ireland Limited (nur nach Einwilligung):</strong> Webanalyse via Google Analytics 4 ausschließlich nach deiner ausdrücklichen Zustimmung im Cookie-Banner (siehe Abschnitt 7).</li>
  <li><strong>Angefragter Online-Shop:</strong> Ausschließlich öffentliche HTTPS-Abfragen an die vom Nutzer ausdrücklich genannte Shop-Domain (geschützt durch DNS-gepinnten SSRF-Blocker).</li>
</ul>

<h2>4. Speicherdauer</h2>
<ul>
  <li>OAuth Access Tokens: <strong>1 Stunde</strong> (automatische Firestore-TTL-Löschung).</li>
  <li>OAuth Refresh Tokens: <strong>30 Tage</strong> (Single-Use-Rotation, sofortige Family-Revocation bei Replay).</li>
  <li>OAuth Authorization Codes: <strong>5 Minuten</strong> (einmalige Verwendung).</li>
  <li>Dynamisch registrierte OAuth-Clients (DCR): <strong>30 Tage</strong> unaktiviert / <strong>90 Tage</strong> nach Aktivierung.</li>
  <li>E-Mail-Einmal-Codes &amp; Magic Links: <strong>10 Minuten</strong> (einmalige Verwendung, automatische Firestore-TTL-Löschung).</li>
  <li>Kontodaten (E-Mail, Kontingentstatus): Bis zur Löschung durch den Nutzer.</li>
</ul>

<h2>5. Nutzerkontrolle &amp; DSGVO-Rechte (Art. 15–21 DSGVO)</h2>
<p>Du kannst jede KI-Client-Verbindung jederzeit über deinen Client oder <code>/oauth/revoke</code> widerrufen. Auskunft, Berichtigung, Datenexport oder vollständige Kontolöschung erhältst du jederzeit formlos per E-Mail an <a href="mailto:support@wals.pro">support@wals.pro</a>.</p>

<h2>6. UTM-Attribution &amp; Affiliate-/Partner-Links (Transparenzhinweis)</h2>
<p>Von ShopCart erzeugte Produkt- und Warenkorb-Links enthalten im gehosteten Modus standardmäßig nicht-personenbezogene UTM-Parameter (<code>utm_source=shopcart.wals.pro</code>, <code>utm_medium=ai_mcp</code>, <code>utm_campaign=shopcart_mcp</code>), damit Händler KI-vermittelte Besuche in ihren Shop-Analysen zuordnen können (in der lokalen OSS-CLI optional abschaltbar via <code>SHOPCART_DISABLE_UTM=1</code>). Für teilnehmende Partner-Shops oder Produkt-Feeds (z. B. über Affiliate-Netzwerke wie Awin, Impact, Sovrn Commerce, Direktpartnerprogramme oder das Amazon-PartnerNet) können Links zusätzlich Partner- oder Affiliate-Parameter enthalten. Solche monetarisierten Links werden in jeder MCP-Antwort ausdrücklich mit <code>affiliate_disclosure: true</code> gekennzeichnet (§ 5a UWG, § 6 DDG, ECG, FTC 16 CFR Part 255). Beim Klick auf einen Affiliate-Link können das jeweilige Netzwerk oder der Händler eigene Zuordnungs-Cookies gemäß deren Datenschutzerklärung setzen; Wals Professional Services GmbH erhält keine persönlichen Bestell- oder Zahlungsdaten. <strong>Amazon-PartnerNet-Hinweis:</strong> Als Amazon-Partner verdient Wals Professional Services GmbH an qualifizierten Verkäufen — für dich entstehen dadurch keine Mehrkosten.</p>

<h2>7. Webanalyse mit Google Analytics 4 (nur nach Einwilligung)</h2>
<p>Auf der Website von ShopCart MCP setzen wir <strong>Google Analytics 4</strong> ein, einen Webanalysedienst der <strong>Google Ireland Limited</strong> (Gordon House, Barrow Street, Dublin 4, Irland; Muttergesellschaft: Google LLC, USA, zertifiziert unter dem EU-US Data Privacy Framework). Die Nutzung erfolgt streng nach dem <strong>Zero-Pre-Consent-Prinzip</strong> und dem <strong>Google Consent Mode v2</strong>:</p>
<ul>
  <li><strong>Rechtsgrundlage:</strong> Ausschließlich deine vorherige, ausdrückliche Einwilligung gemäß <strong>Art. 6 Abs. 1 lit. a DSGVO</strong> und <strong>§ 165 Abs. 3 TKG 2021</strong>. Solange du nicht aktiv auf „Alle akzeptieren“ geklickt hast, werden keinerlei Anfragen an <code>googletagmanager.com</code> oder <code>google-analytics.com</code> gesendet und keine <code>_ga*</code>-Cookies gesetzt.</li>
  <li><strong>Erhobene Daten (0 PII):</strong> Nach deiner Zustimmung messen wir ausschließlich pseudonyme Nutzungs- und Interaktionsereignisse auf unseren Webseiten (bereinigte Seitenaufrufe ohne Query-Parameter, Klicks auf KI-Verbindungs- und Setup-Buttons, Tab-Auswahl, Kopieren von Setup-Snippets sowie anonymisierte Aktivierungs- und Upgrade-Schritte). Es werden <strong>niemals</strong> E-Mail-Adressen, Einmal-Codes, OAuth-Tokens, Zahlungsdaten, Suchbegriffe oder Warenkorbinhalte an Google Analytics übermittelt. Die lokale Open-Source-CLI (<code>npx -y shopcart-mcp</code>) enthält keinerlei Webanalyse oder Telemetrie.</li>
  <li><strong>Datenschutz-Härtung:</strong> IP-Anonymisierung ist aktiv (<code>anonymize_ip: true</code>), Google Signals und Werbepersonalisierung sind dauerhaft deaktiviert (<code>allow_google_signals: false</code>, <code>allow_ad_personalization_signals: false</code>) und URL-Query-Strings werden vor der Übermittlung entfernt.</li>
  <li><strong>Speicherung &amp; jederzeitiger Widerruf:</strong> Deine Entscheidung wird lokal in deinem Browser unter <code>localStorage</code> (<code>shopcart_consent_v1</code>) gespeichert. Du kannst deine Einwilligung jederzeit mit Wirkung für die Zukunft über <strong>„Cookie-Einstellungen“</strong> im Footer jeder Seite widerrufen („Nur notwendige“ wählen). Beim Widerruf wird Google Analytics sofort deaktiviert und alle gesetzten <code>_ga*</code>-Cookies werden gelöscht.</li>
</ul>

<div class="disclaimer">${escapeHtml(getTrademarkDisclaimer("de"))}</div>
`
    : `
<h1>Privacy Policy — ShopCart MCP</h1>
<p class="updated">Last updated: 2026-11-25 · Applies to the hosted service (${escapeHtml(config.appOrigin)}) and the open-source CLI (<code>shopcart-mcp</code>)</p>

<h2>1. Data Controller</h2>
<p><strong>Wals Professional Services GmbH</strong>, Vienna, Austria (EU).<br>
Support &amp; privacy requests: <a href="mailto:support@wals.pro">support@wals.pro</a> · Security contact: <a href="mailto:security@wals.pro">security@wals.pro</a> · <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">Legal Notice</a>.</p>

<h2>2. Data Categories &amp; Purposes</h2>
<ul>
  <li><strong>Account &amp; OAuth 2.1 Authentication:</strong> Passwordless email sign-in via single-use 6-digit code and Magic Link (stored strictly as <code>HMAC-SHA-256</code> hashes with a 10-minute TTL — zero passwords stored), plus cryptographic hashes (<code>SHA-256</code>) of OAuth access/refresh tokens (never plaintext tokens) used strictly to authenticate your AI clients (such as Claude, ChatGPT, or Cursor).</li>
  <li><strong>Tool Inputs &amp; Outputs:</strong> Public store URLs, search keywords, product handles, and variant IDs you pass to tools are forwarded live over HTTPS GET to the requested public online store to normalize catalog metadata and build browser cart links. We do <strong>not</strong> store chat transcripts, shipping addresses, merchant store logins, or payment credentials.</li>
  <li><strong>Usage Counters &amp; Billing:</strong> A numeric daily tool-call counter per account is stored to enforce Free/Pro daily quotas. If you upgrade to Pro, payment processing is handled solely by <strong>Stripe</strong>; wals.pro stores only your Stripe Customer ID, Subscription ID, and subscription status (zero credit card or bank details).</li>
  <li><strong>Local Open-Source Mode (<code>npx -y shopcart-mcp</code>):</strong> Runs 100% locally over <code>stdio</code> on your machine — <strong>zero data sent to wals.pro, zero telemetry, no account required</strong>.</li>
</ul>

<h2>3. Recipients &amp; Subprocessors</h2>
<ul>
  <li><strong>Google Cloud Platform (Region <code>europe-west1</code>, EU):</strong> Application hosting (Cloud Run) and database storage (Cloud Firestore).</li>
  <li><strong>Stripe Payments Europe Ltd.:</strong> Subscription checkout and billing portal (only when upgrading to Pro).</li>
  <li><strong>Google Ireland Limited (consent only):</strong> Web analytics via Google Analytics 4 strictly after your explicit opt-in via the cookie banner (see Section 7).</li>
  <li><strong>Requested Public Storefront:</strong> Public read-only HTTPS catalog queries to the store domain explicitly requested by the user (protected by DNS-pinned SSRF controls).</li>
</ul>

<h2>4. Data Retention</h2>
<ul>
  <li>OAuth Access Tokens: <strong>1 hour</strong> (automatic Firestore TTL expiration).</li>
  <li>OAuth Refresh Tokens: <strong>30 days</strong> (single-use rotation with automatic family revocation on replay).</li>
  <li>OAuth Authorization Codes: <strong>5 minutes</strong> (single-use).</li>
  <li>Dynamic OAuth Clients (DCR): <strong>30 days</strong> if unactivated / <strong>90 days</strong> once activated.</li>
  <li>Email one-time codes &amp; Magic Links: <strong>10 minutes</strong> (single-use, automatic Firestore TTL expiration).</li>
  <li>Account records (email, plan status): Retained until you request account deletion.</li>
</ul>

<h2>5. User Controls &amp; GDPR Rights (Articles 15–21)</h2>
<p>You can revoke any connected AI client at any time in your AI client settings or via <code>/oauth/revoke</code>. To request access, correction, export, or permanent deletion of your account and all associated data, email <a href="mailto:support@wals.pro">support@wals.pro</a>.</p>

<h2>6. UTM Attribution &amp; Affiliate / Partner Links Disclosure</h2>
<p>Product and cart links generated in hosted mode include non-personal UTM attribution parameters by default (<code>utm_source=shopcart.wals.pro</code>, <code>utm_medium=ai_mcp</code>, <code>utm_campaign=shopcart_mcp</code>) so merchants can recognize AI-assisted referrals in storefront analytics (optional opt-out in the local OSS CLI via <code>SHOPCART_DISABLE_UTM=1</code>). For participating merchants or partner product feeds (such as Awin, Impact, Sovrn Commerce, direct merchant referral programs, or Amazon Associates / PartnerNet), links may include affiliate tracking tags or deeplinks. Whenever a monetized affiliate link is returned, MCP tool outputs explicitly set <code>affiliate_disclosure: true</code> in compliance with EU/DACH transparency laws and US FTC Endorsement Guides (16 CFR Part 255). Clicking an affiliate link may allow the respective affiliate network or merchant to set attribution cookies under its own privacy policy; Wals Professional Services GmbH never receives personal shopper checkout details. <strong>Amazon Associates Disclosure:</strong> As an Amazon Associate, Wals Professional Services GmbH earns from qualifying purchases at no additional cost to you.</p>

<h2>7. Web Analytics with Google Analytics 4 (Consent Only)</h2>
<p>On the ShopCart MCP website, we use <strong>Google Analytics 4</strong>, a web analytics service provided by <strong>Google Ireland Limited</strong> (Gordon House, Barrow Street, Dublin 4, Ireland; parent company: Google LLC, USA, certified under the EU-US Data Privacy Framework). Analytics operates strictly under a <strong>zero-pre-consent</strong> standard and <strong>Google Consent Mode v2</strong>:</p>
<ul>
  <li><strong>Legal basis:</strong> Solely your prior explicit consent pursuant to <strong>Art. 6(1)(a) GDPR</strong> and <strong>§ 165(3) Austrian TKG 2021</strong>. Until you actively click “Accept all”, zero requests are made to <code>googletagmanager.com</code> or <code>google-analytics.com</code> and no <code>_ga*</code> cookies are set.</li>
  <li><strong>Data collected (zero PII):</strong> Only after opt-in do we collect pseudonymous website usage and interaction events (sanitized page views without query strings, setup/connect button clicks, setup tab switches, snippet copies, and anonymized activation or upgrade funnel steps). We <strong>never</strong> transmit email addresses, one-time codes, OAuth tokens, payment details, store queries, or cart contents to Google Analytics. The local open-source CLI (<code>npx -y shopcart-mcp</code>) contains zero analytics or telemetry.</li>
  <li><strong>Privacy safeguards:</strong> IP anonymization is enabled (<code>anonymize_ip: true</code>), Google Signals and ad personalization signals are disabled (<code>allow_google_signals: false</code>, <code>allow_ad_personalization_signals: false</code>), and URL query strings are stripped before transmission.</li>
  <li><strong>Storage &amp; withdrawal at any time:</strong> Your preference is stored locally in your browser via <code>localStorage</code> (<code>shopcart_consent_v1</code>). You can withdraw your consent at any time with future effect via <strong>“Cookie settings”</strong> in the footer of every page (select “Essential only”). Upon withdrawal, Google Analytics is immediately disabled and all <code>_ga*</code> cookies are deleted.</li>
</ul>

<div class="disclaimer">${escapeHtml(getTrademarkDisclaimer("en"))}</div>
`;

  return renderLegalShell(lang, de ? "Datenschutz" : "Privacy Policy", "/privacy", body, config);
}

export function renderTermsPage(config: AppConfig, lang: Lang): string {
  const de = lang === "de";
  const body = de
    ? `
<h1>Nutzungsbedingungen — ShopCart MCP</h1>
<p class="updated">Stand: 25.11.2026 · Betreiber: Wals Professional Services GmbH (Wien, Österreich)</p>

<h2>1. Leistungsbeschreibung (Nur-Lesen)</h2>
<p>ShopCart MCP (${escapeHtml(config.appOrigin)}) ist ein eigenständiger Katalog-Normalisierer, Varianten-Prüfer und Warenkorb-Link-Generator für öffentliche Online-Shops (Shopify, WooCommerce, BigCommerce, Shopware 6, Magento 2, Amazon-Warenkorb-Links sowie beliebige Shops mit Schema.org/JSON-LD-Produktdaten). Alle MCP-Tools arbeiten <strong>rein lesend</strong>: ShopCart MCP löst niemals Bestellungen aus, nimmt keine Zahlungen entgegen und greift auf keine Händler-Admin-Konten zu. Kaufverträge kommen ausschließlich direkt zwischen dir und dem jeweiligen Händler im Browser zustande.</p>

<h2>2. Tarife, Kontingente &amp; Open-Source-Lizenz</h2>
<ul>
  <li><strong>Lokale OSS-CLI (<code>shopcart-mcp</code>):</strong> Steht unter der <a href="${escapeHtml(config.repoUrl)}/blob/main/LICENSE" target="_blank" rel="noopener">MIT-Lizenz</a> und ist lokal unbegrenzt kostenfrei nutzbar.</li>
  <li><strong>Gehosteter Free-Tarif:</strong> ${config.freeDailyLimit} Tool-Calls pro Tag kostenfrei.</li>
  <li><strong>Gehosteter Pro-Tarif:</strong> 9 € / Monat (inkl. ${config.proDailyLimit} Tool-Calls pro Tag), monatlich jederzeit kündbar über das Stripe-Kundenportal. Während der Black-Friday-Launch-Aktion bis einschließlich 06.12.2026 steht das Pro-Kontingent allen angemeldeten Konten kostenlos zur Verfügung.</li>
</ul>

<h2>3. Zulässige Nutzung</h2>
<p>Untersagt sind automatisiertes Massen-Scraping, Umgehung technischer Schutzmechanismen, Angriffe auf interne Netze/Metadaten-Endpunkte sowie missbräuchliche Umgehung von Tageskontingenten. wals.pro darf Konten bei Missbrauch sperren.</p>

<h2>4. Verfügbarkeit &amp; Haftung</h2>
<p>Katalogdaten, Preise und Verfügbarkeiten stammen direkt von dritten Online-Shops und können sich jederzeit ändern. Wir übernehmen keine Gewähr für Preis- oder Bestandsangaben von Drittanbietern. Im Übrigen haftet die Wals Professional Services GmbH nach Maßgabe des österreichischen Rechts (Vorsatz und grobe Fahrlässigkeit unbeschränkt).</p>

<h2>5. Affiliate- &amp; Werbehinweis (EU/DACH &amp; FTC)</h2>
<p>Ausgehende Produkt- und Warenkorb-Links können reine UTM-Herkunftsparameter (<code>utm_source=shopcart.wals.pro</code>) sowie — bei teilnehmenden Partnern oder Produkt-Feeds (z. B. Awin, Impact, Sovrn Commerce, Direktpartner, Amazon PartnerNet) — gekennzeichnete Affiliate-Links (<code>affiliate_disclosure: true</code>) enthalten. Durch qualifizierte Käufe über solche Partner-Links kann Wals Professional Services GmbH eine Provision erhalten; der Kaufpreis für dich bleibt unverändert. Als Amazon-Partner verdient Wals Professional Services GmbH an qualifizierten Verkäufen.</p>

<h2>6. Kontakt</h2>
<p>Support: <a href="mailto:support@wals.pro">support@wals.pro</a> · <a href="/privacy?lang=de">Datenschutzerklärung</a> · <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">Impressum</a>.</p>

<div class="disclaimer">${escapeHtml(getTrademarkDisclaimer("de"))}</div>
`
    : `
<h1>Terms of Service — ShopCart MCP</h1>
<p class="updated">Last updated: 2026-11-25 · Operator: Wals Professional Services GmbH (Vienna, Austria)</p>

<h2>1. Service Description (Strictly Read-Only)</h2>
<p>ShopCart MCP (${escapeHtml(config.appOrigin)}) is an independent storefront catalog normalizer, variant availability checker, and deterministic cart link generator for public online stores (Shopify, WooCommerce, BigCommerce, Shopware 6, Magento 2, Amazon cart links, and any store with Schema.org/JSON-LD product data). All MCP tools are <strong>strictly read-only</strong>: ShopCart MCP never places orders, never processes checkout payments, and never accesses merchant admin accounts. Any purchase takes place solely between you and the respective merchant in your browser.</p>

<h2>2. Plans, Quotas &amp; Open-Source License</h2>
<ul>
  <li><strong>Local OSS CLI (<code>shopcart-mcp</code>):</strong> Released under the <a href="${escapeHtml(config.repoUrl)}/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a>; free and unlimited when run locally.</li>
  <li><strong>Hosted Free Tier:</strong> ${config.freeDailyLimit} tool calls per day at no cost.</li>
  <li><strong>Hosted Pro Tier:</strong> €9 / month (${config.proDailyLimit} tool calls per day), cancelable anytime via the Stripe Billing Portal. During our Black Friday Launch Promo through December 6, 2026, all signed-in accounts receive the Pro daily quota at no charge.</li>
</ul>

<h2>3. Acceptable Use</h2>
<p>You agree not to abuse the service for high-volume automated scraping, attempt to probe private networks or metadata endpoints, bypass rate limits or quotas, or disrupt third-party storefronts. wals.pro may suspend accounts engaged in abuse.</p>

<h2>4. Third-Party Data &amp; Liability</h2>
<p>Product titles, prices, discounts, and stock availability come live from third-party public storefronts and may change at any time. Always verify final prices and items on the merchant's cart page before purchasing. Liability is governed by Austrian law.</p>

<h2>5. Affiliate &amp; Partner Link Disclosure (EU/DACH &amp; FTC)</h2>
<p>Outbound product and cart links may carry non-monetized UTM attribution parameters (<code>utm_source=shopcart.wals.pro</code>) and, for participating merchants or partner product feeds (e.g., Awin, Impact, Sovrn Commerce, direct merchant programs, or Amazon Associates), clearly disclosed affiliate links (<code>affiliate_disclosure: true</code>). Qualifying purchases via partner links may earn Wals Professional Services GmbH a commission at no extra cost to you. As an Amazon Associate, Wals Professional Services GmbH earns from qualifying purchases.</p>

<h2>6. Contact</h2>
<p>Support: <a href="mailto:support@wals.pro">support@wals.pro</a> · <a href="/privacy?lang=en">Privacy Policy</a> · <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener">Legal Notice</a>.</p>

<div class="disclaimer">${escapeHtml(getTrademarkDisclaimer("en"))}</div>
`;

  return renderLegalShell(lang, de ? "Nutzungsbedingungen" : "Terms of Service", "/terms", body, config);
}

export function renderNotFoundPage(lang: Lang, config?: AppConfig): string {
  const de = lang === "de";
  const body = de
    ? `
<h1>404 — Seite nicht gefunden</h1>
<p class="updated">Die angeforderte Seite existiert leider nicht oder wurde verschoben.</p>
<p><a href="/?lang=de">Zur Startseite</a> · <a href="/guides?lang=de">Zu den Shopping-Guides</a> · <a href="/billing?lang=de">Konto &amp; Billing</a></p>
`
    : `
<h1>404 — Page not found</h1>
<p class="updated">The requested page does not exist or has been moved.</p>
<p><a href="/?lang=en">Back to homepage</a> · <a href="/guides?lang=en">Browse Shopping Guides</a> · <a href="/billing?lang=en">Account &amp; Billing</a></p>
`;
  return renderLegalShell(lang, de ? "Seite nicht gefunden (404)" : "Page not found (404)", "/", body, config);
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
