import {
  cellAt,
  edgeDirection,
  isWalkable,
  neighbours4,
} from "@/domain/grid";
import type { TileGrid } from "@/schema/grid";

/**
 * Airtightness and compartment flood-fill over a ship's grid. Pure and
 * deterministic: cells are visited in row-major order and the flood-fill is a
 * FIFO BFS, so two runs over the same grid produce identical compartment
 * membership and order.
 */

/** A maximal deck region connected through passable edges (open or open door). */
export interface Compartment {
  /** `"col,row"` keys of the deck cells in this compartment. */
  cells: ReadonlySet<string>;
  /** Whether every perimeter edge of this compartment is `wall`, `door:closed`,
   *  or borders an armor cell. Any `open` edge or `open` door on the perimeter
   *  breaches the compartment. */
  airtight: boolean;
}

/**
 * Partition a grid's deck cells into compartments by flood-filling through
 * passable edges (open or open door). Deterministic: cells visited in
 * row-major order, flood-fill uses a FIFO queue (BFS), so two runs over the
 * same grid yield identical compartment membership and order.
 */
export function computeCompartments(grid: TileGrid): Compartment[] {
  const visited = new Set<string>();
  const compartments: Compartment[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const key = `${col},${row}`;
      if (visited.has(key)) continue;
      const cell = cellAt(col, row, grid);
      if (!isWalkable(cell)) continue;
      const cells = new Set<string>([key]);
      const queue: { col: number; row: number }[] = [{ col, row }];
      visited.add(key);
      while (queue.length > 0) {
        const cur = queue.shift();
        if (cur === undefined) break;
        const curCell = cellAt(cur.col, cur.row, grid);
        if (curCell === undefined || curCell.kind !== "solid") continue;
        for (const n of neighbours4(cur.col, cur.row, grid)) {
          const nKey = `${n.col},${n.row}`;
          if (visited.has(nKey)) continue;
          const nCell = cellAt(n.col, n.row, grid);
          if (!isWalkable(nCell) || nCell?.kind !== "solid") continue;
          const dir = edgeDirection(cur, n);
          if (dir === undefined) continue;
          const edge = curCell.edges[dir];
          if (edge === "open") {
            // passable
          } else if (edge === "door" && curCell.edges.doorStates[dir] === "open") {
            // passable
          } else {
            continue; // wall or closed door — does not connect
          }
          visited.add(nKey);
          cells.add(nKey);
          queue.push(n);
        }
      }
      compartments.push({ cells, airtight: isAirtight(grid, cells) });
    }
  }
  return compartments;
}

/**
 * Whether a compartment is airtight: every perimeter edge — an edge whose
 * neighbour is outside the compartment (a non-deck cell, an out-of-grid cell,
 * or a deck cell in a different compartment) — must be `wall`, `door:closed`,
 * or border an armor/bare/empty cell. Any `open` edge or `open` door on the
 * perimeter breaches it. Walkable edges that lead to a deck cell inside the
 * compartment are interior and do not breach.
 *
 * Grid-boundary edges (where the neighbour is out of bounds) are perimeter
 * edges too: an open edge to the outside of the grid breaches the compartment.
 */
function isAirtight(grid: TileGrid, cells: ReadonlySet<string>): boolean {
  for (const key of cells) {
    const [colStr, rowStr] = key.split(",");
    const col = Number(colStr);
    const row = Number(rowStr);
    const cell = cellAt(col, row, grid);
    if (cell === undefined || cell.kind !== "solid") continue;
    // Check all four edges; for each, determine whether the neighbour is
    // inside the compartment (interior edge) or outside (perimeter edge).
    const dirs: readonly ("n" | "e" | "s" | "w")[] = ["n", "e", "s", "w"];
    for (const dir of dirs) {
      const offset = DIR_OFFSET[dir];
      const nCol = col + offset.dCol;
      const nRow = row + offset.dRow;
      const nKey = `${nCol},${nRow}`;
      if (cells.has(nKey)) continue; // interior edge — does not breach
      // Perimeter edge. The neighbour is outside the compartment. If the
      // neighbour is an armor cell, the armor itself is the barrier and the
      // edge is sealed regardless of the deck cell's own edge state.
      const nCell = cellAt(nCol, nRow, grid);
      if (nCell !== undefined && nCell.kind === "solid" && nCell.surface === "armor") {
        continue; // sealed by the armor neighbour
      }
      // Otherwise the deck cell's own edge state governs: an open edge or
      // open door breaches; wall / closed door / out-of-grid-with-wall seals.
      const edge = cell.edges[dir];
      if (edge === "open") return false;
      if (edge === "door" && cell.edges.doorStates[dir] === "open") return false;
      // wall or closed door: airtight at this edge.
    }
  }
  return true;
}

/** Compass direction → (dCol, dRow) offset. */
const DIR_OFFSET: Record<"n" | "e" | "s" | "w", { dCol: number; dRow: number }> = {
  n: { dCol: 0, dRow: -1 },
  e: { dCol: 1, dRow: 0 },
  s: { dCol: 0, dRow: 1 },
  w: { dCol: -1, dRow: 0 },
};
