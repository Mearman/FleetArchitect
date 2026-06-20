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
  return { cols, rows: rows.length, cells, connections: [], shape: { outlineMode: "hexadecilinear" } };
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
});
