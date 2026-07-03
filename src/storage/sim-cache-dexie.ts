import type { Table } from "dexie";
import { isBattleResult, type BattleFrame, type BattleResult } from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import type { SimCache } from "@/domain/cache/contract";
import type { SimCacheMetaRecord, SimCacheRecord } from "@/storage/db";
import { isQuotaExceeded, isUncloneable } from "@/storage/idb-errors";

/**
 * The in-browser durable tier of the deterministic result cache: an IndexedDB
 * adapter over the `simCache` Dexie table (see `db.ts`, `version(5)`) and its
 * lightweight eviction-metadata mirror `simCacheMeta` (added in `version(10)`).
 * It mirrors the on-disk `DiskSimCache` for node tests — same `SimCache` contract,
 * same LRU + budget eviction policy — but persists across browser reloads instead
 * of across `pnpm test` runs.
 *
 * The table is SEPARATE from the write-only `battles` history: that table records
 * every play keyed by random id and is never read back, whereas this one is a
 * memoisation tier addressed by content hash. A cache hit here returns a stored
 * `BattleResult` instead of re-simulating.
 *
 * Eviction is bounded on TWO axes, both checked after every `set`:
 *  - a total-bytes budget ({@link DEFAULT_DEXIE_BYTES_BUDGET}) — results are large,
 *    so the byte budget caps the IndexedDB footprint; and
 *  - an entry-count cap ({@link DEFAULT_DEXIE_MAX_ENTRIES}) — a guard against an
 *    unbounded count of tiny results.
 * The oldest entries by `lastAccess` are removed until both bounds hold.
 *
 * Sizing and eviction are designed to stay off the playback rAF:
 *  - {@link estimateResultBytes} sums the typed-array buffer lengths across the
 *    frame graph plus a coarse per-entity scalar. It is a stable, monotonic proxy
 *    for on-disk size — never a `JSON.stringify` of the whole result, which for a
 *    multi-hundred-MB battle blocked the IDB `success` handler for hundreds of ms
 *    and risked a string-limit `RangeError`.
 *  - {@link DexieSimCache.evict} ranks and deletes from an in-memory
 *    `{ key → { bytes, lastAccess } }` mirror, not from a fresh
 *    `orderBy("lastAccess").toArray()` — that call structured-cloned EVERY cached
 *    result on every `set`, the dominant cost of the old write path. The mirror is
 *    rebuilt once (lazily, inside the deferred `set`) from the `simCacheMeta`
 *    table, which holds only three scalars per entry (no `result` payload), and is
 *    kept in sync thereafter.
 *  - the `put` + `evict` run via `requestIdleCallback` so even the structured-clone
 *    `put` of a large result never blocks the animation frame.
 *  - every `put` / `delete` writes BOTH the `simCache` and `simCacheMeta` tables
 *    in a single readwrite transaction, so the metadata mirror never drifts from
 *    the result rows.
 *
 * A `get` bumps the hit entry's `lastAccess` for LRU recency. The bump is
 * fire-and-forget: it must not delay returning the result and a failure to record
 * recency is not a reason to fail the read (the result is already in hand). It is
 * the ONLY swallow in this adapter, and it is deliberate — recency bookkeeping,
 * not the data path. Every other failure (quota on `set`, a corrupt record)
 * surfaces.
 */

/** 256 MiB: a generous in-browser footprint that still bounds the object store. */
export const DEFAULT_DEXIE_BYTES_BUDGET = 256 * 1024 * 1024;

/** Entry-count guard against an unbounded number of small cached results. */
export const DEFAULT_DEXIE_MAX_ENTRIES = 64;

/** Base size of the result envelope (id, config, winner, …) — the cloned
 *  plain-object fields present even for a 0-frame recorded battle, so the
 *  estimate is always positive. */
const RESULT_OVERHEAD_BYTES = 512;
/** Per-frame / per-entity scalar overhead for the structured-cloned plain-object
 *  portion (positions, velocities, beam/pod records). A coarse but stable,
 *  monotonic add-on so the byte budget also responds to frame/entity count, not
 *  only to the binary cell + resource buffers that dominate the size. */
const FRAME_OVERHEAD_BYTES = 256;
const SHIP_OVERHEAD_BYTES = 128;
const PROJECTILE_OVERHEAD_BYTES = 32;

function isTypedArrayView(value: unknown): value is ArrayBufferView {
  return (
    typeof value === "object" &&
    value !== null &&
    ArrayBuffer.isView(value) &&
    !(value instanceof DataView)
  );
}

/** The byte length of `value` when it is a typed-array view, else 0. */
function typedBytes(value: unknown): number {
  return isTypedArrayView(value) ? value.byteLength : 0;
}

/**
 * A stable, monotonic size estimate for a {@link BattleResult}: the sum of every
 * typed-array buffer length in the frame graph (the cell state, resource, and
 * medium arrays — the dominant, deterministic component of a result's size) plus
 * a coarse per-frame / per-ship / per-projectile scalar for the cloned
 * plain-object portion.
 *
 * It never serialises the result, so it cannot hit the V8 string limit (the old
 * `JSON.stringify`-based estimate's `RangeError` failure mode is gone) and it runs
 * in time proportional to the frame count rather than the serialised byte count.
 * The eviction contract only requires a stable, monotonic proxy — it need not
 * equal the exact IndexedDB on-disk size, which the structured-clone format does
 * not expose.
 */
export function estimateResultBytes(result: BattleResult): number {
  return RESULT_OVERHEAD_BYTES + estimateFramesBytes(result.frames);
}

/** Stable, monotonic size estimate for a sequence of {@link BattleFrame}s: the
 *  typed-array buffer lengths (cell/resource/medium state) plus a coarse
 *  per-frame / per-ship / per-projectile scalar. Shared by the result cache
 *  (over a BattleResult's frames) and the checkpoint store (over a resume
 *  checkpoint's pre-frames, the dominant component of its size). Never
 *  serialises — same no-RangeError property as {@link estimateResultBytes}. */
export function estimateFramesBytes(frames: readonly BattleFrame[]): number {
  let total = 0;
  for (const frame of frames) {
    total += FRAME_OVERHEAD_BYTES;
    for (const ship of frame.ships) {
      total += SHIP_OVERHEAD_BYTES;
      const cells = ship.cells;
      if (cells !== undefined) {
        for (const value of Object.values(cells)) total += typedBytes(value);
      }
      const resource = ship.resource;
      if (resource !== undefined) {
        for (const value of Object.values(resource)) total += typedBytes(value);
      }
    }
    const medium = frame.medium;
    if (medium !== undefined) {
      total += typedBytes(medium.rho);
      total += typedBytes(medium.eps);
    }
    total += frame.projectiles.length * PROJECTILE_OVERHEAD_BYTES;
  }
  return total;
}

/** Coarse envelope for the checkpoint object itself (version, rng, counters,
 *  deployment): the plain-object fields present even for a 0-pre-frame
 *  checkpoint, so the estimate is always positive. */
const CHECKPOINT_OVERHEAD_BYTES = 1024;

/** Stable, monotonic size estimate for a resume checkpoint: the per-frame sum
 *  over its `preFrames` (the dominant component — the full frame history up to
 *  the checkpoint tick) plus a coarse scalar for the live ship/projectile
 *  snapshot and the medium field. Used by {@link DexieCheckpointStore}'s
 *  byte-budget eviction; never serialises the checkpoint. */
export function estimateCheckpointBytes(
  checkpoint: EngineCheckpoint,
  preFrames: readonly BattleFrame[],
): number {
  let total = CHECKPOINT_OVERHEAD_BYTES;
  total += checkpoint.ships.length * SHIP_OVERHEAD_BYTES;
  total += checkpoint.projectiles.length * PROJECTILE_OVERHEAD_BYTES;
  const medium = checkpoint.medium;
  if (medium !== undefined) {
    total += typedBytes(medium.rho);
    total += typedBytes(medium.eps);
    total += typedBytes(medium.epsVis);
    total += typedBytes(medium.mx);
    total += typedBytes(medium.my);
  }
  return total + estimateFramesBytes(preFrames);
}

/**
 * Run `task` in a browser idle callback so a large durable cache write never
 * blocks the animation frame. Falls back to `setTimeout(0)` where
 * `requestIdleCallback` is unavailable (node test runs). The `timeout` bounds the
 * defer so the write still lands promptly when the tab is busy, rather than
 * waiting indefinitely for an idle slot.
 */
function runAtIdle(task: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const invoke = (): void => {
      task().then(resolve, reject);
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => invoke(), { timeout: 2000 });
    } else {
      setTimeout(invoke, 0);
    }
  });
}

interface CacheEntryMeta {
  bytes: number;
  lastAccess: number;
}

export class DexieSimCache implements SimCache {
  // In-memory mirror of every row's { bytes, lastAccess }, so eviction can rank
  // and bound entries without structured-cloning every cached result on each
  // write. Built once (lazily, inside the deferred `set` that first needs it) from
  // the lightweight `simCacheMeta` table — never the `simCache` result rows — and
  // kept in sync on every get/set/evict thereafter. `null` until that first build.
  #meta: Map<string, CacheEntryMeta> | null = null;

  constructor(
    private readonly table: Table<SimCacheRecord, string>,
    private readonly metaTable: Table<SimCacheMetaRecord, string>,
    private readonly maxBytes: number = DEFAULT_DEXIE_BYTES_BUDGET,
    private readonly maxEntries: number = DEFAULT_DEXIE_MAX_ENTRIES,
  ) {}

  /**
   * Populate {@link #meta} from the `simCacheMeta` table on first use and return
   * it. Runs once per instance; later calls return the existing map. Called from
   * `set` (the only path that evicts), so the one metadata-table read happens
   * inside the deferred idle write, off the rAF. Reading `simCacheMeta` (three
   * scalars per row) instead of `simCache` avoids structured-cloning every cached
   * `BattleResult` — the full frame-graph payloads stay in the result table
   * untouched. Returning the map lets callers use a narrowed local rather than
   * re-checking the nullable field after each await.
   */
  async #ensureMeta(): Promise<Map<string, CacheEntryMeta>> {
    if (this.#meta !== null) return this.#meta;
    const rows = await this.metaTable.toArray();
    const meta = new Map<string, CacheEntryMeta>();
    for (const row of rows) meta.set(row.key, { bytes: row.bytes, lastAccess: row.lastAccess });
    this.#meta = meta;
    return meta;
  }

  async get(key: string): Promise<BattleResult | undefined> {
    const record = await this.table.get(key);
    if (record === undefined) return undefined;
    // Cheap shape guard only: the inputs + SimConfig + engineAlgorithmSignature
    // cover every determinant, so a stale-shape entry is never read (algorithm
    // or schema drift flips the key). This guard only catches gross corruption
    // (a truncated write) — evict the row from BOTH tables and miss.
    if (!isBattleResult(record.result)) {
      await this.#deleteBoth(key);
      if (this.#meta !== null) this.#meta.delete(key);
      return undefined;
    }
    // Bump recency for LRU. Fire-and-forget on the durable rows: do not delay or
    // fail the read on a recency-bookkeeping error — the result is already
    // resolved. Mirror the bump too, when the mirror is loaded and holds the
    // key, so the next eviction sees fresh recency without re-reading the table.
    const now = Date.now();
    void this.#bumpRecency(key, now);
    if (this.#meta !== null) {
      const existing = this.#meta.get(key);
      if (existing !== undefined) this.#meta.set(key, { ...existing, lastAccess: now });
    }
    return record.result;
  }

  async set(key: string, value: BattleResult): Promise<void> {
    // The structured-clone `put` of a large result and the eviction scan can both
    // take hundreds of ms; defer them to an idle callback so they never block the
    // playback rAF. The memory tier in CompositeSimCache already holds the result
    // for the session, and CachingBattleRunner surfaces a write failure via the
    // notifier rather than failing the battle, so a deferred write is safe.
    await runAtIdle(() => this.#write(key, value));
  }

  async #write(key: string, value: BattleResult): Promise<void> {
    const meta = await this.#ensureMeta();
    const bytes = estimateResultBytes(value);
    const now = Date.now();
    const record: SimCacheRecord = { key, result: value, bytes, lastAccess: now };
    try {
      await this.#putBoth(record);
    } catch (error) {
      // A DataCloneError is a capacity boundary, not a bug: the result is too
      // large for the structured clone. The memory tier still holds it for the
      // session, so skip the durable write instead of surfacing a scary toast.
      // Do NOT evict on this path — the table is not over quota, and evicting
      // cached results would not help a single oversized entry clone.
      if (isUncloneable(error)) return;
      // Only a quota exhaustion is recoverable: drop the oldest entry to free
      // space and retry the write once. Any other failure is a real bug and is
      // rethrown unchanged.
      if (!isQuotaExceeded(error)) throw error;
      await this.#evictOldest(meta);
      await this.#putBoth(record);
    }
    meta.set(key, { bytes, lastAccess: now });
    await this.#evict(meta);
  }

  /**
   * Write a result row and its metadata mirror in a single readwrite
   * transaction over both tables, so the two never drift apart. Used by
   * {@link #write} (including the quota-retry path — the first transaction
   * aborts cleanly on quota, then eviction frees space and this is re-called).
   */
  async #putBoth(record: SimCacheRecord): Promise<void> {
    await this.table.db.transaction("rw", this.table, this.metaTable, async () => {
      await this.table.put(record);
      await this.metaTable.put({
        key: record.key,
        bytes: record.bytes,
        lastAccess: record.lastAccess,
      });
    });
  }

  /**
   * Delete the result row and its metadata mirror in a single readwrite
   * transaction. A missing row in either table is a no-op (IndexedDB `delete`
   * on a non-existent key is not an error), so this is safe for keys that exist
   * in only one table (e.g. a corrupt row evicted before the mirror was built).
   */
  async #deleteBoth(key: string): Promise<void> {
    await this.table.db.transaction("rw", this.table, this.metaTable, async () => {
      await this.table.delete(key);
      await this.metaTable.delete(key);
    });
  }

  /**
   * Bump the `lastAccess` timestamp on both the result row and its metadata
   * mirror in a single readwrite transaction. Fire-and-forget from {@link get}:
   * the result is already in hand, and a failure to record recency is not a
   * reason to fail the read (the sole deliberate swallow in this adapter).
   */
  async #bumpRecency(key: string, now: number): Promise<void> {
    await this.table.db.transaction("rw", this.table, this.metaTable, async () => {
      await this.table.update(key, { lastAccess: now });
      await this.metaTable.update(key, { lastAccess: now });
    });
  }

  async has(key: string): Promise<boolean> {
    const count = await this.table.where("key").equals(key).count();
    return count > 0;
  }

  /**
   * Delete the single oldest-`lastAccess` row, if any. Used to free space after
   * a quota-exceeded `put` before retrying it once.
   */
  async #evictOldest(meta: Map<string, CacheEntryMeta>): Promise<void> {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [k, m] of meta) {
      if (m.lastAccess < oldestAccess) {
        oldestAccess = m.lastAccess;
        oldestKey = k;
      }
    }
    if (oldestKey === null) return;
    await this.#deleteBoth(oldestKey);
    meta.delete(oldestKey);
  }

  /**
   * Evict the oldest-`lastAccess` rows until both the byte budget and the
   * entry-count cap hold. Ranks and bounds from the in-memory {@link #meta}
   * mirror, deleting oldest-first from BOTH tables, so no cached result is
   * structured-cloned just to compute the running totals.
   */
  async #evict(meta: Map<string, CacheEntryMeta>): Promise<void> {
    const ordered = Array.from(meta.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    let totalBytes = 0;
    for (const [, m] of ordered) totalBytes += m.bytes;
    let count = ordered.length;
    for (const [k, m] of ordered) {
      if (totalBytes <= this.maxBytes && count <= this.maxEntries) break;
      await this.#deleteBoth(k);
      meta.delete(k);
      totalBytes -= m.bytes;
      count -= 1;
    }
  }
}
