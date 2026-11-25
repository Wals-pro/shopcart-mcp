import { Firestore, Timestamp } from "@google-cloud/firestore";
import { sha256Hex } from "../auth/crypto.js";
import type {
  OAuthClientRecord,
  OAuthCodeRecord,
  OAuthTokenRecord,
  RefreshRotationResult,
  StorageBackend,
  UserRecord,
  WebSessionRecord
} from "./types.js";

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

  constructor(projectId?: string) {
    this.db = new Firestore({
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
      passwordHash: String(data.passwordHash),
      passwordSalt: String(data.passwordSalt),
      plan: data.plan === "pro" ? "pro" : "free",
      status:
        data.status === "trialing" || data.status === "past_due" || data.status === "canceled"
          ? data.status
          : "active",
      stripeCustomerId: typeof data.stripeCustomerId === "string" ? data.stripeCustomerId : null,
      stripeSubscriptionId:
        typeof data.stripeSubscriptionId === "string" ? data.stripeSubscriptionId : null,
      currentPeriodEnd: toNullableDate(data.currentPeriodEnd),
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
    const snap = await this.db.collection("oauth_clients").doc(clientId).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    const expiresAt = toDate(d.expiresAt);
    if (expiresAt.getTime() <= Date.now()) return null;
    return {
      clientId: snap.id,
      clientName: String(d.clientName ?? "OAuth Client"),
      redirectUris: Array.isArray(d.redirectUris) ? d.redirectUris.map(String) : [],
      tokenEndpointAuthMethod:
        d.tokenEndpointAuthMethod === "client_secret_basic" ||
        d.tokenEndpointAuthMethod === "client_secret_post"
          ? d.tokenEndpointAuthMethod
          : "none",
      clientSecretHash: typeof d.clientSecretHash === "string" ? d.clientSecretHash : null,
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
    await this.db
      .collection("oauth_clients")
      .doc(clientId)
      .set(
        {
          activated: true,
          expiresAt: Timestamp.fromDate(newExpiresAt)
        },
        { merge: true }
      );
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
      .set({
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
      });
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
    const snap = await this.db.collection("oauth_tokens").doc(tokenHash).get();
    if (!snap.exists) return null;
    return this.mapToken(tokenHash, snap.data()!);
  }

  async rotateRefreshToken(tokenHash: string): Promise<RefreshRotationResult> {
    const ref = this.db.collection("oauth_tokens").doc(tokenHash);
    const result = await this.db.runTransaction(async (tx): Promise<RefreshRotationResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: "invalid" };
      const rec = this.mapToken(tokenHash, snap.data()!);
      if (rec.type !== "refresh" || rec.revoked || rec.expiresAt.getTime() <= Date.now()) {
        return { status: "invalid" };
      }
      if (rec.rotatedAt !== null) {
        return { status: "replayed", familyId: rec.familyId };
      }
      const now = new Date();
      tx.update(ref, { rotatedAt: Timestamp.fromDate(now) });
      return { status: "ok", record: { ...rec, rotatedAt: now } };
    });

    if (result.status === "replayed") {
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
      await this.db.collection("oauth_tokens").doc(tokenHash).update({ revoked: true });
    }
  }

  async revokeTokenFamily(familyId: string): Promise<void> {
    const snap = await this.db
      .collection("oauth_tokens")
      .where("familyId", "==", familyId)
      .where("revoked", "==", false)
      .get();
    if (snap.empty) return;
    const batch = this.db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { revoked: true });
    }
    await batch.commit();
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
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 6) {
        return false;
      }
      throw err;
    }
  }
}
