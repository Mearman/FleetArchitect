import { describe, expect, it } from "vitest";

import { MEDIUM_DT_S } from "./engine/medium-field";
import {
  BEAM_ENERGY_HALFSAT_J,
  EXHAUST_ENERGY_HALFSAT_J,
  IMPACT_ENERGY_HALFSAT_J,
  WAKE_ENERGY_HALFSAT_J,
  emitBeamChannelParticles,
  emitExhaustParticles,
  emitImpactBurstParticles,
  emitProjectileWakeParticles,
  gatherParticles,
  particleIntensityFromEnergy,
  stepExhaustParticle,
  stepExhaustParticles,
  type ExhaustParticle,
} from "./engine/exhaust-particles";

// Exhaust/plume particles: the visible "energetic material" a firing weapon
// throws into space. Each particle is real transported matter — a position, a
// velocity (the exhaust velocity, in the exhaust direction), and a glow
// intensity it radiates as it cools. The glow is the rendered light of these
// particles, not a field layered on top: where the particles actually are is
// what shines.
//
// Each source's intensity is driven by its real emitted energy (Joules) through
// a saturating `energyJ / (energyJ + halfSatJ)` curve, so the tests below pick
// energies that are meaningful multiples of the relevant per-source half-sat
// constant — well above it to assert a near-max glow, well below it to assert a
// near-zero glow — rather than a flat placeholder that only satisfies the type
// checker.

describe("engine.exhaust-particles", () => {
  it("advances an exhaust particle by velocity · dt (material transports, it does not pool)", () => {
    // A particle just emitted at x=1000 moving at 3000 m/s in +x.
    const p: ExhaustParticle = { x: 1000, y: 0, vx: 3000, vy: 0, intensity: 1, age: 0 };
    const stepped = stepExhaustParticle(p, MEDIUM_DT_S);

    // Transported downstream by velocity · dt — the defining behaviour: the
    // material leaves the source instead of accumulating there.
    expect(stepped.x).toBeCloseTo(1000 + 3000 * MEDIUM_DT_S, 9);
    expect(stepped.y).toBeCloseTo(0, 9);
  });

  it("a firing thruster emits exhaust particles moving at the exhaust velocity in the exhaust direction", () => {
    // Jet energy 100× the thruster half-sat → the fresh parcel glows near the
    // top of the saturating curve (100/101 ≈ 0.990).
    const energyJ = 100 * EXHAUST_ENERGY_HALFSAT_J;
    const parts = emitExhaustParticles({
      nozzleX: 0,
      nozzleY: 0,
      dirX: 1,
      dirY: 0,
      exhaustSpeed: 3000,
      throttle: 1,
      energyJ,
      dt: MEDIUM_DT_S,
    });

    // Firing throws material out (not nothing)...
    expect(parts.length).toBeGreaterThan(0);
    // ...moving at the exhaust speed, in the exhaust direction.
    for (const p of parts) {
      expect(p.vx).toBeCloseTo(3000, 1);
      expect(p.vy).toBeCloseTo(0, 1);
      // A large jet energy lands near the top of the curve but never exceeds 1.
      expect(p.intensity).toBeGreaterThan(0.98);
      expect(p.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("a non-firing thruster (throttle 0) emits no exhaust", () => {
    const parts = emitExhaustParticles({
      nozzleX: 0,
      nozzleY: 0,
      dirX: 1,
      dirY: 0,
      exhaustSpeed: 3000,
      throttle: 0,
      energyJ: 100 * EXHAUST_ENERGY_HALFSAT_J,
      dt: MEDIUM_DT_S,
    });
    expect(parts).toEqual([]);
  });

  it("a weak exhaust (jet energy well below the thruster half-sat) emits dim particles", () => {
    // Jet energy at 1/100 of the thruster half-sat → a faint parcel near the
    // bottom of the curve (0.01/1.01 ≈ 0.0099), still non-zero.
    const energyJ = EXHAUST_ENERGY_HALFSAT_J / 100;
    const parts = emitExhaustParticles({
      nozzleX: 0,
      nozzleY: 0,
      dirX: 1,
      dirY: 0,
      exhaustSpeed: 3000,
      throttle: 1,
      energyJ,
      dt: MEDIUM_DT_S,
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]!.intensity).toBeGreaterThan(0);
    expect(parts[0]!.intensity).toBeLessThan(0.02);
  });

  it("an exhaust particle's intensity decays as it cools (the glow fades behind the engine)", () => {
    const p: ExhaustParticle = { x: 0, y: 0, vx: 3000, vy: 0, intensity: 1, age: 0 };
    const stepped = stepExhaustParticle(p, MEDIUM_DT_S);
    // Cooled a little this tick (dimmer) but still radiating (not gone).
    expect(stepped.intensity).toBeLessThan(1);
    expect(stepped.intensity).toBeGreaterThan(0);
  });

  it("a stepped particle ages (so stale plume parcels can be culled by lifetime)", () => {
    const p: ExhaustParticle = { x: 0, y: 0, vx: 3000, vy: 0, intensity: 1, age: 0 };
    const stepped = stepExhaustParticle(p, MEDIUM_DT_S);
    expect(stepped.age).toBeCloseTo(MEDIUM_DT_S, 9);
  });

  it("steps every particle and culls those past their lifetime", () => {
    const fresh: ExhaustParticle = { x: 0, y: 0, vx: 1000, vy: 0, intensity: 1, age: 0.1 };
    const stale: ExhaustParticle = { x: 0, y: 0, vx: 1000, vy: 0, intensity: 0.01, age: 99 };
    const out = stepExhaustParticles([fresh, stale], MEDIUM_DT_S);
    // The stale parcel is gone; the fresh one survives, aged by one tick.
    expect(out).toHaveLength(1);
    expect(out[0]!.age).toBeCloseTo(0.1 + MEDIUM_DT_S, 9);
  });

  it("a beam emits particles along its source-to-target channel", () => {
    // Beam energy 100× the beam half-sat → the ionised channel glows near the
    // top of the curve along its whole length.
    const energyJ = 100 * BEAM_ENERGY_HALFSAT_J;
    const parts = emitBeamChannelParticles({
      sourceX: 0,
      sourceY: 0,
      targetX: 1000,
      targetY: 0,
      energyJ,
      dt: MEDIUM_DT_S,
    });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      // On the source->target line (y == 0)...
      expect(p.y).toBeCloseTo(0, 6);
      // ...and within the segment.
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(1001);
      // Bright channel (near-max) for a high-energy strike.
      expect(p.intensity).toBeGreaterThan(0.98);
      expect(p.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("a projectile leaves a heated wake particle at its position", () => {
    // Wake kinetic energy at 1/100 of the wake half-sat → the heated medium
    // behind the round glows faintly (near the bottom of the curve).
    const energyJ = WAKE_ENERGY_HALFSAT_J / 100;
    const parts = emitProjectileWakeParticles({
      x: 500,
      y: 0,
      energyJ,
      dt: MEDIUM_DT_S,
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]!.x).toBeCloseTo(500, 6);
    expect(parts[0]!.y).toBeCloseTo(0, 6);
    // A faint wake, but non-zero.
    expect(parts[0]!.intensity).toBeGreaterThan(0);
    expect(parts[0]!.intensity).toBeLessThan(0.02);
  });

  it("an impact bursts particles radially outward from the strike point", () => {
    // Strike energy 100× the impact half-sat → the ejecta flashes bright.
    const energyJ = 100 * IMPACT_ENERGY_HALFSAT_J;
    const parts = emitImpactBurstParticles({
      x: 0,
      y: 0,
      energyJ,
      dt: MEDIUM_DT_S,
    });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      // Each starts at the strike point...
      expect(p.x).toBeCloseTo(0, 6);
      expect(p.y).toBeCloseTo(0, 6);
      // ...and flies outward (positive speed).
      expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(0);
      // A high-energy strike produces a bright burst (near-max).
      expect(p.intensity).toBeGreaterThan(0.98);
      expect(p.intensity).toBeLessThanOrEqual(1);
    }
    // The burst spreads (not all one direction): at least two distinct angles.
    const angles = new Set(parts.map((p) => Math.round(Math.atan2(p.vy, p.vx) * 10)));
    expect(angles.size).toBeGreaterThan(1);
  });

  it("gatherParticles collects emissions from all sources in fixed order", () => {
    // One of each source. Fixed concatenation order matters for determinism.
    // Energies are picked off each source's own half-sat so the gathered set
    // exercises the full brightness range (bright thruster/beam/impact, faint
    // wake) without changing the gather's structure.
    const out = gatherParticles(
      {
        thrusters: [
          { nozzleX: 0, nozzleY: 0, dirX: 1, dirY: 0, exhaustSpeed: 3000, throttle: 1, energyJ: 100 * EXHAUST_ENERGY_HALFSAT_J },
        ],
        beams: [{ sourceX: 0, sourceY: 0, targetX: 500, targetY: 0, energyJ: 100 * BEAM_ENERGY_HALFSAT_J }],
        projectiles: [{ x: 100, y: 0, energyJ: WAKE_ENERGY_HALFSAT_J / 100 }],
        impacts: [{ x: 500, y: 0, energyJ: 100 * IMPACT_ENERGY_HALFSAT_J }],
      },
      MEDIUM_DT_S,
    );
    // Exhaust (1) + beam channel over 500 m (6) + wake (1) + impact burst (8).
    expect(out).toHaveLength(1 + 6 + 1 + 8);
    // Thrusters come first — the streaming exhaust particle (vx ≈ exhaust speed).
    expect(out[0]!.vx).toBeCloseTo(3000, 1);
  });
});

describe("particleIntensityFromEnergy", () => {
  it("saturates toward 1 for energy far above the half-saturation constant", () => {
    // 100× half-sat: 100 / (100 + 1) = 100/101 ≈ 0.990.
    expect(
      particleIntensityFromEnergy(100 * EXHAUST_ENERGY_HALFSAT_J, EXHAUST_ENERGY_HALFSAT_J),
    ).toBeCloseTo(100 / 101, 6);
  });

  it("approaches 0 for energy far below the half-saturation constant", () => {
    // half-sat / 100: 0.01 / (0.01 + 1) = 1/101 ≈ 0.0099.
    expect(
      particleIntensityFromEnergy(EXHAUST_ENERGY_HALFSAT_J / 100, EXHAUST_ENERGY_HALFSAT_J),
    ).toBeCloseTo(1 / 101, 6);
  });

  it("returns exactly 0.5 at the half-saturation energy", () => {
    // The defining anchor: energyJ === halfSatJ lands at the curve's midpoint.
    expect(
      particleIntensityFromEnergy(EXHAUST_ENERGY_HALFSAT_J, EXHAUST_ENERGY_HALFSAT_J),
    ).toBe(0.5);
  });

  it("returns exactly 0 for non-positive energy (the guard clause, no negative glow)", () => {
    // Zero energy deposits nothing; negative energy is non-physical. Both must
    // read as exactly 0 (not a signed or NaN leak) so a quiescent source is dark.
    expect(particleIntensityFromEnergy(0, EXHAUST_ENERGY_HALFSAT_J)).toBe(0);
    expect(particleIntensityFromEnergy(-1, EXHAUST_ENERGY_HALFSAT_J)).toBe(0);
    expect(particleIntensityFromEnergy(-1e9, BEAM_ENERGY_HALFSAT_J)).toBe(0);
  });

  it("each source's per-source half-sat anchor puts its own typical energy at 0.5", () => {
    // The four anchors are distinct per-source constants (a thruster's jet
    // power and a wake's kinetic energy span ~6 orders of magnitude); each
    // maps its own anchor energy to the curve midpoint.
    expect(particleIntensityFromEnergy(EXHAUST_ENERGY_HALFSAT_J, EXHAUST_ENERGY_HALFSAT_J)).toBe(0.5);
    expect(particleIntensityFromEnergy(BEAM_ENERGY_HALFSAT_J, BEAM_ENERGY_HALFSAT_J)).toBe(0.5);
    expect(particleIntensityFromEnergy(WAKE_ENERGY_HALFSAT_J, WAKE_ENERGY_HALFSAT_J)).toBe(0.5);
    expect(particleIntensityFromEnergy(IMPACT_ENERGY_HALFSAT_J, IMPACT_ENERGY_HALFSAT_J)).toBe(0.5);
  });
});
