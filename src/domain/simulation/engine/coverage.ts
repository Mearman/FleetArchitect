/**
 * Sensor/comms coverage shapes for the awareness snapshot — kept separate
 * from `awareness.ts` so neither exceeds the file-length guard.
 */

import { SIM } from "./config";
import type { CoverageShape } from "./sensors";
import { effectiveSensorArc, effectiveSensorBearing, effectiveSensorRange } from "./sensors";
import type { SimShip } from "./types";

/** The coverage shapes a ship contributes to its cluster's rendered footprint,
 *  in clear-space (un-attenuated) terms: the innate omni visual circle plus, per
 *  alive (manned-if-crewed) sensor, either a full circle (omni) or a sector
 *  (directional/dish/variable). A sector carries `bearing` (the cone's world
 *  centre) and `arc` (its half-arc); a circle omits both. */
export function coverageShapes(ship: SimShip): CoverageShape[] {
  const shapes: CoverageShape[] = [
    // The innate omni visual circle — always present, a full circle. Its radius
    // is the innate visual reach, so the rendered footprint matches the
    // detection reach `emReceives` grants.
    { x: ship.x, y: ship.y, r: SIM.visualLosRadius },
  ];
  if (ship.modules !== undefined) {
    // Iterate ship.modules directly rather than allocating a fresh SensorUnit[]
    // (plus one wrapper per alive manned sensor) via sensorUnitsOf each tick.
    // Guards mirror sensorUnitsOf exactly, preserving module-array iteration
    // order so the emitted shape sequence is byte-identical.
    for (const m of ship.modules) {
      if (!m.alive) continue;
      const effect = m.effect;
      if (effect.kind !== "sensor") continue;
      if (m.crewRequired > 0 && !m.manned) continue;
      const r = effectiveSensorRange(effect, m);
      const arc = effectiveSensorArc(effect, m);
      if (arc >= Math.PI) {
        // Omni sensor: a full circle, no bearing/arc.
        shapes.push({ x: ship.x, y: ship.y, r });
      } else {
        // Directional/dish/variable: a sector about the world bearing.
        shapes.push({ x: ship.x, y: ship.y, r, bearing: effectiveSensorBearing(m, ship), arc });
      }
    }
  }
  return shapes;
}
