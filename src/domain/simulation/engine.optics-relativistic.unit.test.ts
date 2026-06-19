import { describe, expect, it } from "vitest";
import { SPEED_OF_LIGHT_M_PER_S } from "./engine/config";
import { dopplerFactor, gravitationalRedshift, lensingDeflection, relativisticAberration } from "./engine/optics";

describe("engine.optics — relativistic ray optics (Phase 10)", () => {
  it("Doppler: receding redshifts (D<1), approaching blueshifts (D>1)", () => {
    expect(dopplerFactor(0)).toBe(1);
    expect(dopplerFactor(0.5)).toBeCloseTo(Math.sqrt(1 / 3), 6); // sqrt(0.5/1.5)
    expect(dopplerFactor(0.5)).toBeLessThan(1);   // receding -> redshift
    expect(dopplerFactor(-0.5)).toBeGreaterThan(1); // approaching -> blueshift
  });

  it("aberration sweeps a perpendicular ray forward", () => {
    // theta = PI/2 (perpendicular), beta = 0.5: the ray appears forward of 90deg.
    const ab = relativisticAberration(Math.PI / 2, 0.5);
    expect(ab).toBeLessThan(Math.PI / 2);
    // theta = 0 (forward) stays forward.
    expect(relativisticAberration(0, 0.5)).toBeCloseTo(0, 6);
  });

  it("gravitational redshift -> 0 at the Schwarzschild radius", () => {
    const c2 = SPEED_OF_LIGHT_M_PER_S * SPEED_OF_LIGHT_M_PER_S;
    expect(gravitationalRedshift(0)).toBe(1);
    expect(gravitationalRedshift(-c2 / 2)).toBeCloseTo(0, 6);
  });

  it("lensing reproduces the Sun's ~1.75 arcsecond deflection", () => {
    // 4GM/(c^2 b) for the Sun: GM = 1.327e20, b = 6.96e8 (solar radius).
    const deflect = lensingDeflection(6.96e8, 1.327e20);
    const arcsec = deflect * (180 / Math.PI) * 3600;
    expect(arcsec).toBeGreaterThan(1.6);
    expect(arcsec).toBeLessThan(1.9);
  });

  it("is deterministic (pure functions)", () => {
    expect(dopplerFactor(0.3)).toEqual(dopplerFactor(0.3));
    expect(relativisticAberration(1.2, 0.4)).toEqual(relativisticAberration(1.2, 0.4));
  });
});
