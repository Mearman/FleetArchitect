import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs } from "@/domain/simulation/types";
import { BattleResult, BattleStreamMessage } from "@/schema/battle";
import type {
  BattleFrame,
  BattleResult as BattleResultType,
  ShipDescriptor,
} from "@/schema/battle";

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
 * Runs the engine synchronously on the calling thread. Used by Vitest / node
 * where `Worker` is unavailable, and as a fallback. Still honours the async
 * contract (returns a resolved promise) and the abort signal.
 *
 * When `onFrames` is provided, it is called once with all frames after the
 * battle completes — streaming on the direct path is a single batch.
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
 * incoming message is validated with `BattleStreamMessage.safeParse` at the
 * thread boundary. On a `frames` message `onFrames` is invoked and the worker
 * is kept alive; on a `result` message the worker is cleaned up and the
 * promise resolves.
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

    return new Promise<BattleResultType>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new BattleAbortError());
        return;
      }

      const worker = this.#createWorker();

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
        const parsed = BattleStreamMessage.safeParse(event.data);
        if (!parsed.success) {
          cleanup();
          reject(new Error(`Worker sent an invalid BattleStreamMessage: ${parsed.error.message}`));
          return;
        }

        if (parsed.data.kind === "frames") {
          // Deliver the batch to the caller and keep the worker alive — more
          // batches (or the final result) are still on the way.
          onFrames?.(parsed.data.frames, parsed.data.computedTicks, parsed.data.descriptors);
          return;
        }

        // kind === "result": the simulation has finished — clean up and resolve.
        // Re-parse the embedded result through BattleResult to narrow to the
        // correct type; BattleStreamMessage already validated the shape, so
        // this parse will always succeed.
        const resultParsed = BattleResult.safeParse(parsed.data.result);
        cleanup();
        if (resultParsed.success) {
          resolve(resultParsed.data);
        } else {
          reject(new Error(`Worker returned an invalid BattleResult: ${resultParsed.error.message}`));
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(`Battle worker error: ${event.message}`));
      };

      if (signal !== undefined) signal.addEventListener("abort", onAbort);
      worker.postMessage(inputs);
    });
  }
}
