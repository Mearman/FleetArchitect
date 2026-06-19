/**
 * Sensor/comms coverage shapes for the awareness snapshot — kept separate
 * from `awareness.ts` so neither exceeds the file-length guard.
 */

import { SIM } from "./config";
import type { CoverageShape } from "./sensors";
import { effectiveSensorArc, effectiveSensorBearing, effectiveSensorRange, sensorUnitsOf } from "./sensors";
import type { SimShip } from "./types";

/** The coverage shapes a ship contributes to its cluster's rendered footprint,
 *  in clear-space (un-attenuated) terms: the innate omni visual circle plus, per
 *  alive (manned-if-crewed) sensor, either a full circle (omni) or a sector
 *  (directional/dish/variable). A sector carries `bearing` (the cone's world
 *  centre) and `arc` (its half-arc); a circle omits both. */
export function coverageShapes(ship: SimShip): CoverageShape[] {
  const shapes: CoverageShape[] = [
    // The innate omni visual circle — always present, a full circle.
    { x: ship.x, y: ship.y, r: SIM.visualLosRadius },
  ];
  for (const unit of sensorUnitsOf(ship)) {
    const r = effectiveSensorRange(unit);
    const arc = effectiveSensorArc(unit);
    if (arc >= Math.PI) {
      // Omni sensor: a full circle, no bearing/arc.
      shapes.push({ x: ship.x, y: ship.y, r });
    } else {
      // Directional/dish/variable: a sector about the world bearing.
      shapes.push({ x: ship.x, y: ship.y, r, bearing: effectiveSensorBearing(unit), arc });
    }
  }
  return shapes;
}
