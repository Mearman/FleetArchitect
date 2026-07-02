import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import type { Table } from "dexie";
import { FleetArchitectDatabase, _setDatabaseForTesting } from "@/storage/db";
import type { CheckpointDeltaRecord } from "@/storage/db";
import { DexieCheckpointStore } from "@/storage/checkpoint-store-dexie";
import { estimateCheckpointBytes } from "@/storage/sim-cache-dexie";
import { EngineCheckpoint, CHECKPOINT_VERSION } from "@/schema/checkpoint";
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
 * Wrap a Dexie table so every property access forwards to the underlying table
 * except `put`, which is replaced by the supplied stub. Used to simulate the
 * capacity-boundary error a checkpoint delta triggers in the browser
 * (DataCloneError on the structured clone of `deltaFrames`) without having to
 * build such a record. `Object.defineProperty` overrides `put` on the table
 * instance directly, keeping the full `Table` structural type so no assertion
 * is needed at the call site.
 */
function withPutStub(
  table: Table<CheckpointDeltaRecord, [string, number]>,
  put: (record: CheckpointDeltaRecord) => Promise<void>,
): Table<CheckpointDeltaRecord, [string, number]> {
  return Object.defineProperty(table, "put", { value: put, configurable: true });
}

/**
 * A minimal, schema-valid `EngineCheckpoint` with empty entity arrays. The
 * store tests cover get/put/delete and corrupt-record eviction — the checkpoint
 * semantics are irrelevant here, so the fixture need only round-trip through
 * `EngineCheckpoint.parse`.
 */
function minimalCheckpoint(tick: number): EngineCheckpoint {
  return EngineCheckpoint.parse({
    version: CHECKPOINT_VERSION,
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
    ticksSinceLastDeath: 0,
    deployment: {},
    ships: [],
    projectiles: [],
    mines: [],
    pods: [],
    pulses: [],
    emissions: [],
    debris: [],
    beams: [],
  });
}

/** A minimal `BattleFrame` carrying just the tick (enough for the delta
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

/** Frames 0..tick inclusive (the prefix a capture at `tick` passes as preFrames). */
function framesThrough(tick: number): BattleFrame[] {
  const out: BattleFrame[] = [];
  for (let t = 0; t <= tick; t++) out.push(frame(t));
  return out;
}

/** Count the delta rows stored for a matchup (read via the `key` index). */
async function rowCountFor(
  db: FleetArchitectDatabase,
  key: string,
): Promise<number> {
  return db.checkpoints.where("key").equals(key).count();
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

  it("appends one delta per capture and reassembles the full prefix on get", async () => {
    // The core delta behaviour: each capture appends ONLY the new frames, and
    // get concatenates the deltas in seq order. preFrames is a strict
    // prefix-extension across captures (frames 0..checkpoint.tick grow), so the
    // store slices preFrames since the previously stored total.
    const store = new DexieCheckpointStore(db.checkpoints);

    await store.put("k1", minimalCheckpoint(30), framesThrough(30));
    await store.put("k1", minimalCheckpoint(60), framesThrough(60));
    await store.put("k1", minimalCheckpoint(90), framesThrough(90));

    // Three delta rows for the matchup (one per capture), NOT one overwrite.
    expect(await rowCountFor(db, "k1")).toBe(3);

    const got = await store.get("k1");
    expect(got).toBeDefined();
    // The latest capture's checkpoint is the resume point.
    expect(got?.checkpoint.tick).toBe(90);
    // The reassembled prefix is the full 0..90 timeline in tick order.
    expect(got?.preFrames.map((f) => f.tick)).toEqual(
      Array.from({ length: 91 }, (_, t) => t),
    );
  });

  it("only the NEW frames since the previous capture cross the clone boundary", async () => {
    // A spy on the table's structured-clone (via the bytes estimate the store
    // records) proves each delta carries only its slice, not the whole prefix.
    // delta0 = frames 0..30 (31), delta1 = frames 31..60 (30), delta2 = 61..90 (30).
    const store = new DexieCheckpointStore(db.checkpoints);
    await store.put("k1", minimalCheckpoint(30), framesThrough(30));
    await store.put("k1", minimalCheckpoint(60), framesThrough(60));
    await store.put("k1", minimalCheckpoint(90), framesThrough(90));

    const rows = await db.checkpoints.where("key").equals("k1").sortBy("seq");
    expect(rows.map((r) => r.deltaFrames.length)).toEqual([31, 30, 30]);
    expect(rows[0]?.deltaFrames.map((f) => f.tick)).toEqual(
      Array.from({ length: 31 }, (_, t) => t),
    );
    expect(rows[1]?.deltaFrames.map((f) => f.tick)).toEqual(
      Array.from({ length: 30 }, (_, i) => 31 + i),
    );
    expect(rows[2]?.deltaFrames.map((f) => f.tick)).toEqual(
      Array.from({ length: 30 }, (_, i) => 61 + i),
    );
  });

  it("resumes from a partial delta set (interrupted mid-run)", async () => {
    // Simulate an interrupted run: deltas for captures at ticks 30 and 60 were
    // written, but the run was interrupted before tick 90's capture. get must
    // reassemble whatever complete deltas exist and resume from the latest one.
    const store = new DexieCheckpointStore(db.checkpoints);
    await store.put("k1", minimalCheckpoint(30), framesThrough(30));
    await store.put("k1", minimalCheckpoint(60), framesThrough(60));

    const got = await store.get("k1");
    expect(got?.checkpoint.tick).toBe(60);
    expect(got?.preFrames.map((f) => f.tick)).toEqual(
      Array.from({ length: 61 }, (_, t) => t),
    );
  });

  it("resumes from deltas written directly to the table (e.g. by a prior session)", async () => {
    // A fresh store instance (meta not yet built) must reassemble deltas a
    // previous instance wrote. Write two deltas directly, then construct the
    // store and read.
    const updatedAt = Date.now();
    await db.checkpoints.put({
      key: "k1",
      seq: 0,
      checkpoint: minimalCheckpoint(30),
      deltaFrames: framesThrough(30),
      updatedAt,
      bytes: 1000,
    });
    await db.checkpoints.put({
      key: "k1",
      seq: 1,
      checkpoint: minimalCheckpoint(60),
      deltaFrames: framesThrough(60).slice(31),
      updatedAt,
      bytes: 1000,
    });

    const store = new DexieCheckpointStore(db.checkpoints);
    const got = await store.get("k1");
    expect(got?.checkpoint.tick).toBe(60);
    expect(got?.preFrames.map((f) => f.tick)).toEqual(
      Array.from({ length: 61 }, (_, t) => t),
    );
  });

  it("delete removes every delta for the matchup", async () => {
    const store = new DexieCheckpointStore(db.checkpoints);
    await store.put("k1", minimalCheckpoint(30), framesThrough(30));
    await store.put("k1", minimalCheckpoint(60), framesThrough(60));
    expect(await rowCountFor(db, "k1")).toBe(2);
    expect(await store.get("k1")).toBeDefined();

    await store.delete("k1");
    expect(await store.get("k1")).toBeUndefined();
    expect(await rowCountFor(db, "k1")).toBe(0);
  });

  it("treats a schema-invalid latest checkpoint as a miss and evicts all deltas", async () => {
    // Store a delta whose `checkpoint` violates the schema, simulating stored-
    // shape drift (a version bump made an old checkpoint unreadable). The latest
    // delta fails EngineCheckpoint.safeParse, so the whole matchup is a miss and
    // every delta is evicted.
    const corrupt = structuredClone(minimalCheckpoint(1));
    Reflect.deleteProperty(corrupt, "tick");
    await db.checkpoints.put({
      key: "broken",
      seq: 0,
      checkpoint: minimalCheckpoint(0),
      deltaFrames: [frame(0)],
      updatedAt: Date.now(),
      bytes: 0,
    });
    await db.checkpoints.put({
      key: "broken",
      seq: 1,
      checkpoint: corrupt,
      deltaFrames: [frame(1)],
      updatedAt: Date.now(),
      bytes: 0,
    });

    const store = new DexieCheckpointStore(db.checkpoints);
    expect(await store.get("broken")).toBeUndefined();
    expect(await rowCountFor(db, "broken")).toBe(0);
  });

  it("swallows a DataCloneError from put as a capacity boundary and clears the matchup", async () => {
    // A delta too large to clone is a capacity boundary, not a bug — the resume
    // feature is an optimisation, never a correctness path. The put is swallowed
    // (no throw) and every pre-existing delta for the key is cleared so a later
    // resume does not read a partial set.
    const store = new DexieCheckpointStore(db.checkpoints);
    await store.put("k1", minimalCheckpoint(30), framesThrough(30));
    expect(await rowCountFor(db, "k1")).toBe(1);

    const table = withPutStub(db.checkpoints, () => {
      const error = new Error("structured clone OOM");
      error.name = "DataCloneError";
      return Promise.reject(error);
    });
    const storeWithFailingPut = new DexieCheckpointStore(table);

    await expect(
      storeWithFailingPut.put("k1", minimalCheckpoint(60), framesThrough(60)),
    ).resolves.toBeUndefined();

    expect(await rowCountFor(db, "k1")).toBe(0);
  });

  it("swallows a Dexie-WRAPPED DataCloneError (the real runtime shape) too", async () => {
    // Dexie wraps the IDB DataCloneError as a DexieError whose `.name` is the
    // wrapper's, not "DataCloneError" — so the raw-name stub above does not
    // match the real failure. The signature survives in the message, which
    // isUncloneable must detect.
    const store = new DexieCheckpointStore(db.checkpoints);
    await store.put("k1", minimalCheckpoint(30), framesThrough(30));
    expect(await rowCountFor(db, "k1")).toBe(1);

    const table = withPutStub(db.checkpoints, () => {
      const error = new Error(
        "Failed to execute 'put' on 'IDBObjectStore': Data cannot be cloned, out of memory. DataCloneError: Failed to execute 'put' on 'IDBObjectStore': Data cannot be cloned, out of memory.",
      );
      error.name = "DexieError";
      return Promise.reject(error);
    });
    const storeWithFailingPut = new DexieCheckpointStore(table);

    await expect(
      storeWithFailingPut.put("k1", minimalCheckpoint(60), framesThrough(60)),
    ).resolves.toBeUndefined();
    expect(await rowCountFor(db, "k1")).toBe(0);
  });

  it("rethrows a non-capacity error from put unchanged", async () => {
    // A genuine Dexie error (not a capacity boundary) must propagate to the
    // resume decorator's notifier rather than being swallowed.
    const table = withPutStub(db.checkpoints, () => {
      const error = new Error("a real IDB failure");
      error.name = "UnknownError";
      return Promise.reject(error);
    });
    const storeWithFailingPut = new DexieCheckpointStore(table);

    await expect(
      storeWithFailingPut.put("k1", minimalCheckpoint(30), framesThrough(30)),
    ).rejects.toThrow("a real IDB failure");
  });

  it("evicts the oldest MATCHUP past the entry-count cap (all its deltas)", async () => {
    // The cap counts matchups (content keys), not delta rows: a single long
    // battle accumulates many deltas for one key without counting against the
    // cap. A store with a 2-matchup cap drops the oldest key's deltas (LRU by
    // updatedAt) when a third matchup arrives.
    const store = new DexieCheckpointStore(db.checkpoints, Number.MAX_SAFE_INTEGER, 2);
    await store.put("k1", minimalCheckpoint(30), framesThrough(30));
    await store.put("k1", minimalCheckpoint(60), framesThrough(60));
    await store.put("k2", minimalCheckpoint(30), framesThrough(30));
    // k1 has two deltas but counts as ONE matchup; k2 is the second.
    expect(await rowCountFor(db, "k1")).toBe(2);

    await store.put("k3", minimalCheckpoint(30), framesThrough(30));

    expect(await store.get("k1"), "oldest matchup evicted").toBeUndefined();
    expect(await store.get("k2"), "recent matchups retained").toBeDefined();
    expect(await store.get("k3"), "recent matchups retained").toBeDefined();
    // k1's two deltas were both removed; only the two retained matchups remain.
    expect(await db.checkpoints.count(), "only the cap remains").toBe(2);
  });

  it("evicts the oldest matchup past the byte budget (all its deltas)", async () => {
    // The byte budget sums every delta's bytes per matchup. Calibrate the budget
    // to one entry's estimated size + 1: one entry fits, two do not, so the
    // oldest matchup is evicted when the second arrives.
    const cp = minimalCheckpoint(30);
    const oneEntry = estimateCheckpointBytes(cp, framesThrough(30));
    const store = new DexieCheckpointStore(
      db.checkpoints,
      oneEntry + 1,
      Number.MAX_SAFE_INTEGER,
    );
    await store.put("k1", cp, framesThrough(30));
    await store.put("k2", cp, framesThrough(30));

    expect(await store.get("k1"), "oldest matchup evicted on byte budget").toBeUndefined();
    expect(await store.get("k2"), "newest matchup retained").toBeDefined();
    expect(await db.checkpoints.count()).toBe(1);
  });
});
