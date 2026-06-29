import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveFleetToCombatShips, resolveFleetToCombatShipsAndPoints } from "@/domain/resolve";
import { loadTemplateTable } from "@/domain/formation-templates";
import { expandTemplates } from "@/schema/expand-templates";
import { BattleAbortError } from "@/domain/simulation/runner";
import type { PacingHandle } from "@/domain/simulation/runner";
import { battleRunner } from "@/ui/battleRunner";
import { catalog } from "@/data/catalog";
import { storage } from "@/storage/db";
import { normaliseAnomalies } from "@/schema/battle";
import type {
  BattleAnomalyKind,
  BattleFrame,
  BattleResult,
  ShipDescriptor,
} from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import type { Fleet } from "@/schema/fleet";
import type { FormationTemplate } from "@/schema/formation-template";
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
 * - `onFirstBatch`: invoked once, when the first streamed batch of a FRESH run
 *   lands. Resets the playback clock to zero, snaps the camera to default,
 *   collapses the setup panel, and starts playback. Not fired on resume.
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
  /**
   * Whether the simulation may run faster than playback (Overdrive). When false
   * the run starts in pausable mode so the route's auto-pacer can hold it to the
   * playback playhead; when true the worker runs the tight, non-pausable loop at
   * full speed. Fixed at run start — a mid-run toggle takes effect on the next
   * battle.
   */
  overdrive: boolean;
}

/** Lifecycle state of the computation. */
export type ComputeStatus = "idle" | "running" | "paused" | "complete";

/** Arguments captured at `startBattle` time so a resume can re-issue them. */
interface BattleArgs {
  attacker: Fleet;
  defender: Fleet;
  anomalies: BattleAnomalyKind[];
  seed: number;
  designs: ShipDesign[];
  /**
   * Snapshot of the formation-template catalogue at battle-start time. A fleet's
   * `template` nodes are by-reference links into this map; they are expanded to
   * concrete formation subtrees before resolve, so the template ids never reach
   * the engine or the cache key. Captured here (rather than reloaded on resume)
   * so a paused run resumes against the same templates it started with — the
   * resolved fleet, and therefore the cache key, stay stable across the pause.
   */
  templates: ReadonlyMap<string, FormationTemplate>;
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
  overdrive,
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
   * stale stream can never feed frames into the new run's accumulator, and when
   * the run is paused so the worker is released while the persisted checkpoint
   * survives for resume.
   */
  const runAbortRef = useRef<AbortController | null>(null);

  /**
   * Arrival time (ms) and tick count of the previous batch, for the rate EMA.
   * Local to this hook: only the rAF flush reads and writes it.
   */
  const lastBatchRef = useRef<{ timeMs: number; ticks: number } | null>(null);

  /**
   * Pending batches awaiting a rAF flush. The worker `message` handler pushes
   * each batch here and schedules a single coalesced rAF; the rAF drains the
   * queue and does the framesRef push, setFrameCount, EMA, and bounds work.
   * Keeping the queue off the message task means the worker handler does only
   * the cheap domain-level push (the resume decorator's synchronous
   * `streamedFrames` accumulation) plus the schedule, so the `message` task
   * stays short and Chrome stops logging `[Violation] 'message' handler` for
   * every batch during a battle.
   */
  const pendingBatchesRef = useRef<
    {
      frames: readonly BattleFrame[];
      streamedTicks: number;
      descriptors: readonly ShipDescriptor[];
      arrivalMs: number;
    }[]
  >([]);

  /**
   * Handle of the pending rAF flush, or null when none is scheduled. Coalesces
   * multiple batches into one rAF so a burst of batches from the worker cannot
   * schedule a storm of callbacks.
   */
  const rafHandleRef = useRef<number | null>(null);

  /**
   * The anomalies baked into the running replay. Captured at battle start (the
   * value passed to `startBattle`) so the rendered anomalies match the simulated
   * physics from the first streamed frame, before the final result — with its
   * `config.anomalies` — has landed. Reconciled against the result on completion.
   */
  const [runningAnomalies, setRunningAnomalies] = useState<BattleAnomalyKind[]>([]);
  const activeAnomalies: BattleAnomalyKind[] = result?.config.anomalies ?? runningAnomalies;

  /**
   * Explicit computation lifecycle. Drives the `computing` and `paused` derived
   * flags so existing consumers keep working while new ones can distinguish a
   * paused run (frames held, resume available) from a completed one. Status is
   * the single source of truth: set to "running" when a run starts, "complete"
   * on a successful resolve, "paused" by `pauseComputation`, and reset to
   * "idle" on a fresh `startBattle` or a non-abort error. Aborts do not touch
   * status here — the caller that aborted has already set the appropriate one.
   */
  const [computeStatus, setComputeStatus] = useState<ComputeStatus>("idle");
  const computing = computeStatus === "running";
  const paused = computeStatus === "paused";

  /**
   * The arguments used to start the most recent fresh run, captured so a paused
   * run can be resumed by re-issuing the same inputs. Cleared implicitly by the
   * next fresh run (overwritten before the run starts).
   */
  const lastBattleArgsRef = useRef<BattleArgs | null>(null);

  /**
   * Cooperative pause/resume handle for the in-flight pausable run (Overdrive
   * off), or null when the run is not pausable or has finished. Set by the
   * runner's `onPacingHandle` once the worker starts; cleared on each new run
   * and on completion. `holdSim`/`releaseSim` message through it.
   */
  const pacingHandleRef = useRef<PacingHandle | null>(null);

  /**
   * Ref mirror of `computedTicks` (the streamed leading edge) so the route's
   * pacing rAF can read the current lead without a stale closure and without
   * per-frame re-renders. Updated wherever `setComputedTicks` is.
   */
  const computedTicksRef = useRef(0);

  // Abort any in-flight run when the route unmounts so a stream can't keep
  // appending frames into a torn-down component. Cancel any pending rAF flush
  // so a deferred batch does not fire after teardown.
  useEffect(
    () => () => {
      runAbortRef.current?.abort();
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
    },
    [],
  );

  /**
   * Resolve the chosen fleets, run the engine, and start the replay. The
   * caller passes fleet objects directly so both the manual and auto-rolled
   * code paths can drive the same pipeline without going through state.
   *
   * `startBattle` is a thin wrapper that captures the args (so a later resume
   * can re-issue them identically) and delegates to {@link runCompute} with
   * `fresh: true`. The previous inline body — accumulator resets, the streaming
   * loop, the `onFirstBatch` gating — now lives in `runCompute`, which is also
   * called with `fresh: false` by {@link resumeComputation}.
   */
  function startBattle(
    attacker: Fleet,
    defender: Fleet,
    chosenAnomalies: BattleAnomalyKind[],
    chosenSeed: number,
    allDesigns: ShipDesign[],
  ): Promise<void> {
    // Load the formation-template catalogue before capturing args so the table
    // is frozen into `BattleArgs` (and reused unchanged by a later resume). The
    // expansion itself happens in `runCompute` — this only reads the catalogue.
    return loadTemplateTable(storage()).then((templates) => {
      const args: BattleArgs = {
        attacker,
        defender,
        anomalies: chosenAnomalies,
        seed: chosenSeed,
        designs: allDesigns,
        templates,
      };
      lastBattleArgsRef.current = args;
      return runCompute(args, { fresh: true });
    });
  }

  /**
   * Pause the in-flight run: abort it (releasing the worker), cancel any pending
   * rAF flush, and flip status to "paused". Does NOT clear `framesRef` or any
   * accumulator — the persisted checkpoint survives the abort because the resume
   * decorator only deletes its checkpoint on successful completion, which is the
   * whole basis for {@link resumeComputation}.
   */
  function pauseComputation(): void {
    runAbortRef.current?.abort();
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    setComputeStatus("paused");
  }

  /**
   * Resume a paused run by re-issuing the captured args with `fresh: false`.
   * No-op unless the status is currently "paused" and args have been captured.
   * Resume hits a cache miss (the prior run never completed) and the resume
   * decorator finds the persisted checkpoint, so computation continues from
   * roughly where it left off.
   */
  function resumeComputation(): void {
    if (computeStatus === "paused" && lastBattleArgsRef.current !== null) {
      void runCompute(lastBattleArgsRef.current, { fresh: false });
    }
  }

  /**
   * Cooperatively hold the in-flight simulation at its next batch boundary
   * (Overdrive off, while playback is playing and the lead is large). Distinct
   * from {@link pauseComputation}: this does NOT abort the run or release the
   * worker — it sends a control message, so no progress is lost and no
   * checkpoint recompute happens on resume. No-op without a pausable handle
   * (Overdrive on, or the run has finished). Memoised so the route's pacing
   * effect can depend on it without re-arming every render.
   */
  const holdSim = useCallback((): void => {
    pacingHandleRef.current?.pause();
  }, []);

  /**
   * Release a cooperatively-held simulation so it resumes computing.
   * Counterpart to {@link holdSim}; no-op without a pausable handle. Memoised
   * for the same reason as {@link holdSim}.
   */
  const releaseSim = useCallback((): void => {
    pacingHandleRef.current?.resume();
    // Re-seed the sim-rate EMA: the next batch after a cooperative resume would
    // otherwise span the whole hold in its inter-batch gap, crashing the EMA
    // (and the buffering resume-lead it feeds). Dropping the previous-batch
    // anchor makes the next batch skip the rate update and the one after
    // re-establish a clean gap.
    lastBatchRef.current = null;
  }, []);

  /**
   * Internal compute driver shared by fresh starts and resumes. The `fresh`
   * flag selects between the two paths:
   *
   * - `fresh: true` — the original `startBattle` behaviour, byte-identical:
   *   reset every accumulator, invoke `resetForNewRun`, capture the deployment
   *   frame and fire `onFirstBatch` on the first batch, set status "running".
   * - `fresh: false` — resume: keep all accumulators and the playback clock,
   *   do NOT invoke `resetForNewRun` or `onFirstBatch`, and MERGE streamed
   *   frames instead of blindly appending (the resume re-emits the frames since
   *   the last checkpoint, which are already held and byte-identical, so skip
   *   any frame whose tick is below the current accumulator length).
   *
   * Both paths abort any prior in-flight controller, cancel the pending rAF, and
   * install a fresh controller before setting status to "running".
   */
  async function runCompute(
    args: BattleArgs,
    opts: { fresh: boolean },
  ): Promise<void> {
    const { attacker, defender, anomalies: chosenAnomalies, seed: chosenSeed, designs: allDesigns, templates: templateTable } = args;
    const fresh = opts.fresh;

    const designMap = new Map(allDesigns.map((d) => [d.id, d]));
    // Inline every `template` formation node into a concrete formation tree
    // BEFORE resolve, so the engine and the cache key never see a template id.
    // A missing templateId or a cycle is an authoring error: refuse to start
    // with a loud message naming the broken reference rather than silently
    // deploying a partial fleet. A template-free fleet is returned unchanged
    // (byte-identical fast path), so preset fleets — which have no template
    // nodes — resolve exactly as before.
    let expandedAttacker: Fleet;
    let expandedDefender: Fleet;
    try {
      expandedAttacker = expandTemplates(attacker, templateTable);
      expandedDefender = expandTemplates(defender, templateTable);
    } catch (error) {
      notifications.show({
        title: "Fleet has unresolved formation templates",
        message:
          error instanceof Error
            ? error.message
            : "A referenced formation template could not be resolved.",
        color: "red",
      });
      return;
    }
    const attackers = resolveFleetToCombatShips(expandedAttacker, designMap, catalog(), "attacker");
    const defenders = resolveFleetToCombatShips(expandedDefender, designMap, catalog(), "defender");
    if (attackers.length === 0 || defenders.length === 0) {
      notifications.show({
        title: "Nothing to fight",
        message: "One fleet has no ships that resolve against the catalog.",
        color: "red",
      });
      return;
    }
    // Resolve each fleet's named waypoints (fleet-local → world) and merge into
    // a single per-battle map keyed by pointId. Empty for fleets that author no
    // points (every preset), so a battle between presets carries an empty map
    // and point references stay unresolvable — byte-identical to before. On a
    // pointId collision the defender's entry wins (last write); pointIds should
    // be unique across both fleets.
    const attackerPoints = resolveFleetToCombatShipsAndPoints(expandedAttacker, designMap, catalog(), "attacker").points;
    const defenderPoints = resolveFleetToCombatShipsAndPoints(expandedDefender, designMap, catalog(), "defender").points;
    const points = new Map<string, { x: number; y: number }>();
    for (const [id, p] of attackerPoints) points.set(id, p);
    for (const [id, p] of defenderPoints) points.set(id, p);
    // Compute off the main thread via the BattleRunner contract. Frames stream
    // in batch by batch through `onFrames`; playback starts on the first batch
    // of a fresh run and runs along the streamed leading edge while later
    // batches compute. The final `result` only lands when the run resolves —
    // used for the winner badge, persistence, and the terminal stop-at-end.

    // Abort any run still in flight so its stale stream can't feed this one.
    runAbortRef.current?.abort();
    // Cancel any deferred rAF flush from the previous run and drop its pending
    // batches so they cannot land in this run's accumulator. On a resume the
    // prior run was already aborted by `pauseComputation`, but the rAF may
    // still be queued.
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    pendingBatchesRef.current = [];
    const controller = new AbortController();
    runAbortRef.current = controller;
    // Drop any pacing handle from a previous run; a fresh one arrives (if this
    // run is pausable) via `onPacingHandle` once the worker starts.
    pacingHandleRef.current = null;

    if (fresh) {
      // Reset every streaming accumulator for the fresh run. The cross-hook
      // resets (buffering, playing) are delegated to `resetForNewRun` so this
      // hook does not own playback state.
      resetForNewRun();
      framesRef.current = [];
      setFrameCount(0);
      setDeploymentFrame(null);
      setRawBounds(null);
      setComputedTicks(0);
      computedTicksRef.current = 0;
      simTickRateRef.current = 0;
      lastBatchRef.current = null;
      setResult(null);
      const freshDescriptors: Map<string, ShipDescriptor> = new Map();
      descriptorsRef.current = freshDescriptors;
      setDescriptors(freshDescriptors);
      setRunningAnomalies(chosenAnomalies);
      setComputeStatus("running");
    } else {
      // Resume: re-record the running anomalies (already set, but the result is
      // still absent so keep them current against any UI that reads them) and
      // flip to "running". Do NOT touch framesRef, descriptors, bounds, the
      // playback clock, or `result` — those carry the paused state forward.
      setComputeStatus("running");
    }

    let firstBatch = fresh;

    // Drains every batch stashed since the last flush, applying the descriptor
    // fold, EMA, deployment-frame capture, framesRef push, bounds expansion, and
    // state mirrors in arrival order. Runs inside a rAF so the work happens off
    // the worker `message` handler task; one pending rAF at a time (coalesced)
    // so a burst of batches produces a single flush.
    const flushPendingBatches = () => {
      rafHandleRef.current = null;
      // A superseded or aborted run must not touch the accumulator or state.
      if (controller.signal.aborted) {
        pendingBatchesRef.current = [];
        return;
      }
      const batches = pendingBatchesRef.current;
      if (batches.length === 0) return;
      pendingBatchesRef.current = [];

      for (const batch of batches) {
        const { frames, streamedTicks, descriptors: batchDescriptors, arrivalMs } = batch;

        // On a resume, drop any re-emitted frame whose tick is already in the
        // accumulator. The resume re-emits the frames since the last checkpoint
        // (the same ones already held and byte-identical), so skipping them by
        // tick avoids duplicating the tail in the accumulator. On a fresh run
        // the accumulator starts empty, so every frame passes through.
        const heldLength = framesRef.current.length;
        const newFrames = fresh ? frames : frames.filter((f) => f.tick >= heldLength);
        if (newFrames.length === 0) continue;

        // Fold any newly-introduced ship descriptors into the live map so the
        // renderer can reconstruct cell positions for this batch's frames. A
        // fresh Map identity makes the descriptors state update reactively; the
        // ref keeps the camera pointer handler current without a render.
        if (batchDescriptors.length > 0) {
          const merged: Map<string, ShipDescriptor> = new Map(descriptorsRef.current);
          for (const d of batchDescriptors) merged.set(d.instanceId, d);
          descriptorsRef.current = merged;
          setDescriptors(merged);
        }

        // Update the measured simulation rate (ticks computed per real second)
        // as an EMA over batch arrivals. The rAF loop uses it to decide how much
        // lead to buffer before resuming playback at the leading edge.
        const prevBatch = lastBatchRef.current;
        if (prevBatch !== null) {
          const dtSeconds = (arrivalMs - prevBatch.timeMs) / 1000;
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
        lastBatchRef.current = { timeMs: arrivalMs, ticks: streamedTicks };

        // Capture the very first streamed frame (the tick-0 deployment snapshot)
        // before appending, so the HP-bar maxima can be taken from it. On a
        // resume `framesRef.current` is non-empty so this is undefined, leaving
        // the existing deployment frame state untouched.
        const firstFrame = framesRef.current.length === 0 ? newFrames[0] : undefined;

        // Append the new frames into the ref the rAF loop reads from. The runner
        // hands us a readonly view; push each frame reference into the
        // accumulator.
        for (const frame of newFrames) {
          framesRef.current.push(frame);
        }

        // Expand the running world extent with this batch's ships and
        // projectiles, growing the camera view as the battle spreads. Folded
        // into the previous bounds state so render reads a reactive value, never
        // the ref. Only emit a fresh object when the extent actually grew, so
        // the bounds memo stays stable across batches that add nothing new.
        setRawBounds((prev) => {
          let minX = prev?.minX ?? Infinity;
          let maxX = prev?.maxX ?? -Infinity;
          let minY = prev?.minY ?? Infinity;
          let maxY = prev?.maxY ?? -Infinity;
          for (const frame of newFrames) {
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
        computedTicksRef.current = streamedTicks;

        if (firstFrame !== undefined) {
          // Capture the tick-0 deployment frame for the HP-bar maxima.
          setDeploymentFrame(firstFrame);
        }

        if (firstBatch) {
          firstBatch = false;
          // Start playback from the top of the fresh battle and hand the stage
          // the full width once the first frames are on screen. Gated on
          // `fresh` (via `firstBatch`'s initial value) so a resume never resets
          // the playback clock or re-fires the setup-panel collapse.
          playbackTimeRef.current = 0;
          onFirstBatch();
        }
      }
    };

    const onFrames = (
      frames: readonly BattleFrame[],
      streamedTicks: number,
      batchDescriptors: readonly ShipDescriptor[],
    ) => {
      // Ignore late batches from a run that has since been superseded.
      if (controller.signal.aborted) return;

      // Stash the batch and schedule a single coalesced rAF to drain the queue.
      // The worker `message` handler task only does this cheap push (plus the
      // resume decorator's synchronous streamedFrames accumulation, which
      // already ran before this callback); the expensive UI accumulation
      // (framesRef push, state mirrors, bounds expansion, EMA) happens in the
      // rAF, off the message task.
      pendingBatchesRef.current.push({
        frames,
        streamedTicks,
        descriptors: batchDescriptors,
        arrivalMs: performance.now(),
      });
      if (rafHandleRef.current === null) {
        rafHandleRef.current = requestAnimationFrame(flushPendingBatches);
      }
    };

    try {
      const battle = await battleRunner.run(
        {
          ships: [...attackers, ...defenders],
          attackerFleetId: attacker.id,
          defenderFleetId: defender.id,
          anomalies: normaliseAnomalies(chosenAnomalies),
          seed: chosenSeed,
          ...(points.size > 0 ? { points } : {}),
        },
        {
          signal: controller.signal,
          onFrames,
          // Overdrive off: start the worker in pausable mode and capture its
          // cooperative pause/resume handle so the route's auto-pacer can hold
          // the sim to the playback playhead. Overdrive on: tight, non-pausable.
          pausable: !overdrive,
          onPacingHandle: overdrive
            ? undefined
            : (handle: PacingHandle) => {
                if (!controller.signal.aborted) pacingHandleRef.current = handle;
              },
        },
      );
      // A superseded run that resolves anyway must not clobber the current one.
      if (controller.signal.aborted) return;
      setResult(battle);
      setComputeStatus("complete");
      // The run is done — drop the pacing handle (the worker is gone).
      pacingHandleRef.current = null;
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
      // An abort is intentional (pause/stop/supersede), not a failure: the
      // caller that aborted has already set the appropriate status ("paused" or
      // the next run's "running"). Do not surface a toast or touch status.
      if (error instanceof BattleAbortError) return;
      setComputeStatus("idle");
      notifications.show({
        title: "Battle failed to compute",
        message: error instanceof Error ? error.message : "The simulation worker did not return a result.",
        color: "red",
      });
    }
  }

  return {
    result,
    frameCount,
    deploymentFrame,
    computedTicks,
    rawBounds,
    activeAnomalies,
    computing,
    paused,
    computeStatus,
    descriptors,
    startBattle,
    pauseComputation,
    resumeComputation,
    holdSim,
    releaseSim,
    computedTicksRef,
  };
}
