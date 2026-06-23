import type { BattleResult } from "@/schema/battle";

/**
 * Build a minimal, schema-valid `BattleResult` for adapter tests. The cache
 * stores and retrieves whole results by content key, so the tests only need a
 * value that round-trips through `BattleResult.parse`; the engine semantics are
 * irrelevant here. `frames` is empty (a valid, if degenerate, recorded battle)
 * and `seed` distinguishes otherwise-identical fixtures so a test can assert it
 * got the right value back.
 */
export function sampleResult(
  id: string,
  overrides?: Partial<BattleResult>,
): BattleResult {
  return {
    id,
    config: {
      attackerFleetId: "fleet-a",
      defenderFleetId: "fleet-b",
      anomalies: [],
      seed: 1,
    },
    winner: "attacker",
    ticks: 0,
    playedAt: "2026-01-01T00:00:00.000Z",
    frames: [],
    ...overrides,
  };
}
