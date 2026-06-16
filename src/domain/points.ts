import type { ShipStats } from "./stats";

/** The build-point budget for a fleet. Tunable per scenario later. */
export const DEFAULT_FLEET_BUDGET = 4000;

/** Total build points across a set of analysed ship stats. */
export function fleetPointTotal(analyses: readonly ShipStats[]): number {
  return analyses.reduce((sum, stats) => sum + stats.cost, 0);
}
