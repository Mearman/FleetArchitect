import { SPEED_OF_LIGHT_M_PER_S } from "./config";

/**
 * Beam optics: diffraction-limited divergence and intensity falloff for
 * directed-energy weapons (lasers, particle beams). Pure functions, no state.
 *
 * A Gaussian beam with waist radius w₀ (the aperture radius of the emitter)
 * and wavelength λ has a Rayleigh range z_R = π·w₀²/λ. The 1/e² beam radius
 * at range z is w(z) = w₀ · √(1 + (z/z_R)²). In the far field (z >> z_R) this
 * approaches w(z) ≈ (λ / (π·w₀)) · z — linear growth with range, with
 * divergence half-angle θ = λ / (π·w₀).
 *
 * Intensity (power per unit area) at the target is I(z) = P / (π·w(z)²),
 * where P is the emitted beam power. In the far field this falls as 1/z² —
 * the classic inverse-square law for a diverging beam.
 */

/** Named physical anchors (SI units). All three factors equal π by Gaussian
 *  beam convention; they are named separately so each formula reads against its
 *  physical meaning rather than a bare Math.PI. */
export const OPTICS: {
  /** Rayleigh range factor: z_R = RAYLEIGH_FACTOR · w₀² / λ. */
  RAYLEIGH_FACTOR: number;
  /** Far-field divergence half-angle: θ = λ / (DIVERGENCE_FACTOR · w₀). */
  DIVERGENCE_FACTOR: number;
  /** Gaussian beam intensity normalisation: I = P / (INTENSITY_FACTOR · w²). */
  INTENSITY_FACTOR: number;
} = {
  RAYLEIGH_FACTOR: Math.PI,
  DIVERGENCE_FACTOR: Math.PI,
  INTENSITY_FACTOR: Math.PI,
};

/**
 * Wavelength (metres) of a ship-mounted directed-energy weapon: a frequency-
 * doubled Nd:YAG line (532 nm, visible green) — the canonical high-power solid-
 * state laser line, the same anchor the optics unit tests carry. The beam
 * physics scales with λ, so naming the real line keeps the divergence grounded
 * rather than hand-picked.
 */
export const BEAM_WAVELENGTH_M = 532e-9;

/**
 * The reference range (metres) at which a combat beam's spot has diverged to
 * its Rayleigh point — where the beam area has doubled and intensity has halved.
 * Anchored to a representative ship-scale beam reach so that divergence is a
 * real, felt effect across an engagement (a beam noticeably weaker at the far
 * edge of its range than point-blank) rather than a negligible far-field
 * correction. Authored catalogue content: a directed-energy weapon's effective
 * collimation distance.
 */
export const BEAM_RAYLEIGH_REFERENCE_M = 400;

/**
 * Emitter aperture radius (metres) of a ship-mounted beam weapon, DERIVED from
 * the wavelength and the reference Rayleigh range rather than hand-picked. The
 * Rayleigh range is z_R = π · w₀² / λ, so the aperture that places z_R at
 * BEAM_RAYLEIGH_REFERENCE_M is w₀ = sqrt(λ · z_R / π). For the 532 nm line and
 * a ~400 m reference this is a sub-centimetre emitter waist — a compact lasing
 * cavity, physically consistent with a ship-scale directed-energy mount.
 */
export const BEAM_APERTURE_RADIUS_M = Math.sqrt(
  (BEAM_WAVELENGTH_M * BEAM_RAYLEIGH_REFERENCE_M) / OPTICS.RAYLEIGH_FACTOR,
);

/**
 * Compute the 1/e² beam spot radius at a given range using the full Gaussian
 * beam formula (not the far-field approximation), so the result is physically
 * correct at all ranges from zero to the far field.
 *
 * w(z) = w₀ · √(1 + (z / z_R)²)
 *
 * where z_R = π · w₀² / λ is the Rayleigh range — the distance over which the
 * beam area doubles.
 *
 * @param wavelength - Beam wavelength in metres (e.g. 1.064e-6 for Nd:YAG).
 * @param apertureRadius - Emitter aperture radius in metres (half the dish
 *   diameter; the beam waist at the emitter).
 * @param range - Distance from emitter to target in metres.
 * @returns The 1/e² beam spot radius in metres at that range.
 */
export function spotRadius(
  wavelength: number,
  apertureRadius: number,
  range: number,
): number {
  if (wavelength <= 0 || apertureRadius <= 0) return 0;
  const rayleighRange =
    (OPTICS.RAYLEIGH_FACTOR * apertureRadius * apertureRadius) / wavelength;
  const ratio = range / rayleighRange;
  return apertureRadius * Math.sqrt(1 + ratio * ratio);
}

/**
 * Compute the intensity (power per unit area) at a given range for a beam of
 * known emitted power. The beam spot is assumed circular with the Gaussian
 * 1/e² radius from `spotRadius`. Intensity is total power divided by the
 * beam's cross-sectional area: I(z) = P / (π · w(z)²).
 *
 * In the far field (z >> z_R), this simplifies to I ≈ P · π · w₀² / (λ² · z²),
 * i.e. inverse-square falloff — the same law that governs any diverging
 * emission in free space.
 *
 * @param wavelength - Beam wavelength in metres.
 * @param apertureRadius - Emitter aperture radius in metres.
 * @param beamPower - Total emitted beam power in watts.
 * @param range - Distance from emitter to target in metres.
 * @returns Intensity at the target in watts per square metre.
 */
export function beamIntensity(
  wavelength: number,
  apertureRadius: number,
  beamPower: number,
  range: number,
): number {
  const w = spotRadius(wavelength, apertureRadius, range);
  if (w <= 0) return 0;
  return beamPower / (OPTICS.INTENSITY_FACTOR * w * w);
}

/**
 * Compute the fractional intensity at a given range relative to the intensity
 * at zero range (the aperture plane). At z = 0, w = w₀, so I₀ = P / (π·w₀²).
 * The ratio is I(z)/I₀ = w₀²/w(z)² = 1 / (1 + (z/z_R)²).
 *
 * This is the most useful form for weapon damage scaling: the caller knows the
 * base damage at point-blank and scales it by the returned factor.
 *
 * @param wavelength - Beam wavelength in metres.
 * @param apertureRadius - Emitter aperture radius in metres.
 * @param range - Distance from emitter to target in metres.
 * @returns Fractional intensity, 1.0 at the aperture plane, falling toward 0.
 */
export function intensityFalloff(
  wavelength: number,
  apertureRadius: number,
  range: number,
): number {
  if (wavelength <= 0 || apertureRadius <= 0) return 0;
  const rayleighRange =
    (OPTICS.RAYLEIGH_FACTOR * apertureRadius * apertureRadius) / wavelength;
  const ratio = range / rayleighRange;
  return 1 / (1 + ratio * ratio);
}

// ---------------------------------------------------------------------------
// Relativistic ray optics (Phase 10): Doppler shift, aberration, gravitational
// redshift, and weak-field lensing. Pure functions over (beta, angle, phi, GM);
// beta is the dimensionless v/c along the relevant axis, phi the gravitational
// potential (m^2/s^2), GM the body's standard gravitational parameter (m^3/s^2).
// These transform the EM that the Phase 8 pulses / Phase 9 emissions carry.
// ---------------------------------------------------------------------------

/**
 * The fractional beam intensity surviving Gaussian divergence at `range` for the
 * ship-scale beam anchors above: the closed-form `intensityFalloff` evaluated at
 * the weapon's wavelength and aperture. 1.0 at the muzzle, falling toward 0 with
 * range as the spot diverges — the multiplier a hitscan beam scales its damage
 * by so a long-range shot lands softer than a point-blank one.
 */
export function beamDamageFactor(range: number): number {
  return intensityFalloff(BEAM_WAVELENGTH_M, BEAM_APERTURE_RADIUS_M, range);
}

/**
 * The radial component of the relative velocity between an emitter and a
 * receiver, expressed as a dimensionless fraction of light (beta), POSITIVE when
 * the two are separating (receding → redshift) and negative when closing
 * (approaching → blueshift). The relative velocity is (emitter − receiver)
 * velocity; its projection onto the line-of-sight unit vector from receiver to
 * emitter is the radial rate. Pure closed-form: no solver, no clock. Returns 0
 * when the two are coincident (no defined line of sight).
 *
 * @param relVx - emitter.vx − receiver.vx (world units per tick).
 * @param relVy - emitter.vy − receiver.vy (world units per tick).
 * @param losX - emitter.x − receiver.x (world units; the line-of-sight vector).
 * @param losY - emitter.y − receiver.y (world units).
 * @param cPerTick - the speed of light in the same units per tick as the
 *   velocities, so the ratio is dimensionless.
 */
export function relativeRadialBeta(
  relVx: number,
  relVy: number,
  losX: number,
  losY: number,
  cPerTick: number,
): number {
  const losLen = Math.hypot(losX, losY);
  if (losLen <= 0 || cPerTick <= 0) return 0;
  const radial = (relVx * losX + relVy * losY) / losLen;
  return radial / cPerTick;
}

/** The relativistic Doppler factor D = sqrt((1 - beta)/(1 + beta)) for a
 *  source receding at radial fraction-of-c `beta` (positive = receding, so
 *  D < 1 = redshift; negative = approaching, D > 1 = blueshift). A photon's
 *  received frequency is the emitted frequency times D. */
export function dopplerFactor(beta: number): number {
  return Math.sqrt((1 - beta) / (1 + beta));
}

/** Relativistic aberration: the angle (radians, from the relative-velocity
 *  axis) at which an observer moving at `beta` sees a ray that was at `angle`
 *  in the source frame. cos(theta') = (cos(theta) - beta) / (1 - beta·cos(theta)).
 *  A ray perpendicular in the source frame (theta = PI/2) is swept forward in
 *  the observer frame — the "searchlight" effect of relativistic motion. */
export function relativisticAberration(angle: number, beta: number): number {
  const cosT = Math.cos(angle);
  // Moving-source (searchlight) convention: a source moving at +beta
  // concentrates its emission forward. cos(theta') = (cos(theta) + beta) /
  // (1 + beta*cos(theta)); a perpendicular ray (theta = PI/2) appears at
  // acos(beta) < PI/2 (forward of 90 degrees).
  const cosTp = (cosT + beta) / (1 + beta * cosT);
  return Math.acos(cosTp);
}

/** Gravitational redshift: the frequency factor of a photon climbing out of a
 *  potential `phi` (m^2/s^2, negative). f_received / f_emitted = sqrt(1 + 2·Phi/c^2)
 *  — a photon escaping a well is redshifted; at the Schwarzschild radius
 *  (Phi = -c^2/2) the shift goes to 0. */
export function gravitationalRedshift(phi: number): number {
  const c2 = SPEED_OF_LIGHT_M_PER_S * SPEED_OF_LIGHT_M_PER_S;
  const f = 1 + (2 * phi) / c2;
  return f <= 0 ? 0 : Math.sqrt(f);
}

/** Weak-field gravitational lensing: the deflection angle (radians) of a ray
 *  passing a body of gravitational parameter `gm` at impact parameter `b`
 *  (closest approach, metres). Einstein's formula: 4·GM / (c^2 · b). For the
 *  Sun (GM = 1.327e20, b = 6.96e8 solar radius) this is the famous ~1.75
 *  arcseconds. Returns 0 for b <= 0 (a ray through the centre is not in the
 *  weak-field regime). */
export function lensingDeflection(impactParameter: number, gm: number): number {
  if (impactParameter <= 0) return 0;
  const c2 = SPEED_OF_LIGHT_M_PER_S * SPEED_OF_LIGHT_M_PER_S;
  return (4 * gm) / (c2 * impactParameter);
}
