import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/hull";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Sonnet-tier: pickTarget must choose the correct living enemy for each
 * orders.targetPriority. Each test arranges three enemies so the priority's
 * winner is unambiguous, then runs the battle and asserts the first hit
 * lands on that enemy.
 *
 * Helper duplicated so this file is self-contained.
 */

function weapon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 5,
    range: 1000,
    cooldown: 10,
    projectileSpeed: 0,
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
  shield?: number;
  cost?: number;
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  orders?: Partial<typeof defaultOrders>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const stats: ShipStats = {
    mass: 10,
    massCapacity: 100,
    cost: opts.cost ?? 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: opts.structure ?? 100,
    damageReduction: 0,
    shieldCapacity: opts.shield ?? 0,
    shieldRechargeRate: 1,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: weapons.map((w) => ({ slotId: `slot-${opts.id}`, effect: w })),
  };
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    orders: { ...defaultOrders, ...opts.orders },
    classification: (opts.classification ?? "frigate"),
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed: 1,
    maxTicks: 80,
  };
}

/** ID of the first defender to take a hit, or undefined if no one did. */
function firstHitTarget(
  result: ReturnType<typeof runBattle>,
  defenderIds: readonly string[],
): string | undefined {
  // Compare each frame's structure to the initial frame and return the
  // first defender whose structure dropped.
  const init = result.frames[0];
  if (init === undefined) return undefined;
  for (const frame of result.frames) {
    for (const id of defenderIds) {
      const initShip = init.ships.find((s) => s.instanceId === id);
      const cur = frame.ships.find((s) => s.instanceId === id);
      if (initShip && cur && cur.structure < initShip.structure) {
        return id;
      }
    }
  }
  return undefined;
}

describe("engine.targeting", () => {
  it("picks the nearest enemy when targetPriority is 'nearest'", () => {
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          weapons: [weapon()],
          orders: { targetPriority: "nearest" },
        }),
        // Distinct distances, all within the attacker's visual range so every
        // candidate is genuinely seen and the nearest (d1) wins on distance.
        makeShip({ id: "d1", side: "defender", x: 60, y: 0, structure: 500 }),
        makeShip({ id: "d2", side: "defender", x: 100, y: 0, structure: 500 }),
        makeShip({ id: "d3", side: "defender", x: 130, y: 0, structure: 500 }),
      ]),
    );
    expect(firstHitTarget(result, ["d1", "d2", "d3"])).toBe("d1");
  });

  it("picks the weakest enemy when targetPriority is 'weakest'", () => {
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          weapons: [weapon()],
          orders: { targetPriority: "weakest" },
        }),
        // Co-located within the attacker's visual range so neither distance nor
        // fog can decide — only the priority (structure) does. The weakest
        // (d2, structure 30) must be picked.
        makeShip({ id: "d1", side: "defender", x: 100, y: 0, structure: 300 }),
        makeShip({ id: "d2", side: "defender", x: 100, y: 0, structure: 30 }),
        makeShip({ id: "d3", side: "defender", x: 100, y: 0, structure: 200 }),
      ]),
    );
    expect(firstHitTarget(result, ["d1", "d2", "d3"])).toBe("d2");
  });

  it("picks the strongest enemy when targetPriority is 'strongest'", () => {
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          weapons: [weapon()],
          orders: { targetPriority: "strongest" },
        }),
        // Co-located within the attacker's visual range so only the priority
        // (structure) decides; the strongest (d3, structure 300) must be picked.
        makeShip({ id: "d1", side: "defender", x: 100, y: 0, structure: 50 }),
        makeShip({ id: "d2", side: "defender", x: 100, y: 0, structure: 120 }),
        makeShip({ id: "d3", side: "defender", x: 100, y: 0, structure: 300 }),
      ]),
    );
    expect(firstHitTarget(result, ["d1", "d2", "d3"])).toBe("d3");
  });

  it("picks the highest-cost enemy when targetPriority is 'highestCost'", () => {
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          weapons: [weapon()],
          orders: { targetPriority: "highestCost" },
        }),
        // Equal distances, equal structure, differing `cost` (the build cost).
        makeShip({ id: "d1", side: "defender", x: 100, y: 0, cost: 50, structure: 500 }),
        makeShip({ id: "d2", side: "defender", x: 100, y: 0, cost: 250, structure: 500 }),
        makeShip({ id: "d3", side: "defender", x: 100, y: 0, cost: 100, structure: 500 }),
      ]),
    );
    expect(firstHitTarget(result, ["d1", "d2", "d3"])).toBe("d2");
  });
});
