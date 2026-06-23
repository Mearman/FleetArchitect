/**
 * Arena-scale physics derivations for the gameplay anomalies: the black-hole
 * gravitational well (Schwarzschild-derived `G·M`, mass, and horizon radius) and
 * the nebula attenuation factors (Beer-Lambert transmittance). Split out of
 * `config.ts` as a leaf so the tunable `SIM` block stays focused on the feel
 * constants and reads these already-derived values. Each constant traces to a
 * named physical formula, not a hand-tuned literal; `config.ts` is the only
 * consumer and re-exports what the engine needs.
 */

import { BLACK_HOLE_SCHWARZSCHILD_RADIUS_M } from "@/domain/black-hole";

/**
 * The arena gravitational constant: the proportionality `G` in Newton's law
 * `a = G·M / r^2`, in arena units (acceleration is m/tick^2, distance m, mass
 * arena-mass). The honest-physics anchor the whole gravity model hangs off:
 * every gravitating body (the black hole, and from N13 each ship) contributes
 * an acceleration `GRAVITY_CONSTANT_ARENA · M_body / r^2` toward it. The real
 * `G` is 6.674e-11 m^3 kg^-1 s^-2, but the catalogue masses are not yet in SI
 * (that lands in Phase 14, when hulls and modules are re-authored in kg); until
 * then masses are arena units and `G` is set so the black hole's `G·M` recovers
 * the arena-scale pull the combat well is tuned to. Pairing this with the
 * derived {@link BLACK_HOLE_MASS_ARENA} below gives the well its `G·M` product.
 */
export const GRAVITY_CONSTANT_ARENA = 0.1;

/**
 * The arena black hole's Schwarzschild radius (metres) — the radius of its
 * event horizon, `r_s`. Re-exported from the shared pure-domain leaf
 * {@link BLACK_HOLE_SCHWARZSCHILD_RADIUS_M} (`@/domain/black-hole`) so the
 * engine, the occluder module, and the renderer all read one source of truth;
 * `config.ts` imports it from here. A physically meaningful combat-scale length
 * (a couple of dozen metres, a ship-length or two) rather than the sub-atomic
 * figure the real `r_s = 2·G·M / c^2` gives at the relativistic speed of light:
 * the arena well is a sub-km gameplay mechanic, so its gravitational sector
 * propagates at the much slower arena signal speed
 * {@link ARENA_GRAVITATIONAL_SIGNAL_SPEED_M_PER_TICK}, not the relativistic `c`.
 * This is the literal event-horizon proxy reused as `SIM.blackHoleLethalRadius`
 * (a ship inside it has crossed the horizon and is destroyed), and it is one of
 * the two anchors the black hole's `G·M` is derived from via the Schwarzschild
 * relation below.
 */
export { BLACK_HOLE_SCHWARZSCHILD_RADIUS_M };

/**
 * The arena-scale `G·M` the black-hole well is tuned to (arena units). This is
 * the gravitational strength the well's pull, N-body field, lensing,
 * gravitational redshift, and GR dilation were all calibrated against; it is
 * NOT consumed directly — it exists only to fix the arena gravitational signal
 * speed below, after which the live `G·M` ({@link BLACK_HOLE_GM_ARENA}) is
 * derived back through the Schwarzschild relation and recovers this value
 * exactly. Naming it keeps the calibration target explicit and traceable rather
 * than buried as a bare literal in the signal-speed expression.
 */
const BLACK_HOLE_TUNED_GM_ARENA = 5000;

/**
 * The arena gravitational signal speed (metres per tick) — the `c` in the
 * arena's Schwarzschild relation `r_s = 2·G·M / c^2`. NOT the relativistic
 * speed of light (`SPEED_OF_LIGHT_M_PER_S`, ~3e8 m/s), which governs light-lag,
 * relativistic momentum, and time dilation elsewhere; this is the far slower
 * propagation speed of the arena's gameplay gravity sector, chosen so a
 * combat-scale event horizon (`r_s` of tens of metres) corresponds to a
 * combat-scale pull (`G·M` of a few thousand). Rearranging the Schwarzschild
 * relation for the signal speed at the tuned `G·M`: `c_arena = sqrt(2·G·M /
 * r_s)` = `sqrt(2 · 5000 / 24)` ≈ 20.4 m/tick — the relativistic `c` slowed by
 * ~1.5e7, the licence a gameplay well takes so its horizon and its pull share
 * one scale.
 */
const ARENA_GRAVITATIONAL_SIGNAL_SPEED_M_PER_TICK = Math.sqrt(
  (2 * BLACK_HOLE_TUNED_GM_ARENA) / BLACK_HOLE_SCHWARZSCHILD_RADIUS_M,
);

/**
 * The black hole's `G·M` product (arena units): the gravitational strength
 * setting the acceleration `G·M / r^2` toward the well. Derived from the
 * Schwarzschild relation `r_s = 2·G·M / c_arena^2`, rearranged for `G·M`:
 * `G·M = r_s · c_arena^2 / 2` — so the well's pull traces to its event-horizon
 * radius and the arena gravitational signal speed, not to a hand-tuned literal.
 * By construction this recovers {@link BLACK_HOLE_TUNED_GM_ARENA} (5000), the
 * strength the pull, N-body field, lensing, redshift, and GR dilation are tuned
 * to, so the grounding changes no behaviour — it re-expresses the same arena
 * feel as a Schwarzschild-derived `G·M`.
 */
export const BLACK_HOLE_GM_ARENA =
  (BLACK_HOLE_SCHWARZSCHILD_RADIUS_M *
    ARENA_GRAVITATIONAL_SIGNAL_SPEED_M_PER_TICK *
    ARENA_GRAVITATIONAL_SIGNAL_SPEED_M_PER_TICK) /
  2;

/**
 * The black hole's mass in arena-mass units, recovered from the derived `G·M`
 * product and the arena gravitational constant: `M = G·M / G`. The black hole
 * gravitates by `G·M / r^2` like any other body on the gravitational body list,
 * just far more massively (a ship's mass is ~10 arena units, so the hole
 * outweighs a frigate by ~5000×, and inter-ship gravity is a tiny perturbation
 * against the well — physically correct). With `G·M = 5000` and
 * `G = GRAVITY_CONSTANT_ARENA = 0.1` this is 50000 — the same mass the well
 * carried before, now derived rather than authored as a round literal.
 */
export const BLACK_HOLE_MASS_ARENA =
  BLACK_HOLE_GM_ARENA / GRAVITY_CONSTANT_ARENA;

// ---------------------------------------------------------------------------
// Nebula attenuation (Beer-Lambert). A nebula is an ionised gas cloud that
// scatters and absorbs energy passing through it; the fraction of a signal
// (sensor return, EM coupling) that survives a path of length `d` is the
// Beer-Lambert transmittance `I/I0 = exp(-μ·d)`, where `μ` is the per-metre
// attenuation coefficient for that channel in this cloud. The nebula factors
// below are this transmittance over a representative combat-engagement path:
// the sensor channel uses a higher `μ` (a return is scattered twice, out and
// back) than the one-way EM channel, so a sensor return attenuates faster than
// shield coupling or homing lock. They replace three identical 0.5 round
// literals; the derived values differ slightly from 0.5, the intended
// consequence of grounding them in real coefficients rather than one hand-picked
// number. (A propulsion / gas-drag channel, μ ≈ 0.05 per 100 m, would slot in
// the same way once a nebula drive-drag effect exists to consume it.)
// ---------------------------------------------------------------------------

/**
 * Representative path length (metres) a signal traverses through a nebula in a
 * combat engagement — the `d` in the Beer-Lambert transmittance `exp(-μ·d)`.
 * Set to the median weapon-range band, the distance over which two engaged ships'
 * sensor returns and EM coupling cross the intervening gas. Re-grounded for km
 * combat (Phase 3): the catalogue's weapon ranges now span ~12-80 km (kinetic
 * ~12-30 km, beam ~52 km, missile ~80 km), so the engagement path is the
 * ~35 km centre of mass of that km-scale distribution, not the pre-km few-hundred-
 * metre band. The per-metre coefficients below are scaled down in lockstep so the
 * dimensionless transmittance (`μ·d`, the value actually consumed) is preserved
 * across the rescale.
 */
const NEBULA_ENGAGEMENT_PATH_M = 35_000;

/**
 * Per-metre Beer-Lambert attenuation coefficient (1/m) for a sensor return in a
 * nebula — the most strongly attenuated channel, because a radar/lidar return is
 * scattered twice (out and back) by charged particles. ~0.2 per 10 km of the
 * km-scale engagement path; over {@link NEBULA_ENGAGEMENT_PATH_M} this gives a
 * transmittance near one half, the historical sensor reduction, now grounded.
 * Scaled down per-metre in lockstep with the km-scale engagement path so the
 * product `μ·d` (and thus the transmittance) matches the pre-km calibration.
 */
const NEBULA_MU_SENSOR_PER_M = 0.2 / 10_000;

/**
 * Per-metre Beer-Lambert attenuation coefficient (1/m) for one-way EM coupling
 * in a nebula — a shield projector coupling to the local field, or a homing
 * weapon's EM return. About half the sensor coefficient (~0.1 per 10 km of the
 * km-scale engagement path) because the path is traversed once, not as a
 * there-and-back scatter.
 */
const NEBULA_MU_EM_PER_M = 0.1 / 10_000;

/** Beer-Lambert transmittance `exp(-μ·d)` over the engagement path. The shared
 *  closed form the nebula attenuation factors evaluate; each factor reads as one
 *  named coefficient through one law. */
function nebulaTransmittance(muPerMetre: number): number {
  return Math.exp(-muPerMetre * NEBULA_ENGAGEMENT_PATH_M);
}

/**
 * Nebula EM-channel transmittance (`exp(-μ_EM · d)`, ~0.70): the fraction of
 * one-way EM coupling surviving the engagement path. Grounds both the shield
 * regen and the homing-tracking attenuation — same physical channel.
 */
export const NEBULA_EM_TRANSMITTANCE = nebulaTransmittance(NEBULA_MU_EM_PER_M);

/**
 * Nebula sensor-channel transmittance (`exp(-μ_sensor · d)`, ~0.50): the
 * fraction of a two-way sensor return surviving the engagement path. Grounds the
 * sensor-radius attenuation; lower than the EM channel because a return is
 * scattered out and back.
 */
export const NEBULA_SENSOR_TRANSMITTANCE = nebulaTransmittance(
  NEBULA_MU_SENSOR_PER_M,
);
