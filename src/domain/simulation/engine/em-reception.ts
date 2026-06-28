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

import type { BattleAnomalyKind } from "@/schema/battle";
import { hasAnomaly } from "@/domain/anomaly";

import {
  DAZZLE_THRESHOLD_MULT,
  EM_HULL_AMBIENT_EMISSION,
  EM_RECEIVER_NOISE_FLOOR,
} from "./em-anchors";
import { SIM, SPEED_OF_LIGHT_M_PER_TICK } from "./config";
import { continuousContact, type Emission } from "./emissions";
import {
  appendMediumEmissionsToSnapshot,
  collectMediumEmissions,
} from "./medium-emissions";
import type { ArenaMedium } from "./medium-setup";
import { cellWorldPosition } from "@/domain/simulation/spatial-hash";
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
 * The effective detection noise floor for `observer` this tick, raised by its
 * current sensor saturation (battlefield-medium phase 5). A blinded receiver
 * is less sensitive — its floor multiplies by `(1 + sensorSaturation)` — so
 * weaker contacts (those received just above the baseline floor) fall below it
 * and are lost while the receiver stays saturated. The saturation is decayed
 * once at the top of the awareness phase (see {@link SATURATION_DECAY_FACTOR}),
 * so this reads the carried-and-decayed value; every reception decision the
 * observer makes this tick — hull ambient, medium-cell radiation — sees the
 * SAME raised floor, so a flash blinds uniformly across all contact kinds.
 */
export function effectiveReceiverFloor(observer: SimShip): number {
  return EM_RECEIVER_NOISE_FLOOR * (1 + observer.sensorSaturation);
}

/**
 * The dazzle boost an emission of inverse-square received strength
 * `receivedStrength` (in floor units, i.e. as a multiple of
 * {@link EM_RECEIVER_NOISE_FLOOR}) contributes to the observer's sensor
 * saturation. Source-agnostic — any emission the observer receives (hull,
 * pulse, or medium-cell radiation) routes here. Returns 0 below the dazzle
 * threshold (so an ordinary detected contact, received at a few times the
 * floor, does NOT dazzle); above it the boost grows as
 * `ln(receivedStrength / threshold)`, a smooth, scale-invariant, unbounded-above
 * measure of how brightly the receiver is lit up. The natural log keeps a
 * single bright flash bounded (a 1000×-over-threshold flash boosts by ~ln(1000)
 * ≈ 6.9, not 1000) while letting an arbitrarily bright bloom dazzle arbitrarily
 * hard. The caller accumulates the per-tick boost across all the observer's
 * received emissions and adds it to the carried (decayed) saturation AFTER the
 * reception pass, so it raises the floor on subsequent ticks.
 *
 * Calibration worked example. A baseline hull emission (~3.14e8) received at
 * 500 m gives `3.14e8 / (4π · 500²) ≈ 100×` the floor — just over the 50×
 * threshold, so a baseline hull dazzles only at point-blank range (intended: a
 * close pass blinds). A hull running an active emitter 1000× the baseline
 * (~3.14e11) received at 4 km gives `~1560×` the floor: a boost of
 * `ln(1560/50) ≈ 3.4`, lifting the floor to ×4.4 next tick — comfortably above
 * a typical hull-ambient contact (received at a few × the floor) and dropping
 * it. As the emitter moves away the received strength falls below the threshold
 * and the saturation decays with {@link SATURATION_DECAY_FACTOR}, recovering
 * the contact a few ticks later.
 */
export function dazzleBoost(receivedStrengthFloorMult: number): number {
  if (receivedStrengthFloorMult <= DAZZLE_THRESHOLD_MULT) return 0;
  return Math.log(receivedStrengthFloorMult / DAZZLE_THRESHOLD_MULT);
}

/**
 * The dazzle boost an enemy's continuous emission contributes to `observer`'s
 * sensor saturation this tick (battlefield-medium phase 5). The received
 * strength is the enemy's continuous emission (shifted by relativistic Doppler
 * + gravitational redshift, exactly as {@link emReceives} shifts it) attenuated
 * by the inverse square of the separation, expressed as a multiple of the
 * baseline noise floor. Source-agnostic: the caller invokes this for every
 * non-occluded enemy regardless of whether it formed a contact, so a bright
 * emitter dazzles even when the observer's raised floor (or arc) keeps it from
 * registering as a fix. Returns 0 below the dazzle threshold. Deterministic
 * (no rng); the caller accumulates over enemies in instanceId order.
 */
export function hullDazzleContribution(
  observer: SimShip,
  enemy: SimShip,
  anomalies: readonly BattleAnomalyKind[],
): number {
  const dx = enemy.x - observer.x;
  const dy = enemy.y - observer.y;
  const distSq = dx * dx + dy * dy;
  const dist = Math.sqrt(distSq);
  const emission = continuousEmissionStrength(enemy) * receptionShift(observer, enemy, anomalies);
  const received = dist <= 0 ? emission : emission / (4 * Math.PI * distSq);
  return dazzleBoost(received / EM_RECEIVER_NOISE_FLOOR);
}

/**
 * The dazzle boost a medium-cell emission contributes to `observer`'s sensor
 * saturation this tick (battlefield-medium phase 5). Mirrors
 * {@link hullDazzleContribution} but for a medium-cell's continuous radiated
 * strength (no relativistic shift — a cell has no velocity of its own, exactly
 * as in {@link mediumReceives}). Source-agnostic. Returns 0 below the dazzle
 * threshold. Deterministic; the caller accumulates over emissions in row-major
 * order.
 */
export function mediumDazzleContribution(observer: SimShip, emission: Emission): number {
  const dx = emission.x - observer.x;
  const dy = emission.y - observer.y;
  const distSq = dx * dx + dy * dy;
  const received =
    distSq <= 0 ? emission.strength : emission.strength / (4 * Math.PI * distSq);
  return dazzleBoost(received / EM_RECEIVER_NOISE_FLOOR);
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
  anomalies: readonly BattleAnomalyKind[],
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
  if (hasAnomaly(anomalies, "blackHole")) {
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
  anomalies: readonly BattleAnomalyKind[],
): boolean {
  const dx = enemy.x - observer.x;
  const dy = enemy.y - observer.y;
  const distSq = dx * dx + dy * dy;
  const dist = Math.sqrt(distSq);
  const emission = continuousEmissionStrength(enemy) * receptionShift(observer, enemy, anomalies);

  // Baseline sensor-free receiver: an omni eye at gain 1, reaching
  // `visualLosRadius` against a baseline emitter. A nebula dims the naked eye
  // too (it is never immune), so attenuate the baseline gain by the same factor
  // the visual radius would shrink — squared, since gain scales as range^2.
  const visualFactor = hasAnomaly(anomalies, "nebula") ? SIM.nebulaSensorFactor : 1;
  const baselineGain = visualFactor * visualFactor;
  const floor = effectiveReceiverFloor(observer);
  if (continuousContact(emission, dist, floor, baselineGain)) {
    return true;
  }

  // Any sensor cone whose gain pulls the enemy above the floor AND whose arc
  // covers the bearing. An omni sensor (arc >= PI) skips the angle test.
  const toEnemy = Math.atan2(dy, dx);
  for (const unit of sensorUnitsOf(observer)) {
    const range = attenuatedSensorRange(unit, anomalies);
    if (range <= 0) continue;
    const gain = sensorGain(range);
    if (!continuousContact(emission, dist, floor, gain)) continue;
    const arc = effectiveSensorArc(unit);
    if (arc >= Math.PI) return true;
    const bearing = effectiveSensorBearing(unit);
    if (Math.abs(angleDifference(bearing, toEnemy)) <= arc) return true;
  }
  return false;
}

/**
 * Whether `observer` receives a medium cell's CONTINUOUS radiation this tick
 * through the inverse-square `continuousContact` path — the SAME steady-state
 * reception a ship's hull-ambient self-emission flows through (NOT the discrete,
 * light-lagged `formsContact` path a single radar ping flows through). An
 * excited medium cell is a SUSTAINED source for the ticks it stays excited: it
 * sheds `ε/τ` watts every tick, so a new light sphere is born every tick and —
 * once the burn has been under way for longer than the source-receiver light-
 * time — one is always arriving at the observer. The light-lag therefore
 * collapses to a STEADY STATE for a long-burning cell exactly as it does for a
 * hull, and the detection decision is the inverse-square received strength
 * against the observer's noise floor. A sensor thus sees a sustained burn at
 * any range where the cell's radiated strength clears the floor — there is no
 * per-event sphere-crossing to gate it (the earlier discrete-path routing was
 * the phase-4 bug: it only ever fired when the observer sat inside the emitting
 * cell).
 *
 * STARTUP light-lag. The steady-state argument only holds once light from the
 * burn has actually had time to cross the gap; a JUST-IGNITED burn is not yet
 * visible at a distance. This function applies that startup gate: the
 * sustained-radiation reception is admitted ONLY on ticks where
 * `tick >= emission.t0 + ceil(dist / SPEED_OF_LIGHT_M_PER_TICK)` — i.e. after
 * the light emitted at the burn's birth tick (`emission.t0`, the cell's
 * `birthTick` carried by {@link collectMediumEmissions}) has crossed the
 * source-receiver gap. Before that first light arrives, no contact (the burn
 * is not yet visible at the observer); after it, the steady inverse-square
 * strength applies for as long as the cell stays excited (the birth tick is
 * preserved while the cell stays above the emission threshold, so the gate
 * stays open and detection continues). This is honest c-fidelity for sustained
 * sources: a just-ignited burn is seen late by a distant receiver; a long-
 * burning one is seen steadily, offset by its light-time.
 *
 * The receiver model mirrors {@link emReceives}: the baseline sensor-free eye
 * (gain 1, attenuated by a nebula) plus any sensor cone whose gain pulls the
 * emission above the noise floor and whose arc covers the bearing. The only
 * difference is that the strength is the cell's continuous radiated strength
 * (`emission.strength`, already computed by `mediumCellEmissionStrength`)
 * rather than the enemy ship's `continuousEmissionStrength`. Relativistic
 * Doppler / gravitational redshift are NOT applied: a medium cell has no
 * velocity of its own (it is a stationary grid volume). Returns the effective
 * receiver gain that formed the contact (so the caller can record which sensor
 * made the detection), or `undefined` when no receiver formed one.
 */
export function mediumReceives(
  observer: SimShip,
  emission: Emission,
  tick: number,
  anomalies: readonly BattleAnomalyKind[],
): number | undefined {
  const dx = emission.x - observer.x;
  const dy = emission.y - observer.y;
  const dist = Math.hypot(dx, dy);
  const strength = emission.strength;

  // STARTUP light-lag: a just-ignited burn is not yet visible at a distance.
  // The cell's birth tick (`emission.t0`) is when the cell first crossed the
  // emission threshold; the light from that tick reaches the observer after
  // `ceil(dist / c)` ticks. Before that window opens, no contact — even if the
  // inverse-square strength would clear the floor. After it, detection
  // continues at the steady inverse-square strength for as long as the cell
  // stays radiating. A cell that ignited long ago (small `t0`) cleared this
  // gate many ticks ago; a fresh ignition (large `t0`) is held off until its
  // light arrives. `t0 === -1` is the never-radiating sentinel (the cell is
  // below the emission threshold this tick); no contact in that case either.
  if (emission.t0 < 0) return undefined;
  const lightTicks = Math.ceil(dist / SPEED_OF_LIGHT_M_PER_TICK);
  if (tick < emission.t0 + lightTicks) return undefined;

  // Baseline sensor-free receiver: an omni eye at gain 1, attenuated by a nebula
  // exactly as in `emReceives` (the naked eye is never immune to a nebula).
  const visualFactor = hasAnomaly(anomalies, "nebula") ? SIM.nebulaSensorFactor : 1;
  const baselineGain = visualFactor * visualFactor;
  const floor = effectiveReceiverFloor(observer);
  if (continuousContact(strength, dist, floor, baselineGain)) {
    return baselineGain;
  }

  // Any sensor cone whose gain pulls the emission above the floor AND whose arc
  // covers the bearing. An omni sensor (arc >= PI) skips the angle test.
  const toCell = Math.atan2(dy, dx);
  for (const unit of sensorUnitsOf(observer)) {
    const range = attenuatedSensorRange(unit, anomalies);
    if (range <= 0) continue;
    const gain = sensorGain(range);
    // `continuousContact` gates on the inverse-square received strength
    // clearing the threshold; a sensor cone further constrains the bearing.
    if (!continuousContact(strength, dist, floor, gain)) continue;
    const arc = effectiveSensorArc(unit);
    if (arc >= Math.PI) return gain;
    const bearing = effectiveSensorBearing(unit);
    if (Math.abs(angleDifference(bearing, toCell)) <= arc) return gain;
  }
  return undefined;
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
    // The active-sensor emission originates at the sensor module's cell
    // (rotated into world by the ship's pose), not the ship centre — the dish
    // is the source of the ping. (The baseline hull emission above stays at the
    // ship centre: it is a whole-hull ambient, not a module emission.)
    const cell = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
    emissions.push({
      sourceId: ship.instanceId,
      x: cell.wx,
      y: cell.wy,
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
 * lexicographic instanceId order behind the monotonic `seq` counter, then
 * append the medium-cell emissions (radiating ε cells) for the snapshot, capped.
 * Returns the next sequence value. A continuous self-emission reflects the
 * current tick's positions, so the log is rebuilt from scratch each tick rather
 * than accumulated; the counter still advances monotonically across the whole
 * battle, mirroring `pulseSeq`, so two same-seed runs produce identical totals.
 *
 * Phantoms (drones/decoys) are excluded — they are detected via the normal ship
 * path and carry no sensor modules, so logging a baseline emission for them
 * would just bloat the snapshot without changing any reception decision.
 *
 * Medium-cell emissions (battlefield-medium phase 4) are collected from
 * `medium` (when supplied) via {@link collectMediumEmissions} and appended AFTER
 * the ship emissions, capped to {@link MEDIUM_EMISSION_SNAPSHOT_CAP} so the
 * snapshot cannot bloat. The UNcapped set is what the reception pass in
 * `computeAwareness` consumes (it collects its own copy); this function only
 * shapes what the snapshot RECORDS. Omit `medium` for a pre-medium caller.
 *
 * The two optional precomputed params let the tick loop share work it has
 * already done this tick: `precomputedAliveRealSorted` is the alive,
 * non-phantom, instanceId-sorted ship list (this function's only use of `ships`
 * is to build that list); `precomputedEmissions` is the medium-cell emission
 * array the loop already computed for `computeAwareness`. When omitted, each is
 * derived internally — same contents, same order, byte-identical — so this
 * function still works standalone.
 */
export function rebuildEmissions(
  ships: readonly SimShip[],
  emissions: Emission[],
  tick: number,
  seq: number,
  medium?: ArenaMedium,
  precomputedAliveRealSorted?: readonly SimShip[],
  precomputedEmissions?: readonly Emission[],
): number {
  emissions.length = 0;
  let next = seq;
  const ordered =
    precomputedAliveRealSorted ??
    [...ships]
      .filter((s) => s.alive && s.phantom === undefined)
      .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
  for (const ship of ordered) {
    next = recordEmissions(ship, emissions, tick, next);
  }
  if (medium !== undefined) {
    // Collect, cap, and append for the snapshot. The reception pass collects its
    // own uncapped copy; this only records what the renderer sees.
    const mediumEmissions = precomputedEmissions ?? collectMediumEmissions(medium);
    next = appendMediumEmissionsToSnapshot(mediumEmissions, emissions, next);
  }
  return next;
}
