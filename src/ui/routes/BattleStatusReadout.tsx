import { Badge, Box, Group, Loader, Progress, Stack, Text } from "@mantine/core";

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
 * Streaming progress readout, pinned to the bottom-left of the canvas stage
 * while a run is computing. Battles run with no fixed tick cap, so an animated
 * bar signals ongoing work and a live tick count tracks the streamed leading
 * edge, with a badge that flips to "buffering" when playback has outrun the
 * streamed frames.
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
          <Text size="xs" c="dimmed" ff="monospace">
            {computedTicks} ticks
          </Text>
        </Group>
        {/* No fixed tick cap means no known total to show a percentage against,
            so an animated bar signals ongoing work while the count above tracks
            the streamed leading edge. */}
        <Progress
          size="xs"
          value={100}
          animated
          color={buffering ? "yellow" : "indigo"}
        />
      </Stack>
    </Box>
  );
}
