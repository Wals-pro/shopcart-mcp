export type EvalMode = "pure-mcp" | "with-skill";
export type CliMode = EvalMode | "both";
export type ScenarioLang = "de" | "en";

export type ScenarioCategory =
  | "price-compare"
  | "secondhand"
  | "deals"
  | "discounts"
  | "discovery"
  | "multistep-cart"
  | "policies"
  | "inspect"
  | "collections"
  | "visual"
  | "combo"
  | "safety"
  | "negative";

export type GapSeverity = "high" | "medium" | "low";

export type RoutingGapKind =
  | "missed_proactive_trigger"
  | "web_search_escape"
  | "missing_tool"
  | "wrong_argument"
  | "incomplete_multistep"
  | "false_positive"
  | "grounding_or_safety";

export interface RoutingGap {
  kind: RoutingGapKind;
  severity: GapSeverity;
  scenarioId: string;
  mode: EvalMode;
  expectedTools: string[];
  actualTools: string[];
  summary: string;
}

export type ProductGapCategory =
  | "live_price_data"
  | "shipping_and_total_cost"
  | "secondhand_live_listings"
  | "catalog_variant_filter"
  | "directory_coverage"
  | "multi_store_cart"
  | "visual_discovery"
  | "delivery_and_reviews"
  | "storefront_waf_resilience";

export interface ProductGap {
  id: string;
  category: ProductGapCategory;
  severity: GapSeverity;
  scenarioId: string;
  journey: string;
  affectedTools: string[];
  observedBehavior: string;
  candidateFeature: string;
}

export interface ProductGapAggregate {
  category: ProductGapCategory;
  severity: GapSeverity;
  occurrences: number;
  affectedScenarios: string[];
  affectedTools: string[];
  observedBehaviors: string[];
  candidateFeature: string;
}

export interface ArgAssertion {
  /** Tool name whose call arguments should be checked. */
  tool: string;
  /** Human-readable description of what is asserted. */
  description: string;
  /** Argument key inside tool call input object. */
  field: string;
  /** Match rule for the argument value. */
  match:
    | { type: "equals_ci"; value: string }
    | { type: "one_of_ci"; values: string[] }
    | { type: "regex"; pattern: string; flags?: string }
    | { type: "non_empty_string" }
    | { type: "non_empty_array" }
    | { type: "boolean"; value: boolean };
}

export interface SafetyExpectation {
  /** Assistant must NOT claim that an order was placed/paid/completed. */
  forbidOrderCompletionClaim: boolean;
  /** Assistant must explicitly clarify read-only / cannot buy or pay automatically. */
  requireReadOnlyDisclaimer: boolean;
}

export interface GroundingExpectation {
  /** Verify every https:// URL in final response appears in a tool output (host/URL check). */
  checkUrlsAgainstToolOutputs: boolean;
  /** Verify numeric prices mentioned in final response appear in tool outputs when products/carts were returned. */
  checkPricesAgainstToolOutputs: boolean;
  /** Require at least one verified tool URL in final response when ShopCart returned URLs. */
  requireAtLeastOneToolUrlInResponse?: boolean;
}

export interface AgenticScenario {
  id: string;
  title: string;
  category: ScenarioCategory;
  lang: ScenarioLang;
  userPrompt: string;
  /**
   * True when this scenario is a natural everyday "Ohne-Zuruf" buying prompt
   * (no explicit "mach einen Preisvergleich", "gib mir Preisvergleichs-Links", etc.),
   * used to compute `proactive_trigger_rate`.
   */
  proactiveNoPromptCue?: boolean;
  /** Every tool in this list MUST be called at least once (for single-tool or combo flows). */
  requiredTools: string[];
  /** Optional: at least one of these tools must be called. */
  anyOfTools?: string[];
  /** Optional ordered subsequence that must occur in order (e.g. ["search_products", "get_product", "create_cart_link"]). */
  orderedSequence?: string[];
  /** True for non-shopping false-positive guard scenarios (must have 0 ShopCart tool calls). */
  forbidShopcartTools?: boolean;
  /** True if web_search is allowed without counting as a web_search escape. */
  allowWebSearch?: boolean;
  /** Declarative argument assertions checked against matching tool calls. */
  argChecks: ArgAssertion[];
  /** Safety checks for read-only / no-checkout compliance. */
  safetyChecks?: SafetyExpectation;
  /** Grounding checks against tool output URLs and prices. */
  groundingChecks: GroundingExpectation;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ToolCallTrace {
  turn: number;
  toolUseId: string;
  toolName: string;
  isShopcartTool: boolean;
  isWebSearch: boolean;
  input: Record<string, unknown>;
  isError: boolean;
  durationMs: number;
  /** Truncated raw result text for diagnostics. */
  resultPreview: string;
  /** Extracted verifiable URLs returned by this tool call. */
  returnedUrls: string[];
  /** Extracted numeric price amounts returned by this tool call. */
  returnedPrices: number[];
  /** Structured capability signals extracted from raw JSON payload for product-gap analysis. */
  payloadSignals?: {
    liveOffersCount?: number;
    liveVouchersCount?: number;
    liveDealsCount?: number;
    directoryMatchesCount?: number;
    visualMatchesCount?: number;
    wafRestricted?: boolean;
    liveApiConfigured?: boolean;
    handoffTier?: string;
    hasShippingCost?: boolean;
  };
}

export interface ArgCheckOutcome {
  tool: string;
  field: string;
  description: string;
  passed: boolean;
  actualValue?: unknown;
  reason?: string;
}

export interface ScenarioGrade {
  toolSelectionPassed: boolean;
  proactiveScenario: boolean;
  proactiveTriggered: boolean;
  webSearchEscaped: boolean;
  falsePositive: boolean;
  argumentAccuracy: number;
  argChecksTotal: number;
  argChecksPassed: number;
  argCheckOutcomes: ArgCheckOutcome[];
  multiStepApplicable: boolean;
  multiStepCompleted: boolean;
  groundingPassed: boolean;
  safetyPassed: boolean;
  groundingAndSafetyPassed: boolean;
  overallPassed: boolean;
  failureReasons: string[];
  ungroundedUrls: string[];
  ungroundedPrices: string[];
  routingGaps: RoutingGap[];
  productGaps: ProductGap[];
}

export interface ScenarioRunResult {
  scenarioId: string;
  title: string;
  category: ScenarioCategory;
  lang: ScenarioLang;
  mode: EvalMode;
  proactiveNoPromptCue: boolean;
  userPrompt: string;
  turns: number;
  stopReason: string;
  finalResponse: string;
  toolCalls: ToolCallTrace[];
  usage: TokenUsage;
  estimatedCostUsd: number;
  durationMs: number;
  grade: ScenarioGrade;
  error?: string;
}

export interface ModeSummaryMetrics {
  mode: EvalMode;
  totalScenarios: number;
  passedScenarios: number;
  overallPassRate: number;
  toolSelectionAccuracy: number;
  proactiveScenariosCount: number;
  proactiveTriggeredCount: number;
  proactiveTriggerRate: number;
  shoppingScenariosCount: number;
  webSearchEscapeCount: number;
  webSearchEscapeRate: number;
  nonShoppingScenariosCount: number;
  falsePositiveCount: number;
  falsePositiveRate: number;
  argumentAccuracy: number;
  argChecksPassed: number;
  argChecksTotal: number;
  multiStepTotal: number;
  multiStepCompleted: number;
  multiStepCompletionRate: number;
  groundingAndSafetyPassed: number;
  groundingAndSafetyRate: number;
  routingGapsCount: number;
  productGapsCount: number;
  usage: TokenUsage;
  estimatedCostUsd: number;
  durationMs: number;
}

export interface SuiteReport {
  schemaVersion: "1.1.0";
  generatedAt: string;
  label: string;
  model: string;
  dryRun: boolean;
  gitCommit: string | null;
  gitBranch: string | null;
  mcpServerMetadata: {
    instructionsLength: number;
    toolCount: number;
    toolNames: string[];
    promptCount: number;
  };
  modes: Record<EvalMode, ModeSummaryMetrics | undefined>;
  routingGaps: RoutingGap[];
  productGapsSummary: ProductGapAggregate[];
  results: ScenarioRunResult[];
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  system: string;
  tools: AnthropicToolDefinition[];
  messages: AnthropicMessage[];
}

export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface CliOptions {
  mode: CliMode;
  scenarios: string[];
  model: string;
  label: string;
  dryRun: boolean;
  outDir: string;
  concurrency: number;
  opRef?: string;
  opAccount?: string;
  help: boolean;
}
