import {
  ActionIcon,
  Button,
  Divider,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import {
  type Condition as ConditionType,
  type CrewPriority as CrewPriorityType,
  type Doctrine,
  type DoctrineAction,
  type DoctrineRule,
  type ShipStance as ShipStanceType,
  CrewPriority,
  ModuleKind,
  ShipStance,
} from "@/schema/ai";
import { ShipClassification } from "@/schema/armor";

/** Human-readable labels for each ship stance. Keys are sourced from the schema
 *  enum so the compiler catches any drift after a schema change. */
const SHIP_STANCE_LABEL: Record<ShipStanceType, string> = {
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

/** Human-readable labels for each crew priority mode. */
const CREW_PRIORITY_LABEL: Record<CrewPriorityType, string> = {
  combat: "Combat",
  damageControl: "Damage control",
  resupply: "Resupply",
};

/** Stance and crew-priority option lists, sourced from the schema enums so the
 *  designer cannot drift from the canonical vocabulary. The literals come from
 *  `ShipStance.options` / `CrewPriority.options` (Zod exposes the enum's
 *  literal union as `.options`), so adding a stance in the schema automatically
 *  surfaces it here. */
const STANCE_OPTIONS = ShipStance.options.map((s) => ({
  value: s,
  label: SHIP_STANCE_LABEL[s],
}));
const CREW_PRIORITY_OPTIONS = CrewPriority.options.map((p) => ({
  value: p,
  label: CREW_PRIORITY_LABEL[p],
}));

/**
 * The ship-self condition subset the rules editor authors — the legacy trigger
 * kinds, all valid {@link ConditionType} members. A authored LegacyCondition
 * widens to Condition without a cast when added to the doctrine rule list.
 */
type LegacyCondition = Extract<
  ConditionType,
  | { kind: "shieldBelow" }
  | { kind: "structureBelow" }
  | { kind: "targetInRange" }
  | { kind: "targetClass" }
  | { kind: "moduleDestroyed" }
  | { kind: "outclassed" }
>;

/**
 * Condition kind options in a stable display order. Each entry pairs the
 * discriminator string (used as the Select value) with a human-readable label.
 * These are the ship-self conditions that mirror the legacy trigger set; the
 * full {@link Condition} union adds formation/spatial/temporal kinds surfaced
 * in later phases.
 */
const CONDITION_KIND_OPTIONS: { value: LegacyCondition["kind"]; label: string }[] = [
  { value: "shieldBelow", label: "Shield below %" },
  { value: "structureBelow", label: "Structure below %" },
  { value: "targetInRange", label: "Target in range" },
  { value: "targetClass", label: "Target class" },
  { value: "moduleDestroyed", label: "Module destroyed" },
  { value: "outclassed", label: "Outclassed by enemy" },
];

/** The authorable legacy action verbs, each mapping to a DoctrineAction axis. */
type ActionKind =
  | "setStance"
  | "retreat"
  | "focusFire"
  | "prioritiseRepair"
  | "holdFire"
  | "fireAtWill";

/**
 * Action-kind options in a stable display order. Each entry pairs the verb
 * (used as the Select value) with a human-readable label. Selecting one builds
 * the corresponding DoctrineAction via {@link defaultAction}; the player never
 * edits raw DoctrineAction fields.
 */
const ACTION_KIND_OPTIONS: { value: ActionKind; label: string }[] = [
  { value: "setStance", label: "Set stance" },
  { value: "retreat", label: "Retreat" },
  { value: "focusFire", label: "Focus fire" },
  { value: "prioritiseRepair", label: "Prioritise repair" },
  { value: "holdFire", label: "Hold fire" },
  { value: "fireAtWill", label: "Fire at will" },
];

/** Type predicate: narrows a string to a valid condition kind without a cast. */
function isConditionKind(v: string): v is LegacyCondition["kind"] {
  return CONDITION_KIND_OPTIONS.some((o) => o.value === v);
}

/** Type predicate: narrows a string to a valid action kind without a cast. */
function isActionKind(v: string): v is ActionKind {
  return ACTION_KIND_OPTIONS.some((o) => o.value === v);
}

const MODULE_KIND_OPTIONS = ModuleKind.options.map((m) => ({
  value: m,
  label: m,
}));

const SHIP_CLASS_OPTIONS = ShipClassification.options.map((c) => ({
  value: c,
  label: c,
}));

/**
 * Which action kind a DoctrineAction encodes, so the editor can reflect the
 * authored axis back to the player. `undefined` means the action carries no
 * recognised legacy verb (a future-scope axis the editor cannot edit yet).
 */
function actionKindOf(action: DoctrineAction): ActionKind | undefined {
  if (action.stance === "retreat") return "retreat";
  if (action.stance !== undefined) return "setStance";
  if (action.targeting?.focusFire === true) return "focusFire";
  if (action.crew === "damageControl") return "prioritiseRepair";
  if (action.fire === "holdFire") return "holdFire";
  if (action.fire === "atWill") return "fireAtWill";
  return undefined;
}

/** A one-line prose summary of a condition, used in the rule list. */
function conditionDescription(condition: ConditionType): string {
  switch (condition.kind) {
    case "shieldBelow":
      return `shield < ${Math.round(condition.fraction * 100)}%`;
    case "structureBelow":
      return `structure < ${Math.round(condition.fraction * 100)}%`;
    case "targetInRange":
      return `target in range ${condition.min}–${condition.max}`;
    case "targetClass":
      return `target is ${condition.classes.join(" or ")}`;
    case "moduleDestroyed":
      return `${condition.moduleKind} destroyed`;
    case "outclassed":
      return "outclassed by enemy";
    default:
      return condition.kind;
  }
}

/** A one-line prose summary of a DoctrineAction, mirroring the legacy verbs. */
function actionDescription(action: DoctrineAction): string {
  const kind = actionKindOf(action);
  switch (kind) {
    case "setStance":
      return `set stance → ${action.stance}`;
    case "retreat":
      return "retreat";
    case "focusFire":
      return "focus fire";
    case "prioritiseRepair":
      return "prioritise repair";
    case "holdFire":
      return "hold fire";
    case "fireAtWill":
      return "fire at will";
    case undefined:
      return "custom action";
  }
}

/** Default parameter values when switching to a new condition kind. */
function defaultCondition(kind: LegacyCondition["kind"]): LegacyCondition {
  switch (kind) {
    case "shieldBelow":
      return { kind: "shieldBelow", fraction: 0.25 };
    case "structureBelow":
      return { kind: "structureBelow", fraction: 0.5 };
    case "targetInRange":
      return { kind: "targetInRange", min: 0, max: 500 };
    case "targetClass":
      return { kind: "targetClass", classes: ["fighter"] };
    case "moduleDestroyed":
      return { kind: "moduleDestroyed", moduleKind: "shield" };
    case "outclassed":
      return { kind: "outclassed" };
  }
}

/**
 * Build a fresh DoctrineAction for an action kind. The mapping preserves the
 * legacy verb semantics: `setStance` sets the stance axis; `retreat` sets
 * stance to "retreat"; `focusFire` sets the targeting axis; `prioritiseRepair`
 * sets crew to damage control; `holdFire`/`fireAtWill` set the fire axis.
 */
function defaultAction(kind: ActionKind, stance: ShipStanceType): DoctrineAction {
  switch (kind) {
    case "setStance":
      return { stance };
    case "retreat":
      return { stance: "retreat" };
    case "focusFire":
      return { targeting: { mode: { kind: "nearest" }, vulnerableWeight: 0, focusFire: true } };
    case "prioritiseRepair":
      return { crew: "damageControl" };
    case "holdFire":
      return { fire: "holdFire" };
    case "fireAtWill":
      return { fire: "atWill" };
  }
}

/** Inline parameter controls for a condition being edited. */
function ConditionParams({
  condition,
  onChange,
}: {
  condition: LegacyCondition;
  onChange: (next: LegacyCondition) => void;
}) {
  switch (condition.kind) {
    case "shieldBelow":
    case "structureBelow": {
      const pct = Math.round(condition.fraction * 100);
      return (
        <NumberInput
          label="Threshold (%)"
          size="xs"
          min={1}
          max={99}
          value={pct}
          onChange={(v) => {
            const num = typeof v === "number" ? v : Number(v);
            if (!Number.isFinite(num)) return;
            const clamped = Math.max(1, Math.min(99, num));
            onChange({ ...condition, fraction: clamped / 100 });
          }}
        />
      );
    }
    case "targetInRange":
      return (
        <Group grow>
          <NumberInput
            label="Min range"
            size="xs"
            min={0}
            value={condition.min}
            onChange={(v) => {
              const num = typeof v === "number" ? v : Number(v);
              if (!Number.isFinite(num)) return;
              onChange({ ...condition, min: Math.max(0, num) });
            }}
          />
          <NumberInput
            label="Max range"
            size="xs"
            min={0}
            value={condition.max}
            onChange={(v) => {
              const num = typeof v === "number" ? v : Number(v);
              if (!Number.isFinite(num)) return;
              onChange({ ...condition, max: Math.max(0, num) });
            }}
          />
        </Group>
      );
    case "targetClass":
      return (
        <Select
          label="Target class"
          size="xs"
          data={SHIP_CLASS_OPTIONS}
          value={condition.classes[0] ?? "fighter"}
          onChange={(v) => {
            if (v === null) return;
            const parsed = ShipClassification.safeParse(v);
            if (!parsed.success) return;
            onChange({ ...condition, classes: [parsed.data] });
          }}
        />
      );
    case "moduleDestroyed":
      return (
        <Select
          label="Module kind"
          size="xs"
          data={MODULE_KIND_OPTIONS}
          value={condition.moduleKind}
          onChange={(v) => {
            if (v === null) return;
            const parsed = ModuleKind.safeParse(v);
            if (!parsed.success) return;
            onChange({ ...condition, moduleKind: parsed.data });
          }}
        />
      );
    case "outclassed":
      return null;
  }
}

/** Inline parameter controls for a DoctrineAction being edited. */
function ActionParams({
  action,
  onChange,
}: {
  action: DoctrineAction;
  onChange: (next: DoctrineAction) => void;
}) {
  const kind = actionKindOf(action);
  if (kind !== "setStance") return null;
  return (
    <Select
      label="New stance"
      size="xs"
      data={STANCE_OPTIONS}
      value={action.stance ?? "balanced"}
      onChange={(v) => {
        if (v === null) return;
        const parsed = ShipStance.safeParse(v);
        if (!parsed.success) return;
        onChange({ ...action, stance: parsed.data });
      }}
    />
  );
}

/** The inline "add a new rule" form. */
function AddRuleForm({ onAdd }: { onAdd: (rule: DoctrineRule) => void }) {
  const [condition, setCondition] = useState<LegacyCondition>({
    kind: "shieldBelow",
    fraction: 0.25,
  });
  const [actionKind, setActionKind] = useState<ActionKind>("setStance");
  const [action, setAction] = useState<DoctrineAction>({
    stance: "evasive",
  });

  function handleConditionKindChange(v: string | null) {
    if (v === null || !isConditionKind(v)) return;
    setCondition(defaultCondition(v));
  }

  function handleActionKindChange(v: string | null) {
    if (v === null || !isActionKind(v)) return;
    setActionKind(v);
    setAction(defaultAction(v, "evasive"));
  }

  function submit() {
    onAdd({ condition, then: action });
  }

  return (
    <Stack gap="xs">
      <Text size="xs" fw={600} c="dimmed">
        Add rule
      </Text>
      <Select
        label="When (condition)"
        size="xs"
        data={CONDITION_KIND_OPTIONS}
        value={condition.kind}
        onChange={handleConditionKindChange}
      />
      <ConditionParams condition={condition} onChange={setCondition} />
      <Select
        label="Then (action)"
        size="xs"
        data={ACTION_KIND_OPTIONS}
        value={actionKind}
        onChange={handleActionKindChange}
      />
      <ActionParams action={action} onChange={setAction} />
      <Button size="xs" variant="light" onClick={submit}>
        Add rule
      </Button>
    </Stack>
  );
}

/**
 * The behaviour panel: the ship's base stance and crew priority (doctrine base
 * axes), plus the player-authored condition/action rule list. All are
 * persisted on the design as a single {@link Doctrine} and read by the AI
 * interpreter.
 *
 * Rules are evaluated in list order each tick; the first matching rule wins.
 * The base action alone governs behaviour when the rule list is empty.
 */
export function BehaviourPanel({
  doctrine,
  readOnly,
  onDoctrineChange,
}: {
  doctrine: Doctrine;
  readOnly: boolean;
  onDoctrineChange: (next: Doctrine) => void;
}) {
  // The stance and crew selects need concrete values; fall back to the
  // historical defaults when the axis is absent so the control always shows a
  // selection. Selecting a value authors that axis.
  const stance = doctrine.base.stance ?? "balanced";
  const crew = doctrine.base.crew ?? "combat";

  function setBaseStance(next: ShipStanceType) {
    onDoctrineChange({
      ...doctrine,
      base: { ...doctrine.base, stance: next },
    });
  }

  function setBaseCrew(next: CrewPriorityType) {
    onDoctrineChange({
      ...doctrine,
      base: { ...doctrine.base, crew: next },
    });
  }

  function removeRule(index: number) {
    onDoctrineChange({
      ...doctrine,
      rules: doctrine.rules.filter((_, i) => i !== index),
    });
  }

  function addRule(rule: DoctrineRule) {
    onDoctrineChange({ ...doctrine, rules: [...doctrine.rules, rule] });
  }

  return (
    <Paper p="md" withBorder>
      <Stack gap="xs">
        <Select
          label="Ship stance"
          size="xs"
          data={STANCE_OPTIONS}
          value={stance}
          disabled={readOnly}
          onChange={(v) => {
            if (v !== null) {
              const parsed = ShipStance.safeParse(v);
              if (parsed.success) setBaseStance(parsed.data);
            }
          }}
        />
        <Select
          label="Crew priority"
          size="xs"
          data={CREW_PRIORITY_OPTIONS}
          value={crew}
          disabled={readOnly}
          onChange={(v) => {
            if (v !== null) {
              const parsed = CrewPriority.safeParse(v);
              if (parsed.success) setBaseCrew(parsed.data);
            }
          }}
        />

        <Divider my={4} />

        <Text size="xs" fw={600}>
          Rules
        </Text>

        {doctrine.rules.length === 0 ? (
          <Text size="xs" c="dimmed">
            No rules — ship follows stance only.
          </Text>
        ) : (
          <Stack gap={4}>
            {doctrine.rules.map((rule, index) => (
              <Group key={index} justify="space-between" wrap="nowrap">
                <Text size="xs" style={{ flex: 1, minWidth: 0 }}>
                  When {conditionDescription(rule.condition)} &rarr;{" "}
                  {actionDescription(rule.then)}
                </Text>
                {!readOnly && (
                  <ActionIcon
                    size="xs"
                    color="red"
                    variant="subtle"
                    aria-label="Remove rule"
                    onClick={() => removeRule(index)}
                  >
                    <IconTrash size={12} />
                  </ActionIcon>
                )}
              </Group>
            ))}
          </Stack>
        )}

        {!readOnly && (
          <>
            <Divider my={4} />
            <AddRuleForm onAdd={addRule} />
          </>
        )}
      </Stack>
    </Paper>
  );
}
