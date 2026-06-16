import type { ShipStats } from "@/domain/stats";
import type { Orders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/hull";
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
