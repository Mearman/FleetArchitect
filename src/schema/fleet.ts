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

/**
 * Pre-battle orders. These are the only control the player has over a ship.
 *
 * Schema version 2 adds:
 *   - focusFire: all ships on the same side with focusFire=true share a single
 *     target (the highest-priority enemy by targetPriority), concentrating fire
 *     rather than spreading it across the enemy fleet.
 *   - vulnerableTargetWeight (0..1): how much to blend vulnerability (low
 *     remaining-HP fraction) into the target score. 0 = pure priority, 1 =
 *     heavily prefer targets close to destruction. Values in between linearly
 *     interpolate between the two scores.
 *   - formationKeeping (0..1): pull toward the fleet centroid when manoeuvring.
 *     0 = every ship flies independently; 1 = ships deviate as little as
 *     possible from the fleet's centre of mass. Applied as a weighted blend on
 *     the desired heading each tick.
 *   - rangeKeepingBand (0.1..1): the fraction of the desired range that defines
 *     the "at range" dead-zone. A tight band (0.1) means the ship thrusts
 *     constantly to hold exact range; a wide band (0.9) lets it drift further
 *     before correcting. Cautious commanders use wider bands; aggressive ones
 *     use narrow bands so they close quickly.
 */
export const Orders = z.object({
  stance: EngagementStance,
  targetPriority: TargetPriority,
  engageRange: EngageRange,
  /** Structure fraction below which the ship tries to disengage (0..1). */
  retreatThreshold: z.number().min(0).max(1),
  /**
   * Concentrate the whole side's fire on fewer targets. When true, all ships
   * on this side with focusFire=true pick the same enemy (the one that scores
   * highest by targetPriority across the fleet), so targets are destroyed
   * faster rather than being whittled down in parallel.
   */
  focusFire: z.boolean(),
  /**
   * How much weight to give a target's current vulnerability (low remaining
   * HP fraction) when scoring enemies. 0 = ignore vulnerability entirely;
   * 1 = prefer the most vulnerable (lowest structure + shield fraction).
   * Values in between blend the priority-based score with the vulnerability
   * score so ships lean toward finishing off wounded enemies.
   */
  vulnerableTargetWeight: z.number().min(0).max(1),
  /**
   * Pull toward the fleet centroid when choosing a heading. 0 = fly
   * independently; 1 = always aim for the formation centre before angling
   * toward the target. Values around 0.2–0.4 keep loose formations without
   * sacrificing offensive intent.
   */
  formationKeeping: z.number().min(0).max(1),
  /**
   * Width of the "at range" dead-zone as a fraction of the desired engagement
   * range. A ship within `desiredRange ± rangeKeepingBand * desiredRange / 2`
   * considers itself correctly positioned and stops thrusting to close or
   * open range. Larger values allow more drift before correcting; smaller
   * values make the ship hold range tightly. Range: 0.1..0.9.
   */
  rangeKeepingBand: z.number().min(0.1).max(0.9),
});
export type Orders = z.infer<typeof Orders>;

export const defaultOrders: Orders = {
  stance: "balanced",
  targetPriority: "nearest",
  engageRange: "medium",
  retreatThreshold: 0,
  focusFire: false,
  vulnerableTargetWeight: 0,
  formationKeeping: 0,
  rangeKeepingBand: 0.3,
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
