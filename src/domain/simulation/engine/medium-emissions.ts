/**
 * Emergent sensor signatures from medium-field excitation (battlefield-medium
 * phase 4). A cell that carries deposited energy ε (a missile's exhaust plume,
 * a beam's ionisation channel, a muzzle flash, a projectile wake) RADIATES as it
 * recombines and cools — that radiation is passively detectable through the SAME
 * light-lagged sensor reception path an active-radar pulse or a hull-ambient
 * emission flows through. A sensor therefore sees a distant burn where the
 * source WAS, delayed by light-time; a muzzle flash is a brief contact; a
 * sustained beam channel emits one discrete, light-lagged emission per tick per
 * cell, so the sensor sees the channel where it was.
 *
 * Coupling model. The medium's ε solver drains each cell at a rate `ε / τ` (the
 * `dε/dt = −ε / τ` recombination/radiative-cooling law in `medium-field.ts`,
 * with `τ = EXCITATION_DECAY_TIMESCALE_S`). That drain is the radiated POWER —
 * the energy leaving the cell per second as EM radiation. A documented coupling
 * fraction `MEDIUM_EPS_RADIATION_COUPLING` maps that SI radiated power into the
 * reception model's emission-strength scale (the same scale the receiver noise
 * floor `EM_RECEIVER_NOISE_FLOOR` and `EM_HULL_AMBIENT_EMISSION` live in, so a
 * cell emission is directly comparable to a hull emission in `formsContact`).
 *
 * The per-tick radiated power a cell sheds is `ε / τ` (joules per second). The
 * coupling fraction is sized so a typical missile-burn / beam-discharge cell is
 * detectable at a range comparable to a hull's ambient reach (a few km for a
 * baseline receiver, further for a sensor cone) — without drowning out every
 * other signature. See {@link MEDIUM_EPS_RADIATION_COUPLING} for the calibration.
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
import { EM_HULL_AMBIENT_EMISSION, EM_RECEIVER_NOISE_FLOOR } from "./em-anchors";
import { VISUAL_LOS_RADIUS_M } from "./em-anchors";
import type { Emission } from "./emissions";
import type { MediumField, MediumState } from "./medium-field";

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
 * Calibration reference: the radiated power a cell must shed to be received at
 * exactly the baseline noise floor at the naked-eye visual radius — the same
 * reach a quiescent hull's ambient emission has. Derived as
 * `4·PI·R² · noiseFloor` with `R = VISUAL_LOS_RADIUS_M`, mirroring
 * `EM_HULL_AMBIENT_EMISSION`'s derivation so a cell radiating at this power is
 * detectable at the same range as a hull. The coupling constant below is sized
 * against it: it is the ratio `EM_HULL_AMBIENT_EMISSION / reference`, which is
 * exactly 1 because both share the same `4·PI·R²·floor` form at the same radius.
 */
export const MEDIUM_REFERENCE_RADIATED_POWER =
  4 * Math.PI * VISUAL_LOS_RADIUS_M * VISUAL_LOS_RADIUS_M * EM_RECEIVER_NOISE_FLOOR;

/**
 * The fraction of a cell's SI radiated power (`ε / τ`) that couples into the
 * reception model's emission-strength scale. Calibrated so a cell radiating the
 * reference power ({@link MEDIUM_REFERENCE_RADIATED_POWER}, the power a hull
 * emits to be seen at the naked-eye radius) produces an emission of
 * `EM_HULL_AMBIENT_EMISSION` — i.e. an excited cell shedding that much power is
 * as detectable as a quiescent hull. Solving
 * `(ε / τ) · COUPLING = EM_HULL_AMBIENT_EMISSION` at the reference power
 * `(ε / τ) = MEDIUM_REFERENCE_RADIATED_POWER` gives
 * `COUPLING = EM_HULL_AMBIENT_EMISSION / MEDIUM_REFERENCE_RADIATED_POWER`,
 * which is exactly 1 because both reference powers share the same `4·PI·R²·floor`
 * form at the same radius. Expressing the coupling as that ratio (rather than
 * the literal 1) preserves the dimensional chain: SI watts → reception-scale
 * strength, and makes the calibration auditable: change the reference radius and
 * the coupling tracks it.
 *
 * With the coupling at unity, a cell's emission strength equals its radiated
 * power `ε / τ` in the reception scale. A sustained beam channel deposits
 * enough ε per tick that `ε / τ` reaches hundreds-to-thousands of hull-ambient
 * units, so its discrete emissions are detectable well beyond the naked-eye
 * radius through any sensor cone — the marquee behaviour — while a lone wake's
 * `ε / τ` (a few tenths of a hull-ambient) only registers at point-blank, so it
 * does not drown out hull signatures.
 */
export const MEDIUM_EPS_RADIATION_COUPLING =
  EM_HULL_AMBIENT_EMISSION / MEDIUM_REFERENCE_RADIATED_POWER;

/**
 * The emission strength (reception scale) a cell radiates this tick: its SI
 * radiated power `ε / τ` times the coupling fraction. Pure function of the
 * cell's ε and the documented decay timescale.
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
 * discrete EM emission per excited cell, in fixed row-major order. Each
 * emission originates at the cell's WORLD position (the documented cell↔world
 * mapping: cell `(col, row)` centre sits at
 * `((col + 0.5 - widthM / 2) · pitch, (row + 0.5 - heightM / 2) · pitch)`) and
 * carries the cell's radiated power as its strength. The emission's `t0` is the
 * current tick, so the light-lagged `formsContact` reception sweep expands its
 * sphere at the speed of light — a distant burn is received ticks after it
 * occurred, exactly as honest EM physics demands.
 *
 * Cells below {@link MEDIUM_EPS_EMISSION_THRESHOLD_J} are skipped (their
 * radiated power is negligible at any sensible range). Pure: no RNG, no
 * mutation, fixed row-major order — two same-seed runs produce byte-identical
 * emission sets.
 */
export function collectMediumEmissions(
  medium: { field: MediumField; state: MediumState },
  tick: number,
): Emission[] {
  const { widthM, heightM, pitchM } = medium.field.config;
  const eps = medium.state.eps;
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
        t0: tick,
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
