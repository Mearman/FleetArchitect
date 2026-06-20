/**
 * Per-tick ship movement: stance-derived desired range, black-hole avoidance
 * steering, the stop-in-time translation controller, and the integration of
 * forces into velocity and position. Movement is frictionless Newtonian:
 * velocity persists, the controller commands prograde/retrograde thrust to
 * hold the desired range, and there is no damping or speed cap.
 */

import type { ShipStance } from "@/schema/ai";

import type { BattleInputs } from "../types";

import { SIM, THRUST_ALIGNMENT_RAD } from "./config";
import { combinedDilation } from "./proper-time";
import {
  availableThrust,
  commandedTurn,
  lateralForceAndTorque,
  maxCommandableTorque,
  shipForceAndTorque,
} from "./physics";
import { angleDifference, blackHoleAvoidWeight, rotateLocal } from "./setup";
import { computeTranslationCommand } from "./translation";
import { afterburnerMultipliers } from "./tech";
import type { SimShip } from "./types";

/**
 * The stance the ship is acting under this tick: the live AI override
 * (`aiStance`, set by a `setStance` rule) when present, otherwise the static
 * `orders.stance`. The {@link EngagementStance} of `orders` is a subset of the
 * richer {@link ShipStance} the AI emits, so widening the fallback to
 * `ShipStance` is a safe assignment — every `orders.stance` value is also a
 * `ShipStance` value. A ship with no `setStance` rule keeps `aiStance` null and
 * reads exactly its static orders, so stance-driven behaviour is unchanged.
 */
export function effectiveStance(ship: SimShip): ShipStance {
  return ship.aiStance ?? ship.orders.stance;
}

export function isRetreating(ship: SimShip): boolean {
  // A `retreat` rule that fired this tick forces disengagement regardless of the
  // static threshold — the AI's explicit order overrides the HP-based default.
  if (ship.aiRetreat) return true;
  const threshold = ship.orders.retreatThreshold;
  if (threshold <= 0) return false;
  // Effective HP fraction: hull structure + module HP combined. The modular
  // damage model routes damage through module HP first (spilling to structure
  // only on module destruction), so structure alone stays near max until the
  // ship is nearly dead. Combining module HP into the fraction makes the
  // retreat threshold fire at a meaningful combat-effectiveness level — a ship
  // that has lost half its total HP (across modules and hull) retreats, not
  // only one on the brink of destruction. For aggregated ships (no modules)
  // this reduces to the original structure/maxStructure ratio.
  let current = ship.structure;
  let maximum = ship.maxStructure;
  if (ship.modules !== undefined) {
    for (const m of ship.modules) {
      current += m.hp;
      maximum += m.maxHp;
    }
  }
  return maximum > 0 && current / maximum < threshold;
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
  const stance = effectiveStance(ship);
  // The aggressive-family stances press the target; interceptor and escort also
  // close (a chaser and a screen both advance). The standoff stances (defensive,
  // evasive, sniper) and the static ones (hold, retreat) do not.
  return (
    stance === "aggressive" ||
    stance === "balanced" ||
    stance === "interceptor" ||
    stance === "escort"
  );
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
        // Soften the singularity at r -> 0 by clamping the effective r
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

    // Translation controller: a pure kinematic stop-in-time decision that
    // returns the world-space thrust direction, the heading the attitude
    // controller should aim for, and whether to fire engines this tick.
    // Replaces the old desired-range/steering + reverse block; see its
    // docstring for the full decision table.
    const cmd = computeTranslationCommand(ship, target, anomaly, deployment);
    let desiredFacing = cmd.desiredFacing;
    let shouldThrust = cmd.shouldThrust;
    const thrustMode = cmd.thrustMode;
    // Survival override: set by black-hole avoidance below. When true the
    // orient-before-burn gate is bypassed — the ship burns to escape even
    // before it has finished turning onto the escape heading, because a
    // partial-alignment thrust still beats coasting into the well while the
    // attitude controller rotates it. Cleared otherwise.
    let forceFire = false;

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

    // Rally (Phase 7 wiring): a `rally` rule that fired this tick returns the
    // ship toward its fleet's formation reference — its own side's centroid.
    // Unlike formation-keeping (a partial blend toward the centroid that still
    // tracks the target), a rally fully overrides the heading toward the
    // centroid and commands thrust, so a rallying ship breaks off and regroups.
    // Opt-in: only a rule-driven `aiRally` reaches here, so non-rallying ships
    // (every ship in a rule-less fleet) are untouched. Skipped when the ship is
    // already on the centroid (no direction to steer) or has no living fleet.
    if (ship.aiRally && centroid !== undefined) {
      const dx = centroid.x - ship.x;
      const dy = centroid.y - ship.y;
      if (dx !== 0 || dy !== 0) {
        desiredFacing = Math.atan2(dy, dx);
        shouldThrust = true;
      }
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
        // holding or at-range ship also fires its engines to climb out. The
        // forceFire flag bypasses the orient-before-burn gate so the engine
        // fires immediately, before the ship has fully turned onto the escape
        // heading.
        shouldThrust = true;
        forceFire = true;
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

    // Linear: thrust accelerates velocity. Velocity PERSISTS — real space is
    // frictionless, so a ship that stops thrusting keeps its momentum and only
    // changes velocity when the controller commands prograde/retrograde thrust
    // or a collision impulse lands. There is no damping bleed and no speed
    // cap; the only thing limiting speed is kinematics (the controller brakes
    // in time to hold the desired range) and the ship's actual engine force.
    //
    // Modular ships (per-cell thrust): each alive engine contributes a
    // force vector F_local = -(cos(exhaust), sin(exhaust)) * thrust. We sum
    // those forces, rotate the net into world space by `ship.facing`, and add
    // F/m to velocity. Engines at the ship's centre contribute no torque;
    // off-centre engines contribute r x F. The translation controller sets
    // `desiredFacing` so the ship's local +x axis aligns with the commanded
    // world thrust direction — firing the engines then produces a world force
    // along that direction. For an aft-only ship that must brake, the
    // controller flips the desired heading by PI so the rear engines point
    // along the ship's velocity and their forward push becomes a braking force.
    //
    // Aggregated (legacy) ships keep the scalar-thrust model: force points
    // along ship.facing, magnitude is `thrust`. The per-tick acceleration cap
    // is `thrust / mass` (F = m*a) and the speed is clamped to `thrust` so
    // heavier ships are sluggish to build speed and have the same top speed as
    // lighter ones. (Phase 1 deletes this branch entirely.)
    if (ship.modules !== undefined) {
      // Engines, RCS, and reaction wheel for the commanded turn sign. Engine
      // r x F torque (and linear force) applies only when the ship is actively
      // thrusting; RCS and reaction wheels (pure-torque sources) apply their
      // commanded torque every tick regardless of thrust. When the ship is
      // holding position or coasting (`shouldThrust = false`), engines are off
      // and produce neither force nor geometric torque — only the commandable
      // attitude sources (RCS, wheels, gimbal) are active.
      //
      // Orient before you burn: a fixed-direction main engine fired while the
      // ship is still turning onto its heading thrusts along the INTERMEDIATE
      // headings, injecting lateral velocity that persists (no damping) and
      // compounds into a drift over a long battle. So the engine fires only
      // once the ship is aligned with the commanded heading within
      // `THRUST_ALIGNMENT_RAD` — the same principle as the flip-and-brake
      // engine cut, generalised to every thrust command. RCS and reaction
      // wheels still turn the ship regardless (they are pure-torque sources).
      const alignedForThrust =
        Math.abs(angleDifference(ship.facing, desiredFacing)) <= THRUST_ALIGNMENT_RAD;
      const engineFire = shouldThrust && (alignedForThrust || forceFire);
      const { fx, fy, torque } = shipForceAndTorque(ship, turnSign, engineFire, thrustMode);
      // Afterburner scales the net engine force (and the resulting torque) for
      // the duration of its window; identity multiplier leaves it untouched.
      // Throttle scales it further so a fine correction (cancelling a small
      // residual under recoil) does not slam full thrust and over-correct.
      const throttle = cmd.throttle ?? 1;
      const lx = engineFire ? fx * boost.thrust * throttle : 0;
      const ly = engineFire ? fy * boost.thrust * throttle : 0;
      // Universal lateral (RCS) damper: cancel the velocity perpendicular to
      // the ship's facing, every tick, independent of the radial translation
      // controller. This is what keeps a ship from drifting sideways — lateral
      // thrusters fire to oppose perpendicular motion (recoil, turn-coupling)
      // without turning the ship, so it stays aimed at its target. The command
      // is the proportional throttle that arrests `vPerp` in one tick, clamped
      // to the lateral budget. Pure CoM translation (no torque — see
      // `lateralForceAndTorque`), so it never spins the ship.
      const latBudget = availableThrust(ship).lateral;
      const aLat = latBudget / Math.max(ship.mass, 1);
      let lateralCmd = 0;
      if (aLat > 0) {
        const perpX = -Math.sin(ship.facing);
        const perpY = Math.cos(ship.facing);
        const vPerp = ship.velX * perpX + ship.velY * perpY;
        lateralCmd = Math.max(-1, Math.min(1, -vPerp / aLat));
      }
      const lat = lateralForceAndTorque(ship, lateralCmd);
      const world = rotateLocal(ship.facing, lx + lat.fx, ly + lat.fy);
      const invMass = 1 / Math.max(ship.mass, 1);
      ship.velX += world.x * invMass;
      ship.velY += world.y * invMass;
      // Newtonian rotation: alpha = torque / I. The lateral engines' torque is
      // included so the attitude controller sees (and counters) any unbalanced
      // lateral firing; a balanced RCS pair contributes none.
      const totalTorque = torque + lat.torque;
      const angularAccel = ship.momentOfInertia > 0 ? totalTorque / ship.momentOfInertia : 0;
      ship.angVel += angularAccel;
    } else {
      // Legacy aggregated ship: no module geometry, so its commandable torque
      // is a scalar authority derived from ShipStats.turnRate. Scaling by mass
      // gives `alpha = torque / I = (turnRate * mass) / (mass * legacyMoI) =
      // turnRate / legacyMoI`, an agility independent of the absolute mass —
      // an agile hull (high turnRate) spins up fast, a sluggish one slowly —
      // under the SAME `angVel += torque / I` integration as modular ships and
      // with NO maximum angular speed. A turnRate-0 hull genuinely cannot turn.
      const torqueAuthority = ship.turnRate * ship.mass;
      const torque = turnSign * torqueAuthority;
      const angularAccel = ship.momentOfInertia > 0 ? torque / ship.momentOfInertia : 0;
      ship.angVel += angularAccel;

      // Afterburner raises both the top speed and the acceleration for its
      // window; identity multiplier leaves the legacy scalar model unchanged.
      // The controller has already set `desiredFacing` so thrusting along it
      // moves the ship in the commanded world direction (for a braking
      // command, desiredFacing is flipped PI so forward thrust becomes a brake).
      const maxSpeed = ship.thrust * boost.thrust;
      const accel = (ship.thrust * boost.thrust) / Math.max(ship.mass, 1);
      const desiredVX = shouldThrust ? Math.cos(ship.facing) * maxSpeed : 0;
      const desiredVY = shouldThrust ? Math.sin(ship.facing) * maxSpeed : 0;
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
    }

    // Deadband settle: snap the ship cleanly onto the target heading when the
    // controller has commanded 0 (|e| <= angularDeadband — see commandedTurn's
    // settle deadband) AND there is real torque authority (alpha > 0). Applied
    // AFTER torque integration so any residual angVel change from that tick is
    // included before the snap, and the ship does not then drift away from the
    // settled heading on the next tick. A ship with zero authority (alpha === 0)
    // genuinely cannot steer — no snap.
    //
    // This snap is load-bearing for convergence under frictionless integration:
    // the bang-bang controller cannot zero angVel exactly at the target under
    // forward Euler, so without damping a ship oscillates around the target
    // forever (a stable limit cycle of amplitude ~one braking tick). Clamping
    // angVel to 0 and facing to desiredFacing when within the heading deadband
    // is the "close enough, settle" step that ends the cycle. A ship genuinely
    // spinning (e.g. uncommanded rotation from off-centre thrust it cannot
    // counter) never has |e| <= deadband against a stable desiredFacing for
    // long, so this does not clamp active manoeuvres — only the residual
    // discretisation overshoot of a ship that has arrived.
    if (
      turnSign === 0 &&
      alpha > 0 &&
      Math.abs(angleDifference(ship.facing, desiredFacing)) <=
        Math.max(Math.abs(ship.angVel), SIM.angularDeadband)
    ) {
      ship.angVel = 0;
      ship.facing = desiredFacing;
    } else {
      ship.facing += ship.angVel;
    }
    ship.x += ship.velX;
    ship.y += ship.velY;
    // Proper-time dilation (Phase 4): ships moving fast or deep in a gravity
    // well age slower. Computed here (after velocity + position update, before
    // the weapons/crew/shield steps that consume it). The black hole is at the
    // origin; its gravitational potential is Phi = -GM/r (softened at r_s).
    const speed = Math.hypot(ship.velX, ship.velY);
    let phi = 0;
    if (anomaly === "blackHole") {
      const dist = Math.max(Math.hypot(ship.x, ship.y), SIM.blackHoleLethalRadius);
      phi = -SIM.blackHoleStrength / dist;
    }
    ship.dilationFactor = combinedDilation(speed, phi);
  }
}

