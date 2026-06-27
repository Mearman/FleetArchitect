/**
 * Doctrine accessors — the engine's movement/targeting reads over the unified
 * {@link Doctrine}. Each reads the relevant doctrine axis directly; the engine
 * compiles `SimShip.doctrine` from the authored design/leaf doctrine, so these
 * values equal the authored intent by construction.
 */

import { SIM } from "./config";
import type { SimShip } from "./types";

/**
 * The default at-range dead-zone fraction — the width of the "at range" band as
 * a fraction of the desired engagement range, used when a ship's doctrine
 * authors no explicit `tolerance` on its spatial range objective. A ship within
 * `desiredRange ± band · desiredRange / 2` considers itself correctly
 * positioned and stops thrusting to close or open range. Mirrors the legacy
 * `defaultOrders.rangeKeepingBand` (0.3); classification: authored tactical
 * doctrine (range-keeping dead-zone).
 */
const DEFAULT_RANGE_KEEPING_BAND = 0.3;

/** Hold-station range? (doctrine `spatial.range.kind === "hold"`). */
export function isHoldRange(ship: SimShip): boolean {
  return ship.doctrine.base.spatial?.range?.kind === "hold";
}

/**
 * The fraction of maximum weapon range the ship engages at (doctrine
 * `spatial.range` `engage.fraction`). Defaults to the medium-range fraction
 * when no spatial range objective is authored. The caller must guard the hold
 * case — a hold ship has no engage fraction (it returns 0 from `desiredRange`).
 */
export function engageFractionOf(ship: SimShip): number {
  const range = ship.doctrine.base.spatial?.range;
  if (range?.kind === "engage") return range.fraction;
  // No authored range objective: default to the medium engagement fraction.
  return SIM.rangeFraction.medium;
}

/**
 * The at-range dead-zone fraction (doctrine `engage`/`maintain` `tolerance`).
 * Reached only on the non-hold path, so the range is `engage`. Defaults to the
 * legacy range-keeping band when no tolerance is authored.
 */
export function rangeBand(ship: SimShip): number {
  const range = ship.doctrine.base.spatial?.range;
  if (range?.kind === "engage" || range?.kind === "maintain") {
    return range.tolerance;
  }
  return DEFAULT_RANGE_KEEPING_BAND;
}
