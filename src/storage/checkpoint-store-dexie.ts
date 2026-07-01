import type { Table } from "dexie";
import type { BattleFrame } from "@/schema/battle";
import { EngineCheckpoint } from "@/schema/checkpoint";
import type { CheckpointStore } from "@/domain/cache/checkpoint-store";
import type { CheckpointRecord } from "@/storage/db";
import { isUncloneable } from "@/storage/idb-errors";
import { estimateCheckpointBytes } from "@/storage/sim-cache-dexie";

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
 *
 * Eviction is bounded on TWO axes (mirroring `DexieSimCache`), both checked
 * after every `put`: a total-bytes budget and an entry-count cap. Without it
 * every distinct matchup adds a row that is only removed once the run completes
 * (or is subsumed), so abandoned / interrupted battles accumulate without
 * bound to quota exhaustion. The oldest rows by `updatedAt` are removed until
 * both bounds hold, ranked from an in-memory `{ key → { bytes, lastAccess } }`
 * mirror so eviction never structured-clones a checkpoint just to total sizes.
 */

/** 64 MiB: a generous in-browser footprint for in-progress checkpoints (a
 *  quarter of the result cache's budget — checkpoints are a resume hint, not a
 *  canonical record). */
export const DEFAULT_CHECKPOINT_BYTES_BUDGET = 64 * 1024 * 1024;

/** Entry-count guard: one row per distinct matchup accumulates otherwise. */
export const DEFAULT_CHECKPOINT_MAX_ENTRIES = 16;

interface CheckpointEntryMeta {
  bytes: number;
  lastAccess: number;
}

export class DexieCheckpointStore implements CheckpointStore {
  // In-memory mirror of every row's { bytes, lastAccess }, so eviction can rank
  // and bound entries without structured-cloning every checkpoint on each write.
  // Built once (lazily, inside the first `put` that evicts) and kept in sync.
  #meta: Map<string, CheckpointEntryMeta> | null = null;

  constructor(
    private readonly table: Table<CheckpointRecord, string>,
    private readonly maxBytes: number = DEFAULT_CHECKPOINT_BYTES_BUDGET,
    private readonly maxEntries: number = DEFAULT_CHECKPOINT_MAX_ENTRIES,
  ) {}

  /**
   * Populate {@link #meta} from the table on first use and return it. Runs once
   * per instance. Legacy rows written before the `bytes` field existed count as
   * 0 bytes — the entry-count cap still bounds them.
   */
  async #ensureMeta(): Promise<Map<string, CheckpointEntryMeta>> {
    if (this.#meta !== null) return this.#meta;
    const rows = await this.table.toArray();
    const meta = new Map<string, CheckpointEntryMeta>();
    for (const row of rows) {
      meta.set(row.key, { bytes: row.bytes ?? 0, lastAccess: row.updatedAt });
    }
    this.#meta = meta;
    return meta;
  }

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
      if (this.#meta !== null) this.#meta.delete(key);
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
    const bytes = estimateCheckpointBytes(checkpoint, preFrames);
    const updatedAt = Date.now();
    const record: CheckpointRecord = {
      key,
      checkpoint,
      preFrames,
      updatedAt,
      bytes,
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
      if (this.#meta !== null) this.#meta.delete(key);
      return;
    }
    const meta = await this.#ensureMeta();
    meta.set(key, { bytes, lastAccess: updatedAt });
    await this.#evict(meta);
  }

  async delete(key: string): Promise<void> {
    await this.table.delete(key);
    if (this.#meta !== null) this.#meta.delete(key);
  }

  /**
   * Evict the oldest-`lastAccess` rows until both the byte budget and the
   * entry-count cap hold. Ranks and bounds from the in-memory {@link #meta}
   * mirror, deleting oldest-first, so no checkpoint is structured-cloned just
   * to compute the running totals.
   */
  async #evict(meta: Map<string, CheckpointEntryMeta>): Promise<void> {
    const ordered = Array.from(meta.entries()).sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess,
    );
    let totalBytes = 0;
    for (const [, m] of ordered) totalBytes += m.bytes;
    let count = ordered.length;
    for (const [k, m] of ordered) {
      if (totalBytes <= this.maxBytes && count <= this.maxEntries) break;
      await this.table.delete(k);
      meta.delete(k);
      totalBytes -= m.bytes;
      count -= 1;
    }
  }
}
