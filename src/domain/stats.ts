import {
  deriveMass,
  footprint,
  isConnected4,
  occupiedCount,
  reachableFrom,
} from "@/domain/grid";
import { growArmourHull, padGrid } from "@/domain/hull-armour";
import { computeCompartments } from "@/domain/interior";
import type { LayerMaterial } from "@/schema/armor";
import type { GridCell, HardwireResource } from "@/schema/grid";
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
  cost: number;
  powerDraw: number;
  powerOutput: number;
  powerNet: number;
  crewRequired: number;
  crewCapacity: number;
  crewNet: number;
  /** Aggregate HP of every solid cell's surface layer (armor + deck) plus
   *  substrate HP. Outer-first depletion (Phase 2) reduces surface HP before
   *  substrate HP; once substrate HP reaches zero the cell is destroyed and
   *  break-apart may sever the graph. */
  structure: number;
  damageReduction: number;
  shieldCapacity: number;
  shieldRechargeRate: number;
  shieldRechargeDelay: number;
  thrust: number;
  turnRate: number;
  weapons: readonly ResolvedWeapon[];
  /** Advisory: total compartments in the design (deck regions connected
   *  through open edges / open doors). Surfaced for designer feedback; the
   *  engine does not yet consume it. */
  compartments: number;
  /** Advisory: how many of those compartments are airtight (every perimeter
   *  edge is wall / closed door / armor). Surfaced for designer feedback. */
  airtightCompartments: number;
}

/** A reason a ship design cannot be built as-is (error), or an advisory note (warning). */
export type DesignFault =
  // ---- Error-level faults (block deployment) ----
  | { kind: "empty"; severity: "error" }
  | { kind: "disconnected"; severity: "error" }
  | { kind: "noCommand"; severity: "error" }
  | { kind: "unknownModule"; severity: "error"; col: number; row: number; moduleId: EntityId }
  | { kind: "unknownLayerMaterial"; severity: "error"; col: number; row: number; layer: LayerMaterial["layer"] }
  | { kind: "powerDeficit"; severity: "error"; net: number }
  | { kind: "crewDeficit"; severity: "error"; net: number }
  /** Parts from more than one faction are present on this design. A valid
   *  ship uses layer materials and modules exclusively from the design's own
   *  faction. */
  | { kind: "crossFaction"; severity: "error"; expected: string; found: string[] }
  /**
   * A station that needs crew (crewRequired > 0) has no walkable path from any
   * crew-quarters cell. Only raised when at least one crew-quarters module exists
   * (a ship with no quarters simply has no crew — that is the crewDeficit case).
   * Walkability is deck-only and edge-gated: a closed door or wall on the shared
   * edge blocks the path.
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
  | { kind: "noRelay"; severity: "warning" }
  /**
   * A hardwire connection has incompatible endpoints. Each resource kind requires
   * a specific source and sink module type:
   *   - "ammo"    — source must be a magazine; sink must be a finite-ammo weapon.
   *   - "power"   — source must be a power plant; sink must draw power (powerDraw > 0).
   *   - "manning" — source must be a command module; sink must require crew (crewRequired > 0).
   * A fault is raised when either endpoint is not an equipment cell, is an unknown
   * module, or is a module of the wrong kind for the declared resource.
   */
  | {
      kind: "invalidHardwire";
      severity: "error";
      from: { col: number; row: number };
      to: { col: number; row: number };
      resource: HardwireResource;
      reason: string;
    };

export interface ShipDesignAnalysis {
  stats: ShipStats;
  faults: readonly DesignFault[];
  valid: boolean;
}

interface MutableStats extends Omit<ShipStats, "weapons"> {
  weapons: ResolvedWeapon[];
}

function emptyStats(): MutableStats {
  return {
    mass: 0,
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
    compartments: 0,
    airtightCompartments: 0,
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
    case "engine":
      stats.thrust += effect.thrust;
      // No per-engine turn rate: a modular ship turns from real torque
      // (engine r × F, gimbal vectoring, RCS, reaction wheel), derived in the
      // engine from the cell geometry — not from a summed scalar. ShipStats.turnRate
      // stays the scalar agility of the legacy aggregated path only.
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
    case "rcs":
    case "reactionWheel":
    case "blink": // tech modules (factions update): cost/power/crew counted above; no aggregate stat contribution, active behaviour is in the engine tick loop
    case "afterburner":
    case "overcharge":
    case "cloak":
    case "signature":
    case "ecm":
    case "eccm":
    case "decoy":
    case "commandAura":
    case "hangar":
    case "mineLayer":
    case "boarding":
      break;
  }
}

/** Mass of a single grid cell, summed across its layers and (if present)
 *  equipment. The layer masses are per-faction catalogue data; an unknown
 *  faction or layer resolves to zero mass, which is reported as a separate
 *  `unknownLayerMaterial` fault in `analyseShipDesign` so a silent zero does
 *  not mask a real problem.
 *
 *  Pass the design's faction so the faction-specific layer material (with its
 *  correct mass) is used. */
export function cellMass(cell: GridCell, catalog: Catalog, faction?: string): number {
  if (cell.kind !== "solid") return 0;
  let sum = 0;
  const substrate = faction !== undefined ? catalog.substrateMaterial(faction) : undefined;
  if (substrate !== undefined) sum += substrate.mass;
  if (cell.surface === "armor") {
    const armor = faction !== undefined ? catalog.armorMaterial(faction) : undefined;
    if (armor !== undefined) sum += armor.mass;
  } else if (cell.surface === "deck") {
    const deck = faction !== undefined ? catalog.deckMaterial(faction) : undefined;
    if (deck !== undefined) sum += deck.mass;
  }
  if (cell.equipment !== undefined) {
    sum += catalog.module(cell.equipment.moduleId)?.mass ?? 0;
  }
  return sum;
}

/** Collect the set of faction names used by equipment cells in the grid.
 *  Layer-material cells only record a surface kind (bare/deck/armor) which is
 *  shared across factions; the faction is resolved from the catalog at stat
 *  time using the design's declared faction. Cross-faction violations are
 *  therefore only detectable through explicitly-identified equipment. */
function partFactions(grid: ShipDesign["grid"], catalog: Catalog): Set<string> {
  const factions = new Set<string>();
  for (const cell of grid.cells) {
    if (cell.kind === "solid" && cell.equipment !== undefined) {
      const mod = catalog.module(cell.equipment.moduleId);
      if (mod !== undefined) factions.add(mod.faction);
    }
  }
  return factions;
}

/**
 * Resolve a ship design against the catalog, producing aggregated stats and any
 * build-constraint faults. Pure and deterministic. The grid is the source of
 * truth: mass, structure, thrust, and the rest are summed over its solid
 * cells. A valid design has all solid cells 4-connected (substrate adjacency),
 * at least one command module, and a non-negative power and crew balance.
 */
export function analyseShipDesign(
  design: ShipDesign,
  catalog: Catalog,
): ShipDesignAnalysis {
  // Auto-derive the armour hull: pad by 1 so a footprint flush to the border
  // gains room to grow, then plate the exterior neighbours of every plating
  // cell with fresh armour. The grown grid is ephemeral — never persisted —
  // so mass, HP, and compartment counts all reflect the armoured hull without
  // changing the saved design.
  const grid = growArmourHull(padGrid(design.grid, 1));
  const faults: DesignFault[] = [];
  // Connectivity and cell-count validation operates on the AUTHORED design,
  // not the grown grid. Growing armour can bridge gaps between disconnected
  // authored cells, which would mask real design errors (a disconnected saved
  // design is always an error regardless of how armour might span the gap).
  const cellCount = occupiedCount(design.grid);
  const stats = emptyStats();

  let hasCommand = false;
  let hasSensor = false;
  // Comms units grouped by channel: channel -> list of positions with moduleId.
  const commsUnitsByChannel = new Map<number, { col: number; row: number; moduleId: EntityId }[]>();
  // Aim units (dish or laser) that have crewRequired > 0.
  const aimUnitPositions: { col: number; row: number; moduleId: EntityId }[] = [];

  for (const { col, row } of footprint(grid)) {
    const cell = grid.cells[row * grid.cols + col];
    if (cell === undefined) continue;
    if (cell.kind !== "solid") continue;
    const slotId = `cell-${col}-${row}`;

    // Surface + substrate HP contribution. A cell with an unknown layer
    // material reports a fault rather than silently contributing zero.
    const substrate = catalog.substrateMaterial(design.faction);
    if (substrate === undefined) {
      faults.push({ kind: "unknownLayerMaterial", severity: "error", col, row, layer: "substrate" });
    } else {
      stats.structure += substrate.hp;
    }
    if (cell.surface === "armor") {
      const armor = catalog.armorMaterial(design.faction);
      if (armor === undefined) {
        faults.push({ kind: "unknownLayerMaterial", severity: "error", col, row, layer: "armor" });
      } else {
        stats.structure += armor.hp;
        stats.damageReduction = Math.max(stats.damageReduction, armor.damageReduction);
      }
    } else if (cell.surface === "deck") {
      const deck = catalog.deckMaterial(design.faction);
      if (deck === undefined) {
        faults.push({ kind: "unknownLayerMaterial", severity: "error", col, row, layer: "deck" });
      } else {
        stats.structure += deck.hp;
      }
    }

    if (cell.equipment !== undefined) {
      const moduleDef = catalog.module(cell.equipment.moduleId);
      if (moduleDef === undefined) {
        faults.push({ kind: "unknownModule", severity: "error", col, row, moduleId: cell.equipment.moduleId });
        continue;
      }
      if (moduleDef.command === true) hasCommand = true;
      if (moduleDef.effect.kind === "sensor") hasSensor = true;
      if (moduleDef.effect.kind === "comms") {
        // Resolve the effective channel: per-instance override wins over the
        // module definition's default channel.
        const effectiveChannel = cell.equipment.channel ?? moduleDef.effect.channel;
        const existing = commsUnitsByChannel.get(effectiveChannel);
        if (existing !== undefined) {
          existing.push({ col, row, moduleId: cell.equipment.moduleId });
        } else {
          commsUnitsByChannel.set(effectiveChannel, [{ col, row, moduleId: cell.equipment.moduleId }]);
        }
        // Track aim units (dish or laser) that require crew.
        if (
          (moduleDef.effect.commsType === "dish" || moduleDef.effect.commsType === "laser") &&
          moduleDef.crewRequired > 0
        ) {
          aimUnitPositions.push({ col, row, moduleId: cell.equipment.moduleId });
        }
      }
      applyModule(stats, moduleDef, slotId);
    }
  }

  stats.mass = deriveMass(grid, (cell) => cellMass(cell, catalog, design.faction));
  stats.powerNet = stats.powerOutput - stats.powerDraw;
  stats.crewNet = stats.crewCapacity - stats.crewRequired;

  // Compartment advisory metrics: deck regions connected through open edges
  // and open doors, with each compartment flagged airtight if every perimeter
  // edge is wall / closed door / armor. Surfaced for designer feedback; the
  // engine does not yet consume airtightness.
  const compartments = computeCompartments(grid);
  stats.compartments = compartments.length;
  stats.airtightCompartments = compartments.filter((c) => c.airtight).length;

  if (cellCount === 0) {
    faults.push({ kind: "empty", severity: "error" });
  } else if (!isConnected4(design.grid)) {
    faults.push({ kind: "disconnected", severity: "error" });
  }
  if (cellCount > 0 && !hasCommand) {
    faults.push({ kind: "noCommand", severity: "error" });
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
  // Hardwire-connection validation.
  //
  // Each connection in grid.connections must pair compatible equipment kinds:
  //   ammo    — source: magazine, sink: finite-ammo weapon (ammoCapacity set).
  //   power   — source: power plant, sink: any module with powerDraw > 0.
  //   manning — source: command module, sink: any module with crewRequired > 0.
  //
  // Valid connections exempt their sinks from the corresponding reachability
  // fault (noAmmoSource / unreachableStation) because the conduit satisfies
  // the resource need without crew logistics.
  //
  // Validated regardless of grid connectivity — the error is in the connection
  // declaration itself, not in the crew path graph.
  // ---------------------------------------------------------------------------

  /** Slot keys (col,row) of stations whose manning need is covered by a valid
   *  manning conduit. These are exempt from unreachableStation. */
  const manningHardwiredSlots = new Set<string>();
  /** Slot keys (col,row) of finite-ammo weapons whose ammo need is covered by a
   *  valid ammo conduit. These are exempt from noAmmoSource. */
  const ammoHardwiredSlots = new Set<string>();

  if (cellCount > 0) {
    for (const conn of grid.connections) {
      const { from, to, resource } = conn;
      const toKey = `${to.col},${to.row}`;

      const fromCell = grid.cells[from.row * grid.cols + from.col];
      const toCell = grid.cells[to.row * grid.cols + to.col];

      // Both endpoints must be equipment cells (solid cells carrying equipment).
      if (fromCell === undefined || fromCell.kind !== "solid" || fromCell.equipment === undefined) {
        faults.push({
          kind: "invalidHardwire",
          severity: "error",
          from,
          to,
          resource,
          reason: "source cell carries no equipment",
        });
        continue;
      }
      if (toCell === undefined || toCell.kind !== "solid" || toCell.equipment === undefined) {
        faults.push({
          kind: "invalidHardwire",
          severity: "error",
          from,
          to,
          resource,
          reason: "sink cell carries no equipment",
        });
        continue;
      }

      const fromDef = catalog.module(fromCell.equipment.moduleId);
      const toDef = catalog.module(toCell.equipment.moduleId);

      // Unknown modules are reported as unknownModule faults elsewhere; skip
      // the hardwire check rather than double-reporting.
      if (fromDef === undefined || toDef === undefined) continue;

      if (resource === "ammo") {
        if (fromDef.effect.kind !== "magazine") {
          faults.push({
            kind: "invalidHardwire",
            severity: "error",
            from,
            to,
            resource,
            reason: `ammo conduit source must be a magazine (found ${fromDef.effect.kind})`,
          });
          continue;
        }
        if (
          toDef.effect.kind !== "weapon" ||
          toDef.effect.ammoCapacity === undefined
        ) {
          faults.push({
            kind: "invalidHardwire",
            severity: "error",
            from,
            to,
            resource,
            reason:
              toDef.effect.kind !== "weapon"
                ? `ammo conduit sink must be a weapon (found ${toDef.effect.kind})`
                : "ammo conduit sink weapon has no ammoCapacity (unlimited ammo weapon)",
          });
          continue;
        }
        // Valid ammo conduit — the sink weapon is covered.
        ammoHardwiredSlots.add(toKey);
      } else if (resource === "power") {
        if (fromDef.effect.kind !== "power") {
          faults.push({
            kind: "invalidHardwire",
            severity: "error",
            from,
            to,
            resource,
            reason: `power conduit source must be a power plant (found ${fromDef.effect.kind})`,
          });
          continue;
        }
        if (toDef.powerDraw <= 0) {
          faults.push({
            kind: "invalidHardwire",
            severity: "error",
            from,
            to,
            resource,
            reason: "power conduit sink module has no power draw",
          });
          continue;
        }
        // Valid power conduit — no reachability fault to suppress (power
        // reachability is not checked as a design fault), but the link is valid.
      } else {
        // resource === "manning"
        if (fromDef.command !== true) {
          faults.push({
            kind: "invalidHardwire",
            severity: "error",
            from,
            to,
            resource,
            reason: `manning conduit source must be a command module (found ${fromDef.effect.kind})`,
          });
          continue;
        }
        if (toDef.crewRequired <= 0) {
          faults.push({
            kind: "invalidHardwire",
            severity: "error",
            from,
            to,
            resource,
            reason: "manning conduit sink module requires no crew",
          });
          continue;
        }
        // Valid manning conduit — the sink station is covered.
        manningHardwiredSlots.add(toKey);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Reachability faults — require crew pathfinding over the walkable surface.
  //
  // We compute these only when the grid has solid cells and is connected
  // (otherwise the connectivity and empty faults already describe the problem).
  // Disconnected grids have an undefined reachable graph, so checking paths
  // inside them would produce misleading results.
  // ---------------------------------------------------------------------------
  if (cellCount > 0 && isConnected4(design.grid)) {
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
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) continue;
      const moduleDef = catalog.module(cell.equipment.moduleId);
      if (moduleDef === undefined) continue;

      if (moduleDef.effect.kind === "crew") {
        quartersPositions.push({ col, row });
      }
      if (moduleDef.crewRequired > 0) {
        crewedStations.push({ col, row, moduleId: cell.equipment.moduleId });
      }
      if (moduleDef.effect.kind === "magazine") {
        magazinePositions.push({ col, row });
      }
      if (
        moduleDef.effect.kind === "weapon" &&
        moduleDef.effect.ammoCapacity !== undefined
      ) {
        finiteAmmoWeapons.push({ col, row, moduleId: cell.equipment.moduleId });
      }
    }

    // Unreachable-station fault: a crewed station with no walkable path from
    // any crew-quarters cell. Only checked when quarters exist — a design with
    // no quarters has a crewDeficit instead, which already covers the problem.
    //
    // We build the reachability set once and reuse it for the unmannedAimUnit
    // warning check further below (aim units also depend on crew reachability).
    let reachableFromAnyQuarters: Set<string> | undefined;
    // Stations covered by a valid manning conduit are exempt.
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
        // A valid manning conduit covers this station — no fault.
        if (manningHardwiredSlots.has(key)) continue;
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
    // Weapons covered by a valid ammo conduit are exempt.
    if (finiteAmmoWeapons.length > 0 && magazinePositions.length === 0) {
      // No magazines at all — every finite-ammo weapon not covered by a conduit
      // is affected.
      for (const weapon of finiteAmmoWeapons) {
        const key = `${weapon.col},${weapon.row}`;
        if (ammoHardwiredSlots.has(key)) continue;
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
      // each weapon. A weapon is faulted only if no magazine can reach it and
      // it is not covered by a valid ammo conduit.
      const reachableFromAnyMagazine = new Set<string>();
      for (const magPos of magazinePositions) {
        for (const key of reachableFrom(grid, magPos)) {
          reachableFromAnyMagazine.add(key);
        }
      }

      for (const weapon of finiteAmmoWeapons) {
        const key = `${weapon.col},${weapon.row}`;
        if (ammoHardwiredSlots.has(key)) continue;
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
