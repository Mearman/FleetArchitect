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
import { simCacheTable } from "@/storage/db";
import { CachingBattleRunner } from "@/ui/cachingBattleRunner";

/**
 * The inner `BattleRunner`: when the browser supports Web Workers the simulation
 * runs off the main thread (via the Vite `?worker` import); where `Worker` is
 * unavailable it falls back to running on the calling thread. The `?worker`
 * import is confined to this UI module so the domain `runner.ts` stays free of
 * bundler specifics.
 */
const innerRunner: BattleRunner =
  typeof Worker === "undefined"
    ? new DirectBattleRunner()
    : new WorkerBattleRunner(() => new BattleWorker());

/**
 * A two-tier read-through cache: a small in-memory LRU (the session working set)
 * in front of the IndexedDB `simCache` table (durable across reloads). The
 * composite warms memory on a durable hit and writes through both on a store.
 */
const cache = new CompositeSimCache(
  new MemorySimCache(),
  new DexieSimCache(simCacheTable()),
);

/**
 * The `BattleRunner` the UI uses: the Direct/Worker runner wrapped in the
 * read-through result cache. An identical matchup re-run returns its cached
 * result and replays it down the same streaming path; a cache miss runs the
 * inner runner and stores the result. A cache-write failure is surfaced via the
 * notifications channel rather than swallowed.
 */
export const battleRunner: BattleRunner = new CachingBattleRunner(
  innerRunner,
  cache,
  (error) => {
    notifications.show({
      title: "Battle result not cached",
      message: error.message,
      color: "yellow",
    });
  },
);
