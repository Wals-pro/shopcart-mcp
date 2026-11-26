import type { Lang } from "../auth/pages.js";

/**
 * Single source of truth for "which shops work and how far does the handoff go".
 * Consumed by the landing page, the guides, /llms.txt, /llms-full.txt, the
 * Schema.org JSON-LD and (mirrored by hand) README.md, so the public copy can
 * never drift back into "Shopify only" claims.
 *
 * Every statement here mirrors what the adapters in src/adapters/* really do:
 * - Shopify: one cart permalink for the whole cart (up to 20 line items).
 * - WooCommerce / BigCommerce: one add-to-cart link per item (sequence).
 * - Amazon: official multi-item Add-to-Cart form link; live search and prices
 *   only when the operator configured Keepa or PA-API credentials.
 * - Shopware 6 / Magento 2 / Universal JSON-LD: verified direct product links.
 */

export type HandoffLevel = "cart" | "sequence" | "amazon" | "product";

export interface PlatformRow {
  id: "shopify" | "woocommerce" | "bigcommerce" | "amazon" | "shopware" | "magento" | "universal";
  name: string;
  /** Short technical basis, shown small under the name. */
  basis: string;
  search: string;
  live: string;
  handoffLevel: HandoffLevel;
  /** Scannable badge label for the handoff column. */
  handoffLabel: string;
  handoff: string;
}

export interface ComfortFeature {
  id: string;
  title: string;
  text: string;
}

export const AMAZON_MARKETPLACES = "DE, AT, US, UK, FR, IT, ES, NL, CA, JP";

/** Names only, in adapter priority order after Shopify. Safe inside sentences. */
export const PLATFORM_NAMES = [
  "Shopify",
  "WooCommerce",
  "BigCommerce",
  "Amazon",
  "Shopware 6",
  "Magento 2"
] as const;

export function getPlatformRows(lang: Lang): PlatformRow[] {
  if (lang === "de") {
    return [
      {
        id: "shopify",
        name: "Shopify",
        basis: "Öffentliche Storefront, Storefront MCP & UCP",
        search: "Live-Suche im ganzen Sortiment, dazu Sale-, Black-Friday- und Bestseller-Kollektionen",
        live: "Preis, Größen, Farben, Bestand, Rabatt in % und Ersparnis",
        handoffLevel: "cart",
        handoffLabel: "Ein Link für den ganzen Warenkorb",
        handoff: "Bis zu 20 Positionen in einem Link, Rabattcode optional. Versand und Rückgabe prüft die KI vorab."
      },
      {
        id: "woocommerce",
        name: "WooCommerce",
        basis: "Öffentliche Store API v1",
        search: "Live-Suche im Sortiment",
        live: "Preis, Varianten und Bestand",
        handoffLevel: "sequence",
        handoffLabel: "Ein Link pro Artikel",
        handoff: "Je Artikel ein In-den-Warenkorb-Link, die du nacheinander anklickst."
      },
      {
        id: "bigcommerce",
        name: "BigCommerce",
        basis: "Öffentliche Shop-Seiten & Cart-Permalink",
        search: "Live-Suche über die Shop-Suche",
        live: "Preis, Varianten, Verfügbarkeit und Rabatte",
        handoffLevel: "sequence",
        handoffLabel: "Ein Link pro Produkt",
        handoff: "Je Produkt ein In-den-Warenkorb-Link, die du nacheinander anklickst."
      },
      {
        id: "amazon",
        name: "Amazon",
        basis: `Offizieller Warenkorb-Link, 10 Marktplätze (${AMAZON_MARKETPLACES})`,
        search: "Du oder deine KI nennt die Artikel per ASIN oder Produktlink. Live-Suche nur im Self-Hosting mit eigenem Keepa- oder PA-API-Schlüssel.",
        live: "Preis und Verfügbarkeit siehst du auf der Amazon-Bestätigungsseite, live im Chat nur mit eigenem Schlüssel",
        handoffLevel: "amazon",
        handoffLabel: "Ein Amazon-Link für mehrere Artikel",
        handoff: "Mehrere Artikel und Mengen in einem Link. Amazon zeigt zuerst seine eigene Bestätigungsseite."
      },
      {
        id: "shopware",
        name: "Shopware 6",
        basis: "Öffentliche Store API oder Shop-Suche",
        search: "Live-Suche im Sortiment",
        live: "Preis, Varianten und Verfügbarkeit",
        handoffLevel: "product",
        handoffLabel: "Geprüfter Produktlink",
        handoff: "Direktlink zur geprüften Produktseite, in den Warenkorb legst du dort selbst."
      },
      {
        id: "magento",
        name: "Magento 2 / Adobe Commerce",
        basis: "Öffentliche GraphQL-Schnittstelle",
        search: "Live-Suche im Sortiment, auch nach Artikelnummer",
        live: "Preis, Varianten, Bestand und Staffelrabatte",
        handoffLevel: "product",
        handoffLabel: "Geprüfter Produktlink",
        handoff: "Direktlink zur geprüften Produktseite, in den Warenkorb legst du dort selbst."
      },
      {
        id: "universal",
        name: "Alle anderen Shops",
        basis: "Schema.org / JSON-LD der Produktseite",
        search: "Keine Katalogsuche: Du gibst den Produktlink, die KI prüft ihn",
        live: "Preis, Währung, Verfügbarkeit und EAN/GTIN direkt von der Produktseite",
        handoffLevel: "product",
        handoffLabel: "Geprüfter Produktlink",
        handoff:
          "Direktlink zum geprüften Produkt. Shops ohne öffentlichen Warenkorb-Link für mehrere Artikel (z. B. IKEA, Manufactum, Bergzeit oder JTL-Shops) laufen über diesen Weg."
      }
    ];
  }

  return [
    {
      id: "shopify",
      name: "Shopify",
      basis: "Public storefront, Storefront MCP & UCP",
      search: "Live search across the full catalog, plus sale, Black Friday, and bestseller collections",
      live: "Price, sizes, colors, stock, discount in % and savings",
      handoffLevel: "cart",
      handoffLabel: "One link for the whole cart",
      handoff: "Up to 20 line items in one link, optional discount code. Your AI checks shipping and returns first."
    },
    {
      id: "woocommerce",
      name: "WooCommerce",
      basis: "Public Store API v1",
      search: "Live catalog search",
      live: "Price, variations, and stock",
      handoffLevel: "sequence",
      handoffLabel: "One link per item",
      handoff: "One add-to-cart link per item, which you click one after another."
    },
    {
      id: "bigcommerce",
      name: "BigCommerce",
      basis: "Public store pages & cart permalink",
      search: "Live search through the store's own search",
      live: "Price, variants, availability, and discounts",
      handoffLevel: "sequence",
      handoffLabel: "One link per product",
      handoff: "One add-to-cart link per product, which you click one after another."
    },
    {
      id: "amazon",
      name: "Amazon",
      basis: `Official cart link, 10 marketplaces (${AMAZON_MARKETPLACES})`,
      search: "You or your AI name the items by ASIN or product link. Live search only when self-hosting with your own Keepa or PA-API key.",
      live: "Price and availability appear on Amazon's confirmation page, live in chat only with your own key",
      handoffLevel: "amazon",
      handoffLabel: "One Amazon link for several items",
      handoff: "Several items and quantities in one link. Amazon shows its own confirmation page first."
    },
    {
      id: "shopware",
      name: "Shopware 6",
      basis: "Public Store API or storefront search",
      search: "Live catalog search",
      live: "Price, variants, and availability",
      handoffLevel: "product",
      handoffLabel: "Verified product link",
      handoff: "Direct link to the verified product page, where you add it to the cart yourself."
    },
    {
      id: "magento",
      name: "Magento 2 / Adobe Commerce",
      basis: "Public GraphQL endpoint",
      search: "Live catalog search, including by SKU",
      live: "Price, variants, stock, and tier discounts",
      handoffLevel: "product",
      handoffLabel: "Verified product link",
      handoff: "Direct link to the verified product page, where you add it to the cart yourself."
    },
    {
      id: "universal",
      name: "Any other store",
      basis: "Schema.org / JSON-LD on the product page",
      search: "No catalog search: you share the product link, your AI verifies it",
      live: "Price, currency, availability, and EAN/GTIN straight from the product page",
      handoffLevel: "product",
      handoffLabel: "Verified product link",
      handoff:
        "Direct link to the verified product. Stores without a public multi-item cart link (e.g. IKEA, Manufactum, Bergzeit, or JTL-Shop stores) use this path."
    }
  ];
}

export function getMatrixHeaders(lang: Lang): { platform: string; search: string; live: string; handoff: string } {
  return lang === "de"
    ? {
        platform: "Shop-System",
        search: "Produkte finden",
        live: "Live geprüft",
        handoff: "Übergabe an den Shop"
      }
    : {
        platform: "Store platform",
        search: "Finding products",
        live: "Verified live",
        handoff: "Handoff to the store"
      };
}

export function getComfortFeatures(lang: Lang): ComfortFeature[] {
  if (lang === "de") {
    return [
      {
        id: "policies",
        title: "Versand & Rückgabe vor dem Checkout",
        text: "Deine KI liest Versandbedingungen und Rückgaberegeln direkt aus dem Shop, bevor du den Warenkorb öffnest. Verfügbar in Shopify-Shops."
      },
      {
        id: "deals",
        title: "Sale, Black Friday & Bestseller",
        text: "Die KI stöbert in Sale-, Black-Friday- und Bestseller-Kollektionen und nennt dir Rabatt in Prozent und Ersparnis pro Artikel. Verfügbar in Shopify-Shops."
      },
      {
        id: "connect",
        title: "In zwei Schritten verbunden",
        text: "Link wird automatisch kopiert, die Connector-Einstellungen von Claude oder ChatGPT öffnen sich. Danach startest du mit einem fertigen Start-Prompt per Klick."
      },
      {
        id: "desktop",
        title: "Claude Desktop mit einem Klick",
        text: "Die Desktop-Erweiterung (.mcpb) installierst du per Doppelklick, ganz ohne Terminal und ohne Konfigurationsdatei."
      },
      {
        id: "login",
        title: "Anmelden ohne Passwort",
        text: "Du bekommst einen 6-stelligen Code und einen Magic Link per E-Mail. Ein Passwort gibt es nicht."
      },
      {
        id: "readonly",
        title: "Nur lesend, in der EU gehostet",
        text: "ShopCart bestellt und bezahlt nie. Zahlungsdaten, Adressen und Shop-Logins bleiben beim Shop und tauchen im Chat nicht auf."
      }
    ];
  }

  return [
    {
      id: "policies",
      title: "Shipping & returns before checkout",
      text: "Your AI reads shipping terms and return rules straight from the store before you open the cart. Available in Shopify stores."
    },
    {
      id: "deals",
      title: "Sale, Black Friday & bestsellers",
      text: "Your AI browses sale, Black Friday, and bestseller collections and tells you the discount in percent and the savings per item. Available in Shopify stores."
    },
    {
      id: "connect",
      title: "Connected in two steps",
      text: "Your link is copied automatically and the connector settings of Claude or ChatGPT open. After that, a ready-made start prompt is one click away."
    },
    {
      id: "desktop",
      title: "Claude Desktop in one click",
      text: "Install the desktop extension (.mcpb) with a double-click, no terminal and no config file."
    },
    {
      id: "login",
      title: "Sign in without a password",
      text: "You get a 6-digit code and a magic link by email. There is no password."
    },
    {
      id: "readonly",
      title: "Read-only and hosted in the EU",
      text: "ShopCart never orders or pays. Payment details, addresses, and store logins stay with the store and never appear in the chat."
    }
  ];
}

/** Campaign decision E1: neutral, factual, trademark-safe. Used on every public surface. */
export function getTrademarkDisclaimer(lang: Lang): string {
  return lang === "de"
    ? "Unabhängiges Open-Source-Tool von wals.pro, nicht verbunden mit oder unterstützt von Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware oder Adobe (Magento). Alle Markennamen gehören ihren jeweiligen Eigentümern."
    : "Independent open-source tool by wals.pro, not affiliated with or endorsed by Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware, or Adobe (Magento). All trademarks belong to their respective owners.";
}

/** One-sentence platform summary for prose (FAQ answers, meta lines, llms.txt intro). */
export function getPlatformSentence(lang: Lang): string {
  return lang === "de"
    ? "ShopCart funktioniert in öffentlichen Shops auf Shopify, WooCommerce, BigCommerce, Shopware 6 und Magento 2, erstellt offizielle Amazon-Warenkorb-Links und prüft in jedem anderen Shop Preis und Verfügbarkeit direkt über die Produktseite."
    : "ShopCart works with public stores on Shopify, WooCommerce, BigCommerce, Shopware 6, and Magento 2, creates official Amazon cart links, and verifies price and availability on any other store straight from the product page.";
}

/** Short honest note on how far the handoff goes per platform. */
export function getHandoffSentence(lang: Lang): string {
  return lang === "de"
    ? "Wie weit die Übergabe reicht, hängt vom Shop-System ab: In Shopify-Shops füllt ein einziger Link den ganzen Warenkorb, bei Amazon ebenfalls (über Amazons Bestätigungsseite). WooCommerce und BigCommerce bekommen einen In-den-Warenkorb-Link pro Artikel. In Shopware-6-, Magento-2- und allen anderen Shops erhältst du geprüfte Direktlinks zu den Produktseiten."
    : "How far the handoff goes depends on the store platform: in Shopify stores a single link fills the whole cart, and Amazon works the same way (through Amazon's confirmation page). WooCommerce and BigCommerce get one add-to-cart link per item. In Shopware 6, Magento 2, and all other stores you receive verified direct links to the product pages.";
}

/** Markdown table for /llms.txt, /llms-full.txt (English, agent-facing). */
export function renderPlatformMatrixMarkdown(lang: Lang = "en"): string {
  const rows = getPlatformRows(lang);
  const h = getMatrixHeaders(lang);
  const lines = [
    `| ${h.platform} | ${h.search} | ${h.live} | ${h.handoff} |`,
    "| --- | --- | --- | --- |",
    ...rows.map(
      (r) => `| **${r.name}** (${r.basis}) | ${r.search} | ${r.live} | **${r.handoffLabel}.** ${r.handoff} |`
    )
  ];
  return lines.join("\n");
}

/** Honest scope note used as the "limitations" paragraph of the guides. */
export function getPlatformLimits(lang: Lang): string {
  return lang === "de"
    ? "Die Live-Suche mit Varianten- und Bestandsprüfung funktioniert in öffentlichen Shops auf Shopify, WooCommerce, BigCommerce, Shopware 6 und Magento 2 ohne Login-Schranke. Ein einziger Link für den ganzen Warenkorb entsteht in Shopify-Shops und bei Amazon (offizieller Multi-Artikel-Link /gp/aws/cart/add.html, 10 Marktplätze). WooCommerce und BigCommerce liefern einen In-den-Warenkorb-Link pro Artikel, Shopware 6, Magento 2 und alle anderen Shops geprüfte Produktlinks. Live-Preise von Amazon gibt es nur im Self-Hosting mit eigenem Keepa- oder PA-API-Schlüssel. Versand- und Rückgabe-Check sowie Sale-Kollektionen sind Shopify-Funktionen. Passwortgeschützte B2B-Portale werden nicht unterstützt, einen automatischen Checkout gibt es nie."
    : "Live search with variant and stock checks works on public Shopify, WooCommerce, BigCommerce, Shopware 6, and Magento 2 stores without login gates. One link for the whole cart exists on Shopify stores and on Amazon (official multi-item link /gp/aws/cart/add.html, 10 marketplaces). WooCommerce and BigCommerce return one add-to-cart link per item, while Shopware 6, Magento 2, and all other stores return verified product links. Live Amazon prices need your own Keepa or PA-API key (self-hosting). Shipping and return checks and sale collections are available on Shopify stores. Password-protected B2B portals are not supported, and there is never an automated checkout.";
}
