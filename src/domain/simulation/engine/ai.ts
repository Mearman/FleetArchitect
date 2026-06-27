/**
 * Ship AI interpreter (Phase 7). A ship's behaviour is its doctrine: a base
 * {@link DoctrineAction} (a preset posture — stance, crew priority, and the
 * spatial/targeting/fire axes the engine resolves) plus an ordered list of
 * player-authored condition/action rules that layer on top. The engine
 * evaluates the rules in list order each tick; the first rule whose condition
 * is satisfied wins (later rules do not stack), and its action overrides the
 * base for that tick. Fully deterministic: no RNG, fixed rule order, pure
 * predicates over frame state.
 *
 * This module is the pure interpreter — `shipSelfSatisfied` (the ship-self
 * predicate evaluator, shared with the formation-doctrine pass) and
 * `effectiveDoctrineAi`. It does not decide targets or move ships; it produces
 * an {@link AiState} the engine's targeting/firing/movement reads. Wiring is
 * integration.
 */

import type {
  Condition,
  Doctrine,
  DoctrineAction,
  ModuleKind,
  ShipStance,
} from "@/schema/ai";
import type { ShipClassification } from "@/schema/armor";

/** The per-tick AI decision layered onto the stance by the matching rule. The
 *  engine reads these flags: `holdFire` ceases weapon fire, `focusFire`
 *  concentrates fire with allies on a shared target, `retreat` disengages,
 *  `prioritiseRepair` directs crew toward repair, `rally` returns to the
 *  fleet's formation reference. `stance` is the effective stance (the doctrine
 *  base, or one overridden by a rule's `stance` axis). */
export interface AiState {
  stance: ShipStance;
  holdFire: boolean;
  focusFire: boolean;
  retreat: boolean;
  prioritiseRepair: boolean;
  rally: boolean;
}

/** The frame state a trigger evaluates against. The engine computes this from
 *  the ship, its target, and the two fleets; tests construct it directly so
 *  the predicates are unit-testable without building whole SimShips. */
export interface TriggerContext {
  /** Current shield fraction (0..1). */
  shieldFraction: number;
  /** Current structure fraction (0..1). */
  structureFraction: number;
  /** Distance to the current target (world metres), or undefined with no
   *  target. */
  targetRange: number | undefined;
  /** The current target's classification, or undefined with no target. */
  targetClassification: ShipClassification | undefined;
  /** Module kinds that have at least one destroyed module this tick. */
  destroyedModuleKinds: ReadonlySet<ModuleKind>;
  /** Whether the ship's side is outclassed by the opposing force (the engine
   *  defines the comparison — e.g. total fleet strength). */
  outclassed: boolean;
}

/** The base AI state for a stance: just the stance, no flags set. */
export function baseAiState(stance: ShipStance): AiState {
  return {
    stance,
    holdFire: false,
    focusFire: false,
    retreat: false,
    prioritiseRepair: false,
    rally: false,
  };
}

/** Whether a ship-self {@link Condition} holds against the trigger context.
 *  Returns `undefined` for any non-ship-self kind so the caller (the doctrine
 *  interpreter and the formation pass) can dispatch formation/spatial/temporal/
 *  boolean conditions through their own evaluator. Pure. */
export function shipSelfSatisfied(
  condition: Condition,
  ctx: TriggerContext,
): boolean | undefined {
  switch (condition.kind) {
    case "shieldBelow":
      return ctx.shieldFraction < condition.fraction;
    case "structureBelow":
      return ctx.structureFraction < condition.fraction;
    case "targetInRange":
      return (
        ctx.targetRange !== undefined &&
        ctx.targetRange >= condition.min &&
        ctx.targetRange <= condition.max
      );
    case "targetClass":
      return (
        ctx.targetClassification !== undefined &&
        condition.classes.includes(ctx.targetClassification)
      );
    case "moduleDestroyed":
      return ctx.destroyedModuleKinds.has(condition.moduleKind);
    case "outclassed":
      return ctx.outclassed;
    default:
      return undefined;
  }
}

/**
 * Whether a unified {@link Condition} holds against the trigger context. The
 * ship-self kinds are evaluated by {@link shipSelfSatisfied}; the
 * formation-state, spatial, and temporal conditions are the formation-aware
 * layer (deferred here) and are not yet satisfiable through this entry point,
 * so they return false — a rule guarded only by them never fires via
 * `effectiveDoctrineAi` (the formation-doctrine pass evaluates them).
 */
function conditionSatisfied(condition: Condition, ctx: TriggerContext): boolean {
  const self = shipSelfSatisfied(condition, ctx);
  if (self !== undefined) return self;
  // Formation/spatial/temporal/boolean-combo conditions: deferred here.
  // The formation-doctrine pass evaluates them when a fleet's doctrine uses
  // them; this path (effectiveDoctrineAi, called by stepAi) returns false so a
  // rule guarded only by them never fires through this entry point.
  return false;
}

/**
 * Layer a unified {@link DoctrineAction} onto an AI state. Maps each axis onto
 * the {@link AiState} flags: `stance`/`stance:"retreat"` → stance or retreat,
 * `targeting.focusFire` → focusFire, `crew:"damageControl"` → prioritiseRepair,
 * `fire` → holdFire. Axes with no AiState counterpart (spatial, whenFiredUpon,
 * etc.) are deferred to the formation-aware layer.
 */
function applyDoctrineAction(state: AiState, action: DoctrineAction): AiState {
  let next = state;
  if (action.stance !== undefined) {
    next =
      action.stance === "retreat"
        ? { ...next, retreat: true }
        : { ...next, stance: action.stance };
  }
  if (action.fire === "holdFire") next = { ...next, holdFire: true };
  else if (action.fire === "atWill") next = { ...next, holdFire: false };
  if (action.targeting?.focusFire === true) next = { ...next, focusFire: true };
  if (action.crew === "damageControl") next = { ...next, prioritiseRepair: true };
  return next;
}

/**
 * Evaluate the doctrine's unified rules (first match wins) against the context,
 * layered onto the doctrine's base stance. Returns the resulting {@link AiState}
 * the engine's targeting/firing/movement steps read. For a run-of-battle ship
 * whose doctrine was compiled from its Orders (via `toSimShip`), the result
 * matches the historical behaviour. Deterministic.
 */
export function effectiveDoctrineAi(
  doctrine: Doctrine,
  ctx: TriggerContext,
): AiState {
  const state = baseAiState(doctrine.base.stance ?? "balanced");
  for (const rule of doctrine.rules) {
    if (conditionSatisfied(rule.condition, ctx)) {
      return applyDoctrineAction(state, rule.then);
    }
  }
  return state;
}
