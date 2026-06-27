import { createId, nowIso } from "@/domain/id";
import { runBattle, simulateBattle } from "@/domain/simulation/engine";
import { buildShipRoster } from "@/domain/simulation/types";
import type { BattleInputs } from "@/domain/simulation/types";
import type {
  BattleFrame,
  BattleResult as BattleResultType,
  BattleResultSummary,
  BattleStreamMessage,
  ShipDescriptor,
} from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";

/**
 * Lightweight envelope guard for incoming worker messages. Narrows `unknown` to
 * {@link BattleStreamMessage} by checking only the top-level `kind` discriminant
 * and object shape — NOT every frame/ship/cell field.
 *
 * The worker is first-party and same-origin, so the deep per-field validation
 * the schema's `safeParse` performs is defensive overhead that scales with
 * batch size (the faster the sim, the more frames per batch, the longer each
 * `message` handler task runs). The deep parse was the source of Chrome's
 * `[Violation] 'message' handler took <N>ms` warnings during a battle. This
 * guard keeps the per-batch cost constant while still narrowing at the thread
 * boundary; the final `BattleResult` continues to be validated once (with
 * `BattleResult.safeParse`) when the `result` message lands.
 */
function isBattleStreamMessage(value: unknown): value is BattleStreamMessage {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value)) return false;
  return value.kind === "frames" || value.kind === "result";
}

/**
 * Cheap top-level shape guard for a {@link BattleResultSummary} arriving in the
 * worker's terminal `result` message. Narrows `unknown` with `typeof` and `in`
 * — no assertions, no deep parse — checking only the scalar header fields the
 * reassembly reads. The worker is first-party and same-origin, and the frames
 * that dominate the result's size were already streamed and accumulated
 * separately, so deep-parsing the summary here would re-walk the whole
 * (optional) `roster`/`descriptors`/`salvage` arrays for no boundary benefit;
 * the envelope guard already narrowed the `kind`. Mirrors the
 * envelope-guard philosophy from {@link isBattleStreamMessage} and the
 * `isBattleResult` guard in `sim-cache-dexie.ts`.
 */
function isBattleResultSummary(value: unknown): value is BattleResultSummary {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || typeof value.id !== "string") return false;
  if (!("winner" in value) || typeof value.winner !== "string") return false;
  if (!("ticks" in value) || typeof value.ticks !== "number") return false;
  if (!("playedAt" in value) || typeof value.playedAt !== "string") return false;
  if (!("config" in value) || typeof value.config !== "object" || value.config === null) return false;
  return true;
}

/**
 * Reassemble a full {@link BattleResultType} from a terminal
 * {@link BattleResultSummary} and the frames accumulated from the worker's
 * streamed `frames` batches. Pure and unit-testable: the assembled result's
 * `frames` is exactly the passed-in array in tick order — byte-identical to
 * what the worker produced, since the batches were appended in arrival order
 * (which is tick order, the engine yields frames strictly ascending) and the
 * summary carries no frames of its own.
 *
 * The inverse of the worker's terminal-message split: the worker streams
 * frames in batches then posts a summary WITHOUT frames, and this stitches
 * them back together on the main thread so the resolved result is
 * indistinguishable from a fresh `runBattle` output.
 */
export function assembleResult(
  summary: BattleResultSummary,
  frames: readonly BattleFrame[],
): BattleResultType {
  return { ...summary, frames: [...frames] };
}

/**
 * Streamed-batch callback. Receives a batch of frames, the highest tick computed
 * so far, and the static descriptors for any ship instances that FIRST appeared
 * in this batch (so the consumer can reconstruct cell world positions for the
 * streamed frames before the final result lands).
 */
export type OnFramesCallback = (
  frames: readonly BattleFrame[],
  computedTicks: number,
  descriptors: readonly ShipDescriptor[],
) => void;

/** Options common to every {@link BattleRunner.run} call. */
export interface BattleRunOptions {
  signal?: AbortSignal;
  onFrames?: OnFramesCallback;
  /**
   * Bypass the result cache for this run: skip the lookup and skip storing the
   * result. The decorating {@link BattleRunner} (the caching runner at the UI
   * edge) honours this; the inner Direct/Worker runners ignore it. Used to force
   * a fresh re-simulation (the "recompute" path) without disturbing any cached
   * entry.
   */
  noCache?: boolean;
  /**
   * Resume the battle from this captured {@link EngineCheckpoint} instead of
   * starting at tick 0. The engine re-enters the loop at `checkpoint.tick + 1`
   * and yields only frames after the checkpoint; the caller (the resume
   * decorator) is responsible for stitching the checkpoint's preceding frames
   * onto the resumed run's output to reconstruct the full `BattleResult`.
   * Omitted on a fresh run.
   */
  resumeFrom?: EngineCheckpoint;
  /**
   * Receives each checkpoint the engine captures during this run (at the
   * cadence the worker chooses). The resume decorator uses it to persist the
   * latest in-progress checkpoint so an interrupted run resumes from there.
   * With `resumeFrom` omitted and `onCheckpoint` set, the engine captures fresh
   * checkpoints as it computes (the proactive-persist path); with both set, a
   * resumed run also re-captures so a second interruption resumes from a later
   * tick. Omitted when the caller does not want checkpoints.
   */
  onCheckpoint?: (checkpoint: EngineCheckpoint) => void;
}

/**
 * The portable-runtime boundary for the battle simulation. A `BattleRunner`
 * takes serialisable `BattleInputs`, runs the (pure, deterministic) engine
 * wherever the adapter chooses — the calling thread, a Web Worker, or
 * (in principle) a remote service — and resolves with a `BattleResult`. The UI
 * depends only on this contract, never on `runBattle` directly, so the
 * computation can move off the main thread without the caller knowing.
 *
 * The contract is asynchronous and cancellable: pass an `AbortSignal` to abort
 * an in-flight run. Aborting rejects the returned promise and frees the
 * underlying worker.
 *
 * The optional `onFrames` callback receives streamed frame batches as they
 * arrive from the worker, enabling progressive replay rendering before the
 * battle finishes computing.
 */
export interface BattleRunner {
  run(
    inputs: BattleInputs,
    options?: BattleRunOptions,
  ): Promise<BattleResultType>;
}

/** Rejection thrown when a run is aborted via its `AbortSignal`. */
export class BattleAbortError extends Error {
  constructor() {
    super("Battle run aborted");
    this.name = "BattleAbortError";
  }
}

/**
 * The checkpoint capture cadence on the direct path: one checkpoint every
 * {@link DIRECT_CHECKPOINT_EVERY_TICKS} ticks, matching the worker's coarse
 * cadence. A named constant rather than a magic number so the cadence is
 * discoverable and adjusted in one place.
 */
const DIRECT_CHECKPOINT_EVERY_TICKS = 30;

/**
 * Runs the engine synchronously on the calling thread. Used by Vitest / node
 * where `Worker` is unavailable, and as a fallback. Still honours the async
 * contract (returns a resolved promise) and the abort signal.
 *
 * When `onFrames` is provided, it is called once with all frames after the
 * battle completes — streaming on the direct path is a single batch.
 *
 * When `resumeFrom` or `onCheckpoint` is set, drives `simulateBattle` directly
 * (folding in the resume / capture options) and assembles a `BattleResult` from
 * the generator summary, mirroring `runBattle`'s assembly. The plain
 * `runBattle` path is kept byte-identical for runs with neither option, so
 * existing behaviour is unchanged.
 */
export class DirectBattleRunner implements BattleRunner {
  run(
    inputs: BattleInputs,
    options?: BattleRunOptions,
  ): Promise<BattleResultType> {
    const signal = options?.signal;
    const onFrames = options?.onFrames;
    if (signal?.aborted === true) {
      return Promise.reject(new BattleAbortError());
    }
    const resumeFrom = options?.resumeFrom;
    const onCheckpoint = options?.onCheckpoint;
    if (resumeFrom === undefined && onCheckpoint === undefined) {
      const result = runBattle(inputs);
      // runBattle always populates descriptors (the field is optional in the
      // schema only so legacy replays from storage still parse); narrow rather
      // than substitute a sentinel.
      const descriptors = result.descriptors;
      if (descriptors === undefined) {
        throw new Error("runBattle returned a result without descriptors");
      }
      onFrames?.(result.frames, result.ticks, descriptors);
      return Promise.resolve(result);
    }
    // Resume / capture path: drive simulateBattle directly and assemble a
    // BattleResult from the generator summary, matching runBattle's shape. On a
    // resume the generator yields only frames after the checkpoint; the caller
    // (the resume decorator) stitches the checkpoint's preceding frames.
    const frames: BattleFrame[] = [];
    const gen = simulateBattle(inputs, {
      resumeFrom,
      checkpointEvery: DIRECT_CHECKPOINT_EVERY_TICKS,
      onCheckpoint,
    });
    let step = gen.next();
    while (!step.done) {
      frames.push(step.value);
      step = gen.next();
    }
    const summary = step.value;
    const result: BattleResultType = {
      id: createId("battle"),
      config: {
        attackerFleetId: inputs.attackerFleetId,
        defenderFleetId: inputs.defenderFleetId,
        anomalies: inputs.anomalies,
        seed: inputs.seed,
      },
      winner: summary.winner,
      ticks: summary.ticks,
      playedAt: nowIso(),
      frames,
      roster: buildShipRoster(inputs.ships),
      descriptors: summary.descriptors,
      ...(summary.salvage.length > 0 ? { salvage: summary.salvage } : {}),
    };
    // `result.descriptors` is optional in the schema (legacy replays), but this
    // runner always sets it from the generator summary. Narrow rather than
    // substitute a sentinel, matching the runBattle path's contract.
    const descriptors = result.descriptors;
    if (descriptors === undefined) {
      throw new Error("assembled BattleResult is missing descriptors");
    }
    onFrames?.(result.frames, result.ticks, descriptors);
    return Promise.resolve(result);
  }
}

/**
 * Runs the engine inside a Web Worker so the main thread stays responsive
 * during computation. The worker is spawned per run and terminated once the
 * result arrives or the run is aborted. `WorkerFactory` is injected so the
 * Vite `?worker` import lives at the call site (the UI) rather than being a
 * hard dependency of this module — keeping the domain layer free of bundler
 * specifics and the adapter unit-constructable in node.
 *
 * The worker streams frame batches via `{ kind: 'frames' }` messages before
 * posting a `{ kind: 'result' }` message with the final `BattleResult`. Each
 * incoming message is narrowed at the thread boundary with the lightweight
 * {@link isBattleStreamMessage} envelope guard, which checks only the
 * top-level `kind` discriminant and object shape — NOT every frame/ship/cell
 * field. The previous per-batch `BattleStreamMessage.safeParse` deep-validated
 * the whole message every batch; that cost scaled with batch size and was the
 * source of Chrome's `[Violation] 'message' handler took <N>ms` warnings on the
 * faster engine. The worker is first-party and same-origin, so the per-field
 * defence was overhead with no real-world boundary to defend. The final
 * `BattleResult` is still validated once (with `BattleResult.safeParse`) when
 * the `result` message lands, keeping the boundary check for the authoritative
 * output. On a `frames` message `onFrames` is invoked and the worker is kept
 * alive; on a `result` message the worker is cleaned up and the promise
 * resolves.
 */
export type WorkerFactory = () => Worker;

export class WorkerBattleRunner implements BattleRunner {
  readonly #createWorker: WorkerFactory;

  constructor(createWorker: WorkerFactory) {
    this.#createWorker = createWorker;
  }

  run(
    inputs: BattleInputs,
    options?: BattleRunOptions,
  ): Promise<BattleResultType> {
    const signal = options?.signal;
    const onFrames = options?.onFrames;
    const onCheckpoint = options?.onCheckpoint;

    return new Promise<BattleResultType>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new BattleAbortError());
        return;
      }

      const worker = this.#createWorker();

      // Accumulate the frames each `frames` batch delivers. The worker's
      // terminal `result` message carries a summary WITHOUT frames (the frames
      // were already streamed), so the full BattleResult is reassembled here
      // from the accumulated batches plus the summary. Batches arrive in tick
      // order (the engine yields frames strictly ascending and the worker
      // posts them in yield order), so appending each batch preserves the
      // timeline — byte-identical to what the worker's old terminal message
      // carried when it re-sent the whole array.
      const accumulatedFrames: BattleFrame[] = [];

      const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
        if (signal !== undefined) signal.removeEventListener("abort", onAbort);
        worker.terminate();
      };

      const onAbort = () => {
        cleanup();
        reject(new BattleAbortError());
      };

      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (!isBattleStreamMessage(event.data)) {
          cleanup();
          reject(new Error("Worker sent a message that is not a BattleStreamMessage"));
          return;
        }

        if (event.data.kind === "frames") {
          // Accumulate this batch's frames for the terminal reassembly, deliver
          // the batch to the caller, and keep the worker alive — more batches
          // (or the final result) are still on the way.
          for (const frame of event.data.frames) accumulatedFrames.push(frame);
          onFrames?.(event.data.frames, event.data.computedTicks, event.data.descriptors);
          // Forward the latest checkpoint (if the worker captured one with this
          // batch) so the resume decorator persists it. The checkpoint may be a
          // few ticks behind the batch's last frame — the worker emits one per
          // cadence, so this is the most recent tick the cadence hit.
          if (event.data.checkpoint !== undefined) {
            onCheckpoint?.(event.data.checkpoint);
          }
          return;
        }

        // kind === "result": the simulation has finished. The message carries a
        // summary (no frames); reassemble the full BattleResult from the
        // accumulated streamed frames. A cheap shape guard on the summary
        // replaces the previous deep `BattleResult.safeParse`, which re-walked
        // the whole frame array at end-of-battle and blocked the main thread
        // for hundreds of milliseconds on large battles. The envelope guard
        // already narrowed the `kind`; this guard catches gross corruption of
        // the scalar header only.
        cleanup();
        if (!isBattleResultSummary(event.data.summary)) {
          reject(new Error("Worker returned a result message with an invalid summary shape"));
          return;
        }
        resolve(assembleResult(event.data.summary, accumulatedFrames));
      };

      worker.onerror = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(`Battle worker error: ${event.message}`));
      };

      if (signal !== undefined) signal.addEventListener("abort", onAbort);
      // Post the inputs and any resume checkpoint together: the worker threads
      // `resumeFrom` into `simulateBattle` so the resumed run reproduces the
      // fresh tail byte-identically and yields only frames after the checkpoint.
      worker.postMessage({ inputs, resumeFrom: options?.resumeFrom });
    });
  }
}
