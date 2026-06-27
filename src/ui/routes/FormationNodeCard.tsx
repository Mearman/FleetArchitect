/**
 * A formation node's header card: role, facing, layout (pattern + spacing),
 * focus toggle, add-sub-formation, save-as-template, move/remove, and a
 * collapsible {@link DoctrineEditor} for the formation's scoped doctrine. The
 * node's children are rendered by the surrounding {@link FormationTreeView}
 * (this card is the header only), so a formation reads as a labelled block with
 * an indented child rail beneath it.
 *
 * The ROOT formation is rendered by a dedicated {@link RootFormationCard} that
 * omits layout/facing/move/remove (the root is the fleet anchor — its layout
 * stays absent so the flat path resolves byte-identically).
 */

import {
  ActionIcon,
  Collapse,
  Group,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { Doctrine } from "@/schema/ai";
import type { Formation, FormationLayout, PatternKind } from "@/schema/formation";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import { DoctrineEditor } from "@/ui/components/DoctrineEditor";
import { doctrineSummary } from "@/ui/components/doctrine-describe";
import { hardwareKeySmall } from "@/ui/theme/controls.css";
import type { Path } from "@/domain/formation-tree-state";
import {
  doctrineRegion,
  formationActions,
  formationChip,
  formationHeader,
  formationRole,
  nodeControls,
  quickLabel,
} from "./FormationTree.css";

/** The pattern shapes a formation can take, in display order, with labels. */
const PATTERN_BUTTONS: { kind: PatternKind; label: string }[] = [
  { kind: "column", label: "Col" },
  { kind: "line", label: "Line" },
  { kind: "wedge", label: "Wedge" },
  { kind: "ring", label: "Ring" },
  { kind: "screen", label: "Screen" },
  { kind: "echelon", label: "Ech" },
];

/** Coerce a Mantine NumberInput value (number | string) to a finite number. */
function toNumber(val: number | string | undefined, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

interface FormationNodeCardProps {
  formation: Formation;
  path: Path;
  isFirst: boolean;
  isLast: boolean;
  isFocused: boolean;
  /** The number of direct children (shown as a chip). */
  childCount: number;
  /** Update this formation's internals (role/facing/layout/doctrine). */
  onUpdateFormation: (fn: (f: Formation) => Formation) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onFocus: () => void;
  onAddSubFormation: () => void;
  onSaveAsTemplate: () => void;
}

/** The effective layout (absent === column, the schema default). */
function effectiveLayout(layout: FormationLayout | undefined): FormationLayout {
  return layout ?? { kind: "column" };
}

/** The pattern kind currently active (column when no pattern layout is set). */
function activePattern(layout: FormationLayout | undefined): PatternKind {
  const eff = effectiveLayout(layout);
  return eff.kind === "pattern" ? eff.pattern : "column";
}

/** The spacing of a pattern layout (0 under column). */
function activeSpacing(layout: FormationLayout | undefined): number {
  const eff = effectiveLayout(layout);
  return eff.kind === "pattern" ? eff.spacing : 0;
}

/**
 * The formation header card. Shared by nested formation nodes; the root uses
 * {@link RootFormationCard} (a slimmed variant). The doctrine editor is collapsed
 * by default; a summary line shows the current scoped doctrine at a glance.
 */
export function FormationNodeCard({
  formation,
  isFirst,
  isLast,
  isFocused,
  childCount,
  onUpdateFormation,
  onRemove,
  onMoveUp,
  onMoveDown,
  onFocus,
  onAddSubFormation,
  onSaveAsTemplate,
}: FormationNodeCardProps) {
  const [open, setOpen] = useState(false);
  const [doctrineOpen, setDoctrineOpen] = useState(false);
  const layout = formation.layout;
  const pattern = activePattern(layout);
  const spacing = activeSpacing(layout);

  function setRole(role: string) {
    onUpdateFormation((f) => ({ ...f, role: role.trim() === "" ? undefined : role }));
  }
  function setFacing(facing: number) {
    onUpdateFormation((f) => ({ ...f, facing }));
  }
  function setPattern(kind: PatternKind) {
    // Picking a shape sets the layout to a pattern (or back to column). Spacing
    // is preserved when switching patterns; a fresh pattern defaults to 120 m.
    const nextSpacing = spacing > 0 ? spacing : 120;
    const nextLayout: FormationLayout =
      kind === "column" ? { kind: "column" } : { kind: "pattern", pattern: kind, spacing: nextSpacing, facingAligned: true };
    onUpdateFormation((f) => ({ ...f, layout: nextLayout }));
  }
  function setSpacing(value: number) {
    if (layout === undefined || layout.kind !== "pattern") return;
    onUpdateFormation((f) =>
      f.layout !== undefined && f.layout.kind === "pattern"
        ? { ...f, layout: { ...f.layout, spacing: Math.max(0, value) } }
        : f,
    );
  }
  function setDoctrine(next: Doctrine) {
    onUpdateFormation((f) => ({ ...f, doctrine: next }));
  }

  const roleLabel = formation.role ?? "unnamed";

  return (
    <div>
      <div className={formationHeader}>
        <span className={formationRole}>{roleLabel}</span>
        <span className={formationChip}>{childCount} child{childCount === 1 ? "" : "ren"}</span>
        {pattern !== "column" && (
          <span className={formationChip}>
            {pattern} {Math.round(spacing)}m
          </span>
        )}
        {formation.facing !== undefined && (
          <span className={formationChip}>↻ {Math.round((formation.facing * 180) / Math.PI)}°</span>
        )}
        <span className={nodeControls}>
          <ActionIcon
            size="xs"
            variant="subtle"
            className={hardwareKeySmall}
            aria-label="Move formation up"
            disabled={isFirst}
            onClick={onMoveUp}
          >
            <IconChevronUp size={12} />
          </ActionIcon>
          <ActionIcon
            size="xs"
            variant="subtle"
            className={hardwareKeySmall}
            aria-label="Move formation down"
            disabled={isLast}
            onClick={onMoveDown}
          >
            <IconChevronDown size={12} />
          </ActionIcon>
          <ActionIcon
            size="xs"
            variant="subtle"
            color="red"
            aria-label="Remove formation"
            onClick={onRemove}
          >
            <IconTrash size={12} />
          </ActionIcon>
        </span>
      </div>

      <div className={formationActions}>
        <Tooltip label="Make this the formation new ships are added to" withArrow position="bottom" openDelay={200}>
          <AnnunciatorButton tint="green" active={isFocused} onClick={onFocus}>
            {isFocused ? "Focused" : "Focus"}
          </AnnunciatorButton>
        </Tooltip>
        <AnnunciatorButton tint="amber" active={open} onClick={() => setOpen((p) => !p)}>
          {open ? "Hide layout" : "Layout"}
        </AnnunciatorButton>
        <AnnunciatorButton tint="amber" active={doctrineOpen} onClick={() => setDoctrineOpen((p) => !p)}>
          {doctrineOpen ? "Hide doctrine" : "Doctrine"}
        </AnnunciatorButton>
        <AnnunciatorButton tint="cyan" onClick={onAddSubFormation}>
          + Sub-formation
        </AnnunciatorButton>
        <AnnunciatorButton tint="cyan" onClick={onSaveAsTemplate}>
          Save as template
        </AnnunciatorButton>
      </div>

      <Collapse expanded={open}>
        <Stack gap="xs" style={{ paddingTop: "0.35rem" }}>
          <Group grow>
            <TextInput
              label="Role"
              size="xs"
              placeholder="e.g. vanguard, carrier, screen"
              value={formation.role ?? ""}
              onChange={(e) => setRole(e.target.value)}
            />
            <NumberInput
              label="Facing (rad)"
              size="xs"
              step={0.1}
              value={formation.facing ?? 0}
              onChange={(v) => setFacing(toNumber(v))}
            />
          </Group>
          <div>
            <span className={quickLabel}>Pattern</span>
            <div className={formationActions}>
              {PATTERN_BUTTONS.map((p) => (
                <AnnunciatorButton
                  key={p.kind}
                  tint="amber"
                  active={pattern === p.kind}
                  onClick={() => setPattern(p.kind)}
                  aria-label={`Pattern: ${p.kind}`}
                >
                  {p.label}
                </AnnunciatorButton>
              ))}
            </div>
          </div>
          {pattern !== "column" && (
            <NumberInput
              label="Spacing (m)"
              size="xs"
              min={0}
              step={10}
              value={spacing}
              onChange={(v) => setSpacing(toNumber(v, 120))}
            />
          )}
          <Text size="xs" c="dimmed">
            Drag a ship on the deployment canvas to commit an explicit slot (it then ignores the pattern).
          </Text>
        </Stack>
      </Collapse>

      <Collapse expanded={doctrineOpen}>
        <div className={doctrineRegion}>
          <Text size="xs" c="dimmed" style={{ marginBottom: "0.2rem" }}>
            {doctrineSummary(formation.doctrine)} — inherited by descendants.
          </Text>
          <DoctrineEditor
            doctrine={formation.doctrine}
            onDoctrineChange={setDoctrine}
            title="Formation doctrine"
          />
        </div>
      </Collapse>
    </div>
  );
}

/**
 * The root formation card: a slim header (role + doctrine) with NO layout,
 * facing, move, or remove controls — the root is the fleet anchor, and its
 * layout stays absent so a flat roster resolves byte-identically to the legacy
 * column. Ships and sub-formations are added to the root via the focus model.
 */
export function RootFormationCard({
  formation,
  isFocused,
  childCount,
  onUpdateFormation,
  onFocus,
}: {
  formation: Formation;
  isFocused: boolean;
  childCount: number;
  onUpdateFormation: (fn: (f: Formation) => Formation) => void;
  onFocus: () => void;
}) {
  const [doctrineOpen, setDoctrineOpen] = useState(false);
  function setRole(role: string) {
    onUpdateFormation((f) => ({ ...f, role: role.trim() === "" ? undefined : role }));
  }
  function setDoctrine(next: Doctrine) {
    onUpdateFormation((f) => ({ ...f, doctrine: next }));
  }
  return (
    <div>
      <div className={formationHeader}>
        <span className={formationRole}>{formation.role ?? "fleet root"}</span>
        <span className={formationChip}>{childCount} direct child{childCount === 1 ? "" : "ren"}</span>
      </div>
      <div className={formationActions}>
        <Tooltip label="Make the root the formation new ships are added to" withArrow position="bottom" openDelay={200}>
          <AnnunciatorButton tint="green" active={isFocused} onClick={onFocus}>
            {isFocused ? "Focused" : "Focus"}
          </AnnunciatorButton>
        </Tooltip>
        <AnnunciatorButton tint="amber" active={doctrineOpen} onClick={() => setDoctrineOpen((p) => !p)}>
          {doctrineOpen ? "Hide fleet doctrine" : "Fleet doctrine"}
        </AnnunciatorButton>
      </div>
      <Collapse expanded={doctrineOpen}>
        <div className={doctrineRegion}>
          <TextInput
            label="Fleet role"
            size="xs"
            placeholder="e.g. main body (used as a doctrine reference)"
            value={formation.role ?? ""}
            onChange={(e) => setRole(e.target.value)}
            style={{ marginBottom: "0.4rem" }}
          />
          <DoctrineEditor
            doctrine={formation.doctrine}
            onDoctrineChange={setDoctrine}
            title="Fleet doctrine"
          />
        </div>
      </Collapse>
    </div>
  );
}
