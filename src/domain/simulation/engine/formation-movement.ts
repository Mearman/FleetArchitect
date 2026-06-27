/**
 * Phase D movement consumer for the formation-doctrine pass: maps a ship's
 * transient `aiSpatial` objective to a world desired-point, and provides the
 * own-formation centroid for the cohesion generalisation. Both are GATED on the
 * ship carrying a formation-doctrine override (`aiSpatial` set, or a nested
 * formation chain) so a flat preset fleet — `aiSpatial` undefined,
 * `formationChain` of length 1 — runs the existing whole-fleet-centroid /
 * target-based movement byte-identically. The pinned preset-determinism hashes
 * do not move.
 *
 * Determinism: `desiredPoint` is a pure function of (ship, tick, resolver) —
 * the only time term is the orbit's `phase + omega·tick`. The cohesion
 * centroid is summed in instanceId-sorted order (via {@link buildAggregates}).
 * No RNG, no clock beyond the orbit term, no Map iteration for summation.
 */

import { maxWeaponRange } from "./setup";
import { type FormationAggregate, type ResolveReference } from "./formation-doctrine";
import type { SpatialObjective, BearingFrame } from "@/schema/ai";
import type { SimShip } from "./types";

/** A desired world point the ship should drive to, the desired distance `want`
 *  the translation controller should hold FROM that point, and the at-range
 *  station-keep band fraction. The point encodes the BEARING rule (where around
 *  the reference); `want` encodes the RANGE rule (how far from the reference).
 *  For `free`/`toward`/`away` the point is the reference P itself and `want`
 *  carries the full range; for `offset`/`orbit` the point is offset to a
 *  fixed/circling location and `want` is 0 (sit on that point). The controller
 *  then drives to `(point, want)` with its existing stop-in-time / station-keep
 *  maths. `band` widens the dead-zone for a `hold` rule; undefined → default. */
export interface DesiredPoint {
  x: number;
  y: number;
  /** Desired distance the controller holds from the point. 0 = drive onto the
   *  point; >0 = hold range (range-keeping band applies). */
  want: number;
  /** At-range band fraction for the station-keeper. Undefined → default. */
  band: number | undefined;
}

/** Empty export placeholder so the module's public surface is explicit. The
 *  helpers below are the real exports. */
export {};

/**
 * The desired distance from the reference point P, derived from the range rule.
 * `hold`/`close` → 0; `evade` → minRange; `kite` → maxRange; `maintain` → range;
 * `engage` → fraction × the ship's own maximum weapon range. Pure.
 */
function desiredDistance(range: SpatialObjective["range"], ship: SimShip): number {
  switch (range.kind) {
    case "hold":
      return 0;
    case "close":
      return 0;
    case "evade":
      return range.minRange;
    case "kite":
      return range.maxRange;
    case "maintain":
      return range.range;
    case "engage":
      // Fraction of the ship's own maximum weapon range, resolved here against
      // the live weapons (the authoring model cannot know them). 0 collapses
      // `engage` to "sit on P" for an unarmed ship.
      return range.fraction * maxWeaponRange(ship.weapons, 0);
  }
}

/**
 * Resolve a point-offsetting bearing to a world point, or undefined when a
 * `toward`/`away` reference unresolves. Non-offsetting bearings (`free`/
 * `toward`/`away`) return P itself — the range is then held by `want` against
 * P, and the controller picks the approach bearing from the ship's position.
 * Offsetting bearings consume `radius` (the range distance) to place the point:
 *  - `offset` — P shifted by `radius` along the authored world angle. Fleet
 *    facing is not carried on SimShip (it would couple the point to attitude),
 *    so `fleet`/`self` resolve as world-space; `world` is the literal frame.
 *  - `orbit` — P shifted by `radius` along `phase + omega·tick` (the only
 *    time-dependent term; pure in tick). Pure.
 */
function offsetPoint(
  bearing: SpatialObjective["bearing"],
  P: { x: number; y: number },
  radius: number,
  tick: number,
  resolve: ResolveReference,
  ship: SimShip,
): { x: number; y: number } | undefined {
  switch (bearing.kind) {
    case "free":
      void resolve;
      void ship;
      return { x: P.x, y: P.y };
    case "toward": {
      // The controller holds `want` from P; the toward-reference biases the
      // approach bearing, which the controller derives from the ship's position
      // toward P. The point stays P.
      const Q = resolve(bearing.reference, ship);
      if (Q === undefined) return undefined;
      void Q;
      return { x: P.x, y: P.y };
    }
    case "away": {
      const Q = resolve(bearing.reference, ship);
      if (Q === undefined) return undefined;
      void Q;
      return { x: P.x, y: P.y };
    }
    case "offset": {
      const frame: BearingFrame = bearing.frame;
      void frame;
      return {
        x: P.x + radius * Math.cos(bearing.angle),
        y: P.y + radius * Math.sin(bearing.angle),
      };
    }
    case "orbit": {
      const angle = bearing.phase + bearing.omega * tick;
      return {
        x: P.x + radius * Math.cos(angle),
        y: P.y + radius * Math.sin(angle),
      };
    }
  }
}

/**
 * Map a ship's `aiSpatial` objective to a world desired-point + range, or
 * undefined when the reference (or a toward/away bearing reference) unresolves
 * — the caller then falls through to the existing movement unchanged. The RANGE
 * rule selects the desired distance `want` from the reference; the BEARING rule
 * selects where around the reference the ship sits.
 *
 * Verb mapping (range → `want`; bearing → point):
 *  - `hold`    — want 0, sit on P, station-keep (band widened by `band`).
 *  - `close`   — want 0, drive onto P (pursue).
 *  - `evade`   — want minRange, hold open range from P.
 *  - `kite`    — want maxRange, hold at maximum reach.
 *  - `maintain`— want range, hold the tolerance.
 *  - `engage`  — want fraction×maxWeaponRange, hold the tolerance.
 * For `offset`/`orbit` the point is offset to the authored/circling location
 * (consuming the radius) and `want` becomes 0 (sit on the offset point). For
 * `free`/`toward`/`away` the point is P and `want` carries the full range.
 *
 * The orbit's `phase + omega·tick` is the only time-dependent term; everything
 * else is pure in the live frame state.
 */
export function desiredPoint(
  ship: SimShip,
  tick: number,
  resolve: ResolveReference,
): DesiredPoint | undefined {
  const spatial = ship.aiSpatial;
  if (spatial === undefined) return undefined;
  const P = resolve(spatial.reference, ship);
  if (P === undefined) return undefined;
  const dist = desiredDistance(spatial.range, ship);
  // Hold band: widen the station-keep dead-zone so a `hold` rule sits loosely on
  // its post. Other verbs leave the band to the controller default.
  const band = spatial.range.kind === "hold" ? spatial.range.band : undefined;
  // Offset bearings (offset/orbit) consume the radius to place the point; the
  // ship then sits ON that point (want = 0). Free/toward/away leave the point
  // at P and the range is held via `want`.
  const offsetting =
    spatial.bearing.kind === "offset" || spatial.bearing.kind === "orbit";
  const radius = offsetting ? dist : 0;
  const want = offsetting ? 0 : dist;
  const point = offsetPoint(spatial.bearing, P, radius, tick, resolve, ship);
  if (point === undefined) return undefined;
  return { x: point.x, y: point.y, want, band };
}

// ---------------------------------------------------------------------------
// Cohesion: own-formation centroid
// ---------------------------------------------------------------------------

/**
 * The centroid of the ship's OWN formation (its `formationId`), or undefined
 * when the ship has no formation identity or its formation has no alive
 * members. Used by the cohesion generalisation in `moveShips`: a ship in a
 * nested formation (chain length > 1) or carrying an `aiSpatial` override
 * blends toward THIS centroid instead of the whole-fleet centroid, so a
 * sub-formation holds its own shape rather than dissolving into the fleet.
 *
 * Determinism: the centroid is read from {@link buildAggregates}, which sums
 * member positions in instanceId-sorted order. Pure function of the live state.
 */
export function ownFormationCentroid(
  ship: SimShip,
  aggregates: ReadonlyMap<string, FormationAggregate>,
): { x: number; y: number } | undefined {
  const id = ship.formationId;
  if (id === undefined) return undefined;
  const agg = aggregates.get(id);
  if (agg === undefined || agg.memberCount === 0) return undefined;
  return { x: agg.centroidX, y: agg.centroidY };
}

/**
 * The cohesion centroid for `ship` this tick: its OWN formation's centroid when
 * the cohesion generalisation gate holds (the ship is nested in a sub-formation
 * — `formationChain` length > 1 — OR carries an `aiSpatial` override), otherwise
 * the whole-fleet centroid `wholeFleetCentroid` (the existing preset behaviour).
 * The gate keeps a flat preset fleet (chain length 1, no aiSpatial) on the
 * whole-fleet centroid byte-identically. Returns undefined when the chosen
 * centroid does not resolve (no alive members). Pure.
 */
export function cohesionCentroidFor(
  ship: SimShip,
  wholeFleetCentroid: { x: number; y: number } | undefined,
  aggregates: ReadonlyMap<string, FormationAggregate>,
): { x: number; y: number } | undefined {
  const nested =
    (ship.formationChain?.length ?? 0) > 1 || ship.aiSpatial !== undefined;
  return nested ? ownFormationCentroid(ship, aggregates) : wholeFleetCentroid;
}
