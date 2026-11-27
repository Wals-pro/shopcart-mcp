import { timingSafeEqualStr } from "../auth/crypto.js";
import type {
  EmailAuthChallengeRecord,
  EmailChallengeVerifyResult,
  OAuthClientRecord,
  OAuthCodeRecord,
  OAuthTokenRecord,
  RefreshRotationResult,
  RotateRefreshTokenParams,
  StorageBackend,
  UserRecord,
  WebSessionRecord
} from "./types.js";

export class MemoryStore implements StorageBackend {
  private readonly users = new Map<string, UserRecord>();
  private readonly clients = new Map<string, OAuthClientRecord>();
  private readonly codes = new Map<string, OAuthCodeRecord>();
  private readonly tokens = new Map<string, OAuthTokenRecord>();
  private readonly revokedFamilies = new Set<string>();
  private readonly sessions = new Map<string, WebSessionRecord>();
  private readonly emailChallenges = new Map<string, EmailAuthChallengeRecord>();
  private readonly usage = new Map<string, number>();
  private readonly stripeEvents = new Set<string>();

  async ping(): Promise<boolean> {
    return true;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.email === normalized) return u;
    }
    return null;
  }

  async getUserByStripeCustomerId(customerId: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.stripeCustomerId === customerId) return u;
    }
    return null;
  }

  async createUser(user: UserRecord): Promise<boolean> {
    if (this.users.has(user.id)) return false;
    this.users.set(user.id, { ...user });
    return true;
  }

  async updateUser(
    userId: string,
    patch: Partial<Omit<UserRecord, "id" | "email" | "createdAt">>
  ): Promise<void> {
    const existing = this.users.get(userId);
    if (!existing) return;
    this.users.set(userId, { ...existing, ...patch, updatedAt: new Date() });
  }

  async getOAuthClient(clientId: string): Promise<OAuthClientRecord | null> {
    const client = this.clients.get(clientId);
    if (!client) return null;
    if (client.expiresAt.getTime() <= Date.now()) {
      this.clients.delete(clientId);
      return null;
    }
    return client;
  }

  async saveOAuthClient(client: OAuthClientRecord): Promise<void> {
    this.clients.set(client.clientId, { ...client });
  }

  async activateOAuthClient(clientId: string, newExpiresAt: Date): Promise<void> {
    const existing = this.clients.get(clientId);
    if (!existing) return;
    existing.activated = true;
    existing.expiresAt = newExpiresAt;
  }

  async saveOAuthCode(code: OAuthCodeRecord): Promise<void> {
    this.codes.set(code.codeHash, { ...code });
  }

  async consumeOAuthCode(codeHash: string): Promise<OAuthCodeRecord | null> {
    const rec = this.codes.get(codeHash);
    if (!rec) return null;
    if (rec.used || rec.expiresAt.getTime() <= Date.now()) return null;
    rec.used = true;
    return { ...rec };
  }

  async saveOAuthToken(token: OAuthTokenRecord): Promise<void> {
    this.tokens.set(token.tokenHash, { ...token });
  }

  async getOAuthToken(tokenHash: string): Promise<OAuthTokenRecord | null> {
    const rec = this.tokens.get(tokenHash);
    if (!rec) return null;
    const revoked = rec.revoked || this.revokedFamilies.has(rec.familyId);
    return { ...rec, revoked };
  }

  async rotateRefreshToken(params: RotateRefreshTokenParams): Promise<RefreshRotationResult> {
    const now = params.now ?? new Date();
    const rec = this.tokens.get(params.tokenHash);
    if (!rec || rec.type !== "refresh" || rec.expiresAt.getTime() <= now.getTime()) {
      return { status: "invalid" };
    }
    if (rec.revoked || this.revokedFamilies.has(rec.familyId)) {
      return { status: "invalid" };
    }
    if (rec.rotatedAt !== null) {
      await this.revokeTokenFamily(rec.familyId);
      return { status: "replayed", familyId: rec.familyId };
    }
    if (rec.clientId !== params.expectedClientId) {
      await this.revokeTokenFamily(rec.familyId);
      return { status: "client_mismatch", familyId: rec.familyId };
    }
    if (params.requestedResource !== undefined && params.requestedResource !== rec.resource) {
      return { status: "resource_mismatch" };
    }

    rec.rotatedAt = now;
    const accessToken: OAuthTokenRecord = {
      tokenHash: params.nextAccessTokenHash,
      type: "access",
      familyId: rec.familyId,
      userId: rec.userId,
      clientId: rec.clientId,
      resource: rec.resource,
      scopes: [...rec.scopes],
      rotatedAt: null,
      revoked: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + params.accessTtlSeconds * 1000)
    };
    const refreshToken: OAuthTokenRecord = {
      tokenHash: params.nextRefreshTokenHash,
      type: "refresh",
      familyId: rec.familyId,
      userId: rec.userId,
      clientId: rec.clientId,
      resource: rec.resource,
      scopes: [...rec.scopes],
      rotatedAt: null,
      revoked: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + params.refreshTtlSeconds * 1000)
    };
    this.tokens.set(accessToken.tokenHash, { ...accessToken });
    this.tokens.set(refreshToken.tokenHash, { ...refreshToken });
    return { status: "ok", record: { ...rec }, accessToken, refreshToken };
  }

  async revokeToken(tokenHash: string): Promise<void> {
    const rec = this.tokens.get(tokenHash);
    if (!rec) return;
    if (rec.type === "refresh") {
      await this.revokeTokenFamily(rec.familyId);
    } else {
      rec.revoked = true;
    }
  }

  async revokeTokenFamily(familyId: string): Promise<void> {
    this.revokedFamilies.add(familyId);
    for (const rec of this.tokens.values()) {
      if (rec.familyId === familyId) {
        rec.revoked = true;
      }
    }
  }

  async saveWebSession(session: WebSessionRecord): Promise<void> {
    this.sessions.set(session.sessionHash, { ...session });
  }

  async getWebSession(sessionHash: string): Promise<WebSessionRecord | null> {
    const rec = this.sessions.get(sessionHash);
    if (!rec) return null;
    if (rec.expiresAt.getTime() <= Date.now()) {
      this.sessions.delete(sessionHash);
      return null;
    }
    return { ...rec };
  }

  async deleteWebSession(sessionHash: string): Promise<void> {
    this.sessions.delete(sessionHash);
  }

  async saveEmailAuthChallenge(challenge: EmailAuthChallengeRecord): Promise<void> {
    this.emailChallenges.set(challenge.challengeId, {
      ...challenge,
      oauthParams: challenge.oauthParams ? { ...challenge.oauthParams } : null
    });
  }

  async getEmailAuthChallenge(challengeId: string): Promise<EmailAuthChallengeRecord | null> {
    const rec = this.emailChallenges.get(challengeId);
    if (!rec) return null;
    return {
      ...rec,
      oauthParams: rec.oauthParams ? { ...rec.oauthParams } : null
    };
  }

  async verifyAndConsumeEmailOtp(
    challengeId: string,
    expectedOtpHash: string,
    now = new Date()
  ): Promise<EmailChallengeVerifyResult> {
    const rec = this.emailChallenges.get(challengeId);
    if (!rec) return { status: "not_found" };
    if (rec.used) return { status: "used" };
    if (rec.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
    if (rec.attempts >= rec.maxAttempts) return { status: "locked" };

    if (!timingSafeEqualStr(rec.otpHash, expectedOtpHash)) {
      rec.attempts += 1;
      if (rec.attempts >= rec.maxAttempts) {
        return { status: "locked" };
      }
      return {
        status: "invalid_code",
        remainingAttempts: rec.maxAttempts - rec.attempts
      };
    }

    rec.used = true;
    return {
      status: "ok",
      challenge: {
        ...rec,
        oauthParams: rec.oauthParams ? { ...rec.oauthParams } : null
      }
    };
  }

  async verifyAndConsumeEmailMagicLink(
    challengeId: string,
    expectedMagicTokenHash: string,
    browserBindHash: string | null,
    now = new Date()
  ): Promise<EmailChallengeVerifyResult> {
    const rec = this.emailChallenges.get(challengeId);
    if (!rec) return { status: "not_found" };
    if (rec.used) return { status: "used" };
    if (rec.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
    if (rec.attempts >= rec.maxAttempts) return { status: "locked" };

    if (!timingSafeEqualStr(rec.magicTokenHash, expectedMagicTokenHash)) {
      rec.attempts += 1;
      if (rec.attempts >= rec.maxAttempts) {
        return { status: "locked" };
      }
      return {
        status: "invalid_code",
        remainingAttempts: rec.maxAttempts - rec.attempts
      };
    }

    if (rec.purpose === "oauth" && rec.browserBindHash) {
      if (!browserBindHash || !timingSafeEqualStr(rec.browserBindHash, browserBindHash)) {
        return {
          status: "browser_mismatch",
          challenge: {
            ...rec,
            oauthParams: rec.oauthParams ? { ...rec.oauthParams } : null
          }
        };
      }
    }

    rec.used = true;
    return {
      status: "ok",
      challenge: {
        ...rec,
        oauthParams: rec.oauthParams ? { ...rec.oauthParams } : null
      }
    };
  }

  async getDailyUsage(userId: string, dayKey: string): Promise<number> {
    return this.usage.get(`${userId}_${dayKey}`) ?? 0;
  }

  async consumeDailyQuota(
    userId: string,
    dayKey: string,
    limit: number
  ): Promise<{ allowed: boolean; used: number }> {
    const key = `${userId}_${dayKey}`;
    const current = this.usage.get(key) ?? 0;
    if (current >= limit) {
      return { allowed: false, used: current };
    }
    const next = current + 1;
    this.usage.set(key, next);
    return { allowed: true, used: next };
  }

  async claimStripeEvent(eventId: string, _type: string): Promise<boolean> {
    if (this.stripeEvents.has(eventId)) return false;
    this.stripeEvents.add(eventId);
    return true;
  }

  async releaseStripeEvent(eventId: string): Promise<void> {
    this.stripeEvents.delete(eventId);
  }
}
