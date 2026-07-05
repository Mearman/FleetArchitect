import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32 } from "@/domain/simulation/rng";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { applyEffectScaling, recomputeAggregatesWithScaling } from "@/domain/simulation/engine/effect-scaling";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { SimModule, SimShip } from "@/domain/simulation/engine/types";

/**
 * Effect scaling for multi-cell modules: a module's output magnitudes scale with
 * its surviving covered cells. These tests build a ship with a multi-cell anchor
 * (via the real `toSimShip`, which constructs `scalingMeta`), kill covers, run
 * `applyEffectScaling`, and assert the anchor's effect magnitudes scaled by the
 * surviving-cell fraction. The fraction is `(1 + aliveCovers) / totalCells`
 * (the anchor counts as one cell).
 */

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

function stats(): ShipStats {
  return {
    mass: 10, cost: 100, powerDraw: 0, powerOutput: 0, powerNet: 0,
    crewRequired: 0, crewCapacity: 0, crewNet: 0, structure: 1_000_000,
    damageReduction: 0, shieldCapacity: 0, shieldRechargeRate: 0, shieldRechargeDelay: 30,
    deflectorCapacity: 0, deflectorRechargeRate: 0, deflectorRechargeDelay: 0,
    thrust: 0, turnRate: 0, weapons: [], compartments: 0, airtightCompartments: 0,
  };
}

function moduleOf(slotId: string, effect: ModuleEffect, col: number, coverSlotIds?: string[]): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    coverSlotIds,
    col,
    row: 0,
    x: col * CELL_SIZE,
    y: 0,
    maxSurfaceHp: 0,
    maxSubstrateHp: 5_000,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
    surface: "bare",
    edges: OPEN_EDGES,
    mass: 5,
    powerDraw: effect.kind === "weapon" ? 40 : 0,
    crewRequired: 0,
    effect,
    command: effect.kind === "power",
    repairRate: effect.kind === "repair" ? effect.repairRate : 0,
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

/** Find a module by slotId on a sim ship. */
function moduleBySlot(ship: SimShip, slotId: string): SimModule {
  const m = ship.modules?.find((x) => x.slotId === slotId);
  if (m === undefined) throw new Error(`module ${slotId} not found`);
  return m;
}

/**
 * Build a ship with one multi-cell anchor at col 0 and `coverCount` covered
 * cells at cols 1..coverCount. Returns the sim ship plus the anchor + cover
 * sim modules (all alive).
 */
function buildMultiCellShip(
  anchorEffect: ModuleEffect,
  coverCount: number,
): { ship: SimShip; anchor: SimModule; covers: SimModule[] } {
  const coverSlotIds = Array.from({ length: coverCount }, (_, i) => `cell-${i + 1}-0`);
  const resolved: ResolvedModule[] = [
    moduleOf("cell-0-0", anchorEffect, 0, coverSlotIds),
    ...coverSlotIds.map((s, i) => moduleOf(s, { kind: "hull" }, i + 1)),
  ];
  const combat: CombatShip = {
    instanceId: "ship",
    designId: "d-ship",
    faction: "Terran",
    side: "attacker",
    stats: stats(),
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules: resolved,
  };
  const ship = toSimShip(combat, mulberry32(7));
  return {
    ship,
    anchor: moduleBySlot(ship, "cell-0-0"),
    covers: coverSlotIds.map((s) => moduleBySlot(ship, s)),
  };
}

const WEAPON: WeaponEffect = {
  kind: "weapon", weaponType: "beam", damage: 100, range: 320, cooldown: 5,
  projectileSpeed: 0, projectileMass: 0.5, tracking: 0,
  shieldPiercing: 1, armourPiercing: 1, spread: 0, facing: 0,
};

describe("applyEffectScaling — weapon damage", () => {
  it("scales damage by the surviving-cell fraction as covers die", () => {
    const base = WEAPON.damage;
    const { ship, anchor, covers } = buildMultiCellShip(WEAPON, 2); // 3 cells total

    // All alive: full strength (fraction 3/3). applyEffectScaling is a no-op on
    // value (base × 1), but run it to confirm no spurious change.
    applyEffectScaling(ship);
    if (anchor.effect.kind !== "weapon") throw new Error("expected weapon");
    expect(anchor.effect.damage).toBeCloseTo(base, 9);

    // Kill one cover: fraction (1 + 1) / 3 = 2/3.
    covers[0]!.alive = false;
    applyEffectScaling(ship);
    if (anchor.effect.kind !== "weapon") throw new Error("expected weapon");
    expect(anchor.effect.damage).toBeCloseTo((base * 2) / 3, 9);

    // Kill both covers: fraction (1 + 0) / 3 = 1/3 (anchor alone still fires).
    covers[1]!.alive = false;
    applyEffectScaling(ship);
    if (anchor.effect.kind !== "weapon") throw new Error("expected weapon");
    expect(anchor.effect.damage).toBeCloseTo(base / 3, 9);
  });

  it("does not mutate a dead anchor's effect", () => {
    const { ship, anchor, covers } = buildMultiCellShip(WEAPON, 2);
    covers[0]!.alive = false;
    anchor.alive = false; // anchor destroyed → module inert
    const before = anchor.effect;
    applyEffectScaling(ship);
    expect(anchor.effect).toBe(before); // same reference, untouched
  });
});

describe("applyEffectScaling — other output magnitudes", () => {
  it("scales shield capacity and rechargeRate", () => {
    const { ship, anchor, covers } = buildMultiCellShip(
      { kind: "shield", capacity: 1000, rechargeRate: 100, rechargeDelay: 30 }, 1,
    );
    covers[0]!.alive = false; // fraction 1/2
    applyEffectScaling(ship);
    if (anchor.effect.kind !== "shield") throw new Error("expected shield");
    expect(anchor.effect.capacity).toBeCloseTo(500, 9);
    expect(anchor.effect.rechargeRate).toBeCloseTo(50, 9);
  });

  it("scales engine thrust", () => {
    const { ship, anchor, covers } = buildMultiCellShip(
      { kind: "engine", thrust: 400, gimbalArc: 0 }, 1,
    );
    covers[0]!.alive = false; // fraction 1/2
    applyEffectScaling(ship);
    if (anchor.effect.kind !== "engine") throw new Error("expected engine");
    expect(anchor.effect.thrust).toBeCloseTo(200, 9);
  });

  it("scales reactor output", () => {
    const { ship, anchor, covers } = buildMultiCellShip(
      { kind: "power", output: 1_000_000 }, 2,
    );
    covers[0]!.alive = false; // fraction 2/3
    applyEffectScaling(ship);
    if (anchor.effect.kind !== "power") throw new Error("expected power");
    expect(anchor.effect.output).toBeCloseTo((1_000_000 * 2) / 3, 3);
  });

  it("scales the repair module-field rate (not the effect)", () => {
    const { ship, anchor, covers } = buildMultiCellShip(
      { kind: "repair", repairRate: 30 }, 1,
    );
    covers[0]!.alive = false; // fraction 1/2
    applyEffectScaling(ship);
    expect(anchor.repairRate).toBeCloseTo(15, 9);
  });
});

describe("applyEffectScaling — no-op cases", () => {
  it("is a no-op on a ship with no multi-cell modules (no scalingMeta)", () => {
    // Single-cell weapon only: no coverSlotIds → no scalingMeta → no-op.
    const combat: CombatShip = {
      instanceId: "ship",
      designId: "d-ship",
      faction: "Terran",
      side: "attacker",
      stats: stats(),
      position: { x: 0, y: 0 },
      facing: 0,
      doctrine: { base: {}, rules: [] },
      classification: "frigate",
      modules: [
        moduleOf("cell-0-0", { kind: "power", output: 1000 }, 0),
        moduleOf("cell-1-0", WEAPON, 1),
      ],
    };
    const ship = toSimShip(combat, mulberry32(7));
    expect(ship.scalingMeta).toBeUndefined();
    const weapon = moduleBySlot(ship, "cell-1-0");
    const before = weapon.effect;
    applyEffectScaling(ship);
    expect(weapon.effect).toBe(before);
  });

  it("leaves a fully-intact multi-cell module at base strength", () => {
    const { ship, anchor } = buildMultiCellShip(WEAPON, 2);
    applyEffectScaling(ship);
    if (anchor.effect.kind !== "weapon") throw new Error("expected weapon");
    expect(anchor.effect.damage).toBeCloseTo(WEAPON.damage, 9);
  });
});

describe("recomputeAggregatesWithScaling — wrapper ordering", () => {
  it("folds the SCALED magnitudes into ship aggregates (mutation before the fold)", () => {
    // A 2-cell shield: ship.maxShield is folded from the shield capacity. With
    // the cover dead, the capacity halves (1/2), so maxShield must read 500 —
    // proving the scaling landed before recomputeAggregates folded it.
    const { ship, covers } = buildMultiCellShip(
      { kind: "shield", capacity: 1000, rechargeRate: 100, rechargeDelay: 30 }, 1,
    );
    covers[0]!.alive = false;
    recomputeAggregatesWithScaling(ship);
    expect(ship.maxShield).toBeCloseTo(500, 9);
  });
});
