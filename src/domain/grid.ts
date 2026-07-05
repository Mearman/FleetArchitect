import type { CellEquipment, GridCell, TileGrid } from "@/schema/grid";
import type { ShipClassification } from "@/schema/armor";
import type { EntityId, Vec2 } from "@/schema/primitives";

/**
 * Pure geometry and derivation helpers over a `TileGrid`. No React, no Dexie,
 * no DOM, no catalog dependency — mass is supplied by a resolver so this layer
 * stays decoupled from the bundled data. Deterministic and unit-tested.
 */

/**
 * Metres spanned by one ship-interior grid cell. The single anchor for the
 * battle's metre scale: a cell is a 1 m square of ship interior, so a ship's
 * physical length in metres equals its occupied-cell span. Every world-space
 * quantity that scales with cell size — `cellToLocal`, `deriveRadius`, the
 * collision/muzzle/mine geometry in the engine, and the per-cell areal masses
 * in the catalogue — derives from this one value, so re-anchoring the scale is
 * a single-line change here.
 */
export const METRES_PER_CELL = 1;

/**
 * World size of one grid cell, in metres. Defined as {@link METRES_PER_CELL}
 * so the metre scale has exactly one source of truth: cell-relative geometry
 * everywhere multiplies by `CELL_SIZE`, and the catalogue's per-cell mass
 * derives its cell area from it too. Each cell is now 1 m across (interiors are
 * authored at 1 m resolution), so a ship's footprint in cells reads directly as
 * its size in metres.
 */
export const CELL_SIZE = METRES_PER_CELL;

/**
 * Spec anchors: the canonical physical length (metres) of each ship class,
 * used by the rescale to re-author hull grids so a built ship's occupied-cell
 * span matches its real-world size. These classify intent — a fighter is a
 * ~20 m strike craft, a frigate ~60 m, a cruiser ~150 m — and are consumed by
 * the grid-authoring and stats layers, not by the engine directly.
 */
export const SHIP_LENGTH_METRES: {
  fighter: number;
  frigate: number;
  cruiser: number;
} = {
  fighter: 20,
  frigate: 60,
  cruiser: 150,
};

/**
 * Spec anchor: the maximum physical length (metres) of a dreadnought-class
 * hull. The largest ship the rescale targets; grids larger than the cruiser
 * tier classify as dreadnoughts and are authored up to this bound.
 */
export const DREADNOUGHT_MAX_LENGTH_M = 300;


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

/** Whether a cell is occupied (a built solid cell), as opposed to empty. */
export function isOccupied(cell: GridCell | undefined): boolean {
  return cell !== undefined && cell.kind === "solid";
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

/**
 * Derived size tier from the hull's bounding-box length in metres. The longest
 * axis of the occupied-cell bounding box (width or height) multiplied by
 * `CELL_SIZE` gives the physical length. Thresholds are taken from
 * {@link SHIP_LENGTH_METRES} and {@link DREADNOUGHT_MAX_LENGTH_M}:
 * - ≤ fighter threshold → "fighter"
 * - ≤ frigate threshold → "frigate"
 * - ≤ cruiser threshold → "cruiser"
 * - anything longer    → "dreadnought"
 *
 * An empty grid (no occupied cells) classifies as "fighter" by convention.
 */
export function deriveClassification(grid: TileGrid): ShipClassification {
  const b = bounds(grid);
  if (b === undefined) return "fighter";
  const widthM = (b.maxCol - b.minCol + 1) * CELL_SIZE;
  const heightM = (b.maxRow - b.minRow + 1) * CELL_SIZE;
  const lengthM = Math.max(widthM, heightM);
  if (lengthM <= SHIP_LENGTH_METRES.fighter) return "fighter";
  if (lengthM <= SHIP_LENGTH_METRES.frigate) return "frigate";
  if (lengthM <= SHIP_LENGTH_METRES.cruiser) return "cruiser";
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
 * Bounding radius (metres) of the occupied cells about the ship-local origin:
 * the distance to the farthest cell centre plus half a cell, so the radius
 * encloses the whole footprint. Zero for an empty grid. Used as the
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
 * Whether a cell is walkable by crew — true only for solid cells whose surface
 * is `deck`. Bare substrate, armor, empty cells, and out-of-bounds are not
 * walkable. A weapon mounted on a deck cell is reachable; a weapon mounted on
 * a bare cell is not (and surfaces as an `unreachableStation` fault).
 */
export function isWalkable(cell: GridCell | undefined): boolean {
  return cell !== undefined && cell.kind === "solid" && cell.surface === "deck";
}

/** The compass direction from `from` to `to`, or `undefined` if the two cells
 *  are not 4-connected neighbours. */
export function edgeDirection(
  from: { col: number; row: number },
  to: { col: number; row: number },
): "n" | "e" | "s" | "w" | undefined {
  if (to.row === from.row - 1 && to.col === from.col) return "n";
  if (to.row === from.row + 1 && to.col === from.col) return "s";
  if (to.col === from.col + 1 && to.row === from.row) return "e";
  if (to.col === from.col - 1 && to.row === from.row) return "w";
  return undefined;
}

/**
 * Whether the edge from `from` to `to` is passable for crew. Requires both
 * cells to be walkable (deck surface) and the shared edge — read off `from`'s
 * edge record in the direction of `to` — to be `open` or a `door`. Doors are
 * passable in either state: crew open them to step through, then close them
 * behind (matching the sim crew-pathfinder in `crew-pathfinding.ts`). The
 * open/closed distinction governs atmosphere tightness, modelled separately in
 * `interior.ts` via `doorStates` — not here. Walls, armor, and bare cells
 * block.
 */
export function edgePassable(
  from: { col: number; row: number },
  to: { col: number; row: number },
  grid: TileGrid,
): boolean {
  const fromCell = cellAt(from.col, from.row, grid);
  const toCell = cellAt(to.col, to.row, grid);
  if (fromCell === undefined || fromCell.kind !== "solid") return false;
  if (toCell === undefined || toCell.kind !== "solid") return false;
  if (fromCell.surface !== "deck" || toCell.surface !== "deck") return false;
  const dir = edgeDirection(from, to);
  if (dir === undefined) return false;
  const edge = fromCell.edges[dir];
  if (edge === "open") return true;
  if (edge === "door") return true; // crew open closed doors to pass
  return false; // wall
}

/**
 * The 4-connected in-bounds neighbours of (col, row) reachable by crew: deck
 * cells whose shared edge is open or a door (open or closed — crew open them).
 * Reuses `neighbours4` and `edgePassable`; the crew pathfinder calls this to
 * discover the next reachable cells from any position.
 */
export function walkableNeighbours4(
  col: number,
  row: number,
  grid: TileGrid,
): { col: number; row: number }[] {
  const here = { col, row };
  return neighbours4(col, row, grid).filter((n) => edgePassable(here, n, grid));
}

/**
 * The canonical string key for a grid cell, used consistently across the grid
 * toolkit and the simulation engine.
 */
function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Flood-fill over walkable cells from `start`, returning the set of reachable
 * cell keys (`"col,row"`) including the start cell itself. Returns an empty set
 * if `start` is not walkable or is out of bounds. Pure BFS; no RNG.
 */
export function reachableFrom(
  grid: TileGrid,
  start: { col: number; row: number },
): Set<string> {
  if (!isWalkable(cellAt(start.col, start.row, grid))) return new Set();
  const visited = new Set<string>([cellKey(start.col, start.row)]);
  const queue: { col: number; row: number }[] = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const n of walkableNeighbours4(current.col, current.row, grid)) {
      const k = cellKey(n.col, n.row);
      if (!visited.has(k)) {
        visited.add(k);
        queue.push(n);
      }
    }
  }
  return visited;
}

/**
 * A* shortest path over walkable cells from `from` to `to`, inclusive of both
 * endpoints. Returns `undefined` if `to` is unreachable (blocked or
 * out-of-bounds) or if either endpoint is not walkable.
 *
 * **Determinism guarantee:** ties in the A* frontier are broken by a fixed
 * total order — lowest f-score first, then lowest row, then lowest col. This
 * means two calls with identical inputs always produce the byte-identical path
 * regardless of Map/Set insertion-order variance. No RNG is used anywhere.
 *
 * Heuristic: Manhattan distance, which is admissible on a 4-connected grid.
 */
export function findPath(
  grid: TileGrid,
  from: { col: number; row: number },
  to: { col: number; row: number },
): { col: number; row: number }[] | undefined {
  if (!isWalkable(cellAt(from.col, from.row, grid))) return undefined;
  if (!isWalkable(cellAt(to.col, to.row, grid))) return undefined;

  // Early exit for trivial same-cell case.
  if (from.col === to.col && from.row === to.row) return [{ col: from.col, row: from.row }];

  const heuristic = (col: number, row: number): number =>
    Math.abs(col - to.col) + Math.abs(row - to.row);

  // g-score: cost from start to this cell. Stored as a map keyed by "col,row".
  const gScore = new Map<string, number>();
  // f-score: g + h. Determines priority.
  const fScore = new Map<string, number>();
  // For path reconstruction.
  const cameFrom = new Map<string, { col: number; row: number }>();

  const startKey = cellKey(from.col, from.row);
  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(from.col, from.row));

  // Open set as a sorted array. We keep it sorted by the tie-break total order:
  // (f ascending, row ascending, col ascending). This is a min-heap substitute
  // that is simple, correct, and fully deterministic.
  const open: { col: number; row: number; f: number }[] = [
    { col: from.col, row: from.row, f: heuristic(from.col, from.row) },
  ];

  const insertSorted = (entry: { col: number; row: number; f: number }): void => {
    // Binary-search insertion to maintain sorted order. The comparator is:
    // (a, b) -> a.f - b.f, then a.row - b.row, then a.col - b.col.
    let lo = 0;
    let hi = open.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = open[mid];
      if (m === undefined) break;
      if (
        m.f < entry.f ||
        (m.f === entry.f && m.row < entry.row) ||
        (m.f === entry.f && m.row === entry.row && m.col < entry.col)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    open.splice(lo, 0, entry);
  };

  const openKeys = new Set<string>([startKey]);

  while (open.length > 0) {
    const current = open.shift();
    if (current === undefined) break;
    const currentKey = cellKey(current.col, current.row);
    openKeys.delete(currentKey);

    // Reached the goal — reconstruct path.
    if (current.col === to.col && current.row === to.row) {
      const path: { col: number; row: number }[] = [
        { col: current.col, row: current.row },
      ];
      let key = currentKey;
      for (;;) {
        const prev = cameFrom.get(key);
        if (prev === undefined) break;
        path.unshift({ col: prev.col, row: prev.row });
        key = cellKey(prev.col, prev.row);
      }
      return path;
    }

    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const n of walkableNeighbours4(current.col, current.row, grid)) {
      const nKey = cellKey(n.col, n.row);
      const tentativeG = currentG + 1;
      const existingG = gScore.get(nKey) ?? Infinity;
      if (tentativeG < existingG) {
        cameFrom.set(nKey, { col: current.col, row: current.row });
        gScore.set(nKey, tentativeG);
        const f = tentativeG + heuristic(n.col, n.row);
        fScore.set(nKey, f);
        if (!openKeys.has(nKey)) {
          openKeys.add(nKey);
          insertSorted({ col: n.col, row: n.row, f });
        } else {
          // Update: remove old entry and re-insert with new f.
          const idx = open.findIndex((e) => e.col === n.col && e.row === n.row);
          if (idx !== -1) open.splice(idx, 1);
          insertSorted({ col: n.col, row: n.row, f });
        }
      }
    }
  }

  // No path found.
  return undefined;
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

// ---------------------------------------------------------------------------
// Polyomino (multi-cell module) placement.
// ---------------------------------------------------------------------------

/**
 * A module placed on the grid, yielded once at its anchor. The equipment is the
 * anchor's record (with `moduleId` defined); covered cells of the same module
 * are NOT yielded separately — they are skipped because their equipment carries
 * a `covers` back-pointer instead of a `moduleId`.
 */
export interface PlacedModule {
  /** Anchor cell column. */
  readonly col: number;
  /** Anchor cell row. */
  readonly row: number;
  /** The anchor's equipment record. `equipment.moduleId` is always defined for
   *  a `PlacedModule` (covered cells, whose `moduleId` is undefined, are not
   *  yielded). */
  readonly equipment: CellEquipment;
  /** The module id installed at this anchor (narrowed from
   *  `equipment.moduleId` for caller convenience). */
  readonly moduleId: EntityId;
}

/**
 * Yield each placed module once, at its anchor, in row-major anchor order. A
 * covered cell (one whose equipment carries a `covers` back-pointer rather than
 * a `moduleId`) is skipped — it belongs to the anchor identified by its
 * `covers.anchorCol`/`covers.anchorRow`, which is yielded in its place.
 *
 * This is the single migration target for every site that today iterates
 * `cell.equipment` per cell and would otherwise double-count a multi-cell
 * module: stats aggregation, per-module reads in resolve, faction collection,
 * hardwire endpoints, etc. For an all-1x1 grid (every anchor has no covered
 * cells), this yields exactly one `PlacedModule` per equipment cell, in the
 * same row-major order the per-cell walk produces — so the migration is a
 * no-op for existing designs.
 *
 * Pure and deterministic: no catalog dependency (the `covers` back-pointer on
 * each covered cell is sufficient to identify anchors vs covered cells without
 * resolving footprints), no RNG, no Map/Set insertion-order dependence.
 */
export function placedModules(grid: TileGrid): PlacedModule[] {
  const out: PlacedModule[] = [];
  for (const { col, row } of footprint(grid)) {
    const cell = cellAt(col, row, grid);
    if (cell === undefined || cell.kind !== "solid") continue;
    const equipment = cell.equipment;
    if (equipment === undefined) continue;
    // Anchors carry moduleId; covered cells carry covers (and no moduleId).
    // The CellEquipment refine guarantees exactly one is set.
    if (equipment.moduleId === undefined) continue;
    out.push({ col, row, equipment, moduleId: equipment.moduleId });
  }
  return out;
}
