/**
 * Arena medium-field setup: compute the grid dimensions from the resolved
 * fleet deployment, build the field, and seed the initial state at the
 * interstellar-medium baseline. Called once per battle from {@link
 * bootstrapEngine}; the returned field + state are carried on the
 * {@link EngineState} and stepped each tick.
 *
 * The grid is sized to the ACTUAL arena bounds — the bounding box of the
 * resolved ships' positions plus their broad-phase radii — so the medium
 * covers the battlefield without assuming a fixed extent. A close-in myopic
 * fleet deploys at a few km and lands a small grid; a long-range sensor fleet
 * deploys out at tens of km and lands a correspondingly larger one.
 */

import {
  D_MEDIUM_M2_PER_S,
  EXCITATION_DECAY_TIMESCALE_S,
  ISM_DENSITY_KG_PER_M3,
  MEDIUM_BOUNDARY_EPS_LOSS_PER_S,
  MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S,
  MEDIUM_MAX_VELOCITY_M_PER_S,
  MEDIUM_PITCH_M_DEFAULT,
  buildMediumField,
  mediumStateFromDensity,
  stepMediumField,
  zeroMediumSources,
} from "./medium-field";
import type { MediumField, MediumState } from "./medium-field";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import type { SimShip } from "./types";

/**
 * Build the arena medium field and its ISM-seeded initial state.
 *
 * The grid spans the deployment bounding box (every ship's centre ± its
 * broad-phase radius, symmetric about the world origin since `resolve.ts`
 * deploys fleets at `±edgeInset` on x and centred on y=0), rounded up to a
 * whole number of {@link MEDIUM_PITCH_M_DEFAULT}-metre cells. The grid is
 * centred on the world origin: cell `(col, row)` centre maps to world
 * `((col + 0.5 - widthM / 2) · pitch, (row + 0.5 - heightM / 2) · pitch)`.
 *
 * ρ is seeded at the baseline interstellar-medium density
 * ({@link ISM_DENSITY_KG_PER_M3}); ε at zero. With zero sources (this pass),
 * ρ diffuses and vents at the open boundary and ε decays to zero — the medium
 * relaxes from its ISM baseline, a pure function of the grid shape. The SI
 * coefficients are the documented anchors from `medium-field.ts`; the field
 * config does not fill defaults, so every coefficient is supplied explicitly.
 */
export function buildArenaMedium(ships: readonly SimShip[]): {
  field: MediumField;
  state: MediumState;
} {
  // Deployment bounding box: every ship's centre ± its broad-phase radius. The
  // radius is the grid bounding radius (farthest cell centre plus half a cell),
  // so the box encloses the whole footprint. A degenerate fleet (no ships, or
  // every ship at the origin with zero radius) falls back to a 1-cell grid so
  // the field is still well-formed; a real battle never hits that path.
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let seen = false;
  for (const ship of ships) {
    const r = ship.radius;
    const x0 = ship.x - r;
    const y0 = ship.y - r;
    const x1 = ship.x + r;
    const y1 = ship.y + r;
    if (!seen) {
      minX = x0;
      minY = y0;
      maxX = x1;
      maxY = y1;
      seen = true;
    } else {
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
    }
  }
  const spanX = seen ? maxX - minX : 0;
  const spanY = seen ? maxY - minY : 0;
  const pitch = MEDIUM_PITCH_M_DEFAULT;
  // ceil(span / pitch) cells covers the whole box; at least 1 cell so the
  // field is well-formed even for a degenerate (zero-span) fleet.
  const widthM = Math.max(1, Math.ceil(spanX / pitch));
  const heightM = Math.max(1, Math.ceil(spanY / pitch));
  const field = buildMediumField({
    widthM,
    heightM,
    pitchM: pitch,
    rhoDiffusionM2PerS: D_MEDIUM_M2_PER_S,
    rhoMaxVelocityMPerS: MEDIUM_MAX_VELOCITY_M_PER_S,
    epsDiffusionM2PerS: D_MEDIUM_M2_PER_S,
    epsDecayTimescaleS: EXCITATION_DECAY_TIMESCALE_S,
    boundaryVentVelocityMPerS: MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S,
    boundaryEpsLossPerS: MEDIUM_BOUNDARY_EPS_LOSS_PER_S,
  });
  // Seed ρ at the ISM baseline (uniform across every cell); ε at zero. The
  // baseline density is a real WIM figure (see medium-field.ts); at this
  // density the ambient medium is the floor the field relaxes back to.
  const state = mediumStateFromDensity(field, ISM_DENSITY_KG_PER_M3);
  return { field, state };
}

/**
 * Rebuild the arena medium from a captured checkpoint, or from the resolved
 * ships when the checkpoint predates the medium field. Used by the resume path
 * (and the capture/restore round-trip test).
 *
 * When `captured` is present the grid connectivity is re-derived from
 * `(widthM, heightM)` via {@link buildMediumField} (a pure function of the cell
 * counts, so byte-identical to the original) and the live ρ/ε arrays are
 * reattached. When `captured` is absent (a pre-medium checkpoint) the field is
 * rebuilt from the restored ships at the ISM baseline — there is no prior
 * mid-battle state to reconstruct because the original run had no medium.
 */
export function restoreArenaMedium(
  captured: EngineCheckpoint["medium"],
  ships: readonly SimShip[],
): { field: MediumField; state: MediumState } {
  if (captured === undefined) return buildArenaMedium(ships);
  const field = buildMediumField({
    widthM: captured.widthM,
    heightM: captured.heightM,
    pitchM: captured.pitchM,
    rhoDiffusionM2PerS: captured.rhoDiffusionM2PerS,
    rhoMaxVelocityMPerS: captured.rhoMaxVelocityMPerS,
    epsDiffusionM2PerS: captured.epsDiffusionM2PerS,
    epsDecayTimescaleS: captured.epsDecayTimescaleS,
    boundaryVentVelocityMPerS: captured.boundaryVentVelocityMPerS,
    boundaryEpsLossPerS: captured.boundaryEpsLossPerS,
  });
  return {
    field,
    state: { rho: captured.rho, eps: captured.eps },
  };
}

/**
 * Advance the arena medium one tick with ZERO sources. The thruster-plume,
 * debris-deposit, and beam-strike injection terms are deferred to a later pass,
 * so the medium relaxes from its prior state without reading or writing any
 * ship / projectile / beam state — battle outcomes stay byte-for-byte unchanged
 * relative to the pre-medium engine; only the new `medium` snapshot field is
 * added. The stepper iterates cells in fixed row-major order with fixed N/E/S/W
 * face order (see `medium-field.ts`), draws no rng, and mutates nothing the rest
 * of the loop reads, so two same-seed runs produce byte-identical medium arrays.
 */
export function stepArenaMedium(medium: {
  field: MediumField;
  state: MediumState;
}): { field: MediumField; state: MediumState } {
  return {
    field: medium.field,
    state: stepMediumField(
      medium.field,
      medium.state,
      zeroMediumSources(medium.field),
    ),
  };
}
