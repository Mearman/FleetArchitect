import { TileGrid } from "@/schema/grid";
import type { CellEdges, CellEquipment, GridCell } from "@/schema/grid";
import { bounds } from "@/domain/grid";

/**
 * Pure, deterministic generator that subdivides a coarse `TileGrid` into a
 * 1 m layered grid by expanding each source cell into an `f × f` block of
 * sub-cells, where `f` is derived from the ratio of the target hull length in
 * metres to the longest occupied-cell dimension of the input.
 *
 * Intended usage: pass a hand-authored ASCII preset and the hull's target
 * physical length (metres) to produce a realistically-scaled interior map
 * ready for crew, pathfinding, and simulation. The output validates against
 * `src/schema/grid.ts` and is byte-identical across calls with the same input
 * (pure function — no RNG, no Date, no side effects).
 */

// ---------------------------------------------------------------------------
// Shared edge constants.
// ---------------------------------------------------------------------------

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

const WALL_EDGES: CellEdges = {
  n: "wall",
  e: "wall",
  s: "wall",
  w: "wall",
  doorStates: {},
};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Compute the subdivision factor for a given coarse grid and target length.
 *
 * `f = max(1, round(targetLengthM / longestOccupiedDimInCells))`
 *
 * The factor is applied equally to both axes so authored proportions are
 * preserved and the physical length of the result matches the target.
 *
 * @param coarse - The source `TileGrid` (any scale).
 * @param targetLengthM - The desired physical length of the longest axis
 *   of the occupied bounding box, in metres. At 1 m per cell in the output,
 *   the longest axis will span approximately this many cells.
 * @returns An integer subdivision factor ≥ 1.
 */
export function subdivisionFactor(
  coarse: TileGrid,
  targetLengthM: number,
): number {
  const b = bounds(coarse);
  if (b === undefined) return 1;
  const longestDim = Math.max(
    b.maxCol - b.minCol + 1,
    b.maxRow - b.minRow + 1,
  );
  return Math.max(1, Math.round(targetLengthM / longestDim));
}

/**
 * Subdivide a coarse `TileGrid` into a 1 m layered grid.
 *
 * Each source cell expands into an `f × f` block of sub-cells:
 *
 * - **empty** → `f × f` empty sub-cells.
 * - **armor** → `f × f` armor sub-cells; wall edges are placed on the outer
 *   perimeter of each source armor cell, interior sub-cell edges are open.
 * - **bare** → `f × f` bare sub-cells. A coarse-level wall or door authored on
 *   the source cell propagates onto the matching outer sub-cells of the block;
 *   interior sub-cell edges are open (low-mass framing).
 * - **deck (no equipment)** → `f × f` deck sub-cells. Coarse-level walls and
 *   doors propagate onto the block perimeter as for `bare`; interior edges are
 *   open so crew can traverse the block.
 * - **deck (with equipment)** → one representative sub-cell (top-left of the
 *   block) carries the equipment; the remaining `f × f − 1` sub-cells are
 *   plain deck. Edge propagation is identical to the no-equipment case.
 *
 * Connections from the coarse grid are not carried through to the output
 * because the absolute cell coordinates change (connection rescaling is a
 * separate concern).
 *
 * The output is validated with `TileGrid.parse` before being returned, so a
 * malformed expansion fails loudly at the boundary.
 *
 * @param coarse - The source `TileGrid`.
 * @param f - The subdivision factor (integer ≥ 1). Use `subdivisionFactor` to
 *   derive this from a target length.
 * @returns A `TileGrid` with `coarse.cols * f` columns and `coarse.rows * f`
 *   rows, validated against the schema.
 */
export function subdivideGrid(coarse: TileGrid, f: number): TileGrid {
  if (!Number.isInteger(f) || f < 1) {
    throw new RangeError(`subdivision factor must be a positive integer; got ${f}`);
  }
  if (f === 1) {
    // Identity: re-parse to strip connections (coordinates are unchanged, but
    // connections are intentionally not forwarded; see JSDoc).
    return TileGrid.parse({
      cols: coarse.cols,
      rows: coarse.rows,
      cells: coarse.cells,
      connections: [],
    });
  }

  const newCols = coarse.cols * f;
  const newRows = coarse.rows * f;
  const cells = new Array<GridCell>(newCols * newRows);

  // Row-major expansion: iterate source cells in (srcRow, srcCol) order, then
  // inner sub-cells in (dr, dc) order. This fixed order is the determinism
  // guarantee — no Map/Set insertion-order dependence, no RNG.
  for (let srcRow = 0; srcRow < coarse.rows; srcRow += 1) {
    for (let srcCol = 0; srcCol < coarse.cols; srcCol += 1) {
      const srcCell = coarse.cells[srcRow * coarse.cols + srcCol];
      if (srcCell === undefined) continue;

      for (let dr = 0; dr < f; dr += 1) {
        for (let dc = 0; dc < f; dc += 1) {
          const dstRow = srcRow * f + dr;
          const dstCol = srcCol * f + dc;
          const dstIdx = dstRow * newCols + dstCol;
          cells[dstIdx] = expandCell(srcCell, dc, dr, f);
        }
      }
    }
  }

  return TileGrid.parse({
    cols: newCols,
    rows: newRows,
    cells,
    connections: [],
  });
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Expand one source cell into a single sub-cell at offset `(dc, dr)` within
 * its `f × f` block. `dc` and `dr` are 0-based sub-cell offsets within the
 * block (column and row respectively).
 *
 * Armour perimeter walls:
 *   The outer perimeter edges of the block correspond to the edges the source
 *   armour cell presents to the rest of the ship. Sub-cells on those edges
 *   keep `wall` on the outward-facing side so the armour shell remains intact.
 *   Interior sub-cell-to-sub-cell edges are `open` so the block is internally
 *   coherent (though armour is never walkable regardless).
 */
function expandCell(
  src: GridCell,
  dc: number,
  dr: number,
  f: number,
): GridCell {
  if (src.kind === "empty") {
    return { kind: "empty" };
  }

  // Whether this sub-cell is on the outermost edge of the block.
  const onNorth = dr === 0;
  const onSouth = dr === f - 1;
  const onWest = dc === 0;
  const onEast = dc === f - 1;

  switch (src.surface) {
    case "armor":
      return expandArmorSubCell(onNorth, onEast, onSouth, onWest);
    case "bare":
      return {
        kind: "solid",
        substrate: true,
        surface: "bare",
        edges: projectedEdges(src.edges, onNorth, onEast, onSouth, onWest),
      };
    case "deck":
      return expandDeckSubCell(
        dc,
        dr,
        src.equipment,
        src.edges,
        onNorth,
        onEast,
        onSouth,
        onWest,
      );
  }
}

/**
 * Build one armour sub-cell. Wall edges are placed only on the outer
 * perimeter of the block to model the armour shell. Interior edges (between
 * sub-cells of the same source cell) are open, keeping the block structurally
 * coherent without blocking anything (armour cells are not walkable either way,
 * so the edge kind is semantically irrelevant for crew movement here — but
 * open preserves the intent that there is no extra barrier *inside* the block).
 */
function expandArmorSubCell(
  onNorth: boolean,
  onEast: boolean,
  onSouth: boolean,
  onWest: boolean,
): GridCell {
  const edges: CellEdges = {
    n: onNorth ? "wall" : "open",
    e: onEast ? "wall" : "open",
    s: onSouth ? "wall" : "open",
    w: onWest ? "wall" : "open",
    doorStates: {},
  };
  return { kind: "solid", substrate: true, surface: "armor", edges };
}

/**
 * Project a coarse cell's edges onto one of its sub-cells. A sub-cell sitting
 * on the block's outer perimeter inherits the coarse cell's edge in that
 * direction, so a coarse-level wall or door authored between two deck/bare
 * cells propagates to a wall or door between the corresponding sub-cell blocks.
 * Interior sub-cell-to-sub-cell edges are `open` so the block remains
 * internally traversable.
 *
 * Door states are carried only onto perimeter sub-cells, and only in
 * directions the coarse cell authored as a door — this preserves the
 * doorState invariant (a state is present exactly on door edges) in the
 * output, which the schema's refine checks at parse time.
 */
function projectedEdges(
  coarse: CellEdges,
  onNorth: boolean,
  onEast: boolean,
  onSouth: boolean,
  onWest: boolean,
): CellEdges {
  const doorStates: CellEdges["doorStates"] = {};
  if (onNorth && coarse.n === "door") doorStates.n = coarse.doorStates.n;
  if (onEast && coarse.e === "door") doorStates.e = coarse.doorStates.e;
  if (onSouth && coarse.s === "door") doorStates.s = coarse.doorStates.s;
  if (onWest && coarse.w === "door") doorStates.w = coarse.doorStates.w;
  return {
    n: onNorth ? coarse.n : "open",
    e: onEast ? coarse.e : "open",
    s: onSouth ? coarse.s : "open",
    w: onWest ? coarse.w : "open",
    doorStates,
  };
}

/**
 * Build one deck sub-cell. The top-left sub-cell of the block (dc === 0,
 * dr === 0) carries any equipment from the source cell; all other sub-cells
 * are plain deck. Edges are projected from the coarse cell via
 * {@link projectedEdges}: a coarse-level wall or door on the cell propagates
 * onto the matching outer sub-cells of the block, while interior edges stay
 * open so crew can traverse the whole block.
 */
function expandDeckSubCell(
  dc: number,
  dr: number,
  equipment: CellEquipment | undefined,
  coarseEdges: CellEdges,
  onNorth: boolean,
  onEast: boolean,
  onSouth: boolean,
  onWest: boolean,
): GridCell {
  const edges = projectedEdges(coarseEdges, onNorth, onEast, onSouth, onWest);
  // Equipment lives on the representative (top-left) sub-cell only.
  if (dc === 0 && dr === 0 && equipment !== undefined) {
    return {
      kind: "solid",
      substrate: true,
      surface: "deck",
      edges,
      equipment,
    };
  }
  return { kind: "solid", substrate: true, surface: "deck", edges };
}

// Export the wall-edges constant for tests that want to assert its shape.
export { OPEN_EDGES as SUBDIVIDE_OPEN_EDGES, WALL_EDGES as SUBDIVIDE_WALL_EDGES };
