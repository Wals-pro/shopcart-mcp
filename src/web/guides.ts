import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import { detectLang, escapeHtml, type Lang } from "../auth/pages.js";
import { isPromoFreeProActive } from "../billing/quota.js";
import { ANSWER_PAGE_GUIDES } from "./guides-answer-pages.js";
import {
  PUBLISHED_ISO,
  SOURCES_DE,
  SOURCES_EN,
  UPDATED_ISO,
  type GuideDefinition,
  type GuideFaqItem,
  type GuideHowToStep,
  type GuideSeasonalNote,
  type GuideSection,
  type GuideSource,
  type GuideTable
} from "./guides-types.js";

export type {
  GuideDefinition,
  GuideFaqItem,
  GuideHowToStep,
  GuideSeasonalNote,
  GuideSection,
  GuideSource,
  GuideTable
};

const GUIDES_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join("; ");

const CORE_GUIDES: readonly GuideDefinition[] = [
  {
    path: "/guides/mit-claude-online-einkaufen",
    lang: "de",
    category: "Claude Shopping Guide",
    title: "Kann Claude online einkaufen & einen Warenkorb bauen? (2026 Guide)",
    metaTitle: "Kann Claude online einkaufen & einen Warenkorb bauen? (2026)",
    metaDescription:
      "Ja: Mit ShopCart MCP prüft Claude Größen, Bestand & Live-Preise in Shopify- & WooCommerce-Shops und baut einen Warenkorb-Link — read-only.",
    cardSummary:
      "Ja: Verbinde Claude.ai oder Claude Desktop in zwei Klicks mit ShopCart MCP und lass dir geprüfte Multi-Artikel-Warenkörbe erstellen.",
    tldrLabel: "Kurzantwort:",
    tldrText:
      "Ja — Claude kann 2026 echte Warenkörbe in tausenden Online-Shops bauen, ohne dass du Zahlungsdaten teilen musst. Mit dem kostenlosen OAuth-2.1-Connector ShopCart MCP (https://shopcart.wals.pro/mcp) prüft Claude.ai oder Claude Desktop Varianten, Größen, Bestand und Live-Preise direkt in öffentlichen Shopify- und WooCommerce-Shops — plus offizielle Amazon-Cart-Links — und liefert einen fertigen Browser-Warenkorb-Link zum Selbstbezahlen.",
    intro:
      "Du möchtest beim Online-Shopping Zeit sparen, ohne dich durch zwanzig Tabs und ausverkaufte Größen zu klicken? In diesem Praxis-Guide siehst du, wie Claude über das offene Model Context Protocol (MCP) echte, geprüfte Warenkörbe zusammenstellt — ganz ohne fragile Browser-Extensions und ohne automatischen Kaufabschluss.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Fertiger Warenkorb statt loser Produktlinks.",
        text: "Claude liest exakte Varianten-IDs und Lagerbestände live beim Shop aus und bündelt mehrere Artikel samt Wunschmenge in einem klickbaren Warenkorb-Link."
      },
      {
        lead: "Du bleibst beim Bezahlen immer am Steuer.",
        text: "ShopCart MCP arbeitet strikt lesend (read-only) und löst niemals Bestellungen aus — Adresse, Versandart und Zahlung bleiben komplett in deinem Browser."
      },
      {
        lead: "Funktioniert in Claude.ai Web, Mobile, Desktop & Claude Code.",
        text: "In Claude.ai verbindest du https://shopcart.wals.pro/mcp in zwei Klicks per OAuth 2.1; lokal auf dem Rechner läuft die MIT-Open-Source-CLI ohne Konto."
      },
      {
        lead: "Weltweite Währungen statt lokaler Liefer-Apps.",
        text: "Unterstützt öffentliche Shopify- und WooCommerce-Shops in EUR, CHF, USD und GBP sowie offizielle Amazon-Multi-Artikel-Links über 10 Marktplätze."
      }
    ],
    primaryAssistant: "claude",
    starterPrompt:
      "Verbinde dich mit ShopCart MCP (https://shopcart.wals.pro/mcp). Falls der Connector noch nicht aktiv ist, erkläre mir kurz die 2-Klick-Einrichtung. Suche mir danach bei snocks.com 2x weiße und 1x schwarze Sneaker-Socken in Größe 43-46, prüfe Live-Preise und Lagerbestand und erstelle mir einen fertigen Warenkorb-Link.",
    ctaHeading: "Direkt ausprobieren: 1-Klick-Startprompt",
    ctaSubtext:
      "Öffnet einen fertigen Shopping-Prompt direkt in Claude oder ChatGPT — inklusive Einrichtungshilfe, falls ShopCart MCP noch nicht verbunden ist.",
    sections: [
      {
        heading: "Warum normale KI-Suche und Browser-Extensions beim Shopping bremsen",
        paragraphs: [
          "Wenn du Claude ohne direkte Shop-Anbindung nach einem Produkt fragst, greift der Assistent auf allgemeine Websuchen oder gecachte Snippets zurück. Das Ergebnis sind oft Kategorieseiten, veraltete Preise oder Artikel, bei denen deine Größe beim Öffnen bereits vergriffen ist.",
          "Browser-Automatisierungs-Extensions klicken sich zwar durch Webseiten, scheitern aber schnell an Cookie-Bannern, dynamischen Menüs oder Popups und funktionieren nicht auf dem Smartphone. Strukturierte MCP-Abfragen liefern dagegen exakte Varianten-IDs und deterministische Warenkorb-Links in Sekunden."
        ],
        takeaway:
          "Fazit: Strukturierter MCP-Lesezugriff ersetzt sowohl veraltete Linklisten als auch fehleranfällige Browser-Klickbots."
      },
      {
        heading: "So baut dir Claude in vier Schritten einen echten Warenkorb",
        paragraphs: [
          "ShopCart MCP nutzt das offene Model Context Protocol (MCP), um Claude vier klar begrenzte Lese-Werkzeuge bereitzustellen. Statt HTML-Seiten zu raten, ruft der Server strukturierte Katalogdaten direkt vom jeweiligen Shop ab und erzeugt einen offiziellen Warenkorb-Permalink."
        ],
        orderedSteps: [
          {
            lead: "Shop prüfen (inspect_store):",
            text: "Erkennt automatisch öffentliche Shopify- und WooCommerce-Shops (sowie Amazon-Marktplätze für Cart-Links) und liest Währung, Land und Firewall-Regeln aus."
          },
          {
            lead: "Katalog durchsuchen (search_products):",
            text: "Sucht gezielt nach Stichwörtern, Preisgrenzen (min_price / max_price) und lieferbaren Artikeln in der Shop-Währung."
          },
          {
            lead: "Varianten und Lagerbestand prüfen (get_product):",
            text: "Lädt die exakten Varianten-IDs für jede Größe und Farbe samt Live-Preis, echtem Streichpreis und Verfügbarkeit."
          },
          {
            lead: "Warenkorb-Link bauen (create_cart_link):",
            text: "Verifiziert deine Wunschpositionen noch einmal live gegen den Shop und erzeugt einen klickbaren Link, der den fertigen Warenkorb direkt auf der Shop-Website öffnet."
          }
        ],
        takeaway:
          "Fazit: Vier feste Prüfschritte sorgen dafür, dass exakt die richtige Größe, Farbe und Stückzahl im Warenkorb landet."
      },
      {
        heading: "Claude Websuche vs. Browser-Extension vs. Claude + ShopCart MCP",
        paragraphs: [
          "Der Vergleich zeigt, warum ein dedizierter Read-Only-MCP-Connector zuverlässiger arbeitet als Websuche oder reine Browser-Steuerung."
        ],
        table: {
          id: "claude-compare-table",
          caption: "Vergleich: Claude Websuche, Browser-Extension (Claude in Chrome) und Claude mit ShopCart MCP",
          headers: [
            "Kriterium",
            "Claude Websuche",
            "Browser-Extension (Claude in Chrome)",
            "Claude + ShopCart MCP"
          ],
          rows: [
            [
              "Preise & Rabatte",
              "Oft veraltet aus gecachten Snippets",
              "Langsames Seitenladen, anfällig für Popups",
              "Live vom Shop geladen inklusive echtem Streichpreis"
            ],
            [
              "Größen- & Farbcheck",
              "Nicht zuverlässig pro Variante sichtbar",
              "Muss Dropdowns einzeln klicken",
              "Exakte Live-Prüfung je Varianten-ID und Lagerstatus"
            ],
            [
              "Smartphone-Nutzung (Mobile)",
              "Nur Textlinks",
              "Nicht verfügbar (Desktop-Browser nötig)",
              "Funktioniert in Claude.ai Web, Mobile & Desktop"
            ],
            [
              "Multi-Artikel-Warenkorb",
              "Manuell pro Tab zusammenklicken",
              "Mehrminütige Klick-Sequenz",
              "Bis zu 20 Positionen in einem geprüften Browser-Link"
            ],
            [
              "Sicherheit beim Kauf",
              "Manueller Checkout im Browser",
              "Teilt aktive Browser-Session",
              "Strikt read-only — Prüfung & Zahlung bleiben komplett im Browser"
            ]
          ]
        },
        takeaway:
          "Fazit: Claude mit ShopCart MCP funktioniert mobil wie am Desktop, ist deterministisch und berührt niemals deine aktive Login-Session."
      },
      {
        heading: "In 30 Sekunden mit Claude.ai oder Claude Desktop verbinden",
        paragraphs: [
          "Für Claude.ai (Web & Mobile) öffnest du einfach die Connector-Einstellungen, hinterlegst die Server-Adresse https://shopcart.wals.pro/mcp und bestätigst die OAuth-2.1-Anmeldung in zwei Klicks. Danach steht dir ShopCart MCP in jedem Chat zur Verfügung.",
          "Wenn du lokal mit Claude Desktop oder Claude Code arbeitest, kannst du alternativ die kostenlose Open-Source-CLI unter MIT-Lizenz direkt per npx -y shopcart-mcp starten — ganz ohne Konto und ohne Telemetrie. Im gehosteten Dienst sind 20 Abfragen pro Tag dauerhaft gratis; im Pro-Tarif (9 €/Monat) gibt es 500 Abfragen pro Tag."
        ],
        takeaway:
          "Fazit: Du startest in unter einer Minute und wählst frei zwischen gehostetem 2-Klick-Komfort und lokalem Open-Source-Betrieb."
      },
      {
        heading: "Datenschutz und Sicherheit: Warum Read-Only entscheidend ist",
        paragraphs: [
          "Niemand möchte, dass eine KI eigenmächtig Kreditkarten belastet oder versteckte Textanweisungen in fremden Produktbeschreibungen ausführt. ShopCart MCP löst beides auf Architekturebene.",
          "Alle vier Werkzeuge sind technisch als rein lesend markiert und verarbeiten weder Bestellungen noch Shop-Logins oder Zahlungsdaten. Ein eingebauter Filter bereinigt HTML und unsichtbare Steuerzeichen aus Shop-Texten (Prompt-Injection-Schutz), während DNS-gepinnte SSRF-Regeln interne Netze sperren. Der gehostete Dienst läuft in der EU (Google Cloud, europe-west1) und speichert keine Chat-Verläufe."
        ],
        takeaway:
          "Fazit: Claude übernimmt Recherche und Warenkorb-Bau, während Datenschutz und Kaufentscheidung zu 100 % bei dir bleiben."
      }
    ],
    howToName: "Mit Claude in 3 Schritten einen geprüften Online-Warenkorb erstellen",
    howToDescription:
      "So verbindest du Claude über ShopCart MCP mit öffentlichen Shopify- und WooCommerce-Shops (sowie Amazon-Cart-Links) und öffnest einen fertigen Warenkorb im Browser.",
    howToSteps: [
      {
        name: "ShopCart MCP in Claude verbinden",
        text: "Füge https://shopcart.wals.pro/mcp als Custom MCP Connector in Claude hinzu und schließe die OAuth-2.1-Anmeldung in zwei Klicks ab (oder nutze lokal npx -y shopcart-mcp)."
      },
      {
        name: "Shop, Artikel, Größen und Budget nennen",
        text: "Schreibe Claude im Chat, in welchem Online-Shop gesucht werden soll und welche Produkte, Farben, Größen oder welches Preislimit du möchtest."
      },
      {
        name: "Geprüften Warenkorb-Link öffnen und selbst bezahlen",
        text: "Claude prüft Varianten und Lagerbestand live und gibt dir einen fertigen Warenkorb-Link. Öffne ihn im Browser, kontrolliere alles in Ruhe und bezahle direkt beim Händler."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser Ratgeber stützt sich auf folgende geprüfte Quellen (alle abgerufen am 26.11.2026):",
    sources: SOURCES_DE,
    limitationsLabel: "Grenzen:",
    limitationsText:
      "Die volle Live-Katalog-, Varianten- und Bestandsprüfung funktioniert auf öffentlichen Shopify- und WooCommerce-Storefronts ohne Login-Schranke. Für Amazon unterstützt ShopCart MCP offizielle Multi-Artikel-Warenkorb-Links (/gp/aws/cart/add.html) über 10 Marktplätze kombiniert mit Websuche oder optional Keepa/PA-API — kein automatischer Checkout. Passwortgeschützte B2B-Portale werden nicht unterstützt.",
    faqHeading: "Häufige Fragen zum Einkaufen mit Claude",
    faqs: [
      {
        question: "Kann Claude automatisch für mich einkaufen oder bezahlen?",
        answer:
          "Nein. Alle Werkzeuge in ShopCart MCP arbeiten strikt rein lesend (read-only) und erzeugen lediglich einen geprüften Warenkorb-Link für deinen Browser. Du prüfst Preise, Versandkosten und Mengen selbst im Online-Shop und schließt den Kauf wie gewohnt ab."
      },
      {
        question: "Funktioniert das Einkaufen mit Claude auch auf dem Smartphone?",
        answer:
          "Ja. Da ShopCart MCP als gehosteter Remote-OAuth-2.1-Server (https://shopcart.wals.pro/mcp) läuft, funktioniert der Connector direkt in Claude.ai Web und in der Claude Mobile App genauso wie in Claude Desktop und Claude Code."
      },
      {
        question: "In welchen Online-Shops kann Claude Warenkörbe erstellen?",
        answer:
          "Claude durchsucht tausende öffentliche Shopify- und WooCommerce-Onlineshops weltweit live inklusive Größen- und Bestandscheck in EUR, CHF, USD oder GBP. Für Amazon erstellt ShopCart MCP zudem offizielle Multi-Artikel-Warenkorb-Links (/gp/aws/cart/add.html) über 10 Marktplätze."
      },
      {
        question: "Was kostet ShopCart MCP für Claude?",
        answer:
          "Der gehostete Free-Tarif bietet dauerhaft 20 Abfragen pro Tag kostenlos. Im Pro-Tarif stehen 500 Abfragen pro Tag für 9 € im Monat bereit. Lokal über npx -y shopcart-mcp (MIT-Lizenz) ist die Nutzung unbegrenzt kostenlos."
      },
      {
        question: "Speichert ShopCart MCP meine Claude-Chats oder Zahlungsdaten?",
        answer:
          "Nein. ShopCart MCP speichert weder Chat-Verläufe noch Lieferadressen, Shop-Logins oder Zahlungsdaten. Im gehosteten EU-Betrieb (europe-west1) werden ausschließlich Konto-E-Mail, verschlüsselte Anmelde-Hashes und der tägliche Nutzungszähler gespeichert."
      }
    ],
    hreflang: {
      de: "/guides/mit-claude-online-einkaufen",
      en: "/en/guides/shop-with-claude",
      xDefault: "/en/guides/shop-with-claude"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "kann claude online einkaufen",
      "claude warenkorb bauen",
      "claude shopping mcp",
      "ki warenkorb erstellen",
      "shopcart mcp"
    ]
  },
  {
    path: "/guides/chatgpt-warenkorb-erstellen",
    lang: "de",
    category: "ChatGPT Shopping Guide",
    title: "Kann ChatGPT einen Warenkorb erstellen? Ja — per offenem MCP (2026)",
    metaTitle: "Kann ChatGPT einen Warenkorb erstellen? Ja — per MCP (2026)",
    metaDescription:
      "Ja: Auch ohne Instant Checkout baut ChatGPT 2026 per ShopCart MCP geprüfte Warenkörbe für Shopify, WooCommerce & Amazon-Links — read-only.",
    cardSummary:
      "Ja — trotz zurückgefahrenem Instant Checkout baut ChatGPT 2026 über ShopCart MCP echte, geprüfte Warenkörbe zum Selbstbezahlen im Browser.",
    tldrLabel: "Kurzantwort:",
    tldrText:
      "Ja — ChatGPT kann 2026 fertige Warenkörbe erstellen, obwohl OpenAI den eigenständigen Instant Checkout zurückgefahren hat. Über das offene Model Context Protocol (MCP) verbindet sich ChatGPT mit ShopCart MCP (https://shopcart.wals.pro/mcp), prüft Größen, Live-Preise und Lagerbestand direkt in öffentlichen Shopify- und WooCommerce-Shops (plus offizielle Amazon-Cart-Links) und liefert einen geprüften Warenkorb-Link zum Selbstbezahlen.",
    intro:
      "Viele ältere Blogartikel und Kurzvideos behaupten noch immer, ChatGPT könne höchstens Text-Einkaufslisten schreiben und keinen echten Warenkorb füllen. Mit Custom MCP Connectors ist diese Aussage 2026 überholt: Hier siehst du, wie ChatGPT in Sekunden einen geprüften Warenkorb-Link baut.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Funktioniert auch nach dem Rückzug von Instant Checkout.",
        text: "Statt auf geschlossene In-Chat-Bezahlstrecken angewiesen zu sein, nutzt ChatGPT das offene Model Context Protocol (MCP) für echte Warenkorb-Links."
      },
      {
        lead: "Live-Varianten statt ausverkaufter Treffer.",
        text: "Auf öffentlichen Shopify- und WooCommerce-Shops liest ChatGPT exakte Größen, Farben, Stückzahlen und aktuelle Preise live vor dem Link-Bau."
      },
      {
        lead: "Mehrere Artikel in einem Klick im Warenkorb.",
        text: "Bis zu 20 Positionen landen gebündelt in einem geprüften Browser-Warenkorb — plus offizielle Amazon-Multi-Artikel-Links über 10 Marktplätze."
      },
      {
        lead: "Kein Auto-Checkout, volle Kontrolle.",
        text: "ShopCart MCP ist strikt read-only und EU-gehostet. Du öffnest den Link im Browser, kontrollierst den Warenkorb auf der Shop-Seite und bezahlst selbst."
      }
    ],
    primaryAssistant: "chatgpt",
    starterPrompt:
      "Nutze den ShopCart MCP Connector (https://shopcart.wals.pro/mcp) — falls er noch nicht verbunden ist, führe mich kurz durch das 2-Klick-Setup. Finde mir dann auf got-bag.com lieferbare wasserdichte Rolltop-Rucksäcke unter 180 €, vergleiche Farben und Preise und erstelle mir einen geprüften Warenkorb-Link.",
    ctaHeading: "Sofort in ChatGPT oder Claude starten",
    ctaSubtext:
      "Ein Klick öffnet den fertigen Beispiel-Prompt — dein KI-Assistent führt dich bei Bedarf direkt durch die kurze 2-Klick-Verbindung mit ShopCart MCP.",
    sections: [
      {
        heading: "Warum viele Antworten noch „Nein“ sagen — und was 2026 per MCP geht",
        paragraphs: [
          "Ohne aktiven MCP-Connector liefert die normale ChatGPT-Websuche tatsächlich nur Text-Einkaufslisten oder einzelne Produkt-URLs mit oft veralteten Preisen. Hinzu kommt, dass OpenAI seinen eigenständigen In-Chat-Instant-Checkout Anfang 2026 zurückgefahren hat — viele Artikel schließen daraus fälschlich, fertige KI-Warenkörbe seien nicht möglich.",
          "Über Custom MCP Connectors ändert sich das grundlegend: Mit ShopCart MCP erhält ChatGPT strukturierten Lesezugriff auf öffentliche Shopify- und WooCommerce-Kataloge, prüft Größen und Bestand live und erzeugt einen offiziellen Warenkorb-Link, der alle Artikel auf einmal in deinem Browser lädt."
        ],
        takeaway:
          "Fazit: Nicht der ChatGPT-Chat allein, sondern ChatGPT + offenes MCP macht aus Textlisten echte, geprüfte Warenkörbe."
      },
      {
        heading: "ChatGPT Custom Connector einrichten und Warenkorb füllen",
        paragraphs: [
          "Die Einrichtung dauert weniger als eine Minute und erfordert keinerlei Programmierkenntnisse."
        ],
        orderedSteps: [
          {
            lead: "Custom Connector hinzufügen:",
            text: "Öffne in ChatGPT die Connector- bzw. App-Einstellungen, trage https://shopcart.wals.pro/mcp ein und melde dich per OAuth 2.1 in zwei Klicks an."
          },
          {
            lead: "Einkaufsauftrag mit Budget und Größen formulieren:",
            text: "Nenne ChatGPT die gewünschte Shop-Domain sowie Artikel, Farben, Größen, Stückzahlen oder dein Maximalbudget."
          },
          {
            lead: "Live-Prüfung abwarten:",
            text: "ChatGPT ruft automatisch inspect_store, search_products und get_product auf, prüft echte Streichpreise (compare_at_price) und sortiert ausverkaufte Varianten aus."
          },
          {
            lead: "Fertigen Warenkorb-Link im Browser öffnen:",
            text: "Über create_cart_link erhältst du einen geprüften Warenkorb-Link, der alle Artikel direkt auf der Shop-Website lädt — zum entspannten Prüfen und Selbstbezahlen."
          }
        ],
        takeaway:
          "Fazit: Einmal verbunden, erledigt ChatGPT den kompletten Varianten- und Bestandsabgleich automatisch im Hintergrund."
      },
      {
        heading: "ChatGPT Websuche vs. Instant Checkout vs. ChatGPT + ShopCart MCP",
        paragraphs: [
          "Gerade bei mehreren Produkten, knappen Größen oder DACH-Shops zeigt der direkte Vergleich den Unterschied."
        ],
        table: {
          id: "chatgpt-compare-table",
          caption: "Vergleich: ChatGPT Websuche, zurückgefahrener Instant Checkout und ChatGPT mit ShopCart MCP",
          headers: [
            "Funktion",
            "ChatGPT Websuche",
            "Zurückgefahrener Instant Checkout",
            "ChatGPT + ShopCart MCP"
          ],
          rows: [
            [
              "Warenkorb direkt füllen",
              "Nein — nur Textliste & Einzellinks",
              "Eigenständiger In-Chat-Flow 2026 zurückgefahren",
              "Ja — geprüfter Multi-Artikel-Warenkorb-Permalink"
            ],
            [
              "Größen & Farben live prüfen",
              "Oft unvollständig oder veraltet",
              "Nur bei angebundenen Pilot-Händlern",
              "Live je Varianten-ID auf öffentlichen Shopify- & WooCommerce-Shops"
            ],
            [
              "Budget- & Rabatt-Prüfung",
              "Schätzung aus Such-Snippets",
              "Eingeschränkt",
              "Exakter Filter (min_price / max_price) & echter Streichpreis"
            ],
            [
              "DACH- & EU-Verfügbarkeit",
              "Ja (ohne Warenkorb-Bau)",
              "Stark US-zentriert",
              "EU-gehostet (europe-west1), EUR, CHF, GBP & USD"
            ],
            [
              "Datenschutz & Bezahlung",
              "Checkout im Browser",
              "Zahlungsdaten im KI-Ökosystem",
              "Strikt read-only — keine Zahlungsdaten bei ShopCart MCP"
            ]
          ]
        },
        takeaway:
          "Fazit: ChatGPT plus ShopCart MCP liefert präzise, plattformoffene Warenkörbe ohne Zahlungs-Lock-in."
      },
      {
        heading: "Praxisbeispiele: So formulierst du starke Shopping-Prompts",
        paragraphs: [
          "Je konkreter dein Wunsch, desto besser filtert ChatGPT das Sortiment. Nenne idealerweise immer die regionale Shop-Domain (z. B. EU- oder DE-Shop), deine gewünschte Größe sowie ein klares Preislimit.",
          "Typische Prompts sind etwa: „Suche mir auf got-bag.com lieferbare Rolltop-Rucksäcke unter 180 € und leg die schwarze Variante in den Warenkorb“ oder „Stell mir bei snocks.com ein Set aus 2× weißen Tennissocken und 1× Boxershorts in Größe L zusammen und gib mir einen Warenkorb-Link.“"
        ],
        takeaway:
          "Fazit: Mit klarer Shop-Domain, Größe und Preisgrenze liefert ChatGPT auf Anhieb bestellfertige Warenkörbe."
      },
      {
        heading: "Kosten, EU-Hosting und Read-Only-Garantie",
        paragraphs: [
          "Der gehostete MCP-Server von wals.pro läuft in der EU (Google Cloud, europe-west1) und umfasst im Free-Tarif dauerhaft 20 Abfragen pro Tag kostenlos. Für größere Einkaufsrunden bietet der Pro-Tarif 500 Abfragen pro Tag für 9 € im Monat — lokal per npx -y shopcart-mcp ist die Open-Source-CLI unter MIT-Lizenz unbegrenzt gratis.",
          "ShopCart MCP speichert weder Chat-Verläufe noch Lieferadressen, Shop-Zugänge oder Zahlungsdaten. Jeder Kaufabschluss erfolgt direkt zwischen dir und dem Händler im Browser."
        ],
        takeaway:
          "Fazit: Du testest risikofrei und kostenlos, ohne jemals Zahlungsdaten an ein Dritt-Tool weiterzugeben."
      }
    ],
    howToName: "ChatGPT mit ShopCart MCP verbinden und Warenkorb erstellen",
    howToDescription:
      "Schritt-für-Schritt-Anleitung, wie du ShopCart MCP als Custom Connector in ChatGPT hinzufügst und geprüfte Browser-Warenkörbe baust.",
    howToSteps: [
      {
        name: "Custom MCP Connector in ChatGPT eintragen",
        text: "Füge https://shopcart.wals.pro/mcp als Custom MCP Connector in den ChatGPT-Einstellungen hinzu und bestätige den OAuth-2.1-Login."
      },
      {
        name: "Produkte, Größen und Budget im Chat angeben",
        text: "Nenne ChatGPT die gewünschte Shop-Domain, die gesuchten Artikel, Varianten und dein Budget."
      },
      {
        name: "Geprüften Warenkorb-Link öffnen",
        text: "Klicke auf den von ChatGPT gelieferten Warenkorb-Link, prüfe Positionen und Versandkosten auf der Shop-Website und schließe die Bestellung selbst ab."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser Leitfaden basiert auf den folgenden geprüften Quellen (alle abgerufen am 26.11.2026):",
    sources: SOURCES_DE,
    limitationsLabel: "Grenzen:",
    limitationsText:
      "Vollständige unauthentifizierte Live-Katalog-, Varianten- und Bestandsprüfung gilt für öffentliche Shopify- und WooCommerce-Shops ohne Login-Pflicht. Bei Amazon sperrt die Plattform automatisierte Checkout-Bots; ShopCart MCP unterstützt dort offizielle Multi-Artikel-Warenkorb-Links (/gp/aws/cart/add.html) über 10 Marktplätze kombiniert mit Websuche oder optional Keepa/PA-API. Passwortgeschützte B2B-Shops werden nicht unterstützt.",
    faqHeading: "Häufige Fragen zu ChatGPT & Warenkorb-Links",
    faqs: [
      {
        question: "Nutzt ChatGPT MCP?",
        answer:
          "Ja. ChatGPT unterstützt Custom Remote MCP Connectors mit Streamable HTTP und OAuth 2.1. Nach dem Hinzufügen von https://shopcart.wals.pro/mcp greift ChatGPT direkt auf die vier Read-Only-Shopping-Tools von ShopCart MCP zu."
      },
      {
        question: "Warum behaupten manche Suchergebnisse, ChatGPT könne keinen Warenkorb erstellen?",
        answer:
          "Weil viele ältere Artikel nur die normale ChatGPT-Websuche betrachten oder sich auf den 2026 zurückgefahrenen Instant Checkout beziehen. Mit einem offenen MCP-Server wie ShopCart MCP erstellt ChatGPT heute zuverlässig echte Multi-Artikel-Warenkorb-Links."
      },
      {
        question: "Funktioniert ein ChatGPT-Warenkorb auch bei Amazon?",
        answer:
          "Amazon blockiert automatisierte Drittanbieter-Checkout-Bots und offenes Katalog-Scraping. Mit ShopCart MCP kannst du jedoch offizielle Amazon-Multi-Artikel-Links (/gp/aws/cart/add.html) für 10 Marktplätze erzeugen — kombiniert mit Websuche oder optional Keepa/PA-API — während öffentliche Shopify- und WooCommerce-Shops volle Live-Suche bieten."
      },
      {
        question: "Kann ChatGPT mit ShopCart MCP selbstständig bestellen oder bezahlen?",
        answer:
          "Nein. ShopCart MCP arbeitet rein lesend und erzeugt ausschließlich einen Warenkorb-Link. ChatGPT kann weder Zahlungsdaten einsehen noch eine Bestellung auslösen — du bezahlst immer selbst im Browser."
      },
      {
        question: "Baut dieser Guide einen Online-Shop oder einen Käufer-Warenkorb?",
        answer:
          "Einen echten Käufer-Warenkorb für bestehende Online-Shops. ShopCart MCP ist ein Einkaufs-Connector für Endkunden, kein Website-Baukasten zum Erstellen eigener Shops."
      },
      {
        question: "Was kostet die Nutzung von ShopCart MCP in ChatGPT?",
        answer:
          "Im Free-Tarif sind 20 Tool-Aufrufe pro Tag dauerhaft kostenlos. Im Pro-Tarif erhältst du 500 Aufrufe pro Tag für 9 €/Monat. Lokal unter MIT-Lizenz (npx -y shopcart-mcp) ist die Nutzung unbegrenzt kostenlos."
      }
    ],
    hreflang: {
      de: "/guides/chatgpt-warenkorb-erstellen",
      en: "/en/guides/chatgpt-shopify-cart",
      xDefault: "/en/guides/chatgpt-shopify-cart"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "kann chatgpt einen warenkorb erstellen",
      "chatgpt warenkorb erstellen",
      "chatgpt shopping mcp",
      "chatgpt shopify warenkorb",
      "ki einkaufsassistent"
    ]
  },
  {
    path: "/guides/adventskalender-mit-ki-finden",
    lang: "de",
    category: "Saisonaler Einkaufs-Guide",
    title: "Adventskalender & Black-Friday-Geschenke mit KI finden",
    metaTitle: "Adventskalender & Black-Friday-Geschenke mit KI finden",
    metaDescription:
      "Finde lieferbare Adventskalender & Black-Friday-Geschenke mit Claude oder ChatGPT — z. B. bei KERNenergie, SNOCKS & PURELEI mit direktem Warenkorb-Link.",
    cardSummary:
      "Spare dir das Tab-Chaos rund um Black Friday und Advent: Lass Claude oder ChatGPT lieferbare Kalender, echte Rabatte und Geschenk-Bundles live prüfen.",
    tldrLabel: "Kurz gesagt:",
    tldrText:
      "Mit Claude oder ChatGPT und ShopCart MCP findest du lieferbare Adventskalender und Black-Friday-Geschenke in öffentlichen Shopify-Shops wie KERNenergie, SNOCKS oder PURELEI nach Budget, prüfst echte Streichpreise live und öffnest deinen fertigen Warenkorb mit einem Klick.",
    intro:
      "Ende November sind beliebte Adventskalender und Geschenksets oft innerhalb von Stunden vergriffen, während Dutzende Sale-Banner den Überblick erschweren. Hier erfährst du, wie deine KI lieferbare Kalender und echte Black-Friday-Rabatte live prüft und direkt für deinen Warenkorb vorbereitet.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Nur lieferbare Kalender & Größen anzeigen.",
        text: "Mit dem Filter available_only: true sortiert ShopCart MCP ausverkaufte Adventskalender und vergriffene Geschenkgrößen sofort aus."
      },
      {
        lead: "Echte Rabatte statt Marketing-Versprechen.",
        text: "Die KI liest Live-Preis und regulären Streichpreis (compare_at_price) direkt beim Shop aus und zeigt nur echte Preisreduktionen."
      },
      {
        lead: "Klare Budget-Grenzen einhalten.",
        text: "Egal ob Wichtelgeschenk unter 30 € oder Premium-Adventskalender unter 100 € — per max_price bleibt jede Empfehlung exakt im Rahmen."
      },
      {
        lead: "Black-Friday-Launch-Vorteil bis 06.12.2026.",
        text: "Alle angemeldeten Konten erhalten während der Launch-Aktion automatisch 500 kostenlose Tool-Abfragen pro Tag für ausgiebige Geschenke-Sessions."
      }
    ],
    primaryAssistant: "claude",
    starterPrompt:
      "Nutze ShopCart MCP (https://shopcart.wals.pro/mcp). Suche mir lieferbare Adventskalender und Geschenkideen unter 80 € bei kern-energie.com, snocks.com oder purelei.com, prüfe echte Streichpreise und Verfügbarkeit und bau mir für meinen Favoriten einen fertigen Warenkorb-Link.",
    ctaHeading: "Adventskalender- & Geschenke-Prompt mit 1 Klick starten",
    ctaSubtext:
      "Starte deine Geschenkesuche sofort in Claude oder ChatGPT — inklusive Live-Bestandsprüfung und direktem Warenkorb-Link.",
    sections: [
      {
        heading: "Warum Adventskalender- und Black-Friday-Suche per Hand so viel Zeit frisst",
        paragraphs: [
          "Gerade in der Black-Week ändern sich Preise und Bestände im Stundentakt. Klassische Vergleichsportale oder Suchmaschinen-Ergebnisse zeigen häufig Kalender, die beim Klick auf den Shop bereits ausverkauft sind — oder Rabatte, die längst abgelaufen sind.",
          "Wenn du gleichzeitig Geschenke für mehrere Personen in unterschiedlichen Shops suchst, verlierst du schnell den Überblick über Größen, Varianten und Gesamtbudget. Eine KI mit Live-Shop-Anbindung übernimmt diese Fleißarbeit in Sekunden."
        ],
        takeaway:
          "Fazit: Live-Daten direkt aus dem Shop verhindern Enttäuschung durch ausverkaufte Kalender und veraltete Deal-Links."
      },
      {
        heading: "Beispiel-Shops für Adventskalender & Geschenke: KERNenergie, SNOCKS & PURELEI",
        paragraphs: [
          "Tausende beliebte DACH-Marken setzen auf Shopify-Storefronts und lassen sich direkt mit ShopCart MCP nach lieferbaren Adventskalendern und Geschenkideen durchsuchen. Drei typische Beispiele aus Food, Basics und Schmuck:"
        ],
        bullets: [
          {
            lead: "KERNenergie (kern-energie.com):",
            text: "Ideal für Genuss-Adventskalender, Nuss-Mix-Geschenkboxen und edle Präsent-Sets — per Budgetfilter schnell nach Preis und Verfügbarkeit sortierbar."
          },
          {
            lead: "SNOCKS (snocks.com):",
            text: "Stark für praktische Alltagsgeschenke, Socken- und Unterwäsche-Bundles sowie Adventskalender-Editionen mit exakter Größenprüfung (z. B. 39–42 oder 43–46)."
          },
          {
            lead: "PURELEI (purelei.com):",
            text: "Beliebt für Schmuck-Adventskalender und Geschenksets in Gold, Silber oder Roségold — inklusive Varianten-Check je Farbe und direktem Warenkorb-Link."
          }
        ],
        takeaway:
          "Fazit: Nenne deiner KI einfach ein bis drei Wunsch-Shops plus Budget — sie vergleicht lieferbare Optionen live und bereitet den Warenkorb vor."
      },
      {
        heading: "Typische Geschenke-Szenarien und passende Filter-Strategien",
        paragraphs: [
          "Je nach Anlass kombiniert deine KI die vier ShopCart-MCP-Werkzeuge gezielt mit Preis-, Verfügbarkeits- und Variantenfiltern."
        ],
        table: {
          id: "advent-scenarios-table",
          caption: "Übersicht typischer Adventskalender- und Black-Friday-Szenarien mit ShopCart MCP",
          headers: ["Anlass", "Sinnvolle Filter im Prompt", "Ergebnis für deinen Warenkorb"],
          rows: [
            [
              "Adventskalender finden",
              "Stichwort „Adventskalender“, available_only: true, max_price",
              "Nur sofort lieferbare Kalender im Budget inkl. Varianten"
            ],
            [
              "Black-Friday-Bundle",
              "Mehrere Artikel + exakte Größen & Farben prüfen",
              "Ein gemeinsamer Warenkorb-Link mit bis zu 20 Positionen"
            ],
            [
              "Geschenke unter 50 €",
              "max_price: 50 + Vergleich echter Streichpreise",
              "Klare Shortlist mit echten Rabatten statt Schein-Deals"
            ],
            [
              "Shop-übergreifender Vergleich",
              "2–3 Shops nacheinander inspizieren & Währung prüfen",
              "Übersichtlicher Vergleich und Warenkorb für den Favoriten"
            ]
          ]
        },
        takeaway:
          "Fazit: Mit klaren Budget- und Verfügbarkeitsvorgaben findest du in Minuten statt Stunden passende Geschenke."
      },
      {
        heading: "So erkennt die KI echte Black-Friday-Rabatte statt Scheinangebote",
        paragraphs: [
          "ShopCart MCP weist einen Rabatt nur dann aus, wenn der Shop über die Produkt-API sowohl einen aktuellen Verkaufspreis als auch einen strikt höheren Vergleichspreis (compare_at_price) liefert. Erfundene Gutscheincodes oder geratene Prozentzahlen sind ausgeschlossen.",
          "Sobald du dich für einen Adventskalender oder ein Geschenk-Bundle entschieden hast, prüft create_cart_link die Varianten-IDs noch einmal live gegen den Shop. Danach öffnest du den Warenkorb direkt im Browser des Händlers, siehst Versandkosten sowie Lieferzeiten und schließt den Kauf selbst ab."
        ],
        takeaway:
          "Fazit: Du profitierst von schnellem KI-Vergleich, behältst aber volle Transparenz bei Endpreis, Lieferzeit und Bezahlung."
      },
      {
        heading: "Black-Friday-Aktion: 500 kostenlose Abfragen pro Tag bis 06.12.2026",
        paragraphs: [
          "Während der Black-Friday-Launch-Aktion bis einschließlich 06.12.2026 schaltet ShopCart MCP für alle angemeldeten gehosteten Konten automatisch das volle Pro-Kontingent mit 500 Tool-Abfragen pro Tag kostenlos frei — ideal für ausführliche Adventskalender- und Weihnachts-Recherchen. Danach bleibt der Free-Tarif mit 20 Abfragen pro Tag dauerhaft kostenlos (Pro optional 9 €/Monat, monatlich kündbar)."
        ],
        takeaway:
          "Fazit: Perfektes Timing für Black Week und Weihnachtseinkäufe — kostenlos testen, ohne Kreditkarte und jederzeit read-only."
      }
    ],
    howToName: "Adventskalender und Black-Friday-Geschenke mit KI finden",
    howToDescription:
      "So findest du mit Claude oder ChatGPT und ShopCart MCP lieferbare Adventskalender und echte Black-Friday-Angebote nach Budget.",
    howToSteps: [
      {
        name: "ShopCart MCP verbinden",
        text: "Verbinde https://shopcart.wals.pro/mcp in Claude oder ChatGPT per OAuth 2.1 oder starte über die 1-Klick-Buttons oben."
      },
      {
        name: "Anlass, Wunsch-Shops und Budget nennen",
        text: "Schreibe deiner KI, ob du Adventskalender oder Geschenke suchst, nenne ein Budget (z. B. unter 80 €) und Wunsch-Shops wie KERNenergie, SNOCKS oder PURELEI."
      },
      {
        name: "Lieferbare Favoriten wählen und Warenkorb öffnen",
        text: "Lass dir nur lieferbare Varianten und echte Streichpreise zeigen, öffne den geprüften Warenkorb-Link im Browser und bestelle selbst im Online-Shop."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser Ratgeber basiert auf folgenden geprüften Quellen (alle abgerufen am 26.11.2026):",
    sources: SOURCES_DE,
    limitationsLabel: "Grenzen & Markenhinweis:",
    limitationsText:
      "Verfügbarkeiten und Aktionspreise von Adventskalendern können sich rund um Black Friday binnen Minuten ändern — prüfe den finalen Preis und die Lieferzeit immer im Warenkorb des Händlers. Genannte Beispiel-Marken wie KERNenergie, SNOCKS und PURELEI dienen ausschließlich als öffentliche Anwendungsbeispiele; alle Marken gehören ihren jeweiligen Eigentümern und es besteht keine Partnerschaft oder Verbindung.",
    faqHeading: "Häufige Fragen zur Adventskalender- & Geschenkesuche mit KI",
    faqs: [
      {
        question: "Findet ShopCart MCP nur noch lieferbare Adventskalender?",
        answer:
          "Ja. Wenn deine KI mit available_only: true sucht und anschließend die Varianten per get_product prüft, werden ausverkaufte Adventskalender zuverlässig aussortiert, bevor ein Warenkorb-Link entsteht."
      },
      {
        question: "Kann ich mehrere Shops wie KERNenergie, SNOCKS und PURELEI vergleichen?",
        answer:
          "Ja. Claude und ChatGPT können mehrere öffentliche Shopify- und WooCommerce-Shops nacheinander abfragen, Preise und Verfügbarkeiten übersichtlich gegenüberstellen und dir für deinen gewählten Shop einen fertigen Warenkorb-Link bauen."
      },
      {
        question: "Prüft ShopCart MCP echte Black-Friday-Rabatte?",
        answer:
          "Ja. Die KI liest Live-Preis und regulären compare_at_price direkt vom Shop aus und weist einen Rabatt nur aus, wenn der Streichpreis tatsächlich über dem aktuellen Preis liegt."
      },
      {
        question: "Bestellt die KI den Adventskalender automatisch?",
        answer:
          "Nein. ShopCart MCP arbeitet strikt lesend. Du öffnest den geprüften Warenkorb-Link selbst im Browser, kontrollierst Versandkosten sowie Liefertermin und bezahlst wie gewohnt beim Händler."
      },
      {
        question: "Wie viele Suchen kann ich während der Black Week kostenlos durchführen?",
        answer:
          "Während der Black-Friday-Launch-Aktion bis zum 06.12.2026 stehen allen angemeldeten Konten automatisch 500 Tool-Abfragen pro Tag gratis zur Verfügung. Danach bleiben 20 Abfragen pro Tag im Free-Tarif dauerhaft kostenlos."
      }
    ],
    hreflang: {
      de: "/guides/adventskalender-mit-ki-finden",
      en: "/en/guides/chatgpt-shopify-cart",
      xDefault: "/guides/adventskalender-mit-ki-finden"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "adventskalender finden ki",
      "black friday ki",
      "geschenke finden ki",
      "ki preisvergleich",
      "shopify mcp"
    ]
  },
  {
    path: "/en/guides/shop-with-claude",
    lang: "en",
    category: "Claude Shopping Guide",
    title: "Can Claude Build a Shopping Cart? Shop Any Store via MCP (2026)",
    metaTitle: "Can Claude Build a Shopping Cart? Shop via MCP (2026)",
    metaDescription:
      "Yes: Connect Claude to ShopCart MCP to verify live stock, sizes, and prices on public Shopify & WooCommerce stores and get a read-only cart link.",
    cardSummary:
      "Yes: Connect Claude.ai or Claude Desktop in two clicks to verify live stock and build real multi-item shopping carts globally — strictly read-only.",
    tldrLabel: "Direct Answer:",
    tldrText:
      "Yes — Claude can build verified multi-item shopping carts across thousands of public Shopify and WooCommerce stores (plus official Amazon multi-item cart links) using ShopCart MCP (https://shopcart.wals.pro/mcp). Unlike regional grocery-only apps, ShopCart MCP works globally in EUR, USD, GBP, and CHF, checks live stock per variant ID, and returns a strictly read-only browser cart link you review and pay yourself.",
    intro:
      "Tired of reading that Claude can only shop inside a couple of regional grocery apps or requires fragile browser automation? This 2026 guide shows how to connect Claude via the open Model Context Protocol (MCP) to verify live stock and build a ready-to-open shopping cart in seconds.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Global multi-item carts instead of regional grocery silos.",
        text: "Works across independent public Shopify and WooCommerce stores in EUR, USD, GBP, and CHF — plus official Amazon multi-item cart permalinks across 10 marketplaces."
      },
      {
        lead: "Strictly read-only by architecture.",
        text: "Claude never places orders, never sees payment cards, and never accesses store logins — you review and pay directly in your own browser."
      },
      {
        lead: "Works on Claude.ai Web, Mobile, Desktop, and Claude Code.",
        text: "Connect the hosted OAuth 2.1 endpoint at https://shopcart.wals.pro/mcp in two clicks, or run the free MIT-licensed CLI locally via npx -y shopcart-mcp."
      },
      {
        lead: "Deterministic variant & stock verification.",
        text: "Claude checks exact variant IDs, sizes, colors, and genuine compare-at markdowns live before creating your cart link."
      }
    ],
    primaryAssistant: "claude",
    starterPrompt:
      "Use ShopCart MCP (https://shopcart.wals.pro/mcp) — if it is not connected yet, guide me through the 2-click connector setup first. Then search got-bag.com for available waterproof rolltop backpacks under €180, compare colors and live stock, and build a verified browser cart link.",
    ctaHeading: "Try it now: 1-Click Starter Prompt",
    ctaSubtext:
      "Launch a ready-to-run shopping prompt directly in Claude or ChatGPT — including quick connector guidance if you have not linked ShopCart MCP yet.",
    sections: [
      {
        heading: "Why regional grocery apps and browser bots fall short for Claude shopping",
        paragraphs: [
          "Most articles answering \"Can Claude build a shopping cart?\" only mention country-specific grocery apps or browser extensions that click through web pages one element at a time. Those approaches break on popups, skip desktop-to-mobile portability, and cover only a tiny slice of online stores.",
          "With ShopCart MCP, Claude talks directly to structured public storefront endpoints instead of guessing from cached snippets or fragile DOM selectors — giving you a deterministic, ready-to-open cart link in one shot."
        ],
        takeaway:
          "Takeaway: An open MCP server lets Claude build verified carts globally without regional lock-in or brittle browser clicking."
      },
      {
        heading: "How Claude builds a verified shopping cart in four read-only steps",
        paragraphs: [
          "ShopCart MCP uses the open Model Context Protocol (MCP) to give Claude four focused read-only tools. Instead of scraping HTML guesses, the server reads structured catalog endpoints live and builds an official cart permalink."
        ],
        orderedSteps: [
          {
            lead: "Inspect the store (inspect_store):",
            text: "Detects public Shopify and WooCommerce storefronts (or Amazon marketplaces for cart permalinks) and resolves canonical origin, currency, country, and firewall rules."
          },
          {
            lead: "Search the catalog (search_products):",
            text: "Finds matching products on public Shopify and WooCommerce stores with optional filters for live availability and minimum or maximum price in native currency."
          },
          {
            lead: "Verify variants and stock (get_product):",
            text: "Retrieves exact variant IDs for every size and color alongside live pricing, genuine compare-at discounts, and in-stock status."
          },
          {
            lead: "Create the cart link (create_cart_link):",
            text: "Re-verifies your chosen items against the store and generates a browser cart permalink so all selected items load in one click."
          }
        ],
        takeaway:
          "Takeaway: Four deterministic read-only calls ensure the exact sizes, colors, and quantities land in your cart."
      },
      {
        heading: "Regional grocery apps vs. browser bots vs. Claude + ShopCart MCP",
        paragraphs: [
          "Compare the three main ways people try to shop with Claude in 2026."
        ],
        table: {
          id: "claude-en-compare-table",
          caption: "Comparison of regional grocery apps, browser automation extensions, and Claude with ShopCart MCP",
          headers: [
            "Dimension",
            "Regional Grocery Apps",
            "Browser Automation Extensions",
            "Claude + ShopCart MCP"
          ],
          rows: [
            [
              "Store & country coverage",
              "Single region / groceries only",
              "Desktop browser only; breaks on anti-bot walls",
              "Global Shopify & WooCommerce stores + 10 Amazon cart marketplaces"
            ],
            [
              "Size & color stock check",
              "Limited to grocery SKUs",
              "Slow manual DOM clicking",
              "Verified live per exact variant ID before linking"
            ],
            [
              "Mobile support (Claude.ai App)",
              "App-dependent",
              "No (requires desktop browser extension)",
              "Yes — works on Claude.ai Web, Mobile, Desktop & Claude Code"
            ],
            [
              "Multi-item bundles",
              "One partner grocer at a time",
              "Fragile multi-step click scripts",
              "Up to 20 line items combined into one verified cart link"
            ],
            [
              "Checkout & privacy safety",
              "Tied to third-party partner account",
              "Shares live browser cookies & sessions",
              "Strictly read-only — review and payment stay in your browser"
            ]
          ]
        },
        takeaway:
          "Takeaway: Claude with ShopCart MCP works globally, runs on mobile and desktop, and never touches your active browser cookies or payment cards."
      },
      {
        heading: "Set up ShopCart MCP in Claude.ai or Claude Desktop in 30 seconds",
        paragraphs: [
          "In Claude.ai (Web or Mobile), open your custom connector settings, paste https://shopcart.wals.pro/mcp, and complete the two-click OAuth 2.1 sign-in. No config files or developer tools are needed.",
          "If you prefer running everything locally in Claude Desktop, Claude Code, or Cursor, launch the MIT-licensed open-source CLI via npx -y shopcart-mcp with unlimited calls and zero telemetry. Hosted accounts include 20 free tool calls per day permanently, while Pro offers 500 calls/day for €9/month."
        ],
        takeaway:
          "Takeaway: Hosted setup takes two clicks, while local open-source users get unlimited usage with no account required."
      },
      {
        heading: "Security and privacy: why read-only cart permalinks matter",
        paragraphs: [
          "Handing credit cards or merchant passwords to an autonomous agent creates unnecessary risk. ShopCart MCP eliminates that surface completely by stopping at the merchant's official cart page.",
          "All four tools carry read-only MCP annotations and never submit orders, collect shipping addresses, or store chat transcripts. Under the hood, the server strips HTML and invisible Unicode characters from third-party catalog text to defend against prompt injection and enforces DNS-pinned SSRF controls. Hosted accounts run in the EU (Google Cloud europe-west1)."
        ],
        takeaway:
          "Takeaway: Claude handles research and cart assembly, while privacy and final checkout remain 100 percent under your control."
      }
    ],
    howToName: "How to build a verified shopping cart with Claude via MCP",
    howToDescription:
      "Connect ShopCart MCP to Claude and generate a verified browser cart link for public Shopify and WooCommerce stores or official Amazon cart permalinks.",
    howToSteps: [
      {
        name: "Connect ShopCart MCP to Claude",
        text: "Add https://shopcart.wals.pro/mcp as a custom MCP connector in Claude and finish the two-click OAuth 2.1 login (or run npx -y shopcart-mcp locally)."
      },
      {
        name: "Describe products, sizes, and budget",
        text: "Tell Claude which store to search along with your preferred products, colors, sizes, quantities, or maximum budget."
      },
      {
        name: "Open the verified cart link and check out yourself",
        text: "Claude verifies live stock and exact variant IDs and returns a ready-to-open cart link. Open it in your browser, review the cart on the store's site, and pay as usual."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro: "This guide is grounded in the following verified sources (all retrieved on 2026-11-26):",
    sources: SOURCES_EN,
    limitationsLabel: "Limitations:",
    limitationsText:
      "Full unauthenticated live catalog, stock, and variant verification applies to public Shopify and WooCommerce storefronts without login gates. On Amazon, automated checkout bots are restricted; ShopCart MCP supports official Amazon multi-item cart permalinks (/gp/aws/cart/add.html) across 10 marketplaces paired with web search or optional Keepa/PA-API keys. Password-protected B2B portals are not supported.",
    faqHeading: "Frequently Asked Questions",
    faqs: [
      {
        question: "Can Claude shop for you?",
        answer:
          "Yes — with ShopCart MCP connected, Claude can search public Shopify and WooCommerce stores live, verify sizes, stock, and prices, and hand you a ready-to-open browser cart link (plus official multi-item Amazon cart permalinks). For your safety, Claude never pays automatically: you review the cart and check out yourself."
      },
      {
        question: "Does Claude place orders or charge my card automatically with ShopCart MCP?",
        answer:
          "No. Every tool in ShopCart MCP is strictly read-only and only creates a browser cart permalink. You open the link on the merchant's website, inspect items and shipping, and complete checkout yourself."
      },
      {
        question: "Does ShopCart MCP work on Claude.ai Web, Mobile, and Claude Desktop?",
        answer:
          "Yes. On Claude.ai Web and Mobile you connect the hosted OAuth 2.1 endpoint at https://shopcart.wals.pro/mcp. On Claude Desktop and Claude Code you can use either the hosted server or the local MIT open-source CLI via npx -y shopcart-mcp."
      },
      {
        question: "Which online stores are supported?",
        answer:
          "ShopCart MCP runs full live catalog, stock, and variant searches on thousands of public Shopify and WooCommerce storefronts worldwide across USD, EUR, GBP, CHF, and other currencies, and builds official multi-item cart permalinks across 10 Amazon marketplaces."
      },
      {
        question: "How much does ShopCart MCP cost?",
        answer:
          "The hosted Free plan includes 20 tool calls per day permanently. The Pro plan offers 500 calls per day for €9 per month. The local open-source CLI (npx -y shopcart-mcp) is free and unlimited under the MIT License."
      },
      {
        question: "Does ShopCart MCP store my Claude chats or payment details?",
        answer:
          "No. ShopCart MCP never stores chat transcripts, shipping addresses, merchant logins, or payment details. Hosted EU accounts store only your account email, hashed login credentials, and a numeric daily call counter."
      }
    ],
    hreflang: {
      en: "/en/guides/shop-with-claude",
      de: "/guides/mit-claude-online-einkaufen",
      xDefault: "/en/guides/shop-with-claude"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "can claude build a shopping cart",
      "can claude shop for you",
      "shop with claude",
      "claude mcp shopping",
      "ai shopping assistant"
    ]
  },
  {
    path: "/en/guides/chatgpt-shopify-cart",
    lang: "en",
    category: "ChatGPT Shopping Guide",
    title: "Can ChatGPT Create a Shopping Cart? Yes — via Open MCP (2026 Guide)",
    metaTitle: "Can ChatGPT Create a Shopping Cart? Yes — via MCP (2026)",
    metaDescription:
      "Yes: Connect ChatGPT to ShopCart MCP to verify live sizes, stock, and prices on public Shopify & WooCommerce stores and build a read-only cart.",
    cardSummary:
      "Yes: Even after standalone Instant Checkout was scaled back, connecting ChatGPT via ShopCart MCP builds verified multi-item browser carts globally.",
    tldrLabel: "Direct Answer:",
    tldrText:
      "Yes — ChatGPT can create a real, verified shopping cart in 2026 using the open Model Context Protocol (MCP). Even after OpenAI scaled back standalone Instant Checkout, connecting ShopCart MCP (https://shopcart.wals.pro/mcp) lets ChatGPT check live stock, sizes, and prices on public Shopify and WooCommerce stores — plus official Amazon multi-item cart links — and return a strictly read-only browser cart link.",
    seasonalNote: {
      label: "Seasonal Note (Black Friday Launch):",
      text: "Through December 6, 2026, every signed-in hosted ShopCart MCP account automatically receives 500 free tool calls/day for holiday gift and sale shopping — no credit card required."
    },
    intro:
      "Most web results still claim ChatGPT can only draft text grocery lists or shop through one US-only delivery app. In 2026, ChatGPT supports custom OAuth 2.1 MCP connectors — letting your assistant check live inventory and hand you a ready-to-open shopping cart for any public Shopify or WooCommerce brand in seconds.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Real, pre-filled carts — not outdated link lists.",
        text: "ShopCart MCP verifies exact variant IDs, in-stock sizes, and genuine compare-at markdowns live before building one clickable browser cart permalink."
      },
      {
        lead: "Works globally beyond US-only grocery integrations.",
        text: "Shop public Shopify and WooCommerce storefronts across EUR, USD, GBP, CHF, and CAD, or assemble official Amazon multi-item cart permalinks across 10 marketplaces."
      },
      {
        lead: "Strictly read-only — zero checkout risk.",
        text: "ChatGPT never sees your payment cards, shipping address, or store passwords. You always review final totals and pay directly on the merchant's site."
      },
      {
        lead: "Free forever on hosted Free tier or MIT local CLI.",
        text: "Get 20 hosted calls/day free permanently at https://shopcart.wals.pro/mcp (Pro €9/month for 500/day), or run npx -y shopcart-mcp locally with unlimited calls."
      }
    ],
    primaryAssistant: "chatgpt",
    starterPrompt:
      "Connect to ShopCart MCP (https://shopcart.wals.pro/mcp) — if not set up yet, walk me through the 2-click custom connector setup. Then find in-stock gift ideas under €80 on snocks.com or allbirds.eu, check real compare-at discounts and sizes, and generate one verified cart link.",
    ctaHeading: "Launch a Verified Cart Prompt in 1 Click",
    ctaSubtext:
      "Opens a ready-to-use shopping prompt in ChatGPT or Claude — complete with 2-click OAuth setup guidance if needed.",
    sections: [
      {
        heading: "Why ChatGPT needs an open MCP server for real shopping carts",
        paragraphs: [
          "Out of the box, ChatGPT's web search reads cached snippets that often miss live size availability, currency nuances, and genuine markdowns. And because standalone in-chat Instant Checkout was scaled back in 2026, shoppers outside narrow US-only grocery pilots were left clicking through ten tabs by hand.",
          "Connecting ShopCart MCP gives ChatGPT direct, strictly read-only access to structured public storefront data — turning a plain chat prompt into a verified multi-item shopping cart link you open directly in your own browser."
        ],
        takeaway:
          "Takeaway: Open MCP bridges the gap between ChatGPT's research strengths and a real, pre-filled merchant shopping cart."
      },
      {
        heading: "Step-by-step: connect ChatGPT and build a verified shopping cart",
        paragraphs: [
          "Setting up ShopCart MCP in ChatGPT takes under a minute using standard OAuth 2.1 authentication."
        ],
        orderedSteps: [
          {
            lead: "Add the Custom MCP Connector:",
            text: "Open ChatGPT connector settings, enter https://shopcart.wals.pro/mcp, and complete the two-click OAuth 2.1 login."
          },
          {
            lead: "Specify stores, products, sizes, and budget:",
            text: "Ask ChatGPT to search one or more public Shopify or WooCommerce stores with a clear price ceiling (for example, under $50 or €80) and required sizes."
          },
          {
            lead: "Review live discounts and stock:",
            text: "ChatGPT runs inspect_store, search_products, and get_product to surface only in-stock variants and genuine compare_at_price markdowns."
          },
          {
            lead: "Open your verified cart permalink:",
            text: "ChatGPT calls create_cart_link and returns one clean browser link that loads every chosen item straight onto the merchant's cart page."
          }
        ],
        takeaway:
          "Takeaway: Once connected, ChatGPT handles store inspection, stock verification, and cart assembly automatically."
      },
      {
        heading: "Grocery apps vs. browser agents vs. ChatGPT + ShopCart MCP",
        paragraphs: [
          "Compare how different AI shopping methods handle multi-item carts, regional coverage, and checkout safety."
        ],
        table: {
          id: "chatgpt-en-compare-table",
          caption: "Comparison of plain web search & regional grocery apps, browser agents, and ChatGPT with ShopCart MCP",
          headers: [
            "Dimension",
            "Web Search & Regional Grocery Apps",
            "Browser Automation Agents",
            "ChatGPT + ShopCart MCP"
          ],
          rows: [
            [
              "Store & geographic reach",
              "US-only groceries or stale product URLs",
              "Breaks on CAPTCHAs, cookie walls & layout shifts",
              "Global public Shopify & WooCommerce stores + 10 Amazon cart marketplaces"
            ],
            [
              "Checking size availability",
              "Rarely verified per variant",
              "Slow clicking through every dropdown",
              "Live variant ID & stock check across matching items"
            ],
            [
              "Spotting genuine deals",
              "Vulnerable to stale banners",
              "Screen-scraping heuristics",
              "Structured live price vs. real compare_at_price check"
            ],
            [
              "Adding multiple items",
              "Manual tab-by-tab clicks for non-partner stores",
              "Fragile multi-minute automation",
              "One verified permalink loads up to 20 items at once"
            ],
            [
              "Payment & account safety",
              "Browser checkout or partner wallet",
              "Elevated risk when logged-in browser sessions are exposed",
              "Strictly read-only — checkout always stays in your browser"
            ]
          ]
        },
        takeaway:
          "Takeaway: ChatGPT plus ShopCart MCP delivers global coverage, deterministic stock checks, and zero payment exposure."
      },
      {
        heading: "Prompt ideas that consistently produce clean carts",
        paragraphs: [
          "For the cleanest results, include the brand's regional domain (such as an EU or US storefront), your maximum budget, and required sizes or colors. If you already have a valid store promo code, you can also tell ChatGPT to attach it to the cart link.",
          "Strong examples include: \"Find 3 in-stock gift ideas under €50 on snocks.com and bundle them into one cart link\" or \"Compare available merino socks under €30 on allbirds.eu in size M and build a cart for 2 pairs.\""
        ],
        takeaway:
          "Takeaway: Pairing a regional store URL with budget and size constraints gives ChatGPT everything needed for an instant cart."
      },
      {
        heading: "Read-only architecture, EU hosting, and transparent pricing",
        paragraphs: [
          "ShopCart MCP never stores payment cards, shipping addresses, merchant logins, or chat transcripts. All four tools are read-only, sanitized against prompt injection, and protected by DNS-pinned SSRF guards on EU infrastructure (Google Cloud europe-west1).",
          "The hosted Free tier includes 20 tool calls/day permanently with zero credit card required. Hosted Pro is €9/month (500 calls/day, cancel anytime), and the MIT open-source CLI (npx -y shopcart-mcp) is free and unlimited locally."
        ],
        takeaway:
          "Takeaway: Transparent pricing and strict read-only engineering make AI shopping carts genuinely practical year-round."
      }
    ],
    howToName: "How to let ChatGPT create a verified shopping cart via MCP",
    howToDescription:
      "Connect ShopCart MCP as a Custom MCP Connector in ChatGPT, check live sizes and prices, and open a verified browser cart link.",
    howToSteps: [
      {
        name: "Connect ShopCart MCP in ChatGPT",
        text: "Add https://shopcart.wals.pro/mcp in ChatGPT's custom MCP connector settings and complete the two-click OAuth 2.1 sign-in."
      },
      {
        name: "Ask ChatGPT for products, sizes, and budget",
        text: "Name your preferred public Shopify or WooCommerce store domain (or Amazon URLs/ASINs), target items or budget, and exact sizes or colors."
      },
      {
        name: "Review and check out on the merchant's website",
        text: "Open the verified cart link in your browser, double-check shipping, discounts, and final totals, and pay directly on the store's site."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro: "This guide is based on the following verified sources (all retrieved on 2026-11-26):",
    sources: SOURCES_EN,
    limitationsLabel: "Limitations:",
    limitationsText:
      "Full unauthenticated live catalog, stock, and variant verification applies to public Shopify and WooCommerce storefronts without login gates. On Amazon, automated checkout bots are restricted; ShopCart MCP supports official Amazon multi-item cart permalinks (/gp/aws/cart/add.html) across 10 marketplaces paired with web search or optional Keepa/PA-API keys. Password-protected B2B portals are not supported.",
    faqHeading: "Frequently Asked Questions",
    faqs: [
      {
        question: "Does ChatGPT use MCP?",
        answer:
          "Yes. ChatGPT supports custom remote MCP connectors over Streamable HTTP with OAuth 2.1. Paste https://shopcart.wals.pro/mcp into ChatGPT's connector settings and sign in to unlock all four read-only shopping tools."
      },
      {
        question: "Is AI shopping cart building with ShopCart MCP free and legit?",
        answer:
          "Yes. ShopCart MCP is an open-source MIT project built and EU-hosted by Wals Professional Services GmbH (wals.pro, Vienna, Austria). The hosted Free tier provides 20 calls/day permanently at €0 (local CLI is unlimited), and all tools are strictly read-only — it never asks for payment cards or store passwords."
      },
      {
        question: "Does ChatGPT place orders or charge my card automatically?",
        answer:
          "No. ShopCart MCP is strictly read-only and never submits orders or handles payment methods. You open the generated cart link in your own browser and complete checkout directly with the store."
      },
      {
        question: "Can ChatGPT create an ecommerce website, or does this build a shopper cart?",
        answer:
          "This guide is for shoppers who want ChatGPT to fill a real shopping cart on existing online stores — not for coding or launching a new storefront website."
      },
      {
        question: "How do online shopping cart permalinks work?",
        answer:
          "Storefronts like Shopify (/cart/<variant_id>:<qty>?storefront=true), WooCommerce Store API carts, and Amazon (/gp/aws/cart/add.html) accept structured URL parameters that preload chosen products and quantities directly into your own browser session without needing third-party account access."
      },
      {
        question: "Can ChatGPT apply my discount code to the cart link?",
        answer:
          "Yes, if you provide a real discount code in your prompt, ChatGPT can pass it to create_cart_link on supported storefronts. ShopCart MCP never invents or guesses coupon codes."
      }
    ],
    hreflang: {
      en: "/en/guides/chatgpt-shopify-cart",
      de: "/guides/chatgpt-warenkorb-erstellen",
      xDefault: "/en/guides/chatgpt-shopify-cart"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "can chatgpt create a shopping cart",
      "chatgpt shopping cart mcp",
      "chatgpt shopify cart",
      "chatgpt connectors",
      "ai shopping assistant"
    ]
  }
];

export const GUIDE_DEFINITIONS: readonly GuideDefinition[] = [...CORE_GUIDES, ...ANSWER_PAGE_GUIDES];

export const GUIDES_CSS = `:root {
  color-scheme: dark;
  --walspro-accent: #ff1f4d;
  --walspro-accent-rgb: 255, 31, 77;
  --walspro-on-accent: #000000;
  --walspro-bg: #141414;
  --walspro-bg-2: #0d0d0d;
  --walspro-bg-deep: #090909;
  --walspro-surface: #1a1a1a;
  --walspro-surface-raised: #1e1e1e;
  --walspro-border: #2a2a2a;
  --walspro-divider: #242424;
  --walspro-border-strong: #3a3a3a;
  --walspro-ink: #e0e0e0;
  --walspro-muted: #a7adb4;
  --walspro-hint: #7e848e;
  --walspro-tone-primary-fg: #ff6b7a;
  --walspro-tone-primary-bg: rgba(var(--walspro-accent-rgb), 0.12);
  --walspro-tone-primary-border: rgba(var(--walspro-accent-rgb), 0.3);
  --walspro-font-display: "WALSPRO Display", "TTFirs Neue", "Inter", system-ui, sans-serif;
  --walspro-font-body: "WALSPRO Body", "Inter", "Avenir Next", system-ui, sans-serif;
  --walspro-font-mono: "SFMono-Regular", "Cascadia Code", "Liberation Mono", ui-monospace, monospace;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  background-color: var(--walspro-bg-deep);
}

body {
  margin: 0;
  min-height: 100dvh;
  font-family: var(--walspro-font-body);
  background:
    radial-gradient(58% 36% at 86% 0%, rgba(255, 31, 77, 0.09), transparent 60%),
    radial-gradient(45% 30% at 14% 18%, rgba(255, 138, 91, 0.045), transparent 60%),
    var(--walspro-bg);
  color: var(--walspro-ink);
  line-height: 1.68;
  -webkit-font-smoothing: antialiased;
  overflow-x: clip;
}

:focus-visible {
  outline: 2px solid var(--walspro-accent);
  outline-offset: 2px;
}

a {
  color: var(--walspro-tone-primary-fg);
}

a:hover {
  color: #ffffff;
}

code {
  font-family: var(--walspro-font-mono);
  background: var(--walspro-bg-deep);
  border: 1px solid var(--walspro-border);
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 0.88em;
  color: #f3f4f6;
}

.wrap {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 0 22px;
}

.promo-bar {
  background: linear-gradient(90deg, #0d0d0d 0%, #1c1014 35%, #241116 68%, #0d0d0d 100%);
  border-bottom: 1px solid var(--walspro-tone-primary-border);
  font-size: 13px;
  color: var(--walspro-ink);
}

.promo-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-block: 8px;
}

.promo-pill {
  background: var(--walspro-accent);
  color: var(--walspro-on-accent);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
}

.promo-cta {
  color: #ffffff;
  font-weight: 600;
  text-decoration: none;
}

.promo-cta:hover {
  text-decoration: underline;
}

.site-header {
  border-bottom: 1px solid var(--walspro-divider);
  background: rgba(13, 13, 13, 0.88);
  backdrop-filter: blur(10px);
  position: sticky;
  top: 0;
  z-index: 20;
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-block: 14px;
  flex-wrap: wrap;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: #ffffff;
  font-family: var(--walspro-font-display);
  font-weight: 750;
  font-size: 16px;
}

.brand img {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: block;
}

.brand-badge {
  font-family: var(--walspro-font-mono);
  font-size: 11px;
  color: var(--walspro-tone-primary-fg);
  background: var(--walspro-tone-primary-bg);
  border: 1px solid var(--walspro-tone-primary-border);
  padding: 2px 7px;
  border-radius: 6px;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13.5px;
}

.nav-links a {
  text-decoration: none;
  color: var(--walspro-muted);
}

.nav-links a:hover,
.nav-links a[aria-current="page"] {
  color: #ffffff;
}

.btn-nav {
  padding: 6px 12px;
  border-radius: 10px;
  border: 1px solid var(--walspro-border-strong);
  background: var(--walspro-surface);
  color: var(--walspro-ink);
  font-weight: 600;
}

.btn-nav:hover {
  border-color: var(--walspro-accent);
  color: #ffffff;
}

main.guide-main {
  padding: 32px 0 64px;
}

.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--walspro-muted);
  margin: 0 0 18px;
}

.breadcrumbs a {
  color: var(--walspro-muted);
  text-decoration: none;
}

.breadcrumbs a:hover {
  color: #ffffff;
  text-decoration: underline;
}

.guide-article {
  background: var(--walspro-surface);
  border: 1px solid var(--walspro-border);
  border-radius: 16px;
  padding: 34px 32px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}

.kicker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.kicker {
  display: inline-block;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--walspro-tone-primary-fg);
  background: var(--walspro-tone-primary-bg);
  border: 1px solid var(--walspro-tone-primary-border);
  padding: 3px 10px;
  border-radius: 999px;
}

.meta-date {
  font-size: 12.5px;
  color: var(--walspro-muted);
}

h1 {
  margin: 0 0 16px;
  font-family: var(--walspro-font-display);
  font-size: clamp(26px, 4vw, 36px);
  line-height: 1.18;
  letter-spacing: -0.025em;
  color: #ffffff;
}

h2 {
  margin: 32px 0 12px;
  font-family: var(--walspro-font-display);
  font-size: clamp(19px, 2.5vw, 23px);
  line-height: 1.28;
  letter-spacing: -0.015em;
  color: #ffffff;
}

h3 {
  margin: 20px 0 8px;
  font-family: var(--walspro-font-display);
  font-size: 16.5px;
  color: #ffffff;
}

p {
  margin: 0 0 14px;
  font-size: 15.5px;
}

ul,
ol {
  margin: 0 0 16px;
  padding-left: 22px;
}

li {
  margin: 8px 0;
  font-size: 15px;
}

.article-tldr {
  background: var(--walspro-bg-2);
  border: 1px solid var(--walspro-tone-primary-border);
  border-inline-start: 4px solid var(--walspro-accent);
  border-radius: 12px;
  padding: 16px 18px;
  margin: 0 0 22px;
}

.article-tldr p {
  margin: 0;
  color: #f3f4f6;
}

.seasonal-note {
  background: var(--walspro-bg-2);
  border: 1px solid var(--walspro-border-strong);
  border-radius: 10px;
  padding: 12px 16px;
  margin: 0 0 20px;
  font-size: 14px;
  color: var(--walspro-ink);
}

.seasonal-note p {
  margin: 0;
  font-size: 14px;
}

.cta-panel {
  background: var(--walspro-bg-2);
  border: 1px solid var(--walspro-border-strong);
  border-radius: 14px;
  padding: 20px 22px;
  margin: 22px 0 28px;
}

.cta-panel h2 {
  margin: 0 0 6px;
  font-size: 18px;
}

.cta-sub {
  margin: 0 0 14px;
  font-size: 14px;
  color: var(--walspro-muted);
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 10px 18px;
  border-radius: 12px;
  font-weight: 700;
  font-size: 14.5px;
  text-decoration: none;
  transition: transform 0.14s ease, border-color 0.14s ease, background-color 0.14s ease;
}

.btn-primary {
  background: var(--walspro-accent);
  color: var(--walspro-on-accent);
  border: 1px solid var(--walspro-accent);
}

.btn-primary:hover {
  background: #ff3b63;
  color: var(--walspro-on-accent);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--walspro-surface-raised);
  color: #ffffff;
  border: 1px solid var(--walspro-border-strong);
}

.btn-secondary:hover {
  border-color: var(--walspro-accent);
  color: #ffffff;
  transform: translateY(-1px);
}

.prompt-preview {
  background: var(--walspro-bg-deep);
  border: 1px solid var(--walspro-border);
  border-radius: 10px;
  padding: 12px 14px;
  font-family: var(--walspro-font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--walspro-muted);
  margin: 0;
  word-break: break-word;
}

.prompt-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--walspro-hint);
  margin-bottom: 4px;
}

.takeaway {
  color: #ffffff;
}

/* Responsive Data Table (Modern Web Guidance: sticky headers + container-query stacked layout) */
.table-wrapper {
  overflow: auto;
  max-inline-size: 100%;
  margin: 16px 0 18px;
  border: 1px solid var(--walspro-border);
  border-radius: 12px;
  background: var(--walspro-bg-2);
  container-type: inline-size;
}

.table-wrapper table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 14px;
}

.table-wrapper caption {
  text-align: left;
  padding: 10px 14px;
  font-size: 12.5px;
  color: var(--walspro-muted);
  background: var(--walspro-bg-deep);
  border-bottom: 1px solid var(--walspro-border);
}

.table-wrapper thead {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
}

.table-wrapper thead th {
  text-align: left;
  padding: 11px 14px;
  background: var(--walspro-surface-raised);
  color: #ffffff;
  font-weight: 700;
  border-bottom: 1px solid var(--walspro-border-strong);
}

.table-wrapper tbody th,
.table-wrapper tbody td {
  text-align: left;
  padding: 11px 14px;
  border-bottom: 1px solid var(--walspro-divider);
  vertical-align: top;
}

.table-wrapper tbody tr:last-child th,
.table-wrapper tbody tr:last-child td {
  border-bottom: none;
}

.table-wrapper tbody th {
  position: sticky;
  inset-inline-start: 0;
  background: var(--walspro-surface);
  color: #ffffff;
  font-weight: 600;
}

@container (width < 600px) {
  .table-wrapper table,
  .table-wrapper thead,
  .table-wrapper tbody,
  .table-wrapper tr,
  .table-wrapper th,
  .table-wrapper td {
    display: block;
  }

  .table-wrapper thead {
    display: none;
  }

  .table-wrapper tbody tr {
    border-bottom: 1px solid var(--walspro-border-strong);
    padding-block-end: 6px;
  }

  .table-wrapper tbody th {
    position: sticky;
    inset-block-start: 0;
    z-index: 2;
    background: var(--walspro-surface-raised);
    border-bottom: 1px solid var(--walspro-border);
  }

  .table-wrapper tbody td {
    border-bottom: 1px dashed var(--walspro-divider);
  }

  .table-wrapper tbody td::before {
    content: attr(data-label) ": ";
    font-weight: 700;
    color: var(--walspro-muted);
  }
}

/* Accessible FAQ Accordion (Modern Web Guidance: native details/summary, no headings inside summary) */
.accordion {
  margin-top: 28px;
}

.accordion details {
  background: var(--walspro-bg-2);
  border: 1px solid var(--walspro-border);
  border-radius: 12px;
  margin-bottom: 10px;
  overflow: hidden;
}

.accordion details[open] {
  border-color: var(--walspro-border-strong);
}

.accordion summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  cursor: pointer;
  font-weight: 650;
  font-size: 15px;
  color: #ffffff;
}

.accordion summary::-webkit-details-marker {
  display: none;
}

.accordion summary::before {
  content: "";
  inline-size: 10px;
  block-size: 10px;
  flex-shrink: 0;
  border-inline-end: 2px solid var(--walspro-accent);
  border-block-end: 2px solid var(--walspro-accent);
  transform: rotate(-45deg);
}

.accordion details[open] > summary::before {
  transform: rotate(45deg);
}

.accordion details::details-content {
  interpolate-size: allow-keywords;
  overflow: clip;
  contain: layout;
}

.accordion details:not([open])::details-content {
  block-size: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .accordion summary::before {
    transition: transform 0.2s ease;
  }

  .accordion details::details-content {
    transition: block-size, content-visibility, display;
    transition-duration: 0.25s;
    transition-timing-function: ease-in-out;
    transition-behavior: allow-discrete;
  }
}

.faq-answer {
  padding: 0 16px 14px 36px;
  margin: 0;
  font-size: 14.5px;
  color: var(--walspro-ink);
}

.sources-box {
  background: var(--walspro-bg-2);
  border: 1px solid var(--walspro-border);
  border-radius: 12px;
  padding: 18px 20px;
  margin-top: 26px;
}

.sources-box h2 {
  margin-top: 0;
}

.related-section {
  margin-top: 32px;
}

.guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-top: 14px;
}

.guide-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  background: var(--walspro-surface);
  border: 1px solid var(--walspro-border);
  border-radius: 14px;
  padding: 20px;
  text-decoration: none;
  color: var(--walspro-ink);
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.guide-card:hover {
  border-color: var(--walspro-accent);
  transform: translateY(-2px);
  color: var(--walspro-ink);
}

.guide-card h3 {
  margin: 6px 0 8px;
  font-size: 17px;
  line-height: 1.3;
  color: #ffffff;
}

.guide-card p {
  margin: 0;
  font-size: 14px;
  color: var(--walspro-muted);
}

.guide-card-link {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--walspro-tone-primary-fg);
}

.disclaimer {
  margin-top: 26px;
  padding: 12px 14px;
  background: var(--walspro-bg-2);
  border: 1px solid var(--walspro-border);
  border-radius: 12px;
  font-size: 13px;
  color: var(--walspro-muted);
}

.site-footer {
  border-top: 1px solid var(--walspro-divider);
  padding: 26px 0 42px;
  background: var(--walspro-bg-2);
}

.foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.foot-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--walspro-ink);
}

.foot-links {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 13px;
}

.foot-links a {
  color: var(--walspro-muted);
  text-decoration: none;
}

.foot-links a:hover {
  color: #ffffff;
}

@media (max-width: 640px) {
  .guide-article {
    padding: 22px 18px;
  }

  .cta-row {
    flex-direction: column;
  }

  .btn-primary,
  .btn-secondary {
    width: 100%;
  }
}
`;

export function buildClaudeDeeplink(prompt: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

export function buildChatGptDeeplink(prompt: string): string {
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function formatGuideDate(isoDate: string, lang: Lang): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  if (lang === "de") {
    return `${day}.${month}.${year}`;
  }
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  const monthIdx = Number.parseInt(month ?? "1", 10) - 1;
  const label = monthNames[monthIdx] ?? month;
  return `${label} ${Number.parseInt(day ?? "1", 10)}, ${year}`;
}

function renderPromoBar(config: AppConfig, lang: Lang): string {
  if (!isPromoFreeProActive(config)) return "";
  const de = lang === "de";
  return `<div class="promo-bar">
  <div class="wrap promo-inner">
    <span class="promo-pill">Black Friday Launch</span>
    <span>${
      de
        ? `Hosted Pro kostenlos bis 06.12.2026 (${config.proDailyLimit} Calls/Tag) · Code <code>BLACKFRIDAY</code>`
        : `Hosted Pro free until Dec 6, 2026 (${config.proDailyLimit} calls/day) · Code <code>BLACKFRIDAY</code>`
    }</span>
    <a class="promo-cta" href="/billing?lang=${lang}">${de ? "Gratis aktivieren →" : "Claim free Pro →"}</a>
  </div>
</div>`;
}

function renderHeader(config: AppConfig, lang: Lang, switchHref: string, currentPath: string): string {
  const de = lang === "de";
  const otherLang: Lang = de ? "en" : "de";
  const isOverview = currentPath === "/guides";
  return `<header class="site-header">
  <div class="wrap nav">
    <a class="brand" href="/?lang=${lang}">
      <img src="/assets/walspro-mark.svg" alt="wals.pro" width="26" height="26">
      <span>ShopCart MCP</span>
      <span class="brand-badge">&gt; MCP_</span>
    </a>
    <nav class="nav-links" aria-label="${de ? "Hauptnavigation" : "Main navigation"}">
      <a href="/?lang=${lang}">${de ? "Startseite" : "Home"}</a>
      <a href="/guides?lang=${lang}"${isOverview ? ' aria-current="page"' : ""}>Guides</a>
      <a href="/billing?lang=${lang}">${de ? "Konto &amp; Billing" : "Account &amp; Billing"}</a>
      <a href="${escapeHtml(config.repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a class="btn-nav" href="${escapeHtml(switchHref)}" hreflang="${otherLang}">${de ? "EN" : "DE"}</a>
    </nav>
  </div>
</header>`;
}

function renderFooter(config: AppConfig, lang: Lang): string {
  const de = lang === "de";
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="foot-row">
      <div class="foot-brand">
        <img src="/assets/walspro-mark.svg" alt="" width="20" height="20">
        <span><strong>ShopCart MCP</strong> · by <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">wals.pro</a></span>
      </div>
      <div class="foot-links">
        <a href="/guides?lang=${lang}">Guides</a>
        <a href="/billing?lang=${lang}">${de ? "Konto &amp; Billing" : "Account &amp; Billing"}</a>
        <a href="/privacy?lang=${lang}">${de ? "Datenschutz" : "Privacy"}</a>
        <a href="/terms?lang=${lang}">${de ? "Nutzungsbedingungen" : "Terms"}</a>
        <a href="/sitemap.xml">Sitemap</a>
        <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener noreferrer">${
          de ? "Impressum" : "Legal Notice"
        }</a>
      </div>
    </div>
    <p class="disclaimer">${
      de
        ? "für Shopify-, WooCommerce- und Amazon-Shops – unabhängiges Community-Tool, nicht verbunden mit Shopify Inc., Automattic Inc. (WooCommerce) oder Amazon.com, Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern."
        : "for Shopify, WooCommerce, and Amazon stores – independent community tool, not affiliated with Shopify Inc., Automattic Inc. (WooCommerce), or Amazon.com, Inc. All trademarks belong to their respective owners."
    }</p>
  </div>
</footer>`;
}

function renderOneClickButtons(
  lang: Lang,
  primaryAssistant: "claude" | "chatgpt",
  heading: string,
  subtext: string,
  prompt: string
): string {
  const de = lang === "de";
  const claudeUrl = buildClaudeDeeplink(prompt);
  const chatGptUrl = buildChatGptDeeplink(prompt);

  const claudeBtn = `<a class="${primaryAssistant === "claude" ? "btn-primary" : "btn-secondary"}" href="${escapeHtml(claudeUrl)}" target="_blank" rel="noopener noreferrer">${
    de ? "In Claude öffnen ↗" : "Open in Claude ↗"
  }</a>`;
  const chatGptBtn = `<a class="${primaryAssistant === "chatgpt" ? "btn-primary" : "btn-secondary"}" href="${escapeHtml(chatGptUrl)}" target="_blank" rel="noopener noreferrer">${
    de ? "In ChatGPT öffnen ↗" : "Open in ChatGPT ↗"
  }</a>`;

  const orderedButtons =
    primaryAssistant === "chatgpt" ? `${chatGptBtn}\n      ${claudeBtn}` : `${claudeBtn}\n      ${chatGptBtn}`;

  return `<section class="cta-panel" aria-label="${escapeHtml(heading)}">
    <h2>${escapeHtml(heading)}</h2>
    <p class="cta-sub">${escapeHtml(subtext)}</p>
    <div class="cta-row">
      ${orderedButtons}
    </div>
    <p class="prompt-preview"><span class="prompt-label">${
      de ? "Enthaltener Startprompt" : "Included starter prompt"
    }</span>${escapeHtml(prompt)}</p>
  </section>`;
}

function renderTable(table: GuideTable): string {
  const captionId = `${table.id}-caption`;
  const headerCellsHtml = table.headers
    .map((h) => `<th scope="col">${escapeHtml(h)}</th>`)
    .join("\n          ");

  const rowsHtml = table.rows
    .map((row) => {
      const [rowHead = "", ...cells] = row;
      const cellsHtml = cells
        .map(
          (cell, idx) =>
            `<td data-label="${escapeHtml(table.headers[idx + 1] ?? "")}">${escapeHtml(cell)}</td>`
        )
        .join("\n        ");
      return `<tr>
        <th scope="row">${escapeHtml(rowHead)}</th>
        ${cellsHtml}
      </tr>`;
    })
    .join("\n      ");

  return `<div tabindex="0" role="region" aria-labelledby="${escapeHtml(captionId)}" class="table-wrapper">
    <table>
      <caption id="${escapeHtml(captionId)}">${escapeHtml(table.caption)}</caption>
      <thead>
        <tr>
          ${headerCellsHtml}
        </tr>
      </thead>
      <tbody>
      ${rowsHtml}
      </tbody>
    </table>
  </div>`;
}

function renderSection(section: GuideSection): string {
  const paragraphsHtml = section.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n  ");

  const bulletsHtml = section.bullets
    ? `<ul>\n    ${section.bullets
        .map((b) => `<li><strong>${escapeHtml(b.lead)}</strong> ${escapeHtml(b.text)}</li>`)
        .join("\n    ")}\n  </ul>`
    : "";

  const stepsHtml = section.orderedSteps
    ? `<ol>\n    ${section.orderedSteps
        .map((s) => `<li><strong>${escapeHtml(s.lead)}</strong> ${escapeHtml(s.text)}</li>`)
        .join("\n    ")}\n  </ol>`
    : "";

  const tableHtml = section.table ? renderTable(section.table) : "";

  return `<section>
  <h2>${escapeHtml(section.heading)}</h2>
  ${paragraphsHtml}
  ${bulletsHtml}
  ${stepsHtml}
  ${tableHtml}
  <p class="takeaway"><strong>${escapeHtml(section.takeaway)}</strong></p>
</section>`;
}

export function renderGuidePage(config: AppConfig, guide: GuideDefinition): string {
  const origin = config.appOrigin;
  const de = guide.lang === "de";
  const canonicalUrl = `${origin}${guide.path}`;
  const deAltUrl = `${origin}${guide.hreflang.de}`;
  const enAltUrl = `${origin}${guide.hreflang.en}`;
  const xDefaultUrl = `${origin}${guide.hreflang.xDefault}`;
  const switchHref = de ? guide.hreflang.en : guide.hreflang.de;
  const ogImage = `${origin}/icon-512.png`;

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.metaDescription,
    inLanguage: guide.lang,
    url: canonicalUrl,
    image: ogImage,
    datePublished: guide.publishedDate,
    dateModified: guide.modifiedDate,
    keywords: guide.keywords.join(", "),
    author: {
      "@type": "Organization",
      name: "Wals Professional Services GmbH (wals.pro)",
      url: "https://wals.pro"
    },
    publisher: {
      "@type": "Organization",
      name: "Wals Professional Services GmbH",
      url: "https://wals.pro",
      logo: {
        "@type": "ImageObject",
        url: ogImage
      }
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl
    }
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: guide.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer
      }
    }))
  };

  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: guide.howToName,
    description: guide.howToDescription,
    totalTime: "PT1M",
    step: guide.howToSteps.map((step, idx) => ({
      "@type": "HowToStep",
      position: idx + 1,
      name: step.name,
      text: step.text
    }))
  };

  const takeawaysHtml = guide.takeaways
    .map((item) => `<li><strong>${escapeHtml(item.lead)}</strong> ${escapeHtml(item.text)}</li>`)
    .join("\n    ");

  const sectionsHtml = guide.sections.map(renderSection).join("\n\n");

  const sourcesHtml = guide.sources
    .map(
      (s) =>
        `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a> (${
          de ? "Abrufdatum" : "retrieved"
        }: ${escapeHtml(s.retrieved)})</li>`
    )
    .join("\n    ");

  const faqItemsHtml = guide.faqs
    .map(
      (faq) => `<details>
      <summary>${escapeHtml(faq.question)}</summary>
      <p class="faq-answer">${escapeHtml(faq.answer)}</p>
    </details>`
    )
    .join("\n    ");

  const seasonalNoteHtml =
    guide.seasonalNote && isPromoFreeProActive(config)
      ? `<aside class="seasonal-note" aria-label="${escapeHtml(guide.seasonalNote.label)}">
        <p><strong>${escapeHtml(guide.seasonalNote.label)}</strong> ${escapeHtml(guide.seasonalNote.text)}</p>
      </aside>`
      : "";

  const sameLangGuides = GUIDE_DEFINITIONS.filter((g) => g.path !== guide.path && g.lang === guide.lang);
  const altGuide = GUIDE_DEFINITIONS.find((g) => g.path === switchHref && g.path !== guide.path);
  const relatedGuides = altGuide ? [...sameLangGuides, altGuide] : sameLangGuides;
  const relatedCardsHtml = relatedGuides
    .map(
      (g) => `<a class="guide-card" href="${escapeHtml(g.path)}">
        <div>
          <span class="kicker">${escapeHtml(g.lang.toUpperCase())} · ${escapeHtml(g.category)}</span>
          <h3>${escapeHtml(g.title)}</h3>
          <p>${escapeHtml(g.cardSummary)}</p>
        </div>
        <span class="guide-card-link">${g.lang === "de" ? "Ratgeber lesen →" : "Read guide →"}</span>
      </a>`
    )
    .join("\n      ");

  const formattedModified = formatGuideDate(guide.modifiedDate, guide.lang);

  return `<!doctype html>
<html lang="${guide.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#141414">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${escapeHtml(guide.metaTitle)}</title>
<meta name="description" content="${escapeHtml(guide.metaDescription)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<link rel="alternate" hreflang="de" href="${escapeHtml(deAltUrl)}">
<link rel="alternate" hreflang="en" href="${escapeHtml(enAltUrl)}">
<link rel="alternate" hreflang="x-default" href="${escapeHtml(xDefaultUrl)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ShopCart MCP by wals.pro">
<meta property="og:locale" content="${de ? "de_DE" : "en_US"}">
<meta property="og:title" content="${escapeHtml(guide.metaTitle)}">
<meta property="og:description" content="${escapeHtml(guide.metaDescription)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(guide.metaTitle)}">
<meta name="twitter:description" content="${escapeHtml(guide.metaDescription)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="stylesheet" href="/assets/guides.css?v=0.2.0">
<script type="application/ld+json">${safeJsonLd(articleLd)}</script>
<script type="application/ld+json">${safeJsonLd(faqLd)}</script>
<script type="application/ld+json">${safeJsonLd(howToLd)}</script>
</head>
<body>
${renderPromoBar(config, guide.lang)}
${renderHeader(config, guide.lang, switchHref, guide.path)}

<main class="guide-main">
  <div class="wrap">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="/?lang=${guide.lang}">ShopCart MCP</a>
      <span aria-hidden="true">/</span>
      <a href="/guides?lang=${guide.lang}">Guides</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${escapeHtml(guide.category)}</span>
    </nav>

    <article class="guide-article">
      <div class="kicker-row">
        <span class="kicker">${escapeHtml(guide.category)}</span>
        <span class="meta-date">${
          de
            ? `Aktualisiert am ${escapeHtml(formattedModified)} · von wals.pro`
            : `Updated ${escapeHtml(formattedModified)} · by wals.pro`
        }</span>
      </div>

      <h1>${escapeHtml(guide.title)}</h1>

      <div class="article-tldr">
        <p><strong>${escapeHtml(guide.tldrLabel)}</strong> ${escapeHtml(guide.tldrText)}</p>
      </div>

      ${seasonalNoteHtml}

      <p>${escapeHtml(guide.intro)}</p>

      ${renderOneClickButtons(
        guide.lang,
        guide.primaryAssistant,
        guide.ctaHeading,
        guide.ctaSubtext,
        guide.starterPrompt
      )}

      <section>
        <h2>${escapeHtml(guide.takeawaysHeading)}</h2>
        <ul>
          ${takeawaysHtml}
        </ul>
      </section>

      ${sectionsHtml}

      <section class="sources-box" aria-labelledby="sources-heading">
        <h2 id="sources-heading">${escapeHtml(guide.sourcesHeading)}</h2>
        <p>${escapeHtml(guide.sourcesIntro)}</p>
        <ul>
          ${sourcesHtml}
        </ul>
        <p><strong>${escapeHtml(guide.limitationsLabel)}</strong> ${escapeHtml(guide.limitationsText)}</p>
      </section>

      <section class="accordion" aria-labelledby="faq-heading">
        <h2 id="faq-heading">${escapeHtml(guide.faqHeading)}</h2>
        ${faqItemsHtml}
      </section>

      <div class="disclaimer">${
        de
          ? "Hinweis: ShopCart MCP ist ein Angebot für Shopify-, WooCommerce- und Amazon-Shops – unabhängiges Community-Tool, nicht verbunden mit Shopify Inc., Automattic Inc. (WooCommerce) oder Amazon.com, Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern."
          : "Note: ShopCart MCP is built for Shopify, WooCommerce, and Amazon stores – independent community tool, not affiliated with Shopify Inc., Automattic Inc. (WooCommerce), or Amazon.com, Inc. All trademarks belong to their respective owners."
      }</div>
    </article>

    <section class="related-section" aria-labelledby="related-heading">
      <h2 id="related-heading">${de ? "Weitere Shopping-Guides (DE & EN)" : "More Shopping Guides (EN & DE)"}</h2>
      <div class="guide-grid">
        ${relatedCardsHtml}
      </div>
    </section>
  </div>
</main>

${renderFooter(config, guide.lang)}
</body>
</html>`;
}

export function renderGuidesOverviewPage(config: AppConfig, lang: Lang): string {
  const origin = config.appOrigin;
  const de = lang === "de";
  const otherLang: Lang = de ? "en" : "de";
  const canonicalUrl = `${origin}/guides`;
  const ogImage = `${origin}/icon-512.png`;

  const metaTitle = de
    ? "KI-Shopping-Guides für Claude & ChatGPT | ShopCart MCP"
    : "AI Shopping Guides for Claude & ChatGPT | ShopCart MCP";
  const metaDescription = de
    ? "Praxis-Guides für ChatGPT & Claude: Warenkörbe per offenem MCP bauen, Instant-Checkout-Alternative, Amazon-Cart-Links & Shopify-MCP-Vergleich."
    : "Step-by-step AI shopping guides for ChatGPT & Claude: open MCP carts, Instant Checkout alternative, Amazon cart links, and Shopify MCP comparison.";

  const starterPrompt = de
    ? "Verbinde dich mit ShopCart MCP (https://shopcart.wals.pro/mcp). Falls der Connector noch nicht eingerichtet ist, zeige mir kurz die 2-Klick-Anleitung. Danach suche mir lieferbare Geschenkideen unter 60 € bei snocks.com und erstelle mir einen geprüften Warenkorb-Link."
    : "Connect to ShopCart MCP (https://shopcart.wals.pro/mcp). If the connector is not active yet, guide me through the 2-click setup first. Then find in-stock gift ideas under €60 on snocks.com and generate a verified browser cart link.";

  const deGuides = GUIDE_DEFINITIONS.filter((g) => g.lang === "de");
  const enGuides = GUIDE_DEFINITIONS.filter((g) => g.lang === "en");

  const renderCards = (items: GuideDefinition[]) =>
    items
      .map(
        (g) => `<a class="guide-card" href="${escapeHtml(g.path)}">
        <div>
          <span class="kicker">${escapeHtml(g.category)}</span>
          <h3>${escapeHtml(g.title)}</h3>
          <p>${escapeHtml(g.cardSummary)}</p>
        </div>
        <span class="guide-card-link">${g.lang === "de" ? "Ratgeber öffnen →" : "Read guide →"}</span>
      </a>`
      )
      .join("\n      ");

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: metaTitle,
    description: metaDescription,
    url: canonicalUrl,
    inLanguage: lang,
    publisher: {
      "@type": "Organization",
      name: "Wals Professional Services GmbH",
      url: "https://wals.pro"
    },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: GUIDE_DEFINITIONS.map((g, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        url: `${origin}${g.path}`,
        name: g.title
      }))
    }
  };

  const primaryBlock = de
    ? `<section aria-labelledby="guides-de-heading">
        <h2 id="guides-de-heading">Deutsche Shopping-Guides</h2>
        <div class="guide-grid">${renderCards(deGuides)}</div>
      </section>
      <section aria-labelledby="guides-en-heading">
        <h2 id="guides-en-heading">English Shopping Guides</h2>
        <div class="guide-grid">${renderCards(enGuides)}</div>
      </section>`
    : `<section aria-labelledby="guides-en-heading">
        <h2 id="guides-en-heading">English Shopping Guides</h2>
        <div class="guide-grid">${renderCards(enGuides)}</div>
      </section>
      <section aria-labelledby="guides-de-heading">
        <h2 id="guides-de-heading">Deutsche Shopping-Guides (German)</h2>
        <div class="guide-grid">${renderCards(deGuides)}</div>
      </section>`;

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
<title>${escapeHtml(metaTitle)}</title>
<meta name="description" content="${escapeHtml(metaDescription)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<link rel="alternate" hreflang="de" href="${escapeHtml(`${origin}/guides?lang=de`)}">
<link rel="alternate" hreflang="en" href="${escapeHtml(`${origin}/guides?lang=en`)}">
<link rel="alternate" hreflang="x-default" href="${escapeHtml(canonicalUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ShopCart MCP by wals.pro">
<meta property="og:locale" content="${de ? "de_DE" : "en_US"}">
<meta property="og:title" content="${escapeHtml(metaTitle)}">
<meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(metaTitle)}">
<meta name="twitter:description" content="${escapeHtml(metaDescription)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="stylesheet" href="/assets/guides.css?v=0.2.0">
<script type="application/ld+json">${safeJsonLd(collectionLd)}</script>
</head>
<body>
${renderPromoBar(config, lang)}
${renderHeader(config, lang, `/guides?lang=${otherLang}`, "/guides")}

<main class="guide-main">
  <div class="wrap">
    <div class="guide-article">
      <div class="kicker-row">
        <span class="kicker">${de ? "DE & EN Ratgeber-Übersicht" : "EN & DE Guide Hub"}</span>
        <span class="meta-date">${
          de
            ? "Read-only · ChatGPT & Claude · Shopify, WooCommerce & Amazon-Cart-Links"
            : "Read-only · ChatGPT & Claude · Shopify, WooCommerce & Amazon Cart Links"
        }</span>
      </div>

      <h1>${de ? "KI-Shopping-Guides für Claude & ChatGPT" : "AI Shopping Guides for Claude & ChatGPT"}</h1>

      <div class="article-tldr">
        <p><strong>${de ? "Kurz gesagt:" : "TL;DR:"}</strong> ${
          de
            ? "Alle Schritt-für-Schritt-Anleitungen für ShopCart MCP auf einen Blick: offene Warenkörbe in ChatGPT & Claude per MCP, Instant-Checkout-Alternative, ehrlicher Amazon-Cart-Permalink-Guide sowie technischer Shopify-MCP-Server-Vergleich — strikt read-only."
            : "Every step-by-step guide for ShopCart MCP in one place: open MCP carts in ChatGPT & Claude, Instant Checkout alternative, honest Amazon multi-item cart permalink guide, and technical Shopify MCP server comparison — strictly read-only."
        }</p>
      </div>

      ${renderOneClickButtons(
        lang,
        "claude",
        de ? "Direkt loslegen: 1-Klick-Start" : "Start Shopping in 1 Click",
        de
          ? "Starte sofort mit einem fertigen Prompt in Claude oder ChatGPT — kostenlos im Free-Tarif (20 Calls/Tag dauerhaft gratis) oder lokal via MIT-CLI."
          : "Launch a ready-to-use prompt directly in Claude or ChatGPT — free permanently on the Free tier (20 calls/day) or locally via the MIT CLI.",
        starterPrompt
      )}

      ${primaryBlock}

      <div class="disclaimer">${
        de
          ? "für Shopify-, WooCommerce- und Amazon-Shops – unabhängiges Community-Tool, nicht verbunden mit Shopify Inc., Automattic Inc. (WooCommerce) oder Amazon.com, Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern."
          : "for Shopify, WooCommerce, and Amazon stores – independent community tool, not affiliated with Shopify Inc., Automattic Inc. (WooCommerce), or Amazon.com, Inc. All trademarks belong to their respective owners."
      }</div>
    </div>
  </div>
</main>

${renderFooter(config, lang)}
</body>
</html>`;
}

function sendGuideHtml(res: Response, html: string): void {
  res.setHeader("Content-Security-Policy", GUIDES_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).type("html").send(html);
}

export function createGuidesRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/assets/guides.css", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(GUIDES_CSS);
  });

  router.get("/guides", (req: Request, res: Response) => {
    const lang = detectLang(req.query.lang, req.headers["accept-language"]);
    sendGuideHtml(res, renderGuidesOverviewPage(config, lang));
  });

  for (const guide of GUIDE_DEFINITIONS) {
    router.get(guide.path, (_req: Request, res: Response) => {
      sendGuideHtml(res, renderGuidePage(config, guide));
    });
  }

  return router;
}
