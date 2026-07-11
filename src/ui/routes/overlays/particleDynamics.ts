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

// ---------------------------------------------------------------------------
// Wake/beam bead bridging (renderer-only)
// ---------------------------------------------------------------------------
//
// Projectile wake and beam-channel parcels are spawned with vx = vy = 0
// (src/domain/simulation/engine/exhaust-particles.ts `pushProjectileWakeParticles`):
// the medium does not carry the round's velocity, so a moving round leaves one
// STATIONARY wake parcel per tick along its track. Streaking cannot join those
// (they do not move), so the trail reads as a chain of evenly-spaced dots — the
// confirmed "spotty/discontiguous trail" symptom. Bridging links each bead to
// its cooled continuation (the same physical emission one tick older) so the
// renderer can draw one stretched sprite between them, turning the bead chain
// into a continuous ribbon. The match is recovered from the EXACT one-step
// cooling relationship between consecutive ages, not from any stored id.

/** A bridge between two stationary wake/beam beads: indices into the ORIGINAL
 *  `particles` array passed to {@link computeParticleBridges}. The renderer
 *  draws one stretched sprite between the two beads' advanced positions so their
 *  glow reads as a continuous trail instead of two dots.
 *
 *  Convention: `fromIndex` is the OLDER bead (larger `.age`, emitted earlier,
 *  cooled more, LOWER `energyJ`); `toIndex` is the YOUNGER bead (smaller `.age`,
 *  emitted later, cooled less, HIGHER `energyJ`). The two are consecutive beads
 *  of one trail, the same physical emission observed one cooling step apart. */
export interface ParticleBridge {
  /** Original-array index of the OLDER bead (larger age, lower energy). */
  fromIndex: number;
  /** Original-array index of the YOUNGER bead (smaller age, higher energy). */
  toIndex: number;
}

/** Relative-error threshold below which an older bead is accepted as a
 *  continuation of a younger one in the SAME trail. The prediction
 *  `E_younger * cooling` assumes a CONSTANT emission energy (a throttled
 *  thruster or a beam's steady channel), which holds for exhaust and beam
 *  channels but NOT for a projectile wake: a round under thrust ACCELERATES, so
 *  each tick's wake bead is emitted with a different kinetic energy and the
 *  older bead drifts past the strict prediction by the per-tick speed change
 *  (a missile gaining ~5%/tick in speed drifts ~9%). A tight threshold
 *  (the former 1e-6) leaves every accelerating round's wake un-bridged, so it
 *  renders as a beaded chain — the "discontiguous projectile trail" artefact.
 *
 *  Loose, not tight: same-trail disambiguation from a DIFFERENT trail's bead at
 *  the same age is done by the NEAREST-DISTANCE tiebreak (the two-chain test
 *  pins this), not by energy. Energy only filters out a different EMISSION
 *  CLASS — a wake bead vs an impact burst, or two different weapons' wakes —
 *  whose energies differ by orders of magnitude. 0.5 admits any per-tick
 *  emission drift a physically-plausible round can produce (a ~1.4× speed
 *  change in one tick) while still rejecting a factor-3000+ mismatch (a 3e3 J
 *  impact fragment next to a 1e7 J wake bead reads ~0.9997 relative error). */
const BRIDGE_REL_ERROR_THRESHOLD = 0.5;

/** Absolute band around the minimum relative error within which two eligible
 *  older candidates count as tied (then broken by nearest spatial distance, then
 *  lowest index). 1e-9 folds floating-point noise together so two older beads
 *  whose energies agree to ~1e-13 (the same cooled value) both stay in the
 *  running and the nearest one wins — a younger bead joins its OWN trail when
 *  several trails share the same cooled value at a given age. */
const BRIDGE_REL_ERROR_TIE_BAND = 1e-9;

/** One eligible older match for a younger bead: its original index, the relative
 *  error of its energy against the cooling prediction, and its squared distance
 *  from the younger bead. Used transiently within a single younger-bead match. */
interface BridgeCandidate {
  readonly index: number;
  readonly relErr: number;
  readonly distSq: number;
}

/**
 * Compute the bridges between stationary wake/beam beads that are the SAME
 * physical emission one cooling step apart, so the renderer can draw one
 * stretched sprite between each pair instead of a chain of disconnected dots.
 *
 * Pure and deterministic (no `Math.random`, no `Date`): stationary-particle
 * INDICES are partitioned into same-`.age` emission groups by one left-to-right
 * pass (within one snapshot a particle's age is `(now - emissionTick) * dt`, so
 * bit-identical age marks the same emission tick; the `Map` preserves insertion
 * order so each group keeps the original array order). Only STATIONARY
 * particles (|vx|,|vy| <= 1e-9) participate — moving particles are joined by
 * velocity streaks, not bridges, and bridging one would double-paint it. For
 * each pair of ADJACENT age groups (younger = smaller age, older = larger age),
 * every younger bead is greedily matched to its best still-unclaimed older
 * partner: the older energy closest to the exact one-step prediction
 * `E_younger * exp(-(age_older - age_younger) / PARTICLE_COOLING_TIMESCALE_S)`,
 * accepting only sub-{@link BRIDGE_REL_ERROR_THRESHOLD} relative error and
 * breaking energy-ties (within {@link BRIDGE_REL_ERROR_TIE_BAND}) by nearest
 * Euclidean distance, then lowest original index. A middle-aged bead
 * participates as the older endpoint of one pair and the younger endpoint of
 * the next, so a chain links end to end.
 *
 * Returns the flat bridge list ordered oldest-adjacent-pair first, then younger
 * bead original-index order within each pair. Empty when fewer than two
 * stationary age groups exist.
 */
export function computeParticleBridges(
  particles: readonly ParticleSnapshot[],
): ParticleBridge[] {
  // Partition stationary-particle indices into same-age emission groups. One
  // left-to-right pass; the Map preserves insertion order so within-group order
  // is the original array order.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    if (p === undefined) continue;
    if (Math.abs(p.vx) > 1e-9 || Math.abs(p.vy) > 1e-9) continue;
    const group = groups.get(p.age);
    if (group === undefined) groups.set(p.age, [i]);
    else group.push(i);
  }
  if (groups.size < 2) return [];

  // Distinct ages present among stationary beads, ascending (consecutive
  // emission ticks, oldest first).
  const ages = Array.from(groups.keys()).sort((a, b) => a - b);

  const bridges: ParticleBridge[] = [];
  // Match each adjacent age pair independently: the younger group (smaller age)
  // seeks its cooled continuation in the older group (larger age). A middle-aged
  // bead is the older endpoint here and the younger endpoint in the next pair,
  // so a chain links end to end — the claimed-set is per-pair, not global.
  for (let g = 0; g < ages.length - 1; g += 1) {
    const youngerAge = ages[g];
    const olderAge = ages[g + 1];
    if (youngerAge === undefined || olderAge === undefined) continue;
    const youngerGroup = groups.get(youngerAge);
    const olderGroup = groups.get(olderAge);
    if (youngerGroup === undefined || olderGroup === undefined) continue;

    // One cooling factor per pair: the exact energy ratio between a younger
    // bead and its same-emission continuation at the older age.
    const coolingFactor = Math.exp(
      -(olderAge - youngerAge) / PARTICLE_COOLING_TIMESCALE_S,
    );
    const claimed = new Set<number>();

    for (const yi of youngerGroup) {
      const y = particles[yi];
      if (y === undefined) continue;
      const predictedEnergyJ = y.energyJ * coolingFactor;

      // Collect older candidates whose energy matches the cooling prediction
      // below the threshold, tracking the best (minimum) relative error.
      const eligible: BridgeCandidate[] = [];
      let minRelErr = Infinity;
      for (const oi of olderGroup) {
        if (claimed.has(oi)) continue;
        const o = particles[oi];
        if (o === undefined) continue;
        const relErr =
          Math.abs(o.energyJ - predictedEnergyJ) / predictedEnergyJ;
        if (relErr >= BRIDGE_REL_ERROR_THRESHOLD) continue;
        const dx = o.x - y.x;
        const dy = o.y - y.y;
        eligible.push({ index: oi, relErr, distSq: dx * dx + dy * dy });
        if (relErr < minRelErr) minRelErr = relErr;
      }
      if (eligible.length === 0) continue;

      // Among candidates tied with the best energy match (within the FP-noise
      // band of the minimum relative error), pick the nearest by distance, then
      // the lowest original index for full determinism.
      let bestIndex = -1;
      let bestDistSq = Infinity;
      for (const cand of eligible) {
        if (cand.relErr > minRelErr + BRIDGE_REL_ERROR_TIE_BAND) continue;
        if (cand.distSq < bestDistSq || (cand.distSq === bestDistSq && cand.index < bestIndex)) {
          bestIndex = cand.index;
          bestDistSq = cand.distSq;
        }
      }
      if (bestIndex >= 0) {
        claimed.add(bestIndex);
        bridges.push({ fromIndex: bestIndex, toIndex: yi });
      }
    }
  }
  return bridges;
}
