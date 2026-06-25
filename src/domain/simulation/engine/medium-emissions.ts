/**
 * Emergent sensor signatures from medium-field excitation (battlefield-medium
 * phase 4). A cell that carries deposited energy ε (a missile's exhaust plume,
 * a beam's ionisation channel, a muzzle flash, a projectile wake) RADIATES as it
 * recombines and cools. That radiation is passively detectable through the SAME
 * continuous, inverse-square sensor reception path a ship's hull-ambient
 * self-emission flows through (`continuousContact`): an excited cell is a
 * STEADY source for the ticks it stays excited, so — like a hull — the
 * light-lag of any one expanding sphere washes out into a steady state and the
 * detection decision collapses to the inverse-square received strength against
 * the receiver's noise floor. A sensor therefore sees a sustained burn at any
 * range where its inverse-square strength clears the floor, with no per-event
 * light-sphere crossing to gate it.
 *
 * Why continuous (not the discrete, light-lagged `formsContact` path a radar
 * ping flows through). A radar ping is a SINGLE transient event — one sphere,
 * born once, received once when it crosses the observer. A radiating medium
 * cell is a SUSTAINED source: while ε > 0 the cell sheds `ε/τ` watts every
 * tick, so a new sphere is born every tick and there is always exactly one
 * arriving at the observer (the steady-state argument `continuousContact`
 * already makes for a hull). Routing sustained cell radiation through the
 * discrete `formsContact` path was the phase-4 bug: the per-tick emission was
 * minted with `t0 = N` and tested at `tick = N`, where `isReaching` requires
 * the observer INSIDE the emitting cell (`dist === 0` at `t === t0`), so no
 * observer ever received a medium contact at any range. The continuous path is
 * the honest model for a sustained source and mirrors how hull ambient is
 * already handled. A truly brief transient (a single-shot muzzle flash) is
 * tactically minor over a sustained source's lifetime and is not modelled
 * separately here — the simplification is documented and matches the
 * codebase's existing sustained-source treatment.
 *
 * Coupling model. The medium's ε solver drains each cell at a rate `ε / τ` (the
 * `dε/dt = −ε / τ` recombination/radiative-cooling law in `medium-field.ts`,
 * with `τ = EXCITATION_DECAY_TIMESCALE_S`). That drain is the radiated POWER —
 * the energy leaving the cell per second as EM radiation. The coupling
 * {@link MEDIUM_EPS_RADIATION_COUPLING} maps that SI radiated power into the
 * reception model's emission-strength scale (the same scale the receiver noise
 * floor `EM_RECEIVER_NOISE_FLOOR` and `EM_HULL_AMBIENT_EMISSION` live in, so a
 * cell's continuous strength is directly comparable to a hull's in
 * `continuousContact`). See the constant for the worked calibration.
 *
 * Determinism contract: cells are scanned in fixed row-major order, no RNG, the
 * emission `sourceId` deterministically encodes the cell (`medium#<col>_<row>`),
 * and emissions are appended in row-major order so two same-seed runs produce
 * byte-identical emission logs and contacts. The grid is usually small (preset
 * battles ~10–25 cells) and only the few excited cells emit, so the per-tick
 * scan is cheap; only cells above {@link MEDIUM_EPS_EMISSION_THRESHOLD_J} emit,
 * skipping near-zero cells.
 */

import { EXCITATION_DECAY_TIMESCALE_S } from "./medium-field";
import { EM_HULL_AMBIENT_EMISSION } from "./em-anchors";
import type { Emission } from "./emissions";
import type { ArenaMedium } from "./medium-setup";

/**
 * Minimum cell excitation (joules) that radiates enough to be worth emitting as
 * a discrete EM event. Below this a cell's radiated power is negligible against
 * the receiver noise floor at any sensible range, so emitting would just bloat
 * the per-tick emission set without ever forming a contact. Set to the energy a
 * single projectile-wake tick deposits (`PROJECTILE_WAKE_EPS_COUPLING` ≈ 2e-3 J)
 * so a lone wake crosses the threshold but the ISM-quiet bulk of the grid never
 * does.
 */
export const MEDIUM_EPS_EMISSION_THRESHOLD_J = 1e-3;

/**
 * The SI jet power of a representative powered guided round's motor, the anchor
 * the coupling is calibrated against. A Terran-band missile (mass 10 kg, cruise
 * 2000 m·s⁻¹, 40 s burn) has motor acceleration
 * `(1 − 0.4) × 2000 / 40 = 30 m·s⁻²` (see `ordnance-motor.ts`), so its motor
 * force is `30 × 10 = 300 N`. Its exhaust jet power is `½·F·v_e` with the shared
 * exhaust velocity `MEDIUM_EXHAUST_VELOCITY_M_PER_S` (≈ 3138 m·s⁻¹), i.e.
 * `½·300·3138 ≈ 4.71e5 W`. Authored as the literal product so this leaf does not
 * import the medium-setup coupling chain; the value tracks any future change to
 * the exhaust velocity or motor spec by construction (the same numbers are
 * re-derived here).
 */
const REFERENCE_MISSILE_JET_POWER_W = 0.5 * (30 * 10) * (320 * 9.80665);

/**
 * The per-tick ε a representative missile deposits into its cell, mirroring the
 * `computeArenaMediumSources` projectile-plume path: jet power × thermal
 * coupling fraction (`THERMAL_EPS_COUPLING_FRACTION` = 0.02) × the per-tick
 * step (`1 / TICKS_PER_SECOND`). Authored as the literal product so this leaf
 * stays decoupled from the source-computation module.
 */
const REFERENCE_MISSILE_EPS_DEPOSIT_PER_TICK_J =
  REFERENCE_MISSILE_JET_POWER_W * 0.02 * (1 / 30);

/**
 * The no-diffusion equilibrium ε a representative missile's cell would reach if
 * it burned in one cell indefinitely: `deposit · τ / dt` (decay `ε·dt/τ` balances
 * the per-tick deposit). This is the UPPER BOUND on a sustained missile-grade
 * cell; the real solver diffuses ε across the grid (FTCS diffusion at
 * `D_MEDIUM_M2_PER_S`), so a real missile cell realises only a small fraction
 * of this — see {@link MEDIUM_REALISED_EPS_FRACTION}.
 */
const REFERENCE_MISSILE_EQUIIBRIUM_EPS_J =
  (REFERENCE_MISSILE_EPS_DEPOSIT_PER_TICK_J * EXCITATION_DECAY_TIMESCALE_S) / (1 / 30);

/**
 * The fraction of the no-diffusion equilibrium ε that a representative powered
 * round's cell REALISES in the actual solver, after FTCS diffusion
 * (`D_MEDIUM_M2_PER_S` = 1e4 m²·s⁻¹) and the round's finite dwell in each
 * 500 m cell have spread and bled the deposit across the grid. Measured
 * empirically: a slow, long-burn powered round (the signature-sanity scenario
 * in `engine.medium-signatures.unit.test.ts`, a torpedo-profile round that
 * dwells many ticks before clearing its launch cell) realises a peak cell ε of
 * ≈ 3.7e3 J; against the missile's no-diffusion equilibrium
 * `REFERENCE_MISSILE_EQUIIBRIUM_EPS_J ≈ 4.71e4 J` that is a fraction of ≈ 0.078.
 * Authored as a literal so this leaf stays decoupled from the solver; if the
 * diffusion coefficient or cell pitch changes materially, re-measure against
 * the signature-sanity scenario and update both this and the worked example
 * below.
 */
export const MEDIUM_REALISED_EPS_FRACTION = 0.078;

/**
 * The realised peak ε a representative powered-round burn reaches in the actual
 * solver: the no-diffusion equilibrium scaled by the diffusion-attenuation
 * fraction. This is the cell energy the coupling is calibrated against — the
 * honest "actual ε deposit magnitude" a burning powered round produces, not the
 * theoretical upper bound diffusion prevents it from reaching. The coupling
 * below makes a cell at this energy detectable at the naked-eye radius, so a
 * missile burn is detectable at a few kilometres by a baseline receiver exactly
 * as the feature requires.
 */
export const MEDIUM_REFERENCE_RADIATION_EPS_J =
  REFERENCE_MISSILE_EQUIIBRIUM_EPS_J * MEDIUM_REALISED_EPS_FRACTION;

/**
 * The fraction of a cell's SI radiated power (`ε / τ`) that couples into the
 * reception model's emission-strength scale. Calibrated so that a cell carrying
 * the REALISED peak ε of a representative powered-round burn
 * ({@link MEDIUM_REFERENCE_RADIATION_EPS_J}, the actual cell energy the solver
 * produces after diffusion — NOT the unattainable no-diffusion equilibrium)
 * radiates with the SAME continuous strength as a quiescent hull. A missile
 * burn is therefore detectable at the naked-eye radius `VISUAL_LOS_RADIUS_M`
 * (5 km) by a baseline, sensor-free receiver, and at proportionally longer
 * ranges through any sensor cone. Solving
 * `(ε_ref / τ) · COUPLING = EM_HULL_AMBIENT_EMISSION` for the coupling:
 *
 *     COUPLING = EM_HULL_AMBIENT_EMISSION · τ / ε_ref
 *
 * Worked example (the calibration, in reception-scale units):
 *  - Hull ambient strength `EM_HULL_AMBIENT_EMISSION = 4π · 5000² ≈ 3.14e8`.
 *  - Missile deposit per tick `D ≈ 314 J` (jet power 4.71e5 W × 0.02 × 1/30 s).
 *  - No-diffusion equilibrium `D · τ / dt ≈ 4.71e4 J`.
 *  - Realised peak after diffusion `ε_ref ≈ 0.078 · 4.71e4 ≈ 3.7e3 J`.
 *  - `τ = 5 s`, so the reference radiated power is `ε_ref / τ ≈ 7.4e2 W`.
 *  - `COUPLING = 3.14e8 · 5 / 3.7e3 ≈ 4.24e5`.
 *
 * Detection ranges it implies (inverse-square against the unit noise floor):
 *  - A missile-burn cell at its realised peak (~3.7e3 J): baseline ~5.0 km,
 *    ~8.0 km through an 8 km sensor cone — the marquee signature-sanity
 *    behaviour.
 *  - A weaker transient cell (~1e3 J as the round moves between dwell peaks):
 *    baseline ~2.6 km.
 *  - A ship's sustained plasma-drive plume (realised ε far higher, depositing
 *    continuously in one cell) is detectable at tens of km — a thrusting drive
 *    is the loudest thing on the board.
 *  - A lone projectile wake (deposits 2e-3 J, transient) registers only at
 *    point-blank (~10 m), so it does not drown out hull signatures.
 */
export const MEDIUM_EPS_RADIATION_COUPLING =
  (EM_HULL_AMBIENT_EMISSION * EXCITATION_DECAY_TIMESCALE_S) /
  MEDIUM_REFERENCE_RADIATION_EPS_J;

/**
 * The continuous emission strength (reception scale) a cell radiates this tick:
 * its SI radiated power `ε / τ` times the coupling fraction. Pure function of
 * the cell's ε and the documented decay timescale. Fed to `continuousContact`
 * (NOT `formsContact`) by the medium reception pass — see the module header for
 * why sustained cell radiation routes through the continuous path.
 */
export function mediumCellEmissionStrength(epsJoules: number): number {
  return (epsJoules / EXCITATION_DECAY_TIMESCALE_S) * MEDIUM_EPS_RADIATION_COUPLING;
}

/**
 * The synthetic `sourceId` for a medium-cell emission. Deterministically
 * encodes the cell so two same-seed runs produce identical ids, and so a
 * contact derived from it carries a stable, parseable identifier (distinct
 * from any real ship's instanceId, which never contains `#medium#`).
 */
export function mediumCellSourceId(col: number, row: number): string {
  return `medium#${col}_${row}`;
}

/**
 * Scan the medium field for cells with non-trivial excitation and emit one
 * continuous EM emission per excited cell, in fixed row-major order. Each
 * emission originates at the cell's WORLD position (the documented cell↔world
 * mapping: cell `(col, row)` centre sits at
 * `((col + 0.5 - widthM / 2) · pitch, (row + 0.5 - heightM / 2) · pitch)`) and
 * carries the cell's continuous radiated strength ({@link
 * mediumCellEmissionStrength}) for the reception pass. The emission's `t0` is
 * the cell's BIRTH tick — the tick the cell first crossed the emission
 * threshold this burn (`medium.birthTicks[cell]`), maintained by
 * {@link stepArenaMedium} — which the sustained-radiation light-lag gate in
 * {@link mediumReceives} reads to delay a distant receiver's first detection
 * until the light has crossed the gap (`tick >= t0 + ceil(dist / c)`). A cell
 * that has been radiating for many ticks carries an old `t0`, so the gate long
 * since admitted its reception and detection continues at the steady inverse-
 * square strength; a just-ignited cell carries a fresh `t0`, so a distant
 * receiver sees nothing until the light arrives. See the module header for
 * why sustained sources still route through the continuous inverse-square path
 * (the steady-state strength) rather than the discrete, light-lagged
 * `formsContact` path — the STARTUP light-lag is a gate on top of the
 * continuous path, not a reversion to broken discrete spheres.
 *
 * Cells below {@link MEDIUM_EPS_EMISSION_THRESHOLD_J} are skipped (their
 * radiated power is negligible at any sensible range). Pure: no RNG, no
 * mutation, fixed row-major order — two same-seed runs produce byte-identical
 * emission sets.
 */
export function collectMediumEmissions(medium: ArenaMedium): Emission[] {
  const { widthM, heightM, pitchM } = medium.field.config;
  const eps = medium.state.eps;
  const birthTicks = medium.birthTicks;
  const out: Emission[] = [];
  // Row-major scan: row 0..heightM-1 outer, col 0..widthM-1 inner. The flat
  // cell index is `row * widthM + col`, so a single row-major pass over the ε
  // array touches cells in the documented order.
  for (let row = 0; row < heightM; row += 1) {
    const cellY = (row + 0.5 - heightM / 2) * pitchM;
    for (let col = 0; col < widthM; col += 1) {
      const idx = row * widthM + col;
      const epsHere = eps[idx];
      if (epsHere === undefined || epsHere <= MEDIUM_EPS_EMISSION_THRESHOLD_J) continue;
      const cellX = (col + 0.5 - widthM / 2) * pitchM;
      out.push({
        sourceId: mediumCellSourceId(col, row),
        x: cellX,
        y: cellY,
        strength: mediumCellEmissionStrength(epsHere),
        // The sustained burn's birth tick — when this cell first crossed the
        // emission threshold this burn. The light-lag gate reads this to
        // suppress distant reception until the light has crossed the gap. A
        // cell that has been burning for many ticks carries an old t0 and the
        // gate stays open; a just-ignited cell carries a fresh t0 and the gate
        // holds reception off until the light arrives.
        t0: birthTicks[idx] ?? -1,
      });
    }
  }
  return out;
}

/**
 * Upper bound on the number of medium-cell emissions appended to the per-tick
 * snapshot emission log. The grid is small and only a few cells are excited at
 * any instant, so in practice this cap never fires; it exists only to keep a
 * degenerate high-excitation battle (a large nebula-flash, many simultaneous
 * beam channels) from bloating `frame.emissions` without bound. When the cap
 * fires the strongest cells win (the row-major scan naturally hits the
 * lowest-row cells first, which is deterministic); the reception pass below
 * reads the UNcapped set from {@link collectMediumEmissions} directly, so
 * detection fidelity is never reduced by snapshot capping — only the snapshot
 * record is trimmed.
 */
export const MEDIUM_EMISSION_SNAPSHOT_CAP = 64;

/**
 * Append medium-cell emissions to the per-tick snapshot emission log, capped to
 * {@link MEDIUM_EMISSION_SNAPSHOT_CAP} so the snapshot cannot bloat. Mutates the
 * `emissions` array in place, appending in row-major order. Returns the next
 * sequence value (threading the caller's monotonic counter). The UNcapped set
 * for the reception pass comes from {@link collectMediumEmissions}; this
 * function only shapes what the snapshot records.
 */
export function appendMediumEmissionsToSnapshot(
  mediumEmissions: readonly Emission[],
  emissions: Emission[],
  seq: number,
): number {
  let next = seq;
  for (let i = 0; i < mediumEmissions.length && i < MEDIUM_EMISSION_SNAPSHOT_CAP; i += 1) {
    const em = mediumEmissions[i];
    if (em === undefined) continue;
    emissions.push(em);
    next += 1;
  }
  return next;
}
