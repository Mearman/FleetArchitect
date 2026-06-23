import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { FleetArchitectDatabase, _setDatabaseForTesting } from "@/storage/db";
import { DexieSimCache } from "@/storage/sim-cache-dexie";
import { sampleResult } from "@/domain/cache/test-fixtures";

/** A budget large enough never to trigger byte eviction in count-cap tests. */
const DEFAULT_LARGE_BYTES = 1024 * 1024 * 1024;
/** An entry cap large enough never to trigger count eviction in byte tests. */
const DEFAULT_LARGE_ENTRIES = 1_000_000;

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

describe("DexieSimCache", () => {
  let db: FleetArchitectDatabase;

  beforeEach(() => {
    db = freshDatabase();
  });

  it("returns undefined on a miss and round-trips a stored result", async () => {
    const cache = new DexieSimCache(db.simCache);
    expect(await cache.get("missing")).toBeUndefined();
    expect(await cache.has("missing")).toBe(false);

    const result = sampleResult("r1", { ticks: 7 });
    await cache.set("k1", result);

    expect(await cache.has("k1")).toBe(true);
    expect(await cache.get("k1")).toEqual(result);
  });

  it("records bytes and lastAccess on set", async () => {
    const cache = new DexieSimCache(db.simCache);
    await cache.set("k1", sampleResult("r1"));

    const record = await db.simCache.get("k1");
    expect(record).toBeDefined();
    expect(record?.bytes).toBeGreaterThan(0);
    expect(record?.lastAccess).toBeGreaterThan(0);
  });

  it("treats a schema-invalid stored record as a miss and evicts it", async () => {
    const cache = new DexieSimCache(db.simCache);
    // Store a record whose `result` violates the schema (ticks must be >= 0),
    // simulating stored-shape drift. Written via the raw table so the broken
    // shape lands in IndexedDB directly.
    await db.simCache.put({
      key: "broken",
      result: sampleResult("ok", { ticks: -1 }),
      bytes: 10,
      lastAccess: Date.now(),
    });

    // The record fails BattleResult.safeParse, so it is a miss and is evicted.
    expect(await cache.get("broken")).toBeUndefined();
    expect(await cache.has("broken")).toBe(false);
  });

  it("bumps lastAccess on a hit for LRU recency", async () => {
    const cache = new DexieSimCache(db.simCache);
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
    const cache = new DexieSimCache(db.simCache, DEFAULT_LARGE_BYTES, 2);
    await db.simCache.put({
      key: "a",
      result: sampleResult("a"),
      bytes: 10,
      lastAccess: 1000,
    });
    await db.simCache.put({
      key: "b",
      result: sampleResult("b"),
      bytes: 10,
      lastAccess: 2000,
    });
    // The third set exceeds the 2-entry cap; the oldest-lastAccess row ("a") goes.
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(false);
    expect(await cache.has("b")).toBe(true);
    expect(await cache.has("c")).toBe(true);
  });

  it("evicts oldest-lastAccess rows past the byte budget", async () => {
    // The freshly-set row "c" measures its own JSON bytes; the two pre-seeded
    // rows carry large explicit byte sizes. Budget = (c's measured size) + 1, so
    // the two large old rows must both be evicted to fit "c" while "c" survives.
    const cResult = sampleResult("c");
    const cBytes = new TextEncoder().encode(JSON.stringify(cResult)).length;
    const cache = new DexieSimCache(db.simCache, cBytes + 1, DEFAULT_LARGE_ENTRIES);
    await db.simCache.put({
      key: "a",
      result: sampleResult("a"),
      bytes: 1000,
      lastAccess: 1000,
    });
    await db.simCache.put({
      key: "b",
      result: sampleResult("b"),
      bytes: 1000,
      lastAccess: 2000,
    });
    // a + b + c far exceeds the budget; the oldest-lastAccess rows go first until
    // only "c" remains within budget.
    await cache.set("c", cResult);

    expect(await cache.has("a")).toBe(false);
    expect(await cache.has("b")).toBe(false);
    expect(await cache.has("c")).toBe(true);
  });
});
