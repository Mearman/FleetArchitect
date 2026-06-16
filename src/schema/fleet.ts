import { z } from "zod";
import { EntityId, Vec2, IsoTimestamp } from "./primitives";

/** Doctrine controlling how a ship behaves once battle begins (no twitch). */
export const EngagementStance = z.enum([
  "aggressive",
  "balanced",
  "defensive",
  "evasive",
]);
export type EngagementStance = z.infer<typeof EngagementStance>;

export const TargetPriority = z.enum([
  "nearest",
  "weakest",
  "strongest",
  "highestCost",
]);
export type TargetPriority = z.infer<typeof TargetPriority>;

export const EngageRange = z.enum(["short", "medium", "long", "hold"]);
export type EngageRange = z.infer<typeof EngageRange>;

/** Pre-battle orders. These are the only control the player has over a ship. */
export const Orders = z.object({
  stance: EngagementStance,
  targetPriority: TargetPriority,
  engageRange: EngageRange,
  /** Structure fraction below which the ship tries to disengage (0..1). */
  retreatThreshold: z.number().min(0).max(1),
});
export type Orders = z.infer<typeof Orders>;

export const defaultOrders: Orders = {
  stance: "balanced",
  targetPriority: "nearest",
  engageRange: "medium",
  retreatThreshold: 0,
};

/** A ship's deployment in a fleet: which design, where, facing which way. */
export const FleetShip = z.object({
  designId: EntityId,
  position: Vec2,
  facing: z.number(),
  orders: Orders,
});
export type FleetShip = z.infer<typeof FleetShip>;

/**
 * A fleet: a named set of deployed ships. The unit of persistence and sharing
 * for force composition, and the input to a battle.
 */
export const Fleet = z.object({
  id: EntityId,
  name: z.string().min(1),
  faction: z.string().min(1),
  ships: z.array(FleetShip).min(1),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type Fleet = z.infer<typeof Fleet>;
