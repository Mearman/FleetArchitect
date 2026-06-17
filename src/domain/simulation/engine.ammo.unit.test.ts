import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Per-module weapon ammo: a weapon with a finite magazine stops firing once it
 * runs dry. The target, which would otherwise be chewed apart over time,
 * stops taking damage once the shooter's ammo hits zero.
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
  x: number,
  y: number,
  maxHp: number,
  mass = 5,
  powerDraw = 0,
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
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    weaponFacing: 0,
  };
}

/** A modular attacker whose single weapon has a small, finite magazine. */
function modularShooter(id: string, x: number, ammo: number): CombatShip {
  const weapon = beam({ damage: 25, cooldown: 1, ammo });
  const modules: ResolvedModule[] = [
    moduleOf("w1", weapon, 12, 0, 50),
    // The reactor doubles as the command module (as it does in the catalog),
    // so the ship satisfies both the power-grid and bridge firing rules.
    moduleOf("p1", { kind: "power", output: 40 }, 0, -12, 20, 5, 0, true),
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
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    side: "attacker",
    stats,
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules,
  };
}

/** A very tough defender — far more structure than the shooter can ever chew
 *  through, so the only way damage stops accumulating is the magazine running
 *  dry. */
function toughTarget(id: string, x: number): CombatShip {
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
    thrust: 0,
    turnRate: 0,
    weapons: [],
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

/** The defender's current structure in a frame. */
function structureOf(frame: { ships: { instanceId: string; structure: number }[] }, id: string): number | undefined {
  return frame.ships.find((s) => s.instanceId === id)?.structure;
}

describe("engine.weapon-ammo", () => {
  it("a finite-ammo weapon stops firing once its magazine is empty", () => {
    const result = runBattle(inputs([modularShooter("a1", 0, 3), toughTarget("d1", 80)]));
    // Walk the frames and watch the defender's structure. It should drop
    // while the shooter has ammo, then freeze once the magazine is dry.
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    // The target should have taken some damage.
    const minStruct = structures.reduce((a, b) => Math.min(a, b), initial);
    expect(minStruct, "weapon should have dealt damage before running dry").toBeLessThan(initial);
    // After the magazine is empty the structure must stop changing: the
    // last 20 frames should all be equal (no more hits landing).
    const tail = structures.slice(-20);
    const allSame = tail.every((s) => s === tail[0]);
    expect(allSame, "structure should stop decreasing once ammo hits 0").toBe(true);
  });

  it("a weapon without an explicit ammo field does not run dry", () => {
    // Same setup, but no ammo limit. The structure should keep dropping
    // through the whole battle — no flat tail.
    const result = runBattle(inputs([modularShooter("a1", 0, 9999), toughTarget("d1", 80)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    const final = structures.at(-1) ?? initial;
    expect(final, "unlimited weapon should keep dealing damage").toBeLessThan(initial);
    // And the tail must still be trending down — i.e. not flat.
    const tail = structures.slice(-20);
    const tailStart = tail[0] ?? 0;
    const tailEnd = tail.at(-1) ?? tailStart;
    expect(tailEnd, "unlimited weapon should still be firing late in the battle").toBeLessThan(tailStart);
  });

  it("is deterministic for ammo-bounded battles", () => {
    const mk = () => runBattle(inputs([modularShooter("a1", 0, 5), toughTarget("d1", 80)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});
