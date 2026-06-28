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
  MOMENTUM_DRAG_PER_S,
  VELOCITY_MAX_M_PER_S,
  buildMediumField,
  mediumStateFromDensity,
} from "./medium-field";
import { stepMediumField } from "./medium-stepper";
import type { MediumField, MediumState, MediumSources } from "./medium-field";
import { MEDIUM_EPS_EMISSION_THRESHOLD_J } from "./medium-emissions";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import { cellWorldPosition } from "@/domain/simulation/spatial-hash";
import type { BattleAnomalyKind } from "@/schema/battle";
import { hasAnomaly } from "@/domain/anomaly";
import type { SimShip } from "./types";
import type { Debris } from "./debris";

/**
 * The live arena medium carried on the {@link EngineState}: the static
 * {@link MediumField} (grid geometry built once from the deployment bounding
 * box), the live {@link MediumState} (ρ + ε arrays, replaced each tick by
 * {@link stepArenaMedium}), and the per-cell radiation `birthTicks` array that
 * tracks WHEN each cell first crossed the sustained-emission threshold this
 * "burn". The birth tick is what the medium reception light-lag gates on: a
 * distant receiver sees a just-ignited burn only after its light-time
 * (`ceil(dist / c)`) has elapsed, so a sensor sees a distant burn where/when
 * the light actually arrives rather than the instant it ignites.
 *
 * `birthTicks[cell]` is the tick the cell crossed
 * {@link MEDIUM_EPS_EMISSION_THRESHOLD_J} from below (its "ignition" tick),
 * preserved while the cell stays above the threshold and reset to -1 the tick
 * it falls back below. The medium stepper is a pure physics solver and does
 * not maintain this array — {@link stepArenaMedium} updates it after each
 * physics step by comparing the pre- and post-step ε against the threshold.
 * Captured and restored on checkpoint so resume preserves the light-cone
 * (without it, every radiating cell would look freshly ignited on resume and
 * distant receivers would lose their steady-burn contacts for one light-time).
 */
export interface ArenaMedium {
  /** Static grid geometry (rebuilt byte-identically from width × height). */
  readonly field: MediumField;
  /** Live ρ + ε state, replaced with a fresh MediumState each tick. */
  readonly state: MediumState;
  /** Per-cell sustained-radiation birth tick (the tick each cell first crossed
   *  the emission threshold this burn); -1 when the cell is not radiating. */
  readonly birthTicks: readonly number[];
  /** Pre-allocated per-tick source buffers (cleared and refilled in place each
   *  tick by the optimised {@link computeArenaMediumSources} path to avoid 5
   *  full-grid allocations per tick). The reference (oracle) path allocates
   *  fresh arrays instead. Not part of the checkpoint — `restoreArenaMedium`
   *  rebuilds a zeroed set on resume. */
  readonly sourceBuffers: MediumSourceBuffers;
}

/**
 * The five per-cell medium-source arrays as mutable buffers, pre-allocated once
 * on the {@link ArenaMedium} and cleared (`.fill(0)`) then refilled in place
 * each tick by the optimised source-computation path. Exposed as `number[]`
 * (not `readonly number[]`) so the deposit core can write in place; the
 * `readonly` properties prevent reassigning the buffer references themselves.
 */
export interface MediumSourceBuffers {
  /** Per-cell density source, kg·s⁻¹. Cleared and refilled each tick. */
  readonly rho: number[];
  /** Per-cell excitation source, J·s⁻¹. Cleared and refilled each tick. */
  readonly eps: number[];
  /** Per-cell visual-excitation source, J·s⁻¹. Cleared and refilled each tick. */
  readonly epsVisSrc: number[];
  /** Per-cell x-momentum source, kg·m·s⁻². Cleared and refilled each tick. */
  readonly mxSrc: number[];
  /** Per-cell y-momentum source, kg·m·s⁻². Cleared and refilled each tick. */
  readonly mySrc: number[];
}

/**
 * A projectile's contribution to the medium, extracted from {@link SimProjectile}
 * at the call site so this leaf module does not import the engine's mutable
 * projectile type. `powered && burnTicks > 0` means the motor is firing this
 * tick and the round injects an exhaust plume (mass + heat) at its position,
 * using the same SI coupling as ship engine exhaust scaled by the motor's
 * thrust force (`thrust × mass`). Every projectile — burning or not — also
 * deposits a tiny wake coupling along its path.
 */
export interface ProjectileMediumEntry {
  x: number;
  y: number;
  powered: boolean;
  burnTicks: number;
  /** Motor thrust in SI m·s⁻². Deposits exhaust scaled by `thrust × mass`. */
  thrust: number;
  /** Round mass (kg), used to turn acceleration into a force for the plume. */
  mass: number;
}

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
export function buildArenaMedium(ships: readonly SimShip[]): ArenaMedium {
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
    momentumDiffusionM2PerS: D_MEDIUM_M2_PER_S,
    momentumDragPerS: MOMENTUM_DRAG_PER_S,
    velocityMaxMPerS: VELOCITY_MAX_M_PER_S,
  });
  // Seed ρ at the ISM baseline (uniform across every cell); ε at zero. The
  // baseline density is a real WIM figure (see medium-field.ts); at this
  // density the ambient medium is the floor the field relaxes back to.
  const state = mediumStateFromDensity(field, ISM_DENSITY_KG_PER_M3);
  // birthTicks: every cell starts dark (no radiating burn), so the light-lag
  // gate suppresses reception until a cell first crosses the emission
  // threshold inside `stepArenaMedium`.
  const birthTicks = new Array<number>(field.cellCount).fill(-1);
  // Source buffers: pre-allocated once and cleared/refilled in place each tick
  // by the optimised source path (avoids 5 full-grid allocations per tick).
  const sourceBuffers: MediumSourceBuffers = {
    rho: new Array<number>(field.cellCount).fill(0),
    eps: new Array<number>(field.cellCount).fill(0),
    epsVisSrc: new Array<number>(field.cellCount).fill(0),
    mxSrc: new Array<number>(field.cellCount).fill(0),
    mySrc: new Array<number>(field.cellCount).fill(0),
  };
  return { field, state, birthTicks, sourceBuffers };
}

/**
 * Rebuild the arena medium from a captured checkpoint, or from the resolved
 * ships when the checkpoint predates the medium field. Used by the resume path
 * (and the capture/restore round-trip test).
 *
 * When `captured` is present the grid connectivity is re-derived from
 * `(widthM, heightM)` via {@link buildMediumField} (a pure function of the cell
 * counts, so byte-identical to the original) and the live ρ/ε arrays are
 * reattached, alongside the per-cell `birthTicks` array so the light-lag gate
 * continues to treat ongoing burns as ongoing (not as freshly ignited on
 * resume — which would lose distant receivers their steady-burn contacts for
 * one light-time). When `captured` is absent (a pre-medium checkpoint) the
 * field is rebuilt from the restored ships at the ISM baseline with every cell
 * dark — there is no prior mid-battle state to reconstruct because the
 * original run had no medium.
 */
export function restoreArenaMedium(
  captured: EngineCheckpoint["medium"],
  ships: readonly SimShip[],
): ArenaMedium {
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
    momentumDiffusionM2PerS: D_MEDIUM_M2_PER_S,
    momentumDragPerS: MOMENTUM_DRAG_PER_S,
    velocityMaxMPerS: VELOCITY_MAX_M_PER_S,
  });
  return {
    field,
    state: { rho: captured.rho, eps: captured.eps, epsVis: captured.epsVis ?? new Array<number>(captured.rho.length).fill(0), mx: new Array<number>(captured.rho.length).fill(0), my: new Array<number>(captured.rho.length).fill(0) },
    birthTicks: [...captured.birthTick],
    // Source buffers are not captured (they are transient per-tick scratch);
    // rebuild a zeroed set on resume so the next tick's optimised source
    // computation clears and refills them.
    sourceBuffers: {
      rho: new Array<number>(captured.rho.length).fill(0),
      eps: new Array<number>(captured.rho.length).fill(0),
      epsVisSrc: new Array<number>(captured.rho.length).fill(0),
      mxSrc: new Array<number>(captured.rho.length).fill(0),
      mySrc: new Array<number>(captured.rho.length).fill(0),
    },
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
 * Fraction of a burning engine's expelled mass that deposits as local density in
 * the medium grid. A real rocket's exhaust rarefies rapidly in vacuum (expanding
 * beyond the coarse grid cell before the next tick), so only a fraction stays
 * local. The deposited mass carries its momentum (exhaust streams backward at
 * exhaust velocity, advecting ρ/ε away from the nozzle) and its heat (ε via
 * {@link THERMAL_EPS_COUPLING_FRACTION}). 0.1: most exhaust rarefies immediately
 * but enough stays to form a visible, streaming plume.
 */
export const EXHAUST_RHO_COUPLING = 1e-14;

/**
 * Fraction of a burning engine's jet power that converts to thermal /
 * ionisation excitation in the downstream plume. Jet power is `½·m_dot·v_e²`; a
 * small coupling fraction becomes ε in the medium. Two per cent is an authored
 * representative value for the fraction of a rocket-plume's kinetic energy that
 * thermalises into a glowing, ionised channel.
 */
export const THERMAL_EPS_COUPLING_FRACTION = 0.02;

/** Drag coefficient for a body moving through the arena medium. A blunt body in
 *  a dilute plasma: Cd ~ 0.5. Authored representative value. */
export const BODY_DRAG_COEFFICIENT = 0.5;

/** Fraction of a body's dissipated drag power that thermalises into excitation
 *  (ε) in the medium — a glowing wake in dense regions. Authored. */
export const WAKE_EPS_COUPLING = 0.1;

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
 * {@link stepArenaMedium} and diffused/glowed by the field stepper. Production
 * runs the OPTIMISED path: the five source arrays are cleared in place on the
 * {@link ArenaMedium.sourceBuffers} (pre-allocated once at build time) and
 * refilled by the shared {@link depositMediumSources} core, avoiding the 5
 * full-grid allocations per tick the reference path pays.
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
 *
 * @param buffers Pre-allocated per-cell source buffers (cleared and refilled in
 *                place). Supplied by the caller from {@link ArenaMedium.sourceBuffers}.
 */
export function computeArenaMediumSources(
  field: MediumField,
  liveRho: readonly number[],
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectiles: ReadonlyArray<ProjectileMediumEntry>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }>,
  buffers: MediumSourceBuffers,
): MediumSources {
  const { rho, eps, epsVisSrc, mxSrc, mySrc } = buffers;
  // Clear in place (the buffers carry the previous tick's sources) then deposit
  // into them. fill(0) on a previously-used buffer leaves it identical to a
  // fresh zeroed array, so the deposit arithmetic is unchanged.
  rho.fill(0);
  eps.fill(0);
  epsVisSrc.fill(0);
  mxSrc.fill(0);
  mySrc.fill(0);
  depositMediumSources(field, liveRho, ships, debris, projectiles, anomalies, asteroidDiscs, rho, eps, epsVisSrc, mxSrc, mySrc);
  return { rho, eps, epsVisSrc, mxSrc, mySrc };
}

/**
 * REFERENCE (oracle) medium-source computation: the naive allocating path, kept
 * as a first-class implementation the equivalence test compares against the
 * optimised path. Not wired into production; production runs
 * {@link computeArenaMediumSources}. Allocates five fresh full-grid arrays per
 * call — the allocation pattern the in-place buffer reuse replaces. Shares the
 * {@link depositMediumSources} core, so the deposited values are byte-identical
 * to the optimised path; only the array objects differ.
 */
export function computeArenaMediumSourcesReference(
  field: MediumField,
  liveRho: readonly number[],
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectiles: ReadonlyArray<ProjectileMediumEntry>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }>,
): MediumSources {
  const cellCount = field.cellCount;
  const rho = new Array<number>(cellCount).fill(0);
  const eps = new Array<number>(cellCount).fill(0);
  const epsVisSrc = new Array<number>(cellCount).fill(0);
  const mxSrc = new Array<number>(cellCount).fill(0);
  const mySrc = new Array<number>(cellCount).fill(0);
  depositMediumSources(field, liveRho, ships, debris, projectiles, anomalies, asteroidDiscs, rho, eps, epsVisSrc, mxSrc, mySrc);
  return { rho, eps, epsVisSrc, mxSrc, mySrc };
}

/**
 * Shared medium-source deposit core. Writes the per-tick sources (thruster
 * exhaust, debris ablation, projectile wakes + plumes, nebula and asteroid
 * anomaly fills, body-drag wakes) into the five given arrays, ADDING to
 * whatever they currently hold. The caller is responsible for clearing the
 * arrays first (the optimised path clears in place via `.fill(0)`; the
 * reference path passes freshly-allocated zeroed arrays). Pure and
 * deterministic: fixed iteration order over ships, debris, projectiles, and
 * asteroid discs; no RNG. Identical inputs plus identically-cleared arrays
 * produce byte-identical deposits, so the optimised and reference paths agree.
 */
function depositMediumSources(
  field: MediumField,
  liveRho: readonly number[],
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectiles: ReadonlyArray<ProjectileMediumEntry>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }>,
  rho: number[],
  eps: number[],
  epsVisSrc: number[],
  mxSrc: number[],
  mySrc: number[],
): void {
  const cellCount = field.cellCount;

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

      const mainDepositKg = massBurnedKg * EXHAUST_RHO_COUPLING;
      const jetPowerW = 0.5 * forceN * MEDIUM_EXHAUST_VELOCITY_M_PER_S;
      const epsDepositJ = jetPowerW * THERMAL_EPS_COUPLING_FRACTION * MEDIUM_DT_S;
      const mainIdx = mediumCellIndex(
        field,
        Math.floor(wx / field.config.pitchM + field.config.widthM / 2),
        Math.floor(wy / field.config.pitchM + field.config.heightM / 2),
      );
      // ε (heat) at the nozzle cell — unchanged from before the velocity
      // substrate. The excitation feeds sensor signatures; keeping it here
      // preserves the existing battle behaviour.
      if (mainIdx !== null) {
        eps[mainIdx] = (eps[mainIdx] ?? 0) + epsDepositJ;
        epsVisSrc[mainIdx] = (epsVisSrc[mainIdx] ?? 0) + epsDepositJ;
      }
      // Conserved mass (ρ) + backward momentum one cell DOWNSTREAM (not at the
      // nozzle) so the ship never sits in its own exhaust mass (no self-drag).
      // The tiny coupling means negligible drag/sensor impact, but u = mx/ρ
      // stays at exhaust velocity so the plume streams. ε at 0.25× (unchanged).
      const downstreamIdx = mediumCellIndex(
        field,
        Math.floor((wx + exDx * field.config.pitchM) / field.config.pitchM + field.config.widthM / 2),
        Math.floor((wy + exDy * field.config.pitchM) / field.config.pitchM + field.config.heightM / 2),
      );
      if (downstreamIdx !== null && downstreamIdx !== mainIdx) {
        rho[downstreamIdx] = (rho[downstreamIdx] ?? 0) + mainDepositKg;
        eps[downstreamIdx] = (eps[downstreamIdx] ?? 0) + epsDepositJ * 0.25;
        epsVisSrc[downstreamIdx] = (epsVisSrc[downstreamIdx] ?? 0) + epsDepositJ * 0.25;
        mxSrc[downstreamIdx] = (mxSrc[downstreamIdx] ?? 0) + mainDepositKg * MEDIUM_EXHAUST_VELOCITY_M_PER_S * exDx;
        mySrc[downstreamIdx] = (mySrc[downstreamIdx] ?? 0) + mainDepositKg * MEDIUM_EXHAUST_VELOCITY_M_PER_S * exDy;
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

  // --- Projectile wake + burning-motor plume: every round displaces and heats
  // a thin column of the medium along its per-tick path (a tiny wake coupling
  // into the cell the round occupies). A POWERED round with fuel remaining
  // ALSO injects an exhaust plume — the marquee visual of a missile's motor —
  // using the same SI coupling as ship engine exhaust (mass-flow from
  // `F = thrust·mass` over `MEDIUM_EXHAUST_VELOCITY_M_PER_S`, and a thermal
  // fraction of the jet power) so the plume tapers to nothing at burnout. The
  // iteration is in projectile array (creation) order for determinism. ---
  for (const pos of projectiles) {
    const idx = mediumCellIndex(
      field,
      Math.floor(pos.x / field.config.pitchM + field.config.widthM / 2),
      Math.floor(pos.y / field.config.pitchM + field.config.heightM / 2),
    );
    if (idx === null) continue;
    // Wake (every round): a tiny displacement + heating along the path.
    rho[idx] = (rho[idx] ?? 0) + PROJECTILE_WAKE_RHO_COUPLING;
    eps[idx] = (eps[idx] ?? 0) + PROJECTILE_WAKE_EPS_COUPLING;
    // Burning-motor plume (powered rounds with fuel). The motor force is
    // `F = thrust · mass` (thrust is an acceleration in m·s⁻²); the mass-flow
    // and jet-power derivations are identical to the ship-exhaust path above,
    // so a missile plume and a thruster plume of the same force read identically.
    if (pos.powered && pos.burnTicks > 0 && pos.thrust > 0) {
      const forceN = pos.thrust * Math.max(pos.mass, 1e-6);
      const massBurnedKg = (forceN / MEDIUM_EXHAUST_VELOCITY_M_PER_S) * MEDIUM_DT_S;
      const mainDepositKg = massBurnedKg * EXHAUST_RHO_COUPLING;
      const jetPowerW = 0.5 * forceN * MEDIUM_EXHAUST_VELOCITY_M_PER_S;
      const epsDepositJ = jetPowerW * THERMAL_EPS_COUPLING_FRACTION * MEDIUM_DT_S;
      rho[idx] = (rho[idx] ?? 0) + mainDepositKg;
      eps[idx] = (eps[idx] ?? 0) + epsDepositJ;
    }
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

  // --- Body drag → wake: a ship moving through the medium displaces it. The
  //     drag reaction deposits momentum (a wake behind the body) and the
  //     dissipated KE becomes heat (ε — a glowing wake in dense medium). In
  //     thin ISM this is negligible; in a nebula a fast ship leaves a faint
  //     disturbance trail. ---
  for (const ship of ships) {
    if (!ship.alive) continue;
    const speedTick = Math.hypot(ship.velX, ship.velY);
    if (speedTick < 0.5) continue;
    const speedMps = speedTick / MEDIUM_DT_S;
    const idx = mediumCellIndex(
      field,
      Math.floor(ship.x / field.config.pitchM + field.config.widthM / 2),
      Math.floor(ship.y / field.config.pitchM + field.config.heightM / 2),
    );
    if (idx === null) continue;
    const rhoHere = liveRho[idx] ?? 0;
    if (rhoHere <= 0) continue;
    const density = rhoHere / (field.config.pitchM * field.config.pitchM);
    const dragForce = 0.5 * density * speedMps * speedMps * BODY_DRAG_COEFFICIENT * (2 * ship.radius);
    if (dragForce <= 0) continue;
    const dirX = ship.velX / speedTick;
    const dirY = ship.velY / speedTick;
    mxSrc[idx] = (mxSrc[idx] ?? 0) + dragForce * dirX;
    mySrc[idx] = (mySrc[idx] ?? 0) + dragForce * dirY;
    epsVisSrc[idx] = (epsVisSrc[idx] ?? 0) + dragForce * speedMps * WAKE_EPS_COUPLING;
  }
}

/**
 * Advance the arena medium one tick. The caller supplies the per-tick sources
 * (thruster exhaust, debris, projectile wakes, nebula + asteroid anomaly fills)
 * via {@link computeArenaMediumSources}; with a zero source pair, the field
 * relaxes from its prior state without reading or writing any ship / projectile /
 * beam state, so battle outcomes stay byte-for-byte unchanged and only the
 * `medium` snapshot field is added.
 *
 * After the physics step the per-cell `birthTicks` array is updated against
 * {@link MEDIUM_EPS_EMISSION_THRESHOLD_J}: a cell that crossed the threshold
 * from below this tick (ignited) records `tick` as its birth tick; a cell that
 * fell back below the threshold (extinguished) resets to -1; a sustained cell
 * carries its existing birth tick forward. This is the bookkeeping the
 * sustained-radiation light-lag gates on — a distant receiver sees a just-
 * ignited burn only after `ceil(dist / c)` ticks have elapsed, so the gate
 * needs the tick each burn began, not the per-tick ε value (which is the same
 * over the whole burn).
 *
 * Determinism: the stepper is iterated in fixed row-major cell order with fixed
 * N/E/S/W face order (`medium-field.ts`), draws no rng, and depends only on its
 * own prior state plus the supplied sources. Source iteration is likewise fixed
 * (ships, debris, and projectile positions in their array orders; asteroid discs
 * in seed order), so two same-seed runs produce byte-identical medium arrays.
 * The birthTick update walks the same row-major order with the same threshold
 * comparison, so the `birthTicks` array is byte-identical across runs too.
 */
export function stepArenaMedium(
  medium: ArenaMedium,
  sources: MediumSources,
  tick: number,
): ArenaMedium {
  const stepped = stepMediumField(medium.field, medium.state, sources);
  return {
    field: medium.field,
    state: stepped,
    birthTicks: updateMediumBirthTicks(
      medium.state.eps,
      stepped.eps,
      medium.birthTicks,
      tick,
    ),
    // The source buffers are transient scratch, carried forward unchanged for
    // the next tick's optimised source computation to clear and refill in place.
    sourceBuffers: medium.sourceBuffers,
  };
}

/**
 * Compute this tick's medium sources from the engine state and step the field.
 * Collapses the per-tick source computation (thruster exhaust, ablating debris,
 * projectile wakes, nebula + asteroid anomaly fills) plus the field step into a
 * single call so the tick loop stays slim. Pure: returns a new medium state,
 * inputs untouched. The `tick` is the tick this step advances to (the index of
 * the post-step state); it seeds the per-cell birth-tick bookkeeping that the
 * sustained-radiation light-lag gates on.
 */
export function stepArenaMediumFromState(
  medium: ArenaMedium,
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectiles: ReadonlyArray<ProjectileMediumEntry>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }>,
  tick: number,
): ArenaMedium {
  return stepArenaMedium(
    medium,
    computeArenaMediumSources(
      medium.field,
      medium.state.rho,
      ships,
      debris,
      projectiles,
      anomalies,
      asteroidDiscs,
      medium.sourceBuffers,
    ),
    tick,
  );
}

/**
 * Build the next per-cell `birthTicks` array from the pre- and post-step ε,
 * against the sustained-emission threshold. Pure cell-wise transition:
 *  - ignited this tick (`old ≤ threshold < new`): the cell's burn begins on
 *    `tick`, so the light-lag gate will admit reception on ticks
 *    `tick + ceil(dist / c)` and onward.
 *  - extinguished this tick (`old > threshold ≥ new`): reset to -1; the cell
 *    stops radiating and reception ceases regardless of the gate.
 *  - sustained (`old > threshold ∧ new > threshold`): carry the prior birth
 *    tick forward so a long-burning cell stays steadily visible (its light
 *    arrived long ago).
 *  - still dark (`old ≤ threshold ∧ new ≤ threshold`): stays -1.
 *
 * Returns a FRESH array; the inputs are not mutated. Row-major cell scan; no
 * RNG; deterministic.
 */
function updateMediumBirthTicks(
  epsBefore: readonly number[],
  epsAfter: readonly number[],
  birthTicksBefore: readonly number[],
  tick: number,
): number[] {
  const n = epsAfter.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const before = epsBefore[i] ?? 0;
    const after = epsAfter[i] ?? 0;
    const wasRadiating = before > MEDIUM_EPS_EMISSION_THRESHOLD_J;
    const isRadiating = after > MEDIUM_EPS_EMISSION_THRESHOLD_J;
    if (isRadiating && !wasRadiating) {
      // Ignited this tick — the burn starts now.
      out[i] = tick;
    } else if (isRadiating && wasRadiating) {
      // Sustained — carry the prior birth tick (the burn's start).
      out[i] = birthTicksBefore[i] ?? tick;
    } else {
      // Extinguished or still dark — no radiating burn this tick.
      out[i] = -1;
    }
  }
  return out;
}
