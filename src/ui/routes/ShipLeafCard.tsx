/**
 * A ship-leaf card in the formation tree: faction-tinted thumbnail, name/class/
 * cost, compact doctrine quick-rows (stance + target priority), a one-line
 * doctrine summary, and an expandable full {@link DoctrineEditor}. Operates on a
 * {@link Doctrine} via callbacks (path-agnostic) so the tree view can bind it to
 * any leaf by its path.
 *
 * The quick-rows edit only the base-action stance and targeting-mode axes — the
 * two highest-frequency per-ship taps. The full editor (posture presets, spatial
 * objective, fire discipline, cohesion, retreat, rules) lives behind the expand
 * so a flat roster stays compact.
 */

import { ActionIcon, Collapse } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { Doctrine, ShipStance } from "@/schema/ai";
import type { ShipDesign } from "@/schema/ship";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import { DoctrineEditor } from "@/ui/components/DoctrineEditor";
import { doctrineSummary } from "@/ui/components/doctrine-describe";
import { ShipThumbnail } from "@/ui/components/ShipThumbnail";
import { hardwareKeySmall } from "@/ui/theme/controls.css";
import {
  leafCard,
  leafClass,
  leafCost,
  leafHeader,
  leafMeta,
  leafName,
  leafSummary,
  nodeControls,
  quickLabel,
  quickRow,
} from "./FormationTree.css";

/** Compact quick-select stances (the common four; the full set is in the editor). */
const QUICK_STANCES: ShipStance[] = ["aggressive", "balanced", "defensive", "evasive"];
const STANCE_LABEL: Record<ShipStance, string> = {
  aggressive: "Agrsv",
  balanced: "Bal",
  defensive: "Defns",
  evasive: "Evs",
  interceptor: "Intcp",
  escort: "Esc",
  sniper: "Snpr",
  hold: "Hold",
  retreat: "Rtrt",
};

/** Scalar target-priority kinds (the relational modes are in the full editor). */
type QuickPriority = "nearest" | "weakest" | "strongest" | "highestCost";
const QUICK_PRIORITIES: QuickPriority[] = ["nearest", "weakest", "strongest", "highestCost"];
const PRIORITY_LABEL: Record<QuickPriority, string> = {
  nearest: "Near",
  weakest: "Weak",
  strongest: "Strong",
  highestCost: "Cost",
};

/** Narrows a targeting-mode kind to a scalar quick-priority. */
function isQuickPriority(kind: string): kind is QuickPriority {
  return kind === "nearest" || kind === "weakest" || kind === "strongest" || kind === "highestCost";
}

interface ShipLeafCardProps {
  design: ShipDesign;
  doctrine: Doctrine;
  classification: string;
  accent: string;
  cost: number;
  overBudget: boolean;
  /** Showing move-up is disabled when this leaf is the first child. */
  isFirst: boolean;
  /** Showing move-down is disabled when this leaf is the last child. */
  isLast: boolean;
  onUpdateDoctrine: (next: Doctrine) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function ShipLeafCard({
  design,
  doctrine,
  classification,
  accent,
  cost,
  overBudget,
  isFirst,
  isLast,
  onUpdateDoctrine,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ShipLeafCardProps) {
  const [open, setOpen] = useState(false);

  // Display values default to the historical defaults when an axis is absent, so
  // a freshly seeded ({ base: {}, rules: [] }) doctrine shows a concrete
  // selection rather than a blank control.
  const stance = doctrine.base.stance ?? "balanced";
  const priorityKind = doctrine.base.targeting?.mode.kind;
  const priority: QuickPriority =
    priorityKind !== undefined && isQuickPriority(priorityKind) ? priorityKind : "nearest";
  const vulnerableWeight = doctrine.base.targeting?.vulnerableWeight ?? 0;
  const focusFire = doctrine.base.targeting?.focusFire ?? false;

  function setStance(next: ShipStance) {
    onUpdateDoctrine({ ...doctrine, base: { ...doctrine.base, stance: next } });
  }
  function setPriority(next: QuickPriority) {
    onUpdateDoctrine({
      ...doctrine,
      base: {
        ...doctrine.base,
        targeting: { mode: { kind: next }, vulnerableWeight, focusFire },
      },
    });
  }

  return (
    <div className={leafCard} style={{ borderLeftColor: accent }}>
      <div className={leafHeader}>
        <ShipThumbnail design={design} size={40} accent={accent} />
        <div className={leafMeta}>
          <span className={leafName}>{design.name}</span>
          <span className={leafSummary}>{doctrineSummary(doctrine)}</span>
        </div>
        <span className={leafClass}>{classification}</span>
        <span className={leafCost} data-over={overBudget ? "true" : undefined}>
          {cost} pts
        </span>
        <div className={nodeControls}>
          <ActionIcon
            size="xs"
            variant="subtle"
            className={hardwareKeySmall}
            aria-label="Move ship up"
            disabled={isFirst}
            onClick={onMoveUp}
          >
            <IconChevronUp size={12} />
          </ActionIcon>
          <ActionIcon
            size="xs"
            variant="subtle"
            className={hardwareKeySmall}
            aria-label="Move ship down"
            disabled={isLast}
            onClick={onMoveDown}
          >
            <IconChevronDown size={12} />
          </ActionIcon>
          <ActionIcon
            size="xs"
            variant="subtle"
            color="red"
            aria-label="Remove ship"
            onClick={onRemove}
          >
            <IconTrash size={12} />
          </ActionIcon>
        </div>
      </div>

      <div className={quickRow}>
        <span className={quickLabel}>Stance</span>
        {QUICK_STANCES.map((s) => (
          <AnnunciatorButton
            key={s}
            tint="amber"
            active={stance === s}
            onClick={() => setStance(s)}
            aria-label={`Stance: ${s}`}
          >
            {STANCE_LABEL[s]}
          </AnnunciatorButton>
        ))}
      </div>
      <div className={quickRow}>
        <span className={quickLabel}>Target</span>
        {QUICK_PRIORITIES.map((p) => (
          <AnnunciatorButton
            key={p}
            tint="cyan"
            active={priority === p}
            onClick={() => setPriority(p)}
            aria-label={`Target priority: ${p}`}
          >
            {PRIORITY_LABEL[p]}
          </AnnunciatorButton>
        ))}
      </div>

      <AnnunciatorButton
        tint="amber"
        active={open}
        onClick={() => setOpen((p) => !p)}
        aria-label={open ? "Hide full doctrine editor" : "Show full doctrine editor"}
      >
        {open ? "Hide doctrine" : "Full doctrine"}
      </AnnunciatorButton>
      <Collapse expanded={open}>
        <DoctrineEditor doctrine={doctrine} onDoctrineChange={onUpdateDoctrine} title="Ship doctrine" />
      </Collapse>
    </div>
  );
}
