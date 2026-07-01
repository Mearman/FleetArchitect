/**
 * Energy-weapon beam emissions: the visible record a hitscan beam weapon
 * produces when it strikes. A beam applies damage instantly and spawns no
 * projectile, so without a carried emission record the renderer has nothing to
 * draw. Each beam lingers in the engine's `beams` array for a few ticks
 * (decremented by the tick loop) so the renderer can draw it as a fading line
 * from the firing gun cell to the strike point.
 *
 * Pure render state: damage is applied once at the moment of emission (in
 * `fireOne`); the carried `SimBeam` never damages. The tick loop ages and culls
 * the array; the snapshot serialises the survivors when non-empty.
 */

import type { WeaponType } from "@/schema/module";

/**
 * A visible energy-weapon beam emission carried across ticks for the renderer.
 * The source is the firing gun cell's world position at the moment of emission;
 * the target is the strike point on the target's hull. Persists for
 * `emissionTicks` ticks (decremented by the loop) so the renderer can draw the
 * beam as a line that lingers rather than vanishing in one frame.
 */
export interface SimBeam {
  /** Instance id of the ship that fired the beam. */
  sourceId: string;
  /** World position of the firing gun cell at emission. */
  sourceX: number;
  sourceY: number;
  /** World position of the beam's strike point on the target's hull. */
  targetX: number;
  targetY: number;
  /** Weapon type that produced the beam, for colour lookup. */
  kind: WeaponType;
  /** Real energy the beam deposited at its strike, Joules (the range-scaled
   *  damage applied in `fireOne`). Threads the strike's energy into the
   *  particle-intensity model for the channel-glow and impact-burst emitters. */
  damageJ: number;
  /** Ticks remaining before the emission expires (renderer fades the line). */
  emissionTicks: number;
}

/**
 * Age every beam's emission by one tick, dropping expired entries. Mutates each
 * survivor's `emissionTicks` in place and returns the survivors in input order,
 * so two same-seed runs emit byte-identical beam arrays. Empty input returns an
 * empty array without allocating, keeping the common no-beam tick cheap.
 */
export function ageBeams(beams: readonly SimBeam[]): SimBeam[] {
  if (beams.length === 0) return [];
  const survivors: SimBeam[] = [];
  for (const beam of beams) {
    const remaining = beam.emissionTicks - 1;
    if (remaining > 0) {
      beam.emissionTicks = remaining;
      survivors.push(beam);
    }
  }
  return survivors;
}
