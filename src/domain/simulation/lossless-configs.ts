import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import type { Fleet } from "@/schema/fleet";
import type { BattleInputs } from "@/domain/simulation/types";
import { frameDigestLines } from "@/domain/simulation/test-frame-hash";

/**
 * The set of battles whose per-frame digests form the lossless-optimisation
 * baseline. A Phase 2 edit is proven lossless when {@link generateLosslessBaseline}
 * is byte-identical run against the edited engine versus the committed
 * `__lossless_baseline__.txt` (generated from clean main).
 *
 * Coverage spans the two fleet-size extremes — the lightest pair (8 ships) and
 * the heaviest (19 ships, the large arena medium grid and full N² awareness) —
 * across three seeds, mirroring the six canonical pinned configs in
 * `engine.preset-determinism`, plus four diverse cross-faction matchups for
 * breadth (different module mixes, deployment footprints, and weapon types).
 * The extras run at a reduced tick cap: the lossless proof needs diverse
 * coverage of the hot paths, not full battle resolution.
 */
export interface LosslessConfig {
  readonly label: string;
  readonly build: () => BattleInputs;
}

const designs = new Map(presetDesigns.map((design) => [design.id, design]));

function fleetById(id: string): Fleet {
  const fleet = presetFleets.find((entry) => entry.id === id);
  if (fleet === undefined) {
    throw new Error(`preset fleet not found: ${id}`);
  }
  return fleet;
}

function inputsFor(
  attackerFleetId: string,
  defenderFleetId: string,
  seed: number,
  maxTicks: number,
): BattleInputs {
  const attacker = fleetById(attackerFleetId);
  const defender = fleetById(defenderFleetId);
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

const PINNED_PAIRS: ReadonlyArray<{
  readonly label: string;
  readonly attacker: string;
  readonly defender: string;
}> = [
  { label: "smallest", attacker: "preset-fleet-concord", defender: "preset-fleet-foundry" },
  { label: "largest", attacker: "preset-fleet-drone-swarm", defender: "preset-fleet-nexus-armada" },
];

const SEEDS: readonly number[] = [1, 7, 99];

const EXTRA_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["preset-fleet-battleline", "preset-fleet-collective"],
  ["preset-fleet-reavers", "preset-fleet-concord"],
  ["preset-fleet-carrier-group", "preset-fleet-foundry"],
  ["preset-fleet-skirmisher-line", "preset-fleet-drone-swarm"],
];

function buildConfigs(): LosslessConfig[] {
  const configs: LosslessConfig[] = [];
  for (const pair of PINNED_PAIRS) {
    for (const seed of SEEDS) {
      const label = `${pair.label}#${seed}`;
      const attacker = pair.attacker;
      const defender = pair.defender;
      configs.push({
        label,
        build: () => inputsFor(attacker, defender, seed, 40),
      });
    }
  }
  EXTRA_PAIRS.forEach(([attacker, defender], index) => {
    configs.push({
      label: `extra${index}`,
      build: () => inputsFor(attacker, defender, 42, 60),
    });
  });
  return configs;
}

export const LOSSLESS_CONFIGS: readonly LosslessConfig[] = buildConfigs();

/**
 * Generate the full per-frame digest baseline: one `<label>\t<tick>\t<hash>` line
 * per frame across every {@link LOSSLESS_CONFIGS}. Deterministic for a given
 * engine; committing this output from clean main gives the reference every
 * lossless edit is diffed against.
 */
export function generateLosslessBaseline(): string {
  const lines = LOSSLESS_CONFIGS.flatMap((config) =>
    frameDigestLines(config.build(), config.label),
  );
  return `${lines.join("\n")}\n`;
}
