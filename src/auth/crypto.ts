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

export function createCsrfPair(secret: string): { token: string; cookieValue: string } {
  const token = randomToken(24);
  const sig = crypto.createHmac("sha256", secret).update(token).digest("base64url");
  return { token, cookieValue: `${token}.${sig}` };
}

export function verifyCsrfPair(
  secret: string,
  cookieValue: string | undefined,
  formToken: string | undefined
): boolean {
  if (!cookieValue || !formToken) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;
  const [token, sig] = parts;
  if (!token || !sig) return false;
  if (!timingSafeEqualStr(token, formToken)) return false;
  const expectedSig = crypto.createHmac("sha256", secret).update(token).digest("base64url");
  return timingSafeEqualStr(sig, expectedSig);
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
