/**
 * Phase-10 aberration geometry: the apparent position at which a moving observer
 * sees a contact. Pure closed-form helper over `relativisticAberration` from
 * `optics.ts`, kept separate so the bearing reconstruction can be unit-tested in
 * isolation and so `awareness.ts` reads cleanly.
 *
 * Relativistic aberration sweeps the apparent direction of an incoming ray
 * toward the observer's direction of motion (the "headlight" effect). We measure
 * the true observer→contact bearing relative to the observer's velocity axis,
 * aberrate that angle, then rebuild the apparent bearing and place the reported
 * contact at the SAME range along it — the observer measures a shifted direction
 * but not a shifted distance.
 *
 * Determinism: a pure function of the observer's velocity and the two positions;
 * no rng, no clock. When the observer is at rest (or the contact is coincident)
 * the aberration is the identity and the reported position is the true one, so a
 * stationary fleet's awareness is unchanged.
 */

import { relativisticAberration } from "./optics";

/** The apparent (aberrated) position of a contact as seen by an observer moving
 *  at velocity (`obsVx`, `obsVy`), given the observer at (`obsX`, `obsY`) and
 *  the true contact at (`trueX`, `trueY`). Returns the true position unchanged
 *  when the observer is at rest or the contact is coincident. `cPerTick` is the
 *  speed of light in the same per-tick units as the velocities. */
export function aberratedContactPosition(
  obsX: number,
  obsY: number,
  obsVx: number,
  obsVy: number,
  trueX: number,
  trueY: number,
  cPerTick: number,
): { x: number; y: number } {
  const speed = Math.hypot(obsVx, obsVy);
  const dx = trueX - obsX;
  const dy = trueY - obsY;
  const range = Math.hypot(dx, dy);
  if (speed <= 0 || range <= 0 || cPerTick <= 0) return { x: trueX, y: trueY };

  const beta = speed / cPerTick;
  // Velocity-axis direction and the true bearing measured against it.
  const velAngle = Math.atan2(obsVy, obsVx);
  const trueBearing = Math.atan2(dy, dx);
  // Angle of the ray relative to the velocity axis, in [0, PI] (aberration is
  // symmetric about the axis). Track the sign to restore the correct side.
  const rel = trueBearing - velAngle;
  const relCos = Math.cos(rel);
  const relSin = Math.sin(rel);
  const angleFromAxis = Math.acos(relCos < -1 ? -1 : relCos > 1 ? 1 : relCos);
  const aberrated = relativisticAberration(angleFromAxis, beta);
  // Restore the original side of the velocity axis (sign of the perpendicular
  // component) and rebuild the apparent world bearing.
  const side = relSin >= 0 ? 1 : -1;
  const apparentBearing = velAngle + side * aberrated;
  return {
    x: obsX + Math.cos(apparentBearing) * range,
    y: obsY + Math.sin(apparentBearing) * range,
  };
}
