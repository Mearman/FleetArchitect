import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Per-module power grid: when a ship's reactor can't sustain its weapons'
 * combined power draw, the hungriest weapons are taken offline each tick
 * (see `recomputeAggregates`). An unpowered weapon must not fire — but its
 * cooldown still ticks, so it recovers the moment the grid recovers.
 *
 * We build two otherwise-identical ships — one with an undersized reactor
 * (power deficit) and one with ample power — firing at a tough target, and
 * assert the under-powered ship spawns fewer projectiles across the battle.
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
    range: 500,
    cooldown: 5,
    projectileSpeed: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

/** A projectile-spawning cannon so we can count spawns, not hitscan pings. */
function cannon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "missile",
    damage: 30,
    range: 500,
    cooldown: 5,
    projectileSpeed: 25,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  x: number,
  y: number,
  maxHp: number,
  mass: number,
  powerDraw: number,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    x,
    y,
    maxHp,
    mass,
    powerDraw,
    effect,
    command,
  };
}

/**
 * A modular attacker with two cannon modules and a reactor. `reactorOutput`
 * sets the power supply; `weaponDraw` sets each weapon's draw, so the caller
 * can make the grid balanced (2 * weaponDraw <= reactorOutput) or in deficit.
 */
function modularAttacker(
  id: string,
  reactorOutput: number,
  weaponDraw: number,
): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("w1", cannon({ damage: 25, range: 500 }), 12, 0, 100, 5, weaponDraw),
    moduleOf("w2", cannon({ damage: 25, range: 500 }), -12, 0, 100, 5, weaponDraw),
    moduleOf("p1", { kind: "power", output: reactorOutput }, 0, -12, 100, 5, 0, true),
    moduleOf("e1", { kind: "engine", thrust: 0.4, turnRate: 0.05 }, 0, 12, 100, 5, 0),
  ];
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 99999,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.9,
    turnRate: 0.15,
    weapons: [],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "attacker",
    stats,
    position: { x: 0, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules,
  };
}

/** A very high-structure legacy target that soaks fire for the whole battle. */
function toughTarget(id: string, x: number): CombatShip {
  const weapon = beam();
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 1_000_000,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [{ slotId: "s", effect: weapon }],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "defender",
    stats,
    position: { x, y: 0 },
    facing: Math.PI,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
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

/** Total projectiles observed across all frames. Each projectile spawn adds
 *  one entry to that frame's snapshot, so the sum counts total spawns. */
function totalProjectileSpawns(result: ReturnType<typeof runBattle>): number {
  let sum = 0;
  for (const frame of result.frames) {
    sum += frame.projectiles.length;
  }
  return sum;
}

describe("engine.per-module power grid", () => {
  it("an under-powered ship fires fewer times than an adequately powered one", () => {
    // Each weapon draws 10 power; two weapons = 20 total demand.
    // Deficit ship: reactor supplies 5 — both weapons are unpowered every
    //   tick (5 < 20), so it never fires.
    // Ample ship: reactor supplies 100 — both weapons always powered.
    const deficit = runBattle(inputs([
      modularAttacker("a-deficit", 5, 10),
      toughTarget("d1", 100),
    ]));
    const ample = runBattle(inputs([
      modularAttacker("a-ample", 100, 10),
      toughTarget("d1", 100),
    ]));

    const deficitShots = totalProjectileSpawns(deficit);
    const ampleShots = totalProjectileSpawns(ample);

    // Sanity: the ample ship actually fired — otherwise this test proves
    // nothing.
    expect(ampleShots, "the adequately-powered ship should fire").toBeGreaterThan(0);
    // The deficit ship's demand (20) is more than double its supply (5), so
    // both weapons are unpowered and it must never fire.
    expect(deficitShots, "the under-powered ship must not fire").toBe(0);
    expect(deficitShots).toBeLessThan(ampleShots);
  });

  it("a partially-powered ship fires some but fewer weapons", () => {
    // Two weapons, each drawing 10 (total 20). Reactor supplies 15 — enough
    // for one weapon but not both, so the hungriest (here either, both equal)
    // is taken offline each tick and only one fires per tick.
    const partial = runBattle(inputs([
      modularAttacker("a-partial", 15, 10),
      toughTarget("d1", 100),
    ]));
    const ample = runBattle(inputs([
      modularAttacker("a-ample", 100, 10),
      toughTarget("d1", 100),
    ]));

    const partialShots = totalProjectileSpawns(partial);
    const ampleShots = totalProjectileSpawns(ample);

    expect(partialShots, "partial power should still allow some fire").toBeGreaterThan(0);
    expect(partialShots, "partial power should fire less than full power").toBeLessThan(ampleShots);
  });

  it("ships built without modules are unaffected by the power rule", () => {
    // The legacy aggregated path: the hammer ship has no modules array, so
    // the power-grid firing check never runs. Its weapons fire on cooldown
    // regardless of any power concern.
    const hammerStats = (id: string): CombatShip => {
      const weapon = cannon({ damage: 25, range: 500 });
      const stats: ShipStats = {
        mass: 10,
        cost: 100,
        powerDraw: 0,
        powerOutput: 0,
        powerNet: 0,
        crewRequired: 0,
        crewCapacity: 0,
        crewNet: 0,
        structure: 99999,
        damageReduction: 0,
        shieldCapacity: 0,
        shieldRechargeRate: 0,
        shieldRechargeDelay: 30,
        thrust: 0.5,
        turnRate: 0.1,
        weapons: [{ slotId: "s", effect: weapon }],
      };
      return {
        instanceId: id,
        designId: `d-${id}`,
        side: "attacker",
        stats,
        position: { x: 0, y: 0 },
        facing: 0,
        orders: { ...defaultOrders, engageRange: "hold" },
        classification: "frigate",
      };
    };

    const result = runBattle(inputs([hammerStats("a1"), toughTarget("d1", 100)]));
    const shots = totalProjectileSpawns(result);
    expect(shots, "a legacy non-modular ship fires without power constraints").toBeGreaterThan(0);
  });
});
