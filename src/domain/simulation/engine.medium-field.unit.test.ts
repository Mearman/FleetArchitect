import { describe, expect, it } from "vitest";

import {
  D_MEDIUM_M2_PER_S,
  EXCITATION_DECAY_TIMESCALE_S,
  GRID_FACE_NEIGHBOURS_MEDIUM,
  ISM_DENSITY_KG_PER_M3,
  MEDIUM_ADVECTION_CFL_MARGIN,
  MEDIUM_BOUNDARY_EPS_LOSS_PER_S,
  MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S,
  MEDIUM_DIFFUSION_CFL_MARGIN,
  MEDIUM_DT_S,
  MEDIUM_MAX_VELOCITY_M_PER_S,
  MEDIUM_PITCH_M_DEFAULT,
  MEDIUM_SLAB_DEPTH_M,
  TICKS_PER_SECOND,
  buildMediumField,
  mediumAdvectionSubSteps,
  mediumDiffusionSubSteps,
  mediumStateFromDensity,
  totalDensity,
  totalExcitation,
  zeroMediumSources,
  zeroMediumState,
  type MediumField,
  type MediumFieldConfig,
  type MediumSources,
  type MediumState,
} from "@/domain/simulation/engine/medium-field";
import { stepMediumField } from "@/domain/simulation/engine/medium-stepper";

/**
 * The arena-scale medium field.
 *
 * Tests assert the underlying physics directly:
 *  - Conservation under pure advection + diffusion (no boundary, no source).
 *  - CFL stability: a sharp delta, stepped for many ticks, stays bounded.
 *  - The boundary sink bleeds perimeter ρ toward zero; ε decays everywhere.
 *  - Determinism: identical inputs produce bit-identical outputs and the input
 *    is not mutated.
 *  - Source injection grows the local cell as `source · dt`.
 *
 * The medium grid is small (a few cells on a side) to keep the tests fast and
 * the physics legible; the real battlefield would be ~40 × 40.
 */

/** A small test field with the default SI anchors. */
function defaultField(
  widthM = 5,
  heightM = 5,
  overrides: Partial<MediumFieldConfig> = {},
): MediumField {
  return buildMediumField({
    widthM,
    heightM,
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
    ...overrides,
  });
}

/** Place a delta of ρ and ε at a single cell, zero everywhere else. */
function deltaState(
  field: MediumField,
  cell: number,
  rho: number,
  eps: number,
): MediumState {
  const state = zeroMediumState(field);
  const rhoArr = state.rho.slice();
  const epsArr = state.eps.slice();
  rhoArr[cell] = rho;
  epsArr[cell] = eps;
  return {
    rho: rhoArr,
    eps: epsArr,
    epsVis: new Float64Array(state.rho.length),
    mx: new Float64Array(state.rho.length),
    my: new Float64Array(state.rho.length),
  };
}

describe("engine.medium-field", () => {
  describe("SI constants and stability derivation", () => {
    it("derives dt from the tick rate as 1/TICKS_PER_SECOND seconds", () => {
      expect(MEDIUM_DT_S).toBeCloseTo(1 / TICKS_PER_SECOND, 12);
      expect(TICKS_PER_SECOND).toBe(30);
    });

    it("uses a per-cell FTCS sub-step count for diffusion at the chosen pitch", () => {
      // Non-diffusive substance needs no sub-stepping.
      expect(mediumDiffusionSubSteps(0, MEDIUM_PITCH_M_DEFAULT)).toBe(1);
      // At P = 500 m, D = 1e4 m²/s, dt = 1/30 s, 4 face-neighbours, margin 0.4:
      // n = 4 · 1e4 · (1/30) / (0.4 · 500²) = 4e4 / 3e6 ≈ 0.0133 → ceil → 1.
      expect(mediumDiffusionSubSteps(D_MEDIUM_M2_PER_S, MEDIUM_PITCH_M_DEFAULT)).toBe(1);
      // Verify the bound derivation by picking D so n is exactly 2 at P=500:
      // D = 2 · margin · P² / (GRID_FACE_NEIGHBOURS_MEDIUM · dt).
      const D =
        (2 * MEDIUM_DIFFUSION_CFL_MARGIN * MEDIUM_PITCH_M_DEFAULT * MEDIUM_PITCH_M_DEFAULT) /
        (GRID_FACE_NEIGHBOURS_MEDIUM * MEDIUM_DT_S);
      expect(mediumDiffusionSubSteps(D, MEDIUM_PITCH_M_DEFAULT)).toBe(2);
    });

    it("uses a per-cell CFL sub-step count for advection at the chosen pitch", () => {
      expect(mediumAdvectionSubSteps(0, MEDIUM_PITCH_M_DEFAULT)).toBe(1);
      // At P = 500 m, vMax = 10 000 m/s, dt = 1/30 s, 4 face-neighbours, 0.5:
      // n = 4 · 1e4 · (1/30) / (0.5 · 500) = 4e4/30 / 250 ≈ 5.33 → ceil → 6.
      const expected = Math.ceil(
        (GRID_FACE_NEIGHBOURS_MEDIUM * MEDIUM_MAX_VELOCITY_M_PER_S * MEDIUM_DT_S) /
          (MEDIUM_ADVECTION_CFL_MARGIN * MEDIUM_PITCH_M_DEFAULT),
      );
      expect(mediumAdvectionSubSteps(MEDIUM_MAX_VELOCITY_M_PER_S, MEDIUM_PITCH_M_DEFAULT)).toBe(
        expected,
      );
      // Verify the bound derivation: pick vMax so n is exactly 3 at P=500.
      const vMax =
        (3 * MEDIUM_ADVECTION_CFL_MARGIN * MEDIUM_PITCH_M_DEFAULT) /
        (GRID_FACE_NEIGHBOURS_MEDIUM * MEDIUM_DT_S);
      expect(mediumAdvectionSubSteps(vMax, MEDIUM_PITCH_M_DEFAULT)).toBe(3);
    });

    it("uses real ISM density as the faint-but-non-zero baseline", () => {
      // Documented ISM WIM density: n_H ≈ 0.1 cm⁻³ = 1e5 m⁻³; × m_H (1.67e-27 kg)
      // ≈ 1.7e-22 kg/m³.
      expect(ISM_DENSITY_KG_PER_M3).toBeGreaterThan(0);
      expect(ISM_DENSITY_KG_PER_M3).toBeLessThan(1e-20);
    });
  });

  describe("buildMediumField", () => {
    it("builds interior neighbours plus perimeter boundary faces for a 3x3 grid", () => {
      const field = defaultField(3, 3);
      // Centre cell (index 4) has 4 neighbours: N, E, S, W = 1, 5, 7, 3.
      expect(field.neighbours[4]).toEqual([1, 5, 7, 3]);
      expect(field.boundaryFaceCount[4]).toBe(0);
      // Top-edge cell (index 1, row 0 col 1) has no North neighbour; its
      // neighbours are E (2), S (4), W (0) — 3 interior + 1 boundary face.
      expect(field.neighbours[1]).toEqual([2, 4, 0]);
      expect(field.boundaryFaceCount[1]).toBe(1);
      // Corner cell (top-left, index 0) has E (1) and S (3): 2 neighbours +
      // 2 boundary faces (N and W both on the perimeter).
      expect(field.neighbours[0]).toEqual([1, 3]);
      expect(field.boundaryFaceCount[0]).toBe(2);
    });

    it("resolves the SI default coefficients", () => {
      const field = defaultField(2, 2);
      expect(field.config.rhoDiffusionM2PerS).toBe(D_MEDIUM_M2_PER_S);
      expect(field.config.rhoMaxVelocityMPerS).toBe(MEDIUM_MAX_VELOCITY_M_PER_S);
      expect(field.config.epsDecayTimescaleS).toBe(EXCITATION_DECAY_TIMESCALE_S);
      expect(field.config.boundaryVentVelocityMPerS).toBe(
        MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S,
      );
    });
  });

  describe("conservation under pure advection + diffusion", () => {
    it("conserves mass exactly across a single interior face in one tick", () => {
      // A 3x1 field with NO boundary sink (turn it off) and a ρ delta on
      // cell 0. Diffusion carries ρ across the (0→1) and (1→2) interior
      // faces; with no boundary sink the total across {0,1,2} is invariant.
      const field = buildMediumField({
        widthM: 3,
        heightM: 1,
        pitchM: MEDIUM_PITCH_M_DEFAULT,
        rhoDiffusionM2PerS: D_MEDIUM_M2_PER_S,
        rhoMaxVelocityMPerS: 0, // disable advection; isolate diffusion
        epsDiffusionM2PerS: 0,
        epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
        boundaryVentVelocityMPerS: 0, // disable boundary sink
        boundaryEpsLossPerS: 0,
        momentumDiffusionM2PerS: 0,
        momentumDragPerS: 0,
        velocityMaxMPerS: 0,
      });
      const state = deltaState(field, 0, 1.0, 0);
      const result = stepMediumField(field, state, zeroMediumSources(field));
      // Pure interior diffusion: total conserved exactly to FP precision.
      expect(totalDensity(result.rho)).toBeCloseTo(totalDensity(state.rho), 9);
      // Cell 0 cooled, cells 1 and 2 warmed.
      expect(result.rho[0] ?? 0).toBeLessThan(1.0);
      expect(result.rho[1] ?? 0).toBeGreaterThan(0);
    });

    it("conserves mass across both advection and diffusion in a closed field", () => {
      // Same 3x1 field, advection on (gradient-driven bulk flow), boundary
      // sink off. The gradient closure moves mass from high-ρ cell 0 toward
      // low-ρ cells 1 and 2; total is conserved.
      const field = buildMediumField({
        widthM: 3,
        heightM: 1,
        pitchM: MEDIUM_PITCH_M_DEFAULT,
        rhoDiffusionM2PerS: D_MEDIUM_M2_PER_S,
        rhoMaxVelocityMPerS: MEDIUM_MAX_VELOCITY_M_PER_S,
        epsDiffusionM2PerS: 0,
        epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
        boundaryVentVelocityMPerS: 0, // boundary sink OFF
        boundaryEpsLossPerS: 0,
        momentumDiffusionM2PerS: 0,
        momentumDragPerS: 0,
        velocityMaxMPerS: 0,
      });
      const state = deltaState(field, 0, 1.0, 0);
      const initial = totalDensity(state.rho);
      let rho = state.rho;
      for (let tick = 0; tick < 30; tick += 1) {
        const result = stepMediumField(field, { rho, eps: new Float64Array(3), epsVis: new Float64Array(3), mx: new Float64Array(3), my: new Float64Array(3) }, zeroMediumSources(field));
        // Mass conserved every tick (no source, no boundary).
        expect(totalDensity(result.rho)).toBeCloseTo(initial, 9);
        // Stays finite.
        for (const v of result.rho) expect(Number.isFinite(v)).toBe(true);
        rho = result.rho;
      }
    });
  });

  describe("CFL stability over many ticks", () => {
    it("keeps a sharp ρ and ε delta bounded over 1000 ticks", () => {
      const field = defaultField(7, 7);
      // Sharp delta: all the mass and energy in the centre cell.
      const centre = 3 * 7 + 3;
      const state = deltaState(field, centre, 1e6, 1e9);
      let rho = state.rho;
      let eps = state.eps;
      for (let tick = 0; tick < 1000; tick += 1) {
        const result = stepMediumField(
          field,
          { rho, eps, epsVis: new Float64Array(49), mx: new Float64Array(49), my: new Float64Array(49) },
          zeroMediumSources(field),
        );
        for (let i = 0; i < result.rho.length; i += 1) {
          expect(Number.isFinite(result.rho[i] ?? 0)).toBe(true);
          expect(Number.isNaN(result.rho[i] ?? 0)).toBe(false);
          expect(result.rho[i] ?? 0).toBeGreaterThanOrEqual(0);
        }
        for (let i = 0; i < result.eps.length; i += 1) {
          expect(Number.isFinite(result.eps[i] ?? 0)).toBe(true);
          expect(Number.isNaN(result.eps[i] ?? 0)).toBe(false);
          expect(result.eps[i] ?? 0).toBeGreaterThanOrEqual(0);
        }
        // No runaway: values stay below a generous bound (the delta was 1e6
        // kg / 1e9 J; the field should equalise or decay, never amplify).
        for (const v of result.rho) expect(v).toBeLessThan(1e9);
        for (const v of result.eps) expect(v).toBeLessThan(1e12);
        rho = result.rho;
        eps = result.eps;
      }
      // After 1000 ticks (~33 s) the ε should have decayed substantially
      // (timescale 5 s ⇒ exp(-33/5) ≈ 0.0014 of the initial energy remains,
      // minus what diffused to neighbours and what the boundary radiated).
      expect(totalExcitation(eps)).toBeLessThan(1e9);
    });
  });

  describe("boundary sink", () => {
    it("bleeds perimeter density toward zero over time", () => {
      // A 5x5 field seeded at the ISM baseline ρ everywhere. The perimeter
      // cells vent to vacuum; the interior cells are fed by diffusion from
      // the perimeter's neighbours but also drain. After many ticks the
      // perimeter cells are well below the interior.
      const field = defaultField(5, 5);
      const state = mediumStateFromDensity(field, ISM_DENSITY_KG_PER_M3);
      let rho = state.rho;
      let eps = state.eps;
      for (let tick = 0; tick < 100; tick += 1) {
        const result = stepMediumField(field, { rho, eps, epsVis: new Float64Array(25), mx: new Float64Array(25), my: new Float64Array(25) }, zeroMediumSources(field));
        rho = result.rho;
        eps = result.eps;
      }
      // A corner cell (2 boundary faces) vents faster than an edge cell (1).
      const corner = rho[0] ?? 0;
      const edge = rho[2] ?? 0; // top edge, middle
      const interior = rho[12] ?? 0; // centre
      expect(corner).toBeLessThan(edge);
      expect(edge).toBeLessThan(interior);
      // All remain finite and non-negative.
      for (const v of rho) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });

    it("decays excitation toward zero everywhere (volumetric + boundary)", () => {
      // Seed ε in every cell. With no source the volumetric decay drives it
      // toward zero; the boundary radiative loss accelerates that at the edge.
      const field = defaultField(5, 5);
      const state: MediumState = {
        rho: new Float64Array(25),
        eps: new Float64Array(25).fill(1e6),
        epsVis: new Float64Array(25),
        mx: new Float64Array(25),
        my: new Float64Array(25),
      };
      let eps = state.eps;
      let rho = state.rho;
      const initial = totalExcitation(eps);
      for (let tick = 0; tick < 200; tick += 1) {
        const result = stepMediumField(field, { rho, eps, epsVis: new Float64Array(25), mx: new Float64Array(25), my: new Float64Array(25) }, zeroMediumSources(field));
        eps = result.eps;
        rho = result.rho;
      }
      // Monotonic net decay: total ε after 200 ticks (~6.7 s) is well below
      // the initial. Volumetric decay alone gives exp(-6.7/5) ≈ 0.26; the
      // boundary radiative loss accelerates that, so the total lands
      // materially below the volumetric-only figure.
      expect(totalExcitation(eps)).toBeLessThan(initial * 0.2);
      expect(totalExcitation(eps)).toBeGreaterThan(0);
      // The corner (2 boundary faces) has lost more than an interior cell.
      expect(eps[0]).toBeLessThan(eps[12] ?? Infinity);
    });
  });

  describe("determinism and purity", () => {
    it("produces bit-identical outputs for identical inputs", () => {
      const field = defaultField(5, 5);
      const state = deltaState(field, 12, 1e3, 1e5);
      const sources = zeroMediumSources(field);
      const a = stepMediumField(field, state, sources);
      const b = stepMediumField(field, state, sources);
      // Deep-equal: every element bit-identical.
      expect(a.rho.length).toBe(b.rho.length);
      expect(a.eps.length).toBe(b.eps.length);
      for (let i = 0; i < a.rho.length; i += 1) {
        expect(a.rho[i]).toBe(b.rho[i]);
      }
      for (let i = 0; i < a.eps.length; i += 1) {
        expect(a.eps[i]).toBe(b.eps[i]);
      }
    });

    it("does not mutate the input state arrays", () => {
      const field = defaultField(5, 5);
      const state = deltaState(field, 12, 1e3, 1e5);
      const sources = zeroMediumSources(field);
      const rhoBefore = state.rho.slice();
      const epsBefore = state.eps.slice();
      const sourcesRhoBefore = sources.rho.slice();
      const sourcesEpsBefore = sources.eps.slice();
      stepMediumField(field, state, sources);
      expect(state.rho).toEqual(rhoBefore);
      expect(state.eps).toEqual(epsBefore);
      expect(sources.rho).toEqual(sourcesRhoBefore);
      expect(sources.eps).toEqual(sourcesEpsBefore);
    });

    it("produces identical results across many ticks (deterministic long run)", () => {
      const field = defaultField(6, 6);
      const state = deltaState(field, 14, 1e4, 1e6);
      const sources = zeroMediumSources(field);
      // Run A.
      let rhoA = state.rho;
      let epsA = state.eps;
      for (let tick = 0; tick < 50; tick += 1) {
        const r = stepMediumField(field, { rho: rhoA, eps: epsA, epsVis: new Float64Array(36), mx: new Float64Array(36), my: new Float64Array(36) }, sources);
        rhoA = r.rho;
        epsA = r.eps;
      }
      // Run B (identical inputs, identical sequence).
      let rhoB = state.rho;
      let epsB = state.eps;
      for (let tick = 0; tick < 50; tick += 1) {
        const r = stepMediumField(field, { rho: rhoB, eps: epsB, epsVis: new Float64Array(36), mx: new Float64Array(36), my: new Float64Array(36) }, sources);
        rhoB = r.rho;
        epsB = r.eps;
      }
      expect(rhoA).toEqual(rhoB);
      expect(epsA).toEqual(epsB);
    });
  });

  describe("source injection", () => {
    it("grows the local ρ cell by source · dt per tick (no transport)", () => {
      // Isolate the source: disable diffusion, advection, and boundary sink.
      const field = buildMediumField({
        widthM: 3,
        heightM: 1,
        pitchM: MEDIUM_PITCH_M_DEFAULT,
        rhoDiffusionM2PerS: 0,
        rhoMaxVelocityMPerS: 0,
        epsDiffusionM2PerS: 0,
        epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
        boundaryVentVelocityMPerS: 0,
        boundaryEpsLossPerS: 0,
        momentumDiffusionM2PerS: 0,
        momentumDragPerS: 0,
        velocityMaxMPerS: 0,
      });
      const state = zeroMediumState(field);
      const sources: MediumSources = {
        rho: [10, 0, 0], // 10 kg/s into cell 0
        eps: [0, 0, 0],
        epsVisSrc: [0, 0, 0],
        mxSrc: [0, 0, 0],
        mySrc: [0, 0, 0],
      };
      const result = stepMediumField(field, state, sources);
      // Cell 0 grew by source · dt = 10 · (1/30) = 0.333... kg.
      expect(result.rho[0]).toBeCloseTo(10 * MEDIUM_DT_S, 9);
      // Other cells unchanged.
      expect(result.rho[1]).toBe(0);
      expect(result.rho[2]).toBe(0);
    });

    it("grows local ε by source · dt, then it decays over subsequent ticks", () => {
      // Disable transport so we can read the decay clearly. Source ε into
      // cell 0 for one tick; then remove the source and run more ticks.
      const field = buildMediumField({
        widthM: 3,
        heightM: 1,
        pitchM: MEDIUM_PITCH_M_DEFAULT,
        rhoDiffusionM2PerS: 0,
        rhoMaxVelocityMPerS: 0,
        epsDiffusionM2PerS: 0,
        epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
        boundaryVentVelocityMPerS: 0,
        boundaryEpsLossPerS: 0,
        momentumDiffusionM2PerS: 0,
        momentumDragPerS: 0,
        velocityMaxMPerS: 0,
      });
      const state = zeroMediumState(field);
      const sourceOn: MediumSources = {
        rho: [0, 0, 0],
        eps: [100, 0, 0], // 100 J/s into cell 0
        epsVisSrc: [0, 0, 0],
        mxSrc: [0, 0, 0],
        mySrc: [0, 0, 0],
      };
      const step1 = stepMediumField(field, state, sourceOn);
      // Cell 0 ε grew by source · dt; with no transport and a single sub-step
      // the decay is zero on the first sub-step (ε starts at 0), so step1 is
      // exactly the injected amount. The decay kicks in once ε > 0.
      const injected = 100 * MEDIUM_DT_S;
      expect(step1.eps[0]).toBeCloseTo(injected, 9);
      expect(step1.eps[0]).toBeGreaterThan(0);

      // Remove the source. Subsequent ticks: ε decays monotonically.
      const sourceOff = zeroMediumSources(field);
      let eps = step1.eps;
      let rho = step1.rho;
      let prev = step1.eps[0] ?? 0;
      for (let tick = 0; tick < 30; tick += 1) {
        const r = stepMediumField(field, { rho, eps, epsVis: new Float64Array(3), mx: new Float64Array(3), my: new Float64Array(3) }, sourceOff);
        expect(r.eps[0] ?? 0).toBeLessThanOrEqual(prev);
        prev = r.eps[0] ?? 0;
        eps = r.eps;
        rho = r.rho;
      }
      // After ~1 s of source-off decay, ε is at roughly exp(-1/5) ≈ 0.82 of
      // the injected amount (volumetric decay, τ = 5 s). Assert a band that
      // proves decay happened (well below 1.0) without over-constraining.
      expect(eps[0] ?? 0).toBeLessThan(injected * 0.9);
      expect(eps[0] ?? 0).toBeGreaterThan(injected * 0.5);
    });
  });

  describe("velocity-driven transport", () => {
    it("advects density downstream when the medium carries momentum", () => {
      // ρ in cell 1 with +x momentum: velocity = mx/ρ = 100 m/s East.
      // Diffusion, gradient bulk-flow, and drag all disabled — the ONLY
      // transport is velocity-driven advection. After stepping, ρ must
      // have moved downstream (East, toward cell 2).
      const field = buildMediumField({
        widthM: 3,
        heightM: 1,
        pitchM: MEDIUM_PITCH_M_DEFAULT,
        rhoDiffusionM2PerS: 0,
        rhoMaxVelocityMPerS: 0,
        epsDiffusionM2PerS: 0,
        epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
        boundaryVentVelocityMPerS: 0,
        boundaryEpsLossPerS: 0,
        momentumDiffusionM2PerS: 0,
        momentumDragPerS: 0,
        velocityMaxMPerS: MEDIUM_MAX_VELOCITY_M_PER_S,
      });
      const result = stepMediumField(
        field,
        { rho: new Float64Array([0, 1, 0]), eps: new Float64Array(3), epsVis: new Float64Array(3), mx: new Float64Array([0, 100, 0]), my: new Float64Array(3) },
        zeroMediumSources(field),
      );
      // Cell 1 lost ρ (it streamed downstream).
      expect(result.rho[1]).toBeLessThan(1);
      // Cell 2 (East, downstream) gained ρ.
      expect(result.rho[2]).toBeGreaterThan(0);
    });

    it("conserves total mass under velocity-driven advection", () => {
      // In a closed field (no sources, no boundary sink) velocity-driven
      // advection must conserve total ρ — the face-average velocity is
      // symmetric so outflow from one cell equals inflow to its neighbour.
      const field = buildMediumField({
        widthM: 3,
        heightM: 1,
        pitchM: MEDIUM_PITCH_M_DEFAULT,
        rhoDiffusionM2PerS: 0,
        rhoMaxVelocityMPerS: 0,
        epsDiffusionM2PerS: 0,
        epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
        boundaryVentVelocityMPerS: 0,
        boundaryEpsLossPerS: 0,
        momentumDiffusionM2PerS: 0,
        momentumDragPerS: 0,
        velocityMaxMPerS: MEDIUM_MAX_VELOCITY_M_PER_S,
      });
      const initial = { rho: new Float64Array([0, 10, 0]), eps: new Float64Array(3), epsVis: new Float64Array(3), mx: new Float64Array([0, 500, 0]), my: new Float64Array(3) };
      const result = stepMediumField(field, initial, zeroMediumSources(field));
      const totalBefore = initial.rho.reduce((a, b) => a + b, 0);
      const totalAfter = result.rho.reduce((a, b) => a + b, 0);
      expect(totalAfter).toBeCloseTo(totalBefore, 6);
    });
  });

  describe("ISM baseline seeding", () => {
    it("seeds uniform density equal to ISM · pitch² · slabDepth per cell", () => {
      const field = defaultField(2, 2);
      const state = mediumStateFromDensity(field, ISM_DENSITY_KG_PER_M3);
      const expected =
        ISM_DENSITY_KG_PER_M3 *
        MEDIUM_PITCH_M_DEFAULT *
        MEDIUM_PITCH_M_DEFAULT *
        MEDIUM_SLAB_DEPTH_M;
      for (const v of state.rho) {
        expect(v).toBeCloseTo(expected, 30);
      }
    });

    it("keeps a uniform ISM field steady under advection (zero gradient)", () => {
      // A uniform field has zero gradient everywhere, so the bulk-flow closure
      // returns zero velocity and advection does nothing. Disable diffusion
      // and the boundary sink to isolate advection.
      const field = buildMediumField({
        widthM: 4,
        heightM: 4,
        pitchM: MEDIUM_PITCH_M_DEFAULT,
        rhoDiffusionM2PerS: 0, // isolate advection
        rhoMaxVelocityMPerS: MEDIUM_MAX_VELOCITY_M_PER_S,
        epsDiffusionM2PerS: 0,
        epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
        boundaryVentVelocityMPerS: 0, // no boundary sink
        boundaryEpsLossPerS: 0,
        momentumDiffusionM2PerS: 0,
        momentumDragPerS: 0,
        velocityMaxMPerS: 0,
      });
      const state = mediumStateFromDensity(field, ISM_DENSITY_KG_PER_M3);
      const result = stepMediumField(field, state, zeroMediumSources(field));
      // Uniform ρ ⇒ no advection ⇒ field unchanged.
      for (let i = 0; i < state.rho.length; i += 1) {
        expect(result.rho[i]).toBeCloseTo(state.rho[i] ?? 0, 30);
      }
    });
  });
});
