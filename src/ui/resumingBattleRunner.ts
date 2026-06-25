import { engineAlgorithmSignature } from "@/domain/cache/algorithm-signature";
import { deriveCacheKey } from "@/domain/cache/key";
import type { CheckpointStore } from "@/domain/cache/checkpoint-store";
import { getSimConfig } from "@/domain/cache/sim-config";
import type {
  BattleRunOptions,
  BattleRunner,
} from "@/domain/simulation/runner";
import type { BattleInputs } from "@/domain/simulation/types";
import type { BattleFrame, BattleResult } from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";

/**
 * Cap on the number of frames persisted in a resume checkpoint's `preFrames`.
 * The resume store clones `preFrames` into IndexedDB; for a long battle the
 * array grows until the structured clone exhausts memory (`DataCloneError`),
 * which Dexie logs to the console even when the app catches it. Once `preFrames`
 * exceeds this cap the persist is SKIPPED — a later interruption resumes from a
 * fresh recompute instead. The resume feature is an optimisation, never a
 * correctness path, so losing the checkpoint for long battles is acceptable.
 *
 * The value accounts for the binary-frame format (typed arrays): each frame's
 * cell data is contiguous buffers (Float64Array/Uint8Array), far more compact
 * for structured clone than the old per-cell objects. At ~35 KB/frame for the
 * heaviest preset pair (19 ships), 2000 frames is ~70 MB — well within the
 * browser's structured-clone budget, and covers most preset battles fully.
 */
const MAX_CHECKPOINT_FRAMES = 2000;

/**
 * Surfaces a checkpoint persist / delete failure to the user. Injected so the
 * decorator stays unit-testable in node (no `@mantine/notifications` runtime);
 * the production wiring in `battleRunner.ts` passes the real notifications
 * channel. A persist or delete failure must NOT block returning the freshly
 * computed result, but MUST surface (never swallowed) so a silently failing
 * checkpoint store cannot masquerade as a working one.
 */
export type NotifyCheckpointFailure = (error: Error) => void;

/**
 * A resume {@link BattleRunner} decorator at the UI edge. Owns a
 * {@link CheckpointStore} and uses it to resume an interrupted run from the
 * latest captured checkpoint instead of recomputing from tick 0, and to
 * proactively persist checkpoints during a fresh compute so a LATER
 * interruption has somewhere to resume from.
 *
 * Sits BELOW {@link CachingBattleRunner} in the decorator chain
 * (`CachingBattleRunner(ResumingBattleRunner(innerRunner))`), so the resolve
 * order on opening a matchup is: result-cache hit (replay, no compute), else
 * checkpoint resume (re-enter the loop at `checkpoint.tick + 1`), else fresh.
 *
 * On `run(inputs, options)`:
 *  1. Derive the content key (the same one the result cache uses — a resumed
 *     run is the same matchup).
 *  2. Look up a checkpoint: `checkpoint = await store.get(key)`.
 *  3. Run the INNER runner. If a checkpoint was found, pass
 *     `options.resumeFrom = checkpoint.checkpoint`; else run fresh.
 *  4. PROACTIVE PERSIST during compute: pass an `onCheckpoint` callback that
 *     accumulates the streamed frames (via a parallel `onFrames` wrapper) and,
 *     on each checkpoint, persists `{ key, checkpoint, preFrames: frames with
 *     tick <= checkpoint.tick }` to the store (overwrite — one latest per
 *     matchup).
 *  5. STITCH: the inner runner returns a result. If this was a resume, the
 *     inner result carries ONLY frames `checkpoint.tick + 1..end`, so assemble
 *     the FULL result = `{ ...innerResult, frames: [...checkpoint.preFrames,
 *     ...innerResult.frames] }`. If fresh, the inner result is already full.
 *  6. On completion (full result assembled), `store.delete(key)` — the
 *     in-progress state is subsumed by the complete result, which the outer
 *     {@link CachingBattleRunner} caches. Return the FULL result.
 *
 * A persist or delete failure is surfaced via the injected notifier and does
 * NOT block returning the result — the battle is already in hand. This is the
 * only swallow in the decorator, and it is deliberate: the resume feature is
 * an optimisation, not a correctness path, so a broken store must not fail a
 * battle that has already been computed.
 */
export class ResumingBattleRunner implements BattleRunner {
  constructor(
    private readonly inner: BattleRunner,
    private readonly store: CheckpointStore,
    private readonly notifyCheckpointFailure: NotifyCheckpointFailure,
  ) {}

  async run(
    inputs: BattleInputs,
    options?: BattleRunOptions,
  ): Promise<BattleResult> {
    const signature = await engineAlgorithmSignature();
    const key = await deriveCacheKey(
      inputs,
      getSimConfig(),
      signature,
    );

    const found = await this.store.get(key);
    const resuming = found !== undefined;
    const resumeFrom = resuming ? found.checkpoint : undefined;

    // Accumulate the frames the inner runner streams via onFrames, so each
    // incoming checkpoint can be persisted alongside the frames that precede
    // it (the ones with tick <= checkpoint.tick — the resumed engine reproduces
    // the tail from checkpoint.tick + 1, so those are exactly the frames a
    // later resume must stitch back on). Seed with the resumed checkpoint's
    // pre-frames so a checkpoint persisted DURING a resumed run captures the
    // full 0..tick (not just the resumed tail) — a second interruption that
    // re-resumes from it would otherwise lose frames 0..checkpoint.tick.
    const streamedFrames: BattleFrame[] = found !== undefined ? [...found.preFrames] : [];
    const userOnFrames = options?.onFrames;
    const onFrames: typeof userOnFrames = (frames, computedTicks, descriptors) => {
      for (const frame of frames) streamedFrames.push(frame);
      userOnFrames?.(frames, computedTicks, descriptors);
    };

    // Persist each checkpoint the inner runner captures. `preFrames` are the
    // frames streamed so far with tick <= checkpoint.tick. A persist failure
    // surfaces via the notifier and does not block the run.
    const onCheckpoint = (checkpoint: EngineCheckpoint): void => {
      const preFrames = streamedFrames.filter(
        (frame) => frame.tick <= checkpoint.tick,
      );
      // Skip the persist once preFrames is too large to clone without OOMing
      // the IDB structured clone (Dexie logs the failed put to the console
      // regardless of whether the app catches it). A later interruption resumes
      // from a fresh recompute — the resume feature is an optimisation.
      if (preFrames.length > MAX_CHECKPOINT_FRAMES) return;
      void this.store
        .put(key, checkpoint, preFrames)
        .catch((error: unknown) => {
          this.notifyCheckpointFailure(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    };

    const innerOptions: BattleRunOptions = {
      ...options,
      onFrames,
      onCheckpoint,
      ...(resumeFrom !== undefined ? { resumeFrom } : {}),
    };

    const innerResult = await this.inner.run(inputs, innerOptions);

    // Stitch: on a resume the inner result carries only frames after the
    // checkpoint, so prepend the checkpoint's preceding frames to reconstruct
    // the full timeline. On a fresh run the inner result is already full.
    const fullResult: BattleResult = resuming && found !== undefined
      ? { ...innerResult, frames: [...found.preFrames, ...innerResult.frames] }
      : innerResult;

    // Keep the checkpoint after completion. The result cache (DexieSimCache)
    // may silently skip the durable write for large results (isUncloneable),
    // so this checkpoint is the only durable state that survives a reload. On
    // a reload the CachingBattleRunner checks the result cache first (misses
    // if the write was skipped), then this resume decorator finds the
    // checkpoint and resumes from here — a partial recompute, not from
    // scratch. The checkpoint is overwritten on the next run of the same
    // matchup, so it never accumulates.
    return fullResult;
  }
}
