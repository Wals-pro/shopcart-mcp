import type { AppConfig } from "../config.js";
import { escapeHtml, type Lang } from "../auth/pages.js";
import { isPromoFreeProActive } from "../billing/quota.js";
import { renderFaviconHeadLinks, renderShopCartWordmark, renderSparkCartSvg } from "./brand.js";
import {
  AI_LINK_BASES,
  CONNECT_SETTINGS_URLS,
  EXAMPLE_PRICES_VERIFIED_DE,
  EXAMPLE_PRICES_VERIFIED_EN,
  buildAiLinks,
  buildInstallLinks,
  buildJsonLd,
  buildStartPrompt,
  defaultPromptTail,
  formatPromoEnd,
  getFaq,
  getHowTo,
  getUseCases,
  getWishes,
  serializeJsonLd,
  startPromptHead,
  taskTail
} from "./content.js";
import {
  getComfortFeatures,
  getMatrixHeaders,
  getPlatformRows,
  getTrademarkDisclaimer,
  PLATFORM_NAMES
} from "./platforms.js";

const GCS_HERO_VIDEO_BASE = "https://storage.googleapis.com/walspro-shopcart-media/videos";

export const HERO_VIDEO_ASSETS = {
  de: {
    legacySrc: `${GCS_HERO_VIDEO_BASE}/01-snocks-hero-16x9-de.mp4`,
    src: `${GCS_HERO_VIDEO_BASE}/01-snocks-hero-16x9-de-v2.mp4`,
    poster: `${GCS_HERO_VIDEO_BASE}/01-snocks-hero-16x9-de-poster.jpg`,
    width: 1920,
    height: 1080
  },
  en: {
    legacySrc: `${GCS_HERO_VIDEO_BASE}/04-allbirds-hero-16x9-en.mp4`,
    src: `${GCS_HERO_VIDEO_BASE}/04-allbirds-hero-16x9-en-v2.mp4`,
    poster: `${GCS_HERO_VIDEO_BASE}/04-allbirds-hero-16x9-en-poster.jpg`,
    width: 1920,
    height: 1080
  }
} as const;

export type ResolvedDemoMedia =
  | { kind: "simulation" }
  | {
      kind: "video";
      src: string;
      poster?: string;
      width?: number;
      height?: number;
      mimeType?: string;
      defaultAspect: "16:9" | "9:16";
    }
  | { kind: "iframe"; src: string; title: string; defaultAspect: "16:9" | "9:16" };

function matchHostedHeroAsset(rawUrl: string) {
  const cleanUrl = rawUrl.split(/[?#]/)[0] ?? "";
  for (const asset of Object.values(HERO_VIDEO_ASSETS)) {
    if (cleanUrl === asset.legacySrc || cleanUrl === asset.src) {
      return asset;
    }
  }
  return undefined;
}

export function resolveDemoMedia(config: AppConfig, lang: Lang): ResolvedDemoMedia {
  const rawUrl =
    (lang === "de" ? config.demoVideoUrlDe : config.demoVideoUrlEn) ?? config.demoVideoUrl;
  if (!rawUrl) return { kind: "simulation" };

  // Direct self-hosted or external video file (.mp4 / .webm / .mov)
  const cleanPath = rawUrl.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (cleanPath.endsWith(".mp4") || cleanPath.endsWith(".webm") || cleanPath.endsWith(".mov")) {
    const explicitPoster =
      (lang === "de" ? config.demoVideoPosterDe : config.demoVideoPosterEn) ??
      config.demoVideoPoster;
    const hostedAsset = matchHostedHeroAsset(rawUrl);
    const cleanUrl = rawUrl.split(/[?#]/)[0] ?? "";
    const resolvedSrc =
      hostedAsset && cleanUrl === hostedAsset.legacySrc ? hostedAsset.src : rawUrl;
    const resolvedPoster = explicitPoster ?? hostedAsset?.poster;
    const mimeType = cleanPath.endsWith(".mp4")
      ? "video/mp4"
      : cleanPath.endsWith(".webm")
        ? "video/webm"
        : "video/quicktime";

    return {
      kind: "video",
      src: resolvedSrc,
      ...(resolvedPoster ? { poster: resolvedPoster } : {}),
      ...(hostedAsset ? { width: hostedAsset.width, height: hostedAsset.height } : {}),
      mimeType,
      defaultAspect: "16:9"
    };
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


// ---------------------------------------------------------------------------
// Consumer-friendly live shopping simulation (fallback when no demo video is set)
// ---------------------------------------------------------------------------

export interface SimScenario {
  id: string;
  tab: string;
  user: string;
  steps: Array<{ label: string; meta: string }>;
  answer: string;
  shop: string;
  items: Array<{ qty: string; name: string; variant: string; price: string }>;
  total: string;
  cartUrl: string;
  cta: string;
}

/**
 * Real example carts. Every cartUrl below was opened live in a browser and resolves to a filled
 * merchant cart (see EXAMPLE_PRICES_VERIFIED_*). Never add generated domains or guessed variant IDs.
 */
export function getSimScenarios(lang: Lang): SimScenario[] {
  const de = lang === "de";

  const snocks: SimScenario = {
    id: "snocks",
    tab: "SNOCKS",
    user: de
      ? "Ich brauche Sneaker-Socken von SNOCKS in 43–46: 2× weiß und 1× schwarz."
      : "I need SNOCKS sneaker socks in size 43–46: 2× white and 1× black.",
    steps: de
      ? [
          { label: "Shop gefunden", meta: "snocks.com · Preise in €" },
          { label: "Sortiment durchsucht", meta: "Sneaker Socken in Weiß & Schwarz" },
          { label: "Größe & Preis geprüft", meta: "43–46 verfügbar · je 22,49 €" },
          { label: "Warenkorb-Link gebaut", meta: "3 Artikel · geprüft" }
        ]
      : [
          { label: "Store found", meta: "snocks.com · prices in €" },
          { label: "Catalog searched", meta: "Sneaker socks in white & black" },
          { label: "Size & price checked", meta: "43–46 in stock · €22.49 each" },
          { label: "Cart link built", meta: "3 items · verified" }
        ],
    answer: de
      ? "Fertig! Drei Sets in 43–46 liegen in deinem Warenkorb. Schau kurz drüber und bezahl direkt bei SNOCKS."
      : "Done! Three packs in 43–46 are in your cart. Take a quick look and pay directly at SNOCKS.",
    shop: "SNOCKS · snocks.com",
    items: [
      {
        qty: "2×",
        name: "Sneaker Socken | White",
        variant: de ? "43–46 · 6 Paar" : "43–46 · 6 pairs",
        price: de ? "44,98 €" : "€44.98"
      },
      {
        qty: "1×",
        name: "Sneaker Socken | Black",
        variant: de ? "43–46 · 6 Paar" : "43–46 · 6 pairs",
        price: de ? "22,49 €" : "€22.49"
      }
    ],
    total: de ? "67,47 €" : "€67.47",
    cartUrl: "https://snocks.com/cart/44434567725323:2,19729211981894:1?storefront=true",
    cta: de ? "Beispiel-Warenkorb bei SNOCKS öffnen" : "Open example cart at SNOCKS"
  };

  const kernenergie: SimScenario = {
    id: "kernenergie",
    tab: "KERNenergie",
    user: de
      ? "Ich suche bei KERNenergie zwei kleine Weihnachtsgeschenke, zusammen unter 40 €."
      : "I'm looking for two small Christmas gifts at KERNenergie, under €40 in total.",
    steps: de
      ? [
          { label: "Shop gefunden", meta: "kern-energie.com · Preise in €" },
          { label: "Sortiment durchsucht", meta: "Weihnachtsgeschenke unter 40 €" },
          { label: "Preis & Verfügbarkeit geprüft", meta: "24,95 € + 12,95 € · lieferbar" },
          { label: "Warenkorb-Link gebaut", meta: "2 Artikel · geprüft" }
        ]
      : [
          { label: "Store found", meta: "kern-energie.com · prices in €" },
          { label: "Catalog searched", meta: "Christmas gifts under €40" },
          { label: "Price & stock checked", meta: "€24.95 + €12.95 · in stock" },
          { label: "Cart link built", meta: "2 items · verified" }
        ],
    answer: de
      ? "Beide Geschenke sind lieferbar und bleiben zusammen unter 40 €. Dein Warenkorb ist bereit."
      : "Both gifts are in stock and stay under €40 together. Your cart is ready.",
    shop: "KERNenergie · kern-energie.com",
    items: [
      {
        qty: "1×",
        name: "Weihnachtsgeschenk MandelgeNUSS",
        variant: de ? "Schokolierte & gebrannte Mandeln" : "Chocolate-coated & roasted almonds",
        price: de ? "24,95 €" : "€24.95"
      },
      {
        qty: "1×",
        name: "Mini Weihnachtsgeschenk",
        variant: de ? "Nussmischung & gebrannte Nüsse" : "Nut mix & roasted nuts",
        price: de ? "12,95 €" : "€12.95"
      }
    ],
    total: de ? "37,90 €" : "€37.90",
    cartUrl: "https://kern-energie.com/cart/49277053370627:1,49277057696003:1?storefront=true",
    cta: de ? "Beispiel-Warenkorb bei KERNenergie öffnen" : "Open example cart at KERNenergie"
  };

  if (!de) {
    const allbirds: SimScenario = {
      id: "allbirds",
      tab: "Allbirds",
      user: "I'd like the Allbirds Men's Wool Runner NZ in dark grey, size 10.",
      steps: [
        { label: "Store found", meta: "allbirds.com · prices in $" },
        { label: "Catalog searched", meta: "Men's Wool Runner NZ" },
        { label: "Size & price checked", meta: "Size 10 in stock · $110.00" },
        { label: "Cart link built", meta: "1 item · verified" }
      ],
      answer:
        "Done! The Wool Runner NZ in dark grey, size 10, is in your cart. Take a quick look and pay directly at Allbirds.",
      shop: "Allbirds · allbirds.com",
      items: [
        {
          qty: "1×",
          name: "Men's Wool Runner NZ",
          variant: "Dark Grey (Light Grey Sole) · Size 10",
          price: "$110.00"
        }
      ],
      total: "$110.00",
      cartUrl: "https://www.allbirds.com/cart/41243558707280:1?storefront=true",
      cta: "Open example cart at Allbirds"
    };
    return [allbirds, snocks, kernenergie];
  }

  const purelei: SimScenario = {
    id: "purelei",
    tab: "PURELEI",
    user: "Ich möchte bei PURELEI den Adventskalender in Gold und dazu die Bold Charm Kette in Gold.",
    steps: [
      { label: "Shop gefunden", meta: "purelei.com · Preise in €" },
      { label: "Sortiment durchsucht", meta: "Adventskalender & Ketten" },
      { label: "Variante & Preis geprüft", meta: "Gold · 139,90 € + 27,93 €" },
      { label: "Warenkorb-Link gebaut", meta: "2 Artikel · geprüft" }
    ],
    answer:
      "Adventskalender und Kette liegen in Gold in deinem Warenkorb. Prüf alles in Ruhe und bezahl direkt bei PURELEI.",
    shop: "PURELEI · purelei.com",
    items: [
      { qty: "1×", name: "PURELEI Adventskalender", variant: "Gold", price: "139,90 €" },
      { qty: "1×", name: "Bold Charm Kette", variant: "Gold", price: "27,93 €" }
    ],
    total: "167,83 €",
    cartUrl: "https://purelei.com/cart/57560981766409:1,55956947566857:1?storefront=true",
    cta: "Beispiel-Warenkorb bei PURELEI öffnen"
  };

  return [snocks, kernenergie, purelei];
}

/** Shopping moments that drift along the hero wave (rendered on canvas by hero-flow.js). */
function getHeroChips(lang: Lang): Array<{ t: string; k: "item" | "price" | "ready" | "link" }> {
  return lang === "de"
    ? [
        { t: "2× SNOCKS Gr. 43–46", k: "item" },
        { t: "Sneaker Socken · 22,49 €", k: "price" },
        { t: "Größe verfügbar ✓", k: "ready" },
        { t: "KERNenergie Geschenkset · 24,95 €", k: "price" },
        { t: "Geschenk unter 50 €", k: "item" },
        { t: "Warenkorb bereit ✓", k: "ready" },
        { t: "PURELEI Kette · Gold", k: "item" },
        { t: "Checkout-Link", k: "link" },
        { t: "Black-Friday-Preis geprüft ✓", k: "ready" }
      ]
    : [
        { t: "2× SNOCKS size 43–46", k: "item" },
        { t: "SNOCKS bundle · €67.47", k: "price" },
        { t: "Size in stock ✓", k: "ready" },
        { t: "Allbirds Wool Runner · size 10", k: "item" },
        { t: "Holiday gift under $50", k: "item" },
        { t: "Cart ready ✓", k: "ready" },
        { t: "Wool Runner NZ · $110.00", k: "price" },
        { t: "Checkout link", k: "link" },
        { t: "Black Friday price checked ✓", k: "ready" }
      ];
}

function renderLauncher(config: AppConfig, lang: Lang, slot: "hero" | "demo"): string {
  const de = lang === "de";
  const mcpUrl = `${config.appOrigin}/mcp`;
  const head = startPromptHead(config, lang);
  const defaultTail = defaultPromptTail(lang);
  const prompt = buildStartPrompt(config, lang);
  const links = buildAiLinks(prompt);
  const wishes = getWishes(lang);
  const copied = de ? "Kopiert ✓" : "Copied ✓";

  const connectHintClaude = de
    ? "Link kopiert ✓ – einfach in Claude einfügen & verbinden."
    : "Link copied ✓ – just paste it into Claude and connect.";
  const connectHintChatgpt = de
    ? "Link kopiert ✓ – in ChatGPT: Einstellungen → Connectors → eigenen Connector hinzufügen (Plus/Pro)."
    : "Link copied ✓ – in ChatGPT: Settings → Connectors → add a custom connector (Plus/Pro).";
  const connectHintGemini = de
    ? "Link kopiert ✓ – in Google Gemini: Einstellungen → Verbundene Apps → Eigene Apps → App hinzufügen (persönliches Google-Konto & Aktivitäten speichern aktiv)."
    : "Link copied ✓ – in Google Gemini: Settings → Connected Apps → Custom apps → Add a custom app (personal Google account & Keep Activity enabled).";
  const connectHintFailed = de
    ? "Kopieren hat nicht geklappt – bitte den Link unten manuell kopieren."
    : "Copying didn't work – please copy the link below manually.";

  return `<div
    class="launcher launcher-${slot}"
    ${slot === "hero" ? 'id="start"' : ""}
    data-launcher
    data-prompt-head="${escapeHtml(head)}"
    data-default-tail="${escapeHtml(defaultTail)}"
  >
    <div class="launcher-head">
      <span class="launcher-title">${de ? "Lass meine KI das einrichten" : "Let my AI set this up for me"}</span>
      <span class="launcher-hint">${de ? "2 Klicks, null Technik." : "2 clicks, zero tech."}</span>
    </div>

    <div class="launch-step">
      <div class="launch-step-head">
        <span class="launch-step-num" aria-hidden="true">1</span>
        <span class="launch-step-title">${de ? "Einmalig verbinden" : "Connect once"}</span>
      </div>
      <div class="launch-grid launch-grid-3">
        <a class="btn-launch btn-launch-primary" data-connect="claude" data-connect-url="${escapeHtml(mcpUrl)}" data-connect-hint="${escapeHtml(connectHintClaude)}" data-connect-failed="${escapeHtml(connectHintFailed)}" href="${CONNECT_SETTINGS_URLS.claude}" target="_blank" rel="noopener">
          <span>${de ? "Mit Claude verbinden" : "Connect to Claude"}</span><span class="btn-arrow" aria-hidden="true">↗</span>
        </a>
        <a class="btn-launch btn-launch-primary" data-connect="chatgpt" data-connect-url="${escapeHtml(mcpUrl)}" data-connect-hint="${escapeHtml(connectHintChatgpt)}" data-connect-failed="${escapeHtml(connectHintFailed)}" href="${CONNECT_SETTINGS_URLS.chatgpt}" target="_blank" rel="noopener">
          <span>${de ? "Mit ChatGPT verbinden" : "Connect to ChatGPT"}</span><span class="btn-arrow" aria-hidden="true">↗</span>
        </a>
        <a class="btn-launch btn-launch-primary" data-connect="gemini" data-connect-url="${escapeHtml(mcpUrl)}" data-connect-hint="${escapeHtml(connectHintGemini)}" data-connect-failed="${escapeHtml(connectHintFailed)}" href="${CONNECT_SETTINGS_URLS.gemini}" target="_blank" rel="noopener">
          <span>${de ? "Mit Gemini verbinden" : "Connect to Gemini"}</span><span class="btn-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
      <p class="connect-status" data-connect-status role="status" aria-live="polite">${
        de
          ? "Kopiert deinen ShopCart-Link und öffnet die Connector-Einstellungen: einfügen, fertig."
          : "Copies your ShopCart link and opens the connector settings: paste it, done."
      }</p>
      <div class="url-copy">
        <span class="url-copy-label">${de ? "Dein Link:" : "Your link:"}</span>
        <code class="url-copy-value" id="mcp-url-${slot}">${escapeHtml(mcpUrl)}</code>
        <button type="button" class="copy-mini" data-copy-target="mcp-url-${slot}" data-copied-label="${copied}">${
          de ? "URL kopieren" : "Copy URL"
        }</button>
        <a class="desktop-link" href="/downloads/shopcart-mcp.mcpb" download>${
          de ? "Claude Desktop? 1-Klick-Erweiterung laden" : "Claude Desktop? Get the 1-click extension"
        } <span aria-hidden="true">↓</span></a>
      </div>
    </div>

    <div class="launch-step">
      <div class="launch-step-head">
        <span class="launch-step-num" aria-hidden="true">2</span>
        <span class="launch-step-title">${de ? "Sofort losshoppen" : "Start shopping"}</span>
        <span class="launch-step-note">${de ? "Wunsch antippen ist optional" : "Picking a wish is optional"}</span>
      </div>
      <div class="wish-chips" role="group" aria-label="${de ? "Wunsch auswählen (optional)" : "Pick a wish (optional)"}">
        ${wishes
          .map(
            (w) =>
              `<button type="button" class="wish-chip" data-wish-tail="${escapeHtml(w.tail)}" aria-pressed="false">${escapeHtml(w.label)}</button>`
          )
          .join("\n        ")}
      </div>
      <div class="launch-grid">
        <a class="btn-launch btn-launch-start" data-ai-link="claude" data-ai-base="${AI_LINK_BASES.claude}" href="${escapeHtml(links.claude)}" target="_blank" rel="noopener">
          <span>${de ? "In Claude starten" : "Start in Claude"}</span><span class="btn-arrow" aria-hidden="true">↗</span>
        </a>
        <a class="btn-launch btn-launch-start" data-ai-link="chatgpt" data-ai-base="${AI_LINK_BASES.chatgpt}" href="${escapeHtml(links.chatgpt)}" target="_blank" rel="noopener">
          <span>${de ? "In ChatGPT starten" : "Start in ChatGPT"}</span><span class="btn-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
      <div class="launch-more">
        <a class="btn-launch btn-launch-ghost" data-ai-link="perplexity" data-ai-base="${AI_LINK_BASES.perplexity}" href="${escapeHtml(links.perplexity)}" target="_blank" rel="noopener">
          <span>${de ? "In Perplexity starten" : "Start in Perplexity"}</span><span class="btn-arrow" aria-hidden="true">↗</span>
        </a>
        <button type="button" class="btn-launch btn-launch-ghost" data-copy-prompt data-copied-label="${copied}">
          <span>${de ? "Startprompt für jede andere KI kopieren" : "Copy start prompt for any other AI"}</span>
        </button>
      </div>
      <details class="prompt-peek">
        <summary>${de ? "Startprompt ansehen" : "View start prompt"}</summary>
        <p class="prompt-preview" data-prompt-preview>${escapeHtml(prompt)}</p>
      </details>
    </div>
  </div>`;
}

function renderSimulation(lang: Lang): string {
  const de = lang === "de";
  const scenarios = getSimScenarios(lang);
  const first = scenarios[0]!;
  const verified = de ? EXAMPLE_PRICES_VERIFIED_DE : EXAMPLE_PRICES_VERIFIED_EN;

  return `<div class="media-frame media-frame-sim">
    <div class="sim-player" id="sim-player" data-phase="3" data-sim="${escapeHtml(JSON.stringify(scenarios))}">
      <div class="sim-chat">
        <div class="sim-chat-head">
          <span class="sim-avatar" aria-hidden="true">${de ? "KI" : "AI"}</span>
          <span>${de ? "Dein KI-Assistent · mit ShopCart verbunden" : "Your AI assistant · connected to ShopCart"}</span>
        </div>
        <div class="sim-msg sim-msg-user" id="sim-user">${escapeHtml(first.user)}</div>
        <ol class="sim-steps" id="sim-steps" aria-live="polite">
          ${first.steps
            .map(
              (step) => `<li class="sim-step" data-state="done">
            <span class="sim-step-icon" aria-hidden="true"></span>
            <span class="sim-step-label">${escapeHtml(step.label)}</span>
            <span class="sim-step-meta">${escapeHtml(step.meta)}</span>
          </li>`
            )
            .join("\n          ")}
        </ol>
        <div class="sim-msg sim-msg-ai" id="sim-answer" data-show="true">${escapeHtml(first.answer)}</div>
      </div>

      <aside class="sim-cart" id="sim-cart" data-ready="true" aria-label="${de ? "Beispiel-Warenkorb" : "Example cart"}">
        <div class="sim-cart-head">
          <span class="sim-cart-title">${de ? "Dein Warenkorb" : "Your cart"}</span>
          <span class="sim-cart-shop" id="sim-shop">${escapeHtml(first.shop)}</span>
        </div>
        <ul class="sim-cart-items" id="sim-items">
          ${first.items
            .map(
              (item) => `<li class="sim-cart-item" data-show="true">
            <span class="sim-cart-qty">${escapeHtml(item.qty)}</span>
            <span class="sim-cart-info"><span class="sim-cart-name">${escapeHtml(item.name)}</span><span class="sim-cart-meta">${escapeHtml(item.variant)}</span></span>
            <span class="sim-cart-price">${escapeHtml(item.price)}</span>
          </li>`
            )
            .join("\n          ")}
        </ul>
        <p class="sim-cart-empty">${de ? "Dein Warenkorb füllt sich gleich …" : "Your cart is about to fill up …"}</p>
        <div class="sim-cart-total">
          <span>${de ? "Zwischensumme" : "Subtotal"}</span>
          <strong id="sim-total">${escapeHtml(first.total)}</strong>
        </div>
        <a class="sim-cart-link" id="sim-link" href="${escapeHtml(first.cartUrl)}" target="_blank" rel="noopener noreferrer">
          <span id="sim-link-label">${escapeHtml(first.cta)}</span><span aria-hidden="true">↗</span>
        </a>
        <p class="sim-cart-note">${
          de
            ? `Du prüfst und bezahlst selbst im Shop. Beispielpreise vom ${verified}, Preise und Verfügbarkeit können sich ändern.`
            : `You review and pay in the store yourself. Example prices as of ${verified}; prices and availability may change.`
        }</p>
      </aside>
    </div>
  </div>`;
}

export function renderLandingPage(config: AppConfig, lang: Lang): string {
  const de = lang === "de";
  const origin = config.appOrigin;
  const mcpUrl = `${origin}/mcp`;
  const promoActive = isPromoFreeProActive(config);
  const promoEnd = formatPromoEnd(config, lang);
  const promoEndShort = de ? promoEnd.replace(/\.\d{4}$/, ".") : promoEnd.replace(/,\s*\d{4}$/, "");
  const otherLang = de ? "en" : "de";
  const demoMedia = resolveDemoMedia(config, lang);
  const defaultAspect = demoMedia.kind === "simulation" ? "16:9" : demoMedia.defaultAspect;
  const hasExternalVideo = demoMedia.kind !== "simulation";
  const assetVersion = encodeURIComponent(config.version);
  const pageUrl = `${origin}/?lang=${lang}`;

  const faq = getFaq(config, lang);
  const howTo = getHowTo(lang);
  const useCases = getUseCases(lang);
  const scenarios = getSimScenarios(lang);
  const promptHead = startPromptHead(config, lang);

  const title = de
    ? "ShopCart – KI Shopping Assistent für Claude, ChatGPT & Gemini"
    : "ShopCart – AI Shopping Assistant for Claude, ChatGPT & Gemini";

  const description = de
    ? "Sag Claude, ChatGPT oder Google Gemini, was du suchst: ShopCart findet echte Produkte, Größen und Preise in Online-Shops und liefert einen Warenkorb-Link."
    : "Tell Claude, ChatGPT, or Google Gemini what you need: ShopCart verifies live prices and stock in online stores and returns a ready-to-review cart link.";

  const cursorSnippet = JSON.stringify({ mcpServers: { shopcart: { url: mcpUrl } } }, null, 2);
  const localSnippet = JSON.stringify(
    { mcpServers: { shopcart: { command: "npx", args: ["-y", "shopcart-mcp"] } } },
    null,
    2
  );
  const claudeCodeCmd = `claude mcp add --transport http shopcart ${mcpUrl}`;
  const geminiExtCmd = `gemini extensions install ${config.repoUrl}`;
  const geminiCliCmd = `gemini mcp add --transport http --scope user shopcart ${mcpUrl}`;
  const geminiSettingsSnippet = JSON.stringify(
    {
      mcpServers: {
        shopcart: {
          httpUrl: mcpUrl,
          authProviderType: "dynamic_discovery"
        }
      }
    },
    null,
    2
  );
  const geminiGuidePath = de ? "/guides/gemini-warenkorb-erstellen" : "/guides/gemini-shopping-cart";
  const installLinks = buildInstallLinks(config);
  const copyLabel = de ? "Kopieren" : "Copy";
  const copiedLabel = de ? "Kopiert ✓" : "Copied ✓";

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
            <video controls playsinline autoplay muted loop preload="metadata"${
              demoMedia.width && demoMedia.height
                ? ` width="${demoMedia.width}" height="${demoMedia.height}"`
                : ""
            }${demoMedia.poster ? ` poster="${escapeHtml(demoMedia.poster)}"` : ""}>
              <source src="${escapeHtml(demoMedia.src)}"${
                demoMedia.mimeType ? ` type="${demoMedia.mimeType}"` : ""
              }>
            </video>
          </div>`
        : renderSimulation(lang);

  const demoToggleHtml = hasExternalVideo
    ? `<div class="seg-toggle" role="group" aria-label="${de ? "Video-Seitenverhältnis" : "Video aspect ratio"}">
        <button type="button" class="seg-btn" data-set-aspect="16:9" aria-pressed="${String(defaultAspect === "16:9")}">16:9</button>
        <button type="button" class="seg-btn" data-set-aspect="9:16" aria-pressed="${String(defaultAspect === "9:16")}">9:16</button>
      </div>`
    : `<div class="seg-toggle" role="group" aria-label="${de ? "Beispiel wählen" : "Choose example"}">
        ${scenarios
          .map(
            (sc, idx) =>
              `<button type="button" class="seg-btn" data-sim-scenario="${idx}" aria-pressed="${String(idx === 0)}">${escapeHtml(sc.tab)}</button>`
          )
          .join("\n        ")}
      </div>`;

  const simPhaseLabels = de
    ? ["Wunsch", "Suche", "Prüfung", "Warenkorb"]
    : ["Wish", "Search", "Check", "Cart"];

  const demoControlsHtml = hasExternalVideo
    ? ""
    : `<div class="demo-controls">
        <div class="demo-btn-group">
          <button
            type="button"
            class="sim-ctrl-btn"
            id="sim-play-btn"
            data-pause-label="Pause"
            data-play-label="${de ? "Abspielen" : "Play"}"
          >❚❚ Pause</button>
          <button type="button" class="sim-ctrl-btn" id="sim-replay-btn">↺ ${de ? "Neu starten" : "Replay"}</button>
        </div>
        <div class="sim-timeline" role="group" aria-label="${de ? "Schritte des Beispiels" : "Example steps"}">
          ${simPhaseLabels
            .map(
              (label, idx) => `<button type="button" class="sim-seg-btn" data-sim-phase="${idx}" data-active="${String(idx === 3)}" data-filled="true">
            <span>${idx + 1} · ${label}</span>
            <span class="sim-seg-bar"><span class="sim-seg-fill"></span></span>
          </button>`
            )
            .join("\n          ")}
        </div>
      </div>`;

  const useCasesHtml = useCases
    .map((uc) => {
      const links = buildAiLinks(`${promptHead} ${taskTail(lang, uc.ask)}`);
      return `<article class="card usecase-card">
          <span class="usecase-kicker">${escapeHtml(uc.kicker)}</span>
          <h3>${escapeHtml(uc.title)}</h3>
          <p>${escapeHtml(uc.text)}</p>
          <blockquote class="usecase-ask">${de ? "„" : "“"}${escapeHtml(uc.ask)}${de ? "“" : "”"}</blockquote>
          <div class="usecase-actions">
            <a class="link-go" href="${escapeHtml(links.claude)}" target="_blank" rel="noopener">${
              de ? "In Claude testen" : "Try in Claude"
            } <span aria-hidden="true">↗</span></a>
            <a class="link-go" href="${escapeHtml(links.chatgpt)}" target="_blank" rel="noopener">${
              de ? "In ChatGPT testen" : "Try in ChatGPT"
            } <span aria-hidden="true">↗</span></a>
          </div>
        </article>`;
    })
    .join("\n        ");

  const howHtml = howTo.steps
    .map(
      (step, idx) => `<li class="how-step">
          <span class="how-num" aria-hidden="true">${idx + 1}</span>
          <h3>${escapeHtml(step.name)}</h3>
          <p>${escapeHtml(step.text)}</p>
        </li>`
    )
    .join("\n        ");

  const matrixHeaders = getMatrixHeaders(lang);
  const matrixHtml = getPlatformRows(lang)
    .map(
      (row) => `<div class="matrix-row" role="row">
          <div class="matrix-cell matrix-platform" role="rowheader">
            <strong>${escapeHtml(row.name)}</strong>
            <span>${escapeHtml(row.basis)}</span>
          </div>
          <div class="matrix-cell" role="cell" data-label="${escapeHtml(matrixHeaders.search)}">${escapeHtml(row.search)}</div>
          <div class="matrix-cell" role="cell" data-label="${escapeHtml(matrixHeaders.live)}">${escapeHtml(row.live)}</div>
          <div class="matrix-cell" role="cell" data-label="${escapeHtml(matrixHeaders.handoff)}">
            <span class="handoff-badge handoff-${row.handoffLevel}">${escapeHtml(row.handoffLabel)}</span>
            <span class="handoff-text">${escapeHtml(row.handoff)}</span>
          </div>
        </div>`
    )
    .join("\n        ");

  const comfortHtml = getComfortFeatures(lang)
    .map(
      (feature) => `<li class="comfort-item">
          <h3>${escapeHtml(feature.title)}</h3>
          <p>${escapeHtml(feature.text)}</p>
        </li>`
    )
    .join("\n        ");

  const faqHtml = faq
    .map(
      (item, idx) => `<details class="faq-item"${idx === 0 ? " open" : ""}>
          <summary><span>${escapeHtml(item.q)}</span><span class="faq-icon" aria-hidden="true"></span></summary>
          <div class="faq-answer"><p>${escapeHtml(item.a)}</p></div>
        </details>`
    )
    .join("\n        ");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#090909">
${renderFaviconHeadLinks()}
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(pageUrl)}">
<link rel="alternate" hreflang="de" href="${escapeHtml(`${origin}/?lang=de`)}">
<link rel="alternate" hreflang="en" href="${escapeHtml(`${origin}/?lang=en`)}">
<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${origin}/`)}">
<link rel="alternate" type="text/plain" title="llms.txt" href="${escapeHtml(`${origin}/llms.txt`)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ShopCart">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:image" content="${escapeHtml(`${origin}/icon-512.png`)}">
<meta property="og:locale" content="${de ? "de_DE" : "en_US"}">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/assets/landing.css?v=${assetVersion}">
<script defer src="/assets/hero-flow.js?v=${assetVersion}"></script>
<script type="application/ld+json">${serializeJsonLd(buildJsonLd(config, lang))}</script>
</head>
<body>
<a class="skip-link" href="#start">${de ? "Direkt zum Start" : "Skip to start"}</a>
${
  promoActive
    ? `<div class="promo-bar">
        <div class="wrap promo-inner">
          <span class="promo-pill">Black Friday</span>
          <span class="promo-text">${
            de
              ? `Pro gratis bis ${promoEnd} <span class="promo-extra">(${config.proDailyLimit} Abfragen/Tag) · Code <code class="promo-code">BLACKFRIDAY</code></span>`
              : `Pro free until ${promoEnd} <span class="promo-extra">(${config.proDailyLimit} lookups/day) · Code <code class="promo-code">BLACKFRIDAY</code></span>`
          }</span>
          <a class="promo-cta" href="/billing?lang=${lang}">${de ? "Gratis sichern →" : "Claim free Pro →"}</a>
        </div>
      </div>`
    : ""
}

<header class="site-header">
  <div class="wrap nav">
    <a class="brand" href="/?lang=${lang}">
      ${renderSparkCartSvg({ size: 28, className: "brand-logo" })}
      ${renderShopCartWordmark()}
    </a>

    <nav class="nav-links" aria-label="${de ? "Hauptnavigation" : "Main navigation"}">
      <a class="hide-sm" href="#demo">Demo</a>
      <a class="hide-sm" href="#how">${de ? "So funktioniert’s" : "How it works"}</a>
      <a class="hide-sm" href="#shops">${de ? "Shops" : "Stores"}</a>
      <a class="hide-md" href="#examples">${de ? "Beispiele" : "Examples"}</a>
      <a class="hide-sm" href="#pricing">${de ? "Preise" : "Pricing"}</a>
      <a class="hide-sm" href="#faq">FAQ</a>
      <a class="hide-md" href="/guides?lang=${lang}">${de ? "Ratgeber" : "Guides"}</a>
      <a class="hide-md" href="#developers">${de ? "Für Entwickler" : "Developers"}</a>
      <div class="nav-actions">
        <a class="btn-nav" href="/billing?lang=${lang}">${de ? "Konto" : "Account"}</a>
        <a class="btn-nav btn-lang" href="/?lang=${otherLang}" hreflang="${otherLang}" aria-label="${
          de ? "Switch to English" : "Auf Deutsch wechseln"
        }">${de ? "EN" : "DE"}</a>
      </div>
    </nav>
  </div>
</header>

<main>
  <!-- Hero: consumer promise + 1-click launch into the AI tool -->
  <section class="hero" id="top">
    <div class="hero-canvas-wrap" aria-hidden="true">
      <canvas
        id="hero-flow-canvas"
        class="hero-canvas"
        data-chips="${escapeHtml(JSON.stringify(getHeroChips(lang)))}"
      ></canvas>
    </div>
    <div class="hero-fade" aria-hidden="true"></div>

    <div class="wrap hero-inner">
      <div class="hero-content" id="hero-content">
        <div class="eyebrow">
          <span class="eyebrow-dot" aria-hidden="true"></span>
          <span>${de ? "Dein KI Shopping Assistent · kostenlos starten" : "Your AI shopping assistant · free to start"}</span>
        </div>

        <h1 class="hero-title">${
          de
            ? `Lass Claude, ChatGPT &amp; Gemini <span class="title-accent">deinen Warenkorb füllen.</span>`
            : `Let Claude, ChatGPT &amp; Gemini <span class="title-accent">fill your shopping cart.</span>`
        }</h1>

        <p class="hero-lead">${
          de
            ? "Sag deiner KI einfach, was du suchst – sie findet die passenden Produkte &amp; Größen in echten Online-Shops und gibt dir einen fertigen Warenkorb-Link. Du prüfst und bezahlst selbst."
            : "Tell your AI what you're looking for — it finds real products, sizes, and prices in online stores and hands you a ready-to-review cart link. You stay in full control of checkout."
        }</p>

        ${renderLauncher(config, lang, "hero")}

        <ul class="trust-strip">
          <li>${de ? "Du bezahlst immer selbst im Shop" : "You always pay in the store yourself"}</li>
          <li>${de ? "Keine Zahlungsdaten bei uns" : "No payment details with us"}</li>
          <li>${de ? "Kostenlos starten" : "Free to start"}</li>
        </ul>

        <a class="hero-platforms hero-clients" href="#setup">
          <span class="hero-platforms-label">${de ? "Für deine KI" : "Works in"}</span>
          <span class="hero-platforms-list">
            <span class="pill-featured">Claude</span>
            <span class="pill-featured">ChatGPT</span>
            <span class="pill-featured">Google Gemini</span>
            <span>Gemini CLI</span>
            <span>Cursor</span>
            <span>Claude Code</span>
            <span>Perplexity</span>
          </span>
        </a>

        <a class="hero-platforms" href="#shops">
          <span class="hero-platforms-label">${de ? "Funktioniert mit" : "Works with"}</span>
          <span class="hero-platforms-list">${PLATFORM_NAMES.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}<span>${
            de ? "+ jeder Shop per Produktlink" : "+ any store via product link"
          }</span></span>
        </a>
      </div>
    </div>

    <button
      type="button"
      id="hero-motion-btn"
      class="hero-motion-btn"
      data-pause-label="${de ? "Animation pausieren" : "Pause animation"}"
      data-play-label="${de ? "Animation starten" : "Play animation"}"
      aria-label="${de ? "Animation pausieren" : "Pause animation"}"
    >❚❚</button>
  </section>

  <!-- Demo video / live shopping example -->
  <section id="demo" class="section section-demo">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${
          hasExternalVideo ? (de ? "Produktvideo" : "Product video") : de ? "Live-Beispiel" : "Live example"
        }</span>
        <h2 class="section-title">${
          de ? "Vom Wunsch zum fertigen Warenkorb in Sekunden" : "From wish to ready-made cart in seconds"
        }</h2>
        <p class="section-sub">${
          de
            ? "So sieht KI-Shopping mit Claude, ChatGPT oder Google Gemini aus: Du schreibst einen Satz, deine KI sucht, prüft Größe und Preis und legt alles in den Warenkorb."
            : "This is what shopping with Claude, ChatGPT, or Google Gemini looks like: you write one sentence, your AI searches, checks size and price, and fills the cart."
        }</p>
      </div>

      <div class="demo-stage-wrap">
        <div class="demo-glow" aria-hidden="true"></div>
        <div class="demo-shell" id="demo-shell" data-aspect="${defaultAspect}" data-has-video="${String(hasExternalVideo)}">
          <div class="demo-chrome">
            <div class="chrome-left">
              <div class="window-dots" aria-hidden="true"><span></span><span></span><span></span></div>
              <div class="chrome-address">${de ? "Dein KI-Chat" : "Your AI chat"}</div>
              <span class="live-tag">${hasExternalVideo ? "Video" : de ? "Beispiel" : "Example"}</span>
            </div>
            ${demoToggleHtml}
          </div>

          <div class="demo-viewport">
            ${demoViewportHtml}
          </div>

          ${demoControlsHtml}
        </div>
      </div>

      <div class="demo-cta">
        <h3 class="demo-cta-title">${de ? "Jetzt mit deinem eigenen Wunsch ausprobieren" : "Now try it with your own wish"}</h3>
        ${renderLauncher(config, lang, "demo")}
      </div>
    </div>
  </section>

  <!-- How it works -->
  <section id="how" class="section">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${de ? "So funktioniert’s" : "How it works"}</span>
        <h2 class="section-title">${escapeHtml(howTo.name)}</h2>
        <p class="section-sub">${
          de
            ? "Kein Formular, keine Einrichtung von Hand: Deine KI übernimmt den Weg zum Warenkorb, du behältst die Kontrolle."
            : "No forms, no manual setup: your AI handles the way to the cart, and you stay in control."
        }</p>
      </div>
      <ol class="how-grid">
        ${howHtml}
      </ol>

      <div class="control-strip">
        <div class="control-item">
          <h3>${de ? "Die KI kauft nie selbst" : "The AI never buys for you"}</h3>
          <p>${
            de
              ? "ShopCart kann nur lesen: suchen, prüfen, Link bauen. Bestellen und bezahlen kannst nur du."
              : "ShopCart can only read: search, check, build a link. Only you can order and pay."
          }</p>
        </div>
        <div class="control-item">
          <h3>${de ? "Keine Adresse, keine Zahlungsdaten" : "No address, no payment details"}</h3>
          <p>${
            de
              ? "Lieferadresse und Zahlung gibst du wie immer direkt im Shop ein, nie bei uns oder deiner KI."
              : "You enter shipping and payment directly in the store as usual, never with us or your AI."
          }</p>
        </div>
        <div class="control-item">
          <h3>${de ? "Echte Preise und Größen" : "Real prices and sizes"}</h3>
          <p>${
            de
              ? "Preise, Varianten und Verfügbarkeit kommen live aus dem Shop, nicht aus veralteten Suchergebnissen."
              : "Prices, variants, and availability come live from the store, not from stale search results."
          }</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Platform & capability matrix: what is connected and how far the handoff goes -->
  <section id="shops" class="section section-shops">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${de ? "Unterstützte Shops" : "Supported stores"}</span>
        <h2 class="section-title">${
          de ? "In diesen Shops kauft deine KI für dich vor" : "Where your AI can prepare your shopping"
        }</h2>
        <p class="section-sub">${
          de
            ? "Sechs Shop-Systeme sind direkt angebunden, jeder andere Shop funktioniert per Produktlink. Die Tabelle zeigt ehrlich, was deine KI dort live prüft und wie der Einkauf bei dir ankommt."
            : "Six store platforms are connected directly, and any other store works via product link. The table shows honestly what your AI verifies live and how the result reaches you."
        }</p>
      </div>

      <div class="matrix" role="table" aria-label="${de ? "Unterstützte Shop-Systeme und Funktionen" : "Supported store platforms and capabilities"}">
        <div class="matrix-head" role="row">
          <span role="columnheader">${escapeHtml(matrixHeaders.platform)}</span>
          <span role="columnheader">${escapeHtml(matrixHeaders.search)}</span>
          <span role="columnheader">${escapeHtml(matrixHeaders.live)}</span>
          <span role="columnheader">${escapeHtml(matrixHeaders.handoff)}</span>
        </div>
        ${matrixHtml}
      </div>

      <p class="matrix-note">${
        de
          ? "Voraussetzung ist immer ein öffentlich erreichbarer Shop. Passwortgeschützte Shops und Shops, die automatische Abrufe sperren, funktionieren nicht. Bestellen und bezahlen kannst in jedem Fall nur du."
          : "The store always has to be publicly reachable. Password-protected stores and stores that block automated requests do not work. In every case, only you can order and pay."
      }</p>
    </div>
  </section>

  <!-- Comfort features -->
  <section id="comfort" class="section">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${de ? "Komfort" : "Comfort"}</span>
        <h2 class="section-title">${
          de ? "Mehr als ein Warenkorb-Link" : "More than a cart link"
        }</h2>
        <p class="section-sub">${
          de
            ? "Alles, was dir beim Einkaufen mit KI Rückfragen, Tabs und Tipparbeit spart."
            : "Everything that saves you follow-up questions, tabs, and typing when shopping with AI."
        }</p>
      </div>
      <ul class="comfort-grid">
        ${comfortHtml}
      </ul>
    </div>
  </section>

  <!-- Use cases -->
  <section id="examples" class="section">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${de ? "Beispiele" : "Examples"}</span>
        <h2 class="section-title">${
          de ? "Wofür du deinen KI Shopping Assistenten nutzt" : "What to use your AI shopping assistant for"
        }</h2>
        <p class="section-sub">${
          de
            ? "Tippe ein Beispiel an: Es öffnet sich direkt in Claude oder ChatGPT, fertig formuliert."
            : "Tap an example: it opens right in Claude or ChatGPT, fully worded."
        }</p>
      </div>
      <div class="grid-2">
        ${useCasesHtml}
      </div>
    </div>
  </section>

  <!-- Pricing -->
  <section id="pricing" class="section">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${de ? "Preise" : "Pricing"}</span>
        <h2 class="section-title">${
          de ? "Kostenlos starten. Mehr, wenn du mehr shoppst." : "Start free. More when you shop more."
        }</h2>
        <p class="section-sub">${
          de
            ? "Eine Shop-Abfrage ist ein Schritt deiner KI, zum Beispiel eine Suche oder eine Größenprüfung. Ein Warenkorb braucht meist nur wenige davon."
            : "A store lookup is one step your AI takes, such as a search or a size check. A cart usually needs only a few."
        }</p>
      </div>

      <div class="pricing-grid">
        <article class="card price-card">
          <h3>${de ? "Kostenlos" : "Free"}</h3>
          <div class="price-row">
            <div class="price">0 € <span>/ ${de ? "Monat" : "month"}</span></div>
          </div>
          <ul class="feat-list">
            <li>${de ? `${config.freeDailyLimit} Shop-Abfragen pro Tag` : `${config.freeDailyLimit} store lookups per day`}</li>
            <li>${de ? "Für Claude, ChatGPT, Google Gemini und andere KI-Tools" : "For Claude, ChatGPT, Google Gemini, and other AI tools"}</li>
            <li>${de ? "Keine Kreditkarte nötig" : "No credit card needed"}</li>
          </ul>
          <a class="btn-secondary w-full" href="#start">${de ? "Kostenlos starten" : "Start free"}</a>
        </article>

        <article class="card price-card card-featured">
          ${
            promoActive
              ? `<div class="pill-promo">★ ${
                  de ? `0 € bis ${promoEnd} · Code BLACKFRIDAY` : `€0 until ${promoEnd} · Code BLACKFRIDAY`
                }</div>`
              : ""
          }
          <h3>Pro</h3>
          <div class="price-row">
            ${promoActive ? `<span class="price-old">9 €</span>` : ""}
            <div class="price">${promoActive ? "0 €" : "9 €"} <span>/ ${
              promoActive ? (de ? `bis ${promoEndShort}` : `until ${promoEndShort}`) : de ? "Monat" : "month"
            }</span></div>
          </div>
          ${
            promoActive
              ? `<p class="price-note">${
                  de ? "Danach 9 €/Monat · jederzeit kündbar" : "Then €9/month · cancel anytime"
                }</p>`
              : ""
          }
          <ul class="feat-list">
            <li>${de ? `${config.proDailyLimit} Shop-Abfragen pro Tag` : `${config.proDailyLimit} store lookups per day`}</li>
            <li>${
              de
                ? "Für Black Friday, Geschenke-Marathons und Preisvergleiche"
                : "For Black Friday, gift marathons, and price comparisons"
            }</li>
            <li>${de ? "Monatlich kündbar, sichere Zahlung über Stripe" : "Cancel monthly, secure payment via Stripe"}</li>
          </ul>
          <a class="btn-primary w-full" href="/billing?lang=${lang}">${
            promoActive ? (de ? "Pro jetzt kostenlos sichern" : "Claim free Pro access") : de ? "Auf Pro upgraden" : "Upgrade to Pro"
          }</a>
        </article>
      </div>

      <p class="pricing-oss">${
        de
          ? `Du entwickelst selbst? Die Open-Source-Version läuft lokal kostenlos und unbegrenzt. <a href="#developers">Für Entwickler &amp; Self-Hosting</a>`
          : `Building it yourself? The open-source version runs locally, free and unlimited. <a href="#developers">For developers &amp; self-hosting</a>`
      }</p>
    </div>
  </section>

  <!-- FAQ (in sync with FAQPage JSON-LD) -->
  <section id="faq" class="section">
    <div class="wrap wrap-narrow">
      <div class="section-head">
        <span class="section-kicker">FAQ</span>
        <h2 class="section-title">${de ? "Häufige Fragen zum Einkaufen mit KI" : "Common questions about shopping with AI"}</h2>
      </div>
      <div class="faq-list">
        ${faqHtml}
      </div>
    </div>
  </section>

  <!-- Developers & self-hosting (compact, at the very bottom) -->
  <section id="developers" class="section section-dev">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${de ? "Für Entwickler &amp; Self-Hosting" : "For developers &amp; self-hosting"}</span>
        <h2 class="section-title">${
          de ? "Open Source: ein MCP-Server für Agentic Commerce" : "Open source: an MCP server for agentic commerce"
        }</h2>
        <p class="section-sub">${
          de
            ? "Technisch ist ShopCart ein MCP-Server (Model Context Protocol) mit sechs read-only Tools: ein Shopify MCP mit Storefront-MCP- und UCP-Erkennung, dazu Adapter für WooCommerce, BigCommerce, Amazon, Shopware 6, Magento 2 und Schema.org/JSON-LD. Gehostet mit OAuth 2.1 oder lokal per <code>npx</code>, ganz ohne Konto."
            : "Technically, ShopCart is an MCP server (Model Context Protocol) with six read-only tools: a Shopify MCP with Storefront MCP and UCP detection, plus adapters for WooCommerce, BigCommerce, Amazon, Shopware 6, Magento 2, and Schema.org/JSON-LD. Hosted with OAuth 2.1 or locally via <code>npx</code>, no account required."
        }</p>
      </div>

      <ul class="dev-facts">
        <li><strong>MIT</strong> ${de ? "Open Source" : "open source"}</li>
        <li><strong>OAuth 2.1</strong> CIMD &amp; DCR · PKCE S256</li>
        <li><strong>Streamable HTTP</strong> &amp; stdio</li>
        <li><strong>npx -y shopcart-mcp</strong></li>
        <li><strong>EU</strong> Cloud Run · europe-west1</li>
      </ul>

      <div class="install-row">
        <span class="install-label">${de ? "1-Klick-Install:" : "1-click install:"}</span>
        <a class="btn-install" href="${escapeHtml(installLinks.cursor)}">${de ? "In Cursor installieren" : "Install in Cursor"}</a>
        <a class="btn-install" href="${escapeHtml(installLinks.vscode)}">${de ? "In VS Code installieren" : "Install in VS Code"}</a>
        <a class="btn-install" href="/downloads/shopcart-mcp.mcpb" download>${
          de ? "Claude Desktop (.mcpb, Mac/Windows)" : "Claude Desktop (.mcpb, Mac/Windows)"
        }</a>
        <span class="install-note">${
          de
            ? "Öffnet die App und trägt ShopCart als MCP-Server ein. Die Claude-Desktop-Erweiterung installierst du per Doppelklick."
            : "Opens the app and adds ShopCart as an MCP server. Install the Claude Desktop extension with a double-click."
        }</span>
      </div>

      <div class="tabs-card" id="setup" data-tabs-root>
        <div class="tablist" role="tablist" aria-label="${de ? "MCP-Clients" : "MCP clients"}">
          <button type="button" role="tab" id="tab-claude-ai" class="tab-btn" aria-selected="true" tabindex="0">
            <span>Claude.ai</span><span class="tab-tag">OAuth 2.1</span>
          </button>
          <button type="button" role="tab" id="tab-chatgpt" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>ChatGPT</span><span class="tab-tag">Connectors</span>
          </button>
          <button type="button" role="tab" id="tab-gemini" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>Google Gemini</span><span class="tab-tag">Web · CLI</span>
          </button>
          <button type="button" role="tab" id="tab-claude-code" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>Claude Code</span><span class="tab-tag">CLI</span>
          </button>
          <button type="button" role="tab" id="tab-cursor" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>Cursor</span><span class="tab-tag">mcp.json</span>
          </button>
          <button type="button" role="tab" id="tab-local" class="tab-btn" aria-selected="false" tabindex="-1">
            <span>OpenClaw / Local npx</span><span class="tab-tag">MIT · stdio</span>
          </button>
        </div>

        <div class="tab-panels">
          <div role="tabpanel" aria-labelledby="tab-claude-ai">
            <div class="tab-panel-inner">
              <div>
                <h3>Claude.ai &amp; Claude Desktop</h3>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span><strong>Settings → Connectors → Add custom connector</strong></span></li>
                  <li><span class="step-badge">2</span><span>${
                    de ? "Remote-MCP-URL einfügen und speichern." : "Paste the remote MCP URL and save."
                  }</span></li>
                  <li><span class="step-badge">3</span><span>${
                    de
                      ? "Im Browser-Fenster anmelden oder kostenloses Konto anlegen."
                      : "Sign in or create a free account in the browser window."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>Remote MCP (Streamable HTTP)</span>
                  <button type="button" class="copy-mini" data-copy-target="code-claude-ai" data-copied-label="${copiedLabel}">${copyLabel}</button>
                </div>
                <pre><code id="code-claude-ai">${escapeHtml(mcpUrl)}</code></pre>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-chatgpt" hidden="until-found">
            <div class="tab-panel-inner">
              <div>
                <h3>ChatGPT Custom Connectors</h3>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de
                      ? "<strong>Settings → Connectors → Create</strong>, dann <strong>MCP Server</strong> wählen."
                      : "<strong>Settings → Connectors → Create</strong>, then select <strong>MCP Server</strong>."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "Endpoint-URL eintragen, Authentifizierung <strong>OAuth</strong>."
                      : "Enter the endpoint URL, authentication <strong>OAuth</strong>."
                  }</span></li>
                  <li><span class="step-badge">3</span><span>${
                    de ? "Zugriff per PKCE S256 autorisieren (RFC 9728 Discovery)." : "Authorize via PKCE S256 (RFC 9728 discovery)."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>ChatGPT MCP Server URL</span>
                  <button type="button" class="copy-mini" data-copy-target="code-chatgpt" data-copied-label="${copiedLabel}">${copyLabel}</button>
                </div>
                <pre><code id="code-chatgpt">${escapeHtml(mcpUrl)}</code></pre>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-gemini" hidden="until-found">
            <div class="tab-panel-inner tab-panel-gemini">
              <div class="gemini-blocks">
                <div class="gemini-block">
                  <h3>${de ? "1. Gemini Web (gemini.google.com)" : "1. Gemini Web (gemini.google.com)"}</h3>
                  <ol class="setup-steps">
                    <li><span class="step-badge">1</span><span>${
                      de
                        ? "In <strong>gemini.google.com</strong> öffnen: <strong>Einstellungen → Verbundene Apps → Eigene Apps → App hinzufügen</strong> (oder zum Testen <code>gemini.google.com/devmode</code>)."
                        : "Open <strong>gemini.google.com</strong> → <strong>Settings → Connected Apps → Custom apps → Add a custom app</strong> (or test via <code>gemini.google.com/devmode</code>)."
                    }</span></li>
                    <li><span class="step-badge">2</span><span>${
                      de
                        ? "MCP-Server-URL einfügen und per OAuth 2.1 anmelden (CIMD über <code>accountlinking.google.com</code>)."
                        : "Paste the MCP server URL and complete OAuth 2.1 sign-in (CIMD via <code>accountlinking.google.com</code>)."
                    }</span></li>
                  </ol>
                  <p class="gemini-prereq-note">${
                    de
                      ? "<strong>Voraussetzungen:</strong> Persönliches Google-Konto (bei Google-Workspace-Konten kann „Service not allowed“ erscheinen, solange der Workspace-Admin es nicht freigibt – Teams nutzen Gemini Enterprise), <strong>Aktivitäten speichern</strong> (Keep Activity) aktiviert und abhängig vom Google-Rollout."
                      : "<strong>Prerequisites:</strong> Personal Google account (Google Workspace accounts may show “Service not allowed” unless enabled by a Workspace Admin — teams use Gemini Enterprise), <strong>Keep Activity</strong> enabled, and subject to Google's regional/account rollout."
                  }</p>
                </div>

                <div class="gemini-block">
                  <h3>${de ? "2. Gemini CLI &amp; Antigravity" : "2. Gemini CLI &amp; Antigravity"}</h3>
                  <p class="gemini-block-note">${
                    de
                      ? "1-Befehl-Installation als offizielle GitHub-Erweiterung oder direkt per <code>gemini mcp add</code>. Wichtig für <code>~/.gemini/settings.json</code>: unbedingt <code>\"httpUrl\"</code> verwenden — nicht <code>\"url\"</code> (sonst erwartet die Gemini CLI Legacy-SSE)."
                      : "1-command install via the GitHub extension or directly with <code>gemini mcp add</code>. Important for <code>~/.gemini/settings.json</code>: always use <code>\"httpUrl\"</code> — never <code>\"url\"</code> (Gemini CLI treats <code>\"url\"</code> as legacy SSE)."
                  }</p>
                </div>

                <div class="gemini-block">
                  <h3>${de ? "3. Gemini Enterprise &amp; @google/genai SDK" : "3. Gemini Enterprise &amp; @google/genai SDK"}</h3>
                  <p class="gemini-block-note">${
                    de
                      ? `<strong>Google Cloud Console (Gemini Enterprise):</strong> Custom MCP Server Data Store mit Streamable HTTP (<code>${escapeHtml(mcpUrl)}</code>), OAuth-2.0-Redirect-URI <code>https://vertexaisearch.cloud.google.com/oauth-redirect</code> und Scope <code>mcp:read</code>.`
                      : `<strong>Google Cloud Console (Gemini Enterprise):</strong> Custom MCP Server Data Store using Streamable HTTP (<code>${escapeHtml(mcpUrl)}</code>), OAuth 2.0 Redirect URI <code>https://vertexaisearch.cloud.google.com/oauth-redirect</code>, and scope <code>mcp:read</code>.`
                  }</p>
                  <p class="gemini-block-note">${
                    de
                      ? `<strong>TypeScript SDK:</strong> Kombiniere <code>mcpToTool(mcpClient)</code> aus <code>@google/genai</code> mit <code>StreamableHTTPClientTransport</code> aus <code>@modelcontextprotocol/sdk</code>. <a class="gemini-guide-link" href="${geminiGuidePath}">Ausführliche Gemini-Anleitung lesen →</a>`
                      : `<strong>TypeScript SDK:</strong> Combine <code>mcpToTool(mcpClient)</code> from <code>@google/genai</code> with <code>StreamableHTTPClientTransport</code> from <code>@modelcontextprotocol/sdk</code>. <a class="gemini-guide-link" href="${geminiGuidePath}">Read the full Gemini setup guide →</a>`
                  }</p>
                </div>
              </div>

              <div class="gemini-code-stack">
                <div class="code-card">
                  <div class="code-head">
                    <span>Gemini Web · Streamable HTTP URL</span>
                    <button type="button" class="copy-mini" data-copy-target="code-gemini-web" data-copied-label="${copiedLabel}">${copyLabel}</button>
                  </div>
                  <pre><code id="code-gemini-web">${escapeHtml(mcpUrl)}</code></pre>
                </div>

                <div class="code-card">
                  <div class="code-head">
                    <span>Gemini CLI Extension (1 command)</span>
                    <button type="button" class="copy-mini" data-copy-target="code-gemini-ext" data-copied-label="${copiedLabel}">${copyLabel}</button>
                  </div>
                  <pre class="code-wrap"><code id="code-gemini-ext">${escapeHtml(geminiExtCmd)}</code></pre>
                </div>

                <div class="code-card">
                  <div class="code-head">
                    <span>Gemini CLI · mcp add</span>
                    <button type="button" class="copy-mini" data-copy-target="code-gemini-cli" data-copied-label="${copiedLabel}">${copyLabel}</button>
                  </div>
                  <pre class="code-wrap"><code id="code-gemini-cli">${escapeHtml(geminiCliCmd)}</code></pre>
                </div>

                <div class="code-card">
                  <div class="code-head">
                    <span>~/.gemini/settings.json (httpUrl)</span>
                    <button type="button" class="copy-mini" data-copy-target="code-gemini-settings" data-copied-label="${copiedLabel}">${copyLabel}</button>
                  </div>
                  <pre><code id="code-gemini-settings">${escapeHtml(geminiSettingsSnippet)}</code></pre>
                </div>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-claude-code" hidden="until-found">
            <div class="tab-panel-inner">
              <div>
                <h3>Claude Code CLI</h3>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de ? "Befehl im Terminal ausführen." : "Run the command in your terminal."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "<code>claude</code> starten und den OAuth-Login einmalig über <code>/mcp</code> bestätigen."
                      : "Start <code>claude</code> and confirm the one-time OAuth sign-in via <code>/mcp</code>."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>Terminal (zsh / bash)</span>
                  <button type="button" class="copy-mini" data-copy-target="code-claude-code" data-copied-label="${copiedLabel}">${copyLabel}</button>
                </div>
                <pre><code id="code-claude-code">${escapeHtml(claudeCodeCmd)}</code></pre>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-cursor" hidden="until-found">
            <div class="tab-panel-inner">
              <div>
                <h3>Cursor &amp; VS Code</h3>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de
                      ? "<code>.cursor/mcp.json</code> im Projekt oder <code>~/.cursor/mcp.json</code> global öffnen."
                      : "Open <code>.cursor/mcp.json</code> in your project or <code>~/.cursor/mcp.json</code> globally."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "Konfiguration einfügen und in Cursor auf <strong>Connect</strong> klicken (RFC 8252 Loopback-OAuth)."
                      : "Paste the config and click <strong>Connect</strong> in Cursor (RFC 8252 loopback OAuth)."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>.cursor/mcp.json</span>
                  <button type="button" class="copy-mini" data-copy-target="code-cursor" data-copied-label="${copiedLabel}">${copyLabel}</button>
                </div>
                <pre><code id="code-cursor">${escapeHtml(cursorSnippet)}</code></pre>
              </div>
            </div>
          </div>

          <div role="tabpanel" aria-labelledby="tab-local" hidden="until-found">
            <div class="tab-panel-inner">
              <div>
                <h3>OpenClaw / Local npx (MIT)</h3>
                <ol class="setup-steps">
                  <li><span class="step-badge">1</span><span>${
                    de
                      ? "Direktstart: <code>npx -y shopcart-mcp</code> (Node.js ≥ 22), 100 % lokal über <code>stdio</code>."
                      : "Instant launch: <code>npx -y shopcart-mcp</code> (Node.js ≥ 22), 100% local over <code>stdio</code>."
                  }</span></li>
                  <li><span class="step-badge">2</span><span>${
                    de
                      ? "Oder den JSON-Block in OpenClaw, Claude Desktop, Goose, Raycast oder jeden stdio-MCP-Host eintragen. Unbegrenzt, kein Konto, keine Telemetrie."
                      : "Or paste the JSON block into OpenClaw, Claude Desktop, Goose, Raycast, or any stdio MCP host. Unlimited, no account, no telemetry."
                  }</span></li>
                </ol>
              </div>
              <div class="code-card">
                <div class="code-head">
                  <span>mcp-servers.json (stdio)</span>
                  <button type="button" class="copy-mini" data-copy-target="code-local" data-copied-label="${copiedLabel}">${copyLabel}</button>
                </div>
                <pre><code id="code-local">${escapeHtml(localSnippet)}</code></pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <details class="dev-details">
        <summary><span>${de ? "Die 6 read-only Tools im Detail" : "The 6 read-only tools in detail"}</span><span class="faq-icon" aria-hidden="true"></span></summary>
        <div class="grid-2 dev-tools">
          <article class="card card-flat">
            <span class="tool-tag">inspect_store</span>
            <p>${
              de
                ? "Erkennt das Shop-System (Shopify, WooCommerce, BigCommerce, Amazon, Shopware 6, Magento 2 oder Schema.org/JSON-LD), Währung, Land und WAF-Verhalten."
                : "Detects the store platform (Shopify, WooCommerce, BigCommerce, Amazon, Shopware 6, Magento 2, or Schema.org/JSON-LD), currency, country, and WAF behavior."
            }</p>
            <div class="tool-sig">inspect_store({ store_url })</div>
          </article>
          <article class="card card-flat">
            <span class="tool-tag">list_collections</span>
            <p>${
              de
                ? "Listet Kollektionen eines Shopify-Shops und hebt Sale, Black Friday, Outlet, Bestseller und Bundles hervor."
                : "Lists a Shopify store's collections and highlights sale, Black Friday, outlet, bestseller, and bundle collections."
            }</p>
            <div class="tool-sig">list_collections({ store_url, deals_only })</div>
          </article>
          <article class="card card-flat">
            <span class="tool-tag">search_products</span>
            <p>${
              de
                ? "Katalogsuche mit Preis- und Verfügbarkeitsfiltern, Kollektionsfilter (z. B. Sale oder Bestseller), Sortierung nach Preis oder Rabatt sowie <code>discount_percent</code> und <code>savings</code> je Treffer."
                : "Catalog search with price and stock filters, collection filter (e.g. sale or bestsellers), sorting by price or discount, plus <code>discount_percent</code> and <code>savings</code> per result."
            }</p>
            <div class="tool-sig">search_products({ store_url, query, collection, max_price, available_only, sort_by })</div>
          </article>
          <article class="card card-flat">
            <span class="tool-tag">get_product</span>
            <p>${
              de
                ? "Varianten, Optionen und Live-Bestand; Minor-Units exakt pro Währung, HTML und verstecktes Unicode entfernt. Auf beliebigen Shops per Produkt-URL über Schema.org/JSON-LD."
                : "Variants, options, and live stock; exact minor units per currency, HTML and hidden Unicode stripped. On any store by product URL via Schema.org/JSON-LD."
            }</p>
            <div class="tool-sig">get_product({ store_url, handle_or_url })</div>
          </article>
          <article class="card card-flat">
            <span class="tool-tag">get_store_policies</span>
            <p>${
              de
                ? "Versand-, Rückgabe- und Widerrufsregeln eines Shopify-Shops vor dem Checkout, aus Storefront MCP und <code>/policies</code>."
                : "Shipping, return, and refund policies of a Shopify store before checkout, from Storefront MCP and <code>/policies</code>."
            }</p>
            <div class="tool-sig">get_store_policies({ store_url, topic, question })</div>
          </article>
          <article class="card card-flat">
            <span class="tool-tag">create_cart_link</span>
            <p>${
              de
                ? "Shopify-Permalink <code>/cart/&lt;id&gt;:&lt;qty&gt;</code>, Amazon <code>/gp/aws/cart/add.html</code>, WooCommerce und BigCommerce je Artikel, sonst geprüfte Produktlinks. Niemals automatische Käufe."
                : "Shopify permalink <code>/cart/&lt;id&gt;:&lt;qty&gt;</code>, Amazon <code>/gp/aws/cart/add.html</code>, WooCommerce and BigCommerce per item, verified product links elsewhere. Never auto-purchases."
            }</p>
            <div class="tool-sig">create_cart_link({ store_url, items, mode, verify_handles })</div>
          </article>
        </div>
        <p class="dev-security">${
          de
            ? "Sicherheit: DNS-gepinnter SSRF-Schutz, Prompt-Injection-Sanitizing für Shop-Texte, Refresh-Token-Rotation mit Replay-Erkennung."
            : "Security: DNS-pinned SSRF guard, prompt-injection sanitizing for store text, refresh-token rotation with replay detection."
        }</p>
      </details>

      <div class="dev-links">
        <a class="btn-secondary" href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub · MIT</a>
        <a class="btn-secondary" href="${escapeHtml(`${config.repoUrl}/blob/main/gemini-extension.json`)}" target="_blank" rel="noopener noreferrer">gemini-extension.json</a>
        <a class="btn-secondary" href="${escapeHtml(`${config.repoUrl}/blob/main/server.json`)}" target="_blank" rel="noopener noreferrer">server.json</a>
        <a class="btn-secondary" href="/.well-known/mcp.json">mcp.json</a>
        <a class="btn-secondary" href="/llms.txt">llms.txt</a>
        <a class="btn-secondary" href="/llms-full.txt">llms-full.txt</a>
      </div>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="foot-row">
      <div class="foot-brand">
        ${renderSparkCartSvg({ size: 20, className: "foot-mark" })}
        <span><strong>Shop<span class="brand-accent">Cart</span></strong> · by <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">wals.pro</a></span>
      </div>
      <div class="foot-links">
        <a href="/guides?lang=${lang}">${de ? "Ratgeber" : "Guides"}</a>
        <a href="/billing?lang=${lang}">${de ? "Konto &amp; Abo" : "Account &amp; billing"}</a>
        <a href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy"}</a>
        <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a>
        <a href="/llms.txt">llms.txt</a>
        <a href="/.well-known/security.txt">security.txt</a>
        <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener noreferrer">${
          de ? "Impressum" : "Legal Notice"
        }</a>
      </div>
    </div>
    <p class="disclaimer">${
      de
        ? `${escapeHtml(getTrademarkDisclaimer("de"))} Genannte Shops und Marken (z. B. SNOCKS, KERNenergie, PURELEI) dienen nur als Beispiele; es besteht keine Partnerschaft. Beispielpreise Stand ${EXAMPLE_PRICES_VERIFIED_DE}, Preise und Verfügbarkeit können sich ändern.`
        : `${escapeHtml(getTrademarkDisclaimer("en"))} Stores and brands mentioned (e.g. SNOCKS, KERNenergie, Allbirds) are examples only; no partnership exists. Example prices as of ${EXAMPLE_PRICES_VERIFIED_EN}; prices and availability may change.`
    }</p>
  </div>
</footer>
</body>
</html>`;
}
