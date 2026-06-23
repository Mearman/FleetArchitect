import type { BattleFrame } from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";

/**
 * The in-progress-run resume store contract: persists the latest captured
 * {@link EngineCheckpoint} (plus the frames up to and including its tick) for a
 * battle's content key, so an interrupted run can resume from the checkpoint
 * instead of recomputing from tick 0.
 *
 * This is the resume counterpart to {@link SimCache}: the result cache holds
 * COMPLETED runs; this store holds IN-PROGRESS state. On opening a matchup the
 * resolve order is result-cache hit, then checkpoint resume, then fresh. On
 * completion the resume decorator deletes the checkpoint — the complete result
 * (cached by the result-cache tier) subsumes it.
 *
 * One latest checkpoint per content key: `put` overwrites. The store keeps no
 * history of prior ticks and needs no `has` — a `get` returning `undefined` is
 * the miss signal.
 *
 * Pure: this interface imports only the `EngineCheckpoint` and `BattleFrame`
 * schema types. No storage, no DOM, no node built-ins. The IndexedDB adapter
 * lives in `src/storage/`; the resume decorator that orchestrates capture and
 * stitching lives at the UI edge (`src/ui/`).
 */
export interface CheckpointStore {
  /**
   * Return the latest captured checkpoint and its preceding frames for a key,
   * or `undefined` on a miss. The `preFrames` are the frames with `tick <=
   * checkpoint.tick` captured by the resume decorator at persist time; the
   * decorator stitches them onto the resumed run's tail to reconstruct the
   * full `BattleResult`.
   */
  get(
    key: string,
  ): Promise<{ checkpoint: EngineCheckpoint; preFrames: BattleFrame[] } | undefined>;
  /**
   * Persist (overwrite) the latest checkpoint for a key. Called by the resume
   * decorator each time the engine emits a checkpoint during compute.
   */
  put(
    key: string,
    checkpoint: EngineCheckpoint,
    preFrames: BattleFrame[],
  ): Promise<void>;
  /** Remove the checkpoint for a key (the completed result subsumes it). */
  delete(key: string): Promise<void>;
}
