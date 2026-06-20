/**
 * Chamfered hull outline for a break-apart chunk. Split out of `damage.ts` so
 * the chunk-construction path keeps its outline geometry in a focused leaf;
 * `damage.ts` imports `computeChunkOutline` from here.
 */

import { computeOutline } from "@/domain/outline";
import type { Shell } from "@/domain/outline";

import type { SimModule } from "./types";

/**
 * Build a chamfered hull outline for a break-apart chunk. The Shell is
 * constructed using the original design-grid dimensions (derived from the
 * parent's full module set) so vertices are centred consistently with the
 * chunk's module.x/y ship-local positions. `outlineMode` defaults to
 * `"hexadecilinear"` (the TileGrid default) — the original mode is not
 * stored on SimShip.
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
    if (m.surface === "armor") cells.add(m.row * cols + m.col);
  }
  if (cells.size === 0) return [];
  const shell: Shell = { cols, rows, cells };
  return computeOutline(shell, { outlineMode: "hexadecilinear" });
}
