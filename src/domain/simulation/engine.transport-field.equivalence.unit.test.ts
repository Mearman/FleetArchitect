import { describe, expect, it } from "vitest";
import {
  createTransportWorkBuffers,
  TICKS_PER_SECOND,
  stepTransportField,
  stepTransportFieldReference,
  totalScalar,
  type TransportFace,
  type TransportField,
  type TransportSubstance,
} from "@/domain/simulation/engine/transport-field";

/**
 * Equivalence between the reference (oracle) and optimised transport-field
 * steppers. Both share the `runTransportStep` core; the ONLY difference is the
 * per-sub-step buffer strategy — reference allocates a fresh `slice()` every
 * sub-step, optimised ping-pongs between two pre-allocated buffers (and the
 * boundary flux is delivered via a single reused out-param scratch instead of a
 * fresh object per call). The inner cell loop is identical, so the post-step φ
 * array, accumulated hull momentum, and per-cell diagnostics are byte-identical
 * regardless of which array objects hold current and next.
 *
 * Fixtures exercise the determinism-sensitive paths the optimisation touches:
 * multi-substep diffusion (the FTCS stability sub-stepping), multi-substep
 * advection with the per-cell CFL×4 coordination that protects mass
 * conservation, boundary fluxes that carry hull momentum, and the opt-in
 * diagnostics breakdown. Each runs both paths on `structuredClone`-d identical
 * inputs and asserts byte-identical results, plus a sanity check that the step
 * actually evolved the field (so the assertion is meaningful, not trivially
 * equal because nothing happened).
 */

/** A two-cell graph with one open interior face in each direction. */
function twoCellField(substance: TransportSubstance): TransportField {
  const faces: TransportFace[] = [
    { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
    { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
  ];
  return { substance, faces, boundaryCells: [] };
}

/** Run both steppers on deep clones of the same φ and assert byte-identical
 *  post-step state (φ array, hull momentum, and — when diagnostics are on — the
 *  per-cell delta breakdown). `stepTransportField` does not mutate its input,
 *  but the clones keep the two runs strictly independent. */
function assertStepEquivalent(
  field: TransportField,
  phi: number[],
  options?: { diagnostics?: boolean },
): void {
  const ref = stepTransportFieldReference(field, structuredClone(phi), options);
  const opt = stepTransportField(field, structuredClone(phi), options);
  expect(opt.phi).toEqual(ref.phi);
  expect(opt.momentumX).toBe(ref.momentumX);
  expect(opt.momentumY).toBe(ref.momentumY);
  if (options?.diagnostics === true) {
    expect(opt.deltas).toEqual(ref.deltas);
  }
}

describe("engine.transport-field — reference vs optimised equivalence", () => {
  // -------------------------------------------------------------------------
  // Fixture 1: multi-substep pure diffusion.
  //
  // A high diffusivity (D = 10 m²·s⁻¹) forces diffusionSubSteps = 4 on the 1 m
  // grid, so the optimised ping-pong path swaps its two buffers four times where
  // the reference allocates four fresh slices. Two cells with a 10:0 gradient
  // equalise over one tick. This is the core case the optimisation targets:
  // repeated sub-step allocation replaced by in-place buffer swap, on a field
  // where the conservation invariant (total scalar) must hold exactly.
  // -------------------------------------------------------------------------
  it("multi-substep diffusion: both paths produce byte-identical φ", () => {
    const substance: TransportSubstance = {
      name: "diffuser",
      // D = 10 ⇒ diffusionSubSteps = ceil(4·10·(1/30)/(0.4·1²)) = ceil(3.33) = 4.
      coefficient: 10,
    };
    const field = twoCellField(substance);
    const phi = [10, 0];
    assertStepEquivalent(field, phi);

    // Sanity: the field must have evolved (hot cell cooled, cold cell warmed),
    // proving the sub-steps actually ran and the equivalence is meaningful.
    const sanity = stepTransportField(field, phi);
    expect(sanity.phi[0]!, "hot cell must cool").toBeLessThan(10);
    expect(sanity.phi[1]!, "cold cell must warm").toBeGreaterThan(0);
    // Pure diffusion conserves the total scalar.
    expect(totalScalar(sanity.phi)).toBeCloseTo(totalScalar(phi), 9);
  });

  // -------------------------------------------------------------------------
  // Fixture 2: multi-substep advection with the per-cell CFL×4 coordination,
  // run over many ticks — the atmosphere-NaN regression scenario.
  //
  // A centre cell surrounded by four empty neighbours, every face open,
  // advecting on a gradient that saturates the velocity to its ceiling. The
  // per-cell (not per-face) CFL bound keeps the summed four-face outflow inside
  // the stability margin so the non-negativity clamp never fabricates mass. The
  // optimised path ping-pongs its buffers across ~90 advection sub-steps per
  // tick for 50 ticks; both paths must conserve mass exactly and agree on every
  // cell value every tick.
  // -------------------------------------------------------------------------
  it("multi-substep advection: mass conserved and byte-identical over 50 ticks", () => {
    const ceiling = 343;
    const faces: TransportFace[] = [];
    const normals = [
      { nx: 1, ny: 0 },
      { nx: -1, ny: 0 },
      { nx: 0, ny: 1 },
      { nx: 0, ny: -1 },
    ];
    for (let k = 0; k < 4; k += 1) {
      const nrm = normals[k]!;
      faces.push({ from: 0, to: k + 1, nx: nrm.nx, ny: nrm.ny, area: 1, open: true, boundary: false });
      faces.push({ from: k + 1, to: 0, nx: -nrm.nx, ny: -nrm.ny, area: 1, open: true, boundary: false });
    }
    const substance: TransportSubstance = {
      name: "atmosphere",
      coefficient: 0,
      maxVelocity: ceiling,
      velocity: (face, p) => {
        if (face.to === undefined) return 0;
        const u = ceiling * ((p[face.from] ?? 0) - (p[face.to] ?? 0));
        return u > ceiling ? ceiling : u < -ceiling ? -ceiling : u;
      },
      nonNegative: true,
      floor: 0,
    };
    const field: TransportField = { substance, faces, boundaryCells: [] };

    let refPhi: Float64Array = Float64Array.of(1, 0, 0, 0, 0);
    let optPhi: Float64Array = Float64Array.of(1, 0, 0, 0, 0);
    const initialTotal = totalScalar(refPhi);
    for (let tick = 0; tick < 50; tick += 1) {
      const refResult = stepTransportFieldReference(field, refPhi);
      const optResult = stepTransportField(field, optPhi);
      expect(optResult.phi).toEqual(refResult.phi);
      expect(optResult.momentumX).toBe(refResult.momentumX);
      expect(optResult.momentumY).toBe(refResult.momentumY);
      // Closed five-cell field: advection only moves mass between cells, so the
      // total is invariant every tick (the conservation invariant).
      expect(totalScalar(optResult.phi)).toBeCloseTo(initialTotal, 9);
      for (const v of optResult.phi) expect(Number.isFinite(v)).toBe(true);
      refPhi = refResult.phi;
      optPhi = optResult.phi;
    }
  });

  // -------------------------------------------------------------------------
  // Fixture 3: multi-substep boundary flux carrying hull momentum.
  //
  // A boundary cell venting mass at a fixed rate, with advection sub-stepping
  // driven by a high maxVelocity. The boundary flux is delivered via the out-
  // param scratch (reused across every boundary cell and sub-step in the
  // optimised path); both paths must accumulate the identical hull impulse and
  // drain the identical mass. The velocity closure exercises advection in
  // addition to the boundary flux, so the sub-step count is well above one.
  // -------------------------------------------------------------------------
  it("boundary flux + advection: identical momentum and mass drain", () => {
    const substance: TransportSubstance = {
      name: "venting",
      coefficient: 0,
      maxVelocity: 50,
      velocity: (face) => 10 * face.nx,
      nonNegative: true,
      floor: 0,
      boundaryFlux: (cell, phi, out) => {
        out.cell = cell;
        // Vent at 2 kg/s while the cell holds mass (phi). Reports a -2 N hull
        // reaction along x (gas leaves along +x, hull recoils along −x).
        out.scalarFlux = (phi[cell] ?? 0) > 0 ? 2 : 0;
        out.momentumX = -2;
        out.momentumY = 0;
      },
    };
    const faces: TransportFace[] = [
      // Cell 0 and cell 1 connected by an open interior face.
      { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
      { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
    ];
    const field: TransportField = { substance, faces, boundaryCells: [0] };
    const phi = [10, 0];
    assertStepEquivalent(field, phi);

    // Sanity: the hull must have accumulated negative-x impulse and the
    // boundary cell must have lost mass.
    const sanity = stepTransportField(field, phi);
    expect(sanity.momentumX, "hull must recoil along −x").toBeLessThan(0);
    expect(sanity.phi[0]!, "boundary cell must drain").toBeLessThan(10);
  });

  // -------------------------------------------------------------------------
  // Fixture 4: diagnostics breakdown equivalence.
  //
  // With { diagnostics: true } both paths build the per-cell TransportDelta
  // breakdown (advection / diffusion / source / boundary). The diagnostics
  // accumulation reads from the same current buffer and writes the same scaled
  // per-second rates regardless of buffer reuse, so the breakdown must be
  // byte-identical. Exercises a substance with all four terms (diffusion +
  // advection + source + boundary) on a multi-substep field.
  // -------------------------------------------------------------------------
  it("diagnostics: identical per-cell delta breakdown", () => {
    const substance: TransportSubstance = {
      name: "full",
      coefficient: 10, // forces multi-substep diffusion
      maxVelocity: 5,
      velocity: (face) => 2 * face.nx,
      source: (cell) => (cell === 0 ? 6 / TICKS_PER_SECOND : 0),
      nonNegative: true,
      floor: 0,
      boundaryFlux: (cell, phi, out) => {
        out.cell = cell;
        out.scalarFlux = (phi[cell] ?? 0) > 0 ? 1 : 0;
        out.momentumX = -1;
        out.momentumY = 0;
      },
    };
    const faces: TransportFace[] = [
      { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
      { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
    ];
    const field: TransportField = { substance, faces, boundaryCells: [0] };
    assertStepEquivalent(field, [10, 0], { diagnostics: true });

    // Sanity: the diagnostics array must be non-empty (the step ran with
    // diagnostics on), proving the equivalence assertion covered the deltas.
    const sanity = stepTransportField(field, [10, 0], { diagnostics: true });
    expect(sanity.deltas.length, "diagnostics must be populated").toBe(2);
  });

  // -------------------------------------------------------------------------
  // Fixture 5: persistent ping-pong work buffers threaded across many ticks —
  // the production resource-step path.
  //
  // resource-step owns one `TransportWorkBuffers` pair per substance on
  // ResourceState and passes it to `stepTransportField` every tick. After a tick
  // the returned φ aliases whichever work buffer the last sub-step wrote, so the
  // next tick the integrator must cross-copy that aliased input into the OTHER
  // buffer (never a self-copy). This fixture reproduces that exact pattern: feed
  // the optimised path's own output back in as the next input (so φ aliases a
  // work buffer between ticks), and assert every tick is byte-identical to the
  // reference (slicing) oracle run on deep-cloned inputs. The substance mixes
  // all four terms (multi-substep diffusion + advection + source + boundary) so
  // both even and odd sub-step counts are exercised over 60 ticks.
  // -------------------------------------------------------------------------
  it("threaded work buffers: byte-identical to oracle across 60 ticks", () => {
    const substance: TransportSubstance = {
      name: "full-with-buffers",
      coefficient: 10, // forces multi-substep diffusion
      maxVelocity: 5,
      velocity: (face) => 2 * face.nx,
      source: (cell) => (cell === 0 ? 6 / TICKS_PER_SECOND : 0),
      nonNegative: true,
      floor: 0,
      boundaryFlux: (cell, phi, out) => {
        out.cell = cell;
        out.scalarFlux = (phi[cell] ?? 0) > 0 ? 1 : 0;
        out.momentumX = -1;
        out.momentumY = 0;
      },
    };
    const faces: TransportFace[] = [
      { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
      { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
    ];
    const field: TransportField = { substance, faces, boundaryCells: [0] };

    let refPhi: Float64Array = Float64Array.of(10, 0);
    let optPhi: Float64Array = Float64Array.of(10, 0);
    const work = createTransportWorkBuffers(optPhi.length);
    for (let tick = 0; tick < 60; tick += 1) {
      // Optimised path: feed its own output back in (φ aliases a work buffer),
      // exactly as resource-step stores `state.X = result.phi`.
      const refResult = stepTransportFieldReference(field, structuredClone(refPhi));
      const optResult = stepTransportField(field, optPhi, undefined, work);
      expect(optResult.phi).toEqual(refResult.phi);
      expect(optResult.momentumX).toBe(refResult.momentumX);
      expect(optResult.momentumY).toBe(refResult.momentumY);
      refPhi = refResult.phi;
      optPhi = optResult.phi;
    }
    // Sanity: the field evolved and the boundary cell drained, so the 60
    // assertions were meaningful (not trivially equal because nothing happened).
    const finalRef = stepTransportFieldReference(field, structuredClone(refPhi));
    expect(finalRef.phi[0]!, "boundary cell drained over the run").toBeLessThan(10);
  });
});
