import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { SpatialHash, cellWorldPosition } from "@/domain/simulation/spatial-hash";

/**
 * The uniform spatial hash is a broad-phase: a point query must return a
 * superset of the entries actually within the query radius, and its nearest-
 * within helper must agree with a brute-force scan. These tests anchor that
 * correctness on small, hand-checkable cases so the engine's collision and
 * hit code can rely on the hash matching an exhaustive search.
 */

interface Pt {
  id: string;
  x: number;
  y: number;
}

/** Brute-force nearest entry within `radius` of (qx, qy), the reference the
 *  hash is checked against. */
function bruteNearest(points: Pt[], qx: number, qy: number, radius: number): Pt | undefined {
  let best: Pt | undefined;
  let bestDistSq = radius * radius;
  for (const p of points) {
    const dx = p.x - qx;
    const dy = p.y - qy;
    const d = dx * dx + dy * dy;
    if (d <= bestDistSq) {
      bestDistSq = d;
      best = p;
    }
  }
  return best;
}

describe("spatial-hash — broad-phase candidates", () => {
  it("candidates are a superset of the entries within the query radius", () => {
    const hash = new SpatialHash<string>();
    const points: Pt[] = [];
    // A spread of points on a coarse lattice plus a few off-grid ones.
    let n = 0;
    for (let gx = -3; gx <= 3; gx += 1) {
      for (let gy = -3; gy <= 3; gy += 1) {
        const x = gx * CELL_SIZE * 1.3 + (gx % 2 === 0 ? 2 : -3);
        const y = gy * CELL_SIZE * 1.3 + (gy % 2 === 0 ? -1 : 4);
        const id = `p${(n += 1)}`;
        points.push({ id, x, y });
        hash.insert(id, x, y);
      }
    }
    // For several query points and radii, every point actually within the
    // radius must appear among the broad-phase candidates.
    for (const q of [
      { x: 0, y: 0, r: CELL_SIZE },
      { x: 5, y: -7, r: CELL_SIZE * 2 },
      { x: -20, y: 15, r: CELL_SIZE * 1.5 },
      { x: 30, y: 30, r: CELL_SIZE * 3 },
    ]) {
      const candidateIds = new Set(hash.candidates(q.x, q.y, q.r).map((c) => c.payload));
      for (const p of points) {
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        if (Math.sqrt(dx * dx + dy * dy) <= q.r) {
          expect(
            candidateIds.has(p.id),
            `point ${p.id} within radius must be a candidate`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("spatial-hash — nearestWithin matches brute force", () => {
  it("returns the same nearest entry as an exhaustive scan", () => {
    const hash = new SpatialHash<Pt>();
    const points: Pt[] = [];
    let n = 0;
    for (let gx = -4; gx <= 4; gx += 1) {
      for (let gy = -4; gy <= 4; gy += 1) {
        const x = gx * (CELL_SIZE * 0.9) + ((gx * 7 + gy * 3) % 5);
        const y = gy * (CELL_SIZE * 1.1) - ((gx * 2 + gy * 5) % 4);
        const p: Pt = { id: `p${(n += 1)}`, x, y };
        points.push(p);
        hash.insert(p, x, y);
      }
    }
    for (let qx = -40; qx <= 40; qx += 7) {
      for (let qy = -40; qy <= 40; qy += 9) {
        for (const r of [CELL_SIZE / 2, CELL_SIZE, CELL_SIZE * 2]) {
          const ref = bruteNearest(points, qx, qy, r);
          const got = hash.nearestWithin(qx, qy, r, () => true);
          if (ref === undefined) {
            expect(got, `no entry within ${r} of (${qx},${qy})`).toBeUndefined();
          } else {
            expect(got, `expected a hit within ${r} of (${qx},${qy})`).toBeDefined();
            // Distances must match (ties may pick different equidistant ids).
            const refD = (ref.x - qx) ** 2 + (ref.y - qy) ** 2;
            const gotD = got === undefined ? Infinity : (got.wx - qx) ** 2 + (got.wy - qy) ** 2;
            expect(gotD).toBeCloseTo(refD, 6);
          }
        }
      }
    }
  });

  it("honours the accept predicate", () => {
    const hash = new SpatialHash<string>();
    hash.insert("near-reject", 1, 0);
    hash.insert("far-accept", 5, 0);
    const got = hash.nearestWithin(0, 0, CELL_SIZE, (p) => p === "far-accept");
    expect(got?.payload).toBe("far-accept");
  });
});

describe("spatial-hash — cellWorldPosition", () => {
  it("composes ship pose with a ship-local cell centre", () => {
    // Facing 0: local offset is unrotated, just translated.
    const a = cellWorldPosition(100, 50, 0, 12, 0);
    expect(a.wx).toBeCloseTo(112, 6);
    expect(a.wy).toBeCloseTo(50, 6);
    // Facing π: the local +x offset points to world -x.
    const b = cellWorldPosition(100, 50, Math.PI, 12, 0);
    expect(b.wx).toBeCloseTo(88, 6);
    expect(b.wy).toBeCloseTo(50, 6);
    // Facing π/2: local +x rotates to world +y.
    const c = cellWorldPosition(0, 0, Math.PI / 2, 10, 0);
    expect(c.wx).toBeCloseTo(0, 6);
    expect(c.wy).toBeCloseTo(10, 6);
  });
});
