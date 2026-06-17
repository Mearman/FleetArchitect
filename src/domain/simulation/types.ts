import type { ShipStats } from "@/domain/stats";
import type { Orders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/hull";
import type { ModuleEffect } from "@/schema/module";
import type { BattleAnomaly } from "@/schema/battle";
import type { Vec2 } from "@/schema/primitives";

/**
 * A ship fully resolved for combat: identity + aggregate stats + deployment +
 * orders. This is the runtime unit the simulation pushes around; it carries no
 * rendering concerns.
 */
export interface CombatShip {
  instanceId: string;
  designId: string;
  side: "attacker" | "defender";
  stats: ShipStats;
  position: Vec2;
  facing: number;
  orders: Orders;
  classification: ShipClassification;
  /**
   * Per-module instances with their initial hit points and the module effect,
   * built from the ShipDesign by the resolver. When present, the engine
   * runs the per-module damage / fire / regen model: each module can be
   * destroyed independently, contributing to per-tick aggregate recompute.
   * When absent, the engine uses the aggregated model for backward compat.
   */
  modules?: ResolvedModule[];
}

/** Per-module initial state, built from a ShipDesign by the resolver. */
export interface ResolvedModule {
  slotId: string;
  moduleId: string;
  kind: ModuleEffect["kind"];
  /** Position on the hull (from the slot) for hit selection and UI. */
  x: number;
  y: number;
  /** Starting (and maximum) hit points. */
  maxHp: number;
  /** Mass contributed to the ship's total mass. */
  mass: number;
  /** The module's effect (weapon/shield/armour/engine/power/crew). */
  effect: ModuleEffect;
  /** Whether this module is a bridge / command module. */
  command: boolean;
}

/** Everything the simulator needs to run a deterministic battle. */
export interface BattleInputs {
  ships: CombatShip[];
  attackerFleetId: string;
  defenderFleetId: string;
  anomaly: BattleAnomaly;
  seed: number;
  maxTicks: number;
}

/** Safety cap so a stalemated battle terminates. ~3 min at 20 ticks/sec. */
export const DEFAULT_MAX_TICKS = 3600;
