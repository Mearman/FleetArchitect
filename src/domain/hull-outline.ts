import type { TileGrid } from "@/schema/grid";
import type { Vec2 } from "@/schema/primitives";
import {
  edgeDirectionAllowed,
  latticeSeedLoops,
  toMetreLoop,
  type IPoint,
  type Shell,
} from "@/domain/outline";

/**
 * The grown-and-bevelled hull outline used for *rendering* (collision/hitscan
 * stays on the tight `computeOutline`). It realises the design locked in with
 * the user:
 *
 *   - GROW: a one-cell armour layer is added outside every deck cell that faces
 *     open space (the deck's outward wall "grows into armour"), never over deck.
 *     This pushes the boundary outside the deck walls so the boundary is all
 *     cuttable armour with the walls safely interior.
 *   - BEVEL: every 90-degree corner becomes a 45-degree facet — staircases (and
 *     lone steps) collapse to diagonals, concave corners fill, isolated convex
 *     shoulders are chamfered.
 *   - INVARIANTS (HARD): every turn is a multiple of 45 degrees (no right
 *     angles) and every diagonal facet is at least one cell diagonal (sqrt 2).
 *     Narrow tab/notch features too small to carry a sqrt-2 facet are absorbed.
 *
 * Everything runs on the integer lattice: a one-cell chamfer of integer corners
 * yields integer endpoints, so facets are exactly sqrt 2 and angles exactly 45
 * degrees by construction. The genuine exception is a feature smaller than three
 * cells (a 2x2 block bevels to a diamond whose tips are new right angles): no
 * octilinear shape that small has sqrt-2 facets, so it would have to grow. Real
 * ships are 1 m-subdivided and never hit this.
 */

// ---------------------------------------------------------------------------
// Grow: add a one-cell armour layer outside exposed deck.
// ---------------------------------------------------------------------------

/**
 * Build the grown footprint Shell from a grid: every built (solid) cell, plus
 * each empty cell orthogonally adjacent to a deck cell (the deck's outward wall
 * grown into armour). The grid is expanded by a one-cell border so grown cells
 * on the original edge have room. Because the border is symmetric, `toMetreLoop`
 * on the expanded dimensions centres identically to the original grid.
 */
export function growFootprint(grid: TileGrid): Shell {
  const { cols, rows } = grid;
  const isSolid = (c: number, r: number): boolean => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    return grid.cells[r * cols + c]?.kind === "solid";
  };
  const isDeck = (c: number, r: number): boolean => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const cell = grid.cells[r * cols + c];
    return cell?.kind === "solid" && cell.surface === "deck";
  };
  const ncols = cols + 2;
  const nrows = rows + 2;
  const cells = new Set<number>();
  for (let r = -1; r <= rows; r += 1) {
    for (let c = -1; c <= cols; c += 1) {
      const here = isSolid(c, r);
      const grow =
        !here &&
        (isDeck(c - 1, r) || isDeck(c + 1, r) || isDeck(c, r - 1) || isDeck(c, r + 1));
      if (here || grow) cells.add((r + 1) * ncols + (c + 1));
    }
  }
  return { cols: ncols, rows: nrows, cells };
}

// ---------------------------------------------------------------------------
// Integer-lattice geometry helpers.
// ---------------------------------------------------------------------------

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Twice the signed area of triangle (a, b, c). */
function orient2(a: IPoint, b: IPoint, c: IPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Whether segments [p1,p2] and [p3,p4] properly cross (interior intersection). */
function segmentsProperlyIntersect(
  p1: IPoint,
  p2: IPoint,
  p3: IPoint,
  p4: IPoint,
): boolean {
  const d1 = orient2(p3, p4, p1);
  const d2 = orient2(p3, p4, p2);
  const d3 = orient2(p1, p2, p3);
  const d4 = orient2(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/** Whether the chord u->w (replacing vertex at `vi`) crosses a non-adjacent edge. */
function chordKeepsSimple(poly: readonly IPoint[], vi: number, u: IPoint, w: IPoint): boolean {
  const n = poly.length;
  const prevIdx = (vi - 1 + n) % n;
  const nextIdx = (vi + 1) % n;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    if (i === prevIdx || i === vi || i === nextIdx) continue;
    if (j === prevIdx || j === nextIdx) continue;
    if (segmentsProperlyIntersect(u, w, poly[i]!, poly[j]!)) return false;
  }
  return true;
}

/** Drop vertices collinear with their neighbours. */
function collapseCollinear(poly: IPoint[]): IPoint[] {
  let pts = poly;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const n = pts.length;
      if (orient2(pts[(i - 1 + n) % n]!, pts[i]!, pts[(i + 1) % n]!) === 0) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        changed = true;
        break;
      }
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Absorb narrow tabs / notches (HARD: features < 3 cells can't carry sqrt 2).
// ---------------------------------------------------------------------------

/**
 * Collapse a tab or notch narrower than three cells: a short cap edge whose two
 * flanking edges are *antiparallel* (boundary went out and straight back). A
 * staircase step has *parallel* flanks, so it is never collapsed — diagonals
 * survive. Only taken when the rejoined edge is octilinear. Fixpoint,
 * deterministic (lowest index first).
 */
function absorbTabs(poly: IPoint[]): IPoint[] {
  let pts = poly.slice();
  let guard = 0;
  while (pts.length > 4 && guard < pts.length * 4) {
    guard += 1;
    const n = pts.length;
    let done = false;
    for (let i = 0; i < n; i += 1) {
      const a = pts[(i - 1 + n) % n]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % n]!;
      const d = pts[(i + 2) % n]!;
      const capLen = Math.hypot(c.x - b.x, c.y - b.y);
      if (capLen >= 3) continue;
      const fIn = { x: sign(b.x - a.x), y: sign(b.y - a.y) };
      const fOut = { x: sign(d.x - c.x), y: sign(d.y - c.y) };
      if (fIn.x + fOut.x !== 0 || fIn.y + fOut.y !== 0) continue; // not antiparallel
      if (!edgeDirectionAllowed(d.x - a.x, d.y - a.y)) continue; // join must stay octilinear
      pts = collapseCollinear(pts.filter((_p, j) => j !== i && j !== (i + 1) % n));
      done = true;
      break;
    }
    if (!done) break;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Smooth: collapse every step (staircases and lone steps) and fill concave
// corners by removing reflex vertices whose bridging chord is octilinear.
// ---------------------------------------------------------------------------

/** Perpendicular distance (lattice units) from v to the line through u and w. */
function distToLine(v: IPoint, u: IPoint, w: IPoint): number {
  const len = Math.hypot(w.x - u.x, w.y - u.y);
  if (len === 0) return Math.hypot(v.x - u.x, v.y - u.y);
  return Math.abs((w.x - u.x) * (v.y - u.y) - (w.y - u.y) * (v.x - u.x)) / len;
}

/** A reflex bridge may not pull the hull more than this far (cells) off the
 *  footprint — keeps the hull hugging the cells (no big gaps over coarse
 *  staircases). One cell admits collapsing 1-cell-step (45-degree) staircases to
 *  clean diagonals; coarser steps stay stepped and are merely corner-bevelled. */
const MAX_DEVIATION = 1 + 1e-9;

/**
 * Remove every reflex vertex whose chord to its neighbours is octilinear, keeps
 * the polygon simple, and stays within one cell of the vertex it bridges.
 * Unlike the tight outline's gated smoother this is ungated by run length, so a
 * *lone* step collapses to a single sqrt-2 diagonal and an isolated concave
 * corner fills with one — what "no 90 degrees" needs. The deviation cap means a
 * fine (1-cell-step) staircase collapses to one diagonal while a coarse
 * staircase keeps its steps, so the hull never gaps far from the plating.
 */
function smoothReflex(poly: IPoint[]): IPoint[] {
  let pts = poly;
  let progressed = true;
  while (progressed && pts.length > 3) {
    progressed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const n = pts.length;
      const u = pts[(i - 1 + n) % n]!;
      const v = pts[i]!;
      const w = pts[(i + 1) % n]!;
      // CW (y-down): reflex turn has negative cross.
      if ((v.x - u.x) * (w.y - v.y) - (v.y - u.y) * (w.x - v.x) >= 0) continue;
      if (!edgeDirectionAllowed(w.x - u.x, w.y - u.y)) continue;
      if (distToLine(v, u, w) > MAX_DEVIATION) continue;
      if (!chordKeepsSimple(pts, i, u, w)) continue;
      pts = collapseCollinear(pts.slice(0, i).concat(pts.slice(i + 1)));
      progressed = true;
      break;
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Chamfer the remaining isolated 90-degree corners (convex shoulders, wide
// concave corners) into sqrt-2 facets.
// ---------------------------------------------------------------------------

/**
 * Chamfer every axis-to-axis right angle by one cell along each edge, capped at
 * half the edge so two chamfers never collide. With the smaller features already
 * absorbed/smoothed the remaining corners sit on edges >= 2 cells, so each
 * chamfer is an exact integer sqrt-2 facet. Corners that already involve a
 * diagonal edge are 45-degree turns and are left alone.
 */
function chamferRightAngles(poly: IPoint[]): IPoint[] {
  const n = poly.length;
  const out: IPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = poly[(i - 1 + n) % n]!;
    const v = poly[i]!;
    const w = poly[(i + 1) % n]!;
    const din = { x: sign(v.x - p.x), y: sign(v.y - p.y) };
    const dout = { x: sign(w.x - v.x), y: sign(w.y - v.y) };
    const axisIn = din.x === 0 || din.y === 0;
    const axisOut = dout.x === 0 || dout.y === 0;
    const rightAngle = axisIn && axisOut && din.x * dout.x + din.y * dout.y === 0;
    if (!rightAngle) {
      out.push(v);
      continue;
    }
    const inLen = Math.hypot(v.x - p.x, v.y - p.y);
    const outLen = Math.hypot(w.x - v.x, w.y - v.y);
    const k = Math.min(1, Math.floor(inLen) / 2, Math.floor(outLen) / 2) || 0.5;
    out.push({ x: v.x - k * din.x, y: v.y - k * din.y });
    out.push({ x: v.x + k * dout.x, y: v.y + k * dout.y });
  }
  return collapseCollinear(out);
}

function bevelLoop(seed: IPoint[]): IPoint[] {
  if (seed.length < 4) return seed;
  return chamferRightAngles(smoothReflex(absorbTabs(seed)));
}

/**
 * Compute the grown, bevelled hull outline polygon(s) for a ship grid, in
 * ship-local metres, clockwise wound — for rendering. Octilinear, no right
 * angles, every facet at least sqrt 2 (for features >= 3 cells), containing
 * every armour cell. Deterministic.
 */
export function computeHullOutline(grid: TileGrid): Vec2[][] {
  const shell = growFootprint(grid);
  return latticeSeedLoops(shell)
    .map((seed) => bevelLoop(seed))
    .filter((loop) => loop.length >= 3)
    .map((loop) => toMetreLoop(loop, shell.cols, shell.rows));
}
