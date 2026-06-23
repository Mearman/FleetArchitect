import { SimpleGrid, Stack, Text } from "@mantine/core";
import type { ShipStats } from "@/domain/stats";
import { formatJoules, formatWatts } from "@/ui/format";

interface StatReadoutProps {
  stats: ShipStats;
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
 * red when the ship cannot sustain itself; mass is reported as a raw figure
 * (the mass budget was retired — heavy ships are slower via F = ma rather than
 * undeployable). Compartments are advisory: airtightness flags whether the
 * crew interior will hold atmosphere once the engine consumes it.
 */
export function StatReadout({ stats }: StatReadoutProps) {
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
        <StatCell label="Cost">{stats.cost} pts</StatCell>
        <StatCell label="Weapons">{stats.weapons.length}</StatCell>
        <StatCell label="Structure">
          {formatJoules(stats.structure)}
          {stats.damageReduction > 0
            ? ` (−${Math.round(stats.damageReduction * 100)}%)`
            : ""}
        </StatCell>
        <StatCell label="Shield">
          {formatJoules(stats.shieldCapacity)}
          {stats.shieldCapacity > 0
            ? ` (+${formatWatts(stats.shieldRechargeRate)})`
            : ""}
        </StatCell>
        <StatCell label="Power" tone={stats.powerNet < 0 ? "bad" : "good"}>
          {stats.powerNet >= 0 ? "+" : ""}
          {formatWatts(stats.powerNet)} ({formatWatts(stats.powerOutput)} out)
        </StatCell>
        <StatCell label="Crew" tone={stats.crewNet < 0 ? "bad" : "good"}>
          {stats.crewNet >= 0 ? "+" : ""}
          {stats.crewNet.toFixed(0)}
        </StatCell>
        <StatCell label="Thrust">{stats.thrust.toFixed(2)}</StatCell>
        <StatCell label="Turn">{stats.turnRate.toFixed(3)}</StatCell>
        <StatCell label="Mass">{stats.mass.toFixed(0)}</StatCell>
        <StatCell label="Compartments">
          {stats.airtightCompartments}/{stats.compartments} airtight
        </StatCell>
      </SimpleGrid>
    </Stack>
  );
}
