import { describe, expect, it, vi } from "vitest";
import { engineAlgorithmSignature } from "@/domain/cache/algorithm-signature";
import { deriveCacheKey } from "@/domain/cache/key";
import { getSimConfig } from "@/domain/cache/sim-config";
import type { CheckpointStore } from "@/domain/cache/checkpoint-store";
import type {
  BattleRunOptions,
  BattleRunner,
} from "@/domain/simulation/runner";
import type { BattleInputs } from "@/domain/simulation/types";
import type {
  BattleFrame,
  BattleResult,
  ShipDescriptor,
} from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import { ResumingBattleRunner } from "@/ui/resumingBattleRunner";

/**
 * Empty `ships` keeps the test focused on the resume decorator, not the engine:
 * `deriveCacheKey` canonicalises and hashes the inputs regardless of how many
 * ships they carry, and the inner runner is a stub that never simulates.
 */
const inputs: BattleInputs = {
  ships: [],
  attackerFleetId: "fleet-a",
  defenderFleetId: "fleet-b",
  anomalies: [],
  seed: 42,
};

/** A frame at a tick (minimal valid shape — the decorator never inspects it). */
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

/** A checkpoint carrying just the tick (the decorator keys stitching off it). */
function checkpoint(tick: number): EngineCheckpoint {
  return {
    version: 1,
    tick,
    rngState: 0,
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
  };
}

/** A `BattleResult` with the given frames (id/ticks derived for assertion). */
function resultWithFrames(frames: BattleFrame[], ticks: number): BattleResult {
  return {
    id: "battle-fresh",
    config: {
      attackerFleetId: "fleet-a",
      defenderFleetId: "fleet-b",
      anomalies: [],
      seed: 42,
    },
    winner: "attacker",
    ticks,
    playedAt: "2026-01-01T00:00:00.000Z",
    frames,
    descriptors: [],
  };
}

/**
 * A fake `BattleRunner` that records the options it was called with and
 * optionally invokes the `onCheckpoint` / `onFrames` callbacks the decorator
 * passed, so the test can simulate the inner runner's behaviour during compute.
 * Returns a fixed `innerResult`.
 */
function fakeInner(
  innerResult: BattleResult,
  behaviours: {
    fireCheckpoints?: EngineCheckpoint[];
    fireFrames?: {
      frames: BattleFrame[];
      ticks: number;
      descriptors: ShipDescriptor[];
    };
  } = {},
): {
  runner: BattleRunner;
  calls: { inputs: BattleInputs; options?: BattleRunOptions }[];
} {
  const calls: { inputs: BattleInputs; options?: BattleRunOptions }[] = [];
  const runner: BattleRunner = {
    run(runInputs, options) {
      calls.push({ inputs: runInputs, options });
      // Simulate the inner runner streaming its frames and emitting checkpoints
      // during compute, BEFORE resolving — mirroring how the real worker posts
      // frames batches (carrying checkpoints) before the final result.
      if (behaviours.fireFrames !== undefined && options?.onFrames !== undefined) {
        options.onFrames(
          behaviours.fireFrames.frames,
          behaviours.fireFrames.ticks,
          behaviours.fireFrames.descriptors,
        );
      }
      if (behaviours.fireCheckpoints !== undefined && options?.onCheckpoint !== undefined) {
        for (const cp of behaviours.fireCheckpoints) options.onCheckpoint(cp);
      }
      return Promise.resolve(innerResult);
    },
  };
  return { runner, calls };
}

/** An in-memory `CheckpointStore` for unit tests (no IndexedDB). Also records
 *  every `put` and `delete` call (synchronously, inside the method) so a test
 *  can observe what was persisted even when the decorator later deletes the
 *  entry — the persist and the completion-delete are both fire-and-forget. */
function memoryStore(): CheckpointStore & {
  records: Map<string, { checkpoint: EngineCheckpoint; preFrames: BattleFrame[] }>;
  putCalls: { key: string; checkpoint: EngineCheckpoint; preFrames: BattleFrame[] }[];
  deleteCalls: string[];
} {
  const records = new Map<
    string,
    { checkpoint: EngineCheckpoint; preFrames: BattleFrame[] }
  >();
  const putCalls: { key: string; checkpoint: EngineCheckpoint; preFrames: BattleFrame[] }[] = [];
  const deleteCalls: string[] = [];
  return {
    records,
    putCalls,
    deleteCalls,
    async get(key) {
      return records.get(key);
    },
    async put(key, checkpoint, preFrames) {
      putCalls.push({ key, checkpoint, preFrames });
      records.set(key, { checkpoint, preFrames });
    },
    async delete(key) {
      deleteCalls.push(key);
      records.delete(key);
    },
  };
}

/** A `CheckpointStore` whose `put` and `delete` reject but whose `get` is a
 *  miss, so the run proceeds fresh and reaches the persist path. Used to
 *  exercise failure surfacing without the `get` itself throwing. */
function persistFailingStore(failure: Error): CheckpointStore {
  return {
    get: () => Promise.resolve(undefined),
    put: () => Promise.reject(failure),
    delete: () => Promise.reject(failure),
  };
}

async function key(): Promise<string> {
  return deriveCacheKey(inputs, getSimConfig(), await engineAlgorithmSignature());
}

describe("ResumingBattleRunner", () => {
  it("with no checkpoint runs the inner runner fresh and deletes nothing", async () => {
    const store = memoryStore();
    const full = resultWithFrames([frame(0), frame(1), frame(2)], 2);
    const { runner: inner, calls } = fakeInner(full);
    const resuming = new ResumingBattleRunner(inner, store, vi.fn());

    const out = await resuming.run(inputs);

    expect(out).toEqual(full);
    expect(calls).toHaveLength(1);
    // Fresh: no resumeFrom passed to the inner runner.
    expect(calls[0]?.options?.resumeFrom).toBeUndefined();
    // Nothing was stored, so nothing to delete; the store stayed empty.
    expect(store.records.size).toBe(0);
  });

  it("with a checkpoint resumes the inner runner and stitches the preceding frames", async () => {
    const store = memoryStore();
    // Seed the store with a checkpoint at tick 1 and its two preceding frames.
    const cp = checkpoint(1);
    const preFrames = [frame(0), frame(1)];
    const k = await key();
    await store.put(k, cp, preFrames);

    // The inner (resumed) runner returns ONLY frames after the checkpoint.
    const tail = [frame(2), frame(3)];
    const innerResult = resultWithFrames(tail, 3);
    const { runner: inner, calls } = fakeInner(innerResult);
    const resuming = new ResumingBattleRunner(inner, store, vi.fn());

    const out = await resuming.run(inputs);

    // The inner runner was called with resumeFrom = the stored checkpoint.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.resumeFrom).toEqual(cp);
    // The full result stitches preFrames ++ tail.
    expect(out.frames).toEqual([...preFrames, ...tail]);
    expect(out.frames.map((f) => f.tick)).toEqual([0, 1, 2, 3]);
    // Completion deletes the checkpoint (subsumed by the complete result).
    expect(await store.get(k)).toBeUndefined();
  });

  it("during a fresh run persists each captured checkpoint with its preceding frames", async () => {
    const store = memoryStore();
    const frames = [frame(0), frame(1), frame(2), frame(3)];
    const full = resultWithFrames(frames, 3);
    // The inner runner streams all frames, then emits two checkpoints.
    const { runner: inner } = fakeInner(full, {
      fireFrames: { frames, ticks: 3, descriptors: [] },
      fireCheckpoints: [checkpoint(1), checkpoint(3)],
    });
    const resuming = new ResumingBattleRunner(inner, store, vi.fn());

    await resuming.run(inputs);

    const k = await key();
    // The persist is fire-and-forget and the completion-delete fires after, so
    // observe the recorded `put` calls rather than the store's final state.
    expect(store.putCalls.length).toBeGreaterThanOrEqual(2);
    // The latest put for this key carries the highest-tick checkpoint.
    const lastPut = store.putCalls[store.putCalls.length - 1];
    expect(lastPut?.key).toBe(k);
    expect(lastPut?.checkpoint.tick).toBe(3);
    // preFrames are the frames with tick <= checkpoint.tick.
    expect(lastPut?.preFrames.map((f) => f.tick)).toEqual([0, 1, 2, 3]);
    // The completion-delete fired (the complete result subsumes the checkpoint).
    expect(store.deleteCalls).toContain(k);
  });

  it("a persist failure surfaces via the notifier but does not block the result", async () => {
    const store = persistFailingStore(new Error("persist failed"));
    const full = resultWithFrames([frame(0)], 0);
    // Emit a checkpoint so the decorator attempts a persist (which rejects).
    const { runner: inner } = fakeInner(full, {
      fireCheckpoints: [checkpoint(0)],
    });
    const onFail = vi.fn<(error: Error) => void>();
    const resuming = new ResumingBattleRunner(inner, store, onFail);

    const out = await resuming.run(inputs);

    // The result is returned despite the persist failure.
    expect(out).toEqual(full);
    // The failure surfaced via the notifier. Allow the fire-and-forget catch to
    // drain by awaiting a microtask.
    await Promise.resolve();
    expect(onFail).toHaveBeenCalled();
    expect(onFail.mock.calls[0]?.[0].message).toBe("persist failed");
  });

  it("a delete failure surfaces via the notifier but does not block the result", async () => {
    // A store whose get returns a checkpoint (triggering the resume path) but
    // whose delete rejects: the stitch succeeds, the result returns, and the
    // delete failure surfaces.
    const cp = checkpoint(1);
    const preFrames = [frame(0), frame(1)];
    const k = await key();
    const base = memoryStore();
    await base.put(k, cp, preFrames);
    const store: CheckpointStore = {
      get: base.get.bind(base),
      put: base.put.bind(base),
      delete: () => Promise.reject(new Error("delete failed")),
    };
    const innerResult = resultWithFrames([frame(2)], 2);
    const { runner: inner } = fakeInner(innerResult);
    const onFail = vi.fn<(error: Error) => void>();
    const resuming = new ResumingBattleRunner(inner, store, onFail);

    const out = await resuming.run(inputs);
    // Await the fire-and-forget delete catch.
    await Promise.resolve();

    expect(out.frames.map((f) => f.tick)).toEqual([0, 1, 2]);
    expect(onFail).toHaveBeenCalled();
    expect(onFail.mock.calls[0]?.[0].message).toBe("delete failed");
  });

  it("forwards the caller's onFrames callback alongside its own accumulation", async () => {
    const store = memoryStore();
    const frames = [frame(0), frame(1)];
    const full = resultWithFrames(frames, 1);
    // The inner runner streams its frames so the decorator's onFrames wrapper
    // fires, which both accumulates and forwards to the caller's callback.
    const { runner: inner } = fakeInner(full, {
      fireFrames: { frames, ticks: 1, descriptors: [] },
    });
    const resuming = new ResumingBattleRunner(inner, store, vi.fn());

    const seen: {
      frames: readonly BattleFrame[];
      ticks: number;
      descriptors: readonly ShipDescriptor[];
    }[] = [];
    await resuming.run(inputs, {
      onFrames: (f, t, d) => seen.push({ frames: f, ticks: t, descriptors: d }),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.ticks).toBe(1);
  });

  it("skips the checkpoint persist once preFrames exceeds the clone-safe cap", async () => {
    // Stream more frames than MAX_CHECKPOINT_FRAMES, then emit a checkpoint whose
    // preFrames (every frame up to its tick) exceed the cap. The persist is
    // skipped so the IDB structured clone of preFrames never OOMs — Dexie logs
    // the failed put to the console even when the app catches it, so the only way
    // to keep the console clean for a long battle is to not attempt the put.
    const frames: BattleFrame[] = [];
    for (let tick = 0; tick < 300; tick++) frames.push(frame(tick));
    const full = resultWithFrames(frames, 299);
    const { runner: inner } = fakeInner(full, {
      fireFrames: { frames, ticks: 299, descriptors: [] },
      fireCheckpoints: [checkpoint(299)],
    });
    const store = memoryStore();
    const resuming = new ResumingBattleRunner(inner, store, vi.fn());

    await resuming.run(inputs);

    // preFrames (300) > the cap (256): the put was skipped, so nothing persisted.
    expect(store.putCalls).toHaveLength(0);
  });
});
