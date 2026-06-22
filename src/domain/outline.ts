import type { TileGrid } from "@/schema/grid";
import { CELL_SIZE } from "@/domain/grid";
import type { Vec2 } from "@/schema/primitives";

/**
 * Shrink-wrap hull outline tracing.
 *
 * The hull outline is a tight polygon that wraps the ship's protective shell —
 * armour cells plus wall/door edges — through the integer lattice. It is a
 * *shrink-wrapped hull*, not a chamfer and not a convex hull. There is a single
 * outline style, octilinear: every edge is axis-aligned or a 45-degree
 * diagonal. Its properties:
 *
 *   - NO BITE: the polygon contains every solid cell whole (every corner of
 *     every solid cell sits inside-or-on the polygon). It never cuts into solid
 *     plating the way the old chamfer did.
 *   - FOLLOWS SHAPE: genuine concavities are preserved — an L stays an L and a
 *     cross keeps its armpits. The boundary is segmented into monotone runs; a
 *     diagonal staircase is one run of many step corners, while a re-entrant
 *     concavity reverses direction and so splits into separate runs. Only the
 *     staircase runs are smoothed (see `smoothableReflexVertices`), so the test
 *     is structural and scale-invariant — independent of how finely the hull is
 *     subdivided.
 *   - SHARP CORNERS: a convex corner already at an allowed angle stays sharp;
 *     corners are never rounded outward. A plain axis-aligned ship traces the
 *     exact rectilinear boundary.
 *   - SMOOTH AS POSSIBLE: only genuine diagonal staircases are smoothed. A
 *     uniform 45-degree staircase collapses to one straight diagonal; a non-45
 *     staircase stays the tightest stepped 0/45/90 polyline.
 *
 * Algorithm:
 *   - Stage A: trace the exact integer rectilinear staircase seed polygon
 *     (boundary edges -> closed loops -> corner list, dropping straight-through
 *     corners). The seed already satisfies no-bite/follows-shape/sharp-corners;
 *     every later step only removes sub-cell area, so those invariants hold
 *     throughout.
 *   - Stage B: greedy reflex-vertex removal. A reflex vertex is dropped only
 *     when it is part of a multi-step diagonal staircase (so an isolated
 *     re-entrant corner stays sharp), the new chord is axis-aligned or a
 *     45-degree diagonal, and the polygon stays simple. Convex vertices are
 *     never removed (that would cut into solid), which is what keeps the hull
 *     bite-free.
 *   - Stage C: approximate each remaining non-45 reflex run with {axis,
 *     45-degree} steps, the tightest superset stepped polyline.
 *   - Stage D: centre on the grid and scale to ship-local metres.
 *
 * Determinism anchors (all of them):
 *   - Boundary edges are enumerated in row-major order over the shell cells,
 *     in the fixed E, S, W, N edge order.
 *   - The closed loop is walked from the row-major-first boundary edge,
 *     clockwise so the shell interior stays on the right.
 *   - Run segmentation and reflex removal scan in polygon order, apply the first
 *     acceptable removal, and restart from index 0, repeating full scans until a
 *     scan removes nothing. All geometric tests use integer cross-product
 *     determinants, never the float `pointInPolygon`.
 *
 * No RNG anywhere. Two calls with identical inputs produce byte-identical
 * vertex lists.
 */

/**
 * The protective shell of a ship, expressed as a set of occupied integer cells
 * on a bounding grid. In the final layered model this is the union of armor
 * cells and the cells carrying wall/door edges; until that model lands, a
 * caller builds the shell explicitly (see `extractShellLegacy`).
 */
export interface Shell {
  /** Bounding grid width (columns), so cell indices resolve. */
  readonly cols: number;
  /** Bounding grid height (rows). */
  readonly rows: number;
  /** Occupied shell cells, as row-major indices `row * cols + col`. */
  readonly cells: ReadonlySet<number>;
}

/** A cell-edge direction offset (east / south / west / north). */
interface EdgeDir {
  readonly dc: number;
  readonly dr: number;
}

/** Compass offsets for the four cell-edge directions, in a fixed order. */
const EDGE_DIRS: readonly EdgeDir[] = [
  { dc: 1, dr: 0 }, // east
  { dc: 0, dr: 1 }, // south
  { dc: -1, dr: 0 }, // west
  { dc: 0, dr: -1 }, // north
];

/** A directed boundary edge between two integer lattice corners. */
interface DirectedEdge {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

/** An integer lattice point (a seed-polygon vertex, before centring/scaling). */
export interface IPoint {
  readonly x: number;
  readonly y: number;
}

/** Lattice corner key for map indexing. */
function cornerKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Whether the shell contains the cell at (col, row). Out of bounds = false. */
function shellHas(shell: Shell, col: number, row: number): boolean {
  if (col < 0 || col >= shell.cols || row < 0 || row >= shell.rows) return false;
  return shell.cells.has(row * shell.cols + col);
}

/**
 * Collect the directed boundary edges of the shell: every unit lattice
 * segment that separates a shell cell from a non-shell neighbour (including
 * the grid exterior), oriented clockwise (interior on the right). Enumerated
 * in row-major order over shell cells, then in the fixed E, S, W, N edge
 * order, so the output is deterministic.
 */
function boundaryEdges(shell: Shell): DirectedEdge[] {
  const seen = new Set<string>();
  const edges: DirectedEdge[] = [];
  for (let row = 0; row < shell.rows; row += 1) {
    for (let col = 0; col < shell.cols; col += 1) {
      if (!shellHas(shell, col, row)) continue;
      for (const dir of EDGE_DIRS) {
        if (shellHas(shell, col + dir.dc, row + dir.dr)) continue;
        const edge = directedBoundaryEdge(col, row, dir.dc, dir.dr);
        const key = `${edge.ax},${edge.ay}->${edge.bx},${edge.by}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push(edge);
        }
      }
    }
  }
  return edges;
}

/**
 * The directed boundary edge for the side of cell (col, row) facing in
 * direction (dc, dr), oriented clockwise (shell interior on the right).
 * Lattice corner (x, y) is the top-left corner of cell (x, y); x grows east,
 * y grows south.
 */
function directedBoundaryEdge(
  col: number,
  row: number,
  dc: number,
  dr: number,
): DirectedEdge {
  if (dc === 1) {
    // East face: (col+1, row) -> (col+1, row+1).
    return { ax: col + 1, ay: row, bx: col + 1, by: row + 1 };
  }
  if (dr === 1) {
    // South face: (col+1, row+1) -> (col, row+1).
    return { ax: col + 1, ay: row + 1, bx: col, by: row + 1 };
  }
  if (dc === -1) {
    // West face: (col, row+1) -> (col, row).
    return { ax: col, ay: row + 1, bx: col, by: row };
  }
  // North face (dr === -1): (col, row) -> (col+1, row).
  return { ax: col, ay: row, bx: col + 1, by: row };
}

/**
 * Chain the boundary edges into one or more closed loops, each walked
 * clockwise. Returns the loops in discovery order: edges are enumerated
 * row-major, so the first edge belongs to the top-most, left-most shell cell's
 * first boundary face, and its loop is the outer boundary of a simply-shaped
 * chunk.
 */
function chainLoops(edges: readonly DirectedEdge[]): DirectedEdge[][] {
  const byStart = new Map<string, DirectedEdge[]>();
  for (const e of edges) {
    const k = cornerKey(e.ax, e.ay);
    const list = byStart.get(k);
    if (list === undefined) byStart.set(k, [e]);
    else list.push(e);
  }

  const consumed = new Set<DirectedEdge>();
  const loops: DirectedEdge[][] = [];
  for (const seed of edges) {
    if (consumed.has(seed)) continue;
    const loop: DirectedEdge[] = [];
    let cursor: DirectedEdge | undefined = seed;
    while (cursor !== undefined && !consumed.has(cursor)) {
      consumed.add(cursor);
      loop.push(cursor);
      const candidates = byStart.get(cornerKey(cursor.bx, cursor.by));
      cursor = candidates?.find((c) => !consumed.has(c));
    }
    loops.push(loop);
  }
  return loops;
}

/** A lattice corner of the boundary with its two incident edge directions. */
interface Corner {
  readonly x: number;
  readonly y: number;
  /** Incoming edge vector (from previous corner to this one). */
  readonly inDx: number;
  readonly inDy: number;
  /** Outgoing edge vector (from this corner to the next). */
  readonly outDx: number;
  readonly outDy: number;
}

/** Convert a closed clockwise loop of directed edges into a corner list. */
function loopCorners(loop: readonly DirectedEdge[]): Corner[] {
  const corners: Corner[] = [];
  for (let i = 0; i < loop.length; i += 1) {
    const prev = loop[(i - 1 + loop.length) % loop.length]!;
    const curr = loop[i]!;
    corners.push({
      x: curr.ax,
      y: curr.ay,
      inDx: curr.ax - prev.ax,
      inDy: curr.ay - prev.ay,
      outDx: curr.bx - curr.ax,
      outDy: curr.by - curr.ay,
    });
  }
  return corners;
}

/**
 * Shoelace signed area of a lattice loop, in square cell units. Positive for
 * clockwise winding in y-down coordinates (row grows south).
 */
function latticeSignedArea(loop: readonly DirectedEdge[]): number {
  let sum = 0;
  for (const e of loop) sum += e.ax * e.by - e.bx * e.ay;
  return sum / 2;
}

/** Reverse a directed loop's winding in place. */
function reverseLoop(loop: readonly DirectedEdge[]): DirectedEdge[] {
  return loop
    .slice()
    .reverse()
    .map((e) => ({ ax: e.bx, ay: e.by, bx: e.ax, by: e.ay }));
}

/**
 * The exact rectilinear staircase seed polygon for a clockwise loop, as integer
 * lattice points. Straight-through corners (no turn) are dropped so the seed is
 * minimal. The seed contains every solid cell whole and encloses no whole empty
 * cell — every later simplification only removes sub-cell area.
 */
function seedPolygon(loop: readonly DirectedEdge[]): IPoint[] {
  const corners = loopCorners(loop);
  const out: IPoint[] = [];
  for (const c of corners) {
    const cross = c.inDx * c.outDy - c.inDy * c.outDx;
    if (cross === 0) continue; // straight-through lattice point: no turn.
    out.push({ x: c.x, y: c.y });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Allowed edge directions and integer geometry helpers.
// ---------------------------------------------------------------------------

/**
 * Whether the edge vector (dx, dy) is an octilinear direction — a multiple of
 * 45 degrees: axis-aligned (one of dx/dy zero) or a pure diagonal
 * (|dx| === |dy|). Exact, no trigonometry. A zero vector is never an edge.
 */
export function edgeDirectionAllowed(dx: number, dy: number): boolean {
  if (dx === 0 && dy === 0) return false;
  if (dx === 0 || dy === 0) return true; // axis-aligned.
  return Math.abs(dx) === Math.abs(dy); // pure diagonal.
}

/**
 * Signed twice-area of triangle (a, b, c) in integer lattice space (the 2D
 * cross product of (b-a) and (c-a)). Positive, negative or zero with no float
 * error.
 */
function orient2(a: IPoint, b: IPoint, c: IPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// ---------------------------------------------------------------------------
// Stage B: greedy reflex-vertex removal (both modes).
// ---------------------------------------------------------------------------

/**
 * Whether two segments [p1, p2] and [p3, p4] properly intersect — cross at a
 * point interior to both. Endpoint touches are not proper crossings. Used to
 * keep the polygon simple after a chord replaces a vertex. Integer arithmetic.
 */
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
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  return false;
}

/**
 * Whether the chord u->w (replacing vertex v at index `vi` in `poly`) would
 * cross any non-adjacent edge of the polygon, breaking simplicity. The chord's
 * own neighbours (the edges ending at u and starting at w, and the two removed
 * edges around v) are skipped.
 */
function chordKeepsSimple(
  poly: readonly IPoint[],
  vi: number,
  u: IPoint,
  w: IPoint,
): boolean {
  const n = poly.length;
  const prevIdx = (vi - 1 + n) % n;
  const nextIdx = (vi + 1) % n;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    // Skip edges incident to u (prevIdx) or w (nextIdx), and the edges around
    // v that the chord replaces.
    if (i === prevIdx || i === vi) continue; // edges leaving u and v.
    if (j === prevIdx || j === nextIdx) continue; // edges arriving at u and w.
    if (i === nextIdx) continue; // edge leaving w.
    if (segmentsProperlyIntersect(u, w, poly[i]!, poly[j]!)) return false;
  }
  return true;
}

/** Integer collinearity test: whether b lies on the straight line a->c. */
function isCollinear(a: IPoint, b: IPoint, c: IPoint): boolean {
  return orient2(a, b, c) === 0;
}

/**
 * Collapse any vertex that has become collinear with its neighbours (no turn),
 * keeping the polygon minimal. Repeats until stable, scanning in order.
 */
function collapseCollinear(poly: IPoint[]): IPoint[] {
  let pts = poly;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const n = pts.length;
      const prev = pts[(i - 1 + n) % n]!;
      const curr = pts[i]!;
      const next = pts[(i + 1) % n]!;
      if (isCollinear(prev, curr, next)) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * Mark the reflex vertices of the seed that belong to a genuine multi-step
 * diagonal staircase, the only concavities we smooth. A monotone *run* is a
 * maximal cyclic sequence of edges with consistent x-sign and y-sign (the
 * boundary descends in a single quadrant, e.g. only east/south). Because every
 * seed vertex is a 90-degree turn, consecutive edges are always perpendicular,
 * so a run breaks exactly at a direction reversal. Within a run, reflex and
 * convex turns alternate; a reflex vertex is *smoothable* only when its run
 * holds at least two reflex vertices — i.e. it is one step of a real diagonal,
 * not an isolated re-entrant corner.
 *
 * This is what makes the hull follow the shape: an L's inner corner, a cross's
 * armpit and a 3x3 plus's notches are each a lone reflex in their run, so they
 * stay sharp; a 45-degree or 2:1 staircase is a run of many reflexes, so it
 * collapses to a diagonal. The result is order-independent (it depends only on
 * the static run structure and per-run reflex counts), so it is deterministic.
 */
function smoothableReflexVertices(seed: readonly IPoint[]): Set<IPoint> {
  const n = seed.length;
  const smoothable = new Set<IPoint>();
  if (n < 4) return smoothable;

  // Unit sign of each edge i (seed[i] -> seed[(i+1)%n]); one axis is always 0.
  const ex: number[] = [];
  const ey: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = seed[i]!;
    const b = seed[(i + 1) % n]!;
    ex.push(Math.sign(b.x - a.x));
    ey.push(Math.sign(b.y - a.y));
  }
  const conflicts = (cx: number, cy: number, ax: number, ay: number): boolean =>
    (cx !== 0 && ax !== 0 && cx !== ax) || (cy !== 0 && ay !== 0 && cy !== ay);

  // Find any run boundary to anchor a clean once-around segmentation. A closed
  // loop reverses in both axes, so a conflict always exists.
  let start = -1;
  {
    let ax = 0;
    let ay = 0;
    for (let k = 0; k < 2 * n; k += 1) {
      const i = k % n;
      if (conflicts(ex[i]!, ey[i]!, ax, ay)) {
        start = i;
        break;
      }
      if (ex[i]! !== 0) ax = ex[i]!;
      if (ey[i]! !== 0) ay = ey[i]!;
    }
  }
  if (start === -1) return smoothable;

  // Assign every edge a run id, scanning once from the boundary `start`.
  const runOf = new Array<number>(n).fill(-1);
  {
    let runId = 0;
    let ax = 0;
    let ay = 0;
    for (let k = 0; k < n; k += 1) {
      const i = (start + k) % n;
      if (k > 0 && conflicts(ex[i]!, ey[i]!, ax, ay)) {
        runId += 1;
        ax = 0;
        ay = 0;
      }
      runOf[i] = runId;
      if (ex[i]! !== 0) ax = ex[i]!;
      if (ey[i]! !== 0) ay = ey[i]!;
    }
  }

  // Count reflex vertices interior to each run (both incident edges same run),
  // then mark those in runs with two or more.
  const reflexByRun = new Map<number, number>();
  const interiorReflex: { vi: number; run: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const eIn = (i - 1 + n) % n;
    if (runOf[eIn] !== runOf[i]) continue; // run-boundary vertex (always convex).
    const u = seed[(i - 1 + n) % n]!;
    const v = seed[i]!;
    const w = seed[(i + 1) % n]!;
    const turn = (v.x - u.x) * (w.y - v.y) - (v.y - u.y) * (w.x - v.x);
    if (turn >= 0) continue; // convex.
    const run = runOf[i]!;
    reflexByRun.set(run, (reflexByRun.get(run) ?? 0) + 1);
    interiorReflex.push({ vi: i, run });
  }
  for (const { vi, run } of interiorReflex) {
    if ((reflexByRun.get(run) ?? 0) >= 2) smoothable.add(seed[vi]!);
  }
  return smoothable;
}

/**
 * Greedily remove reflex vertices to smooth diagonal staircases. A vertex v
 * (neighbours u = prev, w = next) is removed when ALL hold:
 *   (a) v is REFLEX — the CW y-down turn `(v-u) x (w-v) < 0` (convex vertices
 *       are never removed: that would cut into solid);
 *   (b) v is SMOOTHABLE — part of a multi-step staircase (see
 *       `smoothableReflexVertices`), so isolated concavities stay sharp;
 *   (c) the chord u->w is octilinear (axis-aligned or a 45-degree diagonal);
 *   (d) the chord keeps the polygon simple (no crossing of a non-adjacent
 *       edge).
 * After each accepted removal, newly-collinear neighbours collapse and the
 * scan restarts from index 0. Full scans repeat until one removes nothing.
 *
 * No-bite holds without any empty-cell test: only reflex vertices are removed,
 * and bridging a reflex vertex adds area on the empty side of the notch, never
 * cutting into solid. Following the shape is enforced entirely by the smoothable
 * gate — a monotone diagonal run is a hull edge, never a re-entrant concavity (a
 * concavity reverses direction and so splits into separate runs). That gate is
 * scale-invariant, so subdivided hulls (whose 45-degree tapers have multi-cell
 * steps) smooth just like unit-step staircases; an empty-cell area test would
 * instead block them, because a multi-cell step's diagonal does enclose whole
 * sub-cells.
 *
 * Smoothability is computed once from the seed: removal and collinear collapse
 * only drop vertices (never create them), and a kept reflex stays a turn, so a
 * smoothable vertex keeps its identity until it is itself removed.
 */
function removeReflexVertices(poly: IPoint[]): IPoint[] {
  const smoothable = smoothableReflexVertices(poly);
  let pts = poly;
  let progressed = true;
  while (progressed && pts.length > 3) {
    progressed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const n = pts.length;
      const u = pts[(i - 1 + n) % n]!;
      const v = pts[i]!;
      const w = pts[(i + 1) % n]!;
      // (a) reflex test, CW y-down: turn cross (v-u) x (w-v) < 0.
      const turn = (v.x - u.x) * (w.y - v.y) - (v.y - u.y) * (w.x - v.x);
      if (turn >= 0) continue;
      // (b) only smooth genuine multi-step staircases; keep isolated corners.
      if (!smoothable.has(v)) continue;
      // (c) chord must be octilinear (axis-aligned or 45-degree diagonal).
      if (!edgeDirectionAllowed(w.x - u.x, w.y - u.y)) continue;
      // (d) polygon stays simple.
      if (!chordKeepsSimple(pts, i, u, w)) continue;
      // Accept: drop v, collapse newly-collinear neighbours, restart.
      pts = pts.slice(0, i).concat(pts.slice(i + 1));
      pts = collapseCollinear(pts);
      progressed = true;
      break;
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Stage C: octilinear non-45 approximation.
// ---------------------------------------------------------------------------

/**
 * Approximate each remaining non-45 reflex run with the tightest stepped {axis,
 * 45-degree} polyline that stays a superset.
 *
 * After Stage B a chord only survives when it is axis-aligned or a pure
 * 45-degree diagonal — non-45 runs keep their original rectilinear staircase,
 * which is already the tightest stepped 0/90 superset and consists solely of
 * octilinear directions. There is therefore nothing left to re-step (uniform 45
 * staircases collapse to one diagonal; non-45 staircases stay stepped). Stage C
 * is the identity, kept as an explicit pass so the staged structure mirrors the
 * algorithm description and any future re-stepping has an obvious home.
 */
function approximateOctilinear(poly: IPoint[]): IPoint[] {
  return poly;
}

// ---------------------------------------------------------------------------
// Stage D: centre on the grid and scale to ship-local metres.
// ---------------------------------------------------------------------------

/**
 * Centre an integer-lattice loop on the grid and scale to ship-local metres,
 * matching `cellToLocal`'s centring: cell (col, row)'s centre sits at
 * `(col - (cols-1)/2) * CELL_SIZE`, and lattice corner (x, y) is the top-left
 * corner of cell (x, y), so the centre-relative lattice position is
 * `x - (cols-1)/2 - 0.5`. The `- 0.5` is folded into the centre offset.
 */
export function toMetreLoop(loop: readonly IPoint[], cols: number, rows: number): Vec2[] {
  const centreCol = (cols - 1) / 2 + 0.5;
  const centreRow = (rows - 1) / 2 + 0.5;
  return loop.map((p) => ({
    x: (p.x - centreCol) * CELL_SIZE,
    y: (p.y - centreRow) * CELL_SIZE,
  }));
}

/** Run the full simplification pipeline (Stages B and C) on one seed loop. */
function simplifyLoop(seed: IPoint[]): IPoint[] {
  return approximateOctilinear(removeReflexVertices(seed));
}

/**
 * Compute the shrink-wrap hull outline polygon(s) for a shell.
 *
 * Returns one vertex list per closed boundary loop, in discovery order (the
 * outer loop of a simply-shaped chunk is first). Each list is closed implicitly
 * (the first vertex is not repeated at the end). Vertices are in ship-local
 * metres, clockwise wound.
 *
 * Determinism: identical inputs always yield byte-identical output, because
 * every step — edge enumeration, loop chaining, seed construction, reflex
 * removal, octilinear stepping, centring — follows a fixed iteration order with
 * no RNG, and every geometric test is exact integer arithmetic.
 */
/**
 * The exact rectilinear seed loops for a shell, as integer lattice corner
 * lists, each oriented clockwise (interior on the right). This is the raw
 * staircase boundary *before* any smoothing or beveling — every turn is 90
 * degrees. Shared by `computeOutline` (which then smooths staircases) and the
 * hull outline (which bevels every corner); see `src/domain/hull-outline.ts`.
 */
export function latticeSeedLoops(shell: Shell): IPoint[][] {
  const edges = boundaryEdges(shell);
  const loops = chainLoops(edges);
  return loops.map((loop) => {
    const oriented = latticeSignedArea(loop) < 0 ? reverseLoop(loop) : loop;
    return seedPolygon(oriented);
  });
}

export function computeOutline(shell: Shell): Vec2[][] {
  const edges = boundaryEdges(shell);
  const loops = chainLoops(edges);
  return loops.map((loop) => {
    // boundaryEdges already emits clockwise edges; flip any counter-clockwise
    // loop so the output winding is uniform regardless of shell shape.
    const oriented = latticeSignedArea(loop) < 0 ? reverseLoop(loop) : loop;
    const seed = seedPolygon(oriented);
    const simplified = simplifyLoop(seed);
    return toMetreLoop(simplified, shell.cols, shell.rows);
  });
}

/**
 * Index of the outer loop (largest enclosed area) in a list returned by
 * `computeOutline`. Returns 0 when there is only one loop. Exposed for the
 * renderer and for tests.
 */
export function outerLoopIndex(loops: readonly Vec2[][]): number {
  let best = 0;
  let bestArea = -Infinity;
  for (let i = 0; i < loops.length; i += 1) {
    const area = Math.abs(polygonSignedArea(loops[i]!));
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  }
  return best;
}

/** Shoelace signed area of a metre-space polygon. Positive = clockwise. */
function polygonSignedArea(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Whether a metre-space polygon is wound clockwise. In the y-down grid
 * convention used here, clockwise polygons have positive signed area.
 */
export function isClockwise(poly: readonly Vec2[]): boolean {
  return polygonSignedArea(poly) > 0;
}

/**
 * Whether a point is inside a polygon (even-odd ray cast). Used by tests to
 * confirm a chunk's outline encloses its shell cells.
 */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Placeholder shell extractor over the legacy `TileGrid`: treats every
 * occupied (non-empty) cell as shell. Integration replaces this with the real
 * armor + wall/door extractor once the layered cell model lands. Exported so
 * the algorithm has a default bridge to the current grid shape.
 */
export function extractShellLegacy(grid: {
  cols: number;
  rows: number;
  cells: ReadonlyArray<{ kind: string }>;
}): Shell {
  const cells = new Set<number>();
  for (let i = 0; i < grid.cells.length; i += 1) {
    if (grid.cells[i]!.kind !== "empty") cells.add(i);
  }
  return { cols: grid.cols, rows: grid.rows, cells };
}

// ---------------------------------------------------------------------------
// Layered-cell shell extractor: the hull is the contiguous solid region.
// ---------------------------------------------------------------------------

/** Build the outline Shell from a layered-cell grid: the ship's hull, the region
 *  the outline wraps. The hull is the whole contiguous solid region — every
 *  deck, bare and armour cell — because a ship's outer skin is itself a wall:
 *  walls are drawn automatically around contiguous deck tiles, so the cells'
 *  edges facing empty space form the hull, and everything those walls enclose is
 *  interior. Tracing the full region (rather than only explicitly walled or
 *  armour cells) is what gives every ship a silhouette — even an unarmoured one —
 *  and lets a tapered hull read as octilinear diagonals. Empty cells inside the
 *  region remain holes, so an internal cavity is still wrapped by its own loop.
 *  The airtightness/breach model keys off the per-cell edges separately and is
 *  untouched by this. */
export function extractShell(grid: TileGrid): Shell {
  const cells = new Set<number>();
  for (let i = 0; i < grid.cells.length; i += 1) {
    const cell = grid.cells[i];
    if (cell === undefined || cell.kind !== "solid") continue;
    cells.add(i);
  }
  return { cols: grid.cols, rows: grid.rows, cells };
}
