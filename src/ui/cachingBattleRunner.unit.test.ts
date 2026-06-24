import { describe, expect, it, vi } from "vitest";
import { engineAlgorithmSignature } from "@/domain/cache/algorithm-signature";
import { MemorySimCache } from "@/domain/cache/memory-cache";
import { deriveCacheKey } from "@/domain/cache/key";
import { getSimConfig } from "@/domain/cache/sim-config";
import type { SimCache } from "@/domain/cache/contract";
import type {
  BattleRunOptions,
  BattleRunner,
} from "@/domain/simulation/runner";
import type { BattleInputs } from "@/domain/simulation/types";
import type { BattleResult, ShipDescriptor } from "@/schema/battle";
import { CachingBattleRunner } from "@/ui/cachingBattleRunner";

/**
 * Empty `ships` keeps the test focused on the cache decorator, not the engine:
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

/** A recorded result, including the (empty) descriptor set a real run emits. */
function result(id: string): BattleResult {
  return {
    id,
    config: {
      attackerFleetId: "fleet-a",
      defenderFleetId: "fleet-b",
      anomalies: [],
      seed: 42,
    },
    winner: "attacker",
    ticks: 7,
    playedAt: "2026-01-01T00:00:00.000Z",
    frames: [],
    descriptors: [],
  };
}

/** A `BattleRunner` stub recording its calls and returning a fixed result. */
function stubInner(value: BattleResult): {
  runner: BattleRunner;
  calls: { inputs: BattleInputs; options?: BattleRunOptions }[];
} {
  const calls: { inputs: BattleInputs; options?: BattleRunOptions }[] = [];
  const runner: BattleRunner = {
    run(runInputs, options) {
      calls.push({ inputs: runInputs, options });
      return Promise.resolve(value);
    },
  };
  return { runner, calls };
}

async function key(): Promise<string> {
  return deriveCacheKey(inputs, getSimConfig(), await engineAlgorithmSignature());
}

const notify = vi.fn<(error: Error) => void>();

describe("CachingBattleRunner", () => {
  it("replays a cache hit through onFrames and never touches the inner runner", async () => {
    const cached = result("cached");
    const cache = new MemorySimCache();
    await cache.set(await key(), cached);

    const { runner: inner, calls } = stubInner(result("fresh"));
    const caching = new CachingBattleRunner(inner, cache, notify);

    const seen: {
      frames: readonly unknown[];
      ticks: number;
      descriptors: readonly ShipDescriptor[];
    }[] = [];
    const out = await caching.run(inputs, {
      onFrames: (frames, ticks, descriptors) =>
        seen.push({ frames, ticks, descriptors }),
    });

    expect(out).toBe(cached);
    expect(calls).toHaveLength(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.ticks).toBe(cached.ticks);
    expect(seen[0]?.descriptors).toBe(cached.descriptors);
  });

  it("on a miss runs the inner runner and stores its result", async () => {
    const fresh = result("fresh");
    const cache = new MemorySimCache();
    const { runner: inner, calls } = stubInner(fresh);
    const caching = new CachingBattleRunner(inner, cache, notify);

    const out = await caching.run(inputs);

    expect(out).toBe(fresh);
    expect(calls).toHaveLength(1);
    // The freshly computed result is now cached under the derived key.
    expect(await cache.get(await key())).toBe(fresh);
  });

  it("noCache bypasses the cache: delegates and stores nothing", async () => {
    const fresh = result("fresh");
    const cache = new MemorySimCache();
    const { runner: inner, calls } = stubInner(fresh);
    const caching = new CachingBattleRunner(inner, cache, notify);

    const out = await caching.run(inputs, { noCache: true });

    expect(out).toBe(fresh);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.noCache).toBe(true);
    expect(await cache.has(await key())).toBe(false);
  });

  it("surfaces a set failure via the notifier without failing the run", async () => {
    const fresh = result("fresh");
    const failing: SimCache = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error("quota exhausted")),
      has: () => Promise.resolve(false),
    };
    const { runner: inner } = stubInner(fresh);
    const onFail = vi.fn<(error: Error) => void>();
    const caching = new CachingBattleRunner(inner, failing, onFail);

    const out = await caching.run(inputs);

    expect(out).toBe(fresh);
    expect(onFail).toHaveBeenCalledOnce();
    expect(onFail.mock.calls[0]?.[0].message).toBe("quota exhausted");
  });
});
