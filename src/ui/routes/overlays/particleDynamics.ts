import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import type { ParticleSnapshot } from "@/schema/battle";

// ---------------------------------------------------------------------------
// Sub-tick temporal continuity for the particle glow (renderer-only)
// ---------------------------------------------------------------------------
//
// Particles are snapshotted only every RESOURCE_EVERY ticks
// (src/domain/simulation/engine/snapshot.ts), so between emissions the
// renderer would otherwise draw each particle frozen at its snapshotted
// position until the next emission — a visible ~0.2s teleport. This module
// advances a particle's CLOSED-FORM physics exactly between its emission tick
// and the current fractional display tick (tickF), so motion and cooling are
// continuous across the snapshot stride instead of stepping.
//
// The constants below are MIRRORED from the engine (the renderer cannot import
// src/domain/simulation/engine/**, the same UI/domain boundary
// `worldToCellIndex` in mediumShared.ts respects). They must be kept in sync
// with their engine sources; each carries a citation so a future engine-side
// change is easy to notice and re-sync.

/** Radiative cooling timescale, seconds. Mirrors
 *  `EXHAUST_COOLING_TIMESCALE_S` in
 *  `src/domain/simulation/engine/exhaust-particles.ts`. A parcel's glow fades
 *  to 1/e over this time as it radiates its heat into vacuum. Keep in sync with
 *  that source. */
export const PARTICLE_COOLING_TIMESCALE_S = 2;

/** Particle lifetime, seconds. Mirrors `EXHAUST_PARTICLE_LIFETIME_S` in
 *  `src/domain/simulation/engine/exhaust-particles.ts`
 *  (3 cooling timescales: exp(-3) ~ 0.05, the dim tail the engine culls). The
 *  engine culls a particle at this age; the renderer stops drawing it at the
 *  same point so the glow does not linger past the simulated live set. Keep in
 *  sync with that source. */
export const PARTICLE_LIFETIME_S = 3 * PARTICLE_COOLING_TIMESCALE_S;

/** Ramp-in window, seconds. A particle ramps from 0 to full brightness over its
 *  first display tick of age (1 / TICKS_PER_SECOND), so a fresh muzzle flash
 *  does not pop in at full intensity the instant it is emitted. */
export const PARTICLE_RAMP_IN_S = 1 / TICKS_PER_SECOND;

/** Closed-form sub-tick render state for one particle: where it is now, how much
 *  energy it still carries, how old it is, and its ramp-in alpha. Written in
 *  place by {@link particleRenderState} into a caller-owned scratch object so a
 *  per-rAF particle loop can reuse one instance across iterations (the pooling
 *  convention used throughout useBattleCanvas.ts). */
export interface ParticleRenderState {
  x: number;
  y: number;
  energyJ: number;
  ageS: number;
  rampAlpha: number;
}

/** Standard smoothstep: clamp `t = (x - edge0) / (edge1 - edge0)` to [0, 1] and
 *  return `t * t * (3 - 2 * t)`. Returns 0 below edge0, 1 above edge1, and the
 *  smooth Hermite interpolation between. When `edge0 === edge1` no interpolation
 *  is defined, so it returns a step (0 below, 1 at or above) instead of
 *  dividing by zero. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Advance the particle's closed-form state by `dtSinceS` seconds since its
 * snapshot, writing the result into `out` in place (no allocation), and return
 * whether the particle is still live (should be drawn).
 *
 * `dtSinceS` is always >= 0: it is `(tickF - particlesFrame.tick) /
 * TICKS_PER_SECOND`, and the particle-carrying frame is resolved by walking
 * backward for the nearest non-empty emission, so its tick is always <=
 * floor(tickF). Position advances linearly with the snapshotted velocity; energy
 * cools by exactly one `exp(-dt / PARTICLE_COOLING_TIMESCALE_S)` factor; age
 * increases by dt; the ramp-in alpha follows the first-tick smoothstep.
 *
 * Returns `false` (the caller must skip drawing) when the advanced age has
 * reached {@link PARTICLE_LIFETIME_S}, matching the engine's lifetime cull.
 */
export function particleRenderState(
  p: ParticleSnapshot,
  dtSinceS: number,
  out: ParticleRenderState,
): boolean {
  out.x = p.x + p.vx * dtSinceS;
  out.y = p.y + p.vy * dtSinceS;
  out.energyJ = p.energyJ * Math.exp(-dtSinceS / PARTICLE_COOLING_TIMESCALE_S);
  out.ageS = p.age + dtSinceS;
  out.rampAlpha = smoothstep(0, PARTICLE_RAMP_IN_S, out.ageS);
  return out.ageS < PARTICLE_LIFETIME_S;
}
