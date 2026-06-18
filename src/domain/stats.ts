import {
  deriveMass,
  footprint,
  isConnected4,
  occupiedCount,
  reachableFrom,
} from "@/domain/grid";
import type { GridCell } from "@/schema/grid";
import type { ModuleDefinition, WeaponEffect } from "@/schema/module";
import type { ShipDesign } from "@/schema/ship";
import type { EntityId } from "@/schema/primitives";
import type { Catalog } from "./catalog";

/**
 * Fault severity. "error" faults block deployment (the design is invalid);
 * "warning" faults are informational — they may indicate a sub-optimal build
 * but do not make the design undeployable.
 */
export type FaultSeverity = "error" | "warning";

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
  /**
   * Aggregated sensor reach (world units) for a non-modular ship, added to the
   * innate visual radius to give its effective detection range — the aggregated
   * analogue of how `weapons` aggregates weaponry. Absent (or 0) means the ship
   * carries no sensors and sees only out to the innate visual radius. Modular
   * ships derive detection from their sensor modules instead and ignore this.
   */
  sensorRange?: number;
}

/** A reason a ship design cannot be built as-is (error), or an advisory note (warning). */
export type DesignFault =
  // ---- Error-level faults (block deployment) ----
  | { kind: "empty"; severity: "error" }
  | { kind: "disconnected"; severity: "error" }
  | { kind: "noCommand"; severity: "error" }
  | { kind: "unknownModule"; severity: "error"; col: number; row: number; moduleId: EntityId }
  | { kind: "unknownHullTile"; severity: "error"; col: number; row: number; tile: string }
  | { kind: "massExceeded"; severity: "error"; mass: number; capacity: number }
  | { kind: "powerDeficit"; severity: "error"; net: number }
  | { kind: "crewDeficit"; severity: "error"; net: number }
  /** Parts from more than one faction are present on this design. A valid
   *  ship uses tiles and modules exclusively from the design's own faction. */
  | { kind: "crossFaction"; severity: "error"; expected: string; found: string[] }
  /**
   * A station that needs crew (crewRequired > 0) has no walkable path from any
   * crew-quarters cell. Only raised when at least one crew-quarters module exists
   * (a ship with no quarters simply has no crew — that is the crewDeficit case).
   * Both the station and the quarters must be on the walkable surface (hull,
   * module, or floor cells) connected by 4-adjacent edges.
   */
  | { kind: "unreachableStation"; severity: "error"; col: number; row: number; moduleId: EntityId }
  /**
   * A weapon with a finite ammo capacity (ammoCapacity is set) has no magazine
   * module (effect.kind === "magazine") reachable via a walkable path. Only
   * raised when at least one such weapon exists on the design.
   */
  | { kind: "noAmmoSource"; severity: "error"; col: number; row: number; moduleId: EntityId }
  // ---- Warning-level faults (informational, do not block deployment) ----
  /**
   * The design has no sensor module. The ship will rely on short visual range
   * only; it will not detect enemies until they are close.
   */
  | { kind: "noSensors"; severity: "warning" }
  /**
   * A comms unit is the only unit on its channel — nothing else on this ship
   * shares that channel, so it cannot relay data or form an intra-ship bridge.
   * Phrase: "comms unit on a channel nothing else uses".
   */
  | { kind: "commsIsland"; severity: "warning"; col: number; row: number; channel: number }
  /**
   * A dish or laser comms unit (crewRequired > 0) has no walkable path from any
   * crew-quarters cell. It can never be manned, so it will never link.
   * Only raised when at least one crew-quarters module exists on the design.
   */
  | { kind: "unmannedAimUnit"; severity: "warning"; col: number; row: number; moduleId: EntityId }
  /**
   * The design has comms modules but fewer than two, so it cannot relay
   * third-party contact data.
   */
  | { kind: "noRelay"; severity: "warning" };

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
    case "magazine":
    case "sensor": // Phase A: inert — mass/cost/power/crew apply; no detection effect yet
    case "comms":  // Phase A: inert — mass/cost/power/crew apply; no link effect yet
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
  let hasSensor = false;
  // Comms units grouped by channel: channel -> list of positions with moduleId.
  const commsUnitsByChannel = new Map<number, { col: number; row: number; moduleId: EntityId }[]>();
  // Aim units (dish or laser) that have crewRequired > 0.
  const aimUnitPositions: { col: number; row: number; moduleId: EntityId }[] = [];

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
        faults.push({ kind: "unknownHullTile", severity: "error", col, row, tile: cell.tile });
        continue;
      }
      // Hull tiles are pure structure: they contribute mass and hull HP.
      stats.structure += tile.hp;
      continue;
    }

    if (cell.kind === "module") {
      const moduleDef = catalog.module(cell.moduleId);
      if (moduleDef === undefined) {
        faults.push({ kind: "unknownModule", severity: "error", col, row, moduleId: cell.moduleId });
        continue;
      }
      if (moduleDef.command === true) hasCommand = true;
      if (moduleDef.effect.kind === "sensor") hasSensor = true;
      if (moduleDef.effect.kind === "comms") {
        // Resolve the effective channel: per-instance override wins over the
        // module definition's default channel.
        const effectiveChannel = cell.channel ?? moduleDef.effect.channel;
        const existing = commsUnitsByChannel.get(effectiveChannel);
        if (existing !== undefined) {
          existing.push({ col, row, moduleId: cell.moduleId });
        } else {
          commsUnitsByChannel.set(effectiveChannel, [{ col, row, moduleId: cell.moduleId }]);
        }
        // Track aim units (dish or laser) that require crew.
        if (
          (moduleDef.effect.commsType === "dish" || moduleDef.effect.commsType === "laser") &&
          moduleDef.crewRequired > 0
        ) {
          aimUnitPositions.push({ col, row, moduleId: cell.moduleId });
        }
      }
      applyModule(stats, moduleDef, slotId);
    }
  }

  stats.mass = deriveMass(grid, (cell) => cellMass(cell, catalog, design.faction));
  stats.powerNet = stats.powerOutput - stats.powerDraw;
  stats.crewNet = stats.crewCapacity - stats.crewRequired;

  if (cellCount === 0) {
    faults.push({ kind: "empty", severity: "error" });
  } else if (!isConnected4(grid)) {
    faults.push({ kind: "disconnected", severity: "error" });
  }
  if (cellCount > 0 && !hasCommand) {
    faults.push({ kind: "noCommand", severity: "error" });
  }
  if (stats.mass > massCapacity) {
    faults.push({ kind: "massExceeded", severity: "error", mass: stats.mass, capacity: massCapacity });
  }
  if (stats.powerNet < 0) {
    faults.push({ kind: "powerDeficit", severity: "error", net: stats.powerNet });
  }
  if (stats.crewNet < 0) {
    faults.push({ kind: "crewDeficit", severity: "error", net: stats.crewNet });
  }

  // Validate faction purity: every part on this design must belong to the
  // design's declared faction. Parts from other factions produce a fault.
  const usedFactions = partFactions(grid, catalog);
  const wrongFactions = [...usedFactions].filter((f) => f !== design.faction);
  if (wrongFactions.length > 0) {
    faults.push({
      kind: "crossFaction",
      severity: "error",
      expected: design.faction,
      found: wrongFactions,
    });
  }

  // ---------------------------------------------------------------------------
  // Reachability faults — require crew pathfinding over the walkable surface.
  //
  // We compute these only when the grid has occupied cells and is connected
  // (otherwise the connectivity and empty faults already describe the problem).
  // Disconnected grids have an undefined reachable graph, so checking paths
  // inside them would produce misleading results.
  // ---------------------------------------------------------------------------
  if (cellCount > 0 && isConnected4(grid)) {
    // Collect the grid-cell positions of every crew-quarters module (effect.kind
    // === "crew"). These are the sources from which crew walk to man stations.
    const quartersPositions: { col: number; row: number }[] = [];
    // Collect every crewed station (crewRequired > 0) and the positions of
    // every magazine module and every finite-ammo weapon.
    const crewedStations: { col: number; row: number; moduleId: EntityId }[] = [];
    const magazinePositions: { col: number; row: number }[] = [];
    const finiteAmmoWeapons: { col: number; row: number; moduleId: EntityId }[] = [];

    for (const { col, row } of footprint(grid)) {
      const cell = grid.cells[row * grid.cols + col];
      if (cell === undefined || cell.kind !== "module") continue;
      const moduleDef = catalog.module(cell.moduleId);
      if (moduleDef === undefined) continue;

      if (moduleDef.effect.kind === "crew") {
        quartersPositions.push({ col, row });
      }
      if (moduleDef.crewRequired > 0) {
        crewedStations.push({ col, row, moduleId: cell.moduleId });
      }
      if (moduleDef.effect.kind === "magazine") {
        magazinePositions.push({ col, row });
      }
      if (
        moduleDef.effect.kind === "weapon" &&
        moduleDef.effect.ammoCapacity !== undefined
      ) {
        finiteAmmoWeapons.push({ col, row, moduleId: cell.moduleId });
      }
    }

    // Unreachable-station fault: a crewed station with no walkable path from
    // any crew-quarters cell. Only checked when quarters exist — a design with
    // no quarters has a crewDeficit instead, which already covers the problem.
    //
    // We build the reachability set once and reuse it for the unmannedAimUnit
    // warning check further below (aim units also depend on crew reachability).
    let reachableFromAnyQuarters: Set<string> | undefined;
    if (quartersPositions.length > 0) {
      // Build the union of all cells reachable from any quarters cell. We start
      // from each quarters cell and collect the flood-fill, then union the sets.
      // This is cheaper than running findPath from every quarters to every station.
      reachableFromAnyQuarters = new Set<string>();
      for (const qPos of quartersPositions) {
        for (const key of reachableFrom(grid, qPos)) {
          reachableFromAnyQuarters.add(key);
        }
      }

      for (const station of crewedStations) {
        const key = `${station.col},${station.row}`;
        if (!reachableFromAnyQuarters.has(key)) {
          faults.push({
            kind: "unreachableStation",
            severity: "error",
            col: station.col,
            row: station.row,
            moduleId: station.moduleId,
          });
        }
      }
    }

    // No-ammo-source fault: a finite-ammo weapon with no magazine reachable via
    // a walkable path. Only checked when at least one such weapon exists.
    if (finiteAmmoWeapons.length > 0 && magazinePositions.length === 0) {
      // No magazines at all — every finite-ammo weapon is affected.
      for (const weapon of finiteAmmoWeapons) {
        faults.push({
          kind: "noAmmoSource",
          severity: "error",
          col: weapon.col,
          row: weapon.row,
          moduleId: weapon.moduleId,
        });
      }
    } else if (finiteAmmoWeapons.length > 0 && magazinePositions.length > 0) {
      // Build reachability sets from each magazine position once, then test
      // each weapon. A weapon is faulted only if no magazine can reach it.
      const reachableFromAnyMagazine = new Set<string>();
      for (const magPos of magazinePositions) {
        for (const key of reachableFrom(grid, magPos)) {
          reachableFromAnyMagazine.add(key);
        }
      }

      for (const weapon of finiteAmmoWeapons) {
        const key = `${weapon.col},${weapon.row}`;
        if (!reachableFromAnyMagazine.has(key)) {
          faults.push({
            kind: "noAmmoSource",
            severity: "error",
            col: weapon.col,
            row: weapon.row,
            moduleId: weapon.moduleId,
          });
        }
      }
    }

    // -------------------------------------------------------------------------
    // Warning-level faults — sensors and comms advisory checks.
    // These are computed only on connected, non-empty grids to avoid noise
    // when the design is already fundamentally broken.
    // -------------------------------------------------------------------------

    // noSensors: no sensor module at all; ship will fight on short visual range.
    if (!hasSensor) {
      faults.push({ kind: "noSensors", severity: "warning" });
    }

    // commsIsland: a channel that only a single comms unit on this ship uses —
    // it can never bridge or relay anything intra-ship.
    for (const [channel, units] of commsUnitsByChannel) {
      if (units.length === 1) {
        const unit = units[0];
        if (unit !== undefined) {
          faults.push({
            kind: "commsIsland",
            severity: "warning",
            col: unit.col,
            row: unit.row,
            channel,
          });
        }
      }
    }

    // noRelay: the design has comms modules but fewer than 2 total comms units,
    // so it cannot relay third-party contact data to other ships.
    const totalCommsUnits = [...commsUnitsByChannel.values()].reduce(
      (sum, units) => sum + units.length,
      0,
    );
    if (totalCommsUnits > 0 && totalCommsUnits < 2) {
      faults.push({ kind: "noRelay", severity: "warning" });
    }

    // unmannedAimUnit: a dish or laser comms unit with crewRequired > 0 but no
    // walkable path from any crew-quarters cell. Only checked when quarters exist
    // (reachableFromAnyQuarters was built above in the unreachable-station block).
    if (reachableFromAnyQuarters !== undefined && aimUnitPositions.length > 0) {
      for (const aimUnit of aimUnitPositions) {
        const key = `${aimUnit.col},${aimUnit.row}`;
        if (!reachableFromAnyQuarters.has(key)) {
          faults.push({
            kind: "unmannedAimUnit",
            severity: "warning",
            col: aimUnit.col,
            row: aimUnit.row,
            moduleId: aimUnit.moduleId,
          });
        }
      }
    }
  }

  return { stats, faults, valid: faults.every((f) => f.severity === "warning") };
}
