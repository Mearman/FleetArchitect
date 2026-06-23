/**
 * Physical anchors for the combat economy — the realistic-scale quantities the
 * catalogue's weapon ranges, projectile speeds, cooldowns, beam damage, reactor
 * power and attitude-control torque are DERIVED from in later phases. This is
 * the combat-economy sibling of `physics.ts` (which anchors mass and thrust):
 * the engine is already SI internally (watts/joules in `power.ts`, real
 * relativistic joules in collision damage), so grounding combat is a matter of
 * re-authoring the catalogue from named anchors rather than rewriting the
 * engine. Every constant here names the real-world quantity it represents and
 * carries the formula the later derivations apply; nothing consumes these yet.
 *
 * ## Unit model
 *
 * - **Length** is metres. Combat happens at kilometre scale — guns reach tens
 *   of kilometres, projectiles fly at kilometres per second — so the anchors
 *   below are in metres and metres-per-second, and the catalogue stores them in
 *   the field's own consumed unit (see the m/tick note).
 * - **Time** is seconds. A reload or thermal-recovery interval is authored in
 *   seconds and converted to engine ticks at the fixed simulation rate
 *   `TICKS_PER_SECOND` (`src/domain/simulation/types.ts`): `cooldownTicks =
 *   seconds × TICKS_PER_SECOND`.
 * - **The m/tick boundary.** Two engine fields are consumed raw per tick, not
 *   per second: a weapon's `projectileSpeed` (added to a round's position each
 *   tick) and a shield's per-tick recharge. An anchor authored in SI
 *   (m/s, W) must therefore be stored divided by `TICKS_PER_SECOND` at the
 *   catalogue/schema boundary — `v_SI / TPS` m/tick, `power_SI / TPS` J/tick —
 *   or it would run a factor of `TPS` too fast. The anchors here are the SI
 *   values; the per-tick conversion is the later phase's responsibility.
 * - **Energy** is joules, **power** is watts. A kinetic round's damage is its
 *   muzzle kinetic energy `½·m·v²`; a beam's per-tick damage is its power times
 *   the dwell time of one tick, `beamPower × (1 / TICKS_PER_SECOND)`.
 *
 * ## The combat-scale picture
 *
 * Anchored here, these produce: armour cells of order gigajoules (see
 * `SPECIFIC_DESTRUCTION_ENERGY` in `physics.ts`), kinetic salvos of megajoules
 * to gigajoules, beams of hundreds of megajoules per tick, weapon reach of tens
 * of kilometres, and an attitude slew watchable over a couple of seconds — so a
 * hit and the armour it strikes are in one physical unit and a battle resolves
 * in a realistic number of seconds.
 */

import { TICKS_PER_SECOND } from "@/domain/simulation/types";

// ---------------------------------------------------------------------------
// Engagement reference range and weapon-range derivations (metres).
// ---------------------------------------------------------------------------

/**
 * The reference engagement range (metres) the combat economy is sized around —
 * the distance at which two capital ships are expected to open fire and trade
 * decisive blows. Set to tens of kilometres: at this scale a kinetic round's
 * flight time and a beam's diffraction-limited reach both fall out naturally
 * (see `MAX_TOF_S` and `BEAM_RAYLEIGH_REFERENCE_M`), and a sensorless ship is
 * myopic against it while a sensor-equipped one reaches across it. The other
 * range anchors band around this central figure.
 */
export const ENGAGEMENT_REFERENCE_RANGE_M = 40_000;

/**
 * Maximum kinetic-weapon time of flight (seconds) — the longest a fired round
 * stays useful before the firing solution goes stale against a manoeuvring
 * target. A kinetic weapon's reach is DERIVED as `muzzleVelocity × MAX_TOF_S`,
 * so a faster gun reaches further for the same time-of-flight budget: at ~3 s a
 * 4-10 km/s muzzle velocity gives a 12-30 km reach, bracketing the engagement
 * reference range. This is the `t` in `range = v · t`.
 */
export const MAX_TOF_S = 3;

/**
 * The diffraction-limited reference distance (metres) for a beam weapon — the
 * Rayleigh range at which a focused beam's spot has spread to twice its waist
 * area and its on-target intensity has fallen to the threshold the weapon is
 * effective to. A beam's reach is DERIVED as `√3 · BEAM_RAYLEIGH_REFERENCE_M`
 * (the distance at which the beam intensity drops to a quarter, i.e. the spot
 * radius has doubled), giving a reach of order the engagement reference range.
 * Re-anchoring this one figure rescales every beam weapon's reach in lockstep.
 */
export const BEAM_RAYLEIGH_REFERENCE_M = 30_000;

// ---------------------------------------------------------------------------
// Kinetic-weapon muzzle velocities (metres per second).
//
// A kinetic round's speed is its launcher's muzzle velocity. Stored in the
// catalogue as m/tick (`v / TICKS_PER_SECOND`) because `projectileSpeed` is
// consumed raw per tick, but authored here in SI. The kinetic damage of a hit
// is its muzzle kinetic energy `½·m·v²`, so a faster, heavier round hits harder
// AND reaches further (`v × MAX_TOF_S`) for free.
// ---------------------------------------------------------------------------

/**
 * Muzzle velocity (m/s) for each kinetic-weapon class — the speed a round
 * leaves the launcher. An autocannon is a chemical/cyclic gun (slower, rapid);
 * a railgun and a mass driver are electromagnetic launchers (faster, harder
 * hitting). These set both the round's kinetic energy (`½·m·v²`) and, via
 * {@link MAX_TOF_S}, the weapon's reach (`v × MAX_TOF_S`).
 */
export const MUZZLE_VELOCITY_M_PER_S = {
  /** Autocannon: cyclic chemical gun, fastest fire rate, lowest muzzle speed. */
  autocannon: 4_000,
  /** Railgun: electromagnetic rail launcher, capacitor-fed, high muzzle speed. */
  railgun: 8_000,
  /** Mass driver: heavy coilgun, the highest muzzle speed and round mass. */
  driver: 10_000,
};

/**
 * Projectile mass (kilograms) for each kinetic-weapon class — the mass of one
 * round. Banded by mount class so a hit's kinetic energy `½·m·v²` lands in the
 * intended band: a fighter-scale autocannon round (~1 kg @ 4 km/s ≈ 8 MJ), a
 * frigate-scale railgun slug (~10 kg @ 8 km/s ≈ 320 MJ), a capital mass-driver
 * round (~50 kg @ 10 km/s ≈ 2.5 GJ). Recoil and hit impulse already consume a
 * round's mass, so authoring it per class keeps momentum consistent for free.
 */
export const PROJECTILE_MASS_KG = {
  autocannon: 1,
  railgun: 10,
  driver: 50,
};

// ---------------------------------------------------------------------------
// Reload / thermal-recovery intervals (seconds).
//
// A weapon's cooldown is the real mechanism that gates its next shot: a
// capacitor recharge, a cyclic feed interval, a magazine reload, or a thermal
// recovery. Authored in seconds; the catalogue converts to engine ticks as
// `seconds × TICKS_PER_SECOND`.
// ---------------------------------------------------------------------------

/**
 * Reload / thermal-recovery interval (seconds) for each weapon class — the time
 * its limiting mechanism needs before it can fire again. A railgun waits on its
 * capacitor bank to recharge (~3 s); an autocannon's cyclic feed cycles fast
 * (sub-second); a missile rack reloads from a magazine (~3 s); a torpedo tube
 * is the slowest (~5 s). DERIVED into cooldown ticks as `seconds × TPS`.
 */
export const RELOAD_THERMAL_TIME_S = {
  /** Autocannon: cyclic feed, sub-second between rounds. */
  autocannon: 0.27,
  /** Railgun: capacitor-bank recharge between shots. */
  railgun: 3.2,
  /** Missile rack: launch-rail reload from the magazine. */
  missile: 3,
  /** Torpedo tube: the slowest reload, a heavy ordnance load cycle. */
  torpedo: 5,
};

// ---------------------------------------------------------------------------
// Beam-weapon powers (watts).
//
// A beam weapon kills by dwell: its per-tick damage is its delivered optical
// power times the dwell time of one tick, `beamPower × (1 / TICKS_PER_SECOND)`,
// before the existing range-dependent `beamDamageFactor`. Authored in watts so
// beam DPS is directly comparable, in joules, against a kinetic salvo. Tuned so
// a capital lance's DPS lands beside a capital railgun's now that both are in
// joules.
// ---------------------------------------------------------------------------

/**
 * Delivered beam power (W) for each beam-weapon class — the optical power on
 * target before range falloff. A pulse laser is a light mount (~300 MW, ~10 MJ
 * per tick); a capital lance is the heaviest energy weapon (~6 GW, ~200 MJ per
 * tick). Per-tick beam damage is `BEAM_POWER_W × (1 / TICKS_PER_SECOND)`, so a
 * capital lance carves the gigajoule armour above over a watchable dwell while a
 * pulse laser chips lighter targets.
 */
export const BEAM_POWER_W = {
  /** Pulse laser: light energy mount, the point-defence-grade beam. */
  pulse: 3e8,
  /** Beam laser: a frigate-grade sustained beam, mid power. */
  beam: 1.2e9,
  /** Capital lance: the heaviest energy weapon, gigawatt class. */
  lance: 6e9,
};

/**
 * The dwell time (seconds) of a single engine tick — the interval over which a
 * beam deposits its power in one simulation step, `1 / TICKS_PER_SECOND`. A
 * beam's per-tick energy is `BEAM_POWER_W × BEAM_TICK_DWELL_S` joules. Named
 * here so the power-to-damage conversion reads as an explicit `power × time`
 * rather than a bare reciprocal of the tick rate.
 */
export const BEAM_TICK_DWELL_S = 1 / TICKS_PER_SECOND;

// ---------------------------------------------------------------------------
// Reactor power density (watts per cubic metre).
//
// Reactor output is `powerDensity × moduleVolume`. The volumetric power
// densities themselves live with the other module-mass anchors in `physics.ts`
// (`FUSION_POWER_DENSITY_W_PER_M3`, `ANTIMATTER_POWER_DENSITY_W_PER_M3`); the
// intent is recorded here as part of the combat economy so the link between a
// reactor's gigawatt output and the weapons it must feed is visible in one
// place. The combat-economy consequence: a reactor's gigawatt output must cover
// the summed watt draw of its beams, drives, and shield recharge, which is the
// "shields vs guns" power tension later phases introduce.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Attitude-control slew spec (radians per second, seconds, newton-metres).
//
// A ship's attitude-control torque is DERIVED from how fast it must be able to
// turn, not authored as a round literal: `τ = (MAX_TURN_RATE_RAD_PER_S /
// ATTITUDE_SLEW_TIME_S) × representativeMoI`, where the moment of inertia is
// already the real `Σ m·r²`. The angular acceleration `MAX_TURN_RATE /
// SLEW_TIME` times a representative MoI yields the torque a reaction wheel or
// RCS ring must produce.
// ---------------------------------------------------------------------------

/**
 * The maximum attitude turn rate (radians per second) a ship is specified to
 * reach — the top of its rotational speed envelope. Set to a fraction of a
 * radian per second (~0.2 rad/s, ~11°/s) so a capital ship swings to bear over
 * a couple of seconds rather than snapping instantly. The `ω` in the slew spec:
 * with {@link ATTITUDE_SLEW_TIME_S} it fixes the angular acceleration the
 * attitude torque must deliver.
 */
export const MAX_TURN_RATE_RAD_PER_S = 0.2;

/**
 * The time (seconds) a ship is specified to take to spin up from rest to its
 * maximum turn rate — the slew time. With {@link MAX_TURN_RATE_RAD_PER_S} this
 * sets the required angular acceleration `α = ω / t`, and the attitude torque is
 * `τ = α × representativeMoI`. Set to a couple of seconds so the turn is a
 * watchable manoeuvre, not an instantaneous snap.
 */
export const ATTITUDE_SLEW_TIME_S = 2;

/**
 * The angular acceleration (rad/s²) the attitude-control system must deliver to
 * meet the slew spec — DERIVED as `MAX_TURN_RATE_RAD_PER_S / ATTITUDE_SLEW_TIME_S`.
 * The attitude torque for a given ship is this acceleration times that ship's
 * real moment of inertia (`Σ m·r²`), so heavier or larger ships need
 * proportionally more torque to hit the same slew spec — the equivalence the
 * derivation enforces, rather than a single hand-tuned torque literal.
 */
export const ATTITUDE_ANGULAR_ACCEL_RAD_PER_S2 =
  MAX_TURN_RATE_RAD_PER_S / ATTITUDE_SLEW_TIME_S;
