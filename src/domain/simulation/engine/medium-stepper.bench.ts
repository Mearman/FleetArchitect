import { bench, describe } from "vitest";

import {
  D_MEDIUM_M2_PER_S,
  EXCITATION_DECAY_TIMESCALE_S,
  ISM_DENSITY_KG_PER_M3,
  MEDIUM_BOUNDARY_EPS_LOSS_PER_S,
  MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S,
  MEDIUM_GRID_MARGIN_CELLS,
  MEDIUM_MAX_VELOCITY_M_PER_S,
  MEDIUM_PITCH_M_DEFAULT,
  MOMENTUM_DRAG_PER_S,
  VELOCITY_MAX_M_PER_S,
  buildMediumField,
  createMediumWorkBuffers,
  mediumStateFromDensity,
  zeroMediumSources,
} from "@/domain/simulation/engine/medium-field";
import type {
  MediumField,
  MediumSources,
  MediumState,
  MediumWorkBuffers,
} from "@/domain/simulation/engine/medium-field";
import { stepMediumField } from "@/domain/simulation/engine/medium-stepper";

/**
 * Per-tick medium-stepper microbench. The whole-battle bench
 * (`engine.bench.ts`) reports ms/tick over a full `runBattle` and cannot
 * isolate a phase-level win inside the medium step (its 5-21% RME swamps
 * anything less than a 10% whole-engine change — see the project lesson on
 * whole-battle benches missing phase wins). This file targets
 * `stepMediumField` alone, so an optimisation to the FTCS cell loop shows up
 * as a clean per-call delta for items 12-13 to compare against.
 *
 * Setup mirrors `engine.medium-field.equivalence.unit.test.ts`: build a
 * `MediumField` with the production SI coefficients, seed a `MediumState`, and
 * step it with `stepMediumField`. The grid is sized via the same formula
 * `buildArenaMedium` uses (deployment-bbox span at the 500 m default pitch,
 * plus `2 · MEDIUM_GRID_MARGIN_CELLS` on each axis), so the two cases below
 * cover a typical close-in engagement (~20 km span → 40×40) and the upper
 * tractable bound documented on `MEDIUM_PITCH_M_DEFAULT` (~50 km span →
 * 100×100).
 *
 * The state is seeded non-uniform (ISM baseline plus a dense, hot, moving
 * plume cell) so every branch the production stepper takes per tick —
 * density-gradient advection, velocity-driven upwind advection, ε decay, the
 * boundary sink — actually fires. With a uniform field those branches
 * short-circuit and the bench under-measures the real per-tick cost.
 *
 * `stepMediumField` does not mutate its input state (it copies into the work
 * buffers it does not alias), so the same state/sources can be passed every
 * iteration without `structuredClone` — the call is pure and deterministic.
 * The persistent `MediumWorkBuffers` set is created once at module scope and
 * reused, matching how `ArenaMedium.work` is owned and threaded in production.
 */

/** Build a medium field with the production SI coefficients at a given span. */
function fieldForSpan(spanCells: number): MediumField {
  // Same shape as buildArenaMedium: bbox-derived grid plus the padded margin
  // on each side. `spanCells` is the pre-margin cell count along one axis.
  const widthM = spanCells + 2 * MEDIUM_GRID_MARGIN_CELLS;
  const heightM = spanCells + 2 * MEDIUM_GRID_MARGIN_CELLS;
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
    momentumDiffusionM2PerS: D_MEDIUM_M2_PER_S,
    momentumDragPerS: MOMENTUM_DRAG_PER_S,
    velocityMaxMPerS: VELOCITY_MAX_M_PER_S,
  });
}

/**
 * Seed a non-quiescent state: ISM baseline ρ everywhere, plus a dense, hot,
 * moving cell at the grid centre (a stand-in for an exhaust plume mid-burn) so
 * the stepper's advection and decay branches all fire each tick.
 */
function seededState(field: MediumField): MediumState {
  // mediumStateFromDensity returns fresh Float64Arrays we own, so write the
  // plume seed in place — no extra allocation.
  const state = mediumStateFromDensity(field, ISM_DENSITY_KG_PER_M3);
  const centre = Math.floor(field.cellCount / 2);
  state.rho[centre] = (state.rho[centre] ?? 0) + 1e-12;
  state.eps[centre] = (state.eps[centre] ?? 0) + 1e-9;
  state.epsVis[centre] = (state.epsVis[centre] ?? 0) + 1e-9;
  state.mx[centre] = (state.mx[centre] ?? 0) + 1e-12;
  return state;
}

// Resolved once at module scope. The bench reuses the same field, state,
// sources, and work buffers for every iteration — the stepper is pure, so the
// per-call cost is what items 12-13 need to compare against, independent of
// how the field evolves between iterations.

// 40×40 interior (~20 km span at the 500 m pitch) plus margin: the everyday
// close-in engagement size. The cell count is representative of a real arena.
const typicalField = fieldForSpan(40);
const typicalState = seededState(typicalField);
const typicalSources: MediumSources = zeroMediumSources(typicalField);
const typicalWork: MediumWorkBuffers = createMediumWorkBuffers(typicalField.cellCount);

// 100×100 interior (~50 km span): the upper tractable bound documented on
// MEDIUM_PITCH_M_DEFAULT. Where per-tick medium cost hurts on a sensor-heavy
// long-range battle.
const largeField = fieldForSpan(100);
const largeState = seededState(largeField);
const largeSources: MediumSources = zeroMediumSources(largeField);
const largeWork: MediumWorkBuffers = createMediumWorkBuffers(largeField.cellCount);

describe("medium-stepper per-tick cost", () => {
  bench(
    "stepMediumField — typical 40×40 arena",
    () => {
      stepMediumField(typicalField, typicalState, typicalSources, typicalWork);
    },
    { iterations: 100, warmupIterations: 5 },
  );

  bench(
    "stepMediumField — large 100×100 arena",
    () => {
      stepMediumField(largeField, largeState, largeSources, largeWork);
    },
    { iterations: 20, warmupIterations: 2 },
  );
});
