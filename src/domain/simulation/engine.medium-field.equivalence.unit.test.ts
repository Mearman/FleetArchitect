import { describe, expect, it } from "vitest";
import {
  buildMediumField,
  mediumStateFromDensity,
  zeroMediumSources,
  type MediumField,
  type MediumSources,
  type MediumState,
} from "@/domain/simulation/engine/medium-field";
import {
  stepMediumField,
  stepMediumFieldReference,
} from "@/domain/simulation/engine/medium-stepper";
import {
  computeArenaMediumSources,
  computeArenaMediumSourcesReference,
  computeAsteroidSourceCells,
  type MediumSourceBuffers,
  type ProjectileMediumEntry,
} from "@/domain/simulation/engine/medium-setup";
import type { Debris } from "@/domain/simulation/engine/debris";
import type { BattleAnomalyKind } from "@/schema/battle";

/**
 * Equivalence between the reference (oracle) and optimised medium paths.
 *
 * Stepper: `stepMediumFieldReference` vs `stepMediumField` — both share the
 * `runMediumStep` core; the ONLY difference is the per-sub-step buffer strategy
 * (reference slices all five current buffers every sub-step; optimised
 * ping-pongs between two pre-allocated buffers per substance). The inner cell
 * loop is identical, so the five post-step arrays (ρ, ε, εVis, mx, my) are
 * byte-identical regardless of which array objects hold current and next.
 *
 * Sources: `computeArenaMediumSourcesReference` vs `computeArenaMediumSources` —
 * both share the `depositMediumSources` core; the reference allocates five fresh
 * full-grid arrays, the optimised clears the ArenaMedium's pre-allocated buffers
 * in place and refills them. The deposit arithmetic is unchanged on a cleared
 * reused buffer, so the deposited values are byte-identical.
 *
 * Each fixture runs both paths on `structuredClone`-d identical inputs (the
 * stepper and source functions are pure — they do not mutate the input state —
 * but the clones keep the two runs strictly independent) and asserts
 * byte-identical results, plus a sanity check that the step actually evolved the
 * field so the assertion is meaningful.
 */

/** Build a small medium field (2×2, default coefficients) for the fixtures. */
function smallField(): MediumField {
  return buildMediumField({
    widthM: 2,
    heightM: 2,
    pitchM: 500,
    rhoDiffusionM2PerS: 1.0e4,
    rhoMaxVelocityMPerS: 1.0e4,
    epsDiffusionM2PerS: 1.0e4,
    epsDecayTimescaleS: 2,
    boundaryVentVelocityMPerS: 1,
    boundaryEpsLossPerS: 0.1,
    momentumDiffusionM2PerS: 1.0e4,
    momentumDragPerS: 0.5,
    velocityMaxMPerS: 1.0e4,
  });
}

/** Build a 3×3 medium field whose grid spans ±750 m so off-centre deposits land
 *  in distinct cells. */
function wideField(): MediumField {
  return buildMediumField({
    widthM: 3,
    heightM: 3,
    pitchM: 500,
    rhoDiffusionM2PerS: 1.0e4,
    rhoMaxVelocityMPerS: 1.0e4,
    epsDiffusionM2PerS: 1.0e4,
    epsDecayTimescaleS: 2,
    boundaryVentVelocityMPerS: 1,
    boundaryEpsLossPerS: 0.1,
    momentumDiffusionM2PerS: 1.0e4,
    momentumDragPerS: 0.5,
    velocityMaxMPerS: 1.0e4,
  });
}

/** Build a fresh zeroed source-buffer set for a field (mirrors what
 *  `buildArenaMedium` pre-allocates on the ArenaMedium). */
function freshBuffers(field: MediumField): MediumSourceBuffers {
  const n = field.cellCount;
  return {
    rho: new Array<number>(n).fill(0),
    eps: new Array<number>(n).fill(0),
    epsVisSrc: new Array<number>(n).fill(0),
    mxSrc: new Array<number>(n).fill(0),
    mySrc: new Array<number>(n).fill(0),
  };
}

/** Captured post-step state for byte-identity comparison. */
interface StepSummary {
  rho: number[];
  eps: number[];
  epsVis: number[];
  mx: number[];
  my: number[];
}

function summariseStep(state: MediumState): StepSummary {
  return {
    rho: [...state.rho],
    eps: [...state.eps],
    epsVis: [...state.epsVis],
    mx: [...state.mx],
    my: [...state.my],
  };
}

describe("engine.medium-field — reference vs optimised equivalence", () => {
  // -------------------------------------------------------------------------
  // Stepper fixture 1: a multi-substep diffusion of a density gradient over
  // several ticks.
  //
  // The field is seeded with a non-uniform density (one cell heavier than its
  // neighbours) and stepped with a small ρ/ε source on one cell. With the real
  // medium coefficients the integrator sub-steps more than once per tick, so the
  // optimised path ping-pongs its buffers across sub-steps where the reference
  // allocates fresh slices. Both paths must produce byte-identical ρ / ε / εVis /
  // mx / my arrays after each tick.
  // -------------------------------------------------------------------------
  it("stepper: byte-identical ρ/ε/εVis/mx/my over 10 ticks", () => {
    const field = smallField();
    const seedState = mediumStateFromDensity(field, 1e-15);
    // Up-end one cell so the density gradient is non-uniform and ρ diffuses.
    const seedRho = seedState.rho.slice();
    seedRho[0] = (seedRho[0] ?? 0) + 1e-12;
    const baseState: MediumState = {
      rho: seedRho,
      eps: seedState.eps,
      epsVis: seedState.epsVis,
      mx: seedState.mx,
      my: seedState.my,
    };
    // A small ε source on cell 3 so ε and εVis evolve each tick.
    const baseSources: MediumSources = {
      ...zeroMediumSources(field),
      eps: [0, 0, 0, 1e-9],
      epsVisSrc: [0, 0, 0, 1e-9],
    };

    let refState = structuredClone(baseState);
    let optState = structuredClone(baseState);
    const sources = structuredClone(baseSources);
    for (let tick = 0; tick < 10; tick += 1) {
      const ref = stepMediumFieldReference(field, refState, sources);
      const opt = stepMediumField(field, optState, sources);
      expect(summariseStep(opt)).toEqual(summariseStep(ref));
      refState = ref;
      optState = opt;
    }

    // Sanity: the field must have evolved from its initial state, proving the
    // steps actually ran (so the equivalence assertion is meaningful, not a
    // trivially-equal pair of no-ops). The ρ gradient redistributes mass and the
    // ε source raises the sourced cell.
    const sanityInitial = summariseStep(baseState);
    const sanityFinal = summariseStep(stepMediumField(field, structuredClone(baseState), sources));
    expect(sanityFinal.rho, "ρ field must evolve").not.toEqual(sanityInitial.rho);
    expect(sanityFinal.eps[3]!, "ε must rise on the sourced cell").toBeGreaterThan(sanityInitial.eps[3]!);
  });

  // -------------------------------------------------------------------------
  // Stepper fixture 2: momentum + εVis advection.
  //
  // Seed momentum on one cell so the velocity-driven advection term moves ρ,
  // εVis, and momentum through the grid. The velocity advection uses symmetric
  // face-normal averaging (mass-conservative); both paths must agree on the
  // advected distribution byte-for-byte.
  // -------------------------------------------------------------------------
  it("stepper: byte-identical momentum + εVis advection", () => {
    const field = smallField();
    const seedState = mediumStateFromDensity(field, 1e-14);
    const baseState: MediumState = {
      rho: seedState.rho.slice(),
      eps: seedState.eps.slice(),
      epsVis: new Float64Array([1e-10, 0, 0, 0]),
      mx: new Float64Array([1e-12, 0, 0, 0]),
      my: seedState.my.slice(),
    };
    const sources = zeroMediumSources(field);

    let refState = structuredClone(baseState);
    let optState = structuredClone(baseState);
    for (let tick = 0; tick < 5; tick += 1) {
      const ref = stepMediumFieldReference(field, refState, sources);
      const opt = stepMediumField(field, optState, sources);
      expect(summariseStep(opt)).toEqual(summariseStep(ref));
      refState = ref;
      optState = opt;
    }

    // Sanity: εVis must have redistributed (velocity advection streams it away
    // from cell 0 where the momentum was seeded), proving the step ran.
    const sanityFinal = stepMediumField(field, structuredClone(baseState), sources);
    expect(sanityFinal.epsVis[0]!, "εVis must advect away from cell 0").toBeLessThan(1e-10);
  });

  // -------------------------------------------------------------------------
  // Sources fixture: deposit equivalence across every source path.
  //
  // Exercises thruster exhaust (a ship — omitted here, so this path is the empty
  // no-ship branch), debris ablation, projectile wake + burning-motor plume, the
  // nebula anomaly fill, asteroid-disc uplift, and body-drag (omitted — needs a
  // ship). The reference allocates five fresh arrays; the optimised clears the
  // ArenaMedium's pre-allocated sourceBuffers in place and refills them. Both
  // share the depositMediumSources core, so the deposited values must be
  // byte-identical.
  // -------------------------------------------------------------------------
  it("sources: byte-identical deposits across debris + projectile + nebula + asteroid", () => {
    const field = wideField();
    // A non-uniform liveRho so the nebula gap is non-zero on some cells and zero
    // on others (exercises the gap-proportional fill).
    const liveRho = new Array<number>(field.cellCount).fill(0);
    liveRho[0] = 1e-14;
    const debris: Debris[] = [
      { id: "d1", x: 0, y: 0, velX: 0, velY: 0, mass: 5, radius: 1, salvageable: true },
    ];
    const projectiles: ProjectileMediumEntry[] = [
      { x: 0, y: 0, powered: true, burnTicks: 5, thrust: 50, mass: 2 },
      { x: 600, y: 0, powered: false, burnTicks: 0, thrust: 0, mass: 1 },
    ];
    const anomalies: BattleAnomalyKind[] = ["nebula"];
    const asteroidDiscs = [{ x: 0, y: 0, r: 500 }];
    const asteroidSourceCells = computeAsteroidSourceCells(field, asteroidDiscs);

    const ref = computeArenaMediumSourcesReference(
      field, liveRho, [], debris, projectiles, anomalies, asteroidSourceCells,
    );
    const opt = computeArenaMediumSources(
      field, liveRho, [], debris, projectiles, anomalies, asteroidSourceCells,
      freshBuffers(field),
    );
    expect([...opt.rho]).toEqual([...ref.rho]);
    expect([...opt.eps]).toEqual([...ref.eps]);
    expect([...opt.epsVisSrc]).toEqual([...ref.epsVisSrc]);
    expect([...opt.mxSrc]).toEqual([...ref.mxSrc]);
    expect([...opt.mySrc]).toEqual([...ref.mySrc]);

    // Sanity: the deposits must be non-zero somewhere (the fixtures inject real
    // sources), proving the equivalence assertion covered a real deposit.
    expect(
      ref.rho.some((v) => v !== 0),
      "nebula + asteroid + debris + projectile must source density",
    ).toBe(true);
    expect(
      ref.eps.some((v) => v !== 0),
      "the burning projectile plume must source excitation",
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Sources fixture 2: clearing in place is stable across repeated calls.
  //
  // Calling the optimised path twice on the same buffers must clear the
  // previous tick's sources before refilling (the buffers are reused, not
  // replaced). The second call's result must equal a fresh reference call, and
  // must not carry any residue from the first. This guards the in-place
  // `.fill(0)` clear against a regression that left stale values.
  // -------------------------------------------------------------------------
  it("sources: reused buffers are cleared correctly across repeated calls", () => {
    const field = wideField();
    const liveRho = new Array<number>(field.cellCount).fill(0);
    const buffers = freshBuffers(field);
    const debris: Debris[] = [
      { id: "d1", x: 0, y: 0, velX: 0, velY: 0, mass: 5, radius: 1, salvageable: true },
    ];

    // First call deposits debris mass into the centre cell.
    const first = computeArenaMediumSources(field, liveRho, [], debris, [], [], [], buffers);
    const centreIdx = Math.floor(field.cellCount / 2);
    const firstCentre = first.rho[centreIdx] ?? 0;
    // Second call on a DIFFERENT debris position must not carry the centre's
    // residue from the first call.
    const debris2: Debris[] = [
      { id: "d2", x: 600, y: 0, velX: 0, velY: 0, mass: 3, radius: 1, salvageable: true },
    ];
    const opt = computeArenaMediumSources(field, liveRho, [], debris2, [], [], [], buffers);
    const ref = computeArenaMediumSourcesReference(field, liveRho, [], debris2, [], [], []);
    expect([...opt.rho]).toEqual([...ref.rho]);

    // Sanity: the centre cell that held the first deposit must be zero now
    // (cleared), unless the second debris also lands there (it lands off-centre
    // at x=600). The first deposit must have been real and non-zero.
    expect(firstCentre, "first deposit must be non-zero").toBeGreaterThan(0);
    expect(opt.rho[centreIdx], "first deposit cell must be cleared").toBe(ref.rho[centreIdx] ?? 0);
  });
});
