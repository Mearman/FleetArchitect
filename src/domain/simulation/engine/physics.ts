/**
 * Newtonian rigid-body physics: aggregate recomputation from the alive module
 * set, force/torque from thrust and gimballed engines, the bang-bang attitude
 * controller, and the centre-of-mass / tangential-velocity helpers.
 */

import type { WeaponEffect } from "@/schema/module";
import type { CombatShip } from "../types";

import { SIM } from "./config";
import { isCharged, isOperational } from "./crew";
import { angleDifference, gridRadius } from "./setup";
import type { SimModule, SimShip } from "./types";
/**
 * Which engines the force/torque computation should fire. The translation
 * controller chooses a thrust direction each tick; engines whose local force
 * does not contribute to that direction are not fired (so a balanced fore+aft
 * ship does not have its engines cancel). "all" fires every engine regardless
 * of direction — the default for tests and direct callers that are not using
 * the translation controller.
 */
export type ThrustMode = "all" | "prograde" | "retrograde";

/** Thrust contributed by engine modules (subtracted from the aggregate to
 *  recover the hull base, since stats.thrust already sums them in). */
export function sumWeaponThrust(ship: CombatShip): number {
  if (ship.modules === undefined) return 0;
  let sum = 0;
  for (const m of ship.modules) {
    if (m.effect.kind === "engine") sum += m.effect.thrust;
  }
  return sum;
}

/**
 * Resolve the power grid, then recompute the ship's aggregate combat stats
 * from the alive — and powered — module set.
 *
 * Power grid: reactors (power modules) supply a finite output each tick;
 * every other module draws from it. When total draw exceeds supply, the
 * most power-hungry modules go offline — weapons first, then shields —
 * until the budget balances. An unpowered weapon can't fire; an unpowered
 * shield stops regenerating. So a destroyed or inadequate reactor
 * actually degrades the ship's offence and defence.
 *
 * Keeping the aggregates in sync with module destruction and brownout
 * means the movement, firing, and shield-regen code reads live values.
 */
/**
 * Ship-local centre of mass of a module set, summed over the alive cells only
 * (the grid is the single source of truth for mass; there is no separate
 * hull-base point mass). Used both by recomputeAggregates (over a ship's own
 * modules) and by the break-apart momentum split (over a fragment's modules),
 * so the two stay in lockstep.
 */
export function localCentreOfMass(
  modules: readonly SimModule[],
): { x: number; y: number } {
  // The grid is the single source of truth for mass: only alive cells
  // contribute, and there is no separate hull-base point mass. A destroyed
  // cell is gone for CoM just as it is for mass, so the pivot shifts toward
  // what is left, and a chunk that splits off carries exactly its own cells'
  // CoM.
  let massSum = 0;
  let mx = 0;
  let my = 0;
  for (const m of modules) {
    if (!m.alive) continue;
    massSum += m.mass;
    mx += m.mass * m.x;
    my += m.mass * m.y;
  }
  if (massSum <= 0) return { x: 0, y: 0 };
  return { x: mx / massSum, y: my / massSum };
}

/**
 * The world-frame velocity a point gains from rigid-body spin: the parent's
 * linear velocity plus `ω × (pointCoM − parentCoM)`. The CoM offset is
 * ship-local, so it is rotated by the ship facing into world axes (matching
 * the world frame of velX/velY) before the 2D cross product
 * `ω × (rx, ry) = (−ω·ry, ω·rx)`.
 *
 * Exported for the break-apart momentum-conservation test: this is the exact
 * formula every fragment's linear velocity is built from, and conserving total
 * linear and angular momentum across a split is its defining property.
 */
export function comTangentialVelocity(
  facing: number,
  omega: number,
  parentVelX: number,
  parentVelY: number,
  offsetLocalX: number,
  offsetLocalY: number,
): { vx: number; vy: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  const offsetWorldX = offsetLocalX * c - offsetLocalY * s;
  const offsetWorldY = offsetLocalX * s + offsetLocalY * c;
  return {
    vx: parentVelX + -omega * offsetWorldY,
    vy: parentVelY + omega * offsetWorldX,
  };
}

export function recomputeAggregates(ship: SimShip): void {
  if (ship.modules === undefined) return;

  // 1. Supply from alive, manned reactors. A reactor that needs crew only
  //    outputs when its cell is manned — an unmanned reactor is cold.
  let supply = 0;
  for (const m of ship.modules) {
    if (m.alive && m.manned && m.effect.kind === "power") {
      supply += m.effect.output;
    }
  }
  // Reactor overcharge (factions update): every active overcharge module lifts
  // the power ceiling by its `powerSurge` for the duration of its window, so
  // more consumers stay online through a brownout. Activation lives in
  // `stepOvercharge` (driven by the brownout below); here we only fold in the
  // surge of modules already active. A ship with no active overcharge
  // contributes nothing, so the power budget is unchanged.
  for (const m of ship.modules) {
    if (m.effect.kind === "overcharge" && m.techActive > 0 && isOperational(m)) {
      supply += m.effect.powerSurge;
    }
  }

  // 2. Start every alive module powered; we'll disable the hungriest to
  //    fit the budget. Reactors themselves draw nothing.
  for (const m of ship.modules) {
    m.powered = m.alive && m.effect.kind !== "power";
  }

  // 3. Demand from powered consumers. If it exceeds supply, take the
  //    hungriest offline — weapons and PD first (PD is an active defence
  //    system, same priority class as offensive weapons), then shields —
  //    rechecking each time, until demand ≤ supply (or nothing is left to
  //    cut).
  const demandOf = (m: SimModule): number => (m.powered ? m.powerDraw : 0);
  let demand = 0;
  for (const m of ship.modules) demand += demandOf(m);

  while (demand > supply) {
    // Candidates to cut: powered weapons or PD modules, else powered shields.
    let victim: SimModule | undefined;
    let bestDraw = -1;
    for (const m of ship.modules) {
      if (!m.powered) continue;
      if (
        m.effect.kind !== "weapon" &&
        m.effect.kind !== "pointDefense" &&
        m.effect.kind !== "shield"
      ) {
        continue;
      }
      if (m.powerDraw > bestDraw) {
        bestDraw = m.powerDraw;
        victim = m;
      }
    }
    if (victim === undefined) break; // nothing power-hungry left to cut
    victim.powered = false;
    demand -= victim.powerDraw;
  }

  // 4. Build aggregates from alive + powered modules.
  let thrust = ship.hullBaseThrust ?? 0;
  // Grid-derived mass: the sum of every alive cell's mass. The hull is no
  // longer a per-class base point mass — a ship *is* its grid, so its mass is
  // exactly the mass of the cells it is built from. The legacy aggregated
  // path (no modules) keeps the per-class hull mass via toSimShip.
  let mass = 0;
  const armourReduction = 0;
  let shieldCapacity = 0;
  let shieldRechargeRate = 0;
  let shieldRechargeDelay = 0;
  let shieldAdaptiveRamp = 0;
  const weapons: WeaponEffect[] = [];
  const cooldowns: number[] = [];

  for (const m of ship.modules) {
    if (!m.alive) {
      mass += 0; // destroyed modules contribute neither mass nor function
      continue;
    }
    mass += m.mass;
    // Modules that are present (still massing the ship) but non-functional this
    // tick contribute nothing. A station works only when alive, powered (the
    // whole-ship brownout ceiling), manned, and locally charged. A module
    // needing no crew is always manned and one drawing no power is always
    // charged, so this gate is a no-op for simple crewless, draw-free designs.
    if (!m.powered || !m.manned || !isCharged(m)) continue;
    const effect = m.effect;
    switch (effect.kind) {
      case "weapon":
        weapons.push(effect);
        cooldowns.push(m.cooldown);
        break;
      case "shield":
        shieldCapacity += effect.capacity;
        shieldRechargeRate += effect.rechargeRate;
        shieldRechargeDelay = Math.max(shieldRechargeDelay, effect.rechargeDelay);
        // Adaptive shields: the best generator governs the whole-ship ramp, so a
        // mix of conventional and adaptive shields ramps at the strongest one's
        // rate rather than summing into a runaway. Omitted (conventional) shields
        // contribute 0, leaving the ship's ramp at 0 and the regen unchanged.
        if (effect.adaptiveRampRate !== undefined) {
          shieldAdaptiveRamp = Math.max(shieldAdaptiveRamp, effect.adaptiveRampRate);
        }
        break;
      case "engine":
        thrust += effect.thrust;
        break;
      case "power":
      case "crew":
      case "pointDefense":
      case "repair":
      case "hull":
      case "magazine":
      case "sensor": // Phase A: inert — no aggregate effect (detection is Phase C)
      case "comms":  // Phase A: inert — no aggregate effect (link logic is Phase C)
      case "rcs":          // torque handled in the modular shipForceAndTorque path
      case "reactionWheel": // torque handled in the modular shipForceAndTorque path
      case "blink": // tech modules (factions update): no aggregate contribution; active per-tick behaviour handled in the tick loop in later phases
      case "afterburner":
      case "overcharge":
      case "cloak":
      case "signature":
      case "ecm":
      case "eccm":
      case "decoy":
      case "commandAura":
      case "hangar":
      case "mineLayer":
      case "boarding":
        break;
    }
  }

  ship.thrust = thrust;
  ship.mass = mass;
  ship.armourReduction = armourReduction;
  ship.maxShield = shieldCapacity;
  ship.shieldRechargeRate = shieldRechargeRate;
  ship.shieldRechargeDelay = shieldRechargeDelay;
  ship.shieldAdaptiveRamp = shieldAdaptiveRamp;
  ship.shield = Math.min(ship.shield, shieldCapacity);
  ship.weapons = weapons;
  ship.weaponCooldowns = cooldowns;

  // Centre of mass and moment of inertia derived purely from the alive cells'
  // mass distribution — the grid is the single source of truth for mass, so a
  // destroyed cell is gone for CoM and MoI just as it is for mass. The pivot
  // sits at the mass-weighted centroid of the surviving cells; as cells are
  // shot away the CoM shifts toward what is left, and a chunk that splits off
  // carries exactly its own cells' CoM. No hull-base point mass is added — the
  // ship has no mass beyond its cells.
  const com = localCentreOfMass(ship.modules);
  const comX = com.x;
  const comY = com.y;
  let moi = 0;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const dx = m.x - comX;
    const dy = m.y - comY;
    moi += m.mass * (dx * dx + dy * dy);
  }
  ship.comX = comX;
  ship.comY = comY;
  // Floor MoI so a stripped-down ship still has some rotational inertia
  // and we never divide by zero in the angular-acceleration step.
  ship.momentOfInertia = Math.max(moi, 1);
  // Keep the broad-phase bound in step with the alive footprint: a ship that
  // has lost its outer cells has a smaller silhouette.
  ship.radius = gridRadius(ship.modules);
}

/** Whether the ship has at least one alive command (bridge) module. Ships
 *  without any command module cannot fire. A module at 0 hp counts as
 *  destroyed even before its `alive` flag is flipped, since destruction is
 *  hp-driven. */
export function hasAliveCommand(ship: SimShip): boolean {
  if (ship.modules === undefined) return true;
  for (const m of ship.modules) {
    if (m.command && m.alive && m.hp > 0) return true;
  }
  return false;
}

/** Sum the per-engine force (in ship-local axes) and the resulting torque
 *  (z-component of the cross product `r × F`, in ship-local units) for a
 *  modular ship. Engines that are not alive contribute nothing — a
 *  destroyed thruster stops thrusting. The returned force is in ship-local
 *  coordinates; the caller rotates it into world space using the ship's
 *  facing. Torque is computed about the ship's centre of mass: the lever
 *  arm is `(engine_pos − com)`, so an engine mounted exactly at the CoM
 *  produces pure linear thrust and zero spin regardless of its facing. */
/**
 * Net linear force, net torque, and maximum commandable torque for a modular
 * ship this tick, given the attitude controller's commanded turn sign
 * (`turnSign`: −1 clockwise, +1 counter-clockwise, 0 = no turn command).
 *
 * Four torque sources compose into one net torque about the centre of mass,
 * each gated by alive + powered + manned + charged:
 *
 *  1. Engine `r × F` — every alive engine's thrust applied at its lever arm
 *     from the CoM. Always present (off-centre or angled mounts spin the ship
 *     whether or not a turn is commanded), exactly as before.
 *  2. Gimbal vectoring — a gimballed engine (`gimbalArc > 0`) may swing its
 *     thrust vector by up to `gimbalArc` toward producing torque of the
 *     commanded sign. Deterministic rule: full deflection toward `turnSign`.
 *     We add the EXTRA torque the deflection buys over the nominal `r × F`
 *     (already counted in 1), and keep the linear force on the nominal vector
 *     so thrust-vectoring trades pure attitude authority without perturbing
 *     the translation model.
 *  3. RCS modules — bounded pure torque `turnSign · rcs.torque`, no translation.
 *  4. Reaction wheels — bounded pure internal torque `turnSign · wheel.torque`,
 *     no exhaust, position-independent.
 *
 * `maxTorque` is the total commandable torque magnitude the controller can
 * call on in either direction: gimbal differential authority + Σ|rcs.torque| +
 * Σ|wheel.torque|. It sizes the bang-bang controller's angular acceleration.
 * Engine `r × F` is NOT counted in `maxTorque` — it is an uncommandable
 * disturbance the controller works against, not authority it can steer with.
 */
/**
 * Net linear force (ship-local) and net torque for a modular ship this tick.
 *
 * `shouldThrust` gates whether engines are firing this tick: when false, engines
 * are off and contribute neither linear force nor geometric r × F torque —
 * only RCS and reaction wheels (pure-torque sources) remain active. This
 * matches the physical reality that you cannot have engine torque without
 * engine thrust.
 *
 * `turnSign` (−1 / 0 / +1) drives the commanded-torque sources: RCS, reaction
 * wheels, and gimballed engines add their torque in the commanded direction.
 * Engine r × F is present only when `shouldThrust` is true.
 */
export function shipForceAndTorque(
  ship: SimShip,
  turnSign: number,
  shouldThrust: boolean,
  thrustMode: ThrustMode = "all",
): { fx: number; fy: number; torque: number; maxTorque: number } {
  if (ship.modules === undefined) return { fx: 0, fy: 0, torque: 0, maxTorque: 0 };
  let fx = 0;
  let fy = 0;
  let torque = 0;
  let maxTorque = 0;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    // Every torque source runs only when powered, manned, and locally charged,
    // matching the gate the aggregate thrust total already applies. An
    // unmanned, browned-out, or uncharged module is dead weight this tick.
    if (!m.powered || !m.manned || !isCharged(m)) continue;
    const effect = m.effect;
    if (effect.kind === "engine") {
      // Engines only fire when the ship is thrusting. An off engine contributes
      // no linear force and no geometric torque — no thrust, no torque.
      if (!shouldThrust) continue;
      const t = effect.thrust;
      if (t <= 0) continue;
      // The translation controller directs thrust along a chosen axis. Only
      // engines whose local force contributes to the commanded direction fire:
      // prograde mode fires engines with forward (+x local) force, retrograde
      // mode fires engines with rearward (-x local) force. "all" (the default,
      // used by tests and direct callers) fires every engine regardless. This
      // is what lets a balanced fore+aft ship actually move — without the
      // filter, its forward and rear engines cancel.
      const fxLocalSign = -Math.cos(m.facing);
      if (thrustMode === "prograde" && fxLocalSign <= 0) continue;
      if (thrustMode === "retrograde" && fxLocalSign >= 0) continue;
      // A module's `facing` is its exhaust direction (where the nozzle/flame
      // points), matching how engines are authored — a rear-mounted engine
      // faces aft (π). Newton's third law: the thrust on the ship is OPPOSITE
      // the exhaust, so the force vector is `-(cos facing, sin facing) · thrust`.
      // A rear engine (facing π) therefore drives the ship forward (+x).
      const lx = -Math.cos(m.facing) * t;
      const ly = -Math.sin(m.facing) * t;
      fx += lx;
      fy += ly;
      // 2D cross product (z-component): r × F = rx*Fy − ry*Fx, where r is
      // measured from the centre of mass. Positive rotates counter-clockwise
      // (toward +y from +x). This is the nominal (un-gimballed) thrust torque.
      const rx = m.x - ship.comX;
      const ry = m.y - ship.comY;
      const nominalTorque = rx * ly - ry * lx;
      torque += nominalTorque;

      const gimbalArc = effect.gimbalArc ?? 0;
      if (gimbalArc > 0) {
        // Thrust direction (on the ship) is the exhaust direction + π. Swinging
        // the thrust vector by ±gimbalArc rotates that direction; the favourable
        // sign is the one that yields the larger torque toward the commanded
        // turn. The differential authority is the most extra torque a full
        // deflection can buy over the nominal — that is what the controller may
        // call on, so it feeds maxTorque regardless of whether a turn is
        // commanded this tick.
        const thrustDir = m.facing + Math.PI;
        const ccw = gimbalTorque(rx, ry, t, thrustDir, gimbalArc);
        const cw = gimbalTorque(rx, ry, t, thrustDir, -gimbalArc);
        // Best torque the gimbal can produce in each direction, relative to the
        // nominal already added above.
        const extraCcw = ccw - nominalTorque;
        const extraCw = cw - nominalTorque;
        maxTorque += Math.max(0, extraCcw, -extraCw);
        if (turnSign > 0 && extraCcw > 0) torque += extraCcw;
        else if (turnSign < 0 && extraCw < 0) torque += extraCw;
      }
    } else if (effect.kind === "rcs" || effect.kind === "reactionWheel") {
      // Pure commandable torque, either sign, no translation. RCS vents
      // reaction mass; a reaction wheel transfers internal momentum — both
      // appear here only as torque about the CoM, never as linear force.
      // These fire regardless of `shouldThrust` — attitude control is
      // independent of translation.
      maxTorque += effect.torque;
      torque += turnSign * effect.torque;
    }
  }
  return { fx, fy, torque, maxTorque };
}

/**
 * Maximum forward (prograde) and reverse (retrograde) thrust the ship's alive,
 * powered, manned, and charged engines can deliver along the ship's local +/-x
 * axis. For each engine the local force vector is `-(cos(facing), sin(facing))
 * · thrust` (the exhaust-opposite convention used by `shipForceAndTorque`); the
 * component that pushes the ship forward (+x local) is the dot product with
 * (+1, 0), clamped at 0, and the component that pushes it rearward (-x local)
 * is the dot product with (-1, 0), clamped at 0. Canted engines contribute only
 * their forward/aft component; the orthogonal part is ignored by the kinematic
 * controller and shows up as lateral drift — the intended emergent behaviour
 * for asymmetric fits.
 *
 * Afterburner is NOT folded in here: the caller applies `boost.thrust` to the
 * chosen direction, matching the existing integration pattern. The two values
 * are pure functions of module geometry; the caller divides by mass to get
 * accelerations for the stop-in-time controller (`a = thrust / mass`).
 *
 * A ship with only rear-facing engines (the common test-fixture case: exhaust
 * aft ⇒ forward thrust) has `prograde > 0` and `retrograde = 0` — it must flip
 * pi to brake. A ship with fore+aft thrusters has both positive and brakes
 * directly.
 */
export function availableThrust(
  ship: SimShip,
): { prograde: number; retrograde: number; lateral: number } {
  // Aggregated (non-modular) ship: a scalar-thrust abstraction with no module
  // geometry. The legacy movement branch drives it along ship.facing in either
  // direction, so it is modelled as a balanced ship that can brake directly —
  // prograde, retrograde, and lateral all equal its scalar `thrust`. (Phase 1
  // removes aggregated ships entirely; until then the controller must not
  // freeze them.)
  if (ship.modules === undefined) {
    return { prograde: ship.thrust, retrograde: ship.thrust, lateral: ship.thrust };
  }
  let prograde = 0;
  let retrograde = 0;
  let lateralPlus = 0;
  let lateralMinus = 0;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    if (!m.powered || !m.manned || !isCharged(m)) continue;
    const effect = m.effect;
    if (effect.kind !== "engine") continue;
    const t = effect.thrust;
    if (t <= 0) continue;
    // Local force on the ship is opposite the exhaust direction.
    const fxLocal = -Math.cos(m.facing) * t;
    const fyLocal = -Math.sin(m.facing) * t;
    // An engine is lateral when its force is more ±y than ±x (exhaust nearer
    // ±π/2); otherwise it is fore/aft. Fore/aft contributes prograde (+x) or
    // retrograde (−x); lateral contributes +y or −y. `lateral` is the
    // symmetric per-direction budget (min of the two sides) so the controller
    // can command either direction up to the same limit.
    if (Math.abs(fyLocal) > Math.abs(fxLocal)) {
      if (fyLocal > 0) lateralPlus += fyLocal;
      else lateralMinus += -fyLocal;
    } else if (fxLocal > 0) prograde += fxLocal;
    else if (fxLocal < 0) retrograde += -fxLocal;
  }
  return {
    prograde,
    retrograde,
    lateral: Math.min(lateralPlus, lateralMinus),
  };
}

/**
 * Linear force from the ship's lateral (RCS translation) engines fired at
 * signed throttle `lateral` (positive = local +y, negative = −y). A lateral
 * engine is one whose force is more ±y than ±x; only those pushing the
 * commanded direction fire, each at `|lateral|` throttle. This is the channel
 * that lets a ship cancel perpendicular drift WITHOUT turning to face it — so
 * facing (to aim weapons) and translation (to station-keep) decouple.
 *
 * The net force is applied at the centre of mass (zero torque): like a real
 * RCS translation controller, the flight computer fires the thruster
 * combination that produces pure translation, differentially throttling to
 * cancel the geometric torque. Modelling the cancellation here (rather than
 * demanding the fixture place thrusters exactly on the CoM line) keeps the
 * translation channel independent of the attitude channel — a translation
 * command never spins the ship.
 */
export function lateralForceAndTorque(
  ship: SimShip,
  lateral: number,
): { fx: number; fy: number; torque: number } {
  if (ship.modules === undefined || lateral === 0) {
    return { fx: 0, fy: 0, torque: 0 };
  }
  let fy = 0;
  const throttle = Math.min(1, Math.abs(lateral));
  for (const m of ship.modules) {
    if (!m.alive || !m.powered || !m.manned || !isCharged(m)) continue;
    const effect = m.effect;
    if (effect.kind !== "engine") continue;
    const t = effect.thrust;
    if (t <= 0) continue;
    const lxUnit = -Math.cos(m.facing);
    const lyUnit = -Math.sin(m.facing);
    if (Math.abs(lyUnit) <= Math.abs(lxUnit)) continue; // fore/aft, not lateral
    // Fire only engines that push the commanded lateral direction.
    if (lateral > 0 && lyUnit <= 0) continue;
    if (lateral < 0 && lyUnit >= 0) continue;
    fy += lyUnit * t * throttle;
  }
  return { fx: 0, fy, torque: 0 };
}

/**
 * Torque about the CoM from a gimballed engine whose thrust vector points in
 * world-of-ship-local direction `thrustDir + delta`, at lever arm `(rx, ry)`
 * and thrust magnitude `t`. `delta` is the gimbal deflection (clamped by the
 * caller to ±gimbalArc). 2D cross product `r × F`.
 */
export function gimbalTorque(
  rx: number,
  ry: number,
  t: number,
  thrustDir: number,
  delta: number,
): number {
  const a = thrustDir + delta;
  const fxg = Math.cos(a) * t;
  const fyg = Math.sin(a) * t;
  return rx * fyg - ry * fxg;
}

/**
 * Maximum commandable torque magnitude available to the attitude controller
 * this tick. For modular ships this is the sum of gimbal differential authority
 * + Σ|rcs.torque| + Σ|wheel.torque| (the commandable sources only — engine
 * r × F is an uncommandable disturbance, not authority). For legacy ships it
 * is turnRate × mass (the scalar authority derived from ShipStats.turnRate),
 * matching the torque the legacy integration path applies.
 *
 * Deterministic: a pure function of the ship's module state, no RNG.
 */
/**
 * Maximum commandable torque for a ship, given whether its engines are firing
 * this tick. Gimbal authority is only available when the engine fires; RCS and
 * reaction wheels are available regardless. Engine r × F is NOT authority —
 * it is an uncommandable disturbance. For legacy ships the scalar turnRate is
 * always the authority (engines are abstracted away).
 */
export function maxCommandableTorque(ship: SimShip, shouldThrust = false): number {
  if (ship.modules !== undefined) {
    let maxTorque = 0;
    const comX = ship.comX;
    const comY = ship.comY;
    for (const m of ship.modules) {
      if (!m.alive || !m.powered || !m.manned || !isCharged(m)) continue;
      const effect = m.effect;
      if (effect.kind === "engine") {
        // Gimbal authority only exists when the engine is firing.
        if (!shouldThrust) continue;
        const gimbalArc = effect.gimbalArc ?? 0;
        if (gimbalArc <= 0) continue;
        const t = effect.thrust;
        if (t <= 0) continue;
        const rx = m.x - comX;
        const ry = m.y - comY;
        const thrustDir = m.facing + Math.PI;
        const lx = -Math.cos(m.facing) * t;
        const ly = -Math.sin(m.facing) * t;
        const nominalTorque = rx * ly - ry * lx;
        const ccw = gimbalTorque(rx, ry, t, thrustDir, gimbalArc);
        const cw = gimbalTorque(rx, ry, t, thrustDir, -gimbalArc);
        const extraCcw = ccw - nominalTorque;
        const extraCw = cw - nominalTorque;
        maxTorque += Math.max(0, extraCcw, -extraCw);
      } else if (effect.kind === "rcs" || effect.kind === "reactionWheel") {
        maxTorque += effect.torque;
      }
    }
    return maxTorque;
  }
  return ship.turnRate * ship.mass;
}

/**
 * Net uncommandable (geometric) torque on a modular ship from the r × F of
 * its engines in their nominal (un-gimballed) facing, when firing
 * (`shouldThrust = true`). Engine torque only exists when engines fire; when
 * the ship is not thrusting (`shouldThrust = false`), the geometric disturbance
 * is zero. Returns 0 for legacy ships (their scalar integration has no
 * geometric term). Used by the bang-bang controller to compute accurate
 * stopping-angle estimates.
 */
export function geometricTorque(ship: SimShip, shouldThrust: boolean): number {
  if (ship.modules === undefined || !shouldThrust) return 0;
  let torque = 0;
  const comX = ship.comX;
  const comY = ship.comY;
  for (const m of ship.modules) {
    if (!m.alive || !m.powered || !m.manned || !isCharged(m)) continue;
    if (m.effect.kind !== "engine") continue;
    const t = m.effect.thrust;
    if (t <= 0) continue;
    const lx = -Math.cos(m.facing) * t;
    const ly = -Math.sin(m.facing) * t;
    const rx = m.x - comX;
    const ry = m.y - comY;
    torque += rx * ly - ry * lx;
  }
  return torque;
}

/**
 * Bang-bang minimum-time attitude controller. Decides the commanded turn sign
 * (−1 clockwise, +1 counter-clockwise, 0 = hold) to bring `ship.facing` to
 * `desiredFacing` with `angVel → 0` on arrival.
 *
 * Algorithm (all quantities in radians / radians-per-tick):
 *
 *  e = angleDifference(facing, desiredFacing) — heading error, signed.
 *  w = ship.angVel — current angular velocity.
 *  α = mct / momentOfInertia — maximum commandable angular acceleration.
 *  g = geometricTorque / momentOfInertia — constant disturbance angular accel
 *      from off-centre / angled engine r × F (zero for legacy ships).
 *
 *  If α ≤ 0 (no torque authority): command 0 — ship cannot rotate.
 *
 *  Effective braking alpha: when braking against spin of sign `s`, the
 *  net deceleration is (mct − s·g_torque) / I. If geometric torque opposes
 *  the brake (g in same direction as spin), effective braking is reduced; if
 *  it helps (g opposes spin), braking is enhanced. We use the pessimistic
 *  (minimum) effective braking alpha so the stopping-angle estimate errs on
 *  the side of braking early rather than late — preventing overshoot.
 *
 *  Stopping angle eStop = w² / (2·αBrake): angle consumed braking |w| → 0.
 *  (Slight overestimate vs the exact discrete distance — see
 *  `discreteStoppingAngle`. Load-bearing: causes earlier braking so the ship
 *  arrives within the settle deadband.)
 *
 *  Settle deadband: if |e| ≤ deadband: command 0 for the caller to snap to
 *  rest. Without angular damping, clamping within the deadband is the only
 *  thing that prevents a bang-bang limit cycle around the target heading.
 *
 *  Brake if: spinning toward target and would overshoot (eStop ≥ |e|), OR
 *  spinning away from target — command −sign(w).
 *
 *  Otherwise: command sign(e) to accelerate toward the target.
 *
 * `mct` is pre-computed by the caller (via `maxCommandableTorque`) so the
 * settle-snap logic after integration can reuse the same value without a
 * second module scan.
 *
 * Deterministic: a pure function of ship state and the desired heading —
 * no RNG, clock, or Map/Set iteration-order dependence.
 */
/**
 * Stopping angle for an angular velocity `w` braking at a constant angular
 * acceleration `alphaBrake` per tick. Returns the continuous closed form
 * `w^2 / (2 * alphaBrake)`, which slightly overestimates the actual
 * forward-Euler discrete stopping distance (the integrator decrements
 * velocity before adding it to the heading, so the true stop is ~|w|/2
 * shorter). The overestimate is deliberate and load-bearing for the bang-bang
 * attitude controller: braking a tick early makes the ship arrive at the
 * target heading with angVel at or below one tick of braking authority
 * (`|w| <= alpha`), which is exactly the condition the post-integration
 * deadband settle snap needs to clamp the ship cleanly to rest. Using the
 * exact discrete distance instead causes a stable limit cycle under
 * frictionless integration (no damping to decay the residual angVel).
 *
 * Returns `Infinity` when `alphaBrake <= 0` (no commandable braking
 * authority — the ship cannot stop its spin and coasts forever; the
 * controller then never commands a brake, the correct emergent behaviour).
 *
 * Returns the angle (positive, unsigned) consumed from |w| to 0.
 */
export function discreteStoppingAngle(w: number, alphaBrake: number): number {
  if (alphaBrake <= 0) return Infinity;
  const wAbs = Math.abs(w);
  return (wAbs * wAbs) / (2 * alphaBrake);
}

export function commandedTurn(
  ship: SimShip,
  desiredFacing: number,
  mct: number,
  shouldThrust: boolean,
): -1 | 0 | 1 {
  const e = angleDifference(ship.facing, desiredFacing);
  const w = ship.angVel;
  const I = ship.momentOfInertia;
  const alpha = I > 0 ? mct / I : 0;

  // No commandable torque authority — cannot steer.
  if (alpha <= 0) return 0;

  // Net geometric disturbance angular acceleration (uncommandable r × F).
  // Only non-zero when engines are actually firing this tick.
  const gTorque = geometricTorque(ship, shouldThrust);
  const gAlpha = I > 0 ? gTorque / I : 0;

  // Settle deadband: the ship is close enough to the target that this tick's
  // angular displacement will carry it across (or it is within the static
  // heading tolerance). Command no turn so the post-integration snap in
  // moveShips clamps the ship cleanly to rest at the target heading. Without
  // angular damping the snap is the only thing that ends the bang-bang limit
  // cycle around the target: the discrete controller cannot zero angVel
  // exactly at the target under forward Euler, so without the clamp the ship
  // oscillates forever. Using |w| (the per-tick angular step) as the deadband
  // when |w| > angularDeadband ensures the snap fires the tick the ship
  // reaches the target, not a tick later when it has already overshot. The
  // alpha > 0 guard above ensured the ship has real steering authority.
  if (Math.abs(e) <= Math.max(Math.abs(w), SIM.angularDeadband)) {
    return 0;
  }

  // Effective braking alpha: the net deceleration when applying counter-torque
  // (-mct) against the geometric disturbance. When geo torque is in the same
  // direction as spin (hindrance), effective braking is reduced; when it
  // opposes spin (helps brake), effective braking is enhanced. Clamped to 0 if
  // the geometric torque overwhelms the commandable authority — without
  // damping the ship cannot actively decelerate, so it coasts on spin until the
  // engines stop firing or are destroyed. This is the correct emergent
  // behaviour for an unbalanced thrust arrangement.
  const spinSign = w > 0 ? 1 : w < 0 ? -1 : 0;
  const hindrance = spinSign * gAlpha > 0 ? spinSign * gAlpha : 0;
  const alphaBrake = Math.max(alpha - hindrance, 0);

  // Stopping angle: `w²/(2·alphaBrake)`. See discreteStoppingAngle for why
  // the slight overestimate vs the exact discrete distance is load-bearing
  // for convergence under frictionless integration.
  const eStop = discreteStoppingAngle(w, alphaBrake);

  // Brake if spinning toward the target but would overshoot, or spinning away.
  if (w !== 0 && (Math.sign(w) === Math.sign(e) ? eStop >= Math.abs(e) : true)) {
    if (w > 0) return -1;
    return 1;
  }

  // Accelerate toward the target.
  if (e > 0) return 1;
  return -1;
}
