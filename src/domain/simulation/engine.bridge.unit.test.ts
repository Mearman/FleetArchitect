import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * Bridge / command-module rule: a modular ship needs at least one alive
 * command module to coordinate its weapons. Destroy the bridge and the ship
 * can no longer fire, even with intact weapon modules.
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
    facing: 0,
    ...over,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  x: number,
  y: number,
  maxHp: number,
  command: boolean,
  mass = 5,
  powerDraw = 0,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col: Math.round(x),
    row: Math.round(y),
    x,
    y,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/** An immobile target dummy with huge structure and no weapons. Serves as
 *  the thing the modular attacker shoots at so we can detect firing. */
function dummy(id: string, x: number): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 9_999_999,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "defender",
    stats,
    position: { x, y: 0 },
    facing: Math.PI,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
  };
}

/** A modular attacker with one weapon and one command module. The command
 *  module's hp is `commandHp` so the caller can deploy it destroyed (0). */
function modularAttacker(id: string, commandHp: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("w1", beam({ damage: 10, range: 400, cooldown: 2 }), 12, 0, 50, false),
    moduleOf("c1", { kind: "power", output: 40 }, 0, -12, commandHp, true),
    // A sensor so the ship can actually see the dummy 160 wu away — a warship
    // with a 400-range gun needs sensors to match. Without it the ship would be
    // blind beyond the 140 wu visual radius and never acquire a target.
    moduleOf(
      "se1",
      { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 300, nebulaImmune: false },
      0,
      12,
      20,
      false,
    ),
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
    structure: 9999,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "attacker",
    stats,
    position: { x: -80, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules,
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

describe("engine.bridge-command", () => {
  it("a modular ship with a live command module fires its weapons", () => {
    const result = runBattle(inputs([modularAttacker("a1", 20), dummy("d1", 80)]));
    // The dummy has 9,999,999 structure; the attacker's beam does 10/tick.
    // After 100 ticks the dummy should have taken meaningful damage, proving
    // the weapon fired. (If the bridge rule blocked fire, damage would be 0.)
    const final = result.frames.at(-1)?.ships.find((s) => s.instanceId === "d1");
    expect(final).toBeDefined();
    if (final === undefined) return;
    expect(final.structure).toBeLessThan(9_999_999);
  });

  it("a modular ship with its command module destroyed does not fire", () => {
    const result = runBattle(inputs([modularAttacker("a1", 0), dummy("d1", 80)]));
    const final = result.frames.at(-1)?.ships.find((s) => s.instanceId === "d1");
    expect(final).toBeDefined();
    if (final === undefined) return;
    // No shot ever landed: the dummy is undamaged.
    expect(final.structure).toBe(9_999_999);
    // And the attacker's command module is destroyed at deployment (0 hp).
    const attacker = result.frames[0]?.ships.find((s) => s.instanceId === "a1");
    const bridge = attacker?.cells?.find((m) => m.slotId === "c1");
    expect(bridge?.hp).toBe(0);
  });
});
