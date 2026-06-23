import type { Table } from "dexie";
import { BattleResult } from "@/schema/battle";
import type { SimCache } from "@/domain/cache/contract";
import type { SimCacheRecord } from "@/storage/db";

/**
 * The in-browser durable tier of the deterministic result cache: an IndexedDB
 * adapter over the `simCache` Dexie table (see `db.ts`, `version(5)`). It mirrors
 * the on-disk `DiskSimCache` for node tests — same `SimCache` contract, same LRU +
 * budget eviction policy — but persists across browser reloads instead of across
 * `pnpm test` runs.
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

/**
 * The UTF-8 byte length of a result's JSON serialisation, used as the size proxy
 * for the byte budget. It need not equal the exact IndexedDB on-disk size (which
 * the structured-clone format does not expose); it only needs to be a stable,
 * monotonic estimate that lets eviction rank and bound entries consistently.
 */
function estimateBytes(result: BattleResult): number {
  return new TextEncoder().encode(JSON.stringify(result)).length;
}

/**
 * Whether a thrown value is a storage quota-exceeded error. IndexedDB surfaces
 * an exhausted quota as a `DOMException` named `QuotaExceededError`; Dexie
 * propagates it (or wraps it in an error whose `name` is preserved). Narrow
 * `unknown` with `in` and `typeof` — no assertions.
 */
function isQuotaExceeded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("name" in error)) return false;
  return error.name === "QuotaExceededError";
}

export class DexieSimCache implements SimCache {
  constructor(
    private readonly table: Table<SimCacheRecord, string>,
    private readonly maxBytes: number = DEFAULT_DEXIE_BYTES_BUDGET,
    private readonly maxEntries: number = DEFAULT_DEXIE_MAX_ENTRIES,
  ) {}

  async get(key: string): Promise<BattleResult | undefined> {
    const record = await this.table.get(key);
    if (record === undefined) return undefined;
    const parsed = BattleResult.safeParse(record.result);
    if (!parsed.success) {
      // Shape drift: the stored result no longer matches the schema. Treat it as
      // a miss and evict the stale row so it is not re-read on every lookup.
      await this.table.delete(key);
      return undefined;
    }
    // Bump recency for LRU. Fire-and-forget: do not delay or fail the read on a
    // recency-bookkeeping error — the result is already resolved.
    void this.table.update(key, { lastAccess: Date.now() });
    return parsed.data;
  }

  async set(key: string, value: BattleResult): Promise<void> {
    const record: SimCacheRecord = {
      key,
      result: value,
      bytes: estimateBytes(value),
      lastAccess: Date.now(),
    };
    try {
      await this.table.put(record);
    } catch (error) {
      // Only a quota exhaustion is recoverable here: drop the oldest entry to
      // free space and retry the write once. Any other failure (a real Dexie
      // error, a constraint violation) is a bug and is rethrown unchanged — the
      // UI decorator surfaces it rather than serving stale or losing the write
      // silently.
      if (!isQuotaExceeded(error)) throw error;
      await this.evictOldest();
      await this.table.put(record);
    }
    await this.evict();
  }

  async has(key: string): Promise<boolean> {
    const count = await this.table.where("key").equals(key).count();
    return count > 0;
  }

  /**
   * Delete the single oldest-`lastAccess` row, if any. Used to free space after
   * a quota-exceeded `put` before retrying it once.
   */
  private async evictOldest(): Promise<void> {
    const oldest = await this.table.orderBy("lastAccess").first();
    if (oldest === undefined) return;
    await this.table.delete(oldest.key);
  }

  /**
   * Evict the oldest-`lastAccess` rows until both the byte budget and the
   * entry-count cap hold. Reads the index ordered by `lastAccess` so the oldest
   * entries come first; deletes from the front until within budget.
   */
  private async evict(): Promise<void> {
    const ordered = await this.table.orderBy("lastAccess").toArray();
    let totalBytes = ordered.reduce((sum, record) => sum + record.bytes, 0);
    let count = ordered.length;
    for (const record of ordered) {
      if (totalBytes <= this.maxBytes && count <= this.maxEntries) break;
      await this.table.delete(record.key);
      totalBytes -= record.bytes;
      count -= 1;
    }
  }
}
