/**
 * Debris fields: the wreckage a destroyed ship or break-apart chunk leaves
 * behind. A debris entity persists after its parent is gone, drifts
 * frictionlessly (Newtonian — real space has no drag), and is both a kinetic
 * hazard and a line-of-sight occluder.
 *
 * Spawning on destruction and per-tick drift are wired into the battle tick
 * loop (`engine/index.ts`): a destroyed hull leaves one fragment carrying its
 * centre-of-mass momentum, advanced each tick. In a black-hole battle the
 * per-tick step also applies the gravitational field to the fragment (debris
 * as a mass-less test particle — pulled by the well and by ships, but not
 * pulling back); in open space the fragment drifts at constant velocity.
 *
 * Kinetic hazard (Phase 12): each tick, any debris fragment whose bounding
 * disc overlaps a ship's bounding disc transfers kinetic energy to that ship's
 * hull via `applyDamage` (shields and armour apply; no piercing). Implemented
 * in the 2b-debris step in `engine/index.ts`.
 *
 * EM occlusion (Phase 12): each tick, the awareness phase rebuilds a per-tick
 * dynamic occluder list combining the static anomaly occluders with one Disc
 * per drifting fragment, so fragments block sensor lines-of-sight. Implemented
 * in the 0-awareness step in `engine/index.ts`.
 */

import type { Vec2 } from "@/schema/primitives";

import { buildGravityField, gravityAcceleration } from "./gravity";
import type { SimShip } from "./types";

/** A persistent piece of wreckage. Mass in kg; position/velocity in world m
 *  and m/tick (matching the sim's units). `radius` is its bounding radius for
 *  broad-phase occlusion/hazard queries, derived from the mass and an assumed
 *  density (so a heavier fragment is larger). */
export interface Debris {
  readonly id: string;
  x: number;
  y: number;
  velX: number;
  velY: number;
  /** Mass in kg — from the destroyed cells' material mass. */
  mass: number;
  radius: number;
  /** Whether this fragment carries recoverable material a passing ship may
   *  collect (salvage mechanics). Every spawned fragment is salvageable — it is a
   *  coherent piece of hull mass — so the salvage step adds its mass to whichever
   *  ship sweeps over it. The renderer marks salvageable fragments distinctly. */
  salvageable: boolean;
}

/** Assumed mean density of wreckage (kg/m^3) for converting mass to a bounding
 *  radius. A conservative rocky/metallic rubble value; the radius is only a
 *  broad-phase query bound, not a precise shape. */
const DEBRIS_DENSITY_KG_PER_M3 = 3_000;

/** Derive a bounding radius from a debris mass, assuming a roughly spherical
 *  fragment of `DEBRIS_DENSITY_KG_PER_M3`: r = (3m / (4·π·ρ))^(1/3). Pure
 *  function of mass; no hand-tuned radius. */
export function debrisRadius(mass: number): number {
  if (mass <= 0) return 0;
  return Math.cbrt((3 * mass) / (4 * Math.PI * DEBRIS_DENSITY_KG_PER_M3));
}

/** Spawn a piece of debris inheriting a parent's centre-of-mass velocity (so a
 *  destroyed ship's wreckage keeps its momentum — Newton's first law) plus a
 *  breakup impulse `kick` (world m/tick) from the destruction event. Mass and
 *  radius derived, not tuned. */
export function spawnDebris(
  id: string,
  origin: Vec2,
  parentVelocity: Vec2,
  kick: Vec2,
  mass: number,
): Debris {
  return {
    id,
    x: origin.x,
    y: origin.y,
    velX: parentVelocity.x + kick.x,
    velY: parentVelocity.y + kick.y,
    mass,
    radius: debrisRadius(mass),
    // A coherent hull fragment always carries recoverable mass, so it is
    // salvageable from the moment it spawns.
    salvageable: true,
  };
}

/** Advance a debris entity one tick: Newtonian drift under the gravitational
 *  acceleration `gravity` (world units per tick², summed over the per-tick
 *  N-body field — the black hole and every alive ship, treating debris as a
 *  mass-less test particle that is pulled but does not pull back). When
 *  `gravity` is omitted (no black-hole anomaly, so no field) the fragment
 *  drifts frictionlessly at constant velocity. The integration is semi-implicit
 *  (symplectic) Euler — velocity first, then position with the new velocity —
 *  matching the scheme ships use, so orbital drift near the well is stable.
 *  Returns a new entity; the input is not mutated (deterministic,
 *  snapshot-friendly). */
export function stepDebris(
  debris: Debris,
  gravity?: { ax: number; ay: number },
): Debris {
  if (gravity === undefined) {
    return {
      ...debris,
      x: debris.x + debris.velX,
      y: debris.y + debris.velY,
    };
  }
  const velX = debris.velX + gravity.ax;
  const velY = debris.velY + gravity.ay;
  return {
    ...debris,
    velX,
    velY,
    x: debris.x + velX,
    y: debris.y + velY,
  };
}

/** Advance every fragment in `debris` one tick, mutating the array in place.
 *  In a black-hole battle (`hasBlackHole` true) the gravitational field is built
 *  fresh from the current ship positions and each fragment is accelerated as a
 *  mass-less test particle — pulled by the well and by every alive ship, but not
 *  pulling back (wreckage mass is negligible). The field uses the same
 *  simultaneous-snapshot convention as the ship gravity step. Without a black
 *  hole the field is not built and every fragment drifts frictionlessly. */
export function stepDebrisField(
  debris: Debris[],
  ships: readonly SimShip[],
  hasBlackHole: boolean,
): void {
  if (debris.length === 0) return;
  const field = hasBlackHole ? buildGravityField(ships) : undefined;
  for (let i = 0; i < debris.length; i++) {
    const d = debris[i];
    if (d === undefined) continue;
    debris[i] = stepDebris(
      d,
      field !== undefined ? gravityAcceleration(field, d.id, d.x, d.y) : undefined,
    );
  }
}
