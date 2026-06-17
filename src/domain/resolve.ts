import { createId } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { Catalog } from "@/domain/catalog";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Fleet, FleetShip } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { HullDefinition } from "@/schema/hull";

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
 *
 * Each resolved ship also carries the per-module instances (with initial hit
 * points and the module effect) so the engine can run the per-module
 * damage / fire / regen model — the foundation for power, ammo, the
 * bridge, and crew.
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
    const modules = resolveModules(design, hull, catalog);
    ships.push({
      instanceId: createId("ship"),
      designId: design.id,
      side,
      stats,
      position: placement.position,
      facing: placement.facing,
      orders: placement.orders,
      classification: hull.classification,
      ...(modules.length > 0 ? { modules } : {}),
    });
  }
  return ships;
}

/** Build the per-module instances for a ship design. */
function resolveModules(
  design: ShipDesign,
  hull: HullDefinition,
  catalog: Catalog,
): ResolvedModule[] {
  const slotById = new Map(hull.slots.map((s) => [s.id, s]));
  const out: ResolvedModule[] = [];
  for (const placement of design.placements) {
    const moduleDef = catalog.module(placement.moduleId);
    const slot = slotById.get(placement.slotId);
    if (moduleDef === undefined || slot === undefined) continue;
    out.push({
      slotId: placement.slotId,
      moduleId: placement.moduleId,
      kind: moduleDef.effect.kind,
      x: slot.position.x,
      y: slot.position.y,
      maxHp: baseHpFor(moduleDef.effect.kind),
      mass: moduleDef.mass,
      powerDraw: moduleDef.powerDraw,
      effect: moduleDef.effect,
      command: moduleDef.command === true,
    });
  }
  return out;
}

function baseHpFor(kind: ResolvedModule["kind"]): number {
  switch (kind) {
    case "weapon":
      return 25;
    case "shield":
      return 35;
    case "armour":
      return 50;
    case "engine":
      return 30;
    case "power":
      return 20;
    case "crew":
      return 15;
    case "pointDefense":
      return 20;
  }
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
