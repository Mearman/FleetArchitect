import { Group, SegmentedControl, Slider, Stack, Text, Tooltip } from "@mantine/core";
import { IconFocus2, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import type { Camera, ProjectionMode } from "./battleCamera";

/** Narrow a SegmentedControl string value to a ProjectionMode without a cast. */
function toProjectionMode(value: string): ProjectionMode {
  return value === "isometric" ? "isometric" : "flat";
}

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
  /** Switch the battle view between the flat top-down and the 2.5D isometric
   *  projection. The mode rides the camera, so this only sets it. */
  onProjectionChange: (mode: ProjectionMode) => void;
}

/**
 * The playback bar: play/pause, follow/zoom badge, tick readout, speed control,
 * and the seeker slider. Play/pause and the fit toggle are annunciator legend
 * lamps that light while engaged.
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
  onProjectionChange,
}: PlaybackControlsProps) {
  return (
    <Stack gap="xs">
      <Group gap="md" align="center" wrap="wrap">
        <AnnunciatorButton
          tint="green"
          active={playing}
          icon={playing ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
          onClick={onTogglePlay}
        >
          {playing ? "Pause" : "Play"}
        </AnnunciatorButton>
        <Tooltip
          label={
            camera.autoFit
              ? "Auto-fitting live ships — zoom or pan to take manual control"
              : camera.followId !== null
                ? "Following a ship — click to auto-fit live ships"
                : "Click to auto-fit live ships (zoom/pan is manual)"
          }
        >
          <AnnunciatorButton
            tint={camera.autoFit ? "green" : camera.followId !== null ? "magenta" : "amber"}
            active={camera.autoFit}
            icon={<IconFocus2 size={12} />}
            onClick={onRestoreFit}
            aria-label="Restore auto-fit to live ships"
          >
            {camera.autoFit ? "FIT" : `${Math.round(camera.zoom * 100)}%`}
          </AnnunciatorButton>
        </Tooltip>
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          Tick {currentTick} / {maxTick}
          {finished ? "" : "…"}
        </Text>
        <Tooltip label="Toggle between the flat top-down and the 2.5D isometric view">
          <SegmentedControl
            size="xs"
            data={[
              { value: "flat", label: "2D" },
              { value: "isometric", label: "2.5D" },
            ]}
            value={camera.projection}
            onChange={(val) => onProjectionChange(toProjectionMode(val))}
          />
        </Tooltip>
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
