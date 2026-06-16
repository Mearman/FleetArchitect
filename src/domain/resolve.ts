import { createId } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { Catalog } from "@/domain/catalog";
import type { CombatShip } from "@/domain/simulation/types";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";

/**
 * Resolve a fleet's deployed ships into combat-ready ships. The caller supplies
 * the saved designs keyed by id (typically loaded from storage). A deployed
 * ship whose design or hull cannot be found is skipped — it has nothing to
 * fight with — so callers should validate fleet completeness beforehand.
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
    ships.push({
      instanceId: createId("ship"),
      designId: design.id,
      side,
      stats,
      position: deployed.position,
      facing: deployed.facing,
      orders: deployed.orders,
      classification: hull.classification,
    });
  }
  return ships;
}
