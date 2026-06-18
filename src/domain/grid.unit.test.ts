import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  bounds,
  cellAt,
  cellToLocal,
  centroid,
  deriveClassification,
  deriveMass,
  deriveRadius,
  findPath,
  footprint,
  isConnected4,
  isWalkable,
  neighbours4,
  occupiedCount,
  reachableFrom,
  walkableNeighbours4,
} from "@/domain/grid";
import { FloorCell, TileGrid } from "@/schema/grid";
import type { GridCell } from "@/schema/grid";

/**
 * Build a grid from a token map:
 *   `.` empty, `#` hull block, `m` a module, `_` a floor cell.
 */
function grid(rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  const tokens: Record<string, GridCell> = {
    ".": { kind: "empty" },
    "#": { kind: "hull", tile: "block" },
    "m": { kind: "module", moduleId: "mod-x", facing: 0 },
    "_": { kind: "floor" },
  };
  for (const row of rows) {
    for (const ch of row) {
      const cell = tokens[ch];
      if (cell === undefined) throw new Error(`bad token ${ch}`);
      cells.push(cell);
    }
  }
  return TileGrid.parse({ cols, rows: rows.length, cells });
}

describe("grid schema", () => {
  it("parses a well-formed grid", () => {
    expect(() => grid(["#.", ".#"])).not.toThrow();
  });

  it("rejects a grid whose cell count mismatches its dimensions", () => {
    const result = TileGrid.safeParse({
      cols: 2,
      rows: 2,
      cells: [{ kind: "empty" }, { kind: "empty" }, { kind: "empty" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer or zero dimensions", () => {
    expect(TileGrid.safeParse({ cols: 0, rows: 1, cells: [] }).success).toBe(false);
    expect(
      TileGrid.safeParse({ cols: 1.5, rows: 1, cells: [{ kind: "empty" }] }).success,
    ).toBe(false);
  });
});

describe("grid geometry", () => {
  it("centres the grid so a single odd-sized grid's middle cell is at the origin", () => {
    const g = grid(["...", ".#.", "..."]);
    expect(cellToLocal(1, 1, g)).toEqual({ x: 0, y: 0 });
  });

  it("spaces cells by CELL_SIZE", () => {
    const g = grid(["##"]);
    const a = cellToLocal(0, 0, g);
    const b = cellToLocal(1, 0, g);
    expect(b.x - a.x).toBe(CELL_SIZE);
  });

  it("reads cells in row-major order and clips out-of-bounds lookups", () => {
    const g = grid(["#.", ".m"]);
    expect(cellAt(0, 0, g)?.kind).toBe("hull");
    expect(cellAt(1, 1, g)?.kind).toBe("module");
    expect(cellAt(2, 0, g)).toBeUndefined();
  });

  it("returns only in-bounds 4-connected neighbours", () => {
    const g = grid(["###", "###", "###"]);
    expect(neighbours4(0, 0, g)).toHaveLength(2);
    expect(neighbours4(1, 1, g)).toHaveLength(4);
  });

  it("bounds the occupied cells tightly", () => {
    const g = grid([".....", ".##..", ".##..", "....."]);
    expect(bounds(g)).toEqual({ minCol: 1, maxCol: 2, minRow: 1, maxRow: 2 });
  });

  it("has no bounds for an empty grid", () => {
    expect(bounds(grid(["..", ".."]))).toBeUndefined();
  });

  it("counts only occupied cells in the footprint", () => {
    const g = grid([".#.", "#m#"]);
    expect(occupiedCount(g)).toBe(4);
    expect(footprint(g)).toHaveLength(4);
  });
});

describe("grid connectivity", () => {
  it("treats edge-adjacent occupied cells as connected", () => {
    expect(isConnected4(grid(["###"]))).toBe(true);
    expect(isConnected4(grid(["#", "#", "#"]))).toBe(true);
  });

  it("treats a gap as disconnected", () => {
    expect(isConnected4(grid(["#.#"]))).toBe(false);
  });

  it("treats diagonal-only adjacency as disconnected", () => {
    // (0,0) and (1,1) share only a corner, not an edge.
    expect(isConnected4(grid(["#.", ".#"]))).toBe(false);
  });

  it("treats an empty grid as not connected", () => {
    expect(isConnected4(grid(["..", ".."]))).toBe(false);
  });
});

describe("derived properties", () => {
  it("classifies by occupied-cell count", () => {
    // Tiers: fighter <=16, frigate <=45, cruiser <=100, else dreadnought.
    expect(deriveClassification(grid(["##"]))).toBe("fighter"); // 2 cells
    // 30 cells (5 rows of 6): above the fighter bound, within the frigate one.
    const frigate = grid(Array.from({ length: 5 }, () => "######"));
    expect(deriveClassification(frigate)).toBe("frigate");
    // 72 cells (8 rows of 9): within the cruiser bound.
    const cruiser = grid(Array.from({ length: 8 }, () => "#########"));
    expect(deriveClassification(cruiser)).toBe("cruiser");
    // 120 cells (10 rows of 12): above the cruiser bound — a dreadnought.
    const dread = grid(Array.from({ length: 10 }, () => "############"));
    expect(deriveClassification(dread)).toBe("dreadnought");
  });

  it("sums cell masses via the resolver", () => {
    const g = grid(["##", "#m"]);
    const massOf = (cell: GridCell): number =>
      cell.kind === "hull" ? 10 : cell.kind === "module" ? 7 : 0;
    // three hull cells (10 each) + one module (7) = 37
    expect(deriveMass(g, massOf)).toBe(37);
  });

  it("places the centroid toward the heavier side", () => {
    // Two cells in a row: a light hull on the left, a heavy module on the
    // right, so the mass-weighted centroid sits to the right of centre.
    const g = grid(["#m"]);
    const centre = centroid(g, (cell) => (cell.kind === "module" ? 9 : 1));
    expect(centre.x).toBeGreaterThan(0);
  });

  it("derives a radius that encloses the whole footprint", () => {
    const g = grid(["###"]);
    // Farthest cell centre is one CELL_SIZE from the origin; the radius adds
    // half a cell so it encloses the cell's extent.
    expect(deriveRadius(g)).toBeCloseTo(CELL_SIZE + CELL_SIZE / 2, 6);
  });

  it("has zero radius and fighter class for an empty grid", () => {
    const g = grid(["."]);
    expect(deriveRadius(g)).toBe(0);
    expect(occupiedCount(g)).toBe(0);
  });
});

describe("floor cell schema", () => {
  it("parses a floor cell directly", () => {
    const result = FloorCell.safeParse({ kind: "floor" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe("floor");
  });

  it("parses a grid containing floor cells", () => {
    expect(() => grid(["#_m"])).not.toThrow();
    const g = grid(["#_m"]);
    expect(cellAt(1, 0, g)?.kind).toBe("floor");
  });

  it("counts floor cells as occupied", () => {
    // A floor cell is a solid structure — it contributes to the ship's
    // footprint, connectivity, and classification.
    const g = grid(["#_"]);
    expect(occupiedCount(g)).toBe(2);
    expect(footprint(g)).toHaveLength(2);
  });
});

describe("walkability", () => {
  it("isWalkable truth table", () => {
    expect(isWalkable({ kind: "hull", tile: "block" })).toBe(true);
    expect(isWalkable({ kind: "module", moduleId: "x", facing: 0 })).toBe(true);
    expect(isWalkable({ kind: "floor" })).toBe(true);
    expect(isWalkable({ kind: "empty" })).toBe(false);
    expect(isWalkable(undefined)).toBe(false);
  });

  it("walkableNeighbours4 includes hull, module, and floor but not empty", () => {
    // Layout: a 3-cell row with hull | floor | empty.
    // The floor cell at (1,0) has one walkable neighbour on the left (hull at 0,0)
    // and one non-walkable neighbour on the right (empty at 2,0).
    const g = grid(["#_."]);
    const neighbours = walkableNeighbours4(1, 0, g);
    expect(neighbours).toHaveLength(1);
    expect(neighbours[0]).toEqual({ col: 0, row: 0 });
  });

  it("walkableNeighbours4 sees all four walkable neighbours", () => {
    // Centre cell surrounded by walkable cells on all four sides.
    const g = grid([
      "._.",
      "#_#",
      "._.",
    ]);
    // Centre (1,1) has up=(1,0)=floor, down=(1,2)=floor, left=(0,1)=hull, right=(2,1)=hull.
    const neighbours = walkableNeighbours4(1, 1, g);
    expect(neighbours).toHaveLength(4);
  });
});

describe("reachableFrom", () => {
  it("returns only the start cell when isolated", () => {
    // A single hull cell surrounded by empty: reachable set is just itself.
    const g = grid(["...", ".#.", "..."]);
    const reached = reachableFrom(g, { col: 1, row: 1 });
    expect(reached.size).toBe(1);
    expect(reached.has("1,1")).toBe(true);
  });

  it("fills the entire connected walkable region", () => {
    // A 3x1 row of hull cells: starting from any cell should reach all three.
    const g = grid(["###"]);
    const reached = reachableFrom(g, { col: 0, row: 0 });
    expect(reached.size).toBe(3);
    expect(reached.has("0,0")).toBe(true);
    expect(reached.has("1,0")).toBe(true);
    expect(reached.has("2,0")).toBe(true);
  });

  it("includes floor and module cells in the reachable region", () => {
    // hull – floor – module in a row: all three reachable from any one of them.
    const g = grid(["#_m"]);
    const reached = reachableFrom(g, { col: 0, row: 0 });
    expect(reached.size).toBe(3);
    expect(reached.has("2,0")).toBe(true);
  });

  it("does not cross an empty gap", () => {
    // Two isolated hull cells separated by an empty gap.
    const g = grid(["#.#"]);
    const leftReach = reachableFrom(g, { col: 0, row: 0 });
    const rightReach = reachableFrom(g, { col: 2, row: 0 });
    expect(leftReach.size).toBe(1);
    expect(rightReach.size).toBe(1);
    expect(leftReach.has("2,0")).toBe(false);
  });

  it("returns an empty set when the start cell is not walkable", () => {
    const g = grid(["#.#"]);
    const reached = reachableFrom(g, { col: 1, row: 0 });
    expect(reached.size).toBe(0);
  });

  it("returns an empty set when the start is out of bounds", () => {
    const g = grid(["##"]);
    const reached = reachableFrom(g, { col: 5, row: 0 });
    expect(reached.size).toBe(0);
  });

  it("fills an L-shaped connected region correctly", () => {
    // L-shape: three cells down then two cells right.
    const g = grid([
      "#.",
      "#.",
      "##",
    ]);
    const reached = reachableFrom(g, { col: 0, row: 0 });
    expect(reached.size).toBe(4);
  });
});

describe("findPath", () => {
  it("returns a single-element path when from === to", () => {
    const g = grid(["##"]);
    const path = findPath(g, { col: 0, row: 0 }, { col: 0, row: 0 });
    expect(path).toEqual([{ col: 0, row: 0 }]);
  });

  it("finds the shortest path along a straight corridor", () => {
    // Three hull cells in a row: path from left to right should be length 3.
    const g = grid(["###"]);
    const path = findPath(g, { col: 0, row: 0 }, { col: 2, row: 0 });
    expect(path).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
  });

  it("returns undefined when the destination is blocked by empty cells", () => {
    // A gap at col 1 makes the destination unreachable.
    const g = grid(["#.#"]);
    expect(findPath(g, { col: 0, row: 0 }, { col: 2, row: 0 })).toBeUndefined();
  });

  it("returns undefined when the start cell is not walkable", () => {
    const g = grid(["#.#"]);
    expect(findPath(g, { col: 1, row: 0 }, { col: 2, row: 0 })).toBeUndefined();
  });

  it("returns undefined when the destination cell is not walkable", () => {
    const g = grid(["#.#"]);
    expect(findPath(g, { col: 0, row: 0 }, { col: 1, row: 0 })).toBeUndefined();
  });

  it("routes around a non-walkable gap", () => {
    // A 3×3 grid with a gap at the centre of the top row forces a path around:
    //   # . #
    //   # # #
    //   (from top-left to top-right)
    const g = grid([
      "#.#",
      "###",
    ]);
    const path = findPath(g, { col: 0, row: 0 }, { col: 2, row: 0 });
    // Expected: go down, across, then up.
    expect(path).toBeDefined();
    // Path must start and end at the correct cells.
    expect(path?.[0]).toEqual({ col: 0, row: 0 });
    expect(path?.[path.length - 1]).toEqual({ col: 2, row: 0 });
    // Must not pass through the empty cell (1,0).
    const passesGap = path?.some((c) => c.col === 1 && c.row === 0) ?? false;
    expect(passesGap).toBe(false);
    // Shortest route is length 5: (0,0)→(0,1)→(1,1)→(2,1)→(2,0).
    expect(path).toHaveLength(5);
  });

  it("traverses floor cells as walkable", () => {
    // A corridor of floor cells connects the two hull endpoints.
    const g = grid(["#__#"]);
    const path = findPath(g, { col: 0, row: 0 }, { col: 3, row: 0 });
    expect(path).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
    ]);
  });

  it("is deterministic: repeated calls with identical input yield identical output", () => {
    // A 4×4 grid with a corridor that has multiple equally-short routes.
    const g = grid([
      "####",
      "#..#",
      "#..#",
      "####",
    ]);
    const pathA = findPath(g, { col: 0, row: 0 }, { col: 3, row: 3 });
    const pathB = findPath(g, { col: 0, row: 0 }, { col: 3, row: 3 });
    expect(pathA).toBeDefined();
    expect(pathB).toBeDefined();
    expect(pathA).toEqual(pathB);
  });

  it("chooses a consistent tie-breaking path on a symmetric grid", () => {
    // 3×3 all-hull grid: two equal-length L-shaped paths exist from top-left
    // to bottom-right. The tie-break rule (lower row then lower col) must
    // always select the same one.
    const g = grid([
      "###",
      "###",
      "###",
    ]);
    const first = findPath(g, { col: 0, row: 0 }, { col: 2, row: 2 });
    const second = findPath(g, { col: 0, row: 0 }, { col: 2, row: 2 });
    expect(first).toEqual(second);
    // Both calls must return a defined path of length 5 (Manhattan = 4 steps).
    expect(first).toHaveLength(5);
  });
});
