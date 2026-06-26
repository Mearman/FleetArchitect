import { describe, expect, it } from "vitest";

import { MEDIUM_DT_S } from "./engine/medium-field";
import {
  emitBeamChannelParticles,
  emitExhaustParticles,
  emitImpactBurstParticles,
  emitProjectileWakeParticles,
  stepExhaustParticle,
  stepExhaustParticles,
  type ExhaustParticle,
} from "./engine/exhaust-particles";

// Exhaust-plume particles: the visible "energetic material" a firing engine
// throws into space. Each particle is real transported matter — a position, a
// velocity (the exhaust velocity, in the exhaust direction), and an energy it
// radiates as it cools. The glow is the rendered light of these particles, not
// a field layered on top: where the particles actually are is what shines.
//
// These tests drive the particle model up from the smallest behaviour:
// transport (material leaves the source), then emission, cooling, dispersal.

describe("engine.exhaust-particles", () => {
  it("advances an exhaust particle by velocity · dt (material transports, it does not pool)", () => {
    // A particle just emitted at x=1000 moving at 3000 m/s in +x.
    const p: ExhaustParticle = { x: 1000, y: 0, vx: 3000, vy: 0, energy: 1, age: 0 };
    const stepped = stepExhaustParticle(p, MEDIUM_DT_S);

    // Transported downstream by velocity · dt — the defining behaviour: the
    // material leaves the source instead of accumulating there.
    expect(stepped.x).toBeCloseTo(1000 + 3000 * MEDIUM_DT_S, 9);
    expect(stepped.y).toBeCloseTo(0, 9);
  });

  it("a firing thruster emits exhaust particles moving at the exhaust velocity in the exhaust direction", () => {
    // Nozzle at the origin; exhaust points in +x at 3000 m/s; throttle full.
    const parts = emitExhaustParticles({
      nozzleX: 0,
      nozzleY: 0,
      dirX: 1,
      dirY: 0,
      exhaustSpeed: 3000,
      throttle: 1,
      jetPower: 1e6,
      dt: MEDIUM_DT_S,
    });

    // Firing throws material out (not nothing)...
    expect(parts.length).toBeGreaterThan(0);
    // ...moving at the exhaust speed, in the exhaust direction.
    for (const p of parts) {
      expect(p.vx).toBeCloseTo(3000, 1);
      expect(p.vy).toBeCloseTo(0, 1);
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
      jetPower: 1e6,
      dt: MEDIUM_DT_S,
    });
    expect(parts).toEqual([]);
  });

  it("an exhaust particle's energy decays as it cools (the glow fades behind the engine)", () => {
    const p: ExhaustParticle = { x: 0, y: 0, vx: 3000, vy: 0, energy: 1, age: 0 };
    const stepped = stepExhaustParticle(p, MEDIUM_DT_S);
    // Cooled a little this tick (dimmer) but still radiating (not gone).
    expect(stepped.energy).toBeLessThan(1);
    expect(stepped.energy).toBeGreaterThan(0);
  });

  it("a stepped particle ages (so stale plume parcels can be culled by lifetime)", () => {
    const p: ExhaustParticle = { x: 0, y: 0, vx: 3000, vy: 0, energy: 1, age: 0 };
    const stepped = stepExhaustParticle(p, MEDIUM_DT_S);
    expect(stepped.age).toBeCloseTo(MEDIUM_DT_S, 9);
  });

  it("steps every particle and culls those past their lifetime", () => {
    const fresh: ExhaustParticle = { x: 0, y: 0, vx: 1000, vy: 0, energy: 1, age: 0.1 };
    const stale: ExhaustParticle = { x: 0, y: 0, vx: 1000, vy: 0, energy: 0.01, age: 99 };
    const out = stepExhaustParticles([fresh, stale], MEDIUM_DT_S);
    // The stale parcel is gone; the fresh one survives, aged by one tick.
    expect(out).toHaveLength(1);
    expect(out[0]!.age).toBeCloseTo(0.1 + MEDIUM_DT_S, 9);
  });

  it("a beam emits particles along its source-to-target channel", () => {
    // A beam from the origin striking at x=1000: its ionised channel glows where
    // the beam is, so particles land along the line (not streaming off it).
    const parts = emitBeamChannelParticles({
      sourceX: 0,
      sourceY: 0,
      targetX: 1000,
      targetY: 0,
      beamPower: 1e6,
      dt: MEDIUM_DT_S,
    });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      // On the source->target line (y == 0)...
      expect(p.y).toBeCloseTo(0, 6);
      // ...and within the segment.
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(1001);
    }
  });

  it("a projectile leaves a heated wake particle at its position", () => {
    // A round at x=500 moving fast: it leaves the medium it just passed through
    // glowing behind it, so a low-energy wake particle lands where the round is.
    const parts = emitProjectileWakeParticles({
      x: 500,
      y: 0,
      wakePower: 1e3,
      dt: MEDIUM_DT_S,
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]!.x).toBeCloseTo(500, 6);
    expect(parts[0]!.y).toBeCloseTo(0, 6);
  });

  it("an impact bursts particles radially outward from the strike point", () => {
    const parts = emitImpactBurstParticles({
      x: 0,
      y: 0,
      energy: 1e6,
      dt: MEDIUM_DT_S,
    });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      // Each starts at the strike point...
      expect(p.x).toBeCloseTo(0, 6);
      expect(p.y).toBeCloseTo(0, 6);
      // ...and flies outward (positive speed).
      expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(0);
    }
    // The burst spreads (not all one direction): at least two distinct angles.
    const angles = new Set(parts.map((p) => Math.round(Math.atan2(p.vy, p.vx) * 10)));
    expect(angles.size).toBeGreaterThan(1);
  });
});
