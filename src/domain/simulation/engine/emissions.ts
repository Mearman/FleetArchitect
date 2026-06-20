/**
 * Unified EM awareness (Phase 9). Every detection is electromagnetic reception:
 * an emission (active ping, thrust, weapons, shield, reactor, reflected light)
 * leaves its source at the speed of light and is received by a ship's baseline
 * receiver (sensor-free sight) plus any directional sensors when the light
 * sphere reaches it — light-lagged, attenuated, and gated by a threshold.
 *
 * This module is the reception model v1: an emission event, light-cone
 * detection (is the expanding sphere at the receiver this tick?), inverse-
 * square attenuation, and a threshold-gated contact decision. Replacing the
 * engine's instant `sensorDetects` (and the spatial light-cone index) is the
 * integration pass; these are the honest, deterministic primitives.
 */

import { SPEED_OF_LIGHT_M_PER_TICK } from "./config";

/** A single EM emission event, appended to the per-battle log when it occurs.
 *  `strength` is the emitted power at the source; it attenuates with distance. */
export interface Emission {
  /** Who/what emitted (instance id, or "ambient" for reflected illumination). */
  readonly sourceId: string;
  /** Emission position at tick `t0` (metres). */
  x: number;
  y: number;
  /** Emitted strength (power at the source). */
  strength: number;
  /** Tick the emission occurred (the light sphere's birth tick). */
  t0: number;
}

/** A receiver: every ship has a baseline (sensor-free sight) at `sensitivity`;
 *  sensors add `gain` (and directionality, handled by the caller). */
export interface Receiver {
  x: number;
  y: number;
  /** Minimum received strength that registers as a contact (the receiver's
   *  noise floor — a baseline-eyesight value, or a sensor's lower threshold). */
  sensitivity: number;
  /** Signal gain (1 = baseline; a sensor > 1 pulls weaker signals above the
   *  threshold). Stealth on the SOURCE cuts its emission strength instead. */
  gain: number;
}

/** The radius (metres) of an emission's light sphere at tick `t` — how far the
 *  light has travelled since `t0`. `c · (t - t0)`. At t = t0 the radius is 0
 *  (the emission just occurred). */
export function lightSphereRadius(t: number, t0: number): number {
  return SPEED_OF_LIGHT_M_PER_TICK * (t - t0);
}

/** Whether an emission's light sphere is crossing the receiver this tick. The
 *  sphere's radius grew past the receiver's distance within the last tick, i.e.
 *  `dist` is within one light-tick of `c·(t - t0)`. This is the light-lag: a
 *  distant emission is received ticks after it occurred. */
export function isReaching(
  emission: Emission,
  receiver: Receiver,
  t: number,
): boolean {
  if (t < emission.t0) return false;
  const dist = Math.hypot(receiver.x - emission.x, receiver.y - emission.y);
  const sphere = lightSphereRadius(t, emission.t0);
  // The sphere swept past the receiver this tick: dist in (sphere - c, sphere].
  return dist > sphere - SPEED_OF_LIGHT_M_PER_TICK && dist <= sphere;
}

/** The strength of an emission as received at distance `dist` (metres). An
 *  omni emission spreads over its sphere's surface 4·PI·dist^2, so received
 *  strength falls as 1/dist^2; at the source (dist = 0) it is the emitted
 *  strength. (Directional sources concentrate into a smaller solid angle — the
 *  caller scales `strength` by the beam's concentration before calling.) */
export function receivedStrength(emission: Emission, dist: number): number {
  if (dist <= 0) return emission.strength;
  return emission.strength / (4 * Math.PI * dist * dist);
}

/** Whether an emission forms a contact at the receiver: the light sphere is
 *  crossing it this tick AND the received strength exceeds the receiver's
 *  sensitivity (scaled by its gain). This is the one detection predicate for a
 *  SINGLE, discrete emission event (an active radar ping, a weapon discharge) —
 *  it is light-lagged, so the receiver registers it only on the tick the sphere
 *  sweeps across. Sensor-free sight and sensor-enhanced sight both route through
 *  it (a sensor is a higher gain / lower effective threshold). For a source that
 *  emits EVERY tick (a hull's continuous self-illumination), use
 *  `continuousContact` instead — see its note on why the light-lag washes out. */
export function formsContact(
  emission: Emission,
  receiver: Receiver,
  t: number,
): boolean {
  if (!isReaching(emission, receiver, t)) return false;
  const dist = Math.hypot(receiver.x - emission.x, receiver.y - emission.y);
  return receivedStrength(emission, dist) > receiver.sensitivity / receiver.gain;
}

/** Whether a CONTINUOUSLY-emitting source forms a contact at the receiver this
 *  tick. A hull is always there — every tick it reflects ambient light and
 *  radiates its own heat/EM — so the receiver is bathed in a steady stream of
 *  spheres, one born each past tick. Whichever sphere has radius equal to the
 *  source-receiver distance is the one crossing the receiver this tick, and it
 *  was born `ceil(dist/c)` ticks ago; because the source emitted then too, there
 *  is always exactly one such sphere arriving. The light-lag therefore collapses
 *  to a steady-state: the contact decision is purely the inverse-square received
 *  strength against the threshold, with no `isReaching` gate. This is the
 *  predicate that grounds a ship's instant geometric sight in real EM physics —
 *  the range falls out of `receivedStrength > sensitivity/gain`, not an authored
 *  radius. `strength` is the source's continuous emission power; `dist` their
 *  separation (metres). */
export function continuousContact(
  strength: number,
  dist: number,
  sensitivity: number,
  gain: number,
): boolean {
  const received =
    dist <= 0 ? strength : strength / (4 * Math.PI * dist * dist);
  return received > sensitivity / gain;
}

/** The continuous-emission range (metres) at which a source of power `strength`
 *  is received exactly at a receiver's effective threshold `sensitivity / gain`.
 *  The closed-form inverse of `continuousContact`: solving
 *  `strength / (4·PI·d^2) = sensitivity / gain` for `d` gives
 *  `sqrt(strength · gain / (4·PI · sensitivity))`. The grounded replacement for
 *  an authored detection radius — a range now DERIVES from emission power and a
 *  noise floor rather than being hand-picked. */
export function continuousRange(
  strength: number,
  sensitivity: number,
  gain: number,
): number {
  return Math.sqrt((strength * gain) / (4 * Math.PI * sensitivity));
}

/** The continuous-emission power (watts) a source must radiate to be received at
 *  exactly the baseline threshold at range `range` (metres). The closed-form
 *  inverse of `continuousRange` at unit gain: `4·PI·range^2 · sensitivity`. Used
 *  to ground an authored detection RANGE (a sensor's `detectionRange`, the hull
 *  visual radius) as the emission power physics implies for that reach. */
export function emissionForRange(range: number, sensitivity: number): number {
  return 4 * Math.PI * range * range * sensitivity;
}
