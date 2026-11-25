import type { AppConfig } from "../config.js";
import type { StorageBackend, UserRecord } from "../store/types.js";
import type { QuotaCheckResult } from "../mcp/tools.js";

const BERLIN_DAY_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function getBerlinDayKey(now = new Date()): string {
  return BERLIN_DAY_FORMATTER.format(now);
}

export function isPromoFreeProActive(config: AppConfig, now = new Date()): boolean {
  if (!config.promoFreeProUntil) return false;
  return now.getTime() <= config.promoFreeProUntil.getTime();
}

export interface EffectiveEntitlement {
  effectivePlan: "pro" | "pro_promo" | "free";
  dailyLimit: number;
  promoActive: boolean;
  isPaidPro: boolean;
}

export function getEffectiveEntitlement(
  user: UserRecord,
  config: AppConfig,
  now = new Date()
): EffectiveEntitlement {
  const promoActive = isPromoFreeProActive(config, now);
  const inGrace =
    user.currentPeriodEnd !== null && user.currentPeriodEnd.getTime() > now.getTime();
  const isPaidPro =
    user.plan === "pro" &&
    (user.status === "active" || user.status === "trialing" || inGrace);

  if (isPaidPro) {
    return {
      effectivePlan: "pro",
      dailyLimit: config.proDailyLimit,
      promoActive,
      isPaidPro: true
    };
  }

  if (promoActive) {
    return {
      effectivePlan: "pro_promo",
      dailyLimit: config.proDailyLimit,
      promoActive: true,
      isPaidPro: false
    };
  }

  return {
    effectivePlan: "free",
    dailyLimit: config.freeDailyLimit,
    promoActive: false,
    isPaidPro: false
  };
}

export async function consumeUserToolQuota(
  user: UserRecord,
  config: AppConfig,
  store: StorageBackend,
  now = new Date()
): Promise<QuotaCheckResult> {
  const dayKey = getBerlinDayKey(now);
  const ent = getEffectiveEntitlement(user, config, now);
  const res = await store.consumeDailyQuota(user.id, dayKey, ent.dailyLimit);

  return {
    allowed: res.allowed,
    used: res.used,
    limit: ent.dailyLimit,
    dayKey,
    plan: ent.effectivePlan,
    promoActive: ent.promoActive,
    upgradeUrl: `${config.appOrigin}/billing?email=${encodeURIComponent(user.email)}`
  };
}
