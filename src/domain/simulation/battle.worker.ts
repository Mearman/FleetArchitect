/// <reference lib="webworker" />
import { createId, nowIso } from "@/domain/id";
import { simulateBattle } from "@/domain/simulation/engine";
import type { BattleInputs, BattleSummary } from "@/domain/simulation/types";
import { buildShipRoster, STREAM_BATCH_INTERVAL_MS, TICKS_PER_SECOND } from "@/domain/simulation/types";
import type { BattleFrame, CellStateArrays, ShipDescriptor, ShipSnapshot } from "@/schema/battle";
import type { BattleResultSummary } from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";

/**
 * Walk every frame's ship cells and resource block, collecting the underlying
 * {@link ArrayBuffer} of each typed array so {@link postBatch} can hand them to
 * `postMessage` as the TRANSFER LIST. Transferred buffers cross the thread
 * boundary zero-copy — the source is detached and the receiver takes ownership
 * — which eliminates the structured-clone cost that was the source of the
 * `[Violation] 'message' handler` warnings on the heaviest frames.
 *
 * Every typed-array field on {@link CellStateArrays} (always-present and
 * optional) and the three resource typed arrays are collected. The resource
 * `powerBuffer` stays a plain object (two scalars) and is cloned cheaply.
 * De-duplicates by buffer identity so a buffer shared between two typed-array
 * views is transferred once (postMessage throws on duplicate transfers).
 */
function collectTransferables(frames: readonly BattleFrame[]): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  const out: Transferable[] = [];
  const pushBuffer = (buf: ArrayBuffer): void => {
    if (seen.has(buf)) return;
    seen.add(buf);
    out.push(buf);
  };
  const pushTyped = (arr: Float64Array | Uint8Array | Int32Array | undefined): void => {
    if (arr === undefined) return;
    // Typed arrays allocated by the snapshot are always backed by a plain
    // ArrayBuffer (never a SharedArrayBuffer). Narrow at runtime so the value
    // satisfies Transferable's ArrayBuffer member without a type assertion.
    if (arr.buffer instanceof ArrayBuffer) pushBuffer(arr.buffer);
  };
  for (const frame of frames) {
    for (const ship of frame.ships) {
      collectShipTransferables(ship, pushTyped);
    }
    const medium = frame.medium;
    if (medium !== undefined) {
      pushTyped(medium.rho);
      pushTyped(medium.eps);
    }
  }
  return out;
}

/** Collect the typed-array buffers from one ship's cells and resource block. */
function collectShipTransferables(
  ship: ShipSnapshot,
  pushTyped: (arr: Float64Array | Uint8Array | Int32Array | undefined) => void,
): void {
  const cells = ship.cells;
  if (cells !== undefined) collectCellTransferables(cells, pushTyped);
  const resource = ship.resource;
  if (resource !== undefined) {
    pushTyped(resource.thermal);
    pushTyped(resource.propellant);
    pushTyped(resource.atmosphere);
  }
}

/** Push every typed-array buffer on a CellStateArrays object. */
function collectCellTransferables(
  cells: CellStateArrays,
  pushTyped: (arr: Float64Array | Uint8Array | Int32Array | undefined) => void,
): void {
  pushTyped(cells.cellHp);
  pushTyped(cells.cellAlive);
  pushTyped(cells.cellSurfaceHp);
  pushTyped(cells.cellTurretAngle);
  pushTyped(cells.cellManned);
  pushTyped(cells.cellAmmo);
  pushTyped(cells.cellCharge);
  pushTyped(cells.cellDoorN);
  pushTyped(cells.cellDoorE);
  pushTyped(cells.cellDoorS);
  pushTyped(cells.cellDoorW);
}

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
 * The start message the worker accepts. Carries the battle inputs plus an
 * optional {@link EngineCheckpoint} to resume from (the resume decorator passes
 * the latest persisted checkpoint so the worker re-enters the loop at
 * `checkpoint.tick + 1`), and an optional `paced` flag selecting the real-time
 * paced loop (Overdrive off). `postMessage` structured-clones both across the
 * thread boundary, preserving the checkpoint's `±Infinity` / `-0` fields.
 */
interface BattleWorkerRequest {
  inputs: BattleInputs;
  resumeFrom?: EngineCheckpoint;
  paced?: boolean;
}

/** Narrow an unknown incoming message to the start request. */
function isBattleWorkerRequest(value: unknown): value is BattleWorkerRequest {
  if (typeof value !== "object" || value === null) return false;
  return "inputs" in value;
}

/**
 * Worker entry for the battle simulation. Receives `{ inputs, resumeFrom? }`
 * (structured-cloned across the thread boundary by `postMessage`), drives the
 * deterministic generator, and streams frame batches back as
 * `{ kind: 'frames' }` messages (each carrying the latest captured checkpoint,
 * if any) before posting a final `{ kind: 'result' }` carrying a
 * {@link BattleResultSummary} — the full `BattleResult` MINUS its `frames`,
 * which were already streamed in batches. The main thread reassembles the
 * full result by appending the accumulated streamed frames to the summary.
 *
 * Streaming lets the main thread begin rendering replay frames while the
 * simulation is still running, rather than waiting for the whole battle to
 * finish before receiving any data. The forwarded checkpoints let the resume
 * decorator persist the latest in-progress state so an interrupted run resumes
 * from there. Posting the summary without re-sending the frame array avoids a
 * second structured clone of the (potentially hundreds-of-megabytes) frames
 * at end-of-battle — the frames already crossed the boundary in batches.
 */
self.onmessage = (event: MessageEvent<unknown>) => {
  if (!isBattleWorkerRequest(event.data)) return;
  const { inputs, resumeFrom, paced } = event.data;
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

  // Frames are NOT accumulated for the result message: they were already
  // streamed in batches, and re-sending the full array on the terminal
  // message would re-clone the entire (potentially hundreds-of-MB) timeline.
  // The main thread reassembles the full BattleResult from the accumulated
  // streamed batches plus this summary.
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
    // Collect every typed-array buffer across all frames and ships in the
    // batch as the postMessage TRANSFER LIST. Transferred buffers cross the
    // thread boundary zero-copy (the source ArrayBuffer is detached and the
    // receiver takes ownership), eliminating the structured-clone cost that
    // was the source of the `[Violation] 'message' handler` warnings on the
    // heaviest frames. The typed arrays arrive on the main thread already
    // populated and typed; the receiver reads them positionally.
    const transferList: Transferable[] = collectTransferables(frames);
    self.postMessage(message, transferList);
  };

  /**
   * Post the terminal result summary. The full frame array was already streamed
   * in batches, so the summary carries no frames — re-sending them here would
   * re-clone the entire timeline and block the main thread on a deep parse. The
   * main thread reassembles the full BattleResult by appending the accumulated
   * streamed frames to this summary. `roster`, `descriptors`, and `salvage`
   * mirror runBattle's assembly so the reassembled result is byte-identical to a
   * fresh run. Shared by both the paced and tight compute paths.
   */
  const postResult = (summary: BattleSummary): void => {
    const resultSummary: BattleResultSummary = {
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
      roster: buildShipRoster(inputs.ships),
      descriptors: summary.descriptors,
      ...(summary.salvage.length > 0 ? { salvage: summary.salvage } : {}),
    };

    self.postMessage({
      kind: "result",
      summary: resultSummary,
    });
  };

  if (paced === true) {
    // Real-time paced loop (Overdrive off): compute at one sim-second per
    // real-second. A batch is posted every `ticksPerBatch` frames — a fixed
    // slice of sim-time (~STREAM_BATCH_INTERVAL_MS worth) — and after each post
    // the loop sleeps so wall-time tracks sim-time at 1x. If a batch takes
    // longer than its sim-time to compute (a battle heavier than real-time),
    // `aheadMs` is negative and no sleep occurs: the loop runs flat-out, so the
    // throttle is a ceiling, not a floor. The frame sequence is identical to the
    // tight loop — only batch boundaries and post timing differ — so the
    // reassembled result is byte-identical.
    const ticksPerBatch = Math.max(1, Math.round((TICKS_PER_SECOND * STREAM_BATCH_INTERVAL_MS) / 1000));
    const realStartMs = performance.now();
    let next = it.next();
    const simStartTick = !next.done ? next.value.tick : 0;
    const computeChunk = (): void => {
      while (!next.done) {
        batch.push(next.value);
        const batchTick = next.value.tick;
        next = it.next();
        if ((batchTick - simStartTick + 1) % ticksPerBatch === 0) {
          postBatch(batch);
          batch = [];
          if (!next.done) {
            const simElapsedMs = ((batchTick + 1 - simStartTick) / TICKS_PER_SECOND) * 1000;
            const wallElapsedMs = performance.now() - realStartMs;
            setTimeout(computeChunk, Math.max(0, simElapsedMs - wallElapsedMs));
            return;
          }
        }
      }
      if (batch.length > 0) postBatch(batch);
      postResult(next.value);
    };
    computeChunk();
    return;
  }

  // Default tight synchronous loop (Overdrive on, or `paced` omitted) — the
  // historical max-throughput path. It never yields, so it runs flat-out to
  // completion with no real-time pacing. Post a batch when enough wall-clock time
  // has elapsed since the last one; the frame count per batch scales with the
  // simulation's speed, so the main thread always receives several seconds of
  // playback per update.
  let next = it.next();
  while (!next.done) {
    const frame = next.value;
    batch.push(frame);

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

  postResult(next.value);
};
