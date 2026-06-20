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
 */
function frameHash(ships: CombatShip[], attackerId: string, defenderId: string, seed: number): string {
  const r = runBattle({
    ships: structuredClone(ships),
    attackerFleetId: attackerId,
    defenderFleetId: defenderId,
    anomaly: "none",
    seed,
    maxTicks: 500,
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
  });
});
