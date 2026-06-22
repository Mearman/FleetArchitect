/**
 * Determinism gate for the AI rule wiring (Phase 7 consumers): a ship driven by
 * a player-authored rule that changes its movement — a `shieldBelow → retreat`
 * trigger that steers it away from the nearest threat, and a `setStance` override
 * that rescales its engagement range — must still produce byte-identical frames
 * across two same-seed runs.
 *
 * The retreat and stance steering added to `movement.ts`/`targeting.ts` introduce
 * new per-tick branches (nearest-threat selection, stance-scaled desired range,
 * stance-biased target scoring). Each iterates in a FIXED order — enemies sorted
 * by instanceId, the stance read from a total doctrine table — and uses no RNG,
 * clock, or Map/Set iteration order. This test proves that contract holds: the
 * whole frame stream of a rule-driven battle is reproducible bit-for-bit.
 *
 * Self-contained beyond the shared fixture builders, so the gate cannot silently
 * change when an unrelated helper does.
 */
import { describe, expect, it } from "vitest";

import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import type { Rule } from "@/schema/ai";
import type { WeaponEffect } from "@/schema/module";

import { modularShip } from "./engine.factions-tech-helpers";

/** A short-cooldown cannon so the attacker actually chips the retreating ship's
 *  shield down past the rule threshold during the run, firing the retreat branch. */
function cannon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 20,
    range: 600,
    cooldown: 2,
    projectileSpeed: 12,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

/** A two-ship battle: an attacker that closes and fires, and a shielded
 *  defender whose `shieldBelow → retreat` rule fires once its shield is chipped
 *  down, steering it away from the nearest threat. Fixed seed and tick cap. */
function retreatBattle(seed: number, maxTicks: number): BattleInputs {
  const retreatRule: Rule = {
    trigger: { kind: "shieldBelow", fraction: 0.5 },
    action: { kind: "retreat" },
  };
  // A `setStance` rule on the attacker so the stance-override path (range rescale
  // + targeting bias) is exercised too, not only the retreat branch.
  const aggressiveRule: Rule = {
    trigger: { kind: "structureBelow", fraction: 1 },
    action: { kind: "setStance", stance: "aggressive" },
  };
  const attacker: CombatShip = {
    ...modularShip({
      id: "atk",
      side: "attacker",
      x: -300,
      y: 0,
      facing: 0,
      // 8 × TICKS_PER_SECOND² (900): movement.ts divides engine force by 900
      // (ACCEL_PER_TICK_FROM_SI), so this restores the closing acceleration that
      // lets the attacker reach firing range and chip the shield past the rule
      // threshold within the tick budget.
      thrust: 7200,
      turnRate: 0.05,
      weapons: [cannon()],
      orders: { engageRange: "medium" },
    }),
    rules: [aggressiveRule],
  };
  const defender: CombatShip = {
    ...modularShip({
      id: "def",
      side: "defender",
      x: 300,
      y: 0,
      facing: Math.PI,
      shield: 100,
      shieldRechargeRate: 0,
      // 8 × TICKS_PER_SECOND² (900): movement.ts divides engine force by 900
      // (ACCEL_PER_TICK_FROM_SI), so this restores the closing acceleration that
      // lets the attacker reach firing range and chip the shield past the rule
      // threshold within the tick budget.
      thrust: 7200,
      turnRate: 0.05,
      weapons: [cannon()],
      orders: { engageRange: "medium" },
    }),
    rules: [retreatRule],
  };
  return {
    ships: [attacker, defender],
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed,
    maxTicks,
  };
}

describe("engine AI rule wiring determinism", () => {
  it("is byte-identical across two same-seed runs of a retreat-rule battle", () => {
    const DETERMINISM_TICKS = 400;
    const a = runBattle(retreatBattle(7, DETERMINISM_TICKS));
    const b = runBattle(retreatBattle(7, DETERMINISM_TICKS));

    // The gate: every frame byte-identical, plus the run-level summary fields.
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);

    // Sanity: the retreat branch actually fired — the defender's shield was
    // driven below the rule's 0.5-fraction threshold at some point, so the rule
    // triggered and the wired retreat steering ran (rather than the test passing
    // on a battle where the rule never activated and the new code paths were
    // never reached). Frame ships carry only the live shield value, so the
    // threshold is half the defender's starting shield read from the first frame
    // — derived from the fixture, not a hard-coded number.
    const firstDef = a.frames[0]?.ships.find((s) => s.instanceId === "def");
    expect(firstDef).toBeDefined();
    if (firstDef === undefined) throw new Error("defender absent from first frame");
    const halfStartShield = firstDef.shield / 2;
    expect(halfStartShield).toBeGreaterThan(0);
    let sawRetreatCondition = false;
    for (const f of a.frames) {
      const def = f.ships.find((s) => s.instanceId === "def");
      if (def === undefined || !def.alive) continue;
      if (def.shield < halfStartShield) {
        sawRetreatCondition = true;
        break;
      }
    }
    expect(sawRetreatCondition).toBe(true);
  });
});
