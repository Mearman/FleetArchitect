import { describe, expect, it } from "vitest";

import {
  closestPointOnSegment,
  outerWorldLoop,
  outlineWorldLoops,
  pointInPolygon,
  polygonsContact,
  rayPolygonEntry,
  raySegmentIntersect,
} from "@/domain/simulation/engine/poly-collision";
import type { OutlinedPose, Point } from "@/domain/simulation/engine/poly-collision";

/**
 * Hull-outline polygon collision geometry. These tests exercise the pure
 * primitives — ray/segment intersection, closest-point, polygon overlap, and
 * the ray-into-polygon entry — plus the ship-local-to-world outline transform.
 * Every primitive is deterministic, so the expected numbers are exact.
 */

/** A unit square wound clockwise, corners at the given centre offset. */
function square(cx: number, cy: number, half: number): Point[] {
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

/** A minimal pose carrying just position, facing, and an outline — the
 *  OutlinedPose view the world-space transform helpers read. */
function shipWithOutline(
  x: number,
  y: number,
  facing: number,
  outline: { x: number; y: number }[][] | undefined,
): OutlinedPose {
  return { x, y, facing, outline };
}

describe("raySegmentIntersect", () => {
  const ax = 1;
  const ay = -1;
  const bx = 1;
  const by = 1; // a vertical segment at x = 1 spanning y ∈ [-1, 1]

  it("returns null for a ray parallel to the segment (a miss)", () => {
    // Ray travelling straight up at x = 0 never reaches the x = 1 segment.
    expect(raySegmentIntersect(0, -1, 0, 1, ax, ay, bx, by)).toBeNull();
  });

  it("returns the correct t for a perpendicular hit", () => {
    // Ray from the origin along +x crosses the segment at distance 1.
    expect(raySegmentIntersect(0, 0, 1, 0, ax, ay, bx, by)).toBeCloseTo(1, 12);
  });

  it("returns the correct t for a 45-degree hit", () => {
    // Ray from origin along the unit 45-degree direction crosses x = 1 at
    // (1, 1), which is the segment's upper endpoint; distance = sqrt(2).
    const inv = 1 / Math.SQRT2;
    const t = raySegmentIntersect(0, 0, inv, inv, ax, ay, bx, by);
    expect(t).not.toBeNull();
    expect(t).toBeCloseTo(Math.SQRT2, 12);
  });

  it("returns null for a ray pointing away from the segment", () => {
    // Ray from origin along -x heads away from the x = 1 segment.
    expect(raySegmentIntersect(0, 0, -1, 0, ax, ay, bx, by)).toBeNull();
  });

  it("returns null when the crossing lies off the end of the segment", () => {
    // Ray along +x at y = 5 would cross the infinite line x = 1, but that
    // crossing (1, 5) is past the segment's y ∈ [-1, 1] extent.
    expect(raySegmentIntersect(0, 5, 1, 0, ax, ay, bx, by)).toBeNull();
  });
});

describe("closestPointOnSegment", () => {
  it("projects onto the segment interior", () => {
    const p = closestPointOnSegment(0.5, 5, 0, 0, 1, 0);
    expect(p.x).toBeCloseTo(0.5, 12);
    expect(p.y).toBeCloseTo(0, 12);
  });

  it("clamps to the nearer endpoint when the query is off the end", () => {
    const p = closestPointOnSegment(-3, 4, 0, 0, 1, 0);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(0, 12);
  });

  it("returns the single point of a degenerate segment", () => {
    const p = closestPointOnSegment(9, 9, 2, 3, 2, 3);
    expect(p.x).toBe(2);
    expect(p.y).toBe(3);
  });
});

describe("polygonsContact", () => {
  it("reports a contact point for two overlapping squares", () => {
    const a = square(0, 0, 1); // [-1,1]²
    const b = square(1.5, 0, 1); // overlaps a on x ∈ [0.5, 1]
    const hit = polygonsContact(a, b);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    // The contact sits on a's boundary (its right edge at x = 1).
    expect(hit.x).toBeCloseTo(1, 9);
    expect(Math.abs(hit.y)).toBeLessThanOrEqual(1 + 1e-9);
    // The normal points outward from a toward b: along +x.
    expect(hit.nx).toBeCloseTo(1, 9);
    expect(hit.ny).toBeCloseTo(0, 9);
  });

  it("returns null for two disjoint squares", () => {
    const a = square(0, 0, 1);
    const b = square(5, 0, 1);
    expect(polygonsContact(a, b)).toBeNull();
  });

  it("treats edge-touching squares as a contact at the shared edge", () => {
    // b's left edge sits exactly on a's right edge (x = 1): they touch.
    const a = square(0, 0, 1);
    const b = square(2, 0, 1);
    const hit = polygonsContact(a, b);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit.x).toBeCloseTo(1, 9);
  });
});

describe("pointInPolygon", () => {
  it("detects interior and exterior points", () => {
    const sq = square(0, 0, 1);
    expect(pointInPolygon(0, 0, sq)).toBe(true);
    expect(pointInPolygon(5, 5, sq)).toBe(false);
  });
});

describe("outlineWorldLoops / outerWorldLoop", () => {
  it("translates a ship-local outline by the ship position", () => {
    const ship = shipWithOutline(10, 20, 0, [square(0, 0, 1)]);
    const loops = outlineWorldLoops(ship);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toEqual([
      { x: 9, y: 19 },
      { x: 11, y: 19 },
      { x: 11, y: 21 },
      { x: 9, y: 21 },
    ]);
  });

  it("rotates a ship-local outline by the ship facing", () => {
    // A 90-degree (π/2) facing maps local +x to world +y and local +y to -x.
    const ship = shipWithOutline(0, 0, Math.PI / 2, [
      [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    ]);
    const loops = outlineWorldLoops(ship);
    expect(loops[0]![0]!.x).toBeCloseTo(0, 9);
    expect(loops[0]![0]!.y).toBeCloseTo(1, 9);
    expect(loops[0]![1]!.x).toBeCloseTo(-1, 9);
    expect(loops[0]![1]!.y).toBeCloseTo(0, 9);
  });

  it("returns undefined when the ship has no outline", () => {
    const ship = shipWithOutline(0, 0, 0, undefined);
    expect(outlineWorldLoops(ship)).toEqual([]);
    expect(outerWorldLoop(ship)).toBeUndefined();
  });

  it("picks the largest-area loop as the outer hull", () => {
    const big = square(0, 0, 5);
    const small = square(0, 0, 1);
    const ship = shipWithOutline(0, 0, 0, [small, big]);
    const outer = outerWorldLoop(ship);
    expect(outer).not.toBeUndefined();
    // The outer loop spans ±5, not ±1.
    const xs = outer!.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(5, 9);
  });
});

describe("rayPolygonEntry (hitscan beam vs outline)", () => {
  // A target hull outline: a unit square centred at (10, 0) in world space.
  const hull = square(10, 0, 1); // x ∈ [9, 11], y ∈ [-1, 1]

  it("a beam through the hull enters at the near face", () => {
    // Shooter at the origin firing along +x. The beam first crosses the hull's
    // left edge at x = 9.
    const entry = rayPolygonEntry(0, 0, 1, 0, hull);
    expect(entry).not.toBeNull();
    if (entry === null) return;
    expect(entry.x).toBeCloseTo(9, 9);
    expect(entry.y).toBeCloseTo(0, 9);
    expect(entry.t).toBeCloseTo(9, 9);
    // The struck face is the left edge; its outward normal points back along -x.
    expect(entry.nx).toBeCloseTo(-1, 9);
    expect(entry.ny).toBeCloseTo(0, 9);
  });

  it("a beam that grazes past the hull misses (no entry)", () => {
    // Shooter at the origin firing along +x but offset up to y = 5, well clear
    // of the hull's y ∈ [-1, 1] extent.
    const entry = rayPolygonEntry(0, 5, 1, 0, hull);
    expect(entry).toBeNull();
  });

  it("a beam fired away from the hull misses", () => {
    // Firing along -x from the origin heads away from the hull at +x.
    expect(rayPolygonEntry(0, 0, -1, 0, hull)).toBeNull();
  });
});
