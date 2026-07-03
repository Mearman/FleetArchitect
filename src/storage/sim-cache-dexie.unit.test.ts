import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import type { Table } from "dexie";
import { FleetArchitectDatabase, _setDatabaseForTesting } from "@/storage/db";
import type { SimCacheRecord } from "@/storage/db";
import { DexieSimCache, estimateResultBytes } from "@/storage/sim-cache-dexie";
import { sampleResult } from "@/domain/cache/test-fixtures";
import type { BattleFrame, BattleResult } from "@/schema/battle";

/** A budget large enough never to trigger byte eviction in count-cap tests. */
const DEFAULT_LARGE_BYTES = 1024 * 1024 * 1024;
/** An entry cap large enough never to trigger count eviction in byte tests. */
const DEFAULT_LARGE_ENTRIES = 1_000_000;

/**
 * Wrap a Dexie table so every property access forwards to the underlying table
 * except `put`, which is replaced by the supplied stub. Used to simulate the
 * capacity-boundary errors a multi-hundred-MB BattleResult triggers in the
 * browser without having to build such a result. `Object.defineProperty`
 * overrides `put` on the table instance directly, keeping the full `Table`
 * structural type so no assertion is needed at the call site. It mutates the
 * table in place, so a stub that forwards on retry (the QuotaExceededError
 * path) must capture the real `put` first — see that test.
 */
function withPutStub(
  table: Table<SimCacheRecord, string>,
  put: (record: SimCacheRecord) => Promise<void>,
): Table<SimCacheRecord, string> {
  return Object.defineProperty(table, "put", { value: put, configurable: true });
}

let dbCounter = 0;

/** Spin up a fresh fake-indexeddb-backed database with a unique name. */
function freshDatabase(): FleetArchitectDatabase {
  dbCounter += 1;
  const db = new FleetArchitectDatabase(`test-sim-cache-${dbCounter}`, {
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  _setDatabaseForTesting(db);
  return db;
}

/**
 * Seed both the result table (`simCache`) and its metadata mirror (`simCacheMeta`)
 * in one call. Tests that pre-seed entries with specific byte / lastAccess values
 * bypass the cache's `set` method (which computes its own bytes / lastAccess), so
 * they must populate BOTH tables to match the dual-write contract — otherwise
 * `#ensureMeta` (which reads only `simCacheMeta`) would not see the seeded rows
 * and eviction would misbehave.
 */
async function seedBoth(
  db: FleetArchitectDatabase,
  key: string,
  result: BattleResult,
  bytes: number,
  lastAccess: number,
): Promise<void> {
  await db.simCache.put({ key, result, bytes, lastAccess });
  await db.simCacheMeta.put({ key, bytes, lastAccess });
}

describe("DexieSimCache", () => {
  let db: FleetArchitectDatabase;

  beforeEach(() => {
    db = freshDatabase();
  });

  it("returns undefined on a miss and round-trips a stored result", async () => {
    const cache = new DexieSimCache(db.simCache, db.simCacheMeta);
    expect(await cache.get("missing")).toBeUndefined();
    expect(await cache.has("missing")).toBe(false);

    const result = sampleResult("r1", { ticks: 7 });
    await cache.set("k1", result);

    expect(await cache.has("k1")).toBe(true);
    expect(await cache.get("k1")).toEqual(result);
  });

  it("records bytes and lastAccess on set", async () => {
    const cache = new DexieSimCache(db.simCache, db.simCacheMeta);
    await cache.set("k1", sampleResult("r1"));

    const record = await db.simCache.get("k1");
    expect(record).toBeDefined();
    expect(record?.bytes).toBeGreaterThan(0);
    expect(record?.lastAccess).toBeGreaterThan(0);
  });

  it("treats a grossly corrupt stored record as a miss and evicts it", async () => {
    const cache = new DexieSimCache(db.simCache, db.simCacheMeta);
    // Store a record whose `result` fails the cheap top-level shape guard: the
    // `frames` field is not an array, simulating a truncated write or gross
    // corruption. Written via the raw IDB object store (opening a fresh
    // connection to the same fake-indexeddb database) so the broken object lands
    // in IndexedDB directly, bypassing Dexie's typed `put` which would resist a
    // malformed shape. The inputs + SimConfig + signature cover every
    // determinant, so the only path to a malformed row is corruption; the guard
    // catches and evicts it.
    // Force Dexie to open its connection so backendDB() is non-null, then grab
    // the underlying IDBDatabase to write a malformed record directly to the
    // object store, bypassing Dexie's typed `put` which would resist a
    // non-BattleResult shape.
    await db.open();
    const idb = db.backendDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction("simCache", "readwrite");
      tx.objectStore("simCache").put({
        key: "broken",
        result: { id: "ok", winner: "attacker", ticks: 5, frames: "not-an-array" },
        bytes: 10,
        lastAccess: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb transaction error"));
    });

    // The record fails the shape guard, so it is a miss and is evicted.
    expect(await cache.get("broken")).toBeUndefined();
    expect(await cache.has("broken")).toBe(false);
  });

  it("returns a valid stored result without a deep parse", async () => {
    const cache = new DexieSimCache(db.simCache, db.simCacheMeta);
    const stored = sampleResult("ok", { ticks: 7 });
    await cache.set("k", stored);
    // The cheap shape guard narrows record.result to BattleResult and returns it
    // as-is; no deep Zod parse runs on the read path.
    const got = await cache.get("k");
    expect(got).toEqual(stored);
  });

  it("bumps lastAccess on a hit for LRU recency", async () => {
    const cache = new DexieSimCache(db.simCache, db.simCacheMeta);
    await cache.set("k1", sampleResult("r1"));
    const before = await db.simCache.get("k1");

    await cache.get("k1");
    // The fire-and-forget update is awaited indirectly by reading after it; allow
    // the microtask queue to drain so the recency bump has landed.
    await Promise.resolve();
    const after = await db.simCache.get("k1");

    expect(before?.lastAccess).toBeDefined();
    expect(after?.lastAccess).toBeGreaterThanOrEqual(before?.lastAccess ?? 0);
  });

  it("evicts oldest-lastAccess rows past the entry-count cap", async () => {
    const cache = new DexieSimCache(db.simCache, db.simCacheMeta, DEFAULT_LARGE_BYTES, 2);
    await seedBoth(db, "a", sampleResult("a"), 10, 1000);
    await seedBoth(db, "b", sampleResult("b"), 10, 2000);
    // The third set exceeds the 2-entry cap; the oldest-lastAccess row ("a") goes.
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(false);
    expect(await cache.has("b")).toBe(true);
    expect(await cache.has("c")).toBe(true);
  });

  it("evicts oldest-lastAccess rows past the byte budget", async () => {
    // The freshly-set row "c" measures its own bytes via the cache's estimator
    // (typed-array buffers + per-entity scalar — never a JSON serialisation);
    // the two pre-seeded rows carry large explicit byte sizes. Budget = (c's
    // measured size) + 1, so the two large old rows must both be evicted to fit
    // "c" while "c" survives.
    const cResult = sampleResult("c");
    const cBytes = estimateResultBytes(cResult);
    const cache = new DexieSimCache(db.simCache, db.simCacheMeta, cBytes + 1, DEFAULT_LARGE_ENTRIES);
    await seedBoth(db, "a", sampleResult("a"), 1000, 1000);
    await seedBoth(db, "b", sampleResult("b"), 1000, 2000);
    // a + b + c far exceeds the budget; the oldest-lastAccess rows go first until
    // only "c" remains within budget.
    await cache.set("c", cResult);

    expect(await cache.has("a")).toBe(false);
    expect(await cache.has("b")).toBe(false);
    expect(await cache.has("c")).toBe(true);
  });

  it("swallows a DataCloneError from put as a capacity boundary", async () => {
    // An oversized BattleResult fails the structured clone in the browser with
    // DataCloneError; the durable tier must treat that as a capacity boundary
    // and skip the write rather than surfacing a scary toast on every large
    // battle. Seed an existing row to prove the uncloneable path does NOT evict
    // (unlike a quota failure, the table is not over budget).
    await seedBoth(db, "existing", sampleResult("existing"), 10, 1000);
    let putCalls = 0;
    const table = withPutStub(db.simCache, () => {
      putCalls += 1;
      const error = new Error("structured clone OOM");
      error.name = "DataCloneError";
      return Promise.reject(error);
    });
    const cache = new DexieSimCache(table, db.simCacheMeta);

    // The set must not throw.
    await expect(cache.set("oversized", sampleResult("r1"))).resolves.toBeUndefined();

    // put was attempted exactly once; no retry (quota retry path not taken).
    expect(putCalls).toBe(1);
    // The pre-existing row survives: the uncloneable path must not evict.
    expect(await cache.has("existing")).toBe(true);
    // And the oversized key was never written.
    expect(await cache.has("oversized")).toBe(false);
  });

  it("estimates bytes without serialising: stable, monotonic, positive", () => {
    // The estimator sums typed-array buffer lengths plus per-entity scalars —
    // never a JSON serialisation — so the V8 string-limit RangeError that the
    // old JSON.stringify-based estimate could throw on a huge result is gone
    // (an oversized result now fails at the structured-clone `put` instead,
    // covered by the DataCloneError test above). The eviction contract only
    // needs a stable, monotonic proxy; assert those properties hold.
    const emptyFrame = (): BattleFrame => ({ tick: 0, ships: [], projectiles: [] });
    // Positive even for a 0-frame recorded battle (the result-envelope overhead).
    expect(estimateResultBytes(sampleResult("r0"))).toBeGreaterThan(0);
    // Monotonic in frame count: the per-frame overhead scales the estimate.
    const small = sampleResult("r1", { frames: [emptyFrame(), emptyFrame(), emptyFrame()] });
    const large = sampleResult("r2", { frames: Array.from({ length: 30 }, emptyFrame) });
    const a = estimateResultBytes(small);
    const b = estimateResultBytes(large);
    expect(b).toBeGreaterThan(a);
    // Stable: the same result estimates to the same value every call.
    expect(estimateResultBytes(small)).toBe(a);
  });

  it("still retries with eviction on a QuotaExceededError", async () => {
    // The uncloneable capacity-boundary path must not regress the existing
    // quota handling: a QuotaExceededError triggers evictOldest then a retry.
    await seedBoth(db, "old", sampleResult("old"), 10, 1000);
    let putCalls = 0;
    // Capture the real put before `withPutStub` overrides it on the instance,
    // so this stub can forward to it on retry (defineProperty mutates the table
    // rather than wrapping it, so `db.simCache.put` would otherwise recurse).
    const realPut = db.simCache.put.bind(db.simCache);
    const table = withPutStub(db.simCache, async (record) => {
      putCalls += 1;
      if (putCalls === 1) {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      // Retry after eviction: forward to the real table.
      await realPut(record);
    });
    const cache = new DexieSimCache(table, db.simCacheMeta, DEFAULT_LARGE_BYTES, DEFAULT_LARGE_ENTRIES);

    await cache.set("fresh", sampleResult("fresh"));

    // First put hit quota, second succeeded.
    expect(putCalls).toBe(2);
    // The oldest row was evicted to make room.
    expect(await cache.has("old")).toBe(false);
    expect(await cache.has("fresh")).toBe(true);
  });
});
