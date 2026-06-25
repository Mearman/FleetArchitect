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
  MEDIUM_DT_S,
  MEDIUM_MAX_VELOCITY_M_PER_S,
  MEDIUM_PITCH_M_DEFAULT,
  buildMediumField,
  mediumStateFromDensity,
  stepMediumField,
} from "./medium-field";
import type { MediumField, MediumState, MediumSources } from "./medium-field";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import { cellWorldPosition } from "@/domain/simulation/spatial-hash";
import type { BattleAnomalyKind } from "@/schema/battle";
import { hasAnomaly } from "@/domain/anomaly";
import type { SimShip } from "./types";
import type { Debris } from "./debris";

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

// ============================================================================
// Medium constants: source-term coupling
// ============================================================================

/**
 * Exhaust velocity (m·s⁻¹) at which a ship's engines expel propellant, used to
 * convert a thrust force into a mass-flow rate for the medium source. Pulled
 * from `propellant.ts` so the source shares the same SI anchor the engine burn
 * uses (the mass flow `m_dot = F / v_e` is the real physics).
 */
export const MEDIUM_EXHAUST_VELOCITY_M_PER_S = 320 * 9.80665;

/**
 * Fraction of a burning engine's per-tick expelled mass that deposits as local
 * density in the medium grid; the remainder is assumed to blow out past the near
 * cell before mixing. A half-mass coupling is a representative authored value
 * for how much of a supersonic exhaust plume's entrained mass lingers in the
 * near-nozzle cell versus streaming downstream.
 */
export const EXHAUST_RHO_COUPLING = 0.5;

/**
 * Fraction of a burning engine's jet power that converts to thermal /
 * ionisation excitation in the downstream plume. Jet power is `½·m_dot·v_e²`; a
 * small coupling fraction becomes ε in the medium. Two per cent is an authored
 * representative value for the fraction of a rocket-plume's kinetic energy that
 * thermalises into a glowing, ionised channel.
 */
export const THERMAL_EPS_COUPLING_FRACTION = 0.02;

/**
 * Fraction of a debris fragment's mass it sheds into the medium per tick as it
 * tumbles and ablates. A thousandth of the fragment mass per tick is a slow
 * bleed: a coherent hull fragment joins the medium diffusively rather than
 * staying point-like forever, without vanishing in a single tick.
 */
export const DEBRIS_SHED_FRACTION_PER_TICK = 0.001;

/**
 * Nebula fill timescale, seconds. When the nebula anomaly is active, every cell
 * sources density toward a target nebula density at a rate
 * `dρ/dt = (target − ρ) / NEBULA_FILL_TIMESCALE_S`. Five seconds fills most of
 * the gap over a few ticks so a nebula "arrives" promptly at battle start and
 * decays away over the same timescale when the anomaly clears.
 */
export const NEBULA_FILL_TIMESCALE_S = 5;
/** Per-tick fill fraction `dt / NEBULA_FILL_TIMESCALE_S` for the nebula uplift. */
export const NEBULA_FILL_FRACTION_PER_TICK = MEDIUM_DT_S / NEBULA_FILL_TIMESCALE_S;

/**
 * Nebula target density, kg per cell. Many orders of magnitude above the ISM
 * baseline so a nebula battle reads as a visibly dense, glowing medium in the
 * renderer. Authored; tuned against the renderer's brightness mapping.
 */
export const NEBULA_TARGET_CELL_KG = 1e-12;

/**
 * Particulate density injected per asteroid-disc cell per tick, kg. Asteroid
 * fields are cold rock, so they source density (ablated dust) without excitation
 * in the baseline model. A small authored uplift per cell per tick.
 */
export const ASTEROID_PARTULATE_PER_CELL_KG = 5e-13;

/**
 * Per-cell fraction of a projectile's wake that deposits as density and ε as it
 * flies. A fast round displaces and heats a thin column of medium along its
 * path; a small fraction couples into the grid. Authored for visual effect.
 */
export const PROJECTILE_WAKE_RHO_COUPLING = 0.0005;
export const PROJECTILE_WAKE_EPS_COUPLING = 0.002;

// ============================================================================
// Cell <-> world position mapping
// ============================================================================

/**
 * Map a world position to a grid cell, or null if it lies outside the arena
 * grid. The grid is centred on the world origin: cell `(col, row)` centre sits
 * at `((col + 0.5 - widthM / 2) · pitch, (row + 0.5 - heightM / 2) · pitch)`, the
 * inverse of the mapping `buildArenaMedium` uses. The grid is fixed at battle
 * start; a position outside the grid (a ship that has超出 the deployment box)
 * simply does not inject. Zero-cost guard for the off-arena case.
 */
export function worldToMediumCell(
  field: MediumField,
  worldX: number,
  worldY: number,
): { col: number; row: number } | null {
  const { widthM, heightM, pitchM } = field.config;
  const col = Math.floor(worldX / pitchM + widthM / 2);
  const row = Math.floor(worldY / pitchM + heightM / 2);
  if (col < 0 || col >= widthM || row < 0 || row >= heightM) return null;
  return { col, row };
}

/** Flat cell index from a (col, row) pair, or null if out of bounds. */
export function mediumCellIndex(
  field: MediumField,
  col: number,
  row: number,
): number | null {
  if (col < 0 || col >= field.config.widthM || row < 0 || row >= field.config.heightM) {
    return null;
  }
  return row * field.config.widthM + col;
}

/**
 * Sample the INTENSITY density (kg·m⁻³) at a world position via nearest-cell
 * lookup on the medium grid. Returns zero for positions outside the grid or in
 * a zero-density cell. Pure and deterministic: the grid is read-only here.
 *
 * The coarse grid (default 500 m pitch) makes nearest-cell and bilinear give
 * near-identical results — the field varies on the scale of km-wide plumes, not
 * on the cell-to-cell gradient — so nearest-cell keeps the query cheap
 * (a couple of flops and one array index per entity per tick).
 */
export function sampleLocalRhoKgPerM3(
  medium: { field: MediumField; state: MediumState },
  worldX: number,
  worldY: number,
): number {
  const cell = worldToMediumCell(medium.field, worldX, worldY);
  if (cell === null) return 0;
  const idx = mediumCellIndex(medium.field, cell.col, cell.row);
  if (idx === null) return 0;
  const rhoKgPerCell = medium.state.rho[idx] ?? 0;
  if (rhoKgPerCell <= 0) return 0;
  const { pitchM } = medium.field.config;
  const cellVolumeM3 = pitchM * pitchM; // × MEDIUM_SLAB_DEPTH_M (1 m) — cancels
  return rhoKgPerCell / cellVolumeM3;
}

// ============================================================================
// Per-tick source computation
// ============================================================================

/**
 * Compute the per-tick medium sources from the battle state. Pure function of
 * its inputs: no RNG, no mutation, fixed iteration order. Consumed by
 * {@link stepArenaMedium} and diffused/glowed by the field stepper.
 *
 * Sources inject matter (ρ) and deposited energy (ε) where the battle physically
 * puts it — engine exhaust nozzles, ablating debris, the nebula and asteroid
 * field anomalies, and the wake a projectile punches through the thin medium.
 * Thruster exhaust is gated on `ship.engineThrottle > 0` (a ship that coasts,
 * holds station, or only turns burns no propellant and so emits nothing), so the
 * common non-thrusting path stays zero-cost.
 *
 * The grid is fixed at battle start; entities that move outside the deployment
 * box are silently skipped by {@link worldToMediumCell}. The asteroid-disc list
 * lives on the engine state (pre-computed once in `bootstrapEngine` as a pure
 * function of `(anomalies, seed)`), so it deterministically mirrors the discs
 * the awareness/occlusion phase reads.
 */
export function computeArenaMediumSources(
  field: MediumField,
  liveRho: readonly number[],
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectilePositions: ReadonlyArray<{ x: number; y: number }>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }>,
): MediumSources {
  const cellCount = field.cellCount;
  const rho = new Array<number>(cellCount).fill(0);
  const eps = new Array<number>(cellCount).fill(0);

  // --- Thruster exhaust: every engine/afterburner cell that is firing this tick
  // deposits a fraction of its expelled propellant mass as local density, and a
  // fraction of its jet power as excitation, along the exhaust direction. The
  // exhaust direction is `−moduleFacing` (the engine's local +x is forward; the
  // nozzle points the opposite way), mapped into world space by the ship pose. ---
  for (const ship of ships) {
    const modules = ship.modules;
    if (modules === undefined || ship.engineThrottle <= 0) continue;
    for (const m of modules) {
      if (!m.alive) continue;
      const thrust = m.effect.kind === "engine" ? m.effect.thrust : 0;
      if (!(thrust > 0)) continue;
      const burnFraction = ship.engineThrottle;
      const forceN = thrust * burnFraction;
      const massBurnedKg = (forceN / MEDIUM_EXHAUST_VELOCITY_M_PER_S) * MEDIUM_DT_S;
      if (massBurnedKg <= 0) continue;
      const { wx, wy } = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
      const exhaustAngle = ship.facing + (m.facing ?? 0) + Math.PI;
      const exDx = Math.cos(exhaustAngle);
      const exDy = Math.sin(exhaustAngle);

      const mainIdx = mediumCellIndex(
        field,
        Math.floor(wx / field.config.pitchM + field.config.widthM / 2),
        Math.floor(wy / field.config.pitchM + field.config.heightM / 2),
      );
      const mainDepositKg = massBurnedKg * EXHAUST_RHO_COUPLING;
      // Jet power `½·F·v_e`; a coupling fraction becomes excitation (J) over the
      // tick (`· MEDIUM_DT_S`).
      const jetPowerW = 0.5 * forceN * MEDIUM_EXHAUST_VELOCITY_M_PER_S;
      const epsDepositJ = jetPowerW * THERMAL_EPS_COUPLING_FRACTION * MEDIUM_DT_S;
      if (mainIdx !== null) {
        rho[mainIdx] = (rho[mainIdx] ?? 0) + mainDepositKg;
        eps[mainIdx] = (eps[mainIdx] ?? 0) + epsDepositJ;
      }
      // A smaller deposit one cell downstream along the exhaust, so the plume
      // reads as a streak instead of a single flickering cell.
      const downstreamIdx = mediumCellIndex(
        field,
        Math.floor((wx + exDx * field.config.pitchM) / field.config.pitchM + field.config.widthM / 2),
        Math.floor((wy + exDy * field.config.pitchM) / field.config.pitchM + field.config.heightM / 2),
      );
      if (downstreamIdx !== null && downstreamIdx !== mainIdx) {
        rho[downstreamIdx] = (rho[downstreamIdx] ?? 0) + mainDepositKg * 0.25;
        eps[downstreamIdx] = (eps[downstreamIdx] ?? 0) + epsDepositJ * 0.25;
      }
    }
  }

  // --- Debris ablation: each drifting fragment sheds a small fraction of its
  // mass as particulate density in the cell it currently occupies. Cold debris
  // sources no excitation in the baseline model. ---
  for (const d of debris) {
    const idx = mediumCellIndex(
      field,
      Math.floor(d.x / field.config.pitchM + field.config.widthM / 2),
      Math.floor(d.y / field.config.pitchM + field.config.heightM / 2),
    );
    if (idx === null) continue;
    rho[idx] = (rho[idx] ?? 0) + (d.mass ?? 0) * DEBRIS_SHED_FRACTION_PER_TICK;
  }

  // --- Projectile wake: a fast round displaces and heats a thin column of the
  // medium along its per-tick path. Couple a tiny fraction into the cell the
  // round currently occupies. The wake coupling is intentionally tiny: at ISM
  // density the medium is a near-vacuum and the wake is negligible; in dense
  // plume/nebula gas it becomes a visible streak. ---
  for (const pos of projectilePositions) {
    const idx = mediumCellIndex(
      field,
      Math.floor(pos.x / field.config.pitchM + field.config.widthM / 2),
      Math.floor(pos.y / field.config.pitchM + field.config.heightM / 2),
    );
    if (idx === null) continue;
    rho[idx] = (rho[idx] ?? 0) + PROJECTILE_WAKE_RHO_COUPLING;
    eps[idx] = (eps[idx] ?? 0) + PROJECTILE_WAKE_EPS_COUPLING;
  }

  // --- Nebula anomaly: fill every cell toward a dense target, proportional to
  // the gap between the target and the cell's CURRENT density. Sourcing the gap
  // (not a fixed amount) means a cell already at target stops sourcing, and the
  // field converges to the target with the documented fill timescale. ---
  if (hasAnomaly(anomalies, "nebula")) {
    for (let i = 0; i < cellCount; i += 1) {
      const rhoHere = liveRho[i] ?? 0;
      const gap = NEBULA_TARGET_CELL_KG - rhoHere;
      if (gap > 0) rho[i] = (rho[i] ?? 0) + gap * NEBULA_FILL_FRACTION_PER_TICK;
    }
  }

  // --- Asteroid field anomaly: each static disc sources a small particulate
  // uplift into every cell whose centre sits within the disc (plus one pitch of
  // margin for the disc's own radius). Cold rock sources density without
  // excitation. The disc list is pre-computed once per battle as a pure function
  // of (anomalies, seed), so the source reproduces byte-identically. ---
  if (asteroidDiscs.length > 0) {
    const w = field.config.widthM;
    const h = field.config.heightM;
    const pitch = field.config.pitchM;
    for (let row = 0; row < h; row += 1) {
      const cellY = (row + 0.5 - h / 2) * pitch;
      for (let col = 0; col < w; col += 1) {
        const cellX = (col + 0.5 - w / 2) * pitch;
        for (const disc of asteroidDiscs) {
          const dx = cellX - disc.x;
          const dy = cellY - disc.y;
          if (dx * dx + dy * dy <= (disc.r + pitch) * (disc.r + pitch)) {
            rho[row * w + col] = (rho[row * w + col] ?? 0) + ASTEROID_PARTULATE_PER_CELL_KG;
            break; // a cell is in at most one disc's uplift region
          }
        }
      }
    }
  }

  return { rho, eps };
}

/**
 * Advance the arena medium one tick. The caller supplies the per-tick sources
 * (thruster exhaust, debris, projectile wakes, nebula + asteroid anomaly fills)
 * via {@link computeArenaMediumSources}; with a zero source pair, the field
 * relaxes from its prior state without reading or writing any ship / projectile /
 * beam state, so battle outcomes stay byte-for-byte unchanged and only the
 * `medium` snapshot field is added.
 *
 * Determinism: the stepper is iterated in fixed row-major cell order with fixed
 * N/E/S/W face order (`medium-field.ts`), draws no rng, and depends only on its
 * own prior state plus the supplied sources. Source iteration is likewise fixed
 * (ships, debris, and projectile positions in their array orders; asteroid discs
 * in seed order), so two same-seed runs produce byte-identical medium arrays.
 */
export function stepArenaMedium(
  medium: { field: MediumField; state: MediumState },
  sources: MediumSources,
): { field: MediumField; state: MediumState } {
  return {
    field: medium.field,
    state: stepMediumField(medium.field, medium.state, sources),
  };
}

/**
 * Compute this tick's medium sources from the engine state and step the field.
 * Collapses the per-tick source computation (thruster exhaust, ablating debris,
 * projectile wakes, nebula + asteroid anomaly fills) plus the field step into a
 * single call so the tick loop stays slim. Pure: returns a new medium state,
 * inputs untouched.
 */
export function stepArenaMediumFromState(
  medium: { field: MediumField; state: MediumState },
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectilePositions: ReadonlyArray<{ x: number; y: number }>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }>,
): { field: MediumField; state: MediumState } {
  return stepArenaMedium(
    medium,
    computeArenaMediumSources(
      medium.field,
      medium.state.rho,
      ships,
      debris,
      projectilePositions,
      anomalies,
      asteroidDiscs,
    ),
  );
}
