/**
 * REFERENCE (oracle) for the per-tick phantom step: the frozen O(drones ×
 * total-ships) full-scan the optimised {@link stepPhantoms} (in ./phantoms)
 * replaces with a per-side enemy list built once per tick. Not wired into
 * production; production runs {@link stepPhantoms}. The phantom equivalence
 * unit test (engine.phantoms.equivalence) calls both on identical fleets and
 * asserts the resulting ship state matches byte-for-byte; the whole-battle
 * lossless digest gate is the final arbiter.
 *
 * The optimisation is lossless because the per-side enemy list is built by a
 * single order-preserving pass whose filter (`alive && phantom === undefined`,
 * routed to the opposite side's list) is exactly the conjunction the inner loop
 * re-evaluated per drone per enemy — so the candidate SET and iteration ORDER
 * are unchanged. Intra-tick kills stay reactive because the list holds live
 * references to the SimShip objects: when an earlier drone's `applyImpact`
 * sets `target.alive = false`, the inner loop's `!e.alive` check excludes that
 * target for later drones, identical to this reference's full rescan. This
 * reference is the straight per-drone full-ships scan, frozen exactly as the
 * loop read before the optimisation; it shares only the strike helpers
 * (`applyImpact`, `energyImpactProfile`) so the damage shape cannot drift
 * between the two paths.
 */

import { applyImpact } from "./damage-impact";
import { energyImpactProfile } from "./impact-profile";
import type { SimShip } from "./types";

/**
 * Advance every phantom one tick in place — the original O(drones × ships)
 * scan, frozen as the oracle. Each live drone re-reads the full `ships` array
 * and re-evaluates the alive/side/phantom filter against every entry, so an
 * intra-tick kill by an earlier drone is visible to a later drone via the
 * shared `.alive` flag. The optimised path must match this byte-for-byte.
 */
export function stepPhantomsReference(ships: readonly SimShip[]): void {
  for (const s of ships) {
    if (s.phantom === undefined || !s.alive) continue;
    const ph = s.phantom;
    ph.ticksLeft -= 1;
    if (ph.ticksLeft <= 0) {
      s.alive = false;
      continue;
    }
    if (ph.kind === "drone") {
      // Home on the nearest real enemy and strike if in range.
      let nearest: SimShip | undefined;
      let nearestSq = Number.POSITIVE_INFINITY;
      for (const e of ships) {
        if (!e.alive || e.side === s.side || e.phantom !== undefined) continue;
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < nearestSq) {
          nearest = e;
          nearestSq = dSq;
        }
      }
      if (nearest !== undefined) {
        const dx = nearest.x - s.x;
        const dy = nearest.y - s.y;
        const dist = Math.hypot(dx, dy);
        s.facing = dist > 0 ? Math.atan2(dy, dx) : s.facing;
        const step = Math.min(ph.speed, dist);
        s.x += (dx / (dist || 1)) * step;
        s.y += (dy / (dist || 1)) * step;
        if (dist <= ph.range) {
          applyImpact(
            nearest,
            energyImpactProfile({
              energyJ: ph.damage,
              shieldPiercing: 0,
              armourPiercing: 0,
            }),
            s.x,
            s.y,
          );
        }
      }
    }
  }
}
