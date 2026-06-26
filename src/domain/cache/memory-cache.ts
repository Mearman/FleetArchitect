import type { BattleResult } from "@/schema/battle";
import type { SimCache } from "@/domain/cache/contract";

/**
 * The in-memory tier bound is the session working set: the few most recent
 * battles a user is flicking between (re-running a matchup, toggling `noCache`,
 * comparing two seeds). A `BattleResult` is large — frames for a long battle run
 * from ~1 MB to tens of MB — so the bound is an ENTRY COUNT, not a byte budget:
 * a handful of recent results is the right working set and keeps the ceiling
 * predictable without measuring each result's size. The durable tiers (disk,
 * IndexedDB) hold the larger history and back-fill this tier on a hit.
 */
export const MAX_MEMORY_ENTRIES = 8;

/**
 * A `Map`-based LRU cache bounded by entry count. `Map` preserves insertion
 * order, so the oldest entry is always the first key — eviction is `keys().next()`.
 * `get` re-inserts on a hit so a touched entry becomes most-recent; `set` evicts
 * the oldest once the bound is exceeded.
 *
 * Pure: no storage, no DOM. One instance per session (the composite owns it).
 */
export class MemorySimCache implements SimCache {
  private readonly entries = new Map<string, BattleResult>();

  constructor(private readonly maxEntries: number = MAX_MEMORY_ENTRIES) {}

  // Synchronous internally — the body has nothing to await — but the methods
  // stay Promise-returning to satisfy the async `SimCache` contract. Returning
  // `Promise.resolve` directly (rather than `async`) keeps `require-await` happy.
  get(key: string): Promise<BattleResult | undefined> {
    const value = this.entries.get(key);
    if (value === undefined) return Promise.resolve(undefined);
    // Re-insert to mark most-recently used: delete then set moves it to the end.
    this.entries.delete(key);
    this.entries.set(key, value);
    return Promise.resolve(value);
  }

  set(key: string, value: BattleResult): Promise<void> {
    // Delete first so an overwrite also refreshes recency ordering.
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.entries.has(key));
  }
}
