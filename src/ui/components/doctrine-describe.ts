/**
 * Pure (no React) helpers for the doctrine editor: human-readable descriptions
 * of references, conditions, spatial objectives, actions, and doctrines, plus
 * the shared option lists and default-condition factory. Kept separate from the
 * component file so {@link DoctrineEditor.tsx} exports only components (fast
 * refresh) and so the description logic is unit-testable in isolation.
 */

import type {
  Condition,
  Doctrine,
  DoctrineAction,
  FormationReference,
} from "@/schema/ai";
import { CrewPriority, ShipStance } from "@/schema/ai";
import { ShipClassification } from "@/schema/armor";

/** Human-readable stance labels, keyed over the schema enum so drift is caught. */
export const SHIP_STANCE_LABEL: Record<ShipStance, string> = {
  aggressive: "Aggressive",
  balanced: "Balanced",
  defensive: "Defensive",
  evasive: "Evasive",
  interceptor: "Interceptor",
  escort: "Escort",
  sniper: "Sniper",
  hold: "Hold",
  retreat: "Retreat",
};

export const CREW_PRIORITY_LABEL: Record<CrewPriority, string> = {
  combat: "Combat",
  damageControl: "Damage control",
  resupply: "Resupply",
};

/** Stance, crew, and module-class option lists, sourced from the schema enums. */
export const STANCE_OPTIONS = ShipStance.options.map((s) => ({
  value: s,
  label: SHIP_STANCE_LABEL[s],
}));
export const CREW_OPTIONS = CrewPriority.options.map((p) => ({
  value: p,
  label: CREW_PRIORITY_LABEL[p],
}));
export const SHIP_CLASS_OPTIONS = ShipClassification.options.map((c) => ({ value: c, label: c }));

/** A one-line prose summary of a FormationReference, used in rule summaries. */
export function referenceDescription(ref: FormationReference): string {
  switch (ref.kind) {
    case "self":
      return "self";
    case "friendly":
      return `friendly:${ref.role}`;
    case "enemy":
      return `enemy:${ref.role}`;
    case "enemyArchetype":
      return `enemy ${ref.archetype}`;
    case "point":
      return `point:${ref.pointId}`;
    case "deployment":
      return "deployment line";
    case "target":
      return "target";
    case "between":
      return `between(${referenceDescription(ref.a)}, ${referenceDescription(ref.b)})`;
  }
}

/** A short summary of a spatial objective (range + bearing + reference). */
export function spatialDescription(spatial: NonNullable<DoctrineAction["spatial"]>): string {
  const ref = referenceDescription(spatial.reference);
  const range =
    spatial.range.kind === "engage"
      ? `engage ${Math.round(spatial.range.fraction * 100)}%`
      : spatial.range.kind === "hold"
        ? `hold ${Math.round(spatial.range.band * 100)}%`
        : spatial.range.kind === "close"
          ? "close"
          : spatial.range.kind === "evade"
            ? `evade > ${spatial.range.minRange}m`
            : spatial.range.kind === "kite"
              ? `kite ${spatial.range.maxRange}m`
              : `maintain ${spatial.range.range}m`;
  const bearing =
    spatial.bearing.kind === "free"
      ? "free bearing"
      : spatial.bearing.kind === "orbit"
        ? "orbit"
        : spatial.bearing.kind === "offset"
          ? `offset ${Math.round(spatial.bearing.angle)}rad`
          : spatial.bearing.kind;
  return `${range} @ ${ref} (${bearing})`;
}

/** A one-line prose summary of a DoctrineAction (for rule summaries). */
export function actionDescription(action: DoctrineAction): string {
  const parts: string[] = [];
  if (action.stance !== undefined) parts.push(SHIP_STANCE_LABEL[action.stance].toLowerCase());
  if (action.fire !== undefined) parts.push(action.fire);
  if (action.crew !== undefined && action.crew !== "combat") {
    parts.push(CREW_PRIORITY_LABEL[action.crew].toLowerCase());
  }
  if (action.targeting?.focusFire === true) parts.push("focus fire");
  if (action.cohesion !== undefined && action.cohesion > 0) {
    parts.push(`cohesion ${Math.round(action.cohesion * 100)}%`);
  }
  if (action.retreat !== undefined && action.retreat > 0) {
    parts.push(`retreat ${Math.round(action.retreat * 100)}%`);
  }
  if (action.spatial !== undefined) parts.push(spatialDescription(action.spatial));
  return parts.length === 0 ? "no axes set" : parts.join(", ");
}

/** A compact one-line doctrine summary: base action plus the rule count. */
export function doctrineSummary(doctrine: Doctrine): string {
  const base = actionDescription(doctrine.base);
  if (doctrine.rules.length === 0) return base;
  return `${base} + ${doctrine.rules.length} rule${doctrine.rules.length === 1 ? "" : "s"}`;
}

/** A one-line prose summary of a condition. */
export function conditionDescription(condition: Condition): string {
  switch (condition.kind) {
    case "shieldBelow":
      return `shield < ${Math.round(condition.fraction * 100)}%`;
    case "structureBelow":
      return `structure < ${Math.round(condition.fraction * 100)}%`;
    case "targetInRange":
      return `target in ${condition.min}–${condition.max}m`;
    case "targetClass":
      return `target is ${condition.classes.join(" / ")}`;
    case "moduleDestroyed":
      return `${condition.moduleKind} destroyed`;
    case "outclassed":
      return "outclassed";
    case "formationStrength":
      return `${referenceDescription(condition.reference)} strength ${condition.direction} ${Math.round(condition.threshold * 100)}%`;
    case "formationLoss":
      return `${referenceDescription(condition.reference)} lost ${Math.round(condition.lostFraction * 100)}%`;
    case "formationEngaged":
      return `${referenceDescription(condition.reference)} engaged`;
    case "formationDestroyed":
      return `${referenceDescription(condition.reference)} destroyed`;
    case "flagshipLost":
      return `${referenceDescription(condition.reference)} flagship lost`;
    case "range":
      return `range ${referenceDescription(condition.a)}↔${referenceDescription(condition.b)} in ${condition.min}–${condition.max}m`;
    case "crossingLine":
      return `${referenceDescription(condition.reference)} crossing line`;
    case "flanking":
      return `${referenceDescription(condition.reference)} flanking`;
    case "localSuperiority":
      return `local superiority at ${referenceDescription(condition.reference)} ≥ ${condition.minRatio.toFixed(1)}`;
    case "phase":
      return `phase is ${condition.phase}`;
    case "tickAfter":
      return `after tick ${condition.tick}`;
    case "all":
      return `all of (${condition.of.length})`;
    case "any":
      return `any of (${condition.of.length})`;
  }
}
