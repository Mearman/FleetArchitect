import { createId, nowIso } from "@/domain/id";
import { simulateBattle } from "@/domain/simulation/engine";
import type { BattleInputs } from "@/domain/simulation/types";
import { STREAM_BATCH_INTERVAL_MS } from "@/domain/simulation/types";
import type { BattleFrame, ShipDescriptor } from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";

/**
 * The checkpoint capture cadence inside the worker: one checkpoint every
 * {@link WORKER_CHECKPOINT_EVERY_TICKS} ticks, so a long or interrupted battle
 * resumes from a recent tick rather than recomputing from tick 0. Coarse on
 * purpose: capture reads the live engine state and deep-clones it, so the
 * cadence trades a small periodic cost against the progress lost on
 * interruption. A named constant rather than a magic number so the cadence is
 * discoverable and adjusted in one place.
 */
const WORKER_CHECKPOINT_EVERY_TICKS = 30;

/**
 * The message the worker accepts. Carries the battle inputs plus an optional
 * {@link EngineCheckpoint} to resume from (the resume decorator passes the
 * latest persisted checkpoint so the worker re-enters the loop at
 * `checkpoint.tick + 1`). `postMessage` structured-clones both across the
 * thread boundary, preserving the checkpoint's `±Infinity` / `-0` fields.
 */
interface BattleWorkerRequest {
  inputs: BattleInputs;
  resumeFrom?: EngineCheckpoint;
}

/**
 * Worker entry for the battle simulation. Receives `{ inputs, resumeFrom? }`
 * (structured-cloned across the thread boundary by `postMessage`), drives the
 * deterministic generator, and streams frame batches back as
 * `{ kind: 'frames' }` messages (each carrying the latest captured checkpoint,
 * if any) before posting a final `{ kind: 'result' }` with the assembled
 * `BattleResult`.
 *
 * Streaming lets the main thread begin rendering replay frames while the
 * simulation is still running, rather than waiting for the whole battle to
 * finish before receiving any data. The forwarded checkpoints let the resume
 * decorator persist the latest in-progress state so an interrupted run resumes
 * from there.
 */
self.onmessage = (event: MessageEvent<BattleWorkerRequest>) => {
  const { inputs, resumeFrom } = event.data;
  // The descriptor sink is populated by the generator the first frame each ship
  // instance appears. After each batch we forward descriptors captured since the
  // last post so the main thread can reconstruct cell positions for the streamed
  // frames before the final result lands.
  const descriptorSink = new Map<string, ShipDescriptor>();
  // The latest checkpoint captured by the generator (advanced every
  // WORKER_CHECKPOINT_EVERY_TICKS ticks). Forwarded with each batch so the
  // resume decorator can persist it; `undefined` until the cadence first hits
  // (and always undefined on a fresh run with no resumeFrom, which never
  // captures — `onCheckpoint` is what arms the capture path).
  let latestCheckpoint: EngineCheckpoint | undefined;
  // The generator advances `latestCheckpoint` every WORKER_CHECKPOINT_EVERY_TICKS
  // ticks. This flag tracks whether the latest has not yet been forwarded, so a
  // batch carries the checkpoint only when it is new — not on every post between
  // cadence hits. Without it, the same large checkpoint would be re-cloned into
  // every batch message and re-persisted to IndexedDB each time, even though it
  // had not changed since the cadence last fired.
  let checkpointDirty = false;
  const it = simulateBattle(inputs, {
    descriptorSink,
    resumeFrom,
    checkpointEvery: WORKER_CHECKPOINT_EVERY_TICKS,
    onCheckpoint: (cp) => {
      latestCheckpoint = cp;
      checkpointDirty = true;
    },
  });

  const allFrames: BattleFrame[] = [];
  let batch: BattleFrame[] = [];
  let lastPostMs = performance.now();
  // Instance ids whose descriptor has already been streamed, so each batch only
  // carries instances that first appeared since the previous post.
  const sentDescriptorIds = new Set<string>();

  // Collect descriptors captured since the last post (those not yet streamed),
  // marking them sent. Returns the new descriptors in stable insertion order.
  const drainNewDescriptors = (): ShipDescriptor[] => {
    const fresh: ShipDescriptor[] = [];
    for (const [id, descriptor] of descriptorSink) {
      if (sentDescriptorIds.has(id)) continue;
      sentDescriptorIds.add(id);
      fresh.push(descriptor);
    }
    return fresh;
  };

  const postBatch = (frames: BattleFrame[]): void => {
    const lastFrame = frames[frames.length - 1];
    // Forward the latest captured checkpoint with the batch (may be undefined
    // if the cadence has not hit yet). The resume decorator persists it; a
    // few-tick lag behind the batch's last frame is fine — on resume the
    // engine reproduces the tail byte-identically from wherever the checkpoint
    // was taken.
    const message: { kind: "frames"; frames: BattleFrame[]; computedTicks: number; descriptors: ShipDescriptor[]; checkpoint?: EngineCheckpoint } = {
      kind: "frames",
      frames,
      computedTicks: lastFrame !== undefined ? lastFrame.tick : 0,
      descriptors: drainNewDescriptors(),
    };
    // Forward the checkpoint only when it changed since the last post. The
    // generator captures every WORKER_CHECKPOINT_EVERY_TICKS ticks; between hits
    // the value is unchanged, so re-sending it would just re-clone the same
    // large object (and re-persist it on the main thread) for no benefit.
    if (checkpointDirty && latestCheckpoint !== undefined) {
      message.checkpoint = latestCheckpoint;
      checkpointDirty = false;
    }
    self.postMessage(message);
  };

  let next = it.next();
  while (!next.done) {
    const frame = next.value;
    allFrames.push(frame);
    batch.push(frame);

    // Post a batch when enough wall-clock time has elapsed since the last one.
    // The frame count per batch scales with the simulation's speed, so the
    // main thread always receives several seconds of playback per update.
    if (performance.now() - lastPostMs >= STREAM_BATCH_INTERVAL_MS) {
      postBatch(batch);
      batch = [];
      lastPostMs = performance.now();
    }

    next = it.next();
  }

  // Flush the remaining partial batch (may be empty if frames divided evenly).
  if (batch.length > 0) {
    postBatch(batch);
  }

  const summary = next.value;

  self.postMessage({
    kind: "result",
    result: {
      id: createId("battle"),
      config: {
        attackerFleetId: inputs.attackerFleetId,
        defenderFleetId: inputs.defenderFleetId,
        anomalies: inputs.anomalies,
        seed: inputs.seed,
      },
      winner: summary.winner,
      ticks: summary.ticks,
      playedAt: nowIso(),
      frames: allFrames,
      descriptors: summary.descriptors,
    },
  });
};
