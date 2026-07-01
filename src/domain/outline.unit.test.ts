import { describe, expect, it } from "vitest";
import {
  computeOutline,
  edgeDirectionAllowed,
  isClockwise,
  outerLoopIndex,
  pointInPolygon,
  type Shell,
} from "@/domain/outline";
import { CELL_SIZE } from "@/domain/grid";

/**
 * Invariant-based tests for the shrink-wrap hull outline. The hull is always
 * traced octilinearly (there is no longer a mode), so what matters is that every
 * outline satisfies the locked invariants:
 *   1. NO BITE — every solid cell corner is inside-or-on the outline.
 *   2. FOLLOWS SHAPE — no whole empty cell sits inside the outline.
 *   3/4. SHARP / ALLOWED — every edge direction is axis-aligned or a multiple of
 *        45 degrees; plain axis-aligned ships stay rectilinear.
 *   5. SMOOTH — 45 staircases collapse to a single diagonal; isolated concavities
 *        (an L inner corner, a cross armpit) stay sharp.
 *   6. DETERMINISTIC — byte-identical output for identical input.
 */

/**
 * Build a shell from an ASCII map: `#` = shell cell, `.` = empty. Rows must be
 * equal length. Deterministic by construction.
 */
function shell(rows: readonly string[]): Shell {
  const cols = rows[0]?.length ?? 0;
  const cells = new Set<number>();
  for (let r = 0; r < rows.length; r += 1) {
    const line = rows[r]!;
    for (let c = 0; c < cols; c += 1) {
      if (line[c] === "#") cells.add(r * cols + c);
    }
  }
  return { cols, rows: rows.length, cells };
}

/** Ship-local centre of cell (col, row) for the shell's bounding grid. */
function cellCentre(
  s: Shell,
  col: number,
  row: number,
): { x: number; y: number } {
  const centreCol = (s.cols - 1) / 2;
  const centreRow = (s.rows - 1) / 2;
  return {
    x: (col - centreCol) * CELL_SIZE,
    y: (row - centreRow) * CELL_SIZE,
  };
}

/** Ship-local position of integer lattice corner (x, y) (top-left of cell). */
function cornerLocal(s: Shell, x: number, y: number): { x: number; y: number } {
  const centreCol = (s.cols - 1) / 2 + 0.5;
  const centreRow = (s.rows - 1) / 2 + 0.5;
  return {
    x: (x - centreCol) * CELL_SIZE,
    y: (y - centreRow) * CELL_SIZE,
  };
}

type Pt = { x: number; y: number };
type Loops = ReadonlyArray<ReadonlyArray<Pt>>;

/** Distance from p to segment [a, b], squared. */
function distToSegment2(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) {
    return apx * apx + apy * apy;
  }
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

/** Whether p lies on the boundary of any loop (small float tolerance). */
function onAnyBoundary(p: Pt, loops: Loops): boolean {
  const eps = CELL_SIZE * 1e-9;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      if (distToSegment2(p, a, b) <= eps * eps) return true;
    }
  }
  return false;
}

/**
 * Whether p is in the filled region of a polygon-with-holes: inside an odd
 * number of loops (even-odd rule across outer hull and hole loops).
 */
function inFilledRegion(p: Pt, loops: Loops): boolean {
  let parity = 0;
  for (const loop of loops) {
    if (pointInPolygon(p, loop)) parity ^= 1;
  }
  return parity === 1;
}

/** INVARIANT 1: every corner of every solid cell is inside-or-on the outline. */
function everySolidCornerInsideOrOn(s: Shell, loops: Loops): boolean {
  for (let r = 0; r < s.rows; r += 1) {
    for (let c = 0; c < s.cols; c += 1) {
      if (!s.cells.has(r * s.cols + c)) continue;
      const corners = [
        cornerLocal(s, c, r),
        cornerLocal(s, c + 1, r),
        cornerLocal(s, c + 1, r + 1),
        cornerLocal(s, c, r + 1),
      ];
      for (const corner of corners) {
        if (!inFilledRegion(corner, loops) && !onAnyBoundary(corner, loops)) {
          return false;
        }
      }
    }
  }
  return true;
}

/** INVARIANT 2: no empty cell is wholly inside the filled region (all four
 *  corners strictly filled, none on a boundary). */
function noWholeEmptyCellInside(s: Shell, loops: Loops): boolean {
  for (let r = 0; r < s.rows; r += 1) {
    for (let c = 0; c < s.cols; c += 1) {
      if (s.cells.has(r * s.cols + c)) continue;
      const corners = [
        cornerLocal(s, c, r),
        cornerLocal(s, c + 1, r),
        cornerLocal(s, c + 1, r + 1),
        cornerLocal(s, c, r + 1),
      ];
      const wholeInside = corners.every(
        (corner) => inFilledRegion(corner, loops) && !onAnyBoundary(corner, loops),
      );
      if (wholeInside) return false;
    }
  }
  return true;
}

/** INVARIANT 4: every consecutive edge direction is axis-aligned or 45 degrees. */
function allEdgesAllowed(poly: readonly { x: number; y: number }[]): boolean {
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    // Work in cell units so the integer-style predicate sees integer steps.
    const dx = Math.round((b.x - a.x) / CELL_SIZE);
    const dy = Math.round((b.y - a.y) / CELL_SIZE);
    if (!edgeDirectionAllowed(dx, dy)) return false;
  }
  return true;
}

const SHAPES: ReadonlyArray<{ name: string; rows: string[] }> = [
  { name: "2x2 block", rows: ["##", "##"] },
  { name: "3x2 block", rows: ["###", "###"] },
  { name: "45 staircase", rows: ["#...", "##..", "###.", "####"] },
  { name: "2:1 staircase", rows: ["##....", "####..", "######"] },
  { name: "L-shape", rows: ["##.", "##.", "###"] },
  { name: "plus", rows: [".#.", "###", ".#."] },
  { name: "ring", rows: ["###", "#.#", "###"] },
  { name: "single-width spur", rows: ["####", ".#..", ".#.."] },
];

describe("computeOutline — invariants over every shape", () => {
  for (const { name, rows } of SHAPES) {
    const s = shell(rows);

    it(`${name}: contains every solid cell (no bite)`, () => {
      const loops = computeOutline(s);
      expect(everySolidCornerInsideOrOn(s, loops)).toBe(true);
    });

    it(`${name}: encloses no whole empty cell (follows shape)`, () => {
      const loops = computeOutline(s);
      expect(noWholeEmptyCellInside(s, loops)).toBe(true);
    });

    it(`${name}: every edge direction is allowed`, () => {
      const loops = computeOutline(s);
      for (const loop of loops) {
        expect(allEdgesAllowed(loop)).toBe(true);
      }
    });

    it(`${name}: byte-identical across two calls (determinism)`, () => {
      const a = computeOutline(s);
      const b = computeOutline(s);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it(`${name}: outer loop is clockwise and largest-area`, () => {
      const loops = computeOutline(s);
      const idx = outerLoopIndex(loops);
      expect(isClockwise(loops[idx]!)).toBe(true);
      // outerLoopIndex picks the largest-area loop.
      const areas = loops.map((l) => {
        let sum = 0;
        for (let i = 0; i < l.length; i += 1) {
          const p = l[i]!;
          const q = l[(i + 1) % l.length]!;
          sum += p.x * q.y - q.x * p.y;
        }
        return Math.abs(sum) / 2;
      });
      const maxArea = Math.max(...areas);
      expect(areas[idx]).toBe(maxArea);
    });
  }
});

describe("edgeDirectionAllowed", () => {
  it("allows only multiples of 45 degrees", () => {
    expect(edgeDirectionAllowed(1, 0)).toBe(true); // axis
    expect(edgeDirectionAllowed(0, 3)).toBe(true); // axis
    expect(edgeDirectionAllowed(2, 2)).toBe(true); // 45
    expect(edgeDirectionAllowed(-4, 4)).toBe(true); // 45
    expect(edgeDirectionAllowed(2, 1)).toBe(false); // not 45
    expect(edgeDirectionAllowed(0, 0)).toBe(false); // zero
  });
});

describe("computeOutline — exact-geometry anchors", () => {
  it("2x2 block is one 4-vertex loop, area 4 cell-units", () => {
    const s = shell(["##", "##"]);
    const loops = computeOutline(s);
    expect(loops.length).toBe(1);
    expect(loops[0]!.length).toBe(4);
    // Area = 4 cell-units in metres: 4 * CELL_SIZE^2.
    const poly = loops[0]!;
    let sum = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      sum += a.x * b.y - b.x * a.y;
    }
    expect(Math.abs(sum) / 2).toBeCloseTo(4 * CELL_SIZE * CELL_SIZE, 9);
  });

  it("45 staircase collapses its diagonal to a single straight segment", () => {
    const s = shell(["#...", "##..", "###.", "####"]);
    const poly = computeOutline(s)[0]!;
    // The diagonal side is a single segment: exactly one edge has both dx and dy
    // non-zero in cell units.
    let diagonalEdges = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const dx = Math.round((b.x - a.x) / CELL_SIZE);
      const dy = Math.round((b.y - a.y) / CELL_SIZE);
      if (dx !== 0 && dy !== 0) diagonalEdges += 1;
    }
    expect(diagonalEdges).toBe(1);
  });

  it("plus/cross stays a sharp cross: rectilinear outline, armpits kept", () => {
    // Each armpit is a lone reflex corner in its monotone run, so it is NOT
    // smoothed: the cross keeps its exact rectilinear boundary (no diagonal
    // edges) and the four corner empty-cell centres sit strictly outside.
    const s = shell([".#.", "###", ".#."]);
    const loops = computeOutline(s);
    expect(loops.length).toBe(1);
    // No diagonal edges anywhere: the cross is purely axis-aligned.
    for (let i = 0; i < loops[0]!.length; i += 1) {
      const a = loops[0]![i]!;
      const b = loops[0]![(i + 1) % loops[0]!.length]!;
      const dx = Math.round((b.x - a.x) / CELL_SIZE);
      const dy = Math.round((b.y - a.y) / CELL_SIZE);
      expect(dx === 0 || dy === 0).toBe(true);
    }
    // Corner empty-cell centres are strictly outside (concavities preserved).
    const cornerCells: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ];
    for (const [c, r] of cornerCells) {
      expect(inFilledRegion(cellCentre(s, c, r), loops)).toBe(false);
    }
  });

  it("L-shape keeps a sharp inner corner (isolated concavity not beveled)", () => {
    // The L has a single reflex corner; with no staircase partner it is never
    // smoothed, so it traces a rectilinear L (no diagonals).
    const s = shell(["##.", "##.", "###"]);
    const loops = computeOutline(s);
    for (let i = 0; i < loops[0]!.length; i += 1) {
      const a = loops[0]![i]!;
      const b = loops[0]![(i + 1) % loops[0]!.length]!;
      const dx = Math.round((b.x - a.x) / CELL_SIZE);
      const dy = Math.round((b.y - a.y) / CELL_SIZE);
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });

  it("ring traces exactly two loops (outer hull + inner hole)", () => {
    const s = shell(["###", "#.#", "###"]);
    const loops = computeOutline(s);
    expect(loops.length).toBe(2);
    const outer = loops[outerLoopIndex(loops)]!;
    // Outer encloses the hollow centre; the hole does not enclose the ring.
    expect(pointInPolygon(cellCentre(s, 1, 1), outer)).toBe(true);
    const hole = loops.find((l) => l !== outer)!;
    expect(pointInPolygon(cellCentre(s, 0, 0), hole)).toBe(false);
  });
});
