import { describe, expect, it } from "vitest";

import { hasAliveReactor } from "@/domain/simulation/engine/physics";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { mulberry32 } from "@/domain/simulation/rng";
import type { SimShip } from "@/domain/simulation/engine/types";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ShipStats } from "@/domain/stats";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";

/**
 * The reactor-loss death rule (engine/index.ts, the 4d-reactor block) destroys a
 * modular ship the tick it loses its last alive reactor — the termination
 * guarantee that replaced the no-progress watchdog. A ship with no power cannot
 * fire, shield, or run life support, and the simulation has no other path that
 * kills it, so without this rule a mutual brownout (both sides' reactors
 * destroyed) would stall the battle forever.
 *
 * These tests pin the rule's trigger predicate, `hasAliveReactor`, which the
 * loop calls each tick (the 4d-reactor block kills any modular ship for which it
 * returns false). End-to-end termination of resolving preset battles (which
 * destroy reactors and/or deplete structure) is covered by the lethality suite;
 * this file owns the predicate's correctness, which is the part that could
 * regress silently.
 */

const OPEN_EDGES: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  maxHp = 50,
  mass = 5,
  powerDraw = 0,
  crewRequired = 0,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row: 0,
    x: col * 24,
    y: 0,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw,
    crewRequired,
    effect,
    command: effect.kind === "hull",
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

function beam(): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 20,
    range: 5000,
    cooldown: 4,
    projectileSpeed: 0,
    projectileMass: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
  };
}

function baseStats(): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 1000,
    powerNet: 1000,
    crewRequired: 0,
    crewCapacity: 4,
    crewNet: 4,
    structure: 500,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: [{ slotId: "w0", effect: beam() }],
    compartments: 0,
    airtightCompartments: 0,
  };
}

/** A modular ship: a bridge (hull), a beam weapon, N reactors, and a crew bay. */
function modularShip(
  id: string,
  side: "attacker" | "defender",
  reactorCount = 1,
): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("cmd", { kind: "hull" }, 0),
    moduleOf("w0", beam(), 1, 50, 5, 10),
  ];
  for (let i = 0; i < reactorCount; i++) {
    modules.push(moduleOf(`p${i}`, { kind: "power", output: 1000 }, 2 + i, 50, 5, 0));
  }
  modules.push(moduleOf("q0", { kind: "crew", capacity: 4 }, 2 + reactorCount, 50, 5, 0, 0));
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: baseStats(),
    position: { x: side === "attacker" ? -100 : 100, y: 0 },
    facing: side === "attacker" ? 0 : Math.PI,
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules,
  };
}

/** Build a live SimShip from a combat ship (fresh rng each call). */
function toSim(ship: CombatShip): SimShip {
  return toSimShip(ship, mulberry32(1));
}

/** Mark a power module dead (the hp-driven destruction the damage step performs
 *  before the reactor-loss sweep reads `alive`/`hp`). */
function killReactor(ship: SimShip, slotId: string): void {
  const reactor = ship.modules?.find(
    (m) => m.effect.kind === "power" && m.slotId === slotId,
  );
  if (reactor === undefined) throw new Error(`no reactor ${slotId}`);
  reactor.alive = false;
  reactor.hp = 0;
}

describe("hasAliveReactor — the reactor-loss death trigger", () => {
  it("is true while a modular ship has an alive reactor", () => {
    expect(hasAliveReactor(toSim(modularShip("a1", "attacker")))).toBe(true);
  });

  it("is false once the sole reactor is destroyed (the ship must die)", () => {
    const ship = toSim(modularShip("a1", "attacker"));
    killReactor(ship, "p0");
    expect(hasAliveReactor(ship)).toBe(false);
  });

  it("stays true when one of several reactors survives (redundancy protects)", () => {
    const ship = toSim(modularShip("a1", "attacker", 2));
    killReactor(ship, "p0");
    // p1 is still alive, so the ship retains power and must NOT die.
    expect(hasAliveReactor(ship)).toBe(true);
  });

  it("is true for a non-modular ship (legacy ships have no module power model)", () => {
    const ship = toSim(modularShip("a1", "attacker"));
    const nonModular: SimShip = { ...ship, modules: undefined };
    expect(hasAliveReactor(nonModular)).toBe(true);
  });

  it("uses structural loss, not the manned gate — an unmanned reactor still counts", () => {
    // An alive reactor that is unpowered/unmanned (a recoverable brownout) must
    // not trigger the death rule — only structural reactor loss should.
    const ship = toSim(modularShip("a1", "attacker"));
    const reactor = ship.modules?.find((m) => m.effect.kind === "power");
    if (reactor === undefined) throw new Error("no reactor");
    reactor.manned = false;
    reactor.powered = false;
    expect(hasAliveReactor(ship)).toBe(true);
  });
});
