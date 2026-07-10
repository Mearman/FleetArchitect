import { describe, expect, it } from "vitest";

import {
  DEFAULT_CELL_HEAT_CAPACITY_J_PER_K,
  makeThermalSubstance,
  makeThermalSubstanceReference,
  materialiseThermalInputs,
} from "@/domain/simulation/engine/thermal";
import {
  stepTransportField,
  type TransportFace,
  type TransportField,
} from "@/domain/simulation/engine/transport-field";

/**
 * Equivalence between the array-based production thermal substance
 * ({@link makeThermalSubstance} over materialised {@link ThermalArrays}) and the
 * Map/Set-based reference oracle ({@link makeThermalSubstanceReference}). The
 * production path replaces every per-cell `Map.get`/`Set.has` hash lookup with a
 * direct typed-array index and bakes the heat-capacity default in at
 * materialisation time; this test proves both paths yield byte-identical φ
 * arrays and accumulated momentum, in identical cell order, across configs that
 * exercise every closure branch:
 *
 *  - a heat source with and without a radiator surface;
 *  - the heat-capacity default fallback (a cell absent from the map);
 *  - a non-radiator boundary cell (boundary flux returns zero);
 *  - multi-tick stepping so the integrator's boundary-flux capping
 *    (`effective = min(scalarFlux, maxRemovable)`) engages as a radiator cell
 *    drains toward its floor.
 *
 * The lossless digest gate guards the production wiring end-to-end; this test
 * guards the substance-level layout change (Map → dense typed array) directly.
 */

/** Build a pair of directed open faces between two adjacent cells. */
function link(a: number, b: number, nx: number, ny: number): TransportFace[] {
  return [
    { from: a, to: b, nx, ny, area: 1, open: true, boundary: false },
    { from: b, to: a, nx: -nx, ny: -ny, area: 1, open: true, boundary: false },
  ];
}

interface Config {
  sources: Map<number, number>;
  radiators: Set<number>;
  heatCapacity: Map<number, number>;
  /** Boundary cell indices (must include every radiator cell so the integrator
   *  invokes its boundary flux; may also include non-radiator cells to exercise
   *  the zero-flux branch). */
  boundaryCells: number[];
  faces: TransportFace[];
  phi: number[];
}

/** Step both substances for `ticks` ticks from a deep-cloned φ and assert the
 *  final φ arrays and per-tick accumulated momentum are byte-identical. */
function assertEquivalent(config: Config, ticks: number): void {
  const arrays = materialiseThermalInputs(
    config.sources,
    config.radiators,
    config.heatCapacity,
    config.phi.length,
  );
  const referenceSubstance = makeThermalSubstanceReference(
    config.sources,
    config.radiators,
    config.heatCapacity,
  );
  const optimisedSubstance = makeThermalSubstance(
    arrays.sources,
    arrays.radiators,
    arrays.heatCapacity,
  );

  const makeField = (substance: TransportField["substance"]): TransportField => ({
    substance,
    faces: config.faces,
    boundaryCells: config.boundaryCells,
  });

  let refPhi: Float64Array = Float64Array.from(config.phi);
  let optPhi: Float64Array = Float64Array.from(config.phi);
  for (let t = 0; t < ticks; t += 1) {
    const refResult = stepTransportField(makeField(referenceSubstance), refPhi);
    const optResult = stepTransportField(makeField(optimisedSubstance), optPhi);
    expect(optResult.phi, `phi diverged at tick ${t}`).toEqual(refResult.phi);
    expect(optResult.momentumX, `momentumX diverged at tick ${t}`).toBe(refResult.momentumX);
    expect(optResult.momentumY, `momentumY diverged at tick ${t}`).toBe(refResult.momentumY);
    refPhi = refResult.phi;
    optPhi = optResult.phi;
  }
}

describe("engine.thermal — array substance vs Map/Set reference (oracle)", () => {
  it("source + radiator + custom heat capacity: identical over many ticks", () => {
    // One cell with a heat source AND a radiator surface, custom heat
    // capacity. Over many ticks the cell heats toward its radiative equilibrium
    // and the boundary-flux cap engages once the cell is hot enough that the
    // T⁴ outflux exceeds what the cell can lose in one sub-step.
    assertEquivalent(
      {
        sources: new Map([[0, 1e8]]),
        radiators: new Set([0]),
        heatCapacity: new Map([[0, 1e6]]),
        boundaryCells: [0],
        faces: [],
        phi: [300],
      },
      40,
    );
  });

  it("diffusion between two cells, no radiators: identical", () => {
    // Two linked cells at different temperatures, no sources, no radiators:
    // pure diffusion. One cell is absent from the heat-capacity map, so the
    // default fallback ({@link DEFAULT_CELL_HEAT_CAPACITY_J_PER_K}) is on the
    // path (diffusion does not read it, but the materialisation must still bake
    // it in identically to the reference's capacityOf).
    assertEquivalent(
      {
        sources: new Map(),
        radiators: new Set(),
        heatCapacity: new Map([[0, 5e5]]),
        boundaryCells: [],
        faces: link(0, 1, 1, 0),
        phi: [450, 250],
      },
      20,
    );
  });

  it("non-radiator boundary cell: identical (boundary flux stays zero)", () => {
    // Cell 0 is a boundary cell but NOT a radiator — the integrator calls its
    // boundary flux, which must return zero in both paths (the `radiators.has`
    // / `radiators[cell] !== 1` branch). Guards the production-only redundancy
    // the verifier flagged: in production radiators === boundaryCellSet, but
    // the substance is a general function and must honour a decoupled mask.
    assertEquivalent(
      {
        sources: new Map([[0, 1e7]]),
        radiators: new Set(),
        heatCapacity: new Map([[0, 1e6]]),
        boundaryCells: [0],
        faces: [],
        phi: [300],
      },
      15,
    );
  });

  it("mixed multi-cell field: source, radiator, insulated boundary, diffusion", () => {
    // A 3-cell chain: cell 0 heats (source, no radiator), cell 1 conducts, cell
    // 2 is a radiator boundary shedding heat. Plus an insulated boundary on
    // cell 0 (boundary cell, not a radiator). Exercises source + diffusion +
    // radiative boundary + zero-flux boundary + the default heat-capacity
    // fallback (cell 1 absent from the map) all at once.
    assertEquivalent(
      {
        sources: new Map([[0, 5e7]]),
        radiators: new Set([2]),
        heatCapacity: new Map([
          [0, 1e6],
          [2, 8e5],
        ]),
        boundaryCells: [0, 2],
        faces: [...link(0, 1, 1, 0), ...link(1, 2, 1, 0)],
        phi: [300, 300, 300],
      },
      30,
    );
  });

  it("materialiseThermalInputs bakes the default for absent / non-positive capacity", () => {
    // The materialiser must apply the exact reference `capacityOf` fallback:
    // absent cells and cells with non-positive capacity both become the
    // default. Verified directly so the production closure's `heatCapacity[cell]`
    // read (no per-call branch) is provably identical to the reference.
    const arrays = materialiseThermalInputs(
      new Map([[0, 1e7]]),
      new Set([1]),
      new Map([
        [0, 1e6],
        [2, -42], // non-positive → default
      ]),
      4,
    );
    expect(arrays.sources[0]).toBe(1e7);
    expect(arrays.sources[1]).toBe(0);
    expect(arrays.radiators[1]).toBe(1);
    expect(arrays.radiators[0]).toBe(0);
    expect(arrays.heatCapacity[0]).toBe(1e6);
    expect(arrays.heatCapacity[1]).toBe(DEFAULT_CELL_HEAT_CAPACITY_J_PER_K); // absent
    expect(arrays.heatCapacity[2]).toBe(DEFAULT_CELL_HEAT_CAPACITY_J_PER_K); // non-positive
    expect(arrays.heatCapacity[3]).toBe(DEFAULT_CELL_HEAT_CAPACITY_J_PER_K); // absent
  });
});
