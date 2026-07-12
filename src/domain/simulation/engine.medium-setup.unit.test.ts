import { describe, expect, it } from "vitest";

import {
  D_MEDIUM_M2_PER_S,
  EXCITATION_DECAY_TIMESCALE_S,
  MEDIUM_BOUNDARY_EPS_LOSS_PER_S,
  MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S,
  MEDIUM_DT_S,
  MEDIUM_MAX_VELOCITY_M_PER_S,
  MEDIUM_PITCH_M_DEFAULT,
  buildMediumField,
  type MediumField,
} from "@/domain/simulation/engine/medium-field";
import {
  BEAM_CHANNEL_EPS_VIS_COUPLING,
  IMPACT_EPS_VIS_COUPLING,
  PROJECTILE_WAKE_EPS_COUPLING,
  PROJECTILE_WAKE_EPS_VIS_ENERGY_FRACTION,
  computeArenaMediumSources,
  refillImpactScratchFromBeams,
  type MediumImpactEntry,
  type ProjectileMediumEntry,
} from "@/domain/simulation/engine/medium-setup";
import type { SimBeam } from "@/domain/simulation/engine/beams";
import { createParticleStore, particleStoreFromParticles } from "@/domain/simulation/engine/exhaust-particles";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";

/**
 * Projectile wake deposit: a fast round must deposit its wake excitation along
 * the whole swept segment (prev → current), not only its instantaneous cell, so
 * the trail reads continuous. These tests drive the swept-path deposit into the
 * visual `epsVis` substrate.
 */

/** A 10×3 grid at the default 500 m pitch, centred on the world origin. World
 *  x → col `floor(x / 500 + 5)`; world y → row `floor(y / 500 + 1)`. */
function wideField(): MediumField {
  return buildMediumField({
    widthM: 10,
    heightM: 3,
    pitchM: MEDIUM_PITCH_M_DEFAULT,
    rhoDiffusionM2PerS: D_MEDIUM_M2_PER_S,
    rhoMaxVelocityMPerS: MEDIUM_MAX_VELOCITY_M_PER_S,
    epsDiffusionM2PerS: D_MEDIUM_M2_PER_S,
    epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
    boundaryVentVelocityMPerS: MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S,
    boundaryEpsLossPerS: MEDIUM_BOUNDARY_EPS_LOSS_PER_S,
    momentumDiffusionM2PerS: 0,
    momentumDragPerS: 0,
    velocityMaxMPerS: 0,
  });
}

describe("projectile wake deposit", () => {
  it("distributes epsVis along the swept path, not only the endpoint", () => {
    const f = wideField();
    const n = f.cellCount;
    const buffers = {
      rho: new Float64Array(n),
      eps: new Float64Array(n),
      epsVisSrc: new Float64Array(n),
      mxSrc: new Float64Array(n),
      mySrc: new Float64Array(n),
    };
    // prev (0, 0) → current (1000, 0) crosses cols 5, 6, 7 on row 1
    // → flat indices 15, 16, 17.
    const projectiles: ProjectileMediumEntry[] = [
      { x: 1000, y: 0, prevX: 0, prevY: 0, powered: false, burnTicks: 0, thrust: 0, mass: 1 },
    ];
    const result = computeArenaMediumSources(
      f,
      new Float64Array(n),
      [],
      [],
      projectiles,
      [],
      [],
      buffers,
      [],
      createParticleStore(),
    );
    expect(result.epsVisSrc[15] ?? 0).toBeGreaterThan(0);
    expect(result.epsVisSrc[16] ?? 0).toBeGreaterThan(0);
    expect(result.epsVisSrc[17] ?? 0).toBeGreaterThan(0);
  });

  it("scales the swept epsVis deposit with the round's kinetic energy", () => {
    // The wake's CONTINUOUS substrate (epsVis along the swept path) must carry
    // the round's real kinetic energy, not a flat token — otherwise the energy
    // exists only at the discrete per-tick splat and the trail reads as dots.
    // Two rounds on the same path at the same speed, one 4× the mass → 4× the
    // KE → ~4× the swept epsVis.
    const f = wideField();
    const n = f.cellCount;
    const runSum = (mass: number) => {
      const buffers = {
        rho: new Float64Array(n),
        eps: new Float64Array(n),
        epsVisSrc: new Float64Array(n),
        mxSrc: new Float64Array(n),
        mySrc: new Float64Array(n),
      };
      const projectiles: ProjectileMediumEntry[] = [
        { x: 1000, y: 0, prevX: 0, prevY: 0, powered: false, burnTicks: 0, thrust: 0, mass },
      ];
      const result = computeArenaMediumSources(
        f,
        new Float64Array(n),
        [],
        [],
        projectiles,
        [],
        [],
        buffers,
        [],
        createParticleStore(),
      );
      return (result.epsVisSrc[15] ?? 0) + (result.epsVisSrc[16] ?? 0) + (result.epsVisSrc[17] ?? 0);
    };
    const light = runSum(1);
    const heavy = runSum(4);
    expect(light).toBeGreaterThan(0);
    expect(heavy / light).toBeCloseTo(4, 6);
  });

  it("conserves the swept epsVis deposit as KE × coupling across the swept cells", () => {
    const f = wideField();
    const n = f.cellCount;
    const buffers = {
      rho: new Float64Array(n),
      eps: new Float64Array(n),
      epsVisSrc: new Float64Array(n),
      mxSrc: new Float64Array(n),
      mySrc: new Float64Array(n),
    };
    const mass = 1;
    const projectiles: ProjectileMediumEntry[] = [
      { x: 1000, y: 0, prevX: 0, prevY: 0, powered: false, burnTicks: 0, thrust: 0, mass },
    ];
    const result = computeArenaMediumSources(
      f,
      new Float64Array(n),
      [],
      [],
      projectiles,
      [],
      [],
      buffers,
      [],
      createParticleStore(),
    );
    const speedMps = Math.hypot(1000, 0) * TICKS_PER_SECOND;
    const kineticEnergyJ = 0.5 * mass * speedMps * speedMps;
    const sum = (result.epsVisSrc[15] ?? 0) + (result.epsVisSrc[16] ?? 0) + (result.epsVisSrc[17] ?? 0);
    expect(sum).toBeCloseTo(kineticEnergyJ * PROJECTILE_WAKE_EPS_VIS_ENERGY_FRACTION, 6);
  });

  it("leaves the signature (eps) wake deposit fixed regardless of kinetic energy", () => {
    // The energy-proportional deposit is VISUAL ONLY (epsVis, renderer). The
    // signature substrate (eps, feeds AI/sensors) must stay at the fixed coupling
    // so a faster round is no easier to detect — no gameplay change.
    const f = wideField();
    const n = f.cellCount;
    const epsAt = (mass: number) => {
      const buffers = {
        rho: new Float64Array(n),
        eps: new Float64Array(n),
        epsVisSrc: new Float64Array(n),
        mxSrc: new Float64Array(n),
        mySrc: new Float64Array(n),
      };
      const projectiles: ProjectileMediumEntry[] = [
        { x: 1000, y: 0, prevX: 0, prevY: 0, powered: false, burnTicks: 0, thrust: 0, mass },
      ];
      const result = computeArenaMediumSources(
        f,
        new Float64Array(n),
        [],
        [],
        projectiles,
        [],
        [],
        buffers,
        [],
        createParticleStore(),
      );
      return result.eps[17] ?? 0;
    };
    expect(epsAt(1)).toBeCloseTo(PROJECTILE_WAKE_EPS_COUPLING, 10);
    expect(epsAt(4)).toBeCloseTo(PROJECTILE_WAKE_EPS_COUPLING, 10);
  });
});

describe("impact burst deposit", () => {
  it("injects an epsVis burst at the impact cell, not into the signature substrate", () => {
    const f = wideField();
    const n = f.cellCount;
    const buffers = {
      rho: new Float64Array(n),
      eps: new Float64Array(n),
      epsVisSrc: new Float64Array(n),
      mxSrc: new Float64Array(n),
      mySrc: new Float64Array(n),
    };
    // Impact at (1000, 0) → col 7, row 1 → flat index 17.
    const impacts: MediumImpactEntry[] = [{ x: 1000, y: 0, energyJ: 1e6 }];
    const result = computeArenaMediumSources(
      f,
      new Float64Array(n),
      [],
      [],
      [],
      [],
      [],
      buffers,
      impacts,
      createParticleStore(),
    );
    // Deposit = strike energy × coupling × dt, into epsVis only (renderer).
    expect(result.epsVisSrc[17] ?? 0).toBeCloseTo(1e6 * IMPACT_EPS_VIS_COUPLING * MEDIUM_DT_S, 10);
    // Never the signature substrate (eps) — impacts must not feed AI.
    expect(result.eps[17] ?? 0).toBe(0);
  });
});

describe("beam channel deposit", () => {
  it("distributes epsVis along the full channel, not only the strike point", () => {
    const f = wideField();
    const n = f.cellCount;
    const buffers = {
      rho: new Float64Array(n),
      eps: new Float64Array(n),
      epsVisSrc: new Float64Array(n),
      mxSrc: new Float64Array(n),
      mySrc: new Float64Array(n),
    };
    // Channel source (0, 0) → strike (1000, 0) crosses cols 5, 6, 7 on row 1
    // → flat indices 15, 16, 17 (17 is also the strike cell).
    const impacts: MediumImpactEntry[] = [
      { x: 1000, y: 0, energyJ: 1e6, sourceX: 0, sourceY: 0 },
    ];
    const result = computeArenaMediumSources(
      f,
      new Float64Array(n),
      [],
      [],
      [],
      [],
      [],
      buffers,
      impacts,
      createParticleStore(),
    );
    expect(result.epsVisSrc[15] ?? 0).toBeGreaterThan(0);
    expect(result.epsVisSrc[16] ?? 0).toBeGreaterThan(0);
  });

  it("conserves the per-tick channel energy across the swept cells", () => {
    const f = wideField();
    const n = f.cellCount;
    const buffers = {
      rho: new Float64Array(n),
      eps: new Float64Array(n),
      epsVisSrc: new Float64Array(n),
      mxSrc: new Float64Array(n),
      mySrc: new Float64Array(n),
    };
    const impacts: MediumImpactEntry[] = [
      { x: 1000, y: 0, energyJ: 1e6, sourceX: 0, sourceY: 0 },
    ];
    const result = computeArenaMediumSources(
      f,
      new Float64Array(n),
      [],
      [],
      [],
      [],
      [],
      buffers,
      impacts,
      createParticleStore(),
    );
    // Sum across the swept channel cells (15, 16, 17) equals the channel
    // coupling exactly — the point-burst deposit at the strike cell (17) is a
    // separate effect asserted below, not part of this sum.
    const channelSum =
      (result.epsVisSrc[15] ?? 0) + (result.epsVisSrc[16] ?? 0) + (result.epsVisSrc[17] ?? 0) -
      1e6 * IMPACT_EPS_VIS_COUPLING * MEDIUM_DT_S;
    expect(channelSum).toBeCloseTo(1e6 * BEAM_CHANNEL_EPS_VIS_COUPLING * MEDIUM_DT_S, 10);
  });

  it("never deposits channel energy into the signature substrate (eps)", () => {
    const f = wideField();
    const n = f.cellCount;
    const buffers = {
      rho: new Float64Array(n),
      eps: new Float64Array(n),
      epsVisSrc: new Float64Array(n),
      mxSrc: new Float64Array(n),
      mySrc: new Float64Array(n),
    };
    const impacts: MediumImpactEntry[] = [
      { x: 1000, y: 0, energyJ: 1e6, sourceX: 0, sourceY: 0 },
    ];
    const result = computeArenaMediumSources(
      f,
      new Float64Array(n),
      [],
      [],
      [],
      [],
      [],
      buffers,
      impacts,
      createParticleStore(),
    );
    expect(result.eps[15] ?? 0).toBe(0);
    expect(result.eps[16] ?? 0).toBe(0);
  });
});

describe("impact scratch refill", () => {
  it("clears and refills the scratch from each beam's strike point + energy", () => {
    const beams: SimBeam[] = [
      { sourceId: "a", sourceX: 0, sourceY: 0, targetX: 1000, targetY: 0, kind: "beam", damageJ: 5e6, emissionTicks: 3 },
      { sourceId: "b", sourceX: 0, sourceY: 0, targetX: 500, targetY: 500, kind: "beam", damageJ: 2e6, emissionTicks: 2 },
    ];
    const scratch: MediumImpactEntry[] = [{ x: 999, y: 999, energyJ: 1 }];
    refillImpactScratchFromBeams(beams, scratch);
    expect(scratch).toHaveLength(2);
    expect(scratch[0]).toStrictEqual({ x: 1000, y: 0, energyJ: 5e6, sourceX: 0, sourceY: 0 });
    expect(scratch[1]).toStrictEqual({ x: 500, y: 500, energyJ: 2e6, sourceX: 0, sourceY: 0 });
  });
});

describe("particle residual deposit", () => {
  it("deposits a cooling particle's residual energy into epsVis at its cell", () => {
    const f = wideField();
    const n = f.cellCount;
    const buffers = {
      rho: new Float64Array(n),
      eps: new Float64Array(n),
      epsVisSrc: new Float64Array(n),
      mxSrc: new Float64Array(n),
      mySrc: new Float64Array(n),
    };
    // A cooling particle at (1000, 0) → col 7, row 1 → flat index 17.
    const particles = particleStoreFromParticles([
      { x: 1000, y: 0, vx: 0, vy: 0, intensity: 0.5, energyJ: 1e7, age: 0 },
    ]);
    const result = computeArenaMediumSources(
      f,
      new Float64Array(n),
      [],
      [],
      [],
      [],
      [],
      buffers,
      [],
      particles,
    );
    expect(result.epsVisSrc[17] ?? 0).toBeGreaterThan(0);
  });
});
