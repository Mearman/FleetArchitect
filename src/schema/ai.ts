import { z } from "zod";
import { ShipClassification } from "./armor";
import { EntityId } from "./primitives";

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
 * `moduleDestroyed` condition can name a kind without depending on the full
 * effect union. If a new module effect kind is added to `ModuleEffect`, it
 * must be added here too — there is a unit test asserting the two stay in
 * sync (`ai.unit.test.ts`, Phase 10).
 */
export const ModuleKind = z.enum([
  "weapon",
  "shield",
  "deflector",
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

// ---------------------------------------------------------------------------
// Unified doctrine vocabulary (formation overhaul).
//
// This is the SINGLE authoring model for conditional behaviour across
// ship-design, per-ship, and formation scopes: it absorbs Orders /
// EngagementStance into one composable set of axes.
//
// A doctrine is an ordered list of rules (first match wins) plus a base
// DoctrineAction applied when no rule fires. Each rule's action may set any
// subset of three independent axes — spatial (where to be), targeting (whom to
// shoot), fire discipline (when to shoot) — plus stance, crew priority, and
// cohesion. All are evaluated relative to a FormationReference, which may name
// a formation by role (friendly or enemy), an enemy archetype, a waypoint, the
// side's deployment line, or a point derived between two references.
// ---------------------------------------------------------------------------

/**
 * What a behaviour is relative to. References resolve at evaluation time and
 * are total: an unresolvable reference (e.g. an enemy fleet with no formation
 * of the named role) makes any condition that uses it simply unsatisfied — it
 * never errors. `between` interpolates a point on the line from `a` to `b`
 * (`a + alpha·(b − a)`), enabling "screen the gap between our carrier and their
 * main body". Recursive (`between` references FormationReference).
 */
export type FormationReference =
  | { kind: "self" }
  | { kind: "friendly"; role: string }
  | { kind: "enemy"; role: string }
  | { kind: "enemyArchetype"; archetype: ShipClassification }
  | { kind: "point"; pointId: string }
  | { kind: "deployment" }
  | { kind: "target" }
  | { kind: "between"; a: FormationReference; b: FormationReference; alpha: number };

export const FormationReference: z.ZodType<FormationReference> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("self") }),
    z.object({ kind: z.literal("friendly"), role: z.string().min(1) }),
    z.object({ kind: z.literal("enemy"), role: z.string().min(1) }),
    z.object({ kind: z.literal("enemyArchetype"), archetype: ShipClassification }),
    z.object({ kind: z.literal("point"), pointId: EntityId }),
    z.object({ kind: z.literal("deployment") }),
    z.object({ kind: z.literal("target") }),
    z.object({
      kind: z.literal("between"),
      a: FormationReference,
      b: FormationReference,
      alpha: Fraction,
    }),
  ]),
);

/** The coordinate frame a bearing offset is expressed in. */
export const BearingFrame = z.enum(["self", "fleet", "world"]);
export type BearingFrame = z.infer<typeof BearingFrame>;

/**
 * How far the ship should be from its spatial reference — the "range" half of a
 * movement objective. Every movement verb reduces to a (range, bearing) target
 * relative to a reference; this is the range half. `hold` station-keeps within
 * `band` of the reference; `close` drives range toward 0 (pursue); `evade`
 * opens range beyond `minRange` (flee / break contact); `kite` holds at
 * `maxRange` (typically maximum weapon range); `maintain` holds a set range
 * within a tolerance (range-keeping).
 */
export const RangeRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hold"), band: Fraction }),
  z.object({ kind: z.literal("close") }),
  z.object({ kind: z.literal("evade"), minRange: z.number().min(0) }),
  z.object({ kind: z.literal("kite"), maxRange: z.number().min(0) }),
  z.object({ kind: z.literal("maintain"), range: z.number().min(0), tolerance: z.number().min(0) }),
  /**
   * Engage at a fraction of the ship's own maximum weapon range — the
   * weapon-relative expression of the legacy `engageRange` (short/medium/long),
   * resolved to an absolute range at setup against the ship's weapons (which the
   * authoring model cannot know). `tolerance` is the at-range dead-zone fraction
   * (the legacy `rangeKeepingBand`).
   */
  z.object({
    kind: z.literal("engage"),
    fraction: z.number().min(0).max(1),
    tolerance: z.number().min(0),
  }),
]);
export type RangeRule = z.infer<typeof RangeRule>;

/**
 * Which direction from its spatial reference the ship should sit — the
 * "bearing" half of a movement objective. `free` does not constrain bearing;
 * `offset` holds a fixed angle in a chosen frame (follow/lead/flank/screen are
 * named offsets); `toward`/`away` point at or from another reference; `orbit`
 * sweeps the bearing as a pure function of tick (`phase + omega·tick`) so the
 * ship circles the reference deterministically. The orbit radius comes from the
 * paired RangeRule (`maintain`), keeping range and bearing orthogonal.
 */
export const BearingRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("free") }),
  z.object({ kind: z.literal("offset"), frame: BearingFrame, angle: z.number() }),
  z.object({ kind: z.literal("toward"), reference: FormationReference }),
  z.object({ kind: z.literal("away"), reference: FormationReference }),
  z.object({ kind: z.literal("orbit"), omega: z.number(), phase: z.number() }),
]);
export type BearingRule = z.infer<typeof BearingRule>;

/** Where to be: a reference point plus a (range, bearing) target relative to it. */
export const SpatialObjective = z.object({
  reference: FormationReference,
  range: RangeRule,
  bearing: BearingRule,
});
export type SpatialObjective = z.infer<typeof SpatialObjective>;

/**
 * Whom to shoot. The first five mirror the legacy TargetPriority (nearest /
 * weakest / strongest / highestCost) plus `none` (no ship target — pure
 * movement or point-defence only). The relational modes are the formation
 * layer: `threatsTo` (protect — enemies attacking the referenced formation),
 * `membersOf` (concentrate on a formation), `inZone` (defend a point — enemies
 * inside a zone), `sameAs` (support by fire — shoot what the reference
 * shoots), `class` (an enemy classification), `pdPriority` (defensive fire:
 * incoming missiles and drones first).
 */
export const TargetingMode = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("nearest") }),
  z.object({ kind: z.literal("weakest") }),
  z.object({ kind: z.literal("strongest") }),
  z.object({ kind: z.literal("highestCost") }),
  z.object({ kind: z.literal("threatsTo"), reference: FormationReference }),
  z.object({ kind: z.literal("membersOf"), reference: FormationReference }),
  z.object({ kind: z.literal("inZone"), pointId: EntityId }),
  z.object({ kind: z.literal("sameAs"), reference: FormationReference }),
  z.object({ kind: z.literal("class"), classification: ShipClassification }),
  z.object({ kind: z.literal("pdPriority") }),
]);
export type TargetingMode = z.infer<typeof TargetingMode>;

/**
 * Whom to shoot, with the scoring blend. `vulnerableWeight` blends a target's
 * remaining-HP fraction into the score (0 = pure mode, 1 = prefer nearly
 * destroyed targets); `focusFire` concentrates the whole side's fire on fewer
 * targets. Both subsume the legacy Orders fields of the same intent.
 */
export const TargetingObjective = z.object({
  mode: TargetingMode,
  vulnerableWeight: z.number().min(0).max(1).default(0),
  focusFire: z.boolean().default(false),
});
export type TargetingObjective = z.infer<typeof TargetingObjective>;

/** When to fire: at will / hold fire / only once fired upon / only at a spec. */
export const FireDiscipline = z.enum(["atWill", "holdFire", "whenFiredUpon", "onlyAt"]);
export type FireDiscipline = z.infer<typeof FireDiscipline>;

/**
 * What to do when a rule fires. Every field is optional: a rule sets only the
 * axes it cares about, and unset axes fall through to the next-most-specific
 * scope (ship-design base → per-ship → leaf formation → … → root). `stance`
 * is aggressiveness/defensiveness (the ShipStance axis); `cohesion` is the
 * strength of the pull toward the ship's own formation centroid (the legacy
 * `formationKeeping`).
 */
export const DoctrineAction = z.object({
  stance: ShipStance.optional(),
  spatial: SpatialObjective.optional(),
  targeting: TargetingObjective.optional(),
  fire: FireDiscipline.optional(),
  crew: CrewPriority.optional(),
  cohesion: z.number().min(0).max(1).optional(),
  /**
   * The combined-HP fraction below which the ship disengages (0..1; absent or 0
   * = never retreat). Subsumes the legacy `orders.retreatThreshold`. Distinct
   * from a `structureBelow` rule because retreat compares against the COMBINED
   * structure + module-HP fraction (combat effectiveness), not structure alone.
   */
  retreat: z.number().min(0).max(1).optional(),
});
export type DoctrineAction = z.infer<typeof DoctrineAction>;

/**
 * A condition that, when satisfied, fires a {@link DoctrineAction}. Comprises
 * the ship-self predicates (shieldBelow … outclassed) plus formation-state,
 * spatial-between-formations, temporal/phase, and bounded boolean combinations.
 * Recursive (`all`/`any` reference Condition, capped at 4 sub-conditions).
 */
export type Condition =
  | { kind: "shieldBelow"; fraction: number }
  | { kind: "structureBelow"; fraction: number }
  | { kind: "targetInRange"; min: number; max: number }
  | { kind: "targetClass"; classes: ShipClassification[] }
  | { kind: "moduleDestroyed"; moduleKind: ModuleKind }
  | { kind: "outclassed" }
  | {
      kind: "formationStrength";
      reference: FormationReference;
      threshold: number;
      direction: "below" | "above";
    }
  | { kind: "formationLoss"; reference: FormationReference; lostFraction: number }
  | { kind: "formationEngaged"; reference: FormationReference }
  | { kind: "formationDestroyed"; reference: FormationReference }
  | { kind: "flagshipLost"; reference: FormationReference }
  | {
      kind: "range";
      a: FormationReference;
      b: FormationReference;
      min: number;
      max: number;
    }
  | {
      kind: "crossingLine";
      reference: FormationReference;
      lineA: FormationReference;
      lineB: FormationReference;
    }
  | { kind: "flanking"; reference: FormationReference }
  | { kind: "localSuperiority"; reference: FormationReference; minRatio: number }
  | {
      kind: "friendlyInLineOfFire";
      /** Angular tolerance in degrees: a friendly whose bearing from the
       *  observer is within this of the observer→target bearing is "on the
       *  line". Use with `then: { fire: "holdFire" }` to avoid shooting
       *  through a friendly. */
      toleranceDeg: number;
    }
  | {
      kind: "friendlyProximity";
      /** Distance threshold in metres from any alive same-side ship. */
      threshold: number;
      /** `within` fires when a friendly is closer than `threshold`; `beyond`
       *  fires when the nearest friendly is farther than `threshold`. */
      direction: "within" | "beyond";
    }
  | { kind: "phase"; phase: "opening" | "contact" | "closing" | "mopUp" }
  | { kind: "tickAfter"; tick: number }
  | { kind: "all"; of: Condition[] }
  | { kind: "any"; of: Condition[] };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    // Ship-self predicates.
    z.object({ kind: z.literal("shieldBelow"), fraction: Fraction }),
    z.object({ kind: z.literal("structureBelow"), fraction: Fraction }),
    z.object({ kind: z.literal("targetInRange"), min: z.number(), max: z.number() }),
    z.object({ kind: z.literal("targetClass"), classes: z.array(ShipClassification).min(1) }),
    z.object({ kind: z.literal("moduleDestroyed"), moduleKind: ModuleKind }),
    z.object({ kind: z.literal("outclassed") }),
    // Formation state.
    z.object({
      kind: z.literal("formationStrength"),
      reference: FormationReference,
      threshold: Fraction,
      direction: z.enum(["below", "above"]),
    }),
    z.object({ kind: z.literal("formationLoss"), reference: FormationReference, lostFraction: Fraction }),
    z.object({ kind: z.literal("formationEngaged"), reference: FormationReference }),
    z.object({ kind: z.literal("formationDestroyed"), reference: FormationReference }),
    z.object({ kind: z.literal("flagshipLost"), reference: FormationReference }),
    // Spatial between formations.
    z.object({
      kind: z.literal("range"),
      a: FormationReference,
      b: FormationReference,
      min: z.number(),
      max: z.number(),
    }),
    z.object({
      kind: z.literal("crossingLine"),
      reference: FormationReference,
      lineA: FormationReference,
      lineB: FormationReference,
    }),
    z.object({ kind: z.literal("flanking"), reference: FormationReference }),
    z.object({ kind: z.literal("localSuperiority"), reference: FormationReference, minRatio: z.number() }),
    z.object({ kind: z.literal("friendlyInLineOfFire"), toleranceDeg: z.number().min(0) }),
    z.object({
      kind: z.literal("friendlyProximity"),
      threshold: z.number().min(0),
      direction: z.enum(["within", "beyond"]),
    }),
    // Temporal / phase.
    z.object({ kind: z.literal("phase"), phase: z.enum(["opening", "contact", "closing", "mopUp"]) }),
    z.object({ kind: z.literal("tickAfter"), tick: z.number().int().min(0) }),
    // Bounded boolean combinations.
    z.object({ kind: z.literal("all"), of: z.array(Condition).min(1).max(4) }),
    z.object({ kind: z.literal("any"), of: z.array(Condition).min(1).max(4) }),
  ]),
);

/** A single unified rule: when `condition` holds, apply `then`. */
export const DoctrineRule = z.object({
  condition: Condition,
  then: DoctrineAction,
});
export type DoctrineRule = z.infer<typeof DoctrineRule>;

/**
 * A doctrine: a base action applied when no rule fires, plus an ordered list of
 * rules (first match wins). Authored at ship-design, per-ship, or formation
 * scope; inherited down the formation tree (most-specific scope first). Both
 * fields default so an absent doctrine parses to "no rules, empty base" — pure
 * legacy behaviour.
 */
export const Doctrine = z.object({
  base: DoctrineAction.default({}),
  rules: z.array(DoctrineRule).default([]),
});
export type Doctrine = z.infer<typeof Doctrine>;
