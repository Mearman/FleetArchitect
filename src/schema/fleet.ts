import { z } from "zod";
import { EntityId, Vec2, IsoTimestamp } from "./primitives";
import { Formation } from "./formation";
import { Doctrine } from "./ai";

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
  /**
   * Per-ship doctrine override. Additive alongside `orders` while the engine is
   * re-plumbed to read doctrine; populated from `orders` at the parse boundary
   * by `normaliseFleetInput`. Overrides the design's doctrine at the leaf.
   */
  doctrine: Doctrine.optional(),
});
export type FleetShip = z.infer<typeof FleetShip>;

/**
 * Whether a fleet was authored by the player or shipped as a built-in preset.
 * Presets are read-only; the storage layer rejects any attempt to overwrite one.
 */
export const FleetSource = z.enum(["preset", "user"]);
export type FleetSource = z.infer<typeof FleetSource>;

/**
 * A fleet: a named formation tree of deployed ships. The unit of persistence
 * and sharing for force composition, and the input to a battle.
 *
 * A fleet is a single root {@link Formation} whose children are ship leaves (the
 * atomic unit — a lone ship needs no wrapping asset), nested sub-formations, or
 * references to a reusable formation template (expanded inline before resolve).
 * A flat root of ship leaves with no `layout` resolves to the legacy deployment
 * column byte-identically, so a fleet lifted from the former flat `ships[]` form
 * fights exactly as before.
 *
 * `source` and `revision` are additive (`.default()`-ed) so existing fleets
 * parse unchanged. They mirror {@link ShipDesign}'s provenance fields: preset
 * fleets are bundled catalogue content (read-only, no history); user fleets
 * are player-authored and accrue a revision on each version-history snapshot.
 */
export const Fleet = z.object({
  id: EntityId,
  name: z.string().min(1),
  faction: z.string().min(1),
  // `Formation` is a live binding resolved through the fleet.ts ↔ formation.ts
  // import cycle; wrap it in z.lazy so the reference is read at parse time
  // (after both modules have finished initialising), not at schema-construction
  // time when the binding is still undefined. Mirrors the deferred `FleetShip`
  // reference inside formation.ts's own z.lazy.
  formation: z.lazy(() => Formation),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  /** Whether this record is a bundled preset or a player-authored fleet. */
  source: FleetSource.default("user"),
  /**
   * Monotonically increasing revision number, bumped on each save that creates
   * a version-history snapshot. Starts at 1 for fresh fleets; presets stay on
   * their authored revision.
   */
  revision: z.number().int().min(1).default(1),
});
export type Fleet = z.infer<typeof Fleet>;
