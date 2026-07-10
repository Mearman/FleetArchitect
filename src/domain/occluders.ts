import { z } from "zod";
import type { BattleAnomalyKind } from "@/schema/battle";
import { BLACK_HOLE_SCHWARZSCHILD_RADIUS_M } from "@/domain/black-hole";
import { hasAnomaly } from "@/domain/anomaly";

/**
 * Pure, deterministic line-of-sight occluder module.
 *
 * Computes the set of solid disc occluders for a battle's active anomaly set and
 * seed, and tests whether a segment between two points is blocked by any of them.
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
 * Event-horizon radius of the black-hole occluder, in world units. The
 * line-of-sight disc is sized to the black hole's lethal/horizon radius so the
 * rock the player sees and the engine's death zone agree. Read from the shared
 * pure-domain leaf {@link BLACK_HOLE_SCHWARZSCHILD_RADIUS_M}
 * (`@/domain/black-hole`) — the same constant the engine and renderer use — so
 * the three layers cannot drift apart. Aliased locally to keep the existing
 * occluder-test export name stable.
 */
const BLACK_HOLE_RADIUS = BLACK_HOLE_SCHWARZSCHILD_RADIUS_M;

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
 * Asteroid field bounding rectangle (world units, metres). Rocks are scattered
 * within the central battle area, between the two fleet deployment lines at
 * km-scale separations. A margin keeps rocks from spawning directly on top of
 * deploying ships.
 *
 * Re-grounded for km combat (Phase 5): the pre-km ±300 m rect was a tight
 * cluster invisible against the km-scale deployment and weapon ranges. Scaled
 * by the same factor as the black-hole horizon (2000/24 ≈ 83×) to ±25 km so
 * the field spans a readable swath of the km arena — large enough to break
 * line-of-sight across engagement ranges without filling the playfield.
 */
const FIELD_X_MIN = -25_000;
const FIELD_X_MAX = 25_000;
const FIELD_Y_MIN = -25_000;
const FIELD_Y_MAX = 25_000;

/**
 * Minimum radius of a generated asteroid disc (world units, metres). Scaled
 * from the pre-km 14 m by the km rescale factor (2000/24) so rocks are
 * readable obstacles against km-scale ships and weapon paths.
 */
const ASTEROID_MIN_R = 1_200;

/**
 * Maximum radius of a generated asteroid disc (world units, metres). Scaled
 * from the pre-km 34 m by the km rescale factor (2000/24).
 */
const ASTEROID_MAX_R = 2_800;

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
 * Compute the list of solid disc occluders for the active anomaly set and battle
 * seed. Anomalies combine: the result is the union of each active kind's discs
 * in a fixed canonical order — the black-hole disc first (if present), then the
 * asteroid-field discs (if present); a nebula contributes no hard occluders.
 *
 * The order is fixed (black hole before asteroids) so the emitted
 * `AwarenessSnapshot.occluders` array — rendered and used for line-of-sight — is
 * byte-identical for a given anomaly set regardless of how it was selected. The
 * asteroid RNG sequence is unchanged whether or not a black hole is also active:
 * the black-hole disc draws no RNG, so asteroid positions are identical to an
 * asteroid-field-only battle.
 *
 * Results are fully deterministic: two calls with the same (anomalies, seed)
 * always return deep-equal arrays. The iteration count and order are fixed,
 * so no floating-point non-determinism can creep in.
 */
export function computeOccluders(
  anomalies: readonly BattleAnomalyKind[],
  seed: number,
): Disc[] {
  const discs: Disc[] = [];

  // Black hole: one disc at the origin sized to the event horizon. Emitted first
  // so the canonical order is stable.
  if (hasAnomaly(anomalies, "blackHole")) {
    discs.push({ x: 0, y: 0, r: BLACK_HOLE_RADIUS });
  }

  // Asteroid field: ASTEROID_OCCLUDER_COUNT discs scattered in the field
  // rectangle. The seed is XORed with the golden-ratio salt so occluder draws
  // are independent of the main battle RNG sequence.
  if (hasAnomaly(anomalies, "asteroidField")) {
    const rng = mulberry32((seed ^ OCCLUDER_SALT) >>> 0);
    for (let i = 0; i < ASTEROID_OCCLUDER_COUNT; i++) {
      discs.push({
        x: ranged(rng, FIELD_X_MIN, FIELD_X_MAX),
        y: ranged(rng, FIELD_Y_MIN, FIELD_Y_MAX),
        r: ranged(rng, ASTEROID_MIN_R, ASTEROID_MAX_R),
      });
    }
  }

  return discs;
}

/**
 * Returns true if the line segment from (ax, ay) to (bx, by) passes within
 * the radius of any disc in `discs` (i.e. the segment is occluded).
 *
 * Uses the clamped point-to-segment distance squared test:
 *   d² = |PA - t·(BA)|²  where t = clamp(dot(PA, BA) / |BA|², 0, 1)
 * A segment is blocked when d² ≤ r² for any disc. Pure, float-only, and
 * deterministic — no branching on RNG.
 *
 * NOTE: this is a straight-line (Euclidean) test. Near a black hole,
 * gravitational lensing bends both weapon beams (optics.ts) and — in
 * principle — sensor sightlines, so a target behind the well could be visible
 * along a curved geodesic even when the straight segment is occluded. Sensor
 * occlusion does not model this: the deflection at combat sensor ranges is
 * microradians, so the straight-line approximation is physically wrong but
 * functionally irrelevant. A curved-ray variant would require a
 * piecewise-linear polyline through the gravitational field and changes at
 * every call site (awareness-direct.ts, awareness.ts, sensors.ts).
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
