import { createId, nowIso } from "@/domain/id";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32, ranged } from "@/domain/simulation/rng";
import { SpatialHash, cellWorldPosition } from "@/domain/simulation/spatial-hash";
import type { BattleFrame, BattleResult, BattleSide } from "@/schema/battle";
import type { ShipClassification } from "@/schema/hull";
import { DEFAULT_WEAPON_AMMO } from "@/schema/module";
import type {
  ModuleEffect,
  PointDefenseEffect,
  WeaponEffect,
  WeaponType,
} from "@/schema/module";
import type { Orders } from "@/schema/fleet";
import type { BattleInputs, CombatShip, ResolvedModule, SimCrew } from "./types";

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
   * Black-hole avoidance steering. A ship reads the well at the origin and
   * blends a heading that points directly AWAY from it into its normal
   * target-seeking heading, weighted by how deep inside a safety margin it
   * sits. Outside the margin the weight is zero, so a ship clear of the hole
   * fights exactly as it would with no anomaly; well inside the lethal radius
   * the weight saturates at 1 and the ship steers purely to escape. Between
   * the two it interpolates linearly, so a ship grazing the danger zone arcs
   * around it rather than ploughing through.
   */
  blackHoleAvoid: {
    /**
     * Outer edge of the avoidance field as a multiple of the tidal radius.
     * Beyond `safetyMargin * blackHoleTidalRadius` from the centre the
     * avoidance weight is zero — the ship is considered clear and ignores the
     * hole entirely, preserving open-space combat behaviour. 1.5 gives a
     * comfortable buffer outside the damaging tidal zone so a ship begins
     * arcing away before it starts taking tidal damage.
     */
    safetyMargin: 1.5,
    /**
     * Minimum avoidance weight applied the instant a ship crosses inside the
     * safety margin, so the steering bias is felt immediately at the edge
     * rather than fading in from zero (a zero-at-the-edge ramp lets a fast
     * ship punch through before the bias grows). The weight then ramps from
     * this floor up to 1 as the ship nears the lethal radius.
     */
    edgeWeight: 0.35,
  },
  /**
   * Desired-range multipliers (<1) applied when an anomaly punishes
   * time-of-flight, so ships close in to where their shots actually land.
   *  - Nebula halves projectile tracking, gutting homing weapons at range, so
   *    ships fight noticeably closer.
   *  - An asteroid field destroys a fraction of in-flight rounds each tick, so
   *    a shorter flight time means fewer shots lost — a more modest pull-in.
   * Each anomaly is exclusive, so these never compound.
   */
  anomalyRangeFactor: {
    nebula: 0.6,
    asteroidField: 0.8,
  },
  /**
   * Per-tick multiplicative drag on linear and angular velocity. A small drag
   * is a gameplay compromise: real space is frictionless (ships would coast
   * forever), but unbounded drift makes battles unreadable. 0.97 ≈ 0.5 s
   * half-life at 30 ticks/s — momentum is felt, but ships settle.
   */
  linearDamping: 0.97,
  /**
   * Per-tick multiplicative drag on angular velocity — the rotational analogue
   * of `linearDamping`, and like it a deliberate small non-physical bleed: real
   * space is frictionless, so a torqued ship would otherwise spin forever, and
   * the attitude controller's braking only lands angVel exactly on zero in the
   * continuous limit. Close to 1 so a real tumble still reads as momentum (the
   * controller, not damping, does the deliberate braking) while a settled ship
   * cannot jitter forever on residual spin from off-centre thruster torque or a
   * collision kick. There is NO maximum angular speed — this only decays spin,
   * it never caps it.
   */
  angularDamping: 0.98,
  /**
   * Heading error (radians) within which the attitude controller commands no
   * turn — the ship is considered on aim. ~0.6°, below visual notice, so
   * off-centre thruster torque or a residual fraction of a degree cannot make
   * the controller chatter the turn command around a settled heading.
   */
  angularDeadband: 0.01,
  /**
   * Moment of inertia per unit mass for legacy (non-modular) ships, which
   * have no module distribution to derive one from. Treated as a uniform
   * disc of radius `sqrt(mass)/2` would give MoI = m·r²/2; we use the
   * simpler `MoI = mass * legacyMoI` so a single constant governs the
   * relative weight of linear vs angular acceleration. Larger values
   * make the ship harder to spin (more "stubborn"); smaller values make
   * off-axis thrust twitchy. Modular ships ignore this constant — their
   * moment of inertia is derived from their module mass distribution
   * about the centre of mass each time aggregates recompute.
   */
  legacyMoI: 5,
  /**
   * Mass of a single spawned projectile, in the same mass units as ship
   * modules. The recoil a firing ship feels is `m_p * v_p / M_ship` and
   * the impulse a target absorbs on hit is the same — a small fixed
   * projectile mass keeps the recoil visible (a stationary ship firing a
   * fast round kicks backward) without destabilising the movement model
   * for slow, heavy projectiles like torpedoes.
   */
  projectileMass: 0.5,
  /**
   * Per-PD-module per-tick chance of intercepting a single in-range missile
   * or torpedo. Multiple PD modules stack their chances (1 - (1-p)^n) but
   * the cumulative chance is capped here so a screen of PD modules can never
   * be a 100% certainty.
   */
  pdHitChancePerModule: 0.4,
  /** Upper bound on the stacked PD intercept probability per projectile. */
  pdMaxStackedChance: 0.95,
  /**
   * Rounds a crew member carries per ammo-run from a magazine to a dry weapon.
   * One trip tops a weapon up by at most this much (and never beyond the
   * weapon's `ammoCapacity`), and drains the magazine's store by the amount
   * actually carried.
   */
  ammoRunAmount: 40,
  /**
   * Charge packets a crew member carries per power-run from a reactor to a
   * starved module. Each packet refills the sink module's local charge buffer
   * by this much (capped at the buffer ceiling).
   */
  powerRunAmount: 30,
  /**
   * Ceiling on a powered module's local charge buffer. Crew top it up from a
   * reactor; the module spends `powerDraw` from it each tick it operates. A
   * module whose buffer hits zero goes idle until a crew power-run refills it.
   */
  chargeBufferMax: 60,
  /**
   * Passive wiring reach, in cells of walkable path distance from a reactor.
   * A power-drawing module within this many alive cells of an alive reactor is
   * hard-wired to the grid and refills its buffer for free each tick; modules
   * beyond it are off the grid and depend on crew hauling charge from a
   * reactor. Small, compact ships (reactor beside the guns) are fully wired and
   * need no power crew; sprawling capitals have outlying stations that only
   * crew can keep fed, which is the whole point of crewed interiors.
   */
  powerWiringRadius: 3,
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
  /**
   * Ship-local centre of mass (relative to ship.x/ship.y). On modular
   * ships this is the mass-weighted centroid of every module (alive and
   * dead — destroyed hull still contributes structural mass until it is
   * excluded by a recompute). On legacy non-modular ships it stays at
   * (0, 0) — the ship's position is its centre of mass. Rotation pivots
   * about this point; linear forces are lever-armed against it for the
   * torque calculation.
   */
  comX: number;
  comY: number;
  /**
   * Scalar moment of inertia about the z-axis through the centre of
   * mass. On modular ships it is derived as `Σ m_i · |r_i − r_com|²`;
   * on legacy ships it falls back to `mass * legacyMoI`. Drives how
   * readily off-centre forces spin the ship.
   */
  momentOfInertia: number;
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
  /**
   * Crew aboard the ship: physical entities that walk the walkable interior
   * (alive cells) to man stations and haul resources. Populated from the
   * design's crew-quarters cells in `toSimShip`; advanced each tick by
   * `updateCrew` after aggregates recompute. Always present on modular ships
   * (possibly empty); undefined on the legacy aggregated path, which has no
   * cells to walk and ignores crew entirely.
   */
  crew?: SimCrew[];
  /** Hull base thrust, used by recomputeAggregates to recover the non-engine
   *  thrust floor. Set only when modules are present. */
  hullBaseThrust?: number;
  /**
   * True on the tick this ship was created as a break-away chunk from a
   * parent ship. Cleared by snapshot so the flag highlights only the
   * split frame, not every frame the chunk exists.
   */
  brokeOff?: boolean;
}

/**
 * Mutable per-module runtime state. Built from a `ResolvedModule` in
 * `toSimShip`; aggregates are recomputed from the alive set each tick.
 */
interface SimModule {
  slotId: string;
  moduleId: string;
  kind: ModuleEffect["kind"];
  /** Integer grid coordinates of the cell this module occupies. Break-apart
   *  unions over exact 4-connected (edge-sharing) neighbours on these, with no
   *  rounding of the ship-local world position. */
  col: number;
  row: number;
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
  /**
   * Rounds remaining in a magazine module's store. Initialised from
   * `MagazineEffect.ammoStored`; decremented as crew draw runs from it to
   * resupply dry weapons. Zero on every non-magazine module. Kept on the
   * SimModule (not the shared effect) so two ships built from the same design
   * deplete their own magazines independently.
   */
  ammoStored: number;
  /**
   * Local energy buffer a power-drawing module spends each tick it operates.
   * Crew haul charge packets from reactors to top it up. A module whose buffer
   * hits zero goes idle even when the whole-ship brownout would otherwise power
   * it, so the physical distance to a reactor — and the crew routing it — matters.
   * Modules with `powerDraw === 0` never consume charge and are always
   * considered charged. Initialised so reactor-adjacent modules start live;
   * isolated ones drain and starve unless crew feed them.
   */
  charge: number;
  alive: boolean;
  /**
   * Whether the power grid can sustain this module this tick. Reactors
   * supply a finite output; when total draw exceeds it, power-hungry
   * modules (weapons, then shields) go offline until supply recovers.
   */
  powered: boolean;
  /**
   * Whether enough crew currently occupy this module's cell to operate it:
   * the count of crew on the cell is at least the module's `crewRequired`.
   * A module that needs no crew (`crewRequired === 0`) is always manned.
   * Recomputed each tick by `updateCrew` from live crew positions, then read
   * by `recomputeAggregates` and the firing loop so an unmanned station
   * contributes nothing and cannot fire. A station functions only when
   * `alive && powered && manned`.
   */
  manned: boolean;
  /** How many crew must occupy this cell for the module to be manned. Copied
   *  off the module definition; 0 means the module needs no crew. */
  crewRequired: number;
  /** Whether this module serves as the ship's bridge / command module. */
  command: boolean;
  /**
   * HP healed to one damaged module on the same ship per tick. Zero for
   * every non-repair module. Read by the per-tick repair step.
   */
  repairRate: number;
  /** Directional shield arc in radians; 2π means omnidirectional. */
  shieldArc: number;
  /** Direction (radians) the directional shield points. */
  shieldFacing: number;
  /**
   * For directional thrusters: the direction the engine thrusts, in
   * radians, ship-local. Default 0 (forward, +x). Mirrors
   * `ResolvedModule.facing`; carried on `SimModule` so the per-tick
   * movement loop can read each engine's force vector and lever arm
   * without re-walking the resolver.
   */
  facing: number;
  /**
   * Ship-local direction (radians) the weapon fires relative to the host
   * ship's heading. 0 fires along +x in ship-local space (forward); π/2
   * fires left, -π/2 fires right, π fires backward. Copied off the
   * resolved module's `weaponFacing` so the per-tick firing step can add it
   * to the ship's world heading without re-deriving it from the effect.
   * Only meaningful for weapon modules; default 0 is harmless elsewhere.
   */
  weaponFacing: number;
  /**
   * Turret traverse half-arc (radians, ship-local) about `weaponFacing` and
   * slew speed (radians per tick). `turretTurnRate === 0` is a fixed mount.
   */
  turretArc: number;
  turretTurnRate: number;
  /**
   * Live barrel angle (radians, ship-local) for a turret weapon. Slews toward
   * the target bearing each tick at `turretTurnRate`, clamped to
   * `[weaponFacing - turretArc, weaponFacing + turretArc]`. Firing direction
   * and recoil use this live angle, not the static `weaponFacing`. On a fixed
   * mount it stays equal to `weaponFacing` for the ship's whole life, so the
   * firing path can read it unconditionally.
   */
  turretAngle: number;
}

/** Mutable in-flight projectile. */
interface SimProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: WeaponType;
  /** Projectile mass — carried so the hit-impulse step knows the momentum
   *  to transfer without re-deriving it from the owning weapon. */
  mass: number;
  /** Ship-local position of the muzzle that fired this projectile, relative
   *  to the firing ship's centre. Used by the firing-recoil step to compute
   *  the lever arm against the firing ship's CoM. */
  muzzleLocalX: number;
  muzzleLocalY: number;
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

/**
 * Broad-phase bounding radius of a modular ship's cells about the ship origin:
 * the distance to the farthest alive cell centre plus half a cell, so the disc
 * encloses the whole footprint. Recomputed when modules change (cells die or a
 * chunk splits off) so the collision bound never lags the actual ship. Dead
 * modules are excluded — a stripped hulk has a smaller silhouette. Mirrors the
 * pure `deriveRadius` over the grid, but works on the resolved cell set the
 * engine already holds. Returns half a cell as a floor so even a single
 * surviving cell has a non-zero bound. */
function gridRadius(modules: readonly SimModule[]): number {
  let maxDistSq = 0;
  for (const m of modules) {
    if (!m.alive) continue;
    const distSq = m.x * m.x + m.y * m.y;
    if (distSq > maxDistSq) maxDistSq = distSq;
  }
  return Math.sqrt(maxDistSq) + CELL_SIZE / 2;
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

/**
 * The desired engagement range adjusted for the active anomaly. In a nebula
 * (halved projectile tracking) and an asteroid field (in-flight rounds
 * destroyed over time) a longer time-of-flight means fewer shots that land, so
 * ships should close to where their fire is effective; we scale the base
 * desired range down by the anomaly's factor. Black hole and "none" leave the
 * range untouched (the black hole is handled by avoidance steering, not by
 * range), so this is byte-identical to `desiredRange` for those cases.
 */
function anomalyAdjustedRange(
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
function blackHoleAvoidWeight(dist: number): number {
  const margin = SIM.blackHoleAvoid.safetyMargin * SIM.blackHoleTidalRadius;
  if (dist >= margin) return 0;
  if (dist <= SIM.blackHoleLethalRadius) return 1;
  // Fraction of the way from the margin edge (0) to the lethal radius (1).
  const span = margin - SIM.blackHoleLethalRadius;
  const depth = (margin - dist) / span;
  const { edgeWeight } = SIM.blackHoleAvoid;
  return edgeWeight + (1 - edgeWeight) * depth;
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

/** Clamp a ship-local angle to the turret's traverse window
 *  `[weaponFacing - turretArc, weaponFacing + turretArc]`. Both the target
 *  offset and the limit are measured relative to the mount direction so the
 *  wrap-around is handled once, in `angleDifference`. */
function clampToArc(weaponFacing: number, turretArc: number, desired: number): number {
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
function slewTurret(
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
    // Non-modular ships default to a CoM at their position pivot and the
    // legacy scalar moment of inertia. recomputeAggregates overrides both
    // for modular ships (the only path that calls it).
    comX: 0,
    comY: 0,
    momentOfInertia:
      (SIM.hullMass[ship.classification] + ship.stats.mass) * SIM.legacyMoI,
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
    base.crew = spawnCrew(base.instanceId, base.modules);
    recomputeAggregates(base);
    // Broad-phase radius is the grid bounding radius (the farthest cell
    // centre plus half a cell), derived from the module cells rather than a
    // per-class lookup, so the collision bound tracks the actual footprint.
    base.radius = gridRadius(base.modules);
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
  const isPD = effect.kind === "pointDefense";
  return {
    slotId: m.slotId,
    moduleId: m.moduleId,
    kind: m.kind,
    col: m.col,
    row: m.row,
    x: m.x,
    y: m.y,
    hp: m.maxHp,
    maxHp: m.maxHp,
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
  };
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
function spawnCrew(
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
    });
  }
  return crew;
}

/** Starting hit points of a freshly spawned crew member. */
const CREW_HP = 10;

/** Total order on cells by (col, row), used wherever crew or modules must be
 *  scanned in a fixed, RNG-free order. */
function compareByCell(
  a: { col: number; row: number },
  b: { col: number; row: number },
): number {
  if (a.col !== b.col) return a.col - b.col;
  return a.row - b.row;
}

/** Canonical "col,row" cell key, matching the convention used by break-apart
 *  and the grid toolkit. */
function crewCellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Deterministic A* over a ship's alive cells, treating every alive module cell
 * as a walkable interior tile (crew stand on hull, modules, and floor alike).
 * Returns the path inclusive of both endpoints, or undefined when no 4-connected
 * route of alive cells links them.
 *
 * The engine works on its resolved cell set rather than a `TileGrid`, so this
 * mirrors `domain/grid.findPath` over that set: same Manhattan heuristic, same
 * fixed tie-break (lowest f, then lowest row, then lowest col) so two runs with
 * identical inputs yield byte-identical paths. No RNG, no Map/Set iteration
 * order dependence.
 */
function findCrewPath(
  cells: ReadonlyMap<string, SimModule>,
  from: { col: number; row: number },
  to: { col: number; row: number },
): { col: number; row: number }[] | undefined {
  const fromKey = crewCellKey(from.col, from.row);
  const toKey = crewCellKey(to.col, to.row);
  if (!cells.has(fromKey) || !cells.has(toKey)) return undefined;
  if (from.col === to.col && from.row === to.row) {
    return [{ col: from.col, row: from.row }];
  }

  const heuristic = (col: number, row: number): number =>
    Math.abs(col - to.col) + Math.abs(row - to.row);

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { col: number; row: number }>();
  gScore.set(fromKey, 0);

  const open: { col: number; row: number; f: number }[] = [
    { col: from.col, row: from.row, f: heuristic(from.col, from.row) },
  ];
  const openKeys = new Set<string>([fromKey]);

  const insertSorted = (entry: { col: number; row: number; f: number }): void => {
    let lo = 0;
    let hi = open.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = open[mid];
      if (m === undefined) break;
      if (
        m.f < entry.f ||
        (m.f === entry.f && m.row < entry.row) ||
        (m.f === entry.f && m.row === entry.row && m.col < entry.col)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    open.splice(lo, 0, entry);
  };

  while (open.length > 0) {
    const current = open.shift();
    if (current === undefined) break;
    const currentKey = crewCellKey(current.col, current.row);
    openKeys.delete(currentKey);

    if (current.col === to.col && current.row === to.row) {
      const path: { col: number; row: number }[] = [
        { col: current.col, row: current.row },
      ];
      let key = currentKey;
      for (;;) {
        const prev = cameFrom.get(key);
        if (prev === undefined) break;
        path.unshift({ col: prev.col, row: prev.row });
        key = crewCellKey(prev.col, prev.row);
      }
      return path;
    }

    const currentG = gScore.get(currentKey) ?? Infinity;
    // Visit the four edge neighbours in a fixed order; the tie-break in the open
    // set makes the chosen path canonical regardless of insertion order here.
    const candidates = [
      { col: current.col - 1, row: current.row },
      { col: current.col + 1, row: current.row },
      { col: current.col, row: current.row - 1 },
      { col: current.col, row: current.row + 1 },
    ];
    for (const n of candidates) {
      const nKey = crewCellKey(n.col, n.row);
      if (!cells.has(nKey)) continue; // not a walkable alive cell
      const tentativeG = currentG + 1;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, { col: current.col, row: current.row });
        gScore.set(nKey, tentativeG);
        const f = tentativeG + heuristic(n.col, n.row);
        if (!openKeys.has(nKey)) {
          openKeys.add(nKey);
          insertSorted({ col: n.col, row: n.row, f });
        } else {
          const idx = open.findIndex((e) => e.col === n.col && e.row === n.row);
          if (idx !== -1) open.splice(idx, 1);
          insertSorted({ col: n.col, row: n.row, f });
        }
      }
    }
  }
  return undefined;
}

/**
 * Index a ship's alive modules by their integer cell key. This is the walkable
 * graph crew path over and the lookup used to find which module (if any) sits on
 * a given cell.
 */
function aliveCellMap(ship: SimShip): Map<string, SimModule> {
  const map = new Map<string, SimModule>();
  if (ship.modules === undefined) return map;
  for (const m of ship.modules) {
    if (m.alive) map.set(crewCellKey(m.col, m.row), m);
  }
  return map;
}

/**
 * Advance one ship's crew by a single tick and recompute every module's
 * `manned` flag from the resulting positions. Runs after `recomputeAggregates`
 * (so `powered` is settled) and before break-apart. Deterministic throughout:
 * crew are processed in id order, candidate stations / sources are scanned in
 * `(col, row)` order, and the only tie-breaks are on those stable orders —
 * never RNG, never Map/Set insertion order.
 *
 * Step sequence (crew always iterated in id order):
 *  1. Crew whose current cell has died (shot away or severed) are removed.
 *  2. Crew that have arrived at their target resolve the arrival action: a
 *     manning member that reached its station holds; a hauler picks up at a
 *     source or deposits at a sink and frees up for the next job.
 *  3. Idle crew are assigned the highest-priority unmet need — first man an
 *     under-manned station, then run ammo to a dry weapon — reserving the
 *     target so two crew never chase the same one.
 *  4. Crew with a path walk one cell along it.
 *  5. Manning is recomputed from the final positions.
 */
function updateCrew(ship: SimShip): void {
  if (ship.modules === undefined || ship.crew === undefined) return;

  const cells = aliveCellMap(ship);
  const bySlot = new Map<string, SimModule>();
  for (const m of ship.modules) bySlot.set(m.slotId, m);

  // 1. Remove crew standing on a cell that no longer exists.
  ship.crew = ship.crew.filter((c) => cells.has(crewCellKey(c.col, c.row)));

  // Stable id order for every per-crew pass below.
  const ordered = [...ship.crew].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  // 2. Resolve arrivals (pickup / deposit). A member with an empty path that is
  //    standing on its target acts on it; manning members simply hold.
  for (const c of ordered) {
    resolveArrival(c, bySlot, cells);
  }

  // Reservation maps so assignment never over-subscribes a station or sends two
  // haulers to the same sink. Built from current (post-arrival) intents.
  const claimedStations = new Map<string, number>();
  const claimedWeapons = new Set<string>();
  const claimedSinks = new Set<string>();
  for (const c of ship.crew) {
    if (c.job === "manning" && c.targetSlotId !== undefined) {
      claimedStations.set(c.targetSlotId, (claimedStations.get(c.targetSlotId) ?? 0) + 1);
    } else if (c.job === "haulAmmo" && c.haulSinkSlotId !== undefined) {
      claimedWeapons.add(c.haulSinkSlotId);
    } else if (c.job === "haulPower" && c.haulSinkSlotId !== undefined) {
      claimedSinks.add(c.haulSinkSlotId);
    }
  }

  // Stations that still need crew, scanned in a fixed (col, row) order.
  const stations = ship.modules
    .filter((m) => m.alive && m.crewRequired > 0 && stationNeedsCrew(m))
    .slice()
    .sort(compareByCell);

  // 3. Assign idle crew (id order) to the highest-priority unmet need.
  for (const c of ordered) {
    if (c.job !== "idle") continue;

    // Priority 1: man an under-manned station.
    const station = chooseStation(c, stations, cells, claimedStations);
    if (station !== undefined) {
      c.job = "manning";
      c.targetSlotId = station.station.slotId;
      c.path = station.path.slice(1);
      claimedStations.set(
        station.station.slotId,
        (claimedStations.get(station.station.slotId) ?? 0) + 1,
      );
      continue;
    }

    // Priority 2: run ammo from a magazine to a dry weapon.
    const run = chooseAmmoRun(c, ship.modules, cells, claimedWeapons);
    if (run !== undefined) {
      c.job = "haulAmmo";
      c.carrying = undefined;
      // First leg: walk to the magazine. The final delivery sink is recorded on
      // the crew member so the second leg knows where to take the rounds.
      c.targetSlotId = run.source.slotId;
      c.haulSinkSlotId = run.sink.slotId;
      c.path = run.path.slice(1);
      claimedWeapons.add(run.sink.slotId);
      continue;
    }

    // Priority 3: run charge from a reactor to a starved power-drawing module.
    const power = choosePowerRun(c, ship.modules, cells, claimedSinks);
    if (power !== undefined) {
      c.job = "haulPower";
      c.carrying = undefined;
      c.carryAmount = undefined;
      c.targetSlotId = power.source.slotId;
      c.haulSinkSlotId = power.sink.slotId;
      c.path = power.path.slice(1);
      claimedSinks.add(power.sink.slotId);
      continue;
    }
  }

  // 4. Walk one cell along each crew member's path (id order for determinism).
  for (const c of ordered) {
    advanceCrew(c, cells);
  }

  // 5. Recompute manning from final positions, then refresh local charge:
  //    hard-wired modules near a reactor refill for free, then every operating
  //    module spends a tick of its buffer.
  recomputeManning(ship);
  rechargeAndConsume(ship);
}

/**
 * Update every power-drawing module's local charge buffer for the tick:
 *  1. Passive wiring — a module within `powerWiringRadius` walkable cells of an
 *     alive reactor is hard-wired and refills to full for free.
 *  2. Consumption — a module that is operating this tick (alive, powered within
 *     the brownout ceiling, and manned, with charge to spend) draws `powerDraw`
 *     from its buffer, floored at zero.
 * Modules off the wiring grid get no free refill, so they drain and starve
 * unless crew haul charge to them; that crew-fed top-up has already happened in
 * the arrival step before this runs. Reactors draw no power and keep no buffer.
 */
function rechargeAndConsume(ship: SimShip): void {
  if (ship.modules === undefined) return;

  // A ship with no crew has no hauling economy: it runs the pre-crew abstract
  // power grid, so every powered module is hard-wired and never starves. The
  // local-charge logistics only engages once a design commits to crew. This
  // keeps charge as a pure refinement layered on top of the existing brownout
  // for crewed ships, leaving crewless designs on the original power model.
  const hasCrew = ship.crew !== undefined && ship.crew.length > 0;
  if (!hasCrew) {
    for (const m of ship.modules) {
      if (m.alive && m.powerDraw > 0) m.charge = SIM.chargeBufferMax;
    }
    return;
  }

  // 1. Cells within the wiring radius of any alive reactor (multi-source BFS
  //    over alive cells). A module on one of these cells is hard-wired.
  const wired = reactorWiringReach(ship);
  for (const m of ship.modules) {
    if (m.powerDraw <= 0 || !m.alive) continue;
    if (wired.has(crewCellKey(m.col, m.row))) m.charge = SIM.chargeBufferMax;
  }

  // 2. Spend a tick of charge from operating modules.
  for (const m of ship.modules) {
    if (m.powerDraw <= 0) continue;
    if (!m.alive || !m.powered || !m.manned || m.charge <= 0) continue;
    m.charge = Math.max(0, m.charge - m.powerDraw);
  }
}

/**
 * The set of cell keys within `powerWiringRadius` walkable steps of any alive
 * reactor, by multi-source breadth-first search over the alive cells. Used to
 * decide which power-drawing modules are hard-wired (free charge) versus
 * crew-fed. Deterministic: BFS frontier order does not affect the resulting set,
 * and the set membership is all the caller reads.
 */
function reactorWiringReach(ship: SimShip): Set<string> {
  const reach = new Set<string>();
  if (ship.modules === undefined) return reach;
  const cells = aliveCellMap(ship);
  // Seed the frontier with every alive reactor cell at distance 0.
  let frontier: { col: number; row: number }[] = [];
  for (const m of ship.modules) {
    if (m.alive && m.effect.kind === "power") {
      const k = crewCellKey(m.col, m.row);
      if (!reach.has(k)) {
        reach.add(k);
        frontier.push({ col: m.col, row: m.row });
      }
    }
  }
  for (let depth = 0; depth < SIM.powerWiringRadius && frontier.length > 0; depth += 1) {
    const next: { col: number; row: number }[] = [];
    for (const cell of frontier) {
      const neighbours = [
        { col: cell.col - 1, row: cell.row },
        { col: cell.col + 1, row: cell.row },
        { col: cell.col, row: cell.row - 1 },
        { col: cell.col, row: cell.row + 1 },
      ];
      for (const n of neighbours) {
        const k = crewCellKey(n.col, n.row);
        if (!cells.has(k) || reach.has(k)) continue;
        reach.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return reach;
}

/**
 * Whether a module has the local charge to operate this tick. A module that
 * draws no power needs no charge and is always charged; a power-drawing module
 * operates only while its local buffer is above zero. Composed with `powered`
 * (the whole-ship brownout ceiling) and `manned` to decide whether a module
 * actually functions: `alive && powered && manned && isCharged(m)`.
 */
function isCharged(m: SimModule): boolean {
  return m.powerDraw <= 0 || m.charge > 0;
}

/**
 * Whether a crew member has finished its current leg: its path is empty and it
 * is standing on the cell of its current `targetSlotId`. A member still walking
 * (non-empty path) or with no target has not arrived.
 */
function hasArrived(crew: SimCrew, bySlot: ReadonlyMap<string, SimModule>): boolean {
  if (crew.path.length > 0 || crew.targetSlotId === undefined) return false;
  const target = bySlot.get(crew.targetSlotId);
  if (target === undefined) return false;
  return target.col === crew.col && target.row === crew.row;
}

/**
 * Resolve a crew member that has reached its current target. Manning members
 * simply hold their station — `recomputeManning` reads their position. A hauler
 * picks up at the source on the first leg, then deposits at the sink on the
 * second; ammo and power runs share the same two-leg shape and differ only in
 * what is moved. Any run whose source is empty, sink is gone, or route is
 * severed abandons and frees the member.
 */
function resolveArrival(
  crew: SimCrew,
  bySlot: ReadonlyMap<string, SimModule>,
  cells: ReadonlyMap<string, SimModule>,
): void {
  if (!hasArrived(crew, bySlot)) return;
  if (crew.job === "haulAmmo") resolveAmmoArrival(crew, bySlot, cells);
  else if (crew.job === "haulPower") resolvePowerArrival(crew, bySlot, cells);
  // Manning members hold their station; nothing to do on arrival.
}

/** Arrival handling for an ammo run: pick up rounds at the magazine, then
 *  deposit them at the dry weapon (clamped to capacity), conserving the amount
 *  carried end to end. */
function resolveAmmoArrival(
  crew: SimCrew,
  bySlot: ReadonlyMap<string, SimModule>,
  cells: ReadonlyMap<string, SimModule>,
): void {
  if (crew.carrying === undefined) {
    const source = crew.targetSlotId !== undefined ? bySlot.get(crew.targetSlotId) : undefined;
    const sink = crew.haulSinkSlotId !== undefined ? bySlot.get(crew.haulSinkSlotId) : undefined;
    if (
      source === undefined ||
      source.ammoStored <= 0 ||
      sink === undefined ||
      !sink.alive ||
      sink.effect.kind !== "weapon"
    ) {
      abandonHaul(crew);
      return;
    }
    const carried = Math.min(SIM.ammoRunAmount, source.ammoStored, ammoShortfall(sink));
    if (carried <= 0) {
      abandonHaul(crew);
      return;
    }
    source.ammoStored -= carried;
    crew.carrying = "ammo";
    crew.carryAmount = carried;
    const path = findCrewPath(cells, { col: crew.col, row: crew.row }, { col: sink.col, row: sink.row });
    if (path === undefined) {
      // Route severed after pickup: drop the rounds back and give up.
      source.ammoStored += carried;
      abandonHaul(crew);
      return;
    }
    crew.targetSlotId = sink.slotId;
    crew.path = path.slice(1);
    return;
  }

  // At the sink weapon, carrying rounds: deposit exactly what was carried,
  // clamped to capacity. The pickup never takes more than the weapon was short
  // of and the weapon can only have fired since, so the clamp never discards.
  const sink = crew.targetSlotId !== undefined ? bySlot.get(crew.targetSlotId) : undefined;
  const carried = crew.carryAmount; // set with carrying at pickup, so defined here
  if (carried !== undefined && sink !== undefined && sink.alive && sink.effect.kind === "weapon") {
    const cap = sink.effect.ammoCapacity;
    if (cap !== undefined) sink.ammo = Math.min(cap, sink.ammo + carried);
  }
  abandonHaul(crew);
}

/** Arrival handling for a power run: pick up a charge packet at the reactor,
 *  then deposit it into the starved module's local buffer (clamped to the buffer
 *  ceiling), conserving the amount carried. */
function resolvePowerArrival(
  crew: SimCrew,
  bySlot: ReadonlyMap<string, SimModule>,
  cells: ReadonlyMap<string, SimModule>,
): void {
  if (crew.carrying === undefined) {
    const source = crew.targetSlotId !== undefined ? bySlot.get(crew.targetSlotId) : undefined;
    const sink = crew.haulSinkSlotId !== undefined ? bySlot.get(crew.haulSinkSlotId) : undefined;
    if (
      source === undefined ||
      source.effect.kind !== "power" ||
      sink === undefined ||
      !sink.alive ||
      sink.powerDraw <= 0
    ) {
      abandonHaul(crew);
      return;
    }
    // A reactor is an unlimited charge source — it produces power every tick —
    // so the packet is bounded only by the buffer headroom and the run amount.
    const carried = Math.min(SIM.powerRunAmount, chargeShortfall(sink));
    if (carried <= 0) {
      abandonHaul(crew);
      return;
    }
    crew.carrying = "power";
    crew.carryAmount = carried;
    const path = findCrewPath(cells, { col: crew.col, row: crew.row }, { col: sink.col, row: sink.row });
    if (path === undefined) {
      abandonHaul(crew);
      return;
    }
    crew.targetSlotId = sink.slotId;
    crew.path = path.slice(1);
    return;
  }

  // At the sink module, carrying charge: refill its buffer, clamped to the
  // ceiling, then free the member.
  const sink = crew.targetSlotId !== undefined ? bySlot.get(crew.targetSlotId) : undefined;
  const carried = crew.carryAmount; // set with carrying at pickup, so defined here
  if (carried !== undefined && sink !== undefined && sink.alive && sink.powerDraw > 0) {
    sink.charge = Math.min(SIM.chargeBufferMax, sink.charge + carried);
  }
  abandonHaul(crew);
}

/** Rounds a weapon is short of its local magazine capacity. Zero for an
 *  unlimited weapon (no `ammoCapacity`) — those are never resupplied. */
function ammoShortfall(weapon: SimModule): number {
  if (weapon.effect.kind !== "weapon") return 0;
  const cap = weapon.effect.ammoCapacity;
  if (cap === undefined) return 0;
  return Math.max(0, cap - weapon.ammo);
}

/**
 * Reset a crew member's task after a break-apart so it re-plans within its new
 * fragment next tick. A member's target or haul route may now live on a
 * different fragment, so the safe, deterministic move is to clear the
 * assignment and let the next updateCrew re-derive it from the fragment's own
 * topology. Position is untouched, so a member standing on a station still mans
 * it (manning is position-based) and is simply re-assigned to it next tick.
 */
function resetCrewForFragment(crew: SimCrew): void {
  crew.job = "idle";
  crew.targetSlotId = undefined;
  crew.haulSinkSlotId = undefined;
  crew.carrying = undefined;
  crew.carryAmount = undefined;
  crew.path = [];
}

/** Release a crew member from any haul assignment, returning it to idle. Any
 *  rounds still in hand are dropped — only happens when a sink or route has been
 *  destroyed, so the loss models cargo lost with the wreckage. */
function abandonHaul(crew: SimCrew): void {
  crew.job = "idle";
  crew.targetSlotId = undefined;
  crew.haulSinkSlotId = undefined;
  crew.carrying = undefined;
  crew.carryAmount = undefined;
  crew.path = [];
}

/**
 * Pick an ammo run for an idle crew member: the first dry weapon (in (col, row)
 * order) with a finite `ammoCapacity` it is short of, that is not already being
 * resupplied, paired with the nearest reachable magazine that still has store.
 * Returns the source magazine, the sink weapon, and the path to the source, or
 * undefined when no run is both needed and reachable.
 *
 * "Dry" is a weapon below a top-up threshold so crew restock proactively rather
 * than only at exactly zero — a magazine run takes several ticks to walk, so a
 * weapon that waited for a literal empty would always be caught mid-salvo with
 * no rounds. The threshold is the run amount: once a weapon could accept a full
 * run, a hauler is dispatched.
 */
function chooseAmmoRun(
  crew: SimCrew,
  modules: readonly SimModule[],
  cells: ReadonlyMap<string, SimModule>,
  claimedWeapons: ReadonlySet<string>,
): { source: SimModule; sink: SimModule; path: { col: number; row: number }[] } | undefined {
  const weapons = modules
    .filter(
      (m) =>
        m.alive &&
        m.effect.kind === "weapon" &&
        m.effect.ammoCapacity !== undefined &&
        ammoShortfall(m) >= SIM.ammoRunAmount &&
        !claimedWeapons.has(m.slotId),
    )
    .slice()
    .sort(compareByCell);
  if (weapons.length === 0) return undefined;

  const magazines = modules
    .filter((m) => m.alive && m.effect.kind === "magazine" && m.ammoStored > 0)
    .slice()
    .sort(compareByCell);
  if (magazines.length === 0) return undefined;

  for (const sink of weapons) {
    for (const source of magazines) {
      const path = findCrewPath(
        cells,
        { col: crew.col, row: crew.row },
        { col: source.col, row: source.row },
      );
      if (path === undefined) continue;
      // Confirm the second leg (magazine -> weapon) is also walkable before
      // committing, so a crew member never picks up rounds it cannot deliver.
      const delivery = findCrewPath(
        cells,
        { col: source.col, row: source.row },
        { col: sink.col, row: sink.row },
      );
      if (delivery === undefined) continue;
      return { source, sink, path };
    }
  }
  return undefined;
}

/** Charge a power-drawing module is short of a full local buffer. Zero for a
 *  module that draws no power. */
function chargeShortfall(m: SimModule): number {
  if (m.powerDraw <= 0) return 0;
  return Math.max(0, SIM.chargeBufferMax - m.charge);
}

/**
 * Pick a power run for an idle crew member: the first power-drawing module (in
 * (col, row) order) whose local charge buffer has fallen a full run-amount short,
 * that is not already being fed, paired with the nearest reachable reactor.
 * Returns the source reactor, the sink module, and the path to the source, or
 * undefined when no run is both needed and reachable.
 *
 * As with ammo, the starvation threshold is the run amount so crew restock
 * proactively: a module that could accept a full charge packet gets a hauler
 * before its buffer empties and the station drops offline mid-fight.
 */
function choosePowerRun(
  crew: SimCrew,
  modules: readonly SimModule[],
  cells: ReadonlyMap<string, SimModule>,
  claimedSinks: ReadonlySet<string>,
): { source: SimModule; sink: SimModule; path: { col: number; row: number }[] } | undefined {
  const sinks = modules
    .filter(
      (m) =>
        m.alive &&
        m.powerDraw > 0 &&
        chargeShortfall(m) >= SIM.powerRunAmount &&
        !claimedSinks.has(m.slotId),
    )
    .slice()
    .sort(compareByCell);
  if (sinks.length === 0) return undefined;

  const reactors = modules
    .filter((m) => m.alive && m.effect.kind === "power")
    .slice()
    .sort(compareByCell);
  if (reactors.length === 0) return undefined;

  for (const sink of sinks) {
    for (const source of reactors) {
      const path = findCrewPath(cells, { col: crew.col, row: crew.row }, { col: source.col, row: source.row });
      if (path === undefined) continue;
      const delivery = findCrewPath(
        cells,
        { col: source.col, row: source.row },
        { col: sink.col, row: sink.row },
      );
      if (delivery === undefined) continue;
      return { source, sink, path };
    }
  }
  return undefined;
}

/**
 * Whether a station kind is one the manning gate governs. Weapons, engines,
 * shields, point-defence, power and magazines must be crewed to function; pure
 * structure (hull) and passive bays (armour, crew quarters, repair) carry no
 * manning requirement of their own, so a non-zero `crewRequired` on them is
 * still honoured but they are not treated as combat stations to chase. We gate
 * exactly the kinds whose `crewRequired` matters to output.
 */
function stationNeedsCrew(m: SimModule): boolean {
  switch (m.effect.kind) {
    case "weapon":
    case "engine":
    case "shield":
    case "pointDefense":
    case "power":
    case "magazine":
      return true;
    case "armour":
    case "crew":
    case "repair":
    case "hull":
    case "rcs":
    case "reactionWheel":
      return false;
  }
}

/**
 * Pick the highest-priority station an idle crew member should man: the first
 * (in `(col, row)` order) under-subscribed station that the crew member can
 * actually reach. "Under-subscribed" means fewer crew are already assigned to it
 * than it requires. Returns the station and the path to it, or undefined when
 * nothing is both needed and reachable (the crew member then stays idle).
 */
function chooseStation(
  crew: SimCrew,
  stations: readonly SimModule[],
  cells: ReadonlyMap<string, SimModule>,
  claimed: ReadonlyMap<string, number>,
): { station: SimModule; path: { col: number; row: number }[] } | undefined {
  for (const station of stations) {
    if ((claimed.get(station.slotId) ?? 0) >= station.crewRequired) continue;
    const path = findCrewPath(cells, { col: crew.col, row: crew.row }, { col: station.col, row: station.row });
    if (path === undefined) continue;
    return { station, path };
  }
  return undefined;
}

/**
 * Walk a crew member one cell along its path, updating its integer cell and
 * clearing the within-cell render offset. When the path empties the crew member
 * has arrived; an idle member with no path simply holds position. The fractional
 * offset is reset to 0 on arrival of each step — render smoothing is purely a UI
 * concern and never feeds back into a gameplay decision.
 */
function advanceCrew(crew: SimCrew, cells: ReadonlyMap<string, SimModule>): void {
  const next = crew.path[0];
  if (next === undefined) {
    crew.ox = 0;
    crew.oy = 0;
    return;
  }
  // If the next step is no longer walkable (its cell died this tick), abandon
  // the route and drop the job; the crew member re-plans next tick from where it
  // stands. A dropped ammo run forgets its sink reservation too.
  if (!cells.has(crewCellKey(next.col, next.row))) {
    abandonHaul(crew);
    return;
  }
  crew.col = next.col;
  crew.row = next.row;
  crew.path = crew.path.slice(1);
  crew.ox = 0;
  crew.oy = 0;
}

/**
 * Recompute every module's `manned` flag from the crew now standing on each
 * cell. A module that needs no crew is always manned; otherwise it is manned
 * when at least `crewRequired` crew occupy its cell. Crew standing on a cell
 * count toward manning regardless of their job label, so a member that has just
 * arrived mans the station the same tick.
 */
function recomputeManning(ship: SimShip): void {
  if (ship.modules === undefined || ship.crew === undefined) return;
  const counts = new Map<string, number>();
  for (const c of ship.crew) {
    const k = crewCellKey(c.col, c.row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const m of ship.modules) {
    if (m.crewRequired <= 0) {
      m.manned = true;
      continue;
    }
    const present = counts.get(crewCellKey(m.col, m.row)) ?? 0;
    m.manned = present >= m.crewRequired;
  }
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
function localCentreOfMass(
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

function recomputeAggregates(ship: SimShip): void {
  if (ship.modules === undefined) return;

  // 1. Supply from alive, manned reactors. A reactor that needs crew only
  //    outputs when its cell is manned — an unmanned reactor is cold.
  let supply = 0;
  for (const m of ship.modules) {
    if (m.alive && m.manned && m.effect.kind === "power") {
      supply += m.effect.output;
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
        break;
      case "armour":
        armourReduction = Math.max(armourReduction, effect.damageReduction);
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
      case "rcs":
      case "reactionWheel":
        break;
    }
  }

  ship.thrust = thrust;
  ship.mass = mass;
  ship.armourReduction = armourReduction;
  ship.maxShield = shieldCapacity;
  ship.shieldRechargeRate = shieldRechargeRate;
  ship.shieldRechargeDelay = shieldRechargeDelay;
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
function hasAliveCommand(ship: SimShip): boolean {
  if (ship.modules === undefined) return true;
  for (const m of ship.modules) {
    if (m.command && m.alive && m.hp > 0) return true;
  }
  return false;
}

/**
 * Score a single enemy for targeting purposes, from `ship`'s perspective.
 * Higher scores are preferred. The raw priority score is blended with a
 * vulnerability score when `vulnerableTargetWeight > 0`:
 *
 *   finalScore = (1 − w) * priorityScore_normalised + w * vulnerabilityScore
 *
 * Priority scores are normalised to the range [0, 1] across the living set
 * so the blend is dimensionally consistent — otherwise a cost-based score in
 * the thousands would swamp a distance-based score near −1.
 *
 * Vulnerability is `1 − (structure + shield) / (maxStructure + maxShield)`,
 * so a freshly spawned enemy scores 0 and a nearly dead one scores near 1.
 * When maxStructure + maxShield is zero the score is treated as 0.
 */
function scoreEnemy(
  ship: SimShip,
  enemy: SimShip,
  living: readonly SimShip[],
): number {
  // Raw priority score (higher = better target for this priority).
  const distSq = (enemy.x - ship.x) ** 2 + (enemy.y - ship.y) ** 2;
  let rawScore: number;
  switch (ship.orders.targetPriority) {
    case "nearest":
      rawScore = -distSq;
      break;
    case "weakest":
      rawScore = -(enemy.structure + enemy.shield);
      break;
    case "strongest":
      rawScore = enemy.structure + enemy.shield;
      break;
    case "highestCost":
      rawScore = enemy.cost;
      break;
  }

  const w = ship.orders.vulnerableTargetWeight;
  if (w <= 0) return rawScore; // fast path: no blending needed

  // Normalise priority score to [0, 1] across the living set so the blend
  // with the vulnerability score (already in [0,1]) is dimensionally consistent.
  let minRaw = rawScore;
  let maxRaw = rawScore;
  for (const e of living) {
    const dSq = (e.x - ship.x) ** 2 + (e.y - ship.y) ** 2;
    let s: number;
    switch (ship.orders.targetPriority) {
      case "nearest":
        s = -dSq;
        break;
      case "weakest":
        s = -(e.structure + e.shield);
        break;
      case "strongest":
        s = e.structure + e.shield;
        break;
      case "highestCost":
        s = e.cost;
        break;
    }
    if (s < minRaw) minRaw = s;
    if (s > maxRaw) maxRaw = s;
  }
  const range = maxRaw - minRaw;
  const normPriority = range > 0 ? (rawScore - minRaw) / range : 1;

  // Vulnerability: fraction of max HP already lost.
  const maxTotal = enemy.maxStructure + enemy.maxShield;
  const curTotal = enemy.structure + enemy.shield;
  const vulnerability = maxTotal > 0 ? 1 - curTotal / maxTotal : 0;

  return (1 - w) * normPriority + w * vulnerability;
}

/**
 * Pick the best target for `ship` from `enemies`.
 *
 * When `focusTargetId` is defined (non-undefined), the ship is part of a
 * focus-fire group and must pick that target if it is still alive. This lets
 * an entire side concentrate fire on one enemy at a time rather than spreading
 * damage across the fleet.
 *
 * Otherwise the ship scores each living enemy with `scoreEnemy` and picks the
 * highest. `vulnerableTargetWeight` blends vulnerability into that score.
 */
function pickTarget(
  ship: SimShip,
  enemies: readonly SimShip[],
  focusTargetId: string | undefined,
): SimShip | undefined {
  const living = enemies.filter((e) => e.alive);
  if (living.length === 0) return undefined;

  // Focus-fire: override individual preference with the fleet-agreed target.
  if (ship.orders.focusFire && focusTargetId !== undefined) {
    const focus = living.find((e) => e.instanceId === focusTargetId);
    if (focus !== undefined) return focus;
    // Fleet target is dead — fall through to individual scoring.
  }

  let best: SimShip | undefined;
  let bestScore = -Infinity;
  for (const enemy of living) {
    const score = scoreEnemy(ship, enemy, living);
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/**
 * Elect the fleet-agreed focus-fire target for a side. All living ships on
 * the side with `focusFire = true` vote by scoring each enemy; the enemy with
 * the highest aggregate score wins. Returns `undefined` when no ships have
 * focus-fire enabled or there are no living enemies.
 *
 * Using an aggregate vote rather than a single ship's score makes the choice
 * stable even as ships are destroyed: the fleet converges on the same answer
 * regardless of which ships are alive, as long as at least one focus-fire ship
 * remains on the side.
 */
function electFocusTarget(
  side: "attacker" | "defender",
  ships: readonly SimShip[],
  enemies: readonly SimShip[],
): string | undefined {
  const living = enemies.filter((e) => e.alive);
  if (living.length === 0) return undefined;
  const voters = ships.filter(
    (s) => s.alive && s.side === side && s.orders.focusFire,
  );
  if (voters.length === 0) return undefined;

  // Aggregate score: sum each voter's scoreEnemy across living enemies.
  const totals = new Map<string, number>();
  for (const voter of voters) {
    for (const enemy of living) {
      const s = scoreEnemy(voter, enemy, living);
      totals.set(enemy.instanceId, (totals.get(enemy.instanceId) ?? 0) + s);
    }
  }

  let bestId: string | undefined;
  let bestTotal = -Infinity;
  for (const [id, total] of totals) {
    if (total > bestTotal) {
      bestTotal = total;
      bestId = id;
    }
  }
  return bestId;
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
 * When the ship carries directional shield modules (an alive shield whose
 * `shieldArc < 2π`), the incoming shot direction is tested against each
 * shield's arc. A directional shield whose arc covers the shot absorbs the
 * hit using its module HP (in addition to the pooled shield pool above),
 * before any structural module is touched. If the directional shield is
 * destroyed, the leftover spills onward to the next-nearest module.
 *
 * `impactX/impactY` are the world-space hit location (a projectile's
 * position, or for hitscan the target's edge facing the shooter). When
 * provided we use the projectile's velocity direction as the shot angle;
 * otherwise we fall back to the direction from the target toward the
 * attacker (or 0 if no attacker is known).
 */
function applyDamage(
  ship: SimShip,
  damage: number,
  shieldPiercing: number,
  armourPiercing: number,
  impactX?: number,
  impactY?: number,
  shotAngle?: number,
  /**
   * Ordered penetration path: the modules the shot passes through, frontmost
   * first, as resolved by the broad-phase cell lookup. When supplied (a
   * projectile-vs-cell hit) structural damage strikes the frontmost cell and
   * any overflow carries to the next cell behind along the travel direction.
   * When omitted (hitscan / legacy) the spill falls back to the nearest-alive
   * heuristic so beams and the aggregated path are unchanged.
   */
  path?: readonly SimModule[],
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
    applyModuleDamage(ship, rawStructure, armourPiercing, impactX, impactY, shotAngle, path);
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
 * Per-module damage.
 *
 * A directional shield module whose arc covers the shot direction always
 * intercepts first (using its own HP as the shield pool); if it is destroyed,
 * the leftover spills onward.
 *
 * The structural hit then resolves one of two ways:
 *  - **cell path** (projectile-vs-cell): when `path` is supplied, the shot
 *    strikes the frontmost cell it passed through and any overflow carries to
 *    the next cell behind along the travel direction, in order, until the
 *    damage is spent or the path is exhausted. This is the exact cell hit the
 *    broad-phase resolved, not a Euclidean nearest guess.
 *  - **nearest fallback** (hitscan / no path): the shot strikes the nearest
 *    alive module to the impact point and spills to the next nearest.
 *
 * In both cases, overflow past the last available module falls through to the
 * hull structure, armour-reduced. A ship with no alive modules takes the full
 * amount to structure.
 */
function applyModuleDamage(
  ship: SimShip,
  amount: number,
  armourPiercing: number,
  impactX?: number,
  impactY?: number,
  shotAngle?: number,
  path?: readonly SimModule[],
): void {
  // Transform the world-space impact point into ship-local (design)
  // coordinates so it lines up with module.x/module.y.
  const local = worldToLocal(ship, impactX, impactY);

  // A directional shield covering the shot intercepts before any structural
  // cell is touched, regardless of which routing the structure uses.
  let remaining = amount;
  const shield = directionalShieldFor(ship, shotAngle);
  if (shield !== undefined) {
    shield.hp -= remaining;
    if (shield.hp > 0) return; // shield absorbed the whole hit
    remaining = -shield.hp;
    shield.hp = 0;
    shield.alive = false;
  }

  if (path !== undefined) {
    // Cell-path penetration: spill through the resolved cells in order. Skip
    // the intercepting shield if it appears in the path (already resolved).
    for (const cell of path) {
      if (remaining <= 0) return;
      if (!cell.alive || cell === shield) continue;
      cell.hp -= remaining;
      if (cell.hp > 0) return; // this cell absorbed the rest
      remaining = -cell.hp;
      cell.hp = 0;
      cell.alive = false;
    }
    // Overflow past the last cell on the path falls to the hull structure.
    if (remaining > 0) spillToStructure(ship, remaining, armourPiercing);
    return;
  }

  // Nearest-alive fallback (hitscan / legacy).
  while (remaining > 0) {
    const target = nearestAliveModule(ship, local);
    if (target === undefined) {
      spillToStructure(ship, remaining, armourPiercing);
      return;
    }
    target.hp -= remaining;
    if (target.hp > 0) return; // module absorbed the whole hit
    remaining = -target.hp;
    target.hp = 0;
    target.alive = false;
  }
}

/** Apply leftover structural damage to the hull, armour-reduced, and kill the
 *  ship if its integrity runs out. */
function spillToStructure(ship: SimShip, amount: number, armourPiercing: number): void {
  const reduction = ship.armourReduction * (1 - armourPiercing);
  ship.structure -= amount * (1 - reduction);
  if (ship.structure <= 0) {
    ship.structure = 0;
    ship.alive = false;
  }
}

/**
 * The alive directional shield module whose arc covers `shotAngle`, or
 * undefined if none does. Each shield's coverage is a cone centred on
 * `shieldFacing` with half-arc `shieldArc/2`; an omnidirectional shield
 * (arc ≥ 2π) is handled by the pooled shield, not here. `shotAngle` is in
 * world coordinates, so it is rotated into the ship's local frame before the
 * arc test. When two shields cover the shot the one with the most remaining
 * HP intercepts, so a pair of front shields share hits rather than the first
 * being chewed apart.
 */
function directionalShieldFor(
  ship: SimShip,
  shotAngle: number | undefined,
): SimModule | undefined {
  if (ship.modules === undefined || shotAngle === undefined) return undefined;
  const localShot = normaliseAngle(shotAngle - ship.facing);
  let candidate: SimModule | undefined;
  let bestScore = -Infinity;
  for (const m of ship.modules) {
    if (!m.alive || m.effect.kind !== "shield") continue;
    if (m.shieldArc >= Math.PI * 2) continue; // omnidirectional, use the pool
    const halfArc = m.shieldArc / 2;
    const offset = Math.abs(angleDifference(m.shieldFacing, localShot));
    if (offset > halfArc) continue; // shot is outside this shield's arc
    if (m.hp > bestScore) {
      bestScore = m.hp;
      candidate = m;
    }
  }
  return candidate;
}

/** Wrap an angle to the (-π, π] interval so `angleDifference` works on it. */
function normaliseAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
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

/**
 * Break-apart: when the alive modules on a modular ship no longer form a
 * single 4-connected graph (sharing a grid edge between adjacent cells),
 * each disconnected component becomes its own rigid body. The largest
 * component stays with the original SimShip (keeping its `instanceId` and
 * side); every smaller component is split off as a fresh SimShip with a
 * fresh id, inheriting the parent's velocity.
 *
 * Connectivity is defined purely on alive modules — dead modules are gone
 * for all purposes including graph connectivity. A non-modular ship (no
 * `modules` array) never splits: the legacy aggregated path stays whole.
 *
 * The split happens at most once per ship per tick. After splitting, the
 * original ship's modules array is mutated so that every module belonging
 * to a non-primary component is marked `alive: false`. The chunk SimShips
 * carry their own copies of those modules (alive: true), re-derived
 * aggregates, and a fresh instanceId from `nextChunkId`.
 *
 * The function returns the list of new chunk ships to be added to the
 * simulation's ship list. Returns an empty array when no split happens.
 */
function splitBreakApart(
  ship: SimShip,
  currentTick: number,
  nextChunkId: (parentId: string, tick: number) => string,
): SimShip[] {
  if (ship.modules === undefined) return [];
  const alive = ship.modules.filter((m) => m.alive);
  if (alive.length === 0) return [];
  // Hull modules are the connectivity anchor for break-apart. A ship
  // whose module set doesn't include any hull cell at all never splits:
  // it's a single rigid body regardless of how far apart its modules
  // sit. This matches the design intent that break-apart is a feature
  // of hull-segmented ships, not a side effect of module distance in
  // ship designs that haven't adopted hull cells. A destroyed hull
  // cell still anchors the ship — the ship was designed with a hull,
  // it just happens to be a destroyed hull cell now.
  const hasAnyHull = ship.modules.some((m) => m.effect.kind === "hull");
  if (!hasAnyHull) return [];

  // Union-Find over alive modules, grouped by exact 4-connected (edge-sharing)
  // grid adjacency. Only alive modules are nodes: a destroyed hull cell no
  // longer bridges its neighbours, so the graph can split apart when an anchor
  // cell dies. Non-modular ships (no `modules` array) never split; the legacy
  // aggregated path stays whole.
  const parent = new Map<SimModule, SimModule>();
  for (const m of alive) parent.set(m, m);
  const find = (m: SimModule): SimModule => {
    let root = m;
    while (parent.get(root) !== root) {
      const next = parent.get(root);
      if (next === undefined) break;
      root = next;
    }
    return root;
  };
  const union = (a: SimModule, b: SimModule): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Index alive modules by their integer cell so each cell can find its four
  // edge neighbours in O(1). Cells are unique per grid position, so the map is
  // one module per (col, row).
  const cellKey = (col: number, row: number): string => `${col},${row}`;
  const byCell = new Map<string, SimModule>();
  for (const m of alive) byCell.set(cellKey(m.col, m.row), m);

  // 4-connected adjacency: a cell unions with the alive module directly above,
  // below, left, and right of it. Diagonal cells are NOT connected — the
  // structural "bolted together" test is a shared edge, not a shared corner.
  for (const m of alive) {
    const edgeNeighbours = [
      byCell.get(cellKey(m.col - 1, m.row)),
      byCell.get(cellKey(m.col + 1, m.row)),
      byCell.get(cellKey(m.col, m.row - 1)),
      byCell.get(cellKey(m.col, m.row + 1)),
    ];
    for (const n of edgeNeighbours) {
      if (n !== undefined) union(m, n);
    }
  }

  // Group alive modules by their component root.
  const components = new Map<SimModule, SimModule[]>();
  for (const m of alive) {
    const r = find(m);
    const list = components.get(r);
    if (list === undefined) components.set(r, [m]);
    else list.push(m);
  }
  if (components.size <= 1) return []; // connected — no split


  // Pick the largest component as the survivor. Ties broken by string
  // comparison on the root slotId so the choice is fully deterministic.
  let survivorRoot: SimModule | undefined;
  let survivorModules: SimModule[] = [];
  for (const [, list] of components) {
    if (
      list.length > survivorModules.length ||
      (list.length === survivorModules.length &&
        survivorRoot !== undefined &&
        list[0] !== undefined &&
        survivorRoot.slotId > list[0].slotId)
    ) {
      survivorRoot = list[0];
      survivorModules = list;
    }
  }
  if (survivorRoot === undefined) return [];

  // Snapshot the parent's pre-split centre of mass before any module
  // migration shifts it. Every fragment's tangential kick is measured
  // relative to this single CoM so total linear and angular momentum are
  // conserved across the split (each cell keeps the world velocity it had
  // as part of the spinning whole; see makeChunkShip).
  const parentComX = ship.comX;
  const parentComY = ship.comY;
  const parentVelX = ship.velX;
  const parentVelY = ship.velY;

  // Partition crew by the component their current cell belongs to. Each cell is
  // unique per component, so a crew member's (col, row) maps it to exactly one
  // fragment; a member mid-path is assigned by where it currently stands. Crew
  // whose cell is in no alive component (it died this tick) are dropped — but
  // updateCrew already removed crew on freshly-dead cells before break-apart, so
  // in practice every member maps to a fragment. The lookup is keyed by cell so
  // the split is deterministic regardless of map iteration order.
  const componentOfCell = new Map<string, SimModule[]>();
  for (const [, list] of components) {
    for (const m of list) componentOfCell.set(cellKey(m.col, m.row), list);
  }
  const crewOfComponent = new Map<SimModule[], SimCrew[]>();
  const parentCrew = ship.crew ?? [];
  for (const c of parentCrew) {
    const list = componentOfCell.get(cellKey(c.col, c.row));
    if (list === undefined) continue; // on a dead cell — killed
    const bucket = crewOfComponent.get(list);
    if (bucket === undefined) crewOfComponent.set(list, [c]);
    else bucket.push(c);
  }

  // Build chunk SimShips for every non-survivor component. Each chunk
  // inherits the parent's world position, facing, and angular velocity, but
  // gets a fresh instanceId and a CoM-tangential linear velocity. The chunk
  // carries its own copies of the migrated SimModules so subsequent ticks
  // treat it as an independent ship.
  const survivorSet = new Set(survivorModules);
  const chunks: SimShip[] = [];
  for (const [, list] of components) {
    if (list === survivorModules) continue;
    const chunkCrew = crewOfComponent.get(list) ?? [];
    const chunk = makeChunkShip(ship, list, chunkCrew, nextChunkId(ship.instanceId, currentTick));
    chunks.push(chunk);
    // Mark the migrated modules as gone on the original ship so its
    // hit-selection and aggregate recompute ignore them from now on.
    for (const m of list) {
      if (!survivorSet.has(m)) {
        m.alive = false;
        m.hp = 0;
      }
    }
  }

  // The parent keeps only the crew whose cell stayed with the survivor
  // fragment; everyone else either migrated to a chunk (copied independently)
  // or died with a severed cell. A migrating crew member that was mid-haul to a
  // station now on a different fragment is reset to idle so it re-plans within
  // its own fragment next tick.
  ship.crew = crewOfComponent.get(survivorModules) ?? [];
  for (const chunk of chunks) {
    if (chunk.crew === undefined) continue;
    for (const c of chunk.crew) resetCrewForFragment(c);
  }
  for (const c of ship.crew) resetCrewForFragment(c);

  // The surviving fragment's centre of mass shifts once the migrated modules
  // are gone. Apply the same tangential split to it so it, too, keeps the
  // world velocity its new CoM had under the parent's spin. recomputeAggregates
  // (run by the caller after this returns) derives the survivor's new CoM, so
  // do it here directly from the survivor module set with the same convention.
  applyMomentumSplitToSurvivor(
    ship,
    survivorModules,
    parentComX,
    parentComY,
    parentVelX,
    parentVelY,
  );
  return chunks;
}

/**
 * Apply the CoM-tangential momentum split to the surviving fragment in place.
 * Mirrors the fragment treatment in makeChunkShip: the survivor's new centre
 * of mass (over its remaining alive cells, the grid being the single source of
 * truth for mass) gains the tangential velocity it had under the parent's spin —
 * `v_parent + ω × (survivorCoM − parentCoM)`, with the local CoM offset rotated
 * by the ship facing into world axes. Angular velocity is unchanged.
 */
function applyMomentumSplitToSurvivor(
  ship: SimShip,
  survivorModules: readonly SimModule[],
  parentComX: number,
  parentComY: number,
  parentVelX: number,
  parentVelY: number,
): void {
  const survivorCom = localCentreOfMass(survivorModules);
  const split = comTangentialVelocity(
    ship.facing,
    ship.angVel,
    parentVelX,
    parentVelY,
    survivorCom.x - parentComX,
    survivorCom.y - parentComY,
  );
  ship.velX = split.vx;
  ship.velY = split.vy;
}

/**
 * Build a fresh SimShip for a disconnected chunk of modules. The chunk
 * inherits the parent's world position and facing verbatim, and a
 * physically correct momentum split: it keeps the parent's angular
 * velocity ω, and its linear velocity is the parent's linear velocity
 * plus the tangential velocity the chunk's centre of mass already had
 * due to the parent's spin — `v_parent + ω × (chunkCoM − parentCoM)`.
 * The CoM offset is ship-local, so it is rotated by the parent's facing
 * into world axes before the cross product, matching the world frame of
 * `velX/velY`. Per-cell masses make each fragment's mass sum correct on
 * recompute, so total linear and angular momentum are conserved across
 * the split (the parent's surviving fragment carries the complement).
 * Aggregates are recomputed from the chunk's own module set so the chunk
 * participates in subsequent ticks' movement, firing, and damage.
 *
 * The chunk's structure field is reset to the parent's remaining
 * structure scaled by the fraction of modules it carries — so a chunk
 * with half the modules takes roughly half the structural damage before
 * dying. This is a v1 simplification: a more faithful model would
 * partition the hull HP by component, but per-module hull HP isn't
 * tracked on the aggregated ship.
 *
 * `instanceId` is supplied by the caller so two runs with identical
 * inputs deterministically produce the same chunk ids. The id is built
 * from the parent's id, the tick the split happened on, and a per-tick
 * counter — together those uniquely identify the chunk within a battle.
 */
function makeChunkShip(
  parent: SimShip,
  modules: readonly SimModule[],
  crew: readonly SimCrew[],
  instanceId: string,
): SimShip {
  const totalAlive = parent.modules === undefined ? 1 : parent.modules.filter((m) => m.alive).length;
  const fraction = totalAlive === 0 ? 1 : modules.length / totalAlive;
  const chunkStructure = Math.max(1, parent.structure * fraction);
  // Independent copies of the modules: mutations on one ship must not
  // bleed into the other.
  const chunkModules: SimModule[] = modules.map((m) => ({ ...m }));
  const chunk: SimShip = {
    instanceId,
    side: parent.side,
    classification: parent.classification,
    x: parent.x,
    y: parent.y,
    facing: parent.facing,
    // Linear velocity starts at the parent's; the tangential term from the
    // parent's spin is added below, once recomputeAggregates has derived the
    // chunk's own centre of mass.
    velX: parent.velX,
    velY: parent.velY,
    // Angular velocity is conserved verbatim — a rigid fragment leaves the
    // parent spinning at the same rate it was spinning as part of the whole.
    angVel: parent.angVel,
    structure: chunkStructure,
    maxStructure: chunkStructure,
    shield: 0,
    maxShield: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    shieldRegenCountdown: 0,
    armourReduction: 0,
    thrust: 0,
    turnRate: 0,
    // Placeholders; recomputeAggregates derives the real mass, CoM, MoI, and
    // broad-phase radius from the chunk's own module set immediately after
    // construction.
    mass: 0,
    comX: 0,
    comY: 0,
    momentOfInertia: 1,
    radius: parent.radius,
    cost: 0,
    weapons: [],
    weaponCooldowns: [],
    orders: parent.orders,
    target: undefined,
    alive: true,
    modules: chunkModules,
    // The crew whose cells fell into this fragment, copied independently so the
    // chunk and its parent never share crew state. A fragment with nobody aboard
    // leaves its crewed stations unmanned — a severed section can't crew itself.
    crew: crew.map((c) => ({ ...c, path: c.path.map((p) => ({ ...p })) })),
    hullBaseThrust: parent.hullBaseThrust,
  };
  // Force a clean recompute so chunk aggregates match its own modules.
  // This derives the chunk's own ship-local centre of mass (comX/comY).
  recomputeAggregates(chunk);
  // Momentum split: set the chunk's linear velocity to the parent's plus the
  // tangential velocity the chunk's CoM had under the parent's spin.
  const split = comTangentialVelocity(
    parent.facing,
    parent.angVel,
    parent.velX,
    parent.velY,
    chunk.comX - parent.comX,
    chunk.comY - parent.comY,
  );
  chunk.velX = split.vx;
  chunk.velY = split.vy;
  // A chunk's shield pool resets to zero — it has no recharge, and the
  // parent's pooled shield doesn't carry over.
  chunk.shield = 0;
  chunk.maxShield = 0;
  return chunk;
}

function spawnProjectile(
  owner: SimShip,
  weapon: WeaponEffect,
  weaponFacing: number,
  muzzleLocalX: number,
  muzzleLocalY: number,
  target: SimShip,
  rng: () => number,
): SimProjectile {
  const aimAngle = Math.atan2(target.y - owner.y, target.x - owner.x);
  // The weapon's mount direction (ship-local) is added to the ship's world
  // heading so a side-mounted weapon fires sideways regardless of where the
  // ship is pointed. `aimAngle` keeps the projectile on-target (homing will
  // take over from there if `tracking > 0`); the spread still perturbs the
  // aim — a side-mounted weapon is just as accurate as a forward one,
  // measured against its own muzzle direction.
  const mountAngle = owner.facing + weaponFacing;
  const spread = weapon.spread > 0 ? ranged(rng, -weapon.spread, weapon.spread) : 0;
  const angle = aimAngle + spread;
  const muzzleX = owner.x + Math.cos(mountAngle) * SIM.muzzleOffset;
  const muzzleY = owner.y + Math.sin(mountAngle) * SIM.muzzleOffset;
  const ttl = Math.ceil((weapon.range + 40) / Math.max(weapon.projectileSpeed, 1));
  const vx = Math.cos(angle) * weapon.projectileSpeed;
  const vy = Math.sin(angle) * weapon.projectileSpeed;
  // Recoil: the firing ship absorbs the projectile's momentum in equal and
  // opposite measure. delta_v_ship = -m_p * v_p / M_ship; the angular kick
  // is the lever arm (muzzle − CoM) cross the projectile's linear momentum,
  // divided by the ship's moment of inertia. Applied before the projectile
  // enters the world so the first tick of travel already reflects the
  // ship's post-recoil velocity.
  applyImpulse(owner, -SIM.projectileMass * vx, -SIM.projectileMass * vy, muzzleLocalX, muzzleLocalY);
  return {
    x: muzzleX,
    y: muzzleY,
    vx,
    vy,
    kind: weapon.weaponType,
    mass: SIM.projectileMass,
    muzzleLocalX,
    muzzleLocalY,
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

/**
 * Apply an instantaneous impulse to a ship: a linear momentum change
 * (deltaPx, deltaPy) in world coordinates, delivered at the ship-local
 * point (localX, localY) relative to the ship origin. The ship's CoM
 * absorbs the linear part (`delta_v = deltaP / M`) and the offset from
 * the CoM produces a torque (`tau = r × deltaP`) which becomes an angular
 * velocity change (`delta_omega = tau / I`). Used for both firing recoil
 * (impulse = -m_p * v_p, applied at the muzzle) and hit impulses
 * (impulse = +m_p * v_p, applied at the impact point).
 *
 * The local point is in ship-local coordinates (un-rotated design frame),
 * so the lever arm is `(localX − comX, localY − comY)` regardless of the
 * ship's world heading. The impulse itself is in world coordinates because
 * that's the frame the projectile's velocity lives in; we rotate it back
 * into the local frame only to compute the cross product for torque.
 */
function applyImpulse(
  ship: SimShip,
  deltaPx: number,
  deltaPy: number,
  localX: number,
  localY: number,
): void {
  if (!ship.alive) return;
  const invMass = 1 / Math.max(ship.mass, 1);
  ship.velX += deltaPx * invMass;
  ship.velY += deltaPy * invMass;
  // Torque = r × F where r is measured from the CoM and F is the impulse
  // expressed in the ship's local frame. Rotate the world impulse by
  // -ship.facing to bring it into the local frame.
  const c = Math.cos(-ship.facing);
  const s = Math.sin(-ship.facing);
  const localImpulseX = deltaPx * c - deltaPy * s;
  const localImpulseY = deltaPx * s + deltaPy * c;
  const rx = localX - ship.comX;
  const ry = localY - ship.comY;
  const torque = rx * localImpulseY - ry * localImpulseX;
  if (ship.momentOfInertia > 0) {
    ship.angVel += torque / ship.momentOfInertia;
  }
}

function isRetreating(ship: SimShip): boolean {
  return (
    ship.maxStructure > 0 &&
    ship.structure / ship.maxStructure < ship.orders.retreatThreshold
  );
}

/** A ship cell placed in the broad-phase: the owning ship, the cell, and its
 *  world-space centre at the moment the hash was built. */
interface ShipCell {
  ship: SimShip;
  module: SimModule;
  wx: number;
  wy: number;
}

/**
 * Build a uniform spatial hash over every alive ship's occupied cells in world
 * space. Each alive module on a modular ship contributes one entry at its
 * world-space cell centre (the ship's pose composed with the cell's ship-local
 * centre). Legacy aggregated ships have no cells, so they don't participate in
 * the cell-level broad-phase — they keep the centre-based behaviour. The hash
 * backs both projectile-vs-cell hits and ship-vs-ship collision so the two
 * agree on where every cell is.
 */
function buildShipCellHash(ships: readonly SimShip[]): SpatialHash<ShipCell> {
  const hash = new SpatialHash<ShipCell>();
  for (const ship of ships) {
    if (!ship.alive || ship.modules === undefined) continue;
    for (const m of ship.modules) {
      if (!m.alive) continue;
      const { wx, wy } = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
      hash.insert({ ship, module: m, wx, wy }, wx, wy);
    }
  }
  return hash;
}

/**
 * Two cells overlap when their world-space centres are within one cell size of
 * each other — each cell is treated as a disc of radius `CELL_SIZE/2`, so the
 * discs intersect when the centre distance is below `CELL_SIZE`. The contact
 * depth is how far the discs overlap; used for positional separation.
 */
const CELL_CONTACT_DISTANCE = CELL_SIZE;

/**
 * Ship-vs-ship collision at cell granularity. All ships are solid bodies —
 * enemies and friendlies alike — so no two ships may interpenetrate. Cells from
 * different ships that overlap (centre distance below `CELL_CONTACT_DISTANCE`)
 * register a contact for that ship pair; per pair, the deepest contact's normal
 * and point drive the response:
 *
 *  - **Elastic impulse** along the contact normal, scaled by the relative
 *    velocity of the two contact points (including each ship's spin), the
 *    reduced mass, and the lever arms about each CoM — delivered through the
 *    existing `applyImpulse` so the linear push and the torque are consistent
 *    with the rest of the rigid-body model. Approaching pairs exchange
 *    momentum; pairs already separating are left alone so a resolved contact
 *    doesn't get pulled back together.
 *  - **Positional separation** pushing the two ships apart along the normal by
 *    the penetration depth, split between them in inverse proportion to mass,
 *    so the cells stop overlapping this tick rather than drifting through.
 *
 * Each ordered ship pair is resolved at most once per tick. Legacy aggregated
 * ships (no cells) don't appear in the hash and so never collide at the cell
 * level — they keep passing through, matching the pre-grid behaviour.
 */
function resolveShipCollisions(hash: SpatialHash<ShipCell>): void {
  // Deepest contact per unordered ship pair.
  interface Contact {
    a: SimShip;
    b: SimShip;
    // Contact point in world space (midpoint of the two cell centres).
    px: number;
    py: number;
    // Unit normal from a toward b.
    nx: number;
    ny: number;
    depth: number;
  }
  const contacts = new Map<string, Contact>();

  for (const entry of hash.entries()) {
    const { ship: a, wx, wy } = entry.payload;
    for (const other of hash.candidates(wx, wy, CELL_CONTACT_DISTANCE)) {
      const b = other.payload.ship;
      if (a === b) continue;
      // Resolve each unordered pair once: only consider a < b by instanceId.
      if (a.instanceId >= b.instanceId) continue;
      const dx = other.wx - wx;
      const dy = other.wy - wy;
      const distSq = dx * dx + dy * dy;
      if (distSq >= CELL_CONTACT_DISTANCE * CELL_CONTACT_DISTANCE) continue;
      const dist = Math.sqrt(distSq);
      const depth = CELL_CONTACT_DISTANCE - dist;
      // Normal from a's cell toward b's cell. When two cells sit exactly on
      // top of each other, fall back to the line between ship centres so the
      // push is still well-defined.
      let nx: number;
      let ny: number;
      if (dist > 1e-9) {
        nx = dx / dist;
        ny = dy / dist;
      } else {
        const cdx = b.x - a.x;
        const cdy = b.y - a.y;
        const cdist = Math.hypot(cdx, cdy);
        if (cdist > 1e-9) {
          nx = cdx / cdist;
          ny = cdy / cdist;
        } else {
          nx = 1;
          ny = 0;
        }
      }
      const key = `${a.instanceId}|${b.instanceId}`;
      const existing = contacts.get(key);
      if (existing === undefined || depth > existing.depth) {
        contacts.set(key, {
          a,
          b,
          px: (wx + other.wx) / 2,
          py: (wy + other.wy) / 2,
          nx,
          ny,
          depth,
        });
      }
    }
  }

  for (const contact of contacts.values()) {
    resolveContact(contact.a, contact.b, contact.px, contact.py, contact.nx, contact.ny, contact.depth);
  }
}

/**
 * Resolve a single ship-vs-ship contact: an elastic impulse along the normal
 * plus positional separation. `(px, py)` is the contact point in world space,
 * `(nx, ny)` the unit normal from `a` toward `b`, and `depth` the penetration.
 */
function resolveContact(
  a: SimShip,
  b: SimShip,
  px: number,
  py: number,
  nx: number,
  ny: number,
  depth: number,
): void {
  const ma = Math.max(a.mass, 1);
  const mb = Math.max(b.mass, 1);

  // Lever arms from each ship's CoM to the contact point, in world space. The
  // CoM is stored in ship-local coordinates, so rotate it into world space and
  // add the ship position to get the world-space pivot.
  const aCom = localPointToWorld(a, a.comX, a.comY);
  const bCom = localPointToWorld(b, b.comX, b.comY);
  const rax = px - aCom.x;
  const ray = py - aCom.y;
  const rbx = px - bCom.x;
  const rby = py - bCom.y;

  // Velocity of each contact point = linear velocity + ω × r (2D: ω × r =
  // (-ω·ry, ω·rx)).
  const vax = a.velX - a.angVel * ray;
  const vay = a.velY + a.angVel * rax;
  const vbx = b.velX - b.angVel * rby;
  const vby = b.velY + b.angVel * rbx;

  // Relative velocity of b's contact point with respect to a's, projected
  // onto the normal. Negative means the points are approaching.
  const rvx = vbx - vax;
  const rvy = vby - vay;
  const approach = rvx * nx + rvy * ny;

  if (approach < 0) {
    // Elastic (restitution 1) impulse magnitude along the normal. The
    // rotational terms (r × n)²/I add the contact's resistance to spin into
    // the effective mass, so a glancing hit off-centre transfers less linear
    // momentum and more spin — consistent with the rigid-body model.
    const ia = a.momentOfInertia > 0 ? a.momentOfInertia : Infinity;
    const ib = b.momentOfInertia > 0 ? b.momentOfInertia : Infinity;
    const raCrossN = rax * ny - ray * nx;
    const rbCrossN = rbx * ny - rby * nx;
    const invEffectiveMass =
      1 / ma + 1 / mb + (raCrossN * raCrossN) / ia + (rbCrossN * rbCrossN) / ib;
    const restitution = 1;
    const j = (-(1 + restitution) * approach) / invEffectiveMass;
    // Equal and opposite impulses at the shared contact point. applyImpulse
    // wants the impulse in world coordinates and the application point in the
    // ship's local frame, so convert the world contact point per ship.
    const aLocal = worldToLocal(a, px, py);
    const bLocal = worldToLocal(b, px, py);
    if (aLocal !== undefined) applyImpulse(a, -j * nx, -j * ny, aLocal.x, aLocal.y);
    if (bLocal !== undefined) applyImpulse(b, j * nx, j * ny, bLocal.x, bLocal.y);
  }

  // Positional separation: push the ships apart along the normal by the
  // penetration depth, split inversely to mass so the lighter ship moves more.
  const totalInvMass = 1 / ma + 1 / mb;
  const aShare = (1 / ma) / totalInvMass;
  const bShare = (1 / mb) / totalInvMass;
  a.x -= nx * depth * aShare;
  a.y -= ny * depth * aShare;
  b.x += nx * depth * bShare;
  b.y += ny * depth * bShare;
}

/** Rotate a ship-local point into world space (the inverse of `worldToLocal`). */
function localPointToWorld(ship: SimShip, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(ship.facing);
  const s = Math.sin(ship.facing);
  return { x: ship.x + lx * c - ly * s, y: ship.y + lx * s + ly * c };
}

export function runBattle(inputs: BattleInputs): BattleResult {
  const rng = mulberry32(inputs.seed >>> 0);
  const ships = inputs.ships.map((s) => toSimShip(s, rng));
  const attackers = ships.filter((s) => s.side === "attacker");
  const defenders = ships.filter((s) => s.side === "defender");
  const byId = new Map(ships.map((s) => [s.instanceId, s]));
  let projectiles: SimProjectile[] = [];
  // Deterministic counter for break-away chunk ids. Each split consumes
  // one tick + one chunk-index slot so two battles with the same seed
  // produce the same chunk ids. Counter is private to this run.
  let chunkSeq = 0;
  const nextChunkId = (parentId: string, tick: number): string =>
    `${parentId}#chunk#${tick}#${chunkSeq += 1}`;

  const frames: BattleFrame[] = [snapshot(0, ships, projectiles)];

  let winner: BattleSide = "draw";
  let resolved = false;

  for (let tick = 1; tick <= inputs.maxTicks; tick++) {
    // 1. Targeting.
    // Elect focus-fire targets once per tick per side. A ship with
    // focusFire=true defers to this fleet-agreed target; all others pick
    // independently. Computing the election outside the per-ship loop keeps
    // determinism: every ship on a side sees the same fleet target for this
    // tick, not a target that shifts as earlier ships set their own.
    const attackerFocusTarget = electFocusTarget("attacker", ships, defenders);
    const defenderFocusTarget = electFocusTarget("defender", ships, attackers);
    for (const ship of ships) {
      if (!ship.alive) continue;
      const enemies = ship.side === "attacker" ? defenders : attackers;
      const focusTarget =
        ship.side === "attacker" ? attackerFocusTarget : defenderFocusTarget;
      ship.target = pickTarget(ship, enemies, focusTarget)?.instanceId;
    }

    // 2. Movement + facing.
    moveShips(ships, byId, inputs.anomaly);

    // 2b. Ship-vs-ship collision at cell granularity. After movement, any two
    //     ships whose cells now overlap are pushed apart with an elastic
    //     impulse plus positional separation, so ships can't drive through each
    //     other. All sides are solid — friendlies collide too.
    resolveShipCollisions(buildShipCellHash(ships));

    // 3. Weapon firing (creates projectiles; hitscan applies damage at once).
    projectiles = projectiles.concat(fireWeapons(ships, byId, rng));

    // 3b. PD cooldowns tick down so a battery that just fired can fire again
    //     the next tick. Tick here (before projectile resolution) so a PD
    //     module that's about to be online can intercept in-flight ordnance
    //     on this same tick if its cooldown just hit 0.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      for (const m of ship.modules) {
        if (!m.alive) continue;
        if (m.effect.kind !== "pointDefense") continue;
        if (m.cooldown > 0) m.cooldown -= 1;
      }
    }

    // 4. Projectile travel, homing, asteroid deflection, and collision.
    projectiles = updateProjectiles(projectiles, byId, inputs.anomaly, rng);

    // 4b. Recompute aggregate stats from the alive module set, so a module
    //     destroyed this tick (hitscan or projectile) is reflected in the
    //     shield pool, thrust, and weapon list before regen and the snapshot,
    //     and carried into the next tick's movement and firing.
    for (const ship of ships) {
      if (ship.modules !== undefined) recomputeAggregates(ship);
    }

    // 4b-crew. Crew AI + movement. After aggregates settle `powered`, each
    //     ship's crew walk one cell toward an under-manned station, then every
    //     module's `manned` flag is recomputed from the new positions. Done
    //     before break-apart so the split partitions crew by their post-move
    //     cell. Fully deterministic: crew iterate in id order, stations scan in
    //     (col, row) order, paths come from the fixed-tie-break A*.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      updateCrew(ship);
    }

    // 4c. Break-apart: if the alive modules on a modular ship no longer
    //     form a single connected graph, split the disconnected pieces
    //     into fresh SimShips. Each chunk gets its own `brokeOff` flag
    //     for the UI to highlight the split. Done after aggregates so
    //     chunks inherit their own recomputed stats.
    const newChunks: SimShip[] = [];
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      const chunks = splitBreakApart(ship, tick, nextChunkId);
      if (chunks.length === 0) continue; // connected — nothing to do
      for (const chunk of chunks) {
        chunk.brokeOff = true;
        newChunks.push(chunk);
      }
      // A modular ship whose split drained it of all alive modules on
      // the survivor side is structurally dead — alive: false stops it
      // from being targeted, firing, or being checked for termination.
      if (ship.modules.every((m) => !m.alive)) {
        ship.alive = false;
        ship.structure = 0;
      } else {
        // Re-run aggregates on the survivor since some modules flipped
        // to dead during the split (they were migrated to chunks).
        recomputeAggregates(ship);
      }
    }
    if (newChunks.length > 0) {
      for (const chunk of newChunks) {
        ships.push(chunk);
        byId.set(chunk.instanceId, chunk);
      }
      // Refresh side lists so termination checks below see new arrivals.
      attackers.length = 0;
      defenders.length = 0;
      for (const s of ships) {
        if (s.side === "attacker") attackers.push(s);
        else defenders.push(s);
      }
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

    // 5b. Module repair (per-module ships only). Each alive repair module on
    //     a living ship picks the first damaged alive module in array order
    //     and heals it by `repairRate`, capped at maxHp. A repair module can
    //     heal itself (a bay patching its own systems); multiple repair
    //     modules each heal one module per tick; if there's nothing damaged
    //     yet, they idle. A repair module destroyed mid-battle can't run
    //     any more. Aggregated ships have no modules to repair, so the step
    //     is skipped for them.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      for (const healer of ship.modules) {
        if (!healer.alive || healer.repairRate <= 0) continue;
        const target = ship.modules.find((m) => m.alive && m.hp < m.maxHp);
        if (target === undefined) continue;
        target.hp = Math.min(target.maxHp, target.hp + healer.repairRate);
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
function shipForceAndTorque(
  ship: SimShip,
  turnSign: number,
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
      const t = effect.thrust;
      if (t <= 0) continue;
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
      maxTorque += effect.torque;
      torque += turnSign * effect.torque;
    }
  }
  return { fx, fy, torque, maxTorque };
}

/**
 * Torque about the CoM from a gimballed engine whose thrust vector points in
 * world-of-ship-local direction `thrustDir + delta`, at lever arm `(rx, ry)`
 * and thrust magnitude `t`. `delta` is the gimbal deflection (clamped by the
 * caller to ±gimbalArc). 2D cross product `r × F`.
 */
function gimbalTorque(
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
 * Phase 3 hook — the attitude controller. Decides the commanded turn sign
 * (−1 clockwise, +1 counter-clockwise, 0 = hold) to bring `ship.facing` to
 * `desiredFacing`. Phase 2 ships a simple proportional rule (turn toward the
 * heading error, hold inside a tiny deadband) so the torque physics is
 * exercisable end to end; Phase 3 replaces the body with bang-bang
 * minimum-time control (accelerate, coast, counter-thrust to arrive at
 * angVel ≈ 0) using the ship's `maxTorque` and moment of inertia. The
 * signature is the seam: only the decision inside changes.
 *
 * Deterministic: a pure function of the ship's facing and the desired heading,
 * no RNG, clock, or iteration-order dependence.
 */
function commandedTurn(facing: number, desiredFacing: number): -1 | 0 | 1 {
  const error = angleDifference(facing, desiredFacing);
  if (Math.abs(error) <= SIM.angularDeadband) return 0;
  return error > 0 ? 1 : -1;
}

/** Rotate a local (ship-frame) vector into world coordinates by `facing`. */
function rotateLocal(facing: number, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: lx * c - ly * s, y: lx * s + ly * c };
}

/**
 * Compute the centroid of all alive ships on a given side. Used by
 * formation-keeping to pull ships toward their fleet's centre of mass.
 * Returns `undefined` when no alive ships are present.
 */
function fleetCentroid(
  ships: readonly SimShip[],
  side: "attacker" | "defender",
): { x: number; y: number } | undefined {
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const s of ships) {
    if (!s.alive || s.side !== side) continue;
    cx += s.x;
    cy += s.y;
    count += 1;
  }
  return count > 0 ? { x: cx / count, y: cy / count } : undefined;
}

function moveShips(
  ships: readonly SimShip[],
  byId: Map<string, SimShip>,
  anomaly: BattleInputs["anomaly"],
): void {
  // Pre-compute fleet centroids once per tick so formation-keeping blends
  // each ship's desired heading toward a stable reference point, not one
  // that shifts mid-loop as individual ships move.
  const centroidAttacker = fleetCentroid(ships, "attacker");
  const centroidDefender = fleetCentroid(ships, "defender");
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
    // Each ship's rangeKeepingBand determines how wide the "at range" dead-zone
    // is. A wider band means the ship tolerates being further from its ideal
    // range before correcting — cautious captains set wide bands, aggressive
    // ones set narrow ones so they close quickly. The inner edge of the dead-
    // zone is `1 - rangeKeepingBand` of `want`; the outer edge is `want`
    // itself (outside `want` always closes).
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

    // Attitude control is pure Newtonian rotation: the attitude controller
    // commands a turn sign, the ship's torque sources produce a real torque
    // about the centre of mass, and `angVel += torque / I; facing += angVel`
    // is the only thing that rotates the ship. There is NO maximum angular
    // speed anywhere — a ship under sustained turning torque keeps spinning up
    // until counter-torque brakes it. The commanded sign is decided by
    // `commandedTurn` (Phase 3 makes it full bang-bang; Phase 2 is a simple
    // proportional turn-toward-error). Both the modular and legacy branches
    // below share this one rotational model — they differ only in where their
    // commandable torque comes from (module geometry vs a scalar derived from
    // ShipStats.turnRate).
    const turnSign = commandedTurn(ship.facing, desiredFacing);

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
      // Engines, RCS, and reaction wheels for the commanded turn sign. The
      // engine `r × F` torque is always present (off-centre thrust spins the
      // ship even with no turn commanded); the gimbal / RCS / wheel torque
      // responds to `turnSign`.
      const { fx, fy, torque } = shipForceAndTorque(ship, turnSign);
      const dir = reverse ? -1 : 1;
      const lx = shouldThrust ? dir * fx : 0;
      const ly = shouldThrust ? dir * fy : 0;
      const world = rotateLocal(ship.facing, lx, ly);
      const invMass = 1 / Math.max(ship.mass, 1);
      ship.velX += world.x * invMass;
      ship.velY += world.y * invMass;
      ship.velX *= SIM.linearDamping;
      ship.velY *= SIM.linearDamping;
      // Newtonian rotation. Torque is measured about the CoM and the moment of
      // inertia is the scalar I = Σ m·|r−com|², so angular acceleration is
      // `α = torque / I` (Newton's second law for rotation). No per-tick cap
      // and no maximum angular speed: angVel accumulates and persists. RCS and
      // wheels still draw thrust to fire, but the engine `r × F` disturbance is
      // applied even when the ship is coasting (shouldThrust false) — a
      // spinning-up engine torques the hull whether or not it is also closing.
      const angularAccel = ship.momentOfInertia > 0 ? torque / ship.momentOfInertia : 0;
      ship.angVel += angularAccel;
      // A small angular damping mirrors linearDamping: real space is
      // frictionless, but the controller's bang-bang braking lands the ship
      // exactly on angVel ≈ 0 only in the continuous limit. This deliberate,
      // minor non-physical bleed keeps a settled ship from jittering on residual
      // spin without meaningfully fighting a real turn (close to 1).
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
    }

    ship.facing += ship.angVel;
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
        const weapon = m.effect;
        const isTurret = m.turretTurnRate > 0;
        // Slew the turret every tick, even while cooling or unpowered, so the
        // barrel keeps tracking and is on-target the moment it can fire again.
        // A fixed mount leaves its barrel on the mount direction.
        let turretCanBear = true;
        if (isTurret) {
          const slew = slewTurret(m, ship, target);
          m.turretAngle = slew.angle;
          turretCanBear = slew.canFire;
        }
        if (m.cooldown > 0) {
          m.cooldown -= 1;
          continue;
        }
        if (!m.powered) continue; // reactor can't sustain it this tick
        if (!m.manned) continue; // nobody crewing the gun — it can't fire
        if (!isCharged(m)) continue; // local charge buffer empty — no juice
        if (dist > weapon.range) continue;
        // Fire gate: a turret fires when its slewed barrel bears on the target
        // (independent of where the ship is pointing); a fixed mount fires
        // only when the ship's own heading brings the target into the forward
        // firing arc, exactly as before turrets existed.
        if (isTurret ? !turretCanBear : facingError > SIM.firingArc) continue;
        if (m.ammo <= 0) continue; // out of ammo; no resupply yet
        // A genuine, in-range shot: spend a round and reset the cycle. Firing
        // direction and recoil use the live barrel angle (which equals the
        // mount facing on a fixed mount), not the static mount direction.
        m.ammo -= 1;
        m.cooldown = weapon.cooldown;
        fireOne(ship, weapon, m.turretAngle, m.x, m.y, target, rng, fired);
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
      // Legacy aggregated path reads facing off the weapon effect (default 0).
      // No per-module muzzle position, so the recoil lever arm is the ship's
      // origin (0, 0) — the legacy CoM.
      fireOne(ship, weapon, weapon.facing ?? 0, 0, 0, target, rng, fired);
    }
  }
  return fired;
}

/** Fire a single weapon: hitscan applies damage immediately at a synthesised
 *  impact point on the target's facing edge; otherwise spawn a projectile.
 *  `weaponFacing` is the weapon's mount direction (radians, ship-local); the
 *  ship adds it to its own heading to figure out the muzzle position.
 *  `muzzleLocalX/Y` is the weapon's position in ship-local coordinates —
 *  the lever arm against the ship's CoM for firing recoil. On the legacy
 *  aggregated path it defaults to (0, 0) (the ship's origin), matching the
 *  pre-rigid-body behaviour where every weapon sat at the pivot. */
function fireOne(
  ship: SimShip,
  weapon: WeaponEffect,
  weaponFacing: number,
  muzzleLocalX: number,
  muzzleLocalY: number,
  target: SimShip,
  rng: () => number,
  fired: SimProjectile[],
): void {
  if (weapon.projectileSpeed <= 0) {
    // Hitscan: the beam strikes the target's edge nearest the shooter.
    // The shot angle (used by directional shields) is the shooter's bearing
    // relative to the target, i.e. the direction the energy is travelling.
    const angle = Math.atan2(target.y - ship.y, target.x - ship.x);
    const ix = target.x + Math.cos(angle) * target.radius;
    const iy = target.y + Math.sin(angle) * target.radius;
    applyDamage(target, weapon.damage, weapon.shieldPiercing, weapon.armourPiercing, ix, iy, angle);
  } else {
    fired.push(spawnProjectile(ship, weapon, weaponFacing, muzzleLocalX, muzzleLocalY, target, rng));
  }
}

/**
 * Roll for a point-defence intercept. Returns true if the projectile was
 * shot down. PD modules on ships on the opposing side that are alive,
 * powered, not on cooldown, and within range of the projectile each get an
 * independent hit roll; the per-module chance stacks as
 * 1 - (1 - p)^n, capped at SIM.pdMaxStackedChance.
 *
 * Only ships with the per-module path (`ship.modules` defined) carry PD.
 * The legacy aggregated path is unaffected. PD requires the defending
 * ship to have an alive command module — coordination matters, same rule
 * as offensive weapons.
 */
function tryPointDefenseIntercept(
  p: SimProjectile,
  byId: Map<string, SimShip>,
  rng: () => number,
): boolean {
  const enemySide: BattleSide = p.ownerSide === "attacker" ? "defender" : "attacker";
  // Walk every alive defending ship; count how many in-range, online PD
  // modules can fire this tick. A single rng draw resolves the stacked
  // chance — keeps the random stream the same length regardless of how
  // many PD modules are present, so a destroyer with two PDs and a cruiser
  // with one see the same determinism behaviour modulo the count.
  let pdCount = 0;
  for (const [, ship] of byId) {
    if (!ship.alive || ship.side !== enemySide) continue;
    if (ship.modules === undefined) continue; // legacy ships don't run PD
    if (!hasAliveCommand(ship)) continue; // no bridge → no coordination
    for (const m of ship.modules) {
      if (!m.alive || !m.powered || !m.manned || !isCharged(m)) continue;
      if (m.cooldown > 0) continue;
      if (m.effect.kind !== "pointDefense") continue;
      const effect: PointDefenseEffect = m.effect;
      const dx = ship.x - p.x;
      const dy = ship.y - p.y;
      if (Math.hypot(dx, dy) <= effect.range) pdCount += 1;
    }
  }
  if (pdCount === 0) return false;
  const perModule = SIM.pdHitChancePerModule;
  const stacked = 1 - Math.pow(1 - perModule, pdCount);
  const capped = Math.min(stacked, SIM.pdMaxStackedChance);
  // Consume one cycle on every contributing module regardless of outcome —
  // a PD battery firing into the sky should still pay its cooldown, so
  // salvos are spaced out across ticks rather than back-to-back.
  for (const [, ship] of byId) {
    if (!ship.alive || ship.side !== enemySide) continue;
    if (ship.modules === undefined) continue;
    if (!hasAliveCommand(ship)) continue;
    for (const m of ship.modules) {
      if (!m.alive || !m.powered || !m.manned || !isCharged(m)) continue;
      if (m.effect.kind !== "pointDefense") continue;
      if (m.cooldown > 0) continue;
      const dx = ship.x - p.x;
      const dy = ship.y - p.y;
      if (Math.hypot(dx, dy) > m.effect.range) continue;
      m.cooldown = m.effect.cooldown;
    }
  }
  return rng() < capped;
}

/**
 * Penetration path for a projectile-vs-cell hit: the alive cells of the struck
 * ship that lie on the projectile's line, ordered front to back along its
 * travel direction. The frontmost cell is the one the broad-phase found; cells
 * behind it (further along `(vx, vy)`) and within half a cell of the line of
 * fire follow, so armour-piercing overflow carries straight through the hull
 * rather than scattering to whichever module happens to be nearest. The
 * direction must be a unit vector.
 */
function penetrationPath(
  ship: SimShip,
  hitWx: number,
  hitWy: number,
  dirX: number,
  dirY: number,
): SimModule[] {
  if (ship.modules === undefined) return [];
  // Projection of the hit point along the travel direction; the path is every
  // cell at or beyond it, within half a cell laterally.
  const hitAlong = hitWx * dirX + hitWy * dirY;
  const onLine: { module: SimModule; along: number }[] = [];
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const { wx, wy } = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
    const along = wx * dirX + wy * dirY;
    if (along < hitAlong - CELL_SIZE / 2) continue; // in front of the entry cell
    const perp = Math.abs((wx - hitWx) * -dirY + (wy - hitWy) * dirX);
    if (perp > CELL_SIZE / 2) continue; // off the line of fire
    onLine.push({ module: m, along });
  }
  onLine.sort((l, r) => l.along - r.along);
  return onLine.map((e) => e.module);
}

function updateProjectiles(
  projectiles: readonly SimProjectile[],
  byId: Map<string, SimShip>,
  anomaly: BattleInputs["anomaly"],
  rng: () => number,
): SimProjectile[] {
  const survivors: SimProjectile[] = [];
  const trackingFactor = anomaly === "nebula" ? SIM.nebulaTrackingFactor : 1;
  // Broad-phase over every alive ship's cells in world space. Projectile hits
  // query this for the frontmost occupied cell on the path instead of scanning
  // every ship. Built once per tick from the post-movement, post-collision
  // positions so a projectile strikes a cell where it actually is.
  const cellHash = buildShipCellHash([...byId.values()]);

  for (const p of projectiles) {
    // Point-defence intercept: PD modules on the opposing side get a chance
    // to shoot down the projectile before it moves on this tick. Only
    // missiles and torpedoes are PD-able; beams and plasma travel too fast
    // to intercept. Multiple PD modules within range stack their per-tick
    // hit chance (1 - (1-p)^n) up to `pdMaxStackedChance`. An unpowered,
    // cooling, or destroyed PD module contributes nothing. PD requires the
    // defending ship to have an alive command module — coordination matters.
    if (p.kind === "missile" || p.kind === "torpedo") {
      if (tryPointDefenseIntercept(p, byId, rng)) continue;
    }

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

    // Collision with an enemy ship. For modular ships the broad-phase finds
    // the frontmost occupied cell on the projectile's path and the hit strikes
    // THAT cell, with armour-piercing overflow carrying to the cell behind.
    // Legacy aggregated ships have no cells in the hash, so they keep the
    // centre-distance test against their radius.
    const enemySide = p.ownerSide === "attacker" ? "defender" : "attacker";
    const speed = Math.hypot(p.vx, p.vy);
    const dirX = speed > 1e-9 ? p.vx / speed : 1;
    const dirY = speed > 1e-9 ? p.vy / speed : 0;

    // Modular ships: nearest enemy cell within the cell contact distance is
    // the frontmost cell struck.
    const cellHit = cellHash.nearestWithin(
      p.x,
      p.y,
      CELL_CONTACT_DISTANCE,
      (c) => c.ship.alive && c.ship.side === enemySide,
    );

    let hit: SimShip | undefined;
    let hitWx = p.x;
    let hitWy = p.y;
    let path: readonly SimModule[] | undefined;
    if (cellHit !== undefined) {
      hit = cellHit.payload.ship;
      hitWx = cellHit.wx;
      hitWy = cellHit.wy;
      path = penetrationPath(hit, hitWx, hitWy, dirX, dirY);
    } else {
      // Legacy fallback: nearest living enemy ship without cells.
      let bestDist = Infinity;
      for (const [, ship] of byId) {
        if (!ship.alive || ship.side !== enemySide) continue;
        if (ship.modules !== undefined) continue; // modular ships use the hash
        const d = Math.hypot(ship.x - p.x, ship.y - p.y);
        if (d < ship.radius && d < bestDist) {
          bestDist = d;
          hit = ship;
        }
      }
    }

    if (hit !== undefined) {
      // The projectile's velocity gives the shot direction; that's what
      // directional shields see.
      const shotAngle = Math.atan2(p.vy, p.vx);
      applyDamage(hit, p.damage, p.shieldPiercing, p.armourPiercing, hitWx, hitWy, shotAngle, path);
      // Hit impulse: the target absorbs the projectile's remaining momentum
      // at the impact point. delta_v = +m_p * v_p / M_target; the lever arm
      // is the impact point (in ship-local) relative to the CoM. Applied
      // after damage so a kill shot still transfers momentum to the
      // (now-dead) hulk, matching conservation. The impact point's local
      // coordinates are derived by un-rotating the world hit position by
      // the target's facing.
      const c = Math.cos(-hit.facing);
      const s = Math.sin(-hit.facing);
      const localX = (hitWx - hit.x) * c - (hitWy - hit.y) * s;
      const localY = (hitWx - hit.x) * s + (hitWy - hit.y) * c;
      applyImpulse(hit, p.mass * p.vx, p.mass * p.vy, localX, localY);
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
        // Record the split frame, then clear so subsequent snapshots
        // don't carry a stale "freshly broken" marker.
        ...(s.brokeOff === true ? { brokeOff: true } : {}),
        // Centre of mass in ship-local coordinates. Omitted when at the
        // origin so legacy replays stay byte-compatible with pre-rigid-body
        // recordings; modular ships with offset CoM always emit it.
        ...(s.comX !== 0 || s.comY !== 0 ? { comX: s.comX, comY: s.comY } : {}),
      };
      if (s.brokeOff === true) s.brokeOff = false;
      if (s.modules === undefined) return base;
      const withModules = {
        ...base,
        modules: s.modules.map((m) => ({
          slotId: m.slotId,
          kind: m.kind,
          x: m.x,
          y: m.y,
          hp: m.hp,
          maxHp: m.maxHp,
          alive: m.alive,
          // Emit the live barrel angle for turrets so the renderer can draw
          // the barrel tracking the target. Omitted on fixed mounts and
          // non-weapon cells (their barrel always points along the mount
          // facing) to keep legacy replays byte-compatible.
          ...(m.turretTurnRate > 0 ? { turretAngle: m.turretAngle } : {}),
          // Manning state — only emitted for stations that need crew, so
          // crewless cells stay byte-identical to pre-crew replays.
          ...(m.crewRequired > 0 ? { manned: m.manned } : {}),
          // Remaining rounds — only for weapons with a finite local magazine
          // (an ammoCapacity); unlimited weapons and non-weapons omit it.
          ...(m.effect.kind === "weapon" && m.effect.ammoCapacity !== undefined
            ? { ammo: m.ammo }
            : {}),
          // Local charge buffer — only for power-drawing modules; draw-free
          // cells omit it so simple designs stay byte-compatible.
          ...(m.powerDraw > 0 ? { charge: m.charge } : {}),
        })),
      };
      // Crew positions and state, in ship-local coordinates. Each crew member
      // sits on the cell of the module at its (col, row); that module's x/y is
      // the cell's ship-local centre, plus the fractional render offset. Omitted
      // when the ship carries no crew so crewless replays stay byte-compatible.
      if (s.crew === undefined || s.crew.length === 0) return withModules;
      const moduleByCell = new Map<string, SimModule>();
      for (const m of s.modules) moduleByCell.set(crewCellKey(m.col, m.row), m);
      return {
        ...withModules,
        crew: s.crew.map((c) => {
          const cell = moduleByCell.get(crewCellKey(c.col, c.row));
          const cx = cell !== undefined ? cell.x : 0;
          const cy = cell !== undefined ? cell.y : 0;
          return {
            id: c.id,
            x: cx + c.ox * CELL_SIZE,
            y: cy + c.oy * CELL_SIZE,
            state: crewState(c),
            hp: c.hp,
            ...(c.carrying !== undefined ? { carrying: c.carrying } : {}),
          };
        }),
      };
    }),
    projectiles: projectiles.map((p) => ({ x: p.x, y: p.y, kind: p.kind })),
  };
}

/**
 * Map a crew member's internal job to the snapshot's state enum the renderer
 * reads. A walking member (one with steps left on its path) shows as `walking`
 * regardless of job; an arrived hauler shows as `hauling`; an arrived gunner as
 * `manning`; an idle member as `idle`. Injury is reserved for a future damage
 * model — crew hp is emitted but not yet reduced, so `injured` is unused here.
 */
function crewState(crew: SimCrew): "idle" | "walking" | "manning" | "hauling" | "injured" {
  if (crew.path.length > 0) return "walking";
  if (crew.job === "haulAmmo" || crew.job === "haulPower") return "hauling";
  if (crew.job === "manning") return "manning";
  return "idle";
}
