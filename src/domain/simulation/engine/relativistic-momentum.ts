/**
 * The closed-form relativistic momentum integrator (Phase 3 / N14).
 *
 * The Newtonian velocity update adds `F/m` straight onto velocity and has no
 * speed limit, so sustained thrust drives a ship past `c`. This module replaces
 * that step with a relativistic one that works in MOMENTUM space — where force
 * is still linear — and maps the result back to a velocity bounded by `c`.
 *
 * Leaf module: imports only the speed-of-light anchor from `config`, so it
 * cannot originate an import cycle and can be unit-tested in isolation.
 */

import { SPEED_OF_LIGHT_M_PER_TICK } from "./config";

/**
 * The Lorentz factor of a momentum, computed straight from `p` and `m·c` as
 * `gamma = sqrt(1 + (|p| / (m·c))^2)`. This is the cancellation-free form: the
 * algebraically-equivalent `1/sqrt(1 - beta^2)` with `beta^2 = p^2/(p^2+(mc)^2)`
 * suffers catastrophic cancellation once `p^2` dwarfs `(mc)^2` — `beta^2` rounds
 * to exactly 1, `1 - beta^2` underflows to 0, and gamma blows up to Infinity (so
 * `v = p/(m·gamma)` collapses to 0, the opposite of the physical "v → c"). Going
 * through `(|p|/(mc))^2` instead keeps gamma finite and monotonic for ANY finite
 * momentum, so the velocity it yields, `v = p/(m·gamma)`, is always strictly
 * below `c` with no clamp or cap needed — the speed limit falls out of the
 * algebra rather than being imposed. Pure arithmetic; deterministic.
 */
function lorentzGammaFromMomentum(pMag: number, mc: number): number {
  const ratio = pMag / mc;
  return Math.sqrt(1 + ratio * ratio);
}

/**
 * Closed-form relativistic momentum update for one tick of unit duration.
 *
 * The Newtonian integrator adds `F/m` straight onto velocity, which has no speed
 * limit — sustained thrust drives `v` past `c`. The relativistic integrator
 * instead works in MOMENTUM space, where force is still linear (`dp = F·dt`) but
 * the velocity it maps back to is bounded by `c`:
 *
 *   p' = gamma(v)·m·v + F·dt            (momentum is linear in force)
 *   gamma' = sqrt(1 + (|p'| / (m·c))^2) (cancellation-free Lorentz factor)
 *   v'     = p' / (m·gamma')            (back to velocity, |v'| < c ALWAYS)
 *
 * The velocity recovered from `v = p/(m·gamma)` with `gamma = sqrt(1 +
 * (p/mc)^2)` has magnitude `|p|·c / sqrt(p^2 + (mc)^2)`, which is strictly less
 * than `c` for every finite momentum — so the speed limit is a property of the
 * closed form, not a clamp bolted on. (An earlier draft computed gamma via `1 -
 * beta^2` and a `beta^2` cap; that cap corrupted the velocity at extreme force,
 * letting `v` shoot far past `c`. The cancellation-free gamma above needs no cap
 * and is correct for arbitrarily large force.)
 *
 * Momentum is RE-DERIVED from the live velocity each call (`p = gamma(v)·m·v`)
 * rather than carried as authoritative state: every other system in the engine
 * (gravity, collision impulses, projectile recoil, break-apart) writes velocity
 * directly, so velocity is the single source of truth and a persisted momentum
 * field would silently drop those changes. The ship's `px`/`py` fields hold the
 * post-update momentum purely as a derived record. Because `p = gamma·m·v` is
 * the exact inverse of `v = p / (m·gamma)`, the round-trip through momentum is
 * lossless and, at sub-relativistic speed (`gamma → 1`), reduces exactly to the
 * Newtonian `v' = v + F/m`.
 *
 * Pure and deterministic: a fixed sequence of arithmetic operations on the
 * inputs, no iteration, no root-finding, no RNG, no clock. The same `(vx, vy,
 * fx, fy, m)` always yields the same `(px, py, vx, vy)` bit-for-bit.
 *
 * `mass` is floored at 1 to match the Newtonian branch's `Math.max(ship.mass,
 * 1)` guard (a stripped hull never divides by zero); a non-positive mass is not
 * a physical ship.
 */
export function relativisticMomentumStep(
  vx: number,
  vy: number,
  fx: number,
  fy: number,
  mass: number,
): { px: number; py: number; vx: number; vy: number } {
  const m = Math.max(mass, 1);
  const c = SPEED_OF_LIGHT_M_PER_TICK;
  const mc = m * c;

  // Re-derive the incoming relativistic momentum from the live velocity:
  // p = gamma(v)·m·v, with the velocity's own Lorentz factor.
  const speed = Math.hypot(vx, vy);
  // gamma(v) = 1/sqrt(1 - (v/c)^2). A velocity produced by THIS step is always
  // sub-c, but an external Newtonian write between ticks — gravity near the
  // black hole, a collision impulse, projectile recoil — has no speed limit and
  // can hand this step a `v >= c`. Squaring such a beta would make `1 - beta^2`
  // zero or negative and the gamma NaN/Infinity, which would silently poison
  // determinism. Clamp `beta^2` just below 1 so the incoming gamma stays large
  // but finite; the new momentum it builds is then mapped back through the
  // cancellation-free `gamma'` below, which returns a strictly sub-c velocity —
  // so an over-c external write is corrected back under the limit this tick
  // rather than propagating a NaN. The clamp is `1 - 2^-52` (one ULP below 1),
  // the largest double strictly less than 1, so it never fires for a genuinely
  // sub-c velocity and only catches the unphysical external overshoot.
  const betaSq = Math.min((speed * speed) / (c * c), 1 - Number.EPSILON);
  const velocityGamma = 1 / Math.sqrt(1 - betaSq);
  const pxOld = velocityGamma * m * vx;
  const pyOld = velocityGamma * m * vy;

  // Step 1: force is linear in momentum space (dt = 1 tick).
  const pNewX = pxOld + fx;
  const pNewY = pyOld + fy;

  // Steps 2-3: map the new momentum back to a velocity bounded by c, via the
  // cancellation-free Lorentz factor (no beta^2 cap — see the helper).
  const pMag = Math.hypot(pNewX, pNewY);
  const gamma = lorentzGammaFromMomentum(pMag, mc);
  const invMGamma = 1 / (m * gamma);
  return {
    px: pNewX,
    py: pNewY,
    vx: pNewX * invMGamma,
    vy: pNewY * invMGamma,
  };
}
