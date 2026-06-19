import { describe, expect, it } from "vitest";
import { SPEED_OF_LIGHT_M_PER_S, SPEED_OF_LIGHT_M_PER_TICK } from "./engine/config";
import {
  combinedDilation, gravitationalPotential, gravitationalTimeDilation,
  velocityTimeDilation,
} from "./engine/proper-time";

describe("engine.proper-time", () => {
  it("a ship at rest in flat space ages at real time (factor 1)", () => {
    expect(velocityTimeDilation(0)).toBe(1);
    expect(gravitationalTimeDilation(0)).toBe(1);
    expect(combinedDilation(0, 0)).toBe(1);
  });

  it("velocity dilation follows sqrt(1 - v^2/c^2); 0.5c -> sqrt(0.75)", () => {
    expect(velocityTimeDilation(0.5 * SPEED_OF_LIGHT_M_PER_TICK)).toBeCloseTo(Math.sqrt(0.75), 6);
    expect(velocityTimeDilation(0.8 * SPEED_OF_LIGHT_M_PER_TICK)).toBeCloseTo(0.6, 6); // sqrt(1-0.64)
  });

  it("velocity dilation is 0 at and above c (clamped)", () => {
    expect(velocityTimeDilation(SPEED_OF_LIGHT_M_PER_TICK)).toBe(0);
    expect(velocityTimeDilation(2 * SPEED_OF_LIGHT_M_PER_TICK)).toBe(0);
  });

  it("gravitational dilation -> 0 at the Schwarzschild radius (Phi = -c^2/2)", () => {
    const c2 = SPEED_OF_LIGHT_M_PER_S * SPEED_OF_LIGHT_M_PER_S;
    expect(gravitationalTimeDilation(-c2 / 2)).toBeCloseTo(0, 6);
    // Inside r_s (deeper than -c^2/2) is clamped to 0, not NaN.
    expect(gravitationalTimeDilation(-c2)).toBe(0);
  });

  it("gravitational potential is -Sum(GM/r) over the body list", () => {
    const bodies = [{ gm: 1e16, x: 0, y: 0 }];
    // At r = 1e8 m from a body of GM = 1e16: Phi = -1e16/1e8 = -1e8 m^2/s^2.
    expect(gravitationalPotential(bodies, 1e8, 0)).toBeCloseTo(-1e8, 6);
    // Two bodies sum.
    const two = [
      { gm: 1e16, x: 0, y: 0 },
      { gm: 2e16, x: 1e8, y: 0 },
    ];
    // At (0,0): -1e16/1 (r to body 1 is 0 -> skipped) + -2e16/1e8 = -2e8.
    // Body 1 at the point itself (r=0) is skipped (no singularity).
    expect(gravitationalPotential(two, 0, 0)).toBeCloseTo(-2e8, 6);
  });

  it("combined dilation is the product of velocity and gravitational", () => {
    const v = 0.5 * SPEED_OF_LIGHT_M_PER_TICK;
    const c2 = SPEED_OF_LIGHT_M_PER_S * SPEED_OF_LIGHT_M_PER_S;
    const phi = -0.1 * c2; // a moderate well
    expect(combinedDilation(v, phi)).toBeCloseTo(
      velocityTimeDilation(v) * gravitationalTimeDilation(phi), 6);
    // A fast ship deep in a well ages slower than either alone.
    expect(combinedDilation(v, phi)).toBeLessThan(velocityTimeDilation(v));
    expect(combinedDilation(v, phi)).toBeLessThan(gravitationalTimeDilation(phi));
  });

  it("is deterministic (pure functions)", () => {
    expect(combinedDilation(123, -1e8)).toEqual(combinedDilation(123, -1e8));
    expect(gravitationalPotential([{ gm: 5, x: 1, y: 2 }], 3, 4)).toEqual(
      gravitationalPotential([{ gm: 5, x: 1, y: 2 }], 3, 4));
  });
});
