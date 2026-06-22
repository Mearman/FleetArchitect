import { describe, expect, it } from "vitest";
import { computeOutline, extractShell } from "./outline";
import type { CellEdges, GridCell, TileGrid } from "@/schema/grid";

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

/** Build a grid from an ASCII map of surface letters: '.' = empty, 'a' = armor,
 *  'd' = deck, 'b' = bare. */
function gridFrom(rows: readonly string[]): TileGrid {
  const firstRow = rows[0];
  if (firstRow === undefined) throw new Error("grid has no rows");
  const cols = firstRow.length;
  const cells: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      if (ch === ".") {
        cells.push({ kind: "empty" });
      } else {
        const surface = ch === "a" ? "armor" : ch === "d" ? "deck" : "bare";
        cells.push({ kind: "solid", scaffold: true, surface, edges: OPEN });
      }
    }
  }
  return { cols, rows: rows.length, cells, connections: [], shape: { outlineMode: "octilinear" } };
}

describe("outline.extractShell (layered)", () => {
  it("includes the whole contiguous solid region, not just armour", () => {
    // 3x3: armour ring around an open deck core. The hull is the whole region —
    // the deck core is interior (walls auto-form around contiguous decks), not a
    // hole — so every solid cell, including the centre deck, is in the shell.
    const g = gridFrom(["aaa", "ada", "aaa"]);
    const shell = extractShell(g);
    expect(shell.cols).toBe(3);
    expect(shell.rows).toBe(3);
    expect(shell.cells.size).toBe(9); // all 9 solid cells
    expect(shell.cells.has(4)).toBe(true); // centre deck is interior, included
    expect(shell.cells.has(0)).toBe(true); // corner armour included
  });

  it("includes fully-open deck cells (the outer skin is the hull)", () => {
    // Two open deck cells with no wall edges at all: both are still hull, because
    // the ship's outer skin is itself a wall. The old armour/wall-only extractor
    // would have dropped these.
    const open: GridCell = {
      kind: "solid",
      scaffold: true,
      surface: "deck",
      edges: OPEN,
    };
    const grid: TileGrid = {
      cols: 2,
      rows: 1,
      cells: [open, { ...open }],
      connections: [],
      shape: { outlineMode: "octilinear" },
    };
    const shell = extractShell(grid);
    expect(shell.cells.size).toBe(2);
  });

  it("excludes empty cells, leaving an interior cavity as a hole", () => {
    // A ring of deck with a genuine empty centre: the empty cell is excluded, so
    // computeOutline traces it as a separate hole loop.
    const g = gridFrom(["ddd", "d.d", "ddd"]);
    const shell = extractShell(g);
    expect(shell.cells.size).toBe(8); // 8 solid, centre empty
    expect(shell.cells.has(4)).toBe(false);
    expect(computeOutline(shell, { outlineMode: "octilinear" }).length).toBe(2);
  });

  it("computeOutline produces a closed loop around the hull", () => {
    const g = gridFrom(["dd", "dd"]);
    const shell = extractShell(g);
    const loops = computeOutline(shell, { outlineMode: "octilinear" });
    expect(loops.length).toBeGreaterThanOrEqual(1);
    const firstLoop = loops[0];
    expect(firstLoop, "at least one outline loop is produced").toBeDefined();
    expect(firstLoop!.length).toBeGreaterThanOrEqual(4); // a closed polygon
  });

  it("is deterministic", () => {
    const g = gridFrom(["aaa", "ada", "aaa"]);
    expect(extractShell(g)).toEqual(extractShell(g));
  });
});
