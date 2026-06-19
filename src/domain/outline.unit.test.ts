import { describe, expect, it } from "vitest";
import {
  ARBITRARY_FACET_ANGLE_RAD,
  CHAMFER_FRACTION_OF_CELL_SIDE,
  HEXADECI_FACET_ANGLE_RAD,
  computeOutline,
  extractShellLegacy,
  isClockwise,
  outerLoopIndex,
  pointInPolygon,
  type Shell,
} from "@/domain/outline";
import type { ShipShape } from "@/domain/outline";
import { CELL_SIZE } from "@/domain/grid";

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

/** A 2x2 solid block — the simplest chunk with four convex corners. */
const BLOCK_2X2 = shell(["##", "##"]);

const SHAPE_OCTI: ShipShape = { outlineMode: "octilinear" };
const SHAPE_HEXA: ShipShape = { outlineMode: "hexadecilinear" };
const SHAPE_ARB: ShipShape = { outlineMode: "arbitrary" };

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

describe("computeOutline — geometric anchors", () => {
  it("exposes facet angles derived from regular-polygon geometry", () => {
    // A regular 16-gon's exterior angle is 2pi/16 = pi/8.
    expect(HEXADECI_FACET_ANGLE_RAD).toBeCloseTo(Math.PI / 8, 12);
    // A regular 32-gon's exterior angle is 2pi/32 = pi/16 (twice the resolution).
    expect(ARBITRARY_FACET_ANGLE_RAD).toBeCloseTo(Math.PI / 16, 12);
    expect(ARBITRARY_FACET_ANGLE_RAD).toBe(HEXADECI_FACET_ANGLE_RAD / 2);
  });

  it("exposes a chamfer fraction derived from unit-cell geometry", () => {
    // Two chamfers sharing a unit edge meet at its midpoint: each removes half.
    expect(CHAMFER_FRACTION_OF_CELL_SIDE).toBe(0.5);
  });
});

describe("computeOutline — determinism (byte-identity)", () => {
  it("returns byte-identical vertex lists across two calls (single block)", () => {
    const a = computeOutline(BLOCK_2X2, SHAPE_HEXA);
    const b = computeOutline(BLOCK_2X2, SHAPE_HEXA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns byte-identical vertex lists across two calls (L-shape)", () => {
    const l = shell(["##.", "##.", "###"]);
    const a = computeOutline(l, SHAPE_ARB);
    const b = computeOutline(l, SHAPE_ARB);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces stable vertex positions (deep-equal, not just JSON)", () => {
    const a = computeOutline(BLOCK_2X2, SHAPE_OCTI);
    const b = computeOutline(BLOCK_2X2, SHAPE_OCTI);
    expect(a).toEqual(b);
  });
});

describe("computeOutline — winding", () => {
  it("winds the outer loop clockwise (positive signed area, y-down)", () => {
    const loops = computeOutline(BLOCK_2X2, SHAPE_OCTI);
    expect(loops.length).toBe(1);
    expect(isClockwise(loops[0]!)).toBe(true);
  });

  it("winds clockwise for an L-shaped chunk", () => {
    const l = shell(["##.", "##.", "###"]);
    const loops = computeOutline(l, SHAPE_OCTI);
    expect(loops.length).toBe(1);
    expect(isClockwise(loops[0]!)).toBe(true);
  });

  it("reports counter-clockwise winding as not clockwise", () => {
    const ccw = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ];
    expect(isClockwise(ccw)).toBe(false);
  });
});

describe("computeOutline — chamfer modes", () => {
  it("produces an octilinear bevel with one chamfer vertex per convex corner cut", () => {
    const loops = computeOutline(BLOCK_2X2, SHAPE_OCTI);
    const poly = loops[0]!;
    // 2x2 block has 4 convex corners, no concave ones. Octilinear replaces
    // each corner with 2 tangent points, so the polygon has 4 * 2 = 8
    // vertices.
    expect(poly.length).toBe(8);
  });

  it("samples more vertices for hexadecilinear than octilinear", () => {
    const octi = computeOutline(BLOCK_2X2, SHAPE_OCTI)[0]!;
    const hexa = computeOutline(BLOCK_2X2, SHAPE_HEXA)[0]!;
    expect(hexa.length).toBeGreaterThan(octi.length);
  });

  it("samples more vertices for arbitrary than hexadecilinear", () => {
    const hexa = computeOutline(BLOCK_2X2, SHAPE_HEXA)[0]!;
    const arb = computeOutline(BLOCK_2X2, SHAPE_ARB)[0]!;
    expect(arb.length).toBeGreaterThan(hexa.length);
  });

  it("matches the derived hexadecilinear facet count for a single convex corner", () => {
    // The 90° convex arc is an exact integer multiple of the facet angle:
    // (π/2) / (π/8) = 4 facets. The chamfer emits pIn + (facets - 1) arc
    // midpoints + pOut = facets + 1 = 5 vertices per corner; 4 corners = 20.
    // `Math.round` is used (not `ceil`) because the float quotient drifts
    // above the integer by ~1e-16.
    const hexa = computeOutline(BLOCK_2X2, SHAPE_HEXA)[0]!;
    const facets = Math.round((Math.PI / 2) / HEXADECI_FACET_ANGLE_RAD);
    expect(facets).toBe(4);
    expect(hexa.length).toBe(4 * (facets + 1));
  });

  it("matches the derived arbitrary facet count for a single convex corner", () => {
    // (π/2) / (π/16) = 8 facets; 9 vertices/corner; 4 corners = 36.
    const arb = computeOutline(BLOCK_2X2, SHAPE_ARB)[0]!;
    const facets = Math.round((Math.PI / 2) / ARBITRARY_FACET_ANGLE_RAD);
    expect(facets).toBe(8);
    expect(arb.length).toBe(4 * (facets + 1));
  });
});

describe("computeOutline — enclosure", () => {
  it("a chunk's outline encloses every shell cell centre (solid block)", () => {
    const s = BLOCK_2X2;
    const poly = computeOutline(s, SHAPE_OCTI)[0]!;
    for (let r = 0; r < s.rows; r += 1) {
      for (let c = 0; c < s.cols; c += 1) {
        if (!s.cells.has(r * s.cols + c)) continue;
        expect(pointInPolygon(cellCentre(s, c, r), poly)).toBe(true);
      }
    }
  });

  it("a chunk's outline encloses every shell cell centre (L-shape, hexa)", () => {
    const s = shell(["##.", "##.", "###"]);
    const poly = computeOutline(s, SHAPE_HEXA)[0]!;
    for (let r = 0; r < s.rows; r += 1) {
      for (let c = 0; c < s.cols; c += 1) {
        if (!s.cells.has(r * s.cols + c)) continue;
        expect(pointInPolygon(cellCentre(s, c, r), poly)).toBe(true);
      }
    }
  });

  it("a chunk's outline encloses every shell cell centre (cross, arbitrary)", () => {
    const s = shell([
      ".#.",
      "###",
      ".#.",
    ]);
    const poly = computeOutline(s, SHAPE_ARB)[0]!;
    for (let r = 0; r < s.rows; r += 1) {
      for (let c = 0; c < s.cols; c += 1) {
        if (!s.cells.has(r * s.cols + c)) continue;
        expect(pointInPolygon(cellCentre(s, c, r), poly)).toBe(true);
      }
    }
  });
});

describe("computeOutline — multiple loops", () => {
  it("traces an outer loop and a hole loop for a ring, outer first", () => {
    // 3x3 ring: shell around a hollow centre.
    const ring = shell([
      "###",
      "#.#",
      "###",
    ]);
    const loops = computeOutline(ring, SHAPE_OCTI);
    expect(loops.length).toBe(2);
    const outer = loops[outerLoopIndex(loops)]!;
    // Outer loop must enclose the hollow centre's cell centre.
    const hollow = cellCentre(ring, 1, 1);
    expect(pointInPolygon(hollow, outer)).toBe(true);
    // The hole loop must NOT enclose a point on the ring itself.
    const ringPoint = cellCentre(ring, 0, 0);
    const hole = loops.find((l) => l !== outer)!;
    expect(pointInPolygon(ringPoint, hole)).toBe(false);
  });
});

describe("extractShellLegacy", () => {
  it("treats every non-empty cell as shell", () => {
    const grid = {
      cols: 2,
      rows: 2,
      cells: [
        { kind: "hull" },
        { kind: "empty" },
        { kind: "module" },
        { kind: "floor" },
      ],
    };
    const s = extractShellLegacy(grid);
    expect(s.cols).toBe(2);
    expect(s.rows).toBe(2);
    expect(Array.from(s.cells).sort((a, b) => a - b)).toEqual([0, 2, 3]);
  });
});
