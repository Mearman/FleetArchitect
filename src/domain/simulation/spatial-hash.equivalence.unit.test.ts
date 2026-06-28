import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/domain/simulation/rng";
import {
  SpatialHash,
  SpatialHashReference,
  WORLD_BUCKET_M,
  type WorldCellEntry,
} from "@/domain/simulation/spatial-hash";

/**
 * Equivalence between the reference (oracle, string-keyed) and production
 * (optimised, integer two-level-keyed) spatial-hash stores. Both share the
 * query core ({@link SpatialHashCore}); the ONLY difference is the bucket key
 * encoding. Because every query walks a deterministic row-major block of
 * INTEGER bucket coordinates (and the segment walk dedups on a two-level
 * integer seen-set), the candidate sequence is fixed by the core, not by Map
 * iteration order — so swapping the key encoding cannot change which entries
 * are emitted or in what order. These tests assert that contract on randomised
 * insert / candidates / candidatesAlongSegment / forEachCandidate operations,
 * including cases (large and negative world coordinates) whose bucket indices
 * exceed any provable single-number packing window, where a silent pack
 * collision would corrupt determinism.
 */

/** A point payload plus its world position. */
interface Pt {
  id: string;
  x: number;
  y: number;
}

/** Deterministic pseudo-random point cloud over a given coordinate range. */
function makePoints(rng: () => number, count: number, span: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < count; i += 1) {
    pts.push({
      id: `p${i}`,
      x: (rng() * 2 - 1) * span,
      y: (rng() * 2 - 1) * span,
    });
  }
  return pts;
}

/** Build both stores over the same points in the same order. */
function buildBoth(points: readonly Pt[]): {
  opt: SpatialHash<string>;
  ref: SpatialHashReference<string>;
} {
  const opt = new SpatialHash<string>();
  const ref = new SpatialHashReference<string>();
  for (const p of points) {
    opt.insert(p.id, p.x, p.y);
    ref.insert(p.id, p.x, p.y);
  }
  return { opt, ref };
}

/** Serialise an entry sequence to a comparable string list (id + exact coords). */
function seq(entries: readonly WorldCellEntry<string>[]): string[] {
  return entries.map((e) => `${e.payload}|${e.wx}|${e.wy}`);
}

/** Collect a forEachCandidate walk into the same serialised form. */
function forEachSeq(
  hash: SpatialHash<string> | SpatialHashReference<string>,
  wx: number,
  wy: number,
  radius: number,
): string[] {
  const out: string[] = [];
  hash.forEachCandidate(wx, wy, radius, (e) => {
    out.push(`${e.payload}|${e.wx}|${e.wy}`);
  });
  return out;
}

describe("spatial-hash — integer vs string key equivalence", () => {
  it("candidates() returns identical entries in identical order", () => {
    const rng = mulberry32(42);
    // Points span several world buckets so queries cross bucket boundaries.
    const points = makePoints(rng, 400, WORLD_BUCKET_M * 8);
    const { opt, ref } = buildBoth(points);
    // Randomised queries: varying centres and radii (1 to 4 buckets).
    for (let q = 0; q < 200; q += 1) {
      const qx = (rng() * 2 - 1) * WORLD_BUCKET_M * 8;
      const qy = (rng() * 2 - 1) * WORLD_BUCKET_M * 8;
      const radius = rng() * WORLD_BUCKET_M * 4 + 1;
      const optSeq = seq(opt.candidates(qx, qy, radius));
      const refSeq = seq(ref.candidates(qx, qy, radius));
      expect(optSeq, `candidates order must match at query ${q}`).toEqual(refSeq);
    }
  });

  it("forEachCandidate() matches candidates() on both stores", () => {
    const rng = mulberry32(99);
    const points = makePoints(rng, 300, WORLD_BUCKET_M * 6);
    const { opt, ref } = buildBoth(points);
    for (let q = 0; q < 100; q += 1) {
      const qx = (rng() * 2 - 1) * WORLD_BUCKET_M * 6;
      const qy = (rng() * 2 - 1) * WORLD_BUCKET_M * 6;
      const radius = rng() * WORLD_BUCKET_M * 3 + 1;
      // forEachCandidate must agree with candidates() on the same store...
      expect(forEachSeq(opt, qx, qy, radius)).toEqual(seq(opt.candidates(qx, qy, radius)));
      expect(forEachSeq(ref, qx, qy, radius)).toEqual(seq(ref.candidates(qx, qy, radius)));
      // ...and both stores must agree with each other on both APIs.
      expect(forEachSeq(opt, qx, qy, radius)).toEqual(forEachSeq(ref, qx, qy, radius));
    }
  });

  it("candidatesAlongSegment() returns identical entries in identical order", () => {
    const rng = mulberry32(7);
    const points = makePoints(rng, 300, WORLD_BUCKET_M * 6);
    const { opt, ref } = buildBoth(points);
    for (let q = 0; q < 150; q += 1) {
      // Segments of varying length and direction, some crossing many buckets
      // (exercising the segment walk's seen-set dedup) and some degenerate.
      const x0 = (rng() * 2 - 1) * WORLD_BUCKET_M * 6;
      const y0 = (rng() * 2 - 1) * WORLD_BUCKET_M * 6;
      const len = rng() * WORLD_BUCKET_M * 10;
      const ang = rng() * Math.PI * 2;
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      const radius = rng() * WORLD_BUCKET_M * 2;
      const optSeq = seq(opt.candidatesAlongSegment(x0, y0, x1, y1, radius));
      const refSeq = seq(ref.candidatesAlongSegment(x0, y0, x1, y1, radius));
      expect(optSeq, `segment order must match at query ${q}`).toEqual(refSeq);
    }
  });

  it("agrees on degenerate segments (zero-length point query)", () => {
    const rng = mulberry32(31);
    const points = makePoints(rng, 100, WORLD_BUCKET_M * 4);
    const { opt, ref } = buildBoth(points);
    // A zero-length segment is a point sample; both stores must agree.
    for (let q = 0; q < 50; q += 1) {
      const x = (rng() * 2 - 1) * WORLD_BUCKET_M * 4;
      const y = (rng() * 2 - 1) * WORLD_BUCKET_M * 4;
      const radius = rng() * WORLD_BUCKET_M + 1;
      const optSeq = seq(opt.candidatesAlongSegment(x, y, x, y, radius));
      const refSeq = seq(ref.candidatesAlongSegment(x, y, x, y, radius));
      expect(optSeq).toEqual(refSeq);
    }
  });

  it("agrees at relativistic-scale world coordinates (no pack collision)", () => {
    // World positions whose bucket indices (~3e7) exceed any provable
    // 26-bits-per-axis packing window. A silent single-number pack collision
    // would make the string-keyed reference disagree with the integer store
    // here; the two-level integer store has no precision ceiling, so both must
    // agree exactly. Anchored to SPEED_OF_LIGHT_M_PER_TICK (~1e7): a few ticks
    // of relativistic drift reach these coordinates.
    const far = 1e10;
    const points: Pt[] = [
      { id: "far-a", x: far, y: far },
      { id: "far-b", x: far + WORLD_BUCKET_M * 1.5, y: far },
      { id: "far-c", x: far, y: far + WORLD_BUCKET_M * 1.5 },
      { id: "near-origin", x: 12, y: -7 },
      { id: "neg-far", x: -far, y: -far + WORLD_BUCKET_M * 0.5 },
    ];
    const { opt, ref } = buildBoth(points);
    const queries: Array<{ qx: number; qy: number; r: number }> = [
      { qx: far, qy: far, r: WORLD_BUCKET_M * 2 },
      { qx: far + 5, qy: far - 5, r: WORLD_BUCKET_M },
      { qx: -far, qy: -far, r: WORLD_BUCKET_M * 2 },
      { qx: 0, qy: 0, r: WORLD_BUCKET_M * 2 },
    ];
    for (const q of queries) {
      expect(seq(opt.candidates(q.qx, q.qy, q.r))).toEqual(seq(ref.candidates(q.qx, q.qy, q.r)));
      expect(forEachSeq(opt, q.qx, q.qy, q.r)).toEqual(forEachSeq(ref, q.qx, q.qy, q.r));
      expect(
        seq(opt.candidatesAlongSegment(q.qx, q.qy, q.qx + WORLD_BUCKET_M * 3, q.qy, q.r)),
      ).toEqual(
        seq(ref.candidatesAlongSegment(q.qx, q.qy, q.qx + WORLD_BUCKET_M * 3, q.qy, q.r)),
      );
    }
  });

  it("entries() insertion order is identical", () => {
    const rng = mulberry32(5);
    const points = makePoints(rng, 150, WORLD_BUCKET_M * 5);
    const { opt, ref } = buildBoth(points);
    expect(seq(opt.entries())).toEqual(seq(ref.entries()));
  });
});
