import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AGENTIC_MODEL, resolveAnthropicApiKey } from "./anthropic-client.js";
import { formatConsoleSummary, writeSuiteReports } from "./reporter.js";
import { runAgenticSuite } from "./runner.js";
import { AGENTIC_SCENARIOS, getScenarioById } from "./scenarios.js";
import type { CliMode, CliOptions, EvalMode } from "./types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function makeTimestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sanitizeLabel(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "run";
}

export function parseCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): CliOptions {
  let mode: CliMode = "pure-mcp";
  const scenarios: string[] = [];
  let model = env.AGENTIC_MODEL?.trim() || DEFAULT_AGENTIC_MODEL;
  let label = "";
  let dryRun = false;
  let outDir = "";
  let concurrency = 3;
  let opRef: string | undefined;
  let opAccount: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    const next = argv[i + 1];
    const requireValue = (flag: string): string => {
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for ${flag}`);
      }
      i += 1;
      return next;
    };

    if (arg === "--mode") {
      const val = requireValue("--mode");
      if (
        val !== "pure-mcp" &&
        val !== "with-skill" &&
        val !== "claude-web-harsh" &&
        val !== "both" &&
        val !== "all"
      ) {
        throw new Error(
          `Invalid --mode '${val}'. Expected: pure-mcp | with-skill | claude-web-harsh | both | all`
        );
      }
      mode = val;
    } else if (arg === "--scenario") {
      const val = requireValue("--scenario");
      for (const part of val.split(",")) {
        const id = part.trim();
        if (id) scenarios.push(id);
      }
    } else if (arg === "--model") {
      model = requireValue("--model").trim();
    } else if (arg === "--label") {
      label = requireValue("--label").trim();
    } else if (arg === "--out") {
      outDir = requireValue("--out").trim();
    } else if (arg === "--concurrency") {
      const raw = requireValue("--concurrency");
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
        throw new Error(`Invalid --concurrency '${raw}'. Expected integer 1..10.`);
      }
      concurrency = parsed;
    } else if (arg === "--op-ref") {
      opRef = requireValue("--op-ref").trim();
    } else if (arg === "--op-account") {
      opAccount = requireValue("--op-account").trim();
    } else if (arg === "--") {
      // ignore pnpm pass-through delimiter
      continue;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  const effectiveLabel = label || (dryRun ? "dry-run" : "cycle-0");
  const effectiveOutDir =
    outDir ||
    path.join(
      REPO_ROOT,
      "qa",
      "agentic",
      "reports",
      `${makeTimestampSlug()}-${sanitizeLabel(effectiveLabel)}`
    );

  return {
    mode,
    scenarios,
    model,
    label: effectiveLabel,
    dryRun,
    outDir: effectiveOutDir,
    concurrency,
    opRef,
    opAccount,
    help
  };
}

export function renderHelpText(): string {
  return [
    "ShopCart MCP — Agentic Evaluation Suite",
    "",
    "Usage:",
    "  pnpm run qa:agentic -- [options]",
    "",
    "Options:",
    "  --mode <pure-mcp|with-skill|claude-web-harsh|both|all>  Evaluation mode (default: pure-mcp)",
    "  --scenario <id[,id2,...]>          Run specific scenario ID(s) only",
    `  --model <model-id>                 Anthropic model (default: ${DEFAULT_AGENTIC_MODEL}, or AGENTIC_MODEL env)`,
    "  --label <name>                     Report label (e.g. cycle-0-baseline)",
    "  --dry-run                          Offline self-test through real MCP server (0 API calls, 0 API key)",
    "  --out <dir>                        Output directory for report.json & report.md",
    "  --concurrency <1-10>               Parallel scenarios (default: 3)",
    "  --op-ref <op://vault/item/field>   Optional opt-in 1Password reference (RAM-only, never logged)",
    "  --op-account <account>             Optional 1Password account shorthand/domain (or OP_ACCOUNT env)",
    "  --help, -h                         Show this help message"
  ].join("\n");
}

export async function runCliMain(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseCliArgs(argv, env);
  } catch (err) {
    console.error(`[qa:agentic] ${err instanceof Error ? err.message : String(err)}`);
    console.error("Run with --help for usage.");
    return 2;
  }

  if (opts.help) {
    console.log(renderHelpText());
    return 0;
  }

  let selectedScenarios = [...AGENTIC_SCENARIOS];
  if (opts.scenarios.length > 0) {
    const resolved = [];
    for (const id of opts.scenarios) {
      const found = getScenarioById(id);
      if (!found) {
        console.error(
          `[qa:agentic] Unknown scenario '${id}'. Available IDs:\n  ${AGENTIC_SCENARIOS.map((s) => s.id).join(", ")}`
        );
        return 2;
      }
      resolved.push(found);
    }
    selectedScenarios = resolved;
  }

  const modes: EvalMode[] =
    opts.mode === "both"
      ? ["pure-mcp", "with-skill"]
      : opts.mode === "all"
        ? ["pure-mcp", "with-skill", "claude-web-harsh"]
        : [opts.mode];

  let apiKey: string | undefined;
  if (!opts.dryRun) {
    try {
      apiKey = await resolveAnthropicApiKey({
        opRef: opts.opRef,
        opAccount: opts.opAccount,
        env
      });
    } catch (err) {
      console.error(`[qa:agentic] ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  console.log(
    `[qa:agentic] Starting '${opts.label}' | mode=${opts.mode} | model=${opts.model} | scenarios=${selectedScenarios.length} | concurrency=${opts.concurrency}${opts.dryRun ? " | DRY-RUN" : ""}`
  );

  const report = await runAgenticSuite({
    modes,
    scenarios: selectedScenarios,
    model: opts.model,
    label: opts.label,
    dryRun: opts.dryRun,
    concurrency: opts.concurrency,
    apiKey,
    onScenarioComplete: (res, completed, total) => {
      const icon = res.grade.overallPassed ? "PASS" : "FAIL";
      const tools = res.toolCalls.map((c) => c.toolName).join(" -> ") || "none";
      console.log(
        `  [${completed}/${total}] ${icon} (${res.mode}) ${res.scenarioId} | tools: ${tools}`
      );
    }
  });

  const { jsonPath, markdownPath, productGapsPath } = writeSuiteReports(report, opts.outDir);
  console.log(formatConsoleSummary(report));
  console.log(
    `\nReports written:\n  JSON:         ${jsonPath}\n  MD:           ${markdownPath}\n  Product Gaps: ${productGapsPath}`
  );

  return 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runCliMain()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error("[qa:agentic] Fatal error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
