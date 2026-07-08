/**
 * Arena-scale medium field: a pure, deterministic two-substrate transport
 * solver carrying density (ρ) and excitation (ε) across the battlefield.
 *
 * The field is the physical substrate from which weapon trails, exhaust wakes,
 * ionisation flashes, and sensor signatures will later EMERGE — its job is to
 * be honest SI physics on a coarse arenacale grid, not to render anything. It
 * mirrors the ship-local `transport-field.ts` primitive (the
 * advection–diffusion–reaction equation on a finite-volume FTCS scheme) but
 * carries TWO coupled substances over a regular rectangular arena lattice with
 * a configurable pitch `P` (metres per cell), rather than one substance over
 * an arbitrary ship cell graph.
 *
 * ## Substances
 *
 *  - **Density ρ** — matter, in **kilograms per cell**. Each cell represents a
 *    slab of thickness `MEDIUM_SLAB_DEPTH_M` (1 m) across its `P × P` face, so
 *    a cell at the baseline interstellar-medium density holds
 *    `ρ_ISM · P² · MEDIUM_SLAB_DEPTH_M` kg. ρ advects down its own gradient
 *    (high → low), diffuses (Fick), and bleeds to vacuum at the arena edge.
 *  - **Excitation ε** — deposited energy, in **joules per cell**. ε diffuses,
 *    decays exponentially toward zero (radiative cooling / recombination), and
 *    radiates away at the arena edge. Per-cell injection later feeds in beam
 *    strikes, muzzle flashes, exhaust heat.
 *
 * Both substances are non-negative.
 *
 * ## Scheme and stability
 *
 * Explicit forward-time, centred-space (FTCS) finite volume on a 2D
 * 4-connected (N/E/S/W) rectangular lattice of pitch `P`. Stability of the
 * explicit diffusion step requires `D·dt/P² ≤ 1/2` per face; the per-cell
 * bound (the scheme sums flux over all of a cell's faces in one step) is
 * `GRID_FACE_NEIGHBOURS_MEDIUM · D · dt / P² ≤ margin`, where
 * `GRID_FACE_NEIGHBOURS_MEDIUM = 4`. Upwind advection is stable when
 * `GRID_FACE_NEIGHBOURS_MEDIUM · u_max · dt / P ≤ margin`.
 *
 * The stepper sub-steps the integrator with a FIXED count derived from each
 * substance's `D` and `u_max` ceilings — never the instantaneous values.
 * Sizing from a momentarily small velocity / gradient would under-resolve the
 * stiff `u = K·∇ρ` relaxation: explicit Euler then amplifies the perturbation
 * every tick until a cell goes negative and the non-negativity clamp invents
 * mass, compounding into a runaway (Infinity → NaN). This is the same lesson
 * documented at length in `transport-field.ts`'s atmosphere closure — the
 * fixed sub-step count from the ceiling is the cure.
 *
 * ## Determinism
 *
 * The stepper is pure: input arrays are not mutated, iteration order is fixed
 * (row-major cell sweep, N/E/S/W face order), and there is no `Math.random`,
 * `Date`, or nondeterministic dispatch. Two calls with identical inputs
 * produce bit-identical outputs.
 *
 * Use-deferred: the field is honestly simulated in real SI units but is NOT
 * wired into the tick loop. Wiring (thrusters → ρ source, beams → ε source,
 * signature readout) is a later pass on top of this honest model.
 */

// ============================================================================
// SI anchors and tunables
// ============================================================================

/**
 * Simulation tick rate, ticks per second. Matches the rest of the engine
 * (`transport-field.ts`, `simulation/types.ts`); the medium field's per-tick
 * `dt` is `1 / TICKS_PER_SECOND` seconds before stability sub-stepping.
 *
 * Classification: unit-spec-rate-epsilon (the engine's fixed tick rate).
 */
export const TICKS_PER_SECOND = 30;

/** Per-tick time step, seconds. The integrator further sub-steps if the
 *  explicit-scheme stability bound requires it.
 *
 *  Classification: derived-by-formula (`1 / TICKS_PER_SECOND`). */
export const MEDIUM_DT_S = 1 / TICKS_PER_SECOND;

/**
 * Slab depth (metres) represented by one medium cell — the thickness of the
 * P × P face over which density is integrated. The arena medium is a thin
 * shell rather than a fully 3D volume (the battlefield is wide and long but
 * the gameplay-relevant medium — trails, exhaust plumes, ionisation — is a
 * layer a few metres deep). One metre keeps ρ in honest `kg per P×P×1m` slab
 * units and lets density read directly as a path density along that slab.
 *
 * Classification: unit-spec-rate-epsilon (a chosen slab thickness).
 */
export const MEDIUM_SLAB_DEPTH_M = 1;

/**
 * Default arena medium grid pitch, metres per cell. The battlefield is
 * open-ended: fleets deploy at `±edgeInset` in `resolve.ts`, where the inset
 * is the smaller of "just outside weapon range" (catalogue weapon reach runs
 * ~12–80 km), a kinematic closing budget, and a mutual-sight cap (innate
 * naked-eye sight is ~5 km, `VISUAL_LOS_REFERENCE_M`). A representative
 * engagement therefore spans a few km (a myopic, close-in fleet) to several
 * tens of km (a sensor-equipped long-range fleet).
 *
 * 500 m per cell lands a typical ~20 km × 20 km battlefield on a 40 × 40
 * lattice (~1600 cells) and an extended ~50 km × 50 km one on 100 × 100
 * (~10 000 cells, the upper tractable bound). Callers can override via
 * {@link MediumFieldConfig.pitchM}; the field never assumes a fixed arena
 * extent.
 *
 * Classification: unit-spec-rate-epsilon (a chosen grid resolution for the
 * arena medium; not physics-derived).
 */
export const MEDIUM_PITCH_M_DEFAULT = 500;

/**
 * Cells of margin padded around the deployment bounding box when sizing the
 * arena grid ({@link buildArenaMedium}). The grid is otherwise sized exactly to
 * the ships' bounding box, so without this margin the grid's rectangular
 * boundary lies right on the deployment line — ships sit in the outermost cell
 * (col 0), their backward exhaust plumes spill over the edge, and the glow
 * overlay (which only paints inside the grid) hard-clips there, showing a
 * visible straight border through the battle. The padding seats ships in the
 * interior with room behind them for the plume to exist and fade, pushing the
 * clip edge off the battlefield. The renderer feathers the outermost cells (see
 * `GLOW_EDGE_FEATHER_CELLS` in `mediumShared.ts`) so even if the padded edge is
 * on screen it fades rather than clips.
 *
 * Classification: unit-spec-rate-epsilon (a rendering/coverage margin, not
 * physics-derived). Keep ≥ `GLOW_EDGE_FEATHER_CELLS` so the feather fades
 * within the padded region, not into the ships.
 */
export const MEDIUM_GRID_MARGIN_CELLS = 4;

/**
 * Interstellar medium baseline density, kg·m⁻³. The real ISM is faint but
 * non-zero: the warm ionised medium (WIM) that dominates the Milky Way's volume
 * has number density `n_H ≈ 0.1 cm⁻³` (Draine 2011, ch. 1). Converting to a mass
 * density: `0.1 cm⁻³ = 1e5 m⁻³`; at `m_H ≈ 1.67e-27 kg` that is
 * `≈ 1.7e-22 kg·m⁻³`. This is the floor the medium relaxes back to once battles,
 * exhaust, and trails have dissipated — the battlefield is never a perfect
 * vacuum.
 *
 * Honest visibility note: at this realistic density the ambient ISM is far too
 * thin to ionise visibly on its own. The "faint always-on trail" character comes
 * from LOCALLY dense or excited material — exhaust plumes and beam-deposited
 * energy sit many orders of magnitude above the ISM floor and are what actually
 * glow — together with a renderer brightness mapping whose low end is sensitive
 * enough to read the ISM floor as a faint haze. The dynamic-range tuning lives
 * in the renderer, not in this pure substrate; the constant here is the honest
 * physical baseline.
 *
 * Source: Draine, *Physics of the Interstellar and Intergalactic Medium*
 * (Princeton, 2011), ch. 1, WIM phase properties (`n_H ≈ 0.1 cm⁻³`).
 *
 * Classification: real physical constant (a documented ISM density figure).
 */
export const ISM_DENSITY_KG_PER_M3 = 1.7e-22;

/**
 * Diffusion coefficient for the arena medium, m²·s⁻¹. Turbulent mixing in a
 * dilute, weakly-coupled plasma is dominated by bulk Reynolds stress and
 * plasma instability, not molecular diffusion; the effective coefficient is
 * many orders of magnitude above the molecular value. We take
 * `~1.0e4 m²·s⁻¹` — analogous to strong atmospheric eddy diffusivity scaled
 * to the low-density, high-Mach regime of an exhaust plume spreading through
 * the ISM. This is the slow equalisation that flattens density and energy
 * gradients left behind by moving ships and weapon events.
 *
 * Classification: authored catalogue content (a turbulent-mixing eddy
 * diffusivity for the dilute arena medium; Phase 14 may refine from a real
 * Reynolds-stress model).
 */
export const D_MEDIUM_M2_PER_S = 1.0e4;

/**
 * Density-gradient bulk-flow ceiling, m·s⁻¹. ρ advects down its own gradient
 * with a velocity proportional to the local `−∇ρ`, clamped to ±this value —
 * the parallel of `transport-field.ts`'s atmosphere pressure-gradient closure
 * (`u = c_s · Δp / p_cabin`, clamped to the sound speed). For the dilute
 * arena medium the analog of the sound speed is the Alfvén / thermal speed of
 * the ISM plasma, of order `~10 km·s⁻¹` in the warm ionised phase. We take
 * 10 000 m·s⁻¹.
 *
 * Sizing the sub-step count from this ceiling (not the instantaneous velocity)
 * is what keeps the stiff `u = K·∇ρ` relaxation stable — see the module
 * header. The constant is also the linear closure coefficient: a cell pair
 * with a unit-gradient density step (1 kg·m⁻³ across one pitch) drives flow
 * at `MEDIUM_MAX_VELOCITY_M_PER_S · (Δρ · P / MEDIUM_DENSITY_GRAD_REF)`,
 * clamped.
 *
 * Classification: real physical constant order-of-magnitude (thermal speed of
 * the warm ionised ISM, the analog of the sound speed for the density
 * pressure-gradient closure).
 */
export const MEDIUM_MAX_VELOCITY_M_PER_S = 10_000;

/**
 * Density-gradient reference (kg·m⁻³) at which the bulk-flow closure saturates
 * at its ceiling. The linear closure
 * `u = MEDIUM_MAX_VELOCITY_M_PER_S · (ρ_from − ρ_to) / MEDIUM_DENSITY_GRAD_REF`
 * clamps to ±`MEDIUM_MAX_VELOCITY_M_PER_S`. Sized at the ISM baseline so a
 * cell pair straddling baseline-vs-vacuum (the largest step the medium itself
 * ever presents away from a battle event) drives a near-saturated flow, while
 * a dense exhaust plume (many orders above the ISM) saturates fully — the
 * bulk-flow regime where advection dominates over the slow Fickian diffusion.
 *
 * Classification: derived-by-formula (`ISM_DENSITY_KG_PER_M3`).
 */
export const MEDIUM_DENSITY_GRAD_REF_KG_PER_M3 = ISM_DENSITY_KG_PER_M3;

/**
 * Momentum drag rate, s⁻¹. Injected momentum (exhaust thrust, wake drag) relaxes
 * back toward zero at this rate — the medium's inertia bleeding into the
 * surrounding vacuum as the moving material rarefies. Authored at 0.5 s⁻¹ (a
 * ~2 s decay, matching the excitation cooling timescale so a plume's push fades
 * on the same timescale as its glow).
 *
 * Classification: authored (a drag rate for the dilute arena medium).
 */
export const MOMENTUM_DRAG_PER_S = 0.5;

/**
 * Velocity ceiling for the CFL sub-step count of velocity-driven advection,
 * m·s⁻¹. The sub-step count is sized from this ceiling (not the instantaneous
 * velocity) so the upwind advection stays stable across the full velocity range.
 * Set above the exhaust velocity (~3138 m·s⁻¹) so plume-streaming advection is
 * always inside the CFL bound.
 *
 * Classification: authored (a CFL ceiling for velocity-driven transport).
 */
export const VELOCITY_MAX_M_PER_S = 5000;

/**
 * Boundary sink velocity, m·s⁻¹. ρ at the arena edge bleeds into vacuum at
 * this outflow speed — the same physical picture as the atmosphere substance's
 * vent flux (`dm/dt = ρ · A · v_e`), here applied to every perimeter cell's
 * outward face. Set to the density-gradient ceiling so an edge cell vents at
 * the medium's natural exhaust rate.
 *
 * Classification: derived-by-formula (`MEDIUM_MAX_VELOCITY_M_PER_S`).
 */
export const MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S = MEDIUM_MAX_VELOCITY_M_PER_S;

/**
 * Excitation (ε) decay timescale, seconds. ε decays exponentially toward zero
 * as `dε/dt = −ε / τ`, modelling the combined recombination and radiative
 * cooling that drains deposited energy out of an ionised trail or flash. Five
 * seconds is the order of an ionised plasma channel recombining after the
 * depositing event passes — long enough that a beam strike's ε lingers as a
 * visible trail over multiple ticks, short enough that a battlefield's
 * signature fades to quiescence between engagements rather than accumulating
 * forever.
 *
 * Classification: authored catalogue content (a plasma recombination /
 * radiative-cooling timescale for the dilute arena medium).
 */
export const EXCITATION_DECAY_TIMESCALE_S = 5;

/**
 * Boundary radiative cooling rate for ε, as a fraction of the cell's energy
 * per second lost across each outward perimeter face. The arena edge is open
 * to cold vacuum, so deposited energy radiates away faster there than the bulk
 * volumetric decay. Set so an edge cell loses its ε over roughly one decay
 * timescale via its outward face — matching the volumetric rate.
 *
 * Classification: derived-by-formula (`1 / EXCITATION_DECAY_TIMESCALE_S`).
 */
export const MEDIUM_BOUNDARY_EPS_LOSS_PER_S = 1 / EXCITATION_DECAY_TIMESCALE_S;

// ============================================================================
// Stability bounds (mirroring transport-field.ts's reasoning)
// ============================================================================

/**
 * FTCS stability margin for the explicit diffusion step: stable when
 * `D·dt/P² ≤ 0.5` per face. We run at 0.4 to stay clear of the neutral
 * stability boundary — a documented numerical choice, not a physical constant.
 *
 * Classification: unit-spec-rate-epsilon.
 */
export const MEDIUM_DIFFUSION_CFL_MARGIN = 0.4;

/**
 * CFL stability margin for the explicit upwind advection step: stable when
 * `|u|·dt/P ≤ 1`. We run at 0.5 — the same rate/epsilon category as
 * `MEDIUM_DIFFUSION_CFL_MARGIN`.
 *
 * Classification: unit-spec-rate-epsilon.
 */
export const MEDIUM_ADVECTION_CFL_MARGIN = 0.5;

/**
 * Maximum number of faces a single medium cell can carry on the rectangular
 * 4-connected lattice: an interior cell has N, E, S, W neighbours. Both
 * stability bounds are PER CELL, not per face: the explicit scheme sums the
 * flux over every face of a cell in one step, so the relevant Courant / FTCS
 * number is the SUM of the per-face contributions. The worst case is all four
 * faces carrying flux in the destabilising sense at once — bounding only one
 * face lets that summed flux reach four times the per-face limit, drive a cell
 * negative, and trigger the non-negativity floor clamp to fabricate mass
 * every sub-step, compounding into a runaway. Folding the coordination number
 * into the sub-step count makes the per-cell bound hold by construction. The
 * same reasoning as `transport-field.ts`'s `GRID_FACE_NEIGHBOURS`, restated
 * here so this module is self-contained.
 */
export const GRID_FACE_NEIGHBOURS_MEDIUM = 4;

/**
 * Number of explicit sub-steps needed to keep the diffusion coefficient `D`
 * inside the FTCS bound over one tick at pitch `P`. Returns at least 1 (a
 * non-diffusive substance needs no sub-stepping). The per-cell bound sums the
 * diffusive flux across all of a cell's faces, so the worst-case stability
 * condition is `GRID_FACE_NEIGHBOURS_MEDIUM · D · (dt/n) / P² ≤ margin`,
 * giving `n ≥ GRID_FACE_NEIGHBOURS_MEDIUM · D · dt / (margin · P²)`.
 */
export function mediumDiffusionSubSteps(
  coefficient: number,
  pitchM: number,
): number {
  if (coefficient <= 0) return 1;
  const dx2 = pitchM * pitchM;
  const n =
    (GRID_FACE_NEIGHBOURS_MEDIUM * coefficient * MEDIUM_DT_S) /
    (MEDIUM_DIFFUSION_CFL_MARGIN * dx2);
  return Math.max(1, Math.ceil(n));
}

/**
 * Number of explicit sub-steps needed to keep the upwind advection step inside
 * its CFL bound at pitch `P`, given the maximum advection velocity. The bound
 * is per cell: a cell's net outflow is the sum over its faces, so the worst
 * case (every face expelling at the maximum velocity) is
 * `GRID_FACE_NEIGHBOURS_MEDIUM · |u_max| · (dt/n) / P ≤ margin`, giving
 * `n ≥ GRID_FACE_NEIGHBOURS_MEDIUM · |u_max| · dt / (margin · P)`. Sizing from
 * `u_max` (the ceiling), not the instantaneous velocity, holds for every
 * field state — see the module header.
 */
export function mediumAdvectionSubSteps(
  maxVelocity: number,
  pitchM: number,
): number {
  if (maxVelocity <= 0) return 1;
  const n =
    (GRID_FACE_NEIGHBOURS_MEDIUM * maxVelocity * MEDIUM_DT_S) /
    (MEDIUM_ADVECTION_CFL_MARGIN * pitchM);
  return Math.max(1, Math.ceil(n));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Per-cell source terms injected into the medium over one tick. Both arrays
 * are length `widthM * heightM` (cell-major, row by row), aligned with the ρ
 * and ε field arrays. A positive value adds; a negative value removes. Units:
 * `rhoSource` is kg·s⁻¹ per cell (a thruster plume or debris deposit), and
 * `epsSource` is J·s⁻¹ per cell (a beam strike or muzzle flash). The stepper
 * applies `source · dt` and clamps the cell to non-negative afterwards.
 */
export interface MediumSources {
  /** Per-cell density source, kg·s⁻¹. Default zero everywhere. */
  readonly rho: Float64Array;
  /** Per-cell excitation source, J·s⁻¹. Default zero everywhere. */
  readonly eps: Float64Array;
  /** Per-cell x-momentum source (East+), kg·m·s⁻² per cell. Drives exhaust
   *  streaming and wakes. Default zero everywhere. */
  readonly mxSrc: Float64Array;
  /** Per-cell y-momentum source (South+), kg·m·s⁻² per cell. Default zero. */
  readonly mySrc: Float64Array;
  /** Per-cell visual-excitation source, J·s⁻¹. Same deposits as eps but this
   *  field is velocity-advected (streams). The renderer reads epsVis. */
  readonly epsVisSrc: Float64Array;
}

/** A field state: the five substance arrays as unboxed `Float64Array`, length
 *  `width * height`. Typed arrays hold the same IEEE-754 doubles the boxed
 *  `number[]` representation did — switching to `Float64Array` removes the
 *  per-tick boxing/allocation churn of the FTCS stepper, which ping-pongs
 *  between persistent work buffers (see {@link MediumWorkBuffers}) instead of
 *  slicing five boxed arrays every tick. Boxed `number[]` is materialised only
 *  at the snapshot/checkpoint boundary (`Array.from` / spread), preserving the
 *  exact IEEE-754 values. */
export interface MediumState {
  /** Density ρ, kg per cell (length `widthM * heightM`). */
  readonly rho: Float64Array;
  /** Excitation ε, J per cell (length `widthM * heightM`). Sensor-stable
   *  (no velocity advection) — the AI reads this for targeting. */
  readonly eps: Float64Array;
  /** Visual excitation εVis, J per cell. Same physics as ε (diffusion, decay,
   *  source) but ALSO velocity-advected (streams). The renderer reads this; the
   *  sensor system reads `eps`. This decouples visual glow from AI signatures. */
  readonly epsVis: Float64Array;
  /** Momentum x (East+), kg·m·s⁻¹ per cell. Velocity u_x = mx / ρ. */
  readonly mx: Float64Array;
  /** Momentum y (South+), kg·m·s⁻¹ per cell. Velocity u_y = my / ρ. */
  readonly my: Float64Array;
}

/**
 * Persistent ping-pong work buffers for the medium stepper: two `Float64Array`
 * sets per substance, owned by the {@link ArenaMedium} (in `medium-setup.ts`)
 * and reused every tick so the FTCS step allocates nothing. Each tick the
 * stepper copies the input state into the set it does NOT alias (a cross-copy —
 * the live state aliases one set from the previous tick's result, so copying
 * into the OTHER set is never a self-copy; a fresh state aliases neither and
 * copies into set A), then ping-pongs between the two sets across sub-steps.
 * The post-step state aliases whichever set the last sub-step wrote.
 */
export interface MediumWorkBuffers {
  readonly rhoA: Float64Array;
  readonly rhoB: Float64Array;
  readonly epsA: Float64Array;
  readonly epsB: Float64Array;
  readonly epsVisA: Float64Array;
  readonly epsVisB: Float64Array;
  readonly mxA: Float64Array;
  readonly mxB: Float64Array;
  readonly myA: Float64Array;
  readonly myB: Float64Array;
}

/** Allocate a fresh {@link MediumWorkBuffers} set (all-zero) for a field of
 *  `cellCount` cells. Called once per battle on the {@link ArenaMedium}; the
 *  stepper overwrites the contents every tick but reuses the buffers. */
export function createMediumWorkBuffers(cellCount: number): MediumWorkBuffers {
  return {
    rhoA: new Float64Array(cellCount),
    rhoB: new Float64Array(cellCount),
    epsA: new Float64Array(cellCount),
    epsB: new Float64Array(cellCount),
    epsVisA: new Float64Array(cellCount),
    epsVisB: new Float64Array(cellCount),
    mxA: new Float64Array(cellCount),
    mxB: new Float64Array(cellCount),
    myA: new Float64Array(cellCount),
    myB: new Float64Array(cellCount),
  };
}

/**
 * Static configuration of the medium field: the grid shape, the SI
 * coefficients, and the stability margins. Built once per battle and reused
 * for every tick; the {@link stepMediumField} stepper reads the grid geometry
 * (the cell count, the pre-built per-cell neighbour index, and the boundary
 * cell set) from here so the per-tick work is O(cells), not O(cells · faces).
 *
 * Defaults are the documented SI anchors; every field carries a derivation
 * comment naming its anchor.
 */
export interface MediumFieldConfig {
  /** Grid width, in cells. */
  readonly widthM: number;
  /** Grid height, in cells. */
  readonly heightM: number;
  /** Cell pitch, metres. Defaults to {@link MEDIUM_PITCH_M_DEFAULT}. */
  readonly pitchM: number;
  /** Density diffusion coefficient, m²·s⁻¹. Defaults to
   *  {@link D_MEDIUM_M2_PER_S}. */
  readonly rhoDiffusionM2PerS: number;
  /** Density bulk-flow velocity ceiling, m·s⁻¹. Defaults to
   *  {@link MEDIUM_MAX_VELOCITY_M_PER_S}. */
  readonly rhoMaxVelocityMPerS: number;
  /** Excitation diffusion coefficient, m²·s⁻¹. Defaults to
   *  {@link D_MEDIUM_M2_PER_S}. */
  readonly epsDiffusionM2PerS: number;
  /** Excitation decay timescale, seconds. Defaults to
   *  {@link EXCITATION_DECAY_TIMESCALE_S}. */
  readonly epsDecayTimescaleS: number;
  /** Boundary ρ vent velocity, m·s⁻¹. Defaults to
   *  {@link MEDIUM_BOUNDARY_VENT_VELOCITY_M_PER_S}. */
  readonly boundaryVentVelocityMPerS: number;
  /** Boundary ε loss rate (fraction per second per outward face). Defaults to
   *  {@link MEDIUM_BOUNDARY_EPS_LOSS_PER_S}. */
  readonly boundaryEpsLossPerS: number;
  /** Momentum viscous diffusion coefficient, m²·s⁻¹. Defaults to
   *  {@link D_MEDIUM_M2_PER_S} (same turbulent mixing as density). */
  readonly momentumDiffusionM2PerS: number;
  /** Momentum linear drag rate, s⁻¹. Momentum relaxes toward zero at this rate
   *  (the medium's inertia bleeds into the surrounding vacuum). Defaults to
   *  {@link MOMENTUM_DRAG_PER_S}. */
  readonly momentumDragPerS: number;
  /** Velocity ceiling for the CFL sub-step count of velocity-driven advection,
   *  m·s⁻¹. Defaults to {@link VELOCITY_MAX_M_PER_S}. */
  readonly velocityMaxMPerS: number;
}

/**
 * Built medium field: the {@link MediumFieldConfig} plus the pre-computed grid
 * connectivity. Construct once via {@link buildMediumField}; pass to
 * {@link stepMediumField} every tick.
 */
export interface MediumField {
  /** The resolved field configuration. */
  readonly config: ResolvedMediumFieldConfig;
  /** Total cell count (`widthM * heightM`). */
  readonly cellCount: number;
  /** Pre-built per-cell neighbour index as a flat `Int32Array` of stride 4:
   *  for cell `c`, slots `[c*4 .. c*4+3]` hold the N, E, S, W neighbour indices
   *  in that fixed deterministic order, with `-1` marking a missing direction
   *  (edge/corner cells). Length `cellCount * 4`. A flat typed array replaces
   *  the per-cell boxed arrays so the hot FTCS loop reads neighbour indices via
   *  direct indexed Int32 loads instead of boxed-array `for-of` iteration; the
   *  N/E/S/W visitation order (which drives the floating-point accumulation) is
   *  unchanged. */
  readonly neighboursFlat: Int32Array;
  /** Pre-built per-cell outward face count (how many of the 4 directions open
   *  to vacuum rather than to a neighbour). Length `cellCount`. */
  readonly boundaryFaceCount: readonly number[];
}

/** A {@link MediumFieldConfig} with every field resolved to a concrete value
 *  (defaults filled in). */
export interface ResolvedMediumFieldConfig {
  readonly widthM: number;
  readonly heightM: number;
  readonly pitchM: number;
  readonly rhoDiffusionM2PerS: number;
  readonly rhoMaxVelocityMPerS: number;
  readonly epsDiffusionM2PerS: number;
  readonly epsDecayTimescaleS: number;
  readonly boundaryVentVelocityMPerS: number;
  readonly boundaryEpsLossPerS: number;
  readonly momentumDiffusionM2PerS: number;
  readonly momentumDragPerS: number;
  readonly velocityMaxMPerS: number;
}

/** Result of advancing the medium field by one tick. The arrays alias the
 *  stepper's persistent {@link MediumWorkBuffers} (optimised path) or fresh
 *  slices (reference path); in both cases they hold the post-tick state. */
export interface MediumStepResult {
  /** The post-tick density field. Length `cellCount`. */
  readonly rho: Float64Array;
  /** The post-tick excitation field. Length `cellCount`. */
  readonly eps: Float64Array;
  /** The post-tick visual-excitation field (velocity-advected). Length `cellCount`. */
  readonly epsVis: Float64Array;
  /** The post-tick x-momentum field. Length `cellCount`. */
  readonly mx: Float64Array;
  /** The post-tick y-momentum field. Length `cellCount`. */
  readonly my: Float64Array;
}

/**
 * Build a medium field from a (possibly partial) configuration. Fills in the
 * SI defaults and pre-computes the per-cell neighbour index and boundary face
 * counts. Pure: same inputs always produce the same field.
 */
export function buildMediumField(
  config: MediumFieldConfig,
): MediumField {
  const resolved: ResolvedMediumFieldConfig = {
    widthM: config.widthM,
    heightM: config.heightM,
    pitchM: config.pitchM,
    rhoDiffusionM2PerS: config.rhoDiffusionM2PerS,
    rhoMaxVelocityMPerS: config.rhoMaxVelocityMPerS,
    epsDiffusionM2PerS: config.epsDiffusionM2PerS,
    epsDecayTimescaleS: config.epsDecayTimescaleS,
    boundaryVentVelocityMPerS: config.boundaryVentVelocityMPerS,
    boundaryEpsLossPerS: config.boundaryEpsLossPerS,
    momentumDiffusionM2PerS: config.momentumDiffusionM2PerS,
    momentumDragPerS: config.momentumDragPerS,
    velocityMaxMPerS: config.velocityMaxMPerS,
  };
  const cellCount = resolved.widthM * resolved.heightM;
  // Per-cell neighbours in fixed N, E, S, W order, packed into a single flat
  // Int32Array of stride 4. A missing direction (edge or corner cell) is
  // marked with the `-1` sentinel, which the stepper skips — the visitation
  // order is therefore identical to the old per-cell boxed-array list (which
  // pushed N/E/S/W and omitted missing directions), so the floating-point
  // accumulation in the FTCS loop is byte-identical. One allocation total,
  // and the hot loop reads indices via direct Int32 loads with no per-cell
  // array indirection or boxing.
  const neighboursFlat = new Int32Array(cellCount * 4).fill(-1);
  const boundaryFaceCount: number[] = new Array<number>(cellCount).fill(0);
  for (let row = 0; row < resolved.heightM; row += 1) {
    for (let col = 0; col < resolved.widthM; col += 1) {
      const cell = row * resolved.widthM + col;
      const base = cell * 4;
      // Count the directions that open to vacuum (no neighbour) rather than
      // to an interior cell. A cell on the top row has its North face on the
      // perimeter, etc.; a corner cell has two perimeter faces.
      let boundaryFaces = 0;
      // North neighbour (row - 1) — slot 0.
      if (row > 0) {
        neighboursFlat[base] = (row - 1) * resolved.widthM + col;
      } else {
        boundaryFaces += 1;
      }
      // East neighbour (col + 1) — slot 1.
      if (col + 1 < resolved.widthM) {
        neighboursFlat[base + 1] = row * resolved.widthM + (col + 1);
      } else {
        boundaryFaces += 1;
      }
      // South neighbour (row + 1) — slot 2.
      if (row + 1 < resolved.heightM) {
        neighboursFlat[base + 2] = (row + 1) * resolved.widthM + col;
      } else {
        boundaryFaces += 1;
      }
      // West neighbour (col - 1) — slot 3.
      if (col > 0) {
        neighboursFlat[base + 3] = row * resolved.widthM + (col - 1);
      } else {
        boundaryFaces += 1;
      }
      boundaryFaceCount[cell] = boundaryFaces;
    }
  }
  return {
    config: resolved,
    cellCount,
    neighboursFlat,
    boundaryFaceCount,
  };
}

/**
 * Build a zeroed {@link MediumState} for the field (all cells at zero density
 * and excitation). Use as a starting point and inject sources, or use
 * {@link mediumStateFromDensity} to seed the field at a uniform baseline.
 */
export function zeroMediumState(field: MediumField): MediumState {
  return {
    rho: new Float64Array(field.cellCount),
    eps: new Float64Array(field.cellCount),
    epsVis: new Float64Array(field.cellCount),
    mx: new Float64Array(field.cellCount),
    my: new Float64Array(field.cellCount),
  };
}

/**
 * Build a {@link MediumState} with ρ seeded at a uniform density across every
 * cell (kg per cell = `densityKgPerM3 · pitchM² · MEDIUM_SLAB_DEPTH_M`) and ε
 * at zero. Convenience for initialising the medium at the ISM baseline.
 */
export function mediumStateFromDensity(
  field: MediumField,
  densityKgPerM3: number,
): MediumState {
  const kgPerCell =
    densityKgPerM3 * field.config.pitchM * field.config.pitchM * MEDIUM_SLAB_DEPTH_M;
  return {
    rho: new Float64Array(field.cellCount).fill(kgPerCell),
    eps: new Float64Array(field.cellCount),
    epsVis: new Float64Array(field.cellCount),
    mx: new Float64Array(field.cellCount),
    my: new Float64Array(field.cellCount),
  };
}

/** Build a zeroed {@link MediumSources} (no injection anywhere). */
export function zeroMediumSources(field: MediumField): MediumSources {
  return {
    rho: new Float64Array(field.cellCount),
    eps: new Float64Array(field.cellCount),
    epsVisSrc: new Float64Array(field.cellCount),
    mxSrc: new Float64Array(field.cellCount),
    mySrc: new Float64Array(field.cellCount),
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Bulk-flow velocity across one cell-to-neighbour face, m·s⁻¹, positive along
 * the outward normal (from `cell` toward `neighbour`). The closure is the
 * density-gradient flow: a cell holding more ρ than its neighbour pushes mass
 * outward; the linear coefficient is `MEDIUM_MAX_VELOCITY_M_PER_S /
 * MEDIUM_DENSITY_GRAD_REF_KG_PER_M3` per kg·m⁻³ of density step, clamped to
 * ±`MEDIUM_MAX_VELOCITY_M_PER_S`. The closure is computed from the intensive
 * density (`ρ_mass / cellVolume`, kg·m⁻³), so the per-cell-mass step
 * coefficient is `vMax · (ρ_from − ρ_to) / (gradRef · cellVolume)` — i.e. the
 * cell-volume rescaling happens here, before the velocity is returned, so the
 * stepper can apply the per-face advection formula `u · φ / pitch` directly in
 * extensive (kg) units.
 *
 * The cell volume (`pitch² · slabDepth`, m³) is supplied by the caller rather
 * than recomputed in the body: it is step-invariant (config-derived), so the
 * stepper hoists the `pitch · pitch · slabDepth` multiply out of the per-cell /
 * per-direction neighbour loop alongside its other call-invariant coefficients.
 * The caller MUST guarantee `cellVolumeM3 > 0` and `gradRefKgPerM3 > 0`
 * (degenerate configs never occur in a real field; the stepper collapses the
 * old early-return into a hoisted `gradEnabled` flag). The arithmetic and
 * operand order are identical to the previous pitch/slabDepth-signature form,
 * so frames stay byte-identical — this is pure code motion.
 */
export function densityGradientVelocity(
  rhoFrom: number,
  rhoTo: number,
  cellVolumeM3: number,
  vMax: number,
  gradRefKgPerM3: number,
): number {
  const densityFrom = rhoFrom / cellVolumeM3;
  const densityTo = rhoTo / cellVolumeM3;
  // Linear closure: u = vMax · (ρ_from − ρ_to) / gradRef, clamped.
  const u = (vMax * (densityFrom - densityTo)) / gradRefKgPerM3;
  if (u > vMax) return vMax;
  if (u < -vMax) return -vMax;
  return u;
}

/**
 * Volumetric ε decay rate (J·s⁻¹ per cell) for the exponential cooling
 * `dε/dt = −ε / τ`. Applied as a reaction source in the same sub-step loop as
 * diffusion, so the explicit-scheme sub-step count covers it (the decay's
 * stability bound `dt/τ ≤ 1` is looser than the diffusion bound at the
 * documented timescale).
 */
export function excitationDecayRate(eps: number, tauS: number): number {
  if (tauS <= 0) return 0;
  return -eps / tauS;
}

/**
 * Boundary ρ outflow rate (kg·s⁻¹) for a perimeter cell with `boundaryFaces`
 * outward faces opening to vacuum. The cell vents at the medium's exhaust
 * velocity: per face the outflow is `density · faceArea · v_e`, where
 * `density = ρ / cellVolume`, `faceArea = pitch · slabDepth`, and
 * `cellVolume = pitch² · slabDepth`. Those cancel to give `ρ · v_e / pitch`
 * per face — the slab depth drops out (both the flux through a face and the
 * cell's capacity scale with it). Total across `boundaryFaces` faces:
 * `ρ · v_e · boundaryFaces / pitch`. The stepper applies `rate · dt` and
 * clamps the cell to non-negative.
 */
export function densityBoundaryRate(
  rho: number,
  boundaryFaces: number,
  pitchM: number,
  ventVelocity: number,
): number {
  if (boundaryFaces <= 0 || ventVelocity <= 0) return 0;
  if (rho <= 0) return 0;
  if (pitchM <= 0) return 0;
  return (rho * ventVelocity * boundaryFaces) / pitchM;
}

/**
 * Boundary ε outflow rate (J·s⁻¹) for a perimeter cell. Each outward face
 * loses `boundaryEpsLossPerS` of the cell's energy per second — the open edge
 * radiates faster than the bulk volumetric decay. The total rate across
 * `boundaryFaces` faces is `eps · boundaryEpsLossPerS · boundaryFaces`. The
 * stepper applies `rate · dt` and clamps the cell to non-negative.
 */
export function excitationBoundaryRate(
  eps: number,
  boundaryFaces: number,
  boundaryEpsLossPerS: number,
): number {
  if (boundaryFaces <= 0 || boundaryEpsLossPerS <= 0) return 0;
  if (eps <= 0) return 0;
  return eps * boundaryEpsLossPerS * boundaryFaces;
}

/**
 * Sum the density across the field (kg). Useful for conservation assertions:
 * in a closed field (no sources, no boundary sink) the total is invariant
 * under pure advection + diffusion.
 */
export function totalDensity(rho: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < rho.length; i += 1) sum += rho[i] ?? 0;
  return sum;
}

/**
 * Sum the excitation across the field (joules). Useful for the decay
 * assertion: ε monotonically decreases toward zero in a source-free field.
 */
export function totalExcitation(eps: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < eps.length; i += 1) sum += eps[i] ?? 0;
  return sum;
}
