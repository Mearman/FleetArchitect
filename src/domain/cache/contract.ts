import type { BattleResult } from "@/schema/battle";

/**
 * The cache contract domain code depends on, mirroring `Repository<T>` in
 * `src/storage/contract.ts`: a small, asynchronous, serialisable-data interface
 * that any tier — in-memory, on-disk, IndexedDB — implements. A battle is a pure
 * function of its inputs, so a completed `BattleResult` keyed by its content hash
 * (see `key.ts`) can be served from a cache instead of re-simulated.
 *
 * Pure: this interface imports only the `BattleResult` schema type. No storage,
 * no DOM, no node built-ins. The IndexedDB adapter lives in `src/storage/`, the
 * read-through decorator at the UI edge; the pure adapters (memory, disk) and
 * the composite live alongside this file.
 */
export interface SimCache {
  /** Return the cached result for a key, or `undefined` on a miss. */
  get(key: string): Promise<BattleResult | undefined>;
  /** Store a result under its content key. */
  set(key: string, value: BattleResult): Promise<void>;
  /** Whether a result is cached under this key. */
  has(key: string): Promise<boolean>;
}
