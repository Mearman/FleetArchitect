import { describe, expect, it } from "vitest";
import type { MediumSnapshot } from "@/schema/battle";
import {
  INTENSITY_DRAW_THRESHOLD,
  glowEdgeFade,
  mediumCellIntensity,
  paletteSample,
} from "./mediumShared";
import { blurGridInPlace, computeIntensityGrid, supersampleToRgba } from "./fieldRaster";

/**
 * The field-raster maths (computeIntensityGrid → blurGridInPlace →
 * supersampleToRgba) is extracted from `drawFieldGlow` to be unit-testable
 * without a canvas. These tests pin the contract: the intensity grid follows
 * the ONE brightness truth, the binomial blur conserves energy and edge-clamps
 * (never wraps), and the supersample applies the draw-threshold as a smooth
 * post-interpolation knee.
 */

/** Build a MediumSnapshot-shaped field from per-cell eps/rho arrays. */
function makeField(
  eps: number[] | Float64Array,
  rho: number[] | Float64Array,
  widthM: number,
  heightM: number,
): MediumSnapshot {
  return {
    rho: new Float64Array(rho),
    eps: new Float64Array(eps),
    widthM,
    heightM,
    pitchM: 500,
  };
}

/** The value `x` takes when stored in the grid's Float32Array (the pipeline
 *  samples the Float32-rounded value, not the authored Float64 literal). */
function f32(x: number): number {
  return new Float32Array([x])[0] ?? 0;
}

/** The byte a Uint8ClampedArray stores on assignment (rounds to nearest, clamps
 *  to [0,255]) — the same conversion `outData[p] = v` applies. Derive expected
 *  bytes through this so assertions are not coupled to the exact rounding rule. */
function clampByte(v: number): number {
  const a = new Uint8ClampedArray(1);
  a[0] = v;
  return a[0] ?? 0;
}

describe("computeIntensityGrid", () => {
  it("matches mediumCellIntensity * glowEdgeFade per cell, with a zero-eps cell reading exactly 0", () => {
    // A 3x3 grid. Place excitation in every cell so edge cells exercise the
    // glowEdgeFade (interior centre cell fades to 1/3; edges/corners to 0),
    // but zero out one interior-reachable cell's eps to confirm an eps-driven
    // zero independent of the fade.
    const widthM = 3;
    const heightM = 3;
    const epsVals = [1e6, 1e6, 1e6, 1e6, 0, 1e6, 1e6, 1e6, 1e6];
    const rhoVals = [1e-13, 2e-13, 3e-13, 4e-13, 5e-13, 6e-13, 7e-13, 8e-13, 9e-13];
    const field = makeField(epsVals, rhoVals, widthM, heightM);
    const fxGain = 1;
    const out = new Float32Array(widthM * heightM);

    computeIntensityGrid(field, fxGain, out);

    for (let i = 0; i < widthM * heightM; i += 1) {
      const col = i % widthM;
      const row = Math.floor(i / widthM);
      const epsHere = epsVals[i];
      if (epsHere === undefined) continue;
      const expected =
        epsHere <= 0
          ? 0
          : mediumCellIntensity(epsHere, rhoVals[i] ?? 0, fxGain) *
            glowEdgeFade(col, row, widthM, heightM);
      expect(out[i]).toBeCloseTo(expected, 6);
    }

    // The zero-eps centre cell (idx 4) reads exactly 0 — the early-out branch,
    // not a fade multiplication.
    expect(out[4]).toBe(0);
  });
});

describe("blurGridInPlace", () => {
  it("spreads a single hot pixel into a monotonically-decreasing falloff in both axes", () => {
    const widthM = 5;
    const heightM = 5;
    const grid = new Float32Array(widthM * heightM);
    const scratch = new Float32Array(widthM * heightM);
    const centreRow = 2;
    const centreCol = 2;
    const hot = 1;
    grid[centreRow * widthM + centreCol] = hot;

    blurGridInPlace(grid, widthM, heightM, scratch);

    const at = (col: number, row: number): number =>
      grid[row * widthM + col] ?? 0;

    // The centre is the global maximum.
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let i = 0; i < grid.length; i += 1) {
      const v = grid[i];
      if (v !== undefined && v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }
    expect(maxIdx).toBe(centreRow * widthM + centreCol);

    // Along the centre row, values are non-increasing moving away from centre.
    for (let col = centreCol; col > 0; col -= 1) {
      expect(at(col, centreRow)).toBeGreaterThanOrEqual(at(col - 1, centreRow));
    }
    for (let col = centreCol; col < widthM - 1; col += 1) {
      expect(at(col, centreRow)).toBeGreaterThanOrEqual(at(col + 1, centreRow));
    }
    // Along the centre column, likewise.
    for (let row = centreRow; row > 0; row -= 1) {
      expect(at(centreCol, row)).toBeGreaterThanOrEqual(at(centreCol, row - 1));
    }
    for (let row = centreRow; row < heightM - 1; row += 1) {
      expect(at(centreCol, row)).toBeGreaterThanOrEqual(at(centreCol, row + 1));
    }
  });

  it("conserves total energy (the [1,2,1]/4 kernel preserves the grid sum)", () => {
    // A centred hot pixel whose support does not reach the clamped boundary, so
    // the kernel is exactly energy-conserving.
    const widthM = 7;
    const heightM = 7;
    const grid = new Float32Array(widthM * heightM);
    const scratch = new Float32Array(widthM * heightM);
    grid[3 * widthM + 3] = 4.2;
    const sumBefore = 4.2;

    blurGridInPlace(grid, widthM, heightM, scratch);

    let sumAfter = 0;
    for (let i = 0; i < grid.length; i += 1) {
      const v = grid[i];
      if (v !== undefined) sumAfter += v;
    }
    expect(sumAfter).toBeCloseTo(sumBefore, 6);
  });

  it("clamps at grid edges (a hot corner does not wrap to the opposite edge)", () => {
    const widthM = 5;
    const heightM = 5;
    const grid = new Float32Array(widthM * heightM);
    const scratch = new Float32Array(widthM * heightM);
    grid[0] = 1; // top-left corner hot pixel

    blurGridInPlace(grid, widthM, heightM, scratch);

    const at = (col: number, row: number): number =>
      grid[row * widthM + col] ?? 0;

    // Heat spreads to the immediate in-grid neighbours of (0,0)...
    expect(at(1, 0)).toBeGreaterThan(0);
    expect(at(0, 1)).toBeGreaterThan(0);
    // ...but does NOT wrap onto the opposite edge / corner.
    expect(at(widthM - 1, 0)).toBe(0);
    expect(at(0, heightM - 1)).toBe(0);
    expect(at(widthM - 1, heightM - 1)).toBe(0);
  });
});

describe("supersampleToRgba", () => {
  it("produces a uniform output block for a uniform grid above the draw threshold", () => {
    const widthM = 2;
    const heightM = 2;
    const factor = 2;
    const intensity = 0.6; // well above the knee
    const grid = new Float32Array(widthM * heightM).fill(intensity);
    const outWidth = widthM * factor;
    const outHeight = heightM * factor;
    const out = new Uint8ClampedArray(outWidth * outHeight * 4);

    supersampleToRgba(grid, widthM, heightM, factor, outWidth, outHeight, out);

    // The grid stores the intensity as Float32 and bytes are written through a
    // Uint8ClampedArray (rounding on assignment), so derive the expected bytes
    // from the same Float32 value through the same clamped assignment. Above the
    // knee the smoothstep saturates to 1, so alpha = round(intensity * 255).
    const stored = f32(intensity);
    const [er, eg, eb] = paletteSample(stored);
    const expected = [
      clampByte(er),
      clampByte(eg),
      clampByte(eb),
      clampByte(Math.round(stored * 255)),
    ];
    // Every texel is identical (uniform) ...
    const first = [out[0], out[1], out[2], out[3]];
    for (let p = 0; p < out.length; p += 4) {
      expect([out[p], out[p + 1], out[p + 2], out[p + 3]]).toEqual(first);
    }
    // ... and equals the palette colour + alpha convention for that intensity.
    expect(first).toEqual(expected);
  });

  it("applies the draw-threshold knee: far-below is transparent, far-above near-full, transition monotonic", () => {
    // A 1x1 grid sampled at factor 2 -> a 2x2 block whose every texel resolves
    // to the single cell value, so we can read the knee response from one texel.
    const widthM = 1;
    const heightM = 1;
    const factor = 2;
    const outWidth = widthM * factor;
    const outHeight = heightM * factor;

    /** Knee alpha for a uniform single-cell intensity, read from texel (0,0). */
    const alphaAt = (intensity: number): number => {
      const grid = new Float32Array([intensity]);
      const out = new Uint8ClampedArray(outWidth * outHeight * 4);
      supersampleToRgba(grid, widthM, heightM, factor, outWidth, outHeight, out);
      return out[3] ?? 0;
    };

    const thr = INTENSITY_DRAW_THRESHOLD;
    // Well below the knee -> fully transparent.
    expect(alphaAt(thr * 0.1)).toBe(0);
    // Across the knee -> monotonic non-decreasing.
    const samples = [thr * 0.5, thr, thr * 1.5, thr * 3];
    let prev = alphaAt(samples[0] ?? 0);
    for (const s of samples) {
      if (s === undefined) continue;
      const a = alphaAt(s);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    // Well above the knee -> near-full alpha scaled by the intensity. The
    // smoothstep is saturated to 1 there, so alpha = round(intensity * 255);
    // derive the expected byte from the Float32-stored value (the grid rounds
    // 0.9 to its Float32 representation) through the clamped assignment.
    const high = 0.9;
    expect(alphaAt(high)).toBe(clampByte(Math.round(f32(high) * 255)));
    expect(alphaAt(high)).toBeGreaterThan(0);
  });
});
