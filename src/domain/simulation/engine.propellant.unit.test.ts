import { describe, expect, it } from "vitest";

import {
  EXHAUST_VELOCITY_M_PER_S,
  PROPELLANT_FLOW_SPEED_M_PER_S,
  REFERENCE_ISP_S,
  fuelMassForImpulse,
  makePropellantSubstance,
  pipeKey,
  tsiolkovskyDeltaV,
} from "@/domain/simulation/engine/propellant";
import { STANDARD_GRAVITY_M_PER_S2 } from "@/domain/simulation/engine/transport-field";
import {
  TRANSPORT_DT_S,
  stepTransportField,
} from "@/domain/simulation/engine/transport-field";

/**
 * Propellant substance physics. φ = fuel mass per cell (kg).
 * Advection-only along the pipe graph; engine burn is a boundary flux that
 * carries thrust-equivalent momentum. Tests assert:
 *
 *   - v_e = Isp · g₀ (Tsiolkovsky exhaust velocity);
 *   - a burning engine drains fuel at thrust/v_e and reports thrust = dm·v_e
 *     along -normal (momentum conservation: exhaust impulse = thrust·dt);
 *   - fuel flows along a plumbed edge toward a burning engine;
 *   - a dry tank flames out (no mass ⇒ no flux, no thrust);
 *   - Tsiolkovsky Δv from a known fuel mass matches the rocket equation.
 */

describe("propellant substance", () => {
  it("derives exhaust velocity from Isp·g0", () => {
    expect(EXHAUST_VELOCITY_M_PER_S).toBeCloseTo(
      REFERENCE_ISP_S * STANDARD_GRAVITY_M_PER_S2,
      6,
    );
    // 320 s · 9.80665 m/s² ≈ 3138 m/s.
    expect(EXHAUST_VELOCITY_M_PER_S).toBeGreaterThan(3000);
    expect(EXHAUST_VELOCITY_M_PER_S).toBeLessThan(3300);
  });

  it("drains fuel and reports thrust = dm·v_e along -normal", () => {
    // One engine cell producing 1000 N along +y (nozzle normal +y, so the
    // ship is pushed along -y).
    const engineThrust = new Map([[0, 1000]]);
    const exhaust = new Map([[0, { nx: 0, ny: 1 }]]);
    const substance = makePropellantSubstance(
      engineThrust,
      new Set(),
      exhaust,
    );
    const phi = [100];
    const result = stepTransportField(
      { substance, faces: [], boundaryCells: [0] },
      phi,
    );
    const burnRate = 1000 / EXHAUST_VELOCITY_M_PER_S;
    const expectedMassLost = burnRate * TRANSPORT_DT_S;
    expect(phi[0]! - result.phi[0]!).toBeCloseTo(expectedMassLost, 9);
    // Thrust impulse = burnRate · v_e · dt = 1000 · dt along -y.
    expect(result.momentumY).toBeCloseTo(-1000 * TRANSPORT_DT_S, 6);
    expect(result.momentumX).toBe(0);
  });

  it("flames out when the tank is dry", () => {
    const engineThrust = new Map([[0, 1000]]);
    const exhaust = new Map([[0, { nx: 0, ny: 1 }]]);
    const substance = makePropellantSubstance(
      engineThrust,
      new Set(),
      exhaust,
    );
    const result = stepTransportField(
      { substance, faces: [], boundaryCells: [0] },
      [0],
    );
    expect(result.phi[0]!).toBe(0);
    expect(result.momentumY).toBe(0);
  });

  it("flows along a plumbed edge toward a burning engine", () => {
    // Cell 0 (tank) → cell 1 (burning engine), plumbed.
    const engineThrust = new Map([[1, 1000]]);
    const exhaust = new Map([[1, { nx: 0, ny: 1 }]]);
    const pipes = new Set([pipeKey(0, 1)]);
    const substance = makePropellantSubstance(engineThrust, pipes, exhaust);
    const faces = [
      { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
      { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
    ];
    const phi = [100, 0];
    const result = stepTransportField(
      { substance, faces, boundaryCells: [1] },
      phi,
    );
    // Tank loses flowSpeed·area·phiTank·dt to the engine.
    const transferred = PROPELLANT_FLOW_SPEED_M_PER_S * 1 * 100 * TRANSPORT_DT_S;
    expect(result.phi[0]!).toBeCloseTo(100 - transferred, 6);
    expect(result.phi[1]!).toBeGreaterThan(0);
  });

  it("does not flow when no engine is burning downstream", () => {
    const pipes = new Set([pipeKey(0, 1)]);
    const substance = makePropellantSubstance(new Map(), pipes, new Map());
    const faces = [
      { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
      { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
    ];
    const phi = [100, 0];
    const result = stepTransportField(
      { substance, faces, boundaryCells: [] },
      phi,
    );
    expect(result.phi[0]!).toBeCloseTo(100, 9);
    expect(result.phi[1]!).toBeCloseTo(0, 9);
  });

  describe("Tsiolkovsky rocket equation anchor", () => {
    it("computes delta-v = v_e · ln((dry + fuel)/dry)", () => {
      const dry = 1000;
      const fuel = 1000;
      const expected = EXHAUST_VELOCITY_M_PER_S * Math.log(2);
      expect(tsiolkovskyDeltaV(dry, fuel)).toBeCloseTo(expected, 6);
    });

    it("inverts delta-v/impulse to the fuel mass consumed", () => {
      // dm = impulse / v_e.
      const impulse = 10_000; // N·s
      const expected = impulse / EXHAUST_VELOCITY_M_PER_S;
      expect(fuelMassForImpulse(impulse)).toBeCloseTo(expected, 9);
    });
  });
});
