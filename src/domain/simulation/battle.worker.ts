import { createId, nowIso } from "@/domain/id";
import { simulateBattle } from "@/domain/simulation/engine";
import type { BattleInputs } from "@/domain/simulation/types";
import { STREAM_BATCH_INTERVAL_MS } from "@/domain/simulation/types";
import type { BattleFrame, ShipDescriptor } from "@/schema/battle";

/**
 * Worker entry for the battle simulation. Receives `BattleInputs` (structured-
 * cloned across the thread boundary by `postMessage`), drives the deterministic
 * generator, and streams frame batches back as `{ kind: 'frames' }` messages
 * before posting a final `{ kind: 'result' }` with the assembled `BattleResult`.
 *
 * Streaming lets the main thread begin rendering replay frames while the
 * simulation is still running, rather than waiting for the whole battle to
 * finish before receiving any data.
 */
self.onmessage = (event: MessageEvent<BattleInputs>) => {
  const inputs = event.data;
  // The descriptor sink is populated by the generator the first frame each ship
  // instance appears. After each batch we forward descriptors captured since the
  // last post so the main thread can reconstruct cell positions for the streamed
  // frames before the final result lands.
  const descriptorSink = new Map<string, ShipDescriptor>();
  const it = simulateBattle(inputs, { descriptorSink });

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
    self.postMessage({
      kind: "frames",
      frames,
      computedTicks: lastFrame !== undefined ? lastFrame.tick : 0,
      descriptors: drainNewDescriptors(),
    });
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
        anomaly: inputs.anomaly,
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
