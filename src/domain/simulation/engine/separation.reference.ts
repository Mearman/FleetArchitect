/**
 * REFERENCE (oracle) for the spatial-grid separation heading: the frozen O(N²)
 * full-scan the optimised {@link separationHeading} (in ./separation) replaces
 * with a uniform-grid candidate gather. Not wired into production; production
 * runs {@link separationHeading}. The separation equivalence unit test
 * (engine.separation.equivalence) calls both on identical fields and asserts the
 * heading/weight results match byte-for-byte; the whole-battle lossless digest
 * gate is the final arbiter.
 *
 * The optimisation is lossless because the separation field is short-range:
 * {@link separationWeight} returns exactly 0 for any neighbour outside the pair's
 * outer edge, so such neighbours contribute nothing. The optimised path gathers
 * a superset of the contributing neighbours via the spatial hash, re-sorts them
 * into this same id order, and runs the identical accumulation — so the
 * candidate SET and summation ORDER are unchanged. This reference is the
 * straight full-scan over the sorted bodies with no index, frozen exactly as the
 * loop read before the optimisation; it shares only the leaf weight function
 * ({@link separationWeight}) so the field shape cannot drift between the two.
 */

import { fastHypot } from "./hypot";
import { separationWeight, type SepBody } from "./separation";
import type { SimShip } from "./types";

/**
 * The net separation heading and peak proximity weight for `ship` over every
 * other body in `bodies`, summed in `bodies`' fixed id order — the original
 * O(N²) scan, frozen as the oracle. Iterates every body (no spatial index),
 * applying the same per-neighbour weight/sum/peak as the optimised path.
 */
export function separationHeadingReference(
  ship: SimShip,
  bodies: readonly SepBody[],
): { heading: number; weight: number } | undefined {
  let sumX = 0;
  let sumY = 0;
  let peak = 0;
  for (const o of bodies) {
    if (o.id === ship.instanceId) continue;
    const dx = ship.x - o.x;
    const dy = ship.y - o.y;
    const dist = fastHypot(dx, dy);
    const w = separationWeight(dist, ship.radius + o.radius);
    if (w <= 0 || dist <= 0) continue;
    sumX += (dx / dist) * w;
    sumY += (dy / dist) * w;
    if (w > peak) peak = w;
  }
  if (peak <= 0) return undefined;
  if (sumX * sumX + sumY * sumY < 1e-12) return undefined;
  return { heading: Math.atan2(sumY, sumX), weight: peak };
}
