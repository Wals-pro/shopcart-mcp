import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import { detectLang, escapeHtml, type Lang } from "../auth/pages.js";
import { isPromoFreeProActive } from "../billing/quota.js";

export interface GuideFaqItem {
  question: string;
  answer: string;
}

export interface GuideHowToStep {
  name: string;
  text: string;
}

export interface GuideTable {
  id: string;
  caption: string;
  headers: [string, string, string];
  rows: Array<[string, string, string]>;
}

export interface GuideSection {
  heading: string;
  paragraphs: string[];
  bullets?: Array<{ lead: string; text: string }>;
  orderedSteps?: Array<{ lead: string; text: string }>;
  table?: GuideTable;
  takeaway: string;
}

export interface GuideSource {
  label: string;
  url: string;
  retrieved: string;
}

export interface GuideDefinition {
  path: string;
  lang: Lang;
  category: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  cardSummary: string;
  tldrLabel: string;
  tldrText: string;
  intro: string;
  takeawaysHeading: string;
  takeaways: Array<{ lead: string; text: string }>;
  primaryAssistant: "claude" | "chatgpt";
  starterPrompt: string;
  ctaHeading: string;
  ctaSubtext: string;
  sections: GuideSection[];
  howToName: string;
  howToDescription: string;
  howToSteps: GuideHowToStep[];
  sourcesHeading: string;
  sourcesIntro: string;
  sources: GuideSource[];
  limitationsLabel: string;
  limitationsText: string;
  faqHeading: string;
  faqs: GuideFaqItem[];
  hreflang: {
    de: string;
    en: string;
    xDefault: string;
  };
  publishedDate: string;
  modifiedDate: string;
  keywords: string[];
}

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

const PUBLISHED_ISO = "2026-11-25";

const SOURCES_DE: GuideSource[] = [
  {
    label: "ShopCart MCP Produktseite & Dokumentation",
    url: "https://shopcart.wals.pro/?lang=de",
    retrieved: "25.11.2026"
  },
  {
    label: "ShopCart MCP Open-Source-Repository auf GitHub (MIT-Lizenz)",
    url: "https://github.com/Wals-pro/shopcart-mcp",
    retrieved: "25.11.2026"
  },
  {
    label: "Shopify Developer Docs: Create cart permalinks",
    url: "https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks",
    retrieved: "25.11.2026"
  },
  {
    label: "Model Context Protocol — Offizielle Einführung",
    url: "https://modelcontextprotocol.io/docs/getting-started/intro",
    retrieved: "25.11.2026"
  }
];

const SOURCES_EN: GuideSource[] = [
  {
    label: "ShopCart MCP Product Page & Documentation",
    url: "https://shopcart.wals.pro/?lang=en",
    retrieved: "2026-11-25"
  },
  {
    label: "ShopCart MCP Open-Source Repository on GitHub (MIT License)",
    url: "https://github.com/Wals-pro/shopcart-mcp",
    retrieved: "2026-11-25"
  },
  {
    label: "Shopify Developer Docs: Create cart permalinks",
    url: "https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks",
    retrieved: "2026-11-25"
  },
  {
    label: "Model Context Protocol — Official Introduction",
    url: "https://modelcontextprotocol.io/docs/getting-started/intro",
    retrieved: "2026-11-25"
  }
];

export const GUIDE_DEFINITIONS: readonly GuideDefinition[] = [
  {
    path: "/guides/mit-claude-online-einkaufen",
    lang: "de",
    category: "Claude Shopping Guide",
    title: "Mit Claude direkt in Online-Shops einkaufen & Warenkorb bauen",
    metaTitle: "Mit Claude online einkaufen & Warenkorb bauen | ShopCart MCP",
    metaDescription:
      "Lass Claude Produkte, Größen und Live-Preise in Shopify-Shops prüfen und einen fertigen Warenkorb-Link bauen — read-only, DSGVO-konform und kostenlos.",
    cardSummary:
      "Verbinde Claude.ai oder Claude Desktop in zwei Klicks mit öffentlichen Shopify-Shops und lass dir geprüfte Multi-Artikel-Warenkörbe erstellen.",
    tldrLabel: "Kurz gesagt:",
    tldrText:
      "Mit ShopCart MCP verbindet sich Claude direkt mit öffentlichen Shopify-Onlineshops, prüft Größen, Farben, Live-Preise und Lagerbestand und liefert dir einen fertigen Warenkorb-Link — du prüfst und bezahlst immer selbst im Browser.",
    intro:
      "Du möchtest beim Online-Shopping Zeit sparen, ohne dich durch zwanzig Tabs und ausverkaufte Größen zu klicken? In diesem Praxis-Guide siehst du, wie du Claude sicher mit öffentlichen Shopify-Shops verbindest und in Sekunden einen geprüften Warenkorb im Browser öffnest.",
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
        lead: "In 30 Sekunden startklar.",
        text: "In Claude.ai verbindest du den gehosteten OAuth-2.1-Connector unter https://shopcart.wals.pro/mcp; lokal auf dem Rechner läuft die MIT-Open-Source-CLI ohne Konto."
      },
      {
        lead: "Funktioniert in tausenden Shopify-Shops.",
        text: "Egal ob Mode, Outdoor, Food oder Geschenke — ShopCart MCP verarbeitet Währungen wie EUR, CHF, USD und GBP automatisch korrekt."
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
        heading: "Warum normale KI-Suche beim Online-Shopping oft scheitert",
        paragraphs: [
          "Wenn du Claude ohne direkte Shop-Anbindung nach einem Produkt fragst, greift der Assistent auf allgemeine Websuchen oder gecachte Suchmaschinen-Snippets zurück. Das Ergebnis sind oft allgemeine Kategorieseiten, veraltete Preise oder Artikel, bei denen genau deine Größe beim Öffnen ausverkauft ist.",
          "Noch zäher wird es, sobald du mehrere Teile kombinieren willst — etwa zwei Packungen weiße und eine Packung schwarze Sneaker-Socken in Größe 43 bis 46. Am Ende öffnest du doch wieder jeden Tab von Hand und klickst alle Varianten einzeln in den Warenkorb."
        ],
        takeaway:
          "Fazit: Ohne Live-Zugriff auf Varianten-IDs und Lagerbestand bleibt KI-Shopping eine Linkliste statt echter Zeitersparnis."
      },
      {
        heading: "So baut dir Claude in vier Schritten einen echten Shopify-Warenkorb",
        paragraphs: [
          "ShopCart MCP nutzt das offene Model Context Protocol (MCP), um Claude vier klar begrenzte Lese-Werkzeuge bereitzustellen. Statt HTML-Seiten zu raten, ruft der Server strukturierte Katalogdaten direkt vom jeweiligen Shopify-Shop ab und erzeugt einen offiziellen Warenkorb-Permalink."
        ],
        orderedSteps: [
          {
            lead: "Shop prüfen (inspect_store):",
            text: "Prüft, ob die Domain ein unterstützter öffentlicher Shopify-Shop ist, und liest Währung, Land sowie eventuelle Firewall-Regeln aus."
          },
          {
            lead: "Katalog durchsuchen (search_products):",
            text: "Sucht gezielt nach Stichwörtern, Preisgrenzen (min_price / max_price) und lieferbaren Artikeln in der Shop-Währung."
          },
          {
            lead: "Varianten und Lagerbestand prüfen (get_product):",
            text: "Lädt die exakten numerischen Varianten-IDs für jede Größe und Farbe samt Live-Preis, echtem Streichpreis und Verfügbarkeit."
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
        heading: "Normale KI-Suche vs. Claude mit ShopCart MCP im Vergleich",
        paragraphs: [
          "Der Unterschied zeigt sich sofort, sobald konkrete Größen, echte Streichpreise und mehrere Artikel in einem Einkauf zusammenkommen."
        ],
        table: {
          id: "claude-compare-table",
          caption: "Vergleich: Normale KI-Websuche gegenüber Claude mit ShopCart MCP",
          headers: ["Kriterium", "Normale KI-Websuche", "Claude + ShopCart MCP"],
          rows: [
            [
              "Preise & Rabatte",
              "Oft veraltet aus gecachten Snippets",
              "Live vom Shop geladen inklusive echtem Streichpreis"
            ],
            [
              "Größen- & Farbcheck",
              "Meist nicht zuverlässig pro Variante sichtbar",
              "Exakte Prüfung je Varianten-ID und Lagerstatus"
            ],
            [
              "Ergebnis für dich",
              "Mehrere lose Produktlinks zum Nachklicken",
              "Ein geprüfter Warenkorb-Link mit allen Artikeln & Mengen"
            ],
            [
              "Multi-Artikel-Bundles",
              "Manuell pro Tab zusammenklicken",
              "Bis zu 20 Positionen in einem Browser-Warenkorb"
            ],
            [
              "Sicherheit beim Kauf",
              "Manueller Checkout im Browser",
              "Strikt read-only — Prüfung & Zahlung bleiben im Browser"
            ]
          ]
        },
        takeaway:
          "Fazit: Sobald Größenverfügbarkeit oder mehrere Artikel eine Rolle spielen, spart Claude mit ShopCart MCP den gesamten Klickweg."
      },
      {
        heading: "In 30 Sekunden mit Claude.ai oder Claude Desktop verbinden",
        paragraphs: [
          "Für Claude.ai (Web & Mobile) öffnest du einfach die Connector-Einstellungen, hinterlegst die Server-Adresse https://shopcart.wals.pro/mcp und bestätigst die OAuth-2.1-Anmeldung in zwei Klicks. Danach steht dir ShopCart MCP in jedem Chat zur Verfügung.",
          "Wenn du lokal mit Claude Desktop oder Claude Code arbeitest, kannst du alternativ die kostenlose Open-Source-CLI unter MIT-Lizenz direkt per npx -y shopcart-mcp starten — ganz ohne Konto und ohne Telemetrie. Im gehosteten Dienst sind 20 Abfragen pro Tag dauerhaft gratis; im Pro-Tarif (9 €/Monat) gibt es 500 Abfragen pro Tag — während der Black-Friday-Launch-Aktion bis 06.12.2026 für alle angemeldeten Konten kostenlos."
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
    howToName: "Mit Claude in 3 Schritten einen geprüften Shopify-Warenkorb erstellen",
    howToDescription:
      "So verbindest du Claude über ShopCart MCP mit öffentlichen Shopify-Shops und öffnest einen fertig gepackten Warenkorb-Link im Browser.",
    howToSteps: [
      {
        name: "ShopCart MCP in Claude verbinden",
        text: "Füge https://shopcart.wals.pro/mcp als Custom MCP Connector in Claude hinzu und schließe die OAuth-2.1-Anmeldung in zwei Klicks ab (oder nutze lokal npx -y shopcart-mcp)."
      },
      {
        name: "Shop, Artikel, Größen und Budget nennen",
        text: "Schreibe Claude im Chat, in welchem Shopify-Shop gesucht werden soll und welche Produkte, Farben, Größen oder welches Preislimit du möchtest."
      },
      {
        name: "Geprüften Warenkorb-Link öffnen und selbst bezahlen",
        text: "Claude prüft Varianten und Lagerbestand live und gibt dir einen fertigen Warenkorb-Link. Öffne ihn im Browser, kontrolliere alles in Ruhe und bezahle direkt beim Händler."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser Ratgeber stützt sich auf folgende geprüfte Quellen (alle abgerufen am 25.11.2026):",
    sources: SOURCES_DE,
    limitationsLabel: "Grenzen:",
    limitationsText:
      "ShopCart MCP funktioniert ausschließlich in öffentlichen Shopify-Onlineshops ohne Login-Schranke. Geschlossene Marktplätze wie Amazon, passwortgeschützte B2B-Shops oder andere Shopsysteme werden nicht unterstützt. Bei Marken mit regionalen Länder-Domains solltest du Claude direkt die passende EU- oder DE-Domain nennen, damit Währung und Lagerbestand stimmen.",
    faqHeading: "Häufige Fragen zum Einkaufen mit Claude",
    faqs: [
      {
        question: "Kauft Claude mit ShopCart MCP automatisch für mich ein?",
        answer:
          "Nein. Alle Werkzeuge in ShopCart MCP arbeiten rein lesend und erzeugen lediglich einen Warenkorb-Link für deinen Browser. Du prüfst Preise, Versandkosten und Mengen selbst im Online-Shop und schließt den Kauf wie gewohnt ab."
      },
      {
        question: "Funktioniert ShopCart MCP in Claude.ai Web, Mobile und Claude Desktop?",
        answer:
          "Ja. In Claude.ai Web und Mobile verbindest du den gehosteten OAuth-2.1-Server https://shopcart.wals.pro/mcp als Custom Connector. In Claude Desktop und Claude Code kannst du sowohl den gehosteten Server als auch die lokale Open-Source-CLI via npx -y shopcart-mcp nutzen."
      },
      {
        question: "In welchen Online-Shops kann Claude Warenkörbe erstellen?",
        answer:
          "ShopCart MCP unterstützt tausende öffentliche Shopify-Onlineshops weltweit in Währungen wie Euro, Schweizer Franken, US-Dollar oder Britischem Pfund. Passwortgeschützte Storefronts und geschlossene Marktplätze wie Amazon werden nicht unterstützt."
      },
      {
        question: "Was kostet ShopCart MCP für Claude?",
        answer:
          "Der gehostete Free-Tarif bietet dauerhaft 20 Abfragen pro Tag kostenlos. Im Pro-Tarif stehen 500 Abfragen pro Tag für 9 € im Monat bereit — während der Black-Friday-Launch-Aktion bis zum 06.12.2026 erhalten alle angemeldeten Konten automatisch 500 Abfragen pro Tag gratis. Lokal unter MIT-Lizenz ist die Nutzung unbegrenzt kostenlos."
      },
      {
        question: "Speichert ShopCart MCP meine Claude-Chats oder Zahlungsdaten?",
        answer:
          "Nein. ShopCart MCP speichert weder Chat-Verläufe noch Lieferadressen, Shop-Logins oder Zahlungsdaten. Im gehosteten EU-Betrieb werden ausschließlich Konto-E-Mail, verschlüsselte Anmelde-Hashes und der tägliche Nutzungszähler gespeichert."
      }
    ],
    hreflang: {
      de: "/guides/mit-claude-online-einkaufen",
      en: "/en/guides/shop-with-claude",
      xDefault: "/en/guides/shop-with-claude"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: PUBLISHED_ISO,
    keywords: [
      "claude online einkaufen",
      "claude shopping",
      "shopify mcp",
      "ki warenkorb erstellen",
      "shopcart mcp"
    ]
  },
  {
    path: "/guides/chatgpt-warenkorb-erstellen",
    lang: "de",
    category: "ChatGPT Shopping Guide",
    title: "ChatGPT Warenkorb in Shopify-Shops automatisch füllen",
    metaTitle: "ChatGPT Warenkorb in Shopify-Shops füllen | ShopCart MCP",
    metaDescription:
      "Verbinde ChatGPT per Custom MCP Connector mit öffentlichen Shopify-Shops: Live-Varianten prüfen, echte Rabatte erkennen und fertigen Warenkorb-Link öffnen.",
    cardSummary:
      "So verbindest du ChatGPT über Custom Connectors mit ShopCart MCP und lässt dir lieferbare Produkte direkt als fertigen Warenkorb-Link zusammenstellen.",
    tldrLabel: "Kurz gesagt:",
    tldrText:
      "Über den Custom MCP Connector https://shopcart.wals.pro/mcp greift ChatGPT live auf öffentliche Shopify-Shops zu, prüft Größen, Lagerbestand und echte Rabatte und gibt dir einen fertigen Warenkorb-Link zum Selbstbezahlen im Browser.",
    intro:
      "Du nutzt ChatGPT bereits für Produktrecherche und Preisvergleiche, willst aber endlich von losen Empfehlungen zu einem echten, geprüften Warenkorb kommen? Dieser Leitfaden zeigt dir Schritt für Schritt, wie du ShopCart MCP in ChatGPT verbindest und in Sekunden ganze Einkaufslisten bündelst.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Ein Connector für tausende Shopify-Shops.",
        text: "Du verbindest ShopCart MCP einmalig per OAuth 2.1 in ChatGPT und kannst anschließend beliebige öffentliche Shopify-Storefronts direkt im Chat abfragen."
      },
      {
        lead: "Live-Varianten statt ausverkaufter Treffer.",
        text: "ChatGPT liest exakte Größen, Farben, Stückzahlen und aktuelle Preise live vom Shop, bevor der Warenkorb-Link erstellt wird."
      },
      {
        lead: "Mehrere Artikel in einem Klick im Warenkorb.",
        text: "Bis zu 20 Positionen lassen sich in einem geprüften Shopify-Warenkorb-Permalink kombinieren — ganz ohne Tab-Wechsel."
      },
      {
        lead: "Kein Auto-Checkout, volle Kontrolle.",
        text: "ShopCart MCP ist strikt read-only. Du öffnest den Link in deinem Browser, kontrollierst den Warenkorb auf der Shop-Seite und bezahlst selbst."
      }
    ],
    primaryAssistant: "chatgpt",
    starterPrompt:
      "Nutze den ShopCart MCP Connector (https://shopcart.wals.pro/mcp) — falls er noch nicht verbunden ist, führe mich kurz durch das 2-Klick-Setup. Finde mir dann auf got-bag.com lieferbare wasserdichte Rolltop-Rucksäcke unter 180 €, vergleiche Farben und Preise und erstelle mir einen geprüften Warenkorb-Link.",
    ctaHeading: "Sofort in ChatGPT oder Claude starten",
    ctaSubtext:
      "Ein Klick öffnet den fertigen Beispiel-Prompt — dein KI-Assistent führt dich bei Bedarf direkt durch die kurze Verbindung mit ShopCart MCP.",
    sections: [
      {
        heading: "Warum ChatGPT Shopping mit MCP mehr leistet als die normale Websuche",
        paragraphs: [
          "Die eingebaute Websuche von ChatGPT eignet sich gut für erste Inspiration, stößt beim konkreten Einkaufen aber schnell an Grenzen: Produktseiten sind oft veraltet gecacht, Varianten-Verfügbarkeiten fehlen und am Ende musst du jeden einzelnen Artikel manuell im Shop zusammenklicken.",
          "Mit ShopCart MCP bekommt ChatGPT direkten Lesezugriff auf strukturierte Katalog- und Variantendaten öffentlicher Shopify-Shops. Statt nur über ein Produkt zu sprechen, prüft ChatGPT live, ob deine Wunschgröße auf Lager ist, und baut dir einen funktionierenden Warenkorb-Link."
        ],
        takeaway:
          "Fazit: Durch MCP wird aus unverbindlicher ChatGPT-Recherche ein geprüfter, sofort bestellbarer Warenkorb."
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
            text: "Nenne ChatGPT die gewünschte Shopify-Shop-Domain sowie Artikel, Farben, Größen, Stückzahlen oder dein Maximalbudget."
          },
          {
            lead: "Live-Prüfung abwarten:",
            text: "ChatGPT ruft automatisch inspect_store, search_products und get_product auf, prüft echte Streichpreise (compare_at_price) und sortiert ausverkaufte Varianten aus."
          },
          {
            lead: "Fertigen Warenkorb-Link im Browser öffnen:",
            text: "Über create_cart_link erhältst du einen geprüften Link (/cart/<variant_id>:<menge>?storefront=true), der alle Artikel direkt im Online-Shop lädt."
          }
        ],
        takeaway:
          "Fazit: Einmal verbunden, erledigt ChatGPT den kompletten Varianten- und Bestandsabgleich automatisch im Hintergrund."
      },
      {
        heading: "ChatGPT Websuche vs. ChatGPT mit ShopCart MCP",
        paragraphs: [
          "Gerade bei mehreren Produkten, knappen Größen oder Sale-Aktionen macht der Live-Katalogzugriff den entscheidenden Unterschied."
        ],
        table: {
          id: "chatgpt-compare-table",
          caption: "Vergleich zwischen normaler ChatGPT-Websuche und ChatGPT mit ShopCart MCP",
          headers: ["Funktion", "ChatGPT Websuche", "ChatGPT + ShopCart MCP"],
          rows: [
            [
              "Warenkorb direkt füllen",
              "Nicht möglich — nur Einzellinks",
              "Ja — geprüfter Warenkorb-Permalink mit Wunschmengen"
            ],
            [
              "Größen & Farben live prüfen",
              "Oft unvollständig oder veraltet",
              "Jede Varianten-ID wird live auf Lieferbarkeit geprüft"
            ],
            [
              "Budget-Filter",
              "Ungefähre Schätzung aus Snippets",
              "Exakter Filter (min_price / max_price) in Shop-Währung"
            ],
            [
              "Echte Rabatte erkennen",
              "Anfällig für veraltete Banner",
              "Prüft Live-Preis gegen echten compare_at_price"
            ],
            [
              "Datenschutz & Bezahlung",
              "Checkout im Browser",
              "Strikt read-only — keine Zahlungsdaten bei ShopCart MCP"
            ]
          ]
        },
        takeaway:
          "Fazit: ChatGPT plus ShopCart MCP liefert präzise Warenkörbe statt fehleranfälliger Link-Sammlungen."
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
          "Der gehostete MCP-Server von wals.pro läuft in der EU (Google Cloud, europe-west1) und umfasst im Free-Tarif dauerhaft 20 Abfragen pro Tag kostenlos. Für größere Einkaufsrunden bietet der Pro-Tarif 500 Abfragen pro Tag für 9 € im Monat — während der Black-Friday-Launch-Aktion bis einschließlich 06.12.2026 nutzen alle angemeldeten Konten automatisch 500 Abfragen pro Tag gratis.",
          "ShopCart MCP speichert weder Chat-Verläufe noch Lieferadressen, Shop-Zugänge oder Zahlungsdaten. Jeder Kaufabschluss erfolgt direkt zwischen dir und dem Händler im Browser."
        ],
        takeaway:
          "Fazit: Du testest risikofrei und kostenlos, ohne jemals Zahlungsdaten an ein Dritt-Tool weiterzugeben."
      }
    ],
    howToName: "ChatGPT mit ShopCart MCP verbinden und Warenkorb erstellen",
    howToDescription:
      "Schritt-für-Schritt-Anleitung, wie du ShopCart MCP als Custom Connector in ChatGPT hinzufügst und geprüfte Shopify-Warenkörbe baust.",
    howToSteps: [
      {
        name: "Custom MCP Connector in ChatGPT eintragen",
        text: "Füge https://shopcart.wals.pro/mcp als Custom MCP Connector in den ChatGPT-Einstellungen hinzu und bestätige den OAuth-2.1-Login."
      },
      {
        name: "Produkte, Größen und Budget im Chat angeben",
        text: "Nenne ChatGPT die gewünschte Shopify-Shop-Domain, die gesuchten Artikel, Varianten und dein Budget."
      },
      {
        name: "Geprüften Warenkorb-Link öffnen",
        text: "Klicke auf den von ChatGPT gelieferten Warenkorb-Link, prüfe Positionen und Versandkosten auf der Shop-Website und schließe die Bestellung selbst ab."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser Leitfaden basiert auf den folgenden geprüften Quellen (alle abgerufen am 25.11.2026):",
    sources: SOURCES_DE,
    limitationsLabel: "Grenzen:",
    limitationsText:
      "ShopCart MCP unterstützt ausschließlich öffentliche Shopify-Storefronts ohne Login-Pflicht. Marktplätze wie Amazon, eBay oder Shops anderer Systeme werden nicht unterstützt. Manche Shops schützen Teile ihrer Endpunkte per Firewall (WAF) — in diesen Fällen funktionieren Stichwortsuche, direkter Produktabruf und Warenkorb-Link dennoch zuverlässig.",
    faqHeading: "Häufige Fragen zu ChatGPT & Warenkorb-Links",
    faqs: [
      {
        question: "Wie verbinde ich ShopCart MCP mit ChatGPT?",
        answer:
          "Füge in den Custom-Connector-Einstellungen von ChatGPT die URL https://shopcart.wals.pro/mcp hinzu und bestätige die kurze OAuth-2.1-Anmeldung. Danach erkennt ChatGPT alle vier Read-Only-Shopping-Tools automatisch."
      },
      {
        question: "Kann ChatGPT mit ShopCart MCP selbstständig bestellen oder bezahlen?",
        answer:
          "Nein. ShopCart MCP arbeitet rein lesend und erzeugt ausschließlich einen Warenkorb-Link. ChatGPT kann weder Zahlungsdaten einsehen noch eine Bestellung auslösen — du bezahlst immer selbst im Browser."
      },
      {
        question: "Wie viele Produkte passen in einen ChatGPT-Warenkorb-Link?",
        answer:
          "Mit create_cart_link lassen sich bis zu 20 unterschiedliche Artikelpositionen mit Stückzahlen von jeweils 1 bis 99 in einem einzigen geprüften Shopify-Warenkorb-Link bündeln."
      },
      {
        question: "Funktioniert das auch mit Rabattcodes?",
        answer:
          "Ja. Wenn du einen gültigen Gutscheincode besitzt und ihn ChatGPT im Prompt nennst, kann der Code optional an den Warenkorb-Link übergeben werden. ShopCart MCP erfindet jedoch niemals eigene Rabattcodes."
      },
      {
        question: "Was kostet die Nutzung von ShopCart MCP in ChatGPT?",
        answer:
          "Im Free-Tarif sind 20 Tool-Aufrufe pro Tag dauerhaft kostenlos. Im Pro-Tarif erhältst du 500 Aufrufe pro Tag für 9 €/Monat — während der Black-Friday-Launch-Aktion bis 06.12.2026 ist das 500er-Kontingent für alle angemeldeten Konten kostenlos."
      }
    ],
    hreflang: {
      de: "/guides/chatgpt-warenkorb-erstellen",
      en: "/en/guides/chatgpt-shopify-cart",
      xDefault: "/en/guides/chatgpt-shopify-cart"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: PUBLISHED_ISO,
    keywords: [
      "chatgpt warenkorb erstellen",
      "chatgpt shopping",
      "chatgpt shopify warenkorb",
      "shopify mcp",
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
    sourcesIntro: "Dieser Ratgeber basiert auf folgenden geprüften Quellen (alle abgerufen am 25.11.2026):",
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
          "Ja. Claude und ChatGPT können mehrere öffentliche Shopify-Shops nacheinander abfragen, Preise und Verfügbarkeiten übersichtlich gegenüberstellen und dir für deinen gewählten Shop einen fertigen Warenkorb-Link bauen."
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
    modifiedDate: PUBLISHED_ISO,
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
    title: "How to Build Real Shopping Carts with Claude",
    metaTitle: "How to Build Real Shopping Carts with Claude | ShopCart MCP",
    metaDescription:
      "Connect Claude to public Shopify stores with ShopCart MCP: verify live sizes, stock, and prices, and get a ready-to-review browser cart link — read-only.",
    cardSummary:
      "Connect Claude.ai or Claude Desktop to public Shopify storefronts in two clicks and turn natural shopping prompts into verified multi-item cart links.",
    tldrLabel: "TL;DR:",
    tldrText:
      "ShopCart MCP connects Claude directly to public Shopify storefronts so your AI verifies live sizes, colors, stock, and prices and hands you a ready-to-open shopping cart link — strictly read-only, while you stay in full control of checkout.",
    intro:
      "Tired of asking an AI assistant for shopping recommendations only to click through ten tabs and discover your size is sold out? This guide shows you how to connect Claude to public Shopify stores in under a minute and build verified browser carts in one shot.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Real shopping carts instead of plain links.",
        text: "Claude fetches exact numeric variant IDs and live inventory, combining up to 20 items and quantities into a single clickable cart permalink."
      },
      {
        lead: "Strictly read-only by architecture.",
        text: "Your AI never places orders, never sees payment cards, and never accesses store logins — you review and pay directly in your own browser."
      },
      {
        lead: "Two simple ways to connect.",
        text: "Use the hosted OAuth 2.1 endpoint at https://shopcart.wals.pro/mcp in Claude.ai Web/Mobile, or run the free MIT-licensed CLI locally via npx -y shopcart-mcp."
      },
      {
        lead: "Works across global Shopify stores.",
        text: "Supports public storefronts worldwide across EUR, USD, GBP, CHF, and other ISO 4217 currencies with automatic minor-unit price normalization."
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
        heading: "Why standard AI web search breaks down when shopping",
        paragraphs: [
          "When you ask Claude to find a jacket, sneaker size, or gift bundle via ordinary web search, the model relies on indexed snippets that go stale quickly. Prices can be outdated, sale labels may no longer apply, and specific sizes or colors are rarely verified in real time.",
          "Assembling a multi-item basket is even more tedious. Even if an assistant surfaces three matching product URLs, you still have to open each page, select every variant manually, and add every item to your cart one by one."
        ],
        takeaway:
          "Takeaway: Without live variant and inventory lookups, AI shopping stops at generic links instead of saving real time."
      },
      {
        heading: "How Claude builds a verified Shopify cart in four read-only steps",
        paragraphs: [
          "ShopCart MCP uses the open Model Context Protocol (MCP) to give Claude four focused read-only tools for public Shopify storefronts. Instead of scraping HTML guesses, the server reads structured catalog endpoints live and builds an official Shopify cart permalink."
        ],
        orderedSteps: [
          {
            lead: "Inspect the store (inspect_store):",
            text: "Confirms the domain is a public Shopify storefront and resolves its canonical origin, currency, country, and firewall rules."
          },
          {
            lead: "Search the catalog (search_products):",
            text: "Finds matching products with optional filters for live availability and minimum or maximum price in the store's native currency."
          },
          {
            lead: "Verify variants and stock (get_product):",
            text: "Retrieves exact numeric variant IDs for every size and color alongside live pricing, genuine compare-at discounts, and in-stock status."
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
        heading: "Standard AI web search vs. Claude with ShopCart MCP",
        paragraphs: [
          "Here is how a live MCP shopping workflow compares to asking an AI assistant to browse open web results."
        ],
        table: {
          id: "claude-en-compare-table",
          caption: "Comparison of standard AI web search versus Claude with ShopCart MCP",
          headers: ["Dimension", "Standard AI Web Search", "Claude + ShopCart MCP"],
          rows: [
            [
              "Live prices & discounts",
              "Often cached or stale search snippets",
              "Fetched live from the store with genuine compare-at prices"
            ],
            [
              "Size & color stock check",
              "Frequently guessed or unavailable",
              "Verified per exact numeric variant ID before linking"
            ],
            [
              "Output you receive",
              "Multiple plain product links",
              "One verified cart link preloaded with all items & quantities"
            ],
            [
              "Multi-item bundles",
              "Manual click-through for every item",
              "Up to 20 line items combined into a single browser cart"
            ],
            [
              "Checkout safety",
              "Manual in browser",
              "Strictly read-only — review and payment stay in your browser"
            ]
          ]
        },
        takeaway:
          "Takeaway: Whenever exact sizing, stock checks, or multi-item bundles matter, Claude with ShopCart MCP removes the tab juggling."
      },
      {
        heading: "Set up ShopCart MCP in Claude.ai or Claude Desktop in 30 seconds",
        paragraphs: [
          "In Claude.ai (Web or Mobile), open your custom connector settings, paste https://shopcart.wals.pro/mcp, and complete the two-click OAuth 2.1 sign-in. No config files or developer tools are needed.",
          "If you prefer running everything locally in Claude Desktop, Claude Code, or Cursor, launch the MIT-licensed open-source CLI via npx -y shopcart-mcp with unlimited calls and zero telemetry. Hosted accounts include 20 free tool calls per day permanently, while Pro offers 500 calls/day for €9/month — and during our Black Friday Launch Promo through December 6, 2026, all signed-in accounts receive 500 calls/day free."
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
    howToName: "How to build a verified Shopify shopping cart with Claude",
    howToDescription:
      "Connect ShopCart MCP to Claude and generate a verified browser cart link for any public Shopify storefront.",
    howToSteps: [
      {
        name: "Connect ShopCart MCP to Claude",
        text: "Add https://shopcart.wals.pro/mcp as a custom MCP connector in Claude and finish the two-click OAuth 2.1 login (or run npx -y shopcart-mcp locally)."
      },
      {
        name: "Describe products, sizes, and budget",
        text: "Tell Claude which public Shopify store to search along with your preferred products, colors, sizes, quantities, or maximum budget."
      },
      {
        name: "Open the verified cart link and check out yourself",
        text: "Claude verifies live stock and exact variant IDs and returns a ready-to-open cart link. Open it in your browser, review the cart on the store's site, and pay as usual."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro: "This guide is grounded in the following verified sources (all retrieved on 2026-11-25):",
    sources: SOURCES_EN,
    limitationsLabel: "Limitations:",
    limitationsText:
      "ShopCart MCP works only with public Shopify storefronts that do not require a login to view products. Closed marketplaces such as Amazon, password-protected B2B portals, and non-Shopify stores are not supported. For brands with separate regional domains (such as US and EU storefronts), specify your local domain so currency and stock match your shipping country.",
    faqHeading: "Frequently Asked Questions",
    faqs: [
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
          "ShopCart MCP works with thousands of public Shopify storefronts worldwide across USD, EUR, GBP, CHF, and other currencies. Password-protected stores and closed marketplaces such as Amazon are not supported."
      },
      {
        question: "How much does ShopCart MCP cost?",
        answer:
          "The hosted Free plan includes 20 tool calls per day permanently. The Pro plan offers 500 calls per day for €9 per month — and during the Black Friday launch promo through December 6, 2026, every signed-in account automatically receives 500 calls per day for free. The local open-source CLI is free and unlimited under the MIT License."
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
    modifiedDate: PUBLISHED_ISO,
    keywords: [
      "shop with claude",
      "claude shopping",
      "claude mcp shopify",
      "shopify mcp server",
      "ai shopping assistant"
    ]
  },
  {
    path: "/en/guides/chatgpt-shopify-cart",
    lang: "en",
    category: "ChatGPT Black Friday Guide",
    title: "Let ChatGPT Build Your Shopify Cart for Black Friday",
    metaTitle: "Let ChatGPT Build Your Shopify Cart for Black Friday",
    metaDescription:
      "Use ChatGPT Custom MCP Connectors with ShopCart MCP to check live Black Friday deals, verify in-stock sizes, and build ready-to-open Shopify cart links.",
    cardSummary:
      "Beat Black Friday sell-outs and tab overload: connect ChatGPT via Custom MCP Connector to check live markdowns, verify stock, and build one verified cart link.",
    tldrLabel: "TL;DR:",
    tldrText:
      "Connect ChatGPT to ShopCart MCP (https://shopcart.wals.pro/mcp) to search public Shopify stores for live Black Friday deals, verify real compare-at discounts and in-stock sizes, and get a ready-to-open browser cart link — strictly read-only.",
    intro:
      "Black Friday and holiday gift shopping usually means juggling twenty tabs, chasing fake percentage banners, and hitting sold-out sizes at checkout. This guide shows how to connect ChatGPT via Custom MCP Connectors so your AI checks live Shopify stock and builds a verified cart link in seconds.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Verify genuine Black Friday markdowns live.",
        text: "ShopCart MCP compares live selling prices against each store's actual compare_at_price — reporting discounts only when a real markdown exists."
      },
      {
        lead: "Filter out sold-out sizes before you click.",
        text: "Every variant ID is checked live via get_product and re-verified during cart creation so you never land on an empty cart."
      },
      {
        lead: "Combine holiday bundles in one link.",
        text: "Bundle up to 20 line items across sizes and colors into a single Shopify cart permalink ready for browser review."
      },
      {
        lead: "Free 500 calls/day Black Friday promo.",
        text: "All signed-in hosted accounts automatically get 500 tool calls per day for free through December 6, 2026 — no credit card required."
      }
    ],
    primaryAssistant: "chatgpt",
    starterPrompt:
      "Connect to ShopCart MCP (https://shopcart.wals.pro/mcp) — if not set up yet, walk me through the 2-click custom connector setup. Then find in-stock Black Friday gift ideas under €80 on snocks.com or allbirds.eu, check real compare-at discounts and sizes, and generate one verified cart link.",
    ctaHeading: "Launch Black Friday Cart Prompt in 1 Click",
    ctaSubtext:
      "Opens a ready-to-use holiday shopping prompt in ChatGPT or Claude — complete with 2-click setup guidance if needed.",
    sections: [
      {
        heading: "Why Black Friday shopping needs live variant and discount checks",
        paragraphs: [
          "During Black Week and holiday sales, catalog prices and stock levels change by the minute. Standard search indexes lag behind, which leads to expired deal snippets and sizes that sold out hours earlier.",
          "By connecting ChatGPT to ShopCart MCP, your assistant queries live Shopify storefront data instead of relying on stale search caches — letting you filter by budget, availability, and exact sizes across your favorite independent brands."
        ],
        takeaway:
          "Takeaway: Live catalog queries turn Black Friday browsing from guesswork into verified, in-stock carts."
      },
      {
        heading: "Step-by-step: connect ChatGPT and build your Black Friday cart",
        paragraphs: [
          "Setting up ShopCart MCP in ChatGPT takes under a minute using standard OAuth 2.1 authentication."
        ],
        orderedSteps: [
          {
            lead: "Add the Custom MCP Connector:",
            text: "Open ChatGPT connector settings, enter https://shopcart.wals.pro/mcp, and complete the two-click OAuth 2.1 login."
          },
          {
            lead: "Specify stores, gifts, sizes, and budget:",
            text: "Ask ChatGPT to search one or more public Shopify stores with a clear price ceiling (for example, gifts under $50 or €80) and required sizes."
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
        heading: "Manual Black Friday shopping vs. ChatGPT + ShopCart MCP",
        paragraphs: [
          "Compare the time and accuracy difference when putting together multi-item holiday orders."
        ],
        table: {
          id: "chatgpt-bf-compare-table",
          caption: "Comparison of manual Black Friday shopping versus ChatGPT with ShopCart MCP",
          headers: ["Workflow Step", "Manual / Plain Web Search", "ChatGPT + ShopCart MCP"],
          rows: [
            [
              "Checking size availability",
              "Open every product page individually",
              "Live variant check across all matching products"
            ],
            [
              "Spotting genuine deals",
              "Easy to miss real vs. anchor pricing",
              "Structured live price vs. compare_at_price verification"
            ],
            [
              "Sticking to a gift budget",
              "Manual mental math across tabs",
              "Server-side min_price / max_price filtering in store currency"
            ],
            [
              "Adding multiple items",
              "Click add-to-cart for every single variant",
              "One verified permalink loads up to 20 items at once"
            ],
            [
              "Payment & account safety",
              "Browser checkout on store site",
              "Strictly read-only — checkout always stays in your browser"
            ]
          ]
        },
        takeaway:
          "Takeaway: ChatGPT plus ShopCart MCP cuts multi-tab holiday shopping down to a single verified cart review."
      },
      {
        heading: "High-converting prompt ideas for Black Friday and holiday gifts",
        paragraphs: [
          "For the cleanest results, include the brand's regional Shopify domain (such as an EU or US storefront), your maximum budget, and required sizes or colors. If you already have a valid store promo code, you can also tell ChatGPT to attach it to the cart link.",
          "Great examples include: \"Find 3 in-stock holiday gift ideas under €50 on snocks.com and bundle them into one cart link\" or \"Compare available merino socks under €30 on allbirds.eu in size M and build a cart for 2 pairs.\""
        ],
        takeaway:
          "Takeaway: Pairing a regional store URL with budget and size constraints gives ChatGPT everything needed for an instant cart."
      },
      {
        heading: "Read-only architecture & Black Friday Launch Promo",
        paragraphs: [
          "ShopCart MCP never stores payment cards, shipping addresses, merchant logins, or chat transcripts. All four tools are read-only, sanitized against prompt injection, and protected by DNS-pinned SSRF guards on EU infrastructure (europe-west1).",
          "During the Black Friday Launch Promo through December 6, 2026, every signed-in account gets 500 free tool calls per day automatically. Afterward, the hosted Free tier remains 20 calls/day permanently (Pro optional at €9/month, cancel anytime), and the open-source MIT CLI stays free and unlimited locally."
        ],
        takeaway:
          "Takeaway: Fast Black Friday cart building with zero payment exposure and generous free daily limits."
      }
    ],
    howToName: "How to let ChatGPT build a Black Friday Shopify cart",
    howToDescription:
      "Connect ShopCart MCP as a Custom MCP Connector in ChatGPT, filter real Black Friday deals, and open a verified browser cart link.",
    howToSteps: [
      {
        name: "Connect ShopCart MCP in ChatGPT",
        text: "Add https://shopcart.wals.pro/mcp in ChatGPT's custom MCP connector settings and complete the two-click OAuth 2.1 sign-in."
      },
      {
        name: "Ask ChatGPT for deals, gifts, and sizes within your budget",
        text: "Name your preferred public Shopify store domain, target items or gift budget, and exact sizes or colors."
      },
      {
        name: "Review and check out on the merchant's website",
        text: "Open the verified cart link in your browser, double-check shipping, discounts, and final totals, and pay directly on the store's site."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro: "This guide is based on the following verified sources (all retrieved on 2026-11-25):",
    sources: SOURCES_EN,
    limitationsLabel: "Limitations:",
    limitationsText:
      "ShopCart MCP works exclusively with public Shopify storefronts that do not require a login to browse. Closed marketplaces like Amazon, password-protected B2B stores, and non-Shopify platforms are not supported. Because Black Friday inventory and pricing change rapidly, always verify final totals and delivery estimates on the merchant's cart page before purchasing.",
    faqHeading: "Frequently Asked Questions",
    faqs: [
      {
        question: "How do I connect ShopCart MCP to ChatGPT?",
        answer:
          "Paste https://shopcart.wals.pro/mcp into ChatGPT's custom MCP connector settings and finish the two-click OAuth 2.1 login. ChatGPT immediately gains access to all four read-only shopping tools."
      },
      {
        question: "Can ChatGPT complete a Black Friday purchase automatically?",
        answer:
          "No. ShopCart MCP is strictly read-only and never submits orders or handles payment methods. You open the generated cart link in your own browser and complete checkout directly with the store."
      },
      {
        question: "Can ChatGPT apply my Black Friday discount code to the cart link?",
        answer:
          "Yes, if you provide a real discount code in your prompt, ChatGPT can pass it to create_cart_link. ShopCart MCP never invents or guesses coupon codes."
      },
      {
        question: "How does ShopCart MCP handle different currencies for international stores?",
        answer:
          "ShopCart MCP reads the storefront's native currency via inspect_store and normalizes prices across EUR, USD, GBP, CHF, and other ISO 4217 currencies automatically. For multi-region brands, specify your local storefront domain."
      },
      {
        question: "How much does ShopCart MCP cost for Black Friday shopping?",
        answer:
          "Through December 6, 2026, every signed-in hosted account automatically gets 500 tool calls per day for free. After the promo, the hosted Free tier remains 20 calls/day permanently, Pro is €9/month (500 calls/day), and the MIT open-source CLI is always free locally."
      }
    ],
    hreflang: {
      en: "/en/guides/chatgpt-shopify-cart",
      de: "/guides/chatgpt-warenkorb-erstellen",
      xDefault: "/en/guides/chatgpt-shopify-cart"
    },
    publishedDate: PUBLISHED_ISO,
    modifiedDate: PUBLISHED_ISO,
    keywords: [
      "chatgpt shopify cart",
      "chatgpt connectors",
      "ai black friday deals",
      "ai gift finder",
      "chatgpt shopping assistant"
    ]
  }
];

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
        ? "für Shopify-Shops – unabhängiges Community-Tool, nicht verbunden mit Shopify Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern."
        : "for Shopify stores – independent community tool, not affiliated with Shopify Inc. All trademarks belong to their respective owners."
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
  const [h0, h1, h2] = table.headers;
  const captionId = `${table.id}-caption`;
  const rowsHtml = table.rows
    .map(
      ([c0, c1, c2]) => `<tr>
        <th scope="row">${escapeHtml(c0)}</th>
        <td data-label="${escapeHtml(h1)}">${escapeHtml(c1)}</td>
        <td data-label="${escapeHtml(h2)}">${escapeHtml(c2)}</td>
      </tr>`
    )
    .join("\n      ");

  return `<div tabindex="0" role="region" aria-labelledby="${escapeHtml(captionId)}" class="table-wrapper">
    <table>
      <caption id="${escapeHtml(captionId)}">${escapeHtml(table.caption)}</caption>
      <thead>
        <tr>
          <th scope="col">${escapeHtml(h0)}</th>
          <th scope="col">${escapeHtml(h1)}</th>
          <th scope="col">${escapeHtml(h2)}</th>
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

  const relatedGuides = GUIDE_DEFINITIONS.filter((g) => g.path !== guide.path);
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
<link rel="stylesheet" href="/assets/guides.css?v=0.1.0">
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
        <span class="meta-date">${de ? "Aktualisiert am 25.11.2026 · von wals.pro" : "Updated Nov 25, 2026 · by wals.pro"}</span>
      </div>

      <h1>${escapeHtml(guide.title)}</h1>

      <div class="article-tldr">
        <p><strong>${escapeHtml(guide.tldrLabel)}</strong> ${escapeHtml(guide.tldrText)}</p>
      </div>

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
          ? "Hinweis: ShopCart MCP ist ein Angebot für Shopify-Shops – unabhängiges Community-Tool, nicht verbunden mit Shopify Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern."
          : "Note: ShopCart MCP is built for Shopify stores – independent community tool, not affiliated with Shopify Inc. All trademarks belong to their respective owners."
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
    ? "Praxis-Guides für Claude & ChatGPT: Shopify-Warenkorb automatisch bauen, Adventskalender & Black-Friday-Deals mit KI finden — read-only & sicher."
    : "Step-by-step guides for Claude and ChatGPT: build verified Shopify shopping carts, compare Black Friday deals, and check live stock — strictly read-only.";

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
<link rel="stylesheet" href="/assets/guides.css?v=0.1.0">
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
        <span class="meta-date">${de ? "Read-only · Claude & ChatGPT · Shopify-Shops" : "Read-only · Claude & ChatGPT · Shopify Stores"}</span>
      </div>

      <h1>${de ? "KI-Shopping-Guides für Claude & ChatGPT" : "AI Shopping Guides for Claude & ChatGPT"}</h1>

      <div class="article-tldr">
        <p><strong>${de ? "Kurz gesagt:" : "TL;DR:"}</strong> ${
          de
            ? "Alle Schritt-für-Schritt-Anleitungen für ShopCart MCP auf einen Blick: Verbinde Claude oder ChatGPT mit öffentlichen Shopify-Shops, prüfe Größen und echte Rabatte live und öffne fertige Warenkorb-Links zum Selbstbezahlen."
            : "Every step-by-step guide for ShopCart MCP in one place: connect Claude or ChatGPT to public Shopify stores, check live sizes and genuine discounts, and open ready-to-review cart links yourself."
        }</p>
      </div>

      ${renderOneClickButtons(
        lang,
        "claude",
        de ? "Direkt loslegen: 1-Klick-Start" : "Start Shopping in 1 Click",
        de
          ? "Starte sofort mit einem fertigen Prompt in Claude oder ChatGPT — kostenlos im Free-Tarif (und 500 Calls/Tag gratis während des Black-Friday-Launch bis 06.12.2026)."
          : "Launch a ready-to-use prompt directly in Claude or ChatGPT — free permanently on the Free tier (and 500 calls/day free during the Black Friday launch through Dec 6, 2026).",
        starterPrompt
      )}

      ${primaryBlock}

      <div class="disclaimer">${
        de
          ? "für Shopify-Shops – unabhängiges Community-Tool, nicht verbunden mit Shopify Inc. Alle Markennamen gehören ihren jeweiligen Eigentümern."
          : "for Shopify stores – independent community tool, not affiliated with Shopify Inc. All trademarks belong to their respective owners."
      }</div>
    </div>
  </div>
</main>

${renderFooter(config, lang)}
</body>
</html>`;
}

export function renderSitemapXml(config: AppConfig): string {
  const origin = config.appOrigin;
  const staticUrls: Array<{
    loc: string;
    priority: string;
    changefreq: string;
    alternates?: Array<{ hreflang: string; href: string }>;
  }> = [
    {
      loc: `${origin}/`,
      priority: "1.0",
      changefreq: "weekly",
      alternates: [
        { hreflang: "de", href: `${origin}/?lang=de` },
        { hreflang: "en", href: `${origin}/?lang=en` },
        { hreflang: "x-default", href: `${origin}/` }
      ]
    },
    {
      loc: `${origin}/guides`,
      priority: "0.9",
      changefreq: "weekly",
      alternates: [
        { hreflang: "de", href: `${origin}/guides?lang=de` },
        { hreflang: "en", href: `${origin}/guides?lang=en` },
        { hreflang: "x-default", href: `${origin}/guides` }
      ]
    },
    ...GUIDE_DEFINITIONS.map((g) => ({
      loc: `${origin}${g.path}`,
      priority: "0.8",
      changefreq: "weekly",
      alternates: [
        { hreflang: "de", href: `${origin}${g.hreflang.de}` },
        { hreflang: "en", href: `${origin}${g.hreflang.en}` },
        { hreflang: "x-default", href: `${origin}${g.hreflang.xDefault}` }
      ]
    })),
    { loc: `${origin}/privacy`, priority: "0.3", changefreq: "monthly" },
    { loc: `${origin}/terms`, priority: "0.3", changefreq: "monthly" }
  ];

  const entries = staticUrls
    .map((u) => {
      const altXml = (u.alternates ?? [])
        .map(
          (a) =>
            `    <xhtml:link rel="alternate" hreflang="${escapeHtml(a.hreflang)}" href="${escapeHtml(a.href)}"/>`
        )
        .join("\n");
      return `  <url>
    <loc>${escapeHtml(u.loc)}</loc>
    <lastmod>${PUBLISHED_ISO}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${altXml ? `\n${altXml}` : ""}
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`;
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

  router.get("/sitemap.xml", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(renderSitemapXml(config));
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
