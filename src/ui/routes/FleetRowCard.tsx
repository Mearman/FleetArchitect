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
import {
  EngageRange,
  EngagementStance,
  TargetPriority,
} from "@/schema/fleet";
import type { Orders } from "@/schema/fleet";
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
  orders: Orders;
  position: { x: number; y: number };
  facing: number;
  cost: number;
  overBudget: boolean;
  advancedOpen: boolean;
  onUpdateOrders: (rowId: string, patch: Partial<Orders>) => void;
  onUpdatePosition: (rowId: string, x: number, y: number) => void;
  onUpdateFacing: (rowId: string, facing: number) => void;
  onToggleAdvanced: (rowId: string) => void;
  onRemove: (rowId: string) => void;
}

const STANCES = EngagementStance.options;
const PRIORITIES = TargetPriority.options;
const RANGES = EngageRange.options;

const STANCE_LABEL: Record<EngagementStance, string> = {
  aggressive: "Agrsv",
  balanced: "Bal",
  defensive: "Defns",
  evasive: "Evs",
};

const PRIORITY_LABEL: Record<TargetPriority, string> = {
  nearest: "Near",
  weakest: "Weak",
  strongest: "Strong",
  highestCost: "Cost",
};

const RANGE_LABEL: Record<EngageRange, string> = {
  short: "Short",
  medium: "Med",
  long: "Long",
  hold: "Hold",
};

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
  orders,
  position,
  facing,
  cost,
  overBudget,
  advancedOpen,
  onUpdateOrders,
  onUpdatePosition,
  onUpdateFacing,
  onToggleAdvanced,
  onRemove,
}: FleetRowCardProps) {
  const classification = useMemo(() => deriveClassification(design.grid), [design]);
  const palette = FACTION_PALETTE[design.faction];
  const accent = palette === undefined ? "#9aa0a6" : palette.accent;

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
          {STANCES.map((s) => (
            <AnnunciatorButton
              key={s}
              tint="amber"
              active={orders.stance === s}
              onClick={() =>
                onUpdateOrders(rowId, {
                  stance: EngagementStance.parse(s),
                })
              }
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
          {PRIORITIES.map((p) => (
            <AnnunciatorButton
              key={p}
              tint="cyan"
              active={orders.targetPriority === p}
              onClick={() =>
                onUpdateOrders(rowId, {
                  targetPriority: TargetPriority.parse(p),
                })
              }
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
          {RANGES.map((r) => (
            <AnnunciatorButton
              key={r}
              tint="green"
              active={orders.engageRange === r}
              onClick={() =>
                onUpdateOrders(rowId, {
                  engageRange: EngageRange.parse(r),
                })
              }
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
                  {Math.round(orders.retreatThreshold * 100)}%
                </Text>
              </Group>
              <Slider
                size="md"
                min={0}
                max={1}
                step={0.05}
                value={orders.retreatThreshold}
                onChange={(val) =>
                  onUpdateOrders(rowId, { retreatThreshold: val })
                }
              />
            </Stack>

            <Checkbox
              size="xs"
              label="Focus fire (concentrate fleet on one target)"
              checked={orders.focusFire}
              onChange={(e) =>
                onUpdateOrders(rowId, {
                  focusFire: e.currentTarget.checked,
                })
              }
            />

            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Vulnerable target weight
                </Text>
                <Text size="xs" c="dimmed">
                  {Math.round(orders.vulnerableTargetWeight * 100)}%
                </Text>
              </Group>
              <Slider
                size="md"
                min={0}
                max={1}
                step={0.05}
                value={orders.vulnerableTargetWeight}
                onChange={(val) =>
                  onUpdateOrders(rowId, { vulnerableTargetWeight: val })
                }
              />
            </Stack>

            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Formation keeping
                </Text>
                <Text size="xs" c="dimmed">
                  {Math.round(orders.formationKeeping * 100)}%
                </Text>
              </Group>
              <Slider
                size="md"
                min={0}
                max={1}
                step={0.05}
                value={orders.formationKeeping}
                onChange={(val) =>
                  onUpdateOrders(rowId, { formationKeeping: val })
                }
              />
            </Stack>

            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Range-keeping band
                </Text>
                <Text size="xs" c="dimmed">
                  ±{Math.round(orders.rangeKeepingBand * 50)}%
                </Text>
              </Group>
              <Slider
                size="md"
                min={0.1}
                max={0.9}
                step={0.05}
                value={orders.rangeKeepingBand}
                onChange={(val) =>
                  onUpdateOrders(rowId, { rangeKeepingBand: val })
                }
              />
            </Stack>
          </Stack>
        </div>
      </Collapse>

    </div>
  );
}
