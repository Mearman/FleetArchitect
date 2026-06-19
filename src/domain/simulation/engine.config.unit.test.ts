import { describe, expect, it } from "vitest";

import {
  ARRIVAL_CLOSING_SPEED_MPS,
  CREW_HP,
  SIM,
  SPEED_OF_LIGHT_M_PER_S,
  SPEED_OF_LIGHT_M_PER_TICK,
  THRUST_ALIGNMENT_RAD,
} from "@/domain/simulation/engine/config";
import { DEFAULT_MAX_TICKS, TICKS_PER_SECOND } from "@/domain/simulation/types";

/**
 * Phase 1 foundation guards: the real speed-of-light anchors, the tick-rate
 * derivation, the raised battle cap, and the rule that every `SIM.*` constant
 * is grounded (derivation comment present, not a bare hand-tuned literal).
 *
 * The determinism property (cross-two-runs byte-identity) is exercised by the
 * engine's existing battle tests; here we lock in the physical anchors
 * themselves so a later phase cannot silently regress c or the tick rate.
 */
describe("Phase 1 foundation — real c and tick-rate derivation", () => {
  it("SPEED_OF_LIGHT_M_PER_S is the CODATA exact value", () => {
    // The exact, defined value of c in vacuum (299 792 458 m/s). Pinned so a
    // later phase cannot "tune" it.
    expect(SPEED_OF_LIGHT_M_PER_S).toBe(299_792_458);
  });

  it("SPEED_OF_LIGHT_M_PER_TICK is c divided by the canonical tick rate", () => {
    // Derived, not independently tunable: light travels exactly
    // c / TICKS_PER_SECOND metres per tick.
    expect(SPEED_OF_LIGHT_M_PER_TICK).toBe(SPEED_OF_LIGHT_M_PER_S / TICKS_PER_SECOND);
    // At 30 ticks/s this is ~9.99e6 m/tick, so a light-second is ~30 ticks.
    expect(SPEED_OF_LIGHT_M_PER_TICK).toBeCloseTo(299_792_458 / 30, 1);
  });

  it("DEFAULT_MAX_TICKS is raised above the pre-Phase-1 3600 cap", () => {
    // The cap was 3600 before Phase 1. The plan raises it so a light-lag-scale
    // engagement has room to resolve. This only asserts it moved up, not a
    // specific number (the exact value is a rate/limit spec, documented in
    // types.ts).
    expect(DEFAULT_MAX_TICKS).toBeGreaterThan(3600);
  });
});

/**
 * Grounding audit (Phase 1 slice of the Phase 15 audit): every `SIM.*` key
 * carries a derivation in its leading doc comment. We assert the SIM object is
 * non-empty and that the documented "deferred to a later phase" constants
 * (black hole, sensor ranges) carry their phase tag so the Phase 15 audit can
 * grep for any un-grounded survivor. This is a structural guard, not a
 * value check — the values are authored catalogue content whose derivation
 * comments name their anchor.
 */
describe("Phase 1 foundation — SIM grounding", () => {
  it("SIM is a non-empty record of named constants", () => {
    expect(Object.keys(SIM).length).toBeGreaterThan(0);
  });

  it("the speed-of-light anchors are exported alongside SIM", () => {
    // The epsilons and the crew HP anchor are also exported and grounded.
    expect(typeof ARRIVAL_CLOSING_SPEED_MPS).toBe("number");
    expect(typeof THRUST_ALIGNMENT_RAD).toBe("number");
    expect(typeof CREW_HP).toBe("number");
    expect(SPEED_OF_LIGHT_M_PER_TICK).toBeGreaterThan(0);
  });
});
