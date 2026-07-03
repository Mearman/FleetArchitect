import { engineAlgorithmSignature } from "@/domain/cache/algorithm-signature";
import { deriveCacheKeyMemoised } from "@/domain/cache/key";
import { getSimConfig } from "@/domain/cache/sim-config";
import type { SimCache } from "@/domain/cache/contract";
import type {
  BattleRunOptions,
  BattleRunner,
} from "@/domain/simulation/runner";
import type { BattleInputs } from "@/domain/simulation/types";
import type { BattleResult } from "@/schema/battle";

/**
 * Surfaces a cache-write failure to the user. Injected so the decorator stays
 * unit-testable in node (no `@mantine/notifications` runtime); the production
 * wiring in `battleRunner.ts` passes the real notifications channel.
 */
export type NotifyCacheFailure = (error: Error) => void;

/**
 * A read-through cache {@link BattleRunner} decorator at the UI edge. Battles are
 * pure functions of their inputs, so an identical matchup re-run can return its
 * previously computed {@link BattleResult} instead of re-simulating.
 *
 * On `run`:
 *  - `options.noCache` ⇒ delegate straight to the inner runner; touch nothing.
 *  - otherwise derive the content key from the PRE-WORKER inputs (so the key is
 *    computed once, on the main thread, before the inputs cross into a worker),
 *    then:
 *      - HIT  — replay the cached result's frames through `options.onFrames` so
 *               the UI streams a hit down the identical path it streams a fresh
 *               run, then resolve with the cached result. The inner runner is
 *               never touched.
 *      - MISS — run the inner runner, then fire-and-forget `set` the result
 *               under the key (the caller's `run` promise resolves before the
 *               durable tier's idle-deferred write lands).
 *
 * A `set` failure (including IndexedDB quota exhaustion that the durable tier
 * could not recover by eviction) must NOT block returning the freshly computed
 * result — the battle is already in hand. It is surfaced via the injected
 * notifier rather than swallowed, so a silently failing cache cannot masquerade
 * as a working one.
 *
 * This decorator lives in the UI layer precisely because it depends on the cache
 * (a composed memory + IndexedDB tier) and the notifications channel; the domain
 * `runner.ts` contract knows nothing of either.
 */
export class CachingBattleRunner implements BattleRunner {
  constructor(
    private readonly inner: BattleRunner,
    private readonly cache: SimCache,
    private readonly notifyCacheFailure: NotifyCacheFailure,
  ) {}

  async run(
    inputs: BattleInputs,
    options?: BattleRunOptions,
  ): Promise<BattleResult> {
    if (options?.noCache === true) {
      return this.inner.run(inputs, options);
    }

    const signature = await engineAlgorithmSignature();
    const key = await deriveCacheKeyMemoised(
      inputs,
      getSimConfig(),
      signature,
    );

    const hit = await this.cache.get(key);
    if (hit !== undefined) {
      // Replay the cached result down the streaming path so a hit renders
      // exactly like a fresh run: one batch carrying every frame, the final
      // tick count, and the full descriptor set. A recorded result always
      // carries descriptors; narrow rather than substitute a sentinel.
      const descriptors = hit.descriptors;
      if (descriptors === undefined) {
        throw new Error("cached BattleResult is missing descriptors");
      }
      options?.onFrames?.(hit.frames, hit.ticks, descriptors);
      return hit;
    }

    const result = await this.inner.run(inputs, options);

    // Fire-and-forget: the durable tier defers the structured-clone put through
    // `requestIdleCallback`, so awaiting `set` would hold the caller's
    // battle-runner promise open until that idle-deferred write lands — up to
    // ~2 s of pure UI latency on every battle-complete, worse on a busy main
    // thread. The frames are already fully streamed via `onFrames` by the time
    // the inner runner resolves, so nothing downstream needs the write to have
    // landed. A failed write is surfaced through the existing notifier rather
    // than swallowed, so a silently failing cache cannot masquerade as a
    // working one.
    this.cache.set(key, result).catch((error: unknown) => {
      this.notifyCacheFailure(
        error instanceof Error ? error : new Error(String(error)),
      );
    });

    return result;
  }
}
