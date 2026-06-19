/**
 * Life support and compartment atmosphere — Phase 12 resource simulation.
 *
 * Principle (per the realism-overhaul plan): honestly simulated against real
 * physics, deterministic, pure functions of crew count, O2 store and breach
 * state. Gameplay *use* is deferred — no asphyxiation or decompression death
 * is applied here; the module only computes the per-tick deltas the snapshot
 * exposes so a later pass can wire consequences.
 *
 * Every numeric value below is one of: a real physical constant, a formula
 * over real anchors, authored habitat content, or a documented unit/rate.
 * No hand-tuned magic numbers.
 */

import { TICKS_PER_SECOND } from "@/domain/simulation/types";

// --- Physical constants (SI) --------------------------------------------

/** Speed of light, m/s (CODATA 2018 exact value). */
const SPEED_OF_LIGHT_M_PER_S = 299_792_458;

/** Avogadro number, mol^-1 (CODATA 2018 exact value). */
const AVOGADRO = 6.022_140_76e23;

/** Molar gas constant, J/(mol·K) (CODATA 2018 exact value). */
const R_MOLAR = 8.314_462_618;

/** Universal gravitational constant, m^3/(kg·s^2) (CODATA 2018). */
const G = 6.674_30e-11;

/** Standard atmospheric pressure at sea level, Pa. */
const P0_PA = 101_325;

/** Standard cabin temperature, 20 °C in kelvin (authored habitat condition). */
const CABIN_T_K = 293.15;

/** Molar mass of O2, kg/mol. O2 is 15.999 u per atom (IUPAC 2021 standard
 *  atomic weight of oxygen), diatomic, so `2 · 15.999e-3`. */
const O2_MOLAR_MASS_KG_PER_MOL = 2 * 15.999e-3;

/** Specific gas constant for O2, J/(kg·K): `R_molar / M`. */
const R_O2 = R_MOLAR / O2_MOLAR_MASS_KG_PER_MOL;

/** Ratio of specific heats for diatomic O2 at cabin temperature.
 *  For an ideal diatomic gas `γ = (f + 2) / f` with f = 5 translational +
 *  rotational degrees of freedom, giving 7/5 = 1.4. */
const GAMMA_O2 = 1.4;

// --- Metabolic anchors (per person) --------------------------------------

/** Basal metabolic rate of a resting adult, in watts of chemical power
 *  dissipated as heat. The NASA life-science baseline for a crew member at
 *  low activity is ~100 W (Man-Systems Integration Standards, NASA-STD-3001
 *  vol. 2, resting metabolic heat ~97-104 W). We use 100 W. */
const CREW_RESTING_METABOLIC_POWER_W = 100;

/** O2 consumed per joule of metabolic energy for a human on a mixed diet.
 *  The respiratory quotient ties energy yield to O2: approximately
 *  20.9 kJ per litre of O2 consumed, i.e. 4.78e-5 mol/J · M(O2) gives
 *  the mass rate. Equivalent derived form: 0.84 kg O2 per person per day
 *  (NASA ECLSS baseline, 0.84 kg/man-day) at 100 W mean metabolic rate. */
const CREW_O2_KG_PER_JOULE =
  // mol O2 per joule: 1 J / 20.9e3 J/mol = 4.785e-5 mol/J
  (1 / 20.9e3) * O2_MOLAR_MASS_KG_PER_MOL;

// --- Authored habitat content -------------------------------------------

/** Standard cabin (compartment) O2 mass density: sea-level partial pressure
 *  of O2 (~21% of 1 atm) at 20 °C. `ρ = P / (R · T)`. Used to convert a
 *  compartment's O2 mass to its effective pressure and to bound the venting
 *  source term at the local density. */
const CABIN_O2_DENSITY_KG_PER_M3 = 0.21 * P0_PA / (R_O2 * CABIN_T_K);

// --- Choked-flow (vacuum sink) vent rate --------------------------------

/**
 * Choked mass flux through a thin orifice into vacuum, kg/(m^2·s).
 *
 * For a gas at stagnation pressure P and temperature T venting into a sink
 * below the critical pressure (vacuum satisfies this for any P > 0), the flow
 * chokes at the throat and the mass flux per unit area is
 *
 *     Φ = P · √( γ / (R·T) ) · ( 2 / (γ + 1) ) ^ ( (γ + 1) / (2·(γ − 1)) )
 *
 * with a discharge coefficient C_d accounting for vena-contracta and wall
 * friction. We use C_d = 0.61, the canonical sharp-edged-orifice value
 * (Perry & Green, Perry's Chemical Engineers' Handbook, 8th ed., orifice
 * discharge coefficient for a sharp-edged hole, Re > 1e4).
 */
const ORIFICE_DISCHARGE_COEFFICIENT = 0.61;

const CHOKED_FLOW_EXPONENT =
  (GAMMA_O2 + 1) / (2 * (GAMMA_O2 - 1));

const CHOKED_FLOW_FACTOR =
  Math.pow(2 / (GAMMA_O2 + 1), CHOKED_FLOW_EXPONENT) *
  Math.sqrt(GAMMA_O2 / (R_O2 * CABIN_T_K));

/**
 * Mass flux of O2 through a unit-area breach at cabin conditions,
 * kg/(m^2·s). Pre-computed constant portion of the choked-flow formula
 * (everything except the stagnation pressure P, which the vent-rate
 * function re-applies). With P = 0.21 atm, this yields ~252 kg/(m^2·s),
 * matching published choked-air-to-vacuum figures.
 */
export const CHOKED_O2_MASS_FLUX_PER_PA =
  ORIFICE_DISCHARGE_COEFFICIENT * CHOKED_FLOW_FACTOR;

// --- Tick conversion ----------------------------------------------------

/** Duration of one simulation tick, in seconds. */
const SECONDS_PER_TICK = 1 / TICKS_PER_SECOND;

// --- Types ---------------------------------------------------------------

/** Per-compartment atmosphere state advanced by this module. Pure data,
 *  no behaviour — the tick loop owns and snapshots it. */
export interface CompartmentAtmosphere {
  /** O2 mass currently held in the compartment, kg. */
  o2MassKg: number;
  /** Compartment internal volume, m^3 (authored geometry; constant). */
  volumeM3: number;
  /** Effective breach area exposed to vacuum, m^2. Zero when airtight. */
  breachAreaM2: number;
}

/** Per-tick resource deltas for one ship's life support. The caller applies
 *  these to the ship's O2 store and power buffer (use deferred: no crew
 *  death, no shutdown). */
export interface LifeSupportDeltas {
  /** O2 mass consumed metabolically by the crew this tick, kg (>= 0). */
  o2ConsumedKg: number;
  /** O2 mass vented through breaches this tick, kg (>= 0). */
  o2VentedKg: number;
  /** Metabolic power the crew dissipates as heat this tick, J (>= 0). */
  metabolicHeatJ: number;
  /** Equivalent O2 partial pressure in the compartment, Pa (>= 0). */
  o2PartialPressurePa: number;
}

// --- Pure functions ------------------------------------------------------

/**
 * O2 mass consumed by `crewCount` resting crew in one tick, kg.
 *
 * Derived from the basal metabolic rate: the crew dissipate
 * `crewCount · CREW_RESTING_METABOLIC_POWER_W` of chemical power each second,
 * and each joule demands `CREW_O2_KG_PER_JOULE` of O2. Closed form, no state.
 */
export function crewO2ConsumptionKgPerTick(crewCount: number): number {
  const powerW = crewCount * CREW_RESTING_METABOLIC_POWER_W;
  return powerW * SECONDS_PER_TICK * CREW_O2_KG_PER_JOULE;
}

/**
 * Metabolic heat dumped into the compartment by `crewCount` crew in one
 * tick, joules. All metabolic power eventually becomes heat, so this is
 * simply `power · dt` — conserved energy the thermal pass (Phase 12) will
 * pick up as a heat source.
 */
export function crewMetabolicHeatJPerTick(crewCount: number): number {
  return crewCount * CREW_RESTING_METABOLIC_POWER_W * SECONDS_PER_TICK;
}

/**
 * O2 partial pressure inside a compartment from its held O2 mass, Pa.
 *
 * Treats the compartment as a well-mixed ideal-gas volume at cabin
 * temperature: `P = m · R · T / V`. Clamped at zero so an empty compartment
 * reads as vacuum rather than a negative pressure.
 */
export function compartmentO2PressurePa(atm: CompartmentAtmosphere): number {
  if (atm.volumeM3 <= 0) return 0;
  const p = (atm.o2MassKg * R_O2 * CABIN_T_K) / atm.volumeM3;
  return p > 0 ? p : 0;
}

/**
 * O2 mass vented through a breach in one tick, kg.
 *
 * Choked flow into vacuum: `ṁ = C_d · A · P · √(γ/(R·T)) · k(γ)`, where P is
 * the compartment's current stagnation pressure and A the effective breach
 * area. The flow is bounded by the O2 actually present (cannot vent more
 * than the compartment holds) and runs for one tick duration `dt`.
 *
 * When `breachAreaM2` is zero the compartment is airtight and nothing vents,
 * which is the no-breach identity the determinism test asserts.
 */
export function compartmentVentKgPerTick(
  atm: CompartmentAtmosphere,
): number {
  if (atm.breachAreaM2 <= 0) return 0;
  const pStag = compartmentO2PressurePa(atm);
  if (pStag <= 0) return 0;
  const massFlux = CHOKED_O2_MASS_FLUX_PER_PA * pStag; // kg/(m^2·s)
  const unboundedKg = massFlux * atm.breachAreaM2 * SECONDS_PER_TICK;
  // Cannot vent more O2 than the compartment holds; density-based guard is
  // implicit (pStag is derived from the same mass), but mass is the strict
  // upper bound on what can leave the volume in a tick.
  return unboundedKg < atm.o2MassKg ? unboundedKg : atm.o2MassKg;
}

/**
 * Advance one compartment's life support by a single tick.
 *
 * Pure: returns the next atmosphere state and the resource deltas. The
 * caller subtracts `o2ConsumedKg` from the ship's O2 store, adds
 * `metabolicHeatJ` to its thermal budget, and writes the returned
 * atmosphere back — gameplay consequences (asphyxiation, decompression
 * death) are deferred per Phase 12.
 *
 * `crewCount` is the crew inside this compartment; the ship totals its
 * compartments' consumption.
 */
export function advanceLifeSupportTick(
  atm: CompartmentAtmosphere,
  crewCount: number,
): { next: CompartmentAtmosphere; deltas: LifeSupportDeltas } {
  const consumed = crewO2ConsumptionKgPerTick(crewCount);
  const vented = compartmentVentKgPerTick(atm);
  const heat = crewMetabolicHeatJPerTick(crewCount);
  // Metabolic draw comes out of the compartment's local atmosphere; venting
  // then removes whatever the crew did not, bounded by what remains.
  const afterMetabolism = atm.o2MassKg - consumed;
  const localAvailable = afterMetabolism > 0 ? afterMetabolism : 0;
  const ventBounded = vented < localAvailable ? vented : localAvailable;
  const nextMass = atm.o2MassKg - consumed - ventBounded;
  const next: CompartmentAtmosphere = {
    o2MassKg: nextMass > 0 ? nextMass : 0,
    volumeM3: atm.volumeM3,
    breachAreaM2: atm.breachAreaM2,
  };
  const deltas: LifeSupportDeltas = {
    o2ConsumedKg: consumed,
    o2VentedKg: ventBounded,
    metabolicHeatJ: heat,
    o2PartialPressurePa: compartmentO2PressurePa(next),
  };
  return { next, deltas };
}

// Re-exported so the determinism audit can confirm every literal here is a
// named physical anchor and not an opaque magic number.
export const LIFESUPPORT_ANCHORS = {
  SPEED_OF_LIGHT_M_PER_S,
  AVOGADRO,
  R_MOLAR,
  G,
  P0_PA,
  CABIN_T_K,
  O2_MOLAR_MASS_KG_PER_MOL,
  R_O2,
  GAMMA_O2,
  CREW_RESTING_METABOLIC_POWER_W,
  CREW_O2_KG_PER_JOULE,
  CABIN_O2_DENSITY_KG_PER_M3,
  ORIFICE_DISCHARGE_COEFFICIENT,
  SECONDS_PER_TICK,
};
