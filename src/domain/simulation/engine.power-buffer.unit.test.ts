import { describe, expect, it } from "vitest";
import {
  TICK_DURATION_SECONDS,
  netPower,
  stepEnergyBuffer,
  stepPowerBudget,
} from "@/domain/simulation/engine/power";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import type {
  EnergyBuffer,
  PowerBudget,
  PowerTerminal,
} from "@/domain/simulation/engine/power";

/**
 * Phase 12 power-economy unit tests.
 *
 * These test the **pure** energy-buffer stepper in isolation: power
 * conservation (buffer delta == net over a step), a balanced budget holding
 * the buffer steady, clamping at the physical bounds, and determinism. The
 * deferred gameplay effects (brownout, reactor trip) are intentionally not
 * asserted — the clamp keeps the state valid without acting on a deficit.
 *
 * The sibling `engine.power.unit.test.ts` covers the integrated per-module
 * grid through `runBattle`; this file covers the underlying buffer physics.
 */

/** A source terminal delivering `watts` to the grid. */
function source(watts: number): PowerTerminal {
  return { watts, direction: "source" };
}

/** A sink terminal drawing `watts` from the grid. */
function sink(watts: number): PowerTerminal {
  return { watts, direction: "sink" };
}

/** A buffer charged to `energy` out of `capacity` joules. */
function buffer(energy: number, capacity: number): EnergyBuffer {
  return { energy, capacityJoules: capacity };
}

describe("engine/power netPower", () => {
  it("sums sources positively and sinks negatively", () => {
    // One 1 kW reactor feeding a 300 W sensor and a 100 W beam controller:
    // net = 1000 − 300 − 100 = 600 W.
    const net = netPower([source(1000), sink(300), sink(100)]);
    expect(net).toBe(600);
  });

  it("an empty terminal set has zero net power", () => {
    expect(netPower([])).toBe(0);
  });

  it("is order-stable (deterministic for a fixed input)", () => {
    const a = netPower([source(100), sink(30), sink(20)]);
    const b = netPower([source(100), sink(30), sink(20)]);
    expect(a).toBe(b);
  });
});

describe("engine/power stepEnergyBuffer — conservation", () => {
  it("buffer delta equals net power times the tick duration", () => {
    // Power conservation: ΔE = P_net · dt. Pick values that do not hit the
    // clamp so the unclamped result is observed directly.
    // 250 W net for one tick (1/30 s) → ΔE = 250 / 30 ≈ 8.333 J.
    const start = buffer(1000, 100_000);
    const netWatts = 250;
    const expectedDelta = netWatts * TICK_DURATION_SECONDS;

    const next = stepEnergyBuffer(start, netWatts);

    expect(next.energy - start.energy).toBeCloseTo(expectedDelta, 10);
    expect(next.capacityJoules).toBe(start.capacityJoules);
  });

  it("a negative net drains the buffer by exactly net · dt", () => {
    // 400 W deficit for one tick → ΔE = −400 / 30 ≈ −13.333 J.
    const start = buffer(500, 100_000);
    const netWatts = -400;
    const expectedDelta = netWatts * TICK_DURATION_SECONDS;

    const next = stepEnergyBuffer(start, netWatts);

    expect(start.energy - next.energy).toBeCloseTo(-expectedDelta, 10);
  });

  it("the tick duration is the reciprocal of TICKS_PER_SECOND", () => {
    // Locks the physics anchor: dt is derived from the canonical rate, not
    // authored as an independent constant.
    expect(TICK_DURATION_SECONDS).toBe(1 / TICKS_PER_SECOND);
  });
});

describe("engine/power stepEnergyBuffer — balanced budget", () => {
  it("a balanced budget (net zero) holds the buffer steady", () => {
    // Reactor supplies exactly what the modules draw: net = 0, so the buffer
    // neither charges nor drains over the step.
    const start = buffer(12_500, 100_000);
    const next = stepEnergyBuffer(start, 0);
    expect(next.energy).toBe(start.energy);
  });

  it("equal source and sink totals hold the buffer steady via the budget", () => {
    // 800 W reactor, two 400 W sinks: net = 0.
    const budget: PowerBudget = {
      buffer: buffer(7500, 50_000),
      terminals: [source(800), sink(400), sink(400)],
    };
    const next = stepPowerBudget(budget);
    expect(next.energy).toBe(budget.buffer.energy);
  });
});

describe("engine/power stepEnergyBuffer — clamping (use deferred)", () => {
  it("clamps at zero rather than going negative", () => {
    // A deficit larger than the stored energy would drive the buffer below
    // zero. The stepper clamps to zero — the ship is out of stored energy but
    // no brownout/trip is enforced (deferred).
    const start = buffer(10, 100_000);
    // −10_000 W for 1/30 s would drain ~333 J, far more than the 10 J held.
    const next = stepEnergyBuffer(start, -10_000);
    expect(next.energy).toBe(0);
  });

  it("clamps at capacity rather than overfilling", () => {
    // A surplus that would exceed capacity clamps to capacity. Excess energy
    // dissipates (no gameplay consequence enforced here — deferred).
    const start = buffer(99_990, 100_000);
    // 10_000 W for 1/30 s ≈ 333 J, which would push 99_990 + 333 over 100_000.
    const next = stepEnergyBuffer(start, 10_000);
    expect(next.energy).toBe(100_000);
  });

  it("does not act on a deficit beyond clamping (deferred behaviour)", () => {
    // The stepper returns only the post-step buffer; it does not flag a
    // brownout or trip a reactor. A caller that wants to idle modules reads
    // `next.energy === 0` and decides for itself.
    const start = buffer(0, 100_000);
    const next = stepEnergyBuffer(start, -500);
    expect(next).toEqual({ energy: 0, capacityJoules: 100_000 });
  });
});

describe("engine/power stepPowerBudget — integration of net and step", () => {
  it("applies the summed net to the buffer in one call", () => {
    // 1.5 kW reactor, 1 kW of sinks → net 500 W → ΔE = 500 / 30 ≈ 16.667 J.
    const budget: PowerBudget = {
      buffer: buffer(1000, 100_000),
      terminals: [source(1500), sink(600), sink(400)],
    };
    const expected = 1000 + 500 * TICK_DURATION_SECONDS;
    const next = stepPowerBudget(budget);
    expect(next.energy).toBeCloseTo(expected, 10);
  });

  it("a multi-step drain reaches zero in the physically correct number of ticks", () => {
    // Start with exactly enough energy to last N ticks at the given deficit,
    // then confirm the buffer hits zero on tick N and stays there.
    // E = |P| · dt · N  →  N = E / (|P| · dt).
    const capacity = 100_000;
    const deficitWatts = -300;
    const ticksToEmpty = 10;
    const initialEnergy = -deficitWatts * TICK_DURATION_SECONDS * ticksToEmpty;

    let current = buffer(initialEnergy, capacity);
    for (let i = 0; i < ticksToEmpty; i += 1) {
      current = stepEnergyBuffer(current, deficitWatts);
      // Strictly before the final tick the buffer must still be positive.
      if (i < ticksToEmpty - 1) {
        expect(current.energy).toBeGreaterThan(0);
      }
    }
    // On the final tick the unclamped value hits exactly zero.
    expect(current.energy).toBeCloseTo(0, 10);

    // One more tick must clamp at zero (no negative energy).
    const overdrawn = stepEnergyBuffer(current, deficitWatts);
    expect(overdrawn.energy).toBe(0);
  });
});

describe("engine/power determinism", () => {
  it("two identical budgets produce byte-identical buffer states", () => {
    const make = (): PowerBudget => ({
      buffer: buffer(4321, 99_999),
      terminals: [source(123.5), sink(67.25), sink(10), source(50)],
    });
    const a = stepPowerBudget(make());
    const b = stepPowerBudget(make());
    expect(a).toEqual(b);
  });

  it("a long fixed-input run produces a stable, repeatable trajectory", () => {
    // Drive the same budget for many ticks from two fresh starts and confirm
    // every frame matches. Exercises order-stability of the summation across
    // repeated calls.
    const run = (): number[] => {
      const trajectory: number[] = [];
      let current = buffer(10_000, 50_000);
      for (let i = 0; i < 100; i += 1) {
        current = stepEnergyBuffer(current, 75); // steady surplus
        trajectory.push(current.energy);
      }
      return trajectory;
    };
    expect(run()).toEqual(run());
  });
});
