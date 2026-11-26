import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import { escapeHtml, type Lang } from "../auth/pages.js";
import {
  buildGuidesCsp,
  renderAnalyticsHead,
  renderConsentBanner,
  renderCookieSettingsFooterLink
} from "./analytics.js";
import { renderFaviconHeadLinks, renderShopCartWordmark, renderSparkCartSvg } from "./brand.js";
import { serializeJsonLd } from "./content.js";
import { getTrademarkDisclaimer } from "./platforms.js";

export const FOR_MERCHANTS_DE_PATH = "/for-merchants";
export const FOR_MERCHANTS_EN_PATH = "/en/for-merchants";
export const FOR_MERCHANTS_CSS_PATH = "/assets/for-merchants.css";
export const WALSPRO_BOOKING_URL = "https://wals.pro/termin";

export const INDEPENDENCE_GUARANTEE_DE =
  "Die Erkennung, Funktion und Platzierung eines Shops in ShopCart ist und bleibt zu 100 % unabhängig von einer Zusammenarbeit mit wals.pro. Kein Pay-to-Rank, keine bezahlten Listings.";

export const INDEPENDENCE_GUARANTEE_EN =
  "A store's detection, functionality, and placement in ShopCart is and remains 100% independent of any engagement with wals.pro. No pay-to-rank, no paid listings.";

interface DeliverableItem {
  tag: string;
  title: string;
  text: string;
}

interface ProblemItem {
  title: string;
  text: string;
}

interface ProcessStep {
  num: string;
  title: string;
  text: string;
}

interface MerchantFaqItem {
  q: string;
  a: string;
}

interface PlatformBadge {
  name: string;
  note: string;
}

interface PageCopy {
  lang: Lang;
  otherLang: Lang;
  canonicalPath: string;
  switchPath: string;
  checkPath: string;
  metaTitle: string;
  metaDescription: string;
  skipLabel: string;
  navAriaLabel: string;
  navHome: string;
  navCheck: string;
  navGuides: string;
  navMerchants: string;
  navAccount: string;
  langSwitchAria: string;
  langSwitchLabel: string;
  eyebrow: string;
  heroTitleLine1: string;
  heroTitleAccent: string;
  heroLead: string;
  primaryCtaLabel: string;
  primaryCtaSub: string;
  secondaryCtaLabel: string;
  heroSignals: string[];
  trustBadge: string;
  trustHeading: string;
  trustBody: string;
  trustNote: string;
  selfCheckKicker: string;
  selfCheckTitle: string;
  selfCheckLead: string;
  selfCheckBullets: Array<{ lead: string; text: string }>;
  selfCheckCta: string;
  problemKicker: string;
  problemTitle: string;
  problemSub: string;
  problems: ProblemItem[];
  platformsKicker: string;
  platformsTitle: string;
  platformsSub: string;
  platforms: PlatformBadge[];
  deliverablesKicker: string;
  deliverablesTitle: string;
  deliverablesSub: string;
  deliverables: DeliverableItem[];
  processKicker: string;
  processTitle: string;
  processSub: string;
  steps: ProcessStep[];
  ctaKicker: string;
  ctaTitle: string;
  ctaLead: string;
  ctaTrustReinforce: string;
  ctaPrimaryLabel: string;
  ctaSecondaryLabel: string;
  operatorLabel: string;
  operatorText: string;
  faqKicker: string;
  faqTitle: string;
  faqs: MerchantFaqItem[];
  footerHome: string;
  footerCheck: string;
  footerGuides: string;
  footerBilling: string;
  footerPrivacy: string;
  footerTerms: string;
  footerLegalNotice: string;
}

const TARGET_PLATFORMS_DE: readonly PlatformBadge[] = [
  { name: "Shopify / Shopify Plus", note: "Storefront API, Storefront MCP, /.well-known/ucp & Cart-Permalinks" },
  { name: "Shopware 6", note: "Store API, strukturierte Varianten- & Preisdaten, JSON-LD" },
  { name: "WooCommerce", note: "Store API v1, Varianten-Stock, Performance & Caching" },
  { name: "Magento 2", note: "Öffentliches GraphQL, SKU-/Varianten-Struktur & Staffelpreise" },
  { name: "BigCommerce", note: "Storefront-Suche, Produkt-Metadaten & Cart-Übergabe" },
  { name: "OXID", note: "Strukturierte Produktdaten, Verfügbarkeit & saubere Katalog-Signale" },
  { name: "Custom Storefronts", note: "Headless, Eigenentwicklungen, UCP & Storefront-MCP-Endpoints" }
];

const TARGET_PLATFORMS_EN: readonly PlatformBadge[] = [
  { name: "Shopify / Shopify Plus", note: "Storefront API, Storefront MCP, /.well-known/ucp & cart permalinks" },
  { name: "Shopware 6", note: "Store API, structured variant & pricing data, JSON-LD" },
  { name: "WooCommerce", note: "Store API v1, variation stock, performance & caching" },
  { name: "Magento 2", note: "Public GraphQL, SKU/variant structure & tier pricing" },
  { name: "BigCommerce", note: "Storefront search, product metadata & cart handoff" },
  { name: "OXID", note: "Structured product data, availability & clean catalog signals" },
  { name: "Custom Storefronts", note: "Headless, bespoke builds, UCP & Storefront MCP endpoints" }
];

function getPageCopy(lang: Lang): PageCopy {
  if (lang === "de") {
    return {
      lang: "de",
      otherLang: "en",
      canonicalPath: FOR_MERCHANTS_DE_PATH,
      switchPath: FOR_MERCHANTS_EN_PATH,
      checkPath: "/check",
      metaTitle: "Für Shops: Agentic Storefront Readiness | ShopCart by wals.pro",
      metaDescription:
        "Online-Shop bereit für Claude, ChatGPT, Gemini & Instinct: kostenloser Selbst-Check und Agentic Storefront Readiness von wals.pro. Kein Pay-to-Rank.",
      skipLabel: "Zum Hauptinhalt springen",
      navAriaLabel: "Hauptnavigation",
      navHome: "Startseite",
      navCheck: "Shop-Check",
      navGuides: "Ratgeber",
      navMerchants: "Für Shops",
      navAccount: "Konto",
      langSwitchAria: "Switch to English",
      langSwitchLabel: "EN",
      eyebrow: "Für Online-Shops & E-Commerce-Teams · by wals.pro",
      heroTitleLine1: "Agentic Storefront Readiness",
      heroTitleAccent: "für Ihren Online-Shop.",
      heroLead:
        "Immer mehr Kundinnen und Kunden suchen Produkte, Größen, Preise und Rabatte direkt über Claude, ChatGPT, Google Gemini oder Instinct. Prüfen Sie kostenlos, wie KI-Shopping-Assistenten Ihren Shop heute lesen — und lassen Sie technische Hürden bei Bedarf sauber durch wals.pro beheben.",
      primaryCtaLabel: "Erst selbst prüfen (kostenlos & ohne Login)",
      primaryCtaSub: "Live-Prüfung Ihrer Domain in ~10 Sekunden — sofort ohne Account nutzbar.",
      secondaryCtaLabel: "Erstgespräch vereinbaren",
      heroSignals: [
        "100 % unabhängig · Kein Pay-to-Rank",
        "Read-only — keine Shop-Logins oder Zahlungsdaten",
        "DACH & Global · Wals Professional Services GmbH"
      ],
      trustBadge: "Unabhängigkeits-Garantie",
      trustHeading: "100 % neutral. Kein Pay-to-Rank.",
      trustBody: INDEPENDENCE_GUARANTEE_DE,
      trustNote:
        "ShopCart MCP arbeitet als offenes, rein lesendes Werkzeug gegen öffentliche Storefront-Standards. Jede Optimierung, die wals.pro umsetzt, verbessert Ihren Shop für alle KI-Assistenten und offenen Protokolle gleichermaßen.",
      selfCheckKicker: "Schritt 1 · Kostenloser Selbst-Check",
      selfCheckTitle: "Sehen Sie in ~10 Sekunden, wie KI-Agenten Ihren Shop lesen",
      selfCheckLead:
        "Bevor Sie überhaupt mit jemandem sprechen, testen Sie Ihre Shop-Domain direkt im öffentlichen ShopCart Selbst-Check. Ohne Anmeldung, ohne Agentur-Pitch und direkt auf Basis realer Live-Signale:",
      selfCheckBullets: [
        {
          lead: "Katalog, Varianten & Live-Preise:",
          text: "Werden Größen, Farben, Lagerbestand, Währung und echte Streichpreise eindeutig erkannt?"
        },
        {
          lead: "Versand-, Rückgabe- & Rabatt-Signale:",
          text: "Finden Claude, ChatGPT, Google Gemini und Instinct Ihre Versandbedingungen, Rückgaberegeln und öffentlichen Aktionscodes?"
        },
        {
          lead: "UCP, MCP & WAF-Erreichbarkeit:",
          text: "Antwortet Ihre Storefront sauber auf /.well-known/ucp, Storefront-MCP-Signale und legitime Lese-Anfragen?"
        }
      ],
      selfCheckCta: "Erst selbst prüfen (kostenlos & ohne Login)",
      problemKicker: "Warum KI-Shopping oft abbricht",
      problemTitle: "Wo öffentliche Storefronts heute für KI-Assistenten unsichtbar bleiben",
      problemSub:
        "Viele technisch gute Shops verlieren KI-vermittelte Kaufabsichten nicht wegen des Sortiments, sondern wegen kleiner technischer Brüche in Datenstruktur, Firewall oder Warenkorb-Übergabe.",
      problems: [
        {
          title: "Unvollständige Varianten, Preise & JSON-LD",
          text: "Fehlende oder widersprüchliche Schema.org/JSON-LD-Blöcke, nicht aufgelöste Varianten-IDs, fehlende GTIN/EAN oder veraltete Verfügbarkeitsflags führen dazu, dass KI-Agenten Produkte überspringen oder falsche Größen nennen."
        },
        {
          title: "Zu strenge WAF- & Bot-Regeln",
          text: "Pauschale Firewall-Regeln blockieren legitime, lesende Shopping-Agenten mit 403-Fehlern oder CAPTCHAs — während der Shop eigentlich auf Kaufinteresse vorbereitet sein möchte."
        },
        {
          title: "Fehlende UCP- & Storefront-MCP-Signale",
          text: "Ohne saubere /.well-known/ucp-Metadaten, maschinenlesbare Versand-/Rückgaberegeln oder definierte Storefront-MCP-Endpunkte müssen KI-Clients raten statt zuverlässig zu prüfen."
        },
        {
          title: "Bruch bei Warenkorb- & Rabatt-Übergabe",
          text: "Wenn Cart-Permalinks, Varianten-Parameter oder öffentliche Rabattcodes nicht sauber in den Browser-Checkout übergeben werden, bricht der Kauf im entscheidenden Moment ab."
        }
      ],
      platformsKicker: "Unterstützte Zielplattformen",
      platformsTitle: "Für alle relevanten E-Commerce-Plattformen",
      platformsSub:
        "Ob Standard-Storefront oder individuelle Headless-Architektur: Wir richten uns nach Ihrer bestehenden Shop-Landschaft statt nach starren Vorlagen.",
      platforms: [...TARGET_PLATFORMS_DE],
      deliverablesKicker: "B2B-Angebot von wals.pro",
      deliverablesTitle: "Was wir konkret umsetzen",
      deliverablesSub:
        "Pragmatische, technisch saubere Umsetzung statt PowerPoint-Folien — abgestimmt auf Ihr Shop-System und Ihre internen Teams.",
      deliverables: [
        {
          tag: "01 · Analyse",
          title: "Agentic Storefront Audit",
          text: "Strukturierte Tiefenprüfung Ihrer realen Storefront aus Sicht von Claude, ChatGPT, Google Gemini und Instinct — inklusive priorisierter Mängelliste und konkreter Fix-Empfehlungen."
        },
        {
          tag: "02 · Datenstruktur",
          title: "Sauberes Schema.org / JSON-LD & Variantenstruktur",
          text: "Präzise Auszeichnung von Produktgruppen, Varianten (Größe, Farbe, SKU, EAN/GTIN), Live-Preisen, Streichpreisen und Lagerstatus nach aktuellen Schema.org-Standards."
        },
        {
          tag: "03 · Protokolle",
          title: "UCP (/.well-known/ucp) & Storefront-MCP-Integration",
          text: "Saubere Bereitstellung von Universal Commerce Protocol (/.well-known/ucp), öffentlichen Storefront-MCP-Endpunkten sowie maschinenlesbaren Versand- und Rückgabeinformationen."
        },
        {
          tag: "04 · Sicherheit",
          title: "Saubere WAF- & Bot-Regeln für legitime KI-Shopping-Agenten",
          text: "Differenzierte Sicherheitsregeln (z. B. Cloudflare, Fastly, Edge-WAF), die bösartiges Scraping stoppen, aber verifizierten Read-Only-Shopping-Agenten zuverlässigen Zugriff gewähren."
        },
        {
          tag: "05 · Conversion",
          title: "Checkout- & Rabattlink-Readiness",
          text: "Stabile Übergabe per Warenkorb-Link, verifizierten Varianten-Parametern, konsistenten Währungs-/Markt-Redirects und sauber erkennbaren öffentlichen Rabattaktionen."
        },
        {
          tag: "06 · Betrieb",
          title: "Laufendes Monitoring",
          text: "Kontinuierliche automatisierte Prüfung Ihrer Storefront-Signale, damit Theme-Updates, App-Änderungen oder WAF-Regeln Ihre KI-Lesbarkeit nicht unbemerkt wieder brechen."
        }
      ],
      processKicker: "Klarer Ablauf",
      processTitle: "Vom Selbst-Check zur produktiven Agentic Storefront",
      processSub: "Kein Lock-in, keine unnötige Komplexität — Sie entscheiden nach jedem Schritt selbst.",
      steps: [
        {
          num: "1",
          title: "Kostenloser Selbst-Check",
          text: "Testen Sie Ihre Domain direkt auf /check und sehen Sie sofort, welche Signale bereits funktionieren und wo Lücken liegen."
        },
        {
          num: "2",
          title: "Unverbindliches Erstgespräch",
          text: "Im kurzen Termin mit wals.pro klären wir Plattform, Ziele, Prioritäten und was Ihr internes Team selbst lösen kann."
        },
        {
          num: "3",
          title: "Umsetzung & Monitoring",
          text: "Wir setzen Audit, JSON-LD, UCP/MCP, WAF-Regeln und Checkout-Readiness sauber um und sichern die Qualität laufend ab."
        }
      ],
      ctaKicker: "Unverbindlich sprechen",
      ctaTitle: "Bereit, Ihren Shop für KI-Shopping-Assistenten fit zu machen?",
      ctaLead:
        "Starten Sie mit dem kostenlosen Selbst-Check oder buchen Sie direkt ein unverbindliches technisches Erstgespräch mit dem Team von wals.pro.",
      ctaTrustReinforce: INDEPENDENCE_GUARANTEE_DE,
      ctaPrimaryLabel: "Erstgespräch vereinbaren",
      ctaSecondaryLabel: "Erst selbst prüfen (kostenlos & ohne Login)",
      operatorLabel: "Anbieter & Verantwortung:",
      operatorText:
        "B2B-Beratung und technische Umsetzung erfolgen durch wals.pro (Wals Professional Services GmbH, Wien, Österreich — tätig im DACH-Raum, in der EU und global).",
      faqKicker: "Häufige Fragen von Shops",
      faqTitle: "Antworten für E-Commerce- und Technik-Teams",
      faqs: [
        {
          q: "Bevorzugt ShopCart Shops, die mit wals.pro zusammenarbeiten?",
          a: "Nein — niemals. Die Erkennung, Funktion und Platzierung eines Shops in ShopCart ist und bleibt zu 100 % unabhängig von einer Zusammenarbeit mit wals.pro. Es gibt kein Pay-to-Rank und keine bezahlten Listings."
        },
        {
          q: "Braucht ShopCart Admin-Zugänge oder API-Keys für unseren Shop?",
          a: "Nein. ShopCart MCP greift ausschließlich lesend auf öffentlich zugängliche Storefront-Informationen zu. Auch der Selbst-Check auf /check funktioniert komplett ohne Login und ohne Shop-Zugangsdaten."
        },
        {
          q: "Welche Shop-Systeme unterstützt wals.pro bei Agentic Storefront Readiness?",
          a: "Wir unterstützen Shopify / Shopify Plus, Shopware 6, WooCommerce, Magento 2, BigCommerce, OXID sowie individuelle Custom- und Headless-Storefronts."
        },
        {
          q: "Was bringt uns die Optimierung außerhalb von ShopCart?",
          a: "Alle Maßnahmen folgen offenen Web- und Commerce-Standards (Schema.org / JSON-LD, /.well-known/ucp, Storefront MCP, saubere WAF-Policies, stabile Cart-URLs). Davon profitieren sämtliche KI-Assistenten, Suchmaschinen und Agentic-Commerce-Clients."
        },
        {
          q: "Können wir Fehler aus dem Selbst-Check auch selbst beheben?",
          a: "Ja, ausdrücklich. Der Selbst-Check ist kostenlos und ohne Login nutzbar, damit Ihr internes Entwickler- oder Agentur-Team Befunde direkt eigenständig beheben kann. wals.pro hilft immer dann, wenn Sie Audit, Umsetzung oder laufendes Monitoring auslagern möchten."
        }
      ],
      footerHome: "Startseite",
      footerCheck: "Shop-Check",
      footerGuides: "Ratgeber",
      footerBilling: "Konto & Abo",
      footerPrivacy: "Datenschutz",
      footerTerms: "Nutzungsbedingungen",
      footerLegalNotice: "Impressum"
    };
  }

  return {
    lang: "en",
    otherLang: "de",
    canonicalPath: FOR_MERCHANTS_EN_PATH,
    switchPath: FOR_MERCHANTS_DE_PATH,
    checkPath: "/en/check",
    metaTitle: "For Merchants: Agentic Storefront Readiness | ShopCart by wals.pro",
    metaDescription:
      "Prepare your store for Claude, ChatGPT, Gemini & Instinct: free self-check and Agentic Storefront Readiness by wals.pro. 100% independent.",
    skipLabel: "Skip to main content",
    navAriaLabel: "Main navigation",
    navHome: "Home",
    navCheck: "Store Check",
    navGuides: "Guides",
    navMerchants: "For merchants",
    navAccount: "Account",
    langSwitchAria: "Auf Deutsch wechseln",
    langSwitchLabel: "DE",
    eyebrow: "For online stores & e-commerce teams · by wals.pro",
    heroTitleLine1: "Agentic Storefront Readiness",
    heroTitleAccent: "for your online store.",
    heroLead:
      "More shoppers now ask Claude, ChatGPT, Google Gemini, or Instinct to find products, verify sizes and prices, and prepare carts. Test for free how AI shopping assistants read your storefront today — and have wals.pro fix technical blockers when you want hands-on help.",
    primaryCtaLabel: "Check your store first (free & no login)",
    primaryCtaSub: "Live scan of your domain in ~10 seconds — no account required.",
    secondaryCtaLabel: "Book an intro call",
    heroSignals: [
      "100% independent · No pay-to-rank",
      "Read-only — no store logins or payment data",
      "DACH, EU & Global · Wals Professional Services GmbH"
    ],
    trustBadge: "Independence Guarantee",
    trustHeading: "100% neutral. Zero pay-to-rank.",
    trustBody: INDEPENDENCE_GUARANTEE_EN,
    trustNote:
      "ShopCart MCP operates as an open, strictly read-only tool against public storefront standards. Every improvement wals.pro implements benefits your store across all AI assistants and open commerce protocols equally.",
    selfCheckKicker: "Step 1 · Free Self-Check",
    selfCheckTitle: "See how AI agents read your storefront in ~10 seconds",
    selfCheckLead:
      "Before talking to anyone, run your store domain through the public ShopCart self-check. No sign-up, no sales gate, and based directly on live storefront signals:",
    selfCheckBullets: [
      {
        lead: "Catalog, variants & live prices:",
        text: "Are sizes, colors, stock status, currency, and genuine compare-at discounts parsed accurately?"
      },
      {
        lead: "Shipping, return & promo signals:",
        text: "Can Claude, ChatGPT, Google Gemini, and Instinct reliably read your shipping terms, return rules, and public discount offers?"
      },
      {
        lead: "UCP, MCP & WAF reachability:",
        text: "Does your storefront respond cleanly to /.well-known/ucp, Storefront MCP discovery, and legitimate read-only requests?"
      }
    ],
    selfCheckCta: "Check your store first (free & no login)",
    problemKicker: "Why AI shopping stalls",
    problemTitle: "Where public storefronts lose AI-assisted shoppers today",
    problemSub:
      "Many well-built stores miss AI-driven purchase intent not because of their catalog, but because of small technical gaps in structured data, bot rules, or cart handoff.",
    problems: [
      {
        title: "Incomplete variants, prices & JSON-LD",
        text: "Missing or inconsistent Schema.org/JSON-LD markup, ambiguous variant IDs, missing GTIN/EAN codes, or stale availability flags cause AI agents to skip products or misreport sizes."
      },
      {
        title: "Overly aggressive WAF & bot rules",
        text: "Blanket firewall policies block legitimate read-only shopping assistants with 403 responses or CAPTCHA loops — cutting off high-intent buyers."
      },
      {
        title: "Missing UCP & Storefront MCP signals",
        text: "Without clean /.well-known/ucp metadata, machine-readable shipping and return policies, or discoverable Storefront MCP endpoints, AI clients are forced to guess."
      },
      {
        title: "Broken cart & discount handoffs",
        text: "When cart permalinks, variant parameters, regional redirects, or public promo codes do not resolve cleanly in the shopper's browser, checkout drops off at the finish line."
      }
    ],
    platformsKicker: "Supported target platforms",
    platformsTitle: "Built for every major e-commerce stack",
    platformsSub:
      "Whether standard storefront or bespoke headless architecture, we work cleanly within your existing commerce stack.",
    platforms: [...TARGET_PLATFORMS_EN],
    deliverablesKicker: "B2B offering by wals.pro",
    deliverablesTitle: "What we deliver",
    deliverablesSub:
      "Practical engineering execution instead of slide decks — tailored to your platform and internal engineering or agency workflows.",
    deliverables: [
      {
        tag: "01 · Audit",
        title: "Agentic Storefront Audit",
        text: "Deep technical evaluation of your live storefront as seen by Claude, ChatGPT, Google Gemini, and Instinct — delivered as a prioritized issue report with concrete remediation steps."
      },
      {
        tag: "02 · Structured Data",
        title: "Clean Schema.org / JSON-LD & variant structure",
        text: "Accurate markup for product groups, variants (size, color, SKU, EAN/GTIN), live pricing, genuine markdowns, and stock availability following current Schema.org standards."
      },
      {
        tag: "03 · Open Protocols",
        title: "UCP (/.well-known/ucp) & Storefront MCP integration",
        text: "Standards-compliant setup of Universal Commerce Protocol (/.well-known/ucp), public Storefront MCP endpoints, and machine-readable shipping and return policies."
      },
      {
        tag: "04 · Edge & Security",
        title: "Clean WAF / Bot rules for legitimate AI shopping agents",
        text: "Targeted firewall rules (e.g., Cloudflare, Fastly, edge WAFs) that block abusive scraping while allowing verified read-only shopping assistants through reliably."
      },
      {
        tag: "05 · Conversion",
        title: "Checkout & Discount-Link readiness",
        text: "Deterministic cart permalink handoff, verified variant parameters, clean currency/region routing, and discoverable public promotion codes."
      },
      {
        tag: "06 · Reliability",
        title: "Ongoing monitoring",
        text: "Continuous automated verification of your storefront signals so theme releases, app updates, or WAF changes never silently break AI readability."
      }
    ],
    processKicker: "Simple engagement flow",
    processTitle: "From self-check to production agentic readiness",
    processSub: "Zero lock-in, full transparency — you decide how far you want to take each step.",
    steps: [
      {
        num: "1",
        title: "Run the free self-check",
        text: "Test your store domain on /en/check to see immediately what works today and where AI agents hit friction."
      },
      {
        num: "2",
        title: "Non-binding intro call",
        text: "In a short call with wals.pro, we review your platform, priorities, and what your internal team can fix right away."
      },
      {
        num: "3",
        title: "Implementation & monitoring",
        text: "We implement the audit fixes, JSON-LD, UCP/MCP, WAF rules, and checkout handoff — with optional ongoing monitoring."
      }
    ],
    ctaKicker: "Talk to our engineers",
    ctaTitle: "Ready to make your storefront cleanly readable for AI shoppers?",
    ctaLead:
      "Start with the free self-check or book a non-binding technical intro call directly with the wals.pro team.",
    ctaTrustReinforce: INDEPENDENCE_GUARANTEE_EN,
    ctaPrimaryLabel: "Book an intro call",
    ctaSecondaryLabel: "Check your store first (free & no login)",
    operatorLabel: "Operated by:",
    operatorText:
      "B2B consulting and engineering are delivered by wals.pro (Wals Professional Services GmbH, Vienna, Austria — serving DACH, EU, and global merchants).",
    faqKicker: "Merchant FAQ",
    faqTitle: "Common questions from e-commerce & engineering teams",
    faqs: [
      {
        q: "Does ShopCart favor stores that work with wals.pro?",
        a: "No — never. A store's detection, functionality, and placement in ShopCart is and remains 100% independent of any engagement with wals.pro. There is no pay-to-rank and no paid listings."
      },
      {
        q: "Does ShopCart need admin credentials or private API keys for our store?",
        a: "No. ShopCart MCP only reads publicly accessible storefront data. The self-check at /en/check also works completely without login or private store credentials."
      },
      {
        q: "Which e-commerce platforms does wals.pro support for Agentic Storefront Readiness?",
        a: "We support Shopify / Shopify Plus, Shopware 6, WooCommerce, Magento 2, BigCommerce, OXID, and bespoke custom or headless storefronts."
      },
      {
        q: "Does this optimization only help with ShopCart, or with all AI assistants?",
        a: "Every deliverable builds on open web and commerce standards (Schema.org / JSON-LD, /.well-known/ucp, Storefront MCP, clean WAF rules, and stable cart URLs) — improving compatibility across all AI shopping assistants and search engines."
      },
      {
        q: "Can our own developers fix findings from the self-check themselves?",
        a: "Yes, absolutely. The self-check is free and requires no login so your in-house team or agency can act on findings directly. Engage wals.pro only when you want an expert audit, hands-on implementation, or ongoing monitoring."
      }
    ],
    footerHome: "Home",
    footerCheck: "Store Check",
    footerGuides: "Guides",
    footerBilling: "Account & billing",
    footerPrivacy: "Privacy",
    footerTerms: "Terms",
    footerLegalNotice: "Legal Notice"
  };
}

function buildForMerchantsJsonLd(config: AppConfig, copy: PageCopy): Record<string, unknown> {
  const origin = config.appOrigin;
  const canonicalUrl = `${origin}${copy.canonicalPath}`;
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
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: copy.metaTitle,
        description: copy.metaDescription,
        inLanguage: copy.lang,
        isPartOf: {
          "@type": "WebSite",
          "@id": `${origin}/#website`,
          name: "ShopCart",
          url: origin
        },
        about: {
          "@id": `${canonicalUrl}#service`
        }
      },
      {
        "@type": "Service",
        "@id": `${canonicalUrl}#service`,
        name: "Agentic Storefront Readiness",
        serviceType: "Agentic Commerce & Storefront Engineering",
        description: copy.metaDescription,
        url: canonicalUrl,
        provider: {
          "@id": "https://wals.pro/#organization"
        },
        areaServed: ["AT", "DE", "CH", "EU", "Global"],
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: copy.deliverablesTitle,
          itemListElement: copy.deliverables.map((item) => ({
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: item.title,
              description: item.text
            }
          }))
        }
      },
      {
        "@type": "FAQPage",
        "@id": `${canonicalUrl}#faq`,
        inLanguage: copy.lang,
        mainEntity: copy.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.a
          }
        }))
      }
    ]
  };
}

export function renderForMerchantsPage(config: AppConfig, lang: Lang): string {
  const copy = getPageCopy(lang);
  const de = lang === "de";
  const origin = config.appOrigin;
  const canonicalUrl = `${origin}${copy.canonicalPath}`;
  const deUrl = `${origin}${FOR_MERCHANTS_DE_PATH}`;
  const enUrl = `${origin}${FOR_MERCHANTS_EN_PATH}`;
  const ogImage = `${origin}/icon-512.png`;
  const assetVersion = encodeURIComponent(config.version);
  const jsonLd = buildForMerchantsJsonLd(config, copy);

  const heroSignalsHtml = copy.heroSignals
    .map((signal) => `<li>${escapeHtml(signal)}</li>`)
    .join("\n          ");

  const selfCheckBulletsHtml = copy.selfCheckBullets
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.lead)}</strong> ${escapeHtml(item.text)}</li>`
    )
    .join("\n          ");

  const problemsHtml = copy.problems
    .map(
      (item) => `<article class="fm-card">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
        </article>`
    )
    .join("\n        ");

  const platformsHtml = copy.platforms
    .map(
      (platform) => `<li class="fm-platform-item">
          <strong class="fm-platform-name">${escapeHtml(platform.name)}</strong>
          <span class="fm-platform-note">${escapeHtml(platform.note)}</span>
        </li>`
    )
    .join("\n        ");

  const deliverablesHtml = copy.deliverables
    .map(
      (item) => `<article class="fm-card fm-deliverable">
          <span class="fm-card-tag">${escapeHtml(item.tag)}</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
        </article>`
    )
    .join("\n        ");

  const stepsHtml = copy.steps
    .map(
      (step) => `<li class="fm-step">
          <span class="fm-step-num" aria-hidden="true">${escapeHtml(step.num)}</span>
          <h3>${escapeHtml(step.title)}</h3>
          <p>${escapeHtml(step.text)}</p>
        </li>`
    )
    .join("\n        ");

  const faqHtml = copy.faqs
    .map(
      (faq, idx) => `<details class="fm-faq-item" name="merchant-faq"${idx === 0 ? " open" : ""}>
          <summary><span>${escapeHtml(faq.q)}</span><span class="fm-faq-icon" aria-hidden="true"></span></summary>
          <div class="fm-faq-answer"><p>${escapeHtml(faq.a)}</p></div>
        </details>`
    )
    .join("\n        ");

  return `<!doctype html>
<html lang="${copy.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#090909">
${renderFaviconHeadLinks()}
<title>${escapeHtml(copy.metaTitle)}</title>
<meta name="description" content="${escapeHtml(copy.metaDescription)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<link rel="alternate" hreflang="de" href="${escapeHtml(deUrl)}">
<link rel="alternate" hreflang="en" href="${escapeHtml(enUrl)}">
<link rel="alternate" hreflang="x-default" href="${escapeHtml(enUrl)}">
<link rel="alternate" type="text/plain" title="llms.txt" href="${escapeHtml(`${origin}/llms.txt`)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ShopCart MCP by wals.pro">
<meta property="og:locale" content="${de ? "de_DE" : "en_US"}">
<meta property="og:title" content="${escapeHtml(copy.metaTitle)}">
<meta property="og:description" content="${escapeHtml(copy.metaDescription)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(copy.metaTitle)}">
<meta name="twitter:description" content="${escapeHtml(copy.metaDescription)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="stylesheet" href="${FOR_MERCHANTS_CSS_PATH}?v=${assetVersion}">
${renderAnalyticsHead(config, { lang: copy.lang, pageType: "for_merchants" })}
<script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>
</head>
<body>
<a class="skip-link" href="#main-heading">${escapeHtml(copy.skipLabel)}</a>

<header class="site-header">
  <div class="wrap nav">
    <a class="brand" href="/?lang=${copy.lang}">
      ${renderSparkCartSvg({ size: 28, className: "brand-logo" })}
      ${renderShopCartWordmark()}
    </a>

    <nav class="nav-links" aria-label="${escapeHtml(copy.navAriaLabel)}">
      <a class="hide-sm" href="/?lang=${copy.lang}">${escapeHtml(copy.navHome)}</a>
      <a class="hide-sm" href="${escapeHtml(copy.checkPath)}">${escapeHtml(copy.navCheck)}</a>
      <a class="hide-md" href="/guides?lang=${copy.lang}">${escapeHtml(copy.navGuides)}</a>
      <a class="nav-active" href="${escapeHtml(copy.canonicalPath)}" aria-current="page">${escapeHtml(copy.navMerchants)}</a>
      <div class="nav-actions">
        <a class="btn-nav hide-xs" href="/billing?lang=${copy.lang}">${escapeHtml(copy.navAccount)}</a>
        <a class="btn-nav btn-lang" href="${escapeHtml(copy.switchPath)}" hreflang="${copy.otherLang}" aria-label="${escapeHtml(copy.langSwitchAria)}">${escapeHtml(copy.langSwitchLabel)}</a>
      </div>
    </nav>
  </div>
</header>

<main>
  <section class="fm-hero">
    <div class="wrap fm-hero-inner">
      <div class="eyebrow">
        <span class="eyebrow-dot" aria-hidden="true"></span>
        <span>${escapeHtml(copy.eyebrow)}</span>
      </div>

      <h1 id="main-heading" class="hero-title" tabindex="-1">${escapeHtml(copy.heroTitleLine1)} <span class="title-accent">${escapeHtml(copy.heroTitleAccent)}</span></h1>

      <p class="hero-lead">${escapeHtml(copy.heroLead)}</p>

      <div class="fm-hero-actions">
        <a class="btn-primary" href="${escapeHtml(copy.checkPath)}" data-analytics-event="for_merchants_cta_click" data-analytics-cta="self_check" data-analytics-lang="${copy.lang}">${escapeHtml(copy.primaryCtaLabel)} <span aria-hidden="true">→</span></a>
        <a class="btn-secondary" href="${WALSPRO_BOOKING_URL}" target="_blank" rel="noopener noreferrer" data-analytics-event="for_merchants_cta_click" data-analytics-cta="book_call" data-analytics-lang="${copy.lang}">${escapeHtml(copy.secondaryCtaLabel)} <span aria-hidden="true">↗</span></a>
      </div>
      <p class="fm-cta-sub">${escapeHtml(copy.primaryCtaSub)}</p>

      <ul class="trust-strip" role="list">
        ${heroSignalsHtml}
      </ul>

      <aside class="fm-trust-callout" aria-labelledby="trust-guarantee-heading">
        <div class="fm-trust-badge-row">
          <svg class="fm-shield-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M12 2.5L4 6v5.5c0 5.1 3.4 9.7 8 11 4.6-1.3 8-5.9 8-11V6l-8-3.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M8.5 12.2l2.3 2.3 4.8-4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="fm-trust-pill">${escapeHtml(copy.trustBadge)}</span>
        </div>
        <h2 id="trust-guarantee-heading">${escapeHtml(copy.trustHeading)}</h2>
        <p class="fm-trust-promise">${escapeHtml(copy.trustBody)}</p>
        <p class="fm-trust-note">${escapeHtml(copy.trustNote)}</p>
      </aside>
    </div>
  </section>

  <section class="section fm-section-alt">
    <div class="wrap">
      <div class="fm-selfcheck-panel">
        <div class="fm-selfcheck-copy">
          <span class="section-kicker">${escapeHtml(copy.selfCheckKicker)}</span>
          <h2 class="section-title">${escapeHtml(copy.selfCheckTitle)}</h2>
          <p class="section-sub">${escapeHtml(copy.selfCheckLead)}</p>
          <ul class="fm-check-list" role="list">
            ${selfCheckBulletsHtml}
          </ul>
          <div class="fm-panel-actions">
            <a class="btn-primary" href="${escapeHtml(copy.checkPath)}" data-analytics-event="for_merchants_cta_click" data-analytics-cta="self_check" data-analytics-lang="${copy.lang}">${escapeHtml(copy.selfCheckCta)} <span aria-hidden="true">→</span></a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${escapeHtml(copy.problemKicker)}</span>
        <h2 class="section-title">${escapeHtml(copy.problemTitle)}</h2>
        <p class="section-sub">${escapeHtml(copy.problemSub)}</p>
      </div>
      <div class="fm-grid-2">
        ${problemsHtml}
      </div>
    </div>
  </section>

  <section class="section fm-section-alt">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${escapeHtml(copy.platformsKicker)}</span>
        <h2 class="section-title">${escapeHtml(copy.platformsTitle)}</h2>
        <p class="section-sub">${escapeHtml(copy.platformsSub)}</p>
      </div>
      <ul class="fm-platforms-grid" role="list">
        ${platformsHtml}
      </ul>
    </div>
  </section>

  <section class="section" id="deliverables">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${escapeHtml(copy.deliverablesKicker)}</span>
        <h2 class="section-title">${escapeHtml(copy.deliverablesTitle)}</h2>
        <p class="section-sub">${escapeHtml(copy.deliverablesSub)}</p>
      </div>
      <div class="fm-grid-3">
        ${deliverablesHtml}
      </div>
    </div>
  </section>

  <section class="section fm-section-alt">
    <div class="wrap">
      <div class="section-head">
        <span class="section-kicker">${escapeHtml(copy.processKicker)}</span>
        <h2 class="section-title">${escapeHtml(copy.processTitle)}</h2>
        <p class="section-sub">${escapeHtml(copy.processSub)}</p>
      </div>
      <ol class="fm-steps-grid" role="list">
        ${stepsHtml}
      </ol>
    </div>
  </section>

  <section class="section" id="contact">
    <div class="wrap">
      <div class="fm-cta-box">
        <span class="section-kicker">${escapeHtml(copy.ctaKicker)}</span>
        <h2 class="section-title">${escapeHtml(copy.ctaTitle)}</h2>
        <p class="section-sub">${escapeHtml(copy.ctaLead)}</p>

        <div class="fm-cta-actions">
          <a class="btn-primary" href="${WALSPRO_BOOKING_URL}" target="_blank" rel="noopener noreferrer" data-analytics-event="for_merchants_cta_click" data-analytics-cta="book_call" data-analytics-lang="${copy.lang}">${escapeHtml(copy.ctaPrimaryLabel)} <span aria-hidden="true">↗</span></a>
          <a class="btn-secondary" href="${escapeHtml(copy.checkPath)}" data-analytics-event="for_merchants_cta_click" data-analytics-cta="self_check" data-analytics-lang="${copy.lang}">${escapeHtml(copy.ctaSecondaryLabel)} <span aria-hidden="true">→</span></a>
        </div>

        <p class="fm-cta-trust"><strong>${escapeHtml(copy.trustBadge)}:</strong> ${escapeHtml(copy.ctaTrustReinforce)}</p>
        <p class="fm-operator-note"><strong>${escapeHtml(copy.operatorLabel)}</strong> ${escapeHtml(copy.operatorText)} · <a href="https://wals.pro" target="_blank" rel="noopener noreferrer">wals.pro</a></p>
      </div>
    </div>
  </section>

  <section class="section fm-section-alt" aria-labelledby="merchant-faq-heading">
    <div class="wrap wrap-narrow">
      <div class="section-head">
        <span class="section-kicker">${escapeHtml(copy.faqKicker)}</span>
        <h2 id="merchant-faq-heading" class="section-title">${escapeHtml(copy.faqTitle)}</h2>
      </div>
      <div class="fm-faq-list">
        ${faqHtml}
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
        <a href="/?lang=${copy.lang}">${escapeHtml(copy.footerHome)}</a>
        <a href="${escapeHtml(copy.checkPath)}">${escapeHtml(copy.footerCheck)}</a>
        <a href="/guides?lang=${copy.lang}">${escapeHtml(copy.footerGuides)}</a>
        <a href="/billing?lang=${copy.lang}">${escapeHtml(copy.footerBilling)}</a>
        <a href="/privacy?lang=${copy.lang}">${escapeHtml(copy.footerPrivacy)}</a>
        <a href="/terms?lang=${copy.lang}">${escapeHtml(copy.footerTerms)}</a>
        <a href="https://wals.pro/policies/legal-notice" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.footerLegalNotice)}</a>
        ${renderCookieSettingsFooterLink(config, copy.lang)}
      </div>
    </div>
    <p class="disclaimer">${escapeHtml(getTrademarkDisclaimer(copy.lang))}</p>
  </div>
</footer>
${renderConsentBanner(config, copy.lang)}
</body>
</html>`;
}

export const FOR_MERCHANTS_CSS = `:root {
  color-scheme: dark;

  --walspro-accent: #ff1f4d;
  --walspro-accent-rgb: 255, 31, 77;
  --walspro-on-accent: #000000;
  --walspro-accent-grad: linear-gradient(115deg, #ff6b7a 0%, #ff1f4d 54%, #ff8a5b 100%);

  --walspro-bg: #141414;
  --walspro-bg-2: #0d0d0d;
  --walspro-bg-deep: #090909;
  --walspro-surface: #1a1a1a;
  --walspro-surface-raised: #202020;
  --walspro-border: #2a2a2a;
  --walspro-divider: #242424;
  --walspro-border-strong: #3a3a3a;

  --walspro-ink: #e0e0e0;
  --walspro-muted: #a7adb4;
  --walspro-hint: #8b919b;

  --walspro-tone-positive-fg: #7bd88f;
  --walspro-tone-positive-bg: rgba(76, 175, 80, 0.12);
  --walspro-tone-positive-border: rgba(76, 175, 80, 0.34);

  --walspro-tone-primary-fg: #ff6b7a;
  --walspro-tone-primary-bg: rgba(var(--walspro-accent-rgb), 0.12);
  --walspro-tone-primary-border: rgba(var(--walspro-accent-rgb), 0.34);

  --walspro-font-display: "WALSPRO Display", "TTFirs Neue", "Inter", system-ui, sans-serif;
  --walspro-font-body: "WALSPRO Body", "Inter", "Avenir Next", system-ui, sans-serif;
  --walspro-font-mono: "SFMono-Regular", "Cascadia Code", "Liberation Mono", ui-monospace, monospace;
  --walspro-radius-card: 16px;
  --walspro-radius-pill: 999px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
  background-color: var(--walspro-bg-deep);
  max-width: 100%;
  overflow-x: clip;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}

body {
  margin: 0;
  min-height: 100dvh;
  max-width: 100%;
  overflow-x: clip;
  font-family: var(--walspro-font-body);
  background:
    radial-gradient(54% 34% at 86% 0%, rgba(255, 31, 77, 0.12), transparent 62%),
    radial-gradient(42% 28% at 10% 16%, rgba(255, 138, 91, 0.05), transparent 62%),
    var(--walspro-bg);
  color: var(--walspro-ink);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

:where(main, section, header, footer, article, aside, nav, details, .wrap, .wrap > *) {
  min-width: 0;
  max-width: 100%;
}

a {
  color: inherit;
}

:focus-visible {
  outline: 2px solid var(--walspro-accent);
  outline-offset: 3px;
}

.wrap {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 24px;
}

.wrap-narrow {
  max-width: 840px;
}

.skip-link {
  position: absolute;
  left: 12px;
  top: -64px;
  z-index: 60;
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--walspro-accent);
  color: var(--walspro-on-accent);
  font-weight: 700;
  text-decoration: none;
}

.skip-link:focus {
  top: 12px;
}

/* Header */
.site-header {
  position: sticky;
  top: 0;
  z-index: 25;
  background: rgba(9, 9, 9, 0.88);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--walspro-divider);
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 62px;
  gap: 16px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  font-family: var(--walspro-font-display);
  font-weight: 750;
  font-size: 18px;
  letter-spacing: -0.02em;
  color: #ffffff;
  flex-shrink: 0;
}

.brand-logo {
  width: 28px;
  height: 28px;
  display: block;
  flex-shrink: 0;
}

.brand-accent {
  color: #ff2d59;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 20px;
  font-size: 14px;
  color: var(--walspro-muted);
}

.nav-links a {
  text-decoration: none;
  transition: color 120ms ease;
}

.nav-links a:hover,
.nav-links a.nav-active {
  color: #ffffff;
}

.nav-links a.nav-active {
  font-weight: 650;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 38px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--walspro-border-strong);
  background: var(--walspro-surface);
  color: var(--walspro-ink);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.btn-nav:hover {
  border-color: var(--walspro-tone-primary-border);
  background: var(--walspro-surface-raised);
}

.btn-lang {
  min-inline-size: 44px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

/* Hero */
.fm-hero {
  background:
    radial-gradient(48% 54% at 84% 18%, rgba(255, 31, 77, 0.14), transparent 68%),
    var(--walspro-bg-deep);
  border-bottom: 1px solid var(--walspro-divider);
}

.fm-hero-inner {
  padding-top: 52px;
  padding-bottom: 64px;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 6px 14px 6px 11px;
  border-radius: var(--walspro-radius-pill);
  background: rgba(26, 26, 26, 0.9);
  border: 1px solid var(--walspro-border-strong);
  color: var(--walspro-ink);
  font-size: 13px;
  font-weight: 600;
}

.eyebrow-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--walspro-accent);
  box-shadow: 0 0 0 4px rgba(var(--walspro-accent-rgb), 0.18);
  flex-shrink: 0;
}

.hero-title {
  margin: 20px 0 0;
  max-width: 820px;
  font-family: var(--walspro-font-display);
  font-size: clamp(34px, 4.5vw, 56px);
  font-weight: 760;
  line-height: 1.08;
  letter-spacing: -0.03em;
  color: #ffffff;
  text-wrap: balance;
}

.hero-title:focus {
  outline: none;
}

.title-accent {
  display: block;
  color: #ff6b7a;
  background: var(--walspro-accent-grad);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  padding-bottom: 0.06em;
}

.hero-lead {
  margin: 18px 0 0;
  max-width: 720px;
  font-size: clamp(16.5px, 1.45vw, 19px);
  line-height: 1.62;
  color: #cdd1d6;
}

.fm-hero-actions,
.fm-panel-actions,
.fm-cta-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 26px;
}

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-block-size: 48px;
  padding: 12px 22px;
  border-radius: 14px;
  font-family: var(--walspro-font-body);
  font-size: 15.5px;
  font-weight: 720;
  line-height: 1.25;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: transform 140ms ease, filter 140ms ease, border-color 140ms ease, background-color 140ms ease;
}

.btn-primary {
  background: var(--walspro-accent);
  color: var(--walspro-on-accent);
  border: 1px solid transparent;
  box-shadow: 0 12px 32px rgba(var(--walspro-accent-rgb), 0.28);
}

.btn-primary:hover {
  transform: translateY(-1px);
  filter: brightness(1.07);
}

.btn-secondary {
  background: var(--walspro-surface);
  color: #ffffff;
  border: 1px solid var(--walspro-border-strong);
}

.btn-secondary:hover {
  transform: translateY(-1px);
  border-color: var(--walspro-tone-primary-border);
  background: var(--walspro-surface-raised);
}

.fm-cta-sub {
  margin: 12px 0 0;
  font-size: 13.5px;
  color: var(--walspro-muted);
}

.trust-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
  margin: 22px 0 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  color: var(--walspro-muted);
}

.trust-strip li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.trust-strip li::before {
  content: "✓";
  color: #ff6b7a;
  font-weight: 800;
}

/* Prominent 100% Independence Callout */
.fm-trust-callout {
  margin-top: 34px;
  padding: 24px 26px;
  border-radius: 18px;
  border: 1px solid var(--walspro-tone-positive-border);
  background:
    linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(26, 26, 26, 0.94) 55%),
    var(--walspro-surface);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42);
}

.fm-trust-badge-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--walspro-tone-positive-fg);
}

.fm-shield-icon {
  flex-shrink: 0;
}

.fm-trust-pill {
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.fm-trust-callout h2 {
  margin: 10px 0 0;
  font-family: var(--walspro-font-display);
  font-size: 21px;
  font-weight: 740;
  letter-spacing: -0.02em;
  color: #ffffff;
}

.fm-trust-promise {
  margin: 10px 0 0;
  font-size: 16.5px;
  font-weight: 600;
  line-height: 1.55;
  color: #ffffff;
}

.fm-trust-note {
  margin: 10px 0 0;
  font-size: 14.5px;
  color: var(--walspro-muted);
}

/* Sections */
.section {
  padding: 72px 0;
  border-bottom: 1px solid var(--walspro-divider);
}

.fm-section-alt {
  background: var(--walspro-bg-2);
}

.section-head {
  max-width: 760px;
  margin-bottom: 32px;
}

.section-kicker {
  display: inline-block;
  font-size: 12.5px;
  font-weight: 750;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #ff6b7a;
}

.section-title {
  margin: 10px 0 0;
  font-family: var(--walspro-font-display);
  font-size: clamp(25px, 3vw, 36px);
  font-weight: 750;
  line-height: 1.15;
  letter-spacing: -0.025em;
  color: #ffffff;
  text-wrap: balance;
}

.section-sub {
  margin: 12px 0 0;
  font-size: 16.5px;
  line-height: 1.6;
  color: var(--walspro-muted);
}

/* Self-check bridge panel */
.fm-selfcheck-panel {
  padding: 32px;
  border-radius: 20px;
  border: 1px solid var(--walspro-tone-primary-border);
  background:
    radial-gradient(60% 80% at 100% 0%, rgba(255, 31, 77, 0.12), transparent 68%),
    var(--walspro-surface);
}

.fm-check-list {
  display: grid;
  gap: 12px;
  margin: 22px 0 0;
  padding: 0;
  list-style: none;
}

.fm-check-list li {
  position: relative;
  padding-left: 24px;
  font-size: 15.5px;
  color: var(--walspro-ink);
}

.fm-check-list li::before {
  content: "✓";
  position: absolute;
  left: 0;
  top: 0;
  color: #ff6b7a;
  font-weight: 800;
}

.fm-check-list strong {
  color: #ffffff;
}

/* Cards & Grids */
.fm-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.fm-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.fm-card {
  padding: 24px;
  border-radius: var(--walspro-radius-card);
  border: 1px solid var(--walspro-border);
  background: var(--walspro-surface);
}

.fm-card h3 {
  margin: 0;
  font-family: var(--walspro-font-display);
  font-size: 18px;
  font-weight: 720;
  line-height: 1.28;
  color: #ffffff;
}

.fm-deliverable h3 {
  margin-top: 12px;
}

.fm-card p {
  margin: 10px 0 0;
  font-size: 14.5px;
  line-height: 1.58;
  color: var(--walspro-muted);
}

.fm-card-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--walspro-radius-pill);
  border: 1px solid var(--walspro-tone-primary-border);
  background: var(--walspro-tone-primary-bg);
  color: #ff8a96;
  font-family: var(--walspro-font-mono);
  font-size: 11.5px;
  font-weight: 700;
}

/* Platforms grid */
.fm-platforms-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fm-platform-item {
  padding: 18px 20px;
  border-radius: var(--walspro-radius-card);
  border: 1px solid var(--walspro-border);
  background: var(--walspro-surface);
}

.fm-platform-name {
  display: block;
  font-family: var(--walspro-font-display);
  font-size: 16.5px;
  font-weight: 720;
  color: #ffffff;
}

.fm-platform-note {
  display: block;
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--walspro-muted);
}

/* Process steps */
.fm-steps-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fm-step {
  padding: 24px;
  border-radius: var(--walspro-radius-card);
  border: 1px solid var(--walspro-border);
  background: var(--walspro-surface);
}

.fm-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: 1px solid var(--walspro-tone-primary-border);
  background: var(--walspro-tone-primary-bg);
  color: #ff8a96;
  font-family: var(--walspro-font-display);
  font-size: 15px;
  font-weight: 800;
}

.fm-step h3 {
  margin: 14px 0 0;
  font-family: var(--walspro-font-display);
  font-size: 18px;
  font-weight: 720;
  color: #ffffff;
}

.fm-step p {
  margin: 8px 0 0;
  font-size: 14.5px;
  line-height: 1.58;
  color: var(--walspro-muted);
}

/* Bottom B2B CTA Box */
.fm-cta-box {
  padding: 36px;
  border-radius: 22px;
  border: 1px solid var(--walspro-border-strong);
  background:
    radial-gradient(55% 75% at 92% 0%, rgba(255, 31, 77, 0.14), transparent 70%),
    var(--walspro-surface);
}

.fm-cta-trust {
  margin: 24px 0 0;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--walspro-tone-positive-border);
  background: var(--walspro-tone-positive-bg);
  font-size: 14px;
  line-height: 1.55;
  color: var(--walspro-ink);
}

.fm-cta-trust strong {
  color: var(--walspro-tone-positive-fg);
}

.fm-operator-note {
  margin: 16px 0 0;
  font-size: 13.5px;
  color: var(--walspro-muted);
}

.fm-operator-note strong {
  color: var(--walspro-ink);
}

.fm-operator-note a {
  color: #ff6b7a;
  font-weight: 650;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.fm-operator-note a:hover {
  color: #ffffff;
}

/* FAQ Accordion */
.fm-faq-list {
  display: grid;
  gap: 12px;
}

.fm-faq-item {
  border-radius: var(--walspro-radius-card);
  border: 1px solid var(--walspro-border);
  background: var(--walspro-surface);
  overflow: hidden;
}

.fm-faq-item summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  cursor: pointer;
  list-style: none;
  font-family: var(--walspro-font-display);
  font-size: 16.5px;
  font-weight: 700;
  color: #ffffff;
}

.fm-faq-item summary::-webkit-details-marker {
  display: none;
}

.fm-faq-icon {
  position: relative;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.fm-faq-icon::before,
.fm-faq-icon::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 2px;
  background: #ff6b7a;
  border-radius: 2px;
  transform: translate(-50%, -50%);
  transition: transform 160ms ease, opacity 160ms ease;
}

.fm-faq-icon::after {
  transform: translate(-50%, -50%) rotate(90deg);
}

.fm-faq-item[open] .fm-faq-icon::after {
  transform: translate(-50%, -50%) rotate(0deg);
  opacity: 0;
}

.fm-faq-answer {
  padding: 0 20px 18px;
}

.fm-faq-answer p {
  margin: 0;
  font-size: 15px;
  line-height: 1.62;
  color: var(--walspro-muted);
}

/* Footer */
.site-footer {
  padding: 36px 0 44px;
  border-top: 1px solid var(--walspro-divider);
  background: var(--walspro-bg-deep);
  font-size: 14px;
  color: var(--walspro-muted);
}

.foot-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 28px;
}

.foot-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.foot-brand strong {
  color: #ffffff;
}

.foot-mark {
  width: 20px;
  height: 20px;
  display: block;
  flex-shrink: 0;
}

.foot-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
}

.foot-links a,
.foot-brand a {
  text-decoration: none;
}

.foot-links a:hover,
.foot-brand a:hover {
  color: #ffffff;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.disclaimer {
  margin: 22px 0 0;
  max-width: 920px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--walspro-hint);
}

@media (prefers-reduced-motion: reduce) {
  .btn-primary,
  .btn-secondary,
  .fm-faq-icon::before,
  .fm-faq-icon::after {
    transition: none;
  }
}

/* Responsive */
@media (max-width: 960px) {
  .hide-md {
    display: none;
  }

  .fm-grid-3,
  .fm-platforms-grid,
  .fm-steps-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .hide-sm {
    display: none;
  }

  .wrap {
    padding: 0 18px;
  }

  .fm-hero-inner {
    padding-top: 36px;
    padding-bottom: 48px;
  }

  .section {
    padding: 52px 0;
  }

  .fm-grid-2,
  .fm-grid-3,
  .fm-platforms-grid,
  .fm-steps-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .fm-trust-callout,
  .fm-selfcheck-panel,
  .fm-cta-box,
  .fm-card,
  .fm-step {
    padding: 20px;
  }

  .fm-hero-actions .btn-primary,
  .fm-hero-actions .btn-secondary,
  .fm-panel-actions .btn-primary,
  .fm-cta-actions .btn-primary,
  .fm-cta-actions .btn-secondary {
    width: 100%;
  }

  .foot-row {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 440px) {
  .hide-xs {
    display: none;
  }

  .nav-links {
    gap: 12px;
  }
}

/* Forced colors (Windows high contrast) */
@media (forced-colors: active) {
  .btn-primary,
  .btn-secondary,
  .btn-nav,
  .fm-card,
  .fm-step,
  .fm-platform-item,
  .fm-trust-callout,
  .fm-selfcheck-panel,
  .fm-cta-box,
  .fm-faq-item,
  .fm-cta-trust {
    border: 1px solid CanvasText;
  }

  .title-accent {
    background: none;
    -webkit-text-fill-color: currentColor;
  }
}
`;

function sendForMerchantsHtml(res: Response, html: string, lang: Lang, csp: string): void {
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Content-Language", lang);
  res.status(200).type("html").send(html);
}

export function createForMerchantsRouter(config: AppConfig): Router {
  const router = Router();
  const csp = buildGuidesCsp(config.ga4MeasurementId);

  router.get(FOR_MERCHANTS_CSS_PATH, (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(FOR_MERCHANTS_CSS);
  });

  router.get(FOR_MERCHANTS_DE_PATH, (_req: Request, res: Response) => {
    sendForMerchantsHtml(res, renderForMerchantsPage(config, "de"), "de", csp);
  });

  router.get(FOR_MERCHANTS_EN_PATH, (_req: Request, res: Response) => {
    sendForMerchantsHtml(res, renderForMerchantsPage(config, "en"), "en", csp);
  });

  return router;
}
