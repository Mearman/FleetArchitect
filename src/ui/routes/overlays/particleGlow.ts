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
 * Particle glow: one additive radial-gradient blob per live particle, coloured
 * by the shared hot palette at its (FX-scaled) intensity and sized by it, so a
 * fresh parcel reads bright and large and a cooling one dim and small.
 */
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

  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive: glow brightens space

  for (const p of particles) {
    const intensity = Math.max(0, Math.min(1, p.intensity * fxGain));
    if (intensity < PARTICLE_DRAW_THRESHOLD) continue;

    const [r, g, b] = paletteSample(intensity);
    const screen = t.project(p.x, p.y);
    const radius = PARTICLE_RADIUS_PX * (0.4 + 0.6 * intensity);
    const alphaCore = Math.min(1, intensity * 1.2);

    const grad = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius);
    grad.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${alphaCore})`);
    grad.addColorStop(0.5, `rgba(${r | 0},${g | 0},${b | 0},${intensity * 0.4})`);
    grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Overlay definition: weapon-source particle glow (exhaust, plumes, channels,
 *  impacts), drawn beneath the ship layer. */
export const particleGlow: OverlayDef = {
  id: "particle-glow",
  label: "Weapon particles (exhaust / plumes / impacts)",
  defaultOn: true,
  defaultScope: "all",
  draw: drawParticleGlow,
};
