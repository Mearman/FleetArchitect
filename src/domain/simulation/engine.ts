import { createId, nowIso } from "@/domain/id";
import type { BattleResult } from "@/schema/battle";
import type { BattleInputs } from "./types";

/**
 * Deterministic battle simulator. Given resolved combat ships, an anomaly, and
 * a seed, advance a fixed-timestep simulation to completion and return a
 * replayable BattleResult whose frames conform to the battle schema.
 *
 * This file currently holds a PLACEHOLDER that emits a single initial frame, so
 * the battle viewer can render deployments before the full simulation lands.
 * The signature is stable: implement the real loop in place of this body.
 */
export function runBattle(inputs: BattleInputs): BattleResult {
  const initialFrame = {
    tick: 0,
    ships: inputs.ships.map((ship) => ({
      instanceId: ship.instanceId,
      side: ship.side,
      x: ship.position.x,
      y: ship.position.y,
      structure: ship.stats.structure,
      shield: ship.stats.shieldCapacity,
      alive: true,
    })),
    projectiles: [],
  };

  return {
    id: createId("battle"),
    config: {
      attackerFleetId: inputs.attackerFleetId,
      defenderFleetId: inputs.defenderFleetId,
      anomaly: inputs.anomaly,
      seed: inputs.seed,
    },
    winner: "draw",
    ticks: 0,
    playedAt: nowIso(),
    frames: [initialFrame],
  };
}
