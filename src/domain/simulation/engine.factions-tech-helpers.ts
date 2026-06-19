/**
 * Shared helpers for the split factions-tech engine tests.
 *
 * Extracted verbatim from the original engine.factions-tech.unit.test.ts so
 * every describe block keeps its assertions, fixtures, and setup identical.
 */

import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { runBattle } from "@/domain/simulation/engine";

/** All-open deck edges for test fixtures. */
const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

export function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 400,
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

export function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp = 50,
  mass = 5,
  powerDraw = 0,
): ResolvedModule {
  // For engine modules, carry the effect's `facing` onto the ResolvedModule so
  // `toSimModule` copies it to `SimModule.facing`, which `cellThrustForceAndTorque`
  // reads to compute the force direction. Default 0 (exhaust forward = thrust
  // backward) unless the effect overrides it. Rear engines use `facing: Math.PI`.
  const engineFacing = effect.kind === "engine" ? (effect.facing ?? 0) : 0;
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * 24,
    y: row * 24,
    surface: "deck",
    edges: OPEN_EDGES,
    maxSurfaceHp: 0,
    maxScaffoldHp: maxHp,
    mass,
    powerDraw,
    crewRequired: 0,
    effect,
    command: false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: engineFacing,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/**
 * A command module (bridge) — required by the per-module firing path. Without
 * this, `hasAliveCommand` returns false and the modular ship cannot fire at all.
 */
export function commandModule(col: number, row: number): ResolvedModule {
  return {
    ...moduleOf("cmd", { kind: "hull" }, col, row, 50, 5, 0),
    command: true,
  };
}

export function baseStats(over: Partial<ShipStats> = {}): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 500,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.8,
    turnRate: 0.15,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
    ...over,
  };
}

export function inputs(
  ships: CombatShip[],
  maxTicks = 200,
  seed = 1,
): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed,
    maxTicks,
  };
}

/** Find a ship's state in a frame at a given tick. */
export function shipAt(
  result: ReturnType<typeof runBattle>,
  tick: number,
  id: string,
) {
  const frame = result.frames.find((f) => f.tick === tick);
  if (frame === undefined) throw new Error(`no frame at tick ${tick}`);
  const ship = frame.ships.find((s) => s.instanceId === id);
  if (ship === undefined) throw new Error(`ship ${id} missing from tick ${tick}`);
  return ship;
}
