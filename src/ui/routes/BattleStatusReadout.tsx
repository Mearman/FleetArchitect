import { Group, Text } from "@mantine/core";
import { AnnunciatorLamp } from "@/ui/components/Annunciator";

/**
 * Props for {@link BattleStatusReadout}. Shown only while a run is still
 * computing (the final result has not yet landed); vanishes the moment the
 * result resolves.
 */
export interface BattleStatusReadoutProps {
  /** Whether playback has stalled at the streamed leading edge. */
  buffering: boolean;
  /** Highest tick streamed so far. Battles run with no fixed tick cap, so this
   *  is an open-ended count rather than a fraction of a known total. */
  computedTicks: number;
}

/**
 * Streaming-progress readout mounted on the chassis bezel strip while a run is
 * computing. A lit annunciator lamp signals ongoing work (flipping to amber
 * "buffering" when playback outruns the streamed frames) and a live tick count
 * tracks the streamed leading edge. Battles run with no fixed tick cap, so there
 * is no total to show a percentage against.
 */
export function BattleStatusReadout({ buffering, computedTicks }: BattleStatusReadoutProps) {
  return (
    <Group gap={6} align="center" wrap="nowrap">
      <AnnunciatorLamp tint={buffering ? "amber" : "cyan"} lit>
        {buffering ? "Buffering" : "Computing"}
      </AnnunciatorLamp>
      <Text size="xs" c="dimmed" ff="monospace">
        {computedTicks} ticks
      </Text>
    </Group>
  );
}
