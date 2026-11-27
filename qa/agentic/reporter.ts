import fs from "node:fs";
import path from "node:path";
import type { EvalMode, ModeSummaryMetrics, ScenarioRunResult, SuiteReport } from "./types.js";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function usd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

function formatTraceSummary(res: ScenarioRunResult): string {
  if (res.toolCalls.length === 0) return "_(no tool calls)_";
  return res.toolCalls
    .map((c) => {
      const tag = c.isWebSearch ? " [web_search]" : c.isError ? " [ERROR]" : "";
      return `\`${c.toolName}\`${tag}`;
    })
    .join(" → ");
}

function renderModeKpiRows(m: ModeSummaryMetrics): string[] {
  return [
    `| Overall Pass Rate | **${m.passedScenarios}/${m.totalScenarios} (${pct(m.overallPassRate)})** |`,
    `| Proactive Trigger Rate (ohne Zuruf) | **${m.proactiveTriggeredCount}/${m.proactiveScenariosCount} (${pct(m.proactiveTriggerRate)})** |`,
    `| Tool Selection Accuracy | ${pct(m.toolSelectionAccuracy)} |`,
    `| \`web_search\` Escape Rate (shopping) | ${m.webSearchEscapeCount}/${m.shoppingScenariosCount} (${pct(m.webSearchEscapeRate)}) |`,
    `| False Positive Rate (non-shopping) | ${m.falsePositiveCount}/${m.nonShoppingScenariosCount} (${pct(m.falsePositiveRate)}) |`,
    `| Argument Accuracy | ${m.argChecksPassed}/${m.argChecksTotal} (${pct(m.argumentAccuracy)}) |`,
    `| Multi-Step Completion | ${m.multiStepCompleted}/${m.multiStepTotal} (${pct(m.multiStepCompletionRate)}) |`,
    `| Grounding & Safety | ${m.groundingAndSafetyPassed}/${m.totalScenarios} (${pct(m.groundingAndSafetyRate)}) |`,
    `| Routing Gaps / Product Gaps | ${m.routingGapsCount} routing / ${m.productGapsCount} product |`,
    `| Tokens (in / out / cache_r / cache_w) | ${m.usage.input_tokens.toLocaleString("en-US")} / ${m.usage.output_tokens.toLocaleString("en-US")} / ${m.usage.cache_read_input_tokens.toLocaleString("en-US")} / ${m.usage.cache_creation_input_tokens.toLocaleString("en-US")} |`,
    `| Estimated Cost (USD) | ${usd(m.estimatedCostUsd)} |`
  ];
}

export function renderMarkdownReport(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push(`# ShopCart MCP — Agentic QA Report (${report.label})`);
  lines.push("");
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(`- **Model:** \`${report.model}\`${report.dryRun ? " *(DRY-RUN offline simulator)*" : ""}`);
  lines.push(
    `- **Git:** \`${report.gitBranch ?? "unknown"}\` @ \`${report.gitCommit ?? "unknown"}\``
  );
  lines.push(
    `- **MCP Server Surface:** ${report.mcpServerMetadata.toolCount} tools, ${report.mcpServerMetadata.promptCount} prompts, \`server.instructions\` = ${report.mcpServerMetadata.instructionsLength} chars`
  );
  lines.push("");

  const pure = report.modes["pure-mcp"];
  const skill = report.modes["with-skill"];
  const harsh = report.modes["claude-web-harsh"];

  const presentModes: ModeSummaryMetrics[] = [pure, skill, harsh].filter(
    (m): m is ModeSummaryMetrics => m !== undefined
  );

  if (presentModes.length > 1) {
    lines.push("## Mode Comparison");
    lines.push("");
    const header = ["Metric", ...presentModes.map((m) => `\`${m.mode}\``)];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`|---|${presentModes.map(() => "---:").join("|")}|`);
    lines.push(
      `| Overall Pass Rate | ${presentModes.map((m) => `${pct(m.overallPassRate)} (${m.passedScenarios}/${m.totalScenarios})`).join(" | ")} |`
    );
    lines.push(
      `| **Proactive Trigger Rate (ohne Zuruf)** | ${presentModes.map((m) => `**${pct(m.proactiveTriggerRate)} (${m.proactiveTriggeredCount}/${m.proactiveScenariosCount})**`).join(" | ")} |`
    );
    lines.push(
      `| Tool Selection Accuracy | ${presentModes.map((m) => pct(m.toolSelectionAccuracy)).join(" | ")} |`
    );
    lines.push(
      `| \`web_search\` Escape Rate | ${presentModes.map((m) => `${pct(m.webSearchEscapeRate)} (${m.webSearchEscapeCount}/${m.shoppingScenariosCount})`).join(" | ")} |`
    );
    lines.push(
      `| False Positive Rate | ${presentModes.map((m) => pct(m.falsePositiveRate)).join(" | ")} |`
    );
    lines.push(
      `| Argument Accuracy | ${presentModes.map((m) => pct(m.argumentAccuracy)).join(" | ")} |`
    );
    lines.push(
      `| Multi-Step Completion | ${presentModes.map((m) => pct(m.multiStepCompletionRate)).join(" | ")} |`
    );
    lines.push(
      `| Grounding & Safety | ${presentModes.map((m) => pct(m.groundingAndSafetyRate)).join(" | ")} |`
    );
    lines.push(
      `| Routing Gaps / Product Gaps | ${presentModes.map((m) => `${m.routingGapsCount} / ${m.productGapsCount}`).join(" | ")} |`
    );
    lines.push(
      `| Estimated Cost (USD) | ${presentModes.map((m) => usd(m.estimatedCostUsd)).join(" | ")} |`
    );
    lines.push("");
  } else if (presentModes.length === 1) {
    const active = presentModes[0]!;
    lines.push(`## Summary KPIs (\`${active.mode}\`)`);
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|---|---:|");
    lines.push(...renderModeKpiRows(active));
    lines.push("");
  }

  const activeModes: EvalMode[] = (
    ["pure-mcp", "with-skill", "claude-web-harsh"] as const
  ).filter((m) => report.modes[m] !== undefined);

  for (const mode of activeModes) {
    const modeResults = report.results.filter((r) => r.mode === mode);
    lines.push(`## Scenario Matrix (\`${mode}\`)`);
    lines.push("");
    lines.push(
      "| Scenario | Ohne Zuruf | Status | Tool Sel. | Escape | Args | Multi-Step | Ground/Safe | Tool Trace |"
    );
    lines.push("|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|");
    for (const r of modeResults) {
      const g = r.grade;
      const proactive = !g.proactiveScenario ? "-" : g.proactiveTriggered ? "YES" : "MISS";
      const status = g.overallPassed ? "PASS" : "FAIL";
      const toolSel = g.toolSelectionPassed ? "OK" : "FAIL";
      const escape = g.webSearchEscaped ? "ESCAPE" : "-";
      const args = g.argChecksTotal === 0 ? "-" : `${g.argChecksPassed}/${g.argChecksTotal}`;
      const multi = !g.multiStepApplicable ? "-" : g.multiStepCompleted ? "OK" : "FAIL";
      const gs = g.groundingAndSafetyPassed ? "OK" : "FAIL";
      lines.push(
        `| \`${r.scenarioId}\` | ${proactive} | ${status} | ${toolSel} | ${escape} | ${args} | ${multi} | ${gs} | ${formatTraceSummary(r)} |`
      );
    }
    lines.push("");

    const failed = modeResults.filter((r) => !r.grade.overallPassed);
    if (failed.length > 0) {
      lines.push(`### Failure Diagnostics (\`${mode}\`)`);
      lines.push("");
      for (const r of failed) {
        lines.push(`#### \`${r.scenarioId}\` — ${r.title}`);
        lines.push(`- **Prompt:** ${r.userPrompt}`);
        lines.push(`- **Tool Trace:** ${formatTraceSummary(r)}`);
        lines.push(`- **Failure Reasons:**`);
        for (const reason of r.grade.failureReasons) {
          lines.push(`  - ${reason}`);
        }
        if (r.finalResponse) {
          const snippet = r.finalResponse.replace(/\s+/g, " ").slice(0, 280);
          lines.push(
            `- **Response Excerpt:** "${snippet}${r.finalResponse.length > 280 ? "..." : ""}"`
          );
        }
        lines.push("");
      }
    }
  }

  // Routing Gaps section (fixable via MCP instructions / tool descriptions / prompts / next_step)
  lines.push("## Routing Gaps (Fixable in Optimization Cycles 1..N)");
  lines.push("");
  if (report.routingGaps.length === 0) {
    lines.push("_No routing gaps detected in this run._");
  } else {
    lines.push("| Mode | Scenario | Kind | Severity | Expected | Actual | Summary |");
    lines.push("|---|---|---|:---:|---|---|---|");
    for (const gap of report.routingGaps) {
      lines.push(
        `| \`${gap.mode}\` | \`${gap.scenarioId}\` | \`${gap.kind}\` | **${gap.severity}** | ${gap.expectedTools.join(", ") || "-"} | ${gap.actualTools.join(" → ") || "none"} | ${gap.summary} |`
      );
    }
  }
  lines.push("");

  // Product Gaps section (capability limits for bot:Idea Validator handoff)
  lines.push("## Product Gaps (Capability Limits for Idea Validator)");
  lines.push("");
  if (report.productGapsSummary.length === 0) {
    lines.push("_No product/capability gaps recorded in this run._");
  } else {
    lines.push("| Category | Severity | Scenarios | Affected Tools | Observed Capability Limit | Candidate Product Feature |");
    lines.push("|---|:---:|---:|---|---|---|");
    for (const gap of report.productGapsSummary) {
      lines.push(
        `| \`${gap.category}\` | **${gap.severity}** | ${gap.occurrences} (${gap.affectedScenarios.map((s) => `\`${s}\``).join(", ")}) | ${gap.affectedTools.map((t) => `\`${t}\``).join(", ")} | ${gap.observedBehaviors[0] ?? ""} | ${gap.candidateFeature} |`
      );
    }
  }
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
}

/**
 * Standalone structured product-gaps report formatted for handoff to `bot:Idea Validator`.
 */
export function renderProductGapsReport(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push(`# ShopCart MCP — Product & Capability Gaps Report (${report.label})`);
  lines.push("");
  lines.push(
    "> **Purpose:** Structured handoff for `bot:Idea Validator` separating real product/capability boundaries (`product_gaps`) from MCP prompt/description routing issues (`routing_gaps`)."
  );
  lines.push("");
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(`- **Model:** \`${report.model}\`${report.dryRun ? " *(DRY-RUN)*" : ""}`);
  lines.push(`- **Git:** \`${report.gitBranch ?? "unknown"}\` @ \`${report.gitCommit ?? "unknown"}\``);
  lines.push(`- **Total Unique Product Gap Categories:** ${report.productGapsSummary.length}`);
  lines.push("");

  if (report.productGapsSummary.length === 0) {
    lines.push("_No product gaps detected in this run._");
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Prioritized Product Gaps");
  lines.push("");
  lines.push("| Priority | Category | Affected Journeys | Tools | Candidate Product Feature |");
  lines.push("|:---:|---|---:|---|---|");
  for (const gap of report.productGapsSummary) {
    lines.push(
      `| **${gap.severity.toUpperCase()}** | \`${gap.category}\` | ${gap.occurrences} | ${gap.affectedTools.map((t) => `\`${t}\``).join(", ")} | ${gap.candidateFeature} |`
    );
  }
  lines.push("");

  lines.push("## Evidence by Gap Category");
  lines.push("");
  for (const gap of report.productGapsSummary) {
    lines.push(`### \`${gap.category}\` (${gap.severity.toUpperCase()})`);
    lines.push(`- **Affected Scenarios (${gap.occurrences}):** ${gap.affectedScenarios.map((s) => `\`${s}\``).join(", ")}`);
    lines.push(`- **Affected Tools:** ${gap.affectedTools.map((t) => `\`${t}\``).join(", ")}`);
    lines.push(`- **Observed Behavior:**`);
    for (const obs of gap.observedBehaviors) {
      lines.push(`  - ${obs}`);
    }
    lines.push(`- **Candidate Feature for Idea Validator:** ${gap.candidateFeature}`);
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function writeSuiteReports(
  report: SuiteReport,
  outDir: string
): { jsonPath: string; markdownPath: string; productGapsPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "report.json");
  const markdownPath = path.join(outDir, "report.md");
  const productGapsPath = path.join(outDir, "product-gaps-report.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdownReport(report), "utf8");
  fs.writeFileSync(productGapsPath, renderProductGapsReport(report), "utf8");

  return { jsonPath, markdownPath, productGapsPath };
}

export function formatConsoleSummary(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `=== ShopCart Agentic QA [${report.label}] (${report.model}${report.dryRun ? ", DRY-RUN" : ""}) ===`
  );
  for (const mode of ["pure-mcp", "with-skill", "claude-web-harsh"] as const) {
    const m = report.modes[mode];
    if (!m) continue;
    lines.push(
      [
        `[${mode}]`,
        `Pass: ${m.passedScenarios}/${m.totalScenarios} (${pct(m.overallPassRate)})`,
        `Proactive: ${m.proactiveTriggeredCount}/${m.proactiveScenariosCount} (${pct(m.proactiveTriggerRate)})`,
        `ToolSel: ${pct(m.toolSelectionAccuracy)}`,
        `Escape: ${m.webSearchEscapeCount}/${m.shoppingScenariosCount} (${pct(m.webSearchEscapeRate)})`,
        `FP: ${m.falsePositiveCount}/${m.nonShoppingScenariosCount}`,
        `Args: ${m.argChecksPassed}/${m.argChecksTotal}`,
        `Multi: ${m.multiStepCompleted}/${m.multiStepTotal}`,
        `Gaps: ${m.routingGapsCount}R/${m.productGapsCount}P`,
        `Cost: ${usd(m.estimatedCostUsd)}`
      ].join(" | ")
    );
  }
  return lines.join("\n");
}
