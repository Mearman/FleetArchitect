/**
 * Deterministic cell rasterisation for the arena medium.
 *
 * A fast emitter (a projectile, a beam channel) crosses several medium cells in
 * one tick; depositing only at its instantaneous cell leaves a chain of
 * disconnected points at the 500 m pitch. {@link rasterSegmentCells} walks every
 * grid cell a world-space line segment passes through so the deposit can be
 * distributed along the swept path — a continuous trail instead of dots.
 *
 * Determinism: integer Bresenham over the (col, row) lattice with no RNG, then a
 * row-major sort and stable de-duplicate of the visited flat indices. The output
 * is a pure function of the segment endpoints, so two same-seed runs produce
 * byte-identical deposit sets.
 */

import type { MediumField } from "./medium-field";

/**
 * The flat (row-major) cell indices the segment `(x0, y0) → (x1, y1)` passes
 * through, sorted ascending and de-duplicated. Cells outside the grid are
 * skipped. Empty if both endpoints fall in the same cell (the single cell is
 * still returned — a stationary emitter deposits in its own cell).
 *
 * @param field the arena medium field (supplies `widthM`, `heightM`, `pitchM`).
 * @param x0, y0 world-space segment start, metres.
 * @param x1, y1 world-space segment end, metres.
 * @returns unique visited flat cell indices, ascending.
 */
export function rasterSegmentCells(
  field: MediumField,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[] {
  const { widthM, heightM, pitchM } = field.config;
  // World → cell, matching the arena medium's centred-on-origin mapping
  // (cell `(col, row)` centre sits at `((col + 0.5 - widthM / 2) · pitch, …)`).
  const col0 = Math.floor(x0 / pitchM + widthM / 2);
  const row0 = Math.floor(y0 / pitchM + heightM / 2);
  const col1 = Math.floor(x1 / pitchM + widthM / 2);
  const row1 = Math.floor(y1 / pitchM + heightM / 2);
  const dx = Math.abs(col1 - col0);
  const dy = Math.abs(row1 - row0);
  const sx = col0 < col1 ? 1 : -1;
  const sy = row0 < row1 ? 1 : -1;
  let err = dx - dy;
  let cx = col0;
  let cy = row0;
  const visited: number[] = [];
  // Integer Bresenham over the lattice. Visits at most `max(dx, dy) + 1` cells;
  // bound the loop by the segment's cell-length as a safety net (the
  // endpoint-equality test terminates it in at most that many steps regardless).
  const maxSteps = dx + dy + 2;
  for (let step = 0; step <= maxSteps; step += 1) {
    if (cx >= 0 && cx < widthM && cy >= 0 && cy < heightM) {
      visited.push(cy * widthM + cx);
    }
    if (cx === col1 && cy === row1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  // Row-major sort + stable de-duplicate: a diagonal step can revisit a cell, and
  // a canonical ascending order makes the deposit sum a pure function of the
  // visited SET (independent of the Bresenham tie-break).
  visited.sort((a, b) => a - b);
  const out: number[] = [];
  let prev = -1;
  for (const idx of visited) {
    if (idx !== prev) {
      out.push(idx);
      prev = idx;
    }
  }
  return out;
}
