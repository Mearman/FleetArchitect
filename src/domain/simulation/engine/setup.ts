/**
 * Ship/module construction and the pure geometry helpers (angles, steering,
 * turret slewing, coordinate transforms) shared across the engine.
 */

import { CELL_SIZE } from "@/domain/grid";
import { DEFAULT_WEAPON_AMMO } from "@/schema/module";
import type { WeaponEffect } from "@/schema/module";
import type { Orders } from "@/schema/fleet";
import type { BattleInputs, CombatShip, ResolvedHardwire, ResolvedModule, SimCrew } from "../types";

import { CREW_HP, SIM } from "./config";
import { compareByCell } from "./crew-pathfinding";
import { recomputeAggregates, sumWeaponThrust } from "./physics";
import type { SimModule, SimShip } from "./types";

/**
 * Broad-phase bounding radius of a modular ship's cells about the ship origin:
 * the distance to the farthest alive cell centre plus half a cell, so the disc
 * encloses the whole footprint. Recomputed when modules change (cells die or a
 * chunk splits off) so the collision bound never lags the actual ship. Dead
 * modules are excluded — a stripped hulk has a smaller silhouette. Mirrors the
 * pure `deriveRadius` over the grid, but works on the resolved cell set the
 * engine already holds. Returns half a cell as a floor so even a single
 * surviving cell has a non-zero bound. */
export function gridRadius(modules: readonly SimModule[]): number {
  let maxDistSq = 0;
  for (const m of modules) {
    if (!m.alive) continue;
    const distSq = m.x * m.x + m.y * m.y;
    if (distSq > maxDistSq) maxDistSq = distSq;
  }
  return Math.sqrt(maxDistSq) + CELL_SIZE / 2;
}

export function maxWeaponRange(weapons: readonly WeaponEffect[]): number {
  if (weapons.length === 0) return SIM.defaultRange;
  let max = 0;
  for (const w of weapons) {
    if (w.range > max) max = w.range;
  }
  return max;
}

export function desiredRange(orders: Orders, weapons: readonly WeaponEffect[]): number {
  if (orders.engageRange === "hold") return 0;
  const base = maxWeaponRange(weapons) * SIM.rangeFraction[orders.engageRange];
  return base * SIM.stanceRangeFactor[orders.stance];
}

/**
 * The desired engagement range adjusted for the active anomaly. In a nebula
 * (halved projectile tracking) and an asteroid field (in-flight rounds
 * destroyed over time) a longer time-of-flight means fewer shots that land, so
 * ships should close to where their fire is effective; we scale the base
 * desired range down by the anomaly's factor. Black hole and "none" leave the
 * range untouched (the black hole is handled by avoidance steering, not by
 * range), so this is byte-identical to `desiredRange` for those cases.
 */
export function anomalyAdjustedRange(
  orders: Orders,
  weapons: readonly WeaponEffect[],
  anomaly: BattleInputs["anomaly"],
): number {
  const base = desiredRange(orders, weapons);
  if (anomaly === "nebula") return base * SIM.anomalyRangeFactor.nebula;
  if (anomaly === "asteroidField") return base * SIM.anomalyRangeFactor.asteroidField;
  return base;
}

/**
 * Avoidance weight for a ship at world distance `dist` from the black hole at
 * the origin: 0 when clear of the safety margin, ramping from `edgeWeight` up
 * to 1 as the ship closes from the margin edge to the lethal radius, and
 * saturating at 1 inside the lethal radius. The ramp is linear in distance so
 * the bias grows smoothly as the danger does. Returns 0 for any non-black-hole
 * call so the caller can invoke it unconditionally.
 */
export function blackHoleAvoidWeight(dist: number): number {
  const margin = SIM.blackHoleAvoid.safetyMargin * SIM.blackHoleTidalRadius;
  if (dist >= margin) return 0;
  if (dist <= SIM.blackHoleLethalRadius) return 1;
  // Fraction of the way from the margin edge (0) to the lethal radius (1).
  const span = margin - SIM.blackHoleLethalRadius;
  const depth = (margin - dist) / span;
  const { edgeWeight } = SIM.blackHoleAvoid;
  return edgeWeight + (1 - edgeWeight) * depth;
}

export function angleDifference(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Rotate `facing` toward `target` by at most `maxStep` radians. */
export function steer(facing: number, target: number, maxStep: number): number {
  const diff = angleDifference(facing, target);
  if (Math.abs(diff) <= maxStep) return target;
  return facing + Math.sign(diff) * maxStep;
}

/** Clamp a ship-local angle to the turret's traverse window
 *  `[weaponFacing - turretArc, weaponFacing + turretArc]`. Both the target
 *  offset and the limit are measured relative to the mount direction so the
 *  wrap-around is handled once, in `angleDifference`. */
export function clampToArc(weaponFacing: number, turretArc: number, desired: number): number {
  const offset = angleDifference(weaponFacing, desired);
  const clamped = Math.max(-turretArc, Math.min(turretArc, offset));
  return weaponFacing + clamped;
}

/**
 * Slew a turret's live barrel angle one tick toward a target and report
 * whether it can fire. A fixed mount (`turretTurnRate === 0`) leaves the
 * barrel on its mount direction and never gets here — the caller handles it
 * with the ship-facing firing arc. For a real turret:
 *
 *  - the desired barrel angle is the world bearing to the target brought into
 *    the ship's local frame and clamped to the traverse window about
 *    `weaponFacing`;
 *  - the live angle rotates toward that by at most `turretTurnRate`;
 *  - the turret may fire only once the barrel has slewed to within
 *    `SIM.firingArc` of the (clamped) desired angle — so a turret still
 *    swinging onto a fast-moving target holds fire until it bears.
 *
 * Returns the new live angle and the can-fire flag; the caller writes the
 * angle back onto the module (mutating `turretAngle`) and uses it for both
 * the shot direction and the recoil lever arm.
 */
export function slewTurret(
  m: SimModule,
  ship: SimShip,
  target: SimShip,
): { angle: number; canFire: boolean } {
  const worldBearing = Math.atan2(target.y - ship.y, target.x - ship.x);
  const localBearing = normaliseAngle(worldBearing - ship.facing);
  const desired = clampToArc(m.weaponFacing, m.turretArc, localBearing);
  const angle = steer(m.turretAngle, desired, m.turretTurnRate);
  const onTarget = Math.abs(angleDifference(angle, desired)) <= SIM.firingArc;
  // A target outside the traverse window can never be borne on, even with the
  // barrel at the arc limit: the desired angle is clamped, so the residual
  // bearing error tells us the shot is unreachable.
  const reachable = Math.abs(angleDifference(desired, localBearing)) <= SIM.firingArc;
  return { angle, canFire: onTarget && reachable };
}

export function toSimShip(ship: CombatShip, rng: () => number): SimShip {
  const weapons = ship.stats.weapons.map((w) => w.effect);
  const base: SimShip = {
    instanceId: ship.instanceId,
    faction: ship.faction,
    side: ship.side,
    classification: ship.classification,
    x: ship.position.x,
    y: ship.position.y,
    facing: ship.facing,
    velX: ship.velocity?.x ?? 0,
    velY: ship.velocity?.y ?? 0,
    angVel: 0,
    structure: ship.stats.structure,
    maxStructure: ship.stats.structure,
    shield: ship.stats.shieldCapacity,
    maxShield: ship.stats.shieldCapacity,
    shieldRechargeRate: ship.stats.shieldRechargeRate,
    shieldRechargeDelay: ship.stats.shieldRechargeDelay,
    shieldRegenCountdown: 0,
    // Adaptive shields and command auras default to inert: no ramp, no
    // untouched streak, no aura bonuses. recomputeAggregates derives the ramp
    // for modular ships with adaptive shields; the legacy aggregated path has
    // no module to carry an adaptiveRampRate, so it stays 0 and unchanged.
    shieldAdaptiveRamp: 0,
    shieldUntouchedTicks: 0,
    auraRangeBonus: 0,
    auraAccuracyBonus: 0,
    armourReduction: ship.stats.damageReduction,
    thrust: ship.stats.thrust,
    turnRate: ship.stats.turnRate,
    // Neutral placeholders: every modular ship has these overwritten by
    // recomputeAggregates (which derives mass, MoI, radius, and CoM from
    // the alive module grid). The values here are never read for a real
    // ship — they exist only so the SimShip literal type-checks before the
    // modular branch below fills them in.
    mass: 0,
    comX: 0,
    comY: 0,
    momentOfInertia: 0,
    radius: 0,
    cost: ship.stats.cost,
    weapons,
    // Stagger initial cooldowns so weapons don't all fire on tick 0.
    weaponCooldowns: weapons.map((w) => Math.floor(rng() * (w.cooldown + 1))),
    orders: ship.orders,
    target: undefined,
    alive: true,
    // No awareness yet — computeAwareness fills these from tick 0 onward.
    ghosts: [],
    awareness: new Map(),
    // Never fired yet: a cloaked ship begins fully cloaked, and no decloak
    // window is open. Read only by the cloak detectability rule.
    lastFiredTick: Number.NEGATIVE_INFINITY,
  };

  // Per-module path: build SimModule[] from the resolved modules and let
  // recomputeAggregates derive the live combat stats from the alive set.
  if (ship.modules !== undefined && ship.modules.length > 0) {
    base.modules = ship.modules.map((m) => toSimModule(m, rng));
    // Carry the resolved hardwires onto the ship and index them onto the sink
    // and source SimModules so the per-tick loop can read a module's feeding
    // links directly. Omitted entirely on unhardwired designs so behaviour is
    // byte-identical (no fields touched, no iteration).
    if (ship.hardwires !== undefined && ship.hardwires.length > 0) {
      base.hardwires = ship.hardwires;
      attachHardwires(base.modules, ship.hardwires);
    }
    base.hullBaseThrust = ship.stats.thrust - sumWeaponThrust(ship);
    base.crew = spawnCrew(base.instanceId, base.modules);
    recomputeAggregates(base);
    // Broad-phase radius is the grid bounding radius (the farthest cell
    // centre plus half a cell), derived from the module cells rather than a
    // per-class lookup, so the collision bound tracks the actual footprint.
    base.radius = gridRadius(base.modules);
    base.outline = ship.outline;
    // Shield starts full at the (recomputed) capacity; structure is the
    // hull's base integrity, independent of module HP.
    base.shield = base.maxShield;
    base.structure = ship.stats.structure;
    base.maxStructure = ship.stats.structure;
  }
  return base;
}

export function toSimModule(m: ResolvedModule, rng: () => number): SimModule {
  const effect = m.effect;
  const isWeapon = effect.kind === "weapon";
  const isPD = effect.kind === "pointDefense";
  return {
    slotId: m.slotId,
    moduleId: m.moduleId,
    kind: m.kind,
    col: m.col,
    row: m.row,
    x: m.x,
    y: m.y,
    surface: m.surface,
    edges: m.edges,
    surfaceHp: m.maxSurfaceHp,
    maxSurfaceHp: m.maxSurfaceHp,
    hp: m.maxScaffoldHp,
    maxHp: m.maxScaffoldHp,
    mass: m.mass,
    powerDraw: m.powerDraw,
    effect,
    // Stagger weapon cooldowns so they don't all fire on tick 0. PD modules
    // tick at their own cadence; everything else has no inter-tick timer.
    cooldown:
      isWeapon ? Math.floor(rng() * (effect.cooldown + 1)) :
      isPD ? Math.floor(rng() * (effect.cooldown + 1)) :
      0,
    // Weapons with finite ammo carry it through; without an explicit value
    // they get a large default so they effectively never run dry. PD is
    // unlimited by design — see PointDefenseEffect.
    ammo: isWeapon ? effect.ammo ?? DEFAULT_WEAPON_AMMO : 0,
    ammoStored: effect.kind === "magazine" ? effect.ammoStored : 0,
    // Start every power-drawing module with a full local buffer so a ship is
    // immediately live; modules out of crew reach then drain to zero and idle
    // until a power-run refills them. A reactor has no draw, so it carries no
    // buffer of its own — it is the source crew draw charge from.
    charge: m.powerDraw > 0 ? SIM.chargeBufferMax : 0,
    alive: true,
    powered: true,
    // A module that needs no crew is born manned; one that needs crew starts
    // unmanned and is only switched on once enough crew reach its cell. The
    // first updateCrew pass (tick 1) recomputes this from live positions.
    manned: m.crewRequired === 0,
    crewRequired: m.crewRequired,
    command: m.command,
    repairRate: m.repairRate,
    shieldArc: m.shieldArc,
    shieldFacing: m.shieldFacing,
facing: m.facing,
    weaponFacing: m.weaponFacing,
    turretArc: m.turretArc,
    turretTurnRate: m.turretTurnRate,
    // The barrel starts aligned with its mount direction; a turret slews it
    // toward the target from there each tick, a fixed mount leaves it.
    turretAngle: m.weaponFacing,
    // Comms channel, mount bearing, and live antenna bearing, copied off the
    // resolved module. The awareness phase recomputes dishAngle each tick (the
    // aim pass for dishes, mount + facing for the rest); it starts at the mount.
    channel: m.channel,
    commsBearing: m.commsBearing,
    dishAngle: m.commsBearing,
    ...(m.commsRange !== undefined ? { dishRangeSetting: m.commsRange } : {}),
    // Sensor mount bearing and variable range dial, copied off the resolved
    // module. The detection pass derives the live world cone from these.
    sensorBearing: m.sensorBearing,
    ...(m.sensorRangeSetting !== undefined
      ? { sensorRangeSetting: m.sensorRangeSetting }
      : {}),
    // Tech timers start idle: ready to fire (no cooldown) and inactive (no
    // active window). A non-tech module keeps both at 0 for its whole life.
    techCooldown: 0,
    techActive: 0,
    // Reactive armour starts charged (0 = ready). Non-armour and passive-armour
    // modules never set it, so it stays 0 and the reactive path stays inert.
    reactiveCharge: 0,
    // Mine-layer starts ready (0 = can lay). Only a mine-layer module ever sets
    // it, so every other module keeps it at 0 and never lays anything.
    mineCooldown: 0,
    // Boarding launcher starts ready (0 = can launch). Only a boarding module
    // ever sets it, so every other module keeps it at 0 and never launches.
    boardingCooldown: 0,
  };
}

/**
 * Index a ship's resolved hardwires onto its SimModules: each link is recorded
 * on its source module (`hardwireSources`) and its sink module
 * (`hardwireSinks`), so the per-tick loop can read a module's feeding source or
 * fed sinks without scanning the whole ship's link list. Only called when the
 * design had connections, so unhardwired ships never gain these arrays and stay
 * byte-identical. A link whose endpoint slot id has no matching module (e.g. it
 * referenced a non-module cell) is skipped — the resolver already filters those,
 * so this is belt-and-braces, not a behavioural fallback.
 */
export function attachHardwires(
  modules: SimModule[],
  hardwires: readonly ResolvedHardwire[],
): void {
  const bySlot = new Map(modules.map((m) => [m.slotId, m]));
  for (const link of hardwires) {
    const source = bySlot.get(link.sourceSlotId);
    const sink = bySlot.get(link.sinkSlotId);
    if (source === undefined || sink === undefined) continue;
    (source.hardwireSources ??= []).push(link);
    (sink.hardwireSinks ??= []).push(link);
  }
}

/**
 * Spawn the ship's crew from its crew-quarters cells. Each alive crew module
 * (`CrewEffect`) yields `capacity` crew members; every crew member starts on a
 * crew-quarters cell, distributed round-robin across the quarters in
 * `(col, row)` order so two ships built from the same design always spawn the
 * same crew on the same cells. Ids are stable and globally unique within the
 * run (`<instanceId>-crew-<n>`), which is also the fixed order crew are
 * iterated in for deterministic job assignment.
 *
 * A ship with no crew quarters spawns no crew — its crewed stations simply
 * stay unmanned, which the manning gate then keeps offline. No RNG is used.
 */
export function spawnCrew(
  instanceId: string,
  modules: readonly SimModule[],
): SimCrew[] {
  // Quarters cells, in deterministic (col, row) order. Crew stand on these
  // cells at spawn and round-robin across them.
  const quarters = modules
    .filter((m) => m.alive && m.effect.kind === "crew")
    .slice()
    .sort(compareByCell);
  if (quarters.length === 0) return [];

  let total = 0;
  for (const q of quarters) {
    if (q.effect.kind === "crew") total += Math.floor(q.effect.capacity);
  }
  if (total <= 0) return [];

  const crew: SimCrew[] = [];
  for (let n = 0; n < total; n += 1) {
    // Round-robin placement keeps quarters evenly populated and is a pure
    // function of the crew index, so it is fully deterministic.
    const cell = quarters[n % quarters.length];
    if (cell === undefined) break;
    crew.push({
      id: `${instanceId}-crew-${n}`,
      col: cell.col,
      row: cell.row,
      ox: 0,
      oy: 0,
      hp: CREW_HP,
      job: "idle",
      path: [],
      pathIndex: 0,
    });
  }
  return crew;
}

/** Wrap an angle to the (-π, π] interval so `angleDifference` works on it. */
export function normaliseAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** Rotate a world point into the ship's local frame (design coordinates). */
export function worldToLocal(
  ship: SimShip,
  x?: number,
  y?: number,
): { x: number; y: number } | undefined {
  if (x === undefined || y === undefined) return undefined;
  const cos = Math.cos(-ship.facing);
  const sin = Math.sin(-ship.facing);
  return {
    x: (x - ship.x) * cos - (y - ship.y) * sin,
    y: (x - ship.x) * sin + (y - ship.y) * cos,
  };
}

/** Rotate a ship-local point into world space (the inverse of `worldToLocal`). */
export function localPointToWorld(ship: SimShip, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(ship.facing);
  const s = Math.sin(ship.facing);
  return { x: ship.x + lx * c - ly * s, y: ship.y + lx * s + ly * c };
}

// ---------------------------------------------------------------------------
// Awareness phase (sensors, comms, fog of war)
//
// The whole phase is a pure function of ship state + occluders + anomaly. It
// draws ZERO times from the battle rng (occluders are pre-seeded separately),
// never reads Date/Math.random, and iterates every collection in a fixed
// instanceId / (shipId, slotId) order with all ties broken on stable string
// ids — so two runs with the same inputs produce byte-identical awareness.
//
// Faithful fog of war: every ship is fog-gated, with no omniscient fallback.
// A ship sees an enemy only when that enemy falls inside its own effective
// sensor reach or is shared over the comms graph. A ship carrying no sensor
// modules still has its innate visual line-of-sight radius and so detects
// nearby enemies, but nothing beyond it. A ship with empty awareness (no live
// contact, no ghost) does not hold position: it advances to contact toward the
// opposing side's deployment centroid (see `moveShips`) until something enters
// range.
// ---------------------------------------------------------------------------

/** Rotate a local (ship-frame) vector into world coordinates by `facing`. */
export function rotateLocal(facing: number, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: lx * c - ly * s, y: lx * s + ly * c };
}
