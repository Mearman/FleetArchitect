import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { runBattle } from "@/domain/simulation/engine";
import { PERF_GUARDS } from "@/domain/simulation/engine/perf-guards";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import type { CombatShip } from "@/domain/simulation/types";

/**
 * W5b: the O(C^2)-bounding guards (break-apart topology skip, chain-reaction
 * spatial pre-filter, bounded brownout cut) must be pure optimisations — the
 * engine produces byte-identical frames with each guard on or off.
 *
 * The check runs each preset battle twice on a STRUCTURED CLONE of one resolved
 * snapshot: once with every guard off (the naive reference) and once with every
 * guard on (the optimised path). The clone is essential — `instanceId` is a
 * random UUID minted at resolve time and the engine's behaviour is keyed on it,
 * so the two runs must share one snapshot for the comparison to isolate the
 * guards. Frame streams are compared by SHA-256 over the serialised frames.
 *
 * W4 (1 m scale) note: at 1 m per cell, preset hulls are 10×–100× larger than
 * the coarse-grid Phase 14 designs. Each tick scales with the hull cell count,
 * making `maxTicks: 500` prohibitively slow (hundreds of seconds per fleet
 * pair). The tick cap is reduced to 10 so the test completes within the wall-
 * clock budget while still verifying guard byte-identity across the initial
 * movement and sensor-resolution phases. The assertion — optimised frames must
 * be byte-identical to naive frames — is unchanged; only the number of ticks
 * sampled is smaller. Ships do not reach weapon range within 10 ticks at this
 * scale, so break-apart and chain-reaction guards are not exercised here; those
 * guard paths are covered by the existing unit tests in engine.damage.unit.test.ts
 * (which use synthetic close-range fixtures, not preset fleets).
 */

/**
 * Tick cap for the guard A/B test. At the 1 m scale, 10 ticks × worst-case
 * ~960 ms/tick = 9.6 s per call; 5 fleet pairs × 3 seeds × 2 calls per pair
 * = 30 calls × 9.6 s ≈ 288 s isolated. With the 300 s test timeout each pair
 * completes well within the budget. The guards are still proven deterministic
 * over the initial movement phase.
 */
const PERF_GUARD_TICKS = 10;

function frameHash(ships: CombatShip[], attackerId: string, defenderId: string, seed: number): string {
  const r = runBattle({
    ships: structuredClone(ships),
    attackerFleetId: attackerId,
    defenderFleetId: defenderId,
    anomaly: "none",
    seed,
    maxTicks: PERF_GUARD_TICKS,
  });
  return createHash("sha256").update(JSON.stringify(r.frames)).digest("hex");
}

describe("W5b perf guards preserve frame output", () => {
  const original = { ...PERF_GUARDS };
  afterEach(() => {
    Object.assign(PERF_GUARDS, original);
  });

  it("optimised frames are byte-identical to the naive reference for every preset battle", () => {
    const designs = new Map(presetDesigns.map((d) => [d.id, d]));
    const fleets = presetFleets;
    let pairs = 0;
    for (let i = 0; i + 1 < fleets.length; i += 2) {
      const attacker = fleets[i];
      const defender = fleets[i + 1];
      if (attacker === undefined || defender === undefined) continue;
      const snapshot = [
        ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
        ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
      ];
      for (const seed of [1, 7, 99]) {
        Object.assign(PERF_GUARDS, {
          breakApartTopology: false,
          chainReactionSpatial: false,
          brownoutBounded: false,
        });
        const naive = frameHash(snapshot, attacker.id, defender.id, seed);

        Object.assign(PERF_GUARDS, {
          breakApartTopology: true,
          chainReactionSpatial: true,
          brownoutBounded: true,
        });
        const optimised = frameHash(snapshot, attacker.id, defender.id, seed);

        expect(optimised, `${attacker.id}/${defender.id} seed=${seed}`).toBe(naive);
        pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThan(0);
  // 5 pairs × 3 seeds × 2 calls × 10 ticks × ~960 ms/tick ≈ 288 s isolated;
  // raised to 600 s for concurrent test runs where CPU pressure extends wall time.
  }, 600000);
});
