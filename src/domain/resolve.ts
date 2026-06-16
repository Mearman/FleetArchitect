import { createId } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { Catalog } from "@/domain/catalog";
import type { CombatShip } from "@/domain/simulation/types";
import type { Fleet, FleetShip } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";

/**
 * Resolve a fleet's deployed ships into combat-ready ships. The caller supplies
 * the saved designs keyed by id (typically loaded from storage). A deployed
 * ship whose design or hull cannot be found is skipped — it has nothing to
 * fight with — so callers should validate fleet completeness beforehand.
 *
 * Fleets are authored in "attacker" coordinates (left side of the arena,
 * facing right). When a fleet is used as the defender we mirror it to the
 * opposite side — negating x and rotating facing by π — so the two sides
 * actually meet across the map instead of stacking up.
 */
export function resolveFleetToCombatShips(
  fleet: Fleet,
  designs: ReadonlyMap<string, ShipDesign>,
  catalog: Catalog,
  side: "attacker" | "defender",
): CombatShip[] {
  const ships: CombatShip[] = [];
  for (const deployed of fleet.ships) {
    const design = designs.get(deployed.designId);
    if (design === undefined) continue;
    const hull = catalog.hull(design.hullId);
    if (hull === undefined) continue;
    const { stats } = analyseShipDesign(design, hull, catalog);
    const placement = side === "defender" ? mirrorPlacement(deployed) : deployed;
    ships.push({
      instanceId: createId("ship"),
      designId: design.id,
      side,
      stats,
      position: placement.position,
      facing: placement.facing,
      orders: placement.orders,
      classification: hull.classification,
    });
  }
  return ships;
}

/** Reflect a deployment across the y-axis: negate x, add π to facing. */
function mirrorPlacement(ship: FleetShip): FleetShip {
  return {
    designId: ship.designId,
    position: { x: -ship.position.x, y: ship.position.y },
    facing: ship.facing + Math.PI,
    orders: ship.orders,
  };
}
