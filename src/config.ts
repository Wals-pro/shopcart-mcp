import crypto from "node:crypto";

export interface AppConfig {
  port: number;
  appOrigin: string;
  storageBackend: "firestore" | "memory";
  gcpProject: string | undefined;
  freeDailyLimit: number;
  proDailyLimit: number;
  promoFreeProUntil: Date | null;
  promoTrialEnd: Date | null;
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  stripeProPriceId: string | undefined;
  sessionSecret: string;
  appName: string;
  repoUrl: string;
  version: string;
}

export function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Invalid APP_ORIGIN protocol: ${parsed.protocol}`);
  }
  return parsed.origin;
}

function parseOptionalDate(raw: string | undefined, fallback?: string): Date | null {
  const val = raw !== undefined ? raw.trim() : fallback;
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "8080", 10) || 8080;
  const appOrigin = normalizeOrigin(env.APP_ORIGIN ?? `http://localhost:${port}`);
  const explicitBackend = env.STORAGE_BACKEND?.trim().toLowerCase();
  const storageBackend: "firestore" | "memory" =
    explicitBackend === "memory"
      ? "memory"
      : explicitBackend === "firestore"
        ? "firestore"
        : env.NODE_ENV === "production" || env.K_SERVICE || env.GOOGLE_CLOUD_PROJECT
          ? "firestore"
          : "memory";

  const freeDailyLimit = Math.max(1, Number.parseInt(env.FREE_DAILY_LIMIT ?? "20", 10) || 20);
  const proDailyLimit = Math.max(freeDailyLimit, Number.parseInt(env.PRO_DAILY_LIMIT ?? "500", 10) || 500);

  const promoFreeProUntil = parseOptionalDate(
    env.PROMO_FREE_PRO_UNTIL,
    "2026-12-06T23:59:59+01:00"
  );
  const promoTrialEnd = parseOptionalDate(
    env.PROMO_TRIAL_END,
    "2026-12-07T00:00:00+01:00"
  );

  const sessionSecret =
    env.SESSION_SECRET && env.SESSION_SECRET.trim().length >= 16
      ? env.SESSION_SECRET.trim()
      : crypto.randomBytes(32).toString("hex");

  return {
    port,
    appOrigin,
    storageBackend,
    gcpProject: env.GOOGLE_CLOUD_PROJECT?.trim() || undefined,
    freeDailyLimit,
    proDailyLimit,
    promoFreeProUntil,
    promoTrialEnd,
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    stripeProPriceId: env.STRIPE_PRO_PRICE_ID?.trim() || undefined,
    sessionSecret,
    appName: "shopcart-mcp",
    repoUrl: "https://github.com/Wals-pro/shopcart-mcp",
    version: "0.1.0"
  };
}
