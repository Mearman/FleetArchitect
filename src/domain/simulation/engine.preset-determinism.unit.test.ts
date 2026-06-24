import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
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
 * regenerate after an intended frame change: run the test, paste the new hash.
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
    const PINNED: Record<number, string> = {
      // regenerate after an intended frame change: run the test, paste the new hash.
      1: "f660859c47f0dfd71612d57f38ea111fca3e195f80e36bbfc1a3c0971611ba8c",
      7: "2f8d5c0413e6414ae7489bc8163f95e0cfa5d693b6785f41c0c76d8f91995564",
      99: "7b9054540b7c2592ab01bdf0f7e695535ce2b9c3433a8d3fd6aa863e7d304215",
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
      // regenerate after an intended frame change: run the test, paste the new hash.
      1: "ed6f5052a97906dea6775deb6cf7a1c551f4eb9f73c8ae1af4cb7537521ef8ff",
      7: "56d4598f97f623a8a47a87a2d256557b100dd8d102ef499fb3be2cf58a39f570",
      99: "189a4cb55717ae43f25b6c8bcdb39c1e3179a414ae2685bbd0d15e2336804fee",
    };

    for (const seed of SEEDS) {
      it(`seed ${seed} frame hash is pinned`, () => {
        const inputs = inputsFor("preset-fleet-drone-swarm", "preset-fleet-nexus-armada", seed);
        expect(frameHash(inputs)).toBe(PINNED[seed]);
      }, 300000);
    }
  });
});
