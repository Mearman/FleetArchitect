import { describe, expect, it } from "vitest";
import { subdivideGrid, subdivisionFactor } from "@/domain/shipgen";
import { TileGrid } from "@/schema/grid";
import type { CellEdges, GridCell } from "@/schema/grid";

// ---------------------------------------------------------------------------
// Shared edge constants (mirrors what the implementation uses internally,
// so tests are self-contained and do not import private details).
// ---------------------------------------------------------------------------

const OPEN: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

const WALL: CellEdges = {
  n: "wall",
  e: "wall",
  s: "wall",
  w: "wall",
  doorStates: {},
};

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

/** Smallest valid empty-cell grid (1×1, single empty cell). */
function emptyGrid1x1(): TileGrid {
  return TileGrid.parse({
    cols: 1,
    rows: 1,
    cells: [{ kind: "empty" }],
  });
}

/**
 * Build a minimal TileGrid from a row-major token string array.
 *
 * Tokens:
 *   `.`  empty
 *   `#`  armor (all-wall edges)
 *   `_`  deck, no equipment
 *   `b`  bare substrate, no equipment
 *   `m`  deck + equipment (moduleId "mod-test", facing 0)
 */
function fromTokens(rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      switch (ch) {
        case ".":
          cells.push({ kind: "empty" });
          break;
        case "#":
          cells.push({ kind: "solid", substrate: true, surface: "armor", edges: WALL });
          break;
        case "_":
          cells.push({ kind: "solid", substrate: true, surface: "deck", edges: OPEN });
          break;
        case "b":
          cells.push({ kind: "solid", substrate: true, surface: "bare", edges: OPEN });
          break;
        case "m":
          cells.push({
            kind: "solid",
            substrate: true,
            surface: "deck",
            edges: OPEN,
            equipment: { moduleId: "mod-test", facing: 0 },
          });
          break;
        default:
          throw new Error(`unknown fixture token "${ch}"`);
      }
    }
  }
  return TileGrid.parse({ cols, rows: rows.length, cells });
}

// ---------------------------------------------------------------------------
// subdivisionFactor
// ---------------------------------------------------------------------------

describe("subdivisionFactor", () => {
  it("returns 1 for an empty grid (no occupied cells)", () => {
    expect(subdivisionFactor(emptyGrid1x1(), 20)).toBe(1);
  });

  it("rounds to the nearest integer", () => {
    // A 4-cell-wide grid with a 20 m target: 20/4 = 5 exactly.
    const g = fromTokens(["####"]);
    expect(subdivisionFactor(g, 20)).toBe(5);
  });

  it("rounds half-up correctly", () => {
    // A 4-cell grid, 10 m target: 10/4 = 2.5 → rounds to 3.
    const g = fromTokens(["####"]);
    expect(subdivisionFactor(g, 10)).toBe(3);
  });

  it("is always at least 1 even when target < source size", () => {
    // A 10-cell grid, 5 m target: 5/10 = 0.5, rounds to 1 (floor at 1).
    const g = fromTokens(["##########"]);
    expect(subdivisionFactor(g, 5)).toBe(1);
  });

  it("uses the longest occupied dimension (not total grid size)", () => {
    // Grid is 5 cols × 3 rows but occupied cells span only cols 1-3 (3 wide)
    // and row 1 (1 tall): longest occupied dim = 3.
    const g = fromTokens([
      ".....",
      ".###.",
      ".....",
    ]);
    // 30 m / 3 cells = 10
    expect(subdivisionFactor(g, 30)).toBe(10);
  });

  it("picks the row dimension when it is the longer axis", () => {
    // 2 cols × 5 rows of occupied cells, longest dim = 5.
    const g = fromTokens(["##", "##", "##", "##", "##"]);
    expect(subdivisionFactor(g, 20)).toBe(4); // round(20/5) = 4
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — dimensions
// ---------------------------------------------------------------------------

describe("subdivideGrid — output dimensions", () => {
  it("scales cols and rows by f", () => {
    const g = fromTokens(["###", "###"]);
    const out = subdivideGrid(g, 3);
    expect(out.cols).toBe(9);
    expect(out.rows).toBe(6);
    expect(out.cells).toHaveLength(54);
  });

  it("produces a valid TileGrid (schema parse succeeds)", () => {
    const g = fromTokens(["#_m", "b.#"]);
    expect(() => subdivideGrid(g, 2)).not.toThrow();
  });

  it("with f=1 returns the same dimensions", () => {
    const g = fromTokens(["##_"]);
    const out = subdivideGrid(g, 1);
    expect(out.cols).toBe(3);
    expect(out.rows).toBe(1);
  });

  it("throws for f < 1", () => {
    const g = fromTokens(["#"]);
    expect(() => subdivideGrid(g, 0)).toThrow(RangeError);
  });

  it("throws for non-integer f", () => {
    const g = fromTokens(["#"]);
    expect(() => subdivideGrid(g, 1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — empty cells
// ---------------------------------------------------------------------------

describe("subdivideGrid — empty cells", () => {
  it("empty source cell → f×f empty sub-cells", () => {
    const g = fromTokens(["."]);
    const out = subdivideGrid(g, 3);
    expect(out.cells).toHaveLength(9);
    for (const cell of out.cells) {
      expect(cell.kind).toBe("empty");
    }
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — armor cells
// ---------------------------------------------------------------------------

describe("subdivideGrid — armor cells", () => {
  it("armor source cell → f×f armor sub-cells, all solid", () => {
    const g = fromTokens(["#"]);
    const out = subdivideGrid(g, 2);
    expect(out.cells).toHaveLength(4);
    for (const cell of out.cells) {
      expect(cell.kind).toBe("solid");
      if (cell.kind === "solid") {
        expect(cell.surface).toBe("armor");
      }
    }
  });

  it("armor outer-perimeter sub-cells carry wall edges on exposed sides", () => {
    // Single armor cell, f=2:
    //   sub-cell (dc=0, dr=0) → n:wall, e:open, s:open, w:wall
    //   sub-cell (dc=1, dr=0) → n:wall, e:wall, s:open, w:open
    //   sub-cell (dc=0, dr=1) → n:open, e:open, s:wall, w:wall
    //   sub-cell (dc=1, dr=1) → n:open, e:wall, s:wall, w:open
    const g = fromTokens(["#"]);
    const out = subdivideGrid(g, 2);
    // Index layout: row-major, cols=2
    // idx 0 = (col=0, row=0) = dc=0, dr=0
    // idx 1 = (col=1, row=0) = dc=1, dr=0
    // idx 2 = (col=0, row=1) = dc=0, dr=1
    // idx 3 = (col=1, row=1) = dc=1, dr=1
    const [tl, tr, bl, br] = out.cells;
    expect(tl?.kind).toBe("solid");
    if (tl?.kind === "solid") {
      expect(tl.edges.n).toBe("wall");
      expect(tl.edges.w).toBe("wall");
      expect(tl.edges.e).toBe("open");
      expect(tl.edges.s).toBe("open");
    }
    expect(tr?.kind).toBe("solid");
    if (tr?.kind === "solid") {
      expect(tr.edges.n).toBe("wall");
      expect(tr.edges.e).toBe("wall");
      expect(tr.edges.s).toBe("open");
      expect(tr.edges.w).toBe("open");
    }
    expect(bl?.kind).toBe("solid");
    if (bl?.kind === "solid") {
      expect(bl.edges.s).toBe("wall");
      expect(bl.edges.w).toBe("wall");
      expect(bl.edges.n).toBe("open");
      expect(bl.edges.e).toBe("open");
    }
    expect(br?.kind).toBe("solid");
    if (br?.kind === "solid") {
      expect(br.edges.s).toBe("wall");
      expect(br.edges.e).toBe("wall");
      expect(br.edges.n).toBe("open");
      expect(br.edges.w).toBe("open");
    }
  });

  it("3×3 armor expansion has correct perimeter walls", () => {
    const g = fromTokens(["#"]);
    const out = subdivideGrid(g, 3);
    // The centre sub-cell (dc=1, dr=1) has all edges open.
    const centreIdx = 1 * 3 + 1; // row=1, col=1, newCols=3
    const centre = out.cells[centreIdx];
    expect(centre?.kind).toBe("solid");
    if (centre?.kind === "solid") {
      expect(centre.edges.n).toBe("open");
      expect(centre.edges.e).toBe("open");
      expect(centre.edges.s).toBe("open");
      expect(centre.edges.w).toBe("open");
    }
    // The top-left corner has walls on n and w.
    const topLeft = out.cells[0];
    if (topLeft?.kind === "solid") {
      expect(topLeft.edges.n).toBe("wall");
      expect(topLeft.edges.w).toBe("wall");
      expect(topLeft.edges.e).toBe("open");
      expect(topLeft.edges.s).toBe("open");
    }
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — bare cells
// ---------------------------------------------------------------------------

describe("subdivideGrid — bare cells", () => {
  it("bare source cell → f×f bare sub-cells, all open edges", () => {
    const g = fromTokens(["b"]);
    const out = subdivideGrid(g, 2);
    for (const cell of out.cells) {
      expect(cell.kind).toBe("solid");
      if (cell.kind === "solid") {
        expect(cell.surface).toBe("bare");
        expect(cell.edges).toEqual(OPEN);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — deck cells (no equipment)
// ---------------------------------------------------------------------------

describe("subdivideGrid — deck cells (no equipment)", () => {
  it("deck source cell → f×f deck sub-cells, all open, no equipment", () => {
    const g = fromTokens(["_"]);
    const out = subdivideGrid(g, 3);
    for (const cell of out.cells) {
      expect(cell.kind).toBe("solid");
      if (cell.kind === "solid") {
        expect(cell.surface).toBe("deck");
        expect(cell.edges).toEqual(OPEN);
        expect(cell.equipment).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — equipment carry-through
// ---------------------------------------------------------------------------

describe("subdivideGrid — equipment carry-through", () => {
  it("equipment lands on the top-left sub-cell (dc=0, dr=0)", () => {
    const g = fromTokens(["m"]);
    const out = subdivideGrid(g, 3);
    expect(out.cells).toHaveLength(9);

    const topLeft = out.cells[0];
    expect(topLeft?.kind).toBe("solid");
    if (topLeft?.kind === "solid") {
      expect(topLeft.surface).toBe("deck");
      expect(topLeft.equipment).toEqual({ moduleId: "mod-test", facing: 0 });
    }

    // All other sub-cells are plain deck with no equipment.
    for (let i = 1; i < 9; i += 1) {
      const cell = out.cells[i];
      expect(cell?.kind).toBe("solid");
      if (cell?.kind === "solid") {
        expect(cell.surface).toBe("deck");
        expect(cell.equipment).toBeUndefined();
      }
    }
  });

  it("carries facing correctly", () => {
    const g = TileGrid.parse({
      cols: 1,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "mod-engine-ion", facing: Math.PI },
        },
      ],
    });
    const out = subdivideGrid(g, 2);
    const topLeft = out.cells[0];
    if (topLeft?.kind === "solid") {
      expect(topLeft.equipment?.facing).toBe(Math.PI);
      expect(topLeft.equipment?.moduleId).toBe("mod-engine-ion");
    }
  });

  it("carries optional equipment fields (channel, commsBearing, etc.)", () => {
    const g = TileGrid.parse({
      cols: 1,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: {
            moduleId: "mod-comms-omni",
            facing: 0,
            channel: 3,
            commsBearing: 1.5707,
            commsRange: 500,
          },
        },
      ],
    });
    const out = subdivideGrid(g, 2);
    const topLeft = out.cells[0];
    if (topLeft?.kind === "solid") {
      expect(topLeft.equipment?.channel).toBe(3);
      expect(topLeft.equipment?.commsBearing).toBeCloseTo(1.5707);
      expect(topLeft.equipment?.commsRange).toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — mixed grid
// ---------------------------------------------------------------------------

describe("subdivideGrid — mixed grid", () => {
  it("expands a 2×2 mixed grid correctly", () => {
    // Source: 2 cols × 2 rows
    //   [0,0]=armor, [1,0]=deck, [0,1]=empty, [1,1]=deck+equip
    const g = fromTokens(["#_", ".m"]);
    const out = subdivideGrid(g, 2);
    // Output: 4 cols × 4 rows = 16 cells
    expect(out.cols).toBe(4);
    expect(out.rows).toBe(4);
    expect(out.cells).toHaveLength(16);

    // Source cell (0,0) = armor, expands to positions (dc,dr) ∈ {0,1}×{0,1}
    // in the output grid at (col,row) = (0,0),(1,0),(0,1),(1,1).
    const armorTL = out.cells[0 * 4 + 0]; // row=0, col=0
    expect(armorTL?.kind).toBe("solid");
    if (armorTL?.kind === "solid") expect(armorTL.surface).toBe("armor");

    // Source cell (1,0) = deck, expands to output cols 2-3, rows 0-1.
    const deckTL = out.cells[0 * 4 + 2]; // row=0, col=2
    expect(deckTL?.kind).toBe("solid");
    if (deckTL?.kind === "solid") {
      expect(deckTL.surface).toBe("deck");
      expect(deckTL.equipment).toBeUndefined();
    }

    // Source cell (0,1) = empty, expands to output cols 0-1, rows 2-3.
    const emptyTL = out.cells[2 * 4 + 0]; // row=2, col=0
    expect(emptyTL?.kind).toBe("empty");

    // Source cell (1,1) = deck+equip, expands to output cols 2-3, rows 2-3.
    // The top-left sub-cell (col=2, row=2) carries the equipment.
    const equipCell = out.cells[2 * 4 + 2]; // row=2, col=2
    expect(equipCell?.kind).toBe("solid");
    if (equipCell?.kind === "solid") {
      expect(equipCell.surface).toBe("deck");
      expect(equipCell.equipment?.moduleId).toBe("mod-test");
    }
    // Other sub-cells of that block have no equipment.
    const equipNeighbour = out.cells[2 * 4 + 3]; // row=2, col=3
    if (equipNeighbour?.kind === "solid") {
      expect(equipNeighbour.equipment).toBeUndefined();
    }
  });

  it("preserves occupied-cell proportions", () => {
    // Source: 2 cols × 3 rows with all cells occupied.
    const g = fromTokens(["##", "##", "##"]);
    const f = 4;
    const out = subdivideGrid(g, f);
    // 100% of source cells are occupied → 100% of output cells should be solid.
    const solidCount = out.cells.filter((c) => c.kind === "solid").length;
    expect(solidCount).toBe(out.cells.length);
  });

  it("preserves empty proportion in a sparse grid", () => {
    // 3×1 grid: one armor, one deck, one empty.
    const g = fromTokens(["#_."]);
    const out = subdivideGrid(g, 3);
    // 2 occupied source cells → 2 * 9 = 18 solid cells out of 27 total.
    const solidCount = out.cells.filter((c) => c.kind === "solid").length;
    const emptyCount = out.cells.filter((c) => c.kind === "empty").length;
    expect(solidCount).toBe(18);
    expect(emptyCount).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — connection handling
// ---------------------------------------------------------------------------

describe("subdivideGrid — connections", () => {
  it("does not carry connections from the source grid", () => {
    // Build a source grid that has a connection between two equipment cells.
    const g = TileGrid.parse({
      cols: 2,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "mod-reactor-fusion", facing: 0 },
        },
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "mod-pulse-laser", facing: 0 },
        },
      ],
      connections: [
        { from: { col: 0, row: 0 }, to: { col: 1, row: 0 }, resource: "power" },
      ],
    });
    const out = subdivideGrid(g, 2);
    expect(out.connections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// subdivideGrid — f=1 identity behaviour
// ---------------------------------------------------------------------------

describe("subdivideGrid — f=1 identity", () => {
  it("with f=1 returns identical dimensions and cells", () => {
    const g = fromTokens(["#_m", ".b#"]);
    const out = subdivideGrid(g, 1);
    expect(out.cols).toBe(g.cols);
    expect(out.rows).toBe(g.rows);
    expect(out.cells).toHaveLength(g.cells.length);
  });

  it("with f=1 strips connections", () => {
    const g = TileGrid.parse({
      cols: 2,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "mod-a", facing: 0 },
        },
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "mod-b", facing: 0 },
        },
      ],
      connections: [
        { from: { col: 0, row: 0 }, to: { col: 1, row: 0 }, resource: "ammo" },
      ],
    });
    const out = subdivideGrid(g, 1);
    expect(out.connections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Purity / determinism: two calls with identical inputs → byte-identical output.
// ---------------------------------------------------------------------------

describe("subdivideGrid — purity / determinism", () => {
  it("two calls with the same input produce byte-identical output", () => {
    const g = fromTokens([
      "#.#",
      "_m_",
      "b.#",
    ]);
    const out1 = subdivideGrid(g, 3);
    const out2 = subdivideGrid(g, 3);
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
  });

  it("two calls with a larger fixture produce byte-identical output", () => {
    const g = fromTokens([
      "###.###",
      "#_m_b_#",
      "#_____#",
      "#_m___#",
      "###.###",
    ]);
    const out1 = subdivideGrid(g, 4);
    const out2 = subdivideGrid(g, 4);
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
  });

  it("subdivisionFactor is pure: same input → same output", () => {
    const g = fromTokens(["####.###"]);
    expect(subdivisionFactor(g, 60)).toBe(subdivisionFactor(g, 60));
  });
});

// ---------------------------------------------------------------------------
// Edge: schema validation on output
// ---------------------------------------------------------------------------

describe("subdivideGrid — output validates against schema", () => {
  it("the output grid passes TileGrid.parse without throwing", () => {
    const fixtures: Array<[readonly string[], number]> = [
      [["#"], 1],
      [["#"], 5],
      [["_"], 3],
      [["b"], 2],
      [["m"], 4],
      [["#_m", ".b#"], 2],
      [["###", "#m#", "###"], 3],
    ];
    for (const [rows, f] of fixtures) {
      const g = fromTokens(rows);
      expect(() => TileGrid.parse(subdivideGrid(g, f))).not.toThrow();
    }
  });
});
