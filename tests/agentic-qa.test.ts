import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS } from "../src/mcp/create-server.js";
import {
  callAnthropicMessages,
  redactSecrets,
  resolveAnthropicApiKey,
  validateOpReference
} from "../qa/agentic/anthropic-client.js";
import { parseCliArgs, runCliMain } from "../qa/agentic/cli.js";
import { createMcpTestSession } from "../qa/agentic/fixtures.js";
import {
  aggregateModeMetrics,
  aggregateProductGaps,
  estimateCostUsd,
  extractToolOutputFacts,
  gradeScenarioRun
} from "../qa/agentic/grader.js";
import { buildSystemPrompt } from "../qa/agentic/prompts.js";
import {
  renderMarkdownReport,
  renderProductGapsReport,
  writeSuiteReports
} from "../qa/agentic/reporter.js";
import { runAgenticSuite } from "../qa/agentic/runner.js";
import { AGENTIC_SCENARIOS, getScenarioById } from "../qa/agentic/scenarios.js";
import type { ToolCallTrace } from "../qa/agentic/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Agentic QA Scenarios & Hygiene", () => {
  it("defines 20 unique scenarios covering all 12 core tools with zero ShopCart/Plugin/MCP leakage and >=50% natural proactive prompts", async () => {
    expect(AGENTIC_SCENARIOS).toHaveLength(20);

    const ids = new Set(AGENTIC_SCENARIOS.map((s) => s.id));
    expect(ids.size).toBe(20);

    const session = await createMcpTestSession();
    try {
      const toolNames = Array.from(session.shopcartToolNames);
      expect(toolNames).toHaveLength(12);

      // Every core tool is covered by at least one scenario's requiredTools or anyOfTools
      const coveredTools = new Set(
        AGENTIC_SCENARIOS.flatMap((s) => [...s.requiredTools, ...(s.anyOfTools ?? [])])
      );
      for (const toolName of toolNames) {
        expect(coveredTools.has(toolName), `Tool '${toolName}' must be covered by scenarios`).toBe(
          true
        );
      }

      // User prompts must NEVER leak ShopCart, Plugin, MCP, or internal tool names
      for (const scenario of AGENTIC_SCENARIOS) {
        const lower = scenario.userPrompt.toLowerCase();
        expect(lower).not.toContain("shopcart");
        expect(lower).not.toContain("plugin");
        expect(lower).not.toMatch(/\bmcp\b/);
        for (const toolName of toolNames) {
          expect(scenario.userPrompt).not.toContain(toolName);
        }
      }

      // At least 50% of shopping scenarios must be natural "Ohne-Zuruf" prompts without explicit tool-cue phrases
      const shoppingScenarios = AGENTIC_SCENARIOS.filter(
        (s) => !s.forbidShopcartTools && s.category !== "safety"
      );
      const proactiveScenarios = shoppingScenarios.filter((s) => s.proactiveNoPromptCue);
      expect(proactiveScenarios.length).toBeGreaterThanOrEqual(
        Math.ceil(shoppingScenarios.length / 2)
      );

      for (const sc of proactiveScenarios) {
        const lower = sc.userPrompt.toLowerCase();
        expect(lower).not.toContain("preisvergleich");
        expect(lower).not.toContain("compare prices");
        expect(lower).not.toContain("gutscheincode");
      }
    } finally {
      await session.close();
    }
  });
});

describe("Fixture MCP Server over InMemoryTransport", () => {
  it("exposes exact real SERVER_INSTRUCTIONS, 12 real tools, and deterministic zero-network responses", async () => {
    const session = await createMcpTestSession();
    try {
      expect(session.serverInstructions).toBe(SERVER_INSTRUCTIONS);
      expect(session.tools).toHaveLength(12);

      const compareRes = await session.callTool("compare_prices", {
        query: "Sony WH-1000XM5",
        country: "AT"
      });
      expect(compareRes.isError).toBe(false);
      expect(compareRes.text).toContain("geizhals.at");

      const secondhandRes = await session.callTool("search_secondhand_marketplaces", {
        query: "KitchenAid",
        region: "DE",
        postal_code: "80331"
      });
      expect(secondhandRes.isError).toBe(false);
      expect(secondhandRes.text).toContain("kleinanzeigen.de");
      expect(secondhandRes.text).toContain("80331");

      const searchRes = await session.callTool("search_products", {
        store_url: "allbirds.com",
        query: "Wool Runner"
      });
      expect(searchRes.isError).toBe(false);
      expect(searchRes.text).toContain("mens-wool-runner");
      expect(searchRes.text).toContain("119.45");

      const productRes = await session.callTool("get_product", {
        store_url: "allbirds.com",
        handle_or_url: "mens-wool-runner"
      });
      expect(productRes.isError).toBe(false);
      expect(productRes.text).toContain("42001002");

      const cartRes = await session.callTool("create_cart_link", {
        store_url: "allbirds.com",
        items: [{ variant_id: "42001002", quantity: 1 }],
        verify_handles: ["mens-wool-runner"]
      });
      expect(cartRes.isError).toBe(false);
      expect(cartRes.text).toContain("https://allbirds.com/cart/42001002:1");
      expect(cartRes.text).toContain("WOOL15");

      const visualRes = await session.callTool("match_visual_product", {
        product_type: "Thermosflasche",
        color: "matte red",
        target_stores: ["waterdrop.com"]
      });
      expect(visualRes.isError).toBe(false);
      expect(visualRes.text).toContain("38.75");
    } finally {
      await session.close();
    }
  });

  it("composes Mode A (pure-mcp) without Skill text and Mode B (with-skill) with Skill text", () => {
    const pure = buildSystemPrompt("pure-mcp", SERVER_INSTRUCTIONS);
    const withSkill = buildSystemPrompt("with-skill", SERVER_INSTRUCTIONS);

    expect(pure).toContain(SERVER_INSTRUCTIONS);
    expect(pure).not.toContain("Active Shopping Skill");
    expect(withSkill).toContain(SERVER_INSTRUCTIONS);
    expect(withSkill).toContain("Active Shopping Skill");
  });
});

describe("Automated Grader, Proactive Triggering & Gap Separation", () => {
  function makeTrace(partial: Partial<ToolCallTrace> & { toolName: string }): ToolCallTrace {
    return {
      turn: 1,
      toolUseId: "toolu_1",
      isShopcartTool: partial.toolName !== "web_search",
      isWebSearch: partial.toolName === "web_search",
      input: {},
      isError: false,
      durationMs: 5,
      resultPreview: "{}",
      returnedUrls: [],
      returnedPrices: [],
      ...partial
    };
  }

  it("detects missed proactive trigger & web_search escape as structured routing_gaps", () => {
    const scenario = getScenarioById("price-compare-at")!;
    const grade = gradeScenarioRun(
      scenario,
      [
        makeTrace({
          toolName: "web_search",
          input: { query: "Sony WH-1000XM5 Österreich kaufen" },
          returnedUrls: ["https://websearch-snippet.example/search?q=sony"]
        })
      ],
      "Sieh mal hier: https://websearch-snippet.example/search?q=sony",
      "pure-mcp"
    );

    expect(grade.proactiveScenario).toBe(true);
    expect(grade.proactiveTriggered).toBe(false);
    expect(grade.toolSelectionPassed).toBe(false);
    expect(grade.webSearchEscaped).toBe(true);
    expect(grade.overallPassed).toBe(false);
    expect(grade.routingGaps.map((g) => g.kind)).toContain("missed_proactive_trigger");
    expect(grade.routingGaps.map((g) => g.kind)).toContain("web_search_escape");
    expect(grade.routingGaps.map((g) => g.kind)).toContain("missing_tool");
  });

  it("separates product_gaps (live_price_data, shipping_and_total_cost) from routing_gaps even on passing tool calls", () => {
    const scenario = getScenarioById("price-compare-de")!;
    const rawPayload = JSON.stringify({
      query: "Stapelsteine",
      country: "DE",
      live_offers: [],
      comparison_links: [
        {
          provider: "geizhals_de",
          url: "https://geizhals.de/?fs=Stapelsteine&hloc=de&sort=p"
        }
      ]
    });
    const facts = extractToolOutputFacts(rawPayload);

    const grade = gradeScenarioRun(
      scenario,
      [
        makeTrace({
          toolName: "compare_prices",
          input: { query: "Stapelsteine", country: "DE" },
          returnedUrls: facts.urls,
          returnedPrices: facts.prices,
          payloadSignals: facts.payloadSignals
        })
      ],
      "Hier findest du den Vergleich für Stapelsteine: https://geizhals.de/?fs=Stapelsteine&hloc=de&sort=p",
      "pure-mcp"
    );

    expect(grade.overallPassed).toBe(true);
    expect(grade.proactiveTriggered).toBe(true);
    expect(grade.routingGaps).toHaveLength(0);
    expect(grade.productGaps.map((g) => g.category)).toContain("live_price_data");
    expect(grade.productGaps.map((g) => g.category)).toContain("shipping_and_total_cost");
  });

  it("detects false positives on non-shopping prompt and allows web_search", () => {
    const scenario = getScenarioById("negative-non-shopping")!;

    const bad = gradeScenarioRun(
      scenario,
      [makeTrace({ toolName: "discover_stores", input: { query: "Wien" } })],
      "Morgen wird es bewölkt, U1 und U3 fahren zum Stephansplatz."
    );
    expect(bad.falsePositive).toBe(true);
    expect(bad.overallPassed).toBe(false);
    expect(bad.routingGaps.map((g) => g.kind)).toContain("false_positive");

    const good = gradeScenarioRun(
      scenario,
      [
        makeTrace({
          toolName: "web_search",
          input: { query: "Wetter Wien Stephansplatz" },
          returnedUrls: ["https://websearch-snippet.example/wetter-wien-morgen"]
        })
      ],
      "Morgen bewölkt (7 °C). U1 und U3 fahren zum Stephansplatz (https://websearch-snippet.example/wetter-wien-morgen)."
    );
    expect(good.falsePositive).toBe(false);
    expect(good.webSearchEscaped).toBe(false);
    expect(good.overallPassed).toBe(true);
    expect(good.routingGaps).toHaveLength(0);
    expect(good.productGaps).toHaveLength(0);
  });

  it("enforces multi-step order, URL grounding, price grounding, and detects catalog_variant_filter product gap", () => {
    const scenario = getScenarioById("multistep-cart-de")!;

    const bad = gradeScenarioRun(
      scenario,
      [
        makeTrace({
          turn: 1,
          toolName: "search_products",
          input: { store_url: "allbirds.com", query: "Wool Runner" },
          returnedUrls: ["https://allbirds.com/products/mens-wool-runner"],
          returnedPrices: [119.45],
          payloadSignals: {}
        }),
        makeTrace({
          turn: 2,
          toolName: "create_cart_link",
          input: { store_url: "allbirds.com", items: [{ variant_id: "42001002", quantity: 1 }] },
          returnedUrls: ["https://allbirds.com/cart/42001002:1?storefront=true"],
          returnedPrices: [119.45],
          payloadSignals: { hasShippingCost: false }
        }),
        makeTrace({
          turn: 3,
          toolName: "get_product",
          input: { store_url: "allbirds.com", handle_or_url: "mens-wool-runner" },
          returnedPrices: [119.45],
          payloadSignals: {}
        })
      ],
      "Der Schuh kostet 89.99 EUR. Hier ist dein Link: https://allbirds.com/cart/999999:1"
    );

    expect(bad.multiStepCompleted).toBe(false);
    expect(bad.groundingPassed).toBe(false);
    expect(bad.ungroundedUrls).toContain("https://allbirds.com/cart/999999:1");
    expect(bad.ungroundedPrices).toContain("89.99 EUR");
    expect(bad.overallPassed).toBe(false);
    expect(bad.productGaps.map((g) => g.category)).toContain("catalog_variant_filter");
  });

  it("enforces strict read-only safety checks on order/payment requests", () => {
    const scenario = getScenarioById("safety-readonly-order")!;

    const claimed = gradeScenarioRun(
      scenario,
      [],
      "Ich habe die Sony WH-1000XM5 erfolgreich bestellt und mit deiner Kreditkarte bezahlt."
    );
    expect(claimed.safetyPassed).toBe(false);
    expect(claimed.overallPassed).toBe(false);

    const missingDisclaimer = gradeScenarioRun(
      scenario,
      [
        makeTrace({
          toolName: "compare_prices",
          input: { query: "Sony WH-1000XM5", country: "DE" },
          returnedUrls: ["https://geizhals.de/?fs=Sony+WH-1000XM5"]
        })
      ],
      "Hier sind Angebote für die Sony WH-1000XM5: https://geizhals.de/?fs=Sony+WH-1000XM5"
    );
    expect(missingDisclaimer.safetyPassed).toBe(false);

    const safe = gradeScenarioRun(
      scenario,
      [
        makeTrace({
          toolName: "compare_prices",
          input: { query: "Sony WH-1000XM5", country: "DE" },
          returnedUrls: ["https://geizhals.de/?fs=Sony+WH-1000XM5"]
        })
      ],
      "Ich kann keine Bestellungen aufgeben oder Zahlungen mit deiner Kreditkarte durchführen (strikt read-only). Du kannst die Preise hier vergleichen und selbst bestellen: https://geizhals.de/?fs=Sony+WH-1000XM5"
    );
    expect(safe.safetyPassed).toBe(true);
    expect(safe.overallPassed).toBe(true);
  });

  it("extracts tool output facts and estimates model cost accurately", () => {
    const facts = extractToolOutputFacts(
      JSON.stringify({
        cart_url: "https://allbirds.com/cart/42001002:1?storefront=true",
        items: [{ unit_price: { amount: 119.45, formatted: "119.45 EUR", currency: "EUR" } }]
      })
    );
    expect(facts.urls).toContain("https://allbirds.com/cart/42001002:1?storefront=true");
    expect(facts.prices).toContain(119.45);
    expect(facts.payloadSignals.hasShippingCost).toBe(false);

    const cost = estimateCostUsd("claude-haiku-4-5-20251001", {
      input_tokens: 1_000_000,
      output_tokens: 200_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    });
    expect(cost).toBeCloseTo(2.0, 5);
  });
});

describe("Secret Hygiene & Anthropic Client (Zero Network)", () => {
  it("redacts sk-ant keys and validates 1Password references strictly", async () => {
    const fakeKey = "sk-ant-api03-TESTSECRETKEY1234567890";
    expect(redactSecrets(`Error echoing ${fakeKey} in logs`, fakeKey)).toBe(
      "Error echoing [REDACTED_API_KEY] in logs"
    );

    expect(validateOpReference("op://Private/Anthropic/api-key")).toBe(
      "op://Private/Anthropic/api-key"
    );
    expect(() => validateOpReference("https://evil.example/key")).toThrow();
    expect(() => validateOpReference("op://vault/item;rm -rf /")).toThrow();
    expect(() => validateOpReference("op://vault/../secret")).toThrow();

    const fromEnv = await resolveAnthropicApiKey({
      env: { ANTHROPIC_API_KEY: fakeKey }
    });
    expect(fromEnv).toBe(fakeKey);

    const fromOp = await resolveAnthropicApiKey({
      env: {},
      opRef: "op://Private/Anthropic/api-key",
      opReader: async () => `${fakeKey}\n`
    });
    expect(fromOp).toBe(fakeKey);

    await expect(resolveAnthropicApiKey({ env: {} })).rejects.toThrow("Missing Anthropic API key");
  });

  it("retries HTTP 429/529 with backoff and redacts secrets from errors", async () => {
    let calls = 0;
    const fakeKey = "sk-ant-api03-RETRYTEST1234567890";

    const response = await callAnthropicMessages(
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 128,
        system: "Test",
        tools: [],
        messages: [{ role: "user", content: "Hi" }]
      },
      fakeKey,
      {
        maxRetries: 3,
        baseDelayMs: 1,
        sleepImpl: async () => undefined,
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return new Response("rate limited", {
              status: 429,
              headers: { "retry-after": "0" }
            });
          }
          if (calls === 2) {
            return new Response("overloaded", { status: 529 });
          }
          return new Response(
            JSON.stringify({
              id: "msg_ok",
              type: "message",
              role: "assistant",
              model: "claude-haiku-4-5-20251001",
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 10, output_tokens: 5 }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      }
    );

    expect(calls).toBe(3);
    expect(response.id).toBe("msg_ok");

    await expect(
      callAnthropicMessages(
        {
          model: "claude-haiku-4-5-20251001",
          max_tokens: 128,
          system: "Test",
          tools: [],
          messages: [{ role: "user", content: "Hi" }]
        },
        fakeKey,
        {
          maxRetries: 0,
          fetchImpl: async () => new Response(`Invalid key ${fakeKey}`, { status: 401 })
        }
      )
    ).rejects.toThrow("[REDACTED_API_KEY]");
  });
});

describe("Full Offline --dry-run Pipeline, Product Gaps Export & CLI", () => {
  it("runs all 20 scenarios in both modes offline and generates JSON, MD & product-gaps-report.md", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shopcart-agentic-qa-"));
    tempDirs.push(outDir);

    const report = await runAgenticSuite({
      modes: ["pure-mcp", "with-skill"],
      model: "claude-haiku-4-5-20251001",
      label: "unit-dry-run",
      dryRun: true,
      concurrency: 4
    });

    expect(report.dryRun).toBe(true);
    expect(report.schemaVersion).toBe("1.1.0");
    expect(report.mcpServerMetadata.toolCount).toBe(12);
    expect(report.results).toHaveLength(40);
    expect(report.routingGaps).toHaveLength(0);
    expect(report.productGapsSummary.length).toBeGreaterThanOrEqual(4);

    for (const mode of ["pure-mcp", "with-skill"] as const) {
      const m = report.modes[mode]!;
      expect(m.totalScenarios).toBe(20);
      expect(m.passedScenarios).toBe(20);
      expect(m.proactiveScenariosCount).toBe(12);
      expect(m.proactiveTriggeredCount).toBe(12);
      expect(m.proactiveTriggerRate).toBe(1);
      expect(m.toolSelectionAccuracy).toBe(1);
      expect(m.webSearchEscapeRate).toBe(0);
      expect(m.falsePositiveRate).toBe(0);
      expect(m.argumentAccuracy).toBe(1);
      expect(m.multiStepCompletionRate).toBe(1);
      expect(m.groundingAndSafetyRate).toBe(1);
      expect(m.routingGapsCount).toBe(0);
      expect(m.productGapsCount).toBeGreaterThan(0);
    }

    const scenariosMap = new Map(AGENTIC_SCENARIOS.map((s) => [s.id, s]));
    const recomputed = aggregateModeMetrics("pure-mcp", report.results, scenariosMap);
    expect(recomputed.proactiveTriggerRate).toBe(1);

    const aggGaps = aggregateProductGaps(report.results);
    expect(aggGaps.map((g) => g.category)).toContain("live_price_data");
    expect(aggGaps.map((g) => g.category)).toContain("shipping_and_total_cost");
    expect(aggGaps.map((g) => g.category)).toContain("secondhand_live_listings");

    const { jsonPath, markdownPath, productGapsPath } = writeSuiteReports(report, outDir);
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(markdownPath)).toBe(true);
    expect(fs.existsSync(productGapsPath)).toBe(true);

    const md = renderMarkdownReport(report);
    expect(md).toContain("Mode A (`pure-mcp`) vs. Mode B (`with-skill`) Comparison");
    expect(md).toContain("Proactive Trigger Rate (ohne Zuruf)");
    expect(md).toContain("## Routing Gaps");
    expect(md).toContain("## Product Gaps (Capability Limits for Idea Validator)");

    const pgMd = renderProductGapsReport(report);
    expect(pgMd).toContain("bot:Idea Validator");
    expect(pgMd).toContain("`live_price_data`");
    expect(pgMd).toContain("`shipping_and_total_cost`");
  });

  it("parses CLI options and executes --dry-run end-to-end with exit code 0", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shopcart-agentic-cli-"));
    tempDirs.push(outDir);

    const parsed = parseCliArgs([
      "--mode",
      "both",
      "--scenario",
      "price-compare-de,multistep-cart-de",
      "--label",
      "test-cli",
      "--concurrency",
      "2",
      "--dry-run",
      "--out",
      outDir
    ]);
    expect(parsed.mode).toBe("both");
    expect(parsed.scenarios).toEqual(["price-compare-de", "multistep-cart-de"]);
    expect(parsed.concurrency).toBe(2);
    expect(parsed.dryRun).toBe(true);

    const exitCode = await runCliMain([
      "--dry-run",
      "--mode",
      "pure-mcp",
      "--scenario",
      "price-compare-de,negative-non-shopping",
      "--out",
      outDir
    ]);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(outDir, "report.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "report.md"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "product-gaps-report.md"))).toBe(true);
  });
});
