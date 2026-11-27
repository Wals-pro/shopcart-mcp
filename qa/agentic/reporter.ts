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
    `| Tool Selection Accuracy | ${pct(m.toolSelectionAccuracy)} |`,
    `| \`web_search\` Escape Rate (shopping) | ${m.webSearchEscapeCount}/${m.shoppingScenariosCount} (${pct(m.webSearchEscapeRate)}) |`,
    `| False Positive Rate (non-shopping) | ${m.falsePositiveCount}/${m.nonShoppingScenariosCount} (${pct(m.falsePositiveRate)}) |`,
    `| Argument Accuracy | ${m.argChecksPassed}/${m.argChecksTotal} (${pct(m.argumentAccuracy)}) |`,
    `| Multi-Step Completion | ${m.multiStepCompleted}/${m.multiStepTotal} (${pct(m.multiStepCompletionRate)}) |`,
    `| Grounding & Safety | ${m.groundingAndSafetyPassed}/${m.totalScenarios} (${pct(m.groundingAndSafetyRate)}) |`,
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

  if (pure && skill) {
    lines.push("## Mode A (`pure-mcp`) vs. Mode B (`with-skill`) Comparison");
    lines.push("");
    lines.push("| Metric | `pure-mcp` (Claude.ai Connector) | `with-skill` (+ Shopping Skill) | Delta |");
    lines.push("|---|---:|---:|---:|");
    const deltaPct = (a: number, b: number) => {
      const d = (b - a) * 100;
      return `${d >= 0 ? "+" : ""}${d.toFixed(1)} pp`;
    };
    lines.push(
      `| Overall Pass Rate | ${pct(pure.overallPassRate)} (${pure.passedScenarios}/${pure.totalScenarios}) | ${pct(skill.overallPassRate)} (${skill.passedScenarios}/${skill.totalScenarios}) | ${deltaPct(pure.overallPassRate, skill.overallPassRate)} |`
    );
    lines.push(
      `| Tool Selection Accuracy | ${pct(pure.toolSelectionAccuracy)} | ${pct(skill.toolSelectionAccuracy)} | ${deltaPct(pure.toolSelectionAccuracy, skill.toolSelectionAccuracy)} |`
    );
    lines.push(
      `| \`web_search\` Escape Rate | ${pct(pure.webSearchEscapeRate)} (${pure.webSearchEscapeCount}/${pure.shoppingScenariosCount}) | ${pct(skill.webSearchEscapeRate)} (${skill.webSearchEscapeCount}/${skill.shoppingScenariosCount}) | ${deltaPct(pure.webSearchEscapeRate, skill.webSearchEscapeRate)} |`
    );
    lines.push(
      `| False Positive Rate | ${pct(pure.falsePositiveRate)} | ${pct(skill.falsePositiveRate)} | ${deltaPct(pure.falsePositiveRate, skill.falsePositiveRate)} |`
    );
    lines.push(
      `| Argument Accuracy | ${pct(pure.argumentAccuracy)} | ${pct(skill.argumentAccuracy)} | ${deltaPct(pure.argumentAccuracy, skill.argumentAccuracy)} |`
    );
    lines.push(
      `| Multi-Step Completion | ${pct(pure.multiStepCompletionRate)} | ${pct(skill.multiStepCompletionRate)} | ${deltaPct(pure.multiStepCompletionRate, skill.multiStepCompletionRate)} |`
    );
    lines.push(
      `| Grounding & Safety | ${pct(pure.groundingAndSafetyRate)} | ${pct(skill.groundingAndSafetyRate)} | ${deltaPct(pure.groundingAndSafetyRate, skill.groundingAndSafetyRate)} |`
    );
    lines.push(
      `| Estimated Cost (USD) | ${usd(pure.estimatedCostUsd)} | ${usd(skill.estimatedCostUsd)} | ${usd(skill.estimatedCostUsd - pure.estimatedCostUsd)} |`
    );
    lines.push("");
  } else {
    const active = pure ?? skill;
    if (active) {
      lines.push(`## Summary KPIs (\`${active.mode}\`)`);
      lines.push("");
      lines.push("| Metric | Value |");
      lines.push("|---|---:|");
      lines.push(...renderModeKpiRows(active));
      lines.push("");
    }
  }

  const activeModes: EvalMode[] = (["pure-mcp", "with-skill"] as const).filter(
    (m) => report.modes[m] !== undefined
  );

  for (const mode of activeModes) {
    const modeResults = report.results.filter((r) => r.mode === mode);
    lines.push(`## Scenario Matrix (\`${mode}\`)`);
    lines.push("");
    lines.push(
      "| Scenario | Status | Tool Sel. | Escape | Args | Multi-Step | Ground/Safe | Tool Trace |"
    );
    lines.push("|---|:---:|:---:|:---:|:---:|:---:|:---:|---|");
    for (const r of modeResults) {
      const g = r.grade;
      const status = g.overallPassed ? "PASS" : "FAIL";
      const toolSel = g.toolSelectionPassed ? "OK" : "FAIL";
      const escape = g.webSearchEscaped ? "ESCAPE" : "-";
      const args = g.argChecksTotal === 0 ? "-" : `${g.argChecksPassed}/${g.argChecksTotal}`;
      const multi = !g.multiStepApplicable ? "-" : g.multiStepCompleted ? "OK" : "FAIL";
      const gs = g.groundingAndSafetyPassed ? "OK" : "FAIL";
      lines.push(
        `| \`${r.scenarioId}\` | ${status} | ${toolSel} | ${escape} | ${args} | ${multi} | ${gs} | ${formatTraceSummary(r)} |`
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
          lines.push(`- **Response Excerpt:** "${snippet}${r.finalResponse.length > 280 ? "..." : ""}"`);
        }
        lines.push("");
      }
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export function writeSuiteReports(
  report: SuiteReport,
  outDir: string
): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "report.json");
  const markdownPath = path.join(outDir, "report.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdownReport(report), "utf8");

  return { jsonPath, markdownPath };
}

export function formatConsoleSummary(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `=== ShopCart Agentic QA [${report.label}] (${report.model}${report.dryRun ? ", DRY-RUN" : ""}) ===`
  );
  for (const mode of ["pure-mcp", "with-skill"] as const) {
    const m = report.modes[mode];
    if (!m) continue;
    lines.push(
      [
        `[${mode}]`,
        `Pass: ${m.passedScenarios}/${m.totalScenarios} (${pct(m.overallPassRate)})`,
        `ToolSel: ${pct(m.toolSelectionAccuracy)}`,
        `Escape: ${m.webSearchEscapeCount}/${m.shoppingScenariosCount} (${pct(m.webSearchEscapeRate)})`,
        `FP: ${m.falsePositiveCount}/${m.nonShoppingScenariosCount}`,
        `Args: ${m.argChecksPassed}/${m.argChecksTotal}`,
        `Multi: ${m.multiStepCompleted}/${m.multiStepTotal}`,
        `Safe/Gnd: ${m.groundingAndSafetyPassed}/${m.totalScenarios}`,
        `Cost: ${usd(m.estimatedCostUsd)}`
      ].join(" | ")
    );
  }
  return lines.join("\n");
}
