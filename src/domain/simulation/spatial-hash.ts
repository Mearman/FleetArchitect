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
