import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs } from "@/domain/simulation/types";
import { BattleResult } from "@/schema/battle";
import type { BattleResult as BattleResultType } from "@/schema/battle";

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
 */
export interface BattleRunner {
  run(inputs: BattleInputs, signal?: AbortSignal): Promise<BattleResultType>;
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
 */
export class DirectBattleRunner implements BattleRunner {
  run(inputs: BattleInputs, signal?: AbortSignal): Promise<BattleResultType> {
    if (signal?.aborted === true) {
      return Promise.reject(new BattleAbortError());
    }
    return Promise.resolve(runBattle(inputs));
  }
}

/**
 * Runs the engine inside a Web Worker so the main thread stays responsive
 * during computation. The worker is spawned per run and terminated once the
 * result arrives or the run is aborted. `WorkerFactory` is injected so the
 * Vite `?worker` import lives at the call site (the UI) rather than being a
 * hard dependency of this module — keeping the domain layer free of bundler
 * specifics and the adapter unit-constructable in node.
 */
export type WorkerFactory = () => Worker;

export class WorkerBattleRunner implements BattleRunner {
  readonly #createWorker: WorkerFactory;

  constructor(createWorker: WorkerFactory) {
    this.#createWorker = createWorker;
  }

  run(inputs: BattleInputs, signal?: AbortSignal): Promise<BattleResultType> {
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
        const parsed = BattleResult.safeParse(event.data);
        cleanup();
        if (parsed.success) {
          resolve(parsed.data);
        } else {
          reject(new Error(`Worker returned an invalid BattleResult: ${parsed.error.message}`));
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
