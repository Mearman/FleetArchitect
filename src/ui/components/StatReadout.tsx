import { Box, Group, Progress, SimpleGrid, Stack, Text } from "@mantine/core";
import type { ShipStats } from "@/domain/stats";

interface StatReadoutProps {
  stats: ShipStats;
  /** Hull mass capacity, to show mass as a fraction of the budget. */
  massCapacity: number;
}

interface CellProps {
  label: string;
  children: React.ReactNode;
  tone?: "normal" | "good" | "bad";
}

function StatCell({ label, children, tone = "normal" }: CellProps) {
  const colour =
    tone === "good" ? "teal.4" : tone === "bad" ? "red.4" : "gray.1";
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm" fw={600} c={colour}>
        {children}
      </Text>
    </Stack>
  );
}

/**
 * Compact read-out of a resolved ship's aggregate stats. Power and crew nets go
 * red when the ship cannot sustain itself; mass shows against the hull budget.
 */
export function StatReadout({ stats, massCapacity }: StatReadoutProps) {
  const massFraction = Math.min(1, stats.mass / Math.max(massCapacity, 1));
  const massTone: CellProps["tone"] =
    stats.mass > massCapacity ? "bad" : "normal";

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
        <StatCell label="Cost">{stats.cost} pts</StatCell>
        <StatCell label="Weapons">{stats.weapons.length}</StatCell>
        <StatCell label="Structure">
          {Math.round(stats.structure)}
          {stats.damageReduction > 0
            ? ` (−${Math.round(stats.damageReduction * 100)}%)`
            : ""}
        </StatCell>
        <StatCell label="Shield">
          {Math.round(stats.shieldCapacity)}
          {stats.shieldCapacity > 0
            ? ` (+${stats.shieldRechargeRate.toFixed(1)}/t)`
            : ""}
        </StatCell>
        <StatCell label="Power" tone={stats.powerNet < 0 ? "bad" : "good"}>
          {stats.powerNet >= 0 ? "+" : ""}
          {stats.powerNet.toFixed(0)} ({stats.powerOutput.toFixed(0)} out)
        </StatCell>
        <StatCell label="Crew" tone={stats.crewNet < 0 ? "bad" : "good"}>
          {stats.crewNet >= 0 ? "+" : ""}
          {stats.crewNet.toFixed(0)}
        </StatCell>
        <StatCell label="Thrust">{stats.thrust.toFixed(2)}</StatCell>
        <StatCell label="Turn">{stats.turnRate.toFixed(3)}</StatCell>
      </SimpleGrid>

      <Box>
        <Group justify="space-between" mb={4}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Mass
          </Text>
          <Text size="xs" fw={600} c={massTone === "bad" ? "red.4" : "gray.1"}>
            {stats.mass.toFixed(0)} / {massCapacity}
          </Text>
        </Group>
        <Progress
          value={massFraction * 100}
          color={massTone === "bad" ? "red" : "indigo"}
          size="sm"
        />
      </Box>
    </Stack>
  );
}
