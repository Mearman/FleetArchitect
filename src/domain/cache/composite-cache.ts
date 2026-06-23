import type { BattleResult } from "@/schema/battle";
import type { SimCache } from "@/domain/cache/contract";

/**
 * A read-through cache composing a fast volatile tier in front of a durable one
 * (memory → IndexedDB in the browser, memory → disk in node tests). This is the
 * storage-boundary rule expressed as composition rather than conditionals inside
 * a consumer: a consumer holds one `SimCache`; whether it has one tier or two is
 * invisible to it.
 *
 * - `get`: check memory; on a miss, check the durable tier and BACK-FILL memory
 *   with a durable hit so the next read is fast.
 * - `set`: write through to both tiers so a fresh result is durable immediately
 *   and warm in memory.
 * - `has`: a hit in either tier.
 *
 * Both tiers' failures surface: this composite adds no error-swallowing. A quota
 * failure on the durable `set` propagates to the caller (the UI decorator
 * surfaces it via notifications); it is not silently dropped.
 */
export class CompositeSimCache implements SimCache {
  constructor(
    private readonly memory: SimCache,
    private readonly durable: SimCache,
  ) {}

  async get(key: string): Promise<BattleResult | undefined> {
    const fromMemory = await this.memory.get(key);
    if (fromMemory !== undefined) return fromMemory;
    const fromDurable = await this.durable.get(key);
    if (fromDurable === undefined) return undefined;
    await this.memory.set(key, fromDurable);
    return fromDurable;
  }

  async set(key: string, value: BattleResult): Promise<void> {
    await this.memory.set(key, value);
    await this.durable.set(key, value);
  }

  async has(key: string): Promise<boolean> {
    if (await this.memory.has(key)) return true;
    return this.durable.has(key);
  }
}
