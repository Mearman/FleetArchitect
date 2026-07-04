/**
 * Render-only outline bevel: chamfer each convex 90° (octilinear) corner of a
 * ship's outline into a 45° diagonal so armour corners read as bevelled rather
 * than as sharp lattice squares. The outline DATA is never touched (the engine,
 * the lossless digest, and the silhouette geometry are unchanged); only the
 * rendered clip path is built from the chamfered copy.
 *
 * The helper is pure and unit-agnostic: pass metre-space loops with a metre
 * bevel (the 2-D sprite and the iso path both chamfer in ship-local metres,
 * where the outline is octilinear, then map the result into their own screen
 * space). Chamfering in metre space is essential — under the iso tilt a
 * projected axis-aligned edge is no longer axis-aligned, so the perpendicular
 * / octilinear corner test could not be run on projected (screen-space)
 * vertices.
 */

/** A 2-D point in the chamfer helper's coordinate space (unit-agnostic). */
export interface ChamferPoint {
  x: number;
  y: number;
}

/**
 * Bevel each convex octilinear corner of every loop into a 45° diagonal,
 * cutting the corner back by `bevel` units along the incoming and outgoing
 * edges. Returns a fresh loop list in the same coordinate space as the input;
 * the input is not mutated.
 *
 * A corner is bevelled only when BOTH incident edges are axis-aligned and
 * perpendicular (a true 90° lattice corner), so existing 45° staircase edges
 * produced by outline smoothing and concave notches pass through unchanged.
 * Convexity is detected per loop via the cross-product turn sign measured
 * against the loop's own signed area, so clockwise outer hulls and
 * counter-clockwise holes are both handled without assuming a global winding.
 * Degenerate (zero-length or sub-bevel) edges emit the original vertex, so an
 * offset can never invert past its neighbour.
 */
export function chamferOutline(
  loops: ReadonlyArray<ReadonlyArray<ChamferPoint>>,
  bevel: number,
): ChamferPoint[][] {
  return loops.map((loop) => chamferLoop(loop, bevel));
}

/**
 * Chamfer a single closed loop. The loop is closed implicitly (the last vertex
 * joins back to the first); a loop of fewer than three vertices cannot form a
 * corner and is copied verbatim.
 */
function chamferLoop(loop: ReadonlyArray<ChamferPoint>, bevel: number): ChamferPoint[] {
  const n = loop.length;
  if (n < 3 || bevel <= 0) {
    return loop.map((p) => ({ x: p.x, y: p.y }));
  }
  const area = signedArea(loop);
  const out: ChamferPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];
    if (prev === undefined || curr === undefined || next === undefined) {
      // Unreachable for n >= 3, but noUncheckedIndexedAccess requires the guard.
      if (curr !== undefined) out.push({ x: curr.x, y: curr.y });
      continue;
    }
    const inX = curr.x - prev.x;
    const inY = curr.y - prev.y;
    const outX = next.x - curr.x;
    const outY = next.y - curr.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    // Degenerate or sub-bevel edges: emit the original vertex so the offset
    // never inverts past a neighbour.
    if (inLen < bevel || outLen < bevel) {
      out.push({ x: curr.x, y: curr.y });
      continue;
    }
    // Only bevel axis-aligned perpendicular (octilinear 90°) corners; diagonals
    // from staircase smoothing and collinear junctions pass through untouched.
    const inAxis = inX === 0 || inY === 0;
    const outAxis = outX === 0 || outY === 0;
    const perpendicular = inX * outX + inY * outY === 0;
    if (!inAxis || !outAxis || !perpendicular) {
      out.push({ x: curr.x, y: curr.y });
      continue;
    }
    // Convex corner (turn matches the loop winding): bevel. Concave notches and
    // degenerate (zero-area) loops pass through. In the y-down convention used
    // here, a clockwise loop has positive signed area and convex corners turn
    // the same way (positive cross product); the equality test handles both
    // windings without assuming one.
    const cross = inX * outY - inY * outX;
    const convex = area !== 0 && (cross > 0) === (area > 0);
    if (!convex) {
      out.push({ x: curr.x, y: curr.y });
      continue;
    }
    // Cut the corner: two points offset back along each edge by `bevel`.
    const p1x = curr.x - (bevel * inX) / inLen;
    const p1y = curr.y - (bevel * inY) / inLen;
    const p2x = curr.x + (bevel * outX) / outLen;
    const p2y = curr.y + (bevel * outY) / outLen;
    out.push({ x: p1x, y: p1y }, { x: p2x, y: p2y });
  }
  return out;
}

/**
 * Shoelace signed area of a closed loop. Positive for clockwise winding in the
 * y-down convention used throughout the renderer (matches `polygonSignedArea`
 * in `src/domain/outline.ts`).
 */
function signedArea(loop: ReadonlyArray<ChamferPoint>): number {
  const n = loop.length;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
