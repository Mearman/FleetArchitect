import { describe, expect, it } from "vitest";
import { TileGrid } from "@/schema/grid";
import type { GridCell } from "@/schema/grid";
import { growArmourHull, padGrid } from "@/domain/hull-armour";

/**
 * Contract for the chamfer-only armour grow. Growth adds NO orthogonal ring —
 * armour is exactly what the designer placed. The only cells growth adds are
 * chamfer fills: the missing diagonal of a 2x2 block whose other three cells
 * are armour, which lets the render-time bevel cut a clean facet at an armour
 * corner instead of leaving a gaping notch. A solid armour block (or a lone
 * armour cell) has no such 3-of-4 corner, so it grows nothing. Deck never
 * seeds (only armour does), an enclosed interior hole is never filled, the
 * input is never mutated, and the result is deterministic. `padGrid` grows the
 * canvas on every side so a flush-to-border armour corner gains room for its
 * chamfer.
 */

const EMPTY: GridCell = { kind: "empty" };

/** A fresh armour cell, all edges walled (the growth seed). */
function armour(): GridCell {
  return {
    kind: "solid",
    substrate: true,
    surface: "armor",
    edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} },
  };
}

/** A fresh deck cell, all edges open (interior plating; does NOT seed growth). */
function deck(): GridCell {
  return {
    kind: "solid",
    substrate: true,
    surface: "deck",
    edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} },
  };
}

/** Parse a grid from an ASCII map: `#` is armour (the growth seed), `d` is deck,
 *  `.` is empty. The parse enforces the schema refine (cell count, in-bounds
 *  connections). */
function gridFromAscii(rows: readonly string[]): TileGrid {
  const r0 = rows[0];
  if (r0 === undefined) throw new Error("empty map");
  const cols = r0.length;
  const cells: GridCell[] = [];
  for (const row of rows) {
    if (row.length !== cols) throw new Error("ragged map");
    for (const ch of row) cells.push(ch === "#" ? armour() : ch === "d" ? deck() : EMPTY);
  }
  return TileGrid.parse({ cols, rows: rows.length, cells, connections: [] });
}

/** Index helper for a (col, row) lookup. */
function at(grid: TileGrid, col: number, row: number): GridCell | undefined {
  return grid.cells[row * grid.cols + col];
}

function isArmour(cell: GridCell | undefined): boolean {
  return cell !== undefined && cell.kind === "solid" && cell.surface === "armor";
}

function isEmpty(cell: GridCell | undefined): boolean {
  return cell !== undefined && cell.kind === "empty";
}

describe("growArmourHull", () => {
  it("adds no orthogonal ring: a solid armour block grows nothing", () => {
    // 3x3 armour block centred in a 5x5 grid (1-cell empty border). It has no
    // 3-of-4 corner — every 2x2 inside it is full, every 2x2 outside it touches
    // only one armour cell — so chamfer-only growth leaves it exactly as authored.
    const grid = gridFromAscii([
      ".....",
      ".###.",
      ".###.",
      ".###.",
      ".....",
    ]);
    const out = growArmourHull(grid);

    // Every border cell (the old ring + corner positions) stays empty.
    const border: ReadonlyArray<readonly [number, number]> = [
      [1, 0], [2, 0], [3, 0], [1, 4], [2, 4], [3, 4],
      [0, 1], [0, 2], [0, 3], [4, 1], [4, 2], [4, 3],
      [0, 0], [4, 0], [0, 4], [4, 4],
    ];
    for (const [c, r] of border) {
      expect(isEmpty(at(out, c, r))).toBe(true);
    }
    expect(out.cells.filter((cell) => isArmour(cell)).length).toBe(9);
  });

  it("chamfers a 3-of-4 armour corner (the missing diagonal of a 2x2)", () => {
    // An L of three armour cells in a 2x2; the missing cell (1,1) is exterior
    // (it reaches the border through the empty (2,1)/(1,2)) so its diagonal
    // chamfer fires and it becomes armour.
    const grid = gridFromAscii([
      "##.",
      "#..",
      "...",
    ]);
    const out = growArmourHull(grid);
    expect(isArmour(at(out, 1, 1))).toBe(true);
    // No cascade: the fill creates no new 3-of-4 corner further out.
    expect(isEmpty(at(out, 2, 2))).toBe(true);
    expect(out.cells.filter((cell) => isArmour(cell)).length).toBe(4);
  });

  it("grown chamfer cells are solid armour with all edges walled", () => {
    const grid = gridFromAscii([
      "##.",
      "#..",
      "...",
    ]);
    const out = growArmourHull(grid);
    const chamfer = at(out, 1, 1);
    expect(chamfer).toBeDefined();
    if (chamfer === undefined || chamfer.kind !== "solid") {
      throw new Error("expected a solid armour cell");
    }
    expect(chamfer.surface).toBe("armor");
    expect(chamfer.edges.n).toBe("wall");
    expect(chamfer.edges.e).toBe("wall");
    expect(chamfer.edges.s).toBe("wall");
    expect(chamfer.edges.w).toBe("wall");
    expect(chamfer.edges.doorStates).toEqual({});
  });

  it("grows no armour for a deck-only ship (deck does not seed)", () => {
    const grid = gridFromAscii([
      ".....",
      ".ddd.",
      ".ddd.",
      ".ddd.",
      ".....",
    ]);
    const out = growArmourHull(grid);
    expect(out.cells.filter((cell) => isArmour(cell)).length).toBe(0);
    expect(out).toEqual(grid);
  });

  it("deck does not seed a chamfer where armour would be needed", () => {
    // Were the deck at (1,0) armour, the empty (1,1) would be a 3-of-4 corner and
    // chamfer. Deck is not armour, so the corner is only 2-of-4 — no chamfer.
    const grid = gridFromAscii([
      "#d.",
      "#..",
      "...",
    ]);
    const out = growArmourHull(grid);
    expect(isEmpty(at(out, 1, 1))).toBe(true);
    expect(out.cells.filter((cell) => isArmour(cell)).length).toBe(2);
  });

  it("never chamfers an enclosed interior hole", () => {
    // A ring of armour enclosing one empty cell at the centre (2,2). The hole
    // is interior (unreachable from the border), so it stays empty even though
    // its 2x2 corners read 3-of-4 armour.
    const grid = gridFromAscii([
      ".....",
      ".###.",
      ".#.#.",
      ".###.",
      ".....",
    ]);
    const out = growArmourHull(grid);
    expect(isEmpty(at(out, 2, 2))).toBe(true);
  });

  it("does not mutate its input", () => {
    const grid = gridFromAscii([
      "##.",
      "#..",
      "...",
    ]);
    const before = structuredClone(grid);
    growArmourHull(grid);
    expect(grid).toEqual(before);
  });

  it("is deterministic across calls", () => {
    const grid = gridFromAscii([
      "##.",
      "#..",
      "...",
    ]);
    const a = growArmourHull(grid);
    const b = growArmourHull(grid);
    expect(a).toEqual(b);
  });
});

describe("padGrid", () => {
  it("grows the dims by 2*pad and offsets a known cell and connection", () => {
    // A 2x2 grid with a deck at (1,0) and a connection (0,0)->(1,1).
    const grid: TileGrid = TileGrid.parse({
      cols: 2,
      rows: 2,
      cells: [EMPTY, deck(), EMPTY, EMPTY],
      connections: [
        { from: { col: 0, row: 0 }, to: { col: 1, row: 1 }, resource: "power" },
      ],
    });
    const pad = 2;
    const out = padGrid(grid, pad);
    expect(out.cols).toBe(2 + 2 * pad);
    expect(out.rows).toBe(2 + 2 * pad);

    // The deck cell moved from (1,0) to (1+pad, 0+pad).
    expect(at(out, 1 + pad, 0 + pad)?.kind).toBe("solid");
    // Its old location is now empty.
    expect(isEmpty(at(out, 1, 0))).toBe(true);

    // No cell content was lost: exactly one solid cell remains.
    const solidCount = out.cells.filter((c) => c.kind === "solid").length;
    expect(solidCount).toBe(1);

    // The connection endpoints are offset by +pad.
    const cn = out.connections[0];
    expect(cn).toBeDefined();
    if (cn === undefined) throw new Error("connection lost");
    expect(cn.from).toEqual({ col: 0 + pad, row: 0 + pad });
    expect(cn.to).toEqual({ col: 1 + pad, row: 1 + pad });
    expect(cn.resource).toBe("power");

    // The padded grid still satisfies the schema refine.
    expect(() => TileGrid.parse(out)).not.toThrow();
  });

  it("padGrid + growArmourHull chamfers an L's missing corner", () => {
    // The caller pattern (resolve/stats): pad by one, then chamfer-grow. The L's
    // missing diagonal chamfers, so the grown grid carries one more armour cell
    // than the authored L.
    const l: TileGrid = gridFromAscii([
      "##.",
      "#..",
      "...",
    ]);
    const out = growArmourHull(padGrid(l, 1));
    // After the +1 pad the L sits at (1,1)-(2,2); its missing corner (2,2) chamfers.
    expect(isArmour(at(out, 2, 2))).toBe(true);
    expect(out.cells.filter((c) => isArmour(c)).length).toBe(4);
  });

  it("fills a diagonal gap between two armour cells at an inner corner", () => {
    // Two armour cells diagonally adjacent (sharing a corner), with an exterior
    // empty cell that is orthogonally adjacent to both. The gap fill adds armour
    // there so the band reads solid.
    //
    //   . # .
    //   # . .     →  the gap at (1,1) is adjacent to #@(2,0) [E] and #@(1,2) [S];
    //   . # .        those are diagonally adjacent → fill.
    const diag: TileGrid = gridFromAscii([
      ".#.",
      "#..",
      ".#.",
    ]);
    const out = growArmourHull(padGrid(diag, 1));
    // After +1 pad: # cells at (2,1),(1,2),(2,3). The gap at (2,2) is adjacent
    // to #@(2,1) [N] and #@(1,2) [W] — diagonally adjacent → filled.
    expect(isArmour(at(out, 2, 2))).toBe(true);
  });
});
