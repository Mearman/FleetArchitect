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
  MEDIUM_GRID_MARGIN_CELLS,
  MEDIUM_MAX_VELOCITY_M_PER_S,
  MEDIUM_PITCH_M_DEFAULT,
  MOMENTUM_DRAG_PER_S,
  VELOCITY_MAX_M_PER_S,
  buildMediumField,
  createMediumWorkBuffers,
  mediumStateFromDensity,
} from "./medium-field";
import { stepMediumField } from "./medium-stepper";
import { depositMediumSources } from "./medium-deposit";
import type { MediumField, MediumState, MediumSources, MediumWorkBuffers } from "./medium-field";
import { MEDIUM_EPS_EMISSION_THRESHOLD_J } from "./medium-emissions";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import type { BattleAnomalyKind } from "@/schema/battle";
import type { SimShip } from "./types";
import type { Debris } from "./debris";
import type { SimBeam } from "./beams";
import type { ParticleStore } from "./exhaust-particles";

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
  /** Live ρ + ε state (Float64Array). Replaced with a fresh MediumState each
   *  tick; the arrays alias the {@link work} ping-pong buffers, so advancing
   *  the field overwrites the previous tick's buffers in place. */
  readonly state: MediumState;
  /** Per-cell sustained-radiation birth tick; -1 when not radiating. A persistent
   *  buffer written in place each tick (no per-tick allocation). */
  readonly birthTicks: number[];
  /** Pre-allocated per-tick source buffers (cleared and refilled in place each
   *  tick by the optimised {@link computeArenaMediumSources} path). Not part of
   *  the checkpoint — `restoreArenaMedium` rebuilds a zeroed set on resume. */
  readonly sourceBuffers: MediumSourceBuffers;
  /** Persistent Float64Array ping-pong pairs for the FTCS stepper, reused every
   *  tick (no per-tick allocation). Not part of the checkpoint. */
  readonly work: MediumWorkBuffers;
  /** Pre-step ε snapshot, captured before the stepper overwrites the live ε
   *  buffer (which aliases {@link work}); the birth-tick update diffs it against
   *  the post-step ε. */
  readonly prevEps: Float64Array;
}

/**
 * The five per-cell medium-source arrays as mutable buffers, pre-allocated once
 * on the {@link ArenaMedium} and cleared (`.fill(0)`) then refilled in place
 * each tick by the optimised source-computation path. `Float64Array` (not boxed
 * `number[]`) to match the state arrays the stepper adds them to in the same
 * hot cell loop — same IEEE-754 doubles, no backing-store-shape mismatch.
 */
export interface MediumSourceBuffers {
  /** Per-cell density source, kg·s⁻¹. Cleared and refilled each tick. */
  readonly rho: Float64Array;
  /** Per-cell excitation source, J·s⁻¹. Cleared and refilled each tick. */
  readonly eps: Float64Array;
  /** Per-cell visual-excitation source, J·s⁻¹. Cleared and refilled each tick. */
  readonly epsVisSrc: Float64Array;
  /** Per-cell x-momentum source, kg·m·s⁻². Cleared and refilled each tick. */
  readonly mxSrc: Float64Array;
  /** Per-cell y-momentum source, kg·m·s⁻². Cleared and refilled each tick. */
  readonly mySrc: Float64Array;
}

/**
 * Allocate the per-battle transient scratch on the {@link ArenaMedium}: source
 * buffers, stepper ping-pong pairs, and the pre-step ε snapshot. Rebuilt by
 * {@link buildArenaMedium} and {@link restoreArenaMedium} (not checkpointed).
 */
function createMediumScratch(
  cellCount: number,
): Pick<ArenaMedium, "sourceBuffers" | "work" | "prevEps"> {
  return {
    sourceBuffers: {
      rho: new Float64Array(cellCount),
      eps: new Float64Array(cellCount),
      epsVisSrc: new Float64Array(cellCount),
      mxSrc: new Float64Array(cellCount),
      mySrc: new Float64Array(cellCount),
    },
    work: createMediumWorkBuffers(cellCount),
    prevEps: new Float64Array(cellCount),
  };
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
  /** Pre-move position this tick (`x - vx`, `y - vy`): the swept segment
   *  `prevX,prevY → x,y` is rasterised so the wake deposits along the whole path
   *  the round crossed, not just its instantaneous cell. */
  prevX: number;
  prevY: number;
  powered: boolean;
  burnTicks: number;
  /** Motor thrust in SI m·s⁻². Deposits exhaust scaled by `thrust × mass`. */
  thrust: number;
  /** Round mass (kg), used to turn acceleration into a force for the plume. */
  mass: number;
}

/**
 * An impact's contribution to the medium: a beam strike or projectile hit dumps
 * energy at a world point. Extracted at the call site (the weapons step) so this
 * leaf stays decoupled from the damage pipeline. The energy thermalises into the
 * VISUAL `epsVis` substrate (renderer-only — never feeds AI signatures), giving
 * the impact a flash in the unified glow renderer.
 */
export interface MediumImpactEntry {
  x: number;
  y: number;
  /** Strike energy (joules) — beam `damageJ` or projectile warhead/kinetic energy. */
  energyJ: number;
  /** Channel origin (a beam's firing-gun cell), when this impact is the strike
   *  end of a beam's hitscan channel. Present only for beam impacts; a plain
   *  point impact (no channel) omits it. When present, the deposit also rasters
   *  the source→strike segment into the visual substrate so the whole channel
   *  glows, not just the strike point. */
  sourceX?: number;
  sourceY?: number;
}

/**
 * Refill the per-tick impact scratch from this tick's active beams: each beam's
 * strike point + deposited energy becomes one impact entry, carrying the beam's
 * source point too so the deposit can raster the whole channel (not just the
 * strike point) into the visual substrate. Clears the scratch first
 * (clear-and-reuse, no allocation). Beam strikes are the primary impact glow
 * source; projectile-hit capture is deferred (a round's wake already glows).
 */
export function refillImpactScratchFromBeams(
  beams: readonly SimBeam[],
  scratch: MediumImpactEntry[],
): void {
  scratch.length = 0;
  for (const b of beams) {
    scratch.push({
      x: b.targetX,
      y: b.targetY,
      energyJ: b.damageJ,
      sourceX: b.sourceX,
      sourceY: b.sourceY,
    });
  }
}

/**
 * Build the arena medium field and its ISM-seeded initial state.
 *
 * The grid spans the deployment bounding box (every ship's centre ± its
 * broad-phase radius) plus a {@link MEDIUM_GRID_MARGIN_CELLS} pad on every side,
 * centred on the world origin (cell `(col, row)` centre → world
 * `((col + 0.5 - widthM / 2) · pitch, (row + 0.5 - heightM / 2) · pitch)`).
 *
 * Why padded, not the raw box, and not squared to the larger span. Head-to-head
 * fleets separate on x but cluster on y (a wall a few hundred metres tall), so
 * the raw box collapses `heightM` to 1 — the glow renders as a horizontal bar
 * AND the solver destabilises (every cell a boundary; `u = mx / ρ` unbounded in
 * low-ρ cells). The pad lifts the short axis off 1 (a 1-cell span becomes
 * `1 + 2·margin` rows) so a plume has 2D extent, and seats ships in the interior
 * so the glow's clip edge falls behind them. NOT squared to `max(spanX, spanY)`:
 * a chase battle can span ~1e7 m on one axis and ~0 on the other, and a square
 * of that side is ~4e8 cells → OOM. ρ at ISM baseline; ε at zero; SI coefficients
 * from `medium-field.ts`, supplied explicitly.
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
  // Bbox grid + padded margin: lifts the short axis off 1 (bar/solver fix) and
  // seats ships interior (clip-edge fix). NOT squared — see header (OOM on
  // extreme aspect ratios).
  const widthM = Math.max(1, Math.ceil(spanX / pitch)) + 2 * MEDIUM_GRID_MARGIN_CELLS;
  const heightM = Math.max(1, Math.ceil(spanY / pitch)) + 2 * MEDIUM_GRID_MARGIN_CELLS;
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
  // Seed ρ at the ISM baseline (uniform across every cell); ε at zero.
  const state = mediumStateFromDensity(field, ISM_DENSITY_KG_PER_M3);
  // birthTicks: every cell starts dark (no radiating burn yet).
  const birthTicks = new Array<number>(field.cellCount).fill(-1);
  return { field, state, birthTicks, ...createMediumScratch(field.cellCount) };
}

/**
 * Rebuild the arena medium from a captured checkpoint (or from the resolved
 * ships when the checkpoint predates the medium field). The grid connectivity
 * is re-derived from `(widthM, heightM)` (byte-identical to the original) and
 * the live ρ/ε arrays reattached alongside `birthTicks` so the light-lag gate
 * keeps treating ongoing burns as ongoing on resume. The live state is
 * `Float64Array`; the checkpoint stores boxed `number[]`, materialised to typed
 * arrays at this boundary (exact IEEE-754 doubles).
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
    // Materialise the boxed `number[]` checkpoint arrays into the live
    // Float64Array state (exact IEEE-754 doubles).
    state: {
      rho: Float64Array.from(captured.rho),
      eps: Float64Array.from(captured.eps),
      epsVis: captured.epsVis !== undefined
        ? Float64Array.from(captured.epsVis)
        : new Float64Array(captured.rho.length),
      mx: Float64Array.from(captured.mx),
      my: Float64Array.from(captured.my),
    },
    birthTicks: [...captured.birthTick],
    ...createMediumScratch(captured.rho.length),
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

/**
 * Fraction of an impact's strike energy that thermalises into the visual epsVis
 * substrate at the impact cell. A beam strike or projectile hit dumps energy at
 * a point; a fraction becomes a brief, bright flash in the unified glow renderer.
 * Set to the exhaust thermal fraction ({@link THERMAL_EPS_COUPLING_FRACTION}) for
 * parity with a rocket plume of the same energy. epsVis only — never feeds AI.
 */
export const IMPACT_EPS_VIS_COUPLING = THERMAL_EPS_COUPLING_FRACTION;

/**
 * Fraction of a beam's strike energy that thermalises into the visual epsVis
 * substrate ALONG ITS CHANNEL (the source→strike segment), distributed across
 * the swept cells so a hitscan beam reads as a continuous ionised line rather
 * than the single point flash {@link IMPACT_EPS_VIS_COUPLING} gives the strike
 * cell. A beam physically ionises the whole path it cuts through, not just
 * where it lands. Set to the same thermal fraction as the point impact so a
 * beam's channel and its strike flash compose to a physically comparable total
 * brightness. epsVis only — never feeds AI signatures.
 */
export const BEAM_CHANNEL_EPS_VIS_COUPLING = THERMAL_EPS_COUPLING_FRACTION;

/**
 * Fraction of a cooling particle's radiated energy (its `energyJ × (1 − cooling)`
 * per tick) that thermalises into the visual epsVis substrate in the cell it
 * occupies. This couples the Lagrangian particle representation into the
 * Eulerian field: a cooling parcel bleeds its glow into the medium, so lingering
 * glow becomes field-emergent and fills the gaps between per-tick deposits (a
 * continuous trail). epsVis only — never feeds AI. Tuned in the calibration cycle.
 */
export const PARTICLE_RESIDUAL_EPS_VIS_COUPLING = 0.01;

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
// Asteroid source-cell precomputation
// ============================================================================

/**
 * Precompute the grid-cell indices within any asteroid disc's uplift region
 * (disc radius plus one pitch of margin). Called once at setup — both the
 * discs and the grid are static — so the per-tick deposit loop is O(sourceCells)
 * instead of O(cells x discs). Indices are in row-major visitation order for
 * byte-identical results.
 */
export function computeAsteroidSourceCells(
  field: MediumField,
  asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }>,
): readonly number[] {
  if (asteroidDiscs.length === 0) return [];
  const w = field.config.widthM;
  const h = field.config.heightM;
  const pitch = field.config.pitchM;
  const cells: number[] = [];
  for (let row = 0; row < h; row += 1) {
    const cellY = (row + 0.5 - h / 2) * pitch;
    for (let col = 0; col < w; col += 1) {
      const cellX = (col + 0.5 - w / 2) * pitch;
      for (const disc of asteroidDiscs) {
        const dx = cellX - disc.x;
        const dy = cellY - disc.y;
        if (dx * dx + dy * dy <= (disc.r + pitch) * (disc.r + pitch)) {
          cells.push(row * w + col);
          break;
        }
      }
    }
  }
  return cells;
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
  liveRho: ArrayLike<number>,
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectiles: ReadonlyArray<ProjectileMediumEntry>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidSourceCells: readonly number[],
  buffers: MediumSourceBuffers,
  impacts: ReadonlyArray<MediumImpactEntry>,
  particles: ParticleStore,
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
  depositMediumSources(field, liveRho, ships, debris, projectiles, anomalies, asteroidSourceCells, rho, eps, epsVisSrc, mxSrc, mySrc, impacts, particles);
  return { rho, eps, epsVisSrc, mxSrc, mySrc };
}

/**
 * REFERENCE (oracle) medium-source computation: the naive allocating path the
 * equivalence test compares against the optimised path. Not wired into
 * production. Allocates five fresh full-grid arrays per call — the pattern the
 * in-place reuse replaces. Shares {@link depositMediumSources}, so deposits are
 * byte-identical to the optimised path; only the array objects differ.
 */
export function computeArenaMediumSourcesReference(
  field: MediumField,
  liveRho: ArrayLike<number>,
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectiles: ReadonlyArray<ProjectileMediumEntry>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidSourceCells: readonly number[],
  impacts: ReadonlyArray<MediumImpactEntry>,
  particles: ParticleStore,
): MediumSources {
  const cellCount = field.cellCount;
  const rho = new Float64Array(cellCount);
  const eps = new Float64Array(cellCount);
  const epsVisSrc = new Float64Array(cellCount);
  const mxSrc = new Float64Array(cellCount);
  const mySrc = new Float64Array(cellCount);
  depositMediumSources(field, liveRho, ships, debris, projectiles, anomalies, asteroidSourceCells, rho, eps, epsVisSrc, mxSrc, mySrc, impacts, particles);
  return { rho, eps, epsVisSrc, mxSrc, mySrc };
}

// The deposit core lives in `./medium-deposit` (extracted for module size); the
// optimised and reference compute paths below both call it.

/**
 * Advance the arena medium one tick. The physics step runs in fixed row-major
 * order (no rng), so two same-seed runs produce byte-identical medium arrays.
 * After the step, per-cell birthTicks are updated against
 * {@link MEDIUM_EPS_EMISSION_THRESHOLD_J} (ignited → tick, sustained → carry,
 * extinguished/dark → -1), driving the sustained-radiation light-lag gate.
 */
export function stepArenaMedium(
  medium: ArenaMedium,
  sources: MediumSources,
  tick: number,
): ArenaMedium {
  // Snapshot the pre-step ε before the stepper overwrites the live ε buffer
  // (it aliases the work set); the birth-tick update diffs the two.
  medium.prevEps.set(medium.state.eps);
  const stepped = stepMediumField(medium.field, medium.state, sources, medium.work);
  return {
    field: medium.field,
    state: stepped,
    birthTicks: updateMediumBirthTicks(
      medium.prevEps,
      stepped.eps,
      medium.birthTicks,
      tick,
      medium.birthTicks,
    ),
    // Persistent scratch carried forward for the next tick.
    sourceBuffers: medium.sourceBuffers,
    work: medium.work,
    prevEps: medium.prevEps,
  };
}

/**
 * Compute this tick's medium sources from the engine state and step the field,
 * collapsing source computation (thruster exhaust, debris, projectile wakes,
 * nebula + asteroid fills) plus the field step into one call. `tick` is the
 * tick this step advances to; it seeds the birth-tick bookkeeping the
 * sustained-radiation light-lag gate reads.
 */
export function stepArenaMediumFromState(
  medium: ArenaMedium,
  ships: readonly SimShip[],
  debris: readonly Debris[],
  projectiles: ReadonlyArray<ProjectileMediumEntry>,
  anomalies: readonly BattleAnomalyKind[],
  asteroidSourceCells: readonly number[],
  tick: number,
  impacts: ReadonlyArray<MediumImpactEntry>,
  particles: ParticleStore,
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
      asteroidSourceCells,
      medium.sourceBuffers,
      impacts,
      particles,
    ),
    tick,
  );
}

/**
 * Build the next per-cell `birthTicks` from the pre- and post-step ε against
 * the sustained-emission threshold. Ignited: birth = tick; sustained: carry
 * prior; extinguished or dark: -1. Writes `out` in place (row-major) and
 * returns it. The loop reads `birthTicksBefore[i]` before writing `out[i]` at
 * the same index with no cross-index dependency, so passing the same buffer as
 * both (the persistent {@link ArenaMedium.birthTicks}) is safe and allocates
 * nothing.
 */
function updateMediumBirthTicks(
  epsBefore: ArrayLike<number>,
  epsAfter: ArrayLike<number>,
  birthTicksBefore: readonly number[],
  tick: number,
  out: number[],
): number[] {
  const n = epsAfter.length;
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
