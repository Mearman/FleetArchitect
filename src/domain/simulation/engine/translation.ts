/**
 * The stop-in-time translation controller: the per-tick decision of where a
 * ship thrusts, what heading it aims for, how hard it burns (throttle), and
 * how it damps perpendicular drift (lateral RCS) — so it closes on its target
 * and holds range under frictionless Newtonian movement. Extracted from
 * movement.ts to keep the per-tick orchestrator focused on force integration;
 * movement.ts calls `computeTranslationCommand` each tick and applies the
 * result.
 */

import type { BattleInputs } from "../types";

import { ARRIVAL_CLOSING_SPEED_MPS, SIM } from "./config";
import { availableThrust, maxCommandableTorque } from "./physics";
import type { ThrustMode } from "./physics";
import { angleDifference, anomalyAdjustedRange } from "./setup";
import type { DeploymentReference } from "./movement";
import { isRetreating } from "./movement";
import type { SimShip } from "./types";

/**
 * Output of the stop-in-time translation controller: the world-space thrust
 * direction the ship should accelerate along this tick (already accounting for
 * the aft-only flip — a ship that must brake and has no retro thrusters
 * returns a vector along its own velocity so the rear engines brake), the
 * heading the attitude controller should aim for, and whether engines should
 * fire at all.
 */
export interface TranslationCommand {
  /** World-space unit vector along which firing the engines accelerates the
   *  ship this tick. */
  thrustDirX: number;
  thrustDirY: number;
  /** Heading the attitude controller should aim for this tick. For a ship
   *  with fore+aft thrusters this is the prograde/retrograde bearing to the
   *  target; for an aft-only ship braking it is the bearing flipped by PI so
   *  the rear engines point along the velocity and brake. */
  desiredFacing: number;
  /** Whether engines should fire this tick. False when holding, when within
   *  the arrival band (coast), or when the ship has no useful thrust. */
  shouldThrust: boolean;
  /** Which engines to fire: "prograde" fires only engines pushing local +x,
   *  "retrograde" fires only engines pushing local -x, "all" fires every
   *  engine. The mode is set so a balanced fore+aft ship does not have its
   *  engines cancel when the controller wants to move in one direction. */
  thrustMode: ThrustMode;
  /** Engine throttle this tick, 0..1 (default 1 = full). A stop-in-time brake
   *  from high speed uses full throttle; cancelling a small residual velocity
   *  uses a proportional throttle (`|vClose| / aBrake`, clamped) so the thrust
   *  just arrests the residual instead of over-correcting past zero — which a
   *  full-thrust bang-bang would do every tick under a continuous perturbation
   *  such as weapon recoil, producing a net drift. Real thrusters throttle. */
  throttle?: number;
  /** Signed lateral (RCS translation) throttle this tick, −1..+1, along the
   *  ship's local +y once it faces `desiredFacing`. Lets the controller cancel
   *  perpendicular drift without turning away from the target, so facing (to
   *  aim weapons) and translation (to station-keep) decouple. 0 when the ship
   *  has no lateral engines or no perpendicular velocity to cancel. */
  lateral?: number;
}

/**
 * Kinematic stop-in-time translation controller. Replaces the legacy
 * desired-range/steering + reverse logic with a pure kinematic decision:
 * accelerate prograde toward the target until the remaining closing distance
 * equals the braking distance, then thrust retrograde to arrive at the desired
 * range with near-zero speed. A ship with no target advances toward the enemy
 * deployment centroid; a holding ship coasts; a retreating ship thrusts away.
 *
 * Decision table (target present, not retreating, not hold):
 *  - `dist > want` and `dBrake < dist - want`: accelerate prograde. Room to
 *    build speed before the braking distance begins.
 *  - `dist > want` and `dBrake >= dist - want`: brake. A symmetrical ship
 *    (aRet > 0) brakes directly along the bearing; an aft-only ship (aRet = 0)
 *    flips PI to point its rear engines along its velocity and brakes that way.
 *  - `dist < want * (1 - band)`: too close — kinematic mirror of the closing
 *    case, opening range by accelerating away.
 *  - Otherwise (within the at-range band): coast. Velocity persists.
 *
 * The controller uses only kinematics (`a = thrust / mass`,
 * `vMax = sqrt(2 * a * d)`, `dBrake = v^2 / (2 * a)`) and the ship's actual
 * engine force vectors (via `availableThrust`). The single numerical settle
 * epsilon is `ARRIVAL_CLOSING_SPEED_MPS`; the at-range band comes from the
 * ship's `rangeKeepingBand` order. No speed cap, no damping, no hand-tuned
 * thresholds.
 *
 * Deterministic: a pure function of (ship, target, orders, anomaly, deployment)
 * — no RNG, no clock, no Map/Set iteration-order dependence.
 */
export function computeTranslationCommand(
  ship: SimShip,
  target: SimShip | undefined,
  anomaly: BattleInputs["anomaly"],
  deployment: DeploymentReference,
): TranslationCommand {
  // Retreat and hold are directional decisions handled before the stop-in-time
  // core: a retreating ship thrusts away from its reference and does not try to
  // hold a range; a holding ship faces its reference and coasts. Everything
  // else — range-keeping against a live target and advance-to-contact toward
  // the enemy deployment centroid — runs through the same flip-aware
  // stop-in-time controller (`stopInTimeToward`), so a ship with no current
  // contact cannot build unbounded speed in frictionless space.

  if (target === undefined) {
    // No contact. Steer on the enemy deployment centroid (a fixed reference
    // captured at battle start, never live positions).
    const enemyDeployment =
      ship.side === "attacker" ? deployment.defender : deployment.attacker;
    if (enemyDeployment === undefined) return holdFacing(ship.facing);
    if (ship.orders.engageRange === "hold" && !isRetreating(ship)) {
      return holdFacing(ship.facing);
    }
    const ex = enemyDeployment.x - ship.x;
    const ey = enemyDeployment.y - ship.y;
    if (isRetreating(ship)) return progradeAlong(Math.atan2(-ey, -ex));
    // Advance-to-contact: close on the centroid at want = 0, arriving at low
    // speed so the ship can engage the instant it acquires a target.
    return stopInTimeToward(ship, enemyDeployment.x, enemyDeployment.y, 0);
  }

  // Target present.
  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  const bearingToTarget = Math.atan2(dy, dx);

  if (isRetreating(ship)) return progradeAlong(Math.atan2(-dy, -dx));
  if (ship.orders.engageRange === "hold") return holdFacing(bearingToTarget);

  const want = anomalyAdjustedRange(ship.orders, ship.weapons, anomaly);
  return stopInTimeToward(ship, target.x, target.y, want);
}

/** Coast in place, turning to face `facing`. No thrust. */
function holdFacing(facing: number): TranslationCommand {
  return {
    thrustDirX: Math.cos(facing),
    thrustDirY: Math.sin(facing),
    desiredFacing: facing,
    shouldThrust: false,
    thrustMode: "all",
  };
}

/** Thrust prograde along a world bearing (exhaust-opposite the ship's local
 *  +x once it faces `bearing`). Used by retreat, where there is no range to
 *  hold — the ship simply leaves. */
function progradeAlong(bearing: number): TranslationCommand {
  return {
    thrustDirX: Math.cos(bearing),
    thrustDirY: Math.sin(bearing),
    desiredFacing: bearing,
    shouldThrust: true,
    thrustMode: "prograde",
  };
}

/**
 * Flip-aware stop-in-time controller toward a destination point, holding range
 * `want` from it. The unified core for range-keeping (destination = target,
 * want = engagement range) and advance-to-contact (destination = enemy
 * deployment centroid, want = 0). The ship accelerates prograde toward the
 * destination only while doing so still leaves room to arrest the resulting
 * closing speed — accounting for an aft-only ship's PI-flip coast — so it
 * arrives at `want` at rest and holds, rather than overshooting into a
 * flip-brake oscillation or (with no contact) building unbounded speed.
 *
 * Decision: for the bearing the ship should close along, `closeOrBrake` applies
 * a one-tick look-ahead — accelerate only if the flip-aware braking distance
 * from the speed reached after one prograde tick still fits the remaining gap.
 * That brakes at the last tick that keeps the stop inside the gap, so the ship
 * never builds speed it must then overshoot to shed. The too-close (open range)
 * and at-range-residual cases are the same decision on the mirrored bearing.
 *
 * Deterministic: a pure function of (ship, destination, want) — no RNG, clock,
 * or Map/Set iteration-order dependence.
 */
function stopInTimeToward(
  ship: SimShip,
  destX: number,
  destY: number,
  want: number,
): TranslationCommand {
  const dx = destX - ship.x;
  const dy = destY - ship.y;
  const dist = Math.hypot(dx, dy);
  const bearing = Math.atan2(dy, dx);
  const mass = Math.max(ship.mass, 1);
  const { prograde, retrograde } = availableThrust(ship);
  const aPro = prograde / mass;
  const aRet = retrograde / mass;
  const vClose = dist > 0 ? (ship.velX * dx + ship.velY * dy) / dist : 0;
  const band = ship.orders.rangeKeepingBand;
  const tFlip = flipTime(ship);

  // Outside desired range — close toward it.
  if (dist > want) {
    return closeOrBrake(ship, bearing, dist - want, vClose, aPro, aRet, tFlip);
  }
  // Inside the inner edge of the at-range band — open range (the mirror of
  // closing on the bearing directly away from the destination).
  if (dist < want * (1 - band)) {
    return closeOrBrake(
      ship,
      bearing + Math.PI,
      want - dist,
      -vClose,
      aPro,
      aRet,
      tFlip,
    );
  }
  // Within the at-range band: a critically-damped PD station-keeper holds the
  // range and damps ALL residual velocity (radial and perpendicular) to zero,
  // so perpendicular drift from turn-coupling or recoil cannot compound over a
  // long frictionless battle into a wander off station. See `stationKeep`.
  return stationKeep(ship, dx, dy, dist, want, band, aPro, aRet);
}

/**
 * Critically-damped PD station-keeper for holding range `want` from the
 * destination point `(dx, dy)` away. The radial channel (along the bearing to
 * the destination) holds the range and damps closing speed; the tangential
 * channel damps perpendicular drift (there is no tangential position error —
 * any bearing at range `want` is acceptable, so only velocity is opposed). The
 * resulting desired acceleration vector is pursued by orienting the ship to
 * face it and throttling by `|a| / aMax`.
 *
 * Gains are critically-damped and derived: `Kd = 2·√Kp`, with `Kp` anchored so
 * a band-edge displacement demands full thrust. Both fall out of the ship's
 * available acceleration and its authored range-keeping band — no hand-tuned
 * values. The throttle (`|a| / aMax`) scales the demanded acceleration to each
 * ship's engines.
 *
 * Continuous and snap-free: the D term is active velocity damping (thrusters
 * firing to oppose motion), not a passive drag and not a velocity zeroing — so
 * a continuous perturbation such as weapon recoil is opposed smoothly rather
 * than chattering around a threshold.
 */
function stationKeep(
  ship: SimShip,
  dx: number,
  dy: number,
  dist: number,
  want: number,
  band: number,
  aPro: number,
  aRet: number,
): TranslationCommand {
  // The ship FACES THE TARGET throughout (desiredFacing = bearing), so its
  // weapons stay aimed. Range is held and drift damped through two independent
  // thrust channels that do not require turning: the fore/aft drive for the
  // radial (range) channel and the lateral (RCS) engines for the perpendicular
  // channel. This is the decoupling that lets a ship hold station under fire —
  // perpendicular recoil drift is cancelled by lateral thrust, not by turning
  // away from the target.
  const bearing = Math.atan2(dy, dx);
  const aMax = Math.max(aPro, aRet);
  // Critically-damped PD gains for the frictionless double-integrator
  // `m·ẍ = F`: `kd = 2·√kp`. `kp` is anchored so a band-edge displacement
  // (`want · rangeKeepingBand`) demands exactly full thrust (`kp·bandWidth =
  // aMax`). Derived from the ship's available acceleration and its authored
  // range-keeping band — no hand-tuned values.
  const bandWidth = Math.max(want * band, 1e-6);
  const kp = aMax / bandWidth;
  const kd = 2 * Math.sqrt(kp);
  // Bearing unit (toward target) and its 90°-CCW perpendicular.
  const inv = dist > 0 ? 1 / dist : 0;
  const bx = dx * inv;
  const by = dy * inv;
  const vRadial = ship.velX * bx + ship.velY * by; // +=moving toward target
  const rangeErr = dist - want; // +=too far
  // Radial PD (range): close when too far, open when too close, damp radial
  // speed. The sign selects prograde (toward target) vs retrograde (away); the
  // magnitude is the throttle on the fore/aft drive.
  const aR = kp * rangeErr - kd * vRadial;
  const prograde = aR >= 0;
  const radialThrottle =
    aMax > 0 ? Math.min(1, Math.abs(aR) / (prograde ? aPro : aRet)) : 0;
  const shouldThrust = radialThrottle > 1e-6;
  return {
    thrustDirX: prograde ? bx : -bx,
    thrustDirY: prograde ? by : -by,
    desiredFacing: bearing,
    shouldThrust,
    thrustMode: prograde ? "prograde" : "retrograde",
    throttle: radialThrottle,
  };
}

/**
 * Close along `bearing` (accelerate prograde) or brake, by the flip-aware
 * stop-in-time decision. `remaining` is the gap to the desired range point
 * along that bearing; `vClose` is the speed already carrying the ship along
 * that bearing (positive = closing). Accelerates only while one more prograde
 * tick still leaves room to arrest the resulting speed — the look-ahead that
 * prevents building speed the ship must overshoot to shed. Braking is direct
 * (retro thrusters) for ships that have them; an aft-only ship flips PI and
 * brakes once aligned (`flipAndBrake`, main engine cut during the flip so it
 * does not inject lateral velocity); an aft-only ship with no attitude
 * authority cannot flip and so cannot brake — if it faces the bearing it keeps
 * closing (ramming/overshooting, the only thing it can do), otherwise it drifts.
 */
function closeOrBrake(
  ship: SimShip,
  bearing: number,
  remaining: number,
  vClose: number,
  aPro: number,
  aRet: number,
  tFlip: number,
): TranslationCommand {
  // The ship should move along `bearing` and arrive at the range point
  // `remaining` ahead, at rest. `vClose` is its speed along that bearing
  // (positive = closing on the point, negative = drifting the wrong way).

  // Drifting the wrong way (e.g. knocked back by weapon recoil while sitting
  // at the desired range): cancel the opening drift with a PROPORTIONAL
  // prograde thrust — just enough to arrest it this tick, no overshoot. A
  // full-thrust correction here would slam past zero and inject energy every
  // tick, producing a growing oscillation under continuous recoil.
  if (vClose < -ARRIVAL_CLOSING_SPEED_MPS && aPro > 0) {
    return {
      thrustDirX: Math.cos(bearing),
      thrustDirY: Math.sin(bearing),
      desiredFacing: bearing,
      shouldThrust: true,
      thrustMode: "prograde",
      throttle: Math.min(1, -vClose / aPro),
    };
  }
  // Look-ahead: speed after one prograde tick, and whether the flip-aware
  // braking distance from that speed still fits the remaining gap.
  const dBrakeNext = flipAwareBrakingDistance(vClose + aPro, aPro, aRet, tFlip);
  if (aPro > 0 && dBrakeNext < remaining) {
    return {
      thrustDirX: Math.cos(bearing),
      thrustDirY: Math.sin(bearing),
      desiredFacing: bearing,
      shouldThrust: true,
      thrustMode: "prograde",
    };
  }
  // Brake. A retro-capable ship brakes directly along the bearing (it faces the
  // bearing; retro engines fire, pushing against the closing motion).
  if (aRet > 0) {
    // Proportional throttle: cancel exactly the closing speed this tick when
    // it is below one tick of full retro thrust, so a small residual is
    // arrested without overshooting past zero; full throttle for a large brake.
    const cancel = Math.max(vClose, 0);
    return {
      thrustDirX: -Math.cos(bearing),
      thrustDirY: -Math.sin(bearing),
      desiredFacing: bearing,
      shouldThrust: true,
      thrustMode: "retrograde",
      throttle: Math.min(1, cancel / aRet),
    };
  }
  if (aPro <= 0) {
    return {
      thrustDirX: 0,
      thrustDirY: 0,
      desiredFacing: bearing,
      shouldThrust: false,
      thrustMode: "all",
    };
  }
  if (tFlip === Infinity) {
    // No attitude authority: cannot flip to brake. The PI/2 bound is where the
    // prograde thrust's component along the bearing changes sign (cos = 0); a
    // ship facing within it still closes (it will ram or overshoot, since
    // stopping is impossible for such a degenerate fit), beyond it thrusting
    // would push the ship away from the bearing, so it drifts instead.
    if (Math.abs(angleDifference(ship.facing, bearing)) <= Math.PI / 2) {
      return {
        thrustDirX: Math.cos(bearing),
        thrustDirY: Math.sin(bearing),
        desiredFacing: ship.facing,
        shouldThrust: true,
        thrustMode: "prograde",
      };
    }
    return {
      thrustDirX: 0,
      thrustDirY: 0,
      desiredFacing: ship.facing,
      shouldThrust: false,
      thrustMode: "all",
    };
  }
  return flipAndBrake(ship, bearing);
}

/**
 * Time (ticks) for the ship to rotate PI radians under its commandable attitude
 * authority (RCS, reaction wheels, gimbals), assuming bang-bang control: half
 * the angle accelerating, half braking. The continuous bang-bang time for an
 * angle theta at angular acceleration alpha is 2*sqrt(theta/alpha); for a full
 * PI flip this is 2*sqrt(PI/alpha). Returns Infinity when the ship has no
 * attitude authority (alpha = 0): it cannot turn, so any manoeuvre needing a
 * flip never completes, and the braking-distance formula then correctly
 * forbids acceleration the ship could not later arrest. Pure function of ship
 * state; deterministic.
 */
function flipTime(ship: SimShip): number {
  const I = ship.momentOfInertia;
  if (I <= 0) return Infinity;
  // Pure attitude authority: engine gimbal torque only exists while firing, so
  // pass shouldThrust = false to count RCS and reaction wheels alone.
  const maxTorque = maxCommandableTorque(ship, false);
  if (maxTorque <= 0) return Infinity;
  const alpha = maxTorque / I;
  return 2 * Math.sqrt(Math.PI / alpha);
}

/**
 * Distance a ship covers while shedding closing speed `v`, given its prograde/
 * retrograde thrust and PI-flip time. A retro-capable ship brakes directly (no
 * turn) over v^2/(2*aRet). An aft-only ship (aRet = 0) must first flip PI,
 * coasting unbraked at speed `v` for `tFlip` ticks, then brake over
 * v^2/(2*aPro): total v*tFlip + v^2/(2*aPro). A ship with neither kind of
 * thrust can arrest nothing: Infinity. The v*tFlip term is what makes an
 * aft-only ship begin braking at a lower peak speed so it arrives at the
 * desired range at rest rather than overshooting and oscillating. Every term
 * is kinematics over the ship's actual thrust, mass, and attitude authority —
 * no hand-tuned constants.
 */
function flipAwareBrakingDistance(
  v: number,
  aPro: number,
  aRet: number,
  tFlip: number,
): number {
  const speed = Math.abs(v);
  if (aRet > 0) return (speed * speed) / (2 * aRet);
  if (aPro > 0) return speed * tFlip + (speed * speed) / (2 * aPro);
  return Infinity;
}

/**
 * Flip-and-brake command for an aft-only ship (no retro thrust) carrying
 * velocity it must shed: face along the velocity vector plus PI so the rear
 * engines point along the direction of travel, then fire them — their forward
 * push becomes a braking force. Emergent and deterministic. `bearingToTarget`
 * is the fallback heading when the ship is effectively at rest.
 */
function flipAndBrake(ship: SimShip, bearingToTarget: number): TranslationCommand {
  const speed = Math.hypot(ship.velX, ship.velY);
  if (speed <= ARRIVAL_CLOSING_SPEED_MPS) {
    // Effectively at rest — nothing to brake. Hold facing toward the target.
    return {
      thrustDirX: 0,
      thrustDirY: 0,
      desiredFacing: bearingToTarget,
      shouldThrust: false,
      thrustMode: "all",
    };
  }
  const velBearing = Math.atan2(ship.velY, ship.velX);
  const desiredFacing = velBearing + Math.PI;
  // Cut the main engine while the ship rotates onto the brake heading. A
  // fixed-direction rear engine firing mid-flip sweeps its thrust vector
  // through lateral directions as the ship turns, injecting perpendicular
  // velocity that flings the ship off its braking path into a divergent
  // spiral. A real flip-and-burn cuts thrust, rotates to the retrograde
  // heading on attitude control alone, then fires. Coast (shouldThrust =
  // false) until aligned within the heading deadband, at which point firing
  // prograde is a clean brake along world -velocity.
  const aligned =
    Math.abs(angleDifference(ship.facing, desiredFacing)) <= SIM.angularDeadband;
  return {
    thrustDirX: -ship.velX / speed,
    thrustDirY: -ship.velY / speed,
    desiredFacing,
    shouldThrust: aligned,
    thrustMode: "prograde",
  };
}
