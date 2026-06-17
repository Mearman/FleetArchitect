import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs } from "@/domain/simulation/types";

/**
 * Worker entry for the battle simulation. Receives `BattleInputs` (structured-
 * cloned across the thread boundary by `postMessage`), runs the deterministic
 * engine, and posts the `BattleResult` back. The engine is pure and carries no
 * DOM/React dependency, so it runs unchanged here.
 *
 * `BattleInputs` is the contract type carried verbatim across the boundary;
 * `runBattle` reads it directly, exactly as the main-thread path does.
 */
self.onmessage = (event: MessageEvent<BattleInputs>) => {
  const result = runBattle(event.data);
  self.postMessage(result);
};
