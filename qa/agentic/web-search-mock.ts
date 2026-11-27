import type { AnthropicToolDefinition } from "./types.js";

/**
 * Realistic competing `web_search` tool definition matching Claude.ai Web/Mobile.
 * Injected alongside the real ShopCart MCP tools so the agent must genuinely
 * choose between ShopCart tools and built-in web search.
 */
export const COMPETING_WEB_SEARCH_TOOL: AnthropicToolDefinition = {
  name: "web_search",
  description:
    "Search the web for up-to-date information, news, facts, weather, products, prices, reviews, and websites.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to look up on the web."
      }
    },
    required: ["query"]
  }
};

export interface WebSearchSnippet {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchMockResult {
  query: string;
  results: WebSearchSnippet[];
}

/**
 * Deterministic mock web_search response.
 * - For non-shopping queries (e.g. Vienna weather / U-Bahn Stephansplatz), returns helpful factual snippets.
 * - For shopping queries, returns realistic generic web snippets (vague approximate prices,
 *   no verified live stock, no cart permalink), mimicking real Claude.ai web search behavior.
 */
export function runMockWebSearch(query: string): WebSearchMockResult {
  const q = query.toLowerCase();

  if (q.includes("wetter") || q.includes("weather") || q.includes("wien") || q.includes("stephansplatz") || q.includes("u-bahn")) {
    return {
      query,
      results: [
        {
          title: "Wetter Wien — Vorhersage für morgen (ZAMG / GeoSphere Austria)",
          url: "https://websearch-snippet.example/wetter-wien-morgen",
          snippet:
            "Morgen in Wien überwiegend bewölkt mit einzelnen Auflockerungen, Höchsttemperaturen um 7 °C, Tiefstwerte um 2 °C, schwacher Südostwind."
        },
        {
          title: "Wiener Linien: U-Bahn Station Stephansplatz (U1, U3)",
          url: "https://websearch-snippet.example/wiener-linien-stephansplatz",
          snippet:
            "Die Station Stephansplatz im 1. Bezirk wird direkt von den U-Bahn-Linien U1 (rot) und U3 (orange) angefahren."
        }
      ]
    };
  }

  const slug = encodeURIComponent(query.trim().slice(0, 60));
  return {
    query,
    results: [
      {
        title: `General web results for "${query}"`,
        url: `https://websearch-snippet.example/search?q=${slug}`,
        snippet:
          "Multiple retailers and blogs discuss this product. Exact live stock, size availability, verified promo codes, and direct cart links are not confirmed in this cached search snippet."
      },
      {
        title: `Buying guide & overview: ${query}`,
        url: `https://websearch-snippet.example/guide?q=${slug}`,
        snippet:
          "Prices vary widely by region and seller; check individual merchant sites for current availability and checkout."
      }
    ]
  };
}
