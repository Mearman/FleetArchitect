import type { ShipStats } from "./stats";

/** The build-point budget for a fleet. Sized to field a dreadnought-led fleet
 *  (an apex capital plus a screen of escorts) with headroom, while still
 *  capping a swarm of mid-weight hulls. Tunable per scenario later. */
export const DEFAULT_FLEET_BUDGET = 20000;

/** Total build points across a set of analysed ship stats. */
export function fleetPointTotal(analyses: readonly ShipStats[]): number {
  return analyses.reduce((sum, stats) => sum + stats.cost, 0);
}
