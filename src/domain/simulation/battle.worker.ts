import { createId, nowIso } from "@/domain/id";
import { simulateBattle } from "@/domain/simulation/engine";
import type { BattleInputs } from "@/domain/simulation/types";
import { FRAMES_PER_BATCH } from "@/domain/simulation/types";
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

  let next = it.next();
  while (!next.done) {
    const frame = next.value;
    allFrames.push(frame);
    batch.push(frame);

    if (batch.length >= FRAMES_PER_BATCH) {
      const lastFrame = batch[batch.length - 1];
      // lastFrame is always defined here: batch.length >= FRAMES_PER_BATCH > 0
      self.postMessage({
        kind: "frames",
        frames: batch,
        computedTicks: lastFrame !== undefined ? lastFrame.tick : 0,
      });
      batch = [];
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
