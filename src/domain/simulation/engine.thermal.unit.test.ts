import { describe, expect, it } from "vitest";

import {
  RADIATOR_FIN_AREA_FACTOR,
  REACTOR_THERMAL_EFFICIENCY,
  reactorWasteHeatWatts,
} from "@/data/catalog/combat-scale";
import {
  FUSION_POWER_DENSITY_W_PER_M3,
  moduleVolume,
} from "@/data/catalog/physics";
import {
  HULL_THERMAL_DIFFUSIVITY_M2_PER_S,
  RADIATOR_EMISSIVITY,
  SPACE_TEMPERATURE_K,
  makeThermalSubstance,
  radiatorEquilibriumTemperature,
} from "@/domain/simulation/engine/thermal";
import {
  STEFAN_BOLTZMANN_W_PER_M2_K4,
  TRANSPORT_GEOMETRY,
  stepTransportField,
} from "@/domain/simulation/engine/transport-field";
import { SIM } from "@/domain/simulation/engine/config";

/**
 * Thermal substance physics. φ = temperature (K); diffusion-only transport with
 * a radiative (T⁴) boundary outflux, both expressed as kelvin-per-second rates
 * by dividing the watt power terms by each cell's heat capacity (J/K). Tests
 * assert:
 *
 *   - diffusion equalises temperature between two cells;
 *   - the T⁴ outflux drains heat from a radiator cell;
 *   - a heat source raises temperature at `P / C` K/s (the heat-capacity term);
 *   - the deployed-fin radiator settles a fusion reactor's WASTE heat below the
 *     1500 K overheat threshold (the survival anchor);
 *   - thermal radiation carries no momentum (photon pressure ≈ µN at 300 K).
 */

/** Effective radiating area of one radiator cell, m² — both faces of the unit
 *  cell footprint, amplified by the deployed-fin factor. The tests reconstruct
 *  the analytic radiative balance from the same area the field uses. */
const EFFECTIVE_RADIATOR_AREA_M2 =
  2 * TRANSPORT_GEOMETRY.faceAreaM2 * RADIATOR_FIN_AREA_FACTOR;

describe("thermal substance", () => {
  it("uses the looked-up aluminium thermal diffusivity", () => {
    // Aluminium 6061 at 300 K: α ≈ 6.7e-5 m²/s. Asserted to within 5%.
    expect(HULL_THERMAL_DIFFUSIVITY_M2_PER_S).toBeCloseTo(6.7e-5, 1);
  });

  it("moves heat from the hotter cell to the colder cell at the documented rate", () => {
    // Aluminium conducts slowly (D ≈ 6.7e-5 m²/s), so over a handful of ticks
    // the temperatures barely move — but they move by exactly the analytic
    // amount. Diffusion is a temperature rate (not a power), so it is NOT scaled
    // by heat capacity: for two cells the discrete update is
    //   phi0_new = phi0 + D·(phi1 − phi0)·dt
    //   phi1_new = phi1 + D·(phi0 − phi1)·dt
    // (one open face each way, unit area and pitch).
    const substance = makeThermalSubstance(new Map(), new Set(), new Map());
    const faces = [
      { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
      { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
    ];
    const phi = [400, 200];
    const dt = 1 / 30;
    const expected0 = 400 + HULL_THERMAL_DIFFUSIVITY_M2_PER_S * (200 - 400) * dt;
    const expected1 = 200 + HULL_THERMAL_DIFFUSIVITY_M2_PER_S * (400 - 200) * dt;
    const result = stepTransportField(
      { substance, faces, boundaryCells: [] },
      phi,
    );
    expect(result.phi[0]!).toBeCloseTo(expected0, 6);
    expect(result.phi[1]!).toBeCloseTo(expected1, 6);
    // The hotter cell cooled and the colder cell warmed.
    expect(result.phi[0]!).toBeLessThan(400);
    expect(result.phi[1]!).toBeGreaterThan(200);
  });

  it("raises a heated cell's temperature at P / C kelvin per second", () => {
    // A heat source is a power (W); the field converts it to a temperature rate
    // by dividing by the cell's heat capacity: dT/dt = P / C. With a source of
    // P watts and a cell of C J/K, one tick raises the temperature by
    // (P / C)·dt. No radiator here, so the source is the only term.
    const powerWatts = 1e8; // 100 MW
    const heatCapacityJperK = 1e6; // 1 MJ/K
    const substance = makeThermalSubstance(
      new Map([[0, powerWatts]]),
      new Set(),
      new Map([[0, heatCapacityJperK]]),
    );
    const dt = 1 / 30;
    const phi = [300];
    const expected = 300 + (powerWatts / heatCapacityJperK) * dt;
    const result = stepTransportField(
      { substance, faces: [], boundaryCells: [] },
      phi,
    );
    expect(result.phi[0]!).toBeCloseTo(expected, 3);
  });

  it("drains heat through a radiator cell via the Stefan-Boltzmann flux", () => {
    // One cell with a radiator, no neighbours: the only heat loss is the
    // T⁴ boundary flux. Temperature should fall.
    const radiators = new Set([0]);
    const substance = makeThermalSubstance(
      new Map(),
      radiators,
      new Map([[0, 1e6]]),
    );
    const phi = [400];
    const result = stepTransportField(
      { substance, faces: [], boundaryCells: [0] },
      phi,
    );
    expect(result.phi[0]!).toBeLessThan(400);
    // No momentum: radiation pressure is negligible at ship scale.
    expect(result.momentumX).toBe(0);
    expect(result.momentumY).toBe(0);
  });

  it("settles a fusion reactor's waste heat below the overheat threshold", () => {
    // The survival anchor: a single radiator cell shedding a fusion reactor's
    // WASTE heat (output × (1/η − 1), not the full electrical output) must reach
    // a steady state below SIM.overheatThresholdK, or every reactor-equipped
    // ship would overheat to destruction. The steady state is heat-capacity-
    // independent: T = (P_waste / (ε·σ·A))^(1/4), with A the deployed-fin area.
    const fusionOutputW = FUSION_POWER_DENSITY_W_PER_M3 * moduleVolume("reactor");
    const wasteW = reactorWasteHeatWatts(fusionOutputW);
    const equilibrium = radiatorEquilibriumTemperature(wasteW);
    // Below the 1500 K material limit, with margin — the corvette in the
    // engagement integration test survives at exactly this figure.
    expect(equilibrium).toBeLessThan(SIM.overheatThresholdK);
    expect(equilibrium).toBeGreaterThan(1000); // hot, but holding (~1340 K)
    // Reconstruct the equilibrium condition: ε·σ·A·T⁴ ≈ P_waste.
    const radiated =
      RADIATOR_EMISSIVITY *
      STEFAN_BOLTZMANN_W_PER_M2_K4 *
      EFFECTIVE_RADIATOR_AREA_M2 *
      (equilibrium ** 4 - SPACE_TEMPERATURE_K ** 4);
    expect(radiated).toBeCloseTo(wasteW, 0);
  });

  it("reactor waste heat is a realistic fraction of electrical output", () => {
    // η = 0.85 advanced direct-conversion fusion: waste is output × (1/η − 1),
    // ~17.6% of output — far below the full output the field used to inject.
    const out = 1e9;
    expect(reactorWasteHeatWatts(out)).toBeCloseTo(out * (1 / 0.85 - 1), 0);
    expect(REACTOR_THERMAL_EFFICIENCY).toBeGreaterThan(0);
    expect(REACTOR_THERMAL_EFFICIENCY).toBeLessThan(1);
  });

  it("does not radiate from a non-radiator (insulated) boundary cell", () => {
    const substance = makeThermalSubstance(
      new Map(),
      new Set(),
      new Map([[0, 1e6]]),
    );
    const result = stepTransportField(
      { substance, faces: [], boundaryCells: [0] },
      [400],
    );
    // No radiator ⇒ no heat loss ⇒ temperature unchanged.
    expect(result.phi[0]!).toBeCloseTo(400, 9);
  });
});
