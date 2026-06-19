/**
 * Debris fields: the wreckage a destroyed ship or break-apart chunk leaves
 * behind. A debris entity persists after its parent is gone, drifts
 * frictionlessly (Newtonian — real space has no drag), and is both a kinetic
 * hazard (a hit transfers momentum, routed through the unified damage pipeline
 * in Phase 5) and a line-of-sight occluder (it shadows EM rays in Phase 9).
 *
 * Use-deferred (Phase 12): the entity and its honest motion are modelled here;
 * spawning on destruction, hazard damage, and occlusion wiring come later.
 */

import type { Vec2 } from "@/schema/primitives";

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
  };
}

/** Advance a debris entity one tick: pure Newtonian drift — position advances
 *  by velocity, velocity is unchanged (no drag, no gravity here; body-list
 *  gravity is added when debris is wired into the integrator). Returns a new
 *  entity; the input is not mutated (deterministic, snapshot-friendly). */
export function stepDebris(debris: Debris): Debris {
  return {
    ...debris,
    x: debris.x + debris.velX,
    y: debris.y + debris.velY,
  };
}
