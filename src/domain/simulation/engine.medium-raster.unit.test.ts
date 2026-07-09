import { describe, expect, it } from "vitest";

import {
  D_MEDIUM_M2_PER_S,
  EXCITATION_DECAY_TIMESCALE_S,
  MEDIUM_BOUNDARY_EPS_LOSS_PER_S,
  MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S,
  MEDIUM_MAX_VELOCITY_M_PER_S,
  MEDIUM_PITCH_M_DEFAULT,
  buildMediumField,
  type MediumField,
} from "@/domain/simulation/engine/medium-field";
import { rasterSegmentCells } from "@/domain/simulation/engine/medium-raster";

/**
 * {@link rasterSegmentCells} walks every grid cell a world-space segment crosses
 * so a fast emitter's medium deposit can be distributed along its swept path
 * (a continuous trail, not per-tick dots). These tests pin the cell set and the
 * determinism contract (sorted, unique, pure function of the endpoints).
 */

/** A 10×3 grid at the default 500 m pitch, centred on the world origin. With
 *  `widthM = 10`, world x maps to col `floor(x / 500 + 5)`; world y maps to
 *  row `floor(y / 500 + 1)`. */
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

describe("rasterSegmentCells", () => {
  it("visits every cell a horizontal segment passes through", () => {
    const f = wideField();
    // x = 0 → col 5; x = 1000 → col 7; y = 0 → row 1. The segment crosses
    // cols 5, 6, 7 on row 1 → flat indices 15, 16, 17.
    expect(rasterSegmentCells(f, 0, 0, 1000, 0)).toEqual([15, 16, 17]);
  });

  it("returns a single cell when both endpoints share it", () => {
    const f = wideField();
    // Two points inside col 5, row 1 → flat 15 only.
    expect(rasterSegmentCells(f, 10, 10, 40, 20)).toEqual([15]);
  });

  it("returns ascending, de-duplicated indices", () => {
    const f = wideField();
    const cells = rasterSegmentCells(f, 0, 0, 2200, 0);
    for (let i = 1; i < cells.length; i += 1) {
      expect(cells[i]).toBeGreaterThan(cells[i - 1] ?? -Infinity);
    }
  });

  it("is a pure function of its endpoints (deterministic)", () => {
    const f = wideField();
    const a = rasterSegmentCells(f, 120, 40, 980, 210);
    const b = rasterSegmentCells(f, 120, 40, 980, 210);
    expect(a).toEqual(b);
  });
});
