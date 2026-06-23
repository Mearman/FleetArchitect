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
 * Whether the cell at (col, row) is armour. Only armour seeds hull growth: the
 * shell extends and bevels the armour the designer has placed, so a deck (or
 * bare-framing) edge is never auto-clad — armour is grown for armour, not for
 * deck tiles. Out-of-bounds and non-solid cells are never armour.
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
 * Grow an octilinear armour hull around a ship's plating, returning a NEW grid
 * of the same dimensions with the candidate cells set to fresh armour.
 *
 * A candidate is an EXTERIOR empty cell (reachable from the border by a
 * 4-connected flood, so enclosed interior holes are left alone) that is
 * 4-connected-adjacent (N/E/S/W) to at least one ARMOUR cell. Only armour seeds
 * growth, so deck-only ships grow nothing — the shell extends the armour the
 * designer placed. Restricting to orthogonal adjacency naturally leaves diagonal
 * corner cells empty, giving the octilinear cut-corner silhouette; diagonal
 * corners are never filled. (Any solid cell — deck included — still BLOCKS the
 * exterior flood, so an enclosed empty stays interior regardless of surface.)
 *
 * Does NOT resize. If the footprint touches the grid border there is simply no
 * room to grow there; callers that need a guaranteed border `padGrid` first.
 * Connections are carried through unchanged. Pure — the input is not mutated.
 */
export function growArmourHull(grid: TileGrid): TileGrid {
  const { cols, rows } = grid;
  const exterior = exteriorEmpties(grid);
  const cells: GridCell[] = grid.cells.map((cell) => cell);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!exterior[r * cols + c]) continue;
      let adjacent = false;
      for (const [dx, dy] of ORTHO) {
        if (isArmour(grid, c + dx, r + dy)) {
          adjacent = true;
          break;
        }
      }
      if (adjacent) cells[r * cols + c] = freshArmourCell();
    }
  }
  return {
    cols,
    rows,
    cells,
    connections: grid.connections.map((cn) => ({
      from: { col: cn.from.col, row: cn.from.row },
      to: { col: cn.to.col, row: cn.to.row },
      resource: cn.resource,
    })),
  };
}
