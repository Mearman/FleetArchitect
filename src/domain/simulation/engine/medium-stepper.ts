/**
 * Medium field stepper — the per-tick FTCS integrator for ρ, ε, and momentum
 * (mx, my). Extracted from medium-field.ts to keep the types/constants file
 * under the module-size budget.
 */

import {
  MEDIUM_DT_S,
  MEDIUM_SLAB_DEPTH_M,
  MEDIUM_DENSITY_GRAD_REF_KG_PER_M3,
  mediumDiffusionSubSteps,
  mediumAdvectionSubSteps,
  densityGradientVelocity,
  excitationDecayRate,
  densityBoundaryRate,
  excitationBoundaryRate,
} from "./medium-field";
import type {
  MediumField,
  MediumState,
  MediumSources,
  MediumStepResult,
} from "./medium-field";

/**
 * Advance the medium field by one tick. Pure: returns new ρ and ε arrays, the
 * input arrays are not mutated, and identical inputs always produce identical
 * outputs.
 *
 * The integrator sub-steps with a FIXED count derived from the ρ diffusivity
 * and the ρ velocity ceiling (ρ is the stiffer substance — it advects); ε is
 * advanced in lock-step inside the same loop, with its own (smaller) diffusion
 * sub-step requirement folded into the same count when it would otherwise
 * need more. See the module header for the stability reasoning.
 *
 * Each sub-step:
 *   1. Computes the per-cell ρ advection (upwind), ρ diffusion (FTCS), ρ
 *      boundary sink, and ρ source.
 *   2. Computes the per-cell ε diffusion, ε volumetric decay, ε boundary
 *      sink, and ε source.
 *   3. Applies the change, clamping both substances to non-negative.
 *
 * Iteration order is row-major (cell index ascending), and the per-cell face
 * order is N, E, S, W — both fixed for floating-point determinism.
 */
export function stepMediumField(
  field: MediumField,
  state: MediumState,
  sources: MediumSources,
): MediumStepResult {
  // Production runs the OPTIMISED path: two pre-allocated buffers per substance
  // are ping-ponged across sub-steps (no per-sub-step slice()).
  return runMediumStep(field, state, sources, true);
}

/**
 * REFERENCE (oracle) medium step: the naive allocating path, kept as a
 * first-class implementation the equivalence test compares against the
 * optimised path. Not wired into production; production runs
 * {@link stepMediumField}. Allocates a fresh `slice()` of every current buffer
 * each sub-step — the O(5 · subSteps) allocation pattern the optimised
 * ping-pong replaces. The inner cell loop is identical, so the post-step
 * ρ / ε / εVis / mx / my arrays are byte-identical to the optimised path; only
 * the array objects differ.
 */
export function stepMediumFieldReference(
  field: MediumField,
  state: MediumState,
  sources: MediumSources,
): MediumStepResult {
  return runMediumStep(field, state, sources, false);
}

/**
 * Shared medium-step core. The ONLY difference between the reference (oracle)
 * and optimised (production) paths is the per-sub-step buffer strategy,
 * selected by `reuse`:
 *  - `reuse = false` (reference): allocates a fresh `slice()` of every current
 *    buffer each sub-step — the naive O(5 · subSteps) allocation pattern.
 *  - `reuse = true` (optimised): ping-pongs between two pre-allocated buffers
 *    per substance so no per-sub-step allocation occurs.
 *
 * The inner cell loop is identical in both paths: it reads only from the
 * current buffers and writes every cell of the next buffers, so the computed
 * values — and therefore the five post-step arrays — are byte-identical
 * regardless of which array objects hold current and next. Ping-pong safety:
 * for each substance `current` and `next` are always distinct arrays (A vs B),
 * matching the slice() path's read-from-current / write-to-next discipline, so
 * no cell ever reads a half-written neighbour value.
 */
function runMediumStep(
  field: MediumField,
  state: MediumState,
  sources: MediumSources,
  reuse: boolean,
): MediumStepResult {
  const { config, cellCount, neighbours, boundaryFaceCount } = field;
  const pitch = config.pitchM;
  const slabDepth = MEDIUM_SLAB_DEPTH_M;
  const widthM = config.widthM;
  // ρ is the stiffer substance: it advects at up to `rhoMaxVelocityMPerS`
  // (much larger per-cell effect than ε diffusion at the same D), so its
  // sub-step count governs. We still floor at ε's diffusion requirement in
  // case a caller tunes ε to a much higher D.
  const rhoSubSteps = Math.max(
    mediumDiffusionSubSteps(config.rhoDiffusionM2PerS, pitch),
    mediumAdvectionSubSteps(config.rhoMaxVelocityMPerS, pitch),
  );
  const epsSubSteps = mediumDiffusionSubSteps(config.epsDiffusionM2PerS, pitch);
  const momSubSteps = Math.max(
    mediumDiffusionSubSteps(config.momentumDiffusionM2PerS, pitch),
    mediumAdvectionSubSteps(config.velocityMaxMPerS, pitch),
  );
  const subSteps = Math.max(rhoSubSteps, epsSubSteps, momSubSteps);
  const dt = MEDIUM_DT_S / subSteps;

  // Work on mutable copies so the input is untouched (deterministic, pure).
  // In the optimised path each substance has a ping-pong partner buffer (B)
  // pre-allocated once; in the reference path the slice() branch is always
  // taken so the B buffers are never read (aliased to A to avoid a pointless
  // allocation in the naive baseline).
  const bufRhoA = state.rho.slice();
  const bufEpsA = state.eps.slice();
  const bufEpsVisA = state.epsVis.slice();
  const bufMxA = state.mx.slice();
  const bufMyA = state.my.slice();
  const bufRhoB = reuse ? new Array<number>(cellCount) : bufRhoA;
  const bufEpsB = reuse ? new Array<number>(cellCount) : bufEpsA;
  const bufEpsVisB = reuse ? new Array<number>(cellCount) : bufEpsVisA;
  const bufMxB = reuse ? new Array<number>(cellCount) : bufMxA;
  const bufMyB = reuse ? new Array<number>(cellCount) : bufMyA;
  let rho = bufRhoA;
  let eps = bufEpsA;
  let epsVis = bufEpsVisA;
  let mx = bufMxA;
  let my = bufMyA;

  // Call-invariant coefficients: each depends only on `config` or `pitch`, not
  // on the sub-step or the cell, so hoisting them out of the cell loop (and the
  // sub-step loop) means the two divisions and the config reads happen once per
  // step instead of per cell × per sub-step. Pure code motion — identical
  // values, computed in the same order, so the post-step arrays are unchanged.
  const advVelMax = config.velocityMaxMPerS;
  const invPitch2 = pitch > 0 ? 1 / (pitch * pitch) : 0;
  const invPitch = pitch > 0 ? 1 / pitch : 0;
  const D = config.rhoDiffusionM2PerS;
  const vMax = config.rhoMaxVelocityMPerS;
  const gradRef = MEDIUM_DENSITY_GRAD_REF_KG_PER_M3;
  const Deps = config.epsDiffusionM2PerS;
  const Dmom = config.momentumDiffusionM2PerS;
  const drag = config.momentumDragPerS;

  for (let step = 0; step < subSteps; step += 1) {
    const rhoNext = reuse ? (rho === bufRhoA ? bufRhoB : bufRhoA) : rho.slice();
    const epsNext = reuse ? (eps === bufEpsA ? bufEpsB : bufEpsA) : eps.slice();
    const epsVisNext = reuse ? (epsVis === bufEpsVisA ? bufEpsVisB : bufEpsVisA) : epsVis.slice();
    const mxNext = reuse ? (mx === bufMxA ? bufMxB : bufMxA) : mx.slice();
    const myNext = reuse ? (my === bufMyA ? bufMyB : bufMyA) : my.slice();
    for (let cell = 0; cell < cellCount; cell += 1) {
      const rhoHere = rho[cell] ?? 0;
      const epsHere = eps[cell] ?? 0;
      const epsVisHere = epsVis[cell] ?? 0;
      const mxHere = mx[cell] ?? 0;
      const myHere = my[cell] ?? 0;
      const cellNeighbours = neighbours[cell] ?? [];
      const bFaces = boundaryFaceCount[cell] ?? 0;

      // Derive per-cell velocity u = m / ρ (0 where ρ = 0), clamped to the
      // advection velocity ceiling. u is unbounded as ρ → 0 (momentum that
      // diffused into a near-empty cell), which would violate the CFL condition
      // the substep count is sized for; clamping to `velocityMaxMPerS` — above
      // the exhaust velocity, so genuine plume streaming is untouched — keeps
      // upwind advection stable and stops the field running away to ~1eN.
      let ux = rhoHere > 0 ? mxHere / rhoHere : 0;
      let uy = rhoHere > 0 ? myHere / rhoHere : 0;
      const uMag = Math.hypot(ux, uy);
      if (uMag > advVelMax) {
        const s = advVelMax / uMag;
        ux *= s;
        uy *= s;
      }
      // Per-cell grid position for face-direction mapping.
      const cellCol = cell % widthM;
      const cellRow = Math.floor(cell / widthM);

      // Per-cell finite-volume coefficients for a uniform-volume regular grid.
      // Cell volume `V = pitch² · slabDepth`; face area `A = pitch · slabDepth`;
      // centring distance `d = pitch`. The finite-volume flux rate per cell is
      //   diffusion:  (D · A / d) / V = D / pitch²          (per face)
      //   advection:  (u · A) / V       = u / pitch          (per face)
      //   boundary:   density · A · v_e = (ρ/V) · A · v_e = ρ · v_e / pitch (per face)
      // Both diffusion and advection coefficients are independent of slab depth
      // — it cancels because both the face flux and the cell capacity scale
      // with it. See the module header for the derivation.
      // --- Unified neighbour loop: diffusion for all four fields, ρ gradient-
      //     flow advection (existing bulk-flow closure), and velocity-driven
      //     upwind advection of all four fields by the cell's velocity u. The
      //     face-normal direction is derived from grid indices so diagonal
      //     transport is reconstructed from the x/y face fluxes (not flattened
      //     to cardinals). ---
      let rhoAdv = 0;     // ρ gradient-flow advection (bulk flow)
      let rhoDif = 0;     // ρ diffusion
      let rhoAdvVel = 0;  // ρ velocity-driven advection
      let epsDif = 0;
      let epsVisDif = 0;
      let epsVisAdvVel = 0;
      let mxDif = 0;
      let mxAdvVel = 0;
      let myDif = 0;
      let myAdvVel = 0;

      for (const neighbour of cellNeighbours) {
        const rhoThere = rho[neighbour] ?? 0;
        const epsThere = eps[neighbour] ?? 0;
        const epsVisThere = epsVis[neighbour] ?? 0;
        const mxThere = mx[neighbour] ?? 0;
        const myThere = my[neighbour] ?? 0;

        // Diffusive flux (FTCS): (D / pitch²) · (φ_to − φ_from) per face.
        if (D !== 0) rhoDif += D * invPitch2 * (rhoThere - rhoHere);
        if (Deps !== 0) epsDif += Deps * invPitch2 * (epsThere - epsHere);
        if (Deps !== 0) epsVisDif += Deps * invPitch2 * (epsVisThere - epsVisHere);
        if (Dmom !== 0) {
          mxDif += Dmom * invPitch2 * (mxThere - mxHere);
          myDif += Dmom * invPitch2 * (myThere - myHere);
        }

        // ρ gradient-flow advection (existing bulk-flow closure).
        if (vMax > 0) {
          const u = densityGradientVelocity(rhoHere, rhoThere, pitch, slabDepth, vMax, gradRef);
          if (u > 0) rhoAdv -= u * invPitch * rhoHere;
          else if (u < 0) rhoAdv -= u * invPitch * rhoThere;
        }

        // Velocity-driven advection (upwind) of ρ, mx, my by u. ε is NOT
        // advected yet — it feeds sensor signatures, and advecting exhaust heat
        // at km/s perturbs the AI. The glow still "streams" visually because the
        // renderer's ε×(1+ρ/ρref) brightness is amplified where the streaming ρ
        // is dense. Face-normal velocity is the AVERAGE of the two cells'
        // velocities (symmetric → mass-conservative).
        const uxThere = rhoThere > 0 ? mxThere / rhoThere : 0;
        const uyThere = rhoThere > 0 ? myThere / rhoThere : 0;
        // Clamp the neighbour velocity too (same low-ρ blow-up as the cell).
        const uMagThere = Math.hypot(uxThere, uyThere);
        const uxThereC = uMagThere > advVelMax ? uxThere * (advVelMax / uMagThere) : uxThere;
        const uyThereC = uMagThere > advVelMax ? uyThere * (advVelMax / uMagThere) : uyThere;
        const dCol = (neighbour % widthM) - cellCol;
        const dRow = (Math.floor(neighbour / widthM)) - cellRow;
        const u_n = ((ux + uxThereC) / 2) * dCol + ((uy + uyThereC) / 2) * dRow;
        if (u_n > 0) {
          rhoAdvVel -= u_n * invPitch * rhoHere;
          epsVisAdvVel -= u_n * invPitch * epsVisHere;
          mxAdvVel -= u_n * invPitch * mxHere;
          myAdvVel -= u_n * invPitch * myHere;
        } else if (u_n < 0) {
          rhoAdvVel -= u_n * invPitch * rhoThere;
          epsVisAdvVel -= u_n * invPitch * epsVisThere;
          mxAdvVel -= u_n * invPitch * mxThere;
          myAdvVel -= u_n * invPitch * myThere;
        }
      }

      // --- ρ boundary sink + source ---
      const rhoBnd = densityBoundaryRate(rhoHere, bFaces, pitch, config.boundaryVentVelocityMPerS);
      const rhoSrc = (sources.rho[cell] ?? 0) * dt;
      const dRho = (rhoAdv + rhoAdvVel + rhoDif - rhoBnd) * dt + rhoSrc;
      let rhoNew = rhoHere + dRho;
      if (rhoNew < 0) rhoNew = 0;
      rhoNext[cell] = rhoNew;

      // --- ε decay + boundary + source ---
      const epsDecay = excitationDecayRate(epsHere, config.epsDecayTimescaleS);
      const epsBnd = excitationBoundaryRate(epsHere, bFaces, config.boundaryEpsLossPerS);
      const epsSrc = (sources.eps[cell] ?? 0) * dt;
      const dEps = (epsDif + epsDecay - epsBnd) * dt + epsSrc;
      let epsNew = epsHere + dEps;
      if (epsNew < 0) epsNew = 0;
      epsNext[cell] = epsNew;

      // --- εVis decay + boundary + source + velocity advection (streams) ---
      const epsVisDecay = excitationDecayRate(epsVisHere, config.epsDecayTimescaleS);
      const epsVisBnd = excitationBoundaryRate(epsVisHere, bFaces, config.boundaryEpsLossPerS);
      const epsVisSrc = (sources.epsVisSrc[cell] ?? 0) * dt;
      const dEpsVis = (epsVisDif + epsVisAdvVel + epsVisDecay - epsVisBnd) * dt + epsVisSrc;
      let epsVisNew = epsVisHere + dEpsVis;
      if (epsVisNew < 0) epsVisNew = 0;
      epsVisNext[cell] = epsVisNew;

      // --- momentum drag + source (no clamp — momentum can be negative) ---
      mxNext[cell] = mxHere + (mxDif + mxAdvVel - drag * mxHere) * dt + (sources.mxSrc[cell] ?? 0) * dt;
      myNext[cell] = myHere + (myDif + myAdvVel - drag * myHere) * dt + (sources.mySrc[cell] ?? 0) * dt;
    }
    rho = rhoNext;
    eps = epsNext;
    epsVis = epsVisNext;
    mx = mxNext;
    my = myNext;
  }

  return { rho, eps, epsVis, mx, my };
}
