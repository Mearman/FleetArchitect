import {
  ActionIcon,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Slider,
  Stack,
  Text,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useMemo } from "react";
import { deriveClassification } from "@/domain/grid";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import { hardwareKeySmall } from "@/ui/theme/controls.css";
import type { Doctrine, RangeRule, ShipStance } from "@/schema/ai";
import type { ShipDesign } from "@/schema/ship";
import { ShipThumbnail } from "@/ui/components/ShipThumbnail";
import { FACTION_PALETTE } from "./battleConstants";
import {
  advancedBody,
  doctrineLabel,
  doctrineRow,
  fleetRowCard,
  fleetRowClass,
  fleetRowCost,
  fleetRowHeader,
  fleetRowMeta,
  fleetRowName,
} from "./FleetBuilderRoute.css";

interface FleetRowCardProps {
  rowId: string;
  design: ShipDesign;
  doctrine: Doctrine;
  position: { x: number; y: number };
  facing: number;
  cost: number;
  overBudget: boolean;
  advancedOpen: boolean;
  onUpdateDoctrine: (rowId: string, next: Doctrine) => void;
  onUpdatePosition: (rowId: string, x: number, y: number) => void;
  onUpdateFacing: (rowId: string, facing: number) => void;
  onToggleAdvanced: (rowId: string) => void;
  onRemove: (rowId: string) => void;
}

/**
 * The four quick-select stances offered on the row card (the legacy
 * {@link EngagementStance} set, all valid {@link ShipStance} values). The full
 * ShipStance vocabulary is editable in the designer's behaviour panel.
 */
const ROW_STANCES: ShipStance[] = ["aggressive", "balanced", "defensive", "evasive"];

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

/** Type predicate: narrows a targeting-mode kind to a row-card scalar priority. */
function isRowPriority(kind: string): kind is RowPriority {
  return kind === "nearest" || kind === "weakest" || kind === "strongest" || kind === "highestCost";
}

/** Target-priority scalar kinds, mirroring the legacy TargetPriority set. */
type RowPriority = "nearest" | "weakest" | "strongest" | "highestCost";
const ROW_PRIORITIES: RowPriority[] = ["nearest", "weakest", "strongest", "highestCost"];

const PRIORITY_LABEL: Record<RowPriority, string> = {
  nearest: "Near",
  weakest: "Weak",
  strongest: "Strong",
  highestCost: "Cost",
};

/** Engage-range selections, mirroring the legacy EngageRange set. */
type RowRange = "short" | "medium" | "long" | "hold";
const ROW_RANGES: RowRange[] = ["short", "medium", "long", "hold"];

const RANGE_LABEL: Record<RowRange, string> = {
  short: "Short",
  medium: "Med",
  long: "Long",
  hold: "Hold",
};

/** Legacy engage-range → fraction of max weapon range. Mirrors the fleet
 *  normaliser's `engageFraction` and engine config (short 0.3 / medium 0.55 /
 *  long 0.85). `hold` is handled separately (it is not a fraction). */
const ENGAGE_FRACTION: Record<Exclude<RowRange, "hold">, number> = {
  short: 0.3,
  medium: 0.55,
  long: 0.85,
};

/** The per-ship doctrine's range rule, read back as a row-card range selection. */
function readRange(doctrine: Doctrine): RowRange {
  const range = doctrine.base.spatial?.range;
  if (range === undefined) return "medium";
  if (range.kind === "hold") return "hold";
  if (range.kind === "engage") {
    const match = ROW_RANGES.filter(
      (r): r is Exclude<RowRange, "hold"> => r !== "hold",
    ).find((r) => ENGAGE_FRACTION[r] === range.fraction);
    return match ?? "medium";
  }
  return "medium";
}

/** The range-keeping band — engage tolerance or hold band. Defaults to 0.3. */
function readRangeBand(doctrine: Doctrine): number {
  const range = doctrine.base.spatial?.range;
  if (range === undefined) return 0.3;
  if (range.kind === "hold") return range.band;
  if (range.kind === "engage") return range.tolerance;
  return 0.3;
}

function toNumber(val: number | string | undefined, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

/**
 * One fleet-ship row in the roster: faction-tinted thumbnail, ship name,
 * class badge, point cost, delete, and doctrine controls (stance, target
 * priority, engage range as annunciator-button groups). Advanced deployment
 * settings (position, facing, retreat threshold, focus fire, weights, range
 * band) live in a Collapse driven by {@link advancedOpen}.
 */
export function FleetRowCard({
  rowId,
  design,
  doctrine,
  position,
  facing,
  cost,
  overBudget,
  advancedOpen,
  onUpdateDoctrine,
  onUpdatePosition,
  onUpdateFacing,
  onToggleAdvanced,
  onRemove,
}: FleetRowCardProps) {
  const classification = useMemo(() => deriveClassification(design.grid), [design]);
  const palette = FACTION_PALETTE[design.faction];
  const accent = palette === undefined ? "#9aa0a6" : palette.accent;

  // Display values default to the legacy defaults when an axis is absent, so a
  // freshly seeded ({ base: {}, rules: [] }) doctrine shows a concrete
  // selection rather than a blank control.
  const stance = doctrine.base.stance ?? "balanced";
  const priority: RowPriority = (() => {
    const mode = doctrine.base.targeting?.mode;
    if (mode === undefined) return "nearest";
    return isRowPriority(mode.kind) ? mode.kind : "nearest";
  })();
  const range = readRange(doctrine);
  const retreat = doctrine.base.retreat ?? 0;
  const focusFire = doctrine.base.targeting?.focusFire ?? false;
  const vulnerableWeight = doctrine.base.targeting?.vulnerableWeight ?? 0;
  const cohesion = doctrine.base.cohesion ?? 0;
  const rangeBand = readRangeBand(doctrine);

  function setStance(next: ShipStance) {
    onUpdateDoctrine(rowId, {
      ...doctrine,
      base: { ...doctrine.base, stance: next },
    });
  }

  function setPriority(next: RowPriority) {
    onUpdateDoctrine(rowId, {
      ...doctrine,
      base: {
        ...doctrine.base,
        targeting: {
          mode: { kind: next },
          vulnerableWeight,
          focusFire,
        },
      },
    });
  }

  function setRange(next: RowRange) {
    const rangeRule: RangeRule =
      next === "hold"
        ? { kind: "hold", band: rangeBand }
        : { kind: "engage", fraction: ENGAGE_FRACTION[next], tolerance: rangeBand };
    onUpdateDoctrine(rowId, {
      ...doctrine,
      base: {
        ...doctrine.base,
        spatial: { reference: { kind: "target" }, range: rangeRule, bearing: { kind: "free" } },
      },
    });
  }

  function setRetreat(val: number) {
    onUpdateDoctrine(rowId, {
      ...doctrine,
      base: { ...doctrine.base, retreat: val },
    });
  }

  function setFocusFire(checked: boolean) {
    onUpdateDoctrine(rowId, {
      ...doctrine,
      base: {
        ...doctrine.base,
        targeting: { mode: { kind: priority }, vulnerableWeight, focusFire: checked },
      },
    });
  }

  function setVulnerableWeight(val: number) {
    onUpdateDoctrine(rowId, {
      ...doctrine,
      base: {
        ...doctrine.base,
        targeting: { mode: { kind: priority }, vulnerableWeight: val, focusFire },
      },
    });
  }

  function setCohesion(val: number) {
    onUpdateDoctrine(rowId, {
      ...doctrine,
      base: { ...doctrine.base, cohesion: val },
    });
  }

  function setRangeBand(val: number) {
    const current = readRange(doctrine);
    const rangeRule: RangeRule =
      current === "hold"
        ? { kind: "hold", band: val }
        : {
            kind: "engage",
            fraction: ENGAGE_FRACTION[current],
            tolerance: val,
          };
    onUpdateDoctrine(rowId, {
      ...doctrine,
      base: {
        ...doctrine.base,
        spatial: { reference: { kind: "target" }, range: rangeRule, bearing: { kind: "free" } },
      },
    });
  }

  return (
    <div className={fleetRowCard} style={{ borderColor: accent }}>
      {/* Header: thumbnail + name/class + cost + delete */}
      <div className={fleetRowHeader}>
        <ShipThumbnail design={design} size={52} accent={accent} />

        <div className={fleetRowMeta}>
          <span className={fleetRowName}>{design.name}</span>
          <span className={fleetRowClass}>{classification}</span>
          <span className={fleetRowCost} data-over={overBudget ? "true" : undefined}>
            {cost} pts
          </span>
        </div>

        <ActionIcon
          size="sm"
          variant="subtle"
          className={hardwareKeySmall}
          aria-label="Remove ship from fleet"
          onClick={() => onRemove(rowId)}
        >
          <IconTrash size={13} />
        </ActionIcon>
      </div>

      {/* Doctrine controls */}
      <div>
        <div className={doctrineLabel}>Stance</div>
        <div className={doctrineRow}>
          {ROW_STANCES.map((s) => (
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
      </div>

      <div>
        <div className={doctrineLabel}>Target priority</div>
        <div className={doctrineRow}>
          {ROW_PRIORITIES.map((p) => (
            <AnnunciatorButton
              key={p}
              tint="cyan"
              active={priority === p}
              onClick={() => setPriority(p)}
              aria-label={`Target: ${p}`}
            >
              {PRIORITY_LABEL[p]}
            </AnnunciatorButton>
          ))}
        </div>
      </div>

      <div>
        <div className={doctrineLabel}>Engage range</div>
        <div className={doctrineRow}>
          {ROW_RANGES.map((r) => (
            <AnnunciatorButton
              key={r}
              tint="green"
              active={range === r}
              onClick={() => setRange(r)}
              aria-label={`Range: ${r}`}
            >
              {RANGE_LABEL[r]}
            </AnnunciatorButton>
          ))}
        </div>
      </div>

      {/* Advanced toggle */}
      <AnnunciatorButton
        tint="amber"
        active={advancedOpen}
        onClick={() => onToggleAdvanced(rowId)}
        aria-label={advancedOpen ? "Hide advanced settings" : "Show advanced settings"}
      >
        {advancedOpen ? "Hide advanced" : "Advanced"}
      </AnnunciatorButton>

      <Collapse expanded={advancedOpen}>
        <div className={advancedBody}>
          <Stack gap="xs">
            <Group grow>
              <NumberInput
                size="xs"
                label="X"
                value={position.x}
                onChange={(val) =>
                  onUpdatePosition(rowId, toNumber(val), position.y)
                }
              />
              <NumberInput
                size="xs"
                label="Y"
                value={position.y}
                onChange={(val) =>
                  onUpdatePosition(rowId, position.x, toNumber(val))
                }
              />
              <NumberInput
                size="xs"
                label="Facing"
                value={facing}
                step={0.1}
                onChange={(val) => onUpdateFacing(rowId, toNumber(val))}
              />
            </Group>

            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Retreat below
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
                onChange={setRetreat}
              />
            </Stack>

            <Checkbox
              size="xs"
              label="Focus fire (concentrate fleet on one target)"
              checked={focusFire}
              onChange={(e) => setFocusFire(e.currentTarget.checked)}
            />

            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Vulnerable target weight
                </Text>
                <Text size="xs" c="dimmed">
                  {Math.round(vulnerableWeight * 100)}%
                </Text>
              </Group>
              <Slider
                size="md"
                min={0}
                max={1}
                step={0.05}
                value={vulnerableWeight}
                onChange={setVulnerableWeight}
              />
            </Stack>

            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Formation keeping
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
                onChange={setCohesion}
              />
            </Stack>

            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Range-keeping band
                </Text>
                <Text size="xs" c="dimmed">
                  ±{Math.round(rangeBand * 50)}%
                </Text>
              </Group>
              <Slider
                size="md"
                min={0.1}
                max={0.9}
                step={0.05}
                value={rangeBand}
                onChange={setRangeBand}
              />
            </Stack>
          </Stack>
        </div>
      </Collapse>

    </div>
  );
}
