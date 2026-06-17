import type { GridCell, TileGrid } from "@/schema/grid";
import type { ShipClassification } from "@/schema/hull";
import type { Vec2 } from "@/schema/primitives";

/**
 * Pure geometry and derivation helpers over a `TileGrid`. No React, no Dexie,
 * no DOM, no catalog dependency — mass is supplied by a resolver so this layer
 * stays decoupled from the bundled data. Deterministic and unit-tested.
 */

/**
 * World size of one grid cell, in battle units. Chosen so a hand-laid grid of
 * a few cells spans roughly the same footprint the old hand-placed slot
 * positions did (the old fighter sat within about ±14 units, a frigate ±28),
 * keeping firing ranges, speeds, and collision radii in the same regime as the
 * pre-grid catalog without needing to re-tune the engine constants.
 */
export const CELL_SIZE = 12;

/** Cell-count tiers for the derived size classification. A cell count at or
 *  below a tier's bound classifies as that tier. Named so the thresholds are
 *  self-documenting rather than magic numbers. */
export const CLASSIFICATION_MAX_CELLS: {
  fighter: number;
  frigate: number;
  cruiser: number;
} = {
  /** Up to this many occupied cells is a fighter. */
  fighter: 4,
  /** Up to this many is a frigate. */
  frigate: 12,
  /** Up to this many is a cruiser; anything larger is a dreadnought. */
  cruiser: 30,
};

/** Index into the flat row-major `cells` array for a (col, row) coordinate. */
export function cellIndex(col: number, row: number, grid: TileGrid): number {
  return row * grid.cols + col;
}

/** The cell at (col, row), or undefined if out of bounds. */
export function cellAt(
  col: number,
  row: number,
  grid: TileGrid,
): GridCell | undefined {
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) {
    return undefined;
  }
  return grid.cells[cellIndex(col, row, grid)];
}

/** Whether a cell is occupied (a hull tile or a module), as opposed to empty. */
export function isOccupied(cell: GridCell | undefined): boolean {
  return cell !== undefined && cell.kind !== "empty";
}

/**
 * Ship-local centre coordinates of the cell at (col, row). The grid is centred
 * on its geometric middle so the centroid of a symmetric ship sits near the
 * origin — the engine's rigid-body physics assumes ship-local coordinates are
 * arranged around (0, 0). A cell's centre is its column/row index measured from
 * the grid's centre column/row, scaled by `CELL_SIZE`.
 */
export function cellToLocal(col: number, row: number, grid: TileGrid): Vec2 {
  const centreCol = (grid.cols - 1) / 2;
  const centreRow = (grid.rows - 1) / 2;
  return {
    x: (col - centreCol) * CELL_SIZE,
    y: (row - centreRow) * CELL_SIZE,
  };
}

/** The four edge-sharing neighbours of (col, row), clipped to the grid. */
export function neighbours4(
  col: number,
  row: number,
  grid: TileGrid,
): { col: number; row: number }[] {
  const candidates = [
    { col: col - 1, row },
    { col: col + 1, row },
    { col, row: row - 1 },
    { col, row: row + 1 },
  ];
  return candidates.filter(
    (c) => c.col >= 0 && c.col < grid.cols && c.row >= 0 && c.row < grid.rows,
  );
}

/** The (col, row) coordinates of every occupied cell, in row-major order. */
export function footprint(grid: TileGrid): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (isOccupied(cellAt(col, row, grid))) out.push({ col, row });
    }
  }
  return out;
}

/** Number of occupied (hull or module) cells. */
export function occupiedCount(grid: TileGrid): number {
  return footprint(grid).length;
}

/**
 * Tight integer bounds of the occupied cells: the smallest box that contains
 * every hull/module cell. Undefined when the grid has no occupied cells.
 */
export function bounds(grid: TileGrid):
  | { minCol: number; maxCol: number; minRow: number; maxRow: number }
  | undefined {
  const occupied = footprint(grid);
  if (occupied.length === 0) return undefined;
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const { col, row } of occupied) {
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }
  return { minCol, maxCol, minRow, maxRow };
}

/**
 * Mass-weighted ship-local centroid of the occupied cells. `cellMass` resolves
 * a cell to its mass (hull-tile mass or module mass); cells of zero mass still
 * count toward geometry. Returns the origin when the grid is empty or massless.
 */
export function centroid(
  grid: TileGrid,
  cellMass: (cell: GridCell) => number,
): Vec2 {
  let massSum = 0;
  let mx = 0;
  let my = 0;
  for (const { col, row } of footprint(grid)) {
    const cell = cellAt(col, row, grid);
    if (cell === undefined) continue;
    const m = cellMass(cell);
    const local = cellToLocal(col, row, grid);
    massSum += m;
    mx += m * local.x;
    my += m * local.y;
  }
  if (massSum <= 0) return { x: 0, y: 0 };
  return { x: mx / massSum, y: my / massSum };
}

/** Derived size tier from the occupied-cell count. */
export function deriveClassification(grid: TileGrid): ShipClassification {
  const count = occupiedCount(grid);
  if (count <= CLASSIFICATION_MAX_CELLS.fighter) return "fighter";
  if (count <= CLASSIFICATION_MAX_CELLS.frigate) return "frigate";
  if (count <= CLASSIFICATION_MAX_CELLS.cruiser) return "cruiser";
  return "dreadnought";
}

/** Total mass: the sum of every occupied cell's mass via the resolver. */
export function deriveMass(
  grid: TileGrid,
  cellMass: (cell: GridCell) => number,
): number {
  let sum = 0;
  for (const { col, row } of footprint(grid)) {
    const cell = cellAt(col, row, grid);
    if (cell !== undefined) sum += cellMass(cell);
  }
  return sum;
}

/**
 * Bounding radius (battle units) of the occupied cells about the ship-local
 * origin: the distance to the farthest cell centre plus half a cell, so the
 * radius encloses the whole footprint. Zero for an empty grid. Used as the
 * broad-phase collision bound, the grid analogue of the old per-class radius.
 */
export function deriveRadius(grid: TileGrid): number {
  let maxDistSq = 0;
  for (const { col, row } of footprint(grid)) {
    const local = cellToLocal(col, row, grid);
    const distSq = local.x * local.x + local.y * local.y;
    if (distSq > maxDistSq) maxDistSq = distSq;
  }
  if (maxDistSq === 0 && occupiedCount(grid) === 0) return 0;
  return Math.sqrt(maxDistSq) + CELL_SIZE / 2;
}

/**
 * Whether every occupied cell is reachable from every other by 4-connected
 * edge steps through occupied cells. A grid with no occupied cells is treated
 * as not connected (an empty ship is not a valid single body). Used by stats
 * validity and as the structural precondition for break-apart.
 */
export function isConnected4(grid: TileGrid): boolean {
  const occupied = footprint(grid);
  if (occupied.length === 0) return false;
  const key = (col: number, row: number): number => row * grid.cols + col;
  const occupiedKeys = new Set(occupied.map((c) => key(c.col, c.row)));
  const start = occupied[0];
  if (start === undefined) return false;
  const seen = new Set<number>([key(start.col, start.row)]);
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const n of neighbours4(current.col, current.row, grid)) {
      const k = key(n.col, n.row);
      if (!occupiedKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      stack.push(n);
    }
  }
  return seen.size === occupiedKeys.size;
}
