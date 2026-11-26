import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * JSON Schema keywords rejected by Google Gemini `functionDeclarations`
 * (Gemini API / Gemini Web / Gemini CLI / Vertex AI).
 */
export const GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS = [
  "$schema",
  "additionalProperties",
  "propertyNames",
  "patternProperties",
  "$id",
  "$ref",
  "$defs",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "const",
  "oneOf",
  "uniqueItems"
] as const;

const UNSUPPORTED_KEYWORD_SET: ReadonlySet<string> = new Set(GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS);

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferPrimitiveType(value: unknown): string | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return undefined;
}

function resolveJsonPointer(root: JsonObject, ref: string): JsonObject | null {
  if (!ref.startsWith("#/")) return null;
  const segments = ref
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = root;
  for (const seg of segments) {
    if (!isPlainObject(current) || !(seg in current)) return null;
    current = current[seg];
  }
  return isPlainObject(current) ? current : null;
}

function isNullSchema(node: unknown): boolean {
  return isPlainObject(node) && node.type === "null";
}

function sanitizeNode(
  node: unknown,
  root: JsonObject,
  seenRefs: ReadonlySet<string>
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => sanitizeNode(item, root, seenRefs));
  }
  if (!isPlainObject(node)) {
    return node;
  }

  // Inline local $ref definitions (e.g. #/$defs/Foo) while preventing cycles
  let working: JsonObject = { ...node };
  if (typeof working.$ref === "string") {
    const refTarget = working.$ref;
    delete working.$ref;
    if (!seenRefs.has(refTarget)) {
      const resolved = resolveJsonPointer(root, refTarget);
      if (resolved) {
        const nextSeen = new Set(seenRefs);
        nextSeen.add(refTarget);
        const sanitizedTarget = sanitizeNode(resolved, root, nextSeen);
        if (isPlainObject(sanitizedTarget)) {
          working = { ...sanitizedTarget, ...working };
        }
      }
    }
  }

  // Handle const -> enum: [val]
  if ("const" in working) {
    const constVal = working.const;
    delete working.const;
    if (constVal !== undefined && constVal !== null) {
      if (!("enum" in working)) {
        working.enum = [constVal];
      }
      if (!("type" in working)) {
        const inferred = inferPrimitiveType(constVal);
        if (inferred) working.type = inferred;
      }
    }
  }

  // Convert exclusiveMinimum / exclusiveMaximum to inclusive bounds
  if (typeof working.exclusiveMinimum === "number") {
    if (typeof working.minimum !== "number") {
      working.minimum =
        working.type === "integer" ? working.exclusiveMinimum + 1 : working.exclusiveMinimum;
    }
    delete working.exclusiveMinimum;
  }
  if (typeof working.exclusiveMaximum === "number") {
    if (typeof working.maximum !== "number") {
      working.maximum =
        working.type === "integer" ? working.exclusiveMaximum - 1 : working.exclusiveMaximum;
    }
    delete working.exclusiveMaximum;
  }

  // Collapse oneOf branches where possible; never emit `oneOf`
  if (Array.isArray(working.oneOf)) {
    const rawBranches = working.oneOf;
    delete working.oneOf;
    const nonNullBranches = rawBranches
      .filter((branch) => !isNullSchema(branch))
      .map((branch) => sanitizeNode(branch, root, seenRefs))
      .filter(isPlainObject);

    if (nonNullBranches.length === 1) {
      working = { ...nonNullBranches[0], ...working };
    } else if (nonNullBranches.length > 1) {
      // If every branch reduces to an enum of the same primitive type, merge into one enum
      const allEnums = nonNullBranches.every(
        (b) => Array.isArray(b.enum) && typeof b.type === "string"
      );
      const firstType = nonNullBranches[0]?.type;
      if (allEnums && typeof firstType === "string" && nonNullBranches.every((b) => b.type === firstType)) {
        const merged = Array.from(
          new Set(nonNullBranches.flatMap((b) => b.enum as unknown[]))
        );
        working.type = firstType;
        working.enum = merged;
      } else if (!("type" in working) && typeof firstType === "string") {
        working.type = firstType;
      }
    }
  }

  // Normalize union type arrays such as ["string", "null"] -> "string"
  if (Array.isArray(working.type)) {
    const nonNullTypes = working.type.filter(
      (t): t is string => typeof t === "string" && t !== "null"
    );
    working.type = nonNullTypes[0] ?? "string";
  }

  const result: JsonObject = {};
  for (const [key, value] of Object.entries(working)) {
    if (UNSUPPORTED_KEYWORD_SET.has(key) || key === "definitions") {
      continue;
    }
    if (key === "properties" && isPlainObject(value)) {
      const sanitizedProps: JsonObject = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        sanitizedProps[propName] = sanitizeNode(propSchema, root, seenRefs);
      }
      result.properties = sanitizedProps;
    } else if (key === "items") {
      result.items = sanitizeNode(value, root, seenRefs);
    } else if ((key === "anyOf" || key === "allOf") && Array.isArray(value)) {
      result[key] = value
        .filter((branch) => !isNullSchema(branch))
        .map((branch) => sanitizeNode(branch, root, seenRefs));
    } else {
      result[key] = isPlainObject(value) || Array.isArray(value)
        ? sanitizeNode(value, root, seenRefs)
        : value;
    }
  }

  // Gemini requires explicit `items` on every array schema
  if (result.type === "array" && !isPlainObject(result.items)) {
    result.items = { type: "string" };
  }

  return result;
}

/**
 * Recursively strips/normalizes JSON Schema keywords rejected by Google Gemini
 * `functionDeclarations` while preserving valid MCP JSON Schema semantics.
 */
export function sanitizeSchemaForGemini<T extends Record<string, unknown>>(schema: T): T {
  return sanitizeNode(schema, schema, new Set()) as T;
}

/**
 * Recursively inspects a JSON Schema tree and returns human-readable violation
 * descriptions for any Gemini-unsupported keywords or constructs.
 */
export function findGeminiSchemaViolations(schema: unknown, currentPath = "$"): string[] {
  const violations: string[] = [];
  if (Array.isArray(schema)) {
    schema.forEach((item, idx) => {
      violations.push(...findGeminiSchemaViolations(item, `${currentPath}[${idx}]`));
    });
    return violations;
  }
  if (!isPlainObject(schema)) {
    return violations;
  }

  for (const key of Object.keys(schema)) {
    if (UNSUPPORTED_KEYWORD_SET.has(key)) {
      violations.push(`${currentPath}.${key}: unsupported Gemini schema keyword '${key}'`);
    }
  }

  if (Array.isArray(schema.type)) {
    violations.push(
      `${currentPath}.type: union type array [${schema.type.join(", ")}] is rejected by Gemini`
    );
  }

  if (schema.type === "array" && !isPlainObject(schema.items)) {
    violations.push(`${currentPath}: type "array" is missing explicit object "items" schema`);
  }

  if (isPlainObject(schema.properties)) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      violations.push(...findGeminiSchemaViolations(propSchema, `${currentPath}.properties.${propName}`));
    }
  }
  if (schema.items !== undefined) {
    violations.push(...findGeminiSchemaViolations(schema.items, `${currentPath}.items`));
  }
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((branch, idx) => {
      violations.push(...findGeminiSchemaViolations(branch, `${currentPath}.anyOf[${idx}]`));
    });
  }
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((branch, idx) => {
      violations.push(...findGeminiSchemaViolations(branch, `${currentPath}.allOf[${idx}]`));
    });
  }

  return violations;
}

function getSchemaMethodLiteral(requestSchema: unknown): string | undefined {
  if (!isPlainObject(requestSchema)) return undefined;
  const shape = isPlainObject(requestSchema.shape)
    ? requestSchema.shape
    : isPlainObject(requestSchema._def) && typeof requestSchema._def.shape === "function"
      ? (requestSchema._def.shape() as JsonObject)
      : isPlainObject(requestSchema._def) && isPlainObject(requestSchema._def.shape)
        ? requestSchema._def.shape
        : undefined;
  const methodField = shape?.method;
  if (!isPlainObject(methodField)) return undefined;
  const def = isPlainObject(methodField._def) ? methodField._def : methodField;
  if (typeof def.value === "string") return def.value;
  if (Array.isArray(def.values) && typeof def.values[0] === "string") return def.values[0];
  return undefined;
}

/**
 * Wraps the MCP Server's `tools/list` handler registration so EVERY tool
 * registered on `server` (now or in the future) automatically emits
 * 100% Gemini-compatible `inputSchema` / `outputSchema` without weakening
 * server-side Zod input validation on `tools/call`.
 */
export function installGeminiSchemaSanitizer(server: McpServer): void {
  const lowLevel = server.server;
  const originalSetRequestHandler = lowLevel.setRequestHandler.bind(lowLevel);

  lowLevel.setRequestHandler = ((
    requestSchema: Parameters<typeof lowLevel.setRequestHandler>[0],
    handler: Parameters<typeof lowLevel.setRequestHandler>[1]
  ) => {
    if (getSchemaMethodLiteral(requestSchema) === "tools/list") {
      return originalSetRequestHandler(requestSchema, async (request, extra) => {
        const result = (await handler(request, extra)) as {
          tools?: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };
        if (!result || !Array.isArray(result.tools)) {
          return result;
        }
        return {
          ...result,
          tools: result.tools.map((tool) => ({
            ...tool,
            ...(isPlainObject(tool.inputSchema)
              ? { inputSchema: sanitizeSchemaForGemini(tool.inputSchema) }
              : {}),
            ...(isPlainObject(tool.outputSchema)
              ? { outputSchema: sanitizeSchemaForGemini(tool.outputSchema) }
              : {})
          }))
        };
      });
    }
    return originalSetRequestHandler(requestSchema, handler);
  }) as typeof lowLevel.setRequestHandler;
}
