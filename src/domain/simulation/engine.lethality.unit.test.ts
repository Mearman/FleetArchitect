import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { runBattle } from "@/domain/simulation/engine";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs } from "@/domain/simulation/types";
import type { BattleResult } from "@/schema/battle";

/**
 * Lethality regression guards for crewed Terran battles.
 *
 * On main (before the lethality tuning), crewed capital matchups stalemated:
 * Battle Line vs Armoured Spearhead ran the full 3600-tick cap with nine ships
 * alive at start and nine alive at end — zero kills despite thousands of
 * projectile-frames fired, because the crew economy starved every weapon. These
 * tests lock in the tuning (wider power wiring, larger magazines/charge
 * buffers, enough crew quarters, higher per-shot damage, softer shields) so a
 * silent revert to stalemate fails loudly.
 *
 * The assertions are robust against the pre-existing base-engine
 * non-determinism (large preset battles are not byte-identical run-to-run on
 * main, including crewless ones that never touch the crew code — see the
 * engine.crew-perf header comment). They check properties that hold on every
 * run: ships are destroyed, a winner is decided, and meaningful damage is
 * dealt. The stalemate produced zero kills and zero effective damage, so any of
 * these guards catches it.
 */

const cat = catalog();
const designs = new Map(presetDesigns.map((d) => [d.id, d]));
const fleet = (id: string) => presetFleets.find((f) => f.id === id);

function buildInputs(attackerId: string, defenderId: string, seed = 42): BattleInputs {
  const attacker = resolveFleetToCombatShips(fleet(attackerId)!, designs, cat, "attacker");
  const defender = resolveFleetToCombatShips(fleet(defenderId)!, designs, cat, "defender");
  return {
    ships: [...attacker, ...defender],
    attackerFleetId: attackerId,
    defenderFleetId: defenderId,
    anomaly: "none",
    seed,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

/** Count ships alive in a frame. */
function aliveCount(result: BattleResult): { start: number; final: number; dead: number } {
  const startAlive = result.frames[0]!.ships.filter((s) => s.alive).length;
  const finalAlive = result.frames.at(-1)!.ships.filter((s) => s.alive).length;
  return { start: startAlive, final: finalAlive, dead: startAlive - finalAlive };
}

/** Total structure damage dealt across all ships (initial minus final). */
function totalStructureDamage(result: BattleResult): number {
  let total = 0;
  for (const ship of result.frames[0]!.ships) {
    const initial = ship.structure;
    const final = result.frames.at(-1)!.ships.find((s) => s.instanceId === ship.instanceId)?.structure ?? 0;
    total += Math.max(0, initial - final);
  }
  return total;
}

describe("engine.lethality — crewed Terran battles resolve decisively", () => {
  // These run full preset battles (up to 3.6s on dev hardware), so need a
  // timeout well above vitest's 5s default.
  it("Battle Line vs Armoured Spearhead destroys ships (not a stalemate)", () => {
    // The headline stalemate matchup. On the un-tuned engine this ran the full
    // 3600-tick cap with 9->9 alive and ~0 effective damage. The tuning must
    // produce kills: at least one ship destroyed, a winner decided, and enough
    // structure damage that the fight was real (the stalemate dealt less than
    // 100 total). Measured: 7 of 9 ships destroyed, 1500+ structure damage.
    const result = runBattle(buildInputs("preset-fleet-battleline", "preset-fleet-spearhead"));
    const { dead } = aliveCount(result);

    expect(result.winner, "a winner must be decided, not a stalemate").toBeDefined();
    expect(dead, "at least one ship must be destroyed (stalemate had zero kills)").toBeGreaterThan(0);
    expect(
      totalStructureDamage(result),
      "meaningful damage must be dealt (stalemate dealt negligible damage)",
    ).toBeGreaterThan(500);
  }, 15000);

  it("Strike Wing vs Picket Screen resolves with a winner and meaningful kills", () => {
    // A faster crewed matchup that consistently produces a winner with both
    // sides taking meaningful losses. Phase 2's layered-cell migration changed
    // preset layouts (retired armour-equipment tokens became deck corridors),
    // which shifted the battle balance slightly; combined with the engine's
    // pre-existing crew-pathing non-determinism (documented in the crew-perf
    // suite), the exact tick count varies more than before. The test still
    // guards the core invariant: a winner is decided and multiple ships die.
    const result = runBattle(buildInputs("preset-fleet-strike", "preset-fleet-picket"));
    const { dead } = aliveCount(result);

    expect(result.winner, "a winner must be decided").toBeDefined();
    expect(dead, "multiple ships must be destroyed").toBeGreaterThanOrEqual(6);
  }, 15000);

  it("the crewless Swarm baseline still resolves (fast path unbroken)", () => {
    // Crewless battles must not be slowed by the lethality tuning. The Swarm
    // matchup resolved decisively on the un-tuned engine (~839 ticks) and must
    // still resolve with a winner and kills.
    const result = runBattle(buildInputs("preset-fleet-hive-assault", "preset-fleet-drone-swarm"));
    const { dead } = aliveCount(result);

    expect(result.winner, "crewless battle must still resolve").toBeDefined();
    expect(dead, "crewless battle must still produce kills").toBeGreaterThan(0);
  }, 15000);
});
