/**
 * Shrink-wrap hull outline for a break-apart chunk. Split out of `damage.ts` so
 * the chunk-construction path keeps its outline geometry in a focused leaf;
 * `damage.ts` imports `computeChunkOutline` from here.
 */

import { computeOutline } from "@/domain/outline";
import type { Shell } from "@/domain/outline";
import { computeHullOutline } from "@/domain/hull-outline";
import { ALL_OPEN_EDGES } from "@/schema/grid";
import type { GridCell, TileGrid } from "@/schema/grid";

import type { SimModule } from "./types";

/**
 * Build a shrink-wrap hull outline for a break-apart chunk — the COLLISION
 * outline. The Shell is the chunk's whole contiguous module footprint (matching
 * `extractShell`, whose hull is the contiguous solid region — a chunk's outer
 * skin is its hull), so the chunk wraps as a silhouette rather than only its
 * armour cells. It is built on the original design-grid dimensions (derived from
 * the parent's full module set) so vertices are centred consistently with the
 * chunk's module.x/y ship-local positions. The hull is always traced
 * octilinearly; the bevelled RENDER outline is {@link computeChunkRenderOutline}.
 */
export function computeChunkOutline(
  parentModules: readonly SimModule[],
  chunkModules: readonly SimModule[],
): { x: number; y: number }[][] {
  let maxCol = 0;
  let maxRow = 0;
  for (const m of parentModules) {
    if (m.col > maxCol) maxCol = m.col;
    if (m.row > maxRow) maxRow = m.row;
  }
  const cols = maxCol + 1;
  const rows = maxRow + 1;
  const cells = new Set<number>();
  for (const m of chunkModules) {
    cells.add(m.row * cols + m.col);
  }
  if (cells.size === 0) return [];
  const shell: Shell = { cols, rows, cells };
  return computeOutline(shell);
}

/**
 * The bevelled RENDER outline for a break-apart chunk — the same 45-degree-faceted
 * hull the ship designer renders, so a chunk that splits off does not snap to an
 * octilinear silhouette. Builds a {@link TileGrid} sized to the parent's bounding
 * box (matching {@link computeChunkOutline}'s dimensions, so vertices share the
 * chunk's ship-local coordinate frame), marks each chunk-module cell as solid
 * carrying its own `surface` (so armour corners bevel while deck/bare stay
 * rectilinear — exactly the designer behaviour), and calls
 * {@link computeHullOutline}. Chunk modules carry no walls, so a bare cell with
 * no wall edge is not outline-wrapped, matching the designer render.
 *
 * Render-only — collision stays on {@link computeChunkOutline}.
 */
export function computeChunkRenderOutline(
  parentModules: readonly SimModule[],
  chunkModules: readonly SimModule[],
): { x: number; y: number }[][] {
  let maxCol = 0;
  let maxRow = 0;
  for (const m of parentModules) {
    if (m.col > maxCol) maxCol = m.col;
    if (m.row > maxRow) maxRow = m.row;
  }
  const cols = maxCol + 1;
  const rows = maxRow + 1;
  const cells: GridCell[] = Array.from(
    { length: cols * rows },
    (): GridCell => ({ kind: "empty" }),
  );
  for (const m of chunkModules) {
    cells[m.row * cols + m.col] = {
      kind: "solid",
      substrate: true,
      surface: m.surface,
      edges: ALL_OPEN_EDGES,
    };
  }
  const grid: TileGrid = { cols, rows, cells, connections: [] };
  return computeHullOutline(grid);
}
