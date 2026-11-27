import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse
} from "./types.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_AGENTIC_MODEL = "claude-haiku-4-5-20251001";
export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

const OP_REF_RE = /^op:\/\/[A-Za-z0-9._\-\/ ]{3,200}$/;
const OP_ACCOUNT_RE = /^[A-Za-z0-9._-]{2,120}$/;
const OP_READ_TIMEOUT_MS = 90_000;
const ANTHROPIC_KEY_RE = /sk-ant-[A-Za-z0-9_-]{8,}/g;

/**
 * Redacts any Anthropic API key pattern or explicit secret from diagnostic strings.
 */
export function redactSecrets(text: string, secret?: string): string {
  let out = text.replace(ANTHROPIC_KEY_RE, "[REDACTED_API_KEY]");
  if (secret && secret.length >= 8) {
    out = out.split(secret).join("[REDACTED_API_KEY]");
  }
  return out;
}

export function validateOpReference(opRef: string): string {
  const trimmed = opRef.trim();
  if (!OP_REF_RE.test(trimmed) || trimmed.includes("..")) {
    throw new Error(
      "Invalid 1Password reference: must start with 'op://' and contain only safe vault/item/field characters."
    );
  }
  return trimmed;
}

export function validateOpAccount(account: string): string {
  const trimmed = account.trim();
  if (!OP_ACCOUNT_RE.test(trimmed) || trimmed.includes("..")) {
    throw new Error(
      "Invalid 1Password account: must contain only letters, digits, dots, hyphens, or underscores."
    );
  }
  return trimmed;
}

/**
 * Resolves the Anthropic API key strictly into RAM.
 * Priority:
 * 1. `env.ANTHROPIC_API_KEY`
 * 2. Optional opt-in 1Password secret reference (`opRef` flag or `env.OP_ANTHROPIC_KEY_REF`)
 *
 * NEVER logs, prints, or writes the key to disk.
 */
export async function resolveAnthropicApiKey(opts: {
  opRef?: string;
  opAccount?: string;
  env?: NodeJS.ProcessEnv;
  opReader?: (ref: string, account?: string) => Promise<string>;
} = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const fromEnv = env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const rawOpRef = opts.opRef?.trim() || env.OP_ANTHROPIC_KEY_REF?.trim();
  if (rawOpRef) {
    const safeRef = validateOpReference(rawOpRef);
    const rawAccount = opts.opAccount?.trim() || env.OP_ACCOUNT?.trim();
    const safeAccount = rawAccount ? validateOpAccount(rawAccount) : undefined;
    const reader =
      opts.opReader ??
      (async (ref: string, account?: string) => {
        const args = account ? ["read", "--account", account, ref] : ["read", ref];
        const { stdout } = await execFileAsync("op", args, {
          timeout: OP_READ_TIMEOUT_MS,
          maxBuffer: 16 * 1024
        });
        return stdout;
      });

    let value: string;
    try {
      value = (await reader(safeRef, safeAccount)).trim();
    } catch (err) {
      const msg = err instanceof Error ? redactSecrets(err.message) : "op read failed";
      throw new Error(`Failed to read Anthropic API key from 1Password reference: ${msg}`);
    }

    if (!value) {
      throw new Error("1Password reference returned an empty Anthropic API key.");
    }
    return value;
  }

  throw new Error(
    "Missing Anthropic API key. Set ANTHROPIC_API_KEY in the environment, pass --op-ref op://<vault>/<item>/<field>, or run offline with --dry-run."
  );
}

export interface AnthropicClientOptions {
  apiUrl?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const seconds = Number.parseFloat(headerVal);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), 60_000);
  }
  const dateMs = Date.parse(headerVal);
  if (Number.isFinite(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? Math.min(diff, 60_000) : 0;
  }
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
}

/**
 * Calls the Anthropic Messages API using native `fetch` with exponential backoff
 * and jitter on rate-limit (429) and overload (529) responses.
 */
export async function callAnthropicMessages(
  requestBody: AnthropicMessagesRequest,
  apiKey: string,
  opts: AnthropicClientOptions = {}
): Promise<AnthropicMessagesResponse> {
  const apiUrl = opts.apiUrl ?? ANTHROPIC_API_URL;
  const maxRetries = opts.maxRetries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl ?? defaultSleep;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (response.ok) {
        const json = (await response.json()) as AnthropicMessagesResponse;
        return json;
      }

      const rawErrText = await response.text().catch(() => "");
      const safeErrText = redactSecrets(rawErrText.slice(0, 500), apiKey);

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
        const expBackoff = baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 400);
        const delayMs = Math.min(retryAfter ?? expBackoff + jitter, 30_000);
        await sleepImpl(delayMs);
        continue;
      }

      throw new Error(
        `Anthropic Messages API error (HTTP ${response.status}): ${safeErrText || response.statusText}`
      );
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const safeMsg = err instanceof Error ? redactSecrets(err.message, apiKey) : "Network error";
      lastError = new Error(isAbort ? `Anthropic API request timed out after ${timeoutMs}ms` : safeMsg);

      if (attempt < maxRetries && (isAbort || !safeMsg.startsWith("Anthropic Messages API error"))) {
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 300), 20_000);
        await sleepImpl(delayMs);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("Anthropic Messages API call failed after retries.");
}
