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
    anomaly: "none",
    seed,
    maxTicks,
  };
}

const SEEDS: number[] = [1, 7, 99];

describe("preset-fleet frame determinism regression", () => {
  describe("smallest pair: Phase Lance vs Iron Wall", () => {
    const PINNED: Record<number, string> = {
      // regenerate after an intended frame change: run the test, paste the new hash.
      1: "00260adf4e98ade3c7d8c5d24fea6be9bb9a7d340b99501516b94c6311af96fb",
      7: "c1a71f0bfd7c253d6660beeb7edffced655f9864a90f5cfe63a3136a2d841a35",
      99: "f19dc8cea07e1f9d3bb49375a066923c74211c1737b6177af06151ca58a54926",
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
      1: "9ab271ba57abcd2c76ed4ab736822f31f90de34b3f4e218579ef368902261e0c",
      7: "bcbeb35f3dfb3a1680359dd6da82b7a917e6c33a5a2bbdca6bb04e27b2e69395",
      99: "eee2913266ab8674191f329fc0484859c496c53fcc7f700a8cc39e8b03c440ef",
    };

    for (const seed of SEEDS) {
      it(`seed ${seed} frame hash is pinned`, () => {
        const inputs = inputsFor("preset-fleet-drone-swarm", "preset-fleet-nexus-armada", seed);
        expect(frameHash(inputs)).toBe(PINNED[seed]);
      }, 300000);
    }
  });
});
