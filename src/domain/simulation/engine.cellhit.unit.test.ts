import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { CELL_SIZE } from "@/domain/grid";
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
 * Projectile-vs-cell hits. A projectile strikes the frontmost occupied cell on
 * its path (resolved through the spatial-hash broad-phase), and armour-piercing
 * overflow carries to the next cell behind along the travel direction — not to
 * whichever module happens to be nearest. These tests fire a single round into
 * a column of cells and read the per-cell HP out of the snapshots to confirm
 * which cell absorbed the hit and how the overflow penetrated.
 */

function stats(over: Partial<ShipStats> = {}): ShipStats {
  return {
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
    ...over,
    compartments: 0,
  airtightCompartments: 0,
};
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp: number,
  mass = 5,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    maxSurfaceHp: 0,
    maxScaffoldHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw: 0,
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

/** Defender stand-off distance (world units), several cells out from the
 *  shooter and scaled to the cell size so the geometry is the same at any
 *  metre scale. */
const DEFENDER_DISTANCE = CELL_SIZE * 8;

/** A slow cannon round so a single shot is easy to follow; high cooldown so
 *  only one fires within the window we inspect. The projectile step per tick
 *  (`CELL_SIZE / 2`) is kept at or below the cell contact distance (`CELL_SIZE`)
 *  so the round samples each cell on its path rather than tunnelling past a
 *  column of cells only one cell apart. */
function cannon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 20,
    range: 1000,
    cooldown: 1,
    projectileSpeed: CELL_SIZE / 2,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
    ...over,
  };
}

/** A shooter at the origin facing +x with one centreline cannon. */
function shooter(weapon: WeaponEffect): CombatShip {
  return {
    instanceId: "a1",
    designId: "d-a1",
    faction: "test",
    side: "attacker",
    stats: stats({ thrust: 0 }),
    position: { x: 0, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules: [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 100, 5, true),
      moduleOf("w1", weapon, 1, 0, 100, 5),
    ],
  };
}

/**
 * A defender at (distance, 0) facing +x (so its local +x points away from the
 * shooter). Its cells lie along the centreline at cols 0..n-1: the cell at the
 * SMALLEST world x — col 0 (world x = distance) — is the one the +x-travelling
 * projectile meets first, and higher cols sit behind it. Each cell's HP is
 * supplied so the test can dial penetration.
 */
function defenderColumn(distance: number, cellHp: number[]): CombatShip {
  const modules: ResolvedModule[] = cellHp.map((hp, i) =>
    moduleOf(`cell${i}`, { kind: "hull" }, i, 0, hp, 5, i === 0),
  );
  return {
    instanceId: "d1",
    designId: "d-d1",
    faction: "test",
    side: "defender",
    stats: stats(),
    position: { x: distance, y: 0 },
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
    seed: 3,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

interface FModule {
  slotId: string;
  hp: number;
  alive: boolean;
}
interface FShip {
  instanceId: string;
  cells?: FModule[];
}

/** The recorded HP of a cell on the defender at a given frame, or undefined. */
function cellHp(frame: { ships: FShip[] }, slotId: string): number | undefined {
  const d = frame.ships.find((s) => s.instanceId === "d1");
  return d?.cells?.find((m) => m.slotId === slotId)?.hp;
}

/** The first frame in which the named cell's HP has dropped below its max. */
function firstDamageFrame(
  frames: { ships: FShip[] }[],
  slotId: string,
  maxHp: number,
): number {
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f === undefined) continue;
    const hp = cellHp(f, slotId);
    if (hp !== undefined && hp < maxHp) return i;
  }
  return -1;
}

describe("engine.cellhit — frontmost cell", () => {
  it("a projectile strikes the frontmost cell on its path, not a cell behind it", () => {
    // Defender column: front cell (col 0) with plenty of HP, back cell (col 1)
    // behind it. A single 20-damage round can't get through the front cell, so
    // only the front cell loses HP — the back cell is shadowed.
    const result = runBattle(
      inputs([shooter(cannon({ damage: 20, cooldown: 1000 })), defenderColumn(DEFENDER_DISTANCE, [100, 100])]),
    );
    const frontHit = firstDamageFrame(result.frames, "cell0", 100);
    expect(frontHit, "the front cell must take the hit").toBeGreaterThan(0);
    const last = result.frames.at(-1);
    if (last === undefined) throw new Error("no frames");
    // The front cell lost HP; the back cell behind it is untouched.
    expect(cellHp(last, "cell0") ?? 100, "front cell damaged").toBeLessThan(100);
    expect(cellHp(last, "cell1") ?? 0, "back cell shadowed by the front").toBe(100);
  });
});

describe("engine.cellhit — penetration", () => {
  it("overflow past a destroyed front cell carries to the cell behind", () => {
    // Front cell has only 5 HP; a 20-damage round destroys it (overflow 15)
    // and the remaining 15 must carry to the cell directly behind it. We
    // inspect the first frame the rear cell is touched: by then the single
    // penetrating round has destroyed the front and spilled exactly 15 into
    // the rear, so it sits at 100 - 15 = 85. (Later rounds, once the front
    // is gone, would chew further into the rear, so we read the moment of
    // first penetration, not the end of the battle.)
    const result = runBattle(
      inputs([shooter(cannon({ damage: 20, cooldown: 1 })), defenderColumn(DEFENDER_DISTANCE, [5, 100])]),
    );
    const penetrationIdx = firstDamageFrame(result.frames, "cell1", 100);
    expect(penetrationIdx, "the rear cell must eventually be penetrated").toBeGreaterThan(0);
    const f = result.frames[penetrationIdx];
    if (f === undefined) throw new Error("no penetration frame");
    // Front cell destroyed by the round that penetrated.
    expect(cellHp(f, "cell0") ?? 1, "front cell destroyed before overflow").toBe(0);
    // The cell behind took exactly the 15 overflow on this first penetration.
    expect(cellHp(f, "cell1") ?? 100, "overflow penetrated to the cell behind").toBeCloseTo(
      85,
      5,
    );
  });

  it("the front cell is destroyed before the cell behind takes any damage", () => {
    // Ordering check: across frames, the front cell must reach zero HP no later
    // than the first frame the back cell is touched — penetration is in path
    // order, never reaching the rear before the front is gone.
    const result = runBattle(
      inputs([shooter(cannon({ damage: 8, cooldown: 1 })), defenderColumn(DEFENDER_DISTANCE, [10, 100])]),
    );
    const frontGone = (() => {
      for (let i = 0; i < result.frames.length; i++) {
        const f = result.frames[i];
        if (f === undefined) continue;
        if ((cellHp(f, "cell0") ?? 10) <= 0) return i;
      }
      return Infinity;
    })();
    const backTouched = firstDamageFrame(result.frames, "cell1", 100);
    expect(frontGone, "front cell must be destroyed at some point").toBeLessThan(Infinity);
    if (backTouched >= 0) {
      expect(
        frontGone,
        "the rear cell must not be damaged before the front is destroyed",
      ).toBeLessThanOrEqual(backTouched);
    }
  });
});
