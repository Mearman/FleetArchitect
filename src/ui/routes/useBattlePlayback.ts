import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { interpolateFrame } from "@/ui/interpolateFrame";
import type { BattleFrame, BattleResult } from "@/schema/battle";
import { COMFORT_LEAD_SECONDS, PLAYBACK_EASE_FACTOR, SIM_DELIVERED_RATE_WINDOW_MS } from "./battleConstants";

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
  framesRef: React.RefObject<BattleFrame[]>;
  result: BattleResult | null;
  /** Ref mirror of `computedTicks` (the streamed leading edge) so the rAF can
   *  read the current edge for the delivered-rate bar without a stale closure. */
  computedTicksRef: React.RefObject<number>;
  hasFrames: boolean;
  drawFrame: (frame: BattleFrame, tickF: number, frames: readonly BattleFrame[]) => void;
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
  framesRef,
  result,
  computedTicksRef,
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
   * Effective playback speed the clock advances at, eased toward the sustainable
   * target each frame (see the streaming branch of the rAF loop). A ref, not
   * state, because it changes every frame and only the clock reads it. Reset to
   * the selected speed whenever the rAF effect re-arms (speed/play/result
   * changes), so a deliberate speed change or a resume takes effect immediately
   * rather than easing up from a prior slow value.
   */
  const effectiveSpeedRef = useRef(speed);
  /**
   * The sim's delivered rate (sim-seconds per real-second over the rolling
   * window), mirrored from the sim-speed bar computation below so the streaming
   * easing branch can read it. Updates every rAF frame and drops to 0 when the
   * leading edge stops advancing (e.g. a hard pause).
   */
  const deliveredRateRef = useRef(0);

  /**
   * The sim-speed telemetry shown by the speed slider's cyan bar: the sim's
   * DELIVERED rate (leading-edge advance per real second over a rolling window),
   * NOT the raw inter-batch compute rate. Under Overdrive off the sim is paced to
   * real-time so this settles near 1x; under Overdrive it pokes past the thumb
   * (flat-out). Also drives playback easing via the sibling `deliveredRateRef`.
   * Null before the first batch
   * and once the battle is fully computed. Gated by {@link lastSimSpeedRef} so it
   * only re-renders when the rounded value changes.
   */
  const [simSpeed, setSimSpeed] = useState<number | null>(null);
  // Last rounded sim-speed multiplier mirrored into state, or -1 when hidden.
  // A ref (not a loop-local) so the computed/no-measurement clear survives the
  // effect re-running whenever `result` lands.
  const lastSimSpeedRef = useRef(-1);
  /**
   * Rolling (time, leading-edge-ticks) samples for the delivered-rate window,
   * updated each rAF frame and pruned to {@link SIM_DELIVERED_RATE_WINDOW_MS}.
   * Cleared on edge regression (a fresh run) and when the result lands.
   */
  const deliveredSamplesRef = useRef<{ t: number; ticks: number }[]>([]);

  // The status panel uses the discrete-nearest frame since it shows system HP
  // values, not positions — there is no meaningful interpolation for HP. It is
  // selected inside the rAF loop below (a legitimate non-render context for
  // reading `framesRef`) and mirrored here, updated only when the integer tick
  // changes so it does not re-render every animation frame. The loop reads
  // `statusOpenRef` (not the prop) so toggling the modules tab does not restart
  // the loop; the frame is left stale while the panel is closed and seeded
  // synchronously when the panel reopens (a layout effect, before paint, so the
  // readout never flashes its empty placeholder).
  const [statusFrame, setStatusFrame] = useState<BattleFrame | null>(null);

  // Mirror `statusOpen` into a ref so the rAF loop reads the current value each
  // frame without restarting (and without the one-frame clock hiccup a restart
  // would cause) when the modules tab is toggled. Updated every render; the loop
  // consumes it on the next rAF.
  const statusOpenRef = useRef(statusOpen);
  useEffect(() => {
    statusOpenRef.current = statusOpen;
  });

  // Seed the status frame synchronously when the panel opens so the module
  // readout never flashes its empty placeholder: the rAF loop keeps it fresh
  // thereafter, but its first update lands a frame later. A layout effect so it
  // commits before the browser paints. Uses the same discrete-nearest selection
  // as the loop.
  useLayoutEffect(() => {
    if (!statusOpen) return;
    const frames = framesRef.current;
    if (frames.length === 0) return;
    const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
    const tick = Math.min(frames.length - 1, Math.floor(fractionalTick));
    const frame = frames[tick];
    if (frame !== undefined) setStatusFrame(frame);
  }, [statusOpen, framesRef, playbackTimeRef]);

  // Latest `drawFrame` held in a ref so the rAF loop reads the current frame
  // painter without the effect restarting whenever `drawFrame`'s identity
  // changes (it changes when descriptors/bounds/maxHp change, which happens on
  // early streamed batches). The loop reads `drawFrameRef.current` each frame.
  const drawFrameRef = useRef(drawFrame);
  useEffect(() => {
    drawFrameRef.current = drawFrame;
  });

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
    // Re-arm resets the eased speed to the selected speed, so a speed change,
    // resume, or the result landing takes effect immediately instead of easing
    // up from a prior slow value.
    effectiveSpeedRef.current = speed;

    let rafId = 0;
    let lastTimestamp: number | null = null;
    // Tracks the last integer tick mirrored into `statusFrame`, so the panel's
    // state is updated only when the discrete tick changes, not every frame.
    let lastStatusTick = -1;
    // Last integer decisecond mirrored into the `playbackTime` state, so the
    // readout updates only when the displayed decisecond changes — not every
    // animation frame (see the mirror block at the end of the `playing` branch).
    let lastMirroredDecis = -1;

    const loop = (now: number) => {
      if (lastTimestamp !== null) {
        const realDt = (now - lastTimestamp) / 1000;
        // Guard against very large dt values from hidden-tab pauses (browser
        // suspends rAF; on resume the first dt can be seconds). Clamp to 200 ms.
        const clampedDt = Math.min(realDt, 0.2);

        if (playing) {
          // Reading `result` from the closure (the effect re-runs when it lands)
          // and the streamed leading edge from `computedTicksRef` (so the effect
          // does NOT re-run on every batch — the ref always holds the current edge).
          const final = result !== null;

          if (final) {
            // The whole battle is computed — no delivery constraint, so run at
            // the full selected speed straight through to the authoritative end.
            const maxTime = result.ticks / TICKS_PER_SECOND;
            const newTime = playbackTimeRef.current + clampedDt * speed;
            if (newTime >= maxTime) {
              playbackTimeRef.current = maxTime;
              setPlaying(false);
            } else {
              playbackTimeRef.current = newTime;
            }
          } else {
            // Still computing: ease the effective playback speed toward what the
            // sim can deliver so the playhead never hard-stalls at the leading
            // edge. While the lead is comfortable playback runs at the selected
            // speed; as the lead shrinks below the comfort threshold it eases
            // down toward the sim's delivered rate, and back up as it recovers.
            const edgeTime = computedTicksRef.current / TICKS_PER_SECOND;
            const lead = edgeTime - playbackTimeRef.current;
            const target = lead < COMFORT_LEAD_SECONDS ? Math.min(speed, deliveredRateRef.current) : speed;
            effectiveSpeedRef.current += (target - effectiveSpeedRef.current) * PLAYBACK_EASE_FACTOR;
            const advanced = playbackTimeRef.current + clampedDt * effectiveSpeedRef.current;
            // Clamp at the leading edge as a safety net; the easing targets the
            // delivered rate so this only bites on a sudden lead collapse.
            playbackTimeRef.current = Math.min(advanced, edgeTime);
          }

          // Mirror the clock into state at decisecond resolution so the seeker
          // slider and tick counter stay in sync without re-rendering the route
          // on every animation frame. The draw loop reads playbackTimeRef.current
          // directly (below), so playback smoothness is unaffected; only the UI
          // readout is throttled to ~10 Hz. The slider's own onSeek still sets
          // the state directly, so dragging the thumb stays responsive.
          const decis = Math.floor(playbackTimeRef.current * 10);
          if (decis !== lastMirroredDecis) {
            lastMirroredDecis = decis;
            setPlaybackTime(playbackTimeRef.current);
          }
        }
      }

      lastTimestamp = now;

      // Draw on every rAF regardless of whether the clock advanced.
      const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
      const frames = framesRef.current;
      const frame = interpolateFrame(frames, fractionalTick);
      drawFrameRef.current(frame, fractionalTick, frames);

      // Mirror the discrete-nearest frame into state for the status panel, but
      // only when the panel is open and the integer tick has moved — avoiding a
      // re-render on every animation frame. Reading the ref here is legitimate:
      // the rAF callback is not the render path.
      if (statusOpenRef.current && frames.length > 0) {
        const tick = Math.min(frames.length - 1, Math.floor(fractionalTick));
        if (tick !== lastStatusTick) {
          lastStatusTick = tick;
          setStatusFrame(frames[tick] ?? null);
        }
      }

      // Mirror the sim's DELIVERED rate (leading-edge advance per real second
      // over a rolling window) for the speed slider's telemetry bar. Unlike the
      // inter-batch sim-rate EMA (which feeds the buffering calc and freezes
      // during a cooperative hold), this includes hold gaps, so the bar drops
      // while the sim is held (Overdrive off) and reflects the effective rate:
      // near the thumb when paced, past it when Overdrive is on. Computed from
      // the shared computedTicksRef each frame; gated on value change so the
      // slider does not re-render every animation frame.
      if (result === null) {
        const edge = computedTicksRef.current;
        const samples = deliveredSamplesRef.current;
        // A fresh run resets the edge downward; drop stale samples so the window
        // never spans the boundary between battles.
        const prev = samples[samples.length - 1];
        if (prev !== undefined && edge < prev.ticks) samples.length = 0;
        samples.push({ t: now, ticks: edge });
        const cutoff = now - SIM_DELIVERED_RATE_WINDOW_MS;
        // Prune samples older than the window (keep at least one). Read
        // samples[0] into a narrowed local each iteration — noUncheckedIndexedAccess
        // won't narrow an indexed access gated only on `samples.length`.
        while (samples.length > 1) {
          const first = samples[0];
          if (first === undefined || first.t >= cutoff) break;
          samples.shift();
        }
        const oldest = samples[0];
        let deliveredX = 0;
        if (oldest !== undefined) {
          const spanMs = now - oldest.t;
          if (spanMs > 0) {
            deliveredX = ((edge - oldest.ticks) / TICKS_PER_SECOND) / (spanMs / 1000);
          }
        }
        // Mirror the delivered rate for the streaming easing branch (one-frame
        // latency is fine for a control law).
        deliveredRateRef.current = deliveredX;
        // Show once the sim has produced frames; hide before the first batch.
        if (edge > 0) {
          const rounded = Math.round(deliveredX * 10) / 10;
          if (rounded !== lastSimSpeedRef.current) {
            lastSimSpeedRef.current = rounded;
            setSimSpeed(rounded);
          }
        } else if (lastSimSpeedRef.current !== -1) {
          lastSimSpeedRef.current = -1;
          setSimSpeed(null);
        }
      } else {
        deliveredSamplesRef.current = [];
        if (lastSimSpeedRef.current !== -1) {
          lastSimSpeedRef.current = -1;
          setSimSpeed(null);
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  // Restart the loop only when: the first batch lands, playing toggles, speed
  // changes, or the final result arrives. The status-panel open flag is read via
  // `statusOpenRef` each frame, so toggling the modules tab mirrors/stops
  // mirroring the status frame WITHOUT a loop restart (and the one-frame clock
  // hiccup a restart would cause). The streamed leading edge and the frame
  // painter are likewise read via refs (`computedTicksRef`/`drawFrameRef`) each
  // frame, so a new batch or a recreated `drawFrame` no longer tears the loop
  // down and re-creates it ~60x/sec during streaming. Each restart resets
  // `lastTimestamp` so the first dt after a real pause is not inflated.
  // `playbackTimeRef`/`bufferingRef`/`framesRef`/`simTickRateRef`/
  // `computedTicksRef`/`drawFrameRef`/`statusOpenRef` are stable refs (they
  // never change identity); listed only to satisfy exhaustive-deps lint, not
  // because they ever retrigger the loop.
  }, [hasFrames, playing, speed, result, framesRef, playbackTimeRef, computedTicksRef, drawFrameRef, statusOpenRef]);

  // Redraw when the canvas is resized (canvasSize changes). The draw itself is
  // purely a side-effect of the current playbackTime; no clock advance needed.
  // The rAF loop above handles the drawing during normal playback; this covers
  // the paused-then-resize case.
  useEffect(() => {
    if (!hasFrames) return;
    const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
    const frames = framesRef.current;
    const frame = interpolateFrame(frames, fractionalTick);
    drawFrame(frame, fractionalTick, frames);
  }, [canvasSize, hasFrames, drawFrame, framesRef, playbackTimeRef]);

  return {
    playbackTime,
    setPlaybackTime,
    playing,
    setPlaying,
    speed,
    setSpeed,
    simSpeed,
    statusFrame,
  };
}
