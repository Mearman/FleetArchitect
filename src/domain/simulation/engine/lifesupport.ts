/**
 * Atmosphere / life-support substance: breathable gas density transported by
 * advection + diffusion, with crew consumption and venting recoil.
 *
 * φ = gas mass per cell (kg). The field carries:
 *
 *   - Advection: bulk flow on a pressure gradient through open doors and
 *     hallways. Velocity is derived from the φ-gradient (high → low density)
 *     by a linearised pressure-driven flow; this is the air-rushing-through-
 *     a-breach behaviour.
 *   - Diffusion: Fick's law with the gas diffusion coefficient (O₂ in N₂ at
 *     STP), the slow equalisation that flattens small density differences.
 *   - Sink: crew O₂ consumption (kg·s⁻¹ per crewed cell).
 *   - Boundary flux: venting through a breached compartment. Venting gas at
 *     exhaust velocity `v_e` carries momentum `dm·v_e` — the recoil that
 *     knocks a breached ship off course.
 *
 * Use-deferred: gas density is honestly simulated but does not yet
 * asphyxiate crew or decompress compartments.
 */

import {
  TRANSPORT_GEOMETRY,
  type BoundaryFlux,
  type TransportSubstance,
} from "@/domain/simulation/engine/transport-field";

/**
 * Binary diffusion coefficient of O₂ in N₂ at standard temperature and
 * pressure, m²·s⁻¹. ≈ 2.0e-5 m²·s⁻¹ (Massman 1999, look-up value). This is
 * the Fick's-law coefficient for the diffusion term.
 */
export const GAS_DIFFUSION_COEFFICIENT_M2_PER_S = 2.0e-5;

/**
 * Sea-level atmospheric density of breathable air, kg·m⁻³. ≈ 1.225 kg·m⁻³
 * (ISA standard). Used as the equilibrium value a fully-pressurised cell
 * settles at; one cell holds `density · cellVolume` kg of gas.
 */
export const AIR_DENSITY_KG_PER_M3 = 1.225;

/** Specific gas constant for dry air, J·kg⁻¹·K⁻¹. */
export const SPECIFIC_GAS_CONSTANT_AIR_J_PER_KG_K = 287.058;

/** Reference cabin temperature, K (15 °C). ISA standard: the temperature at
 *  which sea-level density is exactly 1.225 kg/m³ and pressure 101 325 Pa,
 *  so the ideal-gas relation `p = ρ·R·T` is self-consistent at the anchor
 *  values. */
export const CABIN_TEMPERATURE_K = 288.15;

/** Reference cabin pressure, Pa. ISA sea-level standard: 101 325 Pa. */
export const CABIN_PRESSURE_PA = 101_325;

/**
 * Per-crew-member O₂ consumption, kg·s⁻¹. A resting-to-moderate adult
 * consumes ≈ 0.84 kg/day of O₂, which is 0.84 / 86400 ≈ 9.7e-6 kg·s⁻¹.
 * Crewed cells subtract this from the local gas mass.
 */
export const CREW_O2_CONSUMPTION_KG_PER_S = 0.84 / 86_400;

/**
 * Time, in seconds, an unprotected crew member survives full exposure to
 * vacuum before incapacitation/death. Acute decompression renders a human
 * unconscious within ~15 s as the blood deoxygenates; death follows within
 * a minute or two. We take 15 s as the lethal exposure window — the point of
 * useful consciousness — so a crew member in a breached, vented compartment
 * dies over roughly this span. The per-tick fraction of crew HP lost is
 * `1 / (CREW_VACUUM_LETHAL_TIME_S · ticksPerSecond)`; the resource step scales
 * it by the cell's vented-ness (how far below cabin pressure the cell has
 * fallen), so a crew member only takes the full rate once the cell is hard
 * vacuum and takes none while the compartment still holds pressure.
 */
export const CREW_VACUUM_LETHAL_TIME_S = 15;

/**
 * Survivable fraction of standard cabin gas mass. Above this fraction the
 * partial pressure is high enough to keep a crew member conscious and
 * unharmed; below it the crew member is exposed and takes vacuum damage in
 * proportion to the deficit, reaching the full lethal rate at hard vacuum.
 * 0.5 (≈ the pressure at the Armstrong limit, where exposed body fluids begin
 * to boil and useful consciousness is lost) is the threshold for harm.
 */
export const CREW_VACUUM_SURVIVABLE_FRACTION = 0.5;

/**
 * Crew vacuum-exposure severity for a cell holding `gasMassKg`, in [0, 1].
 * Zero while the cell stays at or above the survivable gas mass; ramps
 * linearly to 1 (full exposure) at zero gas (hard vacuum). The resource step
 * multiplies the per-tick lethal rate by this to damage exposed crew.
 */
export function vacuumExposureSeverity(gasMassKg: number): number {
  const survivable = STANDARD_CELL_GAS_MASS_KG * CREW_VACUUM_SURVIVABLE_FRACTION;
  if (survivable <= 0) return 0;
  if (gasMassKg >= survivable) return 0;
  const severity = (survivable - gasMassKg) / survivable;
  return severity < 0 ? 0 : severity > 1 ? 1 : severity;
}

/**
 * Vent exhaust velocity, m·s⁻¹. Gas escaping a breached compartment into
 * vacuum expands at the local speed of sound; for air at 20 °C this is
 * ≈ 343 m·s⁻¹. The recoil impulse from venting mass `dm` is `dm · v_e`.
 */
export const VENT_EXHAUST_VELOCITY_M_PER_S = 343;

/**
 * Per-cell crew count map: cell index → number of crew present. Each crewed
 * cell subtracts `n · CREW_O2_CONSUMPTION_KG_PER_S` from the local gas mass.
 */
export type CrewMap = ReadonlyMap<number, number>;

/** Per-cell vent mask: which boundary cells are breached and venting to
 *  space. A breached cell vents its gas at `VENT_EXHAUST_VELOCITY_M_PER_S`
 *  along the outward normal of its boundary face. */
export type VentMask = ReadonlyMap<number, { nx: number; ny: number }>;

/** Gas mass per cell at standard cabin pressure (the equilibrium a fully
 *  pressurised, unbreached, uncrewed compartment settles at). kg = ρ · V. */
export const STANDARD_CELL_GAS_MASS_KG =
  AIR_DENSITY_KG_PER_M3 * TRANSPORT_GEOMETRY.cellVolumeM3;

/**
 * Convert a cell's gas mass (kg) to pressure (Pa) via the ideal gas law at
 * cabin temperature: `p = (m / V) · R · T`.
 */
export function pressureFromMass(massKg: number): number {
  const density = massKg / TRANSPORT_GEOMETRY.cellVolumeM3;
  return density * SPECIFIC_GAS_CONSTANT_AIR_J_PER_KG_K * CABIN_TEMPERATURE_K;
}

/**
 * Build an atmosphere substance configuration.
 *
 * The velocity closure returns the advection velocity across a face from the
 * local pressure gradient. Pressure `p = (m/V)·R·T` (ideal gas, fixed cabin
 * temperature); the gradient drives flow from high to low pressure at a rate
 * set by `FLOW_CONDUCTANCE_M2_S_PER_PA`. The face normal points from `from`
 * toward `to`, so a positive velocity means flow leaves `from` (into `to`).
 */
export function makeAtmosphereSubstance(
  crew: CrewMap,
  vents: VentMask,
): TransportSubstance {
  return {
    name: "atmosphere",
    coefficient: GAS_DIFFUSION_COEFFICIENT_M2_PER_S,
    // Phase 12 (use-deferred): advection is omitted because there are no
    // breached compartments yet — the damage model does not expose hull
    // openings in this phase, so no cell loses pressure suddenly and the
    // pressure-driven Darcy flow is negligible. Advection (and the 23
    // CFL sub-steps it would require for VENT_EXHAUST_VELOCITY_M_PER_S)
    // is re-enabled when breach support lands. Pure diffusion with 1 sub-step
    // is accurate for an intact, sealed hull.
    nonNegative: true,
    floor: 0,
    source: (cell) =>
      -(crew.get(cell) ?? 0) * CREW_O2_CONSUMPTION_KG_PER_S,
    boundaryFlux: (cell, phi): BoundaryFlux => {
      const vent = vents.get(cell);
      if (vent === undefined) {
        return { cell, scalarFlux: 0, momentumX: 0, momentumY: 0 };
      }
      const mass = phi[cell] ?? 0;
      if (mass <= 0) {
        return { cell, scalarFlux: 0, momentumX: 0, momentumY: 0 };
      }
      // Vent rate `dm/dt = ρ·A·v_e` derived from cell density and exhaust
      // velocity. The field integrator applies `dt` and clamps the cell to
      // non-negative mass.
      const density = mass / TRANSPORT_GEOMETRY.cellVolumeM3;
      const rate =
        density * TRANSPORT_GEOMETRY.faceAreaM2 * VENT_EXHAUST_VELOCITY_M_PER_S;
      // Momentum reaction: gas leaves along +vent normal, so the hull feels
      // a force along −vent normal. F = (dm/dt) · v_e.
      const force = rate * VENT_EXHAUST_VELOCITY_M_PER_S;
      return {
        cell,
        scalarFlux: rate,
        momentumX: -vent.nx * force,
        momentumY: -vent.ny * force,
      };
    },
  };
}

/** Re-export the gravity anchor so tests can reference it from the substance
 *  module without importing the primitive directly. */
export { STANDARD_GRAVITY_M_PER_S2 } from "@/domain/simulation/engine/transport-field";
