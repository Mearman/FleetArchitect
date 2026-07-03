import { notifications } from "@mantine/notifications";
import BattleWorker from "@/domain/simulation/battle.worker?worker";
import { CompositeSimCache } from "@/domain/cache/composite-cache";
import { MemorySimCache } from "@/domain/cache/memory-cache";
import {
  DirectBattleRunner,
  WorkerBattleRunner,
  type BattleRunner,
} from "@/domain/simulation/runner";
import { DexieSimCache } from "@/storage/sim-cache-dexie";
import { DexieCheckpointStore } from "@/storage/checkpoint-store-dexie";
import { checkpointsTable, simCacheMetaTable, simCacheTable } from "@/storage/db";
import { CachingBattleRunner } from "@/ui/cachingBattleRunner";
import { ResumingBattleRunner } from "@/ui/resumingBattleRunner";

/**
 * The inner `BattleRunner`: when the browser supports Web Workers the simulation
 * runs off the main thread (via the Vite `?worker` import); where `Worker` is
 * unavailable it falls back to running on the calling thread. The `?worker`
 * import is confined to this UI module so the domain `runner.ts` stays free of
 * bundler specifics.
 */
const computeRunner: BattleRunner =
  typeof Worker === "undefined"
    ? new DirectBattleRunner()
    : new WorkerBattleRunner(() => new BattleWorker());

/**
 * The resume decorator wraps the compute runner and owns the in-progress
 * checkpoint store. On a run it looks up the latest checkpoint for the matchup
 * and, if found, resumes the engine from there (stitching the checkpoint's
 * preceding frames onto the resumed tail); during compute it persists each
 * captured checkpoint so a later interruption resumes from a recent tick. Sits
 * below the result cache so the resolve order is result-cache hit, then
 * checkpoint resume, then fresh. A persist / delete failure is surfaced via the
 * notifications channel rather than swallowed.
 */
const resumingRunner: BattleRunner = new ResumingBattleRunner(
  computeRunner,
  new DexieCheckpointStore(checkpointsTable()),
  (error) => {
    notifications.show({
      title: "Battle resume checkpoint not persisted",
      message: error.message,
      color: "yellow",
    });
  },
);

/**
 * A two-tier read-through cache: a small in-memory LRU (the session working set)
 * in front of the IndexedDB `simCache` table (durable across reloads). The
 * composite warms memory on a durable hit and writes through both on a store.
 */
const cache = new CompositeSimCache(
  new MemorySimCache(),
  new DexieSimCache(simCacheTable(), simCacheMetaTable()),
);

/**
 * The `BattleRunner` the UI uses: the resume-wrapped Direct/Worker runner
 * wrapped in the read-through result cache. An identical matchup re-run returns
 * its cached result and replays it down the same streaming path; a cache miss
 * with a persisted checkpoint resumes the engine from there; otherwise the
 * battle runs fresh from tick 0. A cache- or checkpoint-write failure is
 * surfaced via the notifications channel rather than swallowed.
 */
export const battleRunner: BattleRunner = new CachingBattleRunner(
  resumingRunner,
  cache,
  (error) => {
    notifications.show({
      title: "Battle result not cached",
      message: error.message,
      color: "yellow",
    });
  },
);
