/**
 * Thermal substance: temperature transported as a diffusion-only field with
 * radiative boundary outflux.
 *
 * φ = temperature (K). The field carries no advection (a solid hull does not
 * flow); heat moves only by conduction (diffusion, D = thermal diffusivity of
 * the hull material) and leaves through radiator panels as Stefan–Boltzmann
 * radiation `j = ε·σ·T⁴·A`. Radiative outflux is NOT a linear diffusion term
 * (it is T⁴, not T), so it is modelled as a boundary flux rather than a
 * diffusive face — exactly as the plan specifies.
 *
 * ## Power ↔ temperature: the heat-capacity term
 *
 * A heat SOURCE and the radiative boundary flux are both POWERS (watts), but the
 * field φ is a TEMPERATURE (kelvin). The two are related by the cell's heat
 * capacity `C` (joules per kelvin): `dT/dt = P / C`. Earlier this field assumed
 * an implicit unit heat capacity (`C = 1`), which was harmless when the reactor
 * "output" was an abstract ~40-unit figure but catastrophic once it became a
 * real gigawatt: injecting `1.5e9` directly as a temperature rate is `1.5e9 K/s`,
 * a ~50 M K spike in one tick. The substance now takes a per-cell heat-capacity
 * map (`C(cell)` in J/K = cell mass × material specific heat) and divides every
 * power by it, so the source becomes `wasteWatts(cell) / C(cell)` [K/s] and the
 * radiative outflux `ε·σ·A·(T⁴ − T_space⁴) / C(cell)` [K/s]. Diffusion already
 * operates correctly on temperature (a conductive rate, not a power), so it is
 * left untouched. The steady state `T = (P / (ε·σ·A))^(1/4)` is independent of
 * `C` — heat capacity governs only the transient and numerical stability;
 * survival is set by the radiator area (the deployed-fin factor) and the waste
 * heat (reactor efficiency), both anchored in `combat-scale.ts`.
 *
 * Temperature is honestly simulated, and a cell that exceeds
 * `SIM.overheatThresholdK` is now destroyed by `resourceStep` (overheat
 * shutdown). The IR emission it implies feeds the Phase 9 awareness model later.
 */

import { RADIATOR_FIN_AREA_FACTOR } from "@/data/catalog/combat-scale";
import {
  STEFAN_BOLTZMANN_W_PER_M2_K4,
  TRANSPORT_GEOMETRY,
  type TransportSubstance,
} from "@/domain/simulation/engine/transport-field";

/**
 * Thermal diffusivity of an aluminium hull at room temperature, m²·s⁻¹.
 * Aluminium 6061: α ≈ 6.7e-5 m²·s⁻¹ at 300 K (looked-up material property,
 * not tuned). The transport field is material-parametric so a different hull
 * material swaps one constant.
 */
export const HULL_THERMAL_DIFFUSIVITY_M2_PER_S = 6.7e-5;

/**
 * Effective radiating area per radiator cell, m². A radiator cell exposes both
 * faces of its 1 m edge to space (twice the face area is the bare footprint),
 * and a real radiator unfolds a large finned surface from that mount: the
 * {@link RADIATOR_FIN_AREA_FACTOR} (deployed-fin amplification, `combat-scale.ts`)
 * scales the footprint up to the effective radiating area. At gigawatt waste
 * heat this is what lets a single reactor cell shed its load below the 1500 K
 * material limit; without the fin amplification the bare 2 m² footprint settles
 * thousands of kelvin above the threshold.
 */
const RADIATOR_AREA_PER_CELL_M2 =
  2 * TRANSPORT_GEOMETRY.faceAreaM2 * RADIATOR_FIN_AREA_FACTOR;

/**
 * Radiator emissivity (dimensionless, 0–1). Real radiator coatings reach
 * ≈ 0.9 in the infrared; a high-emissivity anodised finish is the design
 * point for waste-heat rejection.
 */
export const RADIATOR_EMISSIVITY = 0.9;

/** Space (cosmic microwave background) effective temperature, K. Radiators
 *  exchange heat with a 2.7 K sink; we subtract T_space⁴ from T⁴ to get the
 *  net radiated power (the incoming σT_space⁴ is negligible at ship scales
 *  but physically present, so it is kept). */
export const SPACE_TEMPERATURE_K = 2.725;

/** Celsius zero point, K. Convenience for authoring source rates in human
 *  units; the field itself is always in kelvin. */
export const CELSIUS_ZERO_K = 273.15;

/**
 * Per-cell heat-source map: cell index → thermal power in watts. A reactor
 * cell dumps waste heat; weapons and engines dump heat when they fire. The
 * caller builds this from the live module state; an empty map means a
 * quiescent, coasting ship.
 */
export type ThermalSourceMap = ReadonlyMap<number, number>;

/** Per-cell radiator mask: which cells are radiator panels venting to space.
 *  A cell with no radiator panel is thermally insulated at the hull (no
 *  boundary flux); a radiator cell carries the T⁴ outflux. */
export type RadiatorMask = ReadonlySet<number>;

/**
 * Per-cell heat-capacity map: cell index → heat capacity in joules per kelvin
 * (`cell mass × material specific heat`). The substance divides every power
 * term (the watt source, the watt radiative flux) by the cell's heat capacity
 * to convert watts into a kelvin-per-second rate, since the transported field φ
 * is a temperature. A cell absent from the map carries
 * {@link DEFAULT_CELL_HEAT_CAPACITY_J_PER_K}, so a sparse map degrades to a
 * uniform heat capacity rather than dividing by zero.
 */
export type HeatCapacityMap = ReadonlyMap<number, number>;

/**
 * Fallback heat capacity (J/K) for a cell the caller did not supply in the
 * heat-capacity map. A bare unit cell of low-density material has a heat
 * capacity of order `(~few hundred kg) × (~few hundred J/(kg·K))` ≈ 1e5 J/K;
 * this floor stands in for a cell whose mass the caller could not resolve, so
 * the power-to-temperature conversion never divides by zero. Real cells always
 * carry their resolved `mass × specificHeat`, so this is only ever the degraded
 * path (e.g. a test that omits the map).
 */
export const DEFAULT_CELL_HEAT_CAPACITY_J_PER_K = 1e5;

/**
 * Build a thermal substance configuration.
 *
 * `sources` is the per-cell heat-injection map (watts); `radiators` is the set
 * of cells venting radiatively; `heatCapacity` maps each cell to its heat
 * capacity in J/K. All three are captured by closure so the returned
 * `TransportSubstance` reflects the live ship state when the integrator reads
 * it. The source and radiative boundary flux are both watt quantities divided by
 * the cell's heat capacity to give the kelvin-per-second rate the temperature
 * field integrates.
 */
export function makeThermalSubstance(
  sources: ThermalSourceMap,
  radiators: RadiatorMask,
  heatCapacity: HeatCapacityMap,
): TransportSubstance {
  const capacityOf = (cell: number): number => {
    const c = heatCapacity.get(cell);
    return c !== undefined && c > 0 ? c : DEFAULT_CELL_HEAT_CAPACITY_J_PER_K;
  };
  return {
    name: "thermal",
    coefficient: HULL_THERMAL_DIFFUSIVITY_M2_PER_S,
    // No advection: a solid hull does not flow.
    // Temperature floor: a ship in space cannot cool below the cosmic microwave
    // background. The Stefan-Boltzmann `T⁴ − T_space⁴` boundary flux already
    // drives net outflux to zero at T = T_space, but the explicit integrator
    // only applies positive (outflow) fluxes, so cells would undershoot without
    // this floor. Clamping here enforces the physical invariant.
    nonNegative: true,
    floor: SPACE_TEMPERATURE_K,
    // Source is a heat power (W); divide by the cell's heat capacity (J/K) to
    // get the temperature rate (K/s) the field integrates: dT/dt = P / C.
    source: (cell) => {
      const watts = sources.get(cell) ?? 0;
      return watts === 0 ? 0 : watts / capacityOf(cell);
    },
    boundaryFlux: (cell, phi, out) => {
      out.cell = cell;
      out.momentumX = 0;
      out.momentumY = 0;
      if (!radiators.has(cell)) {
        out.scalarFlux = 0;
        return;
      }
      const t = phi[cell] ?? SPACE_TEMPERATURE_K;
      // Net radiated power: ε·σ·A·(T⁴ − T_space⁴), watts. Positive ⇒ heat leaves
      // the cell. Divided by the cell's heat capacity to express the outflux as
      // a temperature rate (K/s), matching the temperature field. Photons carry
      // negligible momentum at ship scale (radiation pressure σT⁴/c is ~µN·m⁻²
      // at 300 K), so the reaction force is zero — thermal radiation does not
      // recoil the hull.
      const radiatedWatts =
        RADIATOR_EMISSIVITY *
        STEFAN_BOLTZMANN_W_PER_M2_K4 *
        RADIATOR_AREA_PER_CELL_M2 *
        (t * t * t * t - SPACE_TEMPERATURE_K ** 4);
      out.scalarFlux = radiatedWatts / capacityOf(cell);
    },
  };
}

/**
 * Estimate the steady-state temperature a single radiator cell reaches
 * shedding `power` watts, by inverting `P = ε·σ·A·T⁴`:
 *
 *     T = (P / (ε·σ·A))^(1/4)
 *
 * `A` is the effective radiating area {@link RADIATOR_AREA_PER_CELL_M2}, which
 * includes the deployed-fin amplification, so this returns the temperature the
 * real (finned) radiator settles at — heat-capacity-independent, exactly as the
 * radiative balance is. Tests use this as the survival anchor: a reactor cell
 * shedding its waste heat should settle below the overheat threshold.
 */
export function radiatorEquilibriumTemperature(powerWatts: number): number {
  const denom =
    RADIATOR_EMISSIVITY *
    STEFAN_BOLTZMANN_W_PER_M2_K4 *
    RADIATOR_AREA_PER_CELL_M2;
  return Math.pow(powerWatts / denom, 1 / 4);
}
