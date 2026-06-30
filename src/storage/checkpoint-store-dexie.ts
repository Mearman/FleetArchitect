import type { Table } from "dexie";
import type { BattleFrame } from "@/schema/battle";
import { EngineCheckpoint } from "@/schema/checkpoint";
import type { CheckpointStore } from "@/domain/cache/checkpoint-store";
import type { CheckpointRecord } from "@/storage/db";
import { isUncloneable } from "@/storage/idb-errors";

/**
 * The in-browser durable tier of the in-progress-run resume store: an IndexedDB
 * adapter over the `checkpoints` Dexie table (see `db.ts`, `version(6)`). One
 * latest checkpoint per content key (overwrite on `put`); `delete` removes it
 * once the complete result is cached by the result-cache tier and the
 * in-progress state is subsumed.
 *
 * Dexie / IndexedDB uses structured clone across the thread boundary, so the
 * checkpoint's `-Infinity` / `-0` fields (a ship that has never fired carries
 * `lastFiredTick = -Infinity`) survive exactly — the reason this store never
 * goes through JSON.
 *
 * On read, `EngineCheckpoint.safeParse` is the shape-drift guard: a stored
 * checkpoint whose schema no longer matches (after a version bump) is a miss,
 * never silently mis-read. The stale row is evicted so it is not re-read on
 * every lookup, mirroring `DexieSimCache`'s corrupt-record handling.
 *
 * `preFrames` grows with the battle, and on a long battle (the heaviest preset
 * pair runs ~1731 ticks) it can exceed what the structured clone can handle:
 * `table.put` throws `DataCloneError`. That is a CAPACITY BOUNDARY, not a bug
 * — the resume feature is an optimisation, never a correctness path. The put
 * is skipped and any stale row for the key is cleared, so a later interruption
 * resumes from a fresh recompute instead of reading a partial/old checkpoint.
 * Every other failure (a real Dexie error) propagates unchanged — the resume
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
    try {
      await this.table.put(record);
    } catch (error) {
      // A too-large-to-clone checkpoint is a capacity boundary, not a bug — the
      // resume feature is an optimisation, never a correctness path. Drop any
      // stale row for the key so a later resume does not read a partial/old
      // checkpoint, then return (skip the persist) instead of throwing. The
      // next interruption resumes from scratch, the same fallback as no stored
      // checkpoint at all. Any other error propagates to the resume decorator's
      // notifier unchanged.
      if (!isUncloneable(error)) throw error;
      await this.table.delete(key);
    }
  }

  async delete(key: string): Promise<void> {
    await this.table.delete(key);
  }
}
