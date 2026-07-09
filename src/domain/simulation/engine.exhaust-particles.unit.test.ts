import { describe, expect, it } from "vitest";

import { MEDIUM_DT_S } from "./engine/medium-field";
import {
  BEAM_ENERGY_HALFSAT_J,
  EXHAUST_COOLING_TIMESCALE_S,
  EXHAUST_ENERGY_HALFSAT_J,
  EXHAUST_PARTICLE_LIFETIME_S,
  IMPACT_ENERGY_HALFSAT_J,
  MAX_LIVE_PARTICLES,
  WAKE_ENERGY_HALFSAT_J,
  appendParticles,
  emitBeamChannelParticles,
  emitExhaustParticles,
  emitImpactBurstParticles,
  emitProjectileWakeParticles,
  gatherParticles,
  particleIntensityFromEnergy,
  particleStoreFromParticles,
  particlesFromStore,
  stepParticleStore,
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
    const store = particleStoreFromParticles([
      { x: 1000, y: 0, vx: 3000, vy: 0, intensity: 1, energyJ: 1e6, age: 0 },
    ]);
    stepParticleStore(store, MEDIUM_DT_S);

    // Transported downstream by velocity · dt — the defining behaviour: the
    // material leaves the source instead of accumulating there.
    expect(store.x[0] ?? 0).toBeCloseTo(1000 + 3000 * MEDIUM_DT_S, 9);
    expect(store.y[0] ?? 0).toBeCloseTo(0, 9);
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
    const store = particleStoreFromParticles([
      { x: 0, y: 0, vx: 3000, vy: 0, intensity: 1, energyJ: 1e6, age: 0 },
    ]);
    stepParticleStore(store, MEDIUM_DT_S);
    // Cooled a little this tick (dimmer) but still radiating (not gone).
    expect(store.intensity[0] ?? 0).toBeLessThan(1);
    expect(store.intensity[0] ?? 0).toBeGreaterThan(0);
  });

  it("a stepped particle ages (so stale plume parcels can be culled by lifetime)", () => {
    const store = particleStoreFromParticles([
      { x: 0, y: 0, vx: 3000, vy: 0, intensity: 1, energyJ: 1e6, age: 0 },
    ]);
    stepParticleStore(store, MEDIUM_DT_S);
    expect(store.age[0] ?? 0).toBeCloseTo(MEDIUM_DT_S, 9);
  });

  it("steps every particle and culls those past their lifetime (order preserved)", () => {
    // Three parcels: two fresh (distinct x so we can assert ORDER is preserved),
    // one stale (past lifetime) in the middle — the compaction must drop only
    // the stale one and keep the two fresh ones in their original relative order.
    const store = particleStoreFromParticles([
      { x: 10, y: 0, vx: 1000, vy: 0, intensity: 1, energyJ: 1e6, age: 0.1 },
      { x: 99, y: 0, vx: 1000, vy: 0, intensity: 0.01, energyJ: 1e3, age: EXHAUST_PARTICLE_LIFETIME_S + 1 },
      { x: 20, y: 0, vx: 1000, vy: 0, intensity: 1, energyJ: 1e6, age: 0.2 },
    ]);
    stepParticleStore(store, MEDIUM_DT_S);
    // The stale middle parcel is gone; the two fresh ones survive, aged by one
    // tick, in their original relative order (x=10 before x=20).
    expect(store.count).toBe(2);
    expect(store.x[0] ?? 0).toBeCloseTo(10 + 1000 * MEDIUM_DT_S, 6);
    expect(store.x[1] ?? 0).toBeCloseTo(20 + 1000 * MEDIUM_DT_S, 6);
    expect(store.age[0] ?? 0).toBeCloseTo(0.1 + MEDIUM_DT_S, 9);
    expect(store.age[1] ?? 0).toBeCloseTo(0.2 + MEDIUM_DT_S, 9);
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

  it("appendParticles concatenates emissions at the tail when under capacity", () => {
    // Survivors [A, B] (distinct x to track order), two new emissions [C, D].
    const store = particleStoreFromParticles([
      { x: 1, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: 1e6, age: 0.1 },
      { x: 2, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: 1e6, age: 0.1 },
    ]);
    appendParticles(store, [
      { x: 3, y: 0, vx: 0, vy: 0, intensity: 0.9, energyJ: 1e6, age: 0 },
      { x: 4, y: 0, vx: 0, vy: 0, intensity: 0.9, energyJ: 1e6, age: 0 },
    ]);
    // Survivors keep their slots; emissions land at the tail in gather order.
    expect(store.count).toBe(4);
    expect([store.x[0], store.x[1], store.x[2], store.x[3]]).toEqual([1, 2, 3, 4]);
  });

  it("appendParticles drops the OLDEST survivors first when over capacity (order preserved)", () => {
    // The byte-identity-critical cap: over capacity, drop from the FRONT (oldest
    // survivors), keeping the newest survivors + all emissions in relative order
    // — i.e. `survivors.concat(emissions).slice(-MAX)`. Fill the store to its
    // full MAX_LIVE_PARTICLES capacity with distinct, ordered x positions so the
    // dropped (oldest) and kept (newest) slots are unambiguous.
    const survivors: ExhaustParticle[] = [];
    for (let i = 0; i < MAX_LIVE_PARTICLES; i += 1) {
      survivors.push({ x: i + 1, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: 1e6, age: 0.1 });
    }
    const store = particleStoreFromParticles(survivors);
    // Three new emissions appended → total MAX + 3 → drop the 3 oldest survivors.
    appendParticles(store, [
      { x: MAX_LIVE_PARTICLES + 1, y: 0, vx: 0, vy: 0, intensity: 0.9, energyJ: 1e6, age: 0 },
      { x: MAX_LIVE_PARTICLES + 2, y: 0, vx: 0, vy: 0, intensity: 0.9, energyJ: 1e6, age: 0 },
      { x: MAX_LIVE_PARTICLES + 3, y: 0, vx: 0, vy: 0, intensity: 0.9, energyJ: 1e6, age: 0 },
    ]);
    expect(store.count).toBe(MAX_LIVE_PARTICLES);
    // The three oldest survivors (x = 1, 2, 3) were dropped; the kept set runs
    // 4..MAX then the three emissions, in strict ascending order — no reordering.
    const xs: number[] = [];
    for (let i = 0; i < store.count; i += 1) xs.push(store.x[i] ?? 0);
    const expected: number[] = [];
    for (let i = 4; i <= MAX_LIVE_PARTICLES; i += 1) expected.push(i);
    expected.push(MAX_LIVE_PARTICLES + 1, MAX_LIVE_PARTICLES + 2, MAX_LIVE_PARTICLES + 3);
    expect(xs).toEqual(expected);
  });

  it("particlesFromStore round-trips through particleStoreFromStore in order", () => {
    // The checkpoint boundary: capture materialises to plain records, restore
    // rebuilds the store. Order and every double must survive the round trip.
    const original: ExhaustParticle[] = [
      { x: -90.5, y: 12.25, vx: 3000, vy: -0.001, intensity: 0.7, energyJ: 4.2e7, age: 0.4 },
      { x: 0, y: 0, vx: 0, vy: 0, intensity: 0, energyJ: 0, age: 0 },
      { x: 1e9, y: -1e9, vx: 8.6e9, vy: 1, intensity: 0.999, energyJ: 8.6e9, age: 5.999 },
    ];
    const store = particleStoreFromParticles(original);
    expect(particlesFromStore(store)).toEqual(original);
  });

  it("a particle's energyJ decays with cooling (so its residual radiation fades)", () => {
    const store = particleStoreFromParticles([
      { x: 0, y: 0, vx: 0, vy: 0, intensity: 1, energyJ: 1e7, age: 0 },
    ]);
    stepParticleStore(store, MEDIUM_DT_S);
    const cooling = Math.exp(-MEDIUM_DT_S / EXHAUST_COOLING_TIMESCALE_S);
    expect(store.energyJ[0] ?? 0).toBeCloseTo(1e7 * cooling, 9);
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
