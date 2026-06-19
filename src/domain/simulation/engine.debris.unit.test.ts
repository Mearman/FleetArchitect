import { describe, expect, it } from "vitest";
import { debrisRadius, spawnDebris, stepDebris } from "./engine/debris";
import type { Debris } from "./engine/debris";

describe("engine.debris", () => {
  it("drifts in a straight line at constant velocity (no drag)", () => {
    // Real space is frictionless: a debris fragment keeps its momentum and
    // moves in a straight line. After N ticks it has travelled exactly N·v.
    const d0 = spawnDebris("d1", { x: 0, y: 0 }, { x: 10, y: -3 }, { x: 0, y: 0 }, 1000);
    let d: Debris = d0;
    for (let i = 0; i < 50; i += 1) d = stepDebris(d);
    expect(d.x).toBeCloseTo(500, 6); // 50 ticks * 10 m/tick
    expect(d.y).toBeCloseTo(-150, 6); // 50 ticks * -3 m/tick
    expect(d.velX).toBe(10); // velocity unchanged
    expect(d.velY).toBe(-3);
  });

  it("inherits the parent's momentum and adds the breakup impulse", () => {
    const d = spawnDebris("d2", { x: 5, y: 5 }, { x: 2, y: 1 }, { x: -1, y: 4 }, 500);
    expect(d.velX).toBe(1); // 2 + (-1)
    expect(d.velY).toBe(5); // 1 + 4
    expect(d.x).toBe(5);
    expect(d.y).toBe(5);
  });

  it("derives radius from mass via density (heavier => larger)", () => {
    expect(debrisRadius(0)).toBe(0);
    expect(debrisRadius(1000)).toBeGreaterThan(debrisRadius(100));
    // r = (3m/(4·π·ρ))^(1/3); doubling mass scales radius by 2^(1/3).
    const r1 = debrisRadius(8000);
    const r2 = debrisRadius(16000);
    expect(r2 / r1).toBeCloseTo(Math.cbrt(2), 6);
  });

  it("is deterministic (step is a pure function)", () => {
    const d = spawnDebris("d3", { x: 1, y: 2 }, { x: 0, y: 0 }, { x: 0.5, y: -0.5 }, 250);
    expect(stepDebris(d)).toEqual(stepDebris(d));
  });
});
