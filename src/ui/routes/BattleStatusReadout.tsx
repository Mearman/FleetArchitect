import { Badge, Box, Group, Loader, Progress, Stack } from "@mantine/core";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";

/**
 * Props for {@link BattleStatusReadout}. Shown only while a run is still
 * computing (the final result has not yet landed); vanishes the moment the
 * result resolves.
 */
export interface BattleStatusReadoutProps {
  /** Whether playback has stalled at the streamed leading edge. */
  buffering: boolean;
  /** Highest tick streamed so far, against the safety cap. */
  computedTicks: number;
}

/**
 * Streaming progress readout, pinned to the bottom-left of the canvas stage
 * while a run is computing. A thin progress bar tracks the streamed leading edge
 * against the safety cap, with a badge that flips to "buffering" when playback
 * has outrun the streamed frames. Extracted verbatim from the original
 * BattleRoute JSX.
 */
export function BattleStatusReadout({ buffering, computedTicks }: BattleStatusReadoutProps) {
  return (
    <Box
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        zIndex: 3,
        width: "min(260px, 60%)",
        pointerEvents: "none",
      }}
    >
      <Stack gap={4}>
        <Group gap={6} align="center">
          <Loader size={12} />
          <Badge size="sm" variant="filled" color={buffering ? "yellow" : "indigo"}>
            {buffering ? "Buffering" : "Computing"}
          </Badge>
        </Group>
        <Progress
          size="xs"
          value={Math.min(100, (computedTicks / DEFAULT_MAX_TICKS) * 100)}
          color={buffering ? "yellow" : "indigo"}
        />
      </Stack>
    </Box>
  );
}
