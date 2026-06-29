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
 *
 * Key encoding. The production store keys buckets by INTEGER bucket coordinates
 * (a two-level `Map<number, Map<number, …>>`), not the original `${bx},${by}`
 * template string. Every insert / lookup / candidate walk previously allocated
 * and hashed a fresh string — a known V8 hidden cost underpinning every
 * collision broad-phase and projectile swept-cell query. Integer-keyed Maps
 * hash the integer directly (no allocation, no content hash), so the two-level
 * lookup is markedly faster. The two-level form is chosen over packing the pair
 * into one number because the arena is unbounded: with
 * `SPEED_OF_LIGHT_M_PER_TICK ≈ 1e7` and battles of up to 18 000 ticks, a
 * relativistic ship can reach bucket coordinates that exceed any provable
 * 26-bits-per-axis safe-integer packing window, and a silent pack collision
 * would corrupt determinism. Two integer keys have no precision ceiling. The
 * reference (oracle) store ({@link StringBucketStore}) keeps the original
 * string keys; an equivalence test asserts both stores produce identical
 * candidate entries in identical order on randomised operations.
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

/**
 * The bucket key-encoding seam. The shared core ({@link SpatialHashCore})
 * stores and looks up buckets through this interface, so the production
 * (integer-keyed) and reference (string-keyed) stores are the ONLY points of
 * difference between the optimised and oracle implementations — exactly the
 * "differ only in the key encoding" contract the equivalence test relies on.
 */
interface BucketStore<S> {
  /** The bucket at `(bx, by)`, or `undefined` when no entry has been inserted there. */
  get(bx: number, by: number): WorldCellEntry<S>[] | undefined;
  /** Record a (possibly empty-then-filled) bucket at `(bx, by)`. */
  set(bx: number, by: number, bucket: WorldCellEntry<S>[]): void;
}

/**
 * OPTIMISED (production) bucket store: a two-level
 * `Map<number, Map<number, WorldCellEntry<S>[]>>` keyed by integer bucket
 * coordinates. No key allocation and no precision ceiling (see the file header
 * for why two integer keys are used instead of a single packed number). Map
 * iteration order is insertion order at both levels; the core inserts in a
 * fixed order so the candidate sequence is deterministic.
 */
class IntegerBucketStore<S> implements BucketStore<S> {
  private readonly outer = new Map<number, Map<number, WorldCellEntry<S>[]>>();

  get(bx: number, by: number): WorldCellEntry<S>[] | undefined {
    return this.outer.get(bx)?.get(by);
  }

  set(bx: number, by: number, bucket: WorldCellEntry<S>[]): void {
    let inner = this.outer.get(bx);
    if (inner === undefined) {
      inner = new Map<number, WorldCellEntry<S>[]>();
      this.outer.set(bx, inner);
    }
    inner.set(by, bucket);
  }
}

/**
 * REFERENCE (oracle) bucket store: a `Map<string, WorldCellEntry<S>[]>` keyed
 * by the original `${bx},${by}` template string. Kept as a first-class
 * implementation the equivalence test compares against the optimised integer
 * store. Not wired into production; production uses {@link IntegerBucketStore}.
 * Allocates and hashes a string per insert / lookup — exactly the cost the
 * integer store removes.
 */
class StringBucketStore<S> implements BucketStore<S> {
  private readonly buckets = new Map<string, WorldCellEntry<S>[]>();

  private key(bx: number, by: number): string {
    return `${bx},${by}`;
  }

  get(bx: number, by: number): WorldCellEntry<S>[] | undefined {
    return this.buckets.get(this.key(bx, by));
  }

  set(bx: number, by: number, bucket: WorldCellEntry<S>[]): void {
    this.buckets.set(this.key(bx, by), bucket);
  }
}

/**
 * Shared spatial-hash core. The bucket store (the key-encoding seam) is the
 * ONLY thing that differs between the production {@link SpatialHash} and the
 * reference {@link SpatialHashReference}; every query path — insert, entries,
 * candidates, forEachCandidate, candidatesAlongSegment, nearestWithin — is
 * shared and byte-identical between them, so candidate entries come out in the
 * same order regardless of how buckets are keyed.
 *
 * Determinism of the candidate sequence: each query walks a deterministic
 * row-major block of integer bucket coordinates (and, for the segment walk, a
 * deterministic sample progression with a two-level integer seen-set dedup), so
 * the order in which buckets are visited is fixed by the core, not by Map
 * iteration order. Within a bucket, entries are in insertion order. The store's
 * own iteration order is never observed — only point `get(bx, by)` lookups — so
 * swapping the key encoding cannot change which entries are emitted or when.
 */
abstract class SpatialHashCore<S> {
  private readonly all: WorldCellEntry<S>[] = [];
  protected constructor(private readonly buckets: BucketStore<S>) {}

  /** Insert one world-space cell entry. */
  insert(payload: S, wx: number, wy: number): void {
    const entry: WorldCellEntry<S> = { payload, wx, wy };
    this.all.push(entry);
    const bx = bucketCoord(wx);
    const by = bucketCoord(wy);
    const bucket = this.buckets.get(bx, by);
    if (bucket === undefined) this.buckets.set(bx, by, [entry]);
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
    const out: WorldCellEntry<S>[] = [];
    this.forEachCandidate(wx, wy, radius, (entry) => {
      out.push(entry);
    });
    return out;
  }

  /**
   * No-alloc candidate iteration: invokes `callback` once per entry whose bucket
   * overlaps the query disc of the given radius about (wx, wy), in the same
   * order {@link candidates} would return them. The collision broad-phase hot
   * loop (per-cell, per-pair) consumes the candidates immediately, so routing it
   * through this callback avoids allocating a fresh result array per cell per
   * candidate pair. Same superset contract and sequence as {@link candidates}.
   */
  forEachCandidate(
    wx: number,
    wy: number,
    radius: number,
    callback: (entry: WorldCellEntry<S>) => void,
  ): void {
    const span = Math.max(1, Math.ceil(radius / WORLD_BUCKET_M));
    const cx = bucketCoord(wx);
    const cy = bucketCoord(wy);
    for (let bx = cx - span; bx <= cx + span; bx += 1) {
      for (let by = cy - span; by <= cy + span; by += 1) {
        const bucket = this.buckets.get(bx, by);
        if (bucket === undefined) continue;
        for (const entry of bucket) callback(entry);
      }
    }
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
   * row-major order) and each entry is emitted at most once (deduped by a
   * two-level integer seen-set of bucket coordinates), so the result is a
   * deterministic, order-stable superset — the determinism contract the
   * collision step depends on. Pure: no RNG, no clock, no Map iteration-order
   * dependence. The seen-set is keyed by integer bucket coordinates at both
   * levels, so no string allocation occurs here either; it is shared by the
   * production and reference stores (it depends only on the integer coords, not
   * on the bucket key encoding).
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
    // Two-level integer seen-set: outer keyed by bx, inner by by. A Set of
    // integer keys (two levels, no packing) — no string allocation and no
    // precision ceiling, matching the bucket store's integer-key contract.
    const seenBuckets = new Map<number, Set<number>>();
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
          let inner = seenBuckets.get(bx);
          if (inner === undefined) {
            inner = new Set<number>();
            seenBuckets.set(bx, inner);
          }
          if (inner.has(by)) continue;
          inner.add(by);
          const bucket = this.buckets.get(bx, by);
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
   * frontmost cell on a path sample. Iterates via {@link forEachCandidate} so it
   * allocates no candidate array of its own.
   */
  nearestWithin(
    wx: number,
    wy: number,
    radius: number,
    accept: (payload: S) => boolean,
  ): WorldCellEntry<S> | undefined {
    let best: WorldCellEntry<S> | undefined;
    let bestDistSq = radius * radius;
    this.forEachCandidate(wx, wy, radius, (entry) => {
      if (!accept(entry.payload)) return;
      const dx = entry.wx - wx;
      const dy = entry.wy - wy;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        best = entry;
      }
    });
    return best;
  }
}

/**
 * Production spatial hash: integer-keyed two-level bucket store
 * ({@link IntegerBucketStore}). This is the broad phase the engine builds and
 * queries every tick.
 */
export class SpatialHash<S> extends SpatialHashCore<S> {
  constructor() {
    super(new IntegerBucketStore<S>());
  }
}

/**
 * REFERENCE (oracle) spatial hash: the original string-keyed bucket store
 * ({@link StringBucketStore}), kept as a first-class implementation the
 * equivalence test compares against the optimised {@link SpatialHash}. Not
 * wired into production; production runs {@link SpatialHash}.
 */
export class SpatialHashReference<S> extends SpatialHashCore<S> {
  constructor() {
    super(new StringBucketStore<S>());
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
  return cellWorldPositionCs(shipX, shipY, Math.cos(facing), Math.sin(facing), localX, localY);
}

/**
 * As {@link cellWorldPosition}, but takes the precomputed cosine and sine of the
 * ship's facing. Hot callers that project every cell of one ship (the per-tick
 * cell-hash build, the penetration path) pass `cos(facing)`/`sin(facing)` once
 * per ship instead of re-running them per cell. Bit-identical to
 * {@link cellWorldPosition}: same values, same arithmetic order.
 */
export function cellWorldPositionCs(
  shipX: number,
  shipY: number,
  cosF: number,
  sinF: number,
  localX: number,
  localY: number,
): { wx: number; wy: number } {
  return {
    wx: shipX + localX * cosF - localY * sinF,
    wy: shipY + localX * sinF + localY * cosF,
  };
}
