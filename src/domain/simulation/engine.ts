import { createId, nowIso } from "@/domain/id";
import { mulberry32, ranged } from "@/domain/simulation/rng";
import type { BattleFrame, BattleResult, BattleSide } from "@/schema/battle";
import type { ShipClassification } from "@/schema/hull";
import { DEFAULT_WEAPON_AMMO } from "@/schema/module";
import type { ModuleEffect, WeaponEffect, WeaponType } from "@/schema/module";
import type { Orders } from "@/schema/fleet";
import type { BattleInputs, CombatShip, ResolvedModule } from "./types";

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
  /**
   * Black-hole gravity. `blackHoleStrength` is the G·M product: the
   * gravitational acceleration at distance r is `strength / r^2`,
   * directed toward the centre. Applied as a force to velocity (not
   * a position teleport) so momentum is preserved and the
   * equivalence principle holds — heavy and light ships accelerate
   * the same. The acceleration is softened to zero at the lethal
   * radius to avoid a singularity.
   */
  blackHoleStrength: 5000,
  /** Inside this radius a ship is torn apart by tidal forces. */
  blackHoleLethalRadius: 24,
  /** Per-tick structural damage at the centre of the well. */
  blackHoleLethalDamage: 12,
  /**
   * Outside the lethal radius but inside this zone, a ship takes
   * damage proportional to 1/r^3 — the leading-order tidal force
   * across a body of finite size. "Spaghettification".
   */
  blackHoleTidalRadius: 48,
  /** Coefficient for the 1/r^3 tidal damage; tuned so the tidal edge
   *  shreds a typical ship in a handful of ticks. */
  blackHoleTidalDamageScale: 200000,
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
  /**
   * Per-module instances when the ship was built from a ShipDesign with
   * per-module data. Each module has its own hit points and can be
   * destroyed independently; the aggregate fields above are recomputed
   * from the alive set each tick (`recomputeAggregates`). Undefined
   * means the legacy aggregated path is in use.
   */
  modules?: SimModule[];
  /** Hull base thrust/turn-rate, used by recomputeAggregates. Set only
   *  when modules are present. */
  hullBaseThrust?: number;
  hullBaseTurnRate?: number;
}

/**
 * Mutable per-module runtime state. Built from a `ResolvedModule` in
 * `toSimShip`; aggregates are recomputed from the alive set each tick.
 */
interface SimModule {
  slotId: string;
  moduleId: string;
  kind: ModuleEffect["kind"];
  /** Position in ship-local (design) coordinates, for hit selection. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mass: number;
  /** Power drawn from the reactor each tick when running. */
  powerDraw: number;
  effect: ModuleEffect;
  /** Weapon: ticks until next fire. Shield regen is pooled at ship level. */
  cooldown: number;
  /**
   * Weapon: remaining magazine. Decremented by 1 per shot; a weapon at 0
   * cannot fire. Always present on weapon modules; initialised from the
   * effect's `ammo` (defaulting to DEFAULT_WEAPON_AMMO when undefined).
   */
  ammo: number;
  alive: boolean;
  /**
   * Whether the power grid can sustain this module this tick. Reactors
   * supply a finite output; when total draw exceeds it, power-hungry
   * modules (weapons, then shields) go offline until supply recovers.
   */
  powered: boolean;
  /** Whether this module serves as the ship's bridge / command module. */
  command: boolean;
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
  const base: SimShip = {
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

  // Per-module path: build SimModule[] from the resolved modules and let
  // recomputeAggregates derive the live combat stats from the alive set.
  if (ship.modules !== undefined && ship.modules.length > 0) {
    base.modules = ship.modules.map((m) => toSimModule(m, rng));
    base.hullBaseThrust = ship.stats.thrust - sumWeaponThrust(ship);
    base.hullBaseTurnRate = ship.stats.turnRate - sumWeaponTurn(ship);
    recomputeAggregates(base);
    // Shield starts full at the (recomputed) capacity; structure is the
    // hull's base integrity, independent of module HP.
    base.shield = base.maxShield;
    base.structure = ship.stats.structure;
    base.maxStructure = ship.stats.structure;
  }
  return base;
}

function toSimModule(m: ResolvedModule, rng: () => number): SimModule {
  const effect = m.effect;
  const isWeapon = effect.kind === "weapon";
  return {
    slotId: m.slotId,
    moduleId: m.moduleId,
    kind: m.kind,
    x: m.x,
    y: m.y,
    hp: m.maxHp,
    maxHp: m.maxHp,
    mass: m.mass,
    powerDraw: m.powerDraw,
    effect,
    // Stagger weapon cooldowns so they don't all fire on tick 0.
    cooldown: isWeapon ? Math.floor(rng() * (effect.cooldown + 1)) : 0,
    // Weapons with finite ammo carry it through; without an explicit value
    // they get a large default so they effectively never run dry.
    ammo: isWeapon ? effect.ammo ?? DEFAULT_WEAPON_AMMO : 0,
    alive: true,
    powered: true,
    command: m.command,
  };
}

/** Thrust contributed by engine modules (subtracted from the aggregate to
 *  recover the hull base, since stats.thrust already sums them in). */
function sumWeaponThrust(ship: CombatShip): number {
  if (ship.modules === undefined) return 0;
  let sum = 0;
  for (const m of ship.modules) {
    if (m.effect.kind === "engine") sum += m.effect.thrust;
  }
  return sum;
}

function sumWeaponTurn(ship: CombatShip): number {
  if (ship.modules === undefined) return 0;
  let sum = 0;
  for (const m of ship.modules) {
    if (m.effect.kind === "engine") sum += m.effect.turnRate;
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
function recomputeAggregates(ship: SimShip): void {
  if (ship.modules === undefined) return;

  // 1. Supply from alive reactors.
  let supply = 0;
  for (const m of ship.modules) {
    if (m.alive && m.effect.kind === "power") {
      supply += m.effect.output;
    }
  }

  // 2. Start every alive module powered; we'll disable the hungriest to
  //    fit the budget. Reactors themselves draw nothing.
  for (const m of ship.modules) {
    m.powered = m.alive && m.effect.kind !== "power";
  }

  // 3. Demand from powered consumers. If it exceeds supply, take the
  //    hungriest offline — weapons first, then shields — rechecking each
  //    time, until demand ≤ supply (or nothing is left to cut).
  const demandOf = (m: SimModule): number => (m.powered ? m.powerDraw : 0);
  let demand = 0;
  for (const m of ship.modules) demand += demandOf(m);

  while (demand > supply) {
    // Candidates to cut: powered weapons, else powered shields.
    let victim: SimModule | undefined;
    let bestDraw = -1;
    for (const m of ship.modules) {
      if (!m.powered) continue;
      if (m.effect.kind !== "weapon" && m.effect.kind !== "shield") continue;
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
  let turnRate = ship.hullBaseTurnRate ?? 0;
  let mass = SIM.hullMass[ship.classification];
  let armourReduction = 0;
  let shieldCapacity = 0;
  let shieldRechargeRate = 0;
  let shieldRechargeDelay = 0;
  const weapons: WeaponEffect[] = [];
  const cooldowns: number[] = [];

  for (const m of ship.modules) {
    if (!m.alive) {
      mass += 0; // destroyed modules contribute neither mass nor function
      continue;
    }
    mass += m.mass;
    if (!m.powered) continue; // unpowered modules are present but inert
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
        break;
      case "armour":
        armourReduction = Math.max(armourReduction, effect.damageReduction);
        break;
      case "engine":
        thrust += effect.thrust;
        turnRate += effect.turnRate;
        break;
      case "power":
      case "crew":
        break;
    }
  }

  ship.thrust = thrust;
  ship.turnRate = turnRate;
  ship.mass = mass;
  ship.armourReduction = armourReduction;
  ship.maxShield = shieldCapacity;
  ship.shieldRechargeRate = shieldRechargeRate;
  ship.shieldRechargeDelay = shieldRechargeDelay;
  ship.shield = Math.min(ship.shield, shieldCapacity);
  ship.weapons = weapons;
  ship.weaponCooldowns = cooldowns;
}

/** Whether the ship has at least one alive command (bridge) module. Ships
 *  without any command module cannot fire. A module at 0 hp counts as
 *  destroyed even before its `alive` flag is flipped, since destruction is
 *  hp-driven. */
function hasAliveCommand(ship: SimShip): boolean {
  if (ship.modules === undefined) return true;
  for (const m of ship.modules) {
    if (m.command && m.alive && m.hp > 0) return true;
  }
  return false;
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
 * Apply incoming weapon damage. Shields absorb the non-pierced fraction
 * first; any shield contact resets the shield-regeneration delay.
 *
 * What gets past the shields (`rawStructure`) then either:
 *  - per-module ship: strikes the alive module whose cell is nearest the
 *    world-space impact point (transformed into ship-local coordinates),
 *    destroying it if its HP runs out; overflow spills to hull structure,
 *    reduced by armour; or
 *  - legacy aggregated ship: hits structure directly, reduced by armour.
 *
 * `impactX/impactY` are the world-space hit location (a projectile's
 * position, or for hitscan the target's edge facing the shooter). They're
 * only used to select the module on a per-module ship.
 */
function applyDamage(
  ship: SimShip,
  damage: number,
  shieldPiercing: number,
  armourPiercing: number,
  impactX?: number,
  impactY?: number,
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

  if (ship.modules !== undefined) {
    applyModuleDamage(ship, rawStructure, armourPiercing, impactX, impactY);
    return;
  }

  const effectiveReduction = ship.armourReduction * (1 - armourPiercing);
  ship.structure -= rawStructure * (1 - effectiveReduction);
  if (ship.structure <= 0) {
    ship.structure = 0;
    ship.alive = false;
  }
}

/**
 * Per-module damage: `amount` strikes the nearest alive module to the impact
 * point. The module's HP absorbs it; if the module is destroyed, the leftover
 * spills to the next-nearest module, and finally to hull structure (armour-
 * reduced). A ship with no alive modules takes the full amount to structure.
 */
function applyModuleDamage(
  ship: SimShip,
  amount: number,
  armourPiercing: number,
  impactX?: number,
  impactY?: number,
): void {
  let remaining = amount;
  // Transform the world-space impact point into ship-local (design)
  // coordinates so it lines up with module.x/module.y.
  const local = worldToLocal(ship, impactX, impactY);

  while (remaining > 0) {
    const target = nearestAliveModule(ship, local);
    if (target === undefined) {
      // No modules left — everything goes to the hull.
      const reduction = ship.armourReduction * (1 - armourPiercing);
      ship.structure -= remaining * (1 - reduction);
      if (ship.structure <= 0) {
        ship.structure = 0;
        ship.alive = false;
      }
      return;
    }
    target.hp -= remaining;
    if (target.hp > 0) {
      return; // module absorbed the whole hit
    }
    // Module destroyed; leftover spills onward.
    remaining = -target.hp;
    target.hp = 0;
    target.alive = false;
  }
}

/** Rotate a world point into the ship's local frame (design coordinates). */
function worldToLocal(
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

/** The alive module whose cell is nearest the given local point (or the
 *  centroid of alive modules when there's no impact point). */
function nearestAliveModule(
  ship: SimShip,
  local: { x: number; y: number } | undefined,
): SimModule | undefined {
  if (ship.modules === undefined) return undefined;
  const alive = ship.modules.filter((m) => m.alive);
  if (alive.length === 0) return undefined;
  if (local === undefined) return alive[0];
  let best: SimModule | undefined;
  let bestDist = Infinity;
  for (const m of alive) {
    const d = (m.x - local.x) ** 2 + (m.y - local.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
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

    // 4b. Recompute aggregate stats from the alive module set, so a module
    //     destroyed this tick (hitscan or projectile) is reflected in the
    //     shield pool, thrust, and weapon list before regen and the snapshot,
    //     and carried into the next tick's movement and firing.
    for (const ship of ships) {
      if (ship.modules !== undefined) recomputeAggregates(ship);
    }

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
    const dist = Math.hypot(target.x - ship.x, target.y - ship.y);

    // Per-module path: iterate the ship's own weapon modules, reading and
    // writing each module's cooldown and ammo (so destruction is reflected
    // live and recomputeAggregates can't clobber in-flight state). An
    // unpowered or dry weapon is inert — but its cooldown still ticks, so
    // it fires the moment the grid recovers or the magazine is restored.
    // A ship with no alive command (bridge) module cannot coordinate its
    // weapons either, so the whole path is skipped — destroying the bridge
    // disarms the ship.
    if (ship.modules !== undefined) {
      if (!hasAliveCommand(ship)) continue;
      for (const m of ship.modules) {
        if (!m.alive || m.effect.kind !== "weapon") continue;
        if (m.cooldown > 0) {
          m.cooldown -= 1;
          continue;
        }
        if (!m.powered) continue; // reactor can't sustain it this tick
        const weapon = m.effect;
        if (dist > weapon.range || facingError > SIM.firingArc) continue;
        if (m.ammo <= 0) continue; // out of ammo; no resupply yet
        // A genuine, in-range shot: spend a round and reset the cycle.
        m.ammo -= 1;
        m.cooldown = weapon.cooldown;
        fireOne(ship, weapon, target, rng, fired);
      }
      continue;
    }

    // Legacy aggregated path.
    for (let i = 0; i < ship.weapons.length; i++) {
      const weapon = ship.weapons[i];
      if (weapon === undefined) continue;
      const cooldown = ship.weaponCooldowns[i];
      if (cooldown === undefined) continue;
      if (cooldown > 0) {
        ship.weaponCooldowns[i] = cooldown - 1;
        continue;
      }
      if (dist > weapon.range) continue;
      if (facingError > SIM.firingArc) continue;

      ship.weaponCooldowns[i] = weapon.cooldown;
      fireOne(ship, weapon, target, rng, fired);
    }
  }
  return fired;
}

/** Fire a single weapon: hitscan applies damage immediately at a synthesised
 *  impact point on the target's facing edge; otherwise spawn a projectile. */
function fireOne(
  ship: SimShip,
  weapon: WeaponEffect,
  target: SimShip,
  rng: () => number,
  fired: SimProjectile[],
): void {
  if (weapon.projectileSpeed <= 0) {
    // Hitscan: the beam strikes the target's edge nearest the shooter.
    const angle = Math.atan2(target.y - ship.y, target.x - ship.x);
    const ix = target.x + Math.cos(angle) * target.radius;
    const iy = target.y + Math.sin(angle) * target.radius;
    applyDamage(target, weapon.damage, weapon.shieldPiercing, weapon.armourPiercing, ix, iy);
  } else {
    fired.push(spawnProjectile(ship, weapon, target, rng));
  }
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

    // Black-hole gravity bends projectiles too. The same 1/r^2
    // acceleration applied to the projectile's velocity; a fast
    // projectile traverses the strong-field region in fewer ticks and
    // so accumulates less deflection — the "mass" of a projectile
    // (its speed) is what determines how much it bends.
    if (anomaly === "blackHole") {
      const pDist = Math.hypot(p.x, p.y);
      if (pDist > 0) {
        const pEffectiveR = Math.max(pDist, SIM.blackHoleLethalRadius);
        const pAccelMag = SIM.blackHoleStrength / (pEffectiveR * pEffectiveR);
        p.vx += (-p.x / pDist) * pAccelMag;
        p.vy += (-p.y / pDist) * pAccelMag;
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
      applyDamage(hit, p.damage, p.shieldPiercing, p.armourPiercing, p.x, p.y);
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
    ships: ships.map((s) => {
      const base = {
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
      };
      if (s.modules === undefined) return base;
      return {
        ...base,
        modules: s.modules.map((m) => ({
          slotId: m.slotId,
          kind: m.kind,
          x: m.x,
          y: m.y,
          hp: m.hp,
          maxHp: m.maxHp,
          alive: m.alive,
        })),
      };
    }),
    projectiles: projectiles.map((p) => ({ x: p.x, y: p.y, kind: p.kind })),
  };
}
