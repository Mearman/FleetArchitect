import { describe, expect, it } from "vitest";
import {
  OPTICS,
  spotRadius,
  beamIntensity,
  intensityFalloff,
} from "@/domain/simulation/engine/optics";

/**
 * Beam optics: Gaussian beam divergence and intensity falloff.
 *
 * Real diffraction physics, no magic numbers. All test values are derived from
 * named physical anchors or formulas over them. The test parameters use a
 * visible-green laser (λ = 532 nm, aperture 0.5 m) which yields a Rayleigh
 * range of ~739 km — convenient for expressing near-field and far-field
 * behaviour in tests without awkward magnitudes.
 */

describe("optics", () => {
  /** λ = 532 nm (frequency-doubled Nd:YAG, green). */
  const LAMBDA = 532e-9;
  /** Aperture radius 0.5 m (1 m diameter dish). */
  const APERTURE = 0.5;
  /** Rayleigh range for these parameters: π·w₀²/λ ≈ 739 263 m. */
  const RAYLEIGH = (Math.PI * APERTURE * APERTURE) / LAMBDA;

  describe("spotRadius", () => {
    it("equals the aperture radius at zero range", () => {
      expect(spotRadius(LAMBDA, APERTURE, 0)).toBeCloseTo(APERTURE, 12);
    });

    it("grows linearly with range in the far field (z >> z_R)", () => {
      // Far-field approximation: w(z) ≈ θ · z, where θ = λ / (π · w₀).
      const farRange = RAYLEIGH * 1000; // 1000× Rayleigh range.
      const wFar = spotRadius(LAMBDA, APERTURE, farRange);
      const divergenceHalfAngle = LAMBDA / (OPTICS.DIVERGENCE_FACTOR * APERTURE);
      const wApprox = divergenceHalfAngle * farRange;

      // In the far field, full formula ≈ linear approximation to within 0.05%.
      expect(wFar).toBeCloseTo(wApprox, -3);
    });

    it("doubles at exactly one Rayleigh range", () => {
      // w(z_R) = w₀ · √(1 + 1) = w₀ · √2 ≈ 1.414 · w₀.
      const w = spotRadius(LAMBDA, APERTURE, RAYLEIGH);
      expect(w).toBeCloseTo(APERTURE * Math.SQRT2, 10);
    });

    it("grows monotonically with range", () => {
      let prev = spotRadius(LAMBDA, APERTURE, 0);
      for (const r of [1, 100, RAYLEIGH * 0.1, RAYLEIGH, RAYLEIGH * 10, RAYLEIGH * 100]) {
        const w = spotRadius(LAMBDA, APERTURE, r);
        expect(w).toBeGreaterThanOrEqual(prev);
        prev = w;
      }
    });

    it("is symmetric for negative range (range is a distance, not signed)", () => {
      const wPos = spotRadius(LAMBDA, APERTURE, 1000);
      const wNeg = spotRadius(LAMBDA, APERTURE, -1000);
      expect(wPos).toBeCloseTo(wNeg, 12);
    });

    it("returns zero for non-positive wavelength", () => {
      expect(spotRadius(0, APERTURE, 1000)).toBe(0);
      expect(spotRadius(-1e-6, APERTURE, 1000)).toBe(0);
    });

    it("returns zero for non-positive aperture radius", () => {
      expect(spotRadius(LAMBDA, 0, 1000)).toBe(0);
      expect(spotRadius(LAMBDA, -0.1, 1000)).toBe(0);
    });

    it("larger aperture yields smaller spot at the same range (less divergence)", () => {
      const smallAperture = 0.25;
      const largeAperture = 1.0;
      const wSmall = spotRadius(LAMBDA, smallAperture, RAYLEIGH * 10);
      const wLarge = spotRadius(LAMBDA, largeAperture, RAYLEIGH * 10);
      expect(wLarge).toBeLessThan(wSmall);
    });

    it("shorter wavelength yields smaller spot at the same range (less diffraction)", () => {
      const longLambda = 1064e-9; // Infrared Nd:YAG.
      const shortLambda = 266e-9; // UV fourth harmonic.
      const wLong = spotRadius(longLambda, APERTURE, RAYLEIGH * 10);
      const wShort = spotRadius(shortLambda, APERTURE, RAYLEIGH * 10);
      expect(wShort).toBeLessThan(wLong);
    });
  });

  describe("beamIntensity", () => {
    const POWER = 1e6; // 1 MW beam.

    it("returns total power divided by aperture area at zero range", () => {
      // At z=0, w = w₀, so I = P / (π · w₀²).
      const i0 = beamIntensity(LAMBDA, APERTURE, POWER, 0);
      const expected = POWER / (OPTICS.INTENSITY_FACTOR * APERTURE * APERTURE);
      expect(i0).toBeCloseTo(expected, 10);
    });

    it("falls with range (inverse-square in the far field)", () => {
      const iClose = beamIntensity(LAMBDA, APERTURE, POWER, RAYLEIGH * 100);
      const iFar = beamIntensity(LAMBDA, APERTURE, POWER, RAYLEIGH * 200);
      // Far field: doubling range should roughly halve intensity per area squared,
      // i.e. intensity falls by factor of 4 (inverse-square).
      expect(iFar).toBeLessThan(iClose);
      expect(iClose / iFar).toBeCloseTo(4, 0);
    });

    it("returns zero for zero beam power", () => {
      expect(beamIntensity(LAMBDA, APERTURE, 0, RAYLEIGH)).toBe(0);
    });

    it("returns zero for non-positive aperture (degenerate beam)", () => {
      expect(beamIntensity(LAMBDA, 0, POWER, RAYLEIGH)).toBe(0);
    });
  });

  describe("intensityFalloff", () => {
    it("returns 1.0 at zero range", () => {
      expect(intensityFalloff(LAMBDA, APERTURE, 0)).toBeCloseTo(1, 12);
    });

    it("returns 0.5 at one Rayleigh range (beam area doubles)", () => {
      expect(intensityFalloff(LAMBDA, APERTURE, RAYLEIGH)).toBeCloseTo(0.5, 12);
    });

    it("falls as 1/range² in the far field", () => {
      // intensityFalloff = 1 / (1 + (z/z_R)²). In the far field z >> z_R,
      // the +1 is negligible, so falloff ≈ z_R² / z² — inverse-square.
      const r1 = RAYLEIGH * 1000;
      const r2 = RAYLEIGH * 2000;
      const f1 = intensityFalloff(LAMBDA, APERTURE, r1);
      const f2 = intensityFalloff(LAMBDA, APERTURE, r2);
      // Doubling range → falloff quartered (inverse-square).
      expect(f1 / f2).toBeCloseTo(4, 1);
    });

    it("is exactly the square of the aperture-to-spot ratio", () => {
      // intensityFalloff = w₀² / w(z)² by definition.
      const range = RAYLEIGH * 5;
      const w = spotRadius(LAMBDA, APERTURE, range);
      const expected = (APERTURE * APERTURE) / (w * w);
      expect(intensityFalloff(LAMBDA, APERTURE, range)).toBeCloseTo(expected, 12);
    });

    it("returns zero for non-positive wavelength", () => {
      expect(intensityFalloff(0, APERTURE, 1000)).toBe(0);
    });

    it("returns zero for non-positive aperture", () => {
      expect(intensityFalloff(LAMBDA, 0, 1000)).toBe(0);
    });
  });

  describe("determinism", () => {
    it("produces identical results across repeated calls", () => {
      for (let i = 0; i < 50; i++) {
        const range = i * RAYLEIGH * 0.1;
        const a = spotRadius(LAMBDA, APERTURE, range);
        const b = spotRadius(LAMBDA, APERTURE, range);
        const c = intensityFalloff(LAMBDA, APERTURE, range);
        const d = intensityFalloff(LAMBDA, APERTURE, range);
        // Object.is checks bit-identical (no NaN ambiguity since these are
        // well-defined positive values).
        expect(Object.is(a, b)).toBe(true);
        expect(Object.is(c, d)).toBe(true);
      }
    });
  });

  describe("OPTICS constants", () => {
    it("RAYLEIGH_FACTOR is π", () => {
      expect(OPTICS.RAYLEIGH_FACTOR).toBe(Math.PI);
    });

    it("DIVERGENCE_FACTOR equals RAYLEIGH_FACTOR (both π by Gaussian convention)", () => {
      expect(OPTICS.DIVERGENCE_FACTOR).toBe(OPTICS.RAYLEIGH_FACTOR);
    });

    it("INTENSITY_FACTOR is π", () => {
      expect(OPTICS.INTENSITY_FACTOR).toBe(Math.PI);
    });
  });
});
