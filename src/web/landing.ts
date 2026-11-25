import type { AppConfig } from "../config.js";
import { escapeHtml, type Lang } from "../auth/pages.js";
import { isPromoFreeProActive } from "../billing/quota.js";

export type ResolvedDemoMedia =
  | { kind: "simulation" }
  | { kind: "video"; src: string; defaultAspect: "16:9" | "9:16" }
  | { kind: "iframe"; src: string; title: string; defaultAspect: "16:9" | "9:16" };

export function resolveDemoMedia(config: AppConfig, lang: Lang): ResolvedDemoMedia {
  const rawUrl =
    (lang === "de" ? config.demoVideoUrlDe : config.demoVideoUrlEn) ?? config.demoVideoUrl;
  if (!rawUrl) return { kind: "simulation" };

  // Direct self-hosted or external video file (.mp4 / .webm / .mov)
  const cleanPath = rawUrl.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (cleanPath.endsWith(".mp4") || cleanPath.endsWith(".webm") || cleanPath.endsWith(".mov")) {
    return { kind: "video", src: rawUrl, defaultAspect: "16:9" };
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    // YouTube (watch, youtu.be, shorts, embed)
    if (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "www.youtube-nocookie.com"
    ) {
      let videoId: string | null = null;
      let isShort = false;
      if (host === "youtu.be") {
        videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
      } else if (parsed.pathname.startsWith("/shorts/")) {
        videoId = parsed.pathname.split("/")[2] ?? null;
        isShort = true;
      } else if (parsed.pathname.startsWith("/embed/")) {
        videoId = parsed.pathname.split("/")[2] ?? null;
      } else {
        videoId = parsed.searchParams.get("v");
      }
      if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
        return {
          kind: "iframe",
          src: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
          title: lang === "de" ? "shopcart-mcp Demo-Video" : "shopcart-mcp demo video",
          defaultAspect: isShort ? "9:16" : "16:9"
        };
      }
    }

    // Vimeo
    if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
      const match = parsed.pathname.match(/\/(?:video\/)?(\d{5,15})/);
      if (match?.[1]) {
        return {
          kind: "iframe",
          src: `https://player.vimeo.com/video/${match[1]}?dnt=1`,
          title: lang === "de" ? "shopcart-mcp Demo-Video" : "shopcart-mcp demo video",
          defaultAspect: "16:9"
        };
      }
    }

    // TikTok
    if (host === "tiktok.com" || host === "www.tiktok.com" || host === "m.tiktok.com") {
      const match = parsed.pathname.match(/\/(?:video|embed\/v2)\/(\d{8,25})/);
      if (match?.[1]) {
        return {
          kind: "iframe",
          src: `https://www.tiktok.com/embed/v2/${match[1]}`,
          title: lang === "de" ? "shopcart-mcp TikTok Demo" : "shopcart-mcp TikTok demo",
          defaultAspect: "9:16"
        };
      }
    }
  } catch {
    return { kind: "simulation" };
  }

  return { kind: "simulation" };
}

export function renderLandingPage(config: AppConfig, lang: Lang): string {
  const de = lang === "de";
  const mcpUrl = `${config.appOrigin}/mcp`;
  const promoActive = isPromoFreeProActive(config);
  const otherLang = de ? "en" : "de";
  const demoMedia = resolveDemoMedia(config, lang);
  const defaultAspect = demoMedia.kind === "simulation" ? "16:9" : demoMedia.defaultAspect;
  const hasExternalVideo = demoMedia.kind !== "simulation";

  const title = de
    ? "shopcart-mcp — Agentic Shopping & Cart MCP für Shopify-Shops"
    : "shopcart-mcp — Agentic Shopping & Cart MCP for Shopify Stores";

  const description = de
    ? "Verbinde Claude, ChatGPT, Claude Code oder Cursor direkt mit tausenden Shopify-Shops: Produkte suchen, Varianten prüfen, sichere Warenkorb-Links erstellen. Open Source (MIT) oder gehostet mit OAuth 2.1."
    : "Connect Claude, ChatGPT, Claude Code, or Cursor directly to Shopify storefronts: search products, verify variants, and create deterministic cart links. Open-source (MIT) or hosted with OAuth 2.1.";

  const cursorSnippet = JSON.stringify(
    {
      mcpServers: {
        shopcart: {
          url: mcpUrl
        }
      }
    },
    null,
    2
  );

  const localSnippet = JSON.stringify(
    {
      mcpServers: {
        shopcart: {
          command: "npx",
          args: ["-y", "shopcart-mcp"]
        }
      }
    },
    null,
    2
  );

  const claudeCodeCmd = `claude mcp add --transport http shopcart ${mcpUrl}`;

  const demoViewportHtml =
    demoMedia.kind === "iframe"
      ? `<div class="media-frame">
          <iframe
            src="${escapeHtml(demoMedia.src)}"
            title="${escapeHtml(demoMedia.title)}"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        </div>`
      : demoMedia.kind === "video"
        ? `<div class="media-frame">
            <video controls playsinline autoplay muted loop preload="metadata">
              <source src="${escapeHtml(demoMedia.src)}">
            </video>
          </div>`
        : `<div class="media-frame">
            <div class="sim-player" id="sim-player">
              <div class="sim-chat">
                <div class="sim-msg-user">${
                  de
                    ? "Such mir Merinosocken bis 30 € bei allbirds.eu und leg 2 Paar in Größe M direkt in meinen Warenkorb."
                    : "Find merino socks under €30 on allbirds.eu and add 2 pairs in size M straight to my cart."
                }</div>

                <div class="sim-steps" aria-live="polite">
                  <div class="sim-step" data-state="active">
                    <div class="sim-step-left">
                      <span class="sim-step-icon" aria-hidden="true">1</span>
                      <span class="sim-step-call">inspect_store("allbirds.eu")</span>
                    </div>
                    <span class="sim-step-meta">Shopify · EUR</span>
                  </div>
                  <div class="sim-step" data-state="pending">
                    <div class="sim-step-left">
                      <span class="sim-step-icon" aria-hidden="true">2</span>
                      <span class="sim-step-call">search_products("merino socks", max_price=30)</span>
                    </div>
                    <span class="sim-step-meta">4 matches</span>
                  </div>
                  <div class="sim-step" data-state="pending">
                    <div class="sim-step-left">
                      <span class="sim-step-icon" aria-hidden="true">3</span>
                      <span class="sim-step-call">get_product("merino-crew-sock")</span>
                    </div>
                    <span class="sim-step-meta">M · EUR 25.49</span>
                  </div>
                  <div class="sim-step" data-state="pending">
                    <div class="sim-step-left">
                      <span class="sim-step-icon" aria-hidden="true">4</span>
                      <span class="sim-step-call">create_cart_link(37548706496709:2)</span>
                    </div>
                    <span class="sim-step-meta">302 verified</span>
                  </div>
                </div>

                <div class="sim-cart-card" id="sim-cart-card" data-ready="false">
                  <div class="sim-cart-head">
                    <span>✓ ${de ? "Warenkorb-Link verifiziert & bereit" : "Cart link verified & ready"}</span>
                    <span>storefront=true</span>
                  </div>
                  <div class="sim-cart-item">
                    <div>
                      <div class="sim-cart-name">Merino Crew Sock (2×)</div>
                      <div class="sim-cart-meta">${
                        de ? "Größe M · Natural Black · Auf Lager" : "Size M · Natural Black · In stock"
                      }</div>
                    </div>
                    <div class="sim-cart-price">EUR 50.98</div>
                  </div>
                  <a
                    class="sim-cart-link"
                    href="https://shop.allbirds.eu/cart/37548706496709:2?storefront=true"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>${de ? "Beispiel-Warenkorb öffnen" : "Open example cart link"}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                  <div class="sim-cart-url">https://shop.allbirds.eu/cart/37548706496709:2?storefront=true</div>
                </div>
              </div>

              <div class="sim-inspector">
                <div class="sim-inspector-head">
                  <span>MCP JSON-RPC · Streamable HTTP</span>
                  <span class="sim-status-ok" id="sim-latency">142 ms · 200 OK</span>
                </div>
                <pre class="sim-json" id="sim-json-output">{
  "tool": "inspect_store",
  "arguments": { "store_url": "https://shop.allbirds.eu" }
}</pre>
                <div class="sim-guards">
                  <span class="guard-pill">OAuth 2.1 PKCE</span>
                  <span class="guard-pill">DNS-Pinned SSRF</span>
                  <span class="guard-pill">Prompt-Sanitized</span>
                </div>
              </div>
            </div>
          </div>`;

  const demoControlsHtml =
    demoMedia.kind === "simulation"
      ? `<div class="demo-controls">
          <div class="demo-btn-group">
            <button
              type="button"
              class="sim-ctrl-btn"
              id="sim-play-btn"
              data-pause-label="${de ? "Pause" : "Pause"}"
              data-play-label="${de ? "Abspielen" : "Play"}"
            >❚❚ ${de ? "Pause" : "Pause"}</button>
            <button type="button" class="sim-ctrl-btn" id="sim-replay-btn">↺ ${
              de ? "Neu starten" : "Replay"
            }</button>
          </div>
          <div class="sim-timeline" role="group" aria-label="${
            de ? "Simulationsschritte" : "Simulation steps"
          }">
            <button type="button" class="sim-seg-btn" data-sim-step="0" data-active="true" data-filled="true">
              <span>01 inspect_store</span>
              <span class="sim-seg-bar"><span class="sim-seg-fill"></span></span>
            </button>
            <button type="button" class="sim-seg-btn" data-sim-step="1" data-active="false" data-filled="false">
              <span>02 search_products</span>
              <span class="sim-seg-bar"><span class="sim-seg-fill"></span></span>
            </button>
            <button type="button" class="sim-seg-btn" data-sim-step="2" data-active="false" data-filled="false">
              <span>03 get_product</span>
              <span class="sim-seg-bar"><span class="sim-seg-fill"></span></span>
            </button>
            <button type="button" class="sim-seg-btn" data-sim-step="3" data-active="false" data-filled="false">
              <span>04 create_cart_link</span>
              <span class="sim-seg-bar"><span class="sim-seg-fill"></span></span>
            </button>
          </div>
        </div>`
      : "";

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#060913">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="/assets/landing.css?v=0.2.0">
<script defer src="/assets/hero-flow.js?v=0.2.0"></script>
</head>
<body>
${
  promoActive
    ? `<div class="promo-bar">
        <div class="wrap promo-inner">
          <span class="promo-pill">Black Friday Launch</span>
          <span>${
            de
              ? `Hosted Pro kostenlos bis 06.12.2026 (${config.proDailyLimit} Calls/Tag) · Code <code class="promo-code">BLACKFRIDAY</code>`
              : `Hosted Pro free until Dec 6, 2026 (${config.proDailyLimit} calls/day) · Code <code class="promo-code">BLACKFRIDAY</code>`
          }</span>
          <a class="promo-cta" href="/billing?lang=${lang}">${
            de ? "Gratis aktivieren →" : "Claim free Pro →"
          }</a>
        </div>
      </div>`
    : ""
}

<header class="site-header">
  <div class="wrap nav">
    <a class="brand" href="/?lang=${lang}">
      <span class="brand-mark" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="20" r="1.5"></circle>
          <circle cx="18" cy="20" r="1.5"></circle>
          <path d="M2.5 3.5h3l2.2 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.5l1.5-7.3H6.3"></path>
        </svg>
      </span>
      <span>shopcart-mcp</span>
      <span class="brand-badge">&gt; MCP_</span>
    </a>

    <nav class="nav-links" aria-label="${de ? "Hauptnavigation" : "Main navigation"}">
      <a class="hide-sm" href="#demo">Demo</a>
      <a class="hide-sm" href="#setup">Setup</a>
      <a class="hide-sm" href="#tools">Tools</a>
      <a class="hide-sm" href="#pricing">${de ? "Preise" : "Pricing"}</a>
      <a class="hide-sm" href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>
      <div class="nav-actions">
        <a class="btn-nav" href="/billing?lang=${lang}">${de ? "Konto & Billing" : "Account & Billing"}</a>
        <a class="btn-nav btn-lang" href="/?lang=${otherLang}" hreflang="${otherLang}">${de ? "EN" : "DE"}</a>
      </div>
    </nav>
  </div>
</header>

<main>
  <!-- OVHcloud-Style Dynamic Flow Hero -->
  <section class="hero-section">
    <div class="wrap">
      <div class="hero-frame">
        <div class="hero-canvas-wrap">
          <canvas id="hero-flow-canvas" class="hero-canvas" aria-hidden="true"></canvas>
        </div>
        <button
          type="button"
          id="hero-motion-btn"
          class="hero-motion-btn"
          data-pause-label="${de ? "Animation pausieren" : "Pause animation"}"
          data-play-label="${de ? "Animation starten" : "Play animation"}"
        >❚❚ ${de ? "Animation pausieren" : "Pause animation"}</button>

        <div class="hero-content">
          <div class="eyebrow">
            <span class="eyebrow-dot" aria-hidden="true"></span>
            <span>Open Source (MIT) · OAuth 2.1 PKCE · Streamable HTTP &amp; stdio</span>
          </div>

          <h1 class="hero-title">
            ${de ? "Agentic Shopping &amp; Cart MCP" : "Agentic Shopping &amp; Cart MCP"}<br>
            <span class="title-accent">${de ? "für Shopify-Shops" : "for Shopify Stores"}</span>
          </h1>

          <p class="hero-lead">${
            de
              ? "Lass Claude, ChatGPT, Claude Code oder Cursor Produkte in beliebigen Shopify-Shops suchen, echte Varianten &amp; Preise prüfen und verifizierte Warenkorb-Links erstellen — WAF-resilient und geschützt gegen SSRF &amp; Prompt-Injection."
              : "Let Claude, ChatGPT, Claude Code, or Cursor search any Shopify storefront, inspect live variants &amp; prices, and generate verified cart links — WAF-resilient with DNS-pinned SSRF &amp; prompt-injection guards."
          }</p>

          <div class="endpoint-box">
            <span class="endpoint-proto">MCP URL</span>
            <div class="endpoint-url" id="mcp-url">${escapeHtml(mcpUrl)}</div>
            <button
              type="button"
              class="btn-primary"
              id="copy-btn"
              data-copy-target="mcp-url"
              data-copied-label="${de ? "Kopiert ✓" : "Copied ✓"}"
              data-prompt-label="${de ? "MCP-URL kopieren:" : "Copy MCP URL:"}"
            >${de ? "MCP-URL kopieren" : "Copy MCP URL"}</button>
          </div>

          <div class="hero-actions">
            <a class="btn-primary" href="/billing?lang=${lang}">${
              promoActive
                ? de
                  ? "Pro gratis bis 06.12. sichern"
                  : "Claim free Pro until Dec 6"
                : de
                  ? "Kostenloses Konto starten"
                  : "Start free account"
            }</a>
            <a class="btn-secondary" href="#demo">${de ? "Live-Demo ansehen" : "Watch live demo"}</a>
            <a class="btn-secondary" href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub · MIT</a>
          </div>

          <div class="spec-strip">
            <span class="spec-item"><span class="spec-check" aria-hidden="true">✓</span> ${
              de ? "4 Read-Only Tools" : "4 read-only tools"
            }</span>
            <span class="spec-item"><span class="spec-check" aria-hidden="true">✓</span> OAuth 2.1 (CIMD &amp; DCR)</span>
            <span class="spec-item"><span class="spec-check" aria-hidden="true">✓</span> ${
              de ? "DNS-gepinnter SSRF-Schutz" : "DNS-pinned SSRF guard"
            }</span>
            <span class="spec-item"><span class="spec-check" aria-hidden="true">✓</span> EU Cloud Run (europe-west1)</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Demo Video / Interactive Live Simulation Showcase -->
  <section id="demo" class="demo-section">
    <div class="wrap">
      <div class="section-head">
        <div>
          <span class="section-kicker">${
            hasExternalVideo
              ? de
                ? "PRODUKTVIDEO"
                : "PRODUCT VIDEO"
              : de
                ? "INTERAKTIVE LIVE-SIMULATION"
                : "INTERACTIVE LIVE SIMULATION"
          }</span>
          <h2 class="section-title">${
            de
              ? "Vom Chat-Prompt zum fertigen Warenkorb in Sekunden"
              : "From chat prompt to verified checkout cart in seconds"
          }</h2>
          <p class="section-sub">${
            de
              ? "Sieh live, wie dein KI-Assistent Store, Produkte, Varianten und den deterministischen Warenkorb-Permalink per MCP-Protokoll abruft."
              : "Watch how your AI assistant inspects a storefront, searches products, verifies live variants, and generates a deterministic cart link over MCP."
          }</p>
        </div>
      </div>

      <div class="demo-stage-wrap">
        <div class="demo-glow" aria-hidden="true"></div>
        <div
          class="demo-shell"
          id="demo-shell"
          data-aspect="${defaultAspect}"
          data-has-video="${String(hasExternalVideo)}"
        >
          <div class="demo-chrome">
            <div class="chrome-left">
              <div class="window-dots" aria-hidden="true"><span></span><span></span><span></span></div>
              <div class="chrome-address">
                <span>claude.ai</span>
                <span aria-hidden="true">·</span>
                <span>shopcart-mcp</span>
              </div>
              <span class="live-tag">${
                hasExternalVideo ? "VIDEO" : de ? "LIVE TRACE" : "LIVE TRACE"
              }</span>
            </div>

            <div class="aspect-toggle" role="group" aria-label="${
              de ? "Video-Seitenverhältnis" : "Video aspect ratio"
            }">
              <button
                type="button"
                class="aspect-btn"
                data-set-aspect="16:9"
                aria-pressed="${String(defaultAspect === "16:9")}"
              >16:9 ${de ? "Desktop" : "Desktop"}</button>
              <button
                type="button"
                class="aspect-btn"
                data-set-aspect="9:16"
                aria-pressed="${String(defaultAspect === "9:16")}"
              >9:16 Reel / TikTok</button>
            </div>
          </div>

          <div class="demo-viewport">
            ${demoViewportHtml}
          </div>

          ${demoControlsHtml}
        </div>
      </div>
    </div>
  </section>

  <!-- Client Setup Tabs -->
  <section id="setup" class="section">
    <div class="wrap">
      <div class="section-head">
        <div>
          <span class="section-kicker">QUICKSTART</span>
          <h2 class="section-title">${
            de ? "In 30 Sekunden mit jedem MCP-Client verbinden" : "Connect any MCP client in 30 seconds"
          }</h2>
          <p class="section-sub">${
            de
              ? "Gehostet mit OAuth 2.1 (CIMD &amp; DCR + PKCE S256) oder lokal per npx komplett ohne Login."
              : "Hosted via OAuth 2.1 (CIMD &amp; DCR + PKCE S256) or locally via npx with zero authentication."
          }</p>
        </div>
      </div>

      <div class="tabs-card" data-tabs-root>
        <div class="tablist" role="tablist" aria-label="${de ? "MCP-Clients" : "MCP clients"}">
          <button type="button" role="tab" id="tab-claude-ai" class="tab-btn" aria-selected="true" tabindex="0">
            <span>Claude.ai</span>
            <span class="tab-tag">OAuth 2.1</span>
          </button>
          <button type="button" role="tab" id="tab-chatgpt" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>ChatGPT</span>
            <span class="tab-tag">Connectors</span>
          </button>
          <button type="button" role="tab" id="tab-claude-code" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>Claude Code</span>
            <span class="tab-tag">CLI</span>
          </button>
          <button type="button" role="tab" id="tab-cursor" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>Cursor</span>
            <span class="tab-tag">mcp.json</span>
          </button>
          <button type="button" role="tab" id="tab-local" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>OpenClaw / Local npx</span>
            <span class="tab-tag">MIT · stdio</span>
          </button>
        </div>

        <div class="tab-panels">
          <div role="tabpanel" aria-labelledby="tab-claude-ai">
            <div class="tab-panel-inner">
              <div>
                <h3>Claude.ai &amp; Claude Desktop</h3>
                <p>${
                  de
                    ? "Direkte Integration als Custom Connector mit automatischer OAuth-2.1-CIMD-Erkennung — kein API-Key nötig."
                    : "Direct Custom Connector setup with automatic OAuth 2.1 CIMD discovery — no manual API keys."
                }</p>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de
                      ? "Öffne <strong>Settings → Connectors → Add custom connector</strong>."
                      : "Open <strong>Settings → Connectors → Add custom connector</strong>."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "Füge die Remote-MCP-URL rechts ein und speichere."
                      : "Paste the remote MCP URL on the right and save."
                  }</span></li>
                  <li><span class="step-badge">3</span><span>${
                    de
                      ? "Im Browser-Popup anmelden oder kostenloses Konto anlegen — fertig!"
                      : "Sign in or create a free account in the OAuth popup — ready to shop!"
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>Remote Streamable HTTP Endpoint</span>
                  <button
                    type="button"
                    class="copy-mini"
                    data-copy-target="code-claude-ai"
                    data-copied-label="${de ? "Kopiert ✓" : "Copied ✓"}"
                  >${de ? "Kopieren" : "Copy"}</button>
                </div>
                <pre><code id="code-claude-ai">${escapeHtml(mcpUrl)}</code></pre>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-chatgpt" hidden="until-found">
            <div class="tab-panel-inner">
              <div>
                <h3>ChatGPT Custom Connectors</h3>
                <p>${
                  de
                    ? "Kompatibel mit ChatGPT Developer Mode &amp; Custom MCP Connectors inkl. RFC 9728 Discovery."
                    : "Compatible with ChatGPT Developer Mode &amp; Custom MCP Connectors including RFC 9728 discovery."
                }</p>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de
                      ? "Öffne <strong>Settings → Connectors → Create</strong> und wähle <strong>MCP Server</strong>."
                      : "Open <strong>Settings → Connectors → Create</strong> and select <strong>MCP Server</strong>."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "Trage die Endpoint-URL rechts ein und wähle <strong>OAuth</strong> als Authentifizierung."
                      : "Enter the endpoint URL on the right and choose <strong>OAuth</strong> authentication."
                  }</span></li>
                  <li><span class="step-badge">3</span><span>${
                    de
                      ? "Autorisiere den Zugriff per PKCE S256 und starte deinen ersten Shopping-Prompt."
                      : "Authorize via PKCE S256 and run your first shopping prompt."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>ChatGPT MCP Server URL</span>
                  <button
                    type="button"
                    class="copy-mini"
                    data-copy-target="code-chatgpt"
                    data-copied-label="${de ? "Kopiert ✓" : "Copied ✓"}"
                  >${de ? "Kopieren" : "Copy"}</button>
                </div>
                <pre><code id="code-chatgpt">${escapeHtml(mcpUrl)}</code></pre>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-claude-code" hidden="until-found">
            <div class="tab-panel-inner">
              <div>
                <h3>Claude Code CLI</h3>
                <p>${
                  de
                    ? "Ein einziger Terminal-Befehl registriert den Streamable-HTTP-Server mit automatischem Loopback-OAuth."
                    : "A single CLI command registers the Streamable HTTP server with automatic loopback OAuth."
                }</p>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de
                      ? "Führe den Befehl rechts im Terminal aus."
                      : "Run the command on the right in your terminal."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "Starte <code>claude</code> und bestätige den OAuth-Login einmalig über <code>/mcp</code>."
                      : "Start <code>claude</code> and confirm the one-time OAuth sign-in via <code>/mcp</code>."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>Terminal (zsh / bash)</span>
                  <button
                    type="button"
                    class="copy-mini"
                    data-copy-target="code-claude-code"
                    data-copied-label="${de ? "Kopiert ✓" : "Copied ✓"}"
                  >${de ? "Kopieren" : "Copy"}</button>
                </div>
                <pre><code id="code-claude-code">${escapeHtml(claudeCodeCmd)}</code></pre>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-cursor" hidden="until-found">
            <div class="tab-panel-inner">
              <div>
                <h3>Cursor &amp; VS Code</h3>
                <p>${
                  de
                    ? "Nutzt RFC 8252 Dynamic Loopback OAuth (DCR) oder alternativ die lokale stdio-CLI."
                    : "Uses RFC 8252 dynamic loopback OAuth (DCR) or optionally the local stdio CLI."
                }</p>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de
                      ? "Öffne <code>.cursor/mcp.json</code> in deinem Projekt oder global unter <code>~/.cursor/mcp.json</code>."
                      : "Open <code>.cursor/mcp.json</code> in your project or globally at <code>~/.cursor/mcp.json</code>."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "Füge die Konfiguration rechts ein und klicke in Cursor auf <strong>Connect</strong>."
                      : "Paste the config on the right and click <strong>Connect</strong> in Cursor."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>.cursor/mcp.json</span>
                  <button
                    type="button"
                    class="copy-mini"
                    data-copy-target="code-cursor"
                    data-copied-label="${de ? "Kopiert ✓" : "Copied ✓"}"
                  >${de ? "Kopieren" : "Copy"}</button>
                </div>
                <pre><code id="code-cursor">${escapeHtml(cursorSnippet)}</code></pre>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-local" hidden="until-found">
            <div class="tab-panel-inner">
              <div>
                <h3>OpenClaw / Local npx (MIT)</h3>
                <p>${
                  de
                    ? "100 % lokal via <code>stdio</code> — unbegrenzte Calls, kein Konto, keine Telemetrie, direkt per <code>npx</code>."
                    : "100% local via <code>stdio</code> — unlimited calls, zero auth, zero telemetry, directly via <code>npx</code>."
                }</p>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de
                      ? "Direktstart im Terminal: <code>npx -y shopcart-mcp</code> (Node.js ≥ 22)."
                      : "Instant terminal launch: <code>npx -y shopcart-mcp</code> (Node.js ≥ 22)."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "Oder trage den JSON-Block rechts in OpenClaw, Claude Desktop oder jeden stdio-MCP-Host ein."
                      : "Or paste the JSON block on the right into OpenClaw, Claude Desktop, or any stdio MCP host."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>mcp-servers.json (stdio)</span>
                  <button
                    type="button"
                    class="copy-mini"
                    data-copy-target="code-local"
                    data-copied-label="${de ? "Kopiert ✓" : "Copied ✓"}"
                  >${de ? "Kopieren" : "Copy"}</button>
                </div>
                <pre><code id="code-local">${escapeHtml(localSnippet)}</code></pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- 4 Focused Shopping Tools -->
  <section id="tools" class="section">
    <div class="wrap">
      <div class="section-head">
        <div>
          <span class="section-kicker">MCP TOOLKIT</span>
          <h2 class="section-title">${
            de ? "4 präzise, read-only Shopping-Tools" : "4 focused, read-only shopping tools"
          }</h2>
          <p class="section-sub">${
            de
              ? "Gebaut für echte E-Commerce-Zuverlässigkeit: währungsgenaue Preise, WAF-Resilienz, DNS-gepinnter SSRF-Schutz und HTML-/Unicode-Sanitizing."
              : "Built for real-world e-commerce reliability: exact minor-unit currency math, WAF resilience, DNS-pinned SSRF protection, and HTML/Unicode sanitizing."
          }</p>
        </div>
      </div>

      <div class="grid-2">
        <article class="card card-rail card-rail-cyan">
          <div class="tool-head">
            <span class="tool-tag">inspect_store</span>
            <span class="tool-badge">readOnlyHint</span>
          </div>
          <h3>${de ? "Shop, Währung & WAF erkennen" : "Detect store, currency & WAF"}</h3>
          <p>${
            de
              ? "Verifiziert Shopify-Kompatibilität, Shop-Währung, Zielland, WAF-Verhalten und optionale native Storefront-MCP-Fähigkeiten."
              : "Verifies Shopify compatibility, storefront currency, country, WAF behavior, and optional native Storefront MCP capabilities."
          }</p>
          <div class="tool-sig">inspect_store({ store_url }) → { platform, currency, country }</div>
        </article>

        <article class="card card-rail card-rail-blue">
          <div class="tool-head">
            <span class="tool-tag">search_products</span>
            <span class="tool-badge">WAF-resilient</span>
          </div>
          <h3>${de ? "Schnelle, strukturierte Produktsuche" : "Fast, structured product search"}</h3>
          <p>${
            de
              ? "Nutzt primär <code>/search/suggest.json</code> mit Preis- &amp; Verfügbarkeitsfiltern und sauber normalisierten Beträgen."
              : "Queries <code>/search/suggest.json</code> first with price &amp; stock filters and cleanly normalized amounts."
          }</p>
          <div class="tool-sig">search_products({ query, max_price, available_only }) → Product[]</div>
        </article>

        <article class="card card-rail card-rail-violet">
          <div class="tool-head">
            <span class="tool-tag">get_product</span>
            <span class="tool-badge">Prompt-Safe</span>
          </div>
          <h3>${de ? "Varianten, Optionen & Live-Bestand" : "Variants, options & live stock"}</h3>
          <p>${
            de
              ? "Liest <code>/products/&lt;handle&gt;.js</code>, konvertiert Minor-Units exakt pro Währung und entfernt verstecktes Unicode &amp; HTML."
              : "Fetches <code>/products/&lt;handle&gt;.js</code>, converts minor units accurately per currency, and strips hidden Unicode &amp; HTML."
          }</p>
          <div class="tool-sig">get_product({ handle }) → { variants[], options[], in_stock }</div>
        </article>

        <article class="card card-rail card-rail-emerald">
          <div class="tool-head">
            <span class="tool-tag">create_cart_link</span>
            <span class="tool-badge">Deterministic</span>
          </div>
          <h3>${de ? "Verifizierter Warenkorb-Permalink" : "Verified cart permalink"}</h3>
          <p>${
            de
              ? "Erzeugt prüfbare <code>/cart/&lt;id&gt;:&lt;qty&gt;?storefront=true</code> Links inkl. optionaler Live-Variantenprüfung — niemals automatische Käufe."
              : "Builds verifiable <code>/cart/&lt;id&gt;:&lt;qty&gt;?storefront=true</code> links with optional live variant verification — never auto-purchases."
          }</p>
          <div class="tool-sig">create_cart_link({ items }) → 302 /cart/37548706496709:2?storefront=true</div>
        </article>
      </div>
    </div>
  </section>

  <!-- Pricing -->
  <section id="pricing" class="section">
    <div class="wrap">
      <div class="section-head">
        <div>
          <span class="section-kicker">${de ? "PREISE" : "PRICING"}</span>
          <h2 class="section-title">${
            de ? "Open Source im Kern. Gehostet in 30 Sekunden." : "Open source at heart. Hosted in 30 seconds."
          }</h2>
          <p class="section-sub">${
            de
              ? "Lokal immer kostenlos unter MIT-Lizenz. Oder als sofort einsatzbereiter OAuth-2.1-Endpoint in der EU."
              : "Always free locally under the MIT license. Or ready-to-use as a hosted OAuth 2.1 endpoint in the EU."
          }</p>
        </div>
      </div>

      <div class="grid-3">
        <article class="card">
          <h3>OSS MIT (Local / Self-Host)</h3>
          <div class="price-row">
            <div class="price">0 € <span>/ ${de ? "immer" : "forever"}</span></div>
          </div>
          <ul class="feat-list">
            <li>${de ? "Unbegrenzte lokale stdio Tool-Calls" : "Unlimited local stdio tool calls"}</li>
            <li>${de ? "Kein Login, keine Telemetrie" : "Zero auth, zero telemetry"}</li>
            <li>${de ? "MIT-Lizenz · Docker-ready" : "MIT license · Docker-ready"}</li>
          </ul>
          <a class="btn-secondary w-full" href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener noreferrer">${
            de ? "Auf GitHub ansehen" : "View on GitHub"
          }</a>
        </article>

        <article class="card">
          <h3>Hosted Free</h3>
          <div class="price-row">
            <div class="price">0 € <span>/ ${de ? "Monat" : "month"}</span></div>
          </div>
          <ul class="feat-list">
            <li>${de ? `${config.freeDailyLimit} Tool-Calls / Tag` : `${config.freeDailyLimit} tool calls / day`}</li>
            <li>${de ? "OAuth 2.1 für Claude.ai &amp; ChatGPT" : "OAuth 2.1 for Claude.ai &amp; ChatGPT"}</li>
            <li>${de ? "Sofort startklar ohne Kreditkarte" : "Instant start, no credit card"}</li>
          </ul>
          <a class="btn-secondary w-full" href="/billing?lang=${lang}">${
            de ? "Kostenlos starten" : "Start free"
          }</a>
        </article>

        <article class="card card-featured">
          ${
            promoActive
              ? `<div class="pill-promo">★ ${
                  de ? "0 € bis 06.12.2026 · Code BLACKFRIDAY" : "€0 until Dec 6, 2026 · Code BLACKFRIDAY"
                }</div>`
              : ""
          }
          <h3>Hosted Pro</h3>
          <div class="price-row">
            ${promoActive ? `<span class="price-old">9 €</span>` : ""}
            <div class="price">${promoActive ? "0 €" : "9 €"} <span>/ ${
              promoActive
                ? de
                  ? "bis 06.12."
                  : "until Dec 6"
                : de
                  ? "Monat"
                  : "month"
            }</span></div>
          </div>
          ${
            promoActive
              ? `<p class="price-note">${
                  de
                    ? "Danach 9 €/Monat · jederzeit im Stripe-Portal kündbar"
                    : "Then €9/month · cancel anytime in Stripe Portal"
                }</p>`
              : ""
          }
          <ul class="feat-list">
            <li>${de ? `${config.proDailyLimit} Tool-Calls / Tag` : `${config.proDailyLimit} tool calls / day`}</li>
            <li>${
              promoActive
                ? de
                  ? "Black-Friday-Launch: Volles Pro-Kontingent sofort gratis aktiv"
                  : "Black Friday Launch: Full Pro quota active free immediately"
                : de
                  ? "Monatlich kündbar im Stripe-Portal"
                  : "Cancel anytime via Stripe Portal"
            }</li>
            <li>${de ? "EU Cloud Run Infrastruktur (europe-west1)" : "EU Cloud Run infrastructure (europe-west1)"}</li>
          </ul>
          <a class="btn-primary w-full" href="/billing?lang=${lang}">${
            promoActive
              ? de
                ? "Pro jetzt kostenlos sichern"
                : "Claim free Pro access"
              : de
                ? "Auf Pro upgraden"
                : "Upgrade to Pro"
          }</a>
        </article>
      </div>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="foot-row">
      <div class="foot-brand"><strong>shopcart-mcp</strong> · by <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">Wals.pro</a></div>
      <div class="foot-links">
        <a href="/billing?lang=${lang}">${de ? "Konto &amp; Billing" : "Account &amp; Billing"}</a>
        <a href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy"}</a>
        <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a>
        <a href="/.well-known/security.txt">security.txt</a>
        <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener noreferrer">${
          de ? "Impressum" : "Legal Notice"
        }</a>
      </div>
    </div>
    <p class="disclaimer">${
      de
        ? "Unabhängiges Community-Tool für Shopify-Shops — nicht verbunden mit oder unterstützt von Shopify Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern."
        : "Independent community tool for Shopify stores — not affiliated with or endorsed by Shopify Inc. All trademarks belong to their respective owners."
    }</p>
  </div>
</footer>
</body>
</html>`;
}
