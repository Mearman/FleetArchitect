import { useEffect, useRef, useState } from "react";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { interpolateFrame } from "@/ui/interpolateFrame";
import type { BattleFrame, BattleResult } from "@/schema/battle";
import { resumeLeadSeconds } from "./battleConstants";

/**
 * Props for {@link useBattlePlayback}. The hook owns the playback clock state
 * and the rAF/resize redraw loops; the cross-cutting refs (`playbackTimeRef`,
 * `bufferingRef`, `framesRef`, `simTickRateRef`) are created by the route and
 * shared with the simulation hook so both can read/write the live clock and
 * streaming accumulators.
 *
 * The streaming-derived values (`result`, `computedTicks`, `hasFrames`,
 * `drawFrame`, `canvasSize`) are produced by sibling hooks. The route threads
 * the latest values in on each render; the rAF and resize effects list them in
 * their dependency arrays and re-run when they change, so the loop always
 * converges to current values within one effect cycle (the same property the
 * original inlined code relied on).
 */
export interface UseBattlePlaybackProps {
  playbackTimeRef: React.RefObject<number>;
  bufferingRef: React.RefObject<boolean>;
  framesRef: React.RefObject<BattleFrame[]>;
  simTickRateRef: React.RefObject<number>;
  result: BattleResult | null;
  computedTicks: number;
  hasFrames: boolean;
  drawFrame: (frame: BattleFrame, tick: number, frames: readonly BattleFrame[]) => void;
  statusOpen: boolean;
  canvasSize: { width: number; height: number } | null;
}

/**
 * Playback clock and rAF/resize redraw loops for the BattleRoute. Owns the
 * mirrored playback-time state, the playing/speed flags, the buffering
 * state, and the discrete-nearest status frame mirrored for the module-status
 * panel. The clock itself (`playbackTimeRef`) is a route-level ref shared with
 * the simulation hook so `startBattle` can reset it on a fresh run.
 *
 * The rAF loop advances the clock by the real wall-clock delta (multiplied by
 * the speed factor), derives the fractional sim-tick position, interpolates
 * between the two bracketing frames, and draws on every rAF regardless of
 * display refresh rate. Pausing, seeking, and stepping all operate on
 * `playbackTimeRef` directly; the loop runs regardless of `playing` so that
 * seek/resize redraws work.
 */
export function useBattlePlayback({
  playbackTimeRef,
  bufferingRef,
  framesRef,
  simTickRateRef,
  result,
  computedTicks,
  hasFrames,
  drawFrame,
  statusOpen,
  canvasSize,
}: UseBattlePlaybackProps) {
  /**
   * playbackTime mirrored as state so the seeker Slider and tick counter stay
   * in sync with the playback clock without an additional ref-to-state dance.
   */
  const [playbackTime, setPlaybackTime] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  /**
   * True when the playback clock has caught up to the streamed leading edge and
   * is waiting for more frames to compute. Distinct from paused: the clock is
   * clamped to the leading edge but playback is still "on" and resumes
   * automatically as soon as more frames arrive.
   */
  const [buffering, setBuffering] = useState(false);

  /**
   * Measured simulation throughput as a speed multiplier (sim ticks produced per
   * real second / {@link TICKS_PER_SECOND}), mirrored from `simTickRateRef` for
   * the speed slider's telemetry bar. Null while no measurement exists or once
   * the battle is fully computed (no production limit remains). Gated by
   * {@link lastSimSpeedRef} so it only re-renders when the rounded value changes.
   */
  const [simSpeed, setSimSpeed] = useState<number | null>(null);
  // Last rounded sim-speed multiplier mirrored into state, or -1 when hidden.
  // A ref (not a loop-local) so the computed/no-measurement clear survives the
  // effect re-running whenever `result` lands.
  const lastSimSpeedRef = useRef(-1);

  // The status panel uses the discrete-nearest frame since it shows system HP
  // values, not positions — there is no meaningful interpolation for HP. It is
  // selected inside the rAF loop below (a legitimate non-render context for
  // reading `framesRef`) and mirrored here, updated only when the integer tick
  // changes so it does not re-render every animation frame. It is left stale
  // while the panel is closed — render gates on `statusOpen` — and refreshed
  // within one frame of reopening.
  const [statusFrame, setStatusFrame] = useState<BattleFrame | null>(null);

  /**
   * Main rAF loop: advances the playback clock by the real wall-clock delta
   * (multiplied by the speed factor), derives the fractional sim-tick position,
   * interpolates between the two bracketing frames, and draws on every rAF
   * regardless of display refresh rate.
   *
   * Pausing, seeking, and stepping all operate on `playbackTimeRef` directly;
   * this loop runs regardless of `playing` so that seek/resize redraws work.
   */
  useEffect(() => {
    if (!hasFrames) return;

    let rafId = 0;
    let lastTimestamp: number | null = null;
    // Tracks the last integer tick mirrored into `statusFrame`, so the panel's
    // state is updated only when the discrete tick changes, not every frame.
    let lastStatusTick = -1;

    const loop = (now: number) => {
      if (lastTimestamp !== null) {
        const realDt = (now - lastTimestamp) / 1000;
        // Guard against very large dt values from hidden-tab pauses (browser
        // suspends rAF; on resume the first dt can be seconds). Clamp to 200 ms.
        const clampedDt = Math.min(realDt, 0.2);

        if (playing) {
          // Reading `result`/`computedTicks` from the closure: the effect re-runs
          // when either changes, so the closure always sees current values.
          const final = result !== null;
          const newTime = playbackTimeRef.current + clampedDt * speed;

          if (final) {
            // The whole battle is computed. Play straight through to the
            // authoritative end, then stop.
            const maxTime = result.ticks / TICKS_PER_SECOND;
            if (newTime >= maxTime) {
              playbackTimeRef.current = maxTime;
              setPlaybackTime(maxTime);
              setPlaying(false);
              setBuffering(false);
              bufferingRef.current = false;
            } else {
              playbackTimeRef.current = newTime;
              setPlaybackTime(newTime);
              if (bufferingRef.current) {
                bufferingRef.current = false;
                setBuffering(false);
              }
            }
          } else {
            // Still computing: gate playback on the streamed leading edge using
            // the measured sim rate. Switch to buffering when the playhead
            // catches the edge; resume only once enough lead has built up that
            // playback can run smoothly given how fast the sim is producing
            // frames (the rebuffer model — fewer, longer stalls over constant
            // micro-stutter when the sim is slower than playback).
            const edgeTime = computedTicks / TICKS_PER_SECOND;
            const playbackTickRate = TICKS_PER_SECOND * speed;
            const resumeLead = resumeLeadSeconds(simTickRateRef.current, playbackTickRate);

            if (bufferingRef.current) {
              // Hold at the edge until the buffer has refilled to the target lead.
              if (edgeTime - playbackTimeRef.current >= resumeLead) {
                bufferingRef.current = false;
                setBuffering(false);
                playbackTimeRef.current = newTime;
                setPlaybackTime(newTime);
              } else {
                playbackTimeRef.current = Math.min(playbackTimeRef.current, edgeTime);
                setPlaybackTime(playbackTimeRef.current);
              }
            } else if (newTime >= edgeTime) {
              // Caught the leading edge — clamp and start buffering.
              playbackTimeRef.current = edgeTime;
              setPlaybackTime(edgeTime);
              bufferingRef.current = true;
              setBuffering(true);
            } else {
              playbackTimeRef.current = newTime;
              setPlaybackTime(newTime);
            }
          }
        }
      }

      lastTimestamp = now;

      // Draw on every rAF regardless of whether the clock advanced.
      const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
      const frames = framesRef.current;
      const frame = interpolateFrame(frames, fractionalTick);
      drawFrame(frame, Math.floor(fractionalTick), frames);

      // Mirror the discrete-nearest frame into state for the status panel, but
      // only when the panel is open and the integer tick has moved — avoiding a
      // re-render on every animation frame. Reading the ref here is legitimate:
      // the rAF callback is not the render path.
      if (statusOpen && frames.length > 0) {
        const tick = Math.min(frames.length - 1, Math.floor(fractionalTick));
        if (tick !== lastStatusTick) {
          lastStatusTick = tick;
          setStatusFrame(frames[tick] ?? null);
        }
      }

      // Mirror the measured simulation throughput as a sim-speed multiplier for
      // the speed slider's telemetry bar. Only meaningful while the battle is
      // still computing; once `result` lands the simulation is done and the bar
      // is hidden. -1 = hidden; updated only when the rounded value changes so
      // the slider does not re-render every animation frame.
      if (result === null) {
        const rate = simTickRateRef.current;
        if (rate > 0) {
          const rounded = Math.round((rate / TICKS_PER_SECOND) * 10) / 10;
          if (rounded !== lastSimSpeedRef.current) {
            lastSimSpeedRef.current = rounded;
            setSimSpeed(rounded);
          }
        } else if (lastSimSpeedRef.current !== -1) {
          // Fresh run, no batches yet — drop any stale value from a prior battle.
          lastSimSpeedRef.current = -1;
          setSimSpeed(null);
        }
      } else if (lastSimSpeedRef.current !== -1) {
        lastSimSpeedRef.current = -1;
        setSimSpeed(null);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  // Restart the loop when: the first batch lands, playing toggles, speed
  // changes, the streamed leading edge grows, the final result arrives, or
  // drawFrame is recreated (bounds/maxHp changed), or the status panel opens or
  // closes (so the loop begins/stops mirroring the status frame). All are
  // legitimate reasons to reset `lastTimestamp` so the first dt after each
  // change is not inflated.
  // `playbackTimeRef`/`bufferingRef`/`framesRef`/`simTickRateRef` are stable
  // route-level refs (they never change identity); they are listed only to
  // satisfy the exhaustive-deps lint, not because they ever retrigger the loop.
  }, [hasFrames, playing, speed, drawFrame, result, computedTicks, statusOpen, bufferingRef, framesRef, playbackTimeRef, simTickRateRef]);

  // Redraw when the canvas is resized (canvasSize changes). The draw itself is
  // purely a side-effect of the current playbackTime; no clock advance needed.
  // The rAF loop above handles the drawing during normal playback; this covers
  // the paused-then-resize case.
  useEffect(() => {
    if (!hasFrames) return;
    const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
    const frames = framesRef.current;
    const frame = interpolateFrame(frames, fractionalTick);
    drawFrame(frame, Math.floor(fractionalTick), frames);
  }, [canvasSize, hasFrames, drawFrame, framesRef, playbackTimeRef]);

  return {
    playbackTime,
    setPlaybackTime,
    playing,
    setPlaying,
    speed,
    setSpeed,
    buffering,
    setBuffering,
    simSpeed,
    statusFrame,
  };
}
