import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  DREADNOUGHT_MAX_LENGTH_M,
  SHIP_LENGTH_METRES,
  bounds,
  cellAt,
  cellToLocal,
  centroid,
  deriveClassification,
  deriveMass,
  deriveRadius,
  edgePassable,
  findPath,
  footprint,
  isConnected4,
  isWalkable,
  neighbours4,
  occupiedCount,
  reachableFrom,
  walkableNeighbours4,
} from "@/domain/grid";
import { TileGrid } from "@/schema/grid";
import { GridCell as GridCellSchema } from "@/schema/grid";
import type { CellEdges, GridCell } from "@/schema/grid";

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };
const WALL: CellEdges = { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} };

/** Build a grid from a token map:
 *   `.` empty, `#` armor (all-wall), `_` deck corridor (all-open), `b` bare
 *   substrate (all-open), `m` a deck cell carrying equipment. */
function grid(rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  const tokens: Record<string, GridCell> = {
    ".": { kind: "empty" },
    "#": { kind: "solid", substrate: true, surface: "armor", edges: WALL },
    "_": { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
    "b": { kind: "solid", substrate: true, surface: "bare", edges: OPEN },
    "m": {
      kind: "solid",
      substrate: true,
      surface: "deck",
      edges: OPEN,
      equipment: { moduleId: "mod-x", facing: 0 },
    },
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

  it("parses a solid armor cell with all-wall edges", () => {
    const g = grid(["#"]);
    const cell = cellAt(0, 0, g);
    expect(cell?.kind).toBe("solid");
    if (cell?.kind === "solid") {
      expect(cell.surface).toBe("armor");
      expect(cell.edges.n).toBe("wall");
    }
  });

  it("rejects an armor cell that carries equipment", () => {
    // The refine on SolidCell forbids equipment on an armor surface.
    const bad: GridCell = {
      kind: "solid",
      substrate: true,
      surface: "armor",
      edges: WALL,
      equipment: { moduleId: "mod-x", facing: 0 },
    };
    // Parsing via the GridCell union exercises the refine.
    expect(GridCellSchema.safeParse(bad).success).toBe(false);
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
    expect(cellAt(0, 0, g)?.kind).toBe("solid");
    expect(cellAt(1, 1, g)?.kind).toBe("solid");
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
    expect(isConnected4(grid(["#.", ".#"]))).toBe(false);
  });

  it("treats an empty grid as not connected", () => {
    expect(isConnected4(grid(["..", ".."]))).toBe(false);
  });

  it("treats armor + deck adjacency as substrate-connected", () => {
    // Armor and deck are both solid cells (substrate-anchored), so they
    // contribute to the 4-connected structural graph even though armor
    // is not walkable.
    expect(isConnected4(grid(["#_#"]))).toBe(true);
  });
});

describe("derived properties", () => {
  it("classifies by bounding-box length in metres", () => {
    // fighter: longest axis ≤ SHIP_LENGTH_METRES.fighter (20 m). A 2-cell row
    // spans 2 m — well within the fighter threshold.
    expect(deriveClassification(grid(["##"]))).toBe("fighter");

    // frigate: longest axis > 20 m and ≤ SHIP_LENGTH_METRES.frigate (60 m).
    // Build a 1-row grid exactly SHIP_LENGTH_METRES.frigate cells wide (60 m).
    const frigateRow = "#".repeat(SHIP_LENGTH_METRES.frigate);
    expect(deriveClassification(grid([frigateRow]))).toBe("frigate");

    // cruiser: longest axis > 60 m and ≤ SHIP_LENGTH_METRES.cruiser (150 m).
    // Build a 1-row grid exactly SHIP_LENGTH_METRES.cruiser cells wide (150 m).
    const cruiserRow = "#".repeat(SHIP_LENGTH_METRES.cruiser);
    expect(deriveClassification(grid([cruiserRow]))).toBe("cruiser");

    // dreadnought: longest axis > 150 m. Use a grid one cell beyond the cruiser
    // threshold (151 m), which still fits within DREADNOUGHT_MAX_LENGTH_M.
    const dreadRow = "#".repeat(SHIP_LENGTH_METRES.cruiser + 1);
    expect(SHIP_LENGTH_METRES.cruiser + 1).toBeLessThanOrEqual(DREADNOUGHT_MAX_LENGTH_M);
    expect(deriveClassification(grid([dreadRow]))).toBe("dreadnought");
  });

  it("classifies an empty grid as fighter", () => {
    expect(deriveClassification(grid(["."]))).toBe("fighter");
  });

  it("sums cell masses via the resolver", () => {
    const g = grid(["##", "#m"]);
    const massOf = (cell: GridCell): number => {
      if (cell.kind !== "solid") return 0;
      return cell.surface === "armor" ? 10 : cell.equipment !== undefined ? 7 : 2;
    };
    // two armor cells (10 each) + one armor (10) + one equipment deck (7) = 37
    expect(deriveMass(g, massOf)).toBe(37);
  });

  it("places the centroid toward the heavier side", () => {
    const g = grid(["#m"]);
    const centre = centroid(g, (cell) => {
      if (cell.kind !== "solid") return 0;
      return cell.equipment !== undefined ? 9 : 1;
    });
    expect(centre.x).toBeGreaterThan(0);
  });

  it("derives a radius that encloses the whole footprint", () => {
    const g = grid(["###"]);
    expect(deriveRadius(g)).toBeCloseTo(CELL_SIZE + CELL_SIZE / 2, 6);
  });

  it("has zero radius and fighter class for an empty grid", () => {
    const g = grid(["."]);
    expect(deriveRadius(g)).toBe(0);
    expect(occupiedCount(g)).toBe(0);
  });
});

describe("walkability", () => {
  it("isWalkable truth table", () => {
    expect(isWalkable({ kind: "solid", substrate: true, surface: "armor", edges: WALL })).toBe(false);
    expect(isWalkable({ kind: "solid", substrate: true, surface: "bare", edges: OPEN })).toBe(false);
    expect(isWalkable({ kind: "solid", substrate: true, surface: "deck", edges: OPEN })).toBe(true);
    expect(
      isWalkable({
        kind: "solid",
        substrate: true,
        surface: "deck",
        edges: OPEN,
        equipment: { moduleId: "x", facing: 0 },
      }),
    ).toBe(true);
    expect(isWalkable({ kind: "empty" })).toBe(false);
    expect(isWalkable(undefined)).toBe(false);
  });

  it("walkableNeighbours4 includes only deck cells reachable through open edges", () => {
    // Layout: armor | deck | empty. The deck cell at (1,0) has no walkable
    // neighbour: the armor on the left is not walkable, the empty on the
    // right is not walkable.
    const g = grid(["#_."]);
    const neighbours = walkableNeighbours4(1, 0, g);
    expect(neighbours).toHaveLength(0);
  });

  it("walkableNeighbours4 sees all four walkable neighbours when surrounded by deck", () => {
    // 3x3 deck crosshair: centre (1,1) is deck; its four neighbours are deck.
    const g = grid(["._.", "___", "._."]);
    const neighbours = walkableNeighbours4(1, 1, g);
    expect(neighbours).toHaveLength(4);
  });

  it("edgePassable treats a wall edge as impassable", () => {
    // Two adjacent deck cells whose shared edge (w of the right cell) is wall.
    const cells: GridCell[] = [
      { kind: "solid", substrate: true, surface: "deck", edges: { ...OPEN, e: "wall" } },
      { kind: "solid", substrate: true, surface: "deck", edges: { ...OPEN, w: "wall" } },
    ];
    const g = TileGrid.parse({ cols: 2, rows: 1, cells });
    expect(edgePassable({ col: 0, row: 0 }, { col: 1, row: 0 }, g)).toBe(false);
  });

  it("edgePassable treats a door as passable in either state (crew open closed doors)", () => {
    // Left cell has a door to the east, open state.
    const leftEdges: CellEdges = { ...OPEN, e: "door", doorStates: { e: "open" } };
    const rightEdges: CellEdges = { ...OPEN, w: "door", doorStates: { w: "open" } };
    const g = TileGrid.parse({
      cols: 2,
      rows: 1,
      cells: [
        { kind: "solid", substrate: true, surface: "deck", edges: leftEdges },
        { kind: "solid", substrate: true, surface: "deck", edges: rightEdges },
      ],
    });
    expect(edgePassable({ col: 0, row: 0 }, { col: 1, row: 0 }, g)).toBe(true);
    // Close the door on the left side: still passable — the open/closed state
    // governs atmosphere tightness (modelled in interior.ts), not crew passage.
    // Crew open a closed door to step through, mirroring the sim crew-pathfinder.
    const closedLeft: CellEdges = { ...OPEN, e: "door", doorStates: { e: "closed" } };
    const g2 = TileGrid.parse({
      cols: 2,
      rows: 1,
      cells: [
        { kind: "solid", substrate: true, surface: "deck", edges: closedLeft },
        { kind: "solid", substrate: true, surface: "deck", edges: rightEdges },
      ],
    });
    expect(edgePassable({ col: 0, row: 0 }, { col: 1, row: 0 }, g2)).toBe(true);
  });
});

describe("reachableFrom", () => {
  it("returns only the start cell when isolated by armor", () => {
    // A single deck cell surrounded by armor (which is not walkable): the
    // reachable set is just the deck cell.
    const g = grid([
      "###",
      "#_#",
      "###",
    ]);
    const reached = reachableFrom(g, { col: 1, row: 1 });
    expect(reached.size).toBe(1);
    expect(reached.has("1,1")).toBe(true);
  });

  it("fills the entire connected walkable region", () => {
    // A 3x1 row of deck cells: starting from any cell should reach all three.
    const g = grid(["___"]);
    const reached = reachableFrom(g, { col: 0, row: 0 });
    expect(reached.size).toBe(3);
    expect(reached.has("0,0")).toBe(true);
    expect(reached.has("1,0")).toBe(true);
    expect(reached.has("2,0")).toBe(true);
  });

  it("does not cross an armor cell", () => {
    // deck – armor – deck in a row: the two deck cells are NOT mutually
    // reachable (the armor between them is not walkable).
    const g = grid(["_#_"]);
    const leftReach = reachableFrom(g, { col: 0, row: 0 });
    expect(leftReach.size).toBe(1);
    expect(leftReach.has("2,0")).toBe(false);
  });

  it("does not cross an empty gap", () => {
    const g = grid(["_._"]);
    const leftReach = reachableFrom(g, { col: 0, row: 0 });
    expect(leftReach.size).toBe(1);
    expect(leftReach.has("2,0")).toBe(false);
  });

  it("returns an empty set when the start cell is not walkable", () => {
    // Armor is not walkable; an empty cell is not walkable.
    const g = grid(["_#_"]);
    expect(reachableFrom(g, { col: 1, row: 0 }).size).toBe(0);
  });

  it("returns an empty set when the start is out of bounds", () => {
    const g = grid(["__"]);
    expect(reachableFrom(g, { col: 5, row: 0 }).size).toBe(0);
  });

  it("fills an L-shaped connected region correctly", () => {
    const g = grid([
      "_.",
      "_.",
      "__",
    ]);
    const reached = reachableFrom(g, { col: 0, row: 0 });
    expect(reached.size).toBe(4);
  });
});

describe("findPath", () => {
  it("returns a single-element path when from === to", () => {
    const g = grid(["__"]);
    const path = findPath(g, { col: 0, row: 0 }, { col: 0, row: 0 });
    expect(path).toEqual([{ col: 0, row: 0 }]);
  });

  it("finds the shortest path along a straight corridor", () => {
    const g = grid(["___"]);
    const path = findPath(g, { col: 0, row: 0 }, { col: 2, row: 0 });
    expect(path).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
  });

  it("returns undefined when the destination is blocked by empty cells", () => {
    const g = grid(["_._"]);
    expect(findPath(g, { col: 0, row: 0 }, { col: 2, row: 0 })).toBeUndefined();
  });

  it("returns undefined when the destination is blocked by armor", () => {
    // The destination is armor (not walkable).
    const g = grid(["_#"]);
    expect(findPath(g, { col: 0, row: 0 }, { col: 1, row: 0 })).toBeUndefined();
  });

  it("returns undefined when the start cell is not walkable", () => {
    const g = grid(["_._"]);
    expect(findPath(g, { col: 1, row: 0 }, { col: 2, row: 0 })).toBeUndefined();
  });

  it("returns undefined when the destination cell is not walkable", () => {
    const g = grid(["_._"]);
    expect(findPath(g, { col: 0, row: 0 }, { col: 1, row: 0 })).toBeUndefined();
  });

  it("routes around a non-walkable gap", () => {
    const g = grid([
      "_._",
      "___",
    ]);
    const path = findPath(g, { col: 0, row: 0 }, { col: 2, row: 0 });
    expect(path).toBeDefined();
    expect(path?.[0]).toEqual({ col: 0, row: 0 });
    expect(path?.[path.length - 1]).toEqual({ col: 2, row: 0 });
    const passesGap = path?.some((c) => c.col === 1 && c.row === 0) ?? false;
    expect(passesGap).toBe(false);
    expect(path).toHaveLength(5);
  });

  it("is deterministic: repeated calls with identical input yield identical output", () => {
    const g = grid([
      "____",
      "_.._",
      "_.._",
      "____",
    ]);
    const pathA = findPath(g, { col: 0, row: 0 }, { col: 3, row: 3 });
    const pathB = findPath(g, { col: 0, row: 0 }, { col: 3, row: 3 });
    expect(pathA).toBeDefined();
    expect(pathB).toBeDefined();
    expect(pathA).toEqual(pathB);
  });

  it("chooses a consistent tie-breaking path on a symmetric grid", () => {
    const g = grid([
      "___",
      "___",
      "___",
    ]);
    const first = findPath(g, { col: 0, row: 0 }, { col: 2, row: 2 });
    const second = findPath(g, { col: 0, row: 0 }, { col: 2, row: 2 });
    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
  });
});
