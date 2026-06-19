import { z } from "zod";
import { ShipClassification } from "./armor";

/**
 * Canonical schema for ship and crew AI behaviour. Phase 0 of the realism
 * overhaul adds the surface only — the simulation interpreter lands in a later
 * phase. These schemas are additive (every field has a `.default()`), so
 * existing designs and fleets parse unchanged.
 */

/**
 * A ship's base posture. Supersedes (but does not yet replace) the legacy
 * `EngagementStance` in `fleet.ts`. Stances are presets: the engine applies
 * built-in target-selection, range-holding, and disengage rules for each. The
 * player-authored `rules` list layers on top to override or extend the stance.
 */
export const ShipStance = z.enum([
  "aggressive",
  "balanced",
  "defensive",
  "evasive",
  "interceptor",
  "escort",
  "sniper",
  "hold",
  "retreat",
]);
export type ShipStance = z.infer<typeof ShipStance>;

/**
 * How the crew's task scheduler prioritises its base duties (manning, ammo
 * haul, power haul, repair). Modes reorder the same fixed task list; they add
 * no new tasks. `combat` is the historical default.
 */
export const CrewPriority = z.enum(["combat", "damageControl", "resupply"]);
export type CrewPriority = z.infer<typeof CrewPriority>;

/**
 * The set of module effect kinds, mirroring the discriminator of
 * `ModuleEffect` in `./module`. Kept as a literal enum so the
 * `moduleDestroyed` trigger can name a kind without depending on the full
 * effect union. If a new module effect kind is added to `ModuleEffect`, it
 * must be added here too — there is a unit test asserting the two stay in
 * sync (`ai.unit.test.ts`, Phase 10).
 */
export const ModuleKind = z.enum([
  "weapon",
  "shield",
  "engine",
  "power",
  "crew",
  "pointDefense",
  "repair",
  "hull",
  "magazine",
  "sensor",
  "comms",
  "rcs",
  "reactionWheel",
  "blink",
  "afterburner",
  "overcharge",
  "cloak",
  "signature",
  "ecm",
  "eccm",
  "decoy",
  "commandAura",
  "hangar",
  "mineLayer",
  "boarding",
]);
export type ModuleKind = z.infer<typeof ModuleKind>;

/** A fraction in the closed range [0, 1]. */
const Fraction = z.number().min(0).max(1);

/**
 * A condition that, when met, fires an {@link Action}. Triggers are pure
 * predicates over the ship's frame state — shields, structure, target, and
 * destroyed modules — evaluated in deterministic order each tick.
 *
 * - `shieldBelow`     — current shield fraction is below `fraction`.
 * - `structureBelow`  — current hull/structure fraction is below `fraction`.
 * - `targetInRange`   — distance to the current target is within `[min, max]`
 *                       (inclusive; world units).
 * - `targetClass`     — the current target's {@link ShipClassification} is in
 *                       `classes`.
 * - `moduleDestroyed` — at least one module of `moduleKind` has been destroyed.
 * - `outclassed`      — the ship is outclassed by the opposing force (engine
 *                       defines the comparison; e.g. total fleet point value
 *                       or class mismatch).
 */
export const Trigger = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("shieldBelow"),
    fraction: Fraction,
  }),
  z.object({
    kind: z.literal("structureBelow"),
    fraction: Fraction,
  }),
  z.object({
    kind: z.literal("targetInRange"),
    min: z.number(),
    max: z.number(),
  }),
  z.object({
    kind: z.literal("targetClass"),
    classes: z.array(ShipClassification).min(1),
  }),
  z.object({
    kind: z.literal("moduleDestroyed"),
    moduleKind: ModuleKind,
  }),
  z.object({
    kind: z.literal("outclassed"),
  }),
]);
export type Trigger = z.infer<typeof Trigger>;

/**
 * What to do when a {@link Trigger} fires. Actions layer onto the current
 * stance for as long as the trigger remains true (or apply a one-shot effect
 * for `retreat`/`rally`, depending on the interpreter).
 *
 * - `setStance`         — switch the ship's stance to `stance`.
 * - `retreat`           — begin disengaging from the battle.
 * - `focusFire`         — concentrate fire with allies on a shared target.
 * - `prioritiseRepair`  — direct crew and the ship toward repairing damage.
 * - `holdFire`          — cease firing weapons.
 * - `fireAtWill`        — resume autonomous weapon fire.
 * - `rally`             — return toward the fleet's formation reference point.
 */
export const Action = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("setStance"),
    stance: ShipStance,
  }),
  z.object({ kind: z.literal("retreat") }),
  z.object({ kind: z.literal("focusFire") }),
  z.object({ kind: z.literal("prioritiseRepair") }),
  z.object({ kind: z.literal("holdFire") }),
  z.object({ kind: z.literal("fireAtWill") }),
  z.object({ kind: z.literal("rally") }),
]);
export type Action = z.infer<typeof Action>;

/**
 * A single player-authored rule: when `trigger` is true, apply `action`. Rules
 * are evaluated in list order each tick; the first matching rule wins (later
 * phases may refine this to allow stacking).
 */
export const Rule = z.object({
  trigger: Trigger,
  action: Action,
});
export type Rule = z.infer<typeof Rule>;
