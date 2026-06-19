import { describe, expect, it } from "vitest";

import {
  DIFFUSION_CFL_MARGIN,
  TICKS_PER_SECOND,
  TRANSPORT_DT_S,
  diffusionSubSteps,
  stepTransportField,
  totalScalar,
  type TransportFace,
  type TransportField,
  type TransportSubstance,
} from "@/domain/simulation/engine/transport-field";
import { buildRectangularGraph } from "@/domain/simulation/engine/transport-graph";

/**
 * The conserved-scalar transport field.
 *
 * Tests assert the underlying physics directly: conservation under pure
 * diffusion (no boundary, no source → total invariant), the FTCS stability
 * derivation, momentum carried by a boundary flux, and that each term
 * (advection / diffusion / source / boundary) can be exercised in isolation
 * by a substance that enables only it.
 */

/** A field with no faces — the trivial graph. */
function emptyField(substance: TransportSubstance): TransportField {
  return { substance, faces: [], boundaryCells: [] };
}

/** A two-cell graph with one open interior face in each direction. */
function twoCellField(substance: TransportSubstance): TransportField {
  const faces: TransportFace[] = [
    { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: true, boundary: false },
    { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: true, boundary: false },
  ];
  return { substance, faces, boundaryCells: [] };
}

describe("transport-field primitives", () => {
  describe("time step and stability derivation", () => {
    it("derives dt from the tick rate as 1/TICKS_PER_SECOND seconds", () => {
      expect(TRANSPORT_DT_S).toBeCloseTo(1 / TICKS_PER_SECOND, 12);
      // 30 Hz ⇒ ~0.0333 s per tick.
      expect(TICKS_PER_SECOND).toBe(30);
    });

    it("uses a sub-step count that keeps D*dt/dx^2 inside the CFL margin", () => {
      // For D = 0 the field is non-diffusive and needs no sub-stepping.
      expect(diffusionSubSteps(0)).toBe(1);
      // For a diffusivity that would breach the margin, sub-steps scale up.
      // n >= D*dt/(margin*dx^2); pick D so n is exactly 4 at dx=1, margin=0.4,
      // dt = 1/30: D = 4 * 0.4 * 1 / (1/30) = 48.
      const D = (4 * DIFFUSION_CFL_MARGIN) / (1 / TICKS_PER_SECOND);
      expect(diffusionSubSteps(D)).toBe(4);
    });
  });

  describe("pure diffusion conserves the total scalar", () => {
    it("leaves the field total invariant over a tick with no sources or boundaries", () => {
      const substance: TransportSubstance = {
        name: "diffuser",
        coefficient: 1.0,
      };
      const field = twoCellField(substance);
      const phi = [10, 0];
      const result = stepTransportField(field, phi);
      // Total mass conserved (no boundary, no source).
      expect(totalScalar(result.phi)).toBeCloseTo(totalScalar(phi), 9);
      // The hotter cell cooled and the colder cell warmed — equalising.
      expect(result.phi[0]!).toBeLessThan(phi[0]!);
      expect(result.phi[1]!).toBeGreaterThan(phi[1]!);
    });

    it("equalises two cells toward their mean given enough ticks", () => {
      const substance: TransportSubstance = {
        name: "diffuser",
        coefficient: 1.0,
      };
      const field = twoCellField(substance);
      let phi: number[] = [10, 0];
      for (let i = 0; i < 200; i += 1) {
        phi = stepTransportField(field, phi).phi;
      }
      // Both cells converge to the mean (5 each).
      expect(phi[0]!).toBeCloseTo(5, 4);
      expect(phi[1]!).toBeCloseTo(5, 4);
    });

    it("does not diffuse across a closed face", () => {
      const faces: TransportFace[] = [
        { from: 0, to: 1, nx: 1, ny: 0, area: 1, open: false, boundary: false },
        { from: 1, to: 0, nx: -1, ny: 0, area: 1, open: false, boundary: false },
      ];
      const field: TransportField = {
        substance: { name: "diffuser", coefficient: 1.0 },
        faces,
        boundaryCells: [],
      };
      const phi = [10, 0];
      const result = stepTransportField(field, phi);
      expect(result.phi[0]!).toBeCloseTo(10, 12);
      expect(result.phi[1]!).toBeCloseTo(0, 12);
    });
  });

  describe("advection moves the scalar upwind", () => {
    it("transfers phi from the source cell to the destination at the face velocity", () => {
      // Flow along +x at 0.5 m/s. The velocity closure returns the component
      // along the face outward normal, so the (0→1, n=+x) face returns +0.5
      // (flow leaves cell 0 toward cell 1) and the (1→0, n=-x) face returns
      // -0.5 (the same physical flow, projected onto -x). With both directed
      // faces consistent, mass leaves cell 0 and arrives in cell 1.
      const substance: TransportSubstance = {
        name: "advect",
        coefficient: 0,
        maxVelocity: 0.5,
        velocity: (face) => 0.5 * face.nx,
      };
      const field = twoCellField(substance);
      const phi = [1, 0];
      const result = stepTransportField(field, phi);
      // Cell 0 loses u*A*phi*dt = 0.5*1*1*(1/30) = 0.0166...
      const expected = 1 - 0.5 * 1 * (1 / TICKS_PER_SECOND);
      expect(result.phi[0]!).toBeCloseTo(expected, 9);
      expect(result.phi[1]!).toBeCloseTo(0.5 * (1 / TICKS_PER_SECOND), 9);
      // Total conserved.
      expect(totalScalar(result.phi)).toBeCloseTo(totalScalar(phi), 9);
    });
  });

  describe("source term adds phi locally", () => {
    it("injects the source rate times dt into the cell", () => {
      const substance: TransportSubstance = {
        name: "sourced",
        coefficient: 0,
        source: (cell) => (cell === 0 ? 6 : 0), // 6 units/s into cell 0
      };
      const field = emptyField(substance);
      const phi = [0];
      const result = stepTransportField(field, phi);
      expect(result.phi[0]!).toBeCloseTo(6 * TRANSPORT_DT_S, 9);
    });
  });

  describe("boundary flux carries momentum onto the hull", () => {
    it("reports an impulse equal to (flux * exhaust velocity) * dt along -normal", () => {
      // A boundary cell venting mass at rate r along +x; hull feels force
      // along -x. We model the flux directly: scalarFlux = 1 kg/s leaving,
      // momentum reported as -1 N (force opposite to the leaving direction).
      const substance: TransportSubstance = {
        name: "venting",
        coefficient: 0,
        boundaryFlux: () => ({
          cell: 0,
          scalarFlux: 1, // 1 kg/s leaves
          momentumX: -1, // hull feels -1 N
          momentumY: 0,
        }),
      };
      const field: TransportField = {
        substance,
        faces: [],
        boundaryCells: [0],
      };
      const result = stepTransportField(field, [10]);
      // Momentum accumulated = force * dt = -1 * (1/30) N·s.
      expect(result.momentumX).toBeCloseTo(-1 * TRANSPORT_DT_S, 9);
      expect(result.momentumY).toBe(0);
      // The cell lost scalarFlux * dt mass.
      expect(result.phi[0]!).toBeCloseTo(10 - 1 * TRANSPORT_DT_S, 9);
    });
  });

  describe("rectangular graph builder", () => {
    it("builds interior faces plus perimeter boundary faces for a 2x2 region", () => {
      const { faces, boundaryCells } = buildRectangularGraph(2, 2, () => true);
      // Interior edges: one horizontal (between cols 0-1) per row (2 rows),
      // one vertical (between rows 0-1) per col (2 cols) → 4 interior edges,
      // each represented as two directed faces → 8 interior directed faces.
      // Boundary faces: 4 sides × (2 cells per side) = 8 boundary faces, but
      // corner cells contribute two boundary faces each. Total boundary
      // cells = 4 (all four cells are on the perimeter of a 2x2 grid).
      const interior = faces.filter((f) => !f.boundary);
      const boundary = faces.filter((f) => f.boundary);
      expect(interior.length).toBe(8);
      expect(boundary.length).toBe(8);
      expect(boundaryCells).toEqual([0, 1, 2, 3]);
    });

    it("marks interior faces open iff the passable predicate agrees", () => {
      const { faces } = buildRectangularGraph(2, 1, (a, b) => a === 0 && b === 1);
      const openFaces = faces.filter((f) => f.open && !f.boundary);
      // Only the 0↔1 edge is open, represented as two directed faces.
      expect(openFaces.length).toBe(2);
    });
  });
});
