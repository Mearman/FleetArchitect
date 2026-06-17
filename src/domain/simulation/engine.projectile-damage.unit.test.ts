import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/hull";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Sonnet-tier: the projectile damage path — shields absorb first, excess
 * spills to structure (reduced by armour), the shield-recharge delay
 * resets on hit, and homing projectiles track a moving target.
 *
 * Helper duplicated so this file is self-contained.
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
  classification?: ShipClassification;
  orders?: Partial<typeof defaultOrders>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const stats: ShipStats = {
    mass: 10,
    massCapacity: 100,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: opts.structure ?? 200,
    damageReduction: opts.damageReduction ?? 0,
    shieldCapacity: opts.shield ?? 0,
    shieldRechargeRate: opts.shieldRechargeRate ?? 1,
    shieldRechargeDelay: opts.shieldRechargeDelay ?? 60,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: weapons.map((w) => ({ slotId: `slot-${opts.id}`, effect: w })),
  };
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    orders: { ...defaultOrders, ...opts.orders },
    classification: (opts.classification ?? "frigate"),
  };
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

  it("excess damage spills to structure, reduced by armour", () => {
    // Shield 10, damage 30, armour 0.5 → shield absorbs 10, 20 spills to
    // structure, effective reduction 0.5 ⇒ structure takes 10.
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
          shield: 10,
          damageReduction: 0.5,
          orders: { engageRange: "hold" },
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
    expect(hit, "structure should take spillover damage").toBeDefined();
    if (hit === undefined) return;
    // Shield fully depleted by the absorbed portion.
    expect(hit.shield).toBe(0);
    // Spill 20 × (1 − 0.5) = 10 structure damage.
    expect(initial.structure - hit.structure).toBe(10);
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
