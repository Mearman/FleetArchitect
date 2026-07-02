import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { frameHash } from "@/domain/simulation/test-frame-hash";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { runBattleCached } from "@/domain/cache/run-battle-cached";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import type { BattleInputs } from "@/domain/simulation/types";

/**
 * Guard for the test-only read-through cache wrapper: a fresh `runBattle` and a
 * `runBattleCached` call must produce byte-identical frames. The cache key
 * self-invalidates on engine changes (it incorporates the algorithm signature),
 * so this test never goes stale across a lossless refactor — the only way it
 * fails is if the cache serves a result whose frames differ from a live run,
 * which is exactly the contract to guard.
 *
 * Frames are compared via SHA-256 hash, NOT whole-result equality: a
 * `BattleResult` carries a fresh `id` and `playedAt` per run, so a full equality
 * check would fail even when the simulation output is identical.
 */

/** Build the smallest preset-pair battle inputs (mirrors the determinism suite). */
function smallestPresetInputs(): BattleInputs {
  const designs = new Map(presetDesigns.map((d) => [d.id, d]));
  const attacker = presetFleets.find((f) => f.id === "preset-fleet-concord");
  const defender = presetFleets.find((f) => f.id === "preset-fleet-foundry");
  if (attacker === undefined || defender === undefined) {
    throw new Error("preset fleet not found: preset-fleet-concord or preset-fleet-foundry");
  }
  const ships = [
    ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
    ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
  ];
  return {
    ships,
    attackerFleetId: attacker.id,
    defenderFleetId: defender.id,
    anomalies: [],
    seed: 1,
    maxTicks: 40,
  };
}

describe("runBattleCached", () => {
  it("produces byte-identical frames to a fresh runBattle", async () => {
    const inputs = smallestPresetInputs();

    // Cold path: `frameHash` runs `runBattle` internally and SHA-256 hashes the
    // resulting frame stream.
    const coldHash = frameHash(inputs);

    // Cached path: runBattleCached serves from the disk cache (computing and
    // storing on a miss, returning the stored result on a hit). Hash its frames
    // with the identical method so the comparison is frame-bytes, not metadata.
    const cached = await runBattleCached(inputs);
    const cachedHash = createHash("sha256")
      .update(JSON.stringify(cached.frames))
      .digest("hex");

    expect(cachedHash, "cached frames must be byte-identical to a fresh runBattle").toBe(coldHash);
  });

  it("serves the same frames on a second call (cache hit stability)", async () => {
    const inputs = smallestPresetInputs();

    const first = await runBattleCached(inputs);
    const second = await runBattleCached(inputs);

    const firstHash = createHash("sha256")
      .update(JSON.stringify(first.frames))
      .digest("hex");
    const secondHash = createHash("sha256")
      .update(JSON.stringify(second.frames))
      .digest("hex");

    expect(secondHash, "a second cached call must return identical frames").toBe(firstHash);
  });

  it("does not mutate the caller's ships array on a cache miss", async () => {
    const inputs = smallestPresetInputs();
    const shipsBefore = structuredClone(inputs.ships);

    await runBattleCached(inputs);

    // The engine mutates its inputs in place; runBattleCached clones on a miss
    // so the caller's objects are untouched. Serialise both sides for a deep
    // equality check that catches any in-place mutation.
    expect(JSON.stringify(inputs.ships)).toBe(JSON.stringify(shipsBefore));
  });
});
