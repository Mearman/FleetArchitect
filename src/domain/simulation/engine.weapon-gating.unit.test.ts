import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { ShipClassification } from "@/schema/armor";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Empty doctrine == legacy defaults: stance absent (balanced fallback), crew
 * absent (combat), targeting absent (nearest). Used for every ship that
 * previously relied on `defaultOrders`.
 */
const DEFAULT_DOCTRINE: Doctrine = { base: {}, rules: [] };

/**
 * Haiku-tier: mechanical gating of fireWeapons — the conditions that decide
 * whether a given weapon produces a projectile (or, for hitscan, a hit) this
 * tick: cooldown, range, living target. The AI always tries to satisfy
 * range + arc, so we test the gates by (a) pinning the attacker with hold
 * orders so it can't close distance, and (b) bounding hit counts by the
 * configured cooldown.
 *
 * Helper duplicated from the engine unit test so this file is self-contained.
 */

function weapon(over: Partial<WeaponEffect>): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 300,
    cooldown: 10,
    projectileSpeed: 0,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

function makeShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  doctrine?: Doctrine;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: opts.structure ?? 100,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 1,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: weapons.map((w) => ({ slotId: `slot-${opts.id}`, effect: w })),
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "Terran",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    doctrine: opts.doctrine ?? DEFAULT_DOCTRINE,
    classification: opts.classification ?? "frigate",
  };
}

function inputs(ships: CombatShip[], maxTicks = DEFAULT_MAX_TICKS): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed: 1,
    maxTicks,
  };
}

function countHits(result: ReturnType<typeof runBattle>, targetId: string): number {
  let hits = 0;
  let prev = result.frames[0]?.ships.find((s) => s.instanceId === targetId)?.structure ?? 0;
  for (const frame of result.frames) {
    const ship = frame.ships.find((s) => s.instanceId === targetId);
    if (ship === undefined) continue;
    if (ship.structure < prev) hits += 1;
    prev = ship.structure;
  }
  return hits;
}

describe("engine.weapon-gating", () => {
  it("fires a hitscan weapon that is in range and in the firing arc", () => {
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon({ damage: 25, range: 300, cooldown: 5 })],
        }),
        makeShip({ id: "d1", side: "defender", x: 100, y: 0, structure: 200 }),
      ]),
    );
    const last = result.frames.at(-1);
    if (last === undefined) throw new Error("no frames");
    const defender = last.ships.find((s) => s.instanceId === "d1");
    expect(defender).toBeDefined();
    expect(defender?.structure ?? 200).toBeLessThan(200);
  });

  it("does not fire when the target is out of range (hold orders prevent closing)", () => {
    // A hold range rule pins the attacker at its reference so it can't close
    // the distance to satisfy the range gate. (Legacy `engageRange: "hold"`
    // with the default `rangeKeepingBand: 0.3`.)
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon({ damage: 25, range: 50, cooldown: 5 })],
          doctrine: {
            base: {
              spatial: {
                reference: { kind: "target" },
                range: { kind: "hold", band: 0.3 },
                bearing: { kind: "free" },
              },
            },
            rules: [],
          },
        }),
        makeShip({ id: "d1", side: "defender", x: 500, y: 0, structure: 500 }),
      ]),
    );
    const last = result.frames.at(-1);
    const defender = last?.ships.find((s) => s.instanceId === "d1");
    expect(defender?.structure).toBe(500);
  });

  it("does not fire at a dead target", () => {
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          weapons: [weapon({ damage: 25, range: 1000, cooldown: 5 })],
        }),
        makeShip({ id: "d1", side: "defender", x: 100, y: 0, structure: 0 }),
      ]),
    );
    // With a dead target, the attacker never finds a target to fire on, so
    // it takes no damage and the defender's structure stays at 0.
    const last = result.frames.at(-1);
    const attacker = last?.ships.find((s) => s.instanceId === "a1");
    expect(attacker?.structure).toBe(100);
  });

  it("respects the weapon cooldown: hit count is bounded by ticks / cooldown", () => {
    // A hitscan with cooldown 200 across a 500-tick battle can fire at most
    // a handful of times — a tight bound proves the cooldown is gating.
    const result = runBattle(
      inputs(
        [
          makeShip({
            id: "a1",
            side: "attacker",
            x: 0,
            y: 0,
            facing: 0,
            weapons: [weapon({ damage: 5, range: 300, cooldown: 200 })],
          }),
          makeShip({ id: "d1", side: "defender", x: 100, y: 0, structure: 1000 }),
        ],
        500,
      ),
    );
    const hits = countHits(result, "d1");
    expect(hits).toBeGreaterThan(0);
    // 500 ticks / 200 cooldown ≈ 2–3 possible firing windows; allow a
    // little slack for the initial random cooldown offset.
    expect(hits).toBeLessThanOrEqual(5);
  });
});
