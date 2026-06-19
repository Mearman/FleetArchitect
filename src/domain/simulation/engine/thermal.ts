/**
 * Thermal + radiator physics (Phase 12, resource & environment simulation).
 *
 * Honestly simulated, gameplay *use* deferred. Each ship carries a thermal
 * state (temperature in Kelvin, joules of stored heat) advanced by a pure
 * function from the heat sources (reactor, weapons, engines — expressed as
 * joules per tick) and the radiator area rejecting energy via the
 * Stefan-Boltzmann law.
 *
 * Physics
 * -------
 * Radiated power (W, i.e. J/s) from a black-body of area A at temperature T:
 *
 *     P_rad = sigma * T^4 * A
 *
 * where `sigma` is the Stefan-Boltzmann constant
 * (5.670374419e-8 W m^-2 K^-4, CODATA 2018 exact-by-definition value).
 *
 * A real radiator is not a perfect black body; its effectiveness is the
 * product of area and emissivity (0 < epsilon <= 1). The effective radiating
 * power is `sigma * T^4 * A * epsilon`. We model an effective area
 * `A_eff = A * epsilon` so callers express radiator capacity in one
 * physical quantity (square metres of equivalent black-body surface).
 *
 * Heat capacity `C` (J/K) links stored energy to temperature: `E = C * T`.
 * The net power into the body is
 *
 *     P_net = P_in - P_rad
 *
 * and per tick of duration `dt` (seconds) the temperature change is
 *
 *     dT = P_net * dt / C
 *
 * which we integrate with an explicit Euler step. Equilibrium is reached
 * when P_in == P_rad, giving the analytic temperature
 *
 *     T_eq = (P_in / (sigma * A_eff))^(1/4)
 *
 * which is the value the integrator asymptotically approaches and which the
 * unit test asserts.
 *
 * Determinism: the step is a pure function of its inputs (no RNG, no global
 * state), so two same-input runs produce byte-identical sequences.
 *
 * Use-deferred: nothing here enforces overheat shutdown, damage, or any
 * gameplay effect. The tick loop does not call this yet; it exposes honest
 * physics for later wiring.
 */

import { TICKS_PER_SECOND } from "@/domain/simulation/types";

/** Stefan-Boltzmann constant, sigma (W m^-2 K^-4).
 *  CODATA 2018 exact-by-definition value; the SI base-unit definition of the
 *  kelvin fixes h, c, and k_B, from which sigma is derived exactly as
 *  `(2 pi^5 k_B^4) / (15 h^3 c^2)`. */
export const STEFAN_BOLTZMANN_CONSTANT = 5.670374419e-8;

/** Duration of one simulation tick in seconds. Derived from the engine's
 *  authored tick rate (`TICKS_PER_SECOND`), not a hand-tuned literal. */
export const SECONDS_PER_TICK = 1 / TICKS_PER_SECOND;

/** Thermal state of a single body (a ship), snapshotted per tick.
 *  - `temperatureK`: absolute temperature in Kelvin (E = C * T, so this is
 *    the observable thermal state).
 *  - `energyJ`: stored thermal energy in joules (kept in lockstep with
 *    temperature via the heat capacity; exposed for snapshot/audit). */
export interface ThermalState {
  temperatureK: number;
  energyJ: number;
}

/** A heat source contributing joules per tick into the body.
 *  Each source is identified by its physical origin so the caller can
 *  attribute heat to reactor, weapons, engines, etc. */
export interface HeatSource {
  /** Physical origin of the heat (free-form label, e.g. "reactor",
   *  "weapons", "engines"). Used for attribution/snapshot only; not
   *  consulted by the integrator. */
  origin: string;
  /** Heat injected per tick, in joules (energy, not power: this is the
   *  integral of source power over one tick). */
  joulesPerTick: number;
}

/** Inputs to one thermal integration step.
 *  - `sources`: heat inputs for this tick (joules each).
 *  - `radiatorAreaM2`: effective black-body radiating area in square metres
 *    (already folded with emissivity: A_eff = A_physical * epsilon).
 *  - `heatCapacityJPerK`: body heat capacity C in joules per kelvin
 *    (C = m * c_specific; the caller derives it from mass and the
 *    material's specific heat capacity, both physical anchors). */
export interface ThermalStepInputs {
  sources: readonly HeatSource[];
  radiatorAreaM2: number;
  heatCapacityJPerK: number;
}

/** Sum the per-tick heat input (joules) across all sources. Pure. */
export function totalHeatInputJoules(
  sources: readonly HeatSource[],
): number {
  let sum = 0;
  for (const source of sources) {
    sum += source.joulesPerTick;
  }
  return sum;
}

/** Radiated power (watts = joules/second) for a body at temperature T with
 *  effective radiating area A_eff. Pure. Returns zero for T <= 0 (a body
 *  at or below absolute zero radiates nothing; physically T >= 0 always). */
export function radiatedPowerWatts(
  temperatureK: number,
  radiatorAreaM2: number,
): number {
  if (temperatureK <= 0) return 0;
  return STEFAN_BOLTZMANN_CONSTANT * temperatureK ** 4 * radiatorAreaM2;
}

/** Equilibrium temperature (Kelvin) where heat input balances radiation.
 *
 *  Solves `P_in == sigma * T^4 * A_eff` for T, where `P_in` is the
 *  continuous power (watts) corresponding to the per-tick heat input:
 *  `P_in = joulesPerTick / SECONDS_PER_TICK`.
 *
 *  With no heat input and positive area the body radiates to absolute zero;
 *  the formula returns 0 K in that case (the 1/4 power of zero). */
export function equilibriumTemperatureK(
  heatInputJoulesPerTick: number,
  radiatorAreaM2: number,
): number {
  if (radiatorAreaM2 <= 0) return Number.POSITIVE_INFINITY;
  const powerW = heatInputJoulesPerTick / SECONDS_PER_TICK;
  if (powerW <= 0) return 0;
  return Math.pow(powerW / (STEFAN_BOLTZMANN_CONSTANT * radiatorAreaM2), 0.25);
}

/** Advance the thermal state by one tick.
 *
 *  Explicit Euler integration of `C * dT/dt = P_in - sigma * T^4 * A_eff`,
 *  where `P_in = totalHeatInputJoules / SECONDS_PER_TICK` (converting the
 *  per-tick energy into a continuous power for the ODE). The step is
 *  clamped so temperature can never go negative: if radiative cooling
 *  would carry the body below 0 K (only possible when P_in is zero and
 *  the step overshoots), it rests at 0 K instead — the physically correct
 *  floor.
 *
 *  Pure: the returned state is a fresh object; the input is not mutated. */
export function stepThermal(
  state: ThermalState,
  inputs: ThermalStepInputs,
): ThermalState {
  const heatInJ = totalHeatInputJoules(inputs.sources);
  const powerInW = heatInJ / SECONDS_PER_TICK;
  const powerOutW = radiatedPowerWatts(state.temperatureK, inputs.radiatorAreaM2);
  const netPowerW = powerInW - powerOutW;
  const dT = (netPowerW * SECONDS_PER_TICK) / inputs.heatCapacityJPerK;
  const nextTemperatureK = Math.max(0, state.temperatureK + dT);
  const nextEnergyJ = nextTemperatureK * inputs.heatCapacityJPerK;
  return { temperatureK: nextTemperatureK, energyJ: nextEnergyJ };
}

/** Construct an initial thermal state at a given temperature (Kelvin).
 *  Useful for fixtures and for seeding a ship at ambient temperature. */
export function thermalStateAt(
  temperatureK: number,
  heatCapacityJPerK: number,
): ThermalState {
  return { temperatureK, energyJ: temperatureK * heatCapacityJPerK };
}
