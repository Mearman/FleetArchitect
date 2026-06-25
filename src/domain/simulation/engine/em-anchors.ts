/**
 * EM reception anchors — the reference emissions and derived radii the engine's
 * awareness/acquisition model is measured against. A pure leaf (no imports beyond
 * `Math`), extracted from `config.ts` so each anchor carries its derivation in the
 * place its consumers (`em-reception.ts`, the catalogue, `config`'s `SIM`) read it.
 *
 * Unit model: world coordinates are metres; emission powers are in the same scale
 * as the noise floor (fixed at unit power so emission strengths read as multiples
 * of the floor). A continuous emission is "received" when its inverse-square
 * strength at the receiver exceeds the floor; the closed-form range is
 * `sqrt(strength · gain / (4·PI · sensitivity))`, the same formula `continuousRange`
 * in `emissions.ts` evaluates (inlined here because this is the leaf both it and
 * `config` import from).
 *
 * Phase 3 (km combat) raised the two reference radii in lockstep with the weapon-
 * range re-grounding: `sensorGain = (detectionRange / visualLosRadius)²` couples a
 * sensor's reach to `VISUAL_LOS_REFERENCE_M`, so the two MUST move together.
 */

/**
 * The receiver noise floor (the minimum received EM power a baseline,
 * sensor-free receiver registers as a contact). The reference threshold the
 * whole reception model is measured against: a continuous emission is "seen"
 * when its inverse-square received strength at the receiver exceeds this.
 * Fixed at unit power so emission strengths read directly as multiples of the
 * noise floor and the derived ranges below stay legible; the catalogue's
 * authored emission powers and sensor gains carry the real scale.
 */
export const EM_RECEIVER_NOISE_FLOOR = 1;

/**
 * The innate naked-eye reference radius (metres) the hull's ambient self-emission
 * is anchored to: the range at which a sensor-free receiver picks up a quiescent
 * hull. Set to 5 km — a km-combat naked-eye reach an order of magnitude SHORTER
 * than the weapon ranges (a beam ~52 km, a railgun ~24 km), so a sensorless ship
 * is myopic: it cannot see a target until the target is already deep inside its
 * own guns' envelope, and a sensor module is what restores sight out to and
 * beyond weapon reach. `sensorGain = (detectionRange / visualLosRadius)²` couples
 * a sensor's reach to this baseline, so it moves in lockstep with weapon range.
 */
export const VISUAL_LOS_REFERENCE_M = 5_000;

/**
 * The passive-acquisition reference radius (metres) the acquisition-reference
 * emission is anchored to. Set to 60 km — comfortably beyond the longest weapon
 * reach (a beam ~52 km) and the km-scale deployment span plus battle drift, so it
 * never gates ordinary (non-stealth) targeting; it only takes effect once a
 * target carries a signature module (shrinking its acquisition range to
 * `baseAcquireRange × acquisitionMultiplier`) or a cloak.
 */
const ACQUIRE_REFERENCE_RADIUS_M = 60_000;

/**
 * The continuous EM power (watts, in the same unit scale as the noise floor) a
 * quiescent hull radiates and reflects every tick — its baseline self-emission.
 * A ship is never truly dark: it reflects ambient starlight and radiates its own
 * waste heat, so a passive receiver close enough picks it up with no sensor at
 * all. Sized so the innate visual radius lands at `VISUAL_LOS_REFERENCE_M` via
 * `4·PI · R² · noiseFloor`.
 */
export const EM_HULL_AMBIENT_EMISSION =
  4 *
  Math.PI *
  VISUAL_LOS_REFERENCE_M *
  VISUAL_LOS_REFERENCE_M *
  EM_RECEIVER_NOISE_FLOOR;

/**
 * The innate visual line-of-sight radius (metres) DERIVED from the EM reception
 * model: the continuous-emission range at which a quiescent hull's baseline
 * self-emission is received at exactly the noise floor by a sensor-free receiver
 * (gain 1). With the ambient emission anchored to `4·PI · R² · floor` this
 * recovers `VISUAL_LOS_REFERENCE_M` exactly, but the radius now FALLS OUT of the
 * physics rather than being an authored literal.
 */
export const VISUAL_LOS_RADIUS_M = Math.sqrt(
  (EM_HULL_AMBIENT_EMISSION * 1) / (4 * Math.PI * EM_RECEIVER_NOISE_FLOOR),
);

/**
 * The reference emission power (same unit scale as the noise floor) of a ship
 * carrying an active emitter or a strong signature — the anchor the base passive
 * acquisition radius derives from. Sized so the acquisition range lands at
 * `ACQUIRE_REFERENCE_RADIUS_M` via `4·PI · R² · floor`. Authored catalogue
 * content: it stands in for the EM cross-section a stealth-relevant target
 * presents, the multiplicand a signature module's `acquisitionMultiplier` shrinks.
 */
const EM_ACQUIRE_REFERENCE_EMISSION =
  4 *
  Math.PI *
  ACQUIRE_REFERENCE_RADIUS_M *
  ACQUIRE_REFERENCE_RADIUS_M *
  EM_RECEIVER_NOISE_FLOOR;

/**
 * The base passive acquisition radius (metres) DERIVED from the EM reception
 * model: the continuous-emission range at which `EM_ACQUIRE_REFERENCE_EMISSION`
 * is received at the noise floor (gain 1). Same closed-form inverse-square range
 * as the visual radius, off a stronger reference emission; recovers
 * `ACQUIRE_REFERENCE_RADIUS_M` exactly while making the figure fall out of the
 * physics.
 */
export const BASE_ACQUIRE_RANGE_M = Math.sqrt(
  (EM_ACQUIRE_REFERENCE_EMISSION * 1) / (4 * Math.PI * EM_RECEIVER_NOISE_FLOOR),
);

/**
 * Sensor dazzle (battlefield-medium phase 5). An intense INCIDENT emission
 * saturates the receiver, raising its effective noise floor for a recovery
 * period so a sensor blinded by a nearby bright source (a beam discharge, a
 * missile bloom, a point-blank muzzle flash, or a close high-emission hull)
 * temporarily loses its weaker contacts. This is a property of the RECEIVER,
 * source-agnostic: any sufficiently strong received emission dazzles, whatever
 * its origin (hull, pulse, or medium-cell radiation).
 *
 * The dazzle threshold is expressed as a multiple of the received strength
 * over the {@link EM_RECEIVER_NOISE_FLOOR}: an emission whose inverse-square
 * received power at the observer EXCEEDS this dazzles. Set so a baseline hull
 * at the visual radius (received = floor) does NOT dazzle, and only genuinely
 * bright events do. A baseline quiescent hull clears the threshold only inside
 * `VISUAL_LOS_REFERENCE_M / sqrt(DAZZLE_THRESHOLD_MULT)` ≈ 500 m (point-blank);
 * an active emitter or a weapons bloom — orders of magnitude brighter — dazzles
 * out to several kilometres, which is the intended flash-blinding / area-denial
 * scale. See {@link dazzleBoost} for the closed-form boost derivation.
 */
export const DAZZLE_THRESHOLD_MULT = 50;

/**
 * The recovery timescale (ticks) for sensor saturation. The carried
 * `sensorSaturation` decays multiplicatively each tick by
 * `exp(-1 / SATURATION_RECOVERY_TICKS)`, so a single flash that lifts the
 * saturation to S decays to S/2 after `SATURATION_RECOVERY_TICKS · ln(2)`
 * ticks (≈ 2.8 ticks at the 4-tick timescale below). Four ticks gives a
 * recovery window of a few ticks — long enough to drop contacts for a
 * meaningful beat after a flash, short enough that a one-shot dazzle is not a
 * permanent kill. A SUSTAINED bright source (a close high-emission hull) drives
 * the saturation toward a non-zero steady state `boost / (1 - decayFactor)`,
 * giving lasting EM area-denial while it stays close.
 */
export const SATURATION_RECOVERY_TICKS = 4;

/**
 * The per-tick multiplicative decay factor for sensor saturation, derived from
 * the recovery timescale: `exp(-1 / SATURATION_RECOVERY_TICKS)`. Applied to
 * every alive ship's `sensorSaturation` at the top of the awareness phase,
 * BEFORE the floor is read this tick, so a flash on tick T raises the floor on
 * ticks T+1, T+2, ... as the saturation decays. Pure function of the timescale;
 * computed once at module load.
 */
export const SATURATION_DECAY_FACTOR = Math.exp(-1 / SATURATION_RECOVERY_TICKS);
