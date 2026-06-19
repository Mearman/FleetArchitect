import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import type { WeaponEffect } from "@/schema/module";
import { modularShip, targetDummy } from "./engine.factions-tech-helpers";

/**
 * Sonnet-tier: the projectile damage path — shields absorb first, excess
 * spills to structure (reduced by armour), the shield-recharge delay
 * resets on hit, and homing projectiles track a moving target.
 */

function weapon(over: Partial<WeaponEffect>): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 30,
    range: 400,
    cooldown: 5,
    projectileSpeed: 8,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

function makeShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  shield?: number;
  shieldRechargeRate?: number;
  shieldRechargeDelay?: number;
  damageReduction?: number;
  weapons?: WeaponEffect[];
  orders?: { engageRange?: "short" | "medium" | "long" | "hold" };
}): CombatShip {
  const weapons = opts.weapons ?? [];
  // The attacker is a full modular ship (engine, reaction wheel, weapon
  // modules). The defender is a target dummy: a modular ship whose on-axis
  // cells are transparent to damage, so hits flow through to hull structure
  // — preserving the legacy "structure is the damage sink" semantics these
  // assertions were written for.
  if (weapons.length > 0) {
    return modularShip({
      id: opts.id,
      side: opts.side,
      x: opts.x,
      y: opts.y,
      facing: opts.facing,
      structure: opts.structure,
      shield: opts.shield,
      shieldRechargeRate: opts.shieldRechargeRate,
      shieldRechargeDelay: opts.shieldRechargeDelay,
      damageReduction: opts.damageReduction,
      thrust: 0.5,
      // Physical angular acceleration (rad/tick^2) under the frictionless
      // model; rescaled from the legacy /5 scalar.
      turnRate: 0.02,
      weapons: opts.weapons,
      orders: opts.orders,
    });
  }
  return targetDummy({
    id: opts.id,
    side: opts.side,
    x: opts.x,
    y: opts.y,
    structure: opts.structure,
    shield: opts.shield,
    shieldRechargeRate: opts.shieldRechargeRate,
    shieldRechargeDelay: opts.shieldRechargeDelay,
    damageReduction: opts.damageReduction,
    orders: opts.orders,
  });
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed: 1,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

function shieldAt(result: ReturnType<typeof runBattle>, tick: number, id: string) {
  const f = result.frames.find((frame) => frame.tick === tick);
  if (f === undefined) throw new Error(`no frame at tick ${tick}`);
  const s = f.ships.find((ship) => ship.instanceId === id);
  if (s === undefined) throw new Error(`ship ${id} missing in frame ${tick}`);
  return { shield: s.shield, structure: s.structure };
}

describe("engine.projectile-damage", () => {
  it("shields absorb incoming damage before structure", () => {
    // Defender with 100 shield, no armour, attacker fires a cannon for 30
    // damage at shieldPiercing 0. The full 30 should be absorbed by the
    // shield and the structure should be untouched.
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon({ damage: 30, range: 400, cooldown: 5 })],
        }),
        makeShip({
          id: "d1",
          side: "defender",
          x: 50,
          y: 0,
          structure: 500,
          shield: 100,
          orders: { engageRange: "hold" },
        }),
      ]),
    );
    const initial = shieldAt(result, 0, "d1");
    // Find the first frame where the shield has dropped.
    let hit: { tick: number; shield: number; structure: number } | undefined;
    for (const frame of result.frames) {
      const s = frame.ships.find((x) => x.instanceId === "d1");
      if (s !== undefined && s.shield < initial.shield) {
        hit = { tick: frame.tick, shield: s.shield, structure: s.structure };
        break;
      }
    }
    expect(hit, "shield should be hit by the projectile").toBeDefined();
    if (hit === undefined) return;
    expect(hit.shield).toBe(70);
    // Structure should not have taken any damage: the full 30 was absorbed.
    expect(hit.structure).toBe(initial.structure);
  });

  it("excess damage depletes the armour surface layer before reaching structure", () => {
    // The modular damage model is layered: pooled shield absorbs first; spill
    // then strikes a cell, whose armour surface layer (maxSurfaceHp) depletes
    // before the scaffold, and only overflow past every cell on the
    // penetration path reaches hull structure. This replaced the legacy scalar
    // `damageReduction` (a flat fraction off the structure hit) with a
    // per-cell ablative layer.
    //
    // Fixture: defender shield 10, one on-axis armoured cell carrying 15
    // surface HP and 0 scaffold. Attacker fires 30 damage. Shield absorbs 10,
    // 20 spills; the armour surface absorbs 15 of that, the cell dies (no
    // scaffold), and the remaining 5 reaches structure. Structure takes 5 —
    // exactly the amount beyond the armour layer.
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon({ damage: 30, range: 400, cooldown: 5 })],
        }),
        targetDummy({
          id: "d1",
          side: "defender",
          x: 50,
          y: 0,
          structure: 500,
          shield: 10,
          orders: { engageRange: "hold" },
          absorbingCells: 1,
          absorbingSurfaceHp: 15,
          absorbingScaffoldHp: 0,
        }),
      ]),
    );
    const initial = shieldAt(result, 0, "d1");
    let hit: { tick: number; shield: number; structure: number } | undefined;
    for (const frame of result.frames) {
      const s = frame.ships.find((x) => x.instanceId === "d1");
      if (s !== undefined && s.structure < initial.structure) {
        hit = { tick: frame.tick, shield: s.shield, structure: s.structure };
        break;
      }
    }
    expect(hit, "structure should take damage once the armour layer is breached").toBeDefined();
    if (hit === undefined) return;
    // Shield fully depleted by the absorbed portion.
    expect(hit.shield).toBe(0);
    // Of the 20 spill beyond the shield, the armour surface absorbed 15; only
    // the 5 beyond the armour layer reached structure.
    expect(initial.structure - hit.structure).toBe(5);
  });

  it("a homing projectile tracks and hits a moving target", () => {
    // Attacker holds and fires a tracking missile at a defender that is
    // closing in. Without homing the projectile would fly past the
    // defender's original position; with tracking it follows and hits.
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [
            weapon({ damage: 20, range: 600, cooldown: 5, tracking: 2, projectileSpeed: 3 }),
          ],
          orders: { engageRange: "hold" },
        }),
        makeShip({ id: "d1", side: "defender", x: 0, y: 200, structure: 500 }),
      ]),
    );
    const initial = shieldAt(result, 0, "d1");
    let hit: { tick: number; structure: number; shield: number } | undefined;
    for (const frame of result.frames) {
      const s = frame.ships.find((x) => x.instanceId === "d1");
      if (s !== undefined && s.structure < initial.structure) {
        hit = { tick: frame.tick, structure: s.structure, shield: s.shield };
        break;
      }
    }
    expect(hit, "the homing missile should track and hit the moving defender").toBeDefined();
  });
});
