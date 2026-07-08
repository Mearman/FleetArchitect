import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { advanceCrew } from "@/domain/simulation/engine/crew";
import { cellNum } from "@/domain/simulation/engine/crew-pathfinding";
import type { SimCrew } from "@/domain/simulation/types";
import type { SimModule } from "@/domain/simulation/engine/types";

/**
 * Crew door traversal: `advanceCrew` must OPEN a sealed bulkhead and cross it
 * (at a one-tick cost), not bounce off it forever. The old code `abandonHaul`'d
 * on a closed door and could never reopen one, so any reassignment across a
 * sealed bulkhead trapped the crew member and left the destination weapon
 * permanently unmanned — why the Reaver shipped open-plan. These tests pin the
 * fix: a crew member facing a closed door opens it (both sides) and holds for
 * one tick, then crosses.
 */

/** A minimal deck SimModule at (col, row) with the given edges. */
function cell(slotId: string, col: number, row: number, edges: CellEdges): SimModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: "hull",
    col,
    row,
    x: col,
    y: row,
    surface: "deck",
    edges,
    surfaceHp: 100,
    maxSurfaceHp: 100,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    reactiveHp: 0,
    maxReactiveHp: 0,
    hp: 100,
    maxHp: 100,
    mass: 1,
    powerDraw: 0,
    effect: { kind: "hull" },
    cooldown: 0,
    ammo: 0,
    ammoStored: 0,
    charge: 0,
    alive: true,
    powered: true,
    powerCut: false,
    fuelStarved: false,
    manned: false,
    crewRequired: 0,
    command: false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    turretAngle: 0,
    channel: 0,
    commsBearing: 0,
    dishAngle: 0,
    sensorBearing: 0,
    techCooldown: 0,
    techActive: 0,
    reactiveCharge: 0,
    mineCooldown: 0,
    boardingCooldown: 0,
    exploded: false,
  };
}

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

describe("advanceCrew — door traversal", () => {
  it("opens a closed door (both sides) and holds for one tick, then crosses", () => {
    // Two cells with a sealed door between them: A(0,0).east = door (closed),
    // B(1,0).west = door (closed). Crew at A, pathed to B.
    const a = cell("cell-0-0", 0, 0, {
      ...OPEN,
      e: "door",
      doorStates: { e: "closed" },
    });
    const b = cell("cell-1-0", 1, 0, {
      ...OPEN,
      w: "door",
      doorStates: { w: "closed" },
    });
    const cells = new Map<number, SimModule>([
      [cellNum(0, 0), a],
      [cellNum(1, 0), b],
    ]);
    const crew: SimCrew = {
      id: "c1",
      col: 0,
      row: 0,
      ox: 0,
      oy: 0,
      hp: 100,
      job: "manning",
      path: [{ col: 1, row: 0 }],
      pathIndex: 0,
      moveAccumulator: 0,
    };

    // Tick 1: the door was closed → reopen both sides, hold position.
    advanceCrew(crew, cells, 1);
    expect(a.edges.doorStates.e).toBe("open");
    expect(b.edges.doorStates.w).toBe("open");
    expect(crew.col).toBe(0);
    expect(crew.pathIndex).toBe(0);

    // Tick 2: door now open → cross to B.
    advanceCrew(crew, cells, 1);
    expect(crew.col).toBe(1);
    expect(crew.row).toBe(0);
    expect(crew.pathIndex).toBe(1);
  });

  it("crosses an already-open door with no latency", () => {
    const a = cell("cell-0-0", 0, 0, { ...OPEN, e: "door", doorStates: { e: "open" } });
    const b = cell("cell-1-0", 1, 0, { ...OPEN, w: "door", doorStates: { w: "open" } });
    const cells = new Map<number, SimModule>([
      [cellNum(0, 0), a],
      [cellNum(1, 0), b],
    ]);
    const crew: SimCrew = {
      id: "c1",
      col: 0,
      row: 0,
      ox: 0,
      oy: 0,
      hp: 100,
      job: "manning",
      path: [{ col: 1, row: 0 }],
      pathIndex: 0,
      moveAccumulator: 0,
    };

    advanceCrew(crew, cells, 1);
    expect(crew.col).toBe(1);
    expect(crew.pathIndex).toBe(1);
  });
});
