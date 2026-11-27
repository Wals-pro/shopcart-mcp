import { describe, expect, it } from "vitest";
import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { FirestoreStore } from "../src/store/firestore.js";
import type { OAuthClientRecord, OAuthTokenRecord } from "../src/store/types.js";

function grpcError(code: number, message: string): Error & { code: number } {
  const err = new Error(message) as Error & { code: number };
  err.code = code;
  return err;
}

interface FakeDocSnapshot {
  id: string;
  exists: boolean;
  ref: FakeDocRef;
  data(): Record<string, unknown> | undefined;
}

class FakeDocRef {
  constructor(
    readonly db: FakeFirestore,
    readonly collectionName: string,
    readonly id: string
  ) {}

  get path(): string {
    return `${this.collectionName}/${this.id}`;
  }

  async get(): Promise<FakeDocSnapshot> {
    const col = this.db.collections.get(this.collectionName);
    const val = col?.get(this.id);
    return {
      id: this.id,
      exists: val !== undefined,
      ref: this,
      data: () => (val !== undefined ? { ...val } : undefined)
    };
  }

  async create(data: Record<string, unknown>): Promise<void> {
    const col = this.db.ensureCollection(this.collectionName);
    if (col.has(this.id)) {
      throw grpcError(6, `ALREADY_EXISTS: ${this.path}`);
    }
    this.db.ops.push(`create:${this.path}`);
    col.set(this.id, { ...data });
  }

  async set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void> {
    const col = this.db.ensureCollection(this.collectionName);
    this.db.ops.push(`${opts?.merge ? "set_merge" : "set"}:${this.path}`);
    if (opts?.merge && col.has(this.id)) {
      col.set(this.id, { ...col.get(this.id)!, ...data });
    } else {
      col.set(this.id, { ...data });
    }
  }

  async update(patch: Record<string, unknown>): Promise<void> {
    const col = this.db.ensureCollection(this.collectionName);
    if (!col.has(this.id)) {
      throw grpcError(5, `NOT_FOUND: ${this.path}`);
    }
    this.db.ops.push(`update:${this.path}`);
    col.set(this.id, { ...col.get(this.id)!, ...patch });
  }

  async delete(): Promise<void> {
    const col = this.db.ensureCollection(this.collectionName);
    this.db.ops.push(`delete:${this.path}`);
    col.delete(this.id);
  }
}

class FakeQuery {
  constructor(
    private readonly db: FakeFirestore,
    private readonly collectionName: string,
    private readonly filters: Array<{ field: string; value: unknown }> = [],
    private readonly maxLimit?: number
  ) {}

  where(field: string, _op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, value }], this.maxLimit);
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.db, this.collectionName, this.filters, n);
  }

  async get(): Promise<{ empty: boolean; docs: FakeDocSnapshot[] }> {
    const col = this.db.collections.get(this.collectionName) ?? new Map<string, Record<string, unknown>>();
    const matches: FakeDocSnapshot[] = [];
    for (const [id, docData] of col.entries()) {
      const ok = this.filters.every((f) => docData[f.field] === f.value);
      if (ok) {
        const ref = new FakeDocRef(this.db, this.collectionName, id);
        matches.push({ id, exists: true, ref, data: () => ({ ...docData }) });
        if (this.maxLimit !== undefined && matches.length >= this.maxLimit) break;
      }
    }
    if (this.db.onAfterQuery) {
      this.db.onAfterQuery(this.collectionName, matches);
    }
    return { empty: matches.length === 0, docs: matches };
  }
}

class FakeWriteBatch {
  private readonly pending: Array<{ type: "update"; ref: FakeDocRef; patch: Record<string, unknown> }> = [];

  constructor(private readonly db: FakeFirestore) {}

  update(ref: FakeDocRef, patch: Record<string, unknown>): this {
    this.pending.push({ type: "update", ref, patch });
    return this;
  }

  async commit(): Promise<void> {
    if (this.pending.length > 500) {
      throw new Error(`Firestore batch limit exceeded: ${this.pending.length} > 500`);
    }
    this.db.batchSizes.push(this.pending.length);
    // Validate all docs exist first (atomic batch behavior in Firestore)
    for (const op of this.pending) {
      const col = this.db.collections.get(op.ref.collectionName);
      if (!col?.has(op.ref.id)) {
        throw grpcError(5, `NOT_FOUND in batch: ${op.ref.path}`);
      }
    }
    for (const op of this.pending) {
      await op.ref.update(op.patch);
    }
  }
}

class FakeFirestore {
  readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  readonly ops: string[] = [];
  readonly batchSizes: number[] = [];
  onAfterQuery?: (collectionName: string, docs: FakeDocSnapshot[]) => void;

  ensureCollection(name: string): Map<string, Record<string, unknown>> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map();
      this.collections.set(name, col);
    }
    return col;
  }

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocRef(this, name, id),
      where: (field: string, op: string, value: unknown) => new FakeQuery(this, name, [{ field, value }]),
      limit: (n: number) => new FakeQuery(this, name, [], n)
    };
  }

  batch(): FakeWriteBatch {
    return new FakeWriteBatch(this);
  }

  async runTransaction<T>(
    fn: (tx: {
      get: (ref: FakeDocRef) => Promise<FakeDocSnapshot>;
      set: (ref: FakeDocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
      update: (ref: FakeDocRef, patch: Record<string, unknown>) => void;
    }) => Promise<T>
  ): Promise<T> {
    let wrote = false;
    const writes: Array<() => Promise<void>> = [];
    const tx = {
      get: async (ref: FakeDocRef) => {
        if (wrote) {
          throw new Error("Firestore transactions require all reads to be executed before all writes.");
        }
        return ref.get();
      },
      set: (ref: FakeDocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        wrote = true;
        writes.push(() => ref.set(data, opts));
      },
      update: (ref: FakeDocRef, patch: Record<string, unknown>) => {
        wrote = true;
        writes.push(() => ref.update(patch));
      }
    };
    const result = await fn(tx);
    for (const w of writes) {
      await w();
    }
    return result;
  }
}

describe("FirestoreStore security hardening", () => {
  it("activateOAuthClient uses update(), ignores NOT_FOUND without creating a stub, and getOAuthClient fails closed on incomplete/downgraded docs", async () => {
    const db = new FakeFirestore();
    const store = new FirestoreStore("test-project", db as unknown as Firestore);
    const future = new Date(Date.now() + 3600 * 1000);

    // 1. Activating a deleted/missing client MUST NOT create a stub via set(..., { merge: true })
    await store.activateOAuthClient("dcr_deleted_client", future);
    expect(db.collections.get("oauth_clients")?.has("dcr_deleted_client")).toBe(false);
    expect(db.ops.some((op) => op.startsWith("set_merge:oauth_clients/"))).toBe(false);

    // 2. Existing confidential client activates cleanly via update() and stays confidential
    const confidentialClient: OAuthClientRecord = {
      clientId: "dcr_conf_1",
      clientName: "Confidential App",
      redirectUris: ["https://partner.example/cb"],
      tokenEndpointAuthMethod: "client_secret_basic",
      clientSecretHash: "sha256_secret_hash",
      scope: "mcp:read",
      activated: false,
      createdAt: new Date(),
      expiresAt: future
    };
    await store.saveOAuthClient(confidentialClient);
    const extended = new Date(Date.now() + 90 * 24 * 3600 * 1000);
    await store.activateOAuthClient("dcr_conf_1", extended);
    expect(db.ops).toContain("update:oauth_clients/dcr_conf_1");
    const loaded = await store.getOAuthClient("dcr_conf_1");
    expect(loaded?.activated).toBe(true);
    expect(loaded?.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(loaded?.clientSecretHash).toBe("sha256_secret_hash");

    // 3. Incomplete stub missing tokenEndpointAuthMethod MUST return null (never default to "none")
    db.ensureCollection("oauth_clients").set("dcr_stub_missing_auth", {
      activated: true,
      redirectUris: ["https://partner.example/cb"],
      expiresAt: Timestamp.fromDate(extended)
    });
    expect(await store.getOAuthClient("dcr_stub_missing_auth")).toBeNull();

    // 4. Empty redirectUris MUST return null
    db.ensureCollection("oauth_clients").set("dcr_stub_empty_uris", {
      activated: true,
      redirectUris: [],
      tokenEndpointAuthMethod: "none",
      expiresAt: Timestamp.fromDate(extended)
    });
    expect(await store.getOAuthClient("dcr_stub_empty_uris")).toBeNull();

    // 5. Confidential client missing clientSecretHash MUST return null
    db.ensureCollection("oauth_clients").set("dcr_conf_no_secret", {
      activated: true,
      redirectUris: ["https://partner.example/cb"],
      tokenEndpointAuthMethod: "client_secret_post",
      clientSecretHash: null,
      expiresAt: Timestamp.fromDate(extended)
    });
    expect(await store.getOAuthClient("dcr_conf_no_secret")).toBeNull();

    // 6. Path-traversal / slash clientId MUST fail closed
    expect(await store.getOAuthClient("../users/admin")).toBeNull();
    expect(await store.getOAuthClient("bad/id")).toBeNull();
  });

  it("revokeTokenFamily writes oauth_revoked_families marker first, chunks >500 tokens into <=400 batches, and tolerates TTL-deleted docs without set/merge", async () => {
    const db = new FakeFirestore();
    const store = new FirestoreStore("test-project", db as unknown as Firestore);
    const now = new Date();
    const exp = new Date(now.getTime() + 3600 * 1000);
    const familyId = "fam_large_550";

    for (let i = 0; i < 550; i++) {
      const tok: OAuthTokenRecord = {
        tokenHash: `tok_${i}`,
        type: i % 2 === 0 ? "access" : "refresh",
        familyId,
        userId: "user_1",
        clientId: "dcr_1",
        resource: "https://shopcart.wals.pro/mcp",
        scopes: ["mcp:read"],
        rotatedAt: null,
        revoked: false,
        createdAt: now,
        expiresAt: exp
      };
      await store.saveOAuthToken(tok);
    }

    db.ops.length = 0;
    db.batchSizes.length = 0;

    // Simulate a TTL deletion racing right after the query for doc tok_42
    db.onAfterQuery = (colName) => {
      if (colName === "oauth_tokens") {
        db.collections.get("oauth_tokens")?.delete("tok_42");
      }
    };

    await store.revokeTokenFamily(familyId);

    // 1. Revocation marker was persisted FIRST before any token doc updates
    expect(db.ops[0]).toBe(`set:oauth_revoked_families/${familyId}`);
    expect(db.collections.get("oauth_revoked_families")?.has(familyId)).toBe(true);

    // 2. WriteBatches were bounded <= 400 (550 -> 400 + 150)
    expect(db.batchSizes).toEqual([400, 150]);

    // 3. No set_merge was ever used as fallback, and tok_42 was NOT resurrected
    expect(db.ops.some((op) => op.startsWith("set_merge:"))).toBe(false);
    expect(db.collections.get("oauth_tokens")?.has("tok_42")).toBe(false);

    // 4. All remaining 549 docs are marked revoked: true
    let revokedCount = 0;
    for (const doc of db.collections.get("oauth_tokens")!.values()) {
      if (doc.revoked === true) revokedCount++;
    }
    expect(revokedCount).toBe(549);
  });

  it("rotateRefreshToken atomically issues next pair, checks oauth_revoked_families inside transaction, and marks family revoked on replay", async () => {
    const db = new FakeFirestore();
    const store = new FirestoreStore("test-project", db as unknown as Firestore);
    const now = new Date();
    const exp = new Date(now.getTime() + 3600 * 1000);
    const familyId = "fam_atomic_1";

    await store.saveOAuthToken({
      tokenHash: "rt_1",
      type: "refresh",
      familyId,
      userId: "u1",
      clientId: "c1",
      resource: "https://shopcart.wals.pro/mcp",
      scopes: ["mcp:read"],
      rotatedAt: null,
      revoked: false,
      createdAt: now,
      expiresAt: exp
    });

    // 1. Atomic rotation creates new access + refresh pair in a single transaction
    const rot1 = await store.rotateRefreshToken({
      tokenHash: "rt_1",
      expectedClientId: "c1",
      requestedResource: "https://shopcart.wals.pro/mcp",
      nextAccessTokenHash: "at_2",
      nextRefreshTokenHash: "rt_2",
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 86400,
      now
    });
    expect(rot1.status).toBe("ok");
    expect((await store.getOAuthToken("at_2"))?.revoked).toBe(false);
    expect((await store.getOAuthToken("rt_2"))?.revoked).toBe(false);

    // 2. Replaying rt_1 atomically writes oauth_revoked_families/{familyId} & revokes at_2 and rt_2
    const replay = await store.rotateRefreshToken({
      tokenHash: "rt_1",
      expectedClientId: "c1",
      nextAccessTokenHash: "at_3",
      nextRefreshTokenHash: "rt_3",
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 86400,
      now
    });
    expect(replay.status).toBe("replayed");
    expect(db.collections.get("oauth_revoked_families")?.has(familyId)).toBe(true);
    expect((await store.getOAuthToken("at_2"))?.revoked).toBe(true);
    expect((await store.getOAuthToken("rt_2"))?.revoked).toBe(true);
    expect(await store.getOAuthToken("at_3")).toBeNull();

    // 3. Even if an orphaned token doc still had revoked:false, getOAuthToken & rotateRefreshToken fail closed via oauth_revoked_families
    db.ensureCollection("oauth_tokens").set("at_orphan", {
      type: "access",
      familyId,
      userId: "u1",
      clientId: "c1",
      resource: "https://shopcart.wals.pro/mcp",
      scopes: ["mcp:read"],
      rotatedAt: null,
      revoked: false,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(exp)
    });
    expect((await store.getOAuthToken("at_orphan"))?.revoked).toBe(true);
  });

  it("claimStripeEvent and releaseStripeEvent allow clean retry after transient failure", async () => {
    const db = new FakeFirestore();
    const store = new FirestoreStore("test-project", db as unknown as Firestore);

    expect(await store.claimStripeEvent("evt_123", "customer.subscription.deleted")).toBe(true);
    expect(await store.claimStripeEvent("evt_123", "customer.subscription.deleted")).toBe(false);

    await store.releaseStripeEvent("evt_123");
    expect(db.collections.get("stripe_events")?.has("evt_123")).toBe(false);

    // Releasing an already-deleted event is idempotent (no error)
    await store.releaseStripeEvent("evt_123");

    // Retry can now claim the event cleanly
    expect(await store.claimStripeEvent("evt_123", "customer.subscription.deleted")).toBe(true);
  });

  it("applyStripeWebhookUpdate executes transactionally with tombstone and monotonic watermark protection", async () => {
    const db = new FakeFirestore();
    const store = new FirestoreStore("test-project", db as unknown as Firestore);
    const now = new Date();

    await store.createUser({
      id: "user_fs_wh_1",
      email: "fs@example.de",
      passwordHash: "",
      passwordSalt: "",
      plan: "free",
      status: "active",
      stripeCustomerId: "cus_fs_1",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      createdAt: now,
      updatedAt: now
    });

    // 1. Delete sub_1 at T=105 -> sets canceled, clears periodEnd, adds tombstone
    const delRes = await store.applyStripeWebhookUpdate("user_fs_wh_1", {
      eventCreated: 105,
      kind: "subscription_delete",
      subscriptionId: "sub_1"
    });
    expect(delRes).toEqual({ applied: true });
    let loaded = (await store.getUserById("user_fs_wh_1"))!;
    expect(loaded.plan).toBe("free");
    expect(loaded.status).toBe("canceled");
    expect(loaded.currentPeriodEnd).toBeNull();
    expect(loaded.lastStripeEventCreated).toBe(105);
    expect(loaded.deletedStripeSubscriptionIds).toEqual(["sub_1"]);

    // 2. Stale activate for sub_1 at T=100 -> rejected (subscription_deleted)
    const staleRes = await store.applyStripeWebhookUpdate("user_fs_wh_1", {
      eventCreated: 100,
      kind: "activate",
      plan: "pro",
      status: "active",
      subscriptionId: "sub_1",
      stripeCustomerId: "cus_fs_1"
    });
    expect(staleRes).toEqual({ applied: false, reason: "subscription_deleted" });

    // 3. Even a future-timestamped update for tombstoned sub_1 at T=200 -> rejected!
    const tombRes = await store.applyStripeWebhookUpdate("user_fs_wh_1", {
      eventCreated: 200,
      kind: "subscription_update",
      plan: "pro",
      status: "active",
      subscriptionId: "sub_1",
      currentPeriodEnd: new Date(1900000000 * 1000)
    });
    expect(tombRes).toEqual({ applied: false, reason: "subscription_deleted" });

    // 4. Genuine resubscription with new sub_2 at T=200 -> applied!
    const resubRes = await store.applyStripeWebhookUpdate("user_fs_wh_1", {
      eventCreated: 200,
      kind: "activate",
      plan: "pro",
      status: "active",
      subscriptionId: "sub_2",
      stripeCustomerId: "cus_fs_1"
    });
    expect(resubRes).toEqual({ applied: true });
    loaded = (await store.getUserById("user_fs_wh_1"))!;
    expect(loaded.plan).toBe("pro");
    expect(loaded.status).toBe("active");
    expect(loaded.stripeSubscriptionId).toBe("sub_2");
    expect(loaded.lastStripeEventCreated).toBe(200);
    expect(loaded.deletedStripeSubscriptionIds).toEqual(["sub_1"]);
  });
});
