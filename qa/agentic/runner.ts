import { execFileSync } from "node:child_process";
import { callAnthropicMessages, redactSecrets } from "./anthropic-client.js";
import { createMcpTestSession, type McpTestSession } from "./fixtures.js";
import {
  aggregateModeMetrics,
  estimateCostUsd,
  extractToolOutputFacts,
  gradeScenarioRun
} from "./grader.js";
import { buildSystemPrompt } from "./prompts.js";
import { AGENTIC_SCENARIOS } from "./scenarios.js";
import type {
  AgenticScenario,
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicToolDefinition,
  EvalMode,
  ModeSummaryMetrics,
  ScenarioRunResult,
  SuiteReport,
  TokenUsage,
  ToolCallTrace
} from "./types.js";
import { COMPETING_WEB_SEARCH_TOOL, runMockWebSearch } from "./web-search-mock.js";

export type LlmDriver = (
  request: AnthropicMessagesRequest,
  context: { scenario: AgenticScenario; mode: EvalMode; turn: number }
) => Promise<AnthropicMessagesResponse>;

const MAX_AGENT_TURNS = 8;
const MAX_TOKENS_PER_TURN = 1024;
const RESULT_PREVIEW_LIMIT = 400;

function readGitMetadata(): { commit: string | null; branch: string | null } {
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return { commit: commit || null, branch: branch || null };
  } catch {
    return { commit: null, branch: null };
  }
}

function addUsage(target: TokenUsage, delta: AnthropicMessagesResponse["usage"]): void {
  target.input_tokens += delta.input_tokens ?? 0;
  target.output_tokens += delta.output_tokens ?? 0;
  target.cache_creation_input_tokens += delta.cache_creation_input_tokens ?? 0;
  target.cache_read_input_tokens += delta.cache_read_input_tokens ?? 0;
}

function extractTextFromResponse(resp: AnthropicMessagesResponse): string {
  return resp.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function getLatestToolResults(messages: AnthropicMessage[]): Array<{ content: string; isError: boolean }> {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !Array.isArray(last.content)) return [];
  return last.content
    .filter(
      (b): b is { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean } =>
        b.type === "tool_result"
    )
    .map((b) => ({ content: b.content, isError: Boolean(b.is_error) }));
}

function parseJsonSafe(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic offline LLM simulator for `--dry-run` and CI self-tests.
 * Drives the REAL MCP server over InMemoryTransport through realistic multi-turn tool calls,
 * parses actual MCP tool responses, and emits grounded answers without any API key or network.
 */
export function createDryRunDriver(model: string): LlmDriver {
  return async (req, { scenario, turn }) => {
    const usage = {
      input_tokens: 450 + turn * 120,
      output_tokens: 95,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: turn > 1 ? 300 : 0
    };

    const mkToolUse = (
      calls: Array<{ name: string; input: Record<string, unknown> }>
    ): AnthropicMessagesResponse => ({
      id: `dryrun_${scenario.id}_t${turn}`,
      type: "message",
      role: "assistant",
      model,
      stop_reason: "tool_use",
      usage,
      content: calls.map((c, idx) => ({
        type: "tool_use" as const,
        id: `toolu_dry_${scenario.id}_${turn}_${idx}`,
        name: c.name,
        input: c.input
      }))
    });

    const mkFinalText = (text: string): AnthropicMessagesResponse => ({
      id: `dryrun_${scenario.id}_t${turn}`,
      type: "message",
      role: "assistant",
      model,
      stop_reason: "end_turn",
      usage,
      content: [{ type: "text", text }]
    });

    const latestResults = getLatestToolResults(req.messages);
    const parsedResults = latestResults.map((r) => parseJsonSafe(r.content));

    // Multi-step cart flows (3 turns of tool calls + final grounded answer)
    if (scenario.id === "multistep-cart-de") {
      if (turn === 1) {
        return mkToolUse([
          { name: "search_products", input: { store_url: "allbirds.com", query: "Wool Runner" } }
        ]);
      }
      if (turn === 2) {
        const products = (parsedResults[0]?.products as Array<{ handle?: string }> | undefined) ?? [];
        const handle = products[0]?.handle ?? "mens-wool-runner";
        return mkToolUse([
          { name: "get_product", input: { store_url: "allbirds.com", handle_or_url: handle } }
        ]);
      }
      if (turn === 3) {
        const product = parsedResults[0]?.product as
          | { handle?: string; variants?: Array<{ id?: string; title?: string; available?: boolean }> }
          | undefined;
        const variant42 =
          product?.variants?.find((v) => /42/.test(v.title ?? "") && v.available) ??
          product?.variants?.[0];
        return mkToolUse([
          {
            name: "create_cart_link",
            input: {
              store_url: "allbirds.com",
              items: [{ variant_id: variant42?.id ?? "42001002", quantity: 1 }],
              verify_handles: [product?.handle ?? "mens-wool-runner"]
            }
          }
        ]);
      }
      const cartUrl = String(parsedResults[0]?.cart_url ?? "");
      const appliedCode = parsedResults[0]?.applied_discount_code
        ? ` (Rabattcode ${String(parsedResults[0].applied_discount_code)} automatisch angewendet)`
        : "";
      return mkFinalText(
        `Der Allbirds Men's Wool Runner in Größe EU 42 ist auf Lager und kostet 119.45 EUR (statt 135.00 EUR). Hier ist dein fertiger Warenkorb-Link${appliedCode}: ${cartUrl} — du kannst den Warenkorb direkt im Browser prüfen und bezahlen.`
      );
    }

    if (scenario.id === "multistep-cart-en") {
      if (turn === 1) {
        return mkToolUse([
          { name: "search_products", input: { store_url: "gymshark.com", query: "black t-shirt" } }
        ]);
      }
      if (turn === 2) {
        const products = (parsedResults[0]?.products as Array<{ handle?: string }> | undefined) ?? [];
        const handle = products[0]?.handle ?? "crest-classic-black-t-shirt";
        return mkToolUse([
          { name: "get_product", input: { store_url: "gymshark.com", handle_or_url: handle } }
        ]);
      }
      if (turn === 3) {
        const product = parsedResults[0]?.product as
          | { handle?: string; variants?: Array<{ id?: string; title?: string; available?: boolean }> }
          | undefined;
        const variantM =
          product?.variants?.find((v) => /\bM\b/.test(v.title ?? "") && v.available) ??
          product?.variants?.[0];
        return mkToolUse([
          {
            name: "create_cart_link",
            input: {
              store_url: "gymshark.com",
              items: [{ variant_id: variantM?.id ?? "51002002", quantity: 1 }],
              verify_handles: [product?.handle ?? "crest-classic-black-t-shirt"]
            }
          }
        ]);
      }
      const cartUrl = String(parsedResults[0]?.cart_url ?? "");
      return mkFinalText(
        `The Gymshark Crest Classic T-Shirt - Black in size M is in stock for 24.85 USD (compare at 30.00 USD). Here is your direct cart link: ${cartUrl}. Review and complete checkout in your browser.`
      );
    }

    // Turn 1 dispatches for all other scenarios
    if (turn === 1) {
      switch (scenario.id) {
        case "price-compare-de":
          return mkToolUse([
            { name: "compare_prices", input: { query: "Sony WH-1000XM5", country: "DE" } }
          ]);
        case "price-compare-en":
          return mkToolUse([
            { name: "compare_prices", input: { query: "Apple AirPods Pro 2", country: "US" } }
          ]);
        case "price-compare-at":
          return mkToolUse([
            { name: "compare_prices", input: { query: "Dyson V15 Detect", country: "AT" } }
          ]);
        case "secondhand-at-willhaben":
          return mkToolUse([
            {
              name: "search_secondhand_marketplaces",
              input: {
                query: "iPhone 15 Pro",
                region: "AT",
                marketplaces: ["willhaben_at", "refurbed_at"]
              }
            }
          ]);
        case "secondhand-de-kleinanzeigen-plz":
          return mkToolUse([
            {
              name: "search_secondhand_marketplaces",
              input: {
                query: "KitchenAid",
                region: "DE",
                postal_code: "80331",
                marketplaces: ["kleinanzeigen_de"]
              }
            }
          ]);
        case "secondhand-en-refurbished":
          return mkToolUse([
            {
              name: "search_secondhand_marketplaces",
              input: {
                query: "MacBook Air M2",
                region: "EU",
                condition: "refurbished"
              }
            }
          ]);
        case "hot-deals-de":
          return mkToolUse([
            { name: "find_hot_deals", input: { query: "Gaming Monitor", region: "DE" } }
          ]);
        case "hot-deals-en":
          return mkToolUse([
            { name: "find_hot_deals", input: { query: "espresso machine", region: "US" } }
          ]);
        case "store-discounts-de":
          return mkToolUse([
            { name: "find_store_discounts", input: { store_url: "allbirds.com" } }
          ]);
        case "discover-stores-de":
          return mkToolUse([
            { name: "discover_stores", input: { query: "nachhaltige sneaker", country: "EU" } }
          ]);
        case "discover-stores-en":
          return mkToolUse([
            { name: "discover_stores", input: { query: "specialty coffee beans" } }
          ]);
        case "store-policies-de":
          return mkToolUse([
            {
              name: "get_store_policies",
              input: {
                store_url: "allbirds.com",
                topic: "all",
                question: "Ab wann ist der Versand kostenlos und wie sind die Rückgabebedingungen?"
              }
            }
          ]);
        case "inspect-store-de":
          return mkToolUse([
            { name: "inspect_store", input: { store_url: "gymshark.com" } }
          ]);
        case "list-collections-de":
          return mkToolUse([
            { name: "list_collections", input: { store_url: "allbirds.com" } }
          ]);
        case "visual-match-de":
          return mkToolUse([
            {
              name: "match_visual_product",
              input: {
                product_type: "Thermosflasche",
                color: "matte red",
                material: "stainless steel wood lid",
                style_keywords: ["minimalist", "500 ml", "matte", "Holzdeckel"],
                target_stores: ["waterdrop.com"]
              }
            }
          ]);
        case "combo-new-vs-used-de":
          return mkToolUse([
            { name: "compare_prices", input: { query: "Nintendo Switch OLED", country: "DE" } },
            {
              name: "search_secondhand_marketplaces",
              input: { query: "Nintendo Switch OLED", region: "DE" }
            }
          ]);
        case "safety-readonly-order":
          return mkToolUse([
            { name: "compare_prices", input: { query: "Sony WH-1000XM5", country: "DE" } }
          ]);
        case "negative-non-shopping":
          return mkToolUse([
            { name: "web_search", input: { query: "Wetter morgen Wien U-Bahn Stephansplatz" } }
          ]);
        default:
          return mkFinalText("Dry-run fallback response.");
      }
    }

    // Turn 2 grounded final responses using URLs directly extracted from tool results
    const returnedUrls = latestResults.flatMap((r) => extractToolOutputFacts(r.content).urls);
    const primaryUrl = returnedUrls[0] ?? "";
    const secondUrl = returnedUrls[1] ?? "";

    switch (scenario.id) {
      case "safety-readonly-order":
        return mkFinalText(
          `Ich kann leider keine Bestellungen für dich aufgeben und auch nicht mit deiner Kreditkarte bezahlen — ich arbeite strikt read-only (nur lesend). Du kannst die Preise für die Sony WH-1000XM5 aber direkt über diesen Preisvergleich prüfen und selbst im gewünschten Shop bestellen: ${primaryUrl}`
        );
      case "negative-non-shopping":
        return mkFinalText(
          `Morgen wird es in Wien überwiegend bewölkt mit rund 2 bis 7 °C. Zum Stephansplatz fahren die U-Bahn-Linien U1 und U3. Quelle: ${primaryUrl}`
        );
      case "store-discounts-de":
        return mkFinalText(
          "Für allbirds.com wurde der öffentlich beworbene Gutscheincode WOOL15 (15 % Rabatt) gefunden, außerdem gibt es kostenlosen Standardversand ab 75.00 EUR."
        );
      case "store-policies-de":
        return mkFinalText(
          `Bei allbirds.com ist der Standardversand ab 75.00 EUR kostenlos (sonst 5.00 EUR, Lieferzeit 2-4 Werktage via DHL/DPD) und Rückgaben sind innerhalb von 30 Tagen kostenlos möglich. Details: ${primaryUrl}`
        );
      case "inspect-store-de":
        return mkFinalText(
          "gymshark.com läuft auf Shopify (Währung: USD, Land: US) ohne WAF-Einschränkungen und unterstützt direkte Produktsuche sowie Warenkorb-Links."
        );
      case "list-collections-de":
        return mkFinalText(
          `Bei allbirds.com gibt es unter anderem die Kollektionen Seasonal Sale, Bestsellers, Men's Wool & Tree Runners, Women's Wool & Tree Runners und Sustainable Apparel & Socks (${primaryUrl}).`
        );
      case "visual-match-de":
        return mkFinalText(
          `Passender Treffer zu deiner Beschreibung: Minimalist Matte Red Insulated Bottle with Wood Lid 500ml für 38.75 EUR (${primaryUrl}).`
        );
      case "combo-new-vs-used-de":
        return mkFinalText(
          `Hier ist der Vergleich für die Nintendo Switch OLED in Deutschland — Neupreise: ${primaryUrl} — Gebraucht & Refurbished: ${secondUrl || primaryUrl}`
        );
      default:
        return mkFinalText(
          primaryUrl
            ? `Hier sind die geprüften Ergebnisse aus dem Tool-Aufruf: ${primaryUrl}${secondUrl ? ` und ${secondUrl}` : ""}`
            : "Hier sind die geprüften Ergebnisse aus dem Tool-Aufruf."
        );
    }
  };
}

export async function runSingleScenario(opts: {
  scenario: AgenticScenario;
  mode: EvalMode;
  model: string;
  session: McpTestSession;
  driver: LlmDriver;
  maxTurns?: number;
}): Promise<ScenarioRunResult> {
  const { scenario, mode, model, session, driver } = opts;
  const maxTurns = opts.maxTurns ?? MAX_AGENT_TURNS;
  const startMs = Date.now();

  const systemPrompt = buildSystemPrompt(mode, session.serverInstructions);
  const tools: AnthropicToolDefinition[] = [...session.tools, COMPETING_WEB_SEARCH_TOOL];

  const messages: AnthropicMessage[] = [{ role: "user", content: scenario.userPrompt }];
  const toolCalls: ToolCallTrace[] = [];
  const usage: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  };

  let turns = 0;
  let stopReason = "unknown";
  let finalResponse = "";
  let fatalError: string | undefined;

  try {
    while (turns < maxTurns) {
      turns += 1;
      const response = await driver(
        {
          model,
          max_tokens: MAX_TOKENS_PER_TURN,
          temperature: 0,
          system: systemPrompt,
          tools,
          messages
        },
        { scenario, mode, turn: turns }
      );

      addUsage(usage, response.usage);
      stopReason = response.stop_reason;

      const assistantBlocks: AnthropicContentBlock[] = response.content.map((block) =>
        block.type === "text"
          ? { type: "text", text: block.text }
          : {
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input ?? {}
            }
      );
      messages.push({ role: "assistant", content: assistantBlocks });

      const toolUses = response.content.filter(
        (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
          b.type === "tool_use"
      );

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        finalResponse = extractTextFromResponse(response);
        break;
      }

      const toolResultBlocks: AnthropicContentBlock[] = [];
      for (const toolUse of toolUses) {
        const callStart = Date.now();
        const isWebSearch = toolUse.name === COMPETING_WEB_SEARCH_TOOL.name;
        const isShopcartTool = session.shopcartToolNames.has(toolUse.name);
        const toolInput =
          toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {};

        let resultText = "";
        let isError = false;

        if (isWebSearch) {
          const query = typeof toolInput.query === "string" ? toolInput.query : "";
          resultText = JSON.stringify(runMockWebSearch(query), null, 2);
        } else if (isShopcartTool) {
          const mcpRes = await session.callTool(toolUse.name, toolInput);
          resultText = mcpRes.text;
          isError = mcpRes.isError;
        } else {
          resultText = JSON.stringify({ error: `Unknown tool '${toolUse.name}'` });
          isError = true;
        }

        const facts = extractToolOutputFacts(resultText);
        toolCalls.push({
          turn: turns,
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          isShopcartTool,
          isWebSearch,
          input: toolInput,
          isError,
          durationMs: Date.now() - callStart,
          resultPreview:
            resultText.length > RESULT_PREVIEW_LIMIT
              ? `${resultText.slice(0, RESULT_PREVIEW_LIMIT)}...`
              : resultText,
          returnedUrls: facts.urls,
          returnedPrices: facts.prices
        });

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultText,
          ...(isError ? { is_error: true } : {})
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });
    }

    if (!finalResponse && stopReason === "tool_use") {
      fatalError = `Exceeded max turns (${maxTurns}) without final response`;
    }
  } catch (err) {
    fatalError = err instanceof Error ? redactSecrets(err.message) : String(err);
    stopReason = "error";
  }

  const grade = gradeScenarioRun(scenario, toolCalls, finalResponse);
  if (fatalError) {
    grade.overallPassed = false;
    grade.failureReasons.push(`Execution error: ${fatalError}`);
  }

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    category: scenario.category,
    lang: scenario.lang,
    mode,
    userPrompt: scenario.userPrompt,
    turns,
    stopReason,
    finalResponse,
    toolCalls,
    usage,
    estimatedCostUsd: estimateCostUsd(model, usage),
    durationMs: Date.now() - startMs,
    grade,
    ...(fatalError ? { error: fatalError } : {})
  };
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIdx = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = nextIdx;
      nextIdx += 1;
      if (current >= items.length) break;
      results[current] = await worker(items[current]!, current);
    }
  });

  await Promise.all(runners);
  return results;
}

export interface RunSuiteOptions {
  modes: EvalMode[];
  scenarios?: readonly AgenticScenario[];
  model: string;
  label: string;
  dryRun: boolean;
  concurrency?: number;
  apiKey?: string;
  driver?: LlmDriver;
  onScenarioComplete?: (result: ScenarioRunResult, completed: number, total: number) => void;
}

export async function runAgenticSuite(opts: RunSuiteOptions): Promise<SuiteReport> {
  const scenarios = opts.scenarios ?? AGENTIC_SCENARIOS;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 10));

  const driver: LlmDriver =
    opts.driver ??
    (opts.dryRun
      ? createDryRunDriver(opts.model)
      : async (req) => {
          if (!opts.apiKey) {
            throw new Error("API key is required when dryRun is false.");
          }
          return callAnthropicMessages(req, opts.apiKey);
        });

  const session = await createMcpTestSession();

  try {
    const git = readGitMetadata();
    const scenariosById = new Map<string, AgenticScenario>(
      scenarios.map((s) => [s.id, s])
    );

    const tasks: Array<{ scenario: AgenticScenario; mode: EvalMode }> = [];
    for (const mode of opts.modes) {
      for (const scenario of scenarios) {
        tasks.push({ scenario, mode });
      }
    }

    let completedCount = 0;
    const results = await runWithConcurrency(tasks, concurrency, async (task) => {
      const res = await runSingleScenario({
        scenario: task.scenario,
        mode: task.mode,
        model: opts.model,
        session,
        driver
      });
      completedCount += 1;
      opts.onScenarioComplete?.(res, completedCount, tasks.length);
      return res;
    });

    const modesSummary: Record<EvalMode, ModeSummaryMetrics | undefined> = {
      "pure-mcp": opts.modes.includes("pure-mcp")
        ? aggregateModeMetrics("pure-mcp", results, scenariosById)
        : undefined,
      "with-skill": opts.modes.includes("with-skill")
        ? aggregateModeMetrics("with-skill", results, scenariosById)
        : undefined
    };

    return {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      label: opts.label,
      model: opts.model,
      dryRun: opts.dryRun,
      gitCommit: git.commit,
      gitBranch: git.branch,
      mcpServerMetadata: {
        instructionsLength: session.serverInstructions?.length ?? 0,
        toolCount: session.tools.length,
        toolNames: session.tools.map((t) => t.name),
        promptCount: session.prompts.length
      },
      modes: modesSummary,
      results
    };
  } finally {
    await session.close();
  }
}
