import { Button, Chip, Group, NativeSelect, NumberInput, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowsShuffle, IconRefresh, IconSwords } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { BattleAnomalyKind } from "@/schema/battle";
import { ANOMALY_LABEL } from "./battleConstants";

/** Allowed anomaly kinds, as plain strings for Chip.Group narrowing. */
const ALLOWED_ANOMALY_KINDS = new Set<string>(BattleAnomalyKind.options);

function isAnomalyKind(value: string): value is BattleAnomalyKind {
  return ALLOWED_ANOMALY_KINDS.has(value);
}

/**
 * Props for {@link BattleSetupPanel}. All state stays in the route; the panel is
 * a controlled form that reports changes through the setters and triggers a run
 * through `onEngage`/`onRandomBattle`. Keeping the panel stateless preserves the
 * original semantics (the route's `attackerId`/`defenderId`/`anomalies`/`seed`
 * are the single source of truth, including for the auto-roll reflection).
 */
export interface BattleSetupPanelProps {
  attackerId: string | null;
  defenderId: string | null;
  anomalies: BattleAnomalyKind[];
  seed: number;
  fleetOptions: { value: string; label: string }[];
  computing: boolean;
  hasFleets: boolean;
  onAttackerIdChange: (value: string | null) => void;
  onDefenderIdChange: (value: string | null) => void;
  onAnomaliesChange: (value: BattleAnomalyKind[]) => void;
  onSeedChange: (value: number) => void;
  onRandomSeed: () => void;
  onEngage: () => void;
  onRandomBattle: () => void;
}

/**
 * The fleet/anomaly/seed setup form. Purely presentational: every value and
 * setter is handed in by the route. Extracted verbatim from the original
 * BattleRoute `setupForm` JSX.
 */
export function BattleSetupPanel({
  attackerId,
  defenderId,
  anomalies,
  seed,
  fleetOptions,
  computing,
  hasFleets,
  onAttackerIdChange,
  onDefenderIdChange,
  onAnomaliesChange,
  onSeedChange,
  onRandomSeed,
  onEngage,
  onRandomBattle,
}: BattleSetupPanelProps) {
  if (!hasFleets) {
    return (
      <Text size="sm" c="dimmed">
        No fleets yet.{" "}
        <Text component={Link} to="/fleets" size="sm" c="blue" td="underline">
          Build or import a fleet
        </Text>{" "}
        to get started.
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      <Group gap="sm" grow align="flex-start">
        <NativeSelect
          label="Attacker"
          value={attackerId ?? ""}
          onChange={(e) => onAttackerIdChange(e.target.value || null)}
        >
          <option value="">— select —</option>
          {fleetOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          label="Defender"
          value={defenderId ?? ""}
          onChange={(e) => onDefenderIdChange(e.target.value || null)}
        >
          <option value="">— select —</option>
          {fleetOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Group>

      <Stack gap={4}>
        <Text size="sm" fw={500}>
          Spatial anomalies
        </Text>
        <Chip.Group multiple value={anomalies} onChange={(values) => onAnomaliesChange(values.filter(isAnomalyKind))}>
          <Group gap="xs">
            {BattleAnomalyKind.options.map((kind) => (
              <Chip key={kind} value={kind} size="xs" variant="light">
                {ANOMALY_LABEL[kind]}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </Stack>

      <Group align="flex-end">
        <NumberInput
          label="Seed"
          value={seed}
          onChange={(val) => onSeedChange(typeof val === "number" ? val : 1)}
          style={{ flex: 1 }}
        />
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={onRandomSeed}
        >
          Random
        </Button>
      </Group>

      <Group grow>
        <Button
          size="md"
          leftSection={<IconSwords size={18} />}
          onClick={onEngage}
          loading={computing}
          disabled={attackerId === null || defenderId === null || computing}
        >
          Engage
        </Button>
        <Tooltip label="Auto-roll attacker, defender and seed, then watch.">
          <Button
            variant="light"
            leftSection={<IconArrowsShuffle size={16} />}
            onClick={onRandomBattle}
            disabled={!hasFleets || computing}
          >
            AI vs AI
          </Button>
        </Tooltip>
      </Group>
    </Stack>
  );
}
