/**
 * The doctrine editor: a base-action editor (posture preset + axes) and an
 * ordered, editable rule list (first match wins). Used at formation scope in the
 * fleet builder. Rules evaluate in list order; the base action governs when no
 * rule fires.
 *
 * The condition half (condition kinds + FormationReference picker + boolean
 * groups) lives in {@link ConditionEditor.tsx}; the pure description helpers
 * live in {@link doctrine-describe.ts}. This file exports only the
 * {@link DoctrineEditor} component plus the {@link ActionEditor} so a rule card
 * can reuse it.
 */

import {
  ActionIcon,
  Button,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Select,
  Slider,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import {
  type Doctrine,
  type DoctrineAction,
  type DoctrineRule,
  CrewPriority,
  FireDiscipline,
  ShipStance,
} from "@/schema/ai";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import {
  CONDITION_SELECT_DATA,
  defaultCondition,
  isConditionKind,
} from "@/ui/components/doctrine-condition-options";
import {
  ConditionEditor,
  FormationReferencePicker,
} from "@/ui/components/ConditionEditor";
import {
  CREW_OPTIONS,
  STANCE_OPTIONS,
  actionDescription,
  conditionDescription,
  spatialDescription,
} from "@/ui/components/doctrine-describe";
import { POSTURE_PRESET_LIST, type PostureKey } from "@/data/presets/postures";
import {
  doctrineEditor,
  hint,
  pairGrid,
  presetRow,
  ruleBody,
  ruleCard,
  ruleControls,
  ruleHeader,
  ruleSummary,
  sectionLabel,
} from "@/ui/components/DoctrineEditor.css";

const FIRE_DISCIPLINE_LABEL: Record<FireDiscipline, string> = {
  atWill: "At will",
  holdFire: "Hold fire",
  whenFiredUpon: "When fired upon",
  onlyAt: "Only at",
};

const FIRE_OPTIONS = FireDiscipline.options.map((f) => ({
  value: f,
  label: FIRE_DISCIPLINE_LABEL[f],
}));

/** Coerce a Mantine NumberInput value (number | string) to a finite number,
 *  falling back to `fallback` so a cleared input does not NaN the doctrine. */
function toNumber(val: number | string | undefined, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

/** The action editor: posture preset buttons that fill the action, then the
 *  individual axis editors. Every field is optional; the player authors only the
 *  axes they care about. */
export function ActionEditor({
  action,
  onChange,
}: {
  action: DoctrineAction;
  onChange: (next: DoctrineAction) => void;
}) {
  function applyPreset(key: PostureKey) {
    const preset = POSTURE_PRESET_LIST.find((p) => p.key === key);
    if (preset !== undefined) onChange(structuredClone(preset.action));
  }
  function patch(p: Partial<DoctrineAction>) {
    onChange({ ...action, ...p });
  }

  const stance = action.stance ?? "balanced";
  const crew = action.crew ?? "combat";
  const fire = action.fire ?? "atWill";
  const targeting = action.targeting;
  const cohesion = action.cohesion ?? 0;
  const retreat = action.retreat ?? 0;
  const spatial = action.spatial;

  return (
    <Stack gap="xs">
      <div className={sectionLabel}>Posture preset</div>
      <div className={presetRow}>
        {POSTURE_PRESET_LIST.map((p) => (
          <Tooltip key={p.key} label={p.intent} withArrow position="bottom" openDelay={200}>
            <AnnunciatorButton tint="amber" onClick={() => applyPreset(p.key)}>
              {p.label}
            </AnnunciatorButton>
          </Tooltip>
        ))}
      </div>

      <Group grow>
        <Select
          label="Stance"
          size="xs"
          data={STANCE_OPTIONS}
          value={stance}
          onChange={(v) => {
            if (v === null) return;
            const parsed = ShipStance.safeParse(v);
            if (parsed.success) patch({ stance: parsed.data });
          }}
        />
        <Select
          label="Fire discipline"
          size="xs"
          data={FIRE_OPTIONS}
          value={fire}
          onChange={(v) => {
            if (v === null) return;
            const parsed = FireDiscipline.safeParse(v);
            if (parsed.success) patch({ fire: parsed.data });
          }}
        />
      </Group>

      <Group grow>
        <Select
          label="Crew priority"
          size="xs"
          data={CREW_OPTIONS}
          value={crew}
          onChange={(v) => {
            if (v === null) return;
            const parsed = CrewPriority.safeParse(v);
            if (parsed.success) patch({ crew: parsed.data });
          }}
        />
        <Select
          label="Target priority"
          size="xs"
          data={[
            { value: "nearest", label: "Nearest" },
            { value: "weakest", label: "Weakest" },
            { value: "strongest", label: "Strongest" },
            { value: "highestCost", label: "Highest cost" },
            { value: "none", label: "None" },
          ]}
          value={targeting?.mode.kind ?? "nearest"}
          onChange={(v) => {
            if (v === null) return;
            // The scalar targeting modes have no reference parameter; the
            // relational modes (threatsTo/membersOf/...) are reachable via the
            // rule action's objective editor for formations that need them.
            if (
              v === "nearest" ||
              v === "weakest" ||
              v === "strongest" ||
              v === "highestCost" ||
              v === "none"
            ) {
              patch({
                targeting: {
                  mode: { kind: v },
                  vulnerableWeight: targeting?.vulnerableWeight ?? 0,
                  focusFire: targeting?.focusFire ?? false,
                },
              });
            }
          }}
        />
      </Group>

      <Checkbox
        size="xs"
        label="Focus fire (concentrate side fire on fewer targets)"
        checked={targeting?.focusFire ?? false}
        onChange={(e) =>
          patch({
            targeting: {
              mode: targeting?.mode ?? { kind: "nearest" },
              vulnerableWeight: targeting?.vulnerableWeight ?? 0,
              focusFire: e.currentTarget.checked,
            },
          })
        }
      />

      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Vulnerable target weight
          </Text>
          <Text size="xs" c="dimmed">
            {Math.round((targeting?.vulnerableWeight ?? 0) * 100)}%
          </Text>
        </Group>
        <Slider
          size="md"
          min={0}
          max={1}
          step={0.05}
          value={targeting?.vulnerableWeight ?? 0}
          onChange={(v) =>
            patch({
              targeting: {
                mode: targeting?.mode ?? { kind: "nearest" },
                vulnerableWeight: v,
                focusFire: targeting?.focusFire ?? false,
              },
            })
          }
        />
      </Stack>

      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Cohesion (formation keeping)
          </Text>
          <Text size="xs" c="dimmed">
            {Math.round(cohesion * 100)}%
          </Text>
        </Group>
        <Slider
          size="md"
          min={0}
          max={1}
          step={0.05}
          value={cohesion}
          onChange={(v) => patch({ cohesion: v })}
        />
      </Stack>

      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Retreat below effectiveness
          </Text>
          <Text size="xs" c="dimmed">
            {Math.round(retreat * 100)}%
          </Text>
        </Group>
        <Slider
          size="md"
          min={0}
          max={1}
          step={0.05}
          value={retreat}
          onChange={(v) => patch({ retreat: v })}
        />
      </Stack>

      <SpatialObjectiveEditor spatial={spatial} onChange={(next) => patch({ spatial: next })} />
    </Stack>
  );
}

/** Editor for the optional spatial objective axis. A toggle authors (or clears)
 *  the objective; when authored, its reference, range, and bearing controls are
 *  exposed. */
function SpatialObjectiveEditor({
  spatial,
  onChange,
}: {
  spatial: DoctrineAction["spatial"];
  onChange: (next: NonNullable<DoctrineAction["spatial"]> | undefined) => void;
}) {
  const enabled = spatial !== undefined;
  return (
    <Stack gap="xs">
      <Checkbox
        size="xs"
        label="Author spatial objective (where to be)"
        checked={enabled}
        onChange={(e) =>
          e.currentTarget.checked
            ? onChange({
                reference: { kind: "target" },
                range: { kind: "engage", fraction: 0.6, tolerance: 0.15 },
                bearing: { kind: "free" },
              })
            : onChange(undefined)
        }
      />
      {enabled && spatial !== undefined && (
        <>
          <FormationReferencePicker
            label="Reference point"
            reference={spatial.reference}
            onChange={(reference) => onChange({ ...spatial, reference })}
          />
          <RangeRuleEditor
            range={spatial.range}
            onChange={(range) => onChange({ ...spatial, range })}
          />
          <BearingRuleEditor
            bearing={spatial.bearing}
            onChange={(bearing) => onChange({ ...spatial, bearing })}
          />
        </>
      )}
    </Stack>
  );
}

/** Editor for the range half of a spatial objective. */
function RangeRuleEditor({
  range,
  onChange,
}: {
  range: NonNullable<DoctrineAction["spatial"]>["range"];
  onChange: (next: NonNullable<DoctrineAction["spatial"]>["range"]) => void;
}) {
  return (
    <Stack gap="xs">
      <Select
        label="Range rule"
        size="xs"
        data={[
          { value: "engage", label: "Engage (fraction of weapon range)" },
          { value: "hold", label: "Hold station" },
          { value: "close", label: "Close (pursue)" },
          { value: "evade", label: "Evade (open range)" },
          { value: "kite", label: "Kite (hold at max range)" },
          { value: "maintain", label: "Maintain exact range" },
        ]}
        value={range.kind}
        onChange={(v) => {
          if (v === null) return;
          switch (v) {
            case "engage":
              onChange({ kind: "engage", fraction: 0.6, tolerance: 0.15 });
              break;
            case "hold":
              onChange({ kind: "hold", band: 0.2 });
              break;
            case "close":
              onChange({ kind: "close" });
              break;
            case "evade":
              onChange({ kind: "evade", minRange: 8000 });
              break;
            case "kite":
              onChange({ kind: "kite", maxRange: 30000 });
              break;
            case "maintain":
              onChange({ kind: "maintain", range: 10000, tolerance: 1000 });
              break;
          }
        }}
      />
      {range.kind === "engage" && (
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Fraction of max weapon range
            </Text>
            <Text size="xs" c="dimmed">
              {Math.round(range.fraction * 100)}%
            </Text>
          </Group>
          <Slider
            size="md"
            min={0.1}
            max={1}
            step={0.05}
            value={range.fraction}
            onChange={(fraction) => onChange({ ...range, fraction })}
          />
        </Stack>
      )}
      {range.kind === "hold" && (
        <NumberInput
          label="Station band (fraction)"
          size="xs"
          min={0.05}
          max={1}
          step={0.05}
          value={range.band}
          onChange={(v) => onChange({ ...range, band: Math.max(0, Math.min(1, toNumber(v, 0.2))) })}
        />
      )}
      {range.kind === "evade" && (
        <NumberInput
          label="Minimum range (m)"
          size="xs"
          min={0}
          value={range.minRange}
          onChange={(v) => onChange({ ...range, minRange: Math.max(0, toNumber(v)) })}
        />
      )}
      {range.kind === "kite" && (
        <NumberInput
          label="Maximum range (m)"
          size="xs"
          min={0}
          value={range.maxRange}
          onChange={(v) => onChange({ ...range, maxRange: Math.max(0, toNumber(v)) })}
        />
      )}
      {range.kind === "maintain" && (
        <div className={pairGrid}>
          <NumberInput
            label="Range (m)"
            size="xs"
            min={0}
            value={range.range}
            onChange={(v) => onChange({ ...range, range: Math.max(0, toNumber(v)) })}
          />
          <NumberInput
            label="Tolerance (m)"
            size="xs"
            min={0}
            value={range.tolerance}
            onChange={(v) => onChange({ ...range, tolerance: Math.max(0, toNumber(v)) })}
          />
        </div>
      )}
    </Stack>
  );
}

/** Editor for the bearing half of a spatial objective. */
function BearingRuleEditor({
  bearing,
  onChange,
}: {
  bearing: NonNullable<DoctrineAction["spatial"]>["bearing"];
  onChange: (next: NonNullable<DoctrineAction["spatial"]>["bearing"]) => void;
}) {
  return (
    <Stack gap="xs">
      <Select
        label="Bearing rule"
        size="xs"
        data={[
          { value: "free", label: "Free (no constraint)" },
          { value: "offset", label: "Fixed offset angle" },
          { value: "toward", label: "Toward a reference" },
          { value: "away", label: "Away from a reference" },
          { value: "orbit", label: "Orbit the reference" },
        ]}
        value={bearing.kind}
        onChange={(v) => {
          if (v === null) return;
          switch (v) {
            case "free":
              onChange({ kind: "free" });
              break;
            case "offset":
              onChange({ kind: "offset", frame: "fleet", angle: 0 });
              break;
            case "toward":
              onChange({ kind: "toward", reference: { kind: "target" } });
              break;
            case "away":
              onChange({ kind: "away", reference: { kind: "target" } });
              break;
            case "orbit":
              onChange({ kind: "orbit", omega: 0.02, phase: 0 });
              break;
          }
        }}
      />
      {bearing.kind === "offset" && (
        <Group grow>
          <Select
            label="Frame"
            size="xs"
            data={[
              { value: "self", label: "Self" },
              { value: "fleet", label: "Fleet" },
              { value: "world", label: "World" },
            ]}
            value={bearing.frame}
            onChange={(v) => {
              if (v === "self" || v === "fleet" || v === "world") {
                onChange({ ...bearing, frame: v });
              }
            }}
          />
          <NumberInput
            label="Angle (rad)"
            size="xs"
            step={0.1}
            value={bearing.angle}
            onChange={(v) => onChange({ ...bearing, angle: toNumber(v) })}
          />
        </Group>
      )}
      {(bearing.kind === "toward" || bearing.kind === "away") && (
        <FormationReferencePicker
          label={bearing.kind === "toward" ? "Toward" : "Away from"}
          reference={bearing.reference}
          onChange={(reference) => onChange({ ...bearing, reference })}
        />
      )}
      {bearing.kind === "orbit" && (
        <div className={pairGrid}>
          <NumberInput
            label="Omega (rad/tick)"
            size="xs"
            step={0.005}
            value={bearing.omega}
            onChange={(v) => onChange({ ...bearing, omega: toNumber(v, 0.02) })}
          />
          <NumberInput
            label="Phase (rad)"
            size="xs"
            step={0.1}
            value={bearing.phase}
            onChange={(v) => onChange({ ...bearing, phase: toNumber(v) })}
          />
        </div>
      )}
    </Stack>
  );
}

/** One rule: a collapsible card with a header summary (condition → action) and
 *  an inline editor for both halves, plus move-up/move-down/remove controls. */
function RuleCard({
  rule,
  index,
  count,
  onMove,
  onRemove,
  onChange,
}: {
  rule: DoctrineRule;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onChange: (next: DoctrineRule) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={ruleCard}>
      <div className={ruleHeader}>
        <span className={ruleSummary}>
          <Text size="xs" fw={600} component="span" c="dimmed">
            #{index + 1}
          </Text>{" "}
          when {conditionDescription(rule.condition)} → {actionDescription(rule.then)}
        </span>
        <div className={ruleControls}>
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label="Move rule up"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <IconChevronUp size={12} />
          </ActionIcon>
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label="Move rule down"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <IconChevronDown size={12} />
          </ActionIcon>
          <ActionIcon
            size="xs"
            variant="subtle"
            color="red"
            aria-label="Remove rule"
            onClick={onRemove}
          >
            <IconTrash size={12} />
          </ActionIcon>
        </div>
      </div>
      <AnnunciatorButton
        tint="amber"
        active={open}
        onClick={() => setOpen((p) => !p)}
        aria-label={open ? "Collapse rule" : "Expand rule"}
      >
        {open ? "Collapse" : "Edit"}
      </AnnunciatorButton>
      <Collapse expanded={open}>
        <div className={ruleBody}>
          <div className={sectionLabel}>When (condition)</div>
          <Select
            size="xs"
            data={CONDITION_SELECT_DATA}
            value={rule.condition.kind}
            onChange={(v) => {
              if (v !== null && isConditionKind(v)) {
                onChange({ ...rule, condition: defaultCondition(v) });
              }
            }}
          />
          <ConditionEditor
            condition={rule.condition}
            onChange={(condition) => onChange({ ...rule, condition })}
          />
          <div className={sectionLabel} style={{ marginTop: "0.3rem" }}>
            Then (action)
          </div>
          <ActionEditor action={rule.then} onChange={(then) => onChange({ ...rule, then })} />
        </div>
      </Collapse>
    </div>
  );
}

/** The doctrine editor: a base-action editor (posture preset + axes) and an
 *  ordered, editable rule list (first match wins). */
export function DoctrineEditor({
  doctrine,
  onDoctrineChange,
  title = "Doctrine",
}: {
  doctrine: Doctrine;
  onDoctrineChange: (next: Doctrine) => void;
  title?: string;
}) {
  function patchBase(next: DoctrineAction) {
    onDoctrineChange({ ...doctrine, base: next });
  }
  function moveRule(from: number, to: number) {
    const rules = doctrine.rules.slice();
    const rule = rules[from];
    if (rule === undefined) return;
    rules.splice(from, 1);
    const clamped = Math.max(0, Math.min(to, rules.length));
    rules.splice(clamped, 0, rule);
    onDoctrineChange({ ...doctrine, rules });
  }
  function removeRule(index: number) {
    onDoctrineChange({ ...doctrine, rules: doctrine.rules.filter((_, i) => i !== index) });
  }
  function setRule(index: number, next: DoctrineRule) {
    const rules = doctrine.rules.slice();
    rules[index] = next;
    onDoctrineChange({ ...doctrine, rules });
  }
  function addRule() {
    onDoctrineChange({
      ...doctrine,
      rules: [
        ...doctrine.rules,
        {
          condition: { kind: "shieldBelow", fraction: 0.25 },
          then: { stance: "evasive" },
        },
      ],
    });
  }

  return (
    <div className={doctrineEditor}>
      <div className={sectionLabel}>{title} — base posture</div>
      <ActionEditor action={doctrine.base} onChange={patchBase} />
      {doctrine.base.spatial !== undefined && (
        <Text size="xs" className={hint}>
          Base objective: {spatialDescription(doctrine.base.spatial)}
        </Text>
      )}

      <div className={sectionLabel} style={{ marginTop: "0.4rem" }}>
        Rules ({doctrine.rules.length}) — first match wins
      </div>
      <Stack gap={6}>
        {doctrine.rules.map((rule, index) => (
          <RuleCard
            key={index}
            rule={rule}
            index={index}
            count={doctrine.rules.length}
            onMove={moveRule}
            onRemove={() => removeRule(index)}
            onChange={(next) => setRule(index, next)}
          />
        ))}
      </Stack>
      <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addRule}>
        Add rule
      </Button>
    </div>
  );
}
