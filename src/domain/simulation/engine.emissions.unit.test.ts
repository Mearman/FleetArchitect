import { describe, expect, it } from "vitest";
import { SPEED_OF_LIGHT_M_PER_TICK } from "./engine/config";
import { formsContact, isReaching, lightSphereRadius, receivedStrength, type Emission, type Receiver } from "./engine/emissions";

const emit = (over: Partial<Emission> = {}): Emission => ({
  sourceId: "s", x: 0, y: 0, strength: 1e10, t0: 0, ...over,
});
const recv = (over: Partial<Receiver> = {}): Receiver => ({
  x: 0, y: 0, sensitivity: 1, gain: 1, ...over,
});

describe("engine.emissions", () => {
  it("the light sphere radius is c·(t - t0)", () => {
    expect(lightSphereRadius(0, 0)).toBe(0);
    expect(lightSphereRadius(10, 0)).toBeCloseTo(10 * SPEED_OF_LIGHT_M_PER_TICK, 6);
    expect(lightSphereRadius(10, 4)).toBeCloseTo(6 * SPEED_OF_LIGHT_M_PER_TICK, 6);
  });

  it("an emission is received exactly ceil(d/c) ticks after it occurred", () => {
    const d = 5.5 * SPEED_OF_LIGHT_M_PER_TICK;
    const e = emit({ x: 0, y: 0 });
    const r = recv({ x: d, y: 0 });
    // Before the round-trip time, not reaching; at ceil(5.5)=6 ticks, reaching.
    expect(isReaching(e, r, 5)).toBe(false);
    expect(isReaching(e, r, 6)).toBe(true);
    expect(isReaching(e, r, 7)).toBe(false); // the sphere has swept past
  });

  it("received strength falls as 1/(4·PI·dist^2)", () => {
    const e = emit({ strength: 4 * Math.PI * 1e6 }); // so dist=1000 -> strength 1
    expect(receivedStrength(e, 1000)).toBeCloseTo(1, 6);
    expect(receivedStrength(e, 2000)).toBeCloseTo(0.25, 6); // double dist -> 1/4
  });

  it("a contact forms only when the sphere crosses AND strength exceeds threshold", () => {
    const d = 2 * SPEED_OF_LIGHT_M_PER_TICK;
    // Strengths chosen against the inverse-square loss over ~2 light-ticks
    // (4·PI·(2c)^2 ~ 5e15 m^2): a strong emission registers, a weak one does not.
    const strong = emit({ strength: 1e16 });
    const r = recv({ x: d, y: 0, sensitivity: 0.1 });
    expect(formsContact(strong, r, 2)).toBe(true);
    const weak = emit({ strength: 1e6 }); // received ~2e-10, below 0.1
    expect(formsContact(weak, r, 2)).toBe(false);
    // A sensor (high gain) lowers the effective threshold enough to catch it.
    expect(formsContact(weak, { ...r, gain: 1e9 }, 2)).toBe(true);
  });

  it("is deterministic (pure functions)", () => {
    const e = emit({ strength: 5, x: 10, y: 20 });
    const r = recv({ x: 100, y: 50 });
    expect(isReaching(e, r, 3)).toEqual(isReaching(e, r, 3));
    expect(formsContact(e, r, 3)).toEqual(formsContact(e, r, 3));
  });
});
