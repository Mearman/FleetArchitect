import { describe, expect, it } from "vitest";

import { TICKS_PER_SECOND } from "@/domain/simulation/types";

import {
  CHOKED_O2_MASS_FLUX_PER_PA,
  compartmentO2PressurePa,
  compartmentVentKgPerTick,
  crewMetabolicHeatJPerTick,
  crewO2ConsumptionKgPerTick,
  advanceLifeSupportTick,
  LIFESUPPORT_ANCHORS,
  type CompartmentAtmosphere,
} from "@/domain/simulation/engine/lifesupport";

/**
 * Life support & atmosphere — Phase 12 physics. Each test isolates one
 * physical relationship (metabolic consumption rate, choked-flow vent rate,
 * determinism) by constructing a minimal compartment state and reading the
 * pure-function result. Gameplay use is deferred, so these assert the
 * physics, not any downstream consequence.
 */

const SECONDS_PER_TICK = 1 / TICKS_PER_SECOND;

/** A standard compartment: 100 m^3 at sea-level-equivalent O2 partial
 *  pressure (21% of 1 atm), no breach. Constructed from the cabin density
 *  anchor so the test does not hard-code a magic number. */
function standardCompartment(
  over: Partial<CompartmentAtmosphere> = {},
): CompartmentAtmosphere {
  const volumeM3 = 100;
  const o2MassKg =
    LIFESUPPORT_ANCHORS.CABIN_O2_DENSITY_KG_PER_M3 * volumeM3;
  return { o2MassKg, volumeM3, breachAreaM2: 0, ...over };
}

describe("crew O2 consumption", () => {
  it("matches the NASA 0.84 kg/man-day baseline for a single crew member", () => {
    // 0.84 kg/day / 86400 s/day, scaled to one tick.
    const kgPerDay = 0.84;
    const expectedKgPerTick = (kgPerDay / 86_400) * SECONDS_PER_TICK;
    const actual = crewO2ConsumptionKgPerTick(1);
    // Closed form derives ~4.82e-5 kg/tick; the 0.84 kg/day anchor is the
    // published ECLSS figure, allow a small respiratory-quotient rounding.
    expect(actual).toBeCloseTo(expectedKgPerTick, 5);
  });

  it("scales linearly with crew count", () => {
    const one = crewO2ConsumptionKgPerTick(1);
    expect(crewO2ConsumptionKgPerTick(10)).toBeCloseTo(10 * one, 10);
    expect(crewO2ConsumptionKgPerTick(0)).toBe(0);
  });
});

describe("crew metabolic heat", () => {
  it("is exactly 100 W per crew member per second", () => {
    // 100 W · dt = 100/30 J per tick for one crew.
    const expected = 100 * SECONDS_PER_TICK;
    expect(crewMetabolicHeatJPerTick(1)).toBeCloseTo(expected, 10);
    expect(crewMetabolicHeatJPerTick(4)).toBeCloseTo(4 * expected, 10);
  });
});

describe("compartment O2 partial pressure", () => {
  it("recovers sea-level-equivalent O2 partial pressure at standard density", () => {
    const atm = standardCompartment();
    // 21% of 1 atm.
    const expectedPa = 0.21 * LIFESUPPORT_ANCHORS.P0_PA;
    expect(compartmentO2PressurePa(atm)).toBeCloseTo(expectedPa, 1);
  });

  it("returns zero for an empty or zero-volume compartment", () => {
    expect(
      compartmentO2PressurePa({ o2MassKg: 0, volumeM3: 100, breachAreaM2: 0 }),
    ).toBe(0);
    expect(
      compartmentO2PressurePa({ o2MassKg: 1, volumeM3: 0, breachAreaM2: 0 }),
    ).toBe(0);
  });
});

describe("choked-flow vent rate through a breach", () => {
  it("vents nothing from an airtight (zero-breach) compartment", () => {
    const atm = standardCompartment();
    expect(compartmentVentKgPerTick(atm)).toBe(0);
  });

  it("matches the choked-flow formula `C_d · A · P · k(gamma)` for a 1 cm^2 hole", () => {
    const areaM2 = 1e-4; // 1 cm^2
    const atm = standardCompartment({ breachAreaM2: areaM2 });
    const pStag = compartmentO2PressurePa(atm);
    const expectedKg =
      CHOKED_O2_MASS_FLUX_PER_PA * pStag * areaM2 * SECONDS_PER_TICK;
    expect(compartmentVentKgPerTick(atm)).toBeCloseTo(expectedKg, 10);
  });

  it("is bounded by the O2 mass actually present", () => {
    // A huge breach on a near-empty compartment cannot vent more than it holds.
    const atm: CompartmentAtmosphere = {
      o2MassKg: 1e-6,
      volumeM3: 1,
      breachAreaM2: 1.0,
    };
    expect(compartmentVentKgPerTick(atm)).toBe(1e-6);
  });

  it("vents to zero once the compartment is evacuated", () => {
    const atm: CompartmentAtmosphere = {
      o2MassKg: 0,
      volumeM3: 100,
      breachAreaM2: 1e-2,
    };
    expect(compartmentVentKgPerTick(atm)).toBe(0);
  });
});

describe("advanceLifeSupportTick integration", () => {
  it("reduces O2 mass by consumption + venting over one tick", () => {
    const areaM2 = 1e-4;
    const start = standardCompartment({ breachAreaM2: areaM2 });
    const crew = 4;
    const { next, deltas } = advanceLifeSupportTick(start, crew);
    const expectedMass =
      start.o2MassKg - deltas.o2ConsumedKg - deltas.o2VentedKg;
    expect(next.o2MassKg).toBeCloseTo(expectedMass, 10);
    expect(deltas.metabolicHeatJ).toBeCloseTo(
      crewMetabolicHeatJPerTick(crew),
      10,
    );
    expect(next.breachAreaM2).toBe(areaM2);
    expect(next.volumeM3).toBe(start.volumeM3);
  });

  it("preserves airtight behaviour (no venting) with crew present", () => {
    const start = standardCompartment(); // breachAreaM2 = 0
    const crew = 5;
    const { next, deltas } = advanceLifeSupportTick(start, crew);
    expect(deltas.o2VentedKg).toBe(0);
    expect(next.o2MassKg).toBeCloseTo(
      start.o2MassKg - deltas.o2ConsumedKg,
      10,
    );
  });
});

describe("determinism", () => {
  it("produces byte-identical deltas across two identical invocations", () => {
    const start = standardCompartment({ breachAreaM2: 5e-3 });
    const a = advanceLifeSupportTick(start, 8);
    const b = advanceLifeSupportTick(start, 8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is order-independent: advancing the same sequence twice converges", () => {
    // A two-tick sequence run twice from the same start must land on the
    // same final atmosphere — no hidden state, pure functions.
    const start = standardCompartment({ breachAreaM2: 1e-3 });
    const runTwo = (s: CompartmentAtmosphere) => {
      const r1 = advanceLifeSupportTick(s, 3);
      return advanceLifeSupportTick(r1.next, 3);
    };
    const first = runTwo(start);
    const second = runTwo(start);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
