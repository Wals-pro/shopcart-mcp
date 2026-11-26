import type { Lang } from "../auth/pages.js";

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
  headers: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
}

export interface GuideSeasonalNote {
  label: string;
  text: string;
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
  seasonalNote?: GuideSeasonalNote;
  intro: string;
  takeawaysHeading: string;
  takeaways: Array<{ lead: string; text: string }>;
  primaryAssistant: "claude" | "chatgpt" | "gemini";
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

export const PUBLISHED_ISO = "2026-11-25";
export const UPDATED_ISO = "2026-11-26";

export const SOURCES_DE: GuideSource[] = [
  {
    label: "ShopCart MCP Produktseite & Dokumentation",
    url: "https://shopcart.wals.pro/?lang=de",
    retrieved: "26.11.2026"
  },
  {
    label: "ShopCart MCP Open-Source-Repository auf GitHub (MIT-Lizenz)",
    url: "https://github.com/Wals-pro/shopcart-mcp",
    retrieved: "26.11.2026"
  },
  {
    label: "Shopify Developer Docs: Create cart permalinks",
    url: "https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks",
    retrieved: "26.11.2026"
  },
  {
    label: "Model Context Protocol — Offizielle Einführung",
    url: "https://modelcontextprotocol.io/docs/getting-started/intro",
    retrieved: "26.11.2026"
  }
];

export const SOURCES_EN: GuideSource[] = [
  {
    label: "ShopCart MCP Product Page & Documentation",
    url: "https://shopcart.wals.pro/?lang=en",
    retrieved: "2026-11-26"
  },
  {
    label: "ShopCart MCP Open-Source Repository on GitHub (MIT License)",
    url: "https://github.com/Wals-pro/shopcart-mcp",
    retrieved: "2026-11-26"
  },
  {
    label: "Shopify Developer Docs: Create cart permalinks",
    url: "https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks",
    retrieved: "2026-11-26"
  },
  {
    label: "Model Context Protocol — Official Introduction",
    url: "https://modelcontextprotocol.io/docs/getting-started/intro",
    retrieved: "2026-11-26"
  }
];

export const AMAZON_SOURCES_DE: GuideSource[] = [
  ...SOURCES_DE,
  {
    label: "Amazon Product Advertising API 5.0: Add to Cart Form (/gp/aws/cart/add.html)",
    url: "https://webservices.amazon.com/paapi5/documentation/add-to-cart-form.html",
    retrieved: "26.11.2026"
  },
  {
    label: "WooCommerce Developer Docs: Store API Overview",
    url: "https://developer.woocommerce.com/docs/apis/store-api/",
    retrieved: "26.11.2026"
  }
];

export const AMAZON_SOURCES_EN: GuideSource[] = [
  ...SOURCES_EN,
  {
    label: "Amazon Product Advertising API 5.0: Add to Cart Form (/gp/aws/cart/add.html)",
    url: "https://webservices.amazon.com/paapi5/documentation/add-to-cart-form.html",
    retrieved: "2026-11-26"
  },
  {
    label: "WooCommerce Developer Docs: Store API Overview",
    url: "https://developer.woocommerce.com/docs/apis/store-api/",
    retrieved: "2026-11-26"
  }
];

export const SHOPIFY_MCP_SOURCES_DE: GuideSource[] = [
  ...SOURCES_DE,
  {
    label: "Shopify Developer Docs: Shopify AI Toolkit & Dev MCP",
    url: "https://shopify.dev/docs/api/ai-toolkit",
    retrieved: "26.11.2026"
  },
  {
    label: "Shopify Developer Docs: Migrate from Storefront MCP (UCP)",
    url: "https://shopify.dev/docs/apps/build/storefront-mcp",
    retrieved: "26.11.2026"
  }
];

export const SHOPIFY_MCP_SOURCES_EN: GuideSource[] = [
  ...SOURCES_EN,
  {
    label: "Shopify Developer Docs: Shopify AI Toolkit & Dev MCP",
    url: "https://shopify.dev/docs/api/ai-toolkit",
    retrieved: "2026-11-26"
  },
  {
    label: "Shopify Developer Docs: Migrate from Storefront MCP (UCP)",
    url: "https://shopify.dev/docs/apps/build/storefront-mcp",
    retrieved: "2026-11-26"
  }
];

export const GEMINI_SOURCES_DE: GuideSource[] = [
  ...SOURCES_DE,
  {
    label: "Google Gemini CLI Dokumentation: MCP Server & Extensions",
    url: "https://github.com/google-gemini/gemini-cli",
    retrieved: "26.11.2026"
  },
  {
    label: "Google AI for Developers: Gemini API Function Calling & MCP (mcpToTool)",
    url: "https://ai.google.dev/gemini-api/docs/function-calling",
    retrieved: "26.11.2026"
  }
];

export const GEMINI_SOURCES_EN: GuideSource[] = [
  ...SOURCES_EN,
  {
    label: "Google Gemini CLI Documentation: MCP Servers & Extensions",
    url: "https://github.com/google-gemini/gemini-cli",
    retrieved: "2026-11-26"
  },
  {
    label: "Google AI for Developers: Gemini API Function Calling & MCP (mcpToTool)",
    url: "https://ai.google.dev/gemini-api/docs/function-calling",
    retrieved: "2026-11-26"
  }
];
