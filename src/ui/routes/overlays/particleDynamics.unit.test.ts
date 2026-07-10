import { describe, expect, it } from "vitest";
import type { ParticleSnapshot } from "@/schema/battle";
import {
  PARTICLE_COOLING_TIMESCALE_S,
  PARTICLE_LIFETIME_S,
  PARTICLE_RAMP_IN_S,
  particleRenderState,
  smoothstep,
  type ParticleRenderState,
} from "./particleDynamics";

/** A minimal particle with the fields {@link particleRenderState} reads. */
function makeParticle(overrides: Partial<ParticleSnapshot> = {}): ParticleSnapshot {
  return {
    x: 10,
    y: -5,
    vx: 3,
    vy: -2,
    intensity: 0.5,
    energyJ: 1e7,
    age: 0,
    ...overrides,
  };
}

describe("particleRenderState", () => {
  // A reused scratch object per loop, as the draw path does.
  const out: ParticleRenderState = { x: 0, y: 0, energyJ: 0, ageS: 0, rampAlpha: 0 };

  it("at dtSinceS=0 returns the particle's own position/energy/age unchanged", () => {
    const p = makeParticle();
    expect(particleRenderState(p, 0, out)).toBe(true);
    expect(out.x).toBe(p.x);
    expect(out.y).toBe(p.y);
    expect(out.energyJ).toBe(p.energyJ);
    expect(out.ageS).toBe(p.age);
    // rampAlpha is the smoothstep over the advanced age (== p.age at dt 0).
    expect(out.rampAlpha).toBe(smoothstep(0, PARTICLE_RAMP_IN_S, p.age));
  });

  it("advances position linearly with vx/vy over a few ticks", () => {
    const p = makeParticle({ x: 0, y: 0, vx: 4, vy: -6 });
    // Advance by an arbitrary dt; position = p + v * dt.
    const dt = 0.1;
    expect(particleRenderState(p, dt, out)).toBe(true);
    expect(out.x).toBeCloseTo(0 + 4 * dt, 12);
    expect(out.y).toBeCloseTo(0 + -6 * dt, 12);
  });

  it("cools energy by exactly one exp(-dt/tau) factor per elapsed dtSinceS", () => {
    // Compared directly against the closed-form, not a re-derived recurrence,
    // so the renderer and the engine's radiative-cooling model stay aligned.
    // The advance is closed-form from the particle's snapshotted state (not a
    // running accumulator), so each call independently applies exactly one
    // exp(-dt/tau) factor to p.energyJ.
    const p = makeParticle({ energyJ: 2e7, age: 0 });
    const dt = 0.3;
    expect(particleRenderState(p, dt, out)).toBe(true);
    expect(out.energyJ).toBeCloseTo(2e7 * Math.exp(-dt / PARTICLE_COOLING_TIMESCALE_S), 12);
    // A longer elapsed dt applies exactly one exp(-dt/tau) factor on that dt:
    // exp(-2dt/tau), NOT two sequential exp(-dt/tau) factors (the advance is
    // from the snapshot, so it stays the exact closed form at any dt).
    const dt2 = 0.6;
    expect(particleRenderState(p, dt2, out)).toBe(true);
    expect(out.energyJ).toBeCloseTo(2e7 * Math.exp(-dt2 / PARTICLE_COOLING_TIMESCALE_S), 12);
  });

  it("returns false once the advanced age reaches PARTICLE_LIFETIME_S", () => {
    // A particle already past its lifetime is culled (engine cull signal).
    const p = makeParticle({ age: PARTICLE_LIFETIME_S });
    expect(particleRenderState(p, 0, out)).toBe(false);
    // And a live particle crosses the lifetime after enough dt.
    const fresh = makeParticle({ age: 0 });
    expect(particleRenderState(fresh, PARTICLE_LIFETIME_S, out)).toBe(false);
  });

  it("rampAlpha is 0 at ageS=0, 1 once ageS>=PARTICLE_RAMP_IN_S, monotonic between", () => {
    // At age 0 the ramp has not started.
    particleRenderState(makeParticle({ age: 0 }), 0, out);
    expect(out.rampAlpha).toBe(0);
    // Once age reaches the ramp-in window the ramp is fully open.
    particleRenderState(makeParticle({ age: 0 }), PARTICLE_RAMP_IN_S, out);
    expect(out.rampAlpha).toBe(1);
    particleRenderState(makeParticle({ age: PARTICLE_RAMP_IN_S }), 0, out);
    expect(out.rampAlpha).toBe(1);
    // Midway through the window the ramp is strictly between 0 and 1.
    particleRenderState(makeParticle({ age: 0 }), PARTICLE_RAMP_IN_S / 2, out);
    expect(out.rampAlpha).toBeGreaterThan(0);
    expect(out.rampAlpha).toBeLessThan(1);
    // Monotonic non-decreasing across the ramp window.
    let prev = -Infinity;
    for (let i = 0; i <= 10; i += 1) {
      particleRenderState(makeParticle({ age: 0 }), (PARTICLE_RAMP_IN_S * i) / 10, out);
      expect(out.rampAlpha).toBeGreaterThanOrEqual(prev);
      prev = out.rampAlpha;
    }
  });
});

describe("smoothstep", () => {
  it("is 0 at edge0 and 1 at edge1", () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
  });

  it("is 0.5 exactly at the midpoint (symmetric Hermite)", () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });

  it("clamps to 0 below edge0 and to 1 above edge1", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it("works for a shifted, scaled window", () => {
    // edge0=2, edge1=4: at x=3 (midpoint) -> 0.5; below 2 -> 0; above 4 -> 1.
    expect(smoothstep(2, 4, 3)).toBeCloseTo(0.5, 12);
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 5)).toBe(1);
  });

  it("degenerates to a step at edge0 without dividing by zero", () => {
    // edge0 === edge1: no interpolation; returns 0 below and 1 at/above.
    expect(smoothstep(3, 3, 2)).toBe(0);
    expect(smoothstep(3, 3, 3)).toBe(1);
    expect(smoothstep(3, 3, 4)).toBe(1);
  });
});
