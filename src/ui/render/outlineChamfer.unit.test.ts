import { describe, expect, it } from "vitest";

import { chamferOutline } from "@/ui/render/outlineChamfer";

/** Build a clockwise rectangle in y-down metre space (interior on the right). */
function cwRect(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

describe("chamferOutline", () => {
  it("bevels every convex corner of a clockwise rectangle into a 45° edge", () => {
    const bevelled = chamferOutline([cwRect(0, 0, 4, 4)], 0.5);
    expect(bevelled).toHaveLength(1);
    // Each of the 4 corners becomes two vertices, so the loop grows from 4 to 8.
    expect(bevelled[0]).toHaveLength(8);
    // The first corner (0,0): the in-edge runs north from (0,4), the out-edge
    // runs east to (4,0). p1 steps back along the in-edge to (0, 0.5); p2 steps
    // forward along the out-edge to (0.5, 0).
    const loop = bevelled[0]!;
    expect(loop[0]).toEqual({ x: 0, y: 0.5 });
    expect(loop[1]).toEqual({ x: 0.5, y: 0 });
  });

  it("leaves concave notches untouched", () => {
    // An L-shape with one concave (inner) corner at (2,2), clockwise.
    const lShape = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const bevelled = chamferOutline([lShape], 0.5)[0]!;
    // 5 convex corners double to 10 vertices; the single concave corner stays 1.
    expect(bevelled).toHaveLength(11);
    // The concave vertex (2,2) is emitted verbatim (no chamfer point pair).
    expect(bevelled).toContainEqual({ x: 2, y: 2 });
  });

  it("handles counter-clockwise loops by inverting the convex test", () => {
    const ccw = [
      { x: 0, y: 0 },
      { x: 0, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 0 },
    ];
    const bevelled = chamferOutline([ccw], 0.5)[0]!;
    // All 4 corners are convex for the CCW loop, so all are bevelled.
    expect(bevelled).toHaveLength(8);
  });

  it("does not chamfer existing 45° diagonal edges", () => {
    // A rectangle whose right edge is a 45° staircase step: the diagonal-corner
    // vertices must pass through unchanged because the incident edge is not
    // axis-aligned.
    const withDiagonal = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 6, y: 4 }, // diagonal edge from (4,2) -> (6,4)
      { x: 0, y: 4 },
    ];
    const bevelled = chamferOutline([withDiagonal], 0.5)[0]!;
    // (4,2) has an axis-aligned in-edge but a diagonal out-edge -> not bevelled.
    expect(bevelled).toContainEqual({ x: 4, y: 2 });
    // (6,4) has a diagonal in-edge -> not bevelled either.
    expect(bevelled).toContainEqual({ x: 6, y: 4 });
  });

  it("passes sub-bevel edges through unchanged", () => {
    // A 1x1 rectangle with a bevel larger than the edges: nothing is bevelled.
    const tiny = cwRect(0, 0, 1, 1);
    const bevelled = chamferOutline([tiny], 2)[0]!;
    expect(bevelled).toHaveLength(4);
  });

  it("handles multiple loops (outer hull plus a hole)", () => {
    const outer = cwRect(0, 0, 10, 10);
    const hole = cwRect(4, 4, 6, 6);
    const bevelled = chamferOutline([outer, hole], 0.5);
    expect(bevelled).toHaveLength(2);
    expect(bevelled[0]).toHaveLength(8);
    expect(bevelled[1]).toHaveLength(8);
  });

  it("does not mutate the input loops", () => {
    const input = [cwRect(0, 0, 4, 4)];
    const snapshot = JSON.stringify(input);
    chamferOutline(input, 0.5);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("returns the loop verbatim for fewer than three vertices or zero bevel", () => {
    expect(chamferOutline([[{ x: 0, y: 0 }, { x: 1, y: 0 }]], 0.5)[0]).toHaveLength(2);
    expect(chamferOutline([cwRect(0, 0, 4, 4)], 0)[0]).toHaveLength(4);
  });
});
