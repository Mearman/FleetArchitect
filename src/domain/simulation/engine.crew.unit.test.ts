import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Crew core: physical crew members spawn from crew quarters, walk the walkable
 * interior to man stations, and haul ammo and power between modules. The engine
 * stays a pure deterministic function of (seed + update order) throughout.
 *
 * Cells are laid out so that integer `(col, row)` equals the `(x, y)` passed to
 * `moduleOf` — the crew pathfinder unions over the alive cell set, so a route
 * between two stations only exists when intermediate cells are occupied. Tests
 * build small corridors of hull cells to make routes explicit.
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 500,
    cooldown: 2,
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
  col: number,
  row: number,
  maxHp: number,
  opts: { mass?: number; powerDraw?: number; command?: boolean; crewRequired?: number } = {},
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    maxHp,
    mass: opts.mass ?? 5,
    powerDraw: opts.powerDraw ?? 0,
    crewRequired: opts.crewRequired ?? 0,
    effect,
    command: opts.command ?? false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
  };
}

function statsFor(structure: number): ShipStats {
  return {
    mass: 10,
    massCapacity: 1000,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
  };
}

function shooterShip(
  id: string,
  x: number,
  modules: ResolvedModule[],
  structure = 99999,
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "attacker",
    stats: statsFor(structure),
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules,
  };
}

/** A non-modular, very tough target that never fires back. Placed close so the
 *  shooter's hold-fire weapons are in range. */
function toughTarget(id: string, x: number): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "defender",
    stats: statsFor(1_000_000),
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

function structureOf(
  frame: { ships: { instanceId: string; structure: number }[] },
  id: string,
): number | undefined {
  return frame.ships.find((s) => s.instanceId === id)?.structure;
}

describe("engine.crew — entities and manning", () => {
  it("an unmanned weapon cannot fire until a crew member reaches it", () => {
    // A corridor: quarters at col 0, hull bridge/reactor at col 1, a crewed
    // weapon at col 2. The lone crew member must walk from the quarters to the
    // gun before it can fire. Until then the tough target takes no damage.
    const modules = [
      moduleOf("q1", { kind: "crew", capacity: 1 }, 0, 0, 15),
      moduleOf("p1", { kind: "power", output: 80 }, 1, 0, 20, { command: true }),
      moduleOf(
        "w1",
        beam({ damage: 25, cooldown: 1 }),
        2,
        0,
        50,
        { powerDraw: 10, crewRequired: 1 },
      ),
    ];
    const result = runBattle(inputs([shooterShip("a1", 0, modules), toughTarget("d1", 40)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;

    // The gun is unmanned at the start, so the very first frames deal no
    // damage. The crew member needs at least one walk step to reach col 2 from
    // col 0 (two cells away).
    expect(structures[1], "weapon should not fire before crew arrive").toBe(initial);

    // By the end of the battle the crew member has manned the gun and chewed
    // into the target.
    const final = structures.at(-1) ?? initial;
    expect(final, "weapon should fire once crewed").toBeLessThan(initial);
  });

  it("a crewed weapon on a ship with no crew never fires", () => {
    // No crew quarters at all: the crewed gun can never be manned, so the tough
    // target takes no damage across the whole battle. The crewless reactor still
    // supplies power, isolating manning as the only thing keeping the gun silent.
    const modules = [
      moduleOf("p1", { kind: "power", output: 80 }, 0, 0, 20, { command: true }),
      moduleOf(
        "w1",
        beam({ damage: 25, cooldown: 1 }),
        1,
        0,
        50,
        { powerDraw: 10, crewRequired: 1 },
      ),
    ];
    const result = runBattle(inputs([shooterShip("a1", 0, modules), toughTarget("d1", 40)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    const final = structures.at(-1) ?? initial;
    expect(final, "an unmanned gun must never deal damage").toBe(initial);
  });

  it("a crewless weapon fires immediately (crewRequired 0 is always manned)", () => {
    const modules = [
      moduleOf("p1", { kind: "power", output: 80 }, 0, 0, 20, { command: true }),
      moduleOf("w1", beam({ damage: 25, cooldown: 1 }), 1, 0, 50, { powerDraw: 10 }),
    ];
    const result = runBattle(inputs([shooterShip("a1", 0, modules), toughTarget("d1", 30)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    // No crew quarters, no crew, but the gun needs none: it fires from the off.
    expect(structures[2], "crewless gun should fire early").toBeLessThan(initial);
  });

  it("is byte-identical across two runs with the same seed (incl. crew)", () => {
    const build = (): CombatShip =>
      shooterShip("a1", 0, [
        moduleOf("q1", { kind: "crew", capacity: 2 }, 0, 0, 15),
        moduleOf("p1", { kind: "power", output: 80 }, 1, 0, 20, { command: true }),
        moduleOf("w1", beam({ damage: 25, cooldown: 1 }), 2, 0, 50, { powerDraw: 10, crewRequired: 1 }),
      ]);
    const a = runBattle(inputs([build(), toughTarget("d1", 40)]));
    const b = runBattle(inputs([build(), toughTarget("d1", 40)]));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});
