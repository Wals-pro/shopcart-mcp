import type { Lang } from "../auth/pages.js";
import { isPromoFreeProActive } from "../billing/quota.js";
import type { AppConfig } from "../config.js";

/**
 * Shared consumer-facing content for the landing page, Schema.org JSON-LD,
 * and the agent discovery files (/llms.txt, /llms-full.txt).
 * Keeping it in one place guarantees the visible FAQ accordion and the
 * FAQPage / HowTo structured data never drift apart.
 */

/** Date the example prices on the page were last verified against the live stores. */
export const EXAMPLE_PRICES_VERIFIED_DE = "25.11.2026";
export const EXAMPLE_PRICES_VERIFIED_EN = "Nov 25, 2026";

export interface FaqItem {
  q: string;
  a: string;
}

export interface HowToContent {
  name: string;
  description: string;
  steps: Array<{ name: string; text: string }>;
}

export interface Wish {
  id: string;
  label: string;
  /** Sentence fragment appended to the start-prompt head. */
  tail: string;
}

export interface UseCase {
  id: string;
  kicker: string;
  title: string;
  text: string;
  /** Example request shown as a quote and sent as the start-prompt tail. */
  ask: string;
}

export interface AiLinks {
  claude: string;
  chatgpt: string;
  perplexity: string;
}

export function formatPromoEnd(config: AppConfig, lang: Lang): string {
  const date = config.promoFreeProUntil;
  if (!date) return "";
  return new Intl.DateTimeFormat(lang === "de" ? "de-AT" : "en-US", {
    timeZone: "Europe/Vienna",
    day: lang === "de" ? "2-digit" : "numeric",
    month: lang === "de" ? "2-digit" : "short",
    year: "numeric"
  }).format(date);
}

// ---------------------------------------------------------------------------
// 1-click start prompt + deeplinks ("Lass meine KI das einrichten")
// ---------------------------------------------------------------------------

export function startPromptHead(config: AppConfig, lang: Lang): string {
  const mcpUrl = `${config.appOrigin}/mcp`;
  const llmsUrl = `${config.appOrigin}/llms.txt`;
  return lang === "de"
    ? `Verbinde ShopCart (${mcpUrl}) für mich – lies kurz ${llmsUrl}, falls nötig –`
    : `Connect ShopCart (${mcpUrl}) for me — take a quick look at ${llmsUrl} if needed —`;
}

export function defaultPromptTail(lang: Lang): string {
  return lang === "de"
    ? "und frag mich dann nach meinem Wunsch-Shop und was ich suche. Stell mir danach direkt einen fertigen Warenkorb-Link zusammen."
    : "then ask me which online store I'd like to shop at and what I'm looking for, and build me a ready-to-review cart link.";
}

function cartTail(lang: Lang, wish: string): string {
  return lang === "de"
    ? `und stell mir dann direkt folgenden Warenkorb zusammen: ${wish}`
    : `then build me this cart right away: ${wish}`;
}

export function taskTail(lang: Lang, ask: string): string {
  return lang === "de"
    ? `und erledige dann direkt Folgendes für mich: ${ask}`
    : `then do this for me right away: ${ask}`;
}

export function getWishes(lang: Lang): Wish[] {
  if (lang === "de") {
    return [
      {
        id: "snocks",
        label: "SNOCKS Socken-Bundle",
        tail: cartTail(
          lang,
          "ein Socken-Bundle bei SNOCKS (snocks.com) – frag mich kurz nach Größe und Farbe."
        )
      },
      {
        id: "kernenergie",
        label: "KERNenergie Adventskalender",
        tail: cartTail(
          lang,
          "einen Adventskalender bei KERNenergie (kern-energie.com) – falls er ausverkauft ist, schlag mir eine verfügbare Alternative vor."
        )
      },
      {
        id: "purelei",
        label: "PURELEI Geschenk unter 50 €",
        tail: cartTail(
          lang,
          "ein Geschenk unter 50 € bei PURELEI (purelei.com) – zeig mir zuerst drei verfügbare Ideen."
        )
      },
      { id: "own", label: "Eigener Wunsch-Shop", tail: defaultPromptTail(lang) }
    ];
  }
  return [
    {
      id: "allbirds",
      label: "Allbirds sneakers",
      tail: cartTail(
        lang,
        "a pair of Allbirds sneakers (allbirds.com) — ask me for my size and color first."
      )
    },
    {
      id: "gift",
      label: "Holiday gift under $50",
      tail: cartTail(
        lang,
        "a holiday gift under $50 — ask me which store I like, then show me three in-stock ideas first."
      )
    },
    {
      id: "snocks",
      label: "SNOCKS bundle",
      tail: cartTail(
        lang,
        "a SNOCKS sock bundle (snocks.com) — ask me for my size and color first."
      )
    },
    { id: "own", label: "My own store", tail: defaultPromptTail(lang) }
  ];
}

export function buildStartPrompt(config: AppConfig, lang: Lang, tail?: string): string {
  return `${startPromptHead(config, lang)} ${tail ?? defaultPromptTail(lang)}`;
}

/** Where "Mit Claude/ChatGPT verbinden" sends people after copying the connector URL. */
export const CONNECT_SETTINGS_URLS = {
  claude: "https://claude.ai/settings/connectors",
  chatgpt: "https://chatgpt.com/#settings/Connectors"
} as const;

/** Native 1-click install deeplinks for apps that support them today (developer section). */
export function buildInstallLinks(config: AppConfig): { cursor: string; vscode: string } {
  const mcpUrl = `${config.appOrigin}/mcp`;
  const cursorConfig = Buffer.from(JSON.stringify({ url: mcpUrl }), "utf8").toString("base64");
  const vscodeConfig = encodeURIComponent(JSON.stringify({ name: "shopcart", type: "http", url: mcpUrl }));
  return {
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=shopcart&config=${encodeURIComponent(cursorConfig)}`,
    vscode: `vscode:mcp/install?${vscodeConfig}`
  };
}

export const AI_LINK_BASES: AiLinks = {
  claude: "https://claude.ai/new?q=",
  chatgpt: "https://chatgpt.com/?q=",
  perplexity: "https://www.perplexity.ai/search?q="
};

/** Strict RFC 3986 encoding: also escapes ! ' ( ) * so the link survives HTML attributes and link parsers. */
export function encodePrompt(prompt: string): string {
  return encodeURIComponent(prompt).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function buildAiLinks(prompt: string): AiLinks {
  const q = encodePrompt(prompt);
  return {
    claude: `${AI_LINK_BASES.claude}${q}`,
    chatgpt: `${AI_LINK_BASES.chatgpt}${q}`,
    perplexity: `${AI_LINK_BASES.perplexity}${q}`
  };
}

// ---------------------------------------------------------------------------
// Use cases (consumer examples)
// ---------------------------------------------------------------------------

export function getUseCases(lang: Lang): UseCase[] {
  if (lang === "de") {
    return [
      {
        id: "black-friday",
        kicker: "Black Friday",
        title: "Deals ohne Tab-Chaos",
        text: "Deine KI prüft, was wirklich reduziert ist, und legt nur verfügbare Größen in den Warenkorb.",
        ask: "Zeig mir bei snocks.com die reduzierten Sneaker-Socken in Größe 43–46 und pack die zwei besten Angebote in einen Warenkorb."
      },
      {
        id: "advent",
        kicker: "Adventskalender",
        title: "Noch einen Kalender finden",
        text: "Welche Adventskalender sind noch lieferbar und was kosten sie? Deine KI schaut direkt im Shop nach.",
        ask: "Welche Adventskalender gibt es bei KERNenergie (kern-energie.com) und PURELEI (purelei.com) noch? Zeig mir Preise und Verfügbarkeit und bau mir für meinen Favoriten einen Warenkorb-Link."
      },
      {
        id: "bundles",
        kicker: "Socken-Bundles",
        title: "Bundles in deiner Größe",
        text: "Mehrere Farben, mehrere Paare, eine Größe: ein Satz genügt, der Warenkorb steht.",
        ask: "Ich möchte bei SNOCKS (snocks.com) 2× weiße und 1× schwarze Sneaker-Socken in Größe 43–46. Bau mir einen fertigen Warenkorb-Link."
      },
      {
        id: "gifts",
        kicker: "Geschenke unter 50 €",
        title: "Geschenkideen nach Budget",
        text: "Sag Anlass und Budget. Du bekommst lieferbare Ideen mit echten Preisen statt vager Tipps.",
        ask: "Finde mir bei PURELEI (purelei.com) drei lieferbare Geschenkideen unter 50 € und leg meinen Favoriten in den Warenkorb."
      }
    ];
  }
  return [
    {
      id: "black-friday",
      kicker: "Black Friday",
      title: "Deals without tab chaos",
      text: "Your AI checks what is genuinely on sale and only adds sizes that are in stock.",
      ask: "Show me the sneaker socks on sale at snocks.com in size 43–46 and put the two best deals into a cart."
    },
    {
      id: "advent",
      kicker: "Advent calendars",
      title: "Find a calendar in time",
      text: "Which advent calendars are still available, and what do they cost? Your AI checks the store directly.",
      ask: "Which advent calendars are still available at KERNenergie (kern-energie.com) and PURELEI (purelei.com)? Show me prices and availability and build a cart link for my favorite."
    },
    {
      id: "bundles",
      kicker: "Bundles",
      title: "Bundles in your size",
      text: "Several colors, several pairs, one size: one sentence is enough and the cart is ready.",
      ask: "I'd like 2× white and 1× black sneaker socks from SNOCKS (snocks.com) in size 43–46. Build me a ready-to-review cart link."
    },
    {
      id: "gifts",
      kicker: "Gifts under $50",
      title: "Gift ideas on a budget",
      text: "Name the occasion and your budget. You get in-stock ideas with real prices instead of vague tips.",
      ask: "Find three in-stock holiday gift ideas under $50 at allbirds.com and add my favorite to a cart."
    }
  ];
}

// ---------------------------------------------------------------------------
// HowTo ("In 30 Sekunden mit Claude oder ChatGPT einkaufen")
// ---------------------------------------------------------------------------

export function getHowTo(lang: Lang): HowToContent {
  if (lang === "de") {
    return {
      name: "In 30 Sekunden mit Claude oder ChatGPT einkaufen",
      description:
        "So lässt du Claude, ChatGPT oder eine andere KI deinen Warenkorb in einem Online-Shop zusammenstellen. Du prüfst und bezahlst selbst.",
      steps: [
        {
          name: "Einmal verbinden",
          text: "Tippe auf „Mit Claude verbinden“ oder „Mit ChatGPT verbinden“. Dein ShopCart-Link wird kopiert und die Connector-Einstellungen öffnen sich: einfügen, kostenlos anmelden, fertig."
        },
        {
          name: "Chat starten",
          text: "Tippe auf „In Claude starten“ oder „In ChatGPT starten“. Dein Startprompt ist schon eingetragen."
        },
        {
          name: "Wunsch sagen",
          text: "Nenne Shop, Produkt, Größe oder Budget. Deine KI prüft Preise und Verfügbarkeit direkt im Shop."
        },
        {
          name: "Prüfen und selbst bezahlen",
          text: "Du bekommst einen fertigen Warenkorb-Link, öffnest ihn im Shop, prüfst alles und bezahlst wie gewohnt."
        }
      ]
    };
  }
  return {
    name: "Shop with Claude or ChatGPT in 30 seconds",
    description:
      "How to let Claude, ChatGPT, or another AI assistant fill your cart in an online store. You review and pay yourself.",
    steps: [
      {
        name: "Connect once",
        text: "Tap “Connect to Claude” or “Connect to ChatGPT”. Your ShopCart link is copied and the connector settings open: paste it, sign in for free, done."
      },
      {
        name: "Start a chat",
        text: "Tap “Start in Claude” or “Start in ChatGPT”. Your start prompt is already filled in."
      },
      {
        name: "Say what you want",
        text: "Name the store, product, size, or budget. Your AI checks prices and availability directly in the store."
      },
      {
        name: "Review and pay yourself",
        text: "You get a ready-to-review cart link, open it in the store, check everything, and pay as usual."
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// FAQ (6 real consumer questions, in sync with FAQPage JSON-LD)
// ---------------------------------------------------------------------------

export function getFaq(config: AppConfig, lang: Lang): FaqItem[] {
  const mcpUrl = `${config.appOrigin}/mcp`;
  const promoActive = isPromoFreeProActive(config);
  const promoEnd = formatPromoEnd(config, lang);
  const free = config.freeDailyLimit;
  const pro = config.proDailyLimit;

  if (lang === "de") {
    return [
      {
        q: "Kauft die KI über ShopCart automatisch für mich ein?",
        a: "Nein. ShopCart arbeitet rein lesend: Deine KI sucht Produkte, prüft Größen, Preise und Verfügbarkeit und gibt dir einen fertigen Warenkorb-Link. Du öffnest den Link selbst im Browser, prüfst alles in Ruhe und bezahlst wie gewohnt direkt im Online-Shop."
      },
      {
        q: "Wie richte ich ShopCart in Claude oder ChatGPT ein?",
        a: `Tippe auf „Mit Claude verbinden“ oder „Mit ChatGPT verbinden“: Dein ShopCart-Link ${mcpUrl} wird kopiert und die Connector-Einstellungen deiner KI öffnen sich. Dort fügst du den Link als eigenen Connector ein und meldest dich einmalig kostenlos an. Aus Sicherheitsgründen lässt sich ein Connector nicht vollautomatisch von einer Website installieren, deshalb sind es zwei Klicks statt einem. Danach tippst du auf „In Claude starten“ oder „In ChatGPT starten“ und lässt dir sofort deinen ersten Warenkorb mit Claude oder ChatGPT bauen.`
      },
      {
        q: "In welchen Online-Shops funktioniert ShopCart?",
        a: "ShopCart funktioniert in öffentlichen Shopify-Onlineshops weltweit, egal ob in Euro, US-Dollar oder Schweizer Franken. Dazu gehören viele bekannte Marken-Shops aus Mode, Outdoor, Food, Beauty und Technik, zum Beispiel SNOCKS, KERNenergie oder PURELEI. Passwortgeschützte Shops und große Marktplätze wie Amazon werden nicht unterstützt."
      },
      {
        q: "Was kostet ShopCart?",
        a: `Im Free-Tarif sind ${free} Shop-Abfragen pro Tag dauerhaft kostenlos. Wer intensiver shoppt, bekommt im Pro-Tarif ${pro} Abfragen pro Tag für 9 € im Monat.${
          promoActive
            ? ` Während der Black-Friday-Launch-Aktion bis zum ${promoEnd} nutzen alle angemeldeten Konten automatisch ${pro} Abfragen pro Tag gratis.`
            : ""
        } Die Open-Source-Version für lokale Programme ist unter MIT-Lizenz kostenlos und unbegrenzt nutzbar.`
      },
      {
        q: "Welche Daten speichert ShopCart über meine Einkäufe?",
        a: "ShopCart speichert weder deine Chat-Verläufe noch Lieferadressen, Shop-Logins oder Zahlungsdaten. Für den gehosteten Dienst in der EU werden nur deine Konto-E-Mail, gehashte Anmeldedaten und ein täglicher Nutzungszähler gespeichert. Wenn du die Open-Source-Version lokal ausführst, werden überhaupt keine Daten an wals.pro übertragen."
      },
      {
        q: "Was unterscheidet ShopCart von normalem ChatGPT Shopping oder einer KI-Suche?",
        a: "Eine normale KI-Suche liefert oft allgemeine Produktlinks, veraltete Preise oder ausverkaufte Größen. ShopCart ist ein KI Shopping Assistent, der Varianten, Preise und Verfügbarkeit direkt beim jeweiligen Shop ausliest und deine Wunschgrößen und Mengen in einen geprüften Warenkorb-Link verpackt."
      }
    ];
  }

  return [
    {
      q: "Does ShopCart place orders or charge my card automatically?",
      a: "No. ShopCart is strictly read-only: your AI searches products, checks sizes, live prices, and stock, and hands you a ready-to-open cart link. You open the link in your own browser, review every item on the store's website, and complete checkout yourself."
    },
    {
      q: "How do I connect ShopCart to Claude or ChatGPT?",
      a: `Tap “Connect to Claude” or “Connect to ChatGPT”: your ShopCart link ${mcpUrl} is copied and your AI's connector settings open. Paste the link there as a custom connector and sign in once for free. For security reasons, a website cannot install a connector fully automatically, so it takes two clicks instead of one. After that, tap “Start in Claude” or “Start in ChatGPT” and your Claude shopping cart or ChatGPT shopping session is one sentence away.`
    },
    {
      q: "Which online stores work with ShopCart?",
      a: "ShopCart works with public Shopify online stores worldwide across EUR, USD, GBP, CHF, and other currencies. That covers many direct-to-consumer brands across apparel, gear, gifts, food, and lifestyle, for example Allbirds, SNOCKS, or GOT BAG. Password-protected storefronts and closed marketplaces like Amazon are not supported."
    },
    {
      q: "How much does ShopCart cost?",
      a: `The Free plan includes ${free} store lookups per day, permanently free. For heavier shopping sessions, the Pro plan offers ${pro} lookups per day for €9 per month.${
        promoActive
          ? ` During the Black Friday launch promo through ${promoEnd}, every signed-in account automatically gets ${pro} lookups per day for free.`
          : ""
      } The open-source version for local apps is free and unlimited under the MIT License.`
    },
    {
      q: "What data does ShopCart store about my shopping?",
      a: "ShopCart never stores your chat transcripts, shipping addresses, store logins, or payment details. Hosted accounts run in the EU and store only your account email, hashed credentials, and a numeric daily usage counter. If you run the open-source version locally, zero data is sent to wals.pro."
    },
    {
      q: "How is ShopCart different from regular ChatGPT shopping or AI web search?",
      a: "Regular AI web search often returns generic links, stale prices, or sold-out sizes. ShopCart is an AI shopping assistant that reads variants, stock status, and real prices directly from the store, then generates a verified cart link preloaded with your chosen sizes and quantities."
    }
  ];
}

// ---------------------------------------------------------------------------
// Schema.org JSON-LD (@graph: Organization, WebSite, SoftwareApplication, FAQPage, HowTo)
// ---------------------------------------------------------------------------

export function buildJsonLd(config: AppConfig, lang: Lang): Record<string, unknown> {
  const origin = config.appOrigin;
  const pageUrl = `${origin}/?lang=${lang}`;
  const de = lang === "de";
  const faq = getFaq(config, lang);
  const howTo = getHowTo(lang);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://wals.pro/#organization",
        name: "wals.pro",
        legalName: "Wals Professional Services GmbH",
        url: "https://wals.pro"
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: origin,
        name: "ShopCart",
        inLanguage: ["de", "en"],
        publisher: { "@id": "https://wals.pro/#organization" }
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#software`,
        name: "ShopCart",
        alternateName: ["ShopCart MCP", "shopcart-mcp"],
        url: pageUrl,
        image: `${origin}/icon-512.png`,
        inLanguage: lang,
        applicationCategory: "ShoppingApplication",
        applicationSubCategory: de ? "KI Shopping Assistent" : "AI shopping assistant",
        operatingSystem: "Web, iOS, Android, macOS, Windows, Linux",
        description: de
          ? "ShopCart ist ein KI Shopping Assistent für Claude, ChatGPT und andere KI-Tools: Er findet echte Produkte, Größen und Preise in Shopify-Onlineshops und liefert einen fertigen Warenkorb-Link. Rein lesend, du prüfst und bezahlst selbst."
          : "ShopCart is an AI shopping assistant for Claude, ChatGPT, and other AI tools: it finds real products, sizes, and prices in Shopify online stores and returns a ready-to-review cart link. Strictly read-only, you review and pay yourself.",
        featureList: de
          ? [
              "Produktsuche in öffentlichen Shopify-Onlineshops",
              "Live-Prüfung von Größen, Varianten, Preisen und Verfügbarkeit",
              "Fertiger Warenkorb-Link zum Prüfen im Shop",
              "Rein lesend: keine automatischen Käufe, keine Zahlungsdaten"
            ]
          : [
              "Product search in public Shopify online stores",
              "Live check of sizes, variants, prices, and stock",
              "Ready-to-review cart link on the store's own website",
              "Strictly read-only: no automatic purchases, no payment details"
            ],
        offers: [
          {
            "@type": "Offer",
            name: "Free",
            price: "0",
            priceCurrency: "EUR",
            description: de
              ? `${config.freeDailyLimit} Shop-Abfragen pro Tag`
              : `${config.freeDailyLimit} store lookups per day`
          },
          {
            "@type": "Offer",
            name: "Pro",
            price: "9",
            priceCurrency: "EUR",
            description: de
              ? `${config.proDailyLimit} Shop-Abfragen pro Tag, monatlich kündbar`
              : `${config.proDailyLimit} store lookups per day, cancel monthly`
          }
        ],
        license: "https://opensource.org/license/mit",
        codeRepository: config.repoUrl,
        softwareVersion: config.version,
        publisher: { "@id": "https://wals.pro/#organization" }
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        inLanguage: lang,
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a }
        }))
      },
      {
        "@type": "HowTo",
        "@id": `${pageUrl}#how`,
        inLanguage: lang,
        name: howTo.name,
        description: howTo.description,
        totalTime: "PT30S",
        step: howTo.steps.map((step, idx) => ({
          "@type": "HowToStep",
          position: idx + 1,
          name: step.name,
          text: step.text,
          url: `${pageUrl}#how`
        }))
      }
    ]
  };
}

/** Serialize JSON-LD safely for inline embedding inside a <script type="application/ld+json"> block. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
