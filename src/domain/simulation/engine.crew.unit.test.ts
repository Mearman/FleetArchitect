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
    projectileMass: 0.5,
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
  opts: {
    mass?: number;
    powerDraw?: number;
    command?: boolean;
    crewRequired?: number;
    x?: number;
    y?: number;
  } = {},
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: opts.x ?? col,
    y: opts.y ?? row,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
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
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function statsFor(structure: number): ShipStats {
  return {
    mass: 10,
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
    compartments: 0,
  airtightCompartments: 0,
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
    faction: "Terran",
    side: "attacker",
    stats: statsFor(structure),
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
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
    faction: "Terran",
    side: "defender",
    stats: statsFor(1_000_000),
    position: { x, y: 0 },
    facing: Math.PI,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
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

  it("is byte-identical across two runs with the same seed (manning)", () => {
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

describe("engine.crew — ammo hauling", () => {
  /**
   * A crewless ship whose only weapon starts dry (`ammo: 0`) with a finite
   * `ammoCapacity`, a magazine with store, and surplus crew with a clear route
   * along a hull corridor. Layout, left to right:
   *   col 0: crew quarters (capacity 2)   — crew spawn here
   *   col 1: hull corridor                 — walkable bridge
   *   col 2: reactor/bridge                — power + command (crewless)
   *   col 3: magazine (ammoStored)         — the ammo source
   *   col 4: dry weapon (ammoCapacity)     — the sink, also crewless so it fires
   *                                          the instant it has rounds
   */
  function haulShip(opts: { magazine: boolean; ammoStored?: number }): CombatShip {
    const modules: ResolvedModule[] = [
      moduleOf("q1", { kind: "crew", capacity: 2 }, 0, 0, 15),
      moduleOf("h1", { kind: "hull" }, 1, 0, 60),
      moduleOf("p1", { kind: "power", output: 200 }, 2, 0, 20, { command: true }),
    ];
    if (opts.magazine) {
      modules.push(
        moduleOf(
          "mag1",
          { kind: "magazine", ammoStored: opts.ammoStored ?? 300 },
          3,
          0,
          40,
        ),
      );
    } else {
      // Keep the corridor connected without a magazine: a plain hull cell.
      modules.push(moduleOf("h2", { kind: "hull" }, 3, 0, 60));
    }
    modules.push(
      moduleOf(
        "w1",
        beam({ damage: 25, cooldown: 1, ammo: 0, ammoCapacity: 120 }),
        4,
        0,
        50,
        { powerDraw: 10 },
      ),
    );
    return shooterShip("a1", 0, modules);
  }

  it("a dry weapon resumes firing only after a crew ammo-run from a magazine", () => {
    const result = runBattle(inputs([haulShip({ magazine: true }), toughTarget("d1", 60)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;

    // The weapon is dry at the start: the first several frames deal no damage
    // while crew walk from the quarters (col 0) to the magazine (col 3) and back
    // to the gun (col 4).
    expect(structures[1], "dry weapon must not fire before resupply").toBe(initial);
    expect(structures[3], "still dry while crew are en route").toBe(initial);

    // Once a run completes the gun fires and the target loses structure.
    const final = structures.at(-1) ?? initial;
    expect(final, "weapon should fire after an ammo-run refills it").toBeLessThan(initial);
  });

  it("a dry weapon with no magazine or route stays dry forever", () => {
    const result = runBattle(inputs([haulShip({ magazine: false }), toughTarget("d1", 60)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    const final = structures.at(-1) ?? initial;
    expect(final, "no magazine means the weapon never resupplies").toBe(initial);
  });

  it("an exhausted magazine cannot refill the weapon", () => {
    // A magazine with almost no store: a single short run, then it is empty and
    // the gun goes quiet again. The target takes a little damage, then no more.
    const result = runBattle(
      inputs([haulShip({ magazine: true, ammoStored: 10 }), toughTarget("d1", 60)]),
    );
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    const minStruct = structures.reduce((a, b) => Math.min(a, b), initial);
    // Some damage was dealt from the one small run...
    expect(minStruct, "the one small run should land some hits").toBeLessThan(initial);
    // ...but the tail is flat: once the magazine is dry and the weapon spends
    // its rounds, nothing more lands.
    const tail = structures.slice(-15);
    expect(tail.every((s) => s === tail[0]), "damage stops once the magazine empties").toBe(true);
  });

  it("is byte-identical across two runs with the same seed (ammo hauling)", () => {
    const a = runBattle(inputs([haulShip({ magazine: true }), toughTarget("d1", 60)]));
    const b = runBattle(inputs([haulShip({ magazine: true }), toughTarget("d1", 60)]));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});

describe("engine.crew — power hauling", () => {
  /**
   * A crewed ship whose weapon sits beyond the passive wiring reach of the
   * reactor, so it cannot draw power directly and depends on crew carrying
   * charge. Layout, left to right (a long corridor of hull cells):
   *   col 0:  crew quarters (capacity 2)  — crew spawn here
   *   col 1:  reactor/bridge               — power + command, the charge source
   *   col 2..6: hull corridor              — five cells, putting the gun out of
   *                                          the wiring radius (3) of the reactor
   *   col 7:  weapon (powerDraw, crewless) — starves without hauled charge
   * The weapon needs no crew of its own, so manning never gates it: the only
   * thing keeping it dark is local charge.
   */
  function farWeaponShip(corridor: number): CombatShip {
    const modules: ResolvedModule[] = [
      moduleOf("q1", { kind: "crew", capacity: 2 }, 0, 0, 15),
      moduleOf("p1", { kind: "power", output: 500 }, 1, 0, 20, { command: true }),
    ];
    for (let col = 2; col <= 1 + corridor; col += 1) {
      modules.push(moduleOf(`h${col}`, { kind: "hull" }, col, 0, 60));
    }
    const gunCol = 2 + corridor;
    modules.push(
      moduleOf("w1", beam({ damage: 25, cooldown: 1 }), gunCol, 0, 50, { powerDraw: 10 }),
    );
    return shooterShip("a1", 0, modules);
  }

  it("a module far from any reactor is restored by a crew power-run", () => {
    // Five corridor cells put the gun six cells from the reactor — beyond the
    // wiring radius — so it starts firing off its initial buffer, falls silent
    // as the buffer drains, then crew power-runs keep it fed for the long haul.
    const result = runBattle(inputs([farWeaponShip(5), toughTarget("d1", 70)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    const final = structures.at(-1) ?? initial;
    // Over the battle, crew haul charge to the gun and the target loses
    // structure — the far station is being kept alive by the power economy.
    expect(final, "a power-run should keep the far gun firing").toBeLessThan(initial);
    // And it keeps firing late in the battle (not just an opening burst off the
    // initial buffer): the tail is still trending down.
    const tail = structures.slice(-20);
    const tailStart = tail[0] ?? 0;
    const tailEnd = tail.at(-1) ?? tailStart;
    expect(tailEnd, "the gun should still be fed late in the battle").toBeLessThan(tailStart);
  });

  it("a wired weapon beside the reactor needs no power crew", () => {
    // Gun one cell from the reactor — inside the wiring radius — so it is fed
    // for free and fires from the off, even though the ship has crew.
    const result = runBattle(inputs([farWeaponShip(0), toughTarget("d1", 30)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    expect(structures[2], "a wired gun should fire early").toBeLessThan(initial);
  });

  it("is byte-identical across two runs with the same seed (power hauling)", () => {
    const a = runBattle(inputs([farWeaponShip(5), toughTarget("d1", 70)]));
    const b = runBattle(inputs([farWeaponShip(5), toughTarget("d1", 70)]));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});

describe("engine.crew — snapshot", () => {
  function crewOf(
    frame: { ships: { instanceId: string; crew?: { id: string; state: string }[] }[] },
    id: string,
  ): { id: string; state: string }[] {
    return frame.ships.find((s) => s.instanceId === id)?.crew ?? [];
  }

  it("emits one crew member per CrewEffect capacity point in the snapshot", () => {
    const modules = [
      moduleOf("q1", { kind: "crew", capacity: 3 }, 0, 0, 15),
      moduleOf("p1", { kind: "power", output: 40 }, 1, 0, 20, { command: true }),
    ];
    const result = runBattle(inputs([shooterShip("a1", 0, modules), toughTarget("d1", 30)]));
    expect(crewOf(result.frames[0]!, "a1")).toHaveLength(3);
  });

  it("emits module manned/ammo/charge on the module snapshot", () => {
    const modules = [
      moduleOf("q1", { kind: "crew", capacity: 1 }, 0, 0, 15),
      moduleOf("p1", { kind: "power", output: 80 }, 1, 0, 20, { command: true }),
      moduleOf(
        "w1",
        beam({ damage: 25, cooldown: 1, ammo: 0, ammoCapacity: 120 }),
        2,
        0,
        50,
        { powerDraw: 10, crewRequired: 1 },
      ),
    ];
    const result = runBattle(inputs([shooterShip("a1", 0, modules), toughTarget("d1", 40)]));
    const ship = result.frames[0]!.ships.find((s) => s.instanceId === "a1");
    // The dynamic cells are INDEX-MATCHED to the static layout, so find w1's
    // index in the descriptor then read cells[index].
    const layout = result.descriptors?.find((d) => d.instanceId === "a1")?.cells;
    const w1Idx = layout?.findIndex((c) => c.slotId === "w1");
    const weapon = w1Idx !== undefined && w1Idx >= 0 ? ship?.cells?.[w1Idx] : undefined;
    expect(weapon?.manned, "a crewed weapon emits its manned flag").toBe(false);
    expect(weapon?.ammo, "a finite-magazine weapon emits its ammo").toBe(0);
    expect(weapon?.charge, "a power-drawing weapon emits its charge").toBeGreaterThan(0);
  });
});

describe("engine.crew — break-apart partition", () => {
  /**
   * A legacy hammer that fires a heavy beam to shear the defender's hull cell.
   */
  function hammer(id: string, x: number): CombatShip {
    return {
      instanceId: id,
      designId: `d-${id}`,
      faction: "Terran",
      side: "attacker",
      stats: { ...statsFor(99999), weapons: [{ slotId: "s", effect: beam({ damage: 50, range: 500, cooldown: 1 }) }] },
      position: { x, y: 0 },
      facing: 0,
      orders: { ...defaultOrders, engageRange: "hold" },
      crewPriority: "combat",
      shipStance: "balanced",
      rules: [],
      classification: "frigate",
    };
  }

  /**
   * A vertical column that severs into two crewed halves when its central hull
   * cell dies. Quarters sit at (col 0, row 0) and (col 0, row 2); a fragile hull
   * bridges them at (col 0, row 1). The cells are spread by CELL_SIZE in
   * ship-local y so the hammer's beam strikes the central hull first. The two
   * quarters are edge-adjacent to the hull (row diff 1) but not to each other
   * (row diff 2), so destroying the hull splits the column into two single-cell
   * fragments, each carrying its own crew.
   */
  function splitColumn(id: string, x: number): CombatShip {
    const modules: ResolvedModule[] = [
      moduleOf("qU", { kind: "crew", capacity: 1 }, 0, 0, 50, { x: -14, y: -12, command: true }),
      moduleOf("h1", { kind: "hull" }, 0, 1, 1, { x: -14, y: 0 }),
      moduleOf("qD", { kind: "crew", capacity: 1 }, 0, 2, 50, { x: -14, y: 12 }),
    ];
    return {
      instanceId: id,
      designId: `d-${id}`,
      faction: "Terran",
      side: "defender",
      stats: { ...statsFor(5000), thrust: 0, turnRate: 0 },
      position: { x, y: 0 },
      facing: Math.PI,
      orders: { ...defaultOrders, engageRange: "hold" },
      crewPriority: "combat",
      shipStance: "balanced",
      rules: [],
      classification: "frigate",
      modules,
    };
  }

  it("partitions crew to the fragment whose cell each occupies", () => {
    const result = runBattle(inputs([hammer("a1", 0), splitColumn("d1", 80)]));

    // Find the frame where a chunk first breaks off.
    const splitFrame = result.frames.find((f) => f.ships.some((s) => s.brokeOff === true));
    expect(splitFrame, "the column should split when its hull cell dies").toBeDefined();
    if (splitFrame === undefined) return;

    const original = splitFrame.ships.find((s) => s.instanceId === "d1");
    const chunk = splitFrame.ships.find((s) => s.brokeOff === true);
    expect(original?.crew, "the survivor keeps its own crew").toBeDefined();
    expect(chunk?.crew, "the chunk carries its own crew").toBeDefined();

    // Each single-cell fragment holds exactly one crew member, and the two
    // fragments hold different crew — the column's two crew partition cleanly.
    expect(original?.crew).toHaveLength(1);
    expect(chunk?.crew).toHaveLength(1);
    const originalIds = (original?.crew ?? []).map((c) => c.id);
    const chunkIds = (chunk?.crew ?? []).map((c) => c.id);
    expect(originalIds.some((cid) => chunkIds.includes(cid)), "crew are not shared across fragments").toBe(false);
  });

  it("is byte-identical across two runs with the same seed (break-apart)", () => {
    const a = runBattle(inputs([hammer("a1", 0), splitColumn("d1", 80)]));
    const b = runBattle(inputs([hammer("a1", 0), splitColumn("d1", 80)]));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});

describe("engine.crew — path cache determinism (larger grid)", () => {
  /**
   * A capital-like grid with crew, weapons, a magazine, reactors, and a hull
   * corridor — enough structure that the crew path cache exercises many distinct
   * (from, to) pairs across manning, ammo runs, and power runs. The byte-identity
   * check across two runs proves the cache (and its topology-fingerprint
   * invalidation, the pathIndex stepping, and the batched assignment) produce
   * identical crew behaviour to a single uncached run.
   *
   * Layout (a 2-row, 8-column grid, all cells 4-connected):
   *   row 0: q0 q1 h0 p1 h1 w1 w2 h3
   *   row 1: .. .. .. .. h2 m1 .. ..
   * Crew spawn at the two quarters (q0, q1), man the weapons (w1 crewRequired 1,
   * w2 crewRequired 2), run ammo from the magazine (m1) to the dry weapon (w2),
   * and run power from the reactor (p1) to the weapons. The hull cells bridge
   * the corridor so paths are multi-step and exercise the cache.
   */
  function capitalLike(): CombatShip {
    const modules = [
      moduleOf("q0", { kind: "crew", capacity: 2 }, 0, 0, 15),
      moduleOf("q1", { kind: "crew", capacity: 2 }, 1, 0, 15),
      moduleOf("h0", { kind: "hull" }, 2, 0, 60),
      moduleOf("p1", { kind: "power", output: 300 }, 3, 0, 20, { command: true }),
      moduleOf("h1", { kind: "hull" }, 4, 0, 60),
      moduleOf("w1", beam({ damage: 10, cooldown: 2 }), 5, 0, 50, { powerDraw: 10, crewRequired: 1 }),
      moduleOf(
        "w2",
        beam({ damage: 15, cooldown: 3, ammo: 0, ammoCapacity: 80 }),
        6,
        0,
        50,
        { powerDraw: 15, crewRequired: 2 },
      ),
      moduleOf("h3", { kind: "hull" }, 7, 0, 60),
      moduleOf("h2", { kind: "hull" }, 4, 1, 60),
      moduleOf("m1", { kind: "magazine", ammoStored: 400 }, 5, 1, 40),
    ];
    return shooterShip("a1", 0, modules);
  }

  it("a capital-like crewed grid is byte-identical across two same-seed runs", () => {
    // Target placed within visualLosRadius (140) so the sensor-less shooter can
    // acquire it; beam range (500) still covers the gap comfortably.
    const a = runBattle(inputs([capitalLike(), toughTarget("d1", 100)]));
    const b = runBattle(inputs([capitalLike(), toughTarget("d1", 100)]));
    expect(b.frames.length).toBe(a.frames.length);
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });

  it("crew actually move and man stations on the capital-like grid", () => {
    // Sanity: the cache isn't silently returning empty paths. Crew must reach
    // their stations and the weapons must eventually fire (the target takes
    // damage), proving the cached paths are real and walked correctly. Target
    // within visualLosRadius so the sensor-less shooter acquires it.
    const result = runBattle(inputs([capitalLike(), toughTarget("d1", 100)]));
    const structures = result.frames.map((f) => structureOf(f, "d1") ?? 0);
    const initial = structures[0] ?? 0;
    const final = structures.at(-1) ?? initial;
    expect(final, "crewed weapons should fire and damage the target").toBeLessThan(initial);
  });
});
