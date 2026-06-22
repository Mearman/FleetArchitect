/**
 * Hull-outline polygon geometry: the pure 2D primitives that turn a ship's
 * chamfered hull outline into its authoritative collision shape.
 *
 * `SimShip.outline` is a list of closed loops in ship-LOCAL metres (centred on
 * the ship origin, NOT rotated or translated for the current pose; see
 * `computeOutline` in `@/domain/outline`). It is also computed once at resolve
 * time (and re-derived on break-apart), so it is stale with respect to the live
 * ship pose. For any collision use it must first be brought into world space
 * with the ship's current `(x, y, facing)` — `outlineWorldLoops` does that.
 *
 * Every function here is pure and deterministic: no RNG, no clock, no I/O. Given
 * the same inputs they return byte-identical results, so they preserve the
 * engine's determinism guarantee.
 */

import { cellWorldPosition } from "@/domain/simulation/spatial-hash";

/** A 2D point in metres. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The minimal pose-plus-outline view the world-space transform needs: a ship's
 * position, heading, and ship-local outline loops. Narrower than the full
 * `SimShip` (which satisfies it structurally) so the geometry helpers depend
 * only on what they read — and so tests can supply a bare pose without building
 * a whole SimShip.
 */
export interface OutlinedPose {
  x: number;
  y: number;
  facing: number;
  outline?: { x: number; y: number }[][];
}

/**
 * A ship's hull outline transformed into world space: each ship-local loop is
 * rotated by `ship.facing` and translated by `(ship.x, ship.y)`. Returns one
 * vertex array per loop, in the same order `ship.outline` holds them. The
 * outer hull loop is the largest-area loop (see `outerLoopIndex`), but every
 * loop is returned so a holed hull keeps its inner boundaries.
 *
 * Returns an empty array when the ship has no outline (a bare-substrate hull
 * with no armour shell, or a legacy aggregated ship) — callers fall back to
 * their pre-outline behaviour in that case.
 */
export function outlineWorldLoops(ship: OutlinedPose): Point[][] {
  if (ship.outline === undefined) return [];
  return ship.outline.map((loop) =>
    loop.map((p) => {
      const { wx, wy } = cellWorldPosition(ship.x, ship.y, ship.facing, p.x, p.y);
      return { x: wx, y: wy };
    }),
  );
}

/**
 * The ship's outer hull loop in world space — the single largest-area loop,
 * which is the boundary the ship-ship narrow-phase and hitscan entry trace
 * against. Returns `undefined` when the ship has no outline.
 *
 * Inner loops (holes in a complex hull) are deliberately excluded here: contact
 * and ray entry resolve against the outer silhouette. Callers needing every
 * loop use `outlineWorldLoops` directly.
 */
export function outerWorldLoop(ship: OutlinedPose): Point[] | undefined {
  const loops = outlineWorldLoops(ship);
  if (loops.length === 0) return undefined;
  let best = loops[0]!;
  let bestArea = Math.abs(signedArea(best));
  for (let i = 1; i < loops.length; i += 1) {
    const area = Math.abs(signedArea(loops[i]!));
    if (area > bestArea) {
      bestArea = area;
      best = loops[i]!;
    }
  }
  return best;
}

/** Shoelace signed area of a polygon. Sign depends on winding; callers that
 *  only need magnitude take the absolute value. */
function signedArea(poly: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Closest point on the line segment `[ax,ay]→[bx,by]` to the point `[px,py]`.
 * The result is clamped to the segment, so for a query point off the end of the
 * segment the nearer endpoint is returned. A degenerate (zero-length) segment
 * returns its single point.
 */
export function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Point {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 0) return { x: ax, y: ay };
  // Projection of (p - a) onto (b - a), clamped to the segment [0, 1].
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x: ax + abx * t, y: ay + aby * t };
}

/**
 * Intersection of the ray `[ox,oy] + t·[dx,dy]` (t ≥ 0) with the segment
 * `[ax,ay]→[bx,by]`. Returns the ray parameter `t` of the nearest intersection,
 * or `null` when the ray does not cross the segment (parallel, or the crossing
 * lies behind the origin or off the segment).
 *
 * Standard 2D parametric solve: write the ray point as `o + t·d` and the
 * segment point as `a + u·(b − a)`, solve the 2×2 system. `t` is the distance
 * along the ray (in `d` units); `u ∈ [0, 1]` confirms the hit lies on the
 * segment. The direction `(dx, dy)` need not be a unit vector — `t` is then in
 * units of `|d|` — but callers that want `t` as a metre distance pass a unit
 * direction.
 */
export function raySegmentIntersect(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number | null {
  const ex = bx - ax;
  const ey = by - ay;
  // Denominator of Cramer's rule: the 2D cross product of the ray direction
  // with the segment direction. Zero means the two are parallel (no unique
  // crossing).
  const denom = dx * ey - dy * ex;
  if (denom === 0) return null;
  const acx = ax - ox;
  const acy = ay - oy;
  // t along the ray, u along the segment.
  const t = (acx * ey - acy * ex) / denom;
  const u = (acx * dy - acy * dx) / denom;
  if (t < 0) return null; // crossing is behind the ray origin
  if (u < 0 || u > 1) return null; // crossing is off the segment
  return t;
}

/**
 * The nearest entry of a ray into a closed polygon: the smallest `t ≥ 0` at
 * which `[ox,oy] + t·[dx,dy]` crosses any edge of `poly`, the world-space entry
 * point at that `t`, and the outward unit normal of the crossed edge. Returns
 * `null` when the ray misses the polygon entirely.
 *
 * Tracing every edge and keeping the minimum `t` is correct for both convex and
 * concave polygons — the entry is always the first boundary crossing along the
 * ray regardless of overall shape. The edge normal is taken perpendicular to
 * the crossed edge and flipped to face away from the polygon centroid, so it is
 * the surface normal the round strikes against.
 */
export function rayPolygonEntry(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  poly: readonly Point[],
): { t: number; x: number; y: number; nx: number; ny: number } | null {
  if (poly.length < 2) return null;
  let bestT = Infinity;
  let bestEdge = -1;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const t = raySegmentIntersect(ox, oy, dx, dy, a.x, a.y, b.x, b.y);
    if (t !== null && t < bestT) {
      bestT = t;
      bestEdge = i;
    }
  }
  if (bestEdge < 0) return null;
  const a = poly[bestEdge]!;
  const b = poly[(bestEdge + 1) % poly.length]!;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const elen = Math.hypot(ex, ey);
  // Edge normal candidate (perpendicular to the edge). Orient it outward by
  // flipping it to point away from the polygon centroid.
  let nx = elen > 0 ? -ey / elen : 0;
  let ny = elen > 0 ? ex / elen : 0;
  const centroid = polygonCentroid(poly);
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  if ((midX - centroid.x) * nx + (midY - centroid.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { t: bestT, x: ox + bestT * dx, y: oy + bestT * dy, nx, ny };
}

/** Vertex-average centroid of a polygon. Used to orient an edge normal
 *  outward; the exact area centroid is not required for a sign test. */
function polygonCentroid(poly: readonly Point[]): Point {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
}

/**
 * Whether the point `[px,py]` lies inside the polygon (even-odd ray cast).
 * Boundary points may test either way (a measure-zero case the collision use
 * does not depend on).
 */
export function pointInPolygon(px: number, py: number, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersects =
      a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Whether two polygons overlap, and if so a contact point on `b`'s boundary
 * with the contact normal. Returns `null` when they are disjoint.
 *
 * The test is a separating-axis sweep over `a`'s edges: project every vertex of
 * `b` onto each edge's inward direction. An edge whose every `b`-vertex lies
 * strictly on its outward side separates the two — no overlap. When no edge of
 * `a` separates `b`, the pair overlaps, and the deepest-penetrating vertex of
 * `b` (the one furthest inside across all of `a`'s edges' tightest constraint)
 * is the contact: its projection onto the nearest `a` edge is the contact
 * point, and that edge's outward normal is the contact normal.
 *
 * This is exact for the convex case (most ship hulls). For a concave hull it
 * can pick a slightly wrong edge at a re-entrant corner — acceptable for combat
 * physics, where the contact only seeds the nearest-cell damage routing.
 *
 * The returned normal `(nx, ny)` points outward from `a` (the direction to push
 * `b` to separate), matching the ship-ship contact convention (normal from a
 * toward b).
 */
export function polygonsContact(
  a: readonly Point[],
  b: readonly Point[],
): { x: number; y: number; nx: number; ny: number } | null {
  if (a.length < 3 || b.length < 3) return null;
  const aCentroid = polygonCentroid(a);

  // For each edge of a, the smallest signed inward depth of any b-vertex. A
  // positive value means every b-vertex is on the outward side, so the edge
  // separates and there is no overlap. Across all edges we keep the one whose
  // maximum inward depth is the shallowest (the minimum-penetration axis) — the
  // standard SAT contact edge — and the b-vertex realising it.
  let bestEdge = -1;
  let bestDepth = -Infinity; // most negative inward depth across edges == shallowest penetration
  let bestVertex = -1;

  for (let i = 0; i < a.length; i += 1) {
    const p1 = a[i]!;
    const p2 = a[(i + 1) % a.length]!;
    const ex = p2.x - p1.x;
    const ey = p2.y - p1.y;
    const elen = Math.hypot(ex, ey);
    if (elen <= 0) continue;
    // Outward unit normal of this edge (away from a's centroid).
    let nx = -ey / elen;
    let ny = ex / elen;
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    if ((midX - aCentroid.x) * nx + (midY - aCentroid.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    // Signed distance of each b-vertex outward from this edge. The most
    // negative (deepest inside) governs the edge's penetration; the most
    // positive tells us whether the edge separates.
    let maxOutward = -Infinity; // largest outward distance: >0 means edge may separate
    let deepestInward = Infinity; // smallest (most negative) outward distance
    let deepestVertex = -1;
    for (let k = 0; k < b.length; k += 1) {
      const v = b[k]!;
      const d = (v.x - p1.x) * nx + (v.y - p1.y) * ny;
      if (d > maxOutward) maxOutward = d;
      if (d < deepestInward) {
        deepestInward = d;
        deepestVertex = k;
      }
    }
    if (maxOutward > 0 && allVerticesOutward(b, p1, nx, ny)) {
      // This edge fully separates a from b: no overlap.
      return null;
    }
    // The penetration along this axis is how far the deepest b-vertex sits
    // inside (negative outward distance). The shallowest such penetration
    // across all edges is the SAT minimum-translation axis.
    if (deepestInward > bestDepth) {
      bestDepth = deepestInward;
      bestEdge = i;
      bestVertex = deepestVertex;
    }
  }

  if (bestEdge < 0 || bestVertex < 0) return null;

  const p1 = a[bestEdge]!;
  const p2 = a[(bestEdge + 1) % a.length]!;
  const ex = p2.x - p1.x;
  const ey = p2.y - p1.y;
  const elen = Math.hypot(ex, ey);
  let nx = elen > 0 ? -ey / elen : 1;
  let ny = elen > 0 ? ex / elen : 0;
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  if ((midX - aCentroid.x) * nx + (midY - aCentroid.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  // Contact point: the deepest-penetrating b-vertex projected onto the chosen
  // a-edge, so the point sits on a's boundary along the contact normal.
  const v = b[bestVertex]!;
  const contact = closestPointOnSegment(v.x, v.y, p1.x, p1.y, p2.x, p2.y);
  return { x: contact.x, y: contact.y, nx, ny };
}

/** Whether every vertex of `poly` lies on the outward side of the line through
 *  `origin` with outward normal `(nx, ny)` — the strict separation test for one
 *  SAT axis. A single vertex on the inward side means the axis does not
 *  separate. */
function allVerticesOutward(
  poly: readonly Point[],
  origin: Point,
  nx: number,
  ny: number,
): boolean {
  for (const p of poly) {
    if ((p.x - origin.x) * nx + (p.y - origin.y) * ny <= 0) return false;
  }
  return true;
}
