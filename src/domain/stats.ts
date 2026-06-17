import {
  deriveMass,
  footprint,
  isConnected4,
  occupiedCount,
} from "@/domain/grid";
import type { GridCell } from "@/schema/grid";
import type { ModuleDefinition, WeaponEffect } from "@/schema/module";
import type { ShipDesign } from "@/schema/ship";
import type { EntityId } from "@/schema/primitives";
import type { Catalog } from "./catalog";

export interface ResolvedWeapon {
  slotId: EntityId;
  effect: WeaponEffect;
}

/** Aggregated, derived stats for a fully-resolved ship design. */
export interface ShipStats {
  mass: number;
  /** Mass budget for this grid, derived from the number of occupied cells. */
  massCapacity: number;
  cost: number;
  powerDraw: number;
  powerOutput: number;
  powerNet: number;
  crewRequired: number;
  crewCapacity: number;
  crewNet: number;
  structure: number;
  damageReduction: number;
  shieldCapacity: number;
  shieldRechargeRate: number;
  shieldRechargeDelay: number;
  thrust: number;
  turnRate: number;
  weapons: readonly ResolvedWeapon[];
}

/** A reason a ship design cannot be built as-is. */
export type DesignFault =
  | { kind: "empty" }
  | { kind: "disconnected" }
  | { kind: "noCommand" }
  | { kind: "unknownModule"; col: number; row: number; moduleId: EntityId }
  | { kind: "unknownHullTile"; col: number; row: number; tile: string }
  | { kind: "massExceeded"; mass: number; capacity: number }
  | { kind: "powerDeficit"; net: number }
  | { kind: "crewDeficit"; net: number }
  /** Parts from more than one faction are present on this design. A valid
   *  ship uses tiles and modules exclusively from the design's own faction. */
  | { kind: "crossFaction"; expected: string; found: string[] };

export interface ShipDesignAnalysis {
  stats: ShipStats;
  faults: readonly DesignFault[];
  valid: boolean;
}

interface MutableStats extends Omit<ShipStats, "weapons"> {
  weapons: ResolvedWeapon[];
}

/**
 * Mass budget per occupied cell, in mass units. A grid's total budget scales
 * with how many cells it uses, so larger hulls legitimately carry more mass;
 * a design that overstuffs its cells with the heaviest modules exceeds it.
 * Tuned so a typical mixed loadout fits comfortably while an all-heavy build
 * does not.
 */
export const MASS_BUDGET_PER_CELL = 18;

function emptyStats(massCapacity: number): MutableStats {
  return {
    mass: 0,
    massCapacity,
    cost: 0,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 0,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: [],
  };
}

function applyModule(
  stats: MutableStats,
  moduleDef: ModuleDefinition,
  slotId: EntityId,
): void {
  stats.cost += moduleDef.cost;
  stats.powerDraw += moduleDef.powerDraw;
  stats.crewRequired += moduleDef.crewRequired;

  const effect = moduleDef.effect;
  switch (effect.kind) {
    case "weapon":
      stats.weapons.push({ slotId, effect });
      break;
    case "shield":
      stats.shieldCapacity += effect.capacity;
      stats.shieldRechargeRate += effect.rechargeRate;
      // Use the worst (longest) recharge delay across shield generators.
      stats.shieldRechargeDelay = Math.max(
        stats.shieldRechargeDelay,
        effect.rechargeDelay,
      );
      break;
    case "armour":
      stats.structure += effect.hitpoints;
      stats.damageReduction = Math.max(stats.damageReduction, effect.damageReduction);
      break;
    case "engine":
      stats.thrust += effect.thrust;
      stats.turnRate += effect.turnRate;
      break;
    case "power":
      stats.powerOutput += effect.output;
      break;
    case "crew":
      stats.crewCapacity += effect.capacity;
      break;
    case "pointDefense":
    case "repair":
    case "hull":
      break;
  }
}

/** Mass of a single grid cell: a hull tile's mass, a module's mass, or 0 for
 *  an empty cell or a reference the catalog doesn't know (which is reported as
 *  a fault separately, so a zero-mass contribution there is harmless).
 *
 *  Pass the design's faction so the faction-specific tile variant (with its
 *  correct mass) is used rather than any arbitrary faction's variant. */
export function cellMass(cell: GridCell, catalog: Catalog, faction?: string): number {
  if (cell.kind === "hull") {
    const tile = faction !== undefined
      ? (catalog.hullTileFor(faction, cell.tile) ?? catalog.hullTile(cell.tile))
      : catalog.hullTile(cell.tile);
    return tile?.mass ?? 0;
  }
  if (cell.kind === "module") return catalog.module(cell.moduleId)?.mass ?? 0;
  return 0;
}

/** Collect the set of faction names used by module cells in the grid.
 *  Hull tile cells only record a tile _type_ (block/edge/corner/strut) which is
 *  shared across factions; the faction is resolved from the catalog at render/
 *  stat time using the design's declared faction. Cross-faction violations are
 *  therefore only detectable through explicitly-identified modules.
 *  Unknown modules are skipped (those are reported as separate faults). */
function partFactions(grid: ShipDesign["grid"], catalog: Catalog): Set<string> {
  const factions = new Set<string>();
  for (const cell of grid.cells) {
    if (cell.kind === "module") {
      const mod = catalog.module(cell.moduleId);
      if (mod !== undefined) factions.add(mod.faction);
    }
  }
  return factions;
}

/**
 * Resolve a ship design against the catalog, producing aggregated stats and any
 * build-constraint faults. Pure and deterministic. The grid is the source of
 * truth: mass, structure, thrust, and the rest are summed over its occupied
 * cells. A valid design has all occupied cells 4-connected, at least one
 * command module, mass within the cell-derived budget, and a non-negative
 * power and crew balance.
 */
export function analyseShipDesign(
  design: ShipDesign,
  catalog: Catalog,
): ShipDesignAnalysis {
  const grid = design.grid;
  const faults: DesignFault[] = [];
  const cellCount = occupiedCount(grid);
  const massCapacity = cellCount * MASS_BUDGET_PER_CELL;
  const stats = emptyStats(massCapacity);

  let hasCommand = false;
  for (const { col, row } of footprint(grid)) {
    const cell = grid.cells[row * grid.cols + col];
    if (cell === undefined) continue;
    const slotId = `cell-${col}-${row}`;

    if (cell.kind === "hull") {
      // Use the faction-aware lookup so Swarm tiles use Swarm stats, not Terran.
      const tile =
        catalog.hullTileFor(design.faction, cell.tile) ??
        catalog.hullTile(cell.tile);
      if (tile === undefined) {
        faults.push({ kind: "unknownHullTile", col, row, tile: cell.tile });
        continue;
      }
      // Hull tiles are pure structure: they contribute mass and hull HP.
      stats.structure += tile.hp;
      continue;
    }

    if (cell.kind === "module") {
      const moduleDef = catalog.module(cell.moduleId);
      if (moduleDef === undefined) {
        faults.push({ kind: "unknownModule", col, row, moduleId: cell.moduleId });
        continue;
      }
      if (moduleDef.command === true) hasCommand = true;
      applyModule(stats, moduleDef, slotId);
    }
  }

  stats.mass = deriveMass(grid, (cell) => cellMass(cell, catalog, design.faction));
  stats.powerNet = stats.powerOutput - stats.powerDraw;
  stats.crewNet = stats.crewCapacity - stats.crewRequired;

  if (cellCount === 0) {
    faults.push({ kind: "empty" });
  } else if (!isConnected4(grid)) {
    faults.push({ kind: "disconnected" });
  }
  if (cellCount > 0 && !hasCommand) {
    faults.push({ kind: "noCommand" });
  }
  if (stats.mass > massCapacity) {
    faults.push({ kind: "massExceeded", mass: stats.mass, capacity: massCapacity });
  }
  if (stats.powerNet < 0) {
    faults.push({ kind: "powerDeficit", net: stats.powerNet });
  }
  if (stats.crewNet < 0) {
    faults.push({ kind: "crewDeficit", net: stats.crewNet });
  }

  // Validate faction purity: every part on this design must belong to the
  // design's declared faction. Parts from other factions produce a fault.
  const usedFactions = partFactions(grid, catalog);
  const wrongFactions = [...usedFactions].filter((f) => f !== design.faction);
  if (wrongFactions.length > 0) {
    faults.push({
      kind: "crossFaction",
      expected: design.faction,
      found: wrongFactions,
    });
  }

  return { stats, faults, valid: faults.length === 0 };
}
