import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShipsCached, runBattleCached } from "@/domain/cache/run-battle-cached";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { BattleResult } from "@/schema/battle";

/**
 * Full cross-faction matrix: EVERY preset fleet battled against EVERY OTHER
 * preset fleet, in BOTH orientations (attacker vs defender and vice versa).
 * 18 preset fleets × 17 opponents = 306 ordered matchups.
 *
 * The sibling `engine.faction-matrix.integration.test.ts` covers a curated
 * representative sample (one fleet per faction, plus the two formation
 * showcases). This file guards the LONG TAIL the sample cannot reach: every
 * fleet the bundled data ships with, run through the full
 * `resolveFleetToCombatShips` → `runBattle` pipeline against every other. That
 * catches resolve-engine drift (a renamed design, a formation template that
 * stops expanding, a doctrine axis the resolver stops overlaying) on a fleet
 * the curated matrix never picks up — the third Corsair line, the second
 * Foundry column, etc.
 *
 * Assertion is the same minimal contract the curated matrix enforces, narrowed
 * to what every matchup must satisfy regardless of balance: the engine runs to
 * a well-formed outcome without crashing (winner is a valid `BattleSide`), and
 * the frame stream carries the deployment frame plus at least one simulated
 * tick. Balance shifts with every engine change; "who wins" is deliberately
 * not asserted.
 *
 * Performance: tick cap is 150 (enough for most matchups to reach contact and
 * many to resolve, while keeping the 306-battle suite inside the CI window).
 * At the 1 m grid scale preset capitals close range slowly, so within 150
 * ticks some matchups will not yet have reached a decision — they end in a
 * `draw`, which is a valid outcome here. The suite is serial; expect a
 * single-figure-minute wall-clock.
 */

/** Tick cap per battle. Kept short so the 306-battle matrix completes inside
 *  the CI serial-test window (~5 min). Ships deploy within mutual weapon/sight
 *  reach (see `computeEdgeInsetM`), so even 20 ticks exercises resolve, deploy,
 *  the first movement, sensor resolution, and initial fire — enough to catch
 *  a resolve crash, a doctrine error, or a frame-stream breakage. The curated
 *  sibling (engine.faction-matrix.integration.test.ts) covers 36 matchups at
 *  300 ticks for deeper outcome assertions. */
const MAX_TICKS = 20;
/** Shared seed so the matrix is reproducible run-to-run. */
const SEED = 42;

const designs: ReadonlyMap<string, ShipDesign> = new Map(
  presetDesigns.map((d) => [d.id, d]),
);

/** The single shared catalog — `catalog()` returns a memoised singleton, and
 *  the resolver deep-clones each module effect, so sharing it across battles
 *  is safe. */
const cat = catalog();

interface Matchup {
  name: string;
  attacker: Fleet;
  defender: Fleet;
}

/** Every ordered preset-vs-preset pair (attacker ≠ defender). 18 × 17 = 306. */
function buildFullMatrix(): Matchup[] {
  const out: Matchup[] = [];
  for (const attacker of presetFleets) {
    for (const defender of presetFleets) {
      if (attacker.id === defender.id) continue;
      out.push({
        name: `${attacker.name} vs ${defender.name}`,
        attacker,
        defender,
      });
    }
  }
  return out;
}

/** Resolve both fleets to combat ships and run the battle, returning the
 *  result. Each call re-resolves (the resolver produces fresh per-cell modules
 *  with deep-cloned effects, so battles never observe prior state). */
async function resolveAndBattle(
  attackerFleetId: string,
  defenderFleetId: string,
): Promise<BattleResult> {
  const attacker = presetFleets.find((f) => f.id === attackerFleetId);
  const defender = presetFleets.find((f) => f.id === defenderFleetId);
  if (attacker === undefined) {
    throw new Error(`preset fleet not found: ${attackerFleetId}`);
  }
  if (defender === undefined) {
    throw new Error(`preset fleet not found: ${defenderFleetId}`);
  }
  const ships = [
    ...resolveFleetToCombatShipsCached(attacker, designs, cat, "attacker"),
    ...resolveFleetToCombatShipsCached(defender, designs, cat, "defender"),
  ];
  return runBattleCached({
    ships,
    attackerFleetId: attacker.id,
    defenderFleetId: defender.id,
    anomalies: [],
    seed: SEED,
    maxTicks: MAX_TICKS,
  });
}

const matrix = buildFullMatrix();

describe("faction matrix (full): every preset fleet vs every other", () => {
  // Per-test timeout: each matchup resolves in ~2 s isolated, but the suite runs
  // 600 of them through the cache layer back-to-back, and the occasional battle
  // spikes (GC pause, cache pressure) well past the average. 300 s is headroom
  // for a slow CI runner + the spike without masking a real hang.
  for (const m of matrix) {
    it(`${m.name} resolves to a valid outcome`, async () => {
      const result = await resolveAndBattle(m.attacker.id, m.defender.id);

      expect(
        result.winner,
        `${m.name}: winner must be attacker, defender, or draw`,
      ).toBeOneOf(["attacker", "defender", "draw"]);

      expect(
        result.frames.length,
        `${m.name}: battle must produce more than one frame`,
      ).toBeGreaterThan(1);
    }, 300000);
  }
});
