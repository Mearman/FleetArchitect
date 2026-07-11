import { describe, expect, it } from "vitest";
import type { ParticleSnapshot } from "@/schema/battle";
import {
  PARTICLE_COOLING_TIMESCALE_S,
  PARTICLE_LIFETIME_S,
  PARTICLE_RAMP_IN_S,
  computeParticleBridges,
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

describe("computeParticleBridges", () => {
  // The engine's per-tick cooling: each tick multiplies energyJ by exactly one
  // exp(-dt/tau) factor, so a chain of consecutive wake beads built by repeating
  // that factor has ages 0, dt, 2*dt, ... and the exact prediction the bridge
  // matcher uses.
  const dt = 1 / 30;
  const cooling = Math.exp(-dt / PARTICLE_COOLING_TIMESCALE_S);

  it("recovers a 3-bead wake chain as 2 OLDER->YOUNGER bridges in order", () => {
    // Build a synthetic single chain by repeating the cooling factor once per
    // tick of age, ages 0, dt, 2*dt, all stationary at the same spot.
    const e0 = 1e7;
    const e1 = e0 * cooling;
    const e2 = e1 * cooling;
    const particles: ParticleSnapshot[] = [
      { x: 0, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e0, age: 0 },
      { x: 0, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e1, age: dt },
      { x: 0, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e2, age: 2 * dt },
    ];
    const bridges = computeParticleBridges(particles);
    expect(bridges).toHaveLength(2);
    // Convention: fromIndex = OLDER (larger age), toIndex = YOUNGER (smaller age).
    // The age-dt bead (index 1) is the older endpoint of the youngest pair, and
    // the age-2dt bead (index 2) is the older endpoint of the next pair.
    expect(bridges).toContainEqual({ fromIndex: 1, toIndex: 0 });
    expect(bridges).toContainEqual({ fromIndex: 2, toIndex: 1 });
  });

  it("routes each younger bead to the older bead in its OWN spatial chain", () => {
    // Two interleaved chains of IDENTICAL starting energy but different
    // positions, so at each age the two chains' beads are energy-tied and only
    // spatial distance can tell them apart.
    const e0 = 1e7;
    const e1 = e0 * cooling;
    const e2 = e1 * cooling;
    // Chain A beads at x=0,1,2; chain B beads at x=1000,1001,1002 — same ages and
    // energies per age, ordered A then B within each age group.
    const particles: ParticleSnapshot[] = [
      { x: 0, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e0, age: 0 },
      { x: 1000, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e0, age: 0 },
      { x: 1, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e1, age: dt },
      { x: 1001, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e1, age: dt },
      { x: 2, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e2, age: 2 * dt },
      { x: 1002, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e2, age: 2 * dt },
    ];
    const bridges = computeParticleBridges(particles);
    expect(bridges).toHaveLength(4);
    // Each bridge must connect two beads in the SAME chain (A: indices 0,2,4;
    // B: indices 1,3,5). Assert by chain membership rather than exact index, so
    // the test pins the spatial-disambiguation property the matcher guarantees.
    const chainA = new Set([0, 2, 4]);
    const chainB = new Set([1, 3, 5]);
    for (const b of bridges) {
      const inA = chainA.has(b.fromIndex) && chainA.has(b.toIndex);
      const inB = chainB.has(b.fromIndex) && chainB.has(b.toIndex);
      expect(inA || inB).toBe(true);
    }
    // And the older->younger age convention holds on every bridge.
    for (const b of bridges) {
      const from = particles[b.fromIndex];
      const to = particles[b.toIndex];
      // Bridge endpoints always reference valid array indices; the guard narrows
      // for the age comparison without an assertion cast.
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      if (from !== undefined && to !== undefined) {
        expect(from.age).toBeGreaterThan(to.age);
      }
    }
  });

  it("never bridges a particle with non-zero velocity", () => {
    // A stationary chain plus a MOVING particle whose energy is engineered to
    // match the cooling prediction exactly — the moving particle must still be
    // excluded from every bridge endpoint.
    const e0 = 1e7;
    const e1 = e0 * cooling;
    const particles: ParticleSnapshot[] = [
      { x: 0, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: e0, age: 0 },
      // Moving particle at the older age with the exactly-predicted energy.
      { x: 0.5, y: 0, vx: 5, vy: 0, intensity: 0.5, energyJ: e1, age: dt },
    ];
    const bridges = computeParticleBridges(particles);
    expect(bridges).toHaveLength(0);
  });

  it("returns an empty array for empty or single-particle input", () => {
    expect(computeParticleBridges([])).toEqual([]);
    expect(
      computeParticleBridges([
        { x: 0, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: 1e7, age: 0 },
      ]),
    ).toEqual([]);
  });

  it("leaves a younger bead unbridged when no older energy matches closely", () => {
    // Two stationary beads at adjacent ages but energies that violate the
    // cooling law by far more than the 1e-6 threshold -> no bridge.
    const particles: ParticleSnapshot[] = [
      { x: 0, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: 1e7, age: 0 },
      { x: 1, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: 3e3, age: dt },
    ];
    expect(computeParticleBridges(particles)).toEqual([]);
  });

  it("bridges an accelerating round's wake into one chain (energy grows per tick)", () => {
    // A burning missile ACCELERATES under thrust, so each tick's wake bead is
    // emitted with a HIGHER kinetic energy than the one before it (speed rising
    // ~5% per tick -> KE rising ~10.25% per tick). The beads are still one
    // physical trail — laid one-per-tick along the path, 150 m apart — and must
    // bridge into a continuous ribbon. The constant-emission cooling prediction
    // (E_older = E_younger * cooling) is violated by ~9% here, far above the
    // 1e-6 same-emission threshold, so a matcher keyed only on that prediction
    // leaves the trail as a beaded chain — the confirmed "discontiguous
    // projectile trail" artefact.
    const speedGrowthPerTick = 1.05;
    const keGrowthPerTick = speedGrowthPerTick * speedGrowthPerTick; // ~1.1025
    const stepM = 150; // per-tick world displacement along the trail
    const beads = 6;
    const keNow = 1e7; // KE at the most-recent (age 0) tick
    const particles: ParticleSnapshot[] = [];
    for (let k = 0; k < beads; k += 1) {
      // Bead emitted `k` ticks ago: its emission KE was lower (the missile was
      // slower), and it has cooled `k` times since.
      const emissionKe = keNow / Math.pow(keGrowthPerTick, k);
      const energyJ = emissionKe * Math.pow(cooling, k);
      particles.push({
        x: 0,
        y: -k * stepM,
        vx: 0,
        vy: 0,
        intensity: 0.5,
        energyJ,
        age: k * dt,
      });
    }
    const bridges = computeParticleBridges(particles);
    // Six beads in one trail -> five older->younger links, chaining end to end.
    expect(bridges).toHaveLength(beads - 1);
    // Every bead except the youngest (age 0) and the oldest (age (beads-1)*dt)
    // is both a `from` (older endpoint) and a `to` (younger endpoint), so the
    // chain is connected end to end with no orphan.
    const froms = new Set(bridges.map((b) => b.fromIndex));
    const tos = new Set(bridges.map((b) => b.toIndex));
    expect(tos.size).toBe(beads - 1);
    expect(froms.size).toBe(beads - 1);
  });
});
