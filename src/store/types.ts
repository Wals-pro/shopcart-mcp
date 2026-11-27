export type UserPlan = "free" | "pro";
export type UserStatus = "active" | "trialing" | "past_due" | "canceled";
export type ClientAuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  plan: UserPlan;
  status: UserStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  lastStripeEventCreated?: number | null;
  deletedStripeSubscriptionIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type StripeWebhookUpdateKind =
  | "activate"
  | "subscription_update"
  | "subscription_delete"
  | "payment_failed"
  | "bind_customer";

export interface StripeWebhookUpdateParams {
  eventCreated: number;
  kind: StripeWebhookUpdateKind;
  subscriptionId?: string | null;
  stripeCustomerId?: string | null;
  plan?: UserPlan;
  status?: UserStatus;
  currentPeriodEnd?: Date | null;
}

export interface StripeWebhookUpdateResult {
  applied: boolean;
  reason?: string;
}

const MAX_DELETED_STRIPE_SUBSCRIPTION_IDS = 25;

export function normalizeDeletedStripeSubscriptionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0 && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out.slice(-MAX_DELETED_STRIPE_SUBSCRIPTION_IDS);
}

/**
 * Pure transactional state transition for Stripe webhook updates.
 * Shared between MemoryStore and FirestoreStore so both enforce identical
 * tombstone, monotonic watermark, and same-second tie-breaker invariants.
 */
export function computeStripeWebhookUserTransition(
  existing: UserRecord,
  params: StripeWebhookUpdateParams
): {
  result: StripeWebhookUpdateResult;
  patch: Partial<Omit<UserRecord, "id" | "email" | "createdAt">> | null;
} {
  const deletedIds = normalizeDeletedStripeSubscriptionIds(existing.deletedStripeSubscriptionIds);
  const lastCreated =
    typeof existing.lastStripeEventCreated === "number" &&
    Number.isFinite(existing.lastStripeEventCreated)
      ? existing.lastStripeEventCreated
      : null;
  const eventCreated =
    typeof params.eventCreated === "number" &&
    Number.isFinite(params.eventCreated) &&
    params.eventCreated >= 0
      ? Math.floor(params.eventCreated)
      : 0;
  const subId =
    typeof params.subscriptionId === "string" && params.subscriptionId.length > 0
      ? params.subscriptionId
      : null;
  const nextWatermark = Math.max(lastCreated ?? 0, eventCreated);

  // 1. Tombstone protection: a deleted subscription can NEVER resurrect entitlement
  if (
    (params.kind === "activate" || params.kind === "subscription_update") &&
    subId !== null &&
    deletedIds.includes(subId)
  ) {
    return { result: { applied: false, reason: "subscription_deleted" }, patch: null };
  }

  // 2. Monotonic timestamp check (all non-delete events older than last processed event are stale)
  if (lastCreated !== null && eventCreated < lastCreated && params.kind !== "subscription_delete") {
    return { result: { applied: false, reason: "stale_event" }, patch: null };
  }

  // 3. Same-second tie-breaker after cancel
  if (
    lastCreated !== null &&
    eventCreated === lastCreated &&
    existing.status === "canceled" &&
    (params.kind === "activate" || params.kind === "subscription_update") &&
    (!subId || subId === existing.stripeSubscriptionId || deletedIds.includes(subId))
  ) {
    return { result: { applied: false, reason: "stale_same_second_after_cancel" }, patch: null };
  }

  switch (params.kind) {
    case "subscription_delete": {
      const nextDeletedIds =
        subId !== null
          ? [...deletedIds.filter((id) => id !== subId), subId].slice(
              -MAX_DELETED_STRIPE_SUBSCRIPTION_IDS
            )
          : deletedIds;
      const matchesActiveOrEmpty =
        !existing.stripeSubscriptionId || !subId || existing.stripeSubscriptionId === subId;

      if (!matchesActiveOrEmpty) {
        // Still record tombstone & advance watermark so the deleted sub can never resurrect later
        return {
          result: { applied: false, reason: "different_active_subscription" },
          patch: {
            deletedStripeSubscriptionIds: nextDeletedIds,
            lastStripeEventCreated: nextWatermark
          }
        };
      }

      return {
        result: { applied: true },
        patch: {
          plan: "free",
          status: "canceled",
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          deletedStripeSubscriptionIds: nextDeletedIds,
          lastStripeEventCreated: nextWatermark
        }
      };
    }

    case "payment_failed": {
      if (existing.status === "canceled") {
        return { result: { applied: false, reason: "already_canceled" }, patch: null };
      }
      if (subId !== null && deletedIds.includes(subId)) {
        return { result: { applied: false, reason: "subscription_deleted" }, patch: null };
      }
      if (
        subId !== null &&
        existing.stripeSubscriptionId !== null &&
        existing.stripeSubscriptionId !== subId
      ) {
        return { result: { applied: false, reason: "different_active_subscription" }, patch: null };
      }
      return {
        result: { applied: true },
        patch: {
          ...(params.plan !== undefined ? { plan: params.plan } : {}),
          status: "past_due",
          ...(params.stripeCustomerId && !existing.stripeCustomerId
            ? { stripeCustomerId: params.stripeCustomerId }
            : {}),
          lastStripeEventCreated: nextWatermark
        }
      };
    }

    case "bind_customer": {
      if (params.stripeCustomerId && !existing.stripeCustomerId) {
        return {
          result: { applied: true },
          patch: {
            stripeCustomerId: params.stripeCustomerId
          }
        };
      }
      return { result: { applied: false, reason: "no_change" }, patch: null };
    }

    case "activate": {
      return {
        result: { applied: true },
        patch: {
          plan: params.plan ?? "pro",
          status: params.status ?? "active",
          stripeCustomerId: params.stripeCustomerId ?? existing.stripeCustomerId,
          stripeSubscriptionId: subId ?? existing.stripeSubscriptionId,
          lastStripeEventCreated: nextWatermark
        }
      };
    }

    case "subscription_update": {
      return {
        result: { applied: true },
        patch: {
          plan: params.plan ?? existing.plan,
          status: params.status ?? existing.status,
          stripeCustomerId: params.stripeCustomerId ?? existing.stripeCustomerId,
          stripeSubscriptionId: subId ?? existing.stripeSubscriptionId,
          currentPeriodEnd: params.currentPeriodEnd ?? null,
          lastStripeEventCreated: nextWatermark
        }
      };
    }
  }
}

export interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: ClientAuthMethod;
  clientSecretHash: string | null;
  scope: string;
  activated: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthCodeRecord {
  codeHash: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scopes: string[];
  used: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthTokenRecord {
  tokenHash: string;
  type: "access" | "refresh";
  familyId: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: string[];
  rotatedAt: Date | null;
  revoked: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface WebSessionRecord {
  sessionHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthChallengeParams {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scope: string;
  state: string;
}

export type EmailChallengePurpose = "oauth" | "billing";

export interface EmailAuthChallengeRecord {
  challengeId: string;
  email: string;
  purpose: EmailChallengePurpose;
  lang: "de" | "en";
  otpHash: string;
  magicTokenHash: string;
  browserBindHash: string | null;
  oauthParams: OAuthChallengeParams | null;
  attempts: number;
  maxAttempts: number;
  used: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export type EmailChallengeVerifyResult =
  | { status: "ok"; challenge: EmailAuthChallengeRecord }
  | { status: "invalid_code"; remainingAttempts: number }
  | { status: "locked" }
  | { status: "expired" }
  | { status: "used" }
  | { status: "not_found" }
  | { status: "browser_mismatch"; challenge: EmailAuthChallengeRecord };

export interface RotateRefreshTokenParams {
  tokenHash: string;
  expectedClientId: string;
  requestedResource?: string;
  nextAccessTokenHash: string;
  nextRefreshTokenHash: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  now?: Date;
}

export type RefreshRotationResult =
  | {
      status: "ok";
      record: OAuthTokenRecord;
      accessToken: OAuthTokenRecord;
      refreshToken: OAuthTokenRecord;
    }
  | { status: "replayed"; familyId: string }
  | { status: "client_mismatch"; familyId: string }
  | { status: "resource_mismatch" }
  | { status: "invalid" };

export interface StorageBackend {
  ping(): Promise<boolean>;

  // Users
  getUserById(userId: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserByStripeCustomerId(customerId: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<boolean>;
  updateUser(userId: string, patch: Partial<Omit<UserRecord, "id" | "email" | "createdAt">>): Promise<void>;

  // DCR Clients
  getOAuthClient(clientId: string): Promise<OAuthClientRecord | null>;
  saveOAuthClient(client: OAuthClientRecord): Promise<void>;
  activateOAuthClient(clientId: string, newExpiresAt: Date): Promise<void>;

  // Authorization Codes
  saveOAuthCode(code: OAuthCodeRecord): Promise<void>;
  consumeOAuthCode(codeHash: string): Promise<OAuthCodeRecord | null>;

  // Tokens (Access & Refresh)
  saveOAuthToken(token: OAuthTokenRecord): Promise<void>;
  getOAuthToken(tokenHash: string): Promise<OAuthTokenRecord | null>;
  rotateRefreshToken(params: RotateRefreshTokenParams): Promise<RefreshRotationResult>;
  revokeToken(tokenHash: string): Promise<void>;
  revokeTokenFamily(familyId: string): Promise<void>;

  // Web sessions (for /billing)
  saveWebSession(session: WebSessionRecord): Promise<void>;
  getWebSession(sessionHash: string): Promise<WebSessionRecord | null>;
  deleteWebSession(sessionHash: string): Promise<void>;

  // Passwordless Email Auth Challenges (OTP + Magic Link)
  saveEmailAuthChallenge(challenge: EmailAuthChallengeRecord): Promise<void>;
  getEmailAuthChallenge(challengeId: string): Promise<EmailAuthChallengeRecord | null>;
  verifyAndConsumeEmailOtp(
    challengeId: string,
    expectedOtpHash: string,
    now?: Date
  ): Promise<EmailChallengeVerifyResult>;
  verifyAndConsumeEmailMagicLink(
    challengeId: string,
    expectedMagicTokenHash: string,
    browserBindHash: string | null,
    now?: Date
  ): Promise<EmailChallengeVerifyResult>;

  // Daily Usage Quota
  getDailyUsage(userId: string, dayKey: string): Promise<number>;
  consumeDailyQuota(
    userId: string,
    dayKey: string,
    limit: number
  ): Promise<{ allowed: boolean; used: number }>;

  // Stripe Webhook Idempotency & Transactional Entitlement Updates
  claimStripeEvent(eventId: string, type: string): Promise<boolean>;
  releaseStripeEvent(eventId: string): Promise<void>;
  applyStripeWebhookUpdate(
    userId: string,
    params: StripeWebhookUpdateParams
  ): Promise<StripeWebhookUpdateResult>;
}
