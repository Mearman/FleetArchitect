/**
 * Aggregates-change fingerprint: a rolling hash over the per-module mutable
 * flags `recomputeAggregates` reads, so the per-tick aggregate recompute in the
 * tick loop can be skipped on the (common) no-change tick. Mirrors
 * `aliveCellFingerprint` in `./crew-pathfinding`: a count plus an FNV-32 hash
 * over each alive module in stable array order, combined into a single number.
 *
 * Pure-derived and checkpoint-safe. The `aggregatesChanged` cache is a
 * module-local `WeakMap<SimShip, number>` keyed on ship object identity, so a
 * resumed or break-apart ship (a fresh object) always misses and recompute runs
 * once before the cache repopulates — no explicit invalidation is needed.
 */

import type { SimShip } from "./types";

/**
 * Rolling fingerprint of every per-module input `recomputeAggregates` reads that
 * can change mid-battle. `alive` is folded implicitly via the iteration filter
 * and the count (a module dying is both removed from the hash and decrements the
 * count). The five remaining mutable signals — `manned`, `powerCut`,
 * `fuelStarved`, the sign of `charge` (what `isCharged` reads), and the sign of
 * `techActive` (what the overcharge-surge gate reads) — are packed into one byte
 * per alive module and mixed into the hash.
 *
 * Lifetime-stable fields (`x`/`y`/`mass`/`command`/`hullBaseThrust`) are
 * deliberately omitted: they never change mid-battle, so folding them is
 * constant work that cannot move the fingerprint. `effect.*` is the one
 * exception — effect scaling (engine/effect-scaling.ts) mutates multi-cell
 * anchors' output magnitudes each tick — but it is a PURE function of the alive
 * set this fingerprint already tracks, so it cannot move without a tracked
 * signal also moving. `powered` is an OUTPUT of the
 * recompute (set from `alive` plus the brownout cut), fully determined by the
 * tracked signals plus stable `powerDraw`, so omitting it is correct: when no
 * tracked signal moves, `powered` cannot move either, and a skipped recompute
 * leaves every aggregate at exactly the value a recompute would produce.
 *
 * `charge` and `techActive` are folded as their SIGN because that is the only
 * thing the recompute observes: `isCharged` is `powerDraw<=0 || charge>0`, and
 * the surge gate is `techActive>0`. For modules with `powerDraw<=0` (reactors,
 * hull, ...) `charge` is a constant, so its sign never moves and contributes no
 * spurious change; for power-drawing modules the sign is exactly the gate.
 *
 * Deterministic: modules are visited in array order (the design-time slot
 * order), so the FNV-32 mix is reproducible across runs.
 */
export function aggregatesFingerprint(ship: SimShip): number {
  if (ship.modules === undefined) return 0;
  let count = 0;
  let hash = 2166136261 >>> 0; // FNV-32 offset basis
  for (const m of ship.modules) {
    if (!m.alive) continue;
    count += 1;
    // Pack the mutable signals recomputeAggregates reads (directly or via
    // isCharged/isOperational) into one byte per alive module.
    let bits = 0;
    if (m.manned) bits |= 1 << 0;
    if (m.powerCut) bits |= 1 << 1;
    if (m.fuelStarved) bits |= 1 << 2;
    if (m.charge > 0) bits |= 1 << 3;
    if (m.techActive > 0) bits |= 1 << 4;
    // Fold the cell coordinates (lifetime-stable; mirrors aliveCellFingerprint
    // for collision resistance) then the mutable-flags byte.
    hash ^= (m.col + 0x9e3779b9) & 0xffffffff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (m.row + 0x85ebca6b) & 0xffffffff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (bits + 0x811c9dc5) & 0xffffffff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return count * 0x100000000 + hash;
}

/**
 * Per-ship cache of the last fingerprint computed for `aggregatesChanged`.
 * WeakMap-keyed on ship identity so resume (rebuilt state) and break-apart
 * (fresh fragment objects) always miss and trigger one recompute before the
 * cache repopulates — no explicit invalidation needed on either event.
 */
const aggregatesFingerprintCache = new WeakMap<SimShip, number>();

/**
 * Whether the ship's aggregate-relevant state has changed since the last call.
 * Computes the fingerprint, compares it to the cached value for this ship,
 * updates the cache, and returns whether it moved. The first call on any ship
 * object (cold start, resume, or a freshly-split chunk) returns true: the
 * WeakMap misses, so the caller runs recompute once to establish the aggregates
 * before subsequent ticks can skip.
 */
export function aggregatesChanged(ship: SimShip): boolean {
  const fingerprint = aggregatesFingerprint(ship);
  const cached = aggregatesFingerprintCache.get(ship);
  aggregatesFingerprintCache.set(ship, fingerprint);
  return cached !== fingerprint;
}
