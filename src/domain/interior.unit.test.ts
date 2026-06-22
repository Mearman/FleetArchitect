import { describe, expect, it } from "vitest";
import { computeCompartments } from "@/domain/interior";
import type { CellEdges, TileGrid } from "@/schema/grid";

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };
const WALL: CellEdges = { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} };

function deck(edges: CellEdges = OPEN): GridCell {
  return { kind: "solid", substrate: true, surface: "deck", edges };
}
function armor(): GridCell {
  return { kind: "solid", substrate: true, surface: "armor", edges: WALL };
}

import type { GridCell } from "@/schema/grid";

function grid(rows: GridCell[][]): TileGrid {
  const r = rows.length;
  const c = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  for (const row of rows) {
    if (row.length !== c) throw new Error("ragged grid");
    for (const cell of row) cells.push(cell);
  }
  return { cols: c, rows: r, cells, connections: [] };
}

describe("computeCompartments", () => {
  it("returns no compartments for an all-armor grid", () => {
    const g = grid([[armor(), armor()], [armor(), armor()]]);
    expect(computeCompartments(g)).toHaveLength(0);
  });

  it("returns a single airtight compartment for a sealed box of deck cells", () => {
    // 2×2 deck region surrounded by armor on all sides — fully sealed.
    const g = grid([
      [armor(), armor(), armor(), armor()],
      [armor(), deck(), deck(), armor()],
      [armor(), deck(), deck(), armor()],
      [armor(), armor(), armor(), armor()],
    ]);
    const comps = computeCompartments(g);
    expect(comps).toHaveLength(1);
    expect(comps[0]?.airtight).toBe(true);
    expect(comps[0]?.cells.size).toBe(4);
  });

  it("returns a single breached compartment when a perimeter edge is open", () => {
    // Same sealed box but the central deck's north edge is open to an empty
    // (out-of-compartment) neighbour above — breached.
    const leakyDeck: CellEdges = { ...OPEN, n: "open" };
    const g = grid([
      [armor(), deck(leakyDeck), armor(), armor()],
      [armor(), deck(), deck(), armor()],
      [armor(), deck(), deck(), armor()],
      [armor(), armor(), armor(), armor()],
    ]);
    // The top-middle cell is deck; its north neighbour is row -1 (out of grid,
    // treated as outside). With edge 'open' to outside → breached.
    const comps = computeCompartments(g);
    expect(comps).toHaveLength(1);
    expect(comps[0]?.airtight).toBe(false);
  });

  it("partitions a deck region separated by an armor wall into two compartments", () => {
    // Two deck cells separated by an armor column → two compartments.
    const g = grid([
      [deck(), armor(), deck()],
    ]);
    const comps = computeCompartments(g);
    expect(comps).toHaveLength(2);
    expect(comps[0]?.cells.size).toBe(1);
    expect(comps[1]?.cells.size).toBe(1);
  });

  it("treats a closed door as sealing and an open door as connecting", () => {
    // Two deck cells sharing a door edge: when closed, two compartments, both
    // airtight (the closed door seals the perimeter). When open, one
    // compartment, and it is breached (the open door is on the perimeter to
    // an out-of-grid neighbour... actually the door connects the two cells,
    // so the perimeter is the outer edge of the pair).
    const closedEast: CellEdges = { ...OPEN, e: "door", doorStates: { e: "closed" } };
    const closedWest: CellEdges = { ...OPEN, w: "door", doorStates: { w: "closed" } };
    const closed = grid([
      [deck(closedEast), deck(closedWest)],
    ]);
    const closedComps = computeCompartments(closed);
    expect(closedComps).toHaveLength(2);
    // Both halves are sealed by the closed door on the shared edge AND the
    // surrounding open edges — wait, the outer edges are open. So both are
    // breached (open to out-of-grid). Adjust: a closed door on the shared
    // edge makes them two compartments, but each still has open outer edges.
    for (const c of closedComps) expect(c.airtight).toBe(false);

    const openEast: CellEdges = { ...OPEN, e: "door", doorStates: { e: "open" } };
    const openWest: CellEdges = { ...OPEN, w: "door", doorStates: { w: "open" } };
    const open = grid([
      [deck(openEast), deck(openWest)],
    ]);
    const openComps = computeCompartments(open);
    expect(openComps).toHaveLength(1);
    expect(openComps[0]?.airtight).toBe(false); // outer edges open
  });

  it("is deterministic: two calls on the same grid produce identical compartments", () => {
    const g = grid([
      [armor(), armor(), armor(), armor()],
      [armor(), deck(), deck(), armor()],
      [armor(), deck(), deck(), armor()],
      [armor(), armor(), armor(), armor()],
    ]);
    const a = computeCompartments(g);
    const b = computeCompartments(g);
    expect(a).toEqual(b);
  });

  it("returns an airtight compartment only when every perimeter edge is wall/closed/armor", () => {
    // A single deck cell with all four edges wall → airtight.
    const g = grid([[deck(WALL)]]);
    const comps = computeCompartments(g);
    expect(comps).toHaveLength(1);
    expect(comps[0]?.airtight).toBe(true);
  });
});
