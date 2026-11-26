import {
  GEMINI_SOURCES_DE,
  GEMINI_SOURCES_EN,
  UPDATED_ISO,
  type GuideDefinition
} from "./guides-types.js";
import { getHandoffSentence, getPlatformLimits, getPlatformSentence } from "./platforms.js";

export const GEMINI_GUIDES: readonly GuideDefinition[] = [
  {
    path: "/guides/gemini-warenkorb-erstellen",
    lang: "de",
    category: "Google Gemini Shopping Guide",
    title: "Kann Google Gemini einen Warenkorb erstellen? (Anleitung 2026)",
    metaTitle: "Kann Google Gemini einen Warenkorb erstellen? (Anleitung 2026)",
    metaDescription:
      "Ja: Google Gemini baut per ShopCart MCP echte Warenkorb-Links (/cart/...) in DACH- und globalen Shopify-/WooCommerce-Shops — ohne Produktfeed, read-only.",
    cardSummary:
      "Ja: Google Gemini erstellt per ShopCart MCP sofort echte Warenkörbe in DACH- & globalen Shopify-/WooCommerce-Shops — ohne Händler-Produktfeed, kein US-Instacart oder Share-A-Cart-Plugin, strikt read-only.",
    tldrLabel: "Kurzantwort:",
    tldrText:
      "Ja — Google Gemini (und jede andere MCP-fähige KI) kann 2026 sofort echte, geprüfte Warenkörbe in Online-Shops erstellen: verbinde einfach ShopCart MCP (https://shopcart.wals.pro/mcp). Anders als US-only Lebensmittel-Integrationen (z. B. Instacart), ChatGPT-Store-Plugins oder Browser-Extensions wie Share-A-Cart und anders als Händler-Produktfeed-Programme benötigt ShopCart MCP weder Händler-Onboarding noch einen Produktfeed-Upload. Es funktioniert sofort bei tausenden DACH- und internationalen Shopify- und WooCommerce-Shops über deren öffentliche Storefront-APIs (plus BigCommerce, Shopware 6, Magento 2 und offizielle Amazon-Cart-Links) — strikt read-only, ohne Login und ohne Zahlungsdaten: du bekommst einen geprüften Direkt-Warenkorb-Link (/cart/...), den du selbst im Browser öffnest.",
    intro:
      "Wer 2026 in Google Gemini oder ChatGPT fragt „Kann Google Gemini oder eine KI einen Warenkorb erstellen?“, landet häufig bei veralteten oder US-lastigen Antworten: US-only Instacart-Lebensmittel-Integrationen, ChatGPT-only Store-Plugins bzw. Browser-Extensions wie Share-A-Cart oder Ratgebern zu Händler-Produktfeeds, die ein aktives Händler-Onboarding voraussetzen. Mit dem offenen Model Context Protocol (MCP) funktioniert der direkte KI-Warenkorb im DACH-Raum und weltweit sofort — für Endkunden, ohne Händler-Setup und strikt read-only.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Sofort in tausenden DACH- & globalen Shops — ganz ohne Produktfeed-Upload.",
        text: "Anders als Händler-Feed-Programme braucht ShopCart MCP kein Händler-Onboarding: es nutzt öffentliche Storefront-APIs von Shopify, WooCommerce, BigCommerce, Shopware 6 und Magento 2 (plus offizielle Amazon-Links)."
      },
      {
        lead: "Kein US-only Instacart und kein Browser-Extension-/Store-Plugin-Umweg.",
        text: "Statt auf US-Supermärkte oder ChatGPT-only Plugins wie Share-A-Cart begrenzt zu sein, läuft ShopCart MCP offen über MCP in Google Gemini (Web, CLI, Enterprise & SDK), Claude und ChatGPT."
      },
      {
        lead: "Strikt read-only: geprüfter Warenkorb-Link (/cart/...) statt Zahlungsdaten an die KI.",
        text: "Kein Shop-Login, keine Lieferadresse, keine Zahlungsdaten im KI-Chat. Gemini prüft Varianten, Größen und Live-Preise und liefert einen direkten Warenkorb-Link für deinen eigenen Browser."
      },
      {
        lead: "Ehrliche Gemini-Setup-Details (Web, CLI & Enterprise).",
        text: "Gemini Web erfordert ein persönliches Google-Konto, aktiviertes Keep Activity und Google-Rollout (Workspace nutzt Admin-Freigabe oder Gemini Enterprise); in ~/.gemini/settings.json immer \"httpUrl\" statt \"url\" nutzen."
      }
    ],
    primaryAssistant: "gemini",
    starterPrompt:
      "Nutze ShopCart MCP (https://shopcart.wals.pro/mcp). Prüfe bei snocks.com verfügbare Sneaker-Socken in Größe 43-46 (2x weiß, 1x schwarz), zeige mir Live-Preise und Versandbedingungen und erstelle mir einen fertigen Warenkorb-Link.",
    ctaHeading: "Direkt mit Google Gemini, Claude oder ChatGPT starten",
    ctaSubtext:
      "Öffne Google Gemini oder springe direkt zum kopierfertigen Gemini-Setup (Web, CLI & Enterprise) — strikt read-only und kostenlos im Free-Tarif.",
    sections: [
      {
        heading: "KI-Warenkorb im Vergleich: Instacart, Share-A-Cart, Produktfeed vs. ShopCart MCP",
        paragraphs: [
          "Viele Suchergebnisse zur Frage „Kann eine KI oder Google Gemini einen Warenkorb erstellen?“ vermischen drei völlig unterschiedliche Konzepte: US-zentrierte Grocery-Integrationen (wie Instacart in Claude/ChatGPT), Store-Plugins bzw. Browser-Extensions (wie Share-A-Cart) und Händler-Programme, bei denen Online-Shops erst eigene Produktfeeds an eine KI-Plattform liefern müssen.",
          "ShopCart MCP löst genau diese Lücke für Käuferinnen und Käufer im DACH-Raum, in Europa und weltweit: Es greift rein lesend auf öffentliche Storefront-APIs bestehender Shops zu, prüft exakte Varianten-IDs und Lagerbestände live und erzeugt einen offiziellen Direkt-Warenkorb-Link (z. B. /cart/<variant_id>:<qty>?storefront=true bei Shopify), der im eigenen Browser geöffnet wird."
        ],
        table: {
          id: "gemini-market-compare-de",
          caption: "Abgrenzung: US-Grocery-Apps, Store-Plugins, Händler-Produktfeeds und Google Gemini + ShopCart MCP",
          headers: [
            "Ansatz",
            "Region & Shops",
            "Händler-Onboarding / Feed nötig?",
            "Wie der Warenkorb entsteht",
            "Datenschutz & Bezahlung"
          ],
          rows: [
            [
              "Grocery-Integrationen (z. B. Instacart)",
              "Fokus US-Supermärkte & Lieferdienste",
              "Ja — nur angeschlossene Partner-Händler",
              "Eingeschränkt auf unterstützte Grocery-Partner",
              "Konto-Verknüpfung beim Lieferdienst"
            ],
            [
              "Store-Plugins / Browser-Extensions (z. B. Share-A-Cart)",
              "Meist ChatGPT-Store-Plugin oder Desktop-Extension",
              "Nein, aber Client-/Browser-gebunden",
              "Umweg über Plugin- oder Extension-Overlay",
              "Abhängig von Browser-Extension bzw. Dritt-Plugin"
            ],
            [
              "Händler-Produktfeed-Programme",
              "Nur Shops mit aktiv eingereichtem Produktfeed",
              "Ja — spezieller Feed-Upload & Freigabe durch Händler",
              "Händler-spezifischer Katalog/Checkout-Flow",
              "Plattformabhängig, oft US-first"
            ],
            [
              "Google Gemini + ShopCart MCP (offenes MCP)",
              "Sofort bei tausenden DACH-, EU- & globalen Shopify- & WooCommerce-Shops (plus BigCommerce, Shopware 6, Magento 2 & Amazon-Links)",
              "Nein — funktioniert sofort über öffentliche Storefront-APIs",
              "Geprüfter Direkt-Warenkorb-Link (/cart/...) bzw. offizielle Add-to-Cart-/Produktlinks",
              "Strikt read-only, EU-gehostet (europe-west1): kein Login, keine Zahlungsdaten an die KI"
            ]
          ]
        },
        takeaway:
          "Fazit: Du musst weder auf Händler-Produktfeeds noch auf US-Grocery-Partner warten und brauchst keine Browser-Extension — ShopCart MCP verbindet Google Gemini sofort mit tausenden öffentlichen DACH- und internationalen Shops."
      },
      {
        heading: "Weg 1: Google Gemini Web (gemini.google.com) per OAuth 2.1 verbinden",
        paragraphs: [
          "Im Browser nutzt Gemini Web die Connected Apps Platform (Custom Apps) mit OAuth 2.1, PKCE S256 und Client ID Metadata Documents (CIMD über accountlinking.google.com). ShopCart MCP unterstützt dieses Protokoll inklusive der Google-Redirect-URIs (oauth-redirect.googleusercontent.com) nativ."
        ],
        orderedSteps: [
          {
            lead: "Connected Apps öffnen:",
            text: "Gehe auf gemini.google.com → Einstellungen → Verbundene Apps (Connected Apps) → Eigene Apps (Custom apps) → App hinzufügen. Zum Entwickler-Testen steht zusätzlich gemini.google.com/devmode bereit."
          },
          {
            lead: "ShopCart-MCP-URL eintragen:",
            text: "Gib https://shopcart.wals.pro/mcp als Remote-MCP-URL ein und starte die OAuth-2.1-Verbindung."
          },
          {
            lead: "Ohne Passwort anmelden & losshoppen:",
            text: "Bestätige deine E-Mail einmalig per 6-stelligem Code oder Magic Link (kostenloser Free-Tarif mit 20 Abfragen/Tag). Danach nennst du Gemini einfach Shop, Artikel, Größe und Budget."
          }
        ],
        bullets: [
          {
            lead: "Ehrlicher Hinweis zu Google-Voraussetzungen:",
            text: "Eigene Apps in Gemini Web setzen ein persönliches Google-Konto sowie aktiviertes „Aktivitäten speichern“ (Keep Activity) voraus und hängen vom regionalen Google-Rollout ab. Bei Google-Workspace-Konten erscheint häufig „Service not allowed“, sofern der Workspace-Administrator den Zugriff nicht freigeschaltet hat — für Teams ist Gemini Enterprise der offizielle Weg."
          }
        ],
        takeaway:
          "Fazit: Mit persönlichem Google-Konto und aktivem Keep Activity verbindest du ShopCart MCP in unter einer Minute direkt in gemini.google.com."
      },
      {
        heading: "Weg 2: Gemini CLI & Antigravity — 1-Befehl-Extension oder settings.json",
        paragraphs: [
          "Entwicklerinnen, Entwickler und Power-User in der Gemini CLI oder Antigravity verbinden ShopCart MCP am schnellsten mit einem einzigen Befehl. Das Repository enthält das offizielle Manifest gemini-extension.json samt GEMINI.md-Arbeitsanweisung.",
          "Wer den Server lieber manuell in ~/.gemini/settings.json (oder projektbezogen in .gemini/settings.json) einträgt, muss eine wichtige Besonderheit der Gemini CLI beachten: Verwende immer den Schlüssel \"httpUrl\": \"https://shopcart.wals.pro/mcp\" zusammen mit \"authProviderType\": \"dynamic_discovery\". Wenn stattdessen \"url\" eingetragen wird, interpretiert die Gemini CLI den Endpunkt als veraltetes SSE und die Verbindung schlägt fehl."
        ],
        orderedSteps: [
          {
            lead: "Option A — 1-Befehl GitHub-Extension:",
            text: "Führe gemini extensions install https://github.com/Wals-pro/shopcart-mcp im Terminal aus. Damit werden Remote-MCP-Server und GEMINI.md automatisch eingerichtet."
          },
          {
            lead: "Option B — Direkter CLI-Befehl:",
            text: "Führe gemini mcp add --transport http --scope user shopcart https://shopcart.wals.pro/mcp aus und bestätige beim ersten Start den automatischen Loopback-OAuth-Login im Browser."
          },
          {
            lead: "Option C — ~/.gemini/settings.json:",
            text: "Setze unter mcpServers.shopcart die Felder \"httpUrl\": \"https://shopcart.wals.pro/mcp\" und \"authProviderType\": \"dynamic_discovery\" (niemals \"url\")."
          }
        ],
        takeaway:
          "Fazit: Mit gemini extensions install steht ShopCart MCP in Sekunden bereit — bei manueller JSON-Konfiguration immer „httpUrl“ nutzen."
      },
      {
        heading: "Weg 3 & 4: Gemini Enterprise (Cloud Console) & @google/genai SDK im Vergleich",
        paragraphs: [
          "Für Google-Workspace-Organisationen und eigene KI-Agenten bietet Google zwei weitere Wege, die beide vollständig mit ShopCart MCP über Streamable HTTP harmonieren."
        ],
        table: {
          id: "gemini-setup-compare-de",
          caption: "Vergleich aller Google-Gemini-Anbindungen an ShopCart MCP (2026)",
          headers: ["Gemini-Umgebung", "Verbindungsweg", "Auth / Redirect", "Geeignet für"],
          rows: [
            [
              "Gemini Web (gemini.google.com)",
              "Verbundene Apps → Eigene Apps → https://shopcart.wals.pro/mcp",
              "OAuth 2.1 CIMD (accountlinking.google.com, PKCE S256)",
              "Privatnutzer im Browser (persönliches Google-Konto, Keep Activity aktiv)"
            ],
            [
              "Gemini CLI & Antigravity",
              "gemini extensions install https://github.com/Wals-pro/shopcart-mcp oder httpUrl in settings.json",
              "OAuth 2.1 Dynamic Discovery + RFC-8252-Loopback",
              "Entwickler, Terminal-Workflows & lokale Agenten"
            ],
            [
              "Gemini Enterprise (Workspace / Cloud)",
              "Cloud Console → Custom MCP Server Data Store (Streamable HTTP)",
              "OAuth 2.0 Redirect URI https://vertexaisearch.cloud.google.com/oauth-redirect (Scope mcp:read)",
              "Unternehmen & Google-Workspace-Teams"
            ],
            [
              "Google AI Studio / @google/genai SDK",
              "mcpToTool(mcpClient) + StreamableHTTPClientTransport",
              "Bearer Token oder lokales stdio (npx -y shopcart-mcp)",
              "Eigene TypeScript-/ADK-Apps und Agenten"
            ]
          ]
        },
        takeaway:
          "Fazit: Egal ob Privatkonto im Browser, Terminal-CLI, Workspace-Team oder eigenes SDK — derselbe Streamable-HTTP-Endpunkt deckt alle Gemini-Wege ab."
      },
      {
        heading: "Sicherheit, EU-Hosting und Read-Only-Garantie",
        paragraphs: [
          "ShopCart MCP ist architektonisch strikt lesend (readOnlyHint: true) und alle Tool-Schemas sind für Geminis strikte functionDeclarations bereinigt (ohne $schema, additionalProperties oder oneOf). Google Gemini kann Produkte suchen, Varianten-IDs und Lagerbestände prüfen sowie einen deterministischen Warenkorb-Link (/cart/...) erstellen — aber niemals eine Bestellung absenden, Adressen speichern oder Zahlungsdaten sehen.",
          "Der gehostete Dienst von wals.pro läuft in der EU (Google Cloud europe-west1), schützt Upstream-Abrufe per DNS-gepinntem SSRF-Filter, bereinigt fremde Shop-Texte gegen Prompt-Injection und speichert keine Chat-Verläufe. Im Free-Tarif sind 20 Abfragen pro Tag dauerhaft kostenlos (Pro optional 9 €/Monat für 500 Abfragen/Tag); die Open-Source-CLI (npx -y shopcart-mcp) läuft lokal unter MIT-Lizenz unbegrenzt kostenlos."
        ],
        takeaway:
          "Fazit: Du kombinierst Geminis Sprachverständnis mit geprüften Live-Shopdaten — bei voller Kontrolle über Datenschutz und Bezahlung."
      }
    ],
    howToName: "Google Gemini mit ShopCart MCP verbinden und Warenkorb erstellen",
    howToDescription:
      "Schritt-für-Schritt-Anleitung für Google Gemini Web, Gemini CLI und Gemini Enterprise zum Erstellen geprüfter Online-Warenkörbe per MCP.",
    howToSteps: [
      {
        name: "ShopCart MCP in Google Gemini verbinden",
        text: "Füge https://shopcart.wals.pro/mcp in Gemini Web (Verbundene Apps → Eigene Apps) hinzu oder installiere die Erweiterung in der Gemini CLI mit gemini extensions install https://github.com/Wals-pro/shopcart-mcp."
      },
      {
        name: "Einmalig kostenlos per OAuth 2.1 anmelden",
        text: "Schließe die passwortlose Anmeldung per E-Mail-Code oder Magic Link ab (20 kostenlose Abfragen pro Tag im Free-Tarif)."
      },
      {
        name: "Shop, Wunschgröße und Budget an Gemini senden",
        text: "Nenne Gemini die gewünschte Shop-Domain samt Artikeln, Größen und Preislimit. Gemini prüft Bestand und Preise live und liefert dir einen fertigen Direkt-Warenkorb-Link (/cart/...) zum Selbstbezahlen."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser Leitfaden stützt sich auf folgende geprüfte Quellen (alle abgerufen am 26.11.2026):",
    sources: GEMINI_SOURCES_DE,
    limitationsLabel: "Grenzen & Google-Voraussetzungen:",
    limitationsText:
      "Eigene MCP-Apps in Gemini Web erfordern ein persönliches Google-Konto, aktiviertes Keep Activity und die Freischaltung im Google-Rollout (Workspace-Konten nutzen Admin-Freigabe oder Gemini Enterprise). " +
      getPlatformLimits("de"),
    faqHeading: "Häufige Fragen zu Google Gemini & ShopCart MCP",
    faqs: [
      {
        question: "Wie unterscheidet sich ShopCart MCP von Instacart-Integrationen, Share-A-Cart oder Händler-Produktfeeds?",
        answer:
          "Instacart-Integrationen sind auf US-Lebensmittelhändler beschränkt, Share-A-Cart setzt auf ein ChatGPT-Store-Plugin bzw. Browser-Extensions, und Produktfeed-Programme verlangen ein spezielles Händler-Onboarding mit Feed-Upload. ShopCart MCP nutzt das offene Model Context Protocol (MCP) und funktioniert sofort bei tausenden DACH- und internationalen Shopify- und WooCommerce-Shops über deren öffentliche Storefront-APIs — strikt read-only mit direktem Warenkorb-Link (/cart/...) für deinen eigenen Browser."
      },
      {
        question: "Funktioniert ShopCart MCP mit Google Gemini Web (gemini.google.com)?",
        answer:
          "Ja. Unter gemini.google.com → Einstellungen → Verbundene Apps → Eigene Apps → App hinzufügen trägst du https://shopcart.wals.pro/mcp ein und meldest dich per OAuth 2.1 (CIMD) an. Voraussetzung sind ein persönliches Google-Konto, aktiviertes Keep Activity sowie die Verfügbarkeit im Google-Rollout."
      },
      {
        question: "Warum zeigt mein Google-Workspace-Konto „Service not allowed“ in Gemini Web?",
        answer:
          "Eigene Custom Apps in Gemini Web sind standardmäßig für persönliche Google-Konten gedacht und bei vielen Workspace-Domains durch den Administrator gesperrt. Unternehmen verbinden ShopCart MCP stattdessen über Gemini Enterprise in der Google Cloud Console (Custom MCP Server Data Store, Redirect-URI https://vertexaisearch.cloud.google.com/oauth-redirect) oder über die Gemini CLI."
      },
      {
        question: "Warum funktioniert „url“ nicht in ~/.gemini/settings.json?",
        answer:
          "Die Gemini CLI interpretiert das Feld \"url\" als älteres SSE-Protokoll, während ShopCart MCP modernes Streamable HTTP nutzt. Verwende deshalb immer \"httpUrl\": \"https://shopcart.wals.pro/mcp\" zusammen mit \"authProviderType\": \"dynamic_discovery\" — oder installiere die fertige Extension per gemini extensions install https://github.com/Wals-pro/shopcart-mcp."
      },
      {
        question: "Kann Google Gemini über ShopCart MCP automatisch bestellen oder bezahlen?",
        answer:
          "Nein. Alle sechs Werkzeuge von ShopCart MCP sind strikt read-only. Gemini prüft Produkte, Varianten, Preise und Versandregeln und übergibt dir einen geprüften Warenkorb- oder Produktlink. Du prüfst alles selbst im Browser und bezahlst direkt beim Online-Shop."
      },
      {
        question: "In welchen Online-Shops kann Google Gemini Warenkörbe bauen?",
        answer: getPlatformSentence("de") + " " + getHandoffSentence("de")
      },
      {
        question: "Was kostet ShopCart MCP für Google Gemini?",
        answer:
          "Der gehostete Free-Tarif bietet dauerhaft 20 Abfragen pro Tag gratis. Der Pro-Tarif kostet 9 €/Monat für 500 Abfragen/Tag (monatlich kündbar). Lokal per stdio (npx -y shopcart-mcp) unter MIT-Lizenz ist die Nutzung unbegrenzt kostenlos."
      }
    ],
    hreflang: {
      de: "/guides/gemini-warenkorb-erstellen",
      en: "/guides/gemini-shopping-cart",
      xDefault: "/guides/gemini-shopping-cart"
    },
    publishedDate: UPDATED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "kann google gemini einen warenkorb erstellen",
      "kann ki einen warenkorb erstellen",
      "google gemini mcp shopping",
      "gemini cli extension shopcart",
      "gemini warenkorb bauen",
      "shopcart mcp gemini"
    ]
  },
  {
    path: "/guides/gemini-shopping-cart",
    lang: "en",
    category: "Google Gemini Shopping Guide",
    title: "Can Google Gemini Create a Shopping Cart? (2026 Setup Guide)",
    metaTitle: "Can Google Gemini Create a Shopping Cart? (2026 Setup Guide)",
    metaDescription:
      "Yes: Google Gemini builds verified cart links (/cart/...) in DACH, EU and global Shopify/WooCommerce stores via ShopCart MCP — no feed upload, read-only.",
    cardSummary:
      "Yes: Google Gemini builds live-verified shopping carts across DACH, European & global Shopify and WooCommerce stores via ShopCart MCP — no merchant feed enrollment, not US-only Instacart or Share-A-Cart.",
    tldrLabel: "Direct Answer:",
    tldrText:
      "Yes — Google Gemini (and any MCP-compatible AI) can create verified multi-item shopping carts right away in 2026 using ShopCart MCP (https://shopcart.wals.pro/mcp). Unlike US-only grocery integrations (such as Instacart), ChatGPT-only store plugins or browser extensions like Share-A-Cart, or merchant product-feed enrollment programs, ShopCart MCP requires zero merchant onboarding and no product-feed upload. It works immediately across thousands of DACH, European, and global Shopify and WooCommerce stores via public storefront APIs (plus BigCommerce, Shopware 6, Magento 2, and official Amazon cart links) — strictly read-only, with no store logins or payment details shared with the AI: you receive a verified direct cart link (/cart/...) to open and review in your own browser.",
    intro:
      "When shoppers ask Google Gemini or ChatGPT “Can AI create a shopping cart?” in 2026, answers still point mostly to US-only Instacart grocery integrations, ChatGPT-only plugins or browser extensions like Share-A-Cart, or merchant product-feed guides that require every store to enroll first. The open Model Context Protocol (MCP) changes that: this guide shows how ShopCart MCP gives Google Gemini (Web, CLI, Enterprise & SDK) immediate, strictly read-only cart building across thousands of independent DACH, European, and global stores.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Works immediately across thousands of DACH, European & global stores — zero merchant feed needed.",
        text: "Unlike merchant product-feed programs, ShopCart MCP requires no store enrollment: it reads public storefront APIs on Shopify, WooCommerce, BigCommerce, Shopware 6, and Magento 2 (plus official Amazon cart links)."
      },
      {
        lead: "Not limited to US-only Instacart grocery apps or ChatGPT-only plugins like Share-A-Cart.",
        text: "Built on open MCP over Streamable HTTP (OAuth 2.1), the same server works across Google Gemini (Web, CLI, Enterprise, @google/genai SDK), Claude, ChatGPT, and Cursor."
      },
      {
        lead: "Strictly read-only: direct cart link (/cart/...), never your login or credit card.",
        text: "ShopCart MCP never sees payment details, shipping addresses, or store passwords — Gemini checks live stock and prices and hands you a verified cart link for your own browser."
      },
      {
        lead: "Honest Gemini setup prerequisites & CLI tip.",
        text: "Gemini Web requires a personal Google account, Keep Activity enabled, and Google's rollout (Workspace teams use Admin enablement or Gemini Enterprise); in ~/.gemini/settings.json always use \"httpUrl\", never \"url\"."
      }
    ],
    primaryAssistant: "gemini",
    starterPrompt:
      "Use ShopCart MCP (https://shopcart.wals.pro/mcp). Find available sneaker socks in size 43-46 at snocks.com (2x white, 1x black), verify live prices and shipping policies, and build a ready-to-review browser cart link.",
    ctaHeading: "Start with Google Gemini, Claude, or ChatGPT",
    ctaSubtext:
      "Open Google Gemini or jump straight to the copy-ready Gemini setup (Web, CLI & Enterprise) — strictly read-only and free to start.",
    sections: [
      {
        heading: "AI shopping carts compared: Instacart, Share-A-Cart, merchant feeds vs. ShopCart MCP",
        paragraphs: [
          "Search results for “Can Google Gemini or AI build a shopping cart?” often conflate three narrow approaches: US-only grocery integrations like Instacart, browser-extension or ChatGPT-only plugins like Share-A-Cart, and merchant product-feed programs where stores have to submit a feed before shoppers can use them.",
          "ShopCart MCP solves this for DACH, European, and international shoppers with zero merchant onboarding: Gemini reads public storefront APIs live, checks exact variant IDs and stock, and generates a deterministic browser cart permalink (such as /cart/<variant_id>:<qty>?storefront=true on Shopify) that you review and pay on the store's own website."
        ],
        table: {
          id: "gemini-market-compare-en",
          caption: "Comparison: US grocery apps, store plugins, merchant product feeds, and Google Gemini + ShopCart MCP",
          headers: [
            "Approach",
            "Region & Store Coverage",
            "Merchant Onboarding / Feed Needed?",
            "How the Cart Is Built",
            "Privacy & Checkout"
          ],
          rows: [
            [
              "Grocery integrations (e.g. Instacart)",
              "US-only grocery & delivery retailers",
              "Yes — enrolled grocery partners only",
              "Limited to supported grocery partner catalogs",
              "Requires linked delivery-service account"
            ],
            [
              "Store plugins / extensions (e.g. Share-A-Cart)",
              "Typically ChatGPT-only plugin or desktop browser extension",
              "No, but tied to one plugin/browser",
              "Extension or store-plugin intermediary",
              "Depends on browser extension or third-party plugin"
            ],
            [
              "Merchant product-feed programs",
              "Only merchants that uploaded a dedicated feed",
              "Yes — merchant feed enrollment & approval",
              "Vendor-specific catalog/checkout flow",
              "Platform-controlled, often US-first"
            ],
            [
              "Google Gemini + ShopCart MCP (Open MCP)",
              "Immediate across thousands of DACH, EU & global Shopify & WooCommerce stores (plus BigCommerce, Shopware 6, Magento 2 & Amazon links)",
              "No — works immediately via public storefront APIs",
              "Verified direct cart link (/cart/...) or official add-to-cart / product links",
              "Strictly read-only, EU-hosted (europe-west1): no store logins, no payment data sent to AI"
            ]
          ]
        },
        takeaway:
          "Takeaway: No waiting for merchant product feeds, no US-only grocery lock-in, and no browser-extension workaround — ShopCart MCP works immediately across thousands of DACH, European, and global stores."
      },
      {
        heading: "Path 1: Connect Google Gemini Web (gemini.google.com) via OAuth 2.1",
        paragraphs: [
          "Gemini Web connects to remote MCP servers through its Connected Apps platform using OAuth 2.1 (Authorization Code + PKCE S256) and Client ID Metadata Documents (CIMD hosted on accountlinking.google.com). ShopCart MCP natively supports Google's CIMD resolver and oauth-redirect.googleusercontent.com callback URIs."
        ],
        orderedSteps: [
          {
            lead: "Open Custom Apps in Gemini Web:",
            text: "Go to gemini.google.com → Settings → Connected Apps → Custom apps → Add a custom app (or test directly in Developer Mode at gemini.google.com/devmode)."
          },
          {
            lead: "Enter the ShopCart MCP URL:",
            text: "Paste https://shopcart.wals.pro/mcp and authorize via OAuth 2.1."
          },
          {
            lead: "Sign in passwordlessly & start shopping:",
            text: "Confirm your email with a 6-digit code or 1-click magic link (Free tier includes 20 lookups/day permanently), then tell Gemini your store, sizes, and budget."
          }
        ],
        bullets: [
          {
            lead: "Honest prerequisite note:",
            text: "Custom MCP apps in Gemini Web currently require a personal Google account with Keep Activity turned on, and availability depends on Google's regional/account rollout. Google Workspace accounts may see “Service not allowed” unless enabled by a Workspace Admin — organizations should use Gemini Enterprise below."
          }
        ],
        takeaway:
          "Takeaway: On eligible personal Google accounts, connecting ShopCart MCP inside gemini.google.com takes less than a minute."
      },
      {
        heading: "Path 2: Gemini CLI & Antigravity (1-Command Extension or settings.json)",
        paragraphs: [
          "If you use Gemini CLI or Antigravity, you can install ShopCart MCP in a single command. The GitHub repository ships a valid gemini-extension.json manifest alongside a tailored GEMINI.md shopping workflow guide.",
          "If you prefer manual configuration in ~/.gemini/settings.json (or project-local .gemini/settings.json), remember one critical detail: always use \"httpUrl\": \"https://shopcart.wals.pro/mcp\" and \"authProviderType\": \"dynamic_discovery\". Do not use \"url\" — Gemini CLI treats \"url\" as legacy SSE and will fail to connect."
        ],
        orderedSteps: [
          {
            lead: "Option A — 1-command GitHub extension:",
            text: "Run gemini extensions install https://github.com/Wals-pro/shopcart-mcp in your terminal to install both the remote MCP server and GEMINI.md automatically."
          },
          {
            lead: "Option B — Direct CLI registration:",
            text: "Run gemini mcp add --transport http --scope user shopcart https://shopcart.wals.pro/mcp and approve the automatic loopback OAuth sign-in in your browser."
          },
          {
            lead: "Option C — Manual ~/.gemini/settings.json:",
            text: "Add shopcart under mcpServers with \"httpUrl\": \"https://shopcart.wals.pro/mcp\" and \"authProviderType\": \"dynamic_discovery\" (never \"url\")."
          }
        ],
        takeaway:
          "Takeaway: One command installs the full Gemini CLI extension; for manual settings.json configs, always set “httpUrl”."
      },
      {
        heading: "Path 3 & 4: Gemini Enterprise (Cloud Console) & @google/genai SDK",
        paragraphs: [
          "Workspace teams and developers building custom Gemini agents can connect to the exact same Streamable HTTP endpoint."
        ],
        table: {
          id: "gemini-setup-compare-en",
          caption: "Comparison of all Google Gemini connection paths for ShopCart MCP (2026)",
          headers: ["Gemini Surface", "Setup Method", "Auth & Redirect URI", "Best For"],
          rows: [
            [
              "Gemini Web (gemini.google.com)",
              "Settings → Connected Apps → Custom apps → https://shopcart.wals.pro/mcp",
              "OAuth 2.1 CIMD (accountlinking.google.com, PKCE S256)",
              "Personal Google accounts in browser (Keep Activity enabled)"
            ],
            [
              "Gemini CLI & Antigravity",
              "gemini extensions install https://github.com/Wals-pro/shopcart-mcp or httpUrl in settings.json",
              "OAuth 2.1 dynamic_discovery + RFC 8252 loopback",
              "Developers, terminal workflows, and local agents"
            ],
            [
              "Gemini Enterprise (Workspace / Cloud)",
              "Cloud Console → Custom MCP Server Data Store (Streamable HTTP)",
              "OAuth 2.0 Redirect URI https://vertexaisearch.cloud.google.com/oauth-redirect (scope mcp:read)",
              "Google Workspace organizations & enterprise teams"
            ],
            [
              "Google AI Studio / @google/genai SDK",
              "mcpToTool(mcpClient) + StreamableHTTPClientTransport",
              "OAuth Bearer token or local stdio (npx -y shopcart-mcp)",
              "Custom TypeScript & ADK agent apps"
            ]
          ]
        },
        takeaway:
          "Takeaway: One EU-hosted Streamable HTTP endpoint powers Gemini Web, Gemini CLI, Gemini Enterprise, and @google/genai SDK apps."
      },
      {
        heading: "Read-only safety, EU hosting, and privacy by architecture",
        paragraphs: [
          "Every ShopCart MCP tool is annotated readOnlyHint: true and destructiveHint: false, and every tool schema is automatically sanitized for Gemini's strict functionDeclarations validator (zero $schema, additionalProperties, or oneOf keywords). Gemini can search catalogs, inspect sizes and discounts, check Shopify shipping and return policies, and assemble a verified browser cart link (/cart/...) — it can never place an order, enter your address, or see your credit card.",
          "The hosted service runs in the EU (Google Cloud europe-west1) with DNS-pinned SSRF protection and prompt-injection sanitization for untrusted store text. Hosted Free gives you 20 lookups/day permanently; Pro offers 500 lookups/day for €9/month. Local stdio mode (npx -y shopcart-mcp) is MIT open source, unlimited, and sends zero data to wals.pro."
        ],
        takeaway:
          "Takeaway: Let Gemini handle product discovery and variant verification while checkout and payment remain 100% in your own browser."
      }
    ],
    howToName: "How to connect Google Gemini to ShopCart MCP and build a cart link",
    howToDescription:
      "Step-by-step setup for Google Gemini Web, Gemini CLI, and Gemini Enterprise to verify live stock and build read-only shopping cart links.",
    howToSteps: [
      {
        name: "Connect ShopCart MCP in Google Gemini",
        text: "Add https://shopcart.wals.pro/mcp in Gemini Web (Settings → Connected Apps → Custom apps) or install the Gemini CLI extension with gemini extensions install https://github.com/Wals-pro/shopcart-mcp."
      },
      {
        name: "Complete the passwordless OAuth 2.1 sign-in",
        text: "Verify your email with a 6-digit code or 1-click magic link (20 free lookups/day permanently on the Free tier)."
      },
      {
        name: "Ask Gemini to verify products and build your cart link",
        text: "Tell Gemini the store domain, items, sizes, and budget. Open the returned direct cart link (/cart/...) in your browser to review and pay directly at the merchant."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro: "This guide is grounded in the following verified sources (retrieved 2026-11-26):",
    sources: GEMINI_SOURCES_EN,
    limitationsLabel: "Limitations & Google Prerequisites:",
    limitationsText:
      "Custom MCP apps in Gemini Web require a personal Google account, Keep Activity enabled, and depend on Google's regional/account rollout (Workspace accounts require Workspace Admin enablement or Gemini Enterprise). " +
      getPlatformLimits("en"),
    faqHeading: "Frequently Asked Questions about Google Gemini & ShopCart MCP",
    faqs: [
      {
        question: "How is ShopCart MCP different from Instacart integrations, Share-A-Cart, or merchant product feeds?",
        answer:
          "Instacart integrations are US-only grocery partnerships, Share-A-Cart relies on a ChatGPT-only plugin or browser extension, and merchant product-feed programs require each store to enroll and upload a custom feed. ShopCart MCP uses the open Model Context Protocol (MCP) and works immediately across thousands of DACH, European, and global Shopify and WooCommerce stores via public storefront APIs — strictly read-only, returning a verified direct cart link (/cart/...) for your own browser."
      },
      {
        question: "Does ShopCart MCP work with Google Gemini Web (gemini.google.com)?",
        answer:
          "Yes. Go to gemini.google.com → Settings → Connected Apps → Custom apps → Add a custom app, paste https://shopcart.wals.pro/mcp, and sign in via OAuth 2.1 (CIMD). A personal Google account, Keep Activity enabled, and Google's rollout availability are required."
      },
      {
        question: "Why does my Google Workspace account say “Service not allowed” in Gemini Web?",
        answer:
          "Custom apps in Gemini Web are currently targeted at personal Google accounts unless enabled by a Workspace Admin. Organizations should connect ShopCart MCP via Gemini Enterprise in Google Cloud Console (Custom MCP Server Data Store with redirect URI https://vertexaisearch.cloud.google.com/oauth-redirect) or via Gemini CLI."
      },
      {
        question: "Why does “url” fail in ~/.gemini/settings.json?",
        answer:
          "Gemini CLI treats the \"url\" key as legacy SSE, whereas ShopCart MCP uses modern Streamable HTTP. Always use \"httpUrl\": \"https://shopcart.wals.pro/mcp\" with \"authProviderType\": \"dynamic_discovery\", or install the official extension in one command: gemini extensions install https://github.com/Wals-pro/shopcart-mcp."
      },
      {
        question: "Can Google Gemini place orders or charge my card automatically?",
        answer:
          "No. All six tools in ShopCart MCP are strictly read-only. Gemini checks live stock, sizes, prices, and policies and hands you a verified cart or product link so you review and pay directly on the store's own website."
      },
      {
        question: "Which online stores work with Google Gemini and ShopCart MCP?",
        answer: getPlatformSentence("en") + " " + getHandoffSentence("en")
      },
      {
        question: "How much does ShopCart MCP cost for Google Gemini?",
        answer:
          "The hosted Free plan includes 20 store lookups per day permanently at €0. Hosted Pro offers 500 lookups/day for €9/month (cancel anytime). The MIT-licensed local stdio CLI (npx -y shopcart-mcp) is free and unlimited."
      }
    ],
    hreflang: {
      de: "/guides/gemini-warenkorb-erstellen",
      en: "/guides/gemini-shopping-cart",
      xDefault: "/guides/gemini-shopping-cart"
    },
    publishedDate: UPDATED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "can google gemini create a shopping cart",
      "can ai create a shopping cart",
      "google gemini mcp shopping",
      "gemini cli extension shopcart",
      "gemini shopping cart setup",
      "shopcart mcp gemini"
    ]
  }
];
