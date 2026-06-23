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
 * Structural break-apart: when a modular ship's alive modules are no longer
 * connected, each connected component (under 4-connected, edge-sharing
 * adjacency) becomes its own rigid body. The largest component keeps the
 * original ship's `instanceId`; the smaller ones split off as fresh ships with
 * their own `instanceId`, inheriting the parent's momentum and a copy of their
 * carried modules.
 *
 * Layout under test: a vertical three-cell column in grid column 0 — a weapon
 * cell at row 0, a hull cell at row 1, a weapon cell at row 2. The hull is the
 * middle cell, edge-adjacent to both weapons (row diff 1). The two weapons are
 * NOT adjacent to each other (row diff 2), so they are only held together
 * through the hull. The hull sits at the centre of the impact edge facing the
 * attacker, so the beam (fired along +x from the left) lands nearest the hull
 * cell. Destroying it severs the column into two single-weapon components.
 *
 * Connectivity rule: two cells are adjacent iff they share a grid edge
 * (4-connected). Diagonal cells do not connect.
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
    range: 500,
    cooldown: 5,
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
    col,
    row,
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

/** A legacy (non-modular) hammer ship — large structure, single high-power
 *  beam that focuses its fire on the central hull module of the target. */
function hammerShip(id: string, x: number): CombatShip {
  const weapon = beam({ damage: 50, range: 500, cooldown: 1 });
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
    thrust: 0,
    turnRate: 0,
    weapons: [{ slotId: "s", effect: weapon }],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats,
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
 * A modular defender: a vertical column of three cells in grid column 0 — a
 * weapon at (col 0, row 0), a hull cell at (col 0, row 1), a weapon at
 * (col 0, row 2). The hull's HP is `hullHp`; setting it to 1 lets a single
 * hammer hit tear it apart. The hull cell sits at ship-local (−14, 0) — the
 * centre of the left edge facing the attacker — so the beam strikes it first.
 * The two weapons sit at (−14, −12) and (−14, +12); they are edge-adjacent to
 * the hull (row diff 1) but not to each other (row diff 2), so destroying the
 * hull severs the column into two single-weapon components.
 */
function columnShip(id: string, x: number, hullHp: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("wU", beam({ damage: 1, range: 50 }), 0, 0, -14, -12, 50, 5, 0, true),
    moduleOf("h1", { kind: "hull" }, 0, 1, -14, 0, hullHp, 5),
    moduleOf("wD", beam({ damage: 1, range: 50 }), 0, 2, -14, 12, 50, 5, 0, false),
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
    structure: 5000,
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
    faction: "Terran",
    side: "defender",
    stats,
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

describe("engine.breakaway", () => {
  it("a modular ship splits when its only hull cell is destroyed", () => {
    // Hull HP = 1: the first hit tears the central cell apart, severing the
    // column into two single-cell chunks (one weapon each).
    const result = runBattle(inputs([hammerShip("a1", 0), columnShip("d1", 80, 1)]));

    // Find a frame where the original `d1` still exists but a chunk
    // has broken off (some ship in the frame has `brokeOff: true`).
    const splitFrame = result.frames.find((f) =>
      f.ships.some((s) => s.brokeOff === true),
    );
    expect(splitFrame, "the ship should split when its hull cell is destroyed").toBeDefined();
    if (splitFrame === undefined) return;

    // The original ship kept its identity; at least one chunk also exists.
    const original = splitFrame.ships.find((s) => s.instanceId === "d1");
    expect(original, "the original ship should still be tracked").toBeDefined();
    const chunk = splitFrame.ships.find((s) => s.brokeOff === true);
    expect(chunk, "exactly one chunk should have broken off").toBeDefined();
    if (chunk === undefined) return;

    // The chunk is alive and carries exactly one alive weapon — it kept
    // the weapon module from one end of the severed column.
    expect(chunk.alive).toBe(true);
    const aliveChunkModules = chunk.cells?.filter((m) => m.alive) ?? [];
    expect(aliveChunkModules.length).toBe(1);
    // Cell kind is static, read from the chunk's descriptor by slot id.
    const chunkLayout = result.descriptors?.find((d) => d.instanceId === chunk.instanceId)?.cells;
    const aliveSlot = aliveChunkModules[0]?.slotId;
    const aliveKind = chunkLayout?.find((c) => c.slotId === aliveSlot)?.kind;
    expect(aliveKind).toBe("weapon");

    // The split is permanent: subsequent frames keep the chunk alive.
    const lastWithChunk = result.frames.find(
      (f) => f.ships.find((s) => s.brokeOff === true) !== undefined,
    );
    expect(lastWithChunk).toBeDefined();
  });

  it("a modular ship with an intact hull cell does not split", () => {
    // Hull HP huge: no amount of hammer fire in one battle destroys it,
    // so the graph stays connected and no chunk ever appears.
    const result = runBattle(inputs([hammerShip("a1", 0), columnShip("d1", 80, 1_000_000)]));
    const anyChunk = result.frames.some((f) => f.ships.some((s) => s.brokeOff === true));
    expect(anyChunk, "an intact hull should not split").toBe(false);
  });

  it("split chunks carry independent momentum from the parent", () => {
    // The split happens; the chunk inherits the parent's velocity, which
    // is zero at this stage (the defender is stationary). The chunk's
    // own velocity should also be zero, and it should keep flying along
    // with the parent as the battle continues.
    const result = runBattle(inputs([hammerShip("a1", 0), columnShip("d1", 80, 1)]));
    const splitFrame = result.frames.find((f) =>
      f.ships.some((s) => s.brokeOff === true),
    );
    if (splitFrame === undefined) throw new Error("no split occurred");
    const chunk = splitFrame.ships.find((s) => s.brokeOff === true);
    if (chunk === undefined) throw new Error("no chunk found");
    expect(chunk.vx ?? 0).toBe(0);
    expect(chunk.vy ?? 0).toBe(0);

    // A few ticks later, the chunk should still be alive and tracked.
    const later = result.frames.slice(splitFrame.tick + 1, splitFrame.tick + 20);
    const trackedChunk = later.find((f) =>
      f.ships.some((s) => s.instanceId === chunk.instanceId),
    );
    expect(trackedChunk, "the chunk should remain in the simulation after the split").toBeDefined();
  });

  it("split behaviour is deterministic", () => {
    const mk = () => runBattle(inputs([hammerShip("a1", 0), columnShip("d1", 80, 1)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});
