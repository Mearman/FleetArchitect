import { describe, expect, it } from "vitest";
import { canonicalize, deriveCacheKey } from "@/domain/cache/key";
import {
  ENGINE_ALGORITHM_VERSION,
  getSimConfig,
} from "@/domain/cache/sim-config";
import type { SimConfig } from "@/domain/cache/sim-config";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ShipStats } from "@/domain/stats";

function shipStats(): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 50,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
  };
}

function ship(id: string, structure = 50): CombatShip {
  const stats = shipStats();
  stats.structure = structure;
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "attacker",
    stats,
    position: { x: 0, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
  };
}

function baseInputs(): BattleInputs {
  return {
    ships: [ship("a"), ship("b")],
    attackerFleetId: "fleet-attacker",
    defenderFleetId: "fleet-defender",
    anomalies: [],
    seed: 7,
  };
}

const SIM_CONFIG: SimConfig = getSimConfig();
const ALGO = ENGINE_ALGORITHM_VERSION;

describe("canonicalize", () => {
  it("is independent of object key insertion order", () => {
    const a = canonicalize({ x: 1, y: 2, z: { p: 3, q: 4 } });
    const b = canonicalize({ z: { q: 4, p: 3 }, y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("preserves array order", () => {
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("normalises -0 to 0", () => {
    expect(canonicalize(-0)).toBe(canonicalize(0));
    expect(canonicalize({ v: -0 })).toBe(canonicalize({ v: 0 }));
  });

  it("throws on NaN", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/NaN/);
    expect(() => canonicalize({ v: Number.NaN })).toThrow(/NaN/);
  });

  it("throws on Infinity", () => {
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(/Infinity/);
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(/Infinity/);
  });
});

describe("deriveCacheKey", () => {
  it("is independent of object key insertion order in the ships", async () => {
    const inputsA = baseInputs();
    const reordered: BattleInputs = {
      seed: inputsA.seed,
      anomalies: inputsA.anomalies,
      ships: inputsA.ships,
      defenderFleetId: inputsA.defenderFleetId,
      attackerFleetId: inputsA.attackerFleetId,
    };
    const keyA = await deriveCacheKey(inputsA, SIM_CONFIG, ALGO);
    const keyB = await deriveCacheKey(reordered, SIM_CONFIG, ALGO);
    expect(keyA).toBe(keyB);
  });

  it("treats an omitted maxTicks as the explicit DEFAULT_MAX_TICKS", async () => {
    const omitted = baseInputs();
    const explicit: BattleInputs = {
      ...baseInputs(),
      maxTicks: DEFAULT_MAX_TICKS,
    };
    const keyOmitted = await deriveCacheKey(omitted, SIM_CONFIG, ALGO);
    const keyExplicit = await deriveCacheKey(explicit, SIM_CONFIG, ALGO);
    expect(keyOmitted).toBe(keyExplicit);
  });

  it("does not change the key when only attacker/defender fleet ids change", async () => {
    const base = baseInputs();
    const relabelled: BattleInputs = {
      ...base,
      attackerFleetId: "totally-different-attacker",
      defenderFleetId: "totally-different-defender",
    };
    const keyBase = await deriveCacheKey(base, SIM_CONFIG, ALGO);
    const keyRelabelled = await deriveCacheKey(relabelled, SIM_CONFIG, ALGO);
    expect(keyBase).toBe(keyRelabelled);
  });

  it("changes the key when a ship stat changes", async () => {
    const base = baseInputs();
    const mutated: BattleInputs = {
      ...base,
      ships: [ship("a", 999), ship("b")],
    };
    const keyBase = await deriveCacheKey(base, SIM_CONFIG, ALGO);
    const keyMutated = await deriveCacheKey(mutated, SIM_CONFIG, ALGO);
    expect(keyBase).not.toBe(keyMutated);
  });

  it("changes the key when the seed changes", async () => {
    const base = baseInputs();
    const reseeded: BattleInputs = { ...base, seed: base.seed + 1 };
    const keyBase = await deriveCacheKey(base, SIM_CONFIG, ALGO);
    const keyReseeded = await deriveCacheKey(reseeded, SIM_CONFIG, ALGO);
    expect(keyBase).not.toBe(keyReseeded);
  });

  it("changes the key when the anomalies changes", async () => {
    const base = baseInputs();
    const withAnomaly: BattleInputs = { ...base, anomalies: ["blackHole"] };
    const keyBase = await deriveCacheKey(base, SIM_CONFIG, ALGO);
    const keyAnomaly = await deriveCacheKey(withAnomaly, SIM_CONFIG, ALGO);
    expect(keyBase).not.toBe(keyAnomaly);
  });

  it("changes the key when the simConfig changes", async () => {
    const base = baseInputs();
    const tweaked: SimConfig = {
      ...SIM_CONFIG,
      constants: {
        ...SIM_CONFIG.constants,
        GRAVITY_CONSTANT_ARENA: SIM_CONFIG.constants.GRAVITY_CONSTANT_ARENA + 1,
      },
    };
    const keyBase = await deriveCacheKey(base, SIM_CONFIG, ALGO);
    const keyTweaked = await deriveCacheKey(base, tweaked, ALGO);
    expect(keyBase).not.toBe(keyTweaked);
  });

  it("changes the key when the algorithm version changes", async () => {
    const base = baseInputs();
    const keyBase = await deriveCacheKey(base, SIM_CONFIG, ALGO);
    const keyBumped = await deriveCacheKey(base, SIM_CONFIG, ALGO + 1);
    expect(keyBase).not.toBe(keyBumped);
  });

  it("throws when a determinant contains NaN or Infinity", async () => {
    const nanInputs: BattleInputs = { ...baseInputs(), seed: Number.NaN };
    await expect(deriveCacheKey(nanInputs, SIM_CONFIG, ALGO)).rejects.toThrow(
      /NaN/,
    );
    const infInputs: BattleInputs = {
      ...baseInputs(),
      seed: Number.POSITIVE_INFINITY,
    };
    await expect(deriveCacheKey(infInputs, SIM_CONFIG, ALGO)).rejects.toThrow(
      /Infinity/,
    );
  });

  it("produces a 64-char lower-case hex SHA-256 digest", async () => {
    const key = await deriveCacheKey(baseInputs(), SIM_CONFIG, ALGO);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
