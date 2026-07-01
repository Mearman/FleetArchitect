/**
 * The condition half of the doctrine editor. A recursive {@link ConditionEditor}
 * dispatches by kind, surfacing the relevant parameter controls for each. A
 * FormationReference-bearing condition uses the recursive
 * {@link FormationReferencePicker}; an `all`/`any` group uses
 * {@link BooleanGroupEditor} which nests further condition editors (capped at 4
 * sub-conditions per the schema).
 *
 * Split from {@link DoctrineEditor.tsx} so each file stays under the line limit
 * and exports only components (fast refresh).
 */

import {
  ActionIcon,
  Group,
  NumberInput,
  Select,
  Slider,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { type Condition, type FormationReference, ModuleKind } from "@/schema/ai";
import { ShipClassification } from "@/schema/armor";
import { conditionDescription } from "@/ui/components/doctrine-describe";
import {
  CONDITION_SELECT_DATA,
  defaultCondition,
  isConditionKind,
} from "@/ui/components/doctrine-condition-options";
import {
  betweenRow,
  nestedGroup,
  ruleBody,
  ruleCard,
  ruleControls,
  ruleHeader,
  ruleSummary,
  sectionLabel,
} from "@/ui/components/DoctrineEditor.css";

/** The discriminator strings a FormationReference can take, with labels. */
const REFERENCE_KIND_OPTIONS: { value: FormationReference["kind"]; label: string }[] = [
  { value: "self", label: "Self (own formation)" },
  { value: "friendly", label: "Friendly formation (role)" },
  { value: "enemy", label: "Enemy formation (role)" },
  { value: "enemyArchetype", label: "Enemy archetype" },
  { value: "point", label: "Waypoint (id)" },
  { value: "deployment", label: "Deployment line" },
  { value: "target", label: "Current target" },
  { value: "between", label: "Between two refs" },
];

const REFERENCE_KIND_SET: ReadonlySet<string> = new Set(
  REFERENCE_KIND_OPTIONS.map((o) => o.value),
);

/** Type guard for a formation-reference kind string. */
function isReferenceKind(v: string): v is FormationReference["kind"] {
  return REFERENCE_KIND_SET.has(v);
}

/** Build a fresh, valid FormationReference for a given kind (sensible defaults). */
function defaultReference(kind: FormationReference["kind"]): FormationReference {
  switch (kind) {
    case "self":
      return { kind: "self" };
    case "friendly":
      return { kind: "friendly", role: "vanguard" };
    case "enemy":
      return { kind: "enemy", role: "vanguard" };
    case "enemyArchetype":
      return { kind: "enemyArchetype", archetype: "cruiser" };
    case "point":
      return { kind: "point", pointId: "wp1" };
    case "deployment":
      return { kind: "deployment" };
    case "target":
      return { kind: "target" };
    case "between":
      return {
        kind: "between",
        a: { kind: "friendly", role: "vanguard" },
        b: { kind: "enemy", role: "vanguard" },
        alpha: 0.5,
      };
  }
}

/** Coerce a Mantine NumberInput value (number | string) to a finite number. */
function toNumber(val: number | string | undefined, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

/** A compact formation-reference picker: a kind select plus per-kind parameter
 *  inputs (role text, archetype select, point id, or the recursive `between`
 *  a/b pickers + alpha slider). */
export function FormationReferencePicker({
  reference,
  onChange,
  label,
}: {
  reference: FormationReference;
  onChange: (next: FormationReference) => void;
  label: string;
}) {
  return (
    <Stack gap="xs">
      <Select
        label={label}
        size="xs"
        data={REFERENCE_KIND_OPTIONS}
        value={reference.kind}
        onChange={(v) => {
          if (v !== null && isReferenceKind(v)) onChange(defaultReference(v));
        }}
      />
      {(reference.kind === "friendly" || reference.kind === "enemy") && (
        <TextInput
          label="Role"
          size="xs"
          placeholder="e.g. vanguard, carrier, screen"
          value={reference.role}
          onChange={(e) => onChange({ ...reference, role: e.target.value })}
        />
      )}
      {reference.kind === "enemyArchetype" && (
        <Select
          label="Archetype"
          size="xs"
          data={ShipClassification.options.map((c) => ({ value: c, label: c }))}
          value={reference.archetype}
          onChange={(v) => {
            if (v === null) return;
            const parsed = ShipClassification.safeParse(v);
            if (parsed.success) onChange({ ...reference, archetype: parsed.data });
          }}
        />
      )}
      {reference.kind === "point" && (
        <TextInput
          label="Waypoint id"
          size="xs"
          value={reference.pointId}
          onChange={(e) => onChange({ ...reference, pointId: e.target.value })}
        />
      )}
      {reference.kind === "between" && (
        <>
          <div className={betweenRow}>
            <FormationReferencePicker
              label="From"
              reference={reference.a}
              onChange={(a) => onChange({ ...reference, a })}
            />
            <FormationReferencePicker
              label="To"
              reference={reference.b}
              onChange={(b) => onChange({ ...reference, b })}
            />
          </div>
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Interpolation
              </Text>
              <Text size="xs" c="dimmed">
                {Math.round(reference.alpha * 100)}%
              </Text>
            </Group>
            <Slider
              size="md"
              min={0}
              max={1}
              step={0.05}
              value={reference.alpha}
              onChange={(alpha) => onChange({ ...reference, alpha })}
            />
          </Stack>
        </>
      )}
    </Stack>
  );
}

/** Inline parameter controls for one condition. Dispatches by kind. */
export function ConditionEditor({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (next: Condition) => void;
}) {
  switch (condition.kind) {
    case "shieldBelow":
    case "structureBelow": {
      const pct = Math.round(condition.fraction * 100);
      return (
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Threshold
            </Text>
            <Text size="xs" c="dimmed">
              {pct}%
            </Text>
          </Group>
          <Slider
            size="md"
            min={1}
            max={99}
            step={1}
            value={pct}
            onChange={(v) => onChange({ ...condition, fraction: v / 100 })}
          />
        </Stack>
      );
    }
    case "targetInRange":
      return (
        <Group grow>
          <NumberInput
            label="Min (m)"
            size="xs"
            min={0}
            value={condition.min}
            onChange={(v) => onChange({ ...condition, min: Math.max(0, toNumber(v)) })}
          />
          <NumberInput
            label="Max (m)"
            size="xs"
            min={0}
            value={condition.max}
            onChange={(v) => onChange({ ...condition, max: Math.max(0, toNumber(v)) })}
          />
        </Group>
      );
    case "targetClass":
      return (
        <Select
          label="Class"
          size="xs"
          data={ShipClassification.options.map((c) => ({ value: c, label: c }))}
          value={condition.classes[0] ?? "fighter"}
          onChange={(v) => {
            if (v === null) return;
            const parsed = ShipClassification.safeParse(v);
            if (parsed.success) onChange({ ...condition, classes: [parsed.data] });
          }}
        />
      );
    case "moduleDestroyed":
      return (
        <Select
          label="Module kind"
          size="xs"
          data={ModuleKind.options.map((m) => ({ value: m, label: m }))}
          value={condition.moduleKind}
          onChange={(v) => {
            if (v === null) return;
            const parsed = ModuleKind.safeParse(v);
            if (parsed.success) onChange({ ...condition, moduleKind: parsed.data });
          }}
        />
      );
    case "outclassed":
      return null;
    case "formationStrength":
      return (
        <Stack gap="xs">
          <FormationReferencePicker
            label="Formation"
            reference={condition.reference}
            onChange={(reference) => onChange({ ...condition, reference })}
          />
          <Group grow>
            <NumberInput
              label="Threshold (%)"
              size="xs"
              min={1}
              max={99}
              value={Math.round(condition.threshold * 100)}
              onChange={(v) =>
                onChange({
                  ...condition,
                  threshold: Math.max(0.01, Math.min(0.99, toNumber(v, 50) / 100)),
                })
              }
            />
            <Select
              label="Direction"
              size="xs"
              data={[
                { value: "below", label: "Below" },
                { value: "above", label: "Above" },
              ]}
              value={condition.direction}
              onChange={(v) =>
                v === "below" || v === "above"
                  ? onChange({ ...condition, direction: v })
                  : undefined
              }
            />
          </Group>
        </Stack>
      );
    case "formationLoss":
      return (
        <Stack gap="xs">
          <FormationReferencePicker
            label="Formation"
            reference={condition.reference}
            onChange={(reference) => onChange({ ...condition, reference })}
          />
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Lost fraction
              </Text>
              <Text size="xs" c="dimmed">
                {Math.round(condition.lostFraction * 100)}%
              </Text>
            </Group>
            <Slider
              size="md"
              min={0.05}
              max={1}
              step={0.05}
              value={condition.lostFraction}
              onChange={(lostFraction) => onChange({ ...condition, lostFraction })}
            />
          </Stack>
        </Stack>
      );
    case "formationEngaged":
    case "formationDestroyed":
    case "flagshipLost":
    case "flanking":
      return (
        <FormationReferencePicker
          label="Formation"
          reference={condition.reference}
          onChange={(reference) => onChange({ ...condition, reference })}
        />
      );
    case "range":
      return (
        <Stack gap="xs">
          <div className={betweenRow}>
            <FormationReferencePicker
              label="From"
              reference={condition.a}
              onChange={(a) => onChange({ ...condition, a })}
            />
            <FormationReferencePicker
              label="To"
              reference={condition.b}
              onChange={(b) => onChange({ ...condition, b })}
            />
          </div>
          <Group grow>
            <NumberInput
              label="Min (m)"
              size="xs"
              min={0}
              value={condition.min}
              onChange={(v) => onChange({ ...condition, min: Math.max(0, toNumber(v)) })}
            />
            <NumberInput
              label="Max (m)"
              size="xs"
              min={0}
              value={condition.max}
              onChange={(v) => onChange({ ...condition, max: Math.max(0, toNumber(v)) })}
            />
          </Group>
        </Stack>
      );
    case "crossingLine":
      return (
        <Stack gap="xs">
          <FormationReferencePicker
            label="What"
            reference={condition.reference}
            onChange={(reference) => onChange({ ...condition, reference })}
          />
          <div className={betweenRow}>
            <FormationReferencePicker
              label="Line from"
              reference={condition.lineA}
              onChange={(lineA) => onChange({ ...condition, lineA })}
            />
            <FormationReferencePicker
              label="Line to"
              reference={condition.lineB}
              onChange={(lineB) => onChange({ ...condition, lineB })}
            />
          </div>
        </Stack>
      );
    case "localSuperiority":
      return (
        <Stack gap="xs">
          <FormationReferencePicker
            label="Around"
            reference={condition.reference}
            onChange={(reference) => onChange({ ...condition, reference })}
          />
          <NumberInput
            label="Min ratio (friendly:enemy)"
            size="xs"
            min={0.1}
            step={0.1}
            value={condition.minRatio}
            onChange={(v) => onChange({ ...condition, minRatio: Math.max(0, toNumber(v, 1)) })}
          />
        </Stack>
      );
    case "friendlyInLineOfFire":
      return (
        <NumberInput
          label="Tolerance (degrees)"
          size="xs"
          min={0}
          max={180}
          step={1}
          value={condition.toleranceDeg}
          onChange={(v) => onChange({ ...condition, toleranceDeg: Math.max(0, toNumber(v, 5)) })}
        />
      );
    case "friendlyProximity":
      return (
        <Group grow>
          <NumberInput
            label="Threshold (m)"
            size="xs"
            min={0}
            step={10}
            value={condition.threshold}
            onChange={(v) => onChange({ ...condition, threshold: Math.max(0, toNumber(v)) })}
          />
          <Select
            label="Direction"
            size="xs"
            data={[
              { value: "within", label: "Within" },
              { value: "beyond", label: "Beyond" },
            ]}
            value={condition.direction}
            onChange={(v) =>
              v === "within" || v === "beyond"
                ? onChange({ ...condition, direction: v })
                : undefined
            }
          />
        </Group>
      );
    case "phase":
      return (
        <Select
          label="Phase"
          size="xs"
          data={[
            { value: "opening", label: "Opening" },
            { value: "contact", label: "Contact" },
            { value: "closing", label: "Closing" },
            { value: "mopUp", label: "Mop-up" },
          ]}
          value={condition.phase}
          onChange={(v) => {
            if (v === "opening" || v === "contact" || v === "closing" || v === "mopUp") {
              onChange({ ...condition, phase: v });
            }
          }}
        />
      );
    case "tickAfter":
      return (
        <NumberInput
          label="After tick"
          size="xs"
          min={0}
          step={60}
          value={condition.tick}
          onChange={(v) => onChange({ ...condition, tick: Math.max(0, Math.round(toNumber(v))) })}
        />
      );
    case "all":
    case "any":
      return <BooleanGroupEditor group={condition} onChange={onChange} />;
  }
}

/** Editor for an `all`/`any` boolean group: an ordered list of sub-conditions
 *  (capped at 4 per the schema), each editable inline with a remove button, and
 *  an add-sub-condition picker. Recurses through {@link ConditionEditor}. */
function BooleanGroupEditor({
  group,
  onChange,
}: {
  group: Extract<Condition, { kind: "all" | "any" }>;
  onChange: (next: Condition) => void;
}) {
  const cap = 4;
  function setChild(index: number, next: Condition) {
    const of = group.of.slice();
    of[index] = next;
    onChange({ ...group, of });
  }
  function removeChild(index: number) {
    onChange({ ...group, of: group.of.filter((_, i) => i !== index) });
  }
  function addChild(kind: Condition["kind"]) {
    if (group.of.length >= cap) return;
    onChange({ ...group, of: [...group.of, defaultCondition(kind)] });
  }
  return (
    <div className={nestedGroup}>
      <div className={sectionLabel}>
        {group.kind === "all" ? "All of" : "Any of"} ({group.of.length}/{cap})
      </div>
      {group.of.map((child, index) => (
        <div key={index} className={ruleCard}>
          <div className={ruleHeader}>
            <span className={ruleSummary}>{conditionDescription(child)}</span>
            <div className={ruleControls}>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="red"
                aria-label="Remove sub-condition"
                onClick={() => removeChild(index)}
              >
                <IconTrash size={12} />
              </ActionIcon>
            </div>
          </div>
          <div className={ruleBody}>
            <Select
              label="Sub-condition"
              size="xs"
              data={CONDITION_SELECT_DATA}
              value={child.kind}
              onChange={(v) => {
                if (v !== null && isConditionKind(v)) setChild(index, defaultCondition(v));
              }}
            />
            <ConditionEditor condition={child} onChange={(next) => setChild(index, next)} />
          </div>
        </div>
      ))}
      {group.of.length < cap && (
        <Select
          size="xs"
          placeholder="Add sub-condition"
          data={CONDITION_SELECT_DATA}
          value={null}
          onChange={(v) => {
            if (v !== null && isConditionKind(v)) addChild(v);
          }}
        />
      )}
    </div>
  );
}

/** Re-exported so {@link DoctrineEditor} can build the rule-card condition
 *  picker without re-deriving the option list. */
