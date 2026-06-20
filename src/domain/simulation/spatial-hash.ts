import { CELL_SIZE } from "@/domain/grid";

/**
 * A uniform spatial-hash broad-phase over occupied ship cells in world space.
 *
 * Every alive ship contributes one entry per occupied cell, positioned at the
 * cell's world-space centre (the ship's pose composed with the cell's
 * ship-local centre). Entries are bucketed into a uniform grid whose bucket
 * size is one battle-grid cell (`CELL_SIZE`), so a point query touches only the
 * 3×3 block of buckets around it rather than scanning every cell in the battle.
 *
 * The hash backs three formerly O(n²) scans: projectile-vs-cell hits,
 * ship-vs-ship cell-overlap collision, and (where it helps) targeting/PD. It is
 * pure and generic over the entry payload `S` so it can be unit-tested against a
 * brute-force reference on a small case.
 */

/** One occupied cell placed in world space, carrying an arbitrary payload. */
export interface WorldCellEntry<S> {
  /** Whatever the caller needs back on a hit — a ship/module handle. */
  payload: S;
  /** World-space cell centre. */
  wx: number;
  wy: number;
}

/** Integer bucket key for a world coordinate, derived from `CELL_SIZE`. */
function bucketCoord(world: number): number {
  return Math.floor(world / CELL_SIZE);
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
   * `ceil(radius / CELL_SIZE)` so a query radius larger than one cell still
   * reaches every bucket it could touch.
   */
  candidates(wx: number, wy: number, radius: number): WorldCellEntry<S>[] {
    const span = Math.max(1, Math.ceil(radius / CELL_SIZE));
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
   * collision resolution) costs `O((displacement / CELL_SIZE)^2)` — fine at
   * combat speeds, catastrophic once the relativistic integrator drives a ship
   * to a fraction of c (a displacement of ~1e6 m/tick spans ~80_000 buckets per
   * axis → billions of empty-bucket probes per ship per tick). A ship can only
   * tunnel along the LINE it travelled, not across the whole disc, so walking
   * the buckets along that segment is both sufficient and `O(displacement /
   * CELL_SIZE)` — linear, not quadratic.
   *
   * The walk steps in `CELL_SIZE`-sized increments along the segment and gathers
   * the `(2·pad+1)^2` block of buckets around each step, where `pad =
   * ceil(radius / CELL_SIZE)` covers the perpendicular contact radius. Buckets
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
    const pad = Math.max(0, Math.ceil(radius / CELL_SIZE));
    const out: WorldCellEntry<S>[] = [];
    const seenBuckets = new Set<string>();
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    // Number of CELL_SIZE-spaced samples along the segment (at least the two
    // endpoints). Deterministic function of the segment length.
    const steps = Math.max(1, Math.ceil(length / CELL_SIZE));
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
