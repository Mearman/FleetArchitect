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
  type Action as ActionType,
  type CrewPriority as CrewPriorityType,
  type Rule,
  type ShipStance as ShipStanceType,
  type Trigger as TriggerType,
  Action,
  CrewPriority,
  ModuleKind,
  ShipStance,
  Trigger,
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

/** Trigger kind options in a stable display order. Each entry pairs the
 *  discriminator string (used as the Select value) with a human-readable label.
 *  The type annotation on `value` ensures every kind in the `Trigger` union has
 *  an entry and prevents stale labels after schema changes. */
const TRIGGER_KIND_OPTIONS: { value: TriggerType["kind"]; label: string }[] = [
  { value: "shieldBelow", label: "Shield below %" },
  { value: "structureBelow", label: "Structure below %" },
  { value: "targetInRange", label: "Target in range" },
  { value: "targetClass", label: "Target class" },
  { value: "moduleDestroyed", label: "Module destroyed" },
  { value: "outclassed", label: "Outclassed by enemy" },
];

/** Action kind options in a stable display order. */
const ACTION_KIND_OPTIONS: { value: ActionType["kind"]; label: string }[] = [
  { value: "setStance", label: "Set stance" },
  { value: "retreat", label: "Retreat" },
  { value: "focusFire", label: "Focus fire" },
  { value: "prioritiseRepair", label: "Prioritise repair" },
  { value: "holdFire", label: "Hold fire" },
  { value: "fireAtWill", label: "Fire at will" },
  { value: "rally", label: "Rally" },
];

/** Type predicate: narrows a string to a valid trigger kind without a cast. */
function isTriggerKind(v: string): v is TriggerType["kind"] {
  return TRIGGER_KIND_OPTIONS.some((o) => o.value === v);
}

/** Type predicate: narrows a string to a valid action kind without a cast. */
function isActionKind(v: string): v is ActionType["kind"] {
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

/** A one-line prose summary of a trigger, used in the rule list. */
function triggerDescription(trigger: TriggerType): string {
  switch (trigger.kind) {
    case "shieldBelow":
      return `shield < ${Math.round(trigger.fraction * 100)}%`;
    case "structureBelow":
      return `structure < ${Math.round(trigger.fraction * 100)}%`;
    case "targetInRange":
      return `target in range ${trigger.min}–${trigger.max}`;
    case "targetClass":
      return `target is ${trigger.classes.join(" or ")}`;
    case "moduleDestroyed":
      return `${trigger.moduleKind} destroyed`;
    case "outclassed":
      return "outclassed by enemy";
  }
}

/** A one-line prose summary of an action. */
function actionDescription(action: ActionType): string {
  switch (action.kind) {
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
    case "rally":
      return "rally";
  }
}

/** Default parameter values when switching to a new trigger kind. */
function defaultTrigger(kind: TriggerType["kind"]): TriggerType {
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

/** Default parameter values when switching to a new action kind. */
function defaultAction(kind: ActionType["kind"]): ActionType {
  switch (kind) {
    case "setStance":
      return { kind: "setStance", stance: "evasive" };
    case "retreat":
      return { kind: "retreat" };
    case "focusFire":
      return { kind: "focusFire" };
    case "prioritiseRepair":
      return { kind: "prioritiseRepair" };
    case "holdFire":
      return { kind: "holdFire" };
    case "fireAtWill":
      return { kind: "fireAtWill" };
    case "rally":
      return { kind: "rally" };
  }
}

/** Inline parameter controls for a trigger being edited. */
function TriggerParams({
  trigger,
  onChange,
}: {
  trigger: TriggerType;
  onChange: (next: TriggerType) => void;
}) {
  switch (trigger.kind) {
    case "shieldBelow":
    case "structureBelow": {
      const pct = Math.round(trigger.fraction * 100);
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
            onChange({ ...trigger, fraction: clamped / 100 });
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
            value={trigger.min}
            onChange={(v) => {
              const num = typeof v === "number" ? v : Number(v);
              if (!Number.isFinite(num)) return;
              onChange({ ...trigger, min: Math.max(0, num) });
            }}
          />
          <NumberInput
            label="Max range"
            size="xs"
            min={0}
            value={trigger.max}
            onChange={(v) => {
              const num = typeof v === "number" ? v : Number(v);
              if (!Number.isFinite(num)) return;
              onChange({ ...trigger, max: Math.max(0, num) });
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
          value={trigger.classes[0] ?? "fighter"}
          onChange={(v) => {
            if (v === null) return;
            const parsed = ShipClassification.safeParse(v);
            if (!parsed.success) return;
            onChange({ ...trigger, classes: [parsed.data] });
          }}
        />
      );
    case "moduleDestroyed":
      return (
        <Select
          label="Module kind"
          size="xs"
          data={MODULE_KIND_OPTIONS}
          value={trigger.moduleKind}
          onChange={(v) => {
            if (v === null) return;
            const parsed = ModuleKind.safeParse(v);
            if (!parsed.success) return;
            onChange({ ...trigger, moduleKind: parsed.data });
          }}
        />
      );
    case "outclassed":
      return null;
  }
}

/** Inline parameter controls for an action being edited. */
function ActionParams({
  action,
  onChange,
}: {
  action: ActionType;
  onChange: (next: ActionType) => void;
}) {
  if (action.kind !== "setStance") return null;
  return (
    <Select
      label="New stance"
      size="xs"
      data={STANCE_OPTIONS}
      value={action.stance}
      onChange={(v) => {
        if (v === null) return;
        const parsed = ShipStance.safeParse(v);
        if (!parsed.success) return;
        onChange({ kind: "setStance", stance: parsed.data });
      }}
    />
  );
}

/** The inline "add a new rule" form. */
function AddRuleForm({ onAdd }: { onAdd: (rule: Rule) => void }) {
  const [trigger, setTrigger] = useState<TriggerType>({
    kind: "shieldBelow",
    fraction: 0.25,
  });
  const [action, setAction] = useState<ActionType>({
    kind: "setStance",
    stance: "evasive",
  });

  function handleTriggerKindChange(v: string | null) {
    if (v === null || !isTriggerKind(v)) return;
    setTrigger(defaultTrigger(v));
  }

  function handleActionKindChange(v: string | null) {
    if (v === null || !isActionKind(v)) return;
    setAction(defaultAction(v));
  }

  function submit() {
    const parsedTrigger = Trigger.safeParse(trigger);
    const parsedAction = Action.safeParse(action);
    if (!parsedTrigger.success || !parsedAction.success) return;
    onAdd({ trigger: parsedTrigger.data, action: parsedAction.data });
  }

  return (
    <Stack gap="xs">
      <Text size="xs" fw={600} c="dimmed">
        Add rule
      </Text>
      <Select
        label="When (trigger)"
        size="xs"
        data={TRIGGER_KIND_OPTIONS}
        value={trigger.kind}
        onChange={handleTriggerKindChange}
      />
      <TriggerParams trigger={trigger} onChange={setTrigger} />
      <Select
        label="Then (action)"
        size="xs"
        data={ACTION_KIND_OPTIONS}
        value={action.kind}
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
 * The behaviour panel: the ship's base stance, the crew task-scheduler
 * priority mode, and the player-authored trigger/action rule list. All three
 * are persisted on the design and read by the AI interpreter.
 *
 * Rules are evaluated in list order each tick; the first matching rule wins.
 * The stance alone governs behaviour when the rule list is empty.
 */
export function BehaviourPanel({
  shipStance,
  crewPriority,
  rules,
  readOnly,
  onStanceChange,
  onPriorityChange,
  onRulesChange,
}: {
  shipStance: ShipStanceType;
  crewPriority: CrewPriorityType;
  rules: Rule[];
  readOnly: boolean;
  onStanceChange: (next: ShipStanceType) => void;
  onPriorityChange: (next: CrewPriorityType) => void;
  onRulesChange: (next: Rule[]) => void;
}) {
  function removeRule(index: number) {
    onRulesChange(rules.filter((_, i) => i !== index));
  }

  function addRule(rule: Rule) {
    onRulesChange([...rules, rule]);
  }

  return (
    <Paper p="md" withBorder>
      <Stack gap="xs">
        <Select
          label="Ship stance"
          size="xs"
          data={STANCE_OPTIONS}
          value={shipStance}
          disabled={readOnly}
          onChange={(v) => {
            if (v !== null) onStanceChange(ShipStance.parse(v));
          }}
        />
        <Select
          label="Crew priority"
          size="xs"
          data={CREW_PRIORITY_OPTIONS}
          value={crewPriority}
          disabled={readOnly}
          onChange={(v) => {
            if (v !== null) onPriorityChange(CrewPriority.parse(v));
          }}
        />

        <Divider my={4} />

        <Text size="xs" fw={600}>
          Rules
        </Text>

        {rules.length === 0 ? (
          <Text size="xs" c="dimmed">
            No rules — ship follows stance only.
          </Text>
        ) : (
          <Stack gap={4}>
            {rules.map((rule, index) => (
              <Group key={index} justify="space-between" wrap="nowrap">
                <Text size="xs" style={{ flex: 1, minWidth: 0 }}>
                  When {triggerDescription(rule.trigger)} &rarr;{" "}
                  {actionDescription(rule.action)}
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
