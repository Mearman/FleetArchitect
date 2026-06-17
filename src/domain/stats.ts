import type { HullDefinition } from "@/schema/hull";
import type {
  ModuleDefinition,
  ModuleSlotType,
  WeaponEffect,
} from "@/schema/module";
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
  | { kind: "unknownSlot"; slotId: EntityId }
  | { kind: "unknownModule"; slotId: EntityId; moduleId: EntityId }
  | {
      kind: "slotTypeMismatch";
      slotId: EntityId;
      moduleSlotType: ModuleSlotType;
      hullSlotType: ModuleSlotType;
    }
  | { kind: "duplicateSlot"; slotId: EntityId }
  | { kind: "massExceeded"; mass: number; capacity: number }
  | { kind: "powerDeficit"; net: number }
  | { kind: "crewDeficit"; net: number };

export interface ShipDesignAnalysis {
  stats: ShipStats;
  faults: readonly DesignFault[];
  valid: boolean;
}

interface MutableStats extends Omit<ShipStats, "weapons"> {
  weapons: ResolvedWeapon[];
}

function emptyStats(hull: HullDefinition): MutableStats {
  return {
    mass: 0,
    cost: hull.baseCost,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: hull.baseStructure,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    thrust: hull.baseSpeed,
    turnRate: hull.baseTurnRate,
    weapons: [],
  };
}

function applyModule(
  stats: MutableStats,
  moduleDef: ModuleDefinition,
  slotId: EntityId,
): void {
  stats.mass += moduleDef.mass;
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
    case "hull":
      // Hull sections are pure connectivity anchors: they contribute mass
      // and cost (applied above) but no combat stats.
      break;
  }
}

/**
 * Resolve a ship design against a hull and the catalog, producing aggregated
 * stats and any build-constraint faults. Pure and deterministic.
 */
export function analyseShipDesign(
  design: ShipDesign,
  hull: HullDefinition,
  catalog: Catalog,
): ShipDesignAnalysis {
  const faults: DesignFault[] = [];
  const usedSlots = new Set<EntityId>();
  const stats = emptyStats(hull);
  const hullSlots = new Map(hull.slots.map((slot) => [slot.id, slot]));

  for (const placement of design.placements) {
    const slot = hullSlots.get(placement.slotId);
    if (slot === undefined) {
      faults.push({ kind: "unknownSlot", slotId: placement.slotId });
      continue;
    }
    if (usedSlots.has(placement.slotId)) {
      faults.push({ kind: "duplicateSlot", slotId: placement.slotId });
      continue;
    }
    usedSlots.add(placement.slotId);

    const moduleDef = catalog.module(placement.moduleId);
    if (moduleDef === undefined) {
      faults.push({
        kind: "unknownModule",
        slotId: placement.slotId,
        moduleId: placement.moduleId,
      });
      continue;
    }

    if (moduleDef.slotType !== slot.type) {
      faults.push({
        kind: "slotTypeMismatch",
        slotId: placement.slotId,
        moduleSlotType: moduleDef.slotType,
        hullSlotType: slot.type,
      });
      continue;
    }

    applyModule(stats, moduleDef, placement.slotId);
  }

  stats.powerNet = stats.powerOutput - stats.powerDraw;
  stats.crewNet = stats.crewCapacity - stats.crewRequired;

  if (stats.mass > hull.massCapacity) {
    faults.push({ kind: "massExceeded", mass: stats.mass, capacity: hull.massCapacity });
  }
  if (stats.powerNet < 0) {
    faults.push({ kind: "powerDeficit", net: stats.powerNet });
  }
  if (stats.crewNet < 0) {
    faults.push({ kind: "crewDeficit", net: stats.crewNet });
  }

  return { stats, faults, valid: faults.length === 0 };
}
