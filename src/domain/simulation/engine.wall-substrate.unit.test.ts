import { describe, expect, it } from "vitest";
import { DOOR_STOPPING_J, WALL_STOPPING_J } from "@/data/catalog/combat-scale";
import { CELL_SIZE } from "@/domain/grid";
import { resolveChainReactions } from "@/domain/simulation/engine/chain-reaction";
import { applyDamage } from "@/domain/simulation/engine/damage";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { SimShip } from "@/domain/simulation/engine/types";
import { mulberry32 } from "@/domain/simulation/rng";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Wall-edge barriers and substrate damage tier (Phase ?).
 *
 * Three physics features:
 *  1. Surface tier mutation — `damageCell` marks `surface = "bare"` when a cell's
 *     surface layer is stripped so the renderer can show the exposed substrate.
 *  2. Wall-edge projectile stopping — a wall or closed-door edge between two
 *     consecutive path cells absorbs stopping energy before the round reaches the
 *     next cell.
 *  3. Wall-edge blast attenuation — within-ship blast damage is multiplied by
 *     the fraction of the blast wave that survives each wall/door edge crossed on
 *     the DDA path from the source to the target cell.
 */

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

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
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
    ...over,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxSubstrateHp: number,
  opts: {
    mass?: number;
    command?: boolean;
    surface?: "bare" | "deck" | "armor";
    maxSurfaceHp?: number;
    surfaceReduction?: number;
    edges?: CellEdges;
  } = {},
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    surface: opts.surface ?? "bare",
    edges: opts.edges ?? OPEN,
    maxSurfaceHp: opts.maxSurfaceHp ?? 0,
    maxSubstrateHp,
    surfaceReduction: opts.surfaceReduction ?? 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
    mass: opts.mass ?? 5,
    powerDraw: 0,
    crewRequired: 0,
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

function combatShip(
  id: string,
  side: "attacker" | "defender",
  modules: ResolvedModule[],
  over: Partial<CombatShip> = {},
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: stats(),
    position: { x: 0, y: 0 },
    facing: 0,
    classification: "frigate",
    modules,
    // The legacy orders here carried only `engageRange: "hold"` (over the
    // `defaultOrders` baseline); the rest of that baseline (balanced stance,
    // nearest targeting, combat crew, no retreat) collapses to an empty base.
    // The single non-default axis — hold range-keeping at the legacy default
    // band of 0.3 — is preserved as a `hold` spatial objective.
    doctrine: {
      base: {
        spatial: {
          reference: { kind: "target" },
          range: { kind: "hold", band: 0.3 },
          bearing: { kind: "free" },
        },
      },
      rules: [],
    },
    ...over,
  };
}

function buildSim(id: string, modules: ResolvedModule[]): SimShip {
  return toSimShip(combatShip(id, "defender", modules), mulberry32(1));
}

function findModule(ship: SimShip, slotId: string) {
  const m = ship.modules?.find((x) => x.slotId === slotId);
  if (m === undefined) throw new Error(`no module ${slotId}`);
  return m;
}

// ---------------------------------------------------------------------------
// Test 1 — Surface tier mutation
// ---------------------------------------------------------------------------

describe("engine.wall-substrate — surface tier mutation", () => {
  it("strips surface to 'bare' when surface HP is exhausted but substrate survives", () => {
    // One armour cell: surface HP 70, substrate HP 25. Hit with 80 damage
    // (no armour reduction so 80 lands). The surface absorbs 70 and is
    // exhausted; 10 spills into the substrate (substrate HP becomes 15).
    // The cell must still be alive with surface = "bare".
    const ship = buildSim("s1", [
      moduleOf(
        "c1",
        { kind: "hull" },
        0,
        0,
        25,        // substrate HP
        {
          command: true,
          surface: "armor",
          maxSurfaceHp: 70,
        },
      ),
    ]);
    const cell = findModule(ship, "c1");

    applyDamage(ship, 80, 0, 0, ship.x, ship.y, 0);

    expect(cell.alive).toBe(true);
    expect(cell.surface).toBe("bare");
    expect(cell.surfaceHp).toBe(0);
    // Substrate started at 25 and received 10 overflow → 15 remaining.
    expect(cell.hp).toBeCloseTo(15, 6);
  });

  it("does not set surface to 'bare' when the surface layer survives the hit", () => {
    const ship = buildSim("s2", [
      moduleOf(
        "c1",
        { kind: "hull" },
        0,
        0,
        100,
        { command: true, surface: "armor", maxSurfaceHp: 100 },
      ),
    ]);
    const cell = findModule(ship, "c1");

    applyDamage(ship, 50, 0, 0, ship.x, ship.y, 0);

    // Surface still intact: surface should remain "armor".
    expect(cell.alive).toBe(true);
    expect(cell.surface).toBe("armor");
    expect(cell.surfaceHp).toBeGreaterThan(0);
  });

  it("does not change surface to 'bare' on a deck cell when its surface HP is exhausted", () => {
    // Deck cells keep their 'deck' label even when their deck HP is exhausted,
    // so crew walkability and hull-outline geometry are preserved correctly.
    const ship = buildSim("s3", [
      moduleOf(
        "c1",
        { kind: "hull" },
        0,
        0,
        100,
        { command: true, surface: "deck", maxSurfaceHp: 20 },
      ),
    ]);
    const cell = findModule(ship, "c1");

    // Hit with 30: deck HP (20) is exhausted, 10 spills to substrate (100 − 10 = 90).
    applyDamage(ship, 30, 0, 0, ship.x, ship.y, 0);

    // Deck surface exhausted but cell still alive; surface stays "deck".
    expect(cell.alive).toBe(true);
    expect(cell.surface).toBe("deck");
    expect(cell.surfaceHp).toBe(0);
    expect(cell.hp).toBeCloseTo(90, 6);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Wall stops projectile
// ---------------------------------------------------------------------------

describe("engine.wall-substrate — wall-edge projectile stopping", () => {
  // The barrier stopping energies are now real joules (`WALL_STOPPING_J` ≈
  // 940 MJ, `DOOR_STOPPING_J` a third of it), so these fixtures are sized off the
  // constants rather than the pre-SI integers: a small front-cell HP so it dies,
  // and a spill chosen between the door and wall thresholds so a wall fully stops
  // the round while a door lets the excess through.
  const FRONT_HP = 1e8; // 100 MJ — the front cell's substrate pool
  // Spill past the front cell, chosen so DOOR_STOPPING_J < SPILL < WALL_STOPPING_J:
  // the wall absorbs all of it, a closed door absorbs only its share.
  const SPILL = (DOOR_STOPPING_J + WALL_STOPPING_J) / 2;
  const FRONT_DAMAGE = FRONT_HP + SPILL; // kills the front cell, leaving SPILL
  // A deep rear cell, comfortably larger than anything that could reach it.
  const REAR_HP = WALL_STOPPING_J;

  it("a wall edge between two path cells reduces penetrating energy before the next cell is struck", () => {
    // Cell A (col 0) has a wall on its east edge. Cell B (col 1) is behind it.
    // Fire FRONT_DAMAGE: A dies and SPILL spills. With SPILL < WALL_STOPPING_J the
    // wall absorbs the whole remainder, so B survives untouched.
    const wallEdges: CellEdges = {
      n: "open",
      e: "wall",
      s: "open",
      w: "open",
      doorStates: {},
    };
    const ship = buildSim("w1", [
      moduleOf("a", { kind: "hull" }, 0, 0, FRONT_HP, { command: true, edges: wallEdges }),
      moduleOf("b", { kind: "hull" }, 1, 0, REAR_HP),
    ]);
    const cellA = findModule(ship, "a");
    const cellB = findModule(ship, "b");
    const hpBBefore = cellB.hp;

    // Provide an explicit penetration path so the wall-stopping path is exercised.
    const path = [cellA, cellB];
    applyDamage(ship, FRONT_DAMAGE, 0, 0, 0, 0, undefined, path);

    // A should be dead (damage exceeds its HP).
    expect(cellA.alive).toBe(false);
    // B must be untouched: SPILL − WALL_STOPPING_J ≤ 0.
    expect(cellB.hp).toBe(hpBBefore);
    expect(cellB.alive).toBe(true);
  });

  it("a closed door edge reduces penetrating energy but less than a wall", () => {
    // Cell A has a closed door on its east edge. Fire FRONT_DAMAGE: A dies leaving
    // SPILL. A closed door absorbs only DOOR_STOPPING_J, so SPILL − DOOR_STOPPING_J
    // reaches B (which survives with REAR_HP minus that remainder).
    const doorEdges: CellEdges = {
      n: "open",
      e: "door",
      s: "open",
      w: "open",
      doorStates: { e: "closed" },
    };
    const ship = buildSim("d1", [
      moduleOf("a", { kind: "hull" }, 0, 0, FRONT_HP, { command: true, edges: doorEdges }),
      moduleOf("b", { kind: "hull" }, 1, 0, REAR_HP),
    ]);
    const cellA = findModule(ship, "a");
    const cellB = findModule(ship, "b");

    const path = [cellA, cellB];
    applyDamage(ship, FRONT_DAMAGE, 0, 0, 0, 0, undefined, path);

    expect(cellA.alive).toBe(false);
    // SPILL − DOOR_STOPPING_J reaches B; B survives with REAR_HP minus that.
    const reachedB = SPILL - DOOR_STOPPING_J;
    expect(cellB.alive).toBe(true);
    expect(cellB.hp).toBeCloseTo(REAR_HP - reachedB, 0);
  });

  it("an open door edge does not stop the round", () => {
    // An open door provides zero stopping energy — the round passes freely, so the
    // full SPILL reaches B.
    const openDoorEdges: CellEdges = {
      n: "open",
      e: "door",
      s: "open",
      w: "open",
      doorStates: { e: "open" },
    };
    const ship = buildSim("od1", [
      moduleOf("a", { kind: "hull" }, 0, 0, FRONT_HP, { command: true, edges: openDoorEdges }),
      moduleOf("b", { kind: "hull" }, 1, 0, REAR_HP),
    ]);
    const cellA = findModule(ship, "a");
    const cellB = findModule(ship, "b");

    const path = [cellA, cellB];
    applyDamage(ship, FRONT_DAMAGE, 0, 0, 0, 0, undefined, path);

    expect(cellA.alive).toBe(false);
    expect(cellB.alive).toBe(true);
    // The whole SPILL reaches B: REAR_HP − SPILL remaining.
    expect(cellB.hp).toBeCloseTo(REAR_HP - SPILL, 0);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Blast attenuation through wall
// ---------------------------------------------------------------------------

describe("engine.wall-substrate — blast attenuation through wall edges", () => {
  it("a wall edge between source and target attenuates blast damage by wallBlastAttenuation", () => {
    // Three cells in a row: A (col 0), B (col 1), C (col 2).
    // A has a wall on its east edge (between A and B).
    // Detonate A (a reactor). B should receive heavily attenuated damage (× 0.1),
    // while C's path crosses the same wall and also receives attenuated damage.
    // The key assertion: B's damage is roughly 10 % of what it would be without
    // the wall, compared to C which is further away.
    //
    // Without any wall, at CELL_SIZE distance from the blast, falloff = 0.5 and
    // damage = yield * 0.5. With a wall, damage = yield * 0.5 * 0.1 = yield * 0.05.
    const wallEdges: CellEdges = {
      n: "open",
      e: "wall",
      s: "open",
      w: "open",
      doorStates: {},
    };
    // Build unattenuated ship (no walls) for baseline comparison.
    const shipNoWall = buildSim("nw1", [
      moduleOf("a", { kind: "power", output: 200_000 }, 0, 0, 50, { command: true }),
      moduleOf("b", { kind: "hull" }, 1, 0, 10_000),
      moduleOf("c", { kind: "hull" }, 2, 0, 10_000),
    ]);
    const reactorNW = findModule(shipNoWall, "a");
    const bNW = findModule(shipNoWall, "b");

    reactorNW.hp = 0;
    reactorNW.alive = false;
    resolveChainReactions(shipNoWall, [shipNoWall]);
    const bDamageNoWall = bNW.maxHp - bNW.hp;

    // Build attenuated ship: wall between A and B.
    const shipWall = buildSim("wl1", [
      moduleOf("a", { kind: "power", output: 200_000 }, 0, 0, 50, {
        command: true,
        edges: wallEdges,
      }),
      moduleOf("b", { kind: "hull" }, 1, 0, 10_000),
      moduleOf("c", { kind: "hull" }, 2, 0, 10_000),
    ]);
    const reactorW = findModule(shipWall, "a");
    const bW = findModule(shipWall, "b");

    reactorW.hp = 0;
    reactorW.alive = false;
    resolveChainReactions(shipWall, [shipWall]);
    const bDamageWithWall = bW.maxHp - bW.hp;

    // Cell B behind the wall must take strictly less damage than without the wall.
    expect(bDamageWithWall).toBeGreaterThan(0);
    expect(bDamageWithWall).toBeLessThan(bDamageNoWall);
    // The attenuation is roughly SIM.wallBlastAttenuation = 0.1.
    expect(bDamageWithWall).toBeCloseTo(bDamageNoWall * 0.1, 4);
  });
});
