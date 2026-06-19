import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/hull";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Haiku-tier: a ship whose structure drops below its retreatThreshold must
 * stop firing (it is `isRetreating`). We let the defender damage the
 * attacker below the threshold, then assert the attacker emits no
 * projectiles from the tick it crosses the threshold onward.
 *
 * Helper duplicated so this file is self-contained.
 */

function weapon(over: Partial<WeaponEffect>): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 300,
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
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  orders?: Partial<typeof defaultOrders>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const stats: ShipStats = {
    mass: 10,
    massCapacity: 100,
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
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

describe("engine.retreat-firing", () => {
  it("a ship damaged below its retreatThreshold fires no further projectiles", () => {
    // Attacker: low retreatThreshold, a cannon (visible projectiles).
    // Defender: holds position, hitscan with damage 60 — enough to drop the
    // attacker from 100 → 40 (below the 0.5 threshold) in a single hit.
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          weapons: [weapon({ weaponType: "cannon", projectileSpeed: 8, damage: 5, cooldown: 30, range: 600 })],
          orders: { retreatThreshold: 0.5 },
        }),
        makeShip({
          id: "d1",
          side: "defender",
          x: 0,
          y: 200,
          structure: 99999,
          weapons: [weapon({ damage: 60, range: 500, cooldown: 5 })],
          orders: { engageRange: "hold" },
        }),
      ]),
    );

    const initial = result.frames[0]?.ships.find((s) => s.instanceId === "a1");
    if (initial === undefined) throw new Error("missing initial attacker");
    const maxStructure = initial.structure + (result.frames[1]?.ships.find((s) => s.instanceId === "d1")?.structure ?? 0) === 0
      ? 100
      : 100; // the attacker's stats.structure is 100; max tracks that
    const retreatStart = maxStructure * 0.5;

    // Find the first tick at which the attacker is alive and below threshold.
    let retreatTick: number | undefined;
    for (const frame of result.frames) {
      const ship = frame.ships.find((s) => s.instanceId === "a1");
      if (ship?.alive === true && ship.structure < retreatStart) {
        retreatTick = frame.tick;
        break;
      }
    }
    expect(retreatTick, "attacker should be damaged below its retreat threshold").toBeDefined();
    if (retreatTick === undefined) return;

    // From the retreat tick onward, the attacker must not emit any
    // projectiles (the engine skips firing for retreating ships).
    const projectilesAfterRetreat = result.frames
      .filter((f) => f.tick >= retreatTick)
      .flatMap((f) => f.projectiles)
      .filter((p) => p.kind === "cannon");
    expect(projectilesAfterRetreat).toEqual([]);
  });
});
