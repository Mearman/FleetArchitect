import { describe, expect, it } from "vitest";
import { TileGrid } from "@/schema/grid";
import type { GridCell } from "@/schema/grid";
import { growArmourHull, padGrid } from "@/domain/hull-armour";

/**
 * Contract for the octilinear armour grow. Only ARMOUR seeds growth — the hull
 * adds armour on the four orthogonal sides of existing armour but leaves
 * diagonal corners empty (the cut-corner silhouette), grows nothing for a
 * deck-only ship, never armours an enclosed interior hole, never mutates its
 * input, and is deterministic. `padGrid` grows the canvas on every side so a
 * flush-to-border ship gains room to grow.
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
  it("armours the four orthogonal sides of a centred block, leaving diagonal corners empty", () => {
    // 3x3 deck block centred in a 5x5 grid (1-cell empty border).
    const grid = gridFromAscii([
      ".....",
      ".###.",
      ".###.",
      ".###.",
      ".....",
    ]);
    const out = growArmourHull(grid);

    // The 12 orthogonal side cells gain armour: the cells of the border ring
    // directly N/E/S/W of the block.
    const sides: ReadonlyArray<readonly [number, number]> = [
      // top row (row 0), above the three block columns 1..3
      [1, 0],
      [2, 0],
      [3, 0],
      // bottom row (row 4)
      [1, 4],
      [2, 4],
      [3, 4],
      // left column (col 0), beside block rows 1..3
      [0, 1],
      [0, 2],
      [0, 3],
      // right column (col 4)
      [4, 1],
      [4, 2],
      [4, 3],
    ];
    for (const [c, r] of sides) {
      expect(isArmour(at(out, c, r))).toBe(true);
    }

    // The four diagonal corner cells of the border stay empty.
    const corners: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [4, 0],
      [0, 4],
      [4, 4],
    ];
    for (const [c, r] of corners) {
      expect(isEmpty(at(out, c, r))).toBe(true);
    }

    // 9 armour seed cells (the 3x3 block) + 12 grown side cells = 21.
    const armourCount = out.cells.filter((cell) => isArmour(cell)).length;
    expect(armourCount).toBe(21);
  });

  it("armour cells are solid armour with all edges walled", () => {
    const grid = gridFromAscii([
      "...",
      ".#.",
      "...",
    ]);
    const out = growArmourHull(grid);
    const top = at(out, 1, 0);
    expect(top).toBeDefined();
    if (top === undefined || top.kind !== "solid") {
      throw new Error("expected a solid armour cell");
    }
    expect(top.surface).toBe("armor");
    expect(top.edges.n).toBe("wall");
    expect(top.edges.e).toBe("wall");
    expect(top.edges.s).toBe("wall");
    expect(top.edges.w).toBe("wall");
    expect(top.edges.doorStates).toEqual({});
  });

  it("grows no armour for a deck-only ship (armour is not grown for deck tiles)", () => {
    // A solid deck block with an empty border: deck does not seed growth, so the
    // grid is returned unchanged with zero armour added.
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

  it("grows armour around armour even when deck sits between (deck never seeds)", () => {
    // Armour on the left, deck on the right: only the armour's exposed sides
    // gain a shell; the deck's exposed sides do not.
    const grid = gridFromAscii([
      ".....",
      ".#dd.",
      ".....",
    ]);
    const out = growArmourHull(grid);
    // Armour at (1,1): N/S/W neighbours gain armour (E is the deck).
    expect(isArmour(at(out, 1, 0))).toBe(true); // N of armour
    expect(isArmour(at(out, 1, 2))).toBe(true); // S of armour
    expect(isArmour(at(out, 0, 1))).toBe(true); // W of armour
    // The deck's own exposed sides stay empty.
    expect(isEmpty(at(out, 3, 0))).toBe(true); // N of a deck cell
    expect(isEmpty(at(out, 3, 2))).toBe(true); // S of a deck cell
    expect(isEmpty(at(out, 4, 1))).toBe(true); // E of the rightmost deck
  });

  it("never armours an enclosed interior hole", () => {
    // A ring of deck cells enclosing one empty cell at the centre (2,2).
    const grid = gridFromAscii([
      ".....",
      ".###.",
      ".#.#.",
      ".###.",
      ".....",
    ]);
    const out = growArmourHull(grid);
    // The enclosed empty cell is interior: it must stay empty.
    expect(isEmpty(at(out, 2, 2))).toBe(true);
  });

  it("does not mutate its input", () => {
    const grid = gridFromAscii([
      ".....",
      ".###.",
      ".###.",
      ".###.",
      ".....",
    ]);
    const before = structuredClone(grid);
    growArmourHull(grid);
    expect(grid).toEqual(before);
  });

  it("is deterministic across calls", () => {
    const grid = gridFromAscii([
      ".....",
      ".###.",
      ".###.",
      ".###.",
      ".....",
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

  it("a ship flush to the original border gets armour on that side after padGrid + grow", () => {
    // A single armour cell occupying the whole 1x1 grid: flush to every border,
    // so growArmourHull alone has no room to armour.
    const tight: TileGrid = TileGrid.parse({
      cols: 1,
      rows: 1,
      cells: [armour()],
      connections: [],
    });
    expect(growArmourHull(tight).cells.filter((c) => isArmour(c)).length).toBe(1); // only itself

    // After padding by one, the armour sits at (1,1) of a 3x3 grid and grows a
    // shell on all four orthogonal sides.
    const padded = padGrid(tight, 1);
    const out = growArmourHull(padded);
    expect(isArmour(at(out, 1, 0))).toBe(true); // N
    expect(isArmour(at(out, 2, 1))).toBe(true); // E
    expect(isArmour(at(out, 1, 2))).toBe(true); // S
    expect(isArmour(at(out, 0, 1))).toBe(true); // W
    // Diagonal corners stay empty.
    expect(isEmpty(at(out, 0, 0))).toBe(true);
    expect(isEmpty(at(out, 2, 2))).toBe(true);
  });
});
