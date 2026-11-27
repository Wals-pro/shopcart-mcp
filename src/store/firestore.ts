import { Firestore, Timestamp } from "@google-cloud/firestore";
import { sha256Hex, timingSafeEqualStr } from "../auth/crypto.js";
import {
  computeStripeWebhookUserTransition,
  normalizeDeletedStripeSubscriptionIds,
  type EmailAuthChallengeRecord,
  type EmailChallengeVerifyResult,
  type OAuthChallengeParams,
  type OAuthClientRecord,
  type OAuthCodeRecord,
  type OAuthTokenRecord,
  type RefreshRotationResult,
  type RotateRefreshTokenParams,
  type StorageBackend,
  type StripeWebhookUpdateParams,
  type StripeWebhookUpdateResult,
  type UserRecord,
  type WebSessionRecord
} from "./types.js";

const GRPC_NOT_FOUND = 5;
const GRPC_ALREADY_EXISTS = 6;
const FAMILY_REVOCATION_TTL_MS = 95 * 24 * 3600 * 1000;
const MAX_BATCH_WRITES = 400;

function isGrpcErrorCode(err: unknown, expectedCode: number): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === expectedCode
  );
}

function isSafeFirestoreDocId(id: string): boolean {
  if (!id || id.length > 512) return false;
  if (id === "." || id === "..") return false;
  if (id.includes("/") || id.includes("..")) return false;
  if (id.startsWith("__") && id.endsWith("__")) return false;
  return true;
}

function toFirestoreTokenDoc(token: OAuthTokenRecord): Record<string, unknown> {
  return {
    type: token.type,
    familyId: token.familyId,
    userId: token.userId,
    clientId: token.clientId,
    resource: token.resource,
    scopes: token.scopes,
    rotatedAt: token.rotatedAt ? Timestamp.fromDate(token.rotatedAt) : null,
    revoked: token.revoked,
    createdAt: Timestamp.fromDate(token.createdAt),
    expiresAt: Timestamp.fromDate(token.expiresAt)
  };
}

function toDate(val: unknown): Date {
  if (val instanceof Date) return val;
  if (val instanceof Timestamp) return val.toDate();
  if (typeof val === "string" || typeof val === "number") return new Date(val);
  return new Date(0);
}

function toNullableDate(val: unknown): Date | null {
  if (val === null || val === undefined) return null;
  return toDate(val);
}

export class FirestoreStore implements StorageBackend {
  private readonly db: Firestore;

  constructor(projectId?: string, db?: Firestore) {
    this.db =
      db ??
      new Firestore({
        projectId,
        ignoreUndefinedProperties: true
      });
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.collection("_health").doc("ping").get();
      return true;
    } catch {
      return false;
    }
  }

  private mapUser(id: string, data: FirebaseFirestore.DocumentData): UserRecord {
    return {
      id,
      email: String(data.email),
      passwordHash: typeof data.passwordHash === "string" ? data.passwordHash : "",
      passwordSalt: typeof data.passwordSalt === "string" ? data.passwordSalt : "",
      plan: data.plan === "pro" ? "pro" : "free",
      status:
        data.status === "trialing" || data.status === "past_due" || data.status === "canceled"
          ? data.status
          : "active",
      stripeCustomerId: typeof data.stripeCustomerId === "string" ? data.stripeCustomerId : null,
      stripeSubscriptionId:
        typeof data.stripeSubscriptionId === "string" ? data.stripeSubscriptionId : null,
      currentPeriodEnd: toNullableDate(data.currentPeriodEnd),
      lastStripeEventCreated:
        typeof data.lastStripeEventCreated === "number" &&
        Number.isFinite(data.lastStripeEventCreated)
          ? data.lastStripeEventCreated
          : null,
      deletedStripeSubscriptionIds: normalizeDeletedStripeSubscriptionIds(
        data.deletedStripeSubscriptionIds
      ),
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt)
    };
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const snap = await this.db.collection("users").doc(userId).get();
    if (!snap.exists) return null;
    return this.mapUser(snap.id, snap.data()!);
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const id = sha256Hex(email.trim().toLowerCase());
    return this.getUserById(id);
  }

  async getUserByStripeCustomerId(customerId: string): Promise<UserRecord | null> {
    const snap = await this.db
      .collection("users")
      .where("stripeCustomerId", "==", customerId)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    return this.mapUser(doc.id, doc.data());
  }

  async createUser(user: UserRecord): Promise<boolean> {
    try {
      await this.db
        .collection("users")
        .doc(user.id)
        .create({
          email: user.email,
          passwordHash: user.passwordHash,
          passwordSalt: user.passwordSalt,
          plan: user.plan,
          status: user.status,
          stripeCustomerId: user.stripeCustomerId,
          stripeSubscriptionId: user.stripeSubscriptionId,
          currentPeriodEnd: user.currentPeriodEnd
            ? Timestamp.fromDate(user.currentPeriodEnd)
            : null,
          lastStripeEventCreated: user.lastStripeEventCreated ?? null,
          deletedStripeSubscriptionIds: normalizeDeletedStripeSubscriptionIds(
            user.deletedStripeSubscriptionIds
          ),
          createdAt: Timestamp.fromDate(user.createdAt),
          updatedAt: Timestamp.fromDate(user.updatedAt)
        });
      return true;
    } catch (err) {
      // ALREADY_EXISTS code === 6 in gRPC
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 6) {
        return false;
      }
      throw err;
    }
  }

  async updateUser(
    userId: string,
    patch: Partial<Omit<UserRecord, "id" | "email" | "createdAt">>
  ): Promise<void> {
    const update: Record<string, unknown> = {
      ...patch,
      updatedAt: Timestamp.fromDate(new Date())
    };
    if ("currentPeriodEnd" in patch) {
      update.currentPeriodEnd = patch.currentPeriodEnd
        ? Timestamp.fromDate(patch.currentPeriodEnd)
        : null;
    }
    await this.db.collection("users").doc(userId).set(update, { merge: true });
  }

  async getOAuthClient(clientId: string): Promise<OAuthClientRecord | null> {
    if (!isSafeFirestoreDocId(clientId)) return null;
    const snap = await this.db.collection("oauth_clients").doc(clientId).get();
    if (!snap.exists) return null;
    const d = snap.data();
    if (!d) return null;
    const expiresAt = toDate(d.expiresAt);
    if (expiresAt.getTime() <= Date.now()) return null;

    // Fail-closed on incomplete or corrupted client records (never downgrade auth method to "none")
    if (!Array.isArray(d.redirectUris) || d.redirectUris.length === 0) {
      return null;
    }
    const redirectUris: string[] = [];
    for (const uri of d.redirectUris) {
      if (typeof uri !== "string" || uri.trim().length === 0) {
        return null;
      }
      redirectUris.push(uri);
    }

    if (
      d.tokenEndpointAuthMethod !== "none" &&
      d.tokenEndpointAuthMethod !== "client_secret_basic" &&
      d.tokenEndpointAuthMethod !== "client_secret_post"
    ) {
      return null;
    }
    const tokenEndpointAuthMethod = d.tokenEndpointAuthMethod;

    let clientSecretHash: string | null = null;
    if (tokenEndpointAuthMethod !== "none") {
      if (typeof d.clientSecretHash !== "string" || d.clientSecretHash.trim().length === 0) {
        return null;
      }
      clientSecretHash = d.clientSecretHash;
    }

    return {
      clientId: snap.id,
      clientName: String(d.clientName ?? "OAuth Client"),
      redirectUris,
      tokenEndpointAuthMethod,
      clientSecretHash,
      scope: typeof d.scope === "string" ? d.scope : "mcp:read",
      activated: Boolean(d.activated),
      createdAt: toDate(d.createdAt),
      expiresAt
    };
  }

  async saveOAuthClient(client: OAuthClientRecord): Promise<void> {
    await this.db
      .collection("oauth_clients")
      .doc(client.clientId)
      .set({
        clientName: client.clientName,
        redirectUris: client.redirectUris,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        clientSecretHash: client.clientSecretHash,
        scope: client.scope,
        activated: client.activated,
        createdAt: Timestamp.fromDate(client.createdAt),
        expiresAt: Timestamp.fromDate(client.expiresAt)
      });
  }

  async activateOAuthClient(clientId: string, newExpiresAt: Date): Promise<void> {
    if (!isSafeFirestoreDocId(clientId)) return;
    try {
      await this.db
        .collection("oauth_clients")
        .doc(clientId)
        .update({
          activated: true,
          expiresAt: Timestamp.fromDate(newExpiresAt)
        });
    } catch (err) {
      if (isGrpcErrorCode(err, GRPC_NOT_FOUND)) {
        return;
      }
      throw err;
    }
  }

  async saveOAuthCode(code: OAuthCodeRecord): Promise<void> {
    await this.db
      .collection("oauth_codes")
      .doc(code.codeHash)
      .set({
        userId: code.userId,
        clientId: code.clientId,
        redirectUri: code.redirectUri,
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
        resource: code.resource,
        scopes: code.scopes,
        used: code.used,
        createdAt: Timestamp.fromDate(code.createdAt),
        expiresAt: Timestamp.fromDate(code.expiresAt)
      });
  }

  async consumeOAuthCode(codeHash: string): Promise<OAuthCodeRecord | null> {
    const ref = this.db.collection("oauth_codes").doc(codeHash);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const d = snap.data()!;
      const expiresAt = toDate(d.expiresAt);
      if (d.used === true || expiresAt.getTime() <= Date.now()) {
        return null;
      }
      tx.update(ref, { used: true });
      return {
        codeHash,
        userId: String(d.userId),
        clientId: String(d.clientId),
        redirectUri: String(d.redirectUri),
        codeChallenge: String(d.codeChallenge),
        codeChallengeMethod: "S256",
        resource: String(d.resource),
        scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : ["mcp:read"],
        used: true,
        createdAt: toDate(d.createdAt),
        expiresAt
      };
    });
  }

  async saveOAuthToken(token: OAuthTokenRecord): Promise<void> {
    await this.db
      .collection("oauth_tokens")
      .doc(token.tokenHash)
      .set(toFirestoreTokenDoc(token));
  }

  private mapToken(tokenHash: string, d: FirebaseFirestore.DocumentData): OAuthTokenRecord {
    return {
      tokenHash,
      type: d.type === "refresh" ? "refresh" : "access",
      familyId: String(d.familyId),
      userId: String(d.userId),
      clientId: String(d.clientId),
      resource: String(d.resource),
      scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : ["mcp:read"],
      rotatedAt: toNullableDate(d.rotatedAt),
      revoked: Boolean(d.revoked),
      createdAt: toDate(d.createdAt),
      expiresAt: toDate(d.expiresAt)
    };
  }

  async getOAuthToken(tokenHash: string): Promise<OAuthTokenRecord | null> {
    if (!isSafeFirestoreDocId(tokenHash)) return null;
    const snap = await this.db.collection("oauth_tokens").doc(tokenHash).get();
    if (!snap.exists) return null;
    const rec = this.mapToken(tokenHash, snap.data()!);
    if (!rec.revoked && isSafeFirestoreDocId(rec.familyId)) {
      const familySnap = await this.db.collection("oauth_revoked_families").doc(rec.familyId).get();
      if (familySnap.exists) {
        return { ...rec, revoked: true };
      }
    }
    return rec;
  }

  async rotateRefreshToken(params: RotateRefreshTokenParams): Promise<RefreshRotationResult> {
    if (!isSafeFirestoreDocId(params.tokenHash)) return { status: "invalid" };
    const now = params.now ?? new Date();
    const nowTs = Timestamp.fromDate(now);
    const familyRevokeExpiresTs = Timestamp.fromDate(new Date(now.getTime() + FAMILY_REVOCATION_TTL_MS));
    const refreshRef = this.db.collection("oauth_tokens").doc(params.tokenHash);

    const result = await this.db.runTransaction(async (tx): Promise<RefreshRotationResult> => {
      const snap = await tx.get(refreshRef);
      if (!snap.exists) return { status: "invalid" };
      const rec = this.mapToken(params.tokenHash, snap.data()!);
      if (rec.type !== "refresh" || rec.expiresAt.getTime() <= now.getTime()) {
        return { status: "invalid" };
      }
      if (!isSafeFirestoreDocId(rec.familyId)) {
        return { status: "invalid" };
      }

      const familyRef = this.db.collection("oauth_revoked_families").doc(rec.familyId);
      const familySnap = await tx.get(familyRef);

      if (rec.revoked || familySnap.exists) {
        return { status: "invalid" };
      }

      if (rec.rotatedAt !== null) {
        tx.set(familyRef, {
          familyId: rec.familyId,
          revokedAt: nowTs,
          expiresAt: familyRevokeExpiresTs
        });
        tx.update(refreshRef, { revoked: true });
        return { status: "replayed", familyId: rec.familyId };
      }

      if (rec.clientId !== params.expectedClientId) {
        tx.set(familyRef, {
          familyId: rec.familyId,
          revokedAt: nowTs,
          expiresAt: familyRevokeExpiresTs
        });
        tx.update(refreshRef, { revoked: true });
        return { status: "client_mismatch", familyId: rec.familyId };
      }

      if (params.requestedResource !== undefined && params.requestedResource !== rec.resource) {
        return { status: "resource_mismatch" };
      }

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

      const newAccessRef = this.db.collection("oauth_tokens").doc(accessToken.tokenHash);
      const newRefreshRef = this.db.collection("oauth_tokens").doc(refreshToken.tokenHash);
      tx.update(refreshRef, { rotatedAt: nowTs });
      tx.set(newAccessRef, toFirestoreTokenDoc(accessToken));
      tx.set(newRefreshRef, toFirestoreTokenDoc(refreshToken));
      return {
        status: "ok",
        record: { ...rec, rotatedAt: now },
        accessToken,
        refreshToken
      };
    });

    if (result.status === "replayed" || result.status === "client_mismatch") {
      await this.revokeTokenFamily(result.familyId);
    }
    return result;
  }

  async revokeToken(tokenHash: string): Promise<void> {
    const rec = await this.getOAuthToken(tokenHash);
    if (!rec) return;
    if (rec.type === "refresh") {
      await this.revokeTokenFamily(rec.familyId);
    } else {
      try {
        await this.db.collection("oauth_tokens").doc(tokenHash).update({ revoked: true });
      } catch (err) {
        if (!isGrpcErrorCode(err, GRPC_NOT_FOUND)) {
          throw err;
        }
      }
    }
  }

  async revokeTokenFamily(familyId: string): Promise<void> {
    if (!isSafeFirestoreDocId(familyId)) return;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + FAMILY_REVOCATION_TTL_MS);

    // 1. Persist family revocation marker FIRST so any concurrent read/rotation immediately fails closed.
    await this.db
      .collection("oauth_revoked_families")
      .doc(familyId)
      .set({
        familyId,
        revokedAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expiresAt)
      });

    // 2. Sweep individual token docs in bounded batches (<= 400 writes, safely below Firestore's 500 limit).
    const snap = await this.db
      .collection("oauth_tokens")
      .where("familyId", "==", familyId)
      .where("revoked", "==", false)
      .get();
    if (snap.empty) return;

    for (let i = 0; i < snap.docs.length; i += MAX_BATCH_WRITES) {
      const chunk = snap.docs.slice(i, i + MAX_BATCH_WRITES);
      const batch = this.db.batch();
      for (const doc of chunk) {
        batch.update(doc.ref, { revoked: true });
      }
      try {
        await batch.commit();
      } catch (err) {
        if (!isGrpcErrorCode(err, GRPC_NOT_FOUND)) {
          throw err;
        }
        for (const doc of chunk) {
          try {
            await doc.ref.update({ revoked: true });
          } catch (docErr) {
            if (!isGrpcErrorCode(docErr, GRPC_NOT_FOUND)) {
              throw docErr;
            }
          }
        }
      }
    }
  }

  async saveWebSession(session: WebSessionRecord): Promise<void> {
    await this.db
      .collection("web_sessions")
      .doc(session.sessionHash)
      .set({
        userId: session.userId,
        createdAt: Timestamp.fromDate(session.createdAt),
        expiresAt: Timestamp.fromDate(session.expiresAt)
      });
  }

  async getWebSession(sessionHash: string): Promise<WebSessionRecord | null> {
    const snap = await this.db.collection("web_sessions").doc(sessionHash).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    const expiresAt = toDate(d.expiresAt);
    if (expiresAt.getTime() <= Date.now()) return null;
    return {
      sessionHash,
      userId: String(d.userId),
      createdAt: toDate(d.createdAt),
      expiresAt
    };
  }

  async deleteWebSession(sessionHash: string): Promise<void> {
    await this.db.collection("web_sessions").doc(sessionHash).delete();
  }

  private mapEmailChallenge(
    challengeId: string,
    d: FirebaseFirestore.DocumentData
  ): EmailAuthChallengeRecord {
    let oauthParams: OAuthChallengeParams | null = null;
    if (d.oauthParams && typeof d.oauthParams === "object") {
      const o = d.oauthParams as Record<string, unknown>;
      oauthParams = {
        clientId: String(o.clientId ?? ""),
        clientName: String(o.clientName ?? ""),
        redirectUri: String(o.redirectUri ?? ""),
        codeChallenge: String(o.codeChallenge ?? ""),
        codeChallengeMethod: "S256",
        resource: String(o.resource ?? ""),
        scope: String(o.scope ?? "mcp:read"),
        state: String(o.state ?? "")
      };
    }

    return {
      challengeId,
      email: String(d.email ?? ""),
      purpose: d.purpose === "oauth" ? "oauth" : "billing",
      lang: d.lang === "de" ? "de" : "en",
      otpHash: String(d.otpHash ?? ""),
      magicTokenHash: String(d.magicTokenHash ?? ""),
      browserBindHash: typeof d.browserBindHash === "string" ? d.browserBindHash : null,
      oauthParams,
      attempts: Number(d.attempts ?? 0),
      maxAttempts: Number(d.maxAttempts ?? 5),
      used: Boolean(d.used),
      createdAt: toDate(d.createdAt),
      expiresAt: toDate(d.expiresAt)
    };
  }

  async saveEmailAuthChallenge(challenge: EmailAuthChallengeRecord): Promise<void> {
    await this.db
      .collection("auth_email_challenges")
      .doc(challenge.challengeId)
      .set({
        email: challenge.email,
        purpose: challenge.purpose,
        lang: challenge.lang,
        otpHash: challenge.otpHash,
        magicTokenHash: challenge.magicTokenHash,
        browserBindHash: challenge.browserBindHash,
        oauthParams: challenge.oauthParams,
        attempts: challenge.attempts,
        maxAttempts: challenge.maxAttempts,
        used: challenge.used,
        createdAt: Timestamp.fromDate(challenge.createdAt),
        expiresAt: Timestamp.fromDate(challenge.expiresAt)
      });
  }

  async getEmailAuthChallenge(challengeId: string): Promise<EmailAuthChallengeRecord | null> {
    const snap = await this.db.collection("auth_email_challenges").doc(challengeId).get();
    if (!snap.exists) return null;
    return this.mapEmailChallenge(challengeId, snap.data()!);
  }

  async verifyAndConsumeEmailOtp(
    challengeId: string,
    expectedOtpHash: string,
    now = new Date()
  ): Promise<EmailChallengeVerifyResult> {
    const ref = this.db.collection("auth_email_challenges").doc(challengeId);
    return this.db.runTransaction(async (tx): Promise<EmailChallengeVerifyResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: "not_found" };
      const rec = this.mapEmailChallenge(challengeId, snap.data()!);
      if (rec.used) return { status: "used" };
      if (rec.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
      if (rec.attempts >= rec.maxAttempts) return { status: "locked" };

      if (!timingSafeEqualStr(rec.otpHash, expectedOtpHash)) {
        const nextAttempts = rec.attempts + 1;
        tx.update(ref, { attempts: nextAttempts });
        if (nextAttempts >= rec.maxAttempts) {
          return { status: "locked" };
        }
        return {
          status: "invalid_code",
          remainingAttempts: rec.maxAttempts - nextAttempts
        };
      }

      tx.update(ref, { used: true, usedAt: Timestamp.fromDate(now) });
      return { status: "ok", challenge: { ...rec, used: true } };
    });
  }

  async verifyAndConsumeEmailMagicLink(
    challengeId: string,
    expectedMagicTokenHash: string,
    browserBindHash: string | null,
    now = new Date()
  ): Promise<EmailChallengeVerifyResult> {
    const ref = this.db.collection("auth_email_challenges").doc(challengeId);
    return this.db.runTransaction(async (tx): Promise<EmailChallengeVerifyResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: "not_found" };
      const rec = this.mapEmailChallenge(challengeId, snap.data()!);
      if (rec.used) return { status: "used" };
      if (rec.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
      if (rec.attempts >= rec.maxAttempts) return { status: "locked" };

      if (!timingSafeEqualStr(rec.magicTokenHash, expectedMagicTokenHash)) {
        const nextAttempts = rec.attempts + 1;
        tx.update(ref, { attempts: nextAttempts });
        if (nextAttempts >= rec.maxAttempts) {
          return { status: "locked" };
        }
        return {
          status: "invalid_code",
          remainingAttempts: rec.maxAttempts - nextAttempts
        };
      }

      if (rec.purpose === "oauth" && rec.browserBindHash) {
        if (!browserBindHash || !timingSafeEqualStr(rec.browserBindHash, browserBindHash)) {
          return { status: "browser_mismatch", challenge: rec };
        }
      }

      tx.update(ref, { used: true, usedAt: Timestamp.fromDate(now) });
      return { status: "ok", challenge: { ...rec, used: true } };
    });
  }

  async getDailyUsage(userId: string, dayKey: string): Promise<number> {
    const snap = await this.db.collection("usage_daily").doc(`${userId}_${dayKey}`).get();
    if (!snap.exists) return 0;
    return Number(snap.data()?.toolCalls ?? 0);
  }

  async consumeDailyQuota(
    userId: string,
    dayKey: string,
    limit: number
  ): Promise<{ allowed: boolean; used: number }> {
    const ref = this.db.collection("usage_daily").doc(`${userId}_${dayKey}`);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? Number(snap.data()?.toolCalls ?? 0) : 0;
      if (current >= limit) {
        return { allowed: false, used: current };
      }
      const next = current + 1;
      tx.set(
        ref,
        {
          userId,
          dayKey,
          toolCalls: next,
          updatedAt: Timestamp.fromDate(new Date())
        },
        { merge: true }
      );
      return { allowed: true, used: next };
    });
  }

  async claimStripeEvent(eventId: string, type: string): Promise<boolean> {
    if (!isSafeFirestoreDocId(eventId)) {
      throw new Error("Invalid Stripe event ID");
    }
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await this.db
        .collection("stripe_events")
        .doc(eventId)
        .create({
          type,
          processedAt: Timestamp.fromDate(now),
          expiresAt: Timestamp.fromDate(expiresAt)
        });
      return true;
    } catch (err) {
      if (isGrpcErrorCode(err, GRPC_ALREADY_EXISTS)) {
        return false;
      }
      throw err;
    }
  }

  async releaseStripeEvent(eventId: string): Promise<void> {
    if (!isSafeFirestoreDocId(eventId)) return;
    try {
      await this.db.collection("stripe_events").doc(eventId).delete();
    } catch (err) {
      if (!isGrpcErrorCode(err, GRPC_NOT_FOUND)) {
        throw err;
      }
    }
  }

  async applyStripeWebhookUpdate(
    userId: string,
    params: StripeWebhookUpdateParams
  ): Promise<StripeWebhookUpdateResult> {
    if (!isSafeFirestoreDocId(userId)) {
      return { applied: false, reason: "user_not_found" };
    }
    const ref = this.db.collection("users").doc(userId);
    return this.db.runTransaction(async (tx): Promise<StripeWebhookUpdateResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return { applied: false, reason: "user_not_found" };
      }
      const existing = this.mapUser(snap.id, snap.data()!);
      const { result, patch } = computeStripeWebhookUserTransition(existing, params);
      if (patch) {
        const update: Record<string, unknown> = {
          ...patch,
          updatedAt: Timestamp.fromDate(new Date())
        };
        if ("currentPeriodEnd" in patch) {
          update.currentPeriodEnd = patch.currentPeriodEnd
            ? Timestamp.fromDate(patch.currentPeriodEnd)
            : null;
        }
        tx.update(ref, update);
      }
      return result;
    });
  }
}
