/**
 * Penetration path computation: the alive cells of a struck ship that lie on
 * the projectile's (or beam's) line of fire, ordered front to back.
 *
 * Extracted from `weapons.ts` as a leaf utility so the weapon-fire module
 * stays under the file line cap. Pure: no rng, no clock, no mutation — the
 * returned path is consumed synchronously by `applyImpact`.
 */

import { CELL_SIZE } from "@/domain/grid";
import { cellWorldPositionCs } from "@/domain/simulation/spatial-hash";
import type { SimModule, SimShip } from "./types";

/** Reusable parallel-array scratch for {@link penetrationPath}: avoids the
 *  per-hit `{module, along}` wrapper-object + build-array allocation on every
 *  weapon connection. Four buffers cleared-and-refilled each call; the returned
 *  `result` is a BORROW overwritten on the next call, so callers must consume
 *  it synchronously (both call sites pass it straight to {@link applyImpact},
 *  which iterates it within the call). Same clear-and-reuse contract as the
 *  other per-tick scratches on {@link EngineState}; not checkpointed. */
export interface PenetrationPathScratch {
  /** Candidate modules in ship iteration order (parallel to {@link along}). */
  mods: SimModule[];
  /** Per-candidate projection along the firing direction (parallel to {@link mods}). */
  along: number[];
  /** Sort index over {@link mods}/{@link along}, stable-sorted by {@link along}. */
  index: number[];
  /** Borrowed result: modules reordered front-to-back. Overwritten each call. */
  result: SimModule[];
}

export function freshPenetrationPathScratch(): PenetrationPathScratch {
  return { mods: [], along: [], index: [], result: [] };
}

/**
 * Penetration path for a projectile-vs-cell hit: the alive cells of the struck
 * ship that lie on the projectile's line, ordered front to back along its
 * travel direction. The frontmost cell is the one the broad-phase found; cells
 * behind it (further along `(vx, vy)`) and within half a cell of the line of
 * fire follow, so armour-piercing overflow carries straight through the hull
 * rather than scattering to whichever module happens to be nearest. The
 * direction must be a unit vector.
 *
 * Lossless buffer reuse: when `scratch` is supplied (production, threaded from
 * {@link EngineState.penetrationPathScratch}), the prior `{module, along}`
 * wrapper objects and build array are replaced by four reused parallel arrays.
 * Equivalence to the old wrapper sort is exact: candidates are pushed in the
 * same ship-iteration order with bit-identical `along` floats, then an index
 * array `[0..n)` is stable-sorted by the same `along[a] - along[b]` comparator.
 * `Array.prototype.sort` is spec-stable and the index starts in iteration
 * order, so tied `along` values resolve in the same order as the prior stable
 * wrapper sort — byte-identical module-damage-application order on exact ties.
 */
export function penetrationPath(
  ship: SimShip,
  hitWx: number,
  hitWy: number,
  dirX: number,
  dirY: number,
  scratch?: PenetrationPathScratch,
): SimModule[] {
  if (ship.modules === undefined) return [];
  // Reuse the parallel-array scratch when supplied; otherwise allocate (tests
  // that pass no scratch get the prior fresh-allocation behaviour).
  const sc = scratch ?? freshPenetrationPathScratch();
  const mods = sc.mods;
  const along = sc.along;
  mods.length = 0;
  along.length = 0;
  // Projection of the hit point along the travel direction; the path is every
  // cell at or beyond it, within half a cell laterally.
  const hitAlong = hitWx * dirX + hitWy * dirY;
  // cos/sin of the ship's facing are invariant across its cells.
  const cosF = Math.cos(ship.facing);
  const sinF = Math.sin(ship.facing);
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const { wx, wy } = cellWorldPositionCs(ship.x, ship.y, cosF, sinF, m.x, m.y);
    const a = wx * dirX + wy * dirY;
    if (a < hitAlong - CELL_SIZE / 2) continue; // in front of the entry cell
    const perp = Math.abs((wx - hitWx) * -dirY + (wy - hitWy) * dirX);
    if (perp > CELL_SIZE / 2) continue; // off the line of fire
    mods.push(m);
    along.push(a);
  }
  const n = mods.length;
  // Build the sort index [0..n) and stable-sort it by `along`. The index starts
  // in ship-iteration order, so a stable sort resolves tied `along` values in
  // the same order the prior wrapper sort did — byte-identical overflow order.
  const idx = sc.index;
  idx.length = n;
  for (let i = 0; i < n; i += 1) idx[i] = i;
  idx.sort((l, r) => along[l]! - along[r]!);
  const out = sc.result;
  out.length = 0;
  for (const j of idx) out.push(mods[j]!);
  return out;
}
