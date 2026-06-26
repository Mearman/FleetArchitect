import { describe, expect, it } from "vitest";

import { MEDIUM_DT_S } from "./engine/medium-field";
import {
  emitExhaustParticles,
  stepExhaustParticle,
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
});
