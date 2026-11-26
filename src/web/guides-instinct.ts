import {
  PUBLISHED_ISO,
  SOURCES_DE,
  SOURCES_EN,
  UPDATED_ISO,
  type GuideDefinition,
  type GuideSource
} from "./guides-types.js";
import { getPlatformLimits } from "./platforms.js";

const INSTINCT_SOURCES_DE: GuideSource[] = [
  ...SOURCES_DE,
  {
    label: "ShopCart Agent-Anleitung (SKILL.md) — One-Shot CLI & Streamable HTTP MCP",
    url: "https://shopcart.wals.pro/SKILL.md",
    retrieved: "26.11.2026"
  },
  {
    label: "Open Instinct (MIT-Open-Source-Projekt auf GitHub)",
    url: "https://github.com/mariagorskikh/open-instinct",
    retrieved: "26.11.2026"
  }
];

const INSTINCT_SOURCES_EN: GuideSource[] = [
  ...SOURCES_EN,
  {
    label: "ShopCart Agent Skill Instructions (SKILL.md) — One-Shot CLI & Streamable HTTP MCP",
    url: "https://shopcart.wals.pro/SKILL.md",
    retrieved: "26.11.2026"
  },
  {
    label: "Open Instinct (MIT Open-Source Project on GitHub)",
    url: "https://github.com/mariagorskikh/open-instinct",
    retrieved: "26.11.2026"
  }
];

export const INSTINCT_GUIDES: readonly GuideDefinition[] = [
  {
    path: "/guides/instinct-warenkorb-erstellen",
    lang: "de",
    category: "Instinct & Autonome Agenten",
    title: "Kann Instinct einen Warenkorb erstellen? (Anleitung 2026)",
    metaTitle: "Kann Instinct einen Warenkorb erstellen? (Anleitung 2026)",
    metaDescription:
      "Ja, sicher und read-only: Instinct nutzt die ShopCart One-Shot CLI im Cloud-Computer oder Open Instinct / MewCP per MCP für geprüfte /cart-Links.",
    cardSummary:
      "Ja — ohne Login-Risiko und ohne Browser-CAPTCHA-Schleifen: Nutze ShopCarts One-Shot CLI & SKILL.md auf Instincts Cloud-Computer oder verbinde Open Instinct, MewCP & Agensi per Streamable HTTP MCP.",
    tldrLabel: "Kurzantwort:",
    tldrText:
      "Ja — Instinct (Spear Street Technology) kann 2026 sicher und rein lesend echte Online-Warenkörbe zusammenstellen, ohne dass du Shop-Passwörter oder Kreditkarten teilen musst. Da Instinct (Stand November 2026) kein öffentliches Self-Serve-Developer-Portal und kein natives „Custom MCP Settings“-Menü hat, funktioniert der zuverlässigste Weg direkt über Instincts persistenten Cloud-Computer: Schicke Instinct per WhatsApp oder iMessage den Link zu https://shopcart.wals.pro/SKILL.md — Instinct führt die ShopCart One-Shot CLI (npx -y shopcart-mcp inspect/search/product/cart) ohne OAuth-Popup aus und schickt dir einen geprüften /cart/-Link zurück. Für Open Instinct, MewCP und Agensi steht zusätzlich der gehostete Streamable-HTTP-MCP-Endpoint (https://shopcart.wals.pro/mcp) mit OAuth 2.1 + PKCE bereit.",
    intro:
      "Persönliche KI-Agenten wie Instinct (per WhatsApp, iMessage/SMS und Anruf) oder Open-Source-Alternativen wie Open Instinct arbeiten auf einem eigenen Cloud-Computer. Wenn sie einen Online-Shop einfach per Cloud-Browser ansteuern, landen sie jedoch häufig in Cloudflare-Warteschlangen, CAPTCHAs oder brüchigen Dropdown-Klicks — und niemand will einem autonomen Agenten Zahlungsdaten anvertrauen. Mit ShopCart trennst du Recherche sauber vom Bezahlen.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Ehrlicher Stand 2026 zu Instinct:",
        text: "Instinct (Spear Street Technology) ist ein Invite-only-Agent über WhatsApp, iMessage/SMS und Sprache auf einem persistenten Cloud-Computer und besitzt derzeit kein öffentliches Self-Serve-Menü für eigene MCP-Server. Du brauchst keine erfundenen Einstellungen — die One-Shot CLI läuft sofort in der Shell."
      },
      {
        lead: "Pfad A — One-Shot CLI + SKILL.md (läuft heute sofort):",
        text: "Mit npx -y shopcart-mcp inspect, search, product, policies, collections und cart erhält dein Agent deterministisches JSON auf stdout — ohne OAuth-Popup, ohne Browser-Scraping und ohne CAPTCHA-Schleifen."
      },
      {
        lead: "Pfad B — Streamable HTTP MCP für Gateways:",
        text: "Open Instinct (mariagorskikh/open-instinct) sowie MCP-Gateways wie MewCP (mewcp.com) und Agensi (agensi.io) binden direkt https://shopcart.wals.pro/mcp per Streamable HTTP + OAuth 2.1 + PKCE an."
      },
      {
        lead: "Kein Zahlungsrisiko, 1-Klick-Prüfung per WhatsApp/iMessage:",
        text: "ShopCart arbeitet strikt read-only. Instinct teilt dir Preise, Größen und einen fertigen /cart/...-Link direkt im Chat — du prüfst und bezahlst selbst im eigenen Browser."
      }
    ],
    primaryAssistant: "claude",
    starterPrompt:
      "Lies https://shopcart.wals.pro/SKILL.md und nutze die ShopCart One-Shot CLI (npx -y shopcart-mcp inspect/search/product/cart). Suche mir bei snocks.com 2x weiße Sneaker-Socken in Größe 43-46, prüfe Live-Preis und Verfügbarkeit und schick mir den fertigen /cart/-Link hier zurück — nicht einloggen, nichts bestellen.",
    ctaHeading: "Copy-Paste-Prompt für Instinct (WhatsApp / iMessage)",
    ctaSubtext:
      "Kopiere den folgenden Prompt direkt in deinen Instinct-Chat (WhatsApp oder iMessage) — oder teste denselben Read-Only-Ablauf mit einem Klick in Claude oder ChatGPT.",
    sections: [
      {
        heading: "Realitätscheck 2026: Wie Instinct, Open Instinct & MCP-Gateways angebunden werden",
        paragraphs: [
          "Instinct von Spear Street Technology (gegründet von Noah Shinn) läuft als Invite-only-Assistent per WhatsApp, iMessage/SMS und Sprachanruf auf einem persistenten Cloud-Computer mit Browser und Shell-Werkzeugen. Anders als Claude.ai oder ChatGPT bietet Instinct Stand November 2026 kein öffentliches Self-Serve-Entwicklerportal und kein Konfigurationsmenü für benutzerdefinierte MCP-Server.",
          "Genau deshalb liefert shopcart-mcp zwei vollwertige, dokumentierte Wege statt falscher Klick-Anleitungen: Erstens die deterministische One-Shot CLI (npx -y shopcart-mcp ...) direkt in der Shell jedes Cloud-Computers — ideal für Instinct, Open Instinct, OpenClaw, Claude Code, Codex, Manus und Devin. Zweitens den gehosteten Streamable-HTTP-MCP-Server (https://shopcart.wals.pro/mcp) mit OAuth 2.1 + PKCE für Open Instinct (mariagorskikh/open-instinct auf Pi/Inkbox/Maritime-microVMs) sowie MCP-Gateways wie MewCP und Agensi."
        ],
        takeaway:
          "Fazit: Du musst nicht auf ein künftiges Instinct-MCP-Menü warten — die One-Shot CLI + SKILL.md funktioniert sofort auf jedem Cloud-Computer."
      },
      {
        heading: "Pfad A: Sofort-Start auf Instincts Cloud-Computer per SKILL.md & One-Shot CLI",
        paragraphs: [
          "Wenn du Instinct per WhatsApp oder iMessage eine Einkaufsaufgabe gibst, verweise einmal kurz auf https://shopcart.wals.pro/SKILL.md. Die Datei enthält die komplette Schrittfolge mit allen sechs deterministischen CLI-Befehlen, die direkt reines JSON auf stdout liefern und Fehler sauber über stderr und Exit-Codes melden."
        ],
        orderedSteps: [
          {
            lead: "Nachricht an Instinct senden:",
            text: "Schreibe z. B.: „Lies https://shopcart.wals.pro/SKILL.md und nutze die ShopCart One-Shot CLI (npx -y shopcart-mcp). Suche mir bei snocks.com 2x weiße Sneaker-Socken in Größe 43-46, prüfe Preis und Bestand und schick mir den fertigen /cart/-Link — nicht selbst bestellen.“"
          },
          {
            lead: "Shop erkennen & sortiert suchen:",
            text: "Instinct startet auf seinem Cloud-Computer npx -y shopcart-mcp inspect 'snocks.com' und npx -y shopcart-mcp search 'snocks.com' 'socken' --limit 5 --available (optional mit --sort discount_desc oder --max-price)."
          },
          {
            lead: "Exakte Varianten-ID prüfen:",
            text: "Mit npx -y shopcart-mcp product 'snocks.com' '<handle>' liest Instinct echte Varianten-IDs, Größe, Farbe, Live-Preis und Bestand aus — ohne Raten und ohne Browser-CAPTCHA."
          },
          {
            lead: "Geprüften /cart/-Link zurück in WhatsApp/iMessage erhalten:",
            text: "Mit npx -y shopcart-mcp cart 'snocks.com' '<variantId>:2' --verify '<handle>' (optional --discount '<CODE>' oder --note '<TEXT>') entsteht ein verifizierter Warenkorb-Link, den du mit einem Tipp auf dem Smartphone öffnest und selbst bezahlst."
          }
        ],
        takeaway:
          "Fazit: Vier deterministische Shell-Kommandos ersetzen minutenlanges Browser-Klicken, umgehen OAuth-Popups und liefern in 1–2 Sekunden einen echten Warenkorb-Link."
      },
      {
        heading: "Pfad B: Streamable HTTP MCP für Open Instinct, MewCP & Agensi",
        paragraphs: [
          "Nutzt du Open Instinct (MIT-Open-Source-Alternative auf Pi, Inkbox, Maritime microVMs und Composio) oder verbindest autonome Agenten über ein MCP-Gateway wie MewCP (mewcp.com) oder Agensi (agensi.io)? Dann kannst du ShopCart direkt als Remote-MCP-Connector anbinden.",
          "Hinterlege dazu den Streamable-HTTP-Endpoint https://shopcart.wals.pro/mcp. Das Gateway erkennt OAuth 2.1 (RFC 9728, RFC 8414, CIMD + DCR, PKCE S256) automatisch und schaltet alle sechs Read-Only-Shopping-Tools frei (inspect_store, list_collections, search_products, get_product, get_store_policies, create_cart_link). Im Free-Tarif sind 20 Abfragen/Tag dauerhaft kostenlos; lokal per CLI unter MIT-Lizenz unbegrenzt."
        ],
        takeaway:
          "Fazit: Gateways mit OAuth 2.1 nutzen den EU-gehosteten Streamable-HTTP-Endpoint; reine Shell-Agenten nutzen dieselbe Engine lokal per One-Shot CLI."
      },
      {
        heading: "Vergleich: Cloud-Browser-Klickbot vs. Instinct One-Shot CLI vs. MCP-Gateway",
        paragraphs: [
          "Der direkte Vergleich zeigt, warum ein dedizierter Read-Only-Shop-Adapter zuverlässiger und sicherer ist als ein Agent, der sich im Headless-Browser durch Online-Shops klickt."
        ],
        table: {
          id: "instinct-compare-table-de",
          caption:
            "Vergleich: Browser-Steuerung im Cloud-Computer, Instinct + ShopCart One-Shot CLI und Open Instinct / MewCP / Agensi per Streamable HTTP MCP",
          headers: [
            "Kriterium",
            "Cloud-Browser-Klickbot",
            "Instinct + ShopCart One-Shot CLI",
            "Open Instinct / MewCP / Agensi (Remote MCP)"
          ],
          rows: [
            [
              "Cloudflare / Bot-CAPTCHAs",
              "Häufig blockiert oder hängt in Cookie-/Popup-Schleifen",
              "Strukturierte Storefront-APIs — kein Browser-Scraping",
              "Strukturierte Storefront-APIs über EU-Server (europe-west1)"
            ],
            [
              "Setup & Login",
              "Oft manuelles Einloggen nötig",
              "Null OAuth-Popup, direkt per npx -y shopcart-mcp & SKILL.md",
              "Streamable HTTP (https://shopcart.wals.pro/mcp) mit OAuth 2.1 + PKCE"
            ],
            [
              "Geschwindigkeit & Ausgabe",
              "30–120 Sekunden pro Warenkorb",
              "~1–2 Sekunden, deterministisches JSON auf stdout",
              "~1–2 Sekunden, 6 typisierte Read-Only-MCP-Tools"
            ],
            [
              "Zahlungssicherheit",
              "Hohes Risiko bei gespeicherten Logins oder Karten",
              "Strikt read-only — fertiger /cart/-Link für 1-Klick-Prüfung durch dich",
              "Strikt read-only — keine Logins, Adressen oder Karten gespeichert"
            ],
            [
              "Kosten & Limits",
              "Hoher Token- & Rechenverbrauch durch Screenshots",
              "Kostenlos & unbegrenzt (MIT Open Source)",
              "Free 20 Calls/Tag dauerhaft gratis · Pro 500 Calls/Tag (9 €/Monat)"
            ]
          ]
        },
        takeaway:
          "Fazit: Mit ShopCart spart dein autonomer Agent Zeit, Tokens und Fehlversuche — und deine Zahlungsdaten bleiben zu 100 % privat."
      },
      {
        heading: "Sicherheit: SSRF-Schutz, Prompt-Injection-Filter & striktes Read-Only",
        paragraphs: [
          "Autonome Agenten verarbeiten fremde Shop-Seiten ohne ständige Aufsicht. Genau hier schützt ShopCart sowohl in der One-Shot CLI als auch im Remote-MCP-Server mit denselben Sicherheitsmechanismen: HTTPS-only mit DNS-gepinntem SSRF-Schutz gegen interne Netze und Cloud-Metadaten-IPs, strikte Input-Validierung für Varianten-IDs und Mengen sowie Bereinigung von HTML, Skripten und versteckten Unicode-Zeichen in Produkt- und Policy-Texten.",
          "Alle sechs Befehle und MCP-Tools arbeiten rein lesend und legen niemals serverseitig Bestellungen an. So erhältst du in WhatsApp oder iMessage ausschließlich geprüfte Produktdaten und einen klickbaren Warenkorb-Link."
        ],
        takeaway:
          "Fazit: Dieselben SSRF- und Prompt-Injection-Guardrails sichern lokale One-Shot-CLI-Läufe ebenso ab wie den gehosteten MCP-Server."
      }
    ],
    howToName: "Mit Instinct & ShopCart sicher einen Online-Warenkorb erstellen",
    howToDescription:
      "So lässt du Instinct (per WhatsApp/iMessage) oder Open Instinct / MCP-Gateways mit ShopCart einen geprüften Warenkorb-Link ohne Zahlungsrisiko bauen.",
    howToSteps: [
      {
        name: "SKILL.md oder One-Shot CLI im Chat nennen",
        text: "Schicke Instinct per WhatsApp oder iMessage den Link https://shopcart.wals.pro/SKILL.md zusammen mit deinem Wunsch-Shop, Produkt, Größe und Budget (oder verbinde https://shopcart.wals.pro/mcp in Open Instinct, MewCP oder Agensi)."
      },
      {
        name: "Live-Prüfung ohne Browser-CAPTCHA laufen lassen",
        text: "Der Agent prüft Shop, Sortiment und exakte Varianten-IDs per npx -y shopcart-mcp inspect, search und product (bzw. per MCP-Tools) und filtert ausverkaufte Größen aus."
      },
      {
        name: "Geprüften /cart/-Link öffnen und selbst bezahlen",
        text: "Über npx -y shopcart-mcp cart (oder create_cart_link) erhältst du den fertigen Warenkorb-Link direkt im Chat, prüfst alle Artikel im Browser und schließt die Bestellung selbst ab."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro:
      "Dieser Ratgeber stützt sich auf den verifizierten technischen Stand (abgerufen am 26.11.2026):",
    sources: INSTINCT_SOURCES_DE,
    limitationsLabel: "Grenzen:",
    limitationsText: getPlatformLimits("de"),
    faqHeading: "Häufige Fragen zu Instinct, Open Instinct & ShopCart",
    faqs: [
      {
        question: "Hat Instinct (Spear Street Technology) ein eigenes Custom-MCP-Einstellungsmenü?",
        answer:
          "Stand November 2026 bietet Instinct kein öffentliches Self-Serve-Developer-Portal und kein natives „Custom MCP Settings“-Menü. Deshalb funktioniert ShopCart mit Instinct am zuverlässigsten über den persistenten Cloud-Computer per One-Shot CLI (npx -y shopcart-mcp ...) und https://shopcart.wals.pro/SKILL.md."
      },
      {
        question: "Wie verbinde ich Open Instinct, MewCP oder Agensi mit ShopCart?",
        answer:
          "Open Instinct (mariagorskikh/open-instinct) sowie MCP-Gateways wie MewCP (mewcp.com) und Agensi (agensi.io) unterstützen Streamable HTTP MCP. Trage dort https://shopcart.wals.pro/mcp ein — OAuth 2.1 mit PKCE wird automatisch erkannt. Alternativ läuft die One-Shot CLI direkt in der microVM von Open Instinct."
      },
      {
        question: "Muss ich Instinct mein Shop-Passwort oder meine Kreditkarte geben?",
        answer:
          "Nein. ShopCart arbeitet strikt rein lesend (read-only). Instinct benötigt weder Shop-Logins noch Zahlungsdaten, sondern schickt dir einen geprüften /cart/...-Link per WhatsApp oder iMessage, den du selbst in deinem Browser öffnest und bezahlst."
      },
      {
        question: "Welche Befehle bietet die ShopCart One-Shot CLI?",
        answer:
          "Die CLI stellt sechs deterministische JSON-Befehle bereit: inspect '<store>', search '<store>' '<query>', product '<store>' '<handle>', policies '<store>', collections '<store>' und cart '<store>' '<variantId:qty>' (mit optionalem --discount '<CODE>', --note '<TEXT>' und --verify '<handle>'). Ohne Argumente startet npx -y shopcart-mcp weiterhin den klassischen stdio-MCP-Server."
      },
      {
        question: "Was kostet die Nutzung mit Instinct oder Open Instinct?",
        answer:
          "Die One-Shot CLI und der lokale stdio-Modus (npx -y shopcart-mcp) stehen unter MIT-Lizenz kostenlos und unbegrenzt ohne Konto zur Verfügung. Für MCP-Gateways über https://shopcart.wals.pro/mcp sind 20 Abfragen pro Tag dauerhaft gratis (Pro optional 500 Abfragen/Tag für 9 €/Monat)."
      }
    ],
    hreflang: {
      de: "/guides/instinct-warenkorb-erstellen",
      en: "/guides/instinct-shopping-cart",
      xDefault: "/guides/instinct-shopping-cart"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "instinct ai warenkorb",
      "instinct shopping cart",
      "open instinct mcp",
      "autonomer agent einkaufen",
      "shopcart one-shot cli",
      "mewcp agensi mcp"
    ]
  },
  {
    path: "/guides/instinct-shopping-cart",
    lang: "en",
    category: "Instinct & Autonomous Agents",
    title: "Can Instinct AI Build a Shopping Cart? (Safe Read-Only Setup 2026)",
    metaTitle: "Can Instinct AI Build a Shopping Cart? (Read-Only Setup 2026)",
    metaDescription:
      "Yes, safely and read-only: run ShopCart One-Shot CLI on Instinct's cloud computer, or connect Open Instinct, MewCP and Agensi via Streamable HTTP.",
    cardSummary:
      "Yes — with zero payment risk and no Cloudflare/CAPTCHA loops: use ShopCart's One-Shot CLI & SKILL.md on Instinct's cloud computer, or connect Open Instinct, MewCP & Agensi via Streamable HTTP MCP.",
    tldrLabel: "Direct Answer:",
    tldrText:
      "Yes — Instinct AI (Spear Street Technology) can safely assemble verified online shopping carts in 2026 without sharing store logins or credit cards. Because Instinct is an invite-only personal agent on a persistent cloud computer (accessed via WhatsApp, iMessage/SMS, and voice) with no public self-serve Custom MCP Settings UI as of November 2026, the fastest path works today via Shell One-Shot CLI + SKILL.md: text Instinct https://shopcart.wals.pro/SKILL.md so it runs npx -y shopcart-mcp inspect/search/product/cart with zero OAuth popups and sends back a verified /cart/... checkout link. For Open Instinct, MewCP, and Agensi, ShopCart also exposes a managed Streamable HTTP MCP endpoint at https://shopcart.wals.pro/mcp (OAuth 2.1 + PKCE).",
    intro:
      "Autonomous personal agents like Instinct (via WhatsApp and iMessage) or open-source cloud-computer agents like Open Instinct have their own browser and shell. Yet sending a cloud browser directly into online stores frequently triggers Cloudflare loops, bot CAPTCHAs, and broken dropdown clicks — and handing over store passwords or payment cards creates unnecessary risk. ShopCart solves both cleanly with read-only storefront APIs and human-in-the-loop checkout links.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Honest 2026 Instinct reality:",
        text: "Instinct (Spear Street Technology, founded by Noah Shinn) is invite-only over WhatsApp, iMessage/SMS, and voice with a persistent cloud computer — and has no public self-serve developer portal or Custom MCP Settings screen as of November 2026. No fake UI menus required."
      },
      {
        lead: "Path A — Cloud-Computer One-Shot CLI + SKILL.md (works today):",
        text: "Run npx -y shopcart-mcp inspect, search, product, policies, collections, and cart directly in the shell for deterministic JSON on stdout — zero OAuth popup, zero browser scraping."
      },
      {
        lead: "Path B — Streamable HTTP MCP for gateways:",
        text: "Open Instinct (mariagorskikh/open-instinct) and MCP gateways such as MewCP (mewcp.com) and Agensi (agensi.io) connect directly to https://shopcart.wals.pro/mcp with OAuth 2.1 + PKCE."
      },
      {
        lead: "1-click human review & checkout in WhatsApp/iMessage:",
        text: "ShopCart is strictly read-only. Your agent returns exact prices, stock, and a verified /cart/... permalink so you review every item and pay yourself."
      }
    ],
    primaryAssistant: "claude",
    starterPrompt:
      "Read https://shopcart.wals.pro/SKILL.md and use the ShopCart One-Shot CLI (npx -y shopcart-mcp inspect/search/product/cart). Search snocks.com for 2x white sneaker socks in size 43-46, verify live price and stock, and text me back the verified /cart/ link — do not log in or place an order.",
    ctaHeading: "Copy-Paste Prompt for Instinct (WhatsApp / iMessage)",
    ctaSubtext:
      "Text the prompt below directly to Instinct via WhatsApp or iMessage — or test the exact same read-only workflow in one click inside Claude or ChatGPT.",
    sections: [
      {
        heading: "2026 Reality Check: Instinct vs. Open Instinct vs. MCP Gateways",
        paragraphs: [
          "Instinct by Spear Street Technology (founded by Noah Shinn) operates as an invite-only personal AI agent reachable via WhatsApp, iMessage/SMS, and voice calls, backed by a persistent cloud computer with browser and shell access. As of November 2026, Instinct does not provide a public self-serve developer portal or a native Custom MCP Settings screen.",
          "Rather than inventing fictional settings menus, ShopCart supports autonomous agents through two verified paths: Path A is the deterministic One-Shot CLI (npx -y shopcart-mcp ...) designed for any shell-capable cloud computer (Instinct, Open Instinct, OpenClaw, Claude Code, Codex, Manus, Devin). Path B is the hosted Streamable HTTP MCP endpoint (https://shopcart.wals.pro/mcp) with OAuth 2.1 + PKCE for Open Instinct (mariagorskikh/open-instinct, built on Pi, Inkbox, Maritime microVMs, and Composio) and MCP gateways including MewCP and Agensi."
        ],
        takeaway:
          "Takeaway: Use the zero-OAuth One-Shot CLI on Instinct's cloud computer today, or Streamable HTTP MCP on Open Instinct, MewCP, and Agensi."
      },
      {
        heading: "Path A: Run ShopCart on Instinct's Cloud Computer via SKILL.md & One-Shot CLI",
        paragraphs: [
          "Whenever you text Instinct a shopping request on WhatsApp or iMessage, point it to https://shopcart.wals.pro/SKILL.md. The skill document gives the agent exact One-Shot CLI commands that emit structured JSON on stdout (and structured errors on stderr with exit codes 0/1/2) — with zero OAuth popups and zero CAPTCHA loops."
        ],
        orderedSteps: [
          {
            lead: "Text Instinct your request:",
            text: "Send: \"Read https://shopcart.wals.pro/SKILL.md and use the ShopCart One-Shot CLI (npx -y shopcart-mcp). Search snocks.com for 2x white sneaker socks in size 43-46, verify live price and stock, and text me back the verified /cart/ link — do not place an order.\""
          },
          {
            lead: "Inspect the store & search live stock:",
            text: "Instinct runs npx -y shopcart-mcp inspect 'snocks.com' and npx -y shopcart-mcp search 'snocks.com' 'socken' --limit 5 --available (with optional --sort discount_desc or --max-price)."
          },
          {
            lead: "Verify exact variant IDs & pricing:",
            text: "Instinct calls npx -y shopcart-mcp product 'snocks.com' '<handle>' to retrieve exact numeric variant IDs, sizes, live stock, and real compare-at discounts — no DOM clicking required."
          },
          {
            lead: "Receive a verified /cart/... link in WhatsApp or iMessage:",
            text: "Running npx -y shopcart-mcp cart 'snocks.com' '<variantId>:2' --verify '<handle>' (optionally with --discount '<CODE>' or --note '<TEXT>') produces a verified cart permalink you tap to review and pay yourself."
          }
        ],
        takeaway:
          "Takeaway: Four deterministic shell commands replace fragile browser automation and return a verified checkout link in ~1–2 seconds."
      },
      {
        heading: "Path B: Streamable HTTP MCP for Open Instinct, MewCP & Agensi",
        paragraphs: [
          "If you run Open Instinct (MIT-licensed open-source personal agent inside isolated Maritime microVMs) or connect autonomous agents through an MCP gateway such as MewCP (mewcp.com) or Agensi (agensi.io), you can connect ShopCart natively over Streamable HTTP MCP.",
          "Point the gateway at https://shopcart.wals.pro/mcp. RFC 9728 / RFC 8414 discovery handles OAuth 2.1 + PKCE automatically and exposes all six read-only shopping tools (inspect_store, list_collections, search_products, get_product, get_store_policies, create_cart_link). Hosted usage includes 20 free lookups/day permanently; local CLI usage under the MIT license is free and unlimited."
        ],
        takeaway:
          "Takeaway: Managed OAuth 2.1 gateways connect to https://shopcart.wals.pro/mcp, while shell agents run the exact same engine locally via npx."
      },
      {
        heading: "Comparison: Cloud Browser Clicking vs. One-Shot CLI vs. MCP Gateways",
        paragraphs: [
          "Comparing browser automation against ShopCart's structured read-only paths shows why deterministic APIs beat pixel-clicking for real shopping tasks."
        ],
        table: {
          id: "instinct-compare-table-en",
          caption:
            "Comparison of cloud browser automation, Instinct + ShopCart One-Shot CLI, and Open Instinct / MewCP / Agensi over Streamable HTTP MCP",
          headers: [
            "Criterion",
            "Cloud Browser Clicking",
            "Instinct + ShopCart One-Shot CLI",
            "Open Instinct / MewCP / Agensi (Remote MCP)"
          ],
          rows: [
            [
              "Cloudflare & bot CAPTCHAs",
              "Frequently blocked or stuck on cookie banners",
              "Structured public storefront APIs — zero scraping",
              "Structured public storefront APIs via EU server (europe-west1)"
            ],
            [
              "Setup & auth",
              "Often requires manual browser sign-in",
              "Zero OAuth popup — npx -y shopcart-mcp & SKILL.md",
              "Streamable HTTP (https://shopcart.wals.pro/mcp) + OAuth 2.1 PKCE"
            ],
            [
              "Speed & output",
              "30–120 seconds per multi-item cart",
              "~1–2 seconds, deterministic JSON on stdout",
              "~1–2 seconds, 6 typed read-only MCP tools"
            ],
            [
              "Payment & account safety",
              "High risk if store logins or cards are shared",
              "Strictly read-only — verified /cart/... link for 1-click checkout",
              "Strictly read-only — zero logins, addresses, or cards stored"
            ],
            [
              "Cost & limits",
              "Heavy screenshot token & compute usage",
              "Free & unlimited (MIT open source)",
              "Free 20 calls/day permanently · Pro 500 calls/day (€9/mo)"
            ]
          ]
        },
        takeaway:
          "Takeaway: ShopCart eliminates browser-bot fragility and keeps credentials and payments completely out of your autonomous agent's reach."
      },
      {
        heading: "Security Architecture: SSRF Guard, Prompt-Injection Sanitization & Read-Only Guarantee",
        paragraphs: [
          "Autonomous agents read untrusted merchant websites without constant human supervision. Both the One-Shot CLI and the hosted Streamable HTTP server enforce the exact same guardrails: HTTPS-only requests with DNS-pinned SSRF protection blocking private/reserved IP ranges and cloud metadata endpoints, strict validation on variant IDs and quantities, and HTML/script/invisible-Unicode sanitization on merchant catalog and policy text.",
          "Every subcommand and MCP tool is strictly read-only and never submits checkout forms or server-side orders. You receive clean product facts and a verified browser link to complete checkout yourself."
        ],
        takeaway:
          "Takeaway: The One-Shot CLI inherits every SSRF and prompt-injection protection built into ShopCart MCP."
      }
    ],
    howToName: "How to Build a Verified Shopping Cart with Instinct AI & ShopCart",
    howToDescription:
      "Step-by-step read-only setup to let Instinct (WhatsApp/iMessage), Open Instinct, or MCP gateways build verified shopping cart links safely.",
    howToSteps: [
      {
        name: "Share SKILL.md or connect the MCP endpoint",
        text: "Text Instinct https://shopcart.wals.pro/SKILL.md with your store, items, sizes, and budget (or connect https://shopcart.wals.pro/mcp in Open Instinct, MewCP, or Agensi)."
      },
      {
        name: "Verify live products and exact variant IDs",
        text: "Your agent runs npx -y shopcart-mcp inspect, search, and product (or the matching MCP tools) to verify live prices, real discounts, and in-stock variant IDs without browser CAPTCHAs."
      },
      {
        name: "Review the /cart/... link and check out yourself",
        text: "The agent runs npx -y shopcart-mcp cart (or create_cart_link) and sends back a verified cart link in WhatsApp or iMessage so you review and pay in one click on the merchant's site."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro:
      "This guide reflects verified product and protocol documentation (all retrieved Nov 26, 2026):",
    sources: INSTINCT_SOURCES_EN,
    limitationsLabel: "Limitations:",
    limitationsText: getPlatformLimits("en"),
    faqHeading: "Frequently Asked Questions About Instinct AI & Shopping Carts",
    faqs: [
      {
        question: "Does Instinct AI have a Custom MCP Settings UI?",
        answer:
          "As of November 2026, Instinct (Spear Street Technology) is an invite-only personal agent over WhatsApp, iMessage/SMS, and voice with no public self-serve developer portal or Custom MCP Settings screen. Running ShopCart's One-Shot CLI (npx -y shopcart-mcp ...) via https://shopcart.wals.pro/SKILL.md on Instinct's cloud computer works immediately with zero OAuth popup."
      },
      {
        question: "How do I connect Open Instinct, MewCP, or Agensi to ShopCart?",
        answer:
          "Open Instinct (mariagorskikh/open-instinct) and MCP gateways such as MewCP (mewcp.com) and Agensi (agensi.io) support Streamable HTTP MCP. Connect https://shopcart.wals.pro/mcp with OAuth 2.1 + PKCE auto-discovery, or run the One-Shot CLI inside Open Instinct's isolated microVM."
      },
      {
        question: "Do I have to share my store login or credit card with Instinct?",
        answer:
          "No. ShopCart is strictly read-only. Instinct never needs store credentials, shipping addresses, or payment cards — it texts back a verified /cart/... link so you review and pay directly in your own browser."
      },
      {
        question: "What subcommands does the ShopCart One-Shot CLI support?",
        answer:
          "The CLI provides six deterministic JSON subcommands: inspect '<store>', search '<store>' '<query>', product '<store>' '<handle>', policies '<store>', collections '<store>', and cart '<store>' '<variantId:qty>' (with optional --discount '<CODE>', --note '<TEXT>', and --verify '<handle>'). Running npx -y shopcart-mcp with no arguments continues to start the stdio MCP server unchanged."
      },
      {
        question: "How much does ShopCart cost for Instinct or Open Instinct?",
        answer:
          "The One-Shot CLI and local stdio MCP server (npx -y shopcart-mcp) are MIT-licensed, free, and unlimited with zero telemetry. The hosted Streamable HTTP endpoint (https://shopcart.wals.pro/mcp) includes 20 free lookups/day permanently, with Pro (500 lookups/day) at €9/month."
      }
    ],
    hreflang: {
      de: "/guides/instinct-warenkorb-erstellen",
      en: "/guides/instinct-shopping-cart",
      xDefault: "/guides/instinct-shopping-cart"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "can instinct ai build a shopping cart",
      "instinct ai shopping cart",
      "open instinct mcp",
      "autonomous agent shopping cli",
      "shopcart one-shot cli",
      "mewcp agensi mcp"
    ]
  }
];
