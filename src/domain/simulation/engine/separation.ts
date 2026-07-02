/**
 * Inter-ship separation steering — the repulsive counterpart to cohesion.
 *
 * Cohesion blends a ship toward its fleet centroid; without a repulsive term two
 * ships targeting each other close head-on until their cells overlap, and only
 * the reactive collision step (elastic push-apart + kinetic damage) separates
 * them after the fact. Separation sums, for every near neighbour, a unit vector
 * pointing AWAY weighted by proximity (a linear ramp from the field's outer edge
 * to skin contact) and blends the desired facing toward the resultant bearing —
 * steering ships clear before they ram. Universal — ships are solid bodies that
 * cannot share space, regardless of side — so, like `blackHoleAvoid`, this is a
 * global steering spec rather than a per-doctrine knob. The field scales with the
 * pair: contact is `a.radius + b.radius` (the maintained bounding discs), so a
 * fighter pair begins separating at a fraction of a dreadnought pair's distance
 * with no per-class literal.
 *
 * The tunables below are standalone sim-time constants the engine reads at
 * sim-time, so they enter the deterministic-result cache key through
 * `SimConstants` (see `domain/cache/sim-config.ts`); a change to any one flips
 * every cache key.
 */

import { fastHypot } from "./hypot";
import { SpatialHash } from "../spatial-hash";
import type { SimShip } from "./types";

/**
 * How far beyond skin contact the separation field extends, as a multiple of the
 * pair's contact distance (`a.radius + b.radius`). A neighbour inside
 * `contact × (1 + clearanceFactor)` exerts a repulsive bias ramping from zero at
 * the outer edge to full at contact; outside it the neighbour is ignored and
 * normal target-seeking combat is byte-identical. Authored as a MULTIPLE of
 * contact, not a fixed metre distance, so the warning zone scales with ship
 * size: a fighter pair begins jinking a few metres out, a dreadnought pair tens
 * of metres out, and two tiny ships holding station tens of metres apart (well
 * outside a few-metre field) are left untouched — which keeps the field out of
 * the way of size-bound mechanics such as the fixed-range salvage collection.
 *
 * Classification: authored catalogue content (a steering-blend field-width
 * multiple).
 */
export const SEPARATION_CLEARANCE_FACTOR = 0.5;

/**
 * Minimum separation weight applied the instant a neighbour enters the field, so
 * the bias is felt at the edge rather than fading in from zero (a zero-at-the-
 * edge ramp lets a fast ship punch through before the bias grows). The weight
 * ramps from this floor up to 1 as the pair closes to skin contact — the same
 * shape as `blackHoleAvoid.edgeWeight`.
 *
 * Classification: unit-spec-rate-epsilon (a steering-blend floor spec).
 */
export const SEPARATION_EDGE_WEIGHT = 0.2;

/**
 * Separation weight at and above which the ship burns to escape as well as
 * turning — a genuinely imminent collision where a heading-only nudge could be
 * outrun by the closing speed. Mirrors the `forceFire` survival override in
 * black-hole avoidance: the engine fires before the ship has fully turned onto
 * the escape heading, because a partial-alignment burn still beats coasting into
 * contact. Below this the field is heading-only, leaving ordinary
 * closing-to-range combat untouched.
 *
 * Classification: unit-spec-rate-epsilon (a steering-blend survival threshold).
 */
export const SEPARATION_BURN_THRESHOLD = 0.85;

/**
 * One body in the per-tick separation field: a ship's stable `id`, its position
 * SNAPSHOTTED at the start of the tick (before any ship moves), and its bounding
 * radius. The same snapshot contract as the gravitational `MassBody` list in
 * `gravity.ts`: every ship reads the same simultaneous configuration, so the
 * separation term does not depend on the movement loop's execution order, and
 * the list is sorted by `id` so the per-ship neighbour summation is
 * byte-reproducible.
 */
export interface SepBody {
  id: string;
  x: number;
  y: number;
  radius: number;
}

/**
 * The per-tick separation field: every alive, non-phantom ship's pose and
 * bounding radius, captured NOW (before any ship moves) and sorted
 * lexicographically by `instanceId`, PLUS a uniform-grid spatial hash over the
 * same bodies and the largest bounding radius on the field.
 *
 * The hash backs the optimised neighbour gather in {@link separationHeading}:
 * the separation field is SHORT-RANGE (a neighbour outside
 * `contact × (1 + clearanceFactor)` contributes exactly zero — see
 * {@link separationWeight}), so for each ship we query only the disc of buckets
 * the field could reach rather than scanning every body. That disc's radius is
 * `(ship.radius + maxRadius) × (1 + clearanceFactor)` — the furthest any pair's
 * outer edge could lie — which is a guaranteed superset of every contributing
 * neighbour for that ship (any `o` inside the (ship, o) pair-field satisfies
 * `dist < (ship.radius + o.radius) × 1.5 ≤ queryRadius`). The exact membership
 * test is then the SAME `separationWeight > 0` predicate the full scan used, so
 * the gathered+filtered candidate SET is identical to the full-scan contributing
 * set.
 *
 * Determinism of the summation: the candidate set gathered from the hash comes
 * out in bucket-walk order (not id order), so `separationHeading` re-sorts the
 * gathered bodies back into the snapshot's lexicographic `id` order before
 * summing. The contributing neighbours therefore accumulate in the identical
 * order the full O(N²) scan would have summed them — floating-point addition is
 * not associative, so this re-sort is what makes the optimisation byte-identical
 * to the frozen oracle ({@link separationHeadingReference}); the field's `id`
 * sort makes that order a property of the inputs, not of the live array order.
 *
 * `candidateScratch` is a per-tick reusable buffer the heading gather fills (one
 * buffer reused across every ship in the tick, since `moveShips` walks the ships
 * sequentially); it lives exactly as long as the field, which is rebuilt once
 * per tick.
 */
export interface SeparationField {
  /** All alive, non-phantom bodies, sorted lexicographically by `id`. */
  readonly bodies: readonly SepBody[];
  /** Uniform-grid index over the same bodies (payload = the body). */
  readonly hash: SpatialHash<SepBody>;
  /** Largest bounding radius on the field; bounds the per-ship query disc. */
  readonly maxRadius: number;
  /** Reusable candidate buffer, cleared and refilled once per ship per tick. */
  readonly candidateScratch: SepBody[];
}

/**
 * Build the per-tick separation field: every alive, non-phantom ship's pose and
 * bounding radius, captured NOW (before any ship moves) and sorted
 * lexicographically by `instanceId`, then indexed in a uniform-grid spatial hash
 * for the short-range neighbour gather. A claimed hulk is included — it is a
 * solid body other ships must not ram — though it does not itself steer (the
 * movement loop skips claimed hulls before reaching the separation blend). The
 * bodies are sorted and the hash populated in that same sorted order so the
 * neighbour summation has a fixed, run-independent order to be re-sorted into:
 * floating-point addition is not associative, so the order the away-vectors are
 * summed in must be a property of the inputs, not of the live array order.
 */
export function buildSeparationSnapshot(ships: readonly SimShip[]): SeparationField {
  const bodies: SepBody[] = [];
  let maxRadius = 0;
  for (const s of ships) {
    if (!s.alive || s.phantom !== undefined) continue;
    bodies.push({ id: s.instanceId, x: s.x, y: s.y, radius: s.radius });
    if (s.radius > maxRadius) maxRadius = s.radius;
  }
  bodies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hash = new SpatialHash<SepBody>();
  for (const body of bodies) hash.insert(body, body.x, body.y);
  return { bodies, hash, maxRadius, candidateScratch: [] };
}

/**
 * Separation weight a single neighbour at centre distance `dist` exerts, where
 * `contact` is the pair's skin-contact distance (`a.radius + b.radius`): 0 at and
 * beyond the field's outer edge (`contact × (1 + clearanceFactor)`), ramping
 * linearly up to 1 at skin contact. The same ramp shape as `blackHoleAvoidWeight`
 * — a floor at the edge so the bias is felt immediately rather than fading in
 * from zero, then a smooth rise as the pair closes. Returns 0 for any neighbour
 * outside the field so the caller can sum unconditionally. Shared with the
 * reference oracle so the field shape (and hence the exact cutoff the optimised
 * gather relies on) cannot drift between the two implementations.
 */
export function separationWeight(dist: number, contact: number): number {
  const outer = contact * (1 + SEPARATION_CLEARANCE_FACTOR);
  if (dist >= outer) return 0;
  if (dist <= contact) return 1;
  const span = contact * SEPARATION_CLEARANCE_FACTOR;
  const depth = (outer - dist) / span;
  return SEPARATION_EDGE_WEIGHT + (1 - SEPARATION_EDGE_WEIGHT) * depth;
}

/**
 * The net separation heading and peak proximity weight for `ship` over every
 * other body in the field, summed in the snapshot's fixed id order. Each
 * neighbour inside the field contributes a unit vector pointing AWAY from it,
 * weighted by its proximity; the resultant bearing is the direction to steer to
 * escape the cluster (vector-space, so a ship squeezed between two neighbours
 * finds a sideways escape rather than a cancelled-out zero). The blend strength
 * is the PEAK proximity across neighbours — the closest one sets how hard we
 * steer — which is a `max` and so order-independent; only the vector sum is
 * non-associative, which the re-sort into id order makes deterministic. Returns
 * `undefined` when no neighbour is inside the field, or in the degenerate
 * exactly-sandwiched case where the away-vectors cancel (atan2(0,0)=0 would
 * spuriously steer "east"; the existing heading is left to the reactive
 * collision backstop instead).
 *
 * Optimisation vs. the frozen oracle ({@link separationHeadingReference}): the
 * field is short-range, so instead of an O(N²) scan over every body we gather
 * only the bodies whose bucket overlaps the query disc of radius
 * `(ship.radius + field.maxRadius) × (1 + clearanceFactor)` (a superset of every
 * contributing neighbour), re-sort that gathered set into the snapshot's id
 * order, and run the identical per-neighbour accumulation. The contributing
 * neighbours are summed in the same order the full scan would have used; the
 * extra gathered bodies the disc admits are filtered out by the same
 * `separationWeight <= 0` test, contributing nothing. The candidate SET gathered
 * is identical to the full-scan contributing set, in the identical order, so the
 * result is byte-identical (proven by the separation equivalence unit test and
 * the whole-battle lossless digest gate).
 */
export function separationHeading(
  ship: SimShip,
  field: SeparationField,
): { heading: number; weight: number } | undefined {
  // Query disc radius: the furthest any pair's outer edge could reach. Every
  // contributing neighbour (dist < (ship.radius + o.radius) × 1.5) lies inside
  // this disc, so the gather is a guaranteed superset.
  const queryRadius = (ship.radius + field.maxRadius) * (1 + SEPARATION_CLEARANCE_FACTOR);
  // Gather candidate bodies from the spatial hash into the reusable scratch
  // buffer, then re-sort into the snapshot's lexicographic id order so the
  // summation below is byte-identical to the full O(N²) scan. The bucket walk
  // emits in row-major bucket order, not id order, so this re-sort is the
  // load-bearing step that preserves floating-point determinism.
  const gathered = field.candidateScratch;
  gathered.length = 0;
  field.hash.forEachCandidate(ship.x, ship.y, queryRadius, (entry) => {
    gathered.push(entry.payload);
  });
  gathered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let sumX = 0;
  let sumY = 0;
  let peak = 0;
  for (const o of gathered) {
    if (o.id === ship.instanceId) continue;
    const dx = ship.x - o.x;
    const dy = ship.y - o.y;
    const dist = fastHypot(dx, dy);
    const w = separationWeight(dist, ship.radius + o.radius);
    if (w <= 0 || dist <= 0) continue;
    sumX += (dx / dist) * w;
    sumY += (dy / dist) * w;
    if (w > peak) peak = w;
  }
  if (peak <= 0) return undefined;
  if (sumX * sumX + sumY * sumY < 1e-12) return undefined;
  return { heading: Math.atan2(sumY, sumX), weight: peak };
}
