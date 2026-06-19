import { Box, Group, Paper, Progress, Stack, Text, Tooltip } from "@mantine/core";
import type { BattleFrame } from "@/schema/battle";
import { MODULE_LABEL } from "./battleConstants";

/**
 * Per-module status readout for the current frame: each ship's modules as a
 * row of HP bars, so you can watch systems fail as the battle wears on.
 */
export function ModuleStatusPanel({ frame }: { frame: BattleFrame }) {
  const withModules = frame.ships.filter((s) => s.modules !== undefined && s.modules.length > 0);
  if (withModules.length === 0) return null;
  return (
    <Paper p="sm" withBorder>
      <Stack gap={6}>
        <Text size="xs" c="dimmed" fw={600}>
          Modules
        </Text>
        {withModules.map((s) => {
          const sideColour = s.side === "attacker" ? "#ff6b5a" : "#5ab0ff";
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
                {s.modules?.map((m) => {
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
    </Paper>
  );
}
