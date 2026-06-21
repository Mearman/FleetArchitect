import { Button, Group, SegmentedControl, Slider, Stack, Text, Tooltip } from "@mantine/core";
import { IconFocus2, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import type { Camera } from "./battleCamera";

/**
 * Props for {@link PlaybackControls}. All playback/camera state lives in the
 * route (via the playback and camera hooks); the controls are a presentational
 * bar that reports through `onTogglePlay` and `onSeek`. The "restart from the
 * top when paused at the end" logic is decided by the route's `onTogglePlay`
 * handler, which has access to the result and the current tick.
 */
export interface PlaybackControlsProps {
  playing: boolean;
  speed: number;
  currentTick: number;
  maxTick: number;
  /** Whether the final result has landed (controls the "..." suffix on the tick). */
  finished: boolean;
  camera: Camera;
  onTogglePlay: () => void;
  onSpeedChange: (value: number) => void;
  onSeek: (tick: number) => void;
  /** Restore auto-fit mode (the zoom badge acts as this button). */
  onRestoreFit: () => void;
}

/**
 * The playback bar: play/pause, follow/zoom badge, tick readout, speed control,
 * and the seeker slider. Extracted verbatim from the original BattleRoute JSX.
 */
export function PlaybackControls({
  playing,
  speed,
  currentTick,
  maxTick,
  finished,
  camera,
  onTogglePlay,
  onSpeedChange,
  onSeek,
  onRestoreFit,
}: PlaybackControlsProps) {
  return (
    <Stack gap="xs">
      <Group gap="md" align="center" wrap="wrap">
        <Button
          variant="light"
          leftSection={playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
          onClick={onTogglePlay}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <Tooltip
          label={
            camera.autoFit
              ? "Auto-fitting live ships — zoom or pan to take manual control"
              : camera.followId !== null
                ? "Following a ship — click to auto-fit live ships"
                : "Click to auto-fit live ships (zoom/pan is manual)"
          }
        >
          <Button
            size="compact-xs"
            variant={camera.autoFit ? "filled" : "light"}
            color={camera.autoFit ? "teal" : camera.followId !== null ? "grape" : "gray"}
            leftSection={<IconFocus2 size={12} />}
            onClick={onRestoreFit}
            aria-label="Restore auto-fit to live ships"
          >
            {camera.autoFit ? "FIT" : `${Math.round(camera.zoom * 100)}%`}
          </Button>
        </Tooltip>
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          Tick {currentTick} / {maxTick}
          {finished ? "" : "…"}
        </Text>
        <SegmentedControl
          size="xs"
          data={[
            { value: "0.25", label: "0.25x" },
            { value: "0.5", label: "0.5x" },
            { value: "1", label: "1x" },
            { value: "2", label: "2x" },
            { value: "4", label: "4x" },
            { value: "8", label: "8x" },
          ]}
          value={String(speed)}
          onChange={(val) => onSpeedChange(Number(val))}
        />
      </Group>
      <Slider min={0} max={maxTick} value={currentTick} onChange={(val) => onSeek(val)} />
    </Stack>
  );
}
