import { Group, SegmentedControl, Slider, Stack, Text, Tooltip } from "@mantine/core";
import { IconFocus2, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import { speedSliderLayer, speedSliderWrap } from "./PlaybackControls.css";
import { formatSpeed, posToSpeed, speedMarks, speedToPos } from "./speedSlider";
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
  /**
   * Measured simulation throughput as a speed multiplier, shown as a cyan bar on
   * the speed slider's rail. Null hides the bar (no measurement yet, or the
   * battle is fully computed and playback is unconstrained).
   */
  simSpeed: number | null;
  currentTick: number;
  /** Fractional tick position (for smooth slider scrubbing — sub-tick interpolation). */
  playbackTick: number;
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
  simSpeed,
  currentTick,
  playbackTick,
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
        {/*
          Speed control: a slider whose rail carries two bars sharing one
          geometry. The amber bar + thumb (draggable) is the desired playback
          speed, clamped to 8x. The cyan bar is the measured simulation
          throughput (sim speed): it trails the thumb when the engine can't keep
          up and pokes past it into the headroom when the engine is faster. The
          rail is log-scaled (each doubling an equal distance) so 0.25x-1x are
          not crammed into the first few percent.
        */}
        <Tooltip
          multiline
          maw={220}
          label="Playback speed — drag to set. The cyan bar is how fast the battle is computing (sim speed): it sits under the thumb when the sim keeps up, trails it when the sim can't, and pokes past it when the sim is faster (Overdrive). When the bar trails the thumb, playback eases down to the sim's speed rather than stalling."
        >
          <div className={speedSliderWrap}>
            <Slider
              size="xs"
              classNames={{ root: speedSliderLayer }}
              min={0}
              max={1}
              step={0.005}
              value={speedToPos(speed)}
              onChange={(pos) => onSpeedChange(posToSpeed(pos))}
              marks={speedMarks()}
              label={(pos) => formatSpeed(posToSpeed(pos))}
              aria-label="Playback speed"
            />
            {simSpeed !== null && (
              <Slider
                size="xs"
                color="cyan"
                classNames={{ root: speedSliderLayer }}
                min={0}
                max={1}
                step={0.005}
                value={speedToPos(simSpeed)}
                label={null}
                aria-hidden
                styles={{
                  root: { pointerEvents: "none" },
                  thumb: { display: "none" },
                  track: { backgroundColor: "transparent" },
                  bar: {
                    height: 3,
                    top: "50%",
                    transform: "translateY(-50%)",
                    borderRadius: 2,
                  },
                }}
              />
            )}
          </div>
        </Tooltip>
      </Group>
      {/*
        Smooth scrubbing: step 0.1 + fractional playbackTick keeps the thumb
        gliding between ticks (sub-tick interpolation in the renderer). The
        thumb label is the only place a fractional value leaked through, so it
        is floored to match the rendered frame and the "Tick X / Y" readout
        (both derive the shown tick via Math.floor(playbackTick)).
      */}
      <Slider
        min={0}
        max={maxTick}
        value={playbackTick}
        step={0.1}
        onChange={(val) => onSeek(val)}
        label={(value) => Math.floor(value)}
      />
    </Stack>
  );
}
