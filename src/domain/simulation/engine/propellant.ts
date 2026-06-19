/**
 * Propellant and delta-v — the rocket-equation layer.
 *
 * Phase 12 "underlying resource simulation (use deferred)": reaction mass is
 * burned honestly by thrust and specific impulse, dry mass falls as propellant
 * is consumed, and the Tsiolkovsky rocket equation gives the achievable delta-v.
 * The values are computed and exposed; gameplay *use* (dry-tank → derelict,
 * fuel UI, integrator mass feedback) is intentionally deferred to a later pass.
 *
 * Every numeric value here is one of: a real physical constant, a formula over
 * such constants, or an explicit authored input (thrust, Isp, propellant mass,
 * burn duration). No hand-tuned literals.
 *
 * Pure functions only — no module-level mutable state, no I/O. Deterministic:
 * identical inputs yield identical outputs (the only transcendental is `ln`,
 * which IEEE-754 fixes across runs).
 */

/** Standard gravitational acceleration, the exact defined SI value (m/s²).
 *  This is the `g0` that appears in the thrust / specific-impulse relation
 *  `ṁ = F / (Isp · g0)` and in Tsiolkovsky's `Δv = Isp · g0 · ln(m0/mf)`.
 *  Source: CGPM 1901, defined value, exact. */
export const STANDARD_GRAVITY_M_PER_S2 = 9.80665;

/** A propellant state: the live reaction-mass budget of one ship.
 *  `propellantMass` is the remaining reaction mass (kg); `dryMass` is the
 *  mass of the ship with empty tanks (kg). Total (wet) mass is their sum. */
export interface PropellantState {
  /** Reaction mass remaining in the tanks (kg). Non-negative. */
  propellantMass: number;
  /** Ship mass with tanks empty (kg). Positive. */
  dryMass: number;
}

/** Wet (total) mass of a propellant state: dry mass plus remaining propellant.
 *  This is the `m` that feeds the momentum integrator (Phase 3). */
export function wetMass(state: PropellantState): number {
  return state.dryMass + state.propellantMass;
}

/** Propellant mass-flow rate (kg/s) for a given thrust and specific impulse.
 *
 *  Derived from the definition of specific impulse as thrust per unit
 *  weight-flow of reaction mass: `Isp = F / (ṁ · g0)`, rearranged to
 *  `ṁ = F / (Isp · g0)`. A higher Isp means less mass consumed per newton of
 *  thrust, which is the whole point of efficient engines.
 *
 *  `thrustN` is the engine's thrust in newtons; `specificImpulseS` is the
 *  specific impulse in seconds. Both must be positive.
 *
 *  Throws on non-positive thrust or specific impulse: an engine that produces
 *  no thrust or has zero/negative Isp cannot burn propellant, and a zero Isp
 *  would divide by zero — these are invalid authored inputs, surfaced loudly. */
export function massFlowRateKgPerS(thrustN: number, specificImpulseS: number): number {
  if (thrustN <= 0) {
    throw new Error(`massFlowRateKgPerS: thrustN must be positive, got ${thrustN}`);
  }
  if (specificImpulseS <= 0) {
    throw new Error(`massFlowRateKgPerS: specificImpulseS must be positive, got ${specificImpulseS}`);
  }
  return thrustN / (specificImpulseS * STANDARD_GRAVITY_M_PER_S2);
}

/** Propellant consumed (kg) by burning at the given thrust and specific impulse
 *  for `burnDurationS` seconds. Returns the unconsumed demand; the caller is
 *  responsible for clamping to the available propellant (see {@link burn}).
 *
 *  `Δm = ṁ · Δt = F · Δt / (Isp · g0)`. */
export function propellantDemandKg(
  thrustN: number,
  specificImpulseS: number,
  burnDurationS: number,
): number {
  if (burnDurationS < 0) {
    throw new Error(`propellantDemandKg: burnDurationS must be non-negative, got ${burnDurationS}`);
  }
  return massFlowRateKgPerS(thrustN, specificImpulseS) * burnDurationS;
}

/** Burn reaction mass for `burnDurationS` seconds at the given thrust and
 *  specific impulse, returning the resulting propellant state.
 *
 *  The demanded mass is clamped to the available propellant (a tank cannot go
 *  negative); if the demand would drain the tank partway through the burn, the
 *  returned state simply has zero propellant — the deferred-use design does not
 *  model partial-thrust cutoff here. The dry mass is unchanged (only reaction
 *  mass is consumed).
 *
 *  Pure: returns a new {@link PropellantState}; the input is not mutated. */
export function burn(
  state: PropellantState,
  thrustN: number,
  specificImpulseS: number,
  burnDurationS: number,
): PropellantState {
  const demand = propellantDemandKg(thrustN, specificImpulseS, burnDurationS);
  const remaining = Math.max(0, state.propellantMass - demand);
  return { propellantMass: remaining, dryMass: state.dryMass };
}

/** Delta-v (m/s) available from burning all propellant between two masses, per
 *  the Tsiolkovsky rocket equation.
 *
 *  `Δv = Isp · g0 · ln(m0 / mf)`, where `m0` is the initial (wet) mass and
 *  `mf` is the final (dry) mass. `specificImpulseS` must be positive, `wetMass`
 *  must be greater than `dryMass` (there must be propellant to burn), and both
 *  must be positive.
 *
 *  Throws on `wetMass <= dryMass` (no propellant → no meaningful delta-v) and
 *  on non-positive inputs; these are invalid authored configurations. */
export function tsiolkovskyDeltaV(
  specificImpulseS: number,
  wetMassKg: number,
  dryMassKg: number,
): number {
  if (specificImpulseS <= 0) {
    throw new Error(`tsiolkovskyDeltaV: specificImpulseS must be positive, got ${specificImpulseS}`);
  }
  if (wetMassKg <= 0) {
    throw new Error(`tsiolkovskyDeltaV: wetMassKg must be positive, got ${wetMassKg}`);
  }
  if (dryMassKg <= 0) {
    throw new Error(`tsiolkovskyDeltaV: dryMassKg must be positive, got ${dryMassKg}`);
  }
  if (wetMassKg <= dryMassKg) {
    throw new Error(
      `tsiolkovskyDeltaV: wetMassKg (${wetMassKg}) must exceed dryMassKg (${dryMassKg})`,
    );
  }
  return specificImpulseS * STANDARD_GRAVITY_M_PER_S2 * Math.log(wetMassKg / dryMassKg);
}

/** Delta-v (m/s) available from a {@link PropellantState} at the given specific
 *  impulse — the wet mass is dry plus remaining propellant. Convenience wrapper
 *  around {@link tsiolkovskyDeltaV}. */
export function deltaVOf(state: PropellantState, specificImpulseS: number): number {
  return tsiolkovskyDeltaV(specificImpulseS, wetMass(state), state.dryMass);
}

/** The required mass ratio `m0 / mf` to achieve a target delta-v at the given
 *  specific impulse — the inverse of Tsiolkovsky.
 *
 *  `m0 / mf = exp(Δv / (Isp · g0))`. Useful for sizing tanks against a mission
 *  delta-v budget. `targetDeltaVMPerS` may be zero (ratio 1, no propellant
 *  needed); it must not be negative. */
export function massRatioForDeltaV(
  specificImpulseS: number,
  targetDeltaVMPerS: number,
): number {
  if (specificImpulseS <= 0) {
    throw new Error(`massRatioForDeltaV: specificImpulseS must be positive, got ${specificImpulseS}`);
  }
  if (targetDeltaVMPerS < 0) {
    throw new Error(
      `massRatioForDeltaV: targetDeltaVMPerS must be non-negative, got ${targetDeltaVMPerS}`,
    );
  }
  return Math.exp(targetDeltaVMPerS / (specificImpulseS * STANDARD_GRAVITY_M_PER_S2));
}
