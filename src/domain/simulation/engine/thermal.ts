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
 * Use-deferred: temperature is honestly simulated but does not yet shut
 * modules down. The IR emission it implies feeds the Phase 9 awareness model
 * later.
 */

import {
  STEFAN_BOLTZMANN_W_PER_M2_K4,
  TRANSPORT_GEOMETRY,
  type BoundaryFlux,
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
 * Effective radiating area per cell of radiator panel, m². A radiator cell
 * exposes both faces of its 1 m edge to space, so the effective radiating
 * area per cell is twice the face area. Real radiators fold finned surfaces
 * into this effective figure.
 */
const RADIATOR_AREA_PER_CELL_M2 = 2 * TRANSPORT_GEOMETRY.faceAreaM2;

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
 * Build a thermal substance configuration.
 *
 * `sources` is the per-cell heat-injection map (watts); `radiators` is the
 * set of cells venting radiatively. Both are captured by closure so the
 * returned `TransportSubstance` reflects the live ship state when the
 * integrator reads it.
 */
export function makeThermalSubstance(
  sources: ThermalSourceMap,
  radiators: RadiatorMask,
): TransportSubstance {
  return {
    name: "thermal",
    coefficient: HULL_THERMAL_DIFFUSIVITY_M2_PER_S,
    // No advection: a solid hull does not flow.
    source: (cell) => sources.get(cell) ?? 0,
    boundaryFlux: (cell, phi): BoundaryFlux => {
      if (!radiators.has(cell)) {
        return { cell, scalarFlux: 0, momentumX: 0, momentumY: 0 };
      }
      const t = phi[cell] ?? SPACE_TEMPERATURE_K;
      // Net radiated power: ε·σ·A·(T⁴ − T_space⁴). Positive ⇒ heat leaves
      // the cell, so scalarFlux is positive. Photons carry negligible
      // momentum at ship scale (radiation pressure σT⁴/c is ~µN·m⁻² at
      // 300 K), so the reaction force is zero — thermal radiation does not
      // recoil the hull.
      const radiated =
        RADIATOR_EMISSIVITY *
        STEFAN_BOLTZMANN_W_PER_M2_K4 *
        RADIATOR_AREA_PER_CELL_M2 *
        (t * t * t * t - SPACE_TEMPERATURE_K ** 4);
      return { cell, scalarFlux: radiated, momentumX: 0, momentumY: 0 };
    },
  };
}

/**
 * Estimate the steady-state temperature a single radiator cell reaches
 * shedding `power` watts, by inverting `P = ε·σ·A·T⁴`:
 *
 *     T = (P / (ε·σ·A))^(1/4)
 *
 * Tests use this as a physics anchor: a cell dissipating a known wattage
 * should settle near this temperature.
 */
export function radiatorEquilibriumTemperature(powerWatts: number): number {
  const denom =
    RADIATOR_EMISSIVITY *
    STEFAN_BOLTZMANN_W_PER_M2_K4 *
    RADIATOR_AREA_PER_CELL_M2;
  return Math.pow(powerWatts / denom, 1 / 4);
}
