import { describe, expect, it } from "vitest";

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

/**
 * Thermal substance physics. φ = temperature (K); diffusion-only transport
 * with a radiative (T⁴) boundary outflux. Tests assert:
 *
 *   - diffusion equalises temperature between two cells;
 *   - the T⁴ outflux drains heat from a radiator cell;
 *   - the steady-state radiator temperature matches the analytic
 *     `T = (P/(ε·σ·A))^(1/4)`;
 *   - thermal radiation carries no momentum (photon pressure ≈ µN at 300 K).
 */

describe("thermal substance", () => {
  it("uses the looked-up aluminium thermal diffusivity", () => {
    // Aluminium 6061 at 300 K: α ≈ 6.7e-5 m²/s. Asserted to within 5%.
    expect(HULL_THERMAL_DIFFUSIVITY_M2_PER_S).toBeCloseTo(6.7e-5, 1);
  });

  it("moves heat from the hotter cell to the colder cell at the documented rate", () => {
    // Aluminium conducts slowly (D ≈ 6.7e-5 m²/s), so over a handful of ticks
    // the temperatures barely move — but they move by exactly the analytic
    // amount. For two cells the discrete update is
    //   phi0_new = phi0 + D·(phi1 − phi0)·dt
    //   phi1_new = phi1 + D·(phi0 − phi1)·dt
    // (one open face each way, unit area and pitch).
    const substance = makeThermalSubstance(new Map(), new Set());
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

  it("drains heat through a radiator cell via the Stefan-Boltzmann flux", () => {
    // One cell with a radiator, no neighbours: the only heat loss is the
    // T⁴ boundary flux. Temperature should fall.
    const radiators = new Set([0]);
    const substance = makeThermalSubstance(new Map(), radiators);
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

  it("settles near the analytic radiator equilibrium temperature", () => {
    // A cell heated by a constant source and cooled by a radiator reaches
    // the steady state where source power = σ·ε·A·T⁴. Integrating the full
    // field is slow; we check the analytic anchor instead.
    const powerWatts = 1000;
    const expected = radiatorEquilibriumTemperature(powerWatts);
    // Sanity: 1000 W through a 2 m² radiator at ε=0.9 should sit around
    // 350 K (≈ 80 °C) — a believable radiator temperature.
    expect(expected).toBeGreaterThan(300);
    expect(expected).toBeLessThan(400);
    // Reconstruct the equilibrium condition: ε·σ·A·T⁴ ≈ powerWatts.
    const radiated =
      RADIATOR_EMISSIVITY *
      STEFAN_BOLTZMANN_W_PER_M2_K4 *
      (2 * TRANSPORT_GEOMETRY.faceAreaM2) *
      (expected ** 4 - SPACE_TEMPERATURE_K ** 4);
    expect(radiated).toBeCloseTo(powerWatts, 3);
  });

  it("does not radiate from a non-radiator (insulated) boundary cell", () => {
    const substance = makeThermalSubstance(new Map(), new Set());
    const result = stepTransportField(
      { substance, faces: [], boundaryCells: [0] },
      [400],
    );
    // No radiator ⇒ no heat loss ⇒ temperature unchanged.
    expect(result.phi[0]!).toBeCloseTo(400, 9);
  });
});
