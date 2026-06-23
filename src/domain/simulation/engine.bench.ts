import { bench, describe } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import type { BattleInputs } from "@/domain/simulation/types";

/**
 * Per-tick engine cost benchmark. Measures `runBattle` (the pure, deterministic
 * battle) on resolved preset snapshots, so the wall time of a battle — and the
 * effect of any optimisation — is repeatable and regression-guarded.
 *
 * Tick counts are deliberately small and iterations bounded: at the 1 m grid
 * scale the largest preset pair runs at fractions-of-a-second to seconds per
 * tick, so an unbounded bench would hang (the reason a prior attempt stalled).
 * A handful of ticks is enough for a stable per-tick figure; ms/tick is derived
 * as (ms per runBattle) / maxTicks.
 *
 * Run with `pnpm bench` (vitest bench --run). For a phase breakdown, run the
 * same bench under `node --cpu-prof` and read the profile.
 */

const designs = new Map(presetDesigns.map((d) => [d.id, d]));

/** Resolve two preset fleets into a fresh BattleInputs snapshot. */
function snapshotFor(
  attackerFleetId: string,
  defenderFleetId: string,
  seed: number,
  maxTicks: number,
): BattleInputs {
  const attacker = presetFleets.find((f) => f.id === attackerFleetId);
  const defender = presetFleets.find((f) => f.id === defenderFleetId);
  if (attacker === undefined || defender === undefined) {
    throw new Error(`preset fleet not found: ${attackerFleetId} or ${defenderFleetId}`);
  }
  return {
    ships: [
      ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
      ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
    ],
    attackerFleetId,
    defenderFleetId,
    anomaly: "none",
    seed,
    maxTicks,
  };
}

// Resolved once at module scope; each bench iteration clones the ships so the
// run starts from an unmutated snapshot (runBattle must not observe prior state).
const smallest = snapshotFor("preset-fleet-concord", "preset-fleet-foundry", 1, 20);
const largest = snapshotFor("preset-fleet-drone-swarm", "preset-fleet-nexus-armada", 1, 5);

describe("battle engine per-tick cost", () => {
  // 8 ships, 20 ticks. The lightest preset pair — the everyday battle size.
  bench(
    "smallest pair (8 ships, 20 ticks)",
    () => {
      runBattle({ ...smallest, ships: structuredClone(smallest.ships) });
    },
    { iterations: 5, warmupIterations: 0 },
  );

  // 19 ships, 5 ticks. The two heaviest preset fleets — where per-tick cost
  // hurts. Few ticks + few iterations to keep the bench bounded.
  bench(
    "largest pair (19 ships, 5 ticks)",
    () => {
      runBattle({ ...largest, ships: structuredClone(largest.ships) });
    },
    { iterations: 3, warmupIterations: 0 },
  );
});
