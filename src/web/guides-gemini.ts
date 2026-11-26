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
      "Ja: Verbinde Google Gemini (Web, CLI, Enterprise) per OAuth 2.1 mit ShopCart MCP für echte Warenkorb-Links in Shopify, WooCommerce & Amazon — read-only.",
    cardSummary:
      "Ja: Verbinde Google Gemini Web, Gemini CLI (1-Befehl-Extension) oder Gemini Enterprise per OAuth 2.1 mit ShopCart MCP für geprüfte Warenkorb-Links — strikt read-only.",
    tldrLabel: "Kurzantwort:",
    tldrText:
      "Ja — Google Gemini kann 2026 echte, geprüfte Warenkörbe in Online-Shops bauen, sobald du ShopCart MCP (https://shopcart.wals.pro/mcp) verbindest. Das funktioniert in Gemini Web (Verbundene Apps → Eigene Apps), in der Gemini CLI & Antigravity per 1-Befehl-Extension (gemini extensions install https://github.com/Wals-pro/shopcart-mcp), in Gemini Enterprise (Google Cloud Console) sowie im @google/genai SDK (mcpToTool). Alle Tools sind Gemini-Schema-konform und strikt lesend — du prüfst und bezahlst immer selbst im Browser.",
    intro:
      "Standardmäßig liefert Google Gemini beim Einkaufen nur Suchergebnisse, Produktlisten oder allgemeine Empfehlungen — ohne Live-Check von Größen, Farben oder echtem Lagerbestand. Über das offene Model Context Protocol (MCP) ändert sich das: In dieser Anleitung erfährst du Schritt für Schritt, wie du ShopCart MCP in Gemini Web, Gemini CLI, Gemini Enterprise und dem @google/genai SDK verbindest und welche Google-Voraussetzungen ehrlich gelten.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Vier offizielle Gemini-Wege abgedeckt.",
        text: "Verbinde ShopCart MCP in Gemini Web (gemini.google.com), per 1-Befehl-Extension in Gemini CLI & Antigravity, als Custom MCP Data Store in Gemini Enterprise oder per mcpToTool im @google/genai SDK."
      },
      {
        lead: "Ehrliche Voraussetzungen für Gemini Web.",
        text: "Eigene MCP-Apps in Gemini Web erfordern ein persönliches Google-Konto, aktiviertes „Aktivitäten speichern“ (Keep Activity) und unterliegen dem Google-Rollout. Workspace-Konten benötigen die Admin-Freigabe oder Gemini Enterprise."
      },
      {
        lead: "Wichtig für die Gemini CLI: „httpUrl“ statt „url“.",
        text: "In ~/.gemini/settings.json musst du für Streamable HTTP zwingend \"httpUrl\": \"https://shopcart.wals.pro/mcp\" nutzen — mit \"url\" erwartet die Gemini CLI Legacy-SSE und bricht ab."
      },
      {
        lead: "Strikt read-only & 100 % Gemini-Schema-konform.",
        text: "Alle Tool-Schemas sind für Geminis strikte functionDeclarations bereinigt; der Server läuft in der EU (europe-west1), speichert keine Zahlungsdaten und löst niemals Käufe aus."
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
        heading: "Warum normale Gemini-Websuche keinen Warenkorb baut — und was MCP ändert",
        paragraphs: [
          "Ohne angebundenen MCP-Server stützt sich Google Gemini auf allgemeine Suchergebnisse. Größen und Farben lassen sich so nicht zuverlässig je Varianten-ID prüfen, Streichpreise sind oft veraltet und du musst jeden Artikel einzeln in mehreren Browser-Tabs zusammenklicken.",
          "Mit ShopCart MCP erhält Gemini sechs strikt lesende Werkzeuge (inspect_store, list_collections, search_products, get_product, get_store_policies, create_cart_link). Die Tool-Schemas sind speziell für Geminis strenge JSON-Schema-Validierung (ohne $schema, additionalProperties oder oneOf) aufbereitet, sodass Gemini zuverlässig Varianten prüft und einen fertigen Browser-Warenkorb-Link erzeugt."
        ],
        takeaway:
          "Fazit: Erst die Verbindung aus Google Gemini und einem Gemini-kompatiblen MCP-Server macht aus Produktsuche einen geprüften Warenkorb-Link."
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
          "ShopCart MCP ist architektonisch strikt lesend (readOnlyHint: true). Google Gemini kann Produkte suchen, Varianten-IDs und Lagerbestände prüfen sowie einen deterministischen Warenkorb-Link erstellen — aber niemals eine Bestellung absenden, Adressen speichern oder Zahlungsdaten sehen.",
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
        text: "Nenne Gemini die gewünschte Shop-Domain samt Artikeln, Größen und Preislimit. Gemini prüft Bestand und Preise live und liefert dir einen fertigen Warenkorb-Link zum Selbstbezahlen."
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
      "Yes: Connect Google Gemini (Web, CLI, Enterprise) to ShopCart MCP via OAuth 2.1 for live stock checks and read-only shopping cart links.",
    cardSummary:
      "Yes: Connect Google Gemini Web, Gemini CLI (1-command extension), Gemini Enterprise, or @google/genai to ShopCart MCP via OAuth 2.1 for verified browser cart links.",
    tldrLabel: "Direct Answer:",
    tldrText:
      "Yes — Google Gemini can build verified multi-item shopping carts in 2026 when connected to ShopCart MCP (https://shopcart.wals.pro/mcp). Connect it in Gemini Web (Connected Apps → Custom apps), install the 1-command Gemini CLI & Antigravity extension (gemini extensions install https://github.com/Wals-pro/shopcart-mcp), register it in Gemini Enterprise (Google Cloud Console), or wire it into the @google/genai SDK via mcpToTool. All tool schemas are strictly Gemini-compatible and read-only — you always review and pay yourself in your browser.",
    intro:
      "Out of the box, Google Gemini can recommend products from web search, but it cannot verify live variant stock or assemble a pre-filled shopping cart across independent online stores. By connecting ShopCart MCP over Streamable HTTP and OAuth 2.1, Gemini gains deterministic, read-only shopping tools. This 2026 guide walks through all four official Gemini setup paths and states Google's account prerequisites plainly.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Four official Gemini integration paths.",
        text: "Works across Gemini Web (gemini.google.com), Gemini CLI & Antigravity (1-command GitHub extension), Gemini Enterprise (Cloud Console Custom MCP Data Store), and the @google/genai TypeScript SDK (mcpToTool)."
      },
      {
        lead: "Honest Gemini Web prerequisites.",
        text: "Custom MCP apps in Gemini Web require a personal Google account, Keep Activity enabled, and depend on Google's regional/account rollout. Workspace accounts may see “Service not allowed” unless enabled by a Workspace Admin — teams use Gemini Enterprise."
      },
      {
        lead: "Gemini CLI gotcha: use “httpUrl”, never “url”.",
        text: "In ~/.gemini/settings.json, always configure \"httpUrl\": \"https://shopcart.wals.pro/mcp\" with \"authProviderType\": \"dynamic_discovery\". Using \"url\" triggers legacy SSE mode and fails."
      },
      {
        lead: "100% Gemini JSON Schema compliant & strictly read-only.",
        text: "Every tool schema strips Gemini-rejected keywords ($schema, additionalProperties, oneOf, etc.), runs on EU infrastructure (europe-west1), and never places orders or touches payment details."
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
        heading: "Why regular Gemini search stops at product lists — and how MCP fixes it",
        paragraphs: [
          "Standard Gemini web search relies on cached snippets that rarely reflect live size availability or real compare-at markdowns, leaving you to open a dozen tabs and click through store menus manually.",
          "With ShopCart MCP connected, Gemini calls six read-only tools in sequence (inspect_store, list_collections, search_products, get_product, get_store_policies, create_cart_link). Every tool's inputSchema is automatically sanitized for Gemini's strict functionDeclarations validator (zero $schema, additionalProperties, or unsupported JSON Schema keywords), so Gemini reliably verifies variants and hands you a ready-to-open browser cart link."
        ],
        takeaway:
          "Takeaway: Pairing Google Gemini with a Gemini-validated MCP server turns generic product lists into live-verified shopping carts."
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
          "Every ShopCart MCP tool is annotated readOnlyHint: true and destructiveHint: false. Gemini can search catalogs, inspect sizes and discounts, check Shopify shipping and return policies, and assemble a verified browser cart link — it can never place an order, enter your address, or see your credit card.",
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
        text: "Tell Gemini the store domain, items, sizes, and budget. Open the returned cart link in your browser to review and pay directly at the merchant."
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
      "google gemini mcp shopping",
      "gemini cli extension shopcart",
      "gemini shopping cart setup",
      "shopcart mcp gemini"
    ]
  }
];
