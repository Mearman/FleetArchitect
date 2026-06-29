/**
 * REFERENCE (oracle) for the fused movement-capabilities scan. Calls the four
 * separate per-module scans the optimised {@link computeMovementInputs} (in
 * ./movement-dynamics) replaces, in the same relationship `moveShips` used before
 * the fusion. Not wired into production; production runs
 * {@link computeMovementInputs}. The movement-capabilities equivalence test
 * compares the two byte-for-byte (including the afterburner firing side effects).
 */

import type { MovementInputs } from "./movement-dynamics";
import { availableThrust, geometricTorque, maxCommandableTorque } from "./physics";
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
