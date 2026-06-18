import { createId, nowIso } from "@/domain/id";
import { simulateBattle } from "@/domain/simulation/engine";
import type { BattleInputs } from "@/domain/simulation/types";
import { STREAM_BATCH_INTERVAL_MS } from "@/domain/simulation/types";
import type { BattleFrame } from "@/schema/battle";

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
  const it = simulateBattle(inputs);

  const allFrames: BattleFrame[] = [];
  let batch: BattleFrame[] = [];
  let lastPostMs = performance.now();

  let next = it.next();
  while (!next.done) {
    const frame = next.value;
    allFrames.push(frame);
    batch.push(frame);

    // Post a batch when enough wall-clock time has elapsed since the last one.
    // The frame count per batch scales with the simulation's speed, so the
    // main thread always receives several seconds of playback per update.
    if (performance.now() - lastPostMs >= STREAM_BATCH_INTERVAL_MS) {
      const lastFrame = batch[batch.length - 1];
      self.postMessage({
        kind: "frames",
        frames: batch,
        computedTicks: lastFrame !== undefined ? lastFrame.tick : 0,
      });
      batch = [];
      lastPostMs = performance.now();
    }

    next = it.next();
  }

  // Flush the remaining partial batch (may be empty if frames divided evenly).
  if (batch.length > 0) {
    const lastFrame = batch[batch.length - 1];
    self.postMessage({
      kind: "frames",
      frames: batch,
      computedTicks: lastFrame !== undefined ? lastFrame.tick : 0,
    });
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
    },
  });
};
