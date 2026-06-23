import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState } from "react";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { battleRunner } from "@/ui/battleRunner";
import { catalog } from "@/data/catalog";
import type {
  BattleAnomaly as BattleAnomalyType,
  BattleFrame,
  BattleResult,
  ShipDescriptor,
} from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { Bounds } from "./battleCamera";
import { SIM_RATE_EMA_WEIGHT } from "./battleConstants";

/**
 * Props for {@link useBattleSimulation}. The hook owns the simulation/streaming
 * state but shares the streaming accumulator (`framesRef`), the measured sim
 * rate (`simTickRateRef`), and the playback clock (`playbackTimeRef`) with
 * sibling hooks — these are route-level refs so the rAF loop, pointer handlers,
 * and this hook all read/write the same live values.
 *
 * A fresh run also has to reset playback/camera/UI state owned by sibling
 * hooks. Rather than duplicate that state here, the route passes two stable
 * callbacks:
 *
 * - `resetForNewRun`: invoked at the top of every fresh run. Clears the
 *   playback-derived state the original reset inline (buffering state + ref,
 *   playing flag).
 * - `onFirstBatch`: invoked once, when the first streamed batch lands. Resets
 *   the playback clock to zero, snaps the camera to default, collapses the
 *   setup panel, and starts playback.
 *
 * Both are kept as callbacks so the simulation hook stays decoupled from
 * playback/camera/UI state while preserving the original side-effect ordering.
 */
export interface UseBattleSimulationProps {
  framesRef: React.RefObject<BattleFrame[]>;
  simTickRateRef: React.RefObject<number>;
  playbackTimeRef: React.RefObject<number>;
  /** Route-owned mirror of the live descriptor map, kept current as batches
   *  stream so the camera pointer handler reads it without a render. */
  descriptorsRef: React.RefObject<DescriptorMap>;
  resetForNewRun: () => void;
  onFirstBatch: () => void;
}

/**
 * The simulation/streaming lifecycle for the BattleRoute: the running world
 * bounds, the final result, the computing flag, and the `startBattle` entry
 * point. The streaming accumulator and measured sim rate live in route-level
 * refs shared with the playback/camera/canvas hooks; the hook mirrors
 * render-facing facts (frame count, deployment frame, computed ticks) into
 * state so render reads reactive values, never the refs.
 *
 * Frames are accumulated in the shared `framesRef` (not state) so appending a
 * batch is O(batch) and never forces an array copy; the rAF loop, pointer
 * handlers, and redraw effects read it directly.
 */
export function useBattleSimulation({
  framesRef,
  simTickRateRef,
  playbackTimeRef,
  descriptorsRef,
  resetForNewRun,
  onFirstBatch,
}: UseBattleSimulationProps) {
  /**
   * The full, final BattleResult. Set only when the run promise resolves; used
   * for the winner badge, persistence, and the terminal stop-at-end behaviour.
   * Playback no longer waits on this — it reads streamed frames from `framesRef`
   * as soon as the first batch lands.
   */
  const [result, setResult] = useState<BattleResult | null>(null);

  /**
   * Static per-ship descriptors (cell layout + outline), keyed by instance id,
   * accumulated as batches stream so the renderer can reconstruct cell world
   * positions for the leading edge before the final result lands. Held in state
   * so render reads a reactive value; mirrored into `descriptorsRef` for the
   * camera pointer handler.
   */
  const [descriptors, setDescriptors] = useState<DescriptorMap>(() => new Map());

  /**
   * Number of frames streamed so far, mirrored from `framesRef` on each batch.
   * Drives `hasFrames` and bounds-checks in the render path without reading the
   * ref during render.
   */
  const [frameCount, setFrameCount] = useState(0);

  /**
   * The tick-0 deployment frame, captured once when the first batch lands. The
   * full per-ship structure/shield maxima are taken from it for the HP bars, so
   * render reads this state rather than indexing `framesRef.current[0]`.
   */
  const [deploymentFrame, setDeploymentFrame] = useState<BattleFrame | null>(null);

  /**
   * Highest tick streamed so far. While computing this is the leading edge of
   * playable time; once the final `result` lands the authoritative tick count
   * is `result.ticks` (the two agree at completion).
   */
  const [computedTicks, setComputedTicks] = useState(0);

  /**
   * Running world bounds (raw, unpadded), expanded as each batch arrives so the
   * camera widens to follow the spreading battle rather than snapping to the
   * final extent. Held in state so the padded `bounds` memo recomputes whenever
   * the extent grows; the `onFrames` handler reads the current value and sets a
   * fresh object when the extent changes. The padded transform applies the same
   * 8% + 40 padding as the original all-frames pass.
   */
  const [rawBounds, setRawBounds] = useState<Bounds | null>(null);

  /**
   * AbortController for the in-flight run. Aborted when a new battle starts so a
   * stale stream can never feed frames into the new run's accumulator.
   */
  const runAbortRef = useRef<AbortController | null>(null);

  /**
   * Arrival time (ms) and tick count of the previous batch, for the rate EMA.
   * Local to this hook: only `onFrames` reads and writes it.
   */
  const lastBatchRef = useRef<{ timeMs: number; ticks: number } | null>(null);

  /**
   * The anomaly baked into the running replay. Captured at battle start (the
   * value passed to `startBattle`) so the rendered anomaly matches the simulated
   * physics from the first streamed frame, before the final result — with its
   * `config.anomaly` — has landed. Reconciled against the result on completion.
   */
  const [runningAnomaly, setRunningAnomaly] = useState<BattleAnomalyType>("none");
  const activeAnomaly: BattleAnomalyType = result?.config.anomaly ?? runningAnomaly;

  /** Whether a run is in flight (drives the "Computing battle..." loader). */
  const [computing, setComputing] = useState(false);

  // Abort any in-flight run when the route unmounts so a stream can't keep
  // appending frames into a torn-down component.
  useEffect(() => () => runAbortRef.current?.abort(), []);

  /**
   * Resolve the chosen fleets, run the engine, and start the replay. The
   * caller passes fleet objects directly so both the manual and auto-rolled
   * code paths can drive the same pipeline without going through state.
   *
   * The hook invokes `resetForNewRun` at the top of every fresh run (so sibling
   * hooks clear their streaming-derived state) and `onFirstBatch` once, when
   * the first streamed batch lands (so the route resets the playback clock,
   * camera, setup panel, and starts playback) — preserving the original
   * BattleRoute's inline side-effect ordering exactly.
   */
  async function startBattle(
    attacker: Fleet,
    defender: Fleet,
    chosenAnomaly: BattleAnomalyType,
    chosenSeed: number,
    allDesigns: ShipDesign[],
  ): Promise<void> {
    const designMap = new Map(allDesigns.map((d) => [d.id, d]));
    const attackers = resolveFleetToCombatShips(attacker, designMap, catalog(), "attacker");
    const defenders = resolveFleetToCombatShips(defender, designMap, catalog(), "defender");
    if (attackers.length === 0 || defenders.length === 0) {
      notifications.show({
        title: "Nothing to fight",
        message: "One fleet has no ships that resolve against the catalog.",
        color: "red",
      });
      return;
    }
    // Compute off the main thread via the BattleRunner contract. Frames stream
    // in batch by batch through `onFrames`; playback starts on the first batch
    // and runs along the streamed leading edge while later batches compute. The
    // final `result` only lands when the run resolves — used for the winner
    // badge, persistence, and the terminal stop-at-end.

    // Abort any run still in flight so its stale stream can't feed this one.
    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;

    // Reset every streaming accumulator for the fresh run. The cross-hook
    // resets (buffering, playing) are delegated to `resetForNewRun` so this
    // hook does not own playback state.
    resetForNewRun();
    framesRef.current = [];
    setFrameCount(0);
    setDeploymentFrame(null);
    setRawBounds(null);
    setComputedTicks(0);
    simTickRateRef.current = 0;
    lastBatchRef.current = null;
    setResult(null);
    const freshDescriptors: Map<string, ShipDescriptor> = new Map();
    descriptorsRef.current = freshDescriptors;
    setDescriptors(freshDescriptors);
    setRunningAnomaly(chosenAnomaly);
    setComputing(true);

    let firstBatch = true;
    const onFrames = (
      frames: readonly BattleFrame[],
      streamedTicks: number,
      batchDescriptors: readonly ShipDescriptor[],
    ) => {
      // Ignore late batches from a run that has since been superseded.
      if (controller.signal.aborted) return;

      // Fold any newly-introduced ship descriptors into the live map so the
      // renderer can reconstruct cell positions for this batch's frames. A fresh
      // Map identity makes the descriptors state update reactively; the ref keeps
      // the camera pointer handler current without a render.
      if (batchDescriptors.length > 0) {
        const merged: Map<string, ShipDescriptor> = new Map(descriptorsRef.current);
        for (const d of batchDescriptors) merged.set(d.instanceId, d);
        descriptorsRef.current = merged;
        setDescriptors(merged);
      }

      // Update the measured simulation rate (ticks computed per real second) as
      // an EMA over batch arrivals. The rAF loop uses it to decide how much lead
      // to buffer before resuming playback at the leading edge.
      const nowMs = performance.now();
      const prevBatch = lastBatchRef.current;
      if (prevBatch !== null) {
        const dtSeconds = (nowMs - prevBatch.timeMs) / 1000;
        const dTicks = streamedTicks - prevBatch.ticks;
        if (dtSeconds > 0 && dTicks > 0) {
          const instantRate = dTicks / dtSeconds;
          simTickRateRef.current =
            simTickRateRef.current === 0
              ? instantRate
              : SIM_RATE_EMA_WEIGHT * instantRate +
                (1 - SIM_RATE_EMA_WEIGHT) * simTickRateRef.current;
        }
      }
      lastBatchRef.current = { timeMs: nowMs, ticks: streamedTicks };

      // Capture the very first streamed frame (the tick-0 deployment snapshot)
      // before appending, so the HP-bar maxima can be taken from it.
      const firstFrame = framesRef.current.length === 0 ? frames[0] : undefined;

      // Append the batch into the ref the rAF loop reads from. The runner hands
      // us a readonly view; push each frame reference into the accumulator.
      for (const frame of frames) {
        framesRef.current.push(frame);
      }

      // Expand the running world extent with this batch's ships and projectiles,
      // growing the camera view as the battle spreads. Folded into the previous
      // bounds state so render reads a reactive value, never the ref. Only emit
      // a fresh object when the extent actually grew, so the bounds memo stays
      // stable across batches that add nothing new.
      setRawBounds((prev) => {
        let minX = prev?.minX ?? Infinity;
        let maxX = prev?.maxX ?? -Infinity;
        let minY = prev?.minY ?? Infinity;
        let maxY = prev?.maxY ?? -Infinity;
        for (const frame of frames) {
          for (const s of frame.ships) {
            if (s.x < minX) minX = s.x;
            if (s.x > maxX) maxX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.y > maxY) maxY = s.y;
          }
          for (const p of frame.projectiles) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
        }
        if (
          prev !== null &&
          minX === prev.minX &&
          maxX === prev.maxX &&
          minY === prev.minY &&
          maxY === prev.maxY
        ) {
          return prev;
        }
        return { minX, maxX, minY, maxY };
      });

      setFrameCount(framesRef.current.length);
      setComputedTicks(streamedTicks);

      if (firstFrame !== undefined) {
        // Capture the tick-0 deployment frame for the HP-bar maxima.
        setDeploymentFrame(firstFrame);
      }

      if (firstBatch) {
        firstBatch = false;
        // Start playback from the top of the fresh battle and hand the stage the
        // full width once the first frames are on screen.
        playbackTimeRef.current = 0;
        onFirstBatch();
      }
    };

    try {
      const battle = await battleRunner.run(
        {
          ships: [...attackers, ...defenders],
          attackerFleetId: attacker.id,
          defenderFleetId: defender.id,
          anomaly: chosenAnomaly,
          seed: chosenSeed,
        },
        { signal: controller.signal, onFrames },
      );
      // A superseded run that resolves anyway must not clobber the current one.
      if (controller.signal.aborted) return;
      setResult(battle);
      // Reconcile the descriptor map against the authoritative complete list on
      // the result, so any instance the stream did not surface (or a replay that
      // never streamed) is present for rendering.
      if (battle.descriptors !== undefined) {
        const complete: Map<string, ShipDescriptor> = new Map(descriptorsRef.current);
        for (const d of battle.descriptors) complete.set(d.instanceId, d);
        descriptorsRef.current = complete;
        setDescriptors(complete);
      }
    } catch (error) {
      notifications.show({
        title: "Battle failed to compute",
        message: error instanceof Error ? error.message : "The simulation worker did not return a result.",
        color: "red",
      });
    } finally {
      if (runAbortRef.current === controller) setComputing(false);
    }
  }

  return {
    result,
    frameCount,
    deploymentFrame,
    computedTicks,
    rawBounds,
    activeAnomaly,
    computing,
    descriptors,
    startBattle,
  };
}
