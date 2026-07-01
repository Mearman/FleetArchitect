import { fxGainFor, paletteSample, readFxLevel } from "./mediumShared";
import type { BattleFrame, ParticleSnapshot } from "@/schema/battle";
import type { OverlayCtx, OverlayDef } from "./types";

// ---------------------------------------------------------------------------
// Weapon-source particle glow: the visible transferred material
// ---------------------------------------------------------------------------
//
// Draws the live exhaust/plume particles the deterministic engine ticks into
// BattleFrame.particles — engine exhaust streams, beam ionisation channels,
// projectile wakes, and impact ejecta. Each particle is real moving material
// that radiates as it cools, so the glow reads as emerging from the weapons
// (a stream leaving a thrusting engine, a flash at a strike point) rather than
// a field layered on top. Where the particles actually are is what shines.
//
// Every on-screen particle above PARTICLE_DRAW_THRESHOLD is drawn — no density
// thinning. (A prior revision added content-adaptive "foveated" thinning,
// keyed on per-cell energy variance normalised against the frame's max, to
// bound per-particle draw cost; it was removed because sparse-but-structural
// sources — beam channels, thruster exhaust — emit only ~1 particle per screen
// grid-cell, so they have no redundant overlap to survive 85% thinning and
// rendered as disconnected dots instead of a continuous line/trail. The
// prerendered sprite atlas below (glowAtlasSprites) already makes per-particle
// draw cost a cheap drawImage blit, so thinning bought little at a real
// correctness cost. If a future extreme-scale battle needs a render-cost
// lever, use the FX-level LOW/OFF toggle (mediumShared.readFxLevel/
// fxGainFor), not a per-overlay density heuristic.)
//
// Drawn beneath the ship layer so hulls sit on top of their own exhaust.

/** Display radius of a particle's glow blob, pixels at full intensity. Scales
 *  down with intensity so a cooling parcel shrinks as it dims. */
const PARTICLE_RADIUS_PX = 7;

/** Particles dimmer than this are skipped, bounding the paint count. */
const PARTICLE_DRAW_THRESHOLD = 0.02;

/**
 * Resolve the live particle set for `tick` from the discrete frame history: the
 * most recent emission at-or-before this tick. Particles are subsampled in the
 * snapshot (every RESOURCE_EVERY ticks) so a long battle does not exhaust the
 * heap, and the renderer holds the most recent emission between subsamples (as
 * the medium overlay does) so the glow stays continuous. Pure function of
 * (frames, tick) — deterministic, scrub-safe in both directions.
 */
function resolveParticles(
  frames: readonly BattleFrame[],
  tick: number,
): ParticleSnapshot[] | undefined {
  const start = Math.min(Math.max(0, Math.floor(tick)), frames.length - 1);
  for (let i = start; i >= 0; i -= 1) {
    const f = frames[i];
    if (f === undefined) continue;
    if (f.particles !== undefined && f.particles.length > 0) return f.particles;
  }
  return undefined;
}

/**
 * Particle glow: one additive glow blot per live particle, coloured by the
 * shared hot palette at its (FX-scaled) intensity and sized by it, so a fresh
 * parcel reads bright and large and a cooling one dim and small. Drawn via a
 * prerendered sprite atlas (see glowAtlasSprites) rather than a fresh
 * createRadialGradient per particle.
 */
/** Number of prerendered glow sprites (intensity buckets). 16 gives ~6% steps —
 *  imperceptible on an additive glow blob. */
const ATLAS_BUCKETS = 16;
/** Sprite canvas diameter (the max particle glow diameter in pixels). */
const ATLAS_DIAMETER = Math.ceil(PARTICLE_RADIUS_PX * 2);
/** Lazily-initialised prerendered glow atlas: one sprite per intensity bucket,
 *  each a radial gradient with the palette colour and alpha profile baked in.
 *  Eliminates per-particle createRadialGradient + string-built addColorStop. */
let glowAtlas: readonly HTMLCanvasElement[] | null = null;

function glowAtlasSprites(): readonly HTMLCanvasElement[] | null {
  if (glowAtlas !== null) return glowAtlas;
  const sprites: HTMLCanvasElement[] = [];
  const half = ATLAS_DIAMETER / 2;
  for (let i = 0; i < ATLAS_BUCKETS; i += 1) {
    const intensity = i / (ATLAS_BUCKETS - 1);
    const [r, g, b] = paletteSample(intensity);
    const alphaCore = Math.min(1, intensity * 1.2);
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_DIAMETER;
    canvas.height = ATLAS_DIAMETER;
    const actx = canvas.getContext("2d");
    if (actx === null) return null;
    const grad = actx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${alphaCore})`);
    grad.addColorStop(0.5, `rgba(${r | 0},${g | 0},${b | 0},${intensity * 0.4})`);
    grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    actx.fillStyle = grad;
    actx.fillRect(0, 0, ATLAS_DIAMETER, ATLAS_DIAMETER);
    sprites.push(canvas);
  }
  glowAtlas = sprites;
  return glowAtlas;
}

function drawParticleGlow(c: OverlayCtx): void {
  const { ctx, t, tick, frames } = c;

  const fx = readFxLevel();
  if (fx === "off") return;
  const fxGain = fxGainFor(fx);

  // Particles are subsampled in the snapshot (every RESOURCE_EVERY ticks); the
  // interpolated `frame` also strips them on half-ticks. Resolve the nearest
  // emission so the glow renders every rAF without flicker.
  const particles = resolveParticles(frames, tick);
  if (particles === undefined || particles.length === 0) return;

  const width = t.width;
  const height = t.height;
  const atlas = glowAtlasSprites();

  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive: glow brightens space

  const screen = { x: 0, y: 0 };
  for (const p of particles) {
    const intensity = Math.max(0, Math.min(1, p.intensity * fxGain));
    if (intensity < PARTICLE_DRAW_THRESHOLD) continue;
    t.projectInto(screen, p.x, p.y);
    const sx = screen.x;
    const sy = screen.y;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

    const radius = PARTICLE_RADIUS_PX * (0.4 + 0.6 * intensity);
    // Blit the nearest-bucket sprite (drawImage is far cheaper than
    // createRadialGradient + 3 addColorStop + arc/fill per particle).
    const bucket = Math.min(ATLAS_BUCKETS - 1, Math.round(intensity * (ATLAS_BUCKETS - 1)));
    const bucketIntensity = bucket / (ATLAS_BUCKETS - 1);
    const sprite = atlas === null ? undefined : atlas[bucket];
    if (sprite === undefined) continue;
    ctx.globalAlpha = bucketIntensity > 0 ? Math.min(1, intensity / bucketIntensity) : 0;
    ctx.drawImage(sprite, sx - radius, sy - radius, radius * 2, radius * 2);
  }

  ctx.restore();
}

/** Overlay definition: weapon-source particle glow (exhaust, plumes, channels,
 *  impacts), drawn beneath the ship layer. On by default so strikes and exhaust
 *  are visible — the broad medium glow is too coarse (500 m/cell) to resolve
 *  them. FX-gated (off/reduced/full); the live set is capped
 *  (MAX_LIVE_PARTICLES) and each particle draws via a cheap prerendered-sprite
 *  blit (see glowAtlasSprites), so per-frame cost stays bounded without density
 *  thinning. */
export const particleGlow: OverlayDef = {
  id: "particle-glow",
  label: "Weapon particles (exhaust / plumes / impacts)",
  defaultOn: true,
  defaultScope: "all",
  draw: drawParticleGlow,
};
