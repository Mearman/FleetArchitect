import { describe, expect, it } from "vitest";
import {
  STANDARD_GRAVITY_M_PER_S2,
  burn,
  deltaVOf,
  massFlowRateKgPerS,
  massRatioForDeltaV,
  propellantDemandKg,
  tsiolkovskyDeltaV,
  wetMass,
  type PropellantState,
} from "@/domain/simulation/engine/propellant";

/**
 * Propellant and delta-v physics. Each test isolates one relation or
 * conservation law:
 *   - Tsiolkovsky rocket equation (Δv = Isp·g0·ln(m0/mf))
 *   - Mass-flow rate (ṁ = F / (Isp·g0))
 *   - Burn demand (Δm = ṁ·Δt) and tank clamping
 *   - Mass conservation through a burn (wet mass falls by exactly the demand)
 *   - Determinism: identical inputs yield byte-identical outputs across calls
 *
 * Anchors:
 *   - STANDARD_GRAVITY_M_PER_S2 = 9.80665 (exact defined SI g0)
 *   - A representative chemical Isp of 450 s (liquid hydrogen / liquid oxygen,
 *     the Space Shuttle Main Engine class — real, documented, not magic).
 *   - A representative electric Isp of 3000 s (ion engine class — real,
 *     documented).
 */

/** Liquid-hydrogen / liquid-oxygen chemical engine specific impulse (s).
 *  Space Shuttle Main Engine class, vacuum Isp ~453 s; rounded to 450 s. */
const ISP_CHEMICAL_S = 450;
/** Ion-engine class specific impulse (s). Real, documented for xenon ion
 *  thrusters (e.g. NSTAR ~3100 s); rounded to 3000 s. */
const ISP_ION_S = 3000;

describe("propellant / Tsiolkovsky", () => {
  it("STANDARD_GRAVITY_M_PER_S2 is the exact defined SI value", () => {
    expect(STANDARD_GRAVITY_M_PER_S2).toBe(9.80665);
  });

  it("computes delta-v from the rocket equation for a known mass ratio", () => {
    // A 2:1 mass ratio (half the wet mass is propellant) at Isp 450 s.
    // Δv = Isp · g0 · ln(2) = 450 · 9.80665 · 0.6931… ≈ 3059.5 m/s.
    const dryKg = 1000;
    const wetKg = 2 * dryKg;
    const dv = tsiolkovskyDeltaV(ISP_CHEMICAL_S, wetKg, dryKg);
    const expected = ISP_CHEMICAL_S * STANDARD_GRAVITY_M_PER_S2 * Math.log(2);
    expect(dv).toBeCloseTo(expected, 10);
    // Sanity: ~3.06 km/s for a 2:1 chemical stage.
    expect(dv).toBeGreaterThan(3000);
    expect(dv).toBeLessThan(3100);
  });

  it("delta-v scales linearly with specific impulse at a fixed mass ratio", () => {
    // Doubling Isp doubles Δv for the same mass ratio (Tsiolkovsky is linear
    // in Isp). Ion (3000 s) vs chemical (450 s) at the same 3:1 ratio.
    const ratio = 3;
    const dryKg = 1000;
    const wetKg = ratio * dryKg;
    const dvChemical = tsiolkovskyDeltaV(ISP_CHEMICAL_S, wetKg, dryKg);
    const dvIon = tsiolkovskyDeltaV(ISP_ION_S, wetKg, dryKg);
    // The ratio of delta-vs equals the ratio of Isps, independent of mass.
    expect(dvIon / dvChemical).toBeCloseTo(ISP_ION_S / ISP_CHEMICAL_S, 10);
  });

  it("delta-v grows logarithmically with mass ratio (diminishing returns)", () => {
    // Doubling the propellant (hence the mass ratio) does NOT double Δv.
    const dryKg = 1000;
    const dv1 = tsiolkovskyDeltaV(ISP_CHEMICAL_S, 2 * dryKg, dryKg); // ratio 2
    const dv2 = tsiolkovskyDeltaV(ISP_CHEMICAL_S, 4 * dryKg, dryKg); // ratio 4
    // ln(4)/ln(2) = 2, so doubling the ratio doubles Δv here — but the *mass*
    // quadrupled. The check is that Δv less than doubled when propellant
    // tripled (from 1000 to 3000 kg of propellant): ratio went 2 → 4.
    // Concretely: tripling propellant yields less than triple delta-v.
    const propellantLow = 1000;
    const propellantHigh = 3 * propellantLow;
    const dvLow = tsiolkovskyDeltaV(
      ISP_CHEMICAL_S,
      dryKg + propellantLow,
      dryKg,
    );
    const dvHigh = tsiolkovskyDeltaV(
      ISP_CHEMICAL_S,
      dryKg + propellantHigh,
      dryKg,
    );
    expect(dvHigh / dvLow).toBeLessThan(3);
    // And the ln relationship holds exactly: dv2/dv1 = ln(4)/ln(2).
    expect(dv2 / dv1).toBeCloseTo(Math.log(4) / Math.log(2), 10);
  });
});

describe("propellant / mass-flow rate", () => {
  it("computes mass flow as thrust divided by (Isp · g0)", () => {
    // A 100 kN engine at Isp 450 s: ṁ = 100000 / (450 · 9.80665) ≈ 22.65 kg/s.
    const thrustN = 100_000;
    const mdot = massFlowRateKgPerS(thrustN, ISP_CHEMICAL_S);
    const expected = thrustN / (ISP_CHEMICAL_S * STANDARD_GRAVITY_M_PER_S2);
    expect(mdot).toBeCloseTo(expected, 10);
    expect(mdot).toBeCloseTo(22.65, 1);
  });

  it("a higher Isp consumes less mass per newton of thrust", () => {
    const thrustN = 100_000;
    const mdotChemical = massFlowRateKgPerS(thrustN, ISP_CHEMICAL_S);
    const mdotIon = massFlowRateKgPerS(thrustN, ISP_ION_S);
    // Ion consumes far less reaction mass for the same thrust.
    expect(mdotIon).toBeLessThan(mdotChemical);
    // Inversely proportional to Isp.
    expect(mdotIon / mdotChemical).toBeCloseTo(ISP_CHEMICAL_S / ISP_ION_S, 10);
  });

  it("throws on non-positive thrust or specific impulse", () => {
    expect(() => massFlowRateKgPerS(0, ISP_CHEMICAL_S)).toThrow();
    expect(() => massFlowRateKgPerS(-1, ISP_CHEMICAL_S)).toThrow();
    expect(() => massFlowRateKgPerS(100, 0)).toThrow();
    expect(() => massFlowRateKgPerS(100, -1)).toThrow();
  });
});

describe("propellant / burn demand and tank clamping", () => {
  it("burn demand is the mass-flow rate times the burn duration", () => {
    const thrustN = 100_000;
    const burnS = 10;
    const demand = propellantDemandKg(thrustN, ISP_CHEMICAL_S, burnS);
    const expected = massFlowRateKgPerS(thrustN, ISP_CHEMICAL_S) * burnS;
    expect(demand).toBeCloseTo(expected, 10);
  });

  it("zero-duration burn demands zero propellant", () => {
    expect(propellantDemandKg(100_000, ISP_CHEMICAL_S, 0)).toBe(0);
  });

  it("throws on negative burn duration", () => {
    expect(() => propellantDemandKg(100_000, ISP_CHEMICAL_S, -1)).toThrow();
  });

  it("clamps the burn to the available propellant (tank cannot go negative)", () => {
    const state: PropellantState = { propellantMass: 50, dryMass: 1000 };
    // Demand far exceeds the tank: 100 kN at Isp 450 s for 60 s demands
    // ~1359 kg, but only 50 kg remains.
    const result = burn(state, 100_000, ISP_CHEMICAL_S, 60);
    expect(result.propellantMass).toBe(0);
    expect(result.dryMass).toBe(1000);
  });

  it("a partial burn leaves the remainder and preserves dry mass", () => {
    const state: PropellantState = { propellantMass: 1000, dryMass: 1000 };
    // 100 kN at Isp 450 s for 10 s demands ~226.5 kg.
    const demand = propellantDemandKg(100_000, ISP_CHEMICAL_S, 10);
    const result = burn(state, 100_000, ISP_CHEMICAL_S, 10);
    expect(result.propellantMass).toBeCloseTo(1000 - demand, 10);
    expect(result.dryMass).toBe(1000);
  });

  it("does not mutate the input state (pure function)", () => {
    const state: PropellantState = { propellantMass: 1000, dryMass: 1000 };
    const snapshot: PropellantState = { ...state };
    burn(state, 100_000, ISP_CHEMICAL_S, 10);
    expect(state).toEqual(snapshot);
  });
});

describe("propellant / mass conservation", () => {
  it("wet mass falls by exactly the propellant burned (no clamp case)", () => {
    const state: PropellantState = { propellantMass: 1000, dryMass: 1000 };
    const wetBefore = wetMass(state);
    const result = burn(state, 100_000, ISP_CHEMICAL_S, 5);
    const wetAfter = wetMass(result);
    const demand = propellantDemandKg(100_000, ISP_CHEMICAL_S, 5);
    expect(wetBefore - wetAfter).toBeCloseTo(demand, 10);
  });

  it("wet mass is dry plus remaining propellant", () => {
    const state: PropellantState = { propellantMass: 250, dryMass: 750 };
    expect(wetMass(state)).toBe(1000);
  });

  it("deltaVOf agrees with tsiolkovskyDeltaV on the same state", () => {
    const state: PropellantState = { propellantMass: 1000, dryMass: 1000 };
    const direct = tsiolkovskyDeltaV(
      ISP_CHEMICAL_S,
      wetMass(state),
      state.dryMass,
    );
    expect(deltaVOf(state, ISP_CHEMICAL_S)).toBeCloseTo(direct, 10);
  });
});

describe("propellant / mass-ratio inverse", () => {
  it("massRatioForDeltaV inverts tsiolkovskyDeltaV", () => {
    // Pick a target Δv, recover the mass ratio, then feed it back through
    // Tsiolkovsky at a fixed dry mass and confirm the Δv round-trips.
    const targetDv = 5000; // 5 km/s mission budget
    const ratio = massRatioForDeltaV(ISP_CHEMICAL_S, targetDv);
    const dryKg = 1000;
    const dvRecovered = tsiolkovskyDeltaV(
      ISP_CHEMICAL_S,
      ratio * dryKg,
      dryKg,
    );
    expect(dvRecovered).toBeCloseTo(targetDv, 6);
  });

  it("a zero target delta-v yields a mass ratio of exactly 1", () => {
    expect(massRatioForDeltaV(ISP_CHEMICAL_S, 0)).toBe(1);
  });

  it("throws on non-positive specific impulse or negative delta-v", () => {
    expect(() => massRatioForDeltaV(0, 100)).toThrow();
    expect(() => massRatioForDeltaV(-1, 100)).toThrow();
    expect(() => massRatioForDeltaV(ISP_CHEMICAL_S, -1)).toThrow();
  });
});

describe("propellant / tsiolkovskyDeltaV input validation", () => {
  it("throws when wet mass does not exceed dry mass (no propellant)", () => {
    expect(() => tsiolkovskyDeltaV(ISP_CHEMICAL_S, 1000, 1000)).toThrow();
    expect(() => tsiolkovskyDeltaV(ISP_CHEMICAL_S, 999, 1000)).toThrow();
  });

  it("throws on non-positive masses or specific impulse", () => {
    expect(() => tsiolkovskyDeltaV(0, 2000, 1000)).toThrow();
    expect(() => tsiolkovskyDeltaV(ISP_CHEMICAL_S, 0, 1000)).toThrow();
    expect(() => tsiolkovskyDeltaV(ISP_CHEMICAL_S, 2000, 0)).toThrow();
    expect(() => tsiolkovskyDeltaV(ISP_CHEMICAL_S, -1, 1000)).toThrow();
    expect(() => tsiolkovskyDeltaV(ISP_CHEMICAL_S, 2000, -1)).toThrow();
  });
});

describe("propellant / determinism", () => {
  it("identical inputs produce byte-identical outputs across calls", () => {
    const state: PropellantState = { propellantMass: 1234.5, dryMass: 6789 };
    const thrustN = 98_765;
    const burnS = 42.5;
    // Two independent runs of every pure function must agree exactly.
    const dvA = deltaVOf(state, ISP_CHEMICAL_S);
    const dvB = deltaVOf(state, ISP_CHEMICAL_S);
    expect(dvA).toBe(dvB);

    const mdotA = massFlowRateKgPerS(thrustN, ISP_ION_S);
    const mdotB = massFlowRateKgPerS(thrustN, ISP_ION_S);
    expect(mdotA).toBe(mdotB);

    const burnA = burn(state, thrustN, ISP_CHEMICAL_S, burnS);
    const burnB = burn(state, thrustN, ISP_CHEMICAL_S, burnS);
    expect(burnA).toEqual(burnB);

    const ratioA = massRatioForDeltaV(ISP_ION_S, dvA);
    const ratioB = massRatioForDeltaV(ISP_ION_S, dvB);
    expect(ratioA).toBe(ratioB);
  });

  it("a deterministic burn sequence leaves no ambiguity in final state", () => {
    // Burn the same state in two equivalent orderings and confirm the final
    // wet mass is identical (mass conservation makes burn order irrelevant
    // when no burn clamps to zero).
    const makeState = (): PropellantState => ({
      propellantMass: 10_000,
      dryMass: 5000,
    });
    const thrustN = 50_000;
    // Sequence A: burn 10 s then 20 s.
    const a = burn(
      burn(makeState(), thrustN, ISP_CHEMICAL_S, 10),
      thrustN,
      ISP_CHEMICAL_S,
      20,
    );
    // Sequence B: burn 30 s in one step.
    const b = burn(makeState(), thrustN, ISP_CHEMICAL_S, 30);
    expect(wetMass(a)).toBeCloseTo(wetMass(b), 10);
    expect(a.propellantMass).toBeCloseTo(b.propellantMass, 10);
  });
});
