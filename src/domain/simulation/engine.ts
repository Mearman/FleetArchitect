import { createId, nowIso } from "@/domain/id";
import { mulberry32, ranged } from "@/domain/simulation/rng";
import type { BattleFrame, BattleResult, BattleSide } from "@/schema/battle";
import type { ShipClassification } from "@/schema/hull";
import type { WeaponEffect, WeaponType } from "@/schema/module";
import type { Orders } from "@/schema/fleet";
import type { BattleInputs, CombatShip } from "./types";

/**
 * Deterministic battle simulator. Given resolved combat ships, an anomaly, and
 * a seed, advance a fixed-timestep simulation to completion and return a
 * replayable BattleResult whose frames conform to the battle schema.
 *
 * The whole battle is a pure function of its inputs: every random draw flows
 * through one seeded generator, and the per-tick update order is fixed, so two
 * runs with identical BattleInputs produce byte-identical frames.
 */

/** Tunable gameplay constants. All "feel" lives here as named values. */
const SIM = {
  /** Half-angle (radians) either side of a ship's facing within which its
   *  weapons may fire. ~1.2 rad ≈ 69°, a generous forward arc. */
  firingArc: 1.2,
  /** Units forward of a ship's centre where projectiles spawn. */
  muzzleOffset: 6,
  /** Fallback engagement range (battle units) for ships with no weapons. */
  defaultRange: 220,
  /** Fraction of its max weapon range a ship tries to keep from its target. */
  rangeFraction: {
    short: 0.3,
    medium: 0.55,
    long: 0.85,
  },
  /** Multiplier applied to the desired range based on engagement stance. */
  stanceRangeFactor: {
    aggressive: 0.8,
    balanced: 1.0,
    defensive: 1.15,
    evasive: 1.4,
  },
  /** Once within this fraction of the desired range, a ship stops closing. */
  rangeBand: 0.85,
  /** Approximate collision radius per hull classification, in battle units. */
  radius: {
    fighter: 9,
    frigate: 16,
    cruiser: 26,
    dreadnought: 38,
  },
  /**
   * Base structural mass of each hull class, added to the sum of installed
   * module masses to give a ship's total mass. Acceleration is
   * `thrust / mass`, so heavier ships build speed more slowly even
   * though their top speed (set by `thrust`) is unchanged.
   */
  hullMass: {
    fighter: 5,
    frigate: 15,
    cruiser: 40,
    dreadnought: 100,
  },
  /** Black-hole gravity strength and lethal proximity. */
  blackHolePull: 0.9,
  blackHoleLethalRadius: 24,
  blackHoleDamage: 12,
  /** Nebula dampens shield regeneration and projectile tracking. */
  nebulaRegenFactor: 0.5,
  nebulaTrackingFactor: 0.5,
  /** Per-tick chance an asteroid field destroys a passing projectile. */
  asteroidDeflectChance: 0.01,
  /**
   * Per-tick multiplicative drag on linear and angular velocity. A small drag
   * is a gameplay compromise: real space is frictionless (ships would coast
   * forever), but unbounded drift makes battles unreadable. 0.97 ≈ 0.5 s
   * half-life at 30 ticks/s — momentum is felt, but ships settle.
   */
  linearDamping: 0.97,
  angularDamping: 0.9,
};

/** Mutable per-ship runtime state carried across ticks. */
interface SimShip {
  instanceId: string;
  side: "attacker" | "defender";
  classification: ShipClassification;
  x: number;
  y: number;
  facing: number;
  /** Linear velocity (world units per tick). Persists across ticks — momentum. */
  velX: number;
  velY: number;
  /** Angular velocity (radians per tick). Persists — angular momentum. */
  angVel: number;
  structure: number;
  maxStructure: number;
  shield: number;
  maxShield: number;
  shieldRechargeRate: number;
  shieldRechargeDelay: number;
  shieldRegenCountdown: number;
  armourReduction: number;
  thrust: number;
  turnRate: number;
  /** Total ship mass (hull base + installed modules). Drives acceleration. */
  mass: number;
  radius: number;
  cost: number;
  weapons: readonly WeaponEffect[];
  weaponCooldowns: number[];
  orders: Orders;
  target: string | undefined;
  alive: boolean;
}

/** Mutable in-flight projectile. */
interface SimProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: WeaponType;
  damage: number;
  tracking: number;
  shieldPiercing: number;
  armourPiercing: number;
  range: number;
  travelled: number;
  ttl: number;
  ownerId: string;
  ownerSide: "attacker" | "defender";
  targetId: string;
}

function radiusFor(classification: ShipClassification): number {
  return SIM.radius[classification];
}

function maxWeaponRange(weapons: readonly WeaponEffect[]): number {
  if (weapons.length === 0) return SIM.defaultRange;
  let max = 0;
  for (const w of weapons) {
    if (w.range > max) max = w.range;
  }
  return max;
}

function desiredRange(orders: Orders, weapons: readonly WeaponEffect[]): number {
  if (orders.engageRange === "hold") return 0;
  const base = maxWeaponRange(weapons) * SIM.rangeFraction[orders.engageRange];
  return base * SIM.stanceRangeFactor[orders.stance];
}

function angleDifference(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Rotate `facing` toward `target` by at most `maxStep` radians. */
function steer(facing: number, target: number, maxStep: number): number {
  const diff = angleDifference(facing, target);
  if (Math.abs(diff) <= maxStep) return target;
  return facing + Math.sign(diff) * maxStep;
}

function toSimShip(ship: CombatShip, rng: () => number): SimShip {
  const weapons = ship.stats.weapons.map((w) => w.effect);
  return {
    instanceId: ship.instanceId,
    side: ship.side,
    classification: ship.classification,
    x: ship.position.x,
    y: ship.position.y,
    facing: ship.facing,
    velX: 0,
    velY: 0,
    angVel: 0,
    structure: ship.stats.structure,
    maxStructure: ship.stats.structure,
    shield: ship.stats.shieldCapacity,
    maxShield: ship.stats.shieldCapacity,
    shieldRechargeRate: ship.stats.shieldRechargeRate,
    shieldRechargeDelay: ship.stats.shieldRechargeDelay,
    shieldRegenCountdown: 0,
    armourReduction: ship.stats.damageReduction,
    thrust: ship.stats.thrust,
    turnRate: ship.stats.turnRate,
    mass: SIM.hullMass[ship.classification] + ship.stats.mass,
    radius: radiusFor(ship.classification),
    cost: ship.stats.cost,
    weapons,
    // Stagger initial cooldowns so weapons don't all fire on tick 0.
    weaponCooldowns: weapons.map((w) => Math.floor(rng() * (w.cooldown + 1))),
    orders: ship.orders,
    target: undefined,
    alive: true,
  };
}

function pickTarget(ship: SimShip, enemies: readonly SimShip[]): SimShip | undefined {
  const living = enemies.filter((e) => e.alive);
  if (living.length === 0) return undefined;
  let best: SimShip | undefined;
  let bestScore = -Infinity;
  for (const enemy of living) {
    const distSq = (enemy.x - ship.x) ** 2 + (enemy.y - ship.y) ** 2;
    let score: number;
    switch (ship.orders.targetPriority) {
      case "nearest":
        score = -distSq;
        break;
      case "weakest":
        score = -(enemy.structure + enemy.shield);
        break;
      case "strongest":
        score = enemy.structure + enemy.shield;
        break;
      case "highestCost":
        score = enemy.cost;
        break;
    }
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/**
 * Apply incoming weapon damage to a ship's shields then structure. Shields
 * absorb the non-pierced fraction first; whatever spills over hits structure,
 * reduced by armour (itself weakened by armour piercing). Any shield contact
 * resets the shield regeneration delay.
 */
function applyDamage(
  ship: SimShip,
  damage: number,
  shieldPiercing: number,
  armourPiercing: number,
): void {
  const bypass = damage * shieldPiercing;
  const toShield = damage - bypass;
  const shieldAbsorbed = Math.min(ship.shield, toShield);
  ship.shield -= shieldAbsorbed;
  if (shieldAbsorbed > 0) {
    ship.shieldRegenCountdown = ship.shieldRechargeDelay;
  }
  const spill = toShield - shieldAbsorbed;
  const rawStructure = bypass + spill;
  const effectiveReduction = ship.armourReduction * (1 - armourPiercing);
  const finalStructure = rawStructure * (1 - effectiveReduction);
  ship.structure -= finalStructure;
  if (ship.structure <= 0) {
    ship.structure = 0;
    ship.alive = false;
  }
}

function spawnProjectile(
  owner: SimShip,
  weapon: WeaponEffect,
  target: SimShip,
  rng: () => number,
): SimProjectile {
  const aimAngle = Math.atan2(target.y - owner.y, target.x - owner.x);
  const spread = weapon.spread > 0 ? ranged(rng, -weapon.spread, weapon.spread) : 0;
  const angle = aimAngle + spread;
  const muzzleX = owner.x + Math.cos(owner.facing) * SIM.muzzleOffset;
  const muzzleY = owner.y + Math.sin(owner.facing) * SIM.muzzleOffset;
  const ttl = Math.ceil((weapon.range + 40) / Math.max(weapon.projectileSpeed, 1));
  return {
    x: muzzleX,
    y: muzzleY,
    vx: Math.cos(angle) * weapon.projectileSpeed,
    vy: Math.sin(angle) * weapon.projectileSpeed,
    kind: weapon.weaponType,
    damage: weapon.damage,
    tracking: weapon.tracking,
    shieldPiercing: weapon.shieldPiercing,
    armourPiercing: weapon.armourPiercing,
    range: weapon.range,
    travelled: 0,
    ttl,
    ownerId: owner.instanceId,
    ownerSide: owner.side,
    targetId: target.instanceId,
  };
}

function isRetreating(ship: SimShip): boolean {
  return (
    ship.maxStructure > 0 &&
    ship.structure / ship.maxStructure < ship.orders.retreatThreshold
  );
}

export function runBattle(inputs: BattleInputs): BattleResult {
  const rng = mulberry32(inputs.seed >>> 0);
  const ships = inputs.ships.map((s) => toSimShip(s, rng));
  const attackers = ships.filter((s) => s.side === "attacker");
  const defenders = ships.filter((s) => s.side === "defender");
  const byId = new Map(ships.map((s) => [s.instanceId, s]));
  let projectiles: SimProjectile[] = [];

  const frames: BattleFrame[] = [snapshot(0, ships, projectiles)];

  let winner: BattleSide = "draw";
  let resolved = false;

  for (let tick = 1; tick <= inputs.maxTicks; tick++) {
    // 1. Targeting.
    for (const ship of ships) {
      if (!ship.alive) continue;
      const enemies = ship.side === "attacker" ? defenders : attackers;
      ship.target = pickTarget(ship, enemies)?.instanceId;
    }

    // 2. Movement + facing.
    moveShips(ships, byId, inputs.anomaly);

    // 3. Weapon firing (creates projectiles; hitscan applies damage at once).
    projectiles = projectiles.concat(fireWeapons(ships, byId, rng));

    // 4. Projectile travel, homing, asteroid deflection, and collision.
    projectiles = updateProjectiles(projectiles, byId, inputs.anomaly, rng);

    // 5. Shield regeneration.
    const regenFactor = inputs.anomaly === "nebula" ? SIM.nebulaRegenFactor : 1;
    for (const ship of ships) {
      if (!ship.alive || ship.shield >= ship.maxShield) continue;
      if (ship.shieldRegenCountdown > 0) {
        ship.shieldRegenCountdown -= 1;
      } else {
        ship.shield = Math.min(
          ship.maxShield,
          ship.shield + ship.shieldRechargeRate * regenFactor,
        );
      }
    }

    frames.push(snapshot(tick, ships, projectiles));

    // 6. Termination.
    const attackerAlive = attackers.some((s) => s.alive);
    const defenderAlive = defenders.some((s) => s.alive);
    if (!attackerAlive && !defenderAlive) {
      winner = "draw";
      resolved = true;
      break;
    }
    if (!attackerAlive) {
      winner = "defender";
      resolved = true;
      break;
    }
    if (!defenderAlive) {
      winner = "attacker";
      resolved = true;
      break;
    }
  }

  // Ran out of ticks without a decisive end: decide by remaining hit points.
  if (!resolved) {
    winner = leadingSide(attackers, defenders);
  }

  return {
    id: createId("battle"),
    config: {
      attackerFleetId: inputs.attackerFleetId,
      defenderFleetId: inputs.defenderFleetId,
      anomaly: inputs.anomaly,
      seed: inputs.seed,
    },
    winner,
    ticks: frames.length - 1,
    playedAt: nowIso(),
    frames,
  };
}

function leadingSide(
  attackers: readonly SimShip[],
  defenders: readonly SimShip[],
): BattleSide {
  const total = (group: readonly SimShip[]) =>
    group.reduce((sum, s) => sum + s.structure + s.shield, 0);
  const a = total(attackers);
  const d = total(defenders);
  if (a > d) return "attacker";
  if (d > a) return "defender";
  return "draw";
}

function moveShips(
  ships: readonly SimShip[],
  byId: Map<string, SimShip>,
  anomaly: BattleInputs["anomaly"],
): void {
  for (const ship of ships) {
    if (!ship.alive) continue;

    // Black-hole gravity pulls every ship toward the arena centre.
    if (anomaly === "blackHole") {
      const dist = Math.hypot(ship.x, ship.y);
      const pull = SIM.blackHolePull * (1 + 200 / Math.max(dist, 1));
      ship.x += (0 - ship.x) / Math.max(dist, 1) * pull;
      ship.y += (0 - ship.y) / Math.max(dist, 1) * pull;
      if (Math.hypot(ship.x, ship.y) < SIM.blackHoleLethalRadius) {
        ship.structure -= SIM.blackHoleDamage;
        if (ship.structure <= 0) {
          ship.structure = 0;
          ship.alive = false;
        }
      }
    }

    if (!ship.alive) continue;
    const target = ship.target !== undefined ? byId.get(ship.target) : undefined;
    if (target === undefined) continue;

    const dx = target.x - ship.x;
    const dy = target.y - ship.y;
    const dist = Math.hypot(dx, dy);

    let desiredFacing: number;
    let shouldThrust: boolean;
    let reverse = false;
    if (isRetreating(ship)) {
      // Turn tail and flee; retreating ships do not fire.
      desiredFacing = Math.atan2(-dy, -dx);
      shouldThrust = true;
    } else if (ship.orders.engageRange === "hold") {
      desiredFacing = Math.atan2(dy, dx);
      shouldThrust = false;
    } else {
      const want = desiredRange(ship.orders, ship.weapons);
      if (dist > want * SIM.rangeBand) {
        desiredFacing = Math.atan2(dy, dx);
        shouldThrust = true;
      } else if (dist < want * SIM.rangeBand * 0.6) {
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

    // Angular: apply torque toward desiredFacing (capped by turnRate as an
    // angular-acceleration cap). angVel persists, with mild damping so the
    // ship settles on aim.
    const angError = angleDifference(ship.facing, desiredFacing);
    const maxTurn = ship.turnRate;
    const angAccel = Math.abs(angError) <= maxTurn ? angError : Math.sign(angError) * maxTurn;
    ship.angVel += angAccel;
    ship.angVel *= SIM.angularDamping;
    ship.facing += ship.angVel;

    // Linear: thrust accelerates velocity toward the desired velocity vector
    // (facing * maxSpeed forward, or -facing * maxSpeed for a reverse burn).
    // `thrust` is the engine force; the per-tick acceleration cap is
    // `thrust / mass` (F = m·a), so heavier ships are sluggish to build
    // speed. `maxSpeed` (also `thrust`) caps the cruise ceiling. When not
    // thrusting, desired velocity is zero so the ship bleeds off speed
    // and comes to rest.
    const maxSpeed = ship.thrust;
    const accel = ship.thrust / Math.max(ship.mass, 1);
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

    ship.x += ship.velX;
    ship.y += ship.velY;
  }
}

function fireWeapons(
  ships: readonly SimShip[],
  byId: Map<string, SimShip>,
  rng: () => number,
): SimProjectile[] {
  const fired: SimProjectile[] = [];
  for (const ship of ships) {
    if (!ship.alive || isRetreating(ship)) continue;
    const target = ship.target !== undefined ? byId.get(ship.target) : undefined;
    if (target === undefined || !target.alive) continue;

    const toTarget = Math.atan2(target.y - ship.y, target.x - ship.x);
    const facingError = Math.abs(angleDifference(ship.facing, toTarget));

    for (let i = 0; i < ship.weapons.length; i++) {
      const weapon = ship.weapons[i];
      if (weapon === undefined) continue;
      const cooldown = ship.weaponCooldowns[i];
      if (cooldown === undefined) continue;
      if (cooldown > 0) {
        ship.weaponCooldowns[i] = cooldown - 1;
        continue;
      }
      const dist = Math.hypot(target.x - ship.x, target.y - ship.y);
      if (dist > weapon.range) continue;
      if (facingError > SIM.firingArc) continue;

      ship.weaponCooldowns[i] = weapon.cooldown;
      if (weapon.projectileSpeed <= 0) {
        applyDamage(target, weapon.damage, weapon.shieldPiercing, weapon.armourPiercing);
      } else {
        fired.push(spawnProjectile(ship, weapon, target, rng));
      }
    }
  }
  return fired;
}

function updateProjectiles(
  projectiles: readonly SimProjectile[],
  byId: Map<string, SimShip>,
  anomaly: BattleInputs["anomaly"],
  rng: () => number,
): SimProjectile[] {
  const survivors: SimProjectile[] = [];
  const trackingFactor = anomaly === "nebula" ? SIM.nebulaTrackingFactor : 1;

  for (const p of projectiles) {
    // Homing: steer velocity toward the (living) target's current position.
    if (p.tracking > 0) {
      const target = byId.get(p.targetId);
      if (target !== undefined && target.alive) {
        const speed = Math.hypot(p.vx, p.vy);
        const desired = Math.atan2(target.y - p.y, target.x - p.x);
        const current = Math.atan2(p.vy, p.vx);
        const steered = steer(current, desired, p.tracking * trackingFactor);
        p.vx = Math.cos(steered) * speed;
        p.vy = Math.sin(steered) * speed;
      }
    }

    p.x += p.vx;
    p.y += p.vy;
    p.travelled += Math.hypot(p.vx, p.vy);
    p.ttl -= 1;

    if (p.travelled > p.range || p.ttl <= 0) continue;

    // Asteroid fields randomly destroy in-flight ordnance.
    if (anomaly === "asteroidField" && rng() < SIM.asteroidDeflectChance) continue;

    // Collision with the nearest living enemy ship.
    const enemySide = p.ownerSide === "attacker" ? "defender" : "attacker";
    let hit: SimShip | undefined;
    let bestDist = Infinity;
    for (const [, ship] of byId) {
      if (!ship.alive || ship.side !== enemySide) continue;
      const d = Math.hypot(ship.x - p.x, ship.y - p.y);
      if (d < ship.radius && d < bestDist) {
        bestDist = d;
        hit = ship;
      }
    }
    if (hit !== undefined) {
      applyDamage(hit, p.damage, p.shieldPiercing, p.armourPiercing);
      continue;
    }
    survivors.push(p);
  }
  return survivors;
}

function snapshot(
  tick: number,
  ships: readonly SimShip[],
  projectiles: readonly SimProjectile[],
): BattleFrame {
  return {
    tick,
    ships: ships.map((s) => ({
      instanceId: s.instanceId,
      side: s.side,
      x: s.x,
      y: s.y,
      vx: s.velX,
      vy: s.velY,
      facing: s.facing,
      structure: s.structure,
      shield: s.shield,
      alive: s.alive,
    })),
    projectiles: projectiles.map((p) => ({ x: p.x, y: p.y, kind: p.kind })),
  };
}
