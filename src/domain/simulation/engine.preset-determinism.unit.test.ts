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
      1: "fd1f16f9dca7c3d147dee825ed1e296dcff02385d29d15db562c015fac81bca2",
      7: "5c650a6b021fa852034ff5d79579e9160f3fe2bd27c42b91f165530d657b3291",
      99: "89fb24a25d7688ca0338b5627d3dbffbf3fddf91104ad85c75a0d6b6c74869dd",
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
      1: "f0203be2a0b5a9503961f2b2e09e178619d25f052f814812c86473e293b38142",
      7: "61c16b7cfde1192a054cf0047d661a30cc92892f3afe00e4c729a3bf8efaee75",
      99: "5cdbb4a6bd2da5954f97841c54c58e157e27c2bf5c5939850ca8b99c0ac2c122",
    };

    for (const seed of SEEDS) {
      it(`seed ${seed} frame hash is pinned`, () => {
        const inputs = inputsFor("preset-fleet-drone-swarm", "preset-fleet-nexus-armada", seed);
        expect(frameHash(inputs)).toBe(PINNED[seed]);
      }, 300000);
    }
  });
});
