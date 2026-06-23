import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { FleetArchitectDatabase, _setDatabaseForTesting } from "@/storage/db";
import { DexieCheckpointStore } from "@/storage/checkpoint-store-dexie";
import { EngineCheckpoint } from "@/schema/checkpoint";
import type { BattleFrame } from "@/schema/battle";

let dbCounter = 0;

/** Spin up a fresh fake-indexeddb-backed database with a unique name. */
function freshDatabase(): FleetArchitectDatabase {
  dbCounter += 1;
  const db = new FleetArchitectDatabase(`test-checkpoint-${dbCounter}`, {
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  _setDatabaseForTesting(db);
  return db;
}

/**
 * A minimal, schema-valid `EngineCheckpoint` with empty entity arrays. The
 * store tests cover get/put/delete and corrupt-record eviction — the checkpoint
 * semantics are irrelevant here, so the fixture need only round-trip through
 * `EngineCheckpoint.parse`.
 */
function minimalCheckpoint(tick: number): EngineCheckpoint {
  return EngineCheckpoint.parse({
    version: 1,
    tick,
    rngState: 12345,
    counters: {
      projectile: 0,
      chunk: 0,
      mine: 0,
      pod: 0,
      phantom: 0,
      pulse: 0,
      emission: 0,
      debris: 0,
    },
    ticks: tick,
    deployment: {},
    ships: [],
    projectiles: [],
    mines: [],
    pods: [],
    pulses: [],
    emissions: [],
    debris: [],
  });
}

/** A minimal `BattleFrame` carrying just the tick (enough for the preFrames
 *  round-trip — the store never inspects frame contents). */
function frame(tick: number): BattleFrame {
  return {
    tick,
    ships: [],
    projectiles: [],
    mines: [],
    pods: [],
    pulses: [],
    emissions: [],
    debris: [],
  };
}

describe("DexieCheckpointStore", () => {
  let db: FleetArchitectDatabase;

  beforeEach(() => {
    db = freshDatabase();
  });

  it("returns undefined on a miss and round-trips a stored checkpoint", async () => {
    const store = new DexieCheckpointStore(db.checkpoints);
    expect(await store.get("missing")).toBeUndefined();

    const checkpoint = minimalCheckpoint(30);
    const preFrames = [frame(0), frame(1), frame(2)];
    await store.put("k1", checkpoint, preFrames);

    const got = await store.get("k1");
    expect(got).toBeDefined();
    expect(got?.checkpoint).toEqual(checkpoint);
    expect(got?.preFrames).toEqual(preFrames);
  });

  it("put overwrites — one latest checkpoint per content key", async () => {
    const store = new DexieCheckpointStore(db.checkpoints);
    const first = minimalCheckpoint(10);
    const second = minimalCheckpoint(20);

    await store.put("k1", first, [frame(0)]);
    await store.put("k1", second, [frame(0), frame(1)]);

    const got = await store.get("k1");
    expect(got?.checkpoint.tick).toBe(20);
    expect(got?.preFrames).toHaveLength(2);
    // Only one row in the table — put overwrote, it did not append.
    expect(await db.checkpoints.count()).toBe(1);
  });

  it("delete removes the checkpoint", async () => {
    const store = new DexieCheckpointStore(db.checkpoints);
    await store.put("k1", minimalCheckpoint(5), []);
    expect(await store.get("k1")).toBeDefined();

    await store.delete("k1");
    expect(await store.get("k1")).toBeUndefined();
  });

  it("treats a schema-invalid stored checkpoint as a miss and evicts it", async () => {
    const store = new DexieCheckpointStore(db.checkpoints);
    // Store a record whose `checkpoint` violates the schema, simulating stored-
    // shape drift (e.g. a version bump made an old checkpoint unreadable).
    // `structuredClone` a valid checkpoint then `Reflect.deleteProperty` removes
    // a required field at the JS level so the stored record fails
    // `EngineCheckpoint.safeParse` — exactly the corruption the safeParse-on-read
    // guard exists to catch.
    const corrupt = structuredClone(minimalCheckpoint(1));
    Reflect.deleteProperty(corrupt, "tick");

    await db.checkpoints.put({
      key: "broken",
      checkpoint: corrupt,
      preFrames: [],
      updatedAt: Date.now(),
    });

    // The record fails EngineCheckpoint.safeParse (missing required `tick`), so
    // it is a miss and the stale row is evicted.
    expect(await store.get("broken")).toBeUndefined();
    expect(await db.checkpoints.get("broken")).toBeUndefined();
  });
});
