import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/hull";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Haiku-tier: the steering model applies torque (an angular acceleration)
 * and lets angular velocity persist, so the total turn reflects accumulated
 * angVel rather than a static per-tick step. We assert this by checking
 * that the closing ship has rotated and that the rotation exceeds what
 * the static `turnRate` would have produced on its own over the same
 * number of ticks — the difference is the contribution of persisting
 * angVel.
 *
 * Helper duplicated so this file is self-contained.
 */

function makeShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  turnRate?: number;
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
}): CombatShip {
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
    thrust: 0.5,
    turnRate: opts.turnRate ?? 0.05,
    weapons: (opts.weapons ?? []).map((w) => ({ slotId: `slot-${opts.id}`, effect: w })),
  };
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    orders: defaultOrders,
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

/** Smallest signed delta between two angles (radians), wrapped to (-π, π]. */
function angleDelta(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

describe("engine.angular-momentum", () => {
  it("rotates toward the target across the battle", () => {
    // Attacker faces +x, target sits at +y — must rotate ~π/2 to face it.
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          turnRate: 0.1,
        }),
        makeShip({
          id: "d1",
          side: "defender",
          x: 0,
          y: 150,
          structure: 5000,
        }),
      ]),
    );
    const f0 = result.frames[0];
    const fLast = result.frames.at(-1);
    if (f0 === undefined || fLast === undefined) throw new Error("no frames");
    const a0 = f0.ships.find((s) => s.instanceId === "a1");
    const aLast = fLast.ships.find((s) => s.instanceId === "a1");
    if (a0 === undefined || aLast === undefined) throw new Error("missing attacker");
    const facing0 = a0.facing ?? a0.x; // fallback keeps types happy
    const facingLast = aLast.facing ?? facing0;
    // The ship's facing must have moved toward π/2 (toward the target at +y).
    expect(Math.abs(facingLast)).toBeGreaterThan(0.3);
    expect(Math.abs(facingLast)).toBeLessThan(Math.PI / 2 + 0.2);
  });

  it("a single tick can turn faster than the static turn-rate cap (angular momentum)", () => {
    // The Newtonian model lets angVel accumulate, so the per-tick facing
    // change can exceed `turnRate` once angVel is built up. A purely static
    // model (facing += clamp(error, ±turnRate)) can never exceed turnRate
    // in a single tick. Finding a tick where the turn-rate is > turnRate
    // therefore proves angular velocity is persisting.
    const turnRate = 0.05;
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          facing: 0,
          turnRate,
        }),
        makeShip({ id: "d1", side: "defender", x: 0, y: 200, structure: 99999 }),
      ]),
    );
    const facings = result.frames.map(
      (f) => f.ships.find((s) => s.instanceId === "a1")?.facing,
    );
    let maxPerTickTurn = 0;
    for (let i = 1; i < facings.length; i++) {
      const prev = facings[i - 1];
      const cur = facings[i];
      if (prev === undefined || cur === undefined) continue;
      maxPerTickTurn = Math.max(maxPerTickTurn, Math.abs(angleDelta(prev, cur)));
    }
    // The Newtonian model must turn faster than the static cap at least once
    // — that's the whole point of accumulated angular momentum.
    expect(maxPerTickTurn).toBeGreaterThan(turnRate);
  });
});
