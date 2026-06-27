/**
 * Pure (no React) condition-vocabulary helpers for the doctrine editor: the
 * optgroup select data, the per-kind default-condition factory, and the
 * kind-narrowing type guard. Kept separate from {@link ConditionEditor.tsx} so
 * that component file exports only components (fast refresh) and so the
 * vocabulary is unit-testable in isolation.
 */

import type { Condition } from "@/schema/ai";

/** Condition-kind options grouped into optgroups for the select, in a stable
 *  display order (ship-self, formation, spatial, temporal, boolean). */
const CONDITION_GROUPS: { group: string; items: { value: Condition["kind"]; label: string }[] }[] = [
  {
    group: "Ship state",
    items: [
      { value: "shieldBelow", label: "Shield below %" },
      { value: "structureBelow", label: "Structure below %" },
      { value: "targetInRange", label: "Target in range" },
      { value: "targetClass", label: "Target is class" },
      { value: "moduleDestroyed", label: "Module destroyed" },
      { value: "outclassed", label: "Outclassed" },
    ],
  },
  {
    group: "Formation state",
    items: [
      { value: "formationStrength", label: "Formation strength" },
      { value: "formationLoss", label: "Formation loss" },
      { value: "formationEngaged", label: "Formation engaged" },
      { value: "formationDestroyed", label: "Formation destroyed" },
      { value: "flagshipLost", label: "Flagship lost" },
    ],
  },
  {
    group: "Spatial",
    items: [
      { value: "range", label: "Range between refs" },
      { value: "crossingLine", label: "Crossing a line" },
      { value: "flanking", label: "Flanking" },
      { value: "localSuperiority", label: "Local superiority" },
    ],
  },
  {
    group: "Temporal",
    items: [
      { value: "phase", label: "Battle phase" },
      { value: "tickAfter", label: "After tick" },
    ],
  },
  {
    group: "Boolean group",
    items: [
      { value: "all", label: "All of (and)" },
      { value: "any", label: "Any of (or)" },
    ],
  },
];

/** The Mantine Select `data` with optgroups, computed once. */
export const CONDITION_SELECT_DATA = CONDITION_GROUPS.map((g) => ({
  group: g.group,
  items: g.items,
}));

/** Every authorable condition kind, for narrowing a string selection. */
const ALL_CONDITION_KINDS: Condition["kind"][] = CONDITION_GROUPS.flatMap((g) =>
  g.items.map((i) => i.value),
);
const CONDITION_KIND_SET: ReadonlySet<string> = new Set(ALL_CONDITION_KINDS);

/** Type guard: narrows a string to a valid condition kind without a cast. */
export function isConditionKind(v: string): v is Condition["kind"] {
  return CONDITION_KIND_SET.has(v);
}

/** Build a fresh, valid Condition of the given kind with sensible defaults. */
export function defaultCondition(kind: Condition["kind"]): Condition {
  switch (kind) {
    case "shieldBelow":
      return { kind: "shieldBelow", fraction: 0.25 };
    case "structureBelow":
      return { kind: "structureBelow", fraction: 0.5 };
    case "targetInRange":
      return { kind: "targetInRange", min: 0, max: 8000 };
    case "targetClass":
      return { kind: "targetClass", classes: ["fighter"] };
    case "moduleDestroyed":
      return { kind: "moduleDestroyed", moduleKind: "shield" };
    case "outclassed":
      return { kind: "outclassed" };
    case "formationStrength":
      return {
        kind: "formationStrength",
        reference: { kind: "self" },
        threshold: 0.5,
        direction: "below",
      };
    case "formationLoss":
      return { kind: "formationLoss", reference: { kind: "self" }, lostFraction: 0.5 };
    case "formationEngaged":
      return { kind: "formationEngaged", reference: { kind: "self" } };
    case "formationDestroyed":
      return { kind: "formationDestroyed", reference: { kind: "self" } };
    case "flagshipLost":
      return { kind: "flagshipLost", reference: { kind: "self" } };
    case "range":
      return {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "enemy", role: "vanguard" },
        min: 0,
        max: 10000,
      };
    case "crossingLine":
      return {
        kind: "crossingLine",
        reference: { kind: "self" },
        lineA: { kind: "deployment" },
        lineB: { kind: "deployment" },
      };
    case "flanking":
      return { kind: "flanking", reference: { kind: "self" } };
    case "localSuperiority":
      return { kind: "localSuperiority", reference: { kind: "self" }, minRatio: 1.5 };
    case "phase":
      return { kind: "phase", phase: "contact" };
    case "tickAfter":
      return { kind: "tickAfter", tick: 600 };
    case "all":
      return { kind: "all", of: [{ kind: "outclassed" }] };
    case "any":
      return { kind: "any", of: [{ kind: "outclassed" }] };
  }
}
