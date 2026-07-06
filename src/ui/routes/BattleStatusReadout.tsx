import { Group, Text } from "@mantine/core";
import { AnnunciatorLamp } from "@/ui/components/Annunciator";

/**
 * Props for {@link BattleStatusReadout}. Shown only while a run is still
 * computing (the final result has not yet landed); vanishes the moment the
 * result resolves.
 */
export interface BattleStatusReadoutProps {
  /** Whether the battle computation is paused by the user. */
  paused: boolean;
  /** Highest tick streamed so far. Battles run with no fixed tick cap, so this
   *  is an open-ended count rather than a fraction of a known total. */
  computedTicks: number;
}

/**
 * Streaming-progress readout mounted on the chassis bezel strip while a run is
 * computing. A lit annunciator lamp signals ongoing work — cyan "Computing"
 * while frames stream, amber "Paused" when the user has halted the computation
 * — and a live tick count tracks the streamed leading edge. Battles run with no
 * fixed tick cap, so there is no total to show a percentage against. Playback
 * that outruns the sim no longer flips a "Buffering" face; it smoothly eases
 * down instead, signalled by the speed slider's cyan bar trailing the thumb.
 */
export function BattleStatusReadout({ paused, computedTicks }: BattleStatusReadoutProps) {
  const lampLabel = paused ? "Paused" : "Computing";
  const lampTint = paused ? "amber" : "cyan";

  return (
    <Group gap={6} align="center" wrap="nowrap">
      <AnnunciatorLamp tint={lampTint} lit>
        {lampLabel}
      </AnnunciatorLamp>
      <Text size="xs" c="dimmed" ff="monospace">
        {computedTicks} ticks
      </Text>
    </Group>
  );
}
