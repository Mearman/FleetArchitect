/**
 * Phase-9 EM reception: the detection model that replaces the old instant
 * geometric `sensorDetects` path. Every ship continuously emits EM — it reflects
 * ambient starlight and radiates its own waste heat, and an active emitter or a
 * thrusting drive adds to that baseline — and every ship is a receiver, with a
 * sensor-free baseline sensitivity that any sensor module sharpens (more gain,
 * longer reach) within its cone. A contact forms when a source's continuous
 * emission, attenuated by the inverse square of the separation, clears the
 * receiver's effective noise floor.
 *
 * Because a hull emits EVERY tick, the light-lag of any one sphere washes out
 * into a steady state (see `continuousContact` in `emissions.ts`): the decision
 * collapses to the instant inverse-square received strength against the
 * threshold. So this reproduces the geometric detection ranges the catalogue
 * authors — but those ranges now DERIVE from emission power and a noise floor
 * (`continuousRange`), not from a hand-picked radius. A sensor's authored
 * `detectionRange` is exactly the continuous-emission range at which it receives
 * a baseline-emitting hull, which fixes the sensor's effective gain as
 * `(detectionRange / visualLosRadius)^2`; the baseline receiver has gain 1 and
 * therefore reaches `visualLosRadius`.
 *
 * Determinism contract: pure functions of ship state + anomaly; ZERO rng draws.
 * The emission log this module builds is appended in (ship id, module array)
 * order behind a monotonic per-battle counter, and every reception accumulation
 * iterates ships in lexicographic instanceId order — the same contract the
 * pulse and awareness phases keep.
 */

import type { BattleAnomaly } from "@/schema/battle";

import { EM_HULL_AMBIENT_EMISSION, EM_RECEIVER_NOISE_FLOOR } from "./em-anchors";
import { SIM, SPEED_OF_LIGHT_M_PER_TICK } from "./config";
import { continuousContact, type Emission } from "./emissions";
import {
  dopplerFactor,
  gravitationalRedshift,
  relativeRadialBeta,
} from "./optics";
import {
  attenuatedSensorRange,
  effectiveSensorArc,
  effectiveSensorBearing,
  sensorUnitsOf,
} from "./sensors";
import { angleDifference } from "./setup";
import type { SimShip } from "./types";

/**
 * A ship's continuous self-emission power (the same unit scale as the receiver
 * noise floor): the baseline ambient a quiescent hull radiates and reflects,
 * plus the active emission of any operational active-mode sensor it runs.
 *
 * Stealth (signature / cloak) is DELIBERATELY not folded in here. Reception is
 * the physical-sight layer — it reproduces the same geometric reach the old
 * `sensorDetects` had (a non-stealth target at exactly the historical ranges, so
 * the determinism fixtures hold). The dedicated acquisition gate `isDetectable`
 * in `targeting.ts` is where a signature shrinks the lock range and a cloak hides
 * the target; applying the signature multiplier here too would double-count it.
 * An active emitter makes a ship louder (its sensor transmit power adds to the
 * ambient), so a radar-blaring ship is easier to detect — the gameplay-honest
 * consequence of going active.
 */
export function continuousEmissionStrength(ship: SimShip): number {
  let strength = EM_HULL_AMBIENT_EMISSION;
  if (ship.modules === undefined) return strength;
  // Active-mode sensors add their transmit power.
  for (const m of ship.modules) {
    if (!m.alive) continue;
    if (m.effect.kind === "sensor") {
      const sensor = m.effect;
      if (sensor.mode === "active" || sensor.mode === "hybrid") {
        const emit = sensor.emitStrength;
        if (emit !== undefined && emit > 0) strength += emit;
      }
    }
  }
  return strength;
}

/**
 * The effective receiver gain a sensor cone provides relative to the baseline
 * eye. A sensor's authored `detectionRange` is, by construction, the
 * continuous-emission range at which it picks up a baseline-emitting hull; since
 * the continuous range scales as `sqrt(gain)` off the baseline `visualLosRadius`
 * (gain 1), the gain that reproduces that authored range is
 * `(detectionRange / visualLosRadius)^2`. Inside a nebula the sensor's range is
 * attenuated first (via `attenuatedSensorRange`), so the gain — and thus the
 * reach — falls with it, exactly as halving the range would.
 */
function sensorGain(range: number): number {
  if (SIM.visualLosRadius <= 0) return 1;
  const ratio = range / SIM.visualLosRadius;
  return ratio * ratio;
}

/**
 * The relativistic + gravitational correction to the received EM power of
 * `enemy`'s emission as seen by `observer` this tick (Phase 10). Two closed-form
 * factors multiply the inverse-square strength:
 *
 *  - **Relativistic Doppler.** The radial relative velocity along the sight line
 *    gives a Doppler factor D; an approaching source is blueshifted and beamed
 *    brighter, a receding one redshifted and dimmer. Received power scales as D²
 *    (one factor of D for the photon energy, one for the arrival rate).
 *  - **Gravitational redshift.** Under a black hole at the arena origin a photon
 *    climbing from the emitter's potential well to the receiver's shifts by
 *    g(Φ_emitter)/g(Φ_receiver), where g(Φ) = sqrt(1 + 2Φ/c²) and Φ = -GM/r is
 *    the Newtonian potential. A source deeper in the well than the observer is
 *    redshifted (factor < 1, dimmer); shallower, blueshifted.
 *
 * When the two ships share a velocity and no black hole is present, both factors
 * are exactly 1 — so a stationary, anomaly-free engagement reproduces the
 * Phase-9 reception unchanged and the detection fixtures hold byte-for-byte.
 */
export function receptionShift(
  observer: SimShip,
  enemy: SimShip,
  anomaly: BattleAnomaly,
): number {
  // Doppler boosting/dimming from the radial relative velocity along the sight
  // line. relativeRadialBeta is positive when separating (redshift, D < 1).
  const beta = relativeRadialBeta(
    enemy.velX - observer.velX,
    enemy.velY - observer.velY,
    enemy.x - observer.x,
    enemy.y - observer.y,
    SPEED_OF_LIGHT_M_PER_TICK,
  );
  const d = dopplerFactor(beta);
  let shift = d * d;

  // Gravitational redshift between the emitter's and receiver's potential wells
  // under a black hole at the origin. Newtonian potential Φ = -GM/r; the ratio
  // of the climb-out factors is the net frequency (and hence power) shift.
  if (anomaly === "blackHole") {
    const gm = SIM.blackHoleStrength;
    const rEnemy = Math.hypot(enemy.x, enemy.y);
    const rObserver = Math.hypot(observer.x, observer.y);
    if (rEnemy > 0 && rObserver > 0) {
      const gEnemy = gravitationalRedshift(-gm / rEnemy);
      const gObserver = gravitationalRedshift(-gm / rObserver);
      if (gObserver > 0) shift *= gEnemy / gObserver;
    }
  }
  return shift;
}

/**
 * Whether `observer` receives `enemy` this tick: the enemy's continuous emission
 * clears the observer's effective noise floor at their separation, through the
 * baseline omnidirectional receiver OR any sensor cone covering the bearing. The
 * grounded replacement for `sensorDetects` — same cone geometry (range + arc,
 * dish-manning, variable trade, nebula attenuation), but the range now derives
 * from `continuousContact` over the enemy's emission rather than a scalar radius
 * compared against an authored circle.
 */
export function emReceives(
  observer: SimShip,
  enemy: SimShip,
  anomaly: BattleAnomaly,
): boolean {
  const dx = enemy.x - observer.x;
  const dy = enemy.y - observer.y;
  const distSq = dx * dx + dy * dy;
  const dist = Math.sqrt(distSq);
  const emission = continuousEmissionStrength(enemy) * receptionShift(observer, enemy, anomaly);

  // Baseline sensor-free receiver: an omni eye at gain 1, reaching
  // `visualLosRadius` against a baseline emitter. A nebula dims the naked eye
  // too (it is never immune), so attenuate the baseline gain by the same factor
  // the visual radius would shrink — squared, since gain scales as range^2.
  const visualFactor = anomaly === "nebula" ? SIM.nebulaSensorFactor : 1;
  const baselineGain = visualFactor * visualFactor;
  if (continuousContact(emission, dist, EM_RECEIVER_NOISE_FLOOR, baselineGain)) {
    return true;
  }

  // Any sensor cone whose gain pulls the enemy above the floor AND whose arc
  // covers the bearing. An omni sensor (arc >= PI) skips the angle test.
  const toEnemy = Math.atan2(dy, dx);
  for (const unit of sensorUnitsOf(observer)) {
    const range = attenuatedSensorRange(unit, anomaly);
    if (range <= 0) continue;
    const gain = sensorGain(range);
    if (!continuousContact(emission, dist, EM_RECEIVER_NOISE_FLOOR, gain)) continue;
    const arc = effectiveSensorArc(unit);
    if (arc >= Math.PI) return true;
    const bearing = effectiveSensorBearing(unit);
    if (Math.abs(angleDifference(bearing, toEnemy)) <= arc) return true;
  }
  return false;
}

/**
 * Append this ship's continuous-emission events to the per-battle emission log,
 * in deterministic (ship already chosen by caller, then module array) order
 * behind the monotonic `seq` counter. Returns the next sequence value. The log
 * feeds the optional `emissions` snapshot field and is the honest record of
 * every EM event the reception pass consumed — one baseline hull emission per
 * ship, plus one per operational active-mode sensor.
 *
 * The baseline hull emission is always recorded (every ship is always emitting);
 * active-sensor emissions are recorded only when the sensor is alive and in an
 * emitting mode, so a passive-only fleet logs exactly one emission per ship and
 * the snapshot stays compact.
 */
export function recordEmissions(
  ship: SimShip,
  emissions: Emission[],
  tick: number,
  seq: number,
): number {
  let next = seq;
  // The hull's continuous baseline self-emission (stealth is applied downstream
  // in the acquisition gate, not here — see `continuousEmissionStrength`).
  emissions.push({
    sourceId: ship.instanceId,
    x: ship.x,
    y: ship.y,
    strength: EM_HULL_AMBIENT_EMISSION,
    t0: tick,
  });
  next += 1;
  if (ship.modules === undefined) return next;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    if (m.effect.kind !== "sensor") continue;
    const sensor = m.effect;
    if (sensor.mode !== "active" && sensor.mode !== "hybrid") continue;
    const emit = sensor.emitStrength;
    if (emit === undefined || emit <= 0) continue;
    emissions.push({
      sourceId: ship.instanceId,
      x: ship.x,
      y: ship.y,
      strength: emit,
      t0: tick,
    });
    next += 1;
  }
  return next;
}

/**
 * Rebuild the per-tick continuous EM emission log in place: clear the array,
 * then append every alive ship's emissions (via `recordEmissions`) in
 * lexicographic instanceId order behind the monotonic `seq` counter. Returns the
 * next sequence value. A continuous self-emission reflects the current tick's
 * positions, so the log is rebuilt from scratch each tick rather than
 * accumulated; the counter still advances monotonically across the whole battle,
 * mirroring `pulseSeq`, so two same-seed runs produce identical totals.
 *
 * Phantoms (drones/decoys) are excluded — they are detected via the normal ship
 * path and carry no sensor modules, so logging a baseline emission for them
 * would just bloat the snapshot without changing any reception decision.
 */
export function rebuildEmissions(
  ships: readonly SimShip[],
  emissions: Emission[],
  tick: number,
  seq: number,
): number {
  emissions.length = 0;
  let next = seq;
  const ordered = [...ships]
    .filter((s) => s.alive && s.phantom === undefined)
    .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
  for (const ship of ordered) {
    next = recordEmissions(ship, emissions, tick, next);
  }
  return next;
}
