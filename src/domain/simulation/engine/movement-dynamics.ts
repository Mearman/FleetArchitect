/**
 * Fused per-module scan for the four movement capabilities the modular-ship
 * movement step needs that are INDEPENDENT of the commanded turn sign and the
 * lateral damper command: maximum commandable torque (attitude authority), the
 * uncommandable geometric disturbance torque, the lateral (RCS translation)
 * thrust budget, and the afterburner thrust/turn multipliers (with their firing
 * side effects).
 *
 * Each is a pure reduction over `ship.modules` in array order, so fusing the
 * four into one pass — each in its own running accumulator — leaves every value
 * byte-identical to the four separate scans it replaces (`maxCommandableTorque`,
 * `geometricTorque`, the `.lateral` half of `availableThrust`,
 * `afterburnerMultipliers`). The engine force vector `(-cos·t, -sin·t)` is
 * computed once per engine and reused across the lateral, geometric, and gimbal
 * terms (all three originals compute the same vector). The bang-bang turn
 * controller then takes the pre-computed `geoTorque` via `bangBangTurnSign`, so
 * the redundant `geometricTorque` scan inside `commandedTurn` is avoided too.
 *
 * Afterburner firing mutates `m.techActive`/`m.techCooldown` with the same
 * set-then-read-in-one-iteration discipline and module-array order as
 * `afterburnerMultipliers`, so the post-call tech state is identical.
 *
 * The per-module force/torque application (`shipForceAndTorque`,
 * `lateralForceAndTorque`) is NOT fused here — those depend on the turn sign and
 * lateral command derived from these capabilities, so they stay as separate
 * calls in `moveShips`.
 */

import { isOperational } from "./crew";
import { gimbalTorque } from "./physics";
import type { SimShip } from "./types";

export interface MovementInputs {
  /** Maximum commandable torque magnitude (gimbal authority + RCS + wheels). */
  mct: number;
  /** Uncommandable geometric r × F disturbance torque (engines firing). */
  geoTorque: number;
  /** Symmetric lateral (RCS translation) thrust budget: min(plus, minus). */
  latBudget: number;
  /** Afterburner thrust/turn multipliers (1, 1 when none active). */
  boost: { thrust: number; turn: number };
}

/**
 * The four movement capabilities in one module pass. Assumes `ship.modules` is
 * defined — the modular branch of `moveShips` gates on that; legacy (scalar)
 * ships take a different path and never call this.
 */
export function computeMovementInputs(ship: SimShip, shouldThrust: boolean): MovementInputs {
  const modules = ship.modules;
  if (modules === undefined) {
    // Unreachable for the modular-only caller; kept only to narrow the type.
    return { mct: 0, geoTorque: 0, latBudget: 0, boost: { thrust: 1, turn: 1 } };
  }
  const comX = ship.comX;
  const comY = ship.comY;
  let mct = 0;
  let geoTorque = 0;
  let latPlus = 0;
  let latMinus = 0;
  let boostThrust = 1;
  let boostTurn = 1;

  for (const m of modules) {
    // All four originals gate on the same operational predicate (alive, powered,
    // not grid-shed, manned, charged), so a non-operational module contributes
    // to none of them.
    if (!isOperational(m)) continue;
    const effect = m.effect;

    if (effect.kind === "engine" && !m.fuelStarved) {
      const t = effect.thrust;
      if (t > 0) {
        // Engine force on the ship is opposite its exhaust direction — computed
        // once and shared by the lateral budget, the geometric torque, and the
        // gimbal authority, exactly as each original computes it.
        const lx = -Math.cos(m.facing) * t;
        const ly = -Math.sin(m.facing) * t;

        // Lateral budget (availableThrust, no `shouldThrust` gate): an engine is
        // lateral when its force is more ±y than ±x.
        if (Math.abs(ly) > Math.abs(lx)) {
          if (ly > 0) latPlus += ly;
          else latMinus += -ly;
        }

        // Geometric disturbance torque + gimbal authority — both gated on the
        // ship actually thrusting this tick.
        if (shouldThrust) {
          const rx = m.x - comX;
          const ry = m.y - comY;
          const nominalTorque = rx * ly - ry * lx;
          geoTorque += nominalTorque;

          const gimbalArc = effect.gimbalArc ?? 0;
          if (gimbalArc > 0) {
            const thrustDir = m.facing + Math.PI;
            const ccw = gimbalTorque(rx, ry, t, thrustDir, gimbalArc);
            const cw = gimbalTorque(rx, ry, t, thrustDir, -gimbalArc);
            const extraCcw = ccw - nominalTorque;
            const extraCw = cw - nominalTorque;
            mct += Math.max(0, extraCcw, -extraCw);
          }
        }
      }
    } else if (effect.kind === "rcs" || effect.kind === "reactionWheel") {
      // Pure commandable torque, either sign, available regardless of thrust.
      mct += effect.torque;
    } else if (effect.kind === "afterburner") {
      // Fire a ready module when the ship has movement intent, then fold its
      // boost into the running product. Set-then-read in one iteration matches
      // afterburnerMultipliers exactly (a just-fired module boosts this tick).
      if (m.techActive <= 0 && shouldThrust && m.techCooldown === 0) {
        m.techActive = effect.duration;
        m.techCooldown = effect.cooldown;
      }
      if (m.techActive > 0) {
        boostThrust *= effect.thrustBoost;
        boostTurn *= effect.turnBoost;
      }
    }
  }

  return {
    mct,
    geoTorque,
    latBudget: Math.min(latPlus, latMinus),
    boost: { thrust: boostThrust, turn: boostTurn },
  };
}
