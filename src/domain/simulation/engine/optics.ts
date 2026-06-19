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
