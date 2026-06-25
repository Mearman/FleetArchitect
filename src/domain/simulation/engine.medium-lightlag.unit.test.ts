import { describe, expect, it } from "vitest";

import { mulberry32 } from "@/domain/simulation/rng";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { mediumReceives } from "@/domain/simulation/engine/em-reception";
import { SPEED_OF_LIGHT_M_PER_TICK } from "@/domain/simulation/engine/config";
import { EM_HULL_AMBIENT_EMISSION } from "@/domain/simulation/engine/em-anchors";
import type { Emission } from "@/domain/simulation/engine/emissions";
import type { SimShip } from "@/domain/simulation/engine/types";
import { core, ship } from "@/domain/simulation/engine.awareness-helpers";

/**
 * Permanent startup light-lag sanity guard for sustained medium-cell radiation.
 *
 * Phase 4 coupled the medium field's excitation ε to the sensor system: excited
 * cells radiate and are detected through the inverse-square `continuousContact`
 * path (the steady-state path a hull's ambient self-emission uses). The
 * original implementation detected a just-ignited burn IMMEDIATELY at any
 * distance — no light-lag — which is the simplification the docstrings used to
 * admit: a sustained source collapses to a steady state ONCE light from the
 * burn has had time to cross the gap, but a JUST-IGNITED burn is not yet
 * visible at a distance. This test pins the STARTUP light-lag that the
 * continuous path now applies: a cell that began radiating at tick T is
 * detected by a receiver at distance D only on ticks
 * `T + ceil(D / c)` and onward — never at T (the immediate-detection bug), and
 * never before the light has crossed the gap. If this test ever goes red, the
 * startup light-lag has regressed; do not weaken the assertions — fix the gate.
 *
 * The test exercises the gate DIRECTLY on `mediumReceives` with a synthetic
 * emission so it can probe distances the catalogue-scale battlefield cannot
 * (light crosses a 5 km cell in well under a tick, so an integrated
 * preset-scale run cannot distinguish a one-tick startup delay from the
 * awareness-vs-medium-step ordering). Synthetic distances of many light-ticks
 * make the gate's mechanics unambiguous.
 */

/** Build a sensorless SimShip observer at (x, y) for the direct reception test.
 *  No modules beyond a bridge, no sensor saturation, no velocity — the bare
 *  baseline receiver the gate read in {@link mediumReceives} exercises. */
function baselineObserver(x: number, y: number): SimShip {
  return toSimShip(ship("obs", "defender", x, y, [...core()]), mulberry32(1));
}

/** An emission at distance `dist` along +x from the origin, with a strength
 *  chosen so the inverse-square reception comfortably clears the baseline
 *  noise floor at that distance (the test must not be gated by the floor —
 *  only by the light-lag). The emission's `t0` is the cell's birth tick. */
function emissionAt(dist: number, birthTick: number): Emission {
  // The hull-ambient emission is calibrated to be received exactly at the floor
  // at 5 km. Scale by (dist / 5000)² and ×100 so the received strength sits two
  // orders of magnitude above the floor — the contact decision is then the
  // light-lag gate's alone.
  const strength = EM_HULL_AMBIENT_EMISSION * (dist / 5000) * (dist / 5000) * 100;
  return {
    sourceId: "medium#0_0",
    x: dist,
    y: 0,
    strength,
    t0: birthTick,
  };
}

describe("engine.medium-lightlag — sustained radiation is light-lagged at startup", () => {
  it("a distant burn is NOT received before its light has crossed the gap", () => {
    // A cell ignites at tick T=10. The observer sits at D = 2.5 × c, so
    // ceil(D / c) = 3 ticks of light-time. The burn is invisible to the
    // observer until tick T + 3.
    const c = SPEED_OF_LIGHT_M_PER_TICK;
    const D = 2.5 * c; // ≈ 25 million metres — many light-ticks away
    const T = 10;
    const lightTicks = Math.ceil(D / c);
    expect(lightTicks).toBe(3);

    const observer = baselineObserver(0, 0);
    const emission = emissionAt(D, T);

    // The light-lag gate must suppress reception on every tick before the
    // light arrives. The PRIOR (broken) implementation detected the burn
    // immediately on every tick the cell was radiating — this is the
    // immediate-detection bug the test exists to catch.
    for (let t = T; t < T + lightTicks; t += 1) {
      expect(
        mediumReceives(observer, emission, t, []),
        `tick ${t} (T + ${t - T}, before light arrives at T + ${lightTicks}) must not receive the burn`,
      ).toBeUndefined();
    }
  });

  it("the burn IS received on the tick its first light arrives", () => {
    // Same geometry as above. At tick T + lightTicks, the first light emitted
    // at the birth tick reaches the observer; from then on the steady inverse-
    // square strength applies and the contact forms.
    const c = SPEED_OF_LIGHT_M_PER_TICK;
    const D = 2.5 * c;
    const T = 10;
    const lightTicks = Math.ceil(D / c);
    const observer = baselineObserver(0, 0);
    const emission = emissionAt(D, T);

    expect(
      mediumReceives(observer, emission, T + lightTicks, []),
      `tick T + lightTicks (${T + lightTicks}) must receive the burn — the first light has just arrived`,
    ).not.toBeUndefined();

    // And continues to be received on subsequent ticks (the steady state).
    expect(
      mediumReceives(observer, emission, T + lightTicks + 5, []),
    ).not.toBeUndefined();
  });

  it("the immediate-detection bug is gone: no contact at the ignition tick", () => {
    // The phase-4 bug detected the burn the instant it ignited, regardless of
    // distance. Pin that this is no longer the case: at the birth tick T the
    // observer sees NOTHING, even at a distance whose light-time is just one
    // tick. (The 1-tick case is the smallest meaningful gate — at catalogue
    // scale, where D is a few km, the startup delay is exactly one tick.)
    const c = SPEED_OF_LIGHT_M_PER_TICK;
    const D = 1.5 * c; // ceil(D / c) = 2
    const T = 4;
    const observer = baselineObserver(0, 0);
    const emission = emissionAt(D, T);

    // At the birth tick: NO contact (the burn literally just ignited; no light
    // has reached the observer yet).
    expect(
      mediumReceives(observer, emission, T, []),
      "the ignition tick must NOT receive the burn — the immediate-detection bug",
    ).toBeUndefined();
    // One tick later: still no contact (light-time is 2 ticks).
    expect(mediumReceives(observer, emission, T + 1, [])).toBeUndefined();
    // Two ticks later: the first light arrives.
    expect(mediumReceives(observer, emission, T + 2, [])).not.toBeUndefined();
  });

  it("a co-located observer (dist = 0) receives the burn from the birth tick", () => {
    // Sanity: an observer inside the emitting cell has zero light-time, so the
    // gate is `tick >= T + 0` and the burn is detected from the birth tick
    // onward. This pins that the gate does not over-suppress (the start-up
    // delay is bounded below by the light-time and goes to zero at zero
    // distance — the continuousContact path is unchanged for an observer at
    // the source). Use a directly-authored strength (not emissionAt, which
    // zeroes when dist = 0) so the inverse-square decision is not the limit.
    const T = 7;
    const observer = baselineObserver(0, 0);
    const emission: Emission = {
      sourceId: "medium#0_0",
      x: 0,
      y: 0,
      strength: EM_HULL_AMBIENT_EMISSION * 100,
      t0: T,
    };

    expect(
      mediumReceives(observer, emission, T, []),
      "a co-located observer must receive the burn from the birth tick (zero light-time)",
    ).not.toBeUndefined();
  });

  it("a never-radiating cell (t0 = -1) forms no contact regardless of tick or distance", () => {
    // The birthTick sentinel -1 means the cell is below the emission threshold
    // this tick and is not currently radiating. The gate must suppress it
    // unconditionally — even with a huge synthetic strength that would clear
    // the floor by orders of magnitude. This catches a regression where the
    // sentinel is mishandled and a near-zero ε cell is detected as a
    // sustained burn.
    const observer = baselineObserver(0, 0);
    const emission: Emission = {
      sourceId: "medium#0_0",
      x: 1000,
      y: 0,
      strength: 1e15,
      t0: -1,
    };
    expect(mediumReceives(observer, emission, 0, [])).toBeUndefined();
    expect(mediumReceives(observer, emission, 1000, [])).toBeUndefined();
  });
});
