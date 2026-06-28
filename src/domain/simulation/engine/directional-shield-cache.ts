/**
 * Per-ship cache of the alive directional-shield-module list, keyed on the
 * {@link aggregatesFingerprint} from `./aggregates-fingerprint`. The candidate
 * set `directionalShieldFor` (in `./damage`) walks each damage event is "alive
 * module with `effect.kind === "shield"` and `shieldArc < 2π`"; `kind`,
 * `shieldArc`, and `shieldFacing` are lifetime-stable (authored at design time
 * and never mutated mid-battle), so the ONLY input that can move the candidate
 * set is a module dying (`alive` flipping to false). `alive` is folded into the
 * fingerprint (count + iteration filter), so an unchanged fingerprint implies
 * the candidate set is unchanged and the cached list of module REFERENCES is
 * still valid. The per-hit selection (highest current `m.hp` whose arc covers
 * the shot) still reads `m.hp` live, exactly as the uncached scan did.
 *
 * WeakMap-keyed on ship identity, so resume (rebuilt state) and break-apart
 * (fresh fragment objects) always miss and rebuild once before the cache
 * repopulates — no explicit invalidation needed. Pure-derived and checkpoint-
 * safe (never captured; a resume re-derives from the restored modules).
 */

import { aggregatesFingerprint } from "./aggregates-fingerprint";
import type { SimModule, SimShip } from "./types";

interface DirectionalShieldCache {
  fingerprint: number;
  shields: SimModule[];
}

const directionalShieldCache = new WeakMap<SimShip, DirectionalShieldCache>();

/**
 * The alive directional-shield modules for `ship` in module-array order, cached
 * against the {@link aggregatesFingerprint}. Byte-identical to a fresh filter on
 * every cache hit (same candidate set, same array order); rebuilt only when the
 * fingerprint moves (a module died since the last call).
 */
export function aliveDirectionalShields(ship: SimShip): SimModule[] {
  if (ship.modules === undefined) return [];
  const fingerprint = aggregatesFingerprint(ship);
  const cached = directionalShieldCache.get(ship);
  if (cached !== undefined && cached.fingerprint === fingerprint) {
    return cached.shields;
  }
  const shields: SimModule[] = [];
  for (const m of ship.modules) {
    if (!m.alive || m.effect.kind !== "shield") continue;
    if (m.shieldArc >= Math.PI * 2) continue; // omnidirectional, use the pool
    shields.push(m);
  }
  directionalShieldCache.set(ship, { fingerprint, shields });
  return shields;
}
