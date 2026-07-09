import { describe, expect, it } from "vitest";
import type { BattleFrame, MediumSnapshot } from "@/schema/battle";
import {
  EPS_HALFSAT_J,
  RHO_AMPLIFIER_CAP,
  RHO_REF_KG,
  densityAmplifier,
  mediumCellIntensity,
  particleCellBrightness,
  particleEffectiveEps,
  resolveMediumField,
  sampleMediumRho,
} from "./mediumShared";

/**
 * The medium overlays resolve the field per-tick via {@link resolveMediumField}
 * rather than a module-scoped "last-seen" cache. These tests pin the contract
 * that makes that scrub-safe: the field is a PURE FUNCTION OF THE TICK, so
 * forward and backward scrub to the same tick resolve to the identical field
 * regardless of which frames were rendered beforehand.
 *
 * Frames carry `medium` only on emission ticks (every RESOURCE_EVERY ticks);
 * ticks between emissions carry none. The resolver must return the most recent
 * emission AT OR BEFORE the requested tick.
 */

/** Minimal frame carrying only the fields `resolveMediumField` reads. */
function makeFrame(tick: number, medium?: MediumSnapshot): BattleFrame {
  return {
    tick,
    ships: [],
    projectiles: [],
    ...(medium !== undefined ? { medium } : {}),
  };
}

/** A distinguishable field so tests can assert WHICH emission was resolved,
 *  by identity (referential equality), not just that some field came back. */
function makeField(tag: number): MediumSnapshot {
  return {
    rho: new Float64Array([tag]),
    eps: new Float64Array([tag]),
    widthM: 1,
    heightM: 1,
    pitchM: 1,
  };
}

describe("resolveMediumField", () => {
  it("returns the most recent emission at or before the tick", () => {
    // Emissions at ticks 0 and 6; ticks 1-5 and 7-8 carry no medium.
    const a = makeField(1);
    const b = makeField(2);
    const frames: BattleFrame[] = [
      makeFrame(0, a),
      makeFrame(1),
      makeFrame(2),
      makeFrame(3),
      makeFrame(4),
      makeFrame(5),
      makeFrame(6, b),
      makeFrame(7),
      makeFrame(8),
    ];

    expect(resolveMediumField(frames, 8)).toBe(b); // after emission 6
    expect(resolveMediumField(frames, 6)).toBe(b); // exactly on emission 6
    expect(resolveMediumField(frames, 5)).toBe(a); // between 0 and 6 -> earlier
    expect(resolveMediumField(frames, 1)).toBe(a); // just after emission 0
    expect(resolveMediumField(frames, 0)).toBe(a); // first emission
  });

  it("is order-independent: scrub forward then backward resolves the same field", () => {
    // The core determinism assertion the scrub bug violated. A forward-only
    // "last-seen" cache would, after visiting tick 13 (emission 12 = c), return
    // c for tick 9; after visiting tick 0 (emission 0 = a), return a for tick 9.
    // A pure tick-based resolver must return emission 6 (= b) in every case.
    const a = makeField(1);
    const b = makeField(2);
    const c = makeField(3);
    const frames: BattleFrame[] = [
      makeFrame(0, a),
      makeFrame(1),
      makeFrame(2),
      makeFrame(3),
      makeFrame(4),
      makeFrame(5),
      makeFrame(6, b),
      makeFrame(7),
      makeFrame(8),
      makeFrame(9),
      makeFrame(10),
      makeFrame(11),
      makeFrame(12, c),
      makeFrame(13),
    ];

    // Scrub forward past emission 12, then back to tick 9: still emission 6.
    resolveMediumField(frames, 13);
    expect(resolveMediumField(frames, 9)).toBe(b);

    // Scrub all the way back to tick 0, then forward to tick 9: still emission 6.
    resolveMediumField(frames, 0);
    expect(resolveMediumField(frames, 9)).toBe(b);

    // Repeated resolution at the same tick is stable.
    expect(resolveMediumField(frames, 9)).toBe(resolveMediumField(frames, 9));
  });

  it("clamps the tick to the available frame range", () => {
    const a = makeField(1);
    const frames: BattleFrame[] = [makeFrame(0, a), makeFrame(1)];

    expect(resolveMediumField(frames, -5)).toBe(a); // before start -> clamp to 0
    expect(resolveMediumField(frames, 99)).toBe(a); // past end -> clamp, scan back to 0
  });

  it("returns undefined when no frame carries a medium field", () => {
    // A vacuum-anomaly battle (or a pre-medium replay): no frame has a field.
    const frames: BattleFrame[] = [makeFrame(0), makeFrame(1), makeFrame(2)];

    expect(resolveMediumField(frames, 2)).toBeUndefined();
  });

  it("returns undefined for an empty frame history", () => {
    expect(resolveMediumField([], 0)).toBeUndefined();
  });
});

describe("densityAmplifier", () => {
  // The density amplifier is the ρ-driven brightness ramp shared by every
  // overlay: a self-luminous source's OWN intensity is multiplied by this factor
  // (1× in vacuum, capped at RHO_AMPLIFIER_CAP in dense medium) so "how much
  // brighter a nebula makes things" reads identically across overlays.

  it("is exactly 1 in vacuum (so a source with no resolved field is unchanged)", () => {
    expect(densityAmplifier(0)).toBe(1);
  });

  it("doubles at the RHO_REF_KG reference density (1 + rho/RHO_REF_KG = 2)", () => {
    // The reference density is authored so a filled nebula triples the glow; at
    // exactly RHO_REF_KG the amplifier is 2 (halfway up the capped ramp).
    expect(densityAmplifier(RHO_REF_KG)).toBe(2);
  });

  it("caps at RHO_AMPLIFIER_CAP for very dense medium (no exhaust self-amplification blow-out)", () => {
    // An exhaust plume's own ρ (~1e-5 kg/cell) is orders above the nebula target
    // this amplifier is scaled to; without the cap it would saturate the glow to
    // a flat blob. The cap holds at RHO_AMPLIFIER_CAP however large ρ grows.
    expect(densityAmplifier(RHO_REF_KG * 1e10)).toBe(RHO_AMPLIFIER_CAP);
    expect(densityAmplifier(1e5)).toBe(RHO_AMPLIFIER_CAP);
  });
});

describe("sampleMediumRho", () => {
  it("returns 0 for a world point outside the field's grid", () => {
    const field: MediumSnapshot = {
      rho: new Float64Array([11]),
      eps: new Float64Array([0]),
      widthM: 1,
      heightM: 1,
      pitchM: 1,
    };
    // A point well outside the 1×1 grid (whose only cell centres at the origin).
    expect(sampleMediumRho(field, 100, 100)).toBe(0);
    expect(sampleMediumRho(field, -100, -100)).toBe(0);
  });

  it("returns exactly field.rho[idx] for the cell containing the world point", () => {
    // A 2×1 grid (two cells side by side along x) with distinguishable ρ values
    // so the test verifies the INDEX mapping, not just "a non-zero came back".
    // Cell (col,row) centres at world ((col + 0.5 - widthM/2)·pitchM, …); with
    // widthM=2, heightM=1, pitchM=1 the two cell centres are at x=-0.5 and x=0.5.
    const field: MediumSnapshot = {
      rho: new Float64Array([11, 22]),
      eps: new Float64Array([0, 0]),
      widthM: 2,
      heightM: 1,
      pitchM: 1,
    };
    // Left cell (col 0, idx 0) → rho[0] = 11.
    expect(sampleMediumRho(field, -0.5, 0)).toBe(11);
    // Right cell (col 1, idx 1) → rho[1] = 22.
    expect(sampleMediumRho(field, 0.5, 0)).toBe(22);
    // A point between cell centres still falls in one cell or the other
    // (floor of the scaled coordinate), never between values.
    expect(sampleMediumRho(field, -0.4, 0)).toBe(11);
    expect(sampleMediumRho(field, 0.4, 0)).toBe(22);
  });
});

describe("particle brightness truth", () => {
  it("a particle's brightness is the one shared tone-map on its effective eps", () => {
    // The particle glows by the SAME mediumCellIntensity as a grid cell, on its
    // energy scaled into the field's brightness range — not a self-luminous
    // intensity. A typical thruster parcel (~2e7 J / 5 ≈ EPS_HALFSAT) reads mid-range.
    const energyJ = 2e7;
    const rho = 1e-13;
    const fxGain = 1;
    expect(particleCellBrightness(energyJ, rho, fxGain)).toBeCloseTo(
      mediumCellIntensity(particleEffectiveEps(energyJ), rho, fxGain),
      12,
    );
    // Sanity: that effective eps sits at the half-saturation point (mid-range).
    expect(particleEffectiveEps(energyJ)).toBeCloseTo(EPS_HALFSAT_J, 5);
  });
});
