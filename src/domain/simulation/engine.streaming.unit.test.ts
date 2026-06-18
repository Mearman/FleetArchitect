import { describe, expect, it } from "vitest";
import { runBattle, simulateBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Unit tests for the `simulateBattle` generator: verify that the streaming
 * split is deterministic and byte-identical to `runBattle`, that the returned
 * summary matches, and that the generator yields frames incrementally.
 */

function weapon(over: Partial<WeaponEffect> = {}): WeaponEffect {
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
  structure?: number;
  weapons?: WeaponEffect[];
}): CombatShip {
  const weapons = opts.weapons ?? [weapon()];
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
    side: opts.side,
    stats,
    position: { x: opts.x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders },
    classification: "frigate",
  };
}

function fixedInputs(maxTicks = DEFAULT_MAX_TICKS): BattleInputs {
  return {
    ships: [
      makeShip({ id: "a1", side: "attacker", x: -100 }),
      makeShip({ id: "d1", side: "defender", x: 100 }),
    ],
    attackerFleetId: "fleet-attacker",
    defenderFleetId: "fleet-defender",
    anomaly: "none",
    seed: 42,
    maxTicks,
  };
}

describe("simulateBattle generator", () => {
  it("produces frames byte-identical to runBattle for the same seed", () => {
    const inputs = fixedInputs();
    const reference = runBattle(inputs);

    const generatorFrames = [];
    const gen = simulateBattle(inputs);
    let step = gen.next();
    while (!step.done) {
      generatorFrames.push(step.value);
      step = gen.next();
    }

    // Deep equality on each frame, not just length — byte-identical semantics.
    expect(generatorFrames).toStrictEqual(reference.frames);
    // JSON round-trip as a belt-and-braces check that no non-serialisable
    // values (undefined, NaN, cyclic refs) have slipped through.
    expect(JSON.stringify(generatorFrames)).toBe(JSON.stringify(reference.frames));
  });

  it("returned BattleSummary winner and ticks match runBattle", () => {
    const inputs = fixedInputs();
    const reference = runBattle(inputs);

    const gen = simulateBattle(inputs);
    let step = gen.next();
    while (!step.done) {
      step = gen.next();
    }
    const summary = step.value;

    expect(summary.winner).toBe(reference.winner);
    expect(summary.ticks).toBe(reference.ticks);
  });

  it("yields the tick-0 deployment frame before any tick advances", () => {
    const inputs = fixedInputs();
    const gen = simulateBattle(inputs);

    // First .next() must yield the deployment snapshot (tick 0) without
    // advancing the simulation at all.
    const first = gen.next();
    expect(first.done).toBe(false);
    if (first.done) return; // narrows away undefined for TS
    expect(first.value.tick).toBe(0);
  });

  it("yields frames strictly in ascending tick order", () => {
    const inputs = fixedInputs(20);

    const ticks: number[] = [];
    const gen = simulateBattle(inputs);
    let step = gen.next();
    while (!step.done) {
      ticks.push(step.value.tick);
      step = gen.next();
    }

    for (let i = 1; i < ticks.length; i += 1) {
      const prev = ticks[i - 1];
      const curr = ticks[i];
      if (prev === undefined || curr === undefined) continue;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("can be stepped one frame at a time, observing intermediate state before completion", () => {
    // A short battle so the loop terminates fast.
    const inputs = fixedInputs(10);
    const gen = simulateBattle(inputs);

    // Step past tick-0 and obtain tick-1 before consuming the rest.
    const tick0 = gen.next();
    expect(tick0.done).toBe(false);
    if (tick0.done) return;
    expect(tick0.value.tick).toBe(0);

    const tick1 = gen.next();
    expect(tick1.done).toBe(false);
    if (tick1.done) return;
    expect(tick1.value.tick).toBe(1);

    // Drain the rest and verify the generator terminates cleanly.
    let step = gen.next();
    while (!step.done) {
      step = gen.next();
    }
    expect(step.done).toBe(true);
    expect(step.value.winner).toMatch(/^attacker$|^defender$|^draw$/);
  });
});
