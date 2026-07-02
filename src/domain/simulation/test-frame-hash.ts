import { createHash } from "node:crypto";
import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs } from "@/domain/simulation/types";

/**
 * Run a battle and return a SHA-256 digest of the serialised frame stream — the
 * canonical byte-identity check. Two runs with identical inputs must return the
 * same hash (determinism), and a lossless change must leave it unchanged (the
 * {@link ../engine.preset-determinism.unit.test} regression pins the canonical
 * values per preset pair and seed).
 *
 * Shared by the determinism suite and the per-feature oracle/optimised
 * equivalence tests added by the lossless-optimisation pass, so every
 * byte-identity assertion uses one definition rather than a per-test copy. The
 * `structuredClone` keeps each run independent of the caller's ships (the engine
 * mutates in place).
 */
export function frameHash(inputs: BattleInputs): string {
  const result = runBattle({ ...inputs, ships: structuredClone(inputs.ships) });
  return createHash("sha256").update(JSON.stringify(result.frames)).digest("hex");
}

/**
 * Per-frame SHA-256 digests for one battle, as `<label>\t<tick>\t<hash>` lines.
 * Unlike {@link frameHash}'s single whole-stream hash, this returns one hash per
 * frame so a lossless-edit regression localises to the tick of the first byte
 * divergence, not just "the stream changed somewhere". Each frame uses the same
 * `JSON.stringify` serialisation as {@link frameHash}, so a change caught here is
 * exactly a change the pinned-hash regression would catch — just localised.
 *
 * Used by the manual lossless baseline (`engine.lossless-digest.integration`)
 * that gates every Phase 2 lossless optimisation: a change is proven lossless
 * when its per-frame digests are byte-identical to the committed baseline.
 */
export function frameDigestLines(inputs: BattleInputs, label: string): string[] {
  const result = runBattle({ ...inputs, ships: structuredClone(inputs.ships) });
  return result.frames.map((frame, tick) => {
    const hash = createHash("sha256").update(JSON.stringify(frame)).digest("hex");
    return `${label}\t${tick}\t${hash}`;
  });
}
