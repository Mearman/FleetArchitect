/**
 * Per-tick ship movement: stance-derived desired range, black-hole avoidance
 * steering, retreat/closing decisions, and the integration of forces into
 * velocity and position.
 */

import type { BattleInputs } from "../types";

import { SIM } from "./config";
import { commandedTurn, maxCommandableTorque, shipForceAndTorque } from "./physics";
import { angleDifference, anomalyAdjustedRange, blackHoleAvoidWeight, rotateLocal } from "./setup";
import { afterburnerMultipliers } from "./tech";
import type { SimShip } from "./types";

export function isRetreating(ship: SimShip): boolean {
  return (
    ship.maxStructure > 0 &&
    ship.structure / ship.maxStructure < ship.orders.retreatThreshold
  );
}

/**
 * Whether a ship's combat posture this tick is offensive — closing on or
 * pressing the target rather than backing off. Drives a tactical blink drive's
 * jump direction: aggressive and balanced stances jump *toward* the target,
 * defensive and evasive stances jump *away* from the nearest enemy. A retreating
 * ship (structure below its retreat threshold) is always treated as opening the
 * range regardless of stance.
 */
export function isClosingStance(ship: SimShip): boolean {
  if (isRetreating(ship)) return false;
  return ship.orders.stance === "aggressive" || ship.orders.stance === "balanced";
}

/**
 * Centroid of every alive enemy ship from `ship`'s perspective, or undefined
 * when no enemy is alive. Pure function of positions, iterated in array order;
 * the running sum is order-independent. Used by blink drives to jump directly
 * away from the mass of the enemy fleet.
 */
export function enemyCentroid(
  ship: SimShip,
  ships: readonly SimShip[],
): { x: number; y: number } | undefined {
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const e of ships) {
    if (!e.alive || e.side === ship.side) continue;
    cx += e.x;
    cy += e.y;
    count += 1;
  }
  return count > 0 ? { x: cx / count, y: cy / count } : undefined;
}

/**
 * Each side's deployment centroid, captured once at battle start. Used by
 * advance-to-contact so a blind ship steers toward where the enemy deployed.
 * A side's reference is `undefined` only when it deployed no ships.
 */
export interface DeploymentReference {
  attacker: { x: number; y: number } | undefined;
  defender: { x: number; y: number } | undefined;
}

/**
 * Compute the centroid of all alive ships on a given side. Used by
 * formation-keeping to pull ships toward their fleet's centre of mass.
 * Returns `undefined` when no alive ships are present.
 */
export function fleetCentroid(
  ships: readonly SimShip[],
  side: "attacker" | "defender",
): { x: number; y: number } | undefined {
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const s of ships) {
    if (!s.alive || s.side !== side || s.phantom !== undefined) continue;
    cx += s.x;
    cy += s.y;
    count += 1;
  }
  return count > 0 ? { x: cx / count, y: cy / count } : undefined;
}

export function moveShips(
  ships: readonly SimShip[],
  byId: Map<string, SimShip>,
  anomaly: BattleInputs["anomaly"],
  deployment: DeploymentReference,
): void {
  // Pre-compute fleet centroids once per tick so formation-keeping blends
  // each ship's desired heading toward a stable reference point, not one
  // that shifts mid-loop as individual ships move.
  const centroidAttacker = fleetCentroid(ships, "attacker");
  const centroidDefender = fleetCentroid(ships, "defender");
  for (const ship of ships) {
    if (!ship.alive) continue;
    // Phantoms (drones/decoys) move in their own bespoke step, not here.
    if (ship.phantom !== undefined) continue;

    // Black-hole gravity: a real 1/r^2 acceleration toward the centre,
    // applied to velocity (not position) so momentum is preserved and the
    // ship's own velocity still carries it forward. The acceleration
    // is mass-independent (the equivalence principle), so heavy and
    // light ships fall the same way.
    if (anomaly === "blackHole") {
      const dist = Math.hypot(ship.x, ship.y);
      if (dist > 0) {
        // Soften the singularity at r → 0 by clamping the effective r
        // to the lethal radius, so the acceleration stays finite.
        const effectiveR = Math.max(dist, SIM.blackHoleLethalRadius);
        const accelMag = SIM.blackHoleStrength / (effectiveR * effectiveR);
        ship.velX += (-ship.x / dist) * accelMag;
        ship.velY += (-ship.y / dist) * accelMag;
        // Tidal damage outside the lethal zone: the differential pull
        // across a body scales as 1/r^3, so the closer you get, the
        // faster you get torn apart. Ships far outside the tidal zone
        // are unaffected.
        if (dist < SIM.blackHoleTidalRadius && dist >= SIM.blackHoleLethalRadius) {
          ship.structure -= SIM.blackHoleTidalDamageScale / (dist * dist * dist);
          if (ship.structure <= 0) {
            ship.structure = 0;
            ship.alive = false;
          }
        }
      }
      // Lethal zone: the event horizon. Instant tidal destruction.
      if (dist < SIM.blackHoleLethalRadius) {
        ship.structure -= SIM.blackHoleLethalDamage;
        if (ship.structure <= 0) {
          ship.structure = 0;
          ship.alive = false;
        }
      }
    }

    if (!ship.alive) continue;
    const target = ship.target !== undefined ? byId.get(ship.target) : undefined;

    let desiredFacing: number;
    let shouldThrust: boolean;
    let reverse = false;

    if (target === undefined) {
      // Advance-to-contact: this ship has zero awareness (no live contact and
      // no ghost), so it cannot pick a target. Rather than hold blind, it
      // closes on where the enemy deployed — steering toward the OPPOSING
      // side's initial deployment centroid (a fixed reference captured at
      // battle start, never live enemy positions). A retreating blind ship
      // instead flees away from that reference, back toward its own lines. With
      // no opposing reference at all (the enemy fielded nothing) there is
      // nowhere to advance to, so the ship holds.
      const enemyDeployment =
        ship.side === "attacker" ? deployment.defender : deployment.attacker;
      if (enemyDeployment === undefined) continue;
      const ex = enemyDeployment.x - ship.x;
      const ey = enemyDeployment.y - ship.y;
      // A hold-order ship holds position even when blind: hold means do not
      // engage, full stop, so a blind hold ship pins and waits rather than
      // advancing toward an enemy it cannot see. Every other engage-range value
      // advances to contact — close, short, and long-range ships all seek the
      // enemy and let their range band take over once they acquire a target.
      // A retreating blind ship flees back toward its own lines (away from the
      // enemy reference) regardless of engage-range, because retreat overrides
      // every other order. `angleDifference` handles wrapping, so the raw atan2
      // result is fine.
      if (ship.orders.engageRange === "hold" && !isRetreating(ship)) {
        desiredFacing = ship.facing;
        shouldThrust = false;
      } else {
        desiredFacing = isRetreating(ship)
          ? Math.atan2(-ey, -ex)
          : Math.atan2(ey, ex);
        shouldThrust = true;
      }
    } else {
      const dx = target.x - ship.x;
      const dy = target.y - ship.y;
      const dist = Math.hypot(dx, dy);

      // Each ship's rangeKeepingBand determines how wide the "at range" dead-
      // zone is. A wider band means the ship tolerates being further from its
      // ideal range before correcting — cautious captains set wide bands,
      // aggressive ones set narrow ones so they close quickly. The inner edge
      // of the dead-zone is `1 - rangeKeepingBand` of `want`; the outer edge is
      // `want` itself (outside `want` always closes).
      const band = ship.orders.rangeKeepingBand;
      if (isRetreating(ship)) {
        // Turn tail and flee; retreating ships do not fire.
        desiredFacing = Math.atan2(-dy, -dx);
        shouldThrust = true;
      } else if (ship.orders.engageRange === "hold") {
        desiredFacing = Math.atan2(dy, dx);
        shouldThrust = false;
      } else {
        // Close in when the anomaly punishes time-of-flight (nebula, asteroid
        // field); unchanged for black hole and none.
        const want = anomalyAdjustedRange(ship.orders, ship.weapons, anomaly);
        if (dist > want) {
          desiredFacing = Math.atan2(dy, dx);
          shouldThrust = true;
        } else if (dist < want * (1 - band)) {
          // Too close — face the target and reverse-thrust to back off while
          // keeping guns on it. A Newtonian kiting maneuver that decelerates
          // instead of just turning tail.
          desiredFacing = Math.atan2(dy, dx);
          shouldThrust = true;
          reverse = true;
        } else {
          desiredFacing = Math.atan2(dy, dx);
          shouldThrust = false;
        }
      }
    }

    // Formation-keeping: when formationKeeping > 0, blend the desired facing
    // with the direction toward the fleet's centroid. The blend is a weighted
    // average of the two bearings using the angular difference, so the ship
    // steers somewhere between "toward my target" and "toward my fleet's
    // centre". At formationKeeping=0 this is a no-op; at 1 it overrides the
    // target-facing entirely (useful only for pure escort/formation flying).
    // Only applied when the ship is not retreating and has a formation to join.
    const centroid =
      ship.side === "attacker" ? centroidAttacker : centroidDefender;
    if (
      !isRetreating(ship) &&
      ship.orders.formationKeeping > 0 &&
      centroid !== undefined
    ) {
      const formationFacing = Math.atan2(
        centroid.y - ship.y,
        centroid.x - ship.x,
      );
      const fk = ship.orders.formationKeeping;
      // Blend using the angular difference to avoid wrapping artefacts.
      const angDiff = angleDifference(desiredFacing, formationFacing);
      desiredFacing = desiredFacing + angDiff * fk;
    }

    // Black-hole avoidance: ships fly into the well blind otherwise. Blend a
    // heading pointing directly away from the origin into the (already
    // formation-adjusted) target-seeking heading, weighted by how deep inside
    // the safety margin the ship sits. Applied last so near the hole it
    // dominates target-seeking and formation-keeping alike — survival first.
    // When the weight saturates we also force thrust so a ship being dragged
    // in actively burns to escape rather than coasting to its death; clear of
    // the margin the weight is zero and this is a no-op, so non-black-hole and
    // open-space behaviour is untouched.
    if (anomaly === "blackHole") {
      const distToHole = Math.hypot(ship.x, ship.y);
      const avoidWeight = blackHoleAvoidWeight(distToHole);
      if (avoidWeight > 0 && distToHole > 0) {
        const awayFacing = Math.atan2(ship.y, ship.x);
        const angDiff = angleDifference(desiredFacing, awayFacing);
        desiredFacing = desiredFacing + angDiff * avoidWeight;
        // Inside the danger zone, burn to escape — never sit still next to the
        // hole. A retreating ship is already thrusting; this guarantees a
        // holding or at-range ship also fires its engines to climb out.
        shouldThrust = true;
        reverse = false;
      }
    }

    // Attitude control is pure Newtonian rotation: the bang-bang controller
    // decides the commanded turn sign, the ship's torque sources produce a real
    // torque about the centre of mass, and `angVel += torque / I; facing +=
    // angVel` is the only thing that rotates the ship. There is NO maximum
    // angular speed — a ship under sustained turning torque keeps spinning up
    // until counter-torque brakes it to rest at the target heading. Both the
    // modular and legacy branches below share this one rotational model — they
    // differ only in where their commandable torque comes from (module geometry
    // vs a scalar derived from ShipStats.turnRate).
    //
    // Pre-compute the commandable torque and angular alpha so the bang-bang
    // controller and the post-integration settle snap share the same value.
    const mct = maxCommandableTorque(ship, shouldThrust);
    const alpha = ship.momentOfInertia > 0 ? mct / ship.momentOfInertia : 0;
    const turnSign = commandedTurn(ship, desiredFacing, mct, shouldThrust);
    // Afterburner (factions update): when the ship has movement intent this
    // tick, fire any ready afterburner and fold its thrust/turn surge into the
    // integrator below. Identity (1, 1) for ships without the tech, so the
    // movement maths is unchanged for them.
    const boost = afterburnerMultipliers(ship, shouldThrust);

    // Linear: thrust accelerates velocity.
    //
    // Modular ships (per-cell thrust): each alive engine contributes a
    // force vector F_local = (cos(facing) * thrust, sin(facing) * thrust).
    // We sum those forces, rotate the net into world space by `ship.facing`,
    // and add F/m to velocity. Engines at the ship's centre contribute no
    // torque; off-centre engines contribute r × F. The reverse flag flips
    // the sign of every engine's contribution (a kiting ship reverses every
    // thruster at once), so the ship thrusts away from the target. No
    // explicit maxSpeed clamp — the only thing limiting speed is the
    // accumulated engine force, which is the realistic behaviour: a heavily
    // engineered ship accelerates faster than a stripped-down one, and
    // once engines shut off, linear damping bleeds the velocity to zero.
    //
    // Aggregated (legacy) ships keep the scalar-thrust model: force points
    // along ship.facing (or opposite), magnitude is `thrust`. The
    // per-tick acceleration cap is `thrust / mass` (F = m·a) and the speed
    // is clamped to `thrust` so heavier ships are sluggish to build speed
    // and have the same top speed as lighter ones.
    if (ship.modules !== undefined) {
      // Engines, RCS, and reaction wheels for the commanded turn sign. Engine
      // r × F torque (and linear force) applies only when the ship is actively
      // thrusting; RCS and reaction wheels (pure-torque sources) apply their
      // commanded torque every tick regardless of thrust. When the ship is
      // holding position or braking (`shouldThrust = false`), engines are off
      // and produce neither force nor geometric torque — only the commandable
      // attitude sources (RCS, wheels, gimbal) are active.
      const { fx, fy, torque } = shipForceAndTorque(ship, turnSign, shouldThrust);
      const dir = reverse ? -1 : 1;
      // Afterburner scales the net engine force (and the resulting torque) for
      // the duration of its window; identity multiplier leaves it untouched.
      const lx = shouldThrust ? dir * fx * boost.thrust : 0;
      const ly = shouldThrust ? dir * fy * boost.thrust : 0;
      const world = rotateLocal(ship.facing, lx, ly);
      const invMass = 1 / Math.max(ship.mass, 1);
      ship.velX += world.x * invMass;
      ship.velY += world.y * invMass;
      ship.velX *= SIM.linearDamping;
      ship.velY *= SIM.linearDamping;
      // Newtonian rotation: α = torque / I. No angular speed cap.
      const angularAccel = ship.momentOfInertia > 0 ? torque / ship.momentOfInertia : 0;
      ship.angVel += angularAccel;
      // Deliberate small non-physical angular damping (mirrors linearDamping):
      // keeps a settled ship from drifting on floating-point residuals without
      // meaningfully opposing a real turn.
      ship.angVel *= SIM.angularDamping;
    } else {
      // Legacy aggregated ship: no module geometry, so its commandable torque
      // is a scalar authority derived from ShipStats.turnRate. Scaling by mass
      // gives `α = torque / I = (turnRate · mass) / (mass · legacyMoI) =
      // turnRate / legacyMoI`, an agility independent of the absolute mass —
      // an agile hull (high turnRate) spins up fast, a sluggish one slowly —
      // under the SAME `angVel += torque / I` integration as modular ships and
      // with NO maximum angular speed. A turnRate-0 hull genuinely cannot turn.
      const torqueAuthority = ship.turnRate * ship.mass;
      const torque = turnSign * torqueAuthority;
      const angularAccel = ship.momentOfInertia > 0 ? torque / ship.momentOfInertia : 0;
      ship.angVel += angularAccel;
      ship.angVel *= SIM.angularDamping;

      // Afterburner raises both the top speed and the acceleration for its
      // window; identity multiplier leaves the legacy scalar model unchanged.
      const maxSpeed = ship.thrust * boost.thrust;
      const accel = (ship.thrust * boost.thrust) / Math.max(ship.mass, 1);
      const dir = reverse ? -1 : 1;
      const desiredVX = shouldThrust ? dir * Math.cos(ship.facing) * maxSpeed : 0;
      const desiredVY = shouldThrust ? dir * Math.sin(ship.facing) * maxSpeed : 0;
      const dvx = desiredVX - ship.velX;
      const dvy = desiredVY - ship.velY;
      const dvLen = Math.hypot(dvx, dvy);
      if (dvLen > 0) {
        const step = Math.min(dvLen, accel);
        ship.velX += (dvx / dvLen) * step;
        ship.velY += (dvy / dvLen) * step;
      }
      const speed = Math.hypot(ship.velX, ship.velY);
      if (speed > maxSpeed) {
        const k = maxSpeed / speed;
        ship.velX *= k;
        ship.velY *= k;
      }
      ship.velX *= SIM.linearDamping;
      ship.velY *= SIM.linearDamping;
    }

    // Deadband settle: snap the ship cleanly onto the target heading when the
    // controller has commanded 0 (|e| ≤ deadband and |w| ≤ α) AND there is
    // real torque authority (α > 0). Applied AFTER torque integration so any
    // residual angVel change from that tick is included before the snap, and the
    // ship does not then drift away from the settled heading on the next tick.
    // A ship with zero authority (alpha === 0) genuinely cannot steer — no snap.
    if (
      turnSign === 0 &&
      alpha > 0 &&
      Math.abs(angleDifference(ship.facing, desiredFacing)) <= SIM.angularDeadband
    ) {
      ship.angVel = 0;
      ship.facing = desiredFacing;
    } else {
      ship.facing += ship.angVel;
    }
    ship.x += ship.velX;
    ship.y += ship.velY;
  }
}
