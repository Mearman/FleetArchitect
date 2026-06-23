import { describe, expect, it } from "vitest";

import {
  ENGINE_ALGORITHM_VERSION,
  getSimConfig,
} from "@/domain/cache/sim-config";
import {
  ARRIVAL_CLOSING_SPEED_MPS,
  CREW_HP,
  EM_HULL_AMBIENT_EMISSION,
  EM_RECEIVER_NOISE_FLOOR,
  GRAVITY_CONSTANT_ARENA,
  SIM,
  SPEED_OF_LIGHT_M_PER_S,
  SPEED_OF_LIGHT_M_PER_TICK,
  THRUST_ALIGNMENT_RAD,
} from "@/domain/simulation/engine/config";
import {
  ACCEL_PER_TICK_FROM_SI,
  STALEMATE_IDLE_TICKS,
  TICKS_PER_SECOND,
} from "@/domain/simulation/types";

/**
 * Completeness guard for the cache determinant snapshot. The deterministic
 * result cache keys on this snapshot, so a tunable that is silently dropped from
 * it would let a stale result survive a change to that tunable. These tests fail
 * CI the moment a `SIM.*` key or a standalone sim-time constant stops flowing
 * into the snapshot.
 */
describe("getSimConfig — determinant completeness", () => {
  it("carries every top-level SIM key into the snapshot", () => {
    const snapshot = getSimConfig();
    // Key-set equality both ways: no SIM key may be dropped, and the snapshot
    // must not invent a phantom tunable that does not exist on SIM.
    expect(Object.keys(snapshot.sim).sort()).toEqual(Object.keys(SIM).sort());
  });

  it("carries the same value for every SIM key", () => {
    const snapshot = getSimConfig();
    // Reference identity is enough: the snapshot exposes the live SIM object, so
    // any future per-key copy that drops a value is caught here too.
    for (const key of Object.keys(SIM)) {
      expect(key in snapshot.sim).toBe(true);
    }
    expect(snapshot.sim).toEqual(SIM);
  });

  it("includes every standalone sim-time constant the engine reads", () => {
    const { constants } = getSimConfig();
    expect(constants).toEqual({
      SPEED_OF_LIGHT_M_PER_S,
      SPEED_OF_LIGHT_M_PER_TICK,
      EM_RECEIVER_NOISE_FLOOR,
      EM_HULL_AMBIENT_EMISSION,
      GRAVITY_CONSTANT_ARENA,
      CREW_HP,
      THRUST_ALIGNMENT_RAD,
      ARRIVAL_CLOSING_SPEED_MPS,
      TICKS_PER_SECOND,
      ACCEL_PER_TICK_FROM_SI,
      STALEMATE_IDLE_TICKS,
    });
  });

  it("every constant is a finite number (a hashable determinant)", () => {
    const { constants } = getSimConfig();
    for (const value of Object.values(constants)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("carries the manual algorithm version", () => {
    expect(getSimConfig().algorithmVersion).toBe(ENGINE_ALGORITHM_VERSION);
    expect(Number.isInteger(ENGINE_ALGORITHM_VERSION)).toBe(true);
  });

  it("is a pure snapshot — two calls produce equal values", () => {
    expect(getSimConfig()).toEqual(getSimConfig());
  });
});
