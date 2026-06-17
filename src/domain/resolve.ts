import { createId } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import { cellToLocal, deriveClassification, footprint } from "@/domain/grid";
import type { Catalog } from "@/domain/catalog";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Fleet, FleetShip } from "@/schema/fleet";
import type { GridCell } from "@/schema/grid";
import type { ModuleEffect } from "@/schema/module";
import type { ShipDesign } from "@/schema/ship";

/**
 * Resolve a fleet's deployed ships into combat-ready ships. The caller supplies
 * the saved designs keyed by id (typically loaded from storage). A deployed
 * ship whose design cannot be found is skipped — it has nothing to fight with —
 * so callers should validate fleet completeness beforehand.
 *
 * Fleets are authored in "attacker" coordinates (left side of the arena,
 * facing right). When a fleet is used as the defender we mirror it to the
 * opposite side — negating x and rotating facing by π — so the two sides
 * actually meet across the map instead of stacking up.
 *
 * Each resolved ship carries the per-cell module instances (with initial hit
 * points and the module effect) and its classification, derived from the grid,
 * so the engine can run the per-module damage / fire / regen model and the
 * grid-exact break-apart.
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
    const { stats } = analyseShipDesign(design, catalog);
    const placement = side === "defender" ? mirrorPlacement(deployed) : deployed;
    const modules = resolveModules(design, catalog);
    ships.push({
      instanceId: createId("ship"),
      designId: design.id,
      side,
      stats,
      position: placement.position,
      facing: placement.facing,
      orders: placement.orders,
      classification: deriveClassification(design.grid),
      ...(modules.length > 0 ? { modules } : {}),
    });
  }
  return ships;
}

/**
 * Build the per-cell module instances for a ship design. Every occupied cell
 * becomes a `ResolvedModule`: hull cells resolve to kind "hull" with the tile's
 * mass and hp; module cells resolve to their catalog module. Empty cells are
 * skipped. Each module's `(x, y)` is the cell's ship-local centre from
 * `cellToLocal`, and its integer `(col, row)` are carried through so break-apart
 * can union over exact 4-connected neighbours.
 */
function resolveModules(design: ShipDesign, catalog: Catalog): ResolvedModule[] {
  const grid = design.grid;
  const out: ResolvedModule[] = [];
  for (const { col, row } of footprint(grid)) {
    const cell = grid.cells[row * grid.cols + col];
    if (cell === undefined) continue;
    const local = cellToLocal(col, row, grid);
    const slotId = `cell-${col}-${row}`;

    if (cell.kind === "hull") {
      const tile = catalog.hullTile(cell.tile);
      if (tile === undefined) continue;
      out.push({
        slotId,
        moduleId: `hull-${cell.tile}`,
        kind: "hull",
        col,
        row,
        x: local.x,
        y: local.y,
        maxHp: tile.hp,
        mass: tile.mass,
        powerDraw: 0,
        effect: { kind: "hull" },
        command: false,
        repairRate: 0,
        shieldArc: Math.PI * 2,
        shieldFacing: 0,
        facing: 0,
        weaponFacing: 0,
      });
      continue;
    }

    if (cell.kind === "module") {
      const moduleDef = catalog.module(cell.moduleId);
      if (moduleDef === undefined) continue;
      out.push({
        slotId,
        moduleId: moduleDef.id,
        kind: moduleDef.effect.kind,
        col,
        row,
        x: local.x,
        y: local.y,
        maxHp: baseHpFor(moduleDef.effect.kind),
        mass: moduleDef.mass,
        powerDraw: moduleDef.powerDraw,
        effect: moduleDef.effect,
        command: moduleDef.command === true,
        repairRate: repairRateFor(moduleDef.effect),
        // Directional shield defaults: a missing arc means a full-sphere
        // shield, a missing facing defaults to 0 (along +x).
        shieldArc: moduleDef.shieldArc ?? Math.PI * 2,
        shieldFacing: moduleDef.shieldFacing ?? 0,
        // The cell's facing is the module's mount direction (ship-local):
        // engines thrust along it, weapons fire along it.
        facing: engineFacingFor(moduleDef.effect, cell),
        weaponFacing: weaponFacingFor(moduleDef.effect, cell),
      });
    }
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
    case "repair":
      return 25;
    case "hull":
      return 60;
  }
}

/** Read the per-tick HP-heal rate off a module's effect. Only repair modules
 *  have one; every other kind contributes 0. */
function repairRateFor(effect: ModuleEffect): number {
  if (effect.kind === "repair") return effect.repairRate;
  return 0;
}

/** Engine thrust direction (radians, ship-local): the cell's facing for an
 *  engine, 0 for everything else (their facing is unused by the engine). */
function engineFacingFor(effect: ModuleEffect, cell: GridCell): number {
  if (effect.kind !== "engine") return 0;
  return cell.kind === "module" ? cell.facing : 0;
}

/** Weapon fire direction (radians, ship-local): the cell's facing for a
 *  weapon, 0 for everything else. */
function weaponFacingFor(effect: ModuleEffect, cell: GridCell): number {
  if (effect.kind !== "weapon") return 0;
  return cell.kind === "module" ? cell.facing : 0;
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
