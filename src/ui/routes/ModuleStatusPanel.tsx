import { Box, Group, Progress, Stack, Text, Tooltip } from "@mantine/core";
import { memo } from "react";
import type { BattleFrame } from "@/schema/battle";
import { formatJoules } from "@/ui/format";
import { renderCells } from "@/ui/cellLayout";
import type { DescriptorMap, RenderCell } from "@/ui/cellLayout";
import { MODULE_LABEL, SIDE_COLOUR } from "./battleConstants";

interface ShipStatusRowProps {
  sideColour: string;
  shipAlive: boolean;
  cells: RenderCell[];
}

/**
 * Equality for {@link ShipStatusRow}: two rows match when the ship's alive flag,
 * its faction colour, and every cell's hp and alive flag all agree — the only
 * fields that affect the bars. maxHp/kind/slotId come from the static descriptor
 * (stable for a ship's life), so a ship that took no module damage since the
 * last frame compares equal and its memoised row is reused, skipping the
 * Progress/Tooltip re-creation even though `cells` is a fresh array each render.
 */
function shipStatusRowEqual(prev: ShipStatusRowProps, next: ShipStatusRowProps): boolean {
  if (prev.shipAlive !== next.shipAlive || prev.sideColour !== next.sideColour) return false;
  const a = prev.cells;
  const b = next.cells;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const pa = a[i];
    const pb = b[i];
    if (pa === undefined || pb === undefined) return false;
    if (pa.hp !== pb.hp || pa.alive !== pb.alive) return false;
  }
  return true;
}

const ShipStatusRow = memo(
  function ShipStatusRow({ sideColour, shipAlive, cells }: ShipStatusRowProps) {
    return (
      <Group gap="xs" wrap="nowrap" align="center">
        <Box
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: shipAlive ? sideColour : "transparent",
            border: `1px solid ${sideColour}`,
            flex: "0 0 auto",
          }}
        />
        <Group gap={4} wrap="wrap" style={{ flex: 1 }}>
          {cells.map((m) => {
            const frac = m.maxHp > 0 ? Math.max(0, m.hp / m.maxHp) : 0;
            return (
              <Tooltip
                key={m.slotId}
                label={`${MODULE_LABEL[m.kind] ?? m.kind}: ${formatJoules(m.hp)} / ${formatJoules(m.maxHp)}`}
              >
                <Box style={{ width: 34 }}>
                  <Progress
                    size={5}
                    value={m.alive ? frac * 100 : 0}
                    color={m.alive ? "teal" : "gray"}
                  />
                </Box>
              </Tooltip>
            );
          })}
        </Group>
      </Group>
    );
  },
  shipStatusRowEqual,
);

/**
 * Per-module status readout for the current frame: each ship's cells as a row
 * of HP bars, so you can watch systems fail as the battle wears on. Cell kinds
 * and max HP come from the static descriptor; live HP/alive come from the frame.
 *
 * Each row is memoised on its module-state identity (per-cell hp/alive plus the
 * ship's alive flag): a ship that took no module damage since the last frame is
 * reconciled away, so a 30 Hz status-frame update re-creates Progress/Tooltip
 * only for the ships actually taking damage.
 *
 * Renders without a Paper wrapper so it sits flush inside the controls dock or
 * any other container that already provides its own chrome.
 */
export function ModuleStatusPanel({
  frame,
  descriptors,
}: {
  frame: BattleFrame;
  descriptors: DescriptorMap;
}) {
  const rows: { key: string; sideColour: string; shipAlive: boolean; cells: RenderCell[] }[] = [];
  for (const s of frame.ships) {
    const cells = renderCells(s, descriptors.get(s.instanceId));
    if (cells === undefined || cells.length === 0) continue;
    rows.push({
      key: s.instanceId,
      sideColour: SIDE_COLOUR[s.side],
      shipAlive: s.alive,
      cells,
    });
  }

  if (rows.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No module data
      </Text>
    );
  }
  return (
    <Stack gap={6}>
      {rows.map((r) => (
        <ShipStatusRow
          key={r.key}
          sideColour={r.sideColour}
          shipAlive={r.shipAlive}
          cells={r.cells}
        />
      ))}
    </Stack>
  );
}
