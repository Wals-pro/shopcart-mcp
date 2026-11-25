import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("base64url");
}

export function hmacSha256Hex(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomSixDigitCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function hashPassword(
  password: string,
  salt = crypto.randomBytes(16).toString("hex")
): Promise<{ hash: string; salt: string }> {
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string
): Promise<boolean> {
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHash, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export const CSRF_TOKEN_TTL_MS = 30 * 60 * 1000;

export function createSignedCsrfToken(
  secret: string,
  context: string,
  nowMs = Date.now()
): string {
  const exp = Math.floor((nowMs + CSRF_TOKEN_TTL_MS) / 1000);
  const nonce = randomToken(16);
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`csrf:v1:${context}:${exp}:${nonce}`)
    .digest("base64url");
  return `${exp}.${nonce}.${sig}`;
}

export function verifySignedCsrfToken(
  secret: string,
  token: string | undefined,
  context: string,
  nowMs = Date.now()
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  if (!expStr || !nonce || !sig || !/^\d+$/.test(expStr)) return false;
  const expSec = Number(expStr);
  if (!Number.isSafeInteger(expSec) || expSec * 1000 < nowMs) return false;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`csrf:v1:${context}:${expStr}:${nonce}`)
    .digest("base64url");
  return timingSafeEqualStr(sig, expectedSig);
}

export function isAllowedCsrfOrigin(
  originHeader: string | string[] | undefined,
  appOrigin: string
): boolean {
  if (originHeader === undefined) return true;
  const raw = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!raw || raw.trim() === "") return true;
  const normalized = raw.trim().replace(/\/+$/, "");
  const expected = appOrigin.trim().replace(/\/+$/, "");
  return normalized === expected;
}

export function createCsrfPair(
  secret: string,
  context = "default",
  nowMs = Date.now()
): { token: string; cookieValue: string } {
  const token = createSignedCsrfToken(secret, context, nowMs);
  const sig = crypto.createHmac("sha256", secret).update(token).digest("base64url");
  return { token, cookieValue: `${token}|${sig}` };
}

export function verifyCsrfPair(
  secret: string,
  cookieValue: string | undefined,
  formToken: string | undefined
): boolean {
  if (!cookieValue || !formToken) return false;
  let token: string | undefined;
  let sig: string | undefined;
  if (cookieValue.includes("|")) {
    const parts = cookieValue.split("|");
    if (parts.length !== 2) return false;
    [token, sig] = parts;
  } else {
    const parts = cookieValue.split(".");
    if (parts.length !== 2) return false;
    [token, sig] = parts;
  }
  if (!token || !sig) return false;
  if (!timingSafeEqualStr(token, formToken)) return false;
  const expectedSig = crypto.createHmac("sha256", secret).update(token).digest("base64url");
  return timingSafeEqualStr(sig, expectedSig);
}

export function verifyCsrfRequest(params: {
  secret: string;
  appOrigin: string;
  originHeader: string | string[] | undefined;
  formToken: string | undefined;
  cookieValue: string | undefined;
  context: string;
  nowMs?: number;
}): boolean {
  if (!isAllowedCsrfOrigin(params.originHeader, params.appOrigin)) {
    return false;
  }
  if (verifySignedCsrfToken(params.secret, params.formToken, params.context, params.nowMs)) {
    return true;
  }
  return verifyCsrfPair(params.secret, params.cookieValue, params.formToken);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}
