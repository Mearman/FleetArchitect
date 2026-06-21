import { Box, Group, Progress, Stack, Text, Tooltip } from "@mantine/core";
import type { BattleFrame } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import { renderCells } from "@/ui/cellLayout";
import { MODULE_LABEL, SIDE_COLOUR } from "./battleConstants";

/**
 * Per-module status readout for the current frame: each ship's cells as a
 * row of HP bars, so you can watch systems fail as the battle wears on. Cell
 * kinds and max HP come from the static descriptor; live HP/alive come from the
 * frame.
 *
 * Renders without a Paper wrapper so it sits flush inside the controls dock
 * or any other container that already provides its own chrome.
 */
export function ModuleStatusPanel({
  frame,
  descriptors,
}: {
  frame: BattleFrame;
  descriptors: DescriptorMap;
}) {
  const withModules = frame.ships
    .map((s) => ({ ship: s, cells: renderCells(s, descriptors.get(s.instanceId)) }))
    .filter((entry) => entry.cells !== undefined && entry.cells.length > 0);
  if (withModules.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No module data
      </Text>
    );
  }
  return (
    <Stack gap={6}>
      {withModules.map(({ ship: s, cells }) => {
        const sideColour = SIDE_COLOUR[s.side];
        return (
          <Group key={s.instanceId} gap="xs" wrap="nowrap" align="center">
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: s.alive ? sideColour : "transparent",
                border: `1px solid ${sideColour}`,
                flex: "0 0 auto",
              }}
            />
            <Group gap={4} wrap="wrap" style={{ flex: 1 }}>
              {cells?.map((m) => {
                const frac = m.maxHp > 0 ? Math.max(0, m.hp / m.maxHp) : 0;
                return (
                  <Tooltip
                    key={m.slotId}
                    label={`${MODULE_LABEL[m.kind] ?? m.kind}: ${Math.round(m.hp)}/${m.maxHp}`}
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
      })}
    </Stack>
  );
}
