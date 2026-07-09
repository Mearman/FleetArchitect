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
  IMPACT_EPS_VIS_COUPLING,
  PROJECTILE_WAKE_EPS_COUPLING,
  computeArenaMediumSources,
  type MediumImpactEntry,
  type ProjectileMediumEntry,
} from "@/domain/simulation/engine/medium-setup";

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
    );
    expect(result.epsVisSrc[15] ?? 0).toBeGreaterThan(0);
    expect(result.epsVisSrc[16] ?? 0).toBeGreaterThan(0);
    expect(result.epsVisSrc[17] ?? 0).toBeGreaterThan(0);
  });

  it("conserves the per-tick wake energy across the swept cells", () => {
    const f = wideField();
    const n = f.cellCount;
    const buffers = {
      rho: new Float64Array(n),
      eps: new Float64Array(n),
      epsVisSrc: new Float64Array(n),
      mxSrc: new Float64Array(n),
      mySrc: new Float64Array(n),
    };
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
    );
    const sum = (result.epsVisSrc[15] ?? 0) + (result.epsVisSrc[16] ?? 0) + (result.epsVisSrc[17] ?? 0);
    expect(sum).toBeCloseTo(PROJECTILE_WAKE_EPS_COUPLING, 10);
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
    );
    // Deposit = strike energy × coupling × dt, into epsVis only (renderer).
    expect(result.epsVisSrc[17] ?? 0).toBeCloseTo(1e6 * IMPACT_EPS_VIS_COUPLING * MEDIUM_DT_S, 10);
    // Never the signature substrate (eps) — impacts must not feed AI.
    expect(result.eps[17] ?? 0).toBe(0);
  });
});
