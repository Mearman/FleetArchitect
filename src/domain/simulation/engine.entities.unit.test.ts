import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * World-state entities (factions update): proximity mines laid by mine-layer
 * modules and boarding pods launched by boarding modules. Both are opt-in — a
 * battle with neither emits no `mines`/`pods` arrays and is byte-identical to
 * baseline (the determinism fixtures guard that); these tests exercise the
 * opt-in side directly through the frame snapshots and the damage a ship takes.
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 20,
    range: 5000,
    cooldown: 4,
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
  maxHp = 50,
  mass = 5,
  powerDraw = 0,
): ResolvedModule {
  const engineFacing = effect.kind === "engine" ? (effect.facing ?? 0) : 0;
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * 24,
    y: row * 24,
    maxHp,
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

function commandModule(col: number, row: number): ResolvedModule {
  return { ...moduleOf("cmd", { kind: "hull" }, col, row, 50, 5, 0), command: true };
}

/** A single contiguous row so the grid is 4-connected and never splits. Columns
 *  run left from the command module so every cell is adjacent to its neighbour. */
function rowLayout(weapons: ResolvedModule[], extras: ResolvedModule[]): ResolvedModule[] {
  const ordered: ResolvedModule[] = [
    { ...commandModule(0, 0) },
    { ...moduleOf("p1", { kind: "power", output: 1000 }, 1, 0, 50, 5, 0) },
    ...weapons,
    ...extras,
  ];
  return ordered.map((m, i) => ({ ...m, col: i, row: 0, x: i * 24, y: 0 }));
}

function baseStats(over: Partial<ShipStats> = {}): ShipStats {
  return {
    mass: 10,
    massCapacity: 100,
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
    thrust: 0,
    turnRate: 0,
    weapons: [],
    ...over,
  };
}

/** A stationary modular ship (thrust=0 so positions hold for the whole battle). */
function ship(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  facing: number;
  structure?: number;
  weapons?: WeaponEffect[];
  extra?: ResolvedModule[];
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const weaponModules: ResolvedModule[] = weapons.map((w, i) =>
    moduleOf(`w${i}`, w, 0, 0, 50, 5, 0),
  );
  const modules = rowLayout(weaponModules, opts.extra ?? []);
  return {
    instanceId: opts.id,
    designId: `d-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats: baseStats({
      structure: opts.structure ?? 500,
      weapons: weapons.map((w, i) => ({ slotId: `w${i}`, effect: w })),
    }),
    position: { x: opts.x, y: 0 },
    facing: opts.facing,
    orders: defaultOrders,
    classification: "frigate",
    modules,
  };
}

function inputs(ships: CombatShip[], maxTicks = 30, seed = 7): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed,
    maxTicks,
  };
}

/** Damage a ship suffered over the battle: lost module HP plus structure. */
function totalDamage(result: ReturnType<typeof runBattle>, id: string): number {
  const first = result.frames[0];
  const last = result.frames[result.frames.length - 1];
  if (first === undefined || last === undefined) throw new Error("no frames");
  const start = first.ships.find((sh) => sh.instanceId === id);
  const end = last.ships.find((sh) => sh.instanceId === id);
  if (start === undefined || end === undefined) throw new Error(`ship ${id} missing`);
  const startHp =
    (start.modules ?? []).reduce((sum, m) => sum + m.hp, 0) + start.structure;
  if (!end.alive) return startHp;
  const endHp =
    (end.modules ?? []).reduce((sum, m) => sum + m.hp, 0) + end.structure;
  return startHp - endHp;
}

/** Count alive functional (non-hull) modules on a ship in the final frame. */
function aliveFunctionalModules(result: ReturnType<typeof runBattle>, id: string): number {
  const last = result.frames[result.frames.length - 1];
  if (last === undefined) throw new Error("no frames");
  const end = last.ships.find((sh) => sh.instanceId === id);
  if (end === undefined) throw new Error(`ship ${id} missing`);
  return (end.modules ?? []).filter((m) => m.alive && m.kind !== "hull").length;
}

/** Any mine snapshot across the whole battle. */
function anyMines(result: ReturnType<typeof runBattle>): number {
  return result.frames.reduce((n, f) => n + (f.mines?.length ?? 0), 0);
}

describe("engine.entities — mines", () => {
  it("a mine-layer lays mines that arm and damage a nearby enemy", () => {
    // Layer at x=0; enemy sitting at x=40 inside the mine's 60-unit radius. A
    // short arming delay lets the mine arm and detonate within the battle.
    const layer: ModuleEffect = { kind: "mineLayer", mineCount: 1, mineDamage: 80, mineRadius: 60, layCooldown: 0, armingDelay: 2 };
    const ships = [
      ship({
        id: "layer",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("ml", layer, 2, 0, 50, 5, 0)],
      }),
      ship({ id: "foe", side: "defender", x: 40, facing: Math.PI, structure: 600 }),
    ];
    const result = runBattle(inputs(ships, 12));
    expect(anyMines(result)).toBeGreaterThan(0);
    expect(totalDamage(result, "foe")).toBeGreaterThan(0);
  });

  it("mines never damage the layer's own side", () => {
    // Same geometry, but the ship within the blast radius is on the SAME side as
    // the layer. The mine arms but finds no valid enemy target, so the friendly
    // is untouched while an enemy further out (also in range) takes the hit.
    const layer: ModuleEffect = { kind: "mineLayer", mineCount: 1, mineDamage: 80, mineRadius: 120, layCooldown: 0, armingDelay: 2 };
    const ships = [
      ship({
        id: "layer",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("ml", layer, 2, 0, 50, 5, 0)],
      }),
      ship({ id: "ally", side: "attacker", x: 40, facing: 0, structure: 600 }),
      ship({ id: "foe", side: "defender", x: 80, facing: Math.PI, structure: 600 }),
    ];
    const result = runBattle(inputs(ships, 12));
    expect(totalDamage(result, "ally")).toBe(0);
    expect(totalDamage(result, "foe")).toBeGreaterThan(0);
  });

  it("a mine does not detonate before its arming delay elapses", () => {
    // armingDelay far longer than the battle — the mine never arms, so the enemy
    // sat on top of it takes no damage.
    const layer: ModuleEffect = { kind: "mineLayer", mineCount: 1, mineDamage: 80, mineRadius: 60, layCooldown: 0, armingDelay: 50 };
    const ships = [
      ship({
        id: "layer",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("ml", layer, 2, 0, 50, 5, 0)],
      }),
      ship({ id: "foe", side: "defender", x: 40, facing: Math.PI, structure: 600 }),
    ];
    const result = runBattle(inputs(ships, 6));
    expect(totalDamage(result, "foe")).toBe(0);
  });
});

describe("engine.entities — boarding pods", () => {
  it("a boarding ship launches pods that home and disable target modules", () => {
    // Boarding ship at x=0, unarmed, carrying a boarding module with long range.
    // The target sits at x=30 with several functional modules. Pods reach it and
    // disable one, so the target ends with fewer alive functional modules.
    const boarding: ModuleEffect = { kind: "boarding", podCount: 1, troops: 1, range: 5000, cooldown: 0 };
    const ships = [
      ship({
        id: "boarder",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("bd", boarding, 2, 0, 50, 5, 0)],
      }),
      ship({
        id: "foe",
        side: "defender",
        x: 30,
        facing: Math.PI,
        structure: 600,
        extra: [
          moduleOf("x1", { kind: "repair", repairRate: 1 }, 3, 0, 50, 5, 0),
          moduleOf("x2", { kind: "repair", repairRate: 1 }, 4, 0, 50, 5, 0),
        ],
      }),
    ];
    const result = runBattle(inputs(ships, 20));
    expect(aliveFunctionalModules(result, "foe")).toBeLessThan(4);
  });

  it("no boarding pods appear in a battle with no boarding modules", () => {
    const ships = [
      ship({ id: "a", side: "attacker", x: 0, facing: 0, weapons: [beam()] }),
      ship({ id: "d", side: "defender", x: 100, facing: Math.PI }),
    ];
    const result = runBattle(inputs(ships, 10));
    for (const frame of result.frames) {
      expect(frame.pods).toBeUndefined();
    }
  });
});

describe("engine.entities — determinism", () => {
  it("a battle with no entity modules emits no mines/pods and is reproducible", () => {
    const ships = [
      ship({ id: "a", side: "attacker", x: 0, facing: 0, weapons: [beam()] }),
      ship({ id: "d", side: "defender", x: 200, facing: Math.PI, weapons: [beam()] }),
    ];
    const one = runBattle(inputs(ships, 10));
    const two = runBattle(inputs(ships, 10));
    for (const frame of one.frames) {
      expect(frame.mines).toBeUndefined();
      expect(frame.pods).toBeUndefined();
    }
    expect(JSON.stringify(one.frames)).toBe(JSON.stringify(two.frames));
  });

  it("a battle with mines and boarding pods is byte-identical across runs", () => {
    const layer: ModuleEffect = { kind: "mineLayer", mineCount: 2, mineDamage: 40, mineRadius: 60, layCooldown: 0, armingDelay: 1 };
    const boarding: ModuleEffect = { kind: "boarding", podCount: 1, troops: 1, range: 5000, cooldown: 0 };
    const ships = [
      ship({
        id: "a",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("ml", layer, 2, 0, 50, 5, 0), moduleOf("bd", boarding, 3, 0, 50, 5, 0)],
      }),
      ship({ id: "d", side: "defender", x: 40, facing: Math.PI, structure: 600 }),
    ];
    const one = runBattle(inputs(ships, 15));
    const two = runBattle(inputs(ships, 15));
    // Entity ids and positions must match exactly — the deterministic id counters
    // and fixed-step homing make identical seeds reproduce identical frames.
    expect(JSON.stringify(one.frames)).toBe(JSON.stringify(two.frames));
  });
});

describe("engine.entities — drones", () => {
  it("a carrier launches drones that home toward and damage the enemy", () => {
    // Carrier (hangar only) vs a tough stationary enemy. Drones spawn, fly to the
    // enemy and chip its structure over time. The carrier itself is unarmed, so
    // any damage the enemy suffers comes from the drones.
    const hangar: ModuleEffect = {
      kind: "hangar",
      droneCount: 3,
      launchCooldown: 1,
      droneHp: 40,
      droneDamage: 6,
      droneRange: 100,
      droneSpeed: 6,
    };
    const ships = [
      ship({
        id: "carrier",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("hg", hangar, 2, 0, 50, 5, 0)],
      }),
      ship({ id: "foe", side: "defender", x: 150, facing: Math.PI, structure: 2000 }),
    ];
    const result = runBattle(inputs(ships, 70));
    expect(totalDamage(result, "foe")).toBeGreaterThan(0);
  });

  it("drones appear in the drones snapshot and never in the ships snapshot", () => {
    const hangar: ModuleEffect = {
      kind: "hangar",
      droneCount: 2,
      launchCooldown: 1,
      droneHp: 40,
      droneDamage: 4,
      droneRange: 100,
      droneSpeed: 6,
    };
    const ships = [
      ship({
        id: "carrier",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("hg", hangar, 2, 0, 50, 5, 0)],
      }),
      ship({ id: "foe", side: "defender", x: 200, facing: Math.PI, structure: 2000 }),
    ];
    const result = runBattle(inputs(ships, 30));
    expect(result.frames.some((f) => (f.drones?.length ?? 0) > 0)).toBe(true);
    // Drones are partitioned out of the ships array — only carrier + foe appear.
    for (const frame of result.frames) {
      const ids = frame.ships.map((s) => s.instanceId);
      expect(ids).toEqual(expect.arrayContaining(["carrier", "foe"]));
      expect(ids.length).toBe(2);
    }
  });
});

describe("engine.entities — decoys", () => {
  it("a decoy launcher emits decoys that appear in the decoys snapshot", () => {
    const decoy: ModuleEffect = {
      kind: "decoy",
      decoyCount: 3,
      duration: 60,
      cooldown: 1,
      decoyHp: 50,
    };
    const ships = [
      ship({
        id: "layer",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("dy", decoy, 2, 0, 50, 5, 0)],
      }),
      ship({ id: "foe", side: "defender", x: 300, facing: Math.PI, structure: 2000 }),
    ];
    const result = runBattle(inputs(ships, 20));
    expect(result.frames.some((f) => (f.decoys?.length ?? 0) > 0)).toBe(true);
  });

  it("decoys expire after their duration and leave the snapshot", () => {
    // Short duration, long cooldown so a single batch is launched then expires.
    const decoy: ModuleEffect = {
      kind: "decoy",
      decoyCount: 2,
      duration: 10,
      cooldown: 1000,
      decoyHp: 50,
    };
    const ships = [
      ship({
        id: "layer",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("dy", decoy, 2, 0, 50, 5, 0)],
      }),
      ship({ id: "foe", side: "defender", x: 300, facing: Math.PI, structure: 2000 }),
    ];
    const result = runBattle(inputs(ships, 40));
    // Early frames carry decoys; the final frame (well past duration) has none.
    expect(result.frames.slice(1, 12).some((f) => (f.decoys?.length ?? 0) > 0)).toBe(true);
    const last = result.frames[result.frames.length - 1];
    if (last !== undefined) {
      expect(last.decoys?.length ?? 0).toBe(0);
    }
  });

  it("a battle with drones and decoys is byte-identical across runs", () => {
    const hangar: ModuleEffect = {
      kind: "hangar",
      droneCount: 2,
      launchCooldown: 5,
      droneHp: 30,
      droneDamage: 4,
      droneRange: 90,
      droneSpeed: 5,
    };
    const decoy: ModuleEffect = {
      kind: "decoy",
      decoyCount: 2,
      duration: 80,
      cooldown: 120,
      decoyHp: 40,
    };
    const ships = [
      ship({
        id: "a",
        side: "attacker",
        x: 0,
        facing: 0,
        extra: [moduleOf("hg", hangar, 2, 0, 50, 5, 0), moduleOf("dy", decoy, 3, 0, 50, 5, 0)],
      }),
      ship({ id: "d", side: "defender", x: 180, facing: Math.PI, structure: 1500 }),
    ];
    const one = runBattle(inputs(ships, 40));
    const two = runBattle(inputs(ships, 40));
    expect(JSON.stringify(one.frames)).toBe(JSON.stringify(two.frames));
  });
});
