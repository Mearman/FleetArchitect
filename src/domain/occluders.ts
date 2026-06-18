import { z } from "zod";
import type { BattleAnomaly } from "@/schema/battle";

/**
 * Pure, deterministic line-of-sight occluder module.
 *
 * Computes the set of solid disc occluders for a given battle anomaly and seed,
 * and tests whether a segment between two points is blocked by any of them.
 * No dependency on the simulation engine — the renderer and future awareness
 * logic both import this module safely.
 */

// ---------------------------------------------------------------------------
// Disc schema and type
// ---------------------------------------------------------------------------

/** A circular occluder in world coordinates. */
export const Disc = z.object({
  x: z.number(),
  y: z.number(),
  r: z.number(),
});
export type Disc = z.infer<typeof Disc>;

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------

/**
 * Event-horizon radius of the black-hole occluder, in world units.
 * Matches SIM.blackHoleLethalRadius in the engine (24 wu); defined here
 * independently so this module does not import engine internals.
 */
const BLACK_HOLE_RADIUS = 24;

/**
 * Number of asteroid disc occluders generated for an asteroid-field anomaly.
 * Chosen to give a dense-enough field to break line-of-sight without
 * completely filling the playfield.
 */
const ASTEROID_OCCLUDER_COUNT = 24;

/**
 * XOR salt applied to the seed before generating asteroid positions, using
 * the golden-ratio fractional constant 0x9e3779b9. This separates the
 * occluder RNG from any other generator seeded with the same base value so
 * occluder placement is independent of battle-event randomness.
 */
const OCCLUDER_SALT = 0x9e3779b9;

/**
 * Asteroid field bounding rectangle (world units). Rocks are scattered within
 * the central battle area, between the two fleet deployment lines at ±360 wu.
 * A margin keeps rocks from spawning directly on top of deploying ships.
 */
const FIELD_X_MIN = -300;
const FIELD_X_MAX = 300;
const FIELD_Y_MIN = -300;
const FIELD_Y_MAX = 300;

/** Minimum radius of a generated asteroid disc, in world units. */
const ASTEROID_MIN_R = 14;

/** Maximum radius of a generated asteroid disc, in world units. */
const ASTEROID_MAX_R = 34;

// ---------------------------------------------------------------------------
// Internal RNG — mulberry32, identical algorithm to src/domain/simulation/rng.ts
// ---------------------------------------------------------------------------

/**
 * mulberry32 PRNG: fast, reproducible across environments, sufficient quality
 * for a game. The algorithm is copied verbatim from the simulation RNG so
 * occluder results are bit-identical to any engine uses of the same seed.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic float in [min, max). */
function ranged(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the list of solid disc occluders for a given anomaly and battle seed.
 *
 * Results are fully deterministic: two calls with the same (anomaly, seed)
 * always return deep-equal arrays. The iteration count and order are fixed,
 * so no floating-point non-determinism can creep in.
 *
 * - "blackHole"    → one disc at the origin with radius BLACK_HOLE_RADIUS.
 * - "asteroidField" → ASTEROID_OCCLUDER_COUNT discs scattered in the field
 *                     rectangle, generated with mulberry32(seed ^ OCCLUDER_SALT).
 * - "none" / "nebula" → empty array (nebula attenuates sensors but has no
 *                        hard occluders).
 */
export function computeOccluders(anomaly: BattleAnomaly, seed: number): Disc[] {
  switch (anomaly) {
    case "blackHole":
      return [{ x: 0, y: 0, r: BLACK_HOLE_RADIUS }];

    case "asteroidField": {
      // XOR the seed with the golden-ratio salt so occluder draws are
      // independent of the main battle RNG sequence.
      const rng = mulberry32((seed ^ OCCLUDER_SALT) >>> 0);
      const discs: Disc[] = [];
      for (let i = 0; i < ASTEROID_OCCLUDER_COUNT; i++) {
        discs.push({
          x: ranged(rng, FIELD_X_MIN, FIELD_X_MAX),
          y: ranged(rng, FIELD_Y_MIN, FIELD_Y_MAX),
          r: ranged(rng, ASTEROID_MIN_R, ASTEROID_MAX_R),
        });
      }
      return discs;
    }

    case "none":
    case "nebula":
      return [];
  }
}

/**
 * Returns true if the line segment from (ax, ay) to (bx, by) passes within
 * the radius of any disc in `discs` (i.e. the segment is occluded).
 *
 * Uses the clamped point-to-segment distance squared test:
 *   d² = |PA - t·(BA)|²  where t = clamp(dot(PA, BA) / |BA|², 0, 1)
 * A segment is blocked when d² ≤ r² for any disc. Pure, float-only, and
 * deterministic — no branching on RNG.
 */
export function segmentBlocked(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  discs: readonly Disc[],
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  for (const disc of discs) {
    const px = disc.x - ax;
    const py = disc.y - ay;

    // t is the projection of A→disc onto A→B, normalised by |AB|².
    // Clamping to [0, 1] gives the closest point on the segment (not the line).
    const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq)) : 0;

    const closestX = ax + t * dx;
    const closestY = ay + t * dy;

    const diffX = disc.x - closestX;
    const diffY = disc.y - closestY;
    const distSq = diffX * diffX + diffY * diffY;

    if (distSq <= disc.r * disc.r) return true;
  }

  return false;
}

// Re-export constants the test suite needs to verify bounds without magic numbers.
export {
  ASTEROID_OCCLUDER_COUNT,
  ASTEROID_MIN_R,
  ASTEROID_MAX_R,
  FIELD_X_MIN,
  FIELD_X_MAX,
  FIELD_Y_MIN,
  FIELD_Y_MAX,
  BLACK_HOLE_RADIUS,
};
