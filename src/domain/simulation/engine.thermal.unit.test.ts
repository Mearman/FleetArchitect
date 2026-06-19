/**
 * Thermal + radiator physics unit tests (Phase 12).
 *
 * Asserts the honest physics: a body with constant heat input and a
 * finite radiator area converges to the Stefan-Boltzmann equilibrium
 * temperature `T_eq = (P_in / (sigma * A))^(1/4)`, that radiated power
 * follows `sigma * T^4 * A`, and that the integrator is deterministic
 * (same inputs produce byte-identical sequences).
 *
 * Test inputs are physical anchors, not magic numbers:
 *   - Specific heat capacity of aluminium, 910 J kg^-1 K^-1 (CRC Handbook
 *     value; a real material property used to derive the body heat capacity
 *     from mass).
 *   - A 10 kg hull → C = 10 * 910 = 9100 J/K.
 *   - Reactor heat input of 1 MJ/tick → continuous power of
 *     1e6 / (1/30) = 3e7 W (30 MW), a plausible reactor output.
 *   - Radiator area of 50 m^2 of equivalent black-body surface.
 */

import { describe, expect, it } from "vitest";

import {
  STEFAN_BOLTZMANN_CONSTANT,
  SECONDS_PER_TICK,
  equilibriumTemperatureK,
  radiatedPowerWatts,
  stepThermal,
  thermalStateAt,
  totalHeatInputJoules,
} from "@/domain/simulation/engine/thermal";
import type { HeatSource, ThermalState } from "@/domain/simulation/engine/thermal";

/** Specific heat capacity of aluminium, J kg^-1 K^-1 (CRC Handbook). A real
 *  material property; the body heat capacity is mass * c_specific. */
const SPECIFIC_HEAT_ALUMINIUM_J_PER_KG_K = 910;

/** Hull mass for the test ship (kg). Physical anchor for heat capacity. */
const HULL_MASS_KG = 10;

/** Body heat capacity C (J/K), derived from mass and specific heat. */
const HEAT_CAPACITY_J_PER_K = HULL_MASS_KG * SPECIFIC_HEAT_ALUMINIUM_J_PER_KG_K;

/** Effective black-body radiator area (m^2). Physical anchor: square metres
 *  of equivalent radiating surface (area folded with emissivity). */
const RADIATOR_AREA_M2 = 50;

/** Reactor heat input per tick (joules). Physical anchor: energy per tick. */
const REACTOR_HEAT_J_PER_TICK = 1_000_000;

/** Continuous reactor power (watts) = per-tick energy / tick duration. */
const REACTOR_POWER_W = REACTOR_HEAT_J_PER_TICK / SECONDS_PER_TICK;

const REACTOR_SOURCE: HeatSource = {
  origin: "reactor",
  joulesPerTick: REACTOR_HEAT_J_PER_TICK,
};

/** Relative tolerance for convergence to the analytic equilibrium. The
 *  explicit-Euler integrator approaches T_eq asymptotically; after many
 *  ticks the residual is far below this. Documented epsilon. */
const EQUILIBRIUM_REL_TOLERANCE = 1e-6;

describe("thermal physics", () => {
  describe("radiatedPowerWatts", () => {
    it("follows the Stefan-Boltzmann law sigma * T^4 * A", () => {
      const temperatureK = 300;
      const expected =
        STEFAN_BOLTZMANN_CONSTANT * temperatureK ** 4 * RADIATOR_AREA_M2;
      expect(radiatedPowerWatts(temperatureK, RADIATOR_AREA_M2)).toBe(expected);
    });

    it("returns zero at and below absolute zero", () => {
      expect(radiatedPowerWatts(0, RADIATOR_AREA_M2)).toBe(0);
      expect(radiatedPowerWatts(-5, RADIATOR_AREA_M2)).toBe(0);
    });
  });

  describe("equilibriumTemperatureK", () => {
    it("solves P_in == sigma * T^4 * A for T", () => {
      const T = equilibriumTemperatureK(
        REACTOR_HEAT_J_PER_TICK,
        RADIATOR_AREA_M2,
      );
      // Round-trip: at T_eq, radiated power must equal input power.
      const radiatedAtEq = radiatedPowerWatts(T, RADIATOR_AREA_M2);
      expect(radiatedAtEq).toBeCloseTo(REACTOR_POWER_W, 6);
    });

    it("returns 0 K when there is no heat input", () => {
      expect(equilibriumTemperatureK(0, RADIATOR_AREA_M2)).toBe(0);
    });

    it("returns +Infinity when there is no radiator area", () => {
      expect(equilibriumTemperatureK(REACTOR_HEAT_J_PER_TICK, 0)).toBe(
        Number.POSITIVE_INFINITY,
      );
    });
  });

  describe("totalHeatInputJoules", () => {
    it("sums joules per tick across all sources", () => {
      const sources: HeatSource[] = [
        { origin: "reactor", joulesPerTick: 1_000 },
        { origin: "weapons", joulesPerTick: 2_500 },
        { origin: "engines", joulesPerTick: 4_000 },
      ];
      expect(totalHeatInputJoules(sources)).toBe(7_500);
    });

    it("returns 0 for an empty source list", () => {
      expect(totalHeatInputJoules([])).toBe(0);
    });
  });

  describe("stepThermal — equilibrium convergence", () => {
    it("a body with constant heat input converges to T_eq", () => {
      const T_eq = equilibriumTemperatureK(
        REACTOR_HEAT_J_PER_TICK,
        RADIATOR_AREA_M2,
      );
      // Start cold (2.7 K — the cosmic microwave background, a physical
      // ambient anchor) and integrate for a large number of ticks.
      const ticks = 5_000_000;
      let state: ThermalState = thermalStateAt(2.7, HEAT_CAPACITY_J_PER_K);
      for (let i = 0; i < ticks; i += 1) {
        state = stepThermal(state, {
          sources: [REACTOR_SOURCE],
          radiatorAreaM2: RADIATOR_AREA_M2,
          heatCapacityJPerK: HEAT_CAPACITY_J_PER_K,
        });
      }
      expect(state.temperatureK).toBeCloseTo(T_eq, 4);
      expect(
        Math.abs(state.temperatureK - T_eq) / T_eq,
      ).toBeLessThan(EQUILIBRIUM_REL_TOLERANCE);
    });

    it("stores energy consistent with temperature and heat capacity at equilibrium", () => {
      const T_eq = equilibriumTemperatureK(
        REACTOR_HEAT_J_PER_TICK,
        RADIATOR_AREA_M2,
      );
      const ticks = 5_000_000;
      let state: ThermalState = thermalStateAt(0, HEAT_CAPACITY_J_PER_K);
      for (let i = 0; i < ticks; i += 1) {
        state = stepThermal(state, {
          sources: [REACTOR_SOURCE],
          radiatorAreaM2: RADIATOR_AREA_M2,
          heatCapacityJPerK: HEAT_CAPACITY_J_PER_K,
        });
      }
      expect(state.energyJ).toBeCloseTo(
        T_eq * HEAT_CAPACITY_J_PER_K,
        0,
      );
    });

    it("a body with no heat input and positive area cools monotonically toward 0 K", () => {
      // Radiative cooling is `sigma * T^4 * A`, so the body decays
      // asymptotically toward 0 K. After many ticks it must be well below
      // its starting temperature and never negative.
      let state: ThermalState = thermalStateAt(400, HEAT_CAPACITY_J_PER_K);
      let previous = state.temperatureK;
      for (let i = 0; i < 200_000; i += 1) {
        state = stepThermal(state, {
          sources: [],
          radiatorAreaM2: RADIATOR_AREA_M2,
          heatCapacityJPerK: HEAT_CAPACITY_J_PER_K,
        });
        // Monotonic non-increasing: no overshoot, no heating without input.
        expect(state.temperatureK).toBeLessThanOrEqual(previous);
        previous = state.temperatureK;
      }
      expect(state.temperatureK).toBeLessThan(400);
      expect(state.temperatureK).toBeGreaterThanOrEqual(0);
    });

    it("temperature never goes negative, even under an oversized cooling step", () => {
      // A single step whose radiative term would otherwise carry T below 0.
      // The integrator clamps to the 0 K physical floor rather than letting
      // temperature go negative.
      const state: ThermalState = thermalStateAt(1, HEAT_CAPACITY_J_PER_K);
      const cooled = stepThermal(state, {
        sources: [],
        radiatorAreaM2: 1e12,
        heatCapacityJPerK: HEAT_CAPACITY_J_PER_K,
      });
      expect(cooled.temperatureK).toBeGreaterThanOrEqual(0);
    });

    it("does not mutate the input state", () => {
      const initial = thermalStateAt(300, HEAT_CAPACITY_J_PER_K);
      const snapshot: ThermalState = { ...initial };
      stepThermal(initial, {
        sources: [REACTOR_SOURCE],
        radiatorAreaM2: RADIATOR_AREA_M2,
        heatCapacityJPerK: HEAT_CAPACITY_J_PER_K,
      });
      expect(initial).toEqual(snapshot);
    });
  });

  describe("stepThermal — determinism", () => {
    it("two runs from identical inputs produce identical sequences", () => {
      const run = (): readonly ThermalState[] => {
        let state: ThermalState = thermalStateAt(100, HEAT_CAPACITY_J_PER_K);
        const frames: ThermalState[] = [];
        for (let i = 0; i < 1_000; i += 1) {
          state = stepThermal(state, {
            sources: [REACTOR_SOURCE],
            radiatorAreaM2: RADIATOR_AREA_M2,
            heatCapacityJPerK: HEAT_CAPACITY_J_PER_K,
          });
          frames.push(state);
        }
        return frames;
      };
      const a = run();
      const b = run();
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i += 1) {
        expect(a[i]).toEqual(b[i]);
      }
    });
  });
});
