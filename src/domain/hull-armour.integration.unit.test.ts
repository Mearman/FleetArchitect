/**
 * Integration tests: verify that growArmourHull + padGrid are wired into
 * analyseShipDesign so that auto-derived chamfer cells contribute mass and HP
 * without being present in the saved design.
 */
import { describe, expect, it } from "vitest";
import { catalog } from "@/data/catalog";
import { analyseShipDesign } from "@/domain/stats";
import { createId, nowIso } from "@/domain/id";
import type { CellEdges, GridCell, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/** All-wall edges: an armour plate is sealed on every side. */
const WALL: CellEdges = { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} };

/** Parse an ASCII armour map (3x3): `#` armour, `.` empty. */
function fromAscii(rows: readonly string[]): TileGrid {
  const r0 = rows[0];
  if (r0 === undefined) throw new Error("empty map");
  const cols = r0.length;
  const cells: GridCell[] = [];
  for (const row of rows) {
    if (row.length !== cols) throw new Error("ragged map");
    for (const ch of row) {
      cells.push(ch === "#" ? { kind: "solid", substrate: true, surface: "armor", edges: WALL } : { kind: "empty" });
    }
  }
  return { cols, rows: rows.length, cells, connections: [] };
}

/** A user-sourced design wrapping a raw grid (no command module; stats still compute). */
function designOf(grid: TileGrid, name: string): ShipDesign {
  return {
    id: createId("design"),
    name,
    faction: "Terran",
    grid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    doctrine: { base: {}, rules: [] },
  };
}

describe("hull-armour integration: analyseShipDesign includes grown chamfer cells", () => {
  it("a 3-armour L (chamfer fires) reaches the same structure and mass as a 4-armour block", () => {
    // The L is three armour cells of a 2x2; its missing diagonal chamfers under
    // growArmourHull, completing the 2x2. So the L's grown grid is identical to a
    // pre-authored 2x2 armour block — same structure, same mass. If growth were
    // not wired into analyseShipDesign, the L (3 cells) would fall short of the
    // block (4 cells).
    const lShape = analyseShipDesign(designOf(fromAscii(["##.", "#..", "..."]), "L"), catalog()).stats;
    const block = analyseShipDesign(designOf(fromAscii(["##.", "##.", "..."]), "block"), catalog()).stats;
    expect(lShape.structure).toBe(block.structure);
    expect(lShape.mass).toBe(block.mass);
  });

  it("is deterministic: two calls on the same design return identical structure", () => {
    const design = designOf(fromAscii(["##.", "#..", "..."]), "L");
    const { stats: a } = analyseShipDesign(design, catalog());
    const { stats: b } = analyseShipDesign(design, catalog());
    expect(a.structure).toBe(b.structure);
    expect(a.mass).toBe(b.mass);
  });
});
