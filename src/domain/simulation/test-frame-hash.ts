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
