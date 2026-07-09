import {
  INTENSITY_DRAW_THRESHOLD,
  fxGainFor,
  glowEdgeFade,
  mediumCellIntensity,
  paletteSample,
  particleCellBrightness,
  readFxLevel,
  resolveMediumField,
  sampleMediumRho,
} from "./mediumShared";
import type { BattleFrame, MediumSnapshot, ParticleSnapshot } from "@/schema/battle";
import type { OverlayCtx, OverlayDef } from "./types";

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
// The field is rasterised one texel per cell into a cached offscreen buffer and
// blitted smoothed + additively (bilinear turns the lattice into a continuous
// haze); the particles are blitted as prerendered additive sprites. The two
// compose additively in the same pass. The physical model, cell↔world mapping,
// brightness formula, and tuning constants live in `./mediumShared.ts`.

// ---------------------------------------------------------------------------
// Field glow buffer (one texel per cell, cached on field identity)
// ---------------------------------------------------------------------------

type GlowBuffer = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imageData: ImageData;
  rasterField: MediumSnapshot | undefined;
  rasterFxGain: number | undefined;
};

let glowBuffer: GlowBuffer | undefined;
let glowBufferKey = "";

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

/** Rasterise the field one texel per cell into the cached buffer, then blit it
 *  smoothed + additively aligned to the grid's world rectangle. Rasterisation
 *  is cached on the resolved field reference + FX gain (the field is constant
 *  between emissions), so the ~20k-cell scan runs once per emission, not per rAF. */
function drawFieldGlow(c: OverlayCtx, field: MediumSnapshot, fxGain: number): void {
  const { ctx, t } = c;
  const { rho, eps, epsVis, widthM, heightM, pitchM } = field;
  const glowEps = epsVis ?? eps;
  const cellCount = widthM * heightM;
  if (rho.length < cellCount || glowEps.length < cellCount) return;
  const buf = ensureGlowBuffer(widthM, heightM);
  if (buf === undefined) return;

  if (buf.rasterField !== field || buf.rasterFxGain !== fxGain) {
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
  ctx.drawImage(buf.canvas, 0, 0);
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

/** Splat each live particle as a prerendered additive sprite, brightened by the
 *  ONE shared tone-map on its effective eps + the local density. */
function drawParticleGlow(
  c: OverlayCtx,
  particles: ParticleSnapshot[],
  field: MediumSnapshot | undefined,
  fxGain: number,
): void {
  const { ctx, t } = c;
  const width = t.width;
  const height = t.height;
  const atlas = glowAtlasSprites();
  const screen = { x: 0, y: 0 };

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    t.projectInto(screen, p.x, p.y);
    const sx = screen.x;
    const sy = screen.y;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
    const rho = field === undefined ? 0 : sampleMediumRho(field, p.x, p.y);
    const dispI = Math.max(0, Math.min(1, particleCellBrightness(p.energyJ, rho, fxGain)));
    if (dispI < PARTICLE_DRAW_THRESHOLD) continue;
    const radius = PARTICLE_RADIUS_PX * (0.4 + 0.6 * dispI);
    const bucket = Math.min(ATLAS_BUCKETS - 1, Math.round(dispI * (ATLAS_BUCKETS - 1)));
    const bucketIntensity = bucket / (ATLAS_BUCKETS - 1);
    const sprite = atlas === null ? undefined : atlas[bucket];
    if (sprite === undefined) continue;
    ctx.globalAlpha = bucketIntensity > 0 ? Math.min(1, dispI / bucketIntensity) : 0;
    ctx.drawImage(sprite, sx - radius, sy - radius, radius * 2, radius * 2);
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
  const field = resolveMediumField(c.frames, c.tick);
  const particles = resolveParticles(c.frames, c.tick);
  if (field === undefined && (particles === undefined || particles.length === 0)) return;
  if (field !== undefined) drawFieldGlow(c, field, fxGain);
  if (particles !== undefined && particles.length > 0) drawParticleGlow(c, particles, field, fxGain);
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
