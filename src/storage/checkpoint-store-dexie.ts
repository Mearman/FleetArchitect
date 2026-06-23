import type { Table } from "dexie";
import type { BattleFrame } from "@/schema/battle";
import { EngineCheckpoint } from "@/schema/checkpoint";
import type { CheckpointStore } from "@/domain/cache/checkpoint-store";
import type { CheckpointRecord } from "@/storage/db";

/**
 * The in-browser durable tier of the in-progress-run resume store: an IndexedDB
 * adapter over the `checkpoints` Dexie table (see `db.ts`, `version(6)`). One
 * latest checkpoint per content key (overwrite on `put`); `delete` removes it
 * once the complete result is cached by the result-cache tier and the
 * in-progress state is subsumed.
 *
 * Dexie / IndexedDB uses structured clone across the thread boundary, so the
 * checkpoint's `±Infinity` / `-0` fields (a ship that has never fired carries
 * `lastFiredTick = -Infinity`; the stalemate watch's all-time lows begin at
 * `+Infinity`) survive exactly — the reason this store never goes through JSON.
 *
 * On read, `EngineCheckpoint.safeParse` is the shape-drift guard: a stored
 * checkpoint whose schema no longer matches (after a version bump) is a miss,
 * never silently mis-read. The stale row is evicted so it is not re-read on
 * every lookup, mirroring `DexieSimCache`'s corrupt-record handling. Every
 * other failure (a real Dexie error) propagates unchanged — the resume
 * decorator surfaces it via the injected notifier rather than masking it.
 */
export class DexieCheckpointStore implements CheckpointStore {
  constructor(private readonly table: Table<CheckpointRecord, string>) {}

  async get(
    key: string,
  ): Promise<
    { checkpoint: EngineCheckpoint; preFrames: BattleFrame[] } | undefined
  > {
    const record = await this.table.get(key);
    if (record === undefined) return undefined;
    const parsed = EngineCheckpoint.safeParse(record.checkpoint);
    if (!parsed.success) {
      // Shape drift: the stored checkpoint no longer matches the schema. Treat
      // it as a miss and evict the stale row so it is not re-read on every
      // lookup, exactly as `DexieSimCache` does for a corrupt cached result.
      await this.table.delete(key);
      return undefined;
    }
    return {
      checkpoint: parsed.data,
      preFrames: record.preFrames,
    };
  }

  async put(
    key: string,
    checkpoint: EngineCheckpoint,
    preFrames: BattleFrame[],
  ): Promise<void> {
    const record: CheckpointRecord = {
      key,
      checkpoint,
      preFrames,
      updatedAt: Date.now(),
    };
    await this.table.put(record);
  }

  async delete(key: string): Promise<void> {
    await this.table.delete(key);
  }
}
