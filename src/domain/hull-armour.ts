import type { CellEdges, GridCell, SolidCell, TileGrid } from "@/schema/grid";

/**
 * Pure domain operations that grow an octilinear armour hull around a ship's
 * plating. The grid is the single source of truth (`src/schema/grid.ts`): a
 * flat row-major `cells` array of `cols * rows` entries, addressed at index
 * `row * cols + col`.
 *
 * Both functions are pure: they never mutate their inputs and return brand-new
 * grids, deterministic with no clock or randomness.
 */

/** All-wall edges for a fresh armour cell: the plate is the barrier on every
 *  side, so its perimeter is sealed. Mirrors `freshSolidCell("armor")` in
 *  `src/ui/routes/designerGrid.ts` (the private helper is not importable). */
const ARMOUR_EDGES: CellEdges = {
  n: "wall",
  e: "wall",
  s: "wall",
  w: "wall",
  doorStates: {},
};

/** A fresh armour cell: solid substrate, armour surface, sealed on all edges.
 *  A new object every call so two armoured cells never share a reference. */
function freshArmourCell(): SolidCell {
  return {
    kind: "solid",
    substrate: true,
    surface: "armor",
    edges: { ...ARMOUR_EDGES, doorStates: {} },
  };
}

/** The cell at (col, row), or `undefined` when out of bounds. */
function cellAt(grid: TileGrid, col: number, row: number): GridCell | undefined {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return undefined;
  return grid.cells[row * grid.cols + col];
}

/**
 * Whether the cell at (col, row) is armour. Armour seeds the chamfer fill
 * (`isConvexCorner`), so a deck (or bare-framing) edge is never auto-clad —
 * only armour corners are chamfered, never deck tiles. Out-of-bounds and
 * non-solid cells are never armour.
 */
function isArmour(grid: TileGrid, col: number, row: number): boolean {
  const cell = cellAt(grid, col, row);
  return cell !== undefined && cell.kind === "solid" && cell.surface === "armor";
}

/** Whether (col, row) is "empty" for flood-fill purposes: out of grid, or an
 *  entry that is missing or not a solid cell. */
function isEmptySpace(grid: TileGrid, col: number, row: number): boolean {
  const cell = cellAt(grid, col, row);
  return cell === undefined || cell.kind !== "solid";
}

/** The four orthogonal (N/E/S/W) neighbour offsets. */
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** The four diagonal (NW/NE/SW/SE) neighbour offsets. */
const DIAGONALS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * Whether (col, row) is the missing fourth cell of a 2x2 block whose other three
 * cells are armour — i.e. a CONVEX corner of the ring. For some diagonal
 * (dx, dy), both orthogonal flankers (col+dx, row) and (col, row+dy) and the
 * opposite corner (col+dx, row+dy) are armour. A concave notch has only two of
 * the four, so it is left alone (and stays bevel-smoothed).
 */
function isConvexCorner(grid: TileGrid, col: number, row: number): boolean {
  for (const [dx, dy] of DIAGONALS) {
    if (
      isArmour(grid, col + dx, row + dy) &&
      isArmour(grid, col + dx, row) &&
      isArmour(grid, col, row + dy)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether (col, row) is an exterior empty cell in the gap between two armour
 * cells that are diagonally adjacent to each other — i.e. it has two orthogonal
 * armour neighbours that share a corner (are NOT on opposite sides). This fills
 * the inner corner of an L-shaped armour plate, so the armour band reads as
 * solid rather than gappy. The fill is a full armour cell; the coverage system
 * ({@link cellCoverageFractions}) later clips it to a partial block against the
 * bevelled outline, so it contributes proportional HP/mass.
 */
function isDiagonalGap(grid: TileGrid, col: number, row: number): boolean {
  const n = isArmour(grid, col, row - 1);
  const s = isArmour(grid, col, row + 1);
  const e = isArmour(grid, col + 1, row);
  const w = isArmour(grid, col - 1, row);
  return (n && e) || (n && w) || (s && e) || (s && w);
}

/**
 * Return a NEW grid with `pad` empty cells added on every side, so a ship flush
 * to the original border gains room for the hull to grow. New dimensions are
 * `(cols + 2 * pad, rows + 2 * pad)`; every existing cell at (col, row) moves to
 * (col + pad, row + pad) and all other new cells are empty. Every connection's
 * `from`/`to` coordinates are offset by +pad so coordinate lookups stay valid;
 * the resource is preserved. Pure — the input is not mutated.
 */
export function padGrid(grid: TileGrid, pad: number): TileGrid {
  const cols = grid.cols + 2 * pad;
  const rows = grid.rows + 2 * pad;
  const cells: GridCell[] = Array.from({ length: cols * rows }, () => ({
    kind: "empty",
  }));
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const cell = grid.cells[r * grid.cols + c];
      if (cell !== undefined) {
        cells[(r + pad) * cols + (c + pad)] = cell;
      }
    }
  }
  const connections = grid.connections.map((cn) => ({
    from: { col: cn.from.col + pad, row: cn.from.row + pad },
    to: { col: cn.to.col + pad, row: cn.to.row + pad },
    resource: cn.resource,
  }));
  return { cols, rows, cells, connections };
}

/**
 * Compute the set of EXTERIOR empty cells: those reachable by a 4-connected
 * flood-fill of empty/out-of-grid space starting from the virtual border
 * surrounding the grid. Empties NOT reachable (enclosed interior holes) are
 * interior and excluded. Returns a boolean grid keyed by `row * cols + col`,
 * true exactly where the cell is empty AND exterior.
 *
 * The flood walks the padded space `[-1, cols] x [-1, rows]` so the virtual
 * border (one ring outside the grid) seeds the fill; only in-grid empty cells
 * are recorded as exterior.
 */
function exteriorEmpties(grid: TileGrid): boolean[] {
  const { cols, rows } = grid;
  // Padded space coordinates: x in [0, cols+1] maps to col x-1, likewise rows.
  const pcols = cols + 2;
  const prows = rows + 2;
  const visited = new Array<boolean>(pcols * prows).fill(false);
  const exterior = new Array<boolean>(cols * rows).fill(false);
  // Seed the whole virtual border ring (padded coordinate 0 or max on any axis).
  const stack: Array<readonly [number, number]> = [];
  const push = (px: number, py: number): void => {
    if (px < 0 || py < 0 || px >= pcols || py >= prows) return;
    if (visited[py * pcols + px]) return;
    visited[py * pcols + px] = true;
    stack.push([px, py]);
  };
  for (let px = 0; px < pcols; px += 1) {
    push(px, 0);
    push(px, prows - 1);
  }
  for (let py = 0; py < prows; py += 1) {
    push(0, py);
    push(pcols - 1, py);
  }
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) break;
    const [px, py] = top;
    const col = px - 1;
    const row = py - 1;
    // A solid (plating or framing) cell blocks the flood; do not cross it.
    if (!isEmptySpace(grid, col, row)) continue;
    if (col >= 0 && row >= 0 && col < cols && row < rows) {
      exterior[row * cols + col] = true;
    }
    for (const [dx, dy] of ORTHO) push(px + dx, py + dy);
  }
  return exterior;
}

/**
 * Chamfer the authored armour's convex corners, returning a NEW grid of the
 * same dimensions with the diagonal corner cells set to fresh armour.
 *
 * Chamfer only — the orthogonal armour ring was removed: armour is exactly what
 * the designer placed, and growth adds no 1-cell margin around the hull. What
 * remains is the diagonal corner fill that lets the render-time bevel cut a
 * clean sqrt-2 facet at each armour corner: an EXTERIOR empty cell that is the
 * missing fourth of a 2x2 block whose other three cells are armour
 * (`isConvexCorner`). Filling it turns a sharp armour corner into a bevelled
 * one so the cell crop clips it to a PARTIAL armour block instead of a gaping
 * notch. Concave notches (only 2-of-4) stay empty and remain bevel-smoothed.
 *
 * A solid armour block (or a lone armour cell) has no 3-of-4 corner, so it
 * grows nothing: its silhouette stays exactly as authored. Only an armour shape
 * with a missing corner — an L, a step, a 2x2-minus-one — gains a chamfer. Read
 * against the input grid and iterated to fixpoint; it does not cascade —
 * filling a convex corner creates no new 3-of-4 corner further out — but the
 * loop makes that a proof rather than an assumption.
 *
 * Any solid cell — deck included — still BLOCKS the exterior flood, so an
 * enclosed empty stays interior regardless of surface.
 *
 * Does NOT resize. If the footprint touches the grid border there is simply no
 * room to chamfer there; callers that need a guaranteed border `padGrid` first.
 * Connections are carried through unchanged. Pure — the input is not mutated.
 */
export function growArmourHull(grid: TileGrid): TileGrid {
  const { cols, rows } = grid;

  // Armour growth, iterated to fixpoint. Two rules, both checked each iteration:
  // 1. Diagonal gap fill — an exterior empty cell with two orthogonal armour
  //    neighbours that share a corner (the inner gap of an L-shaped plate).
  // 2. Chamfer — an exterior empty cell at a convex corner (3-of-4 in a 2×2).
  // Each iteration snapshots the current cells so reads are consistent.
  let grown = grid.cells;
  let changed = true;
  while (changed) {
    changed = false;
    const snapshot: TileGrid = { cols, rows, cells: grown, connections: grid.connections };
    const exterior = exteriorEmpties(snapshot);
    const next = grown.slice();
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (!exterior[r * cols + c]) continue;
        if (isDiagonalGap(snapshot, c, r) || isConvexCorner(snapshot, c, r)) {
          next[r * cols + c] = freshArmourCell();
          changed = true;
        }
      }
    }
    grown = next;
  }

  return {
    cols,
    rows,
    cells: grown,
    connections: grid.connections.map((cn) => ({
      from: { col: cn.from.col, row: cn.from.row },
      to: { col: cn.to.col, row: cn.to.row },
      resource: cn.resource,
    })),
  };
}
