import type { MediumSnapshot } from "@/schema/battle";
import {
  INTENSITY_DRAW_THRESHOLD,
  glowEdgeFade,
  mediumCellIntensity,
  paletteSample,
} from "./mediumShared";
import { smoothstep } from "./particleDynamics";

// ---------------------------------------------------------------------------
// Field rasterisation (pure, unit-testable)
// ---------------------------------------------------------------------------
//
// Extracted from `battleGlow.ts`'s `drawFieldGlow` so the medium-field raster
// maths is testable without a canvas. Three stages, all allocation-free (every
// buffer is caller-provided and pooled, mirroring the `GlowBuffer`/`ImageData`
// pooling in `battleGlow.ts`):
//
//   1. computeIntensityGrid — the ONE brightness truth (mediumCellIntensity ×
//      glowEdgeFade) per cell into a Float32Array, WITHOUT the draw-threshold
//      cliff (small nonzero values survive so the blur has something to work
//      with at region edges).
//   2. blurGridInPlace — two separable [1,2,1]/4 binomial passes (a cheap
//      Gaussian approximation, sigma ~1 cell) so the one-texel-per-cell raster
//      no longer reads as a lattice.
//   3. supersampleToRgba — bilinearly upsample the blurred grid at `factor`
//      texels per cell into RGBA, applying the draw-threshold as a
//      POST-interpolation smoothstep knee (region edges fade smoothly instead
//      of lattice-aligned contrast steps).

/** A texel whose smoothstep knee alpha falls below this is written fully
 *  transparent and skips the palette lookup — the cheap early-out that
 *  preserves the original raster's "skip fully-dark texels" performance
 *  characteristic on the wide dark ISM background. */
const ALPHA_CUTOFF = 1e-4;

/**
 * Compute the continuous glow intensity for every cell of `field` into the
 * caller-provided `out` Float32Array (sized `widthM * heightM`). This is the
 * SAME brightness truth the old inline raster used —
 * `mediumCellIntensity(eps, rho, fxGain) * glowEdgeFade(col, row)` — but it
 * does NOT apply {@link INTENSITY_DRAW_THRESHOLD}: that hard per-cell cliff
 * moved to a post-interpolation smoothstep knee in {@link supersampleToRgba},
 * so the small nonzero intensities at a region's edge survive here for the blur
 * to spread. A cell with no excitation (`epsVis`/`eps` undefined or <= 0) reads
 * exactly 0.
 *
 * Allocation-free: the caller pools `out` (the same pooling convention as
 * `GlowBuffer`'s `ImageData`). No draw-threshold cliff is applied here.
 */
export function computeIntensityGrid(
  field: MediumSnapshot,
  fxGain: number,
  out: Float32Array,
): void {
  const { rho, eps, epsVis, widthM, heightM } = field;
  const glowEps = epsVis ?? eps;
  const cellCount = widthM * heightM;
  for (let i = 0; i < cellCount; i += 1) {
    const epsHere = glowEps[i];
    if (epsHere === undefined || epsHere <= 0) {
      out[i] = 0;
      continue;
    }
    // `rho` is dense (length >= cellCount, validated by the caller in
    // `drawFieldGlow`); noUncheckedIndexedAccess still types the read as
    // number | undefined, so narrow explicitly rather than silently coercing.
    const rhoHere = rho[i];
    if (rhoHere === undefined) {
      out[i] = 0;
      continue;
    }
    const col = i % widthM;
    const row = Math.floor(i / widthM);
    out[i] =
      mediumCellIntensity(epsHere, rhoHere, fxGain) *
      glowEdgeFade(col, row, widthM, heightM);
  }
}

/**
 * Blur `grid` in place with two separable passes of a [1,2,1]/4 binomial
 * kernel (a cheap discrete Gaussian approximation, sigma ~1 cell): a
 * horizontal pass reading `grid` into `scratch`, then a vertical pass reading
 * `scratch` back into `grid`. Both buffers are `widthM * heightM` and
 * caller-provided (no allocation). Neighbours are clamped at the grid edge by
 * REPEATING the edge value (edge extension), never wrapped across rows or
 * columns, so a hot corner does not leak onto the opposite edge. The kernel
 * conserves total energy for any region whose support does not touch the
 * clamped boundary.
 */
export function blurGridInPlace(
  grid: Float32Array,
  widthM: number,
  heightM: number,
  scratch: Float32Array,
): void {
  // Horizontal pass: grid -> scratch, [1,2,1]/4 along each row.
  for (let row = 0; row < heightM; row += 1) {
    const base = row * widthM;
    for (let col = 0; col < widthM; col += 1) {
      const i = base + col;
      const c = grid[i];
      if (c === undefined) {
        scratch[i] = 0;
        continue;
      }
      // Edge-extended neighbours: the edge value (c) itself at the row
      // boundary; otherwise the in-row neighbour (guaranteed in-bounds by the
      // col guard, narrowed explicitly for noUncheckedIndexedAccess).
      let left = c;
      if (col > 0) {
        const lv = grid[i - 1];
        if (lv !== undefined) left = lv;
      }
      let right = c;
      if (col < widthM - 1) {
        const rv = grid[i + 1];
        if (rv !== undefined) right = rv;
      }
      scratch[i] = (left + 2 * c + right) / 4;
    }
  }

  // Vertical pass: scratch -> grid, [1,2,1]/4 along each column.
  for (let col = 0; col < widthM; col += 1) {
    for (let row = 0; row < heightM; row += 1) {
      const i = row * widthM + col;
      const c = scratch[i];
      if (c === undefined) {
        grid[i] = 0;
        continue;
      }
      let up = c;
      if (row > 0) {
        const uv = scratch[i - widthM];
        if (uv !== undefined) up = uv;
      }
      let down = c;
      if (row < heightM - 1) {
        const dv = scratch[i + widthM];
        if (dv !== undefined) down = dv;
      }
      grid[i] = (up + 2 * c + down) / 4;
    }
  }
}

/**
 * Read a grid value at integer coordinates clamped to the grid bounds, narrowing
 * the typed-array read. Indices are clamped to `[0, widthM-1] × [0, heightM-1]`
 * by the caller, so the read is always in-bounds for a `widthM × heightM`
 * grid; the undefined branch is unreachable and treated as 0.
 */
function gridRead(
  grid: Float32Array,
  widthM: number,
  heightM: number,
  col: number,
  row: number,
): number {
  const c = Math.max(0, Math.min(widthM - 1, col));
  const r = Math.max(0, Math.min(heightM - 1, row));
  const v = grid[r * widthM + c];
  if (v === undefined) return 0;
  return v;
}

/** Bilinearly sample `grid` at the fractional coordinate `(gx, gy)`: 4-tap
 *  blend of the enclosing cell corners, clamped (edge-extended) at the grid
 *  bounds. Reused by {@link supersampleToRgba} for the upsample. */
function sampleBilinear(
  grid: Float32Array,
  widthM: number,
  heightM: number,
  gx: number,
  gy: number,
): number {
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const v00 = gridRead(grid, widthM, heightM, x0, y0);
  const v10 = gridRead(grid, widthM, heightM, x0 + 1, y0);
  const v01 = gridRead(grid, widthM, heightM, x0, y0 + 1);
  const v11 = gridRead(grid, widthM, heightM, x0 + 1, y0 + 1);
  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bot * fy;
}

/**
 * Supersample `grid` (a blurred intensity field, `widthM × heightM`) at `factor`
 * texels per cell into the caller-provided RGBA byte buffer. For each output
 * texel `(ox, oy)` the fractional source-grid coordinate is
 * `((ox + 0.5) / factor - 0.5, (oy + 0.5) / factor - 0.5)`; the grid is
 * bilinearly sampled there, then the draw-threshold is applied as a
 * POST-interpolation smoothstep knee
 * `smoothstep(thr*0.5, thr*1.5, sampled)` so region edges fade smoothly
 * instead of showing the lattice-aligned hard cliff of the old per-cell cut.
 *
 * `outWidth = widthM * factor` and `outHeight = heightM * factor` (the caller
 * computes and passes them — they are not recomputed inside). A texel whose
 * knee alpha is below {@link ALPHA_CUTOFF} is written fully transparent
 * `(0,0,0,0)` and skips the palette lookup (cheap early-out, preserving the
 * original raster's skip-fully-dark-texels performance). Otherwise RGB comes
 * from `paletteSample(sampled)` and alpha is `round(sampled * a * 255)` — the
 * original `round(intensity * 255)` convention, now knee-scaled.
 */
export function supersampleToRgba(
  grid: Float32Array,
  widthM: number,
  heightM: number,
  factor: number,
  outWidth: number,
  outHeight: number,
  outData: Uint8ClampedArray,
): void {
  for (let oy = 0; oy < outHeight; oy += 1) {
    for (let ox = 0; ox < outWidth; ox += 1) {
      const gx = (ox + 0.5) / factor - 0.5;
      const gy = (oy + 0.5) / factor - 0.5;
      const sampled = sampleBilinear(grid, widthM, heightM, gx, gy);
      const a = smoothstep(
        INTENSITY_DRAW_THRESHOLD * 0.5,
        INTENSITY_DRAW_THRESHOLD * 1.5,
        sampled,
      );
      const p = (ox + oy * outWidth) * 4;
      if (a < ALPHA_CUTOFF) {
        outData[p] = 0;
        outData[p + 1] = 0;
        outData[p + 2] = 0;
        outData[p + 3] = 0;
        continue;
      }
      const [r, g, b] = paletteSample(sampled);
      outData[p] = r;
      outData[p + 1] = g;
      outData[p + 2] = b;
      outData[p + 3] = Math.round(sampled * a * 255);
    }
  }
}
