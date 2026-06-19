/**
 * Ship AI interpreter (Phase 7). A ship's behaviour is its base stance (a
 * preset: target selection, desired range, built-in conditionals) plus an
 * ordered list of player-authored trigger/action rules that layer on top. The
 * engine evaluates the rules in list order each tick; the first rule whose
 * trigger is satisfied wins (later rules do not stack — see the Rule schema),
 * and its action overrides/extends the stance for that tick. Fully
 * deterministic: no RNG, fixed rule order, pure predicates over frame state.
 *
 * This module is the pure interpreter — `triggerSatisfied` and `effectiveAi`.
 * It does not decide targets or move ships; it produces an {@link AiState} the
 * engine's targeting/firing/movement reads. Wiring is integration.
 */

import type {
  Action,
  ModuleKind,
  Rule,
  ShipStance,
  Trigger,
} from "@/schema/ai";
import type { ShipClassification } from "@/schema/armor";

/** The per-tick AI decision layered onto the stance by the matching rule. The
 *  engine reads these flags: `holdFire` ceases weapon fire, `focusFire`
 *  concentrates fire with allies on a shared target, `retreat` disengages,
 *  `prioritiseRepair` directs crew toward repair, `rally` returns to the
 *  fleet's formation reference. `stance` is the effective stance (the base,
 *  or one overridden by a `setStance` action). */
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

/** Whether a trigger's condition is satisfied by the given context. Pure. */
export function triggerSatisfied(
  trigger: Trigger,
  ctx: TriggerContext,
): boolean {
  switch (trigger.kind) {
    case "shieldBelow":
      return ctx.shieldFraction < trigger.fraction;
    case "structureBelow":
      return ctx.structureFraction < trigger.fraction;
    case "targetInRange":
      // No target -> the range condition cannot be met.
      return (
        ctx.targetRange !== undefined &&
        ctx.targetRange >= trigger.min &&
        ctx.targetRange <= trigger.max
      );
    case "targetClass":
      return (
        ctx.targetClassification !== undefined &&
        trigger.classes.includes(ctx.targetClassification)
      );
    case "moduleDestroyed":
      return ctx.destroyedModuleKinds.has(trigger.moduleKind);
    case "outclassed":
      return ctx.outclassed;
  }
}

/** Layer an action onto an AI state (mutates a copy). `setStance` switches the
 *  effective stance; the flag actions set their flag. */
function applyAction(state: AiState, action: Action): AiState {
  switch (action.kind) {
    case "setStance":
      return { ...state, stance: action.stance };
    case "retreat":
      return { ...state, retreat: true };
    case "focusFire":
      return { ...state, focusFire: true };
    case "prioritiseRepair":
      return { ...state, prioritiseRepair: true };
    case "holdFire":
      return { ...state, holdFire: true };
    case "fireAtWill":
      return { ...state, holdFire: false };
    case "rally":
      return { ...state, rally: true };
  }
}

/** Evaluate a ship's rules in order against the context and return the
 *  effective AI state: the base stance, overridden by the FIRST matching
 *  rule's action (first-match-wins, per the Rule schema). If no rule matches,
 *  the base stance stands. Deterministic. */
export function effectiveAi(
  baseStance: ShipStance,
  rules: readonly Rule[],
  ctx: TriggerContext,
): AiState {
  const state = baseAiState(baseStance);
  for (const rule of rules) {
    if (triggerSatisfied(rule.trigger, ctx)) {
      return applyAction(state, rule.action);
    }
  }
  return state;
}
