import { describe, expect, it } from "vitest";

import {
  AIR_DENSITY_KG_PER_M3,
  CABIN_PRESSURE_PA,
  CREW_O2_CONSUMPTION_KG_PER_S,
  STANDARD_CELL_GAS_MASS_KG,
  VENT_EXHAUST_VELOCITY_M_PER_S,
  makeAtmosphereSubstance,
  pressureFromMass,
} from "@/domain/simulation/engine/lifesupport";
import {
  TRANSPORT_DT_S,
  stepTransportField,
  totalScalar,
} from "@/domain/simulation/engine/transport-field";

/**
 * Atmosphere / life-support substance physics. φ = gas mass per cell (kg).
 * Tests assert:
 *
 *   - the standard cell gas mass matches ρ·V at sea-level density;
 *   - pressureFromMass inverts the ideal-gas law (p = ρ R T);
 *   - Fick diffusion equalises density between two open cells;
 *   - crew consumption drains gas from a crewed cell at the documented rate;
 *   - a vented cell loses mass AND reports recoil equal to dm·v_e (the same
 *     momentum path as propellant exhaust).
 */

describe("atmosphere substance", () => {
  it("anchors the standard cell gas mass to ISA sea-level density", () => {
    // 1 m³ cell at 1.225 kg/m³.
    expect(STANDARD_CELL_GAS_MASS_KG).toBeCloseTo(AIR_DENSITY_KG_PER_M3, 9);
  });

  it("recovers ISA cabin pressure from the standard cell gas mass", () => {
    // p = ρ R T with ρ = 1.225 kg/m³, R = 287.058 J/kg/K, T = 288.15 K
    // (ISA standard atmosphere: self-consistent at the anchor values).
    expect(pressureFromMass(STANDARD_CELL_GAS_MASS_KG)).toBeCloseTo(
      CABIN_PRESSURE_PA,
      -1, // within 5 Pa of 101 325 Pa.
    );
  });

  it("diffuses gas between two open cells and conserves total mass", () => {
    const substance = makeAtmosphereSubstance(new Map(), new Map());
    const faces = [
      { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
      { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
    ];
    const phi = [2 * STANDARD_CELL_GAS_MASS_KG, 0];
    const result = stepTransportField(
      { substance, faces, boundaryCells: [] },
      phi,
    );
    expect(totalScalar(result.phi)).toBeCloseTo(totalScalar(phi), 9);
    expect(result.phi[0]!).toBeLessThan(phi[0]!);
    expect(result.phi[1]!).toBeGreaterThan(0);
  });

  it("drains gas from a crewed cell at n * crew-O2-consumption per second", () => {
    const crew = new Map([[0, 2]]); // two crew in cell 0
    const substance = makeAtmosphereSubstance(crew, new Map());
    const result = stepTransportField(
      { substance, faces: [], boundaryCells: [] },
      [STANDARD_CELL_GAS_MASS_KG],
    );
    const expectedLoss = 2 * CREW_O2_CONSUMPTION_KG_PER_S * TRANSPORT_DT_S;
    expect(result.phi[0]!).toBeCloseTo(
      STANDARD_CELL_GAS_MASS_KG - expectedLoss,
      9,
    );
  });

  it("vents gas and reports recoil equal to dm·v_e along -normal", () => {
    // One cell venting along +x. Mass lost per tick = rate·dt;
    // rate = ρ·A·v_e. Recoil impulse = rate·v_e·dt along -x.
    const vents = new Map([[0, { nx: 1, ny: 0 }]]);
    const substance = makeAtmosphereSubstance(new Map(), vents);
    const phi = [STANDARD_CELL_GAS_MASS_KG];
    const result = stepTransportField(
      { substance, faces: [], boundaryCells: [0] },
      phi,
    );
    const massLost = phi[0]! - result.phi[0]!;
    expect(massLost).toBeGreaterThan(0);
    // Impulse magnitude = massLost * v_e. The hull feels -x.
    const expectedImpulse = massLost * VENT_EXHAUST_VELOCITY_M_PER_S;
    expect(Math.abs(result.momentumX)).toBeCloseTo(expectedImpulse, 2);
    expect(result.momentumX).toBeLessThan(0); // along -x
    expect(result.momentumY).toBe(0);
  });

  it("stops venting once the cell is empty (no negative mass)", () => {
    const vents = new Map([[0, { nx: 1, ny: 0 }]]);
    const substance = makeAtmosphereSubstance(new Map(), vents);
    let phi = [STANDARD_CELL_GAS_MASS_KG];
    // Vent for many ticks to drain the cell.
    for (let i = 0; i < 1000; i += 1) {
      phi = stepTransportField(
        { substance, faces: [], boundaryCells: [0] },
        phi,
      ).phi;
    }
    // The cell should not go significantly negative. The integrator does not
    // hard-clamp (the substance reports the physical rate and the cell
    // asymptotes through the density term), but it must not diverge.
    expect(phi[0]!).toBeGreaterThanOrEqual(-1e-6);
  });
});
