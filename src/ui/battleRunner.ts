import BattleWorker from "@/domain/simulation/battle.worker?worker";
import {
  DirectBattleRunner,
  WorkerBattleRunner,
  type BattleRunner,
} from "@/domain/simulation/runner";

/**
 * The `BattleRunner` the UI uses. When the browser supports Web Workers the
 * simulation runs off the main thread (via the Vite `?worker` import); where
 * `Worker` is unavailable it falls back to running on the calling thread. The
 * `?worker` import is confined to this UI module so the domain `runner.ts`
 * stays free of bundler specifics.
 */
export const battleRunner: BattleRunner =
  typeof Worker === "undefined"
    ? new DirectBattleRunner()
    : new WorkerBattleRunner(() => new BattleWorker());
