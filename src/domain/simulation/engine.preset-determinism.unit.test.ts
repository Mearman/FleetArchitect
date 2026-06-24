import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import { PINNED_FRAME_HASHES } from "@/domain/cache/algorithm-signature";
import type { BattleInputs } from "@/domain/simulation/types";

/**
 * Determinism regression: pin the canonical SHA-256 frame hash for the smallest
 * and largest preset fleet pairs across three seeds. Any future optimisation
 * that drifts even a single frame byte will turn one of these red.
 *
 * Fleets:
 *  - Smallest pair: Phase Lance (preset-fleet-concord, 4 Shards) vs Iron Wall
 *    (preset-fleet-foundry, 4 Anvils) — 8 ships total, the lightest pair.
 *  - Largest pair: Drone Swarm (preset-fleet-drone-swarm, 11 ships) vs Nexus
 *    Armada (preset-fleet-nexus-armada, 8 ships) — 19 ships total, the two
 *    heaviest fleets in the preset catalogue.
 *
 * The pinned hashes live in `@/domain/cache/algorithm-signature`, where they
 * are the single source of truth for BOTH this regression test and the
 * refactor-stable algorithm signature that keys the deterministic result cache.
 * regenerate after an intended frame change: update PINNED_FRAME_HASHES in the
 * shared module; both this test and the cache key follow automatically.
 */

/** Run a battle and return a SHA-256 digest of the serialised frame stream. */
function frameHash(inputs: BattleInputs): string {
  const result = runBattle({ ...inputs, ships: structuredClone(inputs.ships) });
  return createHash("sha256").update(JSON.stringify(result.frames)).digest("hex");
}

/** Build a battle inputs snapshot from two preset fleet ids at a given seed. */
function inputsFor(
  attackerFleetId: string,
  defenderFleetId: string,
  seed: number,
  maxTicks = 40,
): BattleInputs {
  const designs = new Map(presetDesigns.map((d) => [d.id, d]));
  const attacker = presetFleets.find((f) => f.id === attackerFleetId);
  const defender = presetFleets.find((f) => f.id === defenderFleetId);
  if (attacker === undefined || defender === undefined) {
    throw new Error(`preset fleet not found: ${attackerFleetId} or ${defenderFleetId}`);
  }
  const ships = [
    ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
    ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
  ];
  return {
    ships,
    attackerFleetId,
    defenderFleetId,
    anomalies: [],
    seed,
    maxTicks,
  };
}

const SEEDS: number[] = [1, 7, 99];

describe("preset-fleet frame determinism regression", () => {
  describe("smallest pair: Phase Lance vs Iron Wall", () => {
    // PINNED_FRAME_HASHES is the shared single source of truth: the cache key's
    // algorithm term hashes its canonical serialisation, so any pinned-hash
    // update also flips every cache key automatically.
    const PINNED: Record<number, string> = {
      1: PINNED_FRAME_HASHES[0],
      7: PINNED_FRAME_HASHES[1],
      99: PINNED_FRAME_HASHES[2],
    };

    for (const seed of SEEDS) {
      it(`seed ${seed} frame hash is pinned`, () => {
        const inputs = inputsFor("preset-fleet-concord", "preset-fleet-foundry", seed);
        expect(frameHash(inputs)).toBe(PINNED[seed]);
      }, 60000);
    }
  });

  describe("largest pair: Drone Swarm vs Nexus Armada", () => {
    const PINNED: Record<number, string> = {
      1: PINNED_FRAME_HASHES[3],
      7: PINNED_FRAME_HASHES[4],
      99: PINNED_FRAME_HASHES[5],
    };

    for (const seed of SEEDS) {
      it(`seed ${seed} frame hash is pinned`, () => {
        const inputs = inputsFor("preset-fleet-drone-swarm", "preset-fleet-nexus-armada", seed);
        expect(frameHash(inputs)).toBe(PINNED[seed]);
      }, 300000);
    }
  });
});
