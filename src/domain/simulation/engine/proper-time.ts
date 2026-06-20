/**
 * Proper time (Phase 4). A moving ship in a gravitational field ages slower
 * than a static observer: its rates (weapon cooldowns, crew tasks, shield
 * recharge, repair, sensor sweeps) tick by its PROPER time, which is the map
 * (preferred) frame time scaled by a combined time-dilation factor.
 *
 *   d(tau)/d(t) = sqrt( (1 - v^2/c^2) · (1 + 2·Phi/c^2) )
 *
 * The first factor is the special-relativistic (velocity) dilation; the second
 * is the general-relativistic (gravitational potential) dilation. Both are
 * dimensionless; the product is the dilation factor (1 = real-time, <1 =
 * slowed). This module is the honest physics; applying the factor to each rate
 * consumer is integration.
 *
 * Units: velocity dilation uses the velocity/c ratio (sim velocity is m/tick,
 * so c in m/tick — consistent, dimensionless). Gravitational dilation uses
 * Phi/c^2 where Phi = -Sum(GM/r) is in SI m^2/s^2, so c in m/s. The two are
 * independent dimensionless factors that multiply.
 */

import { SPEED_OF_LIGHT_M_PER_S, SPEED_OF_LIGHT_M_PER_TICK } from "./config";

/** A massive body contributing to the gravitational potential. `gm` is the
 *  standard gravitational parameter GM (m^3/s^2) — real physics, looked up
 *  (e.g. a black hole's mass -> GM). */
export interface GravityBody {
  gm: number;
  x: number;
  y: number;
}

/** The special-relativistic time-dilation factor for a ship moving at `speed`
 *  (m/tick): sqrt(1 - (v/c)^2). At rest -> 1; approaching c -> 0 (time stops);
 *  clamped to 0 at v >= c (a real ship never reaches c; the clamp guards the
 *  sqrt against floating-point overshoot). */
export function velocityTimeDilation(speed: number): number {
  const beta = speed / SPEED_OF_LIGHT_M_PER_TICK;
  const b2 = beta * beta;
  if (b2 >= 1) return 0;
  // Below float64 precision (beta^2 < ~1e-16) the dilation sqrt(1 - b2)
  // rounds to 0.99999999999999xx — indistinguishable from 1 but enough
  // to drift integer-rate cooldowns by a sub-tick per decrement. Return
  // exactly 1 when the effect is below representable precision.
  if (b2 < 1e-10) return 1;
  return Math.sqrt(1 - b2);
}

/** The general-relativistic time-dilation factor at gravitational potential
 *  `phi` (m^2/s^2, negative): sqrt(1 + 2·Phi/c^2). Flat space (Phi = 0) -> 1;
 *  deep in a well (Phi -> -c^2/2, the Schwarzschild r_s) -> 0; clamped to 0 if
 *  the potential is so deep the expression would go negative (inside r_s —
 *  unphysical for a hovering observer). */
export function gravitationalTimeDilation(phi: number): number {
  const factor = 1 + (2 * phi) / (SPEED_OF_LIGHT_M_PER_S * SPEED_OF_LIGHT_M_PER_S);
  if (factor <= 0) return 0;
  if (factor > 1 - 1e-12) return 1; // Below float precision.
  return Math.sqrt(factor);
}

/** The combined proper-time dilation factor: the product of the velocity and
 *  gravitational factors. This is what a ship's rates multiply by each tick. */
export function combinedDilation(speed: number, phi: number): number {
  return velocityTimeDilation(speed) * gravitationalTimeDilation(phi);
}

/** The total gravitational potential Phi = -Sum(GM_i / r_i) at a point from a
 *  list of bodies (m^2/s^2). Pure function of the body list and position. */
export function gravitationalPotential(
  bodies: readonly GravityBody[],
  x: number,
  y: number,
): number {
  let phi = 0;
  for (const b of bodies) {
    const r = Math.hypot(b.x - x, b.y - y);
    if (r > 0) phi -= b.gm / r;
  }
  return phi;
}
