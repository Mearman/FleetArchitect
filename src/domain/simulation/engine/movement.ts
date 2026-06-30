/**
 * Per-tick ship movement: stance-derived desired range, black-hole avoidance
 * steering, the stop-in-time translation controller, and the integration of
 * forces into velocity and position. Movement is frictionless Newtonian:
 * velocity persists, the controller commands prograde/retrograde thrust to
 * hold the desired range, and there is no damping or speed cap.
 */

import type { ShipStance } from "@/schema/ai";

import { ACCEL_PER_TICK_FROM_SI, type BattleInputs } from "../types";
import type { MediumField, MediumState } from "./medium-field";
import { sampleLocalRhoKgPerM3 } from "./medium-setup";

import { GAS_DRAG_CROSS_SECTION_SHIP_M2, SIM, THRUST_ALIGNMENT_RAD } from "./config";
import { TICKS_PER_SECOND } from "../types";
import { combinedDilation } from "./proper-time";
import { bangBangTurnSign, maxCommandableTorque } from "./physics";
import { computeForceAndLateral, computeMovementInputs } from "./movement-dynamics";
import { relativisticMomentumStep } from "./relativistic-momentum";
import { angleDifference, angularAccelPerTick, blackHoleAvoidWeight, rotateLocal } from "./setup";
import { hasAnomaly } from "@/domain/anomaly";
import { computeTranslationCommand } from "./translation";
import { afterburnerMultipliers } from "./tech";
import { buildAggregates, makeResolver, type Point } from "./formation-doctrine";
import { desiredPoint, cohesionCentroidFor } from "./formation-movement";
import type { SimShip } from "./types";
import { isClaimed } from "./salvage";
import { buildGravityField, gravityAcceleration } from "./gravity";
import { buildSeparationSnapshot, separationHeading, SEPARATION_BURN_THRESHOLD } from "./separation";

/**
 * Whether the linear integrator routes thrust through the relativistic
 * momentum update (`p = gamma·m·v`, velocity bounded by `c`) rather than adding
 * `F/m` straight onto velocity (Newtonian, no speed limit).
 *
 * A compile-time constant swap, not a runtime flag: it exists so the
 * relativistic step can be validated against the Newtonian baseline by flipping
 * one symbol and re-running the same deterministic battle. At combat speeds the
 * two are numerically indistinguishable (`gamma → 1`); the difference only
 * appears once a ship is driven to a meaningful fraction of `c`, which is what
 * the determinism gate exercises. Left `true`: the relativistic integrator is
 * the production path.
 */
const USE_RELATIVISTIC_INTEGRATOR = true;

/**
 * The stance the ship is acting under this tick: the live AI override
 * (`aiStance`, set by a `setStance` rule) when present, otherwise the doctrine
 * base stance (falling back to `"balanced"` when the doctrine left it unset).
 * Read by the translation controller (to scale the held engagement range through
 * `stanceRangeFactor`), by `isClosingStance` (blink-jump direction), and by the
 * targeting scorer (stance-driven target preference).
 */
export function effectiveStance(ship: SimShip): ShipStance {
  return ship.aiStance ?? ship.doctrine.base.stance ?? "balanced";
}

export function isRetreating(ship: SimShip): boolean {
  // A `retreat` rule that fired this tick forces disengagement regardless of the
  // static threshold — the AI's explicit order overrides the HP-based default.
  if (ship.aiRetreat) return true;
  const threshold = ship.doctrine.base.retreat ?? 0;
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
 * The nearest alive enemy ship to `ship`, scanned in a FIXED id-sorted order so
 * the choice is deterministic: ties in distance break on the lexicographically
 * smaller instanceId, never on array order (which a kill or spawn could shift).
 * Phantoms count as threats — a drone or decoy bearing down is still a thing to
 * flee. Returns `undefined` when no enemy is alive. Used by the AI `retreat`
 * action to steer directly away from the closest danger rather than merely away
 * from whatever target the ship had locked.
 */
export function nearestThreat(
  ship: SimShip,
  ships: readonly SimShip[],
): SimShip | undefined {
  // Sort candidates by id first so the scan order — and therefore the tie-break
  // — is a property of the inputs, not of the live array order.
  const enemies = ships
    .filter((e) => e.alive && e.side !== ship.side)
    .slice()
    .sort((a, b) =>
      a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0,
    );
  let nearest: SimShip | undefined;
  let bestDistSq = Infinity;
  for (const e of enemies) {
    const dx = e.x - ship.x;
    const dy = e.y - ship.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      nearest = e;
    }
  }
  return nearest;
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
  anomalies: BattleInputs["anomalies"],
  deployment: DeploymentReference,
  defaultRange: number,
  medium: { field: MediumField; state: MediumState } | undefined,
  /** Current tick, threaded through so a formation-doctrine `orbit` bearing
   *  (the only time-dependent spatial term) resolves deterministically. */
  tick: number,
  /** Named waypoints (pointId → world); a `{kind: "point"}` reference resolves
   *  here. Empty when no fleet authored points. */
  points: ReadonlyMap<string, Point>,
): void {
  // Pre-compute fleet centroids once per tick so formation-keeping blends
  // each ship's desired heading toward a stable reference point, not one
  // that shifts mid-loop as individual ships move.
  const centroidAttacker = fleetCentroid(ships, "attacker");
  const centroidDefender = fleetCentroid(ships, "defender");

  // Phase D formation-doctrine support: build the per-formation aggregates and
  // reference resolver ONCE per tick (mirroring the formation-doctrine pass), so
  // a ship with an `aiSpatial` override resolves its spatial objective to the
  // same point the pass used. Pure, instanceId-sorted; harmless for presets
  // (aiSpatial undefined → desiredPoint undefined → byte-identical).
  const sortedForFormation = ships
    .slice()
    .sort((a, b) =>
      a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0,
    );
  const formationAggregates = buildAggregates(sortedForFormation);
  const formationResolve = makeResolver(sortedForFormation, byId, formationAggregates, deployment, points);

  // Build the N-body gravitational field once per tick, with positions
  // snapshotted before any ship moves. Each ship then reads its pull from this
  // single simultaneous configuration, in the field's fixed lexicographic id
  // order — so the gravity step is a property of the inputs, not of the loop
  // order. The black hole is the dominant body on this list and the ships pull
  // each other too (a real N-body system). Built only inside a black-hole
  // battle: open space has no dominant mass and ship-on-ship gravity at combat
  // ranges is below the precision of every other force, so gravity is a feature
  // of the scenario and open-space combat stays exactly gravity-free.
  const gravityField =
    hasAnomaly(anomalies, "blackHole") ? buildGravityField(ships) : undefined;

  // Separation snapshot: every alive, non-phantom ship's pose and bounding
  // radius, captured once before any ship moves and sorted by instanceId — the
  // same determinism contract as the gravity field above. Each ship then reads
  // its neighbours from this single simultaneous configuration, so the
  // separation blend is independent of the loop order and byte-reproducible.
  const separationField = buildSeparationSnapshot(ships);
  for (const ship of ships) {
    if (!ship.alive) continue;
    // Phantoms (drones/decoys) move in their own bespoke step, not here.
    if (ship.phantom !== undefined) continue;
    // A claimed hull is inert salvage: it has been disarmed, decrewed, and
    // grappled, so it neither thrusts nor steers. It still felt gravity above and
    // keeps its velocity, so it drifts on like a piece of wreckage; the
    // controller below (which would fire engines and turn the hull) is skipped.
    if (isClaimed(ship)) {
      ship.engineThrottle = 0;
      continue;
    }

    // N-body gravity: a real 1/r^2 acceleration toward every other body on the
    // field (the black hole, plus every other ship), summed in the field's
    // fixed lexicographic id order and applied to velocity (not position) so
    // momentum is preserved and the ship's own velocity still carries it
    // forward. The acceleration of the PULLED ship is independent of its own
    // mass (the equivalence principle), so heavy and light ships fall the same
    // way; the pull a body EXERTS scales with that body's mass. The field is
    // undefined in open space (no black hole), so this step is skipped entirely
    // there and gravity-free combat is unchanged.
    if (gravityField !== undefined) {
      const g = gravityAcceleration(gravityField, ship.instanceId, ship.x, ship.y);
      ship.velX += g.ax;
      ship.velY += g.ay;
    }

    // Black-hole tidal and lethal damage: specific to the well, not a property
    // of generic gravity, so it stays gated on the anomaly. The differential
    // pull across a body of finite size scales as 1/r^3 ("spaghettification"),
    // so the closer you get the faster you are torn apart; inside the lethal
    // radius (the event-horizon proxy) destruction is instant.
    if (hasAnomaly(anomalies, "blackHole")) {
      const dist = Math.hypot(ship.x, ship.y);
      if (
        dist > 0 &&
        dist < SIM.blackHoleTidalRadius &&
        dist >= SIM.blackHoleLethalRadius
      ) {
        ship.structure -= SIM.blackHoleTidalDamageScale / (dist * dist * dist);
        if (ship.structure <= 0) {
          ship.structure = 0;
          ship.alive = false;
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

    // Gas drag: decelerate in the local medium density. Quadratic drag
    // `F = −C_d · ρ · |v| · v` applied as a velocity decrement after gravity and
    // before the translation controller computes thrust, so the controller sees
    // the dragged velocity. At ISM density the decrement is below float64 epsilon
    // and the term is numerically zero; in dense plume/nebula gas it measurably
    // slows the ship. Only applied when ρ > 0.
    if (medium !== undefined) {
      // Sample density AHEAD of the ship (one cell along its velocity): drag is
      // resistance from the medium the ship flies INTO, and sampling ahead
      // breaks a self-drag feedback where a ship's own freshly-deposited exhaust
      // plume (laid down at its trailing nozzle each tick) would otherwise brake
      // it. A near-stationary ship samples its current cell (pure ISM until it
      // has moved and deposited exhaust behind it).
      const aheadSpeed = Math.hypot(ship.velX, ship.velY);
      const ahead = aheadSpeed > 1e-6 ? medium.field.config.pitchM / aheadSpeed : 0;
      const rhoHere = sampleLocalRhoKgPerM3(medium, ship.x + ship.velX * ahead, ship.y + ship.velY * ahead);
      if (rhoHere > 0) {
        const speedTick = aheadSpeed;
        if (speedTick > 0) {
          const speedMs = speedTick * TICKS_PER_SECOND;
          const dvTick =
            GAS_DRAG_CROSS_SECTION_SHIP_M2 * rhoHere * speedMs * speedMs /
            (Math.max(ship.mass, 1) * TICKS_PER_SECOND * TICKS_PER_SECOND);
          if (dvTick >= speedTick) {
            ship.velX = 0;
            ship.velY = 0;
          } else {
            const f = 1 - dvTick / speedTick;
            ship.velX *= f;
            ship.velY *= f;
          }
        }
      }
    }

    // Reset the per-tick engine throttle; set below only when engines actually
    // fire. A ship that coasts, holds station, or only turns this tick keeps it
    // at 0 and so burns no propellant in the resource step.
    ship.engineThrottle = 0;
    const target = ship.target !== undefined ? byId.get(ship.target) : undefined;

    // Translation controller: a pure kinematic stop-in-time decision that
    // returns the world-space thrust direction, the heading the attitude
    // controller should aim for, and whether to fire engines this tick.
    // Replaces the old desired-range/steering + reverse block; see its
    // docstring for the full decision table.
    const cmd = computeTranslationCommand(
      ship,
      target,
      anomalies,
      deployment,
      defaultRange,
      // Phase D: resolve `aiSpatial` (if any) to a world desired-point.
      // Undefined for every preset ship (the pass is a gated no-op), so the
      // existing target/deployment logic runs byte-identically. The orbit term
      // `phase + omega·tick` is the only time dependence — pure in tick.
      desiredPoint(ship, tick, formationResolve),
    );
    let desiredFacing = cmd.desiredFacing;
    let shouldThrust = cmd.shouldThrust;
    const thrustMode = cmd.thrustMode;
    // Survival override: set by black-hole avoidance below. When true the
    // orient-before-burn gate is bypassed — the ship burns to escape even
    // before it has finished turning onto the escape heading, because a
    // partial-alignment thrust still beats coasting into the well while the
    // attitude controller rotates it. Cleared otherwise.
    let forceFire = false;

    const centroid =
      ship.side === "attacker" ? centroidAttacker : centroidDefender;

    // Retreat (Phase 7 wiring): a `retreat` rule that fired this tick steers the
    // ship directly AWAY from the nearest enemy, not merely away from its locked
    // target — the closest threat is the one to flee. The threat is picked in a
    // fixed id-sorted order (`nearestThreat`) so the choice is deterministic. The
    // translation controller already opens range when `isRetreating` is true
    // (which `aiRetreat` forces); this override aims that flight at the real
    // danger and commands thrust. Takes precedence over rally and
    // formation-keeping — an explicit retreat is the strongest tactical order
    // short of black-hole survival, applied below. Skipped when there is no
    // living enemy (nothing to flee) or the ship sits exactly on the threat.
    const threat = ship.aiRetreat ? nearestThreat(ship, ships) : undefined;
    if (threat !== undefined) {
      const dx = ship.x - threat.x;
      const dy = ship.y - threat.y;
      if (dx !== 0 || dy !== 0) {
        desiredFacing = Math.atan2(dy, dx);
        shouldThrust = true;
      }
    } else if (ship.aiRally && centroid !== undefined) {
      // Rally (Phase 7 wiring): a `rally` rule that fired this tick returns the
      // ship toward its fleet's formation reference — its own side's centroid.
      // Unlike formation-keeping (a partial blend toward the centroid that still
      // tracks the target), a rally fully overrides the heading toward the
      // centroid and commands thrust, so a rallying ship breaks off and regroups.
      // Opt-in: only a rule-driven `aiRally` reaches here, so non-rallying ships
      // (every ship in a rule-less fleet) are untouched. Skipped when the ship is
      // already on the centroid (no direction to steer) or has no living fleet.
      // When rallying, skip formation-keeping entirely — rally takes precedence.
      const dx = centroid.x - ship.x;
      const dy = centroid.y - ship.y;
      if (dx !== 0 || dy !== 0) {
        desiredFacing = Math.atan2(dy, dx);
        shouldThrust = true;
      }
    } else if (
      // Formation-keeping (doctrine `cohesion`): when > 0, blend the desired
      // facing toward a centroid. At 0 a no-op; at 1 it overrides target-facing.
      // Phase D generalises the centroid: a nested/override ship blends toward
      // its OWN formation's centroid (`cohesionCentroidFor`), GATED so a flat
      // preset fleet keeps the whole-fleet centroid.
      !isRetreating(ship) &&
      (ship.doctrine.base.cohesion ?? 0) > 0
    ) {
      const cohesionCentroid = cohesionCentroidFor(
        ship,
        centroid,
        formationAggregates,
      );
      if (cohesionCentroid !== undefined) {
        const formationFacing = Math.atan2(
          cohesionCentroid.y - ship.y,
          cohesionCentroid.x - ship.x,
        );
        const fk = ship.doctrine.base.cohesion ?? 0;
        const angDiff = angleDifference(desiredFacing, formationFacing);
        desiredFacing = desiredFacing + angDiff * fk;
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
    if (hasAnomaly(anomalies, "blackHole")) {
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

    // Inter-ship separation — the repulsive counterpart to cohesion. Cohesion
    // blends a ship toward its fleet centroid; nothing else steers it AWAY from a
    // ship it is about to ram, so two enemies targeting each other close head-on
    // until their cells overlap (separated only reactively by the collision
    // step's elastic push-apart). Separation adds the missing term: blend the
    // desired facing toward the resultant of the near-neighbour away-vectors
    // (see separationHeading). Universal — ships are solid bodies that cannot
    // share space, friend or foe — so, like black-hole avoidance, this is a
    // global constant rather than a per-doctrine knob, and it layers on top of
    // every other heading decision. Soft field: heading-only, so ordinary
    // closing-to-range combat is untouched; at a genuinely-imminent weight the
    // ship also burns out (the same forceFire survival override as black-hole
    // avoidance) so a fast head-on closer escapes before contact.
    const sep = separationHeading(ship, separationField);
    if (sep !== undefined) {
      const angDiff = angleDifference(desiredFacing, sep.heading);
      desiredFacing = desiredFacing + angDiff * sep.weight;
      if (sep.weight >= SEPARATION_BURN_THRESHOLD) {
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
    // Movement capabilities. Modular ships fuse the four independent per-module
    // scans (commandable torque, geometric disturbance torque, lateral budget,
    // afterburner multipliers) into one pass via computeMovementInputs; legacy
    // ships use the scalar fallbacks. The geometric torque feeds the bang-bang
    // controller directly (bangBangTurnSign), so the redundant geometricTorque
    // scan inside commandedTurn is avoided — one pass replaces four scans.
    const { mct, geoTorque, latBudget, boost } =
      ship.modules !== undefined
        ? computeMovementInputs(ship, shouldThrust)
        : {
            mct: maxCommandableTorque(ship, shouldThrust),
            geoTorque: 0,
            latBudget: 0,
            boost: afterburnerMultipliers(ship, shouldThrust),
          };
    const alpha = angularAccelPerTick(mct, ship.momentOfInertia);
    const turnSign = bangBangTurnSign(ship, desiredFacing, mct, geoTorque);

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
      // Lateral (RCS) damper command, computed before the fused force call
      // below (it needs lateralCmd). The damper cancels velocity perpendicular
      // to the facing every tick — lateral thrusters fire to oppose perpendicular
      // drift (recoil, turn-coupling) without spinning the ship. `lateralCmd` is
      // the proportional throttle that arrests `vPerp` in one tick, clamped to
      // the lateral budget (latBudget, from computeMovementInputs). aLat is the
      // per-tick lateral Δv capacity (F/m rescaled by ACCEL_PER_TICK_FROM_SI so
      // vPerp/aLat compares like-with-like in the m/tick clock).
      const aLat = (latBudget / Math.max(ship.mass, 1)) * ACCEL_PER_TICK_FROM_SI;
      let lateralCmd = 0;
      if (aLat > 0) {
        const perpX = -Math.sin(ship.facing);
        const perpY = Math.cos(ship.facing);
        const vPerp = ship.velX * perpX + ship.velY * perpY;
        lateralCmd = Math.max(-1, Math.min(1, -vPerp / aLat));
      }
      // Fused force + lateral scan: one pass replaces shipForceAndTorque and
      // lateralForceAndTorque. `fy` is the engine force (boost/throttle-scaled
      // below); `latFy` is the lateral damper force (applied raw).
      const { fx, fy, torque, latFx, latFy, latTorque } = computeForceAndLateral(
        ship,
        turnSign,
        engineFire,
        thrustMode,
        lateralCmd,
      );
      // Afterburner/throttle scale the net engine force (and its torque) for the
      // window / a fine correction that does not slam full thrust.
      const throttle = cmd.throttle ?? 1;
      const lx = engineFire ? fx * boost.thrust * throttle : 0;
      const ly = engineFire ? fy * boost.thrust * throttle : 0;
      // Effective throttle (with afterburner) for the resource step's propellant
      // burn: fuel consumed in proportion to the thrust actually produced.
      if (engineFire) ship.engineThrottle = boost.thrust * throttle;
      const worldForce = rotateLocal(ship.facing, lx + latFx, ly + latFy);
      // Engine forces are catalogue Newtons, so F/m is an SI acceleration
      // (m/s²). World velocity is metres-per-TICK, so the per-tick velocity
      // increment is (F/m) / TICKS_PER_SECOND² (m/tick²) — acceleration crosses
      // the tick boundary squared (see ACCEL_PER_TICK_FROM_SI). Apply the factor
      // to the force ONCE here, so the resulting impulse is F·dt in the tick
      // clock; both integrator branches below then add a dimensionally-correct
      // momentum/velocity increment. (Previously the raw Newton force was added
      // as if it were m/tick², over-accelerating every ship by 900×.)
      const world = {
        x: worldForce.x * ACCEL_PER_TICK_FROM_SI,
        y: worldForce.y * ACCEL_PER_TICK_FROM_SI,
      };
      // Linear integration. The relativistic path routes the net world impulse
      // through `relativisticMomentumStep` (p = gamma·m·v, velocity bounded by
      // c); the Newtonian path adds Δv = impulse/m straight onto velocity. The
      // two agree bit-for-bit at combat speeds (gamma → 1) and diverge only as
      // the ship approaches c. Momentum is re-derived from the live velocity
      // inside the step, so the gravity/collision/recoil writes above this point
      // are preserved.
      if (USE_RELATIVISTIC_INTEGRATOR) {
        const next = relativisticMomentumStep(
          ship.velX,
          ship.velY,
          world.x,
          world.y,
          ship.mass,
        );
        ship.px = next.px;
        ship.py = next.py;
        ship.velX = next.vx;
        ship.velY = next.vy;
      } else {
        const invMass = 1 / Math.max(ship.mass, 1);
        ship.velX += world.x * invMass;
        ship.velY += world.y * invMass;
        ship.px = ship.velX * Math.max(ship.mass, 1);
        ship.py = ship.velY * Math.max(ship.mass, 1);
      }
      // Newtonian rotation: alpha = torque / I, rescaled into the per-tick clock
      // (rad/tick²) by angularAccelPerTick — the angular twin of the linear
      // ACCEL_PER_TICK_FROM_SI. The lateral engines' torque is included so the
      // attitude controller sees (and counters) any unbalanced lateral firing; a
      // balanced RCS pair contributes none.
      const totalTorque = torque + latTorque;
      ship.angVel += angularAccelPerTick(totalTorque, ship.momentOfInertia);
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
      ship.angVel += angularAccelPerTick(torque, ship.momentOfInertia);

      // Afterburner raises both the top speed and the acceleration for its
      // window; identity multiplier leaves the legacy scalar model unchanged.
      // The controller has already set `desiredFacing` so thrusting along it
      // moves the ship in the commanded world direction (for a braking
      // command, desiredFacing is flipped PI so forward thrust becomes a brake).
      const maxSpeed = ship.thrust * boost.thrust;
      // Per-tick acceleration step (m/tick²). thrust/mass is F/m, an SI
      // acceleration (m/s²); ACCEL_PER_TICK_FROM_SI rescales it into the m/tick
      // velocity clock (acceleration crosses the tick boundary squared) so the
      // `velX += dir * accel` step below adds a dimensionally-correct Δv. The
      // legacy maxSpeed cap is left as authored (a velocity ceiling in m/tick).
      const accel =
        ((ship.thrust * boost.thrust) / Math.max(ship.mass, 1)) *
        ACCEL_PER_TICK_FROM_SI;
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
      // Keep the momentum record in step with the legacy kinematic velocity.
      // The legacy branch is a velocity-target controller (not a force
      // integrator) with its own `maxSpeed` cap far below c, so the relativistic
      // momentum map is a no-op here (gamma ≈ 1); recording `m·v` keeps px/py
      // defined and consistent for every ship.
      const legacyMass = Math.max(ship.mass, 1);
      ship.px = ship.velX * legacyMass;
      ship.py = ship.velY * legacyMass;
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
    if (hasAnomaly(anomalies, "blackHole")) {
      const dist = Math.max(Math.hypot(ship.x, ship.y), SIM.blackHoleLethalRadius);
      phi = -SIM.blackHoleStrength / dist;
    }
    ship.dilationFactor = combinedDilation(speed, phi);
  }
}

