import type { Table } from "dexie";
import type { BattleFrame } from "@/schema/battle";
import { EngineCheckpoint } from "@/schema/checkpoint";
import type { CheckpointStore } from "@/domain/cache/checkpoint-store";
import type { CheckpointDeltaRecord } from "@/storage/db";
import { isUncloneable } from "@/storage/idb-errors";
import { estimateCheckpointBytes } from "@/storage/sim-cache-dexie";

/**
 * The in-browser durable tier of the in-progress-run resume store: an IndexedDB
 * adapter over the `checkpoints` Dexie table (see `db.ts`, `version(9)`). A run
 * is stored as an ORDERED SEQUENCE of delta rows keyed `[key+seq]` — one row per
 * checkpoint capture, each carrying only the frames NEW since the previous
 * delta — so a capture structured-clones the ~30 new frames rather than the
 * whole growing history. The old monolithic shape (one overwrite-per-key holding
 * the full `preFrames`) was O(T²) in clone cost over a run; the delta shape is
 * O(T) total. {@link get} concatenates the deltas in `seq` order and takes the
 * latest delta's checkpoint as the resume point; {@link put} appends one delta.
 *
 * Dexie / IndexedDB uses structured clone across the thread boundary, so the
 * checkpoint's `-Infinity` / `-0` fields (a ship that has never fired carries
 * `lastFiredTick = -Infinity`) survive exactly — the reason this store never
 * goes through JSON.
 *
 * On read, `EngineCheckpoint.safeParse` of the LATEST delta's checkpoint is the
 * shape-drift guard: a stored checkpoint whose schema no longer matches (after
 * a version bump) is a miss, never silently mis-read. All deltas for the key
 * are evicted so they are not re-read on every lookup, mirroring `DexieSimCache`'s
 * corrupt-record handling.
 *
 * Because each delta is small (one capture's worth of frames, not the whole
 * history), the monolithic-shape capacity boundary — `table.put` throwing
 * `DataCloneError` once `preFrames` outgrew the structured clone — is largely
 * eliminated. A `DataCloneError` now would indicate a single enormous frame, not
 * an accumulated history; it is still treated as a capacity boundary (the resume
 * feature is an optimisation, never a correctness path): all deltas for the key
 * are cleared and the put is skipped, so a later interruption resumes from a
 * fresh recompute. Every other failure (a real Dexie error) propagates unchanged.
 *
 * The per-put append is wrapped in a readwrite Dexie transaction over the
 * `checkpoints` store: IndexedDB serialises readwrite transactions on a store,
 * so two fire-and-forget puts for the same key (checkpoints fire every 30 ticks,
 * each `void store.put(...)`) cannot interleave their read-existing / compute-delta
 * / write — the second transaction starts only after the first commits, sees the
 * first's new delta, and computes the correct next `seq` and frame offset. No
 * shared mutable seq counter, no collision, no gaps.
 *
 * Eviction is bounded on TWO axes (mirroring `DexieSimCache`), both checked
 * after every `put`: a total-bytes budget and an entry-count cap keyed on
 * MATCHUP (the content `key`), not on individual delta rows. Without it every
 * distinct matchup accumulates delta rows that are only removed once the run
 * completes, so abandoned battles accumulate without bound. The oldest matchups
 * by `updatedAt` are removed (all their deltas) until both bounds hold, ranked
 * from an in-memory `{ key → { bytes, lastAccess } }` mirror so eviction never
 * structured-clones a delta just to total sizes.
 */

/** 64 MiB: a generous in-browser footprint for in-progress checkpoints (a
 *  quarter of the result cache's budget — checkpoints are a resume hint, not a
 *  canonical record). */
export const DEFAULT_CHECKPOINT_BYTES_BUDGET = 64 * 1024 * 1024;

/** Entry-count guard: one matchup (content key) accumulates a row per capture
 *  otherwise, so this caps the number of DISTINCT matchups retained. */
export const DEFAULT_CHECKPOINT_MAX_ENTRIES = 16;

interface CheckpointEntryMeta {
  bytes: number;
  lastAccess: number;
}

export class DexieCheckpointStore implements CheckpointStore {
  // In-memory mirror of each matchup's { bytes, lastAccess }, so eviction can
  // rank and bound entries without structured-cloning every delta on each write.
  // Built once (lazily, inside the first `put` that evicts) and kept in sync.
  // `bytes` is the SUM of all delta rows for the key.
  #meta: Map<string, CheckpointEntryMeta> | null = null;

  constructor(
    private readonly table: Table<CheckpointDeltaRecord, [string, number]>,
    private readonly maxBytes: number = DEFAULT_CHECKPOINT_BYTES_BUDGET,
    private readonly maxEntries: number = DEFAULT_CHECKPOINT_MAX_ENTRIES,
  ) {}

  /**
   * Populate {@link #meta} from the table on first use and return it. Runs once
   * per instance. Aggregates every delta row by `key` so eviction ranks MATCHUPS
   * (not rows): `bytes` is the sum of the key's delta sizes, `lastAccess` the
   * newest `updatedAt` among them.
   */
  async #ensureMeta(): Promise<Map<string, CheckpointEntryMeta>> {
    if (this.#meta !== null) return this.#meta;
    const rows = await this.table.toArray();
    const meta = new Map<string, CheckpointEntryMeta>();
    for (const row of rows) {
      const existing = meta.get(row.key);
      if (existing === undefined) {
        meta.set(row.key, { bytes: row.bytes, lastAccess: row.updatedAt });
      } else {
        existing.bytes += row.bytes;
        if (row.updatedAt > existing.lastAccess) existing.lastAccess = row.updatedAt;
      }
    }
    this.#meta = meta;
    return meta;
  }

  async get(
    key: string,
  ): Promise<
    { checkpoint: EngineCheckpoint; preFrames: BattleFrame[] } | undefined
  > {
    // Read every delta for the matchup in seq order and reassemble: concatenate
    // the delta frames to reconstruct the full 0..checkpoint.tick prefix, take
    // the latest delta's checkpoint as the resume point.
    const rows = await this.table.where("key").equals(key).sortBy("seq");
    if (rows.length === 0) return undefined;
    const latest = rows[rows.length - 1];
    if (latest === undefined) return undefined;
    const parsed = EngineCheckpoint.safeParse(latest.checkpoint);
    if (!parsed.success) {
      // Shape drift: the stored checkpoint no longer matches the schema. Treat
      // it as a miss and evict every delta for the key so they are not re-read
      // on every lookup, exactly as `DexieSimCache` does for a corrupt result.
      await this.#deleteKey(key);
      return undefined;
    }
    const preFrames: BattleFrame[] = [];
    for (const row of rows) {
      for (const frame of row.deltaFrames) preFrames.push(frame);
    }
    return {
      checkpoint: parsed.data,
      preFrames,
    };
  }

  async put(
    key: string,
    checkpoint: EngineCheckpoint,
    preFrames: BattleFrame[],
  ): Promise<void> {
    // The append is a readwrite transaction over `checkpoints`: IndexedDB
    // serialises readwrite transactions on a store, so concurrent fire-and-forget
    // puts for the same key cannot interleave their read / compute / write. The
    // delta is ONLY the frames new since the previously stored total (preFrames
    // is a strict prefix-extension across captures: each capture's preFrames
    // supersedes the prior as frames 0..checkpoint.tick grow).
    let writtenBytes = 0;
    try {
      await this.table.db.transaction("rw", this.table, async () => {
        const rows = await this.table.where("key").equals(key).sortBy("seq");
        let frameCount = 0;
        for (const row of rows) frameCount += row.deltaFrames.length;
        const seq = seqPlus(rows[rows.length - 1]);
        const delta = preFrames.slice(frameCount);
        const bytes = estimateCheckpointBytes(checkpoint, delta);
        writtenBytes = bytes;
        await this.table.put({
          key,
          seq,
          checkpoint,
          deltaFrames: delta,
          updatedAt: Date.now(),
          bytes,
        });
      });
    } catch (error) {
      // A too-large-to-clone delta is a capacity boundary, not a bug — the
      // resume feature is an optimisation, never a correctness path. Drop every
      // delta for the key so a later resume does not read a partial set, then
      // return (skip the persist) instead of throwing. The next interruption
      // resumes from scratch, the same fallback as no stored checkpoint. Any
      // other error propagates to the resume decorator's notifier unchanged.
      if (!isUncloneable(error)) throw error;
      await this.#deleteKey(key);
      return;
    }
    const meta = await this.#ensureMeta();
    const existing = meta.get(key);
    meta.set(key, {
      bytes: (existing?.bytes ?? 0) + writtenBytes,
      lastAccess: Date.now(),
    });
    await this.#evict(meta);
  }

  async delete(key: string): Promise<void> {
    await this.#deleteKey(key);
  }

  /**
   * Delete every delta row for `key` and drop it from the in-memory mirror.
   * Used by {@link delete}, by the corrupt-checkpoint / capacity-boundary paths,
   * and by eviction. Optional `meta` avoids a redundant {@link #ensureMeta} when
   * the caller already holds it.
   */
  async #deleteKey(
    key: string,
    meta?: Map<string, CheckpointEntryMeta>,
  ): Promise<void> {
    await this.table.where("key").equals(key).delete();
    const m = meta ?? (await this.#ensureMeta());
    m.delete(key);
  }

  /**
   * Evict the oldest-`lastAccess` MATCHUPS (all their delta rows) until both the
   * byte budget and the entry-count cap hold. Ranks and bounds from the in-memory
   * {@link #meta} mirror, deleting each evicted key's deltas in one indexed
   * delete, so no delta is structured-cloned just to compute the running totals.
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
      await this.table.where("key").equals(k).delete();
      meta.delete(k);
      totalBytes -= m.bytes;
      count -= 1;
    }
  }
}

/**
 * The sequence number for a new delta given the current latest (`last` is the
 * highest-seq delta, or undefined when the matchup has no deltas yet). Returns
 * `last.seq + 1`, or 0 for the first delta. `noUncheckedIndexedAccess` types the
 * last element of a `sortBy` result as possibly undefined; this helper absorbs
 * that without a fallback value at the call site.
 */
function seqPlus(last: CheckpointDeltaRecord | undefined): number {
  return last === undefined ? 0 : last.seq + 1;
}
