import {
  fxGainFor,
  paletteSample,
  particleCellBrightness,
  readFxLevel,
  resolveMediumFrame,
  resolveParticlesFrame,
  sampleMediumRho,
} from "./mediumShared";
import {
  computeParticleBridges,
  particleRenderState,
  smoothstep,
  type ParticleBridge,
  type ParticleRenderState,
} from "./particleDynamics";
import {
  blurGridInPlace,
  computeIntensityGrid,
  emissionCrossfadeAlpha,
  supersampleToRgba,
} from "./fieldRaster";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import type { BattleFrame, MediumSnapshot, ParticleSnapshot } from "@/schema/battle";
import type { OverlayCtx, OverlayDef } from "./types";
import { drawPlumeStreaks } from "./plumeStreaks";

// ---------------------------------------------------------------------------
// Battlefield glow: the ONE overlay over the medium field
// ---------------------------------------------------------------------------
//
// A single overlay composes the two representations of the one physical
// substance — the Eulerian coarse field (broad ambient ionisation) and the
// Lagrangian particles (engine exhaust, beam channels, wakes, impact ejecta) —
// into one glow pass. Both share the ONE brightness truth
// (`mediumCellIntensity` on effective eps + the local density amplifier), so a
// field cell and a particle of the same energy read identically; there is no
// separate self-luminous render path and no analytic streak bolt-on. Drawn
// beneath the ship layer so hulls sit on top of their own glow.
//
// The field is rasterised into a cached offscreen buffer through the pure
// pipeline in `./fieldRaster.ts`: per-cell intensity (the ONE brightness truth)
// is binomially blurred (so the one-texel-per-cell grid no longer reads as a
// lattice) then supersampled and bilinearly blitted additively, so cell edges
// disappear into a continuous haze; the particles are blitted as prerendered
// additive sprites. The two compose additively in the same pass. The physical
// model, cell↔world mapping, brightness formula, and tuning constants live in
// `./mediumShared.ts`.

// ---------------------------------------------------------------------------
// Field glow buffer (supersampled, cached on field identity)
// ---------------------------------------------------------------------------

/** Supersamples the field raster before the bilinear canvas blit so cell edges
 *  disappear instead of showing as a lattice. The backing buffer is allocated
 *  at `widthM * FIELD_SUPERSAMPLE` × `heightM * FIELD_SUPERSAMPLE` texels, then
 *  drawn scaled into the field's cell-space rectangle so the world mapping is
 *  independent of the buffer's pixel dimensions. */
const FIELD_SUPERSAMPLE = 2;

type GlowBuffer = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imageData: ImageData;
  /** Pooled per-cell intensity grid (widthM * heightM), written by
   *  computeIntensityGrid then blurred in place. Reused across emissions. */
  intensity: Float32Array;
  /** Pooled scratch for the separable blur pass (widthM * heightM). */
  blurScratch: Float32Array;
  rasterField: MediumSnapshot | undefined;
  rasterFxGain: number | undefined;
};

/** One cached raster slot: a supersampled offscreen buffer plus the
 *  `${widthM}x${heightM}` key it was allocated for. Two slots are held —
 *  `currSlot` for the most-recent emission and `prevSlot` for the one before —
 *  so the field can be CROSS-FADED between consecutive emissions instead of
 *  stepping every RESOURCE_EVERY ticks. Each slot caches its rasterisation on
 *  the field reference + FX gain independently, the same identity-keyed caching
 *  discipline the single-buffer version used. */
type GlowSlot = { buffer: GlowBuffer | undefined; key: string };

const currSlot: GlowSlot = { buffer: undefined, key: "" };
const prevSlot: GlowSlot = { buffer: undefined, key: "" };

function ensureGlowBuffer(
  widthM: number,
  heightM: number,
  slot: GlowSlot,
): GlowBuffer | undefined {
  const key = `${widthM}x${heightM}`;
  if (slot.buffer !== undefined && key === slot.key) return slot.buffer;
  const cellCount = widthM * heightM;
  const canvasW = widthM * FIELD_SUPERSAMPLE;
  const canvasH = heightM * FIELD_SUPERSAMPLE;
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return undefined;
  slot.buffer = {
    canvas,
    ctx,
    imageData: ctx.createImageData(canvasW, canvasH),
    intensity: new Float32Array(cellCount),
    blurScratch: new Float32Array(cellCount),
    rasterField: undefined,
    rasterFxGain: undefined,
  };
  slot.key = key;
  return slot.buffer;
}

/** Rasterise `field` through the pure fieldRaster pipeline (per-cell intensity
 *  -> binomial blur -> supersample) into `buf`, reusing the cached raster when
 *  the field reference + FX gain are unchanged (the field is constant between
 *  emissions, so the ~20k-cell scan runs once per emission, not per rAF). Shared
 *  by the current and previous emission slots so the pipeline is not duplicated
 *  inline twice. */
function rasteriseField(
  field: MediumSnapshot,
  fxGain: number,
  buf: GlowBuffer,
  widthM: number,
  heightM: number,
): void {
  if (buf.rasterField !== field || buf.rasterFxGain !== fxGain) {
    computeIntensityGrid(field, fxGain, buf.intensity);
    blurGridInPlace(buf.intensity, widthM, heightM, buf.blurScratch);
    supersampleToRgba(
      buf.intensity,
      widthM,
      heightM,
      FIELD_SUPERSAMPLE,
      buf.canvas.width,
      buf.canvas.height,
      buf.imageData.data,
    );
    buf.ctx.putImageData(buf.imageData, 0, 0);
    buf.rasterField = field;
    buf.rasterFxGain = fxGain;
  }
}

/** Rasterise the field through the pure fieldRaster pipeline into the cached
 *  buffer and blit it additively aligned to the grid's world rectangle. To avoid
 *  the field visibly STEPPING every RESOURCE_EVERY ticks (the engine emits
 *  `medium` only on those ticks), the blit CROSS-FADES between the previous and
 *  current emission buffers: at the moment a new emission lands the overlay
 *  still looks exactly like the previous one (alpha 0 on the new buffer), then
 *  ramps linearly to the new one over the span until the NEXT emission, when the
 *  roles swap. The fade factor is {@link emissionCrossfadeAlpha}, a pure function
 *  of `(tickF, currentTick, previousTick)`, so this stays scrub-safe (no
 *  last-seen state — everything is re-derived from the frame history each call,
 *  exactly like `resolveMediumFrame`). Rasterisation is cached on the resolved
 *  field reference + FX gain per slot, so the ~20k-cell scan runs once per
 *  emission, not per rAF. When the two emissions' grids differ in shape (arena
 *  bounds changed between them) the cross-fade is skipped and only the current
 *  buffer draws, rather than cross-fading non-aligned buffers. */
function drawFieldGlow(
  c: OverlayCtx,
  field: MediumSnapshot,
  currentTick: number,
  prevFrame: BattleFrame | undefined,
  fxGain: number,
): void {
  const { ctx, t } = c;
  const { widthM, heightM, pitchM } = field;
  const cellCount = widthM * heightM;
  const glowEps = field.epsVis ?? field.eps;
  if (field.rho.length < cellCount || glowEps.length < cellCount) return;

  const prevField = prevFrame?.medium;
  const prevTick = prevFrame?.tick;
  // Cross-fade only when the previous emission's grid is the same shape (arena
  // bounds unchanged between the two emissions); mismatched grids fall back to
  // current-only rather than cross-fading non-aligned buffers.
  const canCrossfade =
    prevField !== undefined &&
    prevTick !== undefined &&
    prevField.widthM === widthM &&
    prevField.heightM === heightM;
  const f = canCrossfade
    ? emissionCrossfadeAlpha(c.tickF, currentTick, prevTick)
    : 1;

  const currBuf = ensureGlowBuffer(widthM, heightM, currSlot);
  if (currBuf === undefined) return;
  rasteriseField(field, fxGain, currBuf, widthM, heightM);

  // Resolve and rasterise the previous-emission buffer only while it actually
  // contributes (f < 1); at f === 1 the current buffer is drawn alone, so there
  // is no previous rasterisation or draw call to make.
  let prevBuf: GlowBuffer | undefined = undefined;
  if (canCrossfade && f < 1 && prevField !== undefined) {
    prevBuf = ensureGlowBuffer(widthM, heightM, prevSlot);
    if (prevBuf !== undefined) {
      rasteriseField(prevField, fxGain, prevBuf, widthM, heightM);
    }
  }

  const p0 = t.project((-widthM / 2) * pitchM, (-heightM / 2) * pitchM);
  const px = t.project((widthM / 2) * pitchM, (-heightM / 2) * pitchM);
  const py = t.project((-widthM / 2) * pitchM, (heightM / 2) * pitchM);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = "lighter";
  ctx.transform(
    (px.x - p0.x) / widthM,
    (px.y - p0.y) / widthM,
    (py.x - p0.x) / heightM,
    (py.y - p0.y) / heightM,
    p0.x,
    p0.y,
  );
  // Draw the previous buffer (fading out) then the current one (fading in),
  // both under "lighter" so the cross-fade is an additive blend, both scaled
  // into the same cell-space rect [0,widthM]x[0,heightM] (the transform above
  // maps it onto the world rectangle). At f === 0 the current buffer draws at
  // alpha 0 (a no-op) so the field looks exactly like the previous emission; at
  // f === 1 the previous buffer is skipped. globalAlpha is scoped by the
  // save/restore so it never leaks into later overlays this frame.
  if (prevBuf !== undefined && f < 1) {
    ctx.globalAlpha = 1 - f;
    ctx.drawImage(prevBuf.canvas, 0, 0, widthM, heightM);
  }
  ctx.globalAlpha = f;
  ctx.drawImage(currBuf.canvas, 0, 0, widthM, heightM);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Particle sprite atlas (prerendered, bucketed by intensity)
// ---------------------------------------------------------------------------

const PARTICLE_RADIUS_PX = 7;
const PARTICLE_DRAW_THRESHOLD = 0.02;
const ATLAS_BUCKETS = 16;
const ATLAS_DIAMETER = Math.ceil(PARTICLE_RADIUS_PX * 2);
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

// ---------------------------------------------------------------------------
// Particle paint helpers (shared by the splat, streak, and bridge paths)
// ---------------------------------------------------------------------------

/** Resolved atlas paint for one display intensity: the prerendered sprite, its
 *  draw radius, and the alpha that folds the bucket-quantised intensity back to
 *  the true value. {@link resolvePaint} writes into a caller-owned scratch so
 *  the hot particle loop allocates nothing per particle. */
interface ParticlePaint {
  radius: number;
  sprite: HTMLCanvasElement | undefined;
  alpha: number;
}
const paintScratch: ParticlePaint = { radius: 0, sprite: undefined, alpha: 0 };

/** Resolve the prerendered atlas sprite, radius, and draw alpha for a display
 *  intensity into the shared {@link paintScratch}, returning whether a sprite
 *  resolved (the caller skips the draw when it does not). The radius, bucket,
 *  and alpha formula is the ONE paint recipe shared by the round splat, the
 *  velocity streak, and the wake bridge so they all read identically. */
function resolvePaint(
  dispI: number,
  atlas: readonly HTMLCanvasElement[] | null,
): boolean {
  const radius = PARTICLE_RADIUS_PX * (0.4 + 0.6 * dispI);
  const bucket = Math.min(
    ATLAS_BUCKETS - 1,
    Math.round(dispI * (ATLAS_BUCKETS - 1)),
  );
  const bucketIntensity = bucket / (ATLAS_BUCKETS - 1);
  const sprite = atlas === null ? undefined : atlas[bucket];
  if (sprite === undefined) return false;
  paintScratch.radius = radius;
  paintScratch.sprite = sprite;
  paintScratch.alpha = bucketIntensity > 0 ? Math.min(1, dispI / bucketIntensity) : 0;
  return true;
}

/** Draw the prerendered particle sprite stretched lengthwise along the screen
 *  segment from `(ax,ay)` to `(bx,by)`, keeping its perpendicular (across-travel)
 *  width at `halfWidth` on each side (total span `len + 2*halfWidth` along the
 *  segment, `2*halfWidth` across). Used both for velocity streaks (the segment
 *  is one tick of travel) and for wake bridges (the segment joins two beads).
 *  `save`/`restore` isolates the rotation so it never leaks into the next draw. */
function drawStretchedSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfWidth: number,
): void {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const len = Math.hypot(bx - ax, by - ay);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(Math.atan2(by - ay, bx - ax));
  ctx.drawImage(
    sprite,
    -(len / 2 + halfWidth),
    -halfWidth,
    len + 2 * halfWidth,
    2 * halfWidth,
  );
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Wake-bridge cache (one bridge set per particle emission, on array identity)
// ---------------------------------------------------------------------------

// Bridges depend only on the particle set, which is constant between emissions
// (a fresh array arrives each emission tick), so they are computed once per
// emission and reused across the rAF frames that fall inside it — the same
// identity-keyed cache idiom `ensureGlowBuffer` uses for the field raster.
let bridgeCacheParticles: ParticleSnapshot[] | undefined = undefined;
let bridgeCacheBridges: ParticleBridge[] = [];

/** Resolve the bridges for a particle set, recomputing only when the array
 *  reference changes (once per emission), not per rAF frame. */
function resolveBridges(particles: ParticleSnapshot[]): ParticleBridge[] {
  if (particles === bridgeCacheParticles) return bridgeCacheBridges;
  bridgeCacheParticles = particles;
  bridgeCacheBridges = computeParticleBridges(particles);
  return bridgeCacheBridges;
}

/** Splat, streak, or bridge each live particle as a prerendered additive sprite,
 *  brightened by the ONE shared tone-map on its effective eps + the local
 *  density. Each particle is advanced in closed form from its emission tick to
 *  the current fractional display tick (tickF) so position and cooling are
 *  continuous across the snapshot stride instead of stepping; a ramp-in alpha
 *  avoids pop-in and a smoothstep fade knee replaces the old hard cutoff.
 *
 *  A particle with real velocity (engine exhaust, impact ejecta) draws a STREAK:
 *  the sprite stretched along its screen-space travel over the last tick, so
 *  consecutive ticks meet end-to-end into a continuous ribbon. A near-stationary
 *  particle (sub-pixel travel — true-zero wake/beam parcels, or slow exhaust
 *  drift) draws the round splat. Stationary wake/beam beads are additionally
 *  linked into bridges (one stretched sprite between consecutive beads of the
 *  same emission) so a moving round's stationary wake chain reads as a
 *  continuous trail instead of evenly-spaced dots; a bridged bead skips its own
 *  splat so its glow is carried by the bridge, not double-painted. */
function drawParticleGlow(
  c: OverlayCtx,
  particles: ParticleSnapshot[],
  field: MediumSnapshot | undefined,
  fxGain: number,
  dtSinceS: number,
): void {
  const { ctx, t } = c;
  const width = t.width;
  const height = t.height;
  const atlas = glowAtlasSprites();

  // One reused scratch per call, allocated once outside the loops (no
  // per-particle allocation), matching the pooling convention used throughout
  // useBattleCanvas.ts. `screen`/`trail` carry a particle's current and
  // one-tick-earlier screen positions; `scratch`/`scratchB` carry two advanced
  // render states (both endpoints of a bridge at once); `screenA`/`screenB`
  // carry a bridge's two projected endpoints.
  const screen = { x: 0, y: 0 };
  const trail = { x: 0, y: 0 };
  const screenA = { x: 0, y: 0 };
  const screenB = { x: 0, y: 0 };
  const scratch: ParticleRenderState = { x: 0, y: 0, energyJ: 0, ageS: 0, rampAlpha: 0 };
  const scratchB: ParticleRenderState = { x: 0, y: 0, energyJ: 0, ageS: 0, rampAlpha: 0 };

  // Bridges link stationary wake/beam beads; the bridged-endpoint set tells the
  // splat/streak pass to skip a bead whose glow is carried by a bridge.
  const bridges = resolveBridges(particles);
  const bridged = new Set<number>();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Bridges first: each draws one stretched sprite between its two endpoints'
  // advanced positions at their mean display brightness, and claims both
  // endpoints so the splat/streak pass does not double-paint a bright dot at
  // either end.
  for (const bridge of bridges) {
    const pFrom = particles[bridge.fromIndex];
    const pTo = particles[bridge.toIndex];
    if (pFrom === undefined || pTo === undefined) continue;
    if (!particleRenderState(pFrom, dtSinceS, scratch)) continue;
    if (!particleRenderState(pTo, dtSinceS, scratchB)) continue;
    t.projectInto(screenA, scratch.x, scratch.y);
    t.projectInto(screenB, scratchB.x, scratchB.y);
    // Coarse off-screen cull of the whole segment (with a radius margin).
    const minX = Math.min(screenA.x, screenB.x) - PARTICLE_RADIUS_PX;
    const maxX = Math.max(screenA.x, screenB.x) + PARTICLE_RADIUS_PX;
    const minY = Math.min(screenA.y, screenB.y) - PARTICLE_RADIUS_PX;
    const maxY = Math.max(screenA.y, screenB.y) + PARTICLE_RADIUS_PX;
    if (maxX < 0 || minX >= width || maxY < 0 || minY >= height) continue;
    // Mean brightness across the two endpoints, sampling rho at the world
    // midpoint of the bridge. The projection is affine, so the world midpoint
    // maps to the segment's screen-space midpoint.
    const midX = (scratch.x + scratchB.x) / 2;
    const midY = (scratch.y + scratchB.y) / 2;
    const rho = field === undefined ? 0 : sampleMediumRho(field, midX, midY);
    const baseIFrom = Math.max(
      0,
      Math.min(1, particleCellBrightness(scratch.energyJ, rho, fxGain)),
    );
    const baseITo = Math.max(
      0,
      Math.min(1, particleCellBrightness(scratchB.energyJ, rho, fxGain)),
    );
    if (baseIFrom < PARTICLE_DRAW_THRESHOLD * 0.1 && baseITo < PARTICLE_DRAW_THRESHOLD * 0.1)
      continue;
    const fadeFrom = smoothstep(
      PARTICLE_DRAW_THRESHOLD,
      PARTICLE_DRAW_THRESHOLD * 2,
      baseIFrom,
    );
    const fadeTo = smoothstep(PARTICLE_DRAW_THRESHOLD, PARTICLE_DRAW_THRESHOLD * 2, baseITo);
    const dispIFrom = baseIFrom * scratch.rampAlpha * fadeFrom;
    const dispITo = baseITo * scratchB.rampAlpha * fadeTo;
    const dispI = (dispIFrom + dispITo) / 2;
    if (dispI <= 0) continue;
    if (!resolvePaint(dispI, atlas)) continue;
    const sprite = paintScratch.sprite;
    if (sprite === undefined) continue;
    ctx.globalAlpha = paintScratch.alpha;
    drawStretchedSprite(
      ctx,
      sprite,
      screenA.x,
      screenA.y,
      screenB.x,
      screenB.y,
      paintScratch.radius,
    );
    bridged.add(bridge.fromIndex);
    bridged.add(bridge.toIndex);
  }

  // Splat or streak pass for every particle not already carried by a bridge.
  for (let i = 0; i < particles.length; i += 1) {
    if (bridged.has(i)) continue;
    const p = particles[i];
    if (p === undefined) continue;
    // Advance the closed-form physics from the emission tick to now; skip if the
    // particle is past its lifetime (engine cull signal).
    if (!particleRenderState(p, dtSinceS, scratch)) continue;
    t.projectInto(screen, scratch.x, scratch.y);
    const sx = screen.x;
    const sy = screen.y;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
    const rho = field === undefined ? 0 : sampleMediumRho(field, scratch.x, scratch.y);
    const baseI = Math.max(
      0,
      Math.min(1, particleCellBrightness(scratch.energyJ, rho, fxGain)),
    );
    // Early-continue on genuinely negligible base brightness (a cooled-out
    // particle) so no draw call is wasted, then fade smoothly across a knee at
    // the old hard cutoff so particles near the threshold fade rather than pop.
    if (baseI < PARTICLE_DRAW_THRESHOLD * 0.1) continue;
    const fade = smoothstep(PARTICLE_DRAW_THRESHOLD, PARTICLE_DRAW_THRESHOLD * 2, baseI);
    // rampAlpha ramps the particle in over its first display tick; fade eases
    // the low-brightness knee. Both fold into the final display intensity that
    // drives radius, sprite bucket, and draw alpha via the shared paint recipe.
    const dispI = baseI * scratch.rampAlpha * fade;
    if (!resolvePaint(dispI, atlas)) continue;
    const sprite = paintScratch.sprite;
    if (sprite === undefined) continue;
    ctx.globalAlpha = paintScratch.alpha;
    // Velocity-elongated streak vs round splat: project the position one tick
    // earlier through the SAME transform. If the two are a sub-pixel apart
    // (near-stationary drift, or a true-zero wake/beam parcel) splat the round
    // sprite unchanged; otherwise stretch the sprite lengthwise along the
    // travel so consecutive ticks of the same parcel meet end-to-end.
    t.projectInto(
      trail,
      scratch.x - p.vx / TICKS_PER_SECOND,
      scratch.y - p.vy / TICKS_PER_SECOND,
    );
    const dx = sx - trail.x;
    const dy = sy - trail.y;
    if (dx * dx + dy * dy < 1) {
      ctx.drawImage(
        sprite,
        sx - paintScratch.radius,
        sy - paintScratch.radius,
        paintScratch.radius * 2,
        paintScratch.radius * 2,
      );
    } else {
      drawStretchedSprite(ctx, sprite, trail.x, trail.y, sx, sy, paintScratch.radius);
    }
  }
  ctx.restore();
}

/**
 * The battlefield glow overlay: the medium field's ambient ionisation blitted
 * additively, then the live particles splatted on top, both through the one
 * shared brightness truth. FX-gated (off/reduced/full); drawn beneath the hulls.
 */
function drawBattleGlow(c: OverlayCtx): void {
  const fx = readFxLevel();
  if (fx === "off") return;
  const fxGain = fxGainFor(fx);
  // Resolve the emission frames (the nearest AT-OR-BEFORE tick carrying each
  // substrate) rather than bare fields, so the particle path can read the actual
  // emission tick to advance sub-tick physics between snapshots.
  const mediumFrame = resolveMediumFrame(c.frames, c.tick);
  const particlesFrame = resolveParticlesFrame(c.frames, c.tick);
  const field = mediumFrame === undefined ? undefined : mediumFrame.medium;
  const particles = particlesFrame === undefined ? undefined : particlesFrame.particles;
  if (field === undefined && (particles === undefined || particles.length === 0)) return;
  if (mediumFrame !== undefined && field !== undefined) {
    // Resolve the emission strictly before the current one (walks backward from
    // currentTick - 1) so the field can cross-fade between consecutive emissions
    // instead of stepping every RESOURCE_EVERY ticks. Returns undefined when the
    // current emission is the very first (tick 0), in which case the cross-fade
    // falls back to current-only.
    const prevFrame = resolveMediumFrame(c.frames, mediumFrame.tick - 1);
    drawFieldGlow(c, field, mediumFrame.tick, prevFrame, fxGain);
    // Continuous ε-sampled plume ribbons for in-flight projectiles, layered
    // over the field glow and under the particle texture — fills the gaps
    // between wake beads so a fast round's trail reads continuous, not beaded.
    drawPlumeStreaks(c, field, fxGain);
  }
  // dtSinceS is always >= 0: particlesFrame.tick <= floor(tickF) because the
  // resolver walks backward from the current tick for the nearest emission.
  if (particlesFrame !== undefined && particles !== undefined && particles.length > 0) {
    const dtSinceS = (c.tickF - particlesFrame.tick) / TICKS_PER_SECOND;
    drawParticleGlow(c, particles, field, fxGain, dtSinceS);
  }
}

/** Overlay definition: the unified battlefield glow (medium field + particles),
 *  drawn beneath the ship layer. */
export const battleGlow: OverlayDef = {
  id: "battle-glow",
  label: "Battlefield glow (plumes / trails / impacts)",
  defaultOn: true,
  defaultScope: "all",
  draw: drawBattleGlow,
};
