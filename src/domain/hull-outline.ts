import type { TileGrid } from "@/schema/grid";
import type { Vec2 } from "@/schema/primitives";
import { CELL_SIZE } from "@/domain/grid";
import { computeOutline, type Shell } from "@/domain/outline";

/**
 * The grown-and-bevelled hull outline used for *rendering* (collision/hitscan
 * stays on the tight `computeOutline`). It realises the design locked in with
 * the user:
 *
 *   - GROW: a one-cell armour layer is added outside every deck cell that faces
 *     open space (its wall "grows outward into armour"), never over deck. This
 *     pushes the hull boundary outside the deck's walls so the boundary is all
 *     armour — cuttable plate — with the walls safely interior.
 *   - BEVEL: every 90-degree corner of the resulting footprint is turned into a
 *     45-degree facet, so the silhouette is octilinear with no right angles.
 *   - INVARIANTS (HARD): every turn is a multiple of 45 degrees and every
 *     diagonal facet is at least one cell diagonal (sqrt 2). Features too small
 *     to carry a sqrt-2 facet are absorbed rather than left as a right angle.
 *
 * Everything runs on the integer lattice (a one-cell chamfer of integer corners
 * yields integer endpoints, so facets are exactly sqrt 2 and angles are exactly
 * 45 degrees by construction); the absorb pass removes the small features that
 * would otherwise force a sub-sqrt-2 facet or a surviving right angle.
 */

// ---------------------------------------------------------------------------
// Grow: add a one-cell armour layer outside exposed deck.
// ---------------------------------------------------------------------------

/**
 * Build the grown footprint Shell from a grid: every built (solid) cell, plus
 * each empty cell orthogonally adjacent to a deck cell (the deck's outward wall
 * grown into armour). The grid is expanded by a one-cell border so grown cells
 * on the original edge have room. Coordinates are in the expanded grid; because
 * the border is symmetric, `toMetreLoop` on the expanded dimensions centres
 * identically to the original grid.
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
      // Grow: an empty cell that touches deck across one of its four edges
      // becomes armour (the wall there grows outward). Deck never overgrown
      // because grown cells are, by definition, not solid.
      const grow =
        !here &&
        (isDeck(c - 1, r) || isDeck(c + 1, r) || isDeck(c, r - 1) || isDeck(c, r + 1));
      if (here || grow) cells.add((r + 1) * ncols + (c + 1));
    }
  }
  return { cols: ncols, rows: nrows, cells };
}

// ---------------------------------------------------------------------------
// Bevel: octilinear, no 90, facets >= sqrt 2.
// ---------------------------------------------------------------------------

const EPS = CELL_SIZE * 1e-6;

/** Unit direction a->b. */
function dir(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/** Signed turn angle (radians, abs) at the junction of incoming `din` -> `dout`. */
function turnAngle(din: Vec2, dout: Vec2): number {
  const cross = din.x * dout.y - din.y * dout.x;
  const dot = din.x * dout.x + din.y * dout.y;
  return Math.abs(Math.atan2(cross, dot));
}

/** Drop consecutive duplicate and collinear vertices (metre space). */
function clean(loop: Vec2[]): Vec2[] {
  let pts = loop.filter((p, i) => {
    const q = loop[(i - 1 + loop.length) % loop.length]!;
    return Math.hypot(p.x - q.x, p.y - q.y) > EPS;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const n = pts.length;
      const a = pts[(i - 1 + n) % n]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % n]!;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < EPS * CELL_SIZE) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * Chamfer every ~90-degree corner of an already-octilinear loop into a 45-degree
 * facet of one cell (sqrt 2). The input comes from `computeOutline`, so its
 * staircases are already single 45-degree diagonals and only isolated convex
 * shoulders / concave notches remain at 90 degrees; those are the corners we
 * bevel. A corner between an axis edge and a 45-degree diagonal is already a
 * 45-degree turn and is left alone. The chamfer length is one cell, capped at
 * half each adjacent edge so two chamfers never cross; on a corner whose edges
 * are both >= 2 cells this yields an exact sqrt-2 facet on the lattice.
 */
function bevelCorners(loop: Vec2[]): Vec2[] {
  const n = loop.length;
  const out: Vec2[] = [];
  const C = CELL_SIZE;
  for (let i = 0; i < n; i += 1) {
    const p = loop[(i - 1 + n) % n]!;
    const v = loop[i]!;
    const w = loop[(i + 1) % n]!;
    const din = dir(p, v);
    const dout = dir(v, w);
    const turn = turnAngle(din, dout);
    if (Math.abs(turn - Math.PI / 2) > 0.2) {
      out.push(v); // not a right angle (axis<->diagonal junction etc.)
      continue;
    }
    const inLen = Math.hypot(v.x - p.x, v.y - p.y);
    const outLen = Math.hypot(w.x - v.x, w.y - v.y);
    const c = Math.min(C, inLen / 2, outLen / 2);
    out.push({ x: v.x - c * din.x, y: v.y - c * din.y });
    out.push({ x: v.x + c * dout.x, y: v.y + c * dout.y });
  }
  return clean(out);
}

/** Whether segment a->b is axis-aligned or a 45-degree diagonal. */
function isOctilinear(a: Vec2, b: Vec2): boolean {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx < EPS || dy < EPS || Math.abs(dx - dy) < EPS;
}

/**
 * Absorb features too small to carry a sqrt-2 facet (HARD). A narrow tab or
 * notch shows up as a short edge (< two cells) whose two flanking edges are
 * *antiparallel* — the boundary went out and came straight back, or in and back
 * out. Collapsing such a cap by dropping its two endpoints and joining the
 * flanks removes the feature; a staircase *step* instead has parallel flanks, so
 * it is never collapsed (which is what keeps diagonals intact). The collapse is
 * only taken when the rejoined edge stays octilinear, so the loop never gains an
 * illegal direction. Repeats to a fixpoint; deterministic (lowest index first).
 */
function absorbSmallFeatures(loop: Vec2[]): Vec2[] {
  let pts = loop.slice();
  let guard = 0;
  const minCap = 3 * CELL_SIZE - EPS;
  while (pts.length > 4 && guard < pts.length * 4) {
    guard += 1;
    const n = pts.length;
    let collapsed = false;
    for (let i = 0; i < n; i += 1) {
      const a = pts[(i - 1 + n) % n]!; // before cap
      const b = pts[i]!; // cap start
      const c = pts[(i + 1) % n]!; // cap end
      const d = pts[(i + 2) % n]!; // after cap
      const capLen = Math.hypot(c.x - b.x, c.y - b.y);
      if (capLen >= minCap) continue;
      const fIn = dir(a, b);
      const fOut = dir(c, d);
      // antiparallel flanks => a tab/notch cap, not a staircase step
      if (Math.abs(fIn.x + fOut.x) > EPS || Math.abs(fIn.y + fOut.y) > EPS) continue;
      if (!isOctilinear(a, d)) continue; // joined edge must stay legal
      pts = pts.filter((_p, j) => j !== i && j !== (i + 1) % n);
      pts = clean(pts);
      collapsed = true;
      break;
    }
    if (!collapsed) break;
  }
  return pts;
}

/**
 * Compute the grown, bevelled hull outline polygon(s) for a ship grid, in
 * ship-local metres, clockwise wound — for rendering. Staircases are smoothed by
 * `computeOutline`, small features are absorbed (HARD), then every remaining
 * 90-degree corner is bevelled to a 45-degree sqrt-2 facet — so the silhouette
 * is octilinear with no right angles and every facet is at least sqrt 2.
 * Deterministic.
 */
export function computeHullOutline(grid: TileGrid): Vec2[][] {
  const shell = growFootprint(grid);
  return computeOutline(shell)
    .map((loop) => bevelCorners(absorbSmallFeatures(loop)))
    .filter((loop) => loop.length >= 3);
}
