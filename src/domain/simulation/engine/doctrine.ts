/**
 * Doctrine accessors — the bridge the engine's movement/targeting/crew reads
 * cross to consume the unified {@link Doctrine} while the legacy `orders`/
 * `shipStance`/`crewPriority`/`rules` fields still exist. Each prefers the
 * doctrine axis and falls back to the legacy field when the doctrine is absent
 * (a direct-constructed test SimShip, or a ship authored before the switch).
 *
 * `toSimShip` compiles `SimShip.doctrine` from the legacy trio/orders, so for
 * every run-of-battle ship the doctrine value equals the legacy value by
 * construction — every read here is byte-identical to the pre-doctrine engine.
 * The fallbacks and the legacy fields are dropped once no consumer reads them.
 */

import { SIM } from "./config";
import type { SimShip } from "./types";

/** Hold-station range? (doctrine `hold` range, legacy `engageRange:"hold"`). */
export function isHoldRange(ship: SimShip): boolean {
  return (
    ship.doctrine?.base.spatial?.range?.kind === "hold" ||
    ship.orders.engageRange === "hold"
  );
}

/**
 * The fraction of maximum weapon range the ship engages at (doctrine
 * `engage.fraction`, else `SIM.rangeFraction` keyed by the legacy
 * `engageRange`). The caller must guard the hold case — a hold ship has no
 * engage fraction (it returns 0 from `desiredRange`).
 */
export function engageFractionOf(ship: SimShip): number {
  const range = ship.doctrine?.base.spatial?.range;
  if (range?.kind === "engage") return range.fraction;
  switch (ship.orders.engageRange) {
    case "short":
      return SIM.rangeFraction.short;
    case "medium":
      return SIM.rangeFraction.medium;
    case "long":
      return SIM.rangeFraction.long;
    case "hold":
      // Unreachable: the caller guards hold. Return medium so the switch is
      // exhaustive without indexing SIM.rangeFraction (which lacks `hold`).
      return SIM.rangeFraction.medium;
  }
}

/**
 * The at-range dead-zone fraction (doctrine `engage`/`maintain` `tolerance`,
 * legacy `rangeKeepingBand`). Reached only on the non-hold path, so the range
 * is `engage`.
 */
export function rangeBand(ship: SimShip): number {
  const range = ship.doctrine?.base.spatial?.range;
  if (range?.kind === "engage" || range?.kind === "maintain") {
    return range.tolerance;
  }
  return ship.orders.rangeKeepingBand;
}
