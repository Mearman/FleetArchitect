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
  footprint,
  isConnected4,
  neighbours4,
  occupiedCount,
} from "@/domain/grid";
import { TileGrid } from "@/schema/grid";
import type { GridCell } from "@/schema/grid";

/** Build a grid from a token map: `.` empty, `#` hull block, `m` a module. */
function grid(rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  const tokens: Record<string, GridCell> = {
    ".": { kind: "empty" },
    "#": { kind: "hull", tile: "block" },
    "m": { kind: "module", moduleId: "mod-x", facing: 0 },
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
