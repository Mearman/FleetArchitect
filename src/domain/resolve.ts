import { createId } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import { cellToLocal, deriveClassification, deriveRadius, footprint } from "@/domain/grid";
import type { Catalog } from "@/domain/catalog";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Fleet } from "@/schema/fleet";
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
/**
 * Where a fleet forms up, in battle units. Ships deploy in a vertical column
 * inset from their own side's edge — attackers on the left facing right (+x),
 * defenders mirrored on the right — rather than at hand-authored coordinates,
 * which rot the moment ship sizes change. Each ship's centre sits one ship
 * radius inside the edge so its hull doesn't clip off-screen; ships stack down
 * the column spaced by their radii plus a margin so no two ever overlap at
 * tick 0 (overlap would trigger the collision-separation impulse and fling the
 * fleet apart before the battle starts). The column is centred on y = 0.
 */
const DEPLOY = {
  /** Distance of the formation line from the arena's vertical midline (x = 0). */
  edgeInset: 360,
  /** Vertical clear space between adjacent ships' hull circles. */
  shipMargin: 18,
};

export function resolveFleetToCombatShips(
  fleet: Fleet,
  designs: ReadonlyMap<string, ShipDesign>,
  catalog: Catalog,
  side: "attacker" | "defender",
): CombatShip[] {
  // Resolve every deployable design first, carrying its radius so the column
  // can be spaced by actual ship size.
  const resolved = fleet.ships
    .map((deployed) => {
      const design = designs.get(deployed.designId);
      if (design === undefined) return undefined;
      return { deployed, design, radius: deriveRadius(design.grid) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

  // Total column height: every ship's diameter plus a margin between each pair.
  const totalHeight =
    resolved.reduce((sum, e) => sum + e.radius * 2, 0) +
    Math.max(0, resolved.length - 1) * DEPLOY.shipMargin;

  // Attackers face right (+x) from the left edge; defenders mirror to the right
  // edge facing left (π). Lay the column out top (most negative y) to bottom,
  // centred on y = 0.
  const dir = side === "attacker" ? -1 : 1;
  const facing = side === "attacker" ? 0 : Math.PI;
  let cursorY = -totalHeight / 2;

  const ships: CombatShip[] = [];
  for (const { deployed, design, radius } of resolved) {
    const { stats } = analyseShipDesign(design, catalog);
    const modules = resolveModules(design, catalog);
    const x = dir * (DEPLOY.edgeInset - radius);
    const y = cursorY + radius;
    cursorY += radius * 2 + DEPLOY.shipMargin;
    ships.push({
      instanceId: createId("ship"),
      designId: design.id,
      side,
      stats,
      position: { x, y },
      facing,
      orders: deployed.orders,
      classification: deriveClassification(design.grid),
      ...(modules.length > 0 ? { modules } : {}),
    });
  }
  return ships;
}

/**
 * Build the per-cell module instances for a ship design. Every occupied cell
 * becomes a `ResolvedModule`: hull cells resolve to kind "hull" with the tile's
 * mass and hp; module cells resolve to their catalog module. Empty cells and
 * floor cells are skipped — floor is walkable interior decking that contributes
 * to the walkable path graph (read directly from the grid by the crew engine)
 * but has no module behaviour of its own. Each module's `(x, y)` is the cell's
 * ship-local centre from `cellToLocal`, and its integer `(col, row)` are carried
 * through so break-apart can union over exact 4-connected neighbours.
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
        crewRequired: 0,
        effect: { kind: "hull" },
        command: false,
        repairRate: 0,
        shieldArc: Math.PI * 2,
        shieldFacing: 0,
        facing: 0,
        weaponFacing: 0,
        turretArc: 0,
        turretTurnRate: 0,
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
        crewRequired: moduleDef.crewRequired,
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
        // Turret traverse comes off the weapon effect; non-turret and
        // non-weapon modules carry 0 (a fixed mount).
        turretArc: turretArcFor(moduleDef.effect),
        turretTurnRate: turretTurnRateFor(moduleDef.effect),
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
    case "magazine":
      return 40;
    // Phase A: sensor and comms modules are inert system components.
    // HP matches a mid-range electronics module — more fragile than armour,
    // sturdier than crew quarters.
    case "sensor":
      return 20;
    case "comms":
      return 20;
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

/** Turret traverse half-arc (radians) for a weapon; 0 (fixed mount) otherwise. */
function turretArcFor(effect: ModuleEffect): number {
  if (effect.kind !== "weapon") return 0;
  return effect.turretArc ?? 0;
}

/** Turret slew speed (radians per tick) for a weapon; 0 (fixed) otherwise. */
function turretTurnRateFor(effect: ModuleEffect): number {
  if (effect.kind !== "weapon") return 0;
  return effect.turretTurnRate ?? 0;
}
