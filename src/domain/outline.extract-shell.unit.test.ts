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
  it("picks out exactly the armor cells as the shell", () => {
    // 3x3: armor ring around a deck core.
    const g = gridFrom(["aaa", "ada", "aaa"]);
    const shell = extractShell(g);
    expect(shell.cols).toBe(3);
    expect(shell.rows).toBe(3);
    expect(shell.cells.size).toBe(8); // 8 armor, 1 deck
    expect(shell.cells.has(4)).toBe(false); // center (row 1, col 1) is deck
    expect(shell.cells.has(0)).toBe(true); // corners are armor
  });

  it("computeOutline produces a closed loop around the armor shell", () => {
    const g = gridFrom(["aa", "aa"]);
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

  it("includes wall/door-edged hull cells, not just armour", () => {
    // A 2x1 of deck cells: the left cell carries a wall on its west edge (it is
    // part of the airtight hull), the right cell is fully open (interior). The
    // shell is the protective boundary — armour OR any wall/door edge — so the
    // walled cell joins it while the open one does not. This is the case the
    // armour-only extractor missed: a hull defined by wall edges rather than
    // armour plating.
    const walled: GridCell = {
      kind: "solid",
      scaffold: true,
      surface: "deck",
      edges: { n: "open", e: "open", s: "open", w: "wall", doorStates: {} },
    };
    const open: GridCell = {
      kind: "solid",
      scaffold: true,
      surface: "deck",
      edges: OPEN,
    };
    const grid: TileGrid = {
      cols: 2,
      rows: 1,
      cells: [walled, open],
      connections: [],
      shape: { outlineMode: "octilinear" },
    };
    const shell = extractShell(grid);
    expect(shell.cells.has(0)).toBe(true); // walled hull cell is shell
    expect(shell.cells.has(1)).toBe(false); // fully-open interior cell is not
  });

  it("treats a door edge as part of the hull", () => {
    const doored: GridCell = {
      kind: "solid",
      scaffold: true,
      surface: "deck",
      edges: { n: "door", e: "open", s: "open", w: "open", doorStates: { n: "closed" } },
    };
    const grid: TileGrid = {
      cols: 1,
      rows: 1,
      cells: [doored],
      connections: [],
      shape: { outlineMode: "octilinear" },
    };
    expect(extractShell(grid).cells.has(0)).toBe(true);
  });
});
