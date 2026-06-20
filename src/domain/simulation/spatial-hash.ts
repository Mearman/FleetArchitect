import { DREADNOUGHT_MAX_LENGTH_M } from "@/domain/grid";

/**
 * A uniform spatial-hash broad-phase over occupied ship cells in world space.
 *
 * Every alive ship contributes one entry per occupied cell, positioned at the
 * cell's world-space centre (the ship's pose composed with the cell's
 * ship-local centre). Entries are bucketed into a uniform grid whose bucket
 * size is {@link WORLD_BUCKET_M} — a coarse *world* bucket, deliberately
 * decoupled from the (now 1 m) ship-interior `CELL_SIZE`. A point query touches
 * only the small block of buckets its radius spans rather than scanning every
 * cell in the battle.
 *
 * Why decouple the bucket from `CELL_SIZE`: the bucket size is a broad-phase
 * tuning, not a geometry fact. Sizing it to the interior cell (1 m) would make
 * buckets far finer than any query needs — a swept-segment query over a
 * thousand-metre per-tick displacement would walk a thousand bucket steps, and
 * a ship would scatter its cells across hundreds of buckets. Sizing the bucket
 * to the largest ship's span keeps a ship's cells in a handful of buckets and a
 * weapon/collision query touching a small, near-constant block — the right
 * granularity for the broad phase regardless of the interior resolution.
 *
 * The hash backs three formerly O(n²) scans: projectile-vs-cell hits,
 * ship-vs-ship cell-overlap collision, and (where it helps) targeting/PD. It is
 * pure and generic over the entry payload `S` so it can be unit-tested against a
 * brute-force reference on a small case.
 */

/**
 * World-space bucket size (metres) for the broad-phase spatial hash. Anchored
 * to the largest ship's physical span ({@link DREADNOUGHT_MAX_LENGTH_M}) so a
 * single ship's occupied cells fall into a small, bounded block of buckets and
 * a typical contact/weapon query touches a near-constant number of buckets. It
 * is a coarse world bucket, independent of the metre-scale `CELL_SIZE`: the
 * hash stays correct for any bucket size (the span/pad/step all derive from it,
 * so every query returns a superset of the true candidates), and this value is
 * chosen purely so the broad phase is selective without being wastefully fine.
 */
export const WORLD_BUCKET_M = DREADNOUGHT_MAX_LENGTH_M;

/** One occupied cell placed in world space, carrying an arbitrary payload. */
export interface WorldCellEntry<S> {
  /** Whatever the caller needs back on a hit — a ship/module handle. */
  payload: S;
  /** World-space cell centre. */
  wx: number;
  wy: number;
}

/** Integer bucket key for a world coordinate, derived from `WORLD_BUCKET_M`. */
function bucketCoord(world: number): number {
  return Math.floor(world / WORLD_BUCKET_M);
}

function bucketKey(bx: number, by: number): string {
  return `${bx},${by}`;
}

export class SpatialHash<S> {
  private readonly buckets = new Map<string, WorldCellEntry<S>[]>();
  private readonly all: WorldCellEntry<S>[] = [];

  /** Insert one world-space cell entry. */
  insert(payload: S, wx: number, wy: number): void {
    const entry: WorldCellEntry<S> = { payload, wx, wy };
    this.all.push(entry);
    const key = bucketKey(bucketCoord(wx), bucketCoord(wy));
    const bucket = this.buckets.get(key);
    if (bucket === undefined) this.buckets.set(key, [entry]);
    else bucket.push(entry);
  }

  /** Every entry inserted, in insertion order. */
  entries(): readonly WorldCellEntry<S>[] {
    return this.all;
  }

  /**
   * Candidate entries whose bucket overlaps the query disc of the given radius
   * about (wx, wy). The result is a superset of the entries actually within
   * `radius` — the caller does the exact distance test. The bucket span is
   * `ceil(radius / WORLD_BUCKET_M)` so a query radius larger than one bucket
   * still reaches every bucket it could touch.
   */
  candidates(wx: number, wy: number, radius: number): WorldCellEntry<S>[] {
    const span = Math.max(1, Math.ceil(radius / WORLD_BUCKET_M));
    const cx = bucketCoord(wx);
    const cy = bucketCoord(wy);
    const out: WorldCellEntry<S>[] = [];
    for (let bx = cx - span; bx <= cx + span; bx += 1) {
      for (let by = cy - span; by <= cy + span; by += 1) {
        const bucket = this.buckets.get(bucketKey(bx, by));
        if (bucket === undefined) continue;
        for (const entry of bucket) out.push(entry);
      }
    }
    return out;
  }

  /**
   * Candidate entries whose bucket lies within `radius` of the swept SEGMENT
   * from `(x0, y0)` to `(x1, y1)` — the path a moving point traces in one tick.
   * The result is a superset of the entries actually within `radius` of the
   * segment; the caller does the exact test.
   *
   * Why this exists: the disc query {@link candidates} scans the full square
   * block of buckets spanning its radius, so widening that radius by a ship's
   * per-tick displacement to catch tunnelling (the swept anti-tunnelling test in
   * collision resolution) costs `O((displacement / WORLD_BUCKET_M)^2)` — fine at
   * combat speeds, catastrophic once the relativistic integrator drives a ship
   * to a fraction of c (a displacement of ~1e6 m/tick spans thousands of buckets
   * per axis → billions of empty-bucket probes per ship per tick). A ship can
   * only tunnel along the LINE it travelled, not across the whole disc, so
   * walking the buckets along that segment is both sufficient and
   * `O(displacement / WORLD_BUCKET_M)` — linear, not quadratic.
   *
   * The walk steps in `WORLD_BUCKET_M`-sized increments along the segment and
   * gathers the `(2·pad+1)^2` block of buckets around each step, where `pad =
   * ceil(radius / WORLD_BUCKET_M)` covers the perpendicular contact radius. Buckets
   * are visited in a fixed order (segment progression, then the padding block in
   * row-major order) and each entry is emitted at most once (deduped by a seen
   * set of bucket keys), so the result is a deterministic, order-stable superset
   * — the determinism contract the collision step depends on. Pure: no RNG, no
   * clock, no Map iteration-order dependence.
   */
  candidatesAlongSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
  ): WorldCellEntry<S>[] {
    const pad = Math.max(0, Math.ceil(radius / WORLD_BUCKET_M));
    const out: WorldCellEntry<S>[] = [];
    const seenBuckets = new Set<string>();
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    // Number of WORLD_BUCKET_M-spaced samples along the segment (at least the
    // two endpoints). Deterministic function of the segment length.
    const steps = Math.max(1, Math.ceil(length / WORLD_BUCKET_M));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const sx = x0 + dx * t;
      const sy = y0 + dy * t;
      const cx = bucketCoord(sx);
      const cy = bucketCoord(sy);
      for (let bx = cx - pad; bx <= cx + pad; bx += 1) {
        for (let by = cy - pad; by <= cy + pad; by += 1) {
          const key = bucketKey(bx, by);
          if (seenBuckets.has(key)) continue;
          seenBuckets.add(key);
          const bucket = this.buckets.get(key);
          if (bucket === undefined) continue;
          for (const entry of bucket) out.push(entry);
        }
      }
    }
    return out;
  }

  /**
   * The entry nearest to (wx, wy) within `radius` for which `accept` returns
   * true, or undefined if none qualifies. Distance is measured cell-centre to
   * the query point. Used by projectile-vs-cell hit selection to find the
   * frontmost cell on a path sample.
   */
  nearestWithin(
    wx: number,
    wy: number,
    radius: number,
    accept: (payload: S) => boolean,
  ): WorldCellEntry<S> | undefined {
    let best: WorldCellEntry<S> | undefined;
    let bestDistSq = radius * radius;
    for (const entry of this.candidates(wx, wy, radius)) {
      if (!accept(entry.payload)) continue;
      const dx = entry.wx - wx;
      const dy = entry.wy - wy;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        best = entry;
      }
    }
    return best;
  }
}

/**
 * World-space centre of a ship-local cell point. Composes the ship's pose
 * (position + facing) with the cell's ship-local centre `(localX, localY)`:
 * rotate the local point by the ship's facing, then translate by its position.
 * This is the single source of truth for where a cell sits in the battle so the
 * broad-phase, collision, and hit code all agree.
 */
export function cellWorldPosition(
  shipX: number,
  shipY: number,
  facing: number,
  localX: number,
  localY: number,
): { wx: number; wy: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return {
    wx: shipX + localX * c - localY * s,
    wy: shipY + localX * s + localY * c,
  };
}
