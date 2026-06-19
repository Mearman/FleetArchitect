import { Button, Group, NativeSelect, NumberInput, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowsShuffle, IconRefresh, IconSwords } from "@tabler/icons-react";
import { BattleAnomaly } from "@/schema/battle";
import type { BattleAnomaly as BattleAnomalyType } from "@/schema/battle";
import { ANOMALY_LABEL } from "./battleConstants";

/**
 * Props for {@link BattleSetupPanel}. All state stays in the route; the panel is
 * a controlled form that reports changes through the setters and triggers a run
 * through `onEngage`/`onRandomBattle`. Keeping the panel stateless preserves the
 * original semantics (the route's `attackerId`/`defenderId`/`anomaly`/`seed`
 * are the single source of truth, including for the auto-roll reflection).
 */
export interface BattleSetupPanelProps {
  attackerId: string | null;
  defenderId: string | null;
  anomaly: BattleAnomalyType;
  seed: number;
  fleetOptions: { value: string; label: string }[];
  computing: boolean;
  hasFleets: boolean;
  onAttackerIdChange: (value: string | null) => void;
  onDefenderIdChange: (value: string | null) => void;
  onAnomalyChange: (value: BattleAnomalyType) => void;
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
  anomaly,
  seed,
  fleetOptions,
  computing,
  hasFleets,
  onAttackerIdChange,
  onDefenderIdChange,
  onAnomalyChange,
  onSeedChange,
  onRandomSeed,
  onEngage,
  onRandomBattle,
}: BattleSetupPanelProps) {
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
          Spatial anomaly
        </Text>
        <SegmentedControl
          fullWidth
          size="xs"
          data={BattleAnomaly.options.map((a) => ({
            value: a,
            label: ANOMALY_LABEL[a],
          }))}
          value={anomaly}
          onChange={(val) => onAnomalyChange(BattleAnomaly.parse(val))}
        />
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
        >
          Engage
        </Button>
        <Tooltip label="Auto-roll attacker, defender, anomaly and seed, then watch.">
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
