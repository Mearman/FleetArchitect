import {
  INTENSITY_DRAW_THRESHOLD,
  fxGainFor,
  glowEdgeFade,
  mediumCellIntensity,
  paletteSample,
  readFxLevel,
  resolveMediumField,
} from "./mediumShared";
import type { MediumSnapshot } from "@/schema/battle";
import type { OverlayCtx, OverlayDef } from "./types";

// ---------------------------------------------------------------------------
// Arena medium field: broad ambient ionisation / plume glow (smooth field)
// ---------------------------------------------------------------------------
//
// Paints the BROAD ambient field as a smooth, continuous ionised haze: the ε
// field (with the ρ amplifier) is rasterised into a cell-resolution offscreen
// buffer — one texel per cell — then blitted scaled-to-world with image
// smoothing and additive blending. Bilinear interpolation between cell samples
// turns the lattice into a continuous glow, so it reads as ionised gas rather
// than a grid of discrete discs (the artifact a per-cell radial-gradient
// approach produced, since every bright core sat on a fixed lattice point). It
// is the coarse complement to `mediumTrails.ts`, which draws the sharp analytic
// per-entity streaks. Both overlays share their palette, FX gating, field
// resolution, and brightness mapping via `./mediumShared`, so the two views
// stay visually consistent (denser medium = brighter, identically, in both).
// Drawn beneath the ship layer so hull silhouettes sit on top of the glow.
//
// The physical model, the cell <-> world mapping, the brightness formula, and
// the tuning rationale for the named constants are all documented in
// `./mediumShared.ts` (the single source of truth shared by both medium
// overlays). Refer there for why ε drives, ρ amplifies, and the magnitudes.

// ---------------------------------------------------------------------------
// Cell-resolution glow buffer (cached rendering resource)
// ---------------------------------------------------------------------------
//
// One texel per medium cell. The pixels are written with putImageData (a raw
// pixel write that ignores transform and composite), then blitted with a single
// smoothed, additive drawImage. Cached at module scope — a rendering resource
// like the ship sprite cache — and recreated only when the grid dimensions
// change between battles (the medium lattice shape is constant within a battle).
//
// The RASTERISATION (the ~20k-cell scan + putImageData) is itself cached on the
// resolved field's identity: resolveMediumField returns the same MediumSnapshot
// object reference for every tick at-or-before a given medium emission tick, so
// between emissions (and on byte-identical fractional-tick scrubs) the scan is a
// pure function of a value that did not change. We skip it on cache hit and just
// re-blit the existing pixels through the current camera transform. The FX gain
// is part of the cache key because toggling the FX level re-colours every cell
// without the field changing; the camera is not (it only affects the blit, never
// the rasterised texels).

/** Cached offscreen glow buffer: its canvas, writable pixels, and the
 *  (field, fxGain) the pixels were last rasterised for. The raster slots are
 *  `undefined` after (re)creation until the first rasterisation writes them. */
type GlowBuffer = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imageData: ImageData;
  rasterField: MediumSnapshot | undefined;
  rasterFxGain: number | undefined;
};

let glowBuffer: GlowBuffer | undefined;

/** Key (widthM x heightM) of the currently cached buffer, "" when none. */
let glowBufferKey = "";

/**
 * Return the glow buffer for the given grid, (re)creating it when the grid
 * dimensions change. A freshly (re)created buffer has empty raster slots, so the
 * next draw always rasterises once before blitting. Returns undefined only if a
 * 2D context cannot be obtained (never in a browser), in which case the overlay
 * draws nothing this frame.
 */
function ensureGlowBuffer(widthM: number, heightM: number): GlowBuffer | undefined {
  const key = `${widthM}x${heightM}`;
  if (glowBuffer !== undefined && key === glowBufferKey) return glowBuffer;
  const canvas = document.createElement("canvas");
  canvas.width = widthM;
  canvas.height = heightM;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return undefined;
  glowBuffer = {
    canvas,
    ctx,
    imageData: ctx.createImageData(widthM, heightM),
    rasterField: undefined,
    rasterFxGain: undefined,
  };
  glowBufferKey = key;
  return glowBuffer;
}

/**
 * Medium-field glow: additive ionisation glow beneath the ship layer. For each
 * cell whose ε-driven, ρ-amplified intensity clears a small threshold, the
 * buffer texel is coloured by the hot palette at an alpha equal to its
 * intensity; the buffer is then blitted smoothed and additively over the
 * backdrop, so bright regions stack into a continuous ionised haze rather than
 * a grid of circles. Denser ρ amplifies the glow (nebula-amplification);
 * ε ≈ 0 cells are skipped (undisturbed space stays dark).
 */
function drawMediumGlow(c: OverlayCtx): void {
  const { ctx, t } = c;

  // FX level: `off` → nothing. `reduced` → dimmer gain.
  const fx = readFxLevel();
  if (fx === "off") return;
  const fxGain = fxGainFor(fx);

  // Resolve the field for this tick from the frame history: the most recent
  // emission at-or-before the current tick (deterministic, scrub-safe).
  const field = resolveMediumField(c.frames, c.tick);
  if (field === undefined) return; // no medium has ever been seen

  const { rho, eps, epsVis, widthM, heightM, pitchM } = field;
  // Prefer epsVis (velocity-advected, streams) for the glow; fall back to eps
  // for old snapshots that don't carry epsVis.
  const glowEps = epsVis ?? eps;
  const cellCount = widthM * heightM;
  if (rho.length < cellCount || glowEps.length < cellCount) return;
  const buf = ensureGlowBuffer(widthM, heightM);
  if (buf === undefined) return;

  // Rasterise only when the resolved field reference or FX gain changed since
  // the last draw. resolveMediumField returns the same MediumSnapshot object for
  // every tick at-or-before a given emission tick, so on the interpolated ticks
  // between emissions (and on byte-identical fractional-tick scrubs) this cache
  // hits and the ~20k-cell scan is skipped — the buffer canvas already holds the
  // correct pixels, so below we just re-blit it through the current transform.
  // The camera is deliberately not part of the key: it only affects the blit,
  // never the rasterised texels.
  if (buf.rasterField !== field || buf.rasterFxGain !== fxGain) {
    // Rasterise: one texel per cell. Straight alpha = intensity; the additive
    // ("lighter") blit contributes colour × intensity per cell, and the
    // smoothing spreads each sample into a continuous field.
    const data = buf.imageData.data;
    for (let i = 0; i < cellCount; i += 1) {
      const epsHere = glowEps[i];
      const p = i * 4;
      if (epsHere === undefined || epsHere <= 0) {
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
        continue;
      }
      const rhoHere = rho[i] ?? 0;
      // ε-driven, ρ-amplified, tone-mapped brightness (see mediumShared), faded
      // to zero at the grid edge so the glow doesn't hard-clip on the buffer's
      // rectangle (a straight border through the battle).
      const col = i % widthM;
      const row = Math.floor(i / widthM);
      const intensity =
        mediumCellIntensity(epsHere, rhoHere, fxGain) *
        glowEdgeFade(col, row, widthM, heightM);
      if (intensity < INTENSITY_DRAW_THRESHOLD) {
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
        continue;
      }
      const [r, g, b] = paletteSample(intensity);
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = Math.round(intensity * 255);
    }
    buf.ctx.putImageData(buf.imageData, 0, 0);
    buf.rasterField = field;
    buf.rasterFxGain = fxGain;
  }

  // Blit the buffer aligned to the grid's world rectangle. The view transform
  // is affine (flat or isometric), so three projected corners fix the mapping;
  // ctx.transform composes with the DPR scale already on the context, so the
  // buffer lands in the same CSS-pixel space as the rest of the frame. The grid
  // is centred on the world origin (see the cell<->world docs in mediumShared).
  const p0 = t.project((-widthM / 2) * pitchM, (-heightM / 2) * pitchM);
  const px = t.project((widthM / 2) * pitchM, (-heightM / 2) * pitchM);
  const py = t.project((-widthM / 2) * pitchM, (heightM / 2) * pitchM);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = "lighter"; // additive: glow brightens space
  ctx.transform(
    (px.x - p0.x) / widthM,
    (px.y - p0.y) / widthM,
    (py.x - p0.x) / heightM,
    (py.y - p0.y) / heightM,
    p0.x,
    p0.y,
  );
  ctx.drawImage(buf.canvas, 0, 0);
  ctx.restore();
}

/** Overlay definition: arena medium-field glow (plumes, beam channels, wakes),
 *  drawn beneath the ship layer. */
export const mediumGlow: OverlayDef = {
  id: "medium-glow",
  label: "Medium glow (plumes / ionisation)",
  defaultOn: true,
  defaultScope: "all",
  draw: drawMediumGlow,
};
