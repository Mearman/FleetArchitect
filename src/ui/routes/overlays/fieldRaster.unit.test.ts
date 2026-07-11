import { describe, expect, it } from "vitest";
import type { MediumSnapshot } from "@/schema/battle";
import {
  INTENSITY_DRAW_THRESHOLD,
  glowEdgeFade,
  mediumCellIntensity,
  paletteSample,
} from "./mediumShared";
import {
  blurGridInPlace,
  computeIntensityGrid,
  emissionCrossfadeAlpha,
  supersampleToRgba,
} from "./fieldRaster";

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

  it("spreads an isolated hot cell to distance 2 (the two-pass PSF bridges a one-cell gap)", () => {
    // An excited cell the 500 m grid cannot resolve must render as a soft
    // point-spread blob wide enough that two cells with one dark cell between
    // them merge into connected haze. One [1,2,1]/4 pass has support radius 1
    // (distance 2 stays exactly 0 — the confirmed dot-lattice artefact); the
    // two-pass [1,4,6,4,1]/16 kernel reaches distance 2 at 6/256 of the source.
    const widthM = 7;
    const heightM = 7;
    const grid = new Float32Array(widthM * heightM);
    const scratch = new Float32Array(widthM * heightM);
    const hot = 1;
    grid[3 * widthM + 3] = hot;

    blurGridInPlace(grid, widthM, heightM, scratch);

    const at = (col: number, row: number): number =>
      grid[row * widthM + col] ?? 0;
    // Distance 2 along each axis carries (1/16)·(6/16) = 6/256 of the source.
    const expected = (hot * 6) / 256;
    expect(at(5, 3)).toBeCloseTo(expected, 6);
    expect(at(1, 3)).toBeCloseTo(expected, 6);
    expect(at(3, 5)).toBeCloseTo(expected, 6);
    expect(at(3, 1)).toBeCloseTo(expected, 6);
  });

  it("conserves total energy (the binomial kernel preserves the grid sum)", () => {
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

  it("fades continuously with no visibility cliff: alpha tracks intensity down to the quantisation floor", () => {
    // A 1x1 grid sampled at factor 2 -> a 2x2 block whose every texel resolves
    // to the single cell value, so we can read the alpha response from one texel.
    const widthM = 1;
    const heightM = 1;
    const factor = 2;
    const outWidth = widthM * factor;
    const outHeight = heightM * factor;

    /** Output alpha for a uniform single-cell intensity, read from texel (0,0). */
    const alphaAt = (intensity: number): number => {
      const grid = new Float32Array([intensity]);
      const out = new Uint8ClampedArray(outWidth * outHeight * 4);
      supersampleToRgba(grid, widthM, heightM, factor, outWidth, outHeight, out);
      return out[3] ?? 0;
    };

    // No artistic threshold: alpha = round(intensity * 255) at EVERY intensity,
    // so a dim field fades continuously instead of being sliced into per-cell
    // dots by a visibility cliff. A dim value near the old knee (0.01) is
    // faintly visible, not zero.
    const thr = INTENSITY_DRAW_THRESHOLD;
    expect(alphaAt(thr * 0.5)).toBe(clampByte(Math.round(f32(thr * 0.5) * 255)));
    expect(alphaAt(thr * 0.5)).toBeGreaterThan(0);
    // Monotonic non-decreasing across the dim range.
    const samples = [thr * 0.5, thr, thr * 1.5, thr * 3];
    let prev = 0;
    for (const s of samples) {
      const a = alphaAt(s);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    // Only below the byte-quantisation floor (where the alpha byte would round
    // to 0 anyway) is the texel written fully transparent.
    expect(alphaAt(1 / 1024)).toBe(0);
    // Bright intensities keep the original alpha convention unchanged.
    const high = 0.9;
    expect(alphaAt(high)).toBe(clampByte(Math.round(f32(high) * 255)));
    expect(alphaAt(high)).toBeGreaterThan(0);
  });
});

describe("emissionCrossfadeAlpha", () => {
  /**
   * The cross-fade factor blends the medium field between consecutive emissions
   * (every RESOURCE_EVERY = 6 ticks) so the glow evolves smoothly instead of
   * stepping. `f` is the current buffer's alpha: 0 right at the current
   * emission tick (still looks like the previous field, no pop), ramping to 1 by
   * the next emission (span = currentTick - previousTick).
   */

  it("returns 1 when previousTick is undefined (battle start, no prior emission)", () => {
    expect(emissionCrossfadeAlpha(0, 0, undefined)).toBe(1);
    expect(emissionCrossfadeAlpha(6, 6, undefined)).toBe(1);
    // A fractional tickF partway through the first stride still draws the
    // current buffer alone, since there is nothing to fade from.
    expect(emissionCrossfadeAlpha(3.5, 0, undefined)).toBe(1);
  });

  it("returns 0 exactly at tickF === currentTick when a previous emission exists", () => {
    // The moment the current emission lands: the current buffer contributes
    // nothing, so the field looks exactly like the previous emission (no pop).
    expect(emissionCrossfadeAlpha(6, 6, 0)).toBe(0);
    expect(emissionCrossfadeAlpha(12, 12, 6)).toBe(0);
  });

  it("ramps linearly to 1 as tickF approaches currentTick + span", () => {
    // span = currentTick - previousTick = 6. At tickF = currentTick + span the
    // current buffer is at full strength; the next emission then lands and the
    // roles swap (what was current becomes previous).
    expect(emissionCrossfadeAlpha(12, 6, 0)).toBe(1);
    // Midway through the span, the two buffers contribute equally.
    expect(emissionCrossfadeAlpha(9, 6, 0)).toBeCloseTo(0.5, 10);
    // One third of the way through.
    expect(emissionCrossfadeAlpha(8, 6, 0)).toBeCloseTo(1 / 3, 10);
  });

  it("is clamped to [0, 1] for tickF outside the expected range", () => {
    // Below currentTick (before the current emission landed) clamps to 0.
    expect(emissionCrossfadeAlpha(5, 6, 0)).toBe(0);
    // Above currentTick + span (past the next emission point) clamps to 1.
    expect(emissionCrossfadeAlpha(13, 6, 0)).toBe(1);
    // Well above the span.
    expect(emissionCrossfadeAlpha(100, 6, 0)).toBe(1);
  });

  it("returns 1 when span is non-positive (degenerate currentTick <= previousTick)", () => {
    // currentTick === previousTick: no span to fade across, draw current only.
    expect(emissionCrossfadeAlpha(6, 6, 6)).toBe(1);
    // currentTick < previousTick (should not occur; defensive) draws current only.
    expect(emissionCrossfadeAlpha(5, 5, 6)).toBe(1);
  });
});
