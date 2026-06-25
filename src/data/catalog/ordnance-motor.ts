/**
 * Finite-burn motor derivation for powered guided ordnance (missiles,
 * torpedoes). Extracted from `combat-scale.ts` to keep that module under the
 * 800-line lint cap.
 *
 * A missile or torpedo spawns SLOWER than its cruise velocity (a realistic
 * slow launch) and accelerates under thrust to reach ≈ cruise at burnout, then
 * coasts ballistically. The total impulse the motor spends is the velocity gap
 * from the spawn speed to cruise, NOT the round's delta-v reach budget (which
 * sets `range` independently via `ordnanceRangeM`). Deriving the motor thrust
 * from the spawn→cruise gap over the burn time keeps the speed magnitude
 * continuous and the effective range roughly preserved — the round cruises at
 * its authored cruise for the bulk of its flight, so battles still resolve at
 * the same engagement ranges.
 */

import { TICKS_PER_SECOND } from "@/domain/simulation/types";

/**
 * Fraction of its cruise velocity at which a powered guided round spawns. A
 * realistic slow launch: the motor brings the round up to cruise over its burn.
 * 0.4 sits in the 0.3–0.5 band (a missile leaves the rail at less than half
 * speed and sprints to cruise). Shared by the catalogue (to derive `thrust`)
 * and the engine (`spawnProjectile`, to set the spawn velocity), so the two
 * stay in lockstep.
 */
export const POWERED_SPAWN_FRACTION_OF_CRUISE = 0.4;

/**
 * Motor thrust (SI m·s⁻²) for a powered guided round, DERIVED as the velocity
 * gap from spawn to cruise divided by the burn time:
 *   `thrust = (1 − POWERED_SPAWN_FRACTION_OF_CRUISE) × cruiseMs / burnSeconds`.
 *
 * The motor spends its whole propellant budget closing the spawn→cruise gap, so
 * over `burnSeconds` the mean acceleration is exactly that gap divided by the
 * time. THE single derivation a missile/torpedo `thrust` field is authored
 * from — no hand-picked literal. For a Terran missile (cruise 2000 m/s, 40 s
 * burn) this is `0.6 × 2000 / 40 = 30 m/s²`.
 */
export function poweredMotorThrustMPerS2(
  cruiseMs: number,
  burnSeconds: number,
): number {
  return ((1 - POWERED_SPAWN_FRACTION_OF_CRUISE) * cruiseMs) / burnSeconds;
}

/**
 * Rated motor fuel duration (ticks) for a powered guided round, DERIVED as
 * `burnSeconds × TICKS_PER_SECOND`. THE single derivation a missile/torpedo
 * `burnTicks` field is authored from. For a Terran missile (40 s burn) this is
 * `40 × 30 = 1200` ticks.
 */
export function poweredMotorBurnTicks(burnSeconds: number): number {
  return Math.round(burnSeconds * TICKS_PER_SECOND);
}
