import {
  AMAZON_SOURCES_DE,
  AMAZON_SOURCES_EN,
  SHOPIFY_MCP_SOURCES_DE,
  SHOPIFY_MCP_SOURCES_EN,
  SOURCES_DE,
  SOURCES_EN,
  UPDATED_ISO,
  type GuideDefinition
} from "./guides-types.js";
import { getPlatformLimits, getTrademarkDisclaimer } from "./platforms.js";

export const ANSWER_PAGE_GUIDES: readonly GuideDefinition[] = [
  {
    path: "/en/guides/chatgpt-instant-checkout-alternative",
    lang: "en",
    category: "Open MCP Alternative",
    title: "Best Open Alternative to ChatGPT Instant Checkout in 2026 (MCP)",
    metaTitle: "Open Alternative to ChatGPT Instant Checkout (2026 MCP)",
    metaDescription:
      "Open-source, EU-hosted, strictly read-only MCP alternative to ChatGPT Instant Checkout: build verified shopping carts in ChatGPT, Claude & more.",
    cardSummary:
      "OpenAI scaled back standalone Instant Checkout in 2026. Here is how an open, EU-hosted, strictly read-only MCP server fills the gap across ChatGPT, Claude, and Cursor.",
    tldrLabel: "Direct Answer:",
    tldrText:
      "After OpenAI scaled back standalone in-chat Instant Checkout in 2026, most remaining AI shopping flows are closed, US-focused ecosystems with payment lock-in. ShopCart MCP (https://shopcart.wals.pro/mcp) is the open-source (MIT), EU-hosted, strictly read-only MCP alternative: it works inside ChatGPT, Claude, Perplexity, and Cursor to build verified browser cart links while you pay directly on the store.",
    intro:
      "Many shoppers and teams looking for a ChatGPT Instant Checkout alternative in 2026 run into the same dilemma: either settle for plain text shopping lists, or lock payment details into a single closed ecosystem that only serves select US merchants. The Model Context Protocol (MCP) offers a cleaner third path.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Works across ChatGPT, Claude, Google Gemini, Perplexity, and Cursor.",
        text: "Because ShopCart MCP uses the open MCP standard and OAuth 2.1, you are never tied to one AI vendor or one checkout wallet."
      },
      {
        lead: "Strictly read-only with zero checkout lock-in.",
        text: "ShopCart MCP stops at a verified browser cart link so shipping addresses, discount codes, and payment methods stay between you and the store."
      },
      {
        lead: "Built for EU, DACH, UK, and global currencies.",
        text: "Hosted on EU infrastructure (Google Cloud europe-west1) with GDPR-first data minimization and automatic currency handling across EUR, CHF, GBP, and USD."
      },
      {
        lead: "Open-source MIT CLI or 2-click hosted endpoint.",
        text: "Connect https://shopcart.wals.pro/mcp in two clicks (20 free calls/day permanently) or self-run npx -y shopcart-mcp locally with unlimited calls."
      }
    ],
    primaryAssistant: "chatgpt",
    starterPrompt:
      "Connect to ShopCart MCP (https://shopcart.wals.pro/mcp) — if the connector is not active yet, walk me through the 2-click OAuth setup first. Then search got-bag.com for in-stock waterproof backpacks under €180, verify live variants and prices, and generate a ready-to-open browser cart link.",
    ctaHeading: "Try the Open MCP Alternative in 1 Click",
    ctaSubtext:
      "Launch a ready-to-run shopping prompt directly in ChatGPT or Claude — strictly read-only with zero payment details shared.",
    sections: [
      {
        heading: "What happened to ChatGPT Instant Checkout in 2026?",
        paragraphs: [
          "Standalone in-chat checkout proved hard to scale cleanly across independent merchants of every size: shipping rules, tax jurisdictions, returns, loyalty points, and regional payment methods such as SEPA, Klarna, or local cards vary widely from store to store.",
          "As standalone Instant Checkout was scaled back in early 2026, most remaining AI shopping experiences gravitated toward closed ecosystems that require merchants to join a specific walled garden and often limit availability to US shoppers. That left European and global shoppers asking how to get real, pre-filled carts without surrendering checkout control."
        ],
        takeaway:
          "Takeaway: Separating AI cart assembly (read-only MCP) from merchant checkout (your own browser) avoids payment lock-in and works across borders immediately."
      },
      {
        heading: "Closed shopping ecosystems vs. Open MCP cart links",
        paragraphs: [
          "Instead of routing credit cards through an AI intermediary, an open MCP server reads public storefront catalogs live and returns an official merchant cart permalink. Compare the architectural trade-offs below."
        ],
        table: {
          id: "instant-checkout-alt-en-table",
          caption: "Comparison of scaled-back Instant Checkout, closed AI shopping ecosystems, and ShopCart MCP",
          headers: [
            "Criterion",
            "Scaled-Back In-Chat Checkout",
            "Closed Ecosystems (Walled Gardens)",
            "ShopCart MCP (Open MCP)"
          ],
          rows: [
            [
              "Supported AI assistants",
              "Single AI client only",
              "Tied to one proprietary assistant",
              "ChatGPT, Claude, Google Gemini, Perplexity, Cursor, Claude Code & more"
            ],
            [
              "Geographic & currency coverage",
              "Limited pilot markets",
              "Frequently US-first or regional grocery only",
              "Global storefronts in EUR, CHF, GBP, USD, CAD, JPY"
            ],
            [
              "Merchant onboarding required",
              "Merchant enrollment required",
              "Merchant partner program required",
              "Zero merchant setup for public Shopify, WooCommerce, BigCommerce, Shopware 6, Magento 2 & Schema.org JSON-LD stores + official Amazon cart permalinks"
            ],
            [
              "Payment & account safety",
              "In-chat payment handling",
              "Centralized wallet inside one ecosystem",
              "Strictly read-only — you review & pay directly in your browser"
            ],
            [
              "Openness & hosting",
              "Proprietary",
              "Proprietary",
              "MIT open source (local CLI) + EU-hosted OAuth 2.1 (europe-west1)"
            ]
          ]
        },
        takeaway:
          "Takeaway: ShopCart MCP gives you multi-AI freedom, EU hosting, and direct merchant checkout with zero vendor lock-in."
      },
      {
        heading: "How ShopCart MCP works inside ChatGPT, Claude, and other MCP clients",
        paragraphs: [
          "ShopCart MCP exposes six read-only tools over the standard Model Context Protocol. Four of them form the core path below; two more read sale collections and shipping and return policies on Shopify stores. Your AI calls them in sequence to verify live catalog data before assembling the cart link."
        ],
        orderedSteps: [
          {
            lead: "Inspect store compatibility (inspect_store):",
            text: "Detects whether a store runs on Shopify, WooCommerce, BigCommerce, Shopware 6, Magento 2, Amazon, or Universal Schema.org JSON-LD and resolves currency, country, and firewall rules."
          },
          {
            lead: "Search live catalog (search_products):",
            text: "Searches public Shopify, WooCommerce, BigCommerce, Shopware 6, and Magento 2 catalogs with exact availability and price filters in the store's native currency."
          },
          {
            lead: "Verify variants and stock (get_product):",
            text: "Reads exact variant IDs, sizes, colors, live selling prices, and genuine compare-at markdowns."
          },
          {
            lead: "Generate a verified cart link (create_cart_link):",
            text: "Re-verifies items against the store and returns a browser cart permalink preloaded with your exact quantities."
          }
        ],
        takeaway:
          "Takeaway: Four deterministic read-only steps replace brittle scraping and risky auto-checkout flows."
      },
      {
        heading: "Privacy, security, and EU hosting by design",
        paragraphs: [
          "Every tool in ShopCart MCP carries read-only MCP annotations (readOnlyHint: true, destructiveHint: false). The server never collects shipping addresses, never accesses store accounts, never touches payment cards, and never stores chat transcripts.",
          "To protect AI sessions from malicious store text, ShopCart MCP strips HTML, scripts, and invisible Unicode characters from catalog fields and enforces DNS-pinned SSRF protection on EU infrastructure (Google Cloud europe-west1)."
        ],
        takeaway:
          "Takeaway: Read-only cart links keep your payment data out of AI chats while still automating the tedious catalog and variant lookup."
      }
    ],
    howToName: "How to switch to an open MCP alternative for AI shopping carts",
    howToDescription:
      "Connect ShopCart MCP to ChatGPT or Claude via OAuth 2.1 and build verified browser shopping carts without payment lock-in.",
    howToSteps: [
      {
        name: "Add ShopCart MCP as a custom connector",
        text: "Paste https://shopcart.wals.pro/mcp into ChatGPT or Claude custom MCP connector settings and complete the two-click OAuth 2.1 login (or run npx -y shopcart-mcp locally)."
      },
      {
        name: "Describe your store, items, sizes, and budget",
        text: "Ask your AI assistant to check live stock and prices on a public Shopify, WooCommerce, BigCommerce, Shopware 6, or Magento 2 store, or assemble an official Amazon multi-item cart permalink."
      },
      {
        name: "Open the verified cart link and check out yourself",
        text: "Click the returned browser cart link to review quantities, shipping options, and final totals directly on the merchant's website."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro: "This guide is grounded in the following verified sources (retrieved 2026-11-26):",
    sources: SOURCES_EN,
    limitationsLabel: "Limitations:",
    limitationsText:
      "ShopCart MCP is intentionally read-only: it never executes one-click in-chat payments or logs into private merchant accounts." + " " + getPlatformLimits("en"),
    faqHeading: "Frequently Asked Questions",
    faqs: [
      {
        question: "Does ChatGPT use MCP for shopping carts in 2026?",
        answer:
          "Yes. ChatGPT supports custom remote MCP connectors with OAuth 2.1. Once you add https://shopcart.wals.pro/mcp, ChatGPT can inspect public storefronts, check live sizes and prices, and generate a verified browser cart link directly in chat."
      },
      {
        question: "Why is a read-only MCP cart link safer than in-chat instant checkout?",
        answer:
          "With a read-only cart link, your payment cards, shipping address, and store password never enter the AI chat or a third-party proxy. You verify every item, shipping cost, and return policy directly on the merchant's own checkout page."
      },
      {
        question: "Does ShopCart MCP work in Europe (EU/DACH) as well as the US and UK?",
        answer:
          "Yes. Unlike US-only AI checkout pilots, ShopCart MCP is hosted in the EU (Google Cloud europe-west1) and supports public storefronts worldwide across EUR, CHF, GBP, USD, CAD, and JPY."
      },
      {
        question: "Can I use the same shopping connector in Claude, Perplexity, and Cursor?",
        answer:
          "Yes. Because ShopCart MCP implements the open Model Context Protocol over Streamable HTTP (OAuth 2.1) and local stdio (npx -y shopcart-mcp), the same server works across ChatGPT, Claude, Perplexity, Cursor, and Claude Code."
      },
      {
        question: "How much does ShopCart MCP cost compared to proprietary shopping tools?",
        answer:
          "The hosted Free tier includes 20 tool calls per day permanently at €0. Hosted Pro offers 500 calls/day for €9/month. The MIT-licensed local CLI (npx -y shopcart-mcp) is free and unlimited with zero telemetry."
      }
    ],
    hreflang: {
      en: "/en/guides/chatgpt-instant-checkout-alternative",
      de: "/guides/chatgpt-instant-checkout-alternative",
      xDefault: "/en/guides/chatgpt-instant-checkout-alternative"
    },
    publishedDate: UPDATED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "chatgpt instant checkout alternative",
      "open ai shopping cart",
      "chatgpt mcp shopping",
      "read-only shopping mcp",
      "shopcart mcp"
    ]
  },
  {
    path: "/guides/chatgpt-instant-checkout-alternative",
    lang: "de",
    category: "Offene MCP-Alternative",
    title: "ChatGPT Instant Checkout Alternative (2026): Offene Warenkörbe per MCP",
    metaTitle: "ChatGPT Instant Checkout Alternative (2026): Offenes MCP",
    metaDescription:
      "Offene, EU-gehostete Alternative zu ChatGPT Instant Checkout: geprüfte Warenkörbe in ChatGPT und Claude für Shopify, WooCommerce, Amazon und mehr. Read-only.",
    cardSummary:
      "Seit OpenAI den eigenen Instant Checkout 2026 zurückgefahren hat, fehlen im DACH-Raum offene KI-Warenkörbe. So löst ein EU-gehosteter Read-Only-MCP-Server die Lücke.",
    tldrLabel: "Kurzantwort:",
    tldrText:
      "Seit OpenAI den eigenständigen Instant Checkout 2026 zurückgefahren hat, dominieren geschlossene US-Ökosysteme mit Zahlungs-Lock-in. ShopCart MCP (https://shopcart.wals.pro/mcp) ist die offene, EU-gehostete und strikt lesende MCP-Alternative für den DACH-Raum: Du nutzt denselben Connector in ChatGPT, Claude, Perplexity und Cursor für geprüfte Warenkorb-Links — und bezahlst immer selbst im Shop.",
    intro:
      "Viele Nutzerinnen und Nutzer im DACH-Raum suchen 2026 nach einer verlässlichen Alternative zu ChatGPT Instant Checkout. Entweder endet der Chat bei simplen Text-Einkaufslisten, oder neue Shopping-Funktionen sind auf geschlossene US-Ökosysteme beschränkt. Über das offene Model Context Protocol (MCP) funktioniert der KI-Warenkorb heute herstellerunabhängig und DSGVO-konform.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Ein offener Standard für ChatGPT, Claude, Google Gemini, Perplexity und Cursor.",
        text: "Du richtest ShopCart MCP einmal per OAuth 2.1 oder lokal als MIT-Open-Source-CLI ein — ganz ohne Bindung an ein einzelnes KI-Ökosystem."
      },
      {
        lead: "EU-Hosting & DSGVO-Fokus ab Werk.",
        text: "Der gehostete Server läuft in der EU (Google Cloud europe-west1), speichert keine Chat-Verläufe und verarbeitet EUR, CHF, GBP sowie USD korrekt."
      },
      {
        lead: "Strikt read-only statt riskantem Auto-Checkout.",
        text: "ShopCart MCP liest Kataloge und baut einen geprüften Warenkorb-Link; Adresse, Versandart, SEPA/Klarna/Karte und Kaufabschluss bleiben in deinem Browser."
      },
      {
        lead: "Kein Händler-Onboarding für öffentliche Shops nötig.",
        text: "Öffentliche Shops auf Shopify, WooCommerce, BigCommerce, Shopware 6 und Magento 2 funktionieren sofort mit Live-Bestandsprüfung; für Amazon stehen offizielle Multi-Artikel-Warenkorb-Links bereit."
      }
    ],
    primaryAssistant: "chatgpt",
    starterPrompt:
      "Verbinde dich mit ShopCart MCP (https://shopcart.wals.pro/mcp) — falls der Connector noch nicht aktiv ist, erkläre mir kurz das 2-Klick-OAuth-Setup. Suche mir danach bei got-bag.com lieferbare wasserdichte Rucksäcke unter 180 €, prüfe Live-Preise und Varianten und erstelle mir einen fertigen Warenkorb-Link.",
    ctaHeading: "Offene MCP-Alternative mit 1 Klick testen",
    ctaSubtext:
      "Startet direkt einen fertigen Einkaufs-Prompt in ChatGPT oder Claude — strikt read-only und ohne Weitergabe von Zahlungsdaten.",
    sections: [
      {
        heading: "Warum der eigenständige Instant Checkout 2026 zurückgefahren wurde",
        paragraphs: [
          "Direkte Bezahlstrecken im KI-Chat stoßen im realen E-Commerce schnell an Grenzen: Versandkostenregeln, regionale Mehrwertsteuer, Rückgaberechte, Gutscheine und lokale Zahlungsarten wie Rechnungskauf, SEPA oder TWINT unterscheiden sich von Händler zu Händler.",
          "Nachdem der eigenständige ChatGPT Instant Checkout 2026 zurückgefahren wurde, setzten neue Angebote vor allem auf geschlossene US-Ökosysteme mit eigenem Wallet. Für Käuferinnen und Käufer in Deutschland, Österreich und der Schweiz blieb eine klare Lücke: ein offener, datenschutzfreundlicher Weg zu echten Warenkörben."
        ],
        takeaway:
          "Fazit: Die Trennung zwischen KI-Warenkorb-Bau (read-only per MCP) und Bezahlung im Händler-Browser funktioniert sofort und grenzüberschreitend."
      },
      {
        heading: "Geschlossene Ökosysteme vs. Textlisten vs. ShopCart MCP im Vergleich",
        paragraphs: [
          "Die folgende Tabelle vergleicht die vier wichtigsten Ansätze für KI-Shopping im Jahr 2026 anhand von Offenheit, DACH-Tauglichkeit und Zahlungssicherheit."
        ],
        table: {
          id: "instant-checkout-alt-de-table",
          caption: "Vergleich: Text-Einkaufslisten, geschlossene Ökosysteme und ShopCart MCP",
          headers: [
            "Kriterium",
            "Text-Einkaufslisten (Websuche)",
            "Geschlossene US-Ökosysteme",
            "ShopCart MCP (Offenes MCP)"
          ],
          rows: [
            [
              "Unterstützte KI-Assistenten",
              "Jeder Chat (nur Textlinks)",
              "Fest an einen Anbieter gebunden",
              "ChatGPT, Claude, Google Gemini, Perplexity, Cursor & Claude Code"
            ],
            [
              "DACH- & EU-Verfügbarkeit",
              "Weltweit, aber oft veraltete Preise",
              "Häufig US-only oder lokale Lieferdienste",
              "EU-gehostet (europe-west1), EUR, CHF, GBP, USD"
            ],
            [
              "Händler-Einrichtung nötig?",
              "Nein",
              "Ja — geschlossenes Partnerprogramm",
              "Nein — öffentliche Shopify-, WooCommerce-, BigCommerce-, Shopware-6-, Magento-2- & JSON-LD-Shops + Amazon-Cart-Links"
            ],
            [
              "Zahlung & Datenschutz",
              "Manuell im Browser",
              "Zentrales Wallet beim Plattformbetreiber",
              "Strikt read-only — du bezahlst direkt beim Händler"
            ],
            [
              "Lizenz & Betrieb",
              "Proprietär",
              "Proprietär",
              "MIT Open Source (lokale CLI) oder EU-Hosted OAuth 2.1"
            ]
          ]
        },
        takeaway:
          "Fazit: ShopCart MCP verbindet DACH-Tauglichkeit, freie KI-Wahl und volle Zahlungshoheit im Browser."
      },
      {
        heading: "So baust du offene KI-Warenkörbe in vier Read-Only-Schritten",
        paragraphs: [
          "ShopCart MCP stellt deiner KI sechs klar abgegrenzte Lese-Werkzeuge über das offene Model Context Protocol bereit. Vier davon bilden den Weg zum Warenkorb, zwei weitere lesen in Shopify-Shops Sale-Kollektionen sowie Versand- und Rückgaberegeln."
        ],
        orderedSteps: [
          {
            lead: "Shop erkennen (inspect_store):",
            text: "Prüft automatisch, ob ein öffentlicher Shopify-, WooCommerce-, BigCommerce-, Shopware-6-, Magento-2-, Amazon- oder Schema.org-JSON-LD-Shop vorliegt, und liest Währung sowie Region aus."
          },
          {
            lead: "Live-Katalog durchsuchen (search_products):",
            text: "Filtert lieferbare Artikel auf öffentlichen Shopify-, WooCommerce-, BigCommerce-, Shopware-6- und Magento-2-Storefronts nach Stichwort und Budget in Shop-Währung."
          },
          {
            lead: "Größen & Bestand verifizieren (get_product):",
            text: "Lädt exakte Varianten-IDs, Farben, Größen, Live-Preise und echte Streichpreise direkt vom Händler."
          },
          {
            lead: "Geprüften Warenkorb-Link öffnen (create_cart_link):",
            text: "Bündelt deine Wunschpositionen in einem klickbaren Warenkorb-Permalink, den du selbst im Browser prüfst und bezahlst."
          }
        ],
        takeaway:
          "Fazit: Vier deterministische Lese-Schritte liefern verlässliche Warenkörbe statt fehleranfälliger Browser-Automatisierung."
      },
      {
        heading: "Datenschutz, Kosten und lokaler Open-Source-Betrieb",
        paragraphs: [
          "Alle sechs Werkzeuge sind technisch als rein lesend markiert und verarbeiten weder Kreditkarten noch Lieferadressen oder Shop-Passwörter. Ein integrierter Filter schützt deine KI vor versteckten Text-Injektionen in fremden Produktbeschreibungen, während DNS-gepinnte SSRF-Regeln interne Netze absichern.",
          "Im gehosteten EU-Dienst sind 20 Abfragen pro Tag dauerhaft kostenlos (Pro optional 9 €/Monat für 500 Abfragen/Tag). Wer lokal arbeitet, nutzt npx -y shopcart-mcp unter MIT-Lizenz kostenlos, unbegrenzt und ohne Konto."
        ],
        takeaway:
          "Fazit: Du testest sofort gratis und entscheidest frei zwischen 2-Klick-EU-Cloud und lokalem Open-Source-Betrieb."
      }
    ],
    howToName: "Offene MCP-Alternative zu ChatGPT Instant Checkout einrichten",
    howToDescription:
      "Verbinde ShopCart MCP per OAuth 2.1 mit ChatGPT oder Claude und erstelle geprüfte Browser-Warenkörbe ohne Zahlungs-Lock-in.",
    howToSteps: [
      {
        name: "ShopCart MCP als Custom Connector hinzufügen",
        text: "Trage https://shopcart.wals.pro/mcp in ChatGPT oder Claude ein und bestätige die 2-Klick-OAuth-2.1-Anmeldung (oder nutze lokal npx -y shopcart-mcp)."
      },
      {
        name: "Shop, Produkte, Größen und Budget nennen",
        text: "Formuliere im Chat, welche Artikel, Varianten und Mengen in einem öffentlichen Online-Shop (Shopify, WooCommerce, BigCommerce, Shopware 6 oder Magento 2) oder als Amazon-Warenkorb-Link zusammengestellt werden sollen."
      },
      {
        name: "Warenkorb-Link im Browser prüfen und bezahlen",
        text: "Öffne den fertigen Warenkorb-Link direkt beim Händler, prüfe Versandkosten und Endpreis und schließe die Bestellung selbst ab."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser Leitfaden stützt sich auf folgende geprüfte Quellen (Abrufdatum 26.11.2026):",
    sources: SOURCES_DE,
    limitationsLabel: "Grenzen:",
    limitationsText:
      "ShopCart MCP führt bewusst keinen automatischen In-Chat-Kauf aus und speichert keine Zugangsdaten." + " " + getPlatformLimits("de"),
    faqHeading: "Häufige Fragen zur offenen ChatGPT-Instant-Checkout-Alternative",
    faqs: [
      {
        question: "Nutzt ChatGPT 2026 wirklich MCP für Warenkörbe?",
        answer:
          "Ja. ChatGPT unterstützt Custom Remote MCP Connectors mit OAuth 2.1. Nach dem Hinzufügen von https://shopcart.wals.pro/mcp kann ChatGPT direkt Kataloge prüfen und fertige Warenkorb-Links für deinen Browser erstellen."
      },
      {
        question: "Warum ist ein Read-Only-Warenkorb-Link sicherer als In-Chat-Checkout?",
        answer:
          "Weil Kreditkarten, Lieferadressen und Shop-Logins niemals im KI-Chat oder auf einem Dritt-Server landen. Du siehst alle Positionen, Versandkosten und Widerrufsbedingungen direkt auf der Website des Händlers."
      },
      {
        question: "Funktioniert ShopCart MCP in Deutschland, Österreich und der Schweiz?",
        answer:
          "Ja. Der Dienst läuft auf EU-Infrastruktur (Google Cloud europe-west1), unterstützt Euro und Schweizer Franken ebenso wie USD und GBP und ist nicht auf US-Pilotprogramme beschränkt."
      },
      {
        question: "Kann ich denselben Connector auch in Claude oder Cursor nutzen?",
        answer:
          "Ja. Da ShopCart MCP auf dem offenen Model Context Protocol basiert, funktioniert derselbe Server in ChatGPT, Claude.ai, Claude Desktop, Claude Code, Perplexity und Cursor."
      },
      {
        question: "Was kostet ShopCart MCP als Alternative?",
        answer:
          "Der gehostete Free-Tarif bietet dauerhaft 20 Abfragen pro Tag kostenlos. Im Pro-Tarif stehen 500 Abfragen pro Tag für 9 €/Monat bereit. Lokal über npx -y shopcart-mcp (MIT-Lizenz) ist die Nutzung unbegrenzt gratis."
      }
    ],
    hreflang: {
      de: "/guides/chatgpt-instant-checkout-alternative",
      en: "/en/guides/chatgpt-instant-checkout-alternative",
      xDefault: "/en/guides/chatgpt-instant-checkout-alternative"
    },
    publishedDate: UPDATED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "chatgpt instant checkout alternative",
      "offener ki warenkorb",
      "chatgpt mcp warenkorb",
      "read-only shopping mcp",
      "shopcart mcp"
    ]
  },
  {
    path: "/en/guides/chatgpt-amazon-shopping-cart",
    lang: "en",
    category: "Amazon & Multi-Store Reality",
    title: "Can ChatGPT Create an Amazon Shopping Cart? (2026 Reality & MCP)",
    metaTitle: "Can ChatGPT Create an Amazon Shopping Cart? (2026 Guide)",
    metaDescription:
      "Amazon blocks checkout bots, yet official multi-item cart permalinks (/gp/aws/cart/add.html) work via ShopCart MCP alongside live Shopify/Woo search.",
    cardSummary:
      "Honest breakdown: Amazon restricts automated third-party checkout bots, how official Amazon multi-item cart permalinks work across 10 marketplaces, and where full live catalog search shines.",
    tldrLabel: "Direct Answer:",
    tldrText:
      "Amazon restricts automated third-party checkout bots and blocks unauthenticated catalog scraping, so ChatGPT cannot auto-checkout on Amazon. However, ShopCart MCP supports official Amazon multi-item cart permalinks (/gp/aws/cart/add.html) across 10 marketplaces — paired with AI web search or optional Keepa/PA-API keys — alongside full live catalog, stock, and price search on public Shopify and WooCommerce stores.",
    intro:
      "Search for \"ChatGPT Amazon shopping cart\" and you will see conflicting claims: some articles say it is completely impossible, while others promise fragile browser bots that quickly break or violate marketplace rules. Here is the honest technical reality in 2026 — and exactly what works reliably with ShopCart MCP.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Amazon blocks third-party checkout bots — by design.",
        text: "No external AI assistant can log into your Amazon account or place orders automatically. Any legitimate workflow hands off to your own browser."
      },
      {
        lead: "Official Amazon multi-item cart permalinks work across 10 marketplaces.",
        text: "ShopCart MCP builds clean /gp/aws/cart/add.html links (ASIN.1 + Quantity.1, up to 20 items) for DE, AT (via DE), US, UK, FR, IT, ES, NL, CA, and JP."
      },
      {
        lead: "Clear factual distinction: Amazon links vs. full live storefront search.",
        text: "On Amazon, ASINs come from AI web search, pasted URLs, or optional Keepa/PA-API 5.0 keys. On public Shopify and WooCommerce stores, ShopCart MCP searches live catalogs, variants, stock, and prices with zero API keys."
      },
      {
        lead: "Strictly read-only on every platform.",
        text: "Whether you open an Amazon cart confirmation page or a Shopify/WooCommerce cart, you always review prices, shipping, and payment yourself."
      }
    ],
    primaryAssistant: "chatgpt",
    starterPrompt:
      "Use ShopCart MCP (https://shopcart.wals.pro/mcp). Help me compare two options: (1) build an official Amazon.de multi-item cart permalink (/gp/aws/cart/add.html) for the ASINs I share or find via web search, or (2) search a public Shopify or WooCommerce brand directly with live stock and price verification.",
    ctaHeading: "Build Verified Cart Links in ChatGPT or Claude",
    ctaSubtext:
      "Works for official Amazon multi-item cart permalinks across 10 marketplaces plus full live catalog search on public Shopify and WooCommerce stores.",
    sections: [
      {
        heading: "Why Amazon blocks automated third-party AI checkout bots",
        paragraphs: [
          "Amazon actively restricts automated third-party shopping agents from scraping storefront pages, logging into customer sessions, or executing checkout flows on a user's behalf. Unlike open D2C storefronts, Amazon does not expose an unauthenticated public JSON catalog API for live search.",
          "That is why browser-clicking bots frequently hit CAPTCHAs or session blocks — and why handing your Amazon login to a third-party automation tool is a bad security trade-off. A sustainable AI cart workflow must use only official, read-only mechanisms."
        ],
        takeaway:
          "Takeaway: Automated Amazon checkout bots are blocked by design; safe AI workflows rely on official cart handoff URLs instead of account automation."
      },
      {
        heading: "How official Amazon multi-item cart permalinks work in ShopCart MCP",
        paragraphs: [
          "Amazon provides an official documented cart-add URL format — /gp/aws/cart/add.html — that accepts multiple ASINs and quantities (ASIN.1, Quantity.1, ASIN.2, Quantity.2, and so on). When you click the link, Amazon opens its own confirmation page in your browser so you decide whether to add the items to your cart.",
          "ShopCart MCP supports this official permalink flow across 10 Amazon marketplaces: amazon.de, amazon.at (routed via amazon.de), amazon.com, amazon.co.uk, amazon.fr, amazon.it, amazon.es, amazon.nl, amazon.ca, and amazon.co.jp. You can supply ASINs via pasted Amazon product links or AI web search — or configure optional Keepa or Amazon PA-API 5.0 credentials when running locally or self-hosted for structured product and price lookups."
        ],
        takeaway:
          "Takeaway: ShopCart MCP turns validated ASINs and quantities into a single official Amazon confirmation link across 10 marketplaces — zero scraping, zero account login."
      },
      {
        heading: "Amazon cart permalinks vs. live Shopify & WooCommerce search",
        paragraphs: [
          "It is important to keep the technical capabilities of each platform crystal clear so you pick the right workflow for every purchase."
        ],
        table: {
          id: "amazon-reality-en-table",
          caption: "Factual comparison: Amazon official cart permalinks, public Shopify & WooCommerce stores, and blocked checkout bots",
          headers: [
            "Capability",
            "Amazon via ShopCart MCP",
            "Public Shopify & WooCommerce via ShopCart MCP",
            "Third-Party Checkout Bots"
          ],
          rows: [
            [
              "Live unauthenticated catalog & stock search",
              "Not exposed by Amazon; pair with AI web search or optional Keepa / PA-API 5.0",
              "Full live catalog, variant, stock & price search with zero API keys",
              "Fragile scraping; frequently blocked by anti-bot controls"
            ],
            [
              "Multi-item cart link",
              "Yes — official /gp/aws/cart/add.html across 10 marketplaces",
              "Shopify: yes, one verified /cart/<vid>:<qty> link. WooCommerce: one add-to-cart link per item",
              "Unreliable automated browser clicking"
            ],
            [
              "Variant & size verification",
              "Each Amazon size/color has its own 10-character ASIN",
              "Live variant ID & availability check per size/color before linking",
              "Prone to wrong selections or stale DOM"
            ],
            [
              "Account & payment safety",
              "Strictly read-only — Amazon shows an official add-to-cart confirmation in your browser",
              "Strictly read-only — review & pay directly on the store's site",
              "High risk if account credentials or cards are exposed"
            ]
          ]
        },
        takeaway:
          "Takeaway: Use ShopCart MCP for full live search + stock checks on independent Shopify and WooCommerce brands, and official /gp/aws/cart/add.html multi-item links on Amazon."
      },
      {
        heading: "Step-by-step: building an Amazon multi-item cart link safely",
        paragraphs: [
          "Here is the cleanest workflow when you want ChatGPT or Claude to bundle several Amazon items into one clickable link."
        ],
        orderedSteps: [
          {
            lead: "Pick your Amazon marketplace:",
            text: "Specify your local domain (for example amazon.de, amazon.com, or amazon.co.uk) so currency and shipping eligibility match."
          },
          {
            lead: "Gather exact 10-character ASINs:",
            text: "Share Amazon product URLs directly, let your AI find ASINs via web search, or attach optional Keepa / Amazon PA-API 5.0 keys for structured lookup."
          },
          {
            lead: "Generate the official multi-item permalink:",
            text: "ShopCart MCP validates the ASIN format and builds one clean /gp/aws/cart/add.html link with all quantities."
          },
          {
            lead: "Confirm in your own Amazon browser session:",
            text: "Open the link, verify live Amazon prices, seller info, and Prime delivery on Amazon's confirmation screen, and click Add to Cart yourself."
          }
        ],
        takeaway:
          "Takeaway: You get multi-item convenience on Amazon without ever sharing credentials or relying on brittle scrapers."
      }
    ],
    howToName: "How to build a multi-item Amazon cart link or shop public stores with ChatGPT",
    howToDescription:
      "Use ShopCart MCP in ChatGPT or Claude to generate official Amazon /gp/aws/cart/add.html cart permalinks or run full live catalog searches on Shopify and WooCommerce stores.",
    howToSteps: [
      {
        name: "Connect ShopCart MCP in ChatGPT or Claude",
        text: "Add https://shopcart.wals.pro/mcp as a custom MCP connector via OAuth 2.1 (or run npx -y shopcart-mcp locally)."
      },
      {
        name: "Provide Amazon URLs/ASINs — or name a Shopify/WooCommerce store",
        text: "For Amazon, share product links or let your AI search ASINs (or configure optional Keepa/PA-API 5.0 keys). For Shopify and WooCommerce stores, ask directly for products, sizes, and budgets."
      },
      {
        name: "Open the official cart link in your browser",
        text: "Review live pricing, delivery dates, and final totals directly on Amazon or the independent store's website before checking out yourself."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro: "This guide is based on the following verified technical sources (retrieved 2026-11-26):",
    sources: AMAZON_SOURCES_EN,
    limitationsLabel: "Limitations & Trademark Notice:",
    limitationsText:
      "Without optional Keepa or Amazon PA-API 5.0 credentials, ShopCart MCP does not scrape Amazon's live catalog or prices — always verify final prices and sellers on Amazon's confirmation page." + " " + getPlatformLimits("en"),
    faqHeading: "Frequently Asked Questions",
    faqs: [
      {
        question: "Does ChatGPT have a native Amazon shopping cart integration?",
        answer:
          "No. Amazon restricts automated third-party checkout agents from placing orders or scraping live storefront sessions. To bundle multiple Amazon products from ChatGPT safely, use an official /gp/aws/cart/add.html cart permalink via ShopCart MCP."
      },
      {
        question: "How do official Amazon multi-item cart permalinks (/gp/aws/cart/add.html) work?",
        answer:
          "Amazon's documented /gp/aws/cart/add.html endpoint accepts numbered ASIN and Quantity parameters (such as ASIN.1 and Quantity.1). Opening the link takes you to an official Amazon confirmation screen in your browser where you approve adding the items to your cart."
      },
      {
        question: "Which Amazon marketplaces does ShopCart MCP support?",
        answer:
          "ShopCart MCP supports 10 Amazon marketplaces: amazon.de (Germany), amazon.at (Austria via amazon.de), amazon.com (US), amazon.co.uk (UK), amazon.fr (France), amazon.it (Italy), amazon.es (Spain), amazon.nl (Netherlands), amazon.ca (Canada), and amazon.co.jp (Japan)."
      },
      {
        question: "Do I need Keepa or Amazon PA-API 5.0 keys to build an Amazon cart link?",
        answer:
          "No. Building official multi-item Amazon cart permalinks works without any API keys once ASINs are provided from pasted URLs or AI web search. Optional Keepa or PA-API 5.0 keys add structured catalog and price lookup for self-hosted or local deployments."
      },
      {
        question: "How is shopping on public Shopify and WooCommerce stores different?",
        answer:
          "Public Shopify and WooCommerce storefronts expose structured product and Store API endpoints directly. ShopCart MCP can search their catalogs live, filter by budget and availability, inspect exact sizes/colors, and verify stock before building the cart link — with zero API keys required. The same live search works on BigCommerce, Shopware 6, and Magento 2 stores. Shopify gets one link for the whole cart, WooCommerce and BigCommerce one add-to-cart link per item, Shopware 6 and Magento 2 verified product links."
      },
      {
        question: "Does ShopCart MCP log into my Amazon account or place orders?",
        answer:
          "Never. ShopCart MCP is strictly read-only across every platform. It never sees your Amazon password, Prime account, shipping address, or payment cards."
      }
    ],
    hreflang: {
      en: "/en/guides/chatgpt-amazon-shopping-cart",
      de: "/guides/chatgpt-amazon-warenkorb",
      xDefault: "/en/guides/chatgpt-amazon-shopping-cart"
    },
    publishedDate: UPDATED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "chatgpt amazon shopping cart",
      "amazon cart permalink mcp",
      "chatgpt shopping amazon",
      "amazon multi item cart link",
      "shopcart mcp"
    ]
  },
  {
    path: "/guides/chatgpt-amazon-warenkorb",
    lang: "de",
    category: "Amazon & Multi-Shop Realität",
    title: "Kann ChatGPT einen Amazon-Warenkorb erstellen? (2026 Realität & MCP)",
    metaTitle: "Kann ChatGPT einen Amazon-Warenkorb erstellen? (2026)",
    metaDescription:
      "Amazon sperrt Checkout-Bots — offizielle Multi-Artikel-Warenkorb-Links (/gp/aws/cart/add.html) klappen per ShopCart MCP plus Live-Suche bei Shopify & Woo.",
    cardSummary:
      "Ehrlicher Überblick: Warum Amazon Checkout-Bots sperrt, wie offizielle Amazon-Multi-Artikel-Warenkorb-Links über 10 Marktplätze funktionieren und wo volle Live-Suche glänzt.",
    tldrLabel: "Kurzantwort:",
    tldrText:
      "Amazon schränkt automatisierte Drittanbieter-Checkout-Bots ein und blockiert unauthentifiziertes Katalog-Scraping, sodass ChatGPT bei Amazon nicht selbst bestellen kann. Über ShopCart MCP funktionieren jedoch offizielle Amazon-Multi-Artikel-Warenkorb-Links (/gp/aws/cart/add.html) für 10 Marktplätze — kombiniert mit KI-Websuche oder optional Keepa/PA-API — neben voller Live-Katalog-, Bestands- und Preissuche in öffentlichen Shopify- und WooCommerce-Shops.",
    intro:
      "Wer fragt, ob ChatGPT einen Amazon-Warenkorb erstellen kann, stößt online auf widersprüchliche Antworten: Von „geht gar nicht“ bis hin zu fragilen Browser-Bots ist alles dabei. Hier bekommst du die ehrliche technische Einordnung für 2026 — und siehst genau, was mit ShopCart MCP zuverlässig funktioniert und wo die Unterschiede zu Shopify und WooCommerce liegen.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Amazon blockiert automatische Drittanbieter-Checkout-Bots.",
        text: "Keine externe KI kann sich sicher in dein Amazon-Konto einloggen oder Bestellungen auslösen — seriöse Tools übergeben immer an deinen eigenen Browser."
      },
      {
        lead: "Offizielle Amazon-Warenkorb-Links für 10 Marktplätze.",
        text: "ShopCart MCP erzeugt dokumentierte /gp/aws/cart/add.html-Links (ASIN.1 + Quantity.1, mehrere Artikel auf einmal) für DE, AT (via DE), US, UK, FR, IT, ES, NL, CA und JP."
      },
      {
        lead: "Klare Trennung der Fähigkeiten je Plattform.",
        text: "Bei Amazon kommen ASINs aus deiner URL, KI-Websuche oder optionalen Keepa-/PA-API-5.0-Schlüsseln. In öffentlichen Shopify- und WooCommerce-Shops durchsucht ShopCart MCP Kataloge, Varianten, Bestand und Preise komplett live ohne API-Key."
      },
      {
        lead: "Überall strikt read-only.",
        text: "Du bestätigst den Warenkorb immer direkt auf Amazon oder im jeweiligen Online-Shop und bezahlst selbst."
      }
    ],
    primaryAssistant: "chatgpt",
    starterPrompt:
      "Nutze ShopCart MCP (https://shopcart.wals.pro/mcp). Hilf mir bei zwei Wegen: (1) Erstelle einen offiziellen Amazon.de-Multi-Artikel-Warenkorb-Link (/gp/aws/cart/add.html) aus meinen ASINs oder per Websuche gefundenen Artikeln, oder (2) durchsuche einen öffentlichen Shopify- oder WooCommerce-Shop live nach lieferbaren Varianten und Preisen.",
    ctaHeading: "Geprüfte Warenkorb-Links in ChatGPT oder Claude bauen",
    ctaSubtext:
      "Offizielle Amazon-Multi-Artikel-Warenkorb-Links für 10 Marktplätze sowie vollständige Live-Katalogsuche in öffentlichen Shopify- und WooCommerce-Shops.",
    sections: [
      {
        heading: "Warum Amazon automatisierte KI-Checkout-Bots einschränkt",
        paragraphs: [
          "Amazon unterbindet gezielt, dass externe KI-Agenten Produktseiten automatisiert auslesen, sich in Kundenkonten anmelden oder Käufe per Bot abschließen. Anders als viele unabhängige Online-Shops stellt Amazon keine offene, unauthentifizierte JSON-Katalog-API für beliebige Live-Suchen bereit.",
          "Fragile Browser-Bots laufen daher rasch in CAPTCHAs oder Sitzungs-Sperren — und Zugangsdaten für ein Amazon-Konto an Dritt-Skripte zu übergeben wäre sicherheitstechnisch fahrlässig. Ein sauberer Workflow setzt stattdessen auf offizielle, rein lesende Übergabe-Links."
        ],
        takeaway:
          "Fazit: Automatisierte Checkout-Bots werden von Amazon geblockt; verlässlich und sicher sind nur offizielle Warenkorb-Permalinks für deinen eigenen Browser."
      },
      {
        heading: "So funktionieren offizielle Amazon-Multi-Artikel-Links mit ShopCart MCP",
        paragraphs: [
          "Amazon bietet einen offiziell dokumentierten Endpunkt (/gp/aws/cart/add.html), über den sich mehrere Artikel per ASIN und Menge (ASIN.1, Quantity.1, ASIN.2, Quantity.2 usw.) in einem einzigen Link übergeben lassen. Beim Klick öffnet Amazon direkt in deinem Browser eine offizielle Bestätigungsseite, auf der du die Artikel mit einem Klick in deinen Warenkorb übernimmst.",
          "ShopCart MCP unterstützt diesen offiziellen Multi-Artikel-Warenkorb-Link über 10 Amazon-Marktplätze: amazon.de, amazon.at (über amazon.de), amazon.com, amazon.co.uk, amazon.fr, amazon.it, amazon.es, amazon.nl, amazon.ca und amazon.co.jp. Die ASINs kommen aus deinen geteilten Produkt-URLs, der KI-Websuche oder — bei lokalem/eigenem Betrieb — optional aus der Keepa-API bzw. Amazon PA-API 5.0."
        ],
        takeaway:
          "Fazit: Mit ShopCart MCP bündelst du mehrere Amazon-Artikel über 10 Marktplätze in einem offiziellen Bestätigungs-Link — ohne Scraping und ohne Konto-Login."
      },
      {
        heading: "Fakten-Vergleich: Amazon-Links vs. volle Live-Suche bei Shopify & WooCommerce",
        paragraphs: [
          "Für volle Transparenz trennen wir sauber zwischen den offiziellen Amazon-Warenkorb-Links und der direkten Live-Katalogsuche bei öffentlichen Shopify- und WooCommerce-Shops."
        ],
        table: {
          id: "amazon-reality-de-table",
          caption: "Fakten-Vergleich: Amazon per ShopCart MCP gegenüber öffentlichen Shopify- & WooCommerce-Shops und Checkout-Bots",
          headers: [
            "Funktion",
            "Amazon via ShopCart MCP",
            "Öffentliche Shopify- & WooCommerce-Shops",
            "Drittanbieter-Checkout-Bots"
          ],
          rows: [
            [
              "Live-Katalog- & Bestandssuche ohne API-Key",
              "Nicht offen von Amazon bereitgestellt; Kombination mit KI-Websuche oder optional Keepa / PA-API 5.0",
              "Vollständige Live-Katalog-, Varianten-, Bestands- & Preissuche ohne API-Key",
              "Fehleranfälliges Scraping, oft blockiert"
            ],
            [
              "Multi-Artikel-Warenkorb-Link",
              "Ja — offizielles /gp/aws/cart/add.html über 10 Marktplätze",
              "Shopify: ja, ein geprüfter /cart/<vid>:<qty>-Link. WooCommerce: ein In-den-Warenkorb-Link pro Artikel",
              "Instabile Browser-Klicks"
            ],
            [
              "Größen- & Variantenprüfung",
              "Jede Größe/Farbe hat bei Amazon eine eigene 10-stellige ASIN",
              "Live-Prüfung je Varianten-ID und Lieferstatus vor dem Link",
              "Hohe Fehlerquote bei dynamischen Seiten"
            ],
            [
              "Konto- & Zahlungssicherheit",
              "Strikt read-only — offizielle Bestätigung im eigenen Amazon-Browser",
              "Strikt read-only — Prüfung & Zahlung direkt beim Händler",
              "Sicherheitsrisiko bei Login-Weitergabe"
            ]
          ]
        },
        takeaway:
          "Fazit: Bei öffentlichen Shopify- und WooCommerce-Marken bekommst du volle Live-Katalog- und Bestandsprüfung; bei Amazon nutzt du sichere offizielle Multi-Artikel-Permalinks."
      },
      {
        heading: "Schritt für Schritt: Amazon-Warenkorb-Link sauber erstellen",
        paragraphs: [
          "So gehst du vor, wenn ChatGPT oder Claude mehrere Amazon-Artikel für dich in einem Link zusammenfassen sollen."
        ],
        orderedSteps: [
          {
            lead: "Marktplatz festlegen:",
            text: "Nenne deiner KI den passenden Marktplatz (z. B. amazon.de oder amazon.at via amazon.de), damit Währung und Lieferung passen."
          },
          {
            lead: "Exakte 10-stellige ASINs sammeln:",
            text: "Füge Amazon-Produktlinks direkt in den Chat ein, nutze die KI-Websuche oder hinterlege im lokalen Betrieb optional Keepa- oder PA-API-5.0-Zugangsdaten."
          },
          {
            lead: "Offiziellen Multi-Artikel-Link erzeugen:",
            text: "ShopCart MCP validiert das ASIN-Format und erzeugt einen sauberen /gp/aws/cart/add.html-Link inklusive gewünschter Stückzahlen."
          },
          {
            lead: "Im eigenen Browser prüfen & übernehmen:",
            text: "Öffne den Link, kontrolliere aktuelle Amazon-Preise, Verkäufer und Liefertermin auf der Amazon-Bestätigungsseite und übernimm die Artikel selbst in deinen Warenkorb."
          }
        ],
        takeaway:
          "Fazit: Saubere Multi-Artikel-Übergabe bei Amazon — ohne Passwortweitergabe und ohne brüchige Scraper."
      }
    ],
    howToName: "Amazon-Multi-Artikel-Warenkorb-Link oder Live-Shop-Warenkorb mit ChatGPT bauen",
    howToDescription:
      "Nutze ShopCart MCP in ChatGPT oder Claude für offizielle Amazon-/gp/aws/cart/add.html-Warenkorb-Links oder für volle Live-Katalogsuche in öffentlichen Shopify- und WooCommerce-Shops.",
    howToSteps: [
      {
        name: "ShopCart MCP in ChatGPT oder Claude verbinden",
        text: "Füge https://shopcart.wals.pro/mcp als Custom Connector per OAuth 2.1 hinzu oder starte lokal npx -y shopcart-mcp."
      },
      {
        name: "Amazon-Links/ASINs teilen oder Shopify-/WooCommerce-Shop nennen",
        text: "Für Amazon teilst du Produkt-URLs oder nutzt KI-Websuche (optional Keepa/PA-API 5.0). Für Shopify- und WooCommerce-Shops fragst du direkt nach Produkten, Größen und Budget."
      },
      {
        name: "Offiziellen Warenkorb-Link im Browser prüfen",
        text: "Öffne den Link direkt auf Amazon oder im jeweiligen Online-Shop, kontrolliere Live-Preis und Versand und bezahle selbst."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser Ratgeber basiert auf folgenden geprüften Quellen (Abrufdatum 26.11.2026):",
    sources: AMAZON_SOURCES_DE,
    limitationsLabel: "Grenzen & Markenhinweis:",
    limitationsText:
      "Ohne optionale Keepa- oder Amazon-PA-API-5.0-Zugangsdaten liest ShopCart MCP keinen Amazon-Live-Katalog aus — prüfe Endpreis und Verkäufer immer auf der offiziellen Amazon-Bestätigungsseite." + " " + getPlatformLimits("de"),
    faqHeading: "Häufige Fragen zu ChatGPT & Amazon-Warenkörben",
    faqs: [
      {
        question: "Hat ChatGPT eine direkte Amazon-Warenkorb-Integration?",
        answer:
          "Nein. Amazon sperrt automatisierte Drittanbieter-Checkout-Agenten. Mit ShopCart MCP kannst du jedoch offizielle /gp/aws/cart/add.html-Multi-Artikel-Links erzeugen, die Amazon direkt in deinem Browser zur Bestätigung öffnet."
      },
      {
        question: "Wie funktioniert der offizielle Amazon-Link /gp/aws/cart/add.html?",
        answer:
          "Der dokumentierte Endpunkt nimmt nummerierte ASIN- und Quantity-Parameter entgegen (z. B. ASIN.1 und Quantity.1). Beim Öffnen zeigt dir Amazon eine offizielle Übersichtsseite, auf der du alle Artikel gemeinsam in deinen Warenkorb legen kannst."
      },
      {
        question: "Welche Amazon-Marktplätze unterstützt ShopCart MCP?",
        answer:
          "Unterstützt werden 10 Marktplätze: amazon.de (Deutschland), amazon.at (Österreich über amazon.de), amazon.com (USA), amazon.co.uk (UK), amazon.fr (Frankreich), amazon.it (Italien), amazon.es (Spanien), amazon.nl (Niederlande), amazon.ca (Kanada) und amazon.co.jp (Japan)."
      },
      {
        question: "Brauche ich Keepa oder die Amazon PA-API 5.0 für den Warenkorb-Link?",
        answer:
          "Nein. Für das Bauen offizieller Multi-Artikel-Warenkorb-Links sind keine API-Schlüssel erforderlich, sobald ASINs aus Produkt-URLs oder der KI-Websuche vorliegen. Keepa oder PA-API 5.0 sind rein optionale Erweiterungen für strukturierte Abfragen."
      },
      {
        question: "Was ist bei öffentlichen Shopify- und WooCommerce-Shops anders?",
        answer:
          "Öffentliche Shopify- und WooCommerce-Shops stellen strukturierte Storefront- und Store-API-Daten direkt bereit. Dort sucht ShopCart MCP ohne API-Key live nach Produkten, Größen, Lagerbestand und Preisen und prüft den Warenkorb vorab. Dieselbe Live-Suche funktioniert in BigCommerce-, Shopware-6- und Magento-2-Shops. Shopify bekommt einen Link für den ganzen Warenkorb, WooCommerce und BigCommerce einen In-den-Warenkorb-Link pro Artikel, Shopware 6 und Magento 2 geprüfte Produktlinks."
      },
      {
        question: "Loggt sich ShopCart MCP in mein Amazon-Konto ein?",
        answer:
          "Niemals. ShopCart MCP arbeitet plattformübergreifend strikt read-only und sieht weder Passwörter noch Prime-Daten, Lieferadressen oder Zahlungsmittel."
      }
    ],
    hreflang: {
      de: "/guides/chatgpt-amazon-warenkorb",
      en: "/en/guides/chatgpt-amazon-shopping-cart",
      xDefault: "/en/guides/chatgpt-amazon-shopping-cart"
    },
    publishedDate: UPDATED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "chatgpt amazon warenkorb",
      "amazon warenkorb link mcp",
      "chatgpt amazon einkaufen",
      "amazon multi artikel link",
      "shopcart mcp"
    ]
  },
  {
    path: "/en/guides/shopify-mcp-server-comparison",
    lang: "en",
    category: "Technical MCP Comparison",
    title: "Shopify MCP Server Guide (2026): Dev MCP vs. Storefront UCP vs. ShopCart MCP",
    metaTitle: "Shopify MCP Server Guide (2026): Dev vs. UCP vs. ShopCart",
    metaDescription:
      "Compare Shopify Dev MCP, Storefront MCP / UCP (/api/ucp/mcp), and ShopCart MCP: roles, auth, self-hosting, ChatGPT & Claude setup in one table.",
    cardSummary:
      "Clear technical breakdown of the three Shopify MCP server categories in 2026 — Dev MCP, Storefront MCP / UCP, and ShopCart MCP — answering every setup and hosting question.",
    tldrLabel: "Direct Answer:",
    tldrText:
      "In 2026, \"Shopify MCP server\" refers to three distinct categories: Shopify's @shopify/dev-mcp for coding and API docs, Shopify's per-store Storefront MCP / Universal Commerce Protocol (UCP at /api/ucp/mcp) for merchants, and ShopCart MCP for shoppers and cross-store AI agents. ShopCart MCP works immediately on any public Shopify, WooCommerce, BigCommerce, Shopware 6, or Magento 2 store with zero merchant setup — read-only, SSRF-hardened, and MIT open source.",
    intro:
      "Developers and AI builders searching for a Shopify MCP server in 2026 often mix up developer documentation tools, merchant-configured Storefront/UCP endpoints, admin API wrappers, and cross-store shopper connectors. This technical guide compares each option side by side and answers how to run or self-host an MCP server cleanly.",
    takeawaysHeading: "Key Takeaways",
    takeaways: [
      {
        lead: "Three roles, three different MCP servers.",
        text: "Use @shopify/dev-mcp to write Shopify code, Shopify Storefront MCP / UCP to expose your own merchant storefront, and ShopCart MCP to search and build carts across any public store."
      },
      {
        lead: "Zero merchant setup for cross-store shopping.",
        text: "ShopCart MCP works out of the box on public Shopify, WooCommerce, BigCommerce, Shopware 6, and Magento 2 stores (plus official Amazon cart permalinks) without asking merchants to install an app."
      },
      {
        lead: "Run locally via stdio or hosted via OAuth 2.1.",
        text: "Start locally in Claude Code, Cursor, or Claude Desktop with npx -y shopcart-mcp, or connect https://shopcart.wals.pro/mcp in ChatGPT and Claude.ai."
      },
      {
        lead: "Self-hostable under MIT with built-in security hardening.",
        text: "ShopCart MCP ships with readOnlyHint annotations, DNS-pinned SSRF protection, and prompt-injection sanitization for untrusted third-party catalog text."
      }
    ],
    primaryAssistant: "claude",
    starterPrompt:
      "Connect to ShopCart MCP (https://shopcart.wals.pro/mcp) and run a read-only technical check on snocks.com using inspect_store, search_products, get_product, and create_cart_link to show the exact structured tool flow.",
    ctaHeading: "Test ShopCart MCP in Claude or ChatGPT",
    ctaSubtext:
      "Try the hosted EU OAuth 2.1 endpoint immediately, or inspect the MIT source code and run npx -y shopcart-mcp locally.",
    sections: [
      {
        heading: "What is MCP in Shopify, and why are there multiple servers?",
        paragraphs: [
          "The Model Context Protocol (MCP) is an open standard that lets AI assistants call structured tools instead of scraping raw web pages. Within the Shopify ecosystem, multiple MCP servers emerged because developers, store owners, and end shoppers have completely different security boundaries and authentication models.",
          "In addition to coding tools (@shopify/dev-mcp) and merchant storefront endpoints (migrating from Storefront MCP to Shopify's Universal Commerce Protocol at https://{shop}/api/ucp/mcp), some merchant-side Admin API MCP apps exist for private order/inventory analytics. None of those merchant-scoped tools are designed to let an end shopper point ChatGPT or Claude at any public store on the web — which is the exact gap ShopCart MCP fills."
        ],
        takeaway:
          "Takeaway: Pick the MCP server that matches your trust boundary: coding docs, single-merchant storefront/admin access, or cross-store read-only shopping."
      },
      {
        heading: "4-Column Comparison: Shopify Dev MCP vs. Storefront UCP vs. ShopCart MCP",
        paragraphs: [
          "Use this 4-column matrix to choose the right Shopify MCP server for your stack in 2026."
        ],
        table: {
          id: "shopify-mcp-compare-en-table",
          caption: "4-column comparison of Shopify Dev MCP, Shopify Storefront MCP / UCP, and ShopCart MCP",
          headers: [
            "Dimension",
            "Shopify Dev MCP (@shopify/dev-mcp)",
            "Shopify Storefront MCP / UCP (/api/ucp/mcp)",
            "ShopCart MCP (wals.pro)"
          ],
          rows: [
            [
              "Primary user & goal",
              "Developers building Shopify apps, themes & GraphQL queries",
              "Merchants exposing their own store to AI channels & checkout",
              "Shoppers & cross-store AI agents searching public stores & building cart links"
            ],
            [
              "Store scope",
              "Shopify docs & schemas (no live shopper cart)",
              "Single merchant store configured by the store owner",
              "Public Shopify, WooCommerce, BigCommerce, Shopware 6 & Magento 2 stores + Amazon cart links + any product URL via Schema.org/JSON-LD"
            ],
            [
              "Merchant setup required",
              "None (developer local tool)",
              "Merchant channel / UCP configuration required",
              "Zero merchant setup required"
            ],
            [
              "Auth & permissions",
              "Local stdio / dev CLI",
              "Storefront / UCP channel policies & optional customer auth",
              "Hosted OAuth 2.1 (PKCE + CIMD/DCR) or keyless local stdio; strictly read-only"
            ],
            [
              "Clients supported",
              "Cursor, Claude Code, VS Code, Windsurf",
              "UCP-compatible agentic storefronts & custom clients",
              "ChatGPT, Claude (Web/Mobile/Desktop/Code), Perplexity, Cursor, Goose"
            ],
            [
              "Self-hosting & license",
              "Official Shopify npm package",
              "Hosted by Shopify on merchant domains",
              "MIT open source — run locally (npx -y shopcart-mcp) or self-host on Cloud Run / Node 22"
            ]
          ]
        },
        takeaway:
          "Takeaway: Shopify Dev MCP helps you code, Storefront UCP serves merchant-owned channels, and ShopCart MCP gives any AI assistant instant read-only shopping across public stores."
      },
      {
        heading: "How to run or self-host ShopCart MCP (Local stdio vs. Hosted OAuth 2.1)",
        paragraphs: [
          "ShopCart MCP supports three clean deployment modes using the same TypeScript codebase."
        ],
        orderedSteps: [
          {
            lead: "Hosted EU OAuth 2.1 endpoint (fastest for ChatGPT & Claude.ai):",
            text: "Add https://shopcart.wals.pro/mcp as a custom remote MCP connector. OAuth 2.1 metadata (RFC 9728 & RFC 8414) is discovered automatically."
          },
          {
            lead: "Local stdio CLI (Claude Desktop, Cursor, Goose, Raycast):",
            text: "Configure command \"npx\" with args [\"-y\", \"shopcart-mcp\"] — zero account, zero telemetry, unlimited local calls."
          },
          {
            lead: "Claude Code HTTP or self-hosted Node 22 container:",
            text: "Connect directly with claude mcp add --transport http shopcart https://shopcart.wals.pro/mcp, or fork the MIT repo on GitHub and deploy to your own Cloud Run or Docker host."
          }
        ],
        takeaway:
          "Takeaway: You can test via hosted OAuth 2.1 in 30 seconds or self-host the entire MIT codebase on your own infrastructure."
      },
      {
        heading: "Security architecture: SSRF pinning & prompt-injection defense",
        paragraphs: [
          "Because a cross-store MCP server fetches third-party storefront data requested by a user prompt, security cannot be an afterthought. ShopCart MCP enforces HTTPS-only DNS-pinned requests that block private IPv4/IPv6 ranges, localhost, cloud metadata IPs, and unsafe redirects.",
          "Every third-party product title and description is stripped of HTML, scripts, BiDi overrides, and invisible Unicode tag characters before returning to the model, paired with explicit untrusted-data notices so product descriptions cannot hijack your AI session."
        ],
        takeaway:
          "Takeaway: DNS-pinned SSRF guards, prompt-injection sanitization, and readOnlyHint annotations make cross-store MCP safe for daily use."
      }
    ],
    howToName: "How to connect or run a Shopify MCP server in Claude, ChatGPT, or Claude Code",
    howToDescription:
      "Connect the hosted ShopCart MCP server via OAuth 2.1 or run the MIT open-source CLI locally over stdio.",
    howToSteps: [
      {
        name: "Choose hosted OAuth 2.1 or local stdio",
        text: "Use https://shopcart.wals.pro/mcp for ChatGPT and Claude.ai web/mobile, or npx -y shopcart-mcp for local Claude Desktop, Cursor, and Claude Code."
      },
      {
        name: "Verify the connection with inspect_store",
        text: "Ask your AI to inspect any public storefront to confirm live currency, platform detection, and WAF status."
      },
      {
        name: "Search, verify variants, and generate a cart permalink",
        text: "Run search_products, get_product, and create_cart_link to get a verified browser cart URL without exposing credentials or payment cards."
      }
    ],
    sourcesHeading: "Sources and Limitations",
    sourcesIntro: "This technical comparison is grounded in official documentation (retrieved 2026-11-26):",
    sources: SHOPIFY_MCP_SOURCES_EN,
    limitationsLabel: "Limitations & Trademark Notice:",
    limitationsText:
      "ShopCart MCP is a read-only shopper MCP server and does not replace Shopify's official Admin API or merchant-side UCP checkout integrations when you need private order management, customer PII, or inventory writes." + " " + getTrademarkDisclaimer("en"),
    faqHeading: "Frequently Asked Questions (Technical PAA)",
    faqs: [
      {
        question: "Is there an MCP server for Shopify?",
        answer:
          "Yes — in 2026 there are three main options depending on your goal: Shopify's official @shopify/dev-mcp for developers writing Shopify code, Shopify's per-store Storefront MCP / UCP (/api/ucp/mcp) for merchants, and ShopCart MCP (https://shopcart.wals.pro/mcp) for end shoppers and cross-store AI agents."
      },
      {
        question: "What is MCP in Shopify?",
        answer:
          "In Shopify, MCP (Model Context Protocol) lets AI clients like Claude, ChatGPT, and Cursor call typed tools for documentation lookup (@shopify/dev-mcp), merchant storefront discovery (Storefront MCP / UCP), or cross-store live catalog search and cart-link creation (ShopCart MCP)."
      },
      {
        question: "Does ChatGPT use MCP?",
        answer:
          "Yes. ChatGPT supports custom remote MCP servers using Streamable HTTP and OAuth 2.1. Adding https://shopcart.wals.pro/mcp lets ChatGPT call ShopCart MCP's six read-only shopping tools directly."
      },
      {
        question: "How do I run an MCP server?",
        answer:
          "You have two easy options: connect a hosted Streamable HTTP MCP server such as https://shopcart.wals.pro/mcp via OAuth 2.1 in Claude or ChatGPT, or run a local stdio MCP server in Claude Desktop, Cursor, or Claude Code with npx -y shopcart-mcp."
      },
      {
        question: "Can I host my own MCP?",
        answer:
          "Yes. ShopCart MCP is MIT open source on GitHub (Wals-pro/shopcart-mcp). You can run it locally over stdio with Node 22 or self-host the Express Streamable HTTP + OAuth 2.1 server on Cloud Run, Fly.io, or your own container host."
      },
      {
        question: "How does ShopCart MCP work alongside Shopify UCP and WooCommerce?",
        answer:
          "ShopCart MCP uses a pluggable AdapterRegistry: it inspects public Shopify storefronts (even when a merchant has not enabled UCP), supports WooCommerce (Store API v1), BigCommerce, Shopware 6, and Magento 2 stores, builds official Amazon multi-item cart permalinks, and verifies any other product page via Schema.org/JSON-LD — all through the same six read-only MCP tools."
      }
    ],
    hreflang: {
      en: "/en/guides/shopify-mcp-server-comparison",
      de: "/guides/shopify-mcp-server-vergleich",
      xDefault: "/en/guides/shopify-mcp-server-comparison"
    },
    publishedDate: UPDATED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "shopify mcp server",
      "shopify dev mcp",
      "shopify storefront mcp ucp",
      "host own mcp server",
      "shopcart mcp"
    ]
  },
  {
    path: "/guides/shopify-mcp-server-vergleich",
    lang: "de",
    category: "Technischer MCP-Vergleich",
    title: "Shopify MCP Server Vergleich (2026): Dev MCP vs. Storefront UCP vs. ShopCart MCP",
    metaTitle: "Shopify MCP Server Vergleich (2026): Dev vs. UCP vs. ShopCart",
    metaDescription:
      "Shopify Dev MCP, Storefront MCP / UCP (/api/ucp/mcp) und ShopCart MCP im Vergleich: Rollen, OAuth, Self-Hosting, ChatGPT & Claude in einer Tabelle.",
    cardSummary:
      "Technischer 4-Spalten-Vergleich aller Shopify-MCP-Server 2026 — Dev MCP, Storefront MCP / UCP und ShopCart MCP — inklusive Self-Hosting, ChatGPT- und Claude-Setup.",
    tldrLabel: "Kurzantwort:",
    tldrText:
      "Im Jahr 2026 steht „Shopify MCP Server“ für drei unterschiedliche Werkzeuge: Shopifys @shopify/dev-mcp für Entwickler-Doku, Shopifys Storefront MCP / Universal Commerce Protocol (UCP unter /api/ucp/mcp) für einzelne Händler-Shops und ShopCart MCP für Käufer und shop-übergreifende KI-Agenten. ShopCart MCP läuft sofort in jedem öffentlichen Shop auf Shopify, WooCommerce, BigCommerce, Shopware 6 oder Magento 2 ohne Händler-Setup — read-only, SSRF-gehärtet und MIT Open Source.",
    intro:
      "Wer 2026 nach einem Shopify MCP Server sucht, stößt auf Entwickler-Tools, Händler-Endpunkte für Storefront/UCP, private Admin-API-Apps und Endkunden-Warenkorb-Server. Dieser technische Vergleich ordnet die Kategorien klar ein und zeigt, wie du einen MCP-Server lokal startest oder selbst hostest.",
    takeawaysHeading: "Das Wichtigste in Kürze",
    takeaways: [
      {
        lead: "Drei Aufgaben, drei verschiedene MCP-Server.",
        text: "@shopify/dev-mcp hilft beim Programmieren, Storefront MCP / UCP öffnet einen einzelnen Händler-Shop und ShopCart MCP baut shop-übergreifende Warenkörbe für Käufer."
      },
      {
        lead: "Null Händler-Einrichtung bei öffentlichen Shops.",
        text: "ShopCart MCP funktioniert sofort in öffentlichen Shops auf Shopify, WooCommerce, BigCommerce, Shopware 6 und Magento 2 (plus offizielle Amazon-Warenkorb-Links) ohne App-Installation beim Händler."
      },
      {
        lead: "Lokal per stdio oder gehostet per OAuth 2.1.",
        text: "Starte lokal in Claude Code, Cursor oder Claude Desktop mit npx -y shopcart-mcp oder verbinde https://shopcart.wals.pro/mcp in ChatGPT und Claude.ai."
      },
      {
        lead: "MIT Open Source, selbst hostbar und sicherheitsgehärtet.",
        text: "Inklusive readOnlyHint-Annotationen, DNS-gepinntem SSRF-Schutz und Prompt-Injection-Filter für fremde Produkttexte."
      }
    ],
    primaryAssistant: "claude",
    starterPrompt:
      "Verbinde dich mit ShopCart MCP (https://shopcart.wals.pro/mcp) und führe einen rein lesenden Technik-Test auf snocks.com über inspect_store, search_products, get_product und create_cart_link aus, um den strukturierten Tool-Ablauf zu zeigen.",
    ctaHeading: "ShopCart MCP direkt in Claude oder ChatGPT testen",
    ctaSubtext:
      "Teste den EU-gehosteten OAuth-2.1-Endpunkt sofort oder prüfe den MIT-Quellcode und starte npx -y shopcart-mcp lokal.",
    sections: [
      {
        heading: "Was ist MCP in Shopify — und warum gibt es mehrere Server?",
        paragraphs: [
          "Das Model Context Protocol (MCP) ist ein offener Standard, über den KI-Assistenten typisierte Werkzeuge statt brüchigem Web-Scraping nutzen. Im Shopify-Ökosystem entstanden mehrere MCP-Server, weil Entwickler, Shop-Betreiber und Endkunden völlig unterschiedliche Rechte und Sicherheitsgrenzen brauchen.",
          "Neben Entwickler-Werkzeugen (@shopify/dev-mcp), Händler-Storefront-Endpunkten (Migration von Storefront MCP auf das Universal Commerce Protocol unter https://{shop}/api/ucp/mcp) und internen Admin-API-MCP-Apps für Bestell-Analysen fehlte ein offener Endkunden-Server, der shop-übergreifend ohne Händler-Onboarding arbeitet — genau dafür wurde ShopCart MCP entwickelt."
        ],
        takeaway:
          "Fazit: Wähle den MCP-Server passend zur Sicherheitsgrenze — Code-Doku, eigener Händler-Kanal oder shop-übergreifendes Read-Only-Shopping."
      },
      {
        heading: "4-Spalten-Vergleich: Shopify Dev MCP vs. Storefront UCP vs. ShopCart MCP",
        paragraphs: [
          "Diese 4-Spalten-Tabelle stellt die drei wichtigsten Shopify-MCP-Server-Kategorien 2026 direkt gegenüber."
        ],
        table: {
          id: "shopify-mcp-compare-de-table",
          caption: "4-Spalten-Vergleich: Shopify Dev MCP, Shopify Storefront MCP / UCP und ShopCart MCP",
          headers: [
            "Kriterium",
            "Shopify Dev MCP (@shopify/dev-mcp)",
            "Shopify Storefront MCP / UCP (/api/ucp/mcp)",
            "ShopCart MCP (wals.pro)"
          ],
          rows: [
            [
              "Zielgruppe & Zweck",
              "Entwickler für Shopify-Apps, Themes & GraphQL-Schemas",
              "Händler, die ihren eigenen Shop für KI-Kanäle öffnen",
              "Käufer & shop-übergreifende KI-Agenten für Suche & Warenkorb-Links"
            ],
            [
              "Shop-Reichweite",
              "Shopify-Doku & API-Schemas (kein Käufer-Warenkorb)",
              "Ein einzelner konfigurierter Händler-Shop",
              "Öffentliche Shops auf Shopify, WooCommerce, BigCommerce, Shopware 6 & Magento 2 + Amazon-Cart-Links + jeder Produktlink per Schema.org/JSON-LD"
            ],
            [
              "Händler-Setup nötig?",
              "Nein (lokales Entwickler-Tool)",
              "Ja — Aktivierung & UCP-Kanal im Händler-Backend",
              "Kein Händler-Setup nötig"
            ],
            [
              "Auth & Rechte",
              "Lokales stdio / Dev-CLI",
              "Storefront-/UCP-Richtlinien & optional Kunden-Auth",
              "Hosted OAuth 2.1 (PKCE + CIMD/DCR) oder lokales stdio; strikt read-only"
            ],
            [
              "Unterstützte Clients",
              "Cursor, Claude Code, VS Code, Windsurf",
              "UCP-fähige Agentic-Storefront-Clients",
              "ChatGPT, Claude (Web/Mobile/Desktop/Code), Perplexity, Cursor, Goose"
            ],
            [
              "Self-Hosting & Lizenz",
              "Offizielles Shopify-npm-Paket",
              "Von Shopify auf Händler-Domains gehostet",
              "MIT Open Source — lokal (npx -y shopcart-mcp) oder Self-Hosting auf Cloud Run / Node 22"
            ]
          ]
        },
        takeaway:
          "Fazit: Dev MCP unterstützt beim Coden, Storefront UCP bedient eigene Händler-Kanäle und ShopCart MCP ermöglicht sofortiges Read-Only-Shopping über beliebige öffentliche Shops."
      },
      {
        heading: "MCP-Server starten oder selbst hosten: Lokal (stdio) vs. EU-Cloud (OAuth 2.1)",
        paragraphs: [
          "ShopCart MCP lässt sich mit derselben TypeScript-Codebasis in drei Varianten betreiben."
        ],
        orderedSteps: [
          {
            lead: "Gehosteter EU-OAuth-2.1-Endpunkt (ideal für ChatGPT & Claude.ai):",
            text: "Trage https://shopcart.wals.pro/mcp als Custom Remote MCP Connector ein; OAuth-2.1-Discovery (RFC 9728 & RFC 8414) erfolgt automatisch."
          },
          {
            lead: "Lokale stdio-CLI (Claude Desktop, Cursor, Goose, Raycast):",
            text: "Starte npx -y shopcart-mcp lokal — ohne Konto, ohne Telemetrie und ohne Tageslimit."
          },
          {
            lead: "Claude Code oder eigenes Self-Hosting (Node 22 / Docker):",
            text: "Nutze claude mcp add --transport http shopcart https://shopcart.wals.pro/mcp oder hoste das MIT-Repo auf deinem eigenen Cloud-Run- oder Docker-Server."
          }
        ],
        takeaway:
          "Fazit: In 30 Sekunden gehostet startklar — oder vollständig unter eigener Kontrolle selbst gehostet."
      },
      {
        heading: "Sicherheitsarchitektur: SSRF-Pinning & Schutz vor Prompt Injection",
        paragraphs: [
          "Ein shop-übergreifender MCP-Server ruft fremde Shop-Daten auf Basis von Nutzer-Prompts ab. ShopCart MCP nutzt deshalb strikte HTTPS-only-Verbindungen mit DNS-gepinntem SSRF-Schutz, der private IPv4-/IPv6-Netze, localhost, Cloud-Metadata-IPs und unsichere Weiterleitungen blockiert.",
          "Alle fremden Produkttitel und Beschreibungen werden vor der Rückgabe an das Modell von HTML, Skripten, BiDi-Steuerzeichen und unsichtbaren Unicode-Tag-Blöcken bereinigt und klar als nicht vertrauenswürdige Katalogdaten gekennzeichnet."
        ],
        takeaway:
          "Fazit: DNS-gepinnter SSRF-Schutz, Prompt-Injection-Bereinigung und strikte Read-Only-Annotationen sichern jede Shopping-Session ab."
      }
    ],
    howToName: "Shopify MCP Server in Claude, ChatGPT oder Claude Code starten",
    howToDescription:
      "Verbinde den gehosteten ShopCart-MCP-Server per OAuth 2.1 oder starte die MIT-Open-Source-CLI lokal über stdio.",
    howToSteps: [
      {
        name: "Hosted OAuth 2.1 oder lokales stdio wählen",
        text: "Nutze https://shopcart.wals.pro/mcp in ChatGPT und Claude.ai oder npx -y shopcart-mcp lokal in Claude Desktop, Cursor und Claude Code."
      },
      {
        name: "Verbindung mit inspect_store prüfen",
        text: "Lass deine KI einen beliebigen öffentlichen Shop prüfen, um Plattform, Währung und Firewall-Status auszulesen."
      },
      {
        name: "Suchen, Varianten prüfen und Warenkorb-Link erstellen",
        text: "Kombiniere search_products, get_product und create_cart_link für einen geprüften Browser-Warenkorb-Link ohne Zahlungs- oder Login-Weitergabe."
      }
    ],
    sourcesHeading: "Quellen und Grenzen",
    sourcesIntro: "Dieser technische Vergleich stützt sich auf offizielle Dokumentationen (Abrufdatum 26.11.2026):",
    sources: SHOPIFY_MCP_SOURCES_DE,
    limitationsLabel: "Grenzen & Markenhinweis:",
    limitationsText:
      "ShopCart MCP ist ein rein lesender Käufer-MCP-Server und ersetzt weder Shopifys offizielle Admin-API noch händlerseitige UCP-Checkout-Integrationen, wenn private Bestelldaten oder Schreibzugriffe benötigt werden." + " " + getTrademarkDisclaimer("de"),
    faqHeading: "Häufige technische Fragen zu Shopify MCP Servern",
    faqs: [
      {
        question: "Gibt es einen MCP-Server für Shopify?",
        answer:
          "Ja — 2026 gibt es je nach Einsatzzweck drei Hauptkategorien: Shopifys offizielles @shopify/dev-mcp für Entwickler, Shopifys Storefront MCP / UCP (/api/ucp/mcp) für einzelne Händler-Shops und ShopCart MCP (https://shopcart.wals.pro/mcp) für Käufer und shop-übergreifende KI-Agenten."
      },
      {
        question: "Was ist MCP in Shopify?",
        answer:
          "MCP (Model Context Protocol) ermöglicht es KI-Assistenten wie Claude, ChatGPT und Cursor, typisierte Werkzeuge aufzurufen — etwa für Shopify-Doku (@shopify/dev-mcp), Händler-Storefronts (Storefront MCP / UCP) oder shop-übergreifende Live-Suche und Warenkorb-Links (ShopCart MCP)."
      },
      {
        question: "Nutzt ChatGPT MCP?",
        answer:
          "Ja. ChatGPT unterstützt Custom Remote MCP Server über Streamable HTTP mit OAuth 2.1. Nach dem Hinzufügen von https://shopcart.wals.pro/mcp kann ChatGPT alle sechs Read-Only-Shopping-Tools von ShopCart MCP direkt nutzen."
      },
      {
        question: "Wie betreibe oder starte ich einen MCP-Server?",
        answer:
          "Am schnellsten verbindest du einen gehosteten Streamable-HTTP-Server wie https://shopcart.wals.pro/mcp per OAuth 2.1 in ChatGPT oder Claude. Lokal startest du die Open-Source-CLI in Claude Desktop, Cursor oder Claude Code mit npx -y shopcart-mcp."
      },
      {
        question: "Kann ich meinen eigenen MCP-Server selbst hosten?",
        answer:
          "Ja. ShopCart MCP steht unter MIT-Lizenz auf GitHub (Wals-pro/shopcart-mcp). Du kannst den Server lokal per stdio mit Node 22 ausführen oder den Express-Streamable-HTTP- und OAuth-2.1-Server selbst auf Cloud Run oder Docker hosten."
      },
      {
        question: "Wie passt ShopCart MCP mit Shopify UCP und WooCommerce zusammen?",
        answer:
          "Über eine modulare AdapterRegistry unterstützt ShopCart MCP öffentliche Shopify-Storefronts (auch ohne aktiviertes Händler-UCP), WooCommerce (Store API v1), BigCommerce, Shopware 6 und Magento 2, offizielle Amazon-Multi-Artikel-Warenkorb-Links sowie die Prüfung jeder anderen Produktseite per Schema.org/JSON-LD über dieselben sechs Read-Only-Tools."
      }
    ],
    hreflang: {
      de: "/guides/shopify-mcp-server-vergleich",
      en: "/en/guides/shopify-mcp-server-comparison",
      xDefault: "/en/guides/shopify-mcp-server-comparison"
    },
    publishedDate: UPDATED_ISO,
    modifiedDate: UPDATED_ISO,
    keywords: [
      "shopify mcp server vergleich",
      "shopify dev mcp",
      "shopify storefront mcp ucp",
      "mcp server selbst hosten",
      "shopcart mcp"
    ]
  }
];
