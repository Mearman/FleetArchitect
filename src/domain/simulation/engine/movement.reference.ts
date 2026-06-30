/**
 * REFERENCE (oracle) for the fused movement-capabilities scan. Calls the four
 * separate per-module scans the optimised {@link computeMovementInputs} (in
 * ./movement-dynamics) replaces, in the same relationship `moveShips` used before
 * the fusion. Not wired into production; production runs
 * {@link computeMovementInputs}. The movement-capabilities equivalence test
 * compares the two byte-for-byte (including the afterburner firing side effects).
 */

import type { ForceAndLateral, MovementInputs } from "./movement-dynamics";
import {
  availableThrust,
  geometricTorque,
  lateralForceAndTorque,
  maxCommandableTorque,
  shipForceAndTorque,
  type ThrustMode,
} from "./physics";
import { afterburnerMultipliers } from "./tech";
import type { SimShip } from "./types";

export function computeMovementInputsReference(
  ship: SimShip,
  shouldThrust: boolean,
): MovementInputs {
  return {
    mct: maxCommandableTorque(ship, shouldThrust),
    geoTorque: geometricTorque(ship, shouldThrust),
    latBudget: availableThrust(ship).lateral,
    boost: afterburnerMultipliers(ship, shouldThrust),
  };
}

/** REFERENCE (oracle) for the fused force+lateral scan: the two separate scans
 *  (`shipForceAndTorque` + `lateralForceAndTorque`) the optimised
 *  {@link computeForceAndLateral} (in ./movement-dynamics) replaces. Not wired
 *  into production; the equivalence test compares the two byte-for-byte. */
export function computeForceAndLateralReference(
  ship: SimShip,
  turnSign: number,
  engineFire: boolean,
  thrustMode: ThrustMode,
  lateralCmd: number,
): ForceAndLateral {
  const sft = shipForceAndTorque(ship, turnSign, engineFire, thrustMode);
  const lat = lateralForceAndTorque(ship, lateralCmd);
  return {
    fx: sft.fx,
    fy: sft.fy,
    torque: sft.torque,
    latFx: lat.fx,
    latFy: lat.fy,
    latTorque: lat.torque,
  };
}
