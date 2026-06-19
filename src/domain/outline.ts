import { z } from "zod";
import { CELL_SIZE } from "@/domain/grid";
import type { Vec2 } from "@/schema/primitives";

/**
 * Chamfered hull outline tracing (Phase 11, plan: iridescent-splashing-zebra).
 *
 * The hull outline is traced around the ship's protective shell — armor cells
 * plus wall/door edges — through the integer lattice corner vertices of those
 * cells, then chamfered at the resolution selected by `outlineMode`.
 *
 * This module owns the outline **algorithm** only. It is deliberately decoupled
 * from the not-yet-landed layered cell model: a caller (integration) supplies a
 * `Shell` describing the protective boundary as a set of occupied integer
 * cells, and receives a closed, clockwise, chamfered polygon in ship-local
 * metres. `extractShellLegacy` bridges the current `TileGrid` until the layered
 * model arrives.
 *
 * Determinism anchors (all of them):
 *   - Boundary edges are enumerated in row-major order over the shell cells,
 *     in the fixed E, S, W, N edge order.
 *   - The closed loop is walked from the row-major-first boundary edge,
 *     clockwise so the shell interior stays on the right.
 *   - Chamfer vertices are emitted in polygon order; their positions are pure
 *     functions of the two incident edge directions and the cell size.
 *
 * No RNG anywhere. Two calls with identical inputs produce byte-identical
 * vertex lists.
 */

/**
 * The chamfer resolution. Each mode dictates how a convex corner of the traced
 * boundary is rounded:
 *   - `octilinear`      — one chamfer vertex per 90° corner, cutting the corner
 *                          at 45°. Produces an octagonal bevel.
 *   - `hexadecilinear`  — samples the corner arc at 22.5° facets, producing a
 *                          16-sided bevel.
 *   - `arbitrary`       — samples at twice the hexadecilinear resolution
 *                          (11.25° facets), producing a visually smooth arc.
 */
export const OutlineMode = z.enum(["octilinear", "hexadecilinear", "arbitrary"]);
export type OutlineMode = z.infer<typeof OutlineMode>;

/** The per-ship shape descriptor consumed by the outline tracer. */
export const ShipShape = z.object({
  outlineMode: OutlineMode,
});
export type ShipShape = z.infer<typeof ShipShape>;

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

/**
 * Half-angle subtended by one chamfer facet, in radians. A regular 16-gon's
 * exterior angle is `2π/16 = π/8` (22.5°); a regular 32-gon's is `π/16`
 * (11.25°). These are geometric anchors — the facet angles of regular polygons
 * — not tuned literals.
 */
export const HEXADECI_FACET_ANGLE_RAD = Math.PI / 8;
export const ARBITRARY_FACET_ANGLE_RAD = Math.PI / 16;

/**
 * The 90° arc swept by a chamfer at a convex axis-aligned corner. One quarter
 * turn; derived from the right angle between two axis-aligned boundary edges.
 */
const CONVEX_ARC_SPAN_RAD = Math.PI / 2;

/**
 * Fraction of a unit cell side that each chamfer cut removes from the two
 * edges meeting at a convex corner. The value is one half: two chamfers
 * sharing a unit edge each remove half of it, so they meet exactly at the
 * edge midpoint without overlap or gap. Derived from unit cell geometry, not
 * tuned.
 */
export const CHAMFER_FRACTION_OF_CELL_SIDE = 0.5;

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
 * Facet angle for the chosen chamfer mode. Octilinear bevels the corner in a
 * single cut (handled separately, no arc sampling); hexadecilinear and
 * arbitrary sample the corner arc at their respective facet angles.
 */
function facetAngleFor(mode: OutlineMode): number {
  if (mode === "hexadecilinear") return HEXADECI_FACET_ANGLE_RAD;
  return ARBITRARY_FACET_ANGLE_RAD;
}

/**
 * Emit the chamfer vertices for a single convex corner under the chosen mode,
 * replacing the corner itself.
 *
 * Chamfer geometry: walk a fraction `CHAMFER_FRACTION_OF_CELL_SIDE` of the unit
 * cell side back along the incoming edge and forward along the outgoing edge
 * to find the two tangent points, then (for the arc-sampling modes) sample the
 * circular arc of that radius between them. All math is in lattice units; the
 * caller scales to metres.
 *
 * The arc is sampled by rotating the corner-to-tangent-in vector clockwise
 * (negative angle in y-down space) by evenly spaced fractions of the 90°
 * span. The sample count is `ceil(span / facetAngle)`, so an integer number
 * of facets covers the arc exactly — derived from the span/facet ratio, not a
 * magic literal.
 */
function chamferVertices(c: Corner, mode: OutlineMode): Vec2[] {
  const t = CHAMFER_FRACTION_OF_CELL_SIDE;
  const pIn = { x: c.x - c.inDx * t, y: c.y - c.inDy * t };
  const pOut = { x: c.x + c.outDx * t, y: c.y + c.outDy * t };

  if (mode === "octilinear") {
    return [pIn, pOut];
  }

  const facetAngle = facetAngleFor(mode);
  // Facet count across the 90° convex arc. Authored to be an exact integer
  // divisor of the right angle (hexadecilinear: 4; arbitrary: 8), but the
  // float quotient `(π/2)/(π/n)` drifts above the integer by ~1e-16, so a
  // naive `ceil` would over-sample by one facet. `Math.round` snaps back to
  // the authored integer ratio.
  const sampleCount = Math.round(CONVEX_ARC_SPAN_RAD / facetAngle);
  const rx = pIn.x - c.x;
  const ry = pIn.y - c.y;
  const vertices: Vec2[] = [pIn];
  for (let i = 1; i < sampleCount; i += 1) {
    const angle = -CONVEX_ARC_SPAN_RAD * (i / sampleCount);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    vertices.push({
      x: c.x + rx * cos - ry * sin,
      y: c.y + rx * sin + ry * cos,
    });
  }
  vertices.push(pOut);
  return vertices;
}

/**
 * Chamfer a single closed clockwise loop into a polygon vertex list. The loop
 * is first shifted so the grid centre sits at the lattice origin (matching
 * `cellToLocal`'s centring convention), then each corner is emitted directly
 * (concave) or replaced by its chamfer vertices (convex). Finally every
 * lattice-unit vertex is scaled to ship-local metres by `CELL_SIZE`.
 */
function chamferLoop(
  loop: readonly DirectedEdge[],
  mode: OutlineMode,
  cols: number,
  rows: number,
): Vec2[] {
  // Centre offset in lattice units: cell (col, row)'s centre sits at
  // `(col - (cols-1)/2) * CELL_SIZE`. Lattice corner (x, y) is the top-left
  // corner of cell (x, y), so the centre-relative lattice position is
  // `x - (cols-1)/2 - 0.5`. We fold the `- 0.5` into the centre offset so the
  // shift is a single subtraction.
  const centreCol = (cols - 1) / 2 + 0.5;
  const centreRow = (rows - 1) / 2 + 0.5;
  const shift = (c: Corner): Corner => ({
    x: c.x - centreCol,
    y: c.y - centreRow,
    inDx: c.inDx,
    inDy: c.inDy,
    outDx: c.outDx,
    outDy: c.outDy,
  });
  const toMetres = (p: Vec2): Vec2 => ({
    x: p.x * CELL_SIZE,
    y: p.y * CELL_SIZE,
  });

  // For a clockwise loop in y-down space, the 2D cross product `in × out` is
  // positive at a convex (right) turn, negative at a concave (left) turn, and
  // zero where the boundary runs straight through a lattice corner.
  const corners = loopCorners(loop).map(shift);
  const out: Vec2[] = [];
  for (const c of corners) {
    const cross = c.inDx * c.outDy - c.inDy * c.outDx;
    if (cross === 0) {
      // Straight-through lattice point: the two incident edges are collinear,
      // so this corner carries no turn. Emitting it would duplicate the
      // preceding vertex geometrically; skip it to keep the polygon minimal.
      continue;
    }
    if (cross > 0) {
      // Convex corner: replace with chamfer vertices.
      for (const v of chamferVertices(c, mode)) out.push(toMetres(v));
    } else {
      // Concave corner: pass through unchanged (the protective shell turns
      // inward here, e.g. the inside of an L-shape).
      out.push(toMetres(c));
    }
  }
  return out;
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
 * Compute the chamfered hull outline polygon(s) for a shell.
 *
 * Returns one vertex list per closed boundary loop, in discovery order (the
 * outer loop of a simply-shaped chunk is first). Each list is closed
 * implicitly (the first vertex is not repeated at the end). Vertices are in
 * ship-local metres, clockwise wound.
 *
 * Determinism: identical inputs always yield byte-identical output vertex
 * lists, because every step — edge enumeration, loop chaining, corner
 * emission, chamfer sampling — follows a fixed iteration order with no RNG.
 */
export function computeOutline(shell: Shell, shape: ShipShape): Vec2[][] {
  const edges = boundaryEdges(shell);
  const loops = chainLoops(edges);
  return loops.map((loop) => {
    // boundaryEdges already emits clockwise edges; flip any counter-clockwise
    // loop so the output winding is uniform regardless of shell shape.
    const oriented = latticeSignedArea(loop) < 0 ? reverseLoop(loop) : loop;
    return chamferLoop(oriented, shape.outlineMode, shell.cols, shell.rows);
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
