import { z } from "zod";
import { EntityId } from "./primitives";

/** How a weapon delivers damage; drives projectile behaviour in the sim. */
export const WeaponType = z.enum([
  "beam",
  "cannon",
  "missile",
  "torpedo",
  "plasma",
]);
export type WeaponType = z.infer<typeof WeaponType>;

const zeroToOne = z.number().min(0).max(1);

/** Effect payload for an offensive module. `projectileSpeed: 0` means hitscan.
 *  `ammo` is the finite magazine; when omitted the weapon gets a large default
 *  (`DEFAULT_WEAPON_AMMO`) and effectively never runs dry.
 *  `ammoCapacity` (optional, int >= 0) is the local magazine size a crew ammo-run
 *  tops the weapon up to, distinct from `ammo` which is the starting/abstract count.
 *  When omitted, the weapon is treated as unlimited (effective infinite capacity).
 *  `facing` (radians, ship-local) is the direction the weapon fires relative
 *  to the host ship's heading; default 0 means the weapon fires along +x in
 *  ship-local space, i.e. forward. A side-mounted weapon uses π/2 (left) or
 *  -π/2 (right); a rear-mounted weapon uses π. The engine adds this offset
 *  to the ship's world heading when spawning a projectile or a hitscan shot. */
export const WeaponEffect = z.object({
  kind: z.literal("weapon"),
  weaponType: WeaponType,
  /** Damage of one hit, in joules. Kinetic weapons author this as the round's
   *  muzzle kinetic energy `½·projectileMass·muzzleVelocity²`; beam weapons as
   *  `beamPower(W) × (1 / TICKS_PER_SECOND)` — the energy deposited in one tick's
   *  dwell. Both derive from the anchors in `@/data/catalog/combat-scale`. The
   *  engine subtracts this straight from a cell's joule hit-point pool. */
  damage: z.number().min(0),
  range: z.number().min(0),
  cooldown: z.number().int().min(0),
  /** Round speed in metres PER TICK (consumed raw each tick). The catalogue
   *  authors a muzzle velocity in m/s and stores `v_SI / TICKS_PER_SECOND` here
   *  (see `projectileSpeedMPerTick` in `@/data/catalog/combat-scale`); a raw
   *  m/s value would fly the round `TICKS_PER_SECOND`× too fast. `0` means
   *  hitscan (an instantaneous beam, no projectile). */
  projectileSpeed: z.number().min(0),
  /** Mass of one fired round, in kilograms. Sets both the round's kinetic
   *  energy (`½·m·v²`, the `damage` above for a kinetic weapon) and the recoil
   *  the firing ship feels / the impulse the target absorbs (`m·v`), so momentum
   *  and energy come from one authored mass. Banded by mount class in
   *  `PROJECTILE_MASS_KG` (`@/data/catalog/combat-scale`). A hitscan beam carries
   *  no round, so its mass is 0. */
  projectileMass: z.number().min(0),
  tracking: z.number().min(0),
  shieldPiercing: zeroToOne,
  armourPiercing: zeroToOne,
  spread: z.number().min(0),
  /**
   * Powered×guided taxonomy. The old `WeaponType` enum conflated two independent
   * axes: whether a round has a motor (powered) and whether it steers toward its
   * target (guided). The engine now reads these two booleans directly.
   *
   *  - `powered` — the projectile thrusts during its burn (`burnTicks`), then
   *    coasts ballistically. An unpowered round (cannon slug, plasma bolt) has
   *    no motor; its `thrust`/`burnTicks` stay 0 and it flies as before.
   *  - `guided` — the projectile homes on its `targetId` (the existing `steer`
   *    path, preserving speed magnitude). An unguided round holds its heading.
   *
   * The two are independent: a missile is powered+guided, a torpedo is
   * powered+guided (shorter burn), a cannon slug is unpowered+unguided, a plasma
   * bolt is unpowered+unguided (but self-luminous, handled renderer-side). All
   * four are OPTIONAL on the effect: their absence models a weapon that has no
   * motor / no steering (a beam has no projectile at all; a test scaffold need
   * not declare them). The engine resolves them once at spawn
   * (`spawnProjectile` reads `powered === true`) onto concrete fields on the
   * {@link SimProjectile}, which carries required booleans for its per-tick
   * motor step.
   */
  powered: z.boolean().optional(),
  guided: z.boolean().optional(),
  /**
   * Motor thrust in SI m·s⁻² (acceleration along the heading while burning).
   * Authored in SI and scaled to per-tick at use via `ACCEL_PER_TICK_FROM_SI`,
   * exactly like ship thrust, so a catalogue force in m/s² is dimensionally
   * consistent. Zero / absent for an unpowered round; irrelevant for a beam.
   * Derived for missiles/torpedoes from the spawn→cruise velocity gap over the
   * burn time (`poweredMotorThrustMPerS2`), so the motor's total impulse
   * exactly closes the slow-launch gap.
   */
  thrust: z.number().min(0).optional(),
  /**
   * Rated motor fuel duration in ticks. On the {@link WeaponEffect} this is the
   * weapon's capacity; the spawned {@link SimProjectile} carries a MUTABLE copy
   * that the engine decrements each burning tick. Zero / absent for an
   * unpowered round. Derived for missiles/torpedoes from `poweredMotorBurnTicks`
   * (`burnSeconds × TICKS_PER_SECOND`).
   */
  burnTicks: z.number().int().min(0).optional(),
  /** Finite magazine; consumes 1 per shot and cannot fire at 0. */
  ammo: z.number().int().min(0).optional(),
  /** Local magazine size (int >= 0) that a crew ammo-run tops the weapon up to.
   *  Distinct from `ammo` (starting count). When omitted, weapon is unlimited. */
  ammoCapacity: z.number().int().min(0).optional(),
  /** Direction the weapon fires, in radians, ship-local. Defaults to 0
   *  (fires along ship heading) so existing modules that never declared it
   *  behave exactly as before. */
  facing: z.number().optional(),
  /**
   * Turret traverse: the half-arc (radians, ship-local) the mount can swing
   * either side of its mount direction (`facing`). A weapon with
   * `turretTurnRate > 0` slews a live barrel angle toward its target each
   * tick, clamped to `[facing - turretArc, facing + turretArc]`, and fires
   * (and recoils) along that live angle — independent of the ship's heading.
   * A value of π gives a full 360° turret. Default 0 (a fixed mount that
   * always points along `facing`). Only meaningful on weapon modules.
   */
  turretArc: z.number().min(0).max(Math.PI).optional(),
  /**
   * Turret slew speed in radians per tick. The live barrel angle rotates
   * toward the target bearing by at most this much each tick. `0` (the
   * default) is a fixed mount: the barrel never leaves `facing` and the
   * weapon fires only when the ship's own heading brings the target into
   * the forward firing arc, exactly as before turrets existed.
   */
  turretTurnRate: z.number().min(0).optional(),
});

/** Default ammo for weapons that omit the field. Large enough that a weapon
 *  without an explicit magazine effectively never runs dry in a normal battle,
 *  while still capping pathological infinite-fire loops. */
export const DEFAULT_WEAPON_AMMO = 9999;
export type WeaponEffect = z.infer<typeof WeaponEffect>;

/**
 * Effect payload for a shield generator. `capacity` and `rechargeRate` are SI:
 *  - `capacity` is the energy (joules) the field can absorb before it collapses,
 *    on the same joule scale as weapon damage and cell HP.
 *  - `rechargeRate` is the power (watts, joules per second) the projector draws to
 *    rebuild the field. The engine adds it as `rechargeRate / TICKS_PER_SECOND`
 *    joules per tick (the watts → joules-per-tick boundary), and the catalogue
 *    sets the module's `powerDraw` to this same wattage so recharge competes with
 *    the weapons and drive for reactor output.
 */
export const ShieldEffect = z.object({
  kind: z.literal("shield"),
  /** Energy the field absorbs before collapsing, in joules. */
  capacity: z.number().min(0),
  /** Power drawn to rebuild the field, in watts (joules per second). */
  rechargeRate: z.number().min(0),
  rechargeDelay: z.number().int().min(0),
  /** Adaptive shield: an extra fraction added to the effective recharge rate for
   *  every tick the shield has gone untouched, so a shield left alone recovers
   *  ever faster (capped by the engine). Omitted = a conventional shield whose
   *  recharge never ramps. */
  adaptiveRampRate: z.number().min(0).optional(),
});
export type ShieldEffect = z.infer<typeof ShieldEffect>;

/**
 * Effect payload for a propulsion module.
 *
 * `facing` (radians, ship-local) is the direction the engine points relative
 * to the ship's forward axis. A rear-facing engine on a forward-facing ship
 * therefore has `facing` ≈ π and thrusts the ship along its heading; a
 * side-mounted engine has facing ≈ ±π/2 and strafes perpendicular to the
 * heading. Unbalanced placement of asymmetric engines produces a non-zero
 * net torque about the ship's centre and spins the ship.
 *
 * `gimbalArc` (radians, ≥ 0) is the half-arc either side of `facing` within
 * which the thrust vector may be steered by the attitude controller. A
 * gimballed engine can thereby vector its thrust to produce a commandable
 * torque while still contributing useful linear thrust. Defaults to 0 (fixed
 * mount, no gimbal).
 *
 * `facing` defaults to 0 (forward) when omitted so existing module definitions
 * and legacy designs continue to behave like a single rear-mounted thruster —
 * i.e. a force pointing along the ship's +x axis.
 *
 * There is no per-engine `turnRate`: a ship turns from real torque, not an
 * abstract per-engine scalar. Turning authority comes from engine `r × F`
 * about the centre of mass, gimbal thrust-vectoring, and dedicated RCS /
 * reaction-wheel modules — never a summed engine `turnRate`.
 */
export const EngineEffect = z.object({
  kind: z.literal("engine"),
  thrust: z.number().min(0),
  /** Direction the engine thrusts, in radians, ship-local. Default 0 = forward. */
  facing: z.number().optional(),
  /** Gimbal half-arc in radians. Thrust vector may swing ±gimbalArc from facing. Default 0 = fixed. */
  gimbalArc: z.number().min(0).optional(),
});
export type EngineEffect = z.infer<typeof EngineEffect>;

/** Effect payload for a power plant. `output` is the reactor's electrical output
 *  in watts (joules per second), on the same SI scale as the module power draws
 *  it must cover. */
export const PowerPlantEffect = z.object({
  kind: z.literal("power"),
  /** Reactor electrical output, in watts (joules per second). */
  output: z.number().min(0),
});
export type PowerPlantEffect = z.infer<typeof PowerPlantEffect>;

/** Effect payload for crew quarters / life support. */
export const CrewEffect = z.object({
  kind: z.literal("crew"),
  capacity: z.number().min(0),
});
export type CrewEffect = z.infer<typeof CrewEffect>;

/**
 * Effect payload for a point-defence weapon. Fires at incoming missiles and
 * torpedoes instead of at enemy ships; short range, low per-shot damage, but
 * fast refire so a battery quickly shreds an incoming volley. Ammo is
 * intentionally unlimited — PD is the cheap CIWS-style defence that should
 * never dry up before the ship itself is destroyed.
 */
export const PointDefenseEffect = z.object({
  kind: z.literal("pointDefense"),
  /** Damage per intercept; the projectile is destroyed on any successful hit. */
  damage: z.number().min(0),
  /** Range (battle units) at which a PD module can reach a passing projectile. */
  range: z.number().min(0),
  /** Ticks between intercept attempts; 0 means every tick. */
  cooldown: z.number().int().min(0),
  /** Per-tick hit chance against a single in-range projectile (0..1). */
  hitChance: zeroToOne,
  /** Steering accuracy; 0 means fixed, >0 lets the PD lead its target. */
  tracking: z.number().min(0),
});
export type PointDefenseEffect = z.infer<typeof PointDefenseEffect>;

/**
 * Effect payload for a damage-control / repair bay. Each tick, every alive
 * repair module on a ship heals the HP of one damaged alive module on the
 * same ship by `repairRate` (capped at the target's max HP). A repair module
 * with a `repairRate` of 0 is inert; v1 keeps repair module-driven and does
 * not depend on crew. A typical value is around 2 HP/tick — small per tick,
 * so a single bay can't undo a salvo in one frame but stacks with others
 * and lets the ship stay in the fight longer than it otherwise would.
 */
export const RepairEffect = z.object({
  kind: z.literal("repair"),
  repairRate: z.number().min(0),
});
export type RepairEffect = z.infer<typeof RepairEffect>;

/**
 * Effect payload for a hull section. Hull modules are pure connectivity
 * anchors: they contribute no combat behaviour, but they define the
 * adjacency graph the break-apart logic uses to decide when a damaged
 * modular ship splits into independent chunks. A hull module with a
 * large HP pool is the structural backbone of the ship — destroying
 * it can sever the graph into disconnected components, each of which
 * becomes its own rigid body with its own momentum, modules, and
 * weapons.
 */
export const HullEffect = z.object({
  kind: z.literal("hull"),
});
export type HullEffect = z.infer<typeof HullEffect>;

/** Effect payload for an ammunition magazine. A magazine is a crewed
 * ammo store that crew draw rounds from to resupply weapons. The magazine
 * itself stores a finite amount; crew task logic (phase C+) handles
 * the hauling and redistribution. */
export const MagazineEffect = z.object({
  kind: z.literal("magazine"),
  ammoStored: z.number().int().min(0),
});
export type MagazineEffect = z.infer<typeof MagazineEffect>;

/**
 * Effect payload for a sensor array — directional, mirroring `CommsEffect`.
 *
 * A sensor projects a detection cone (a sector of half-arc `arc` about its
 * world bearing) rather than a scalar radius. The ship's innate visual circle
 * (`SIM.visualLosRadius`) is separate and always present; sensor cones extend
 * detection beyond it in the directions they cover.
 *
 * `sensorType` sets the cone geometry:
 *   - "omni"        — all-round; `arc` is Math.PI so the angle test always
 *                     passes and the cone is a full circle.
 *   - "directional" — fixed-facing sector; `arc` is the half-arc.
 *   - "dish"        — narrow long-range sector; `arc` is the half-beam-width.
 *                     A dish typically needs crew (`crewRequired > 0`) and only
 *                     contributes when manned.
 *   - "variable"    — electronically steerable; range traded against arc via the
 *                     per-instance range dial (longer range narrows the arc),
 *                     bounded by `minArc`/`maxArc` and `minRange`/`maxRange`.
 *
 * `detectionRange` — maximum detection range (world units) along the cone.
 * `arc`            — half-arc in radians; omni sets this to Math.PI (full circle).
 * `bearing`        — ship-local mount bearing in radians (0 = forward / +x).
 * `nebulaImmune`   — true for active LIDAR / gravimetric arrays unaffected by
 *                    nebula attenuation; they keep full range in the gas cloud.
 *
 * Variable-unit optional fields (`minArc`, `maxArc`, `minRange`, `maxRange`)
 * are only meaningful when `sensorType === "variable"`.
 */
export const SensorEffect = z.object({
  kind: z.literal("sensor"),
  sensorType: z.enum(["omni", "directional", "dish", "variable"]),
  /** Maximum detection range in world units along the cone. */
  detectionRange: z.number().min(0),
  /** Half-arc in radians (0 = point, Math.PI = full circle / all-round). */
  arc: z.number().min(0).max(Math.PI),
  /** Ship-local mount bearing in radians (0 = forward). */
  bearing: z.number(),
  /** True for sensor types (active LIDAR, gravimetric) unaffected by nebula gas. */
  nebulaImmune: z.boolean(),
  // Variable-unit range/arc bounds — only used when sensorType === "variable".
  /** Minimum electronically steerable arc (variable units only). */
  minArc: z.number().optional(),
  /** Maximum electronically steerable arc (variable units only). */
  maxArc: z.number().optional(),
  /** Minimum electronically steerable range (variable units only). */
  minRange: z.number().optional(),
  /** Maximum electronically steerable range (variable units only). */
  maxRange: z.number().optional(),
  /** When true, this sensor can acquire cloaked enemies within its detection
   *  range — an active scan defeats passive cloak. Omitted = a passive sensor
   *  that cannot see through cloak. The counter to the cloak stealth tech. */
  pierceCloak: z.boolean().optional(),
  // --- Phase 8/9 radar fields ---
  /** Operational mode: 'active' (emits and listens), 'passive' (listens only),
   *  or 'hybrid' (primary passive with optional active pulses). */
  mode: z.enum(["active", "passive", "hybrid"]).optional(),
  /** Sweep rotations per tick — how quickly the active beam scans the coverage
   *  arc. Relevant only when mode is 'active' or 'hybrid'. */
  sweepRate: z.number().nonnegative().optional(),
  /** Transmit power in watts — governs how far the active emission propagates
   *  and how detectable the sensor is to passive receivers on the enemy side.
   *  Relevant when mode is 'active' or 'hybrid'. */
  emitStrength: z.number().nonnegative().optional(),
  /** Frequency bands the sensor receives on (e.g. 'thermal', 'radar', 'lidar').
   *  Relevant when mode is 'passive' or 'hybrid'. */
  passiveBands: z.array(z.string()).optional(),
  /** Antenna gain factor — multiplies detection sensitivity; higher values give
   *  better detection at range at the cost of narrower effective coverage. */
  gain: z.number().positive().optional(),
});
export type SensorEffect = z.infer<typeof SensorEffect>;

/**
 * Effect payload for a communications module.
 *
 * `commsType` sets the antenna geometry:
 *   - "omni"        — broadcasts in all directions; `arc` should be Math.PI.
 *   - "directional" — fixed-facing sector; `arc` is the half-arc.
 *   - "dish"        — narrow steerable beam; `arc` is the physical half-beam-width.
 *   - "laser"       — point-to-point; `arc` is effectively zero.
 *   - "variable"    — electronically steerable; `minArc`/`maxArc` and
 *                     `minRange`/`maxRange` override the static values.
 *
 * `range`     — maximum contact range in world units.
 * `arc`       — half-arc in radians; omni sets this to Math.PI (full hemisphere,
 *               which at 2 × π covers 360°).
 * `bearing`   — ship-local mount bearing in radians.
 * `channel`   — logical frequency channel (non-negative integer). Ships share
 *               awareness only if their comms channels match.
 * `bandwidth` — maximum simultaneous contacts relayed per tick.
 *
 * Variable-unit optional fields (`minArc`, `maxArc`, `minRange`, `maxRange`)
 * are only meaningful when `commsType === "variable"`.
 *
 * Phase A: inert — contributes mass/cost/power/crew but no comms behaviour.
 * Link logic is Phase C.
 */
export const CommsEffect = z.object({
  kind: z.literal("comms"),
  commsType: z.enum(["omni", "directional", "dish", "laser", "variable"]),
  /** Maximum communication range in world units. */
  range: z.number().min(0),
  /** Half-arc in radians (0 = point, Math.PI = full hemisphere each side). */
  arc: z.number().min(0).max(Math.PI),
  /** Ship-local mount bearing in radians. */
  bearing: z.number(),
  /** Logical frequency channel; two units communicate only on matching channels. */
  channel: z.number().int().min(0),
  /** Maximum contacts relayed per tick (bandwidth cap). */
  bandwidth: z.number().int().min(0),
  // Variable-unit range/arc bounds — only used when commsType === "variable".
  /** Minimum electronically steerable arc (variable units only). */
  minArc: z.number().optional(),
  /** Maximum electronically steerable arc (variable units only). */
  maxArc: z.number().optional(),
  /** Minimum electronically steerable range (variable units only). */
  minRange: z.number().optional(),
  /** Maximum electronically steerable range (variable units only). */
  maxRange: z.number().optional(),
});
export type CommsEffect = z.infer<typeof CommsEffect>;

/**
 * Effect payload for a reaction-control system (RCS) thruster. RCS produces
 * bounded pure torque (either sign), with no net translation force. The
 * controller determines the sign (spin up or down) and magnitude; the module's
 * torque rating is the maximum per tick. RCS is gated by alive, powered, manned,
 * and charged like any engine module.
 */
export const RcsEffect = z.object({
  kind: z.literal("rcs"),
  torque: z.number().min(0),
});
export type RcsEffect = z.infer<typeof RcsEffect>;

/**
 * Effect payload for a reaction wheel. A reaction wheel produces bounded pure
 * torque (either sign) through internal momentum transfer, with no exhaust or
 * translation. The controller determines the sign (spin up or down) and
 * magnitude; the module's torque rating is the maximum per tick. Reaction
 * wheels are gated by alive, powered, manned, and charged like any module.
 * Torque is independent of the wheel's position on the ship (it is not
 * a lever arm effect; the torque is purely internal).
 */
export const ReactionWheelEffect = z.object({
  kind: z.literal("reactionWheel"),
  torque: z.number().min(0),
});
export type ReactionWheelEffect = z.infer<typeof ReactionWheelEffect>;
 /**
 * Effect payload for a blink / jump drive. Teleports the host ship by up to
 * `jumpRange` world units on a `cooldown`, instead of (or as well as) thrusting
 * there. Two modes:
 *   - "tactical" — short range, short cooldown: a combat reposition. The engine
 *     picks the destination from the ship's stance (close on / flank the target
 *     when aggressive, open the range when evasive).
 *   - "escape"   — long range, long cooldown: an emergency disengage fired once
 *     the ship's structure fraction falls below `escapeThreshold`.
 */
export const BlinkEffect = z.object({
  kind: z.literal("blink"),
  mode: z.enum(["tactical", "escape"]),
  /** Maximum teleport distance in world units. */
  jumpRange: z.number().min(0),
  /** Ticks between jumps. */
  cooldown: z.number().int().min(0),
  /** Structure fraction (0..1) at or below which an "escape" drive fires. Only
   *  meaningful when mode === "escape". */
  escapeThreshold: zeroToOne.optional(),
});
export type BlinkEffect = z.infer<typeof BlinkEffect>;

/** Effect payload for an afterburner: a temporary thrust/turn surge on a
 *  cooldown. `thrustBoost`/`turnBoost` are multipliers (>= 1) applied to the
 *  ship's thrust and turn rate for `duration` ticks, then it recharges over the
 *  remainder of `cooldown`. */
export const AfterburnerEffect = z.object({
  kind: z.literal("afterburner"),
  thrustBoost: z.number().min(1),
  turnBoost: z.number().min(1),
  duration: z.number().int().min(1),
  cooldown: z.number().int().min(0),
});
export type AfterburnerEffect = z.infer<typeof AfterburnerEffect>;

/** Effect payload for a reactor overcharge: temporarily raises the ship's power
 *  ceiling by `powerSurge` units for `duration` ticks on a `cooldown`, letting
 *  more modules stay online through a brownout at the cost of a recharge gap. */
export const OverchargeEffect = z.object({
  kind: z.literal("overcharge"),
  powerSurge: z.number().min(0),
  duration: z.number().int().min(1),
  cooldown: z.number().int().min(0),
});
export type OverchargeEffect = z.infer<typeof OverchargeEffect>;

/** Effect payload for a cloak: while active the ship cannot be acquired as a
 *  target. Firing any weapon drops the cloak for `decloakTicks`, after which it
 *  re-engages. Countered by an enemy `SensorEffect` with `pierceCloak` in range. */
export const CloakEffect = z.object({
  kind: z.literal("cloak"),
  /** Ticks the ship stays visible after firing before the cloak re-engages. */
  decloakTicks: z.number().int().min(0),
});
export type CloakEffect = z.infer<typeof CloakEffect>;

/** Effect payload for signature reduction: always-on partial stealth that
 *  shrinks the range at which enemies can acquire this ship to
 *  `acquisitionMultiplier` of their normal detection range (0..1). */
export const SignatureEffect = z.object({
  kind: z.literal("signature"),
  acquisitionMultiplier: zeroToOne,
});
export type SignatureEffect = z.infer<typeof SignatureEffect>;

/** Effect payload for ECM / jamming: degrades incoming fire aimed at this ship.
 *  `trackingReduction` scales down attacker projectile tracking against it and
 *  `lockBreakChance` is the per-tick chance an enemy missile loses lock.
 *  Countered by an attacker's `EccmEffect`. */
export const EcmEffect = z.object({
  kind: z.literal("ecm"),
  trackingReduction: zeroToOne,
  lockBreakChance: zeroToOne,
});
export type EcmEffect = z.infer<typeof EcmEffect>;

/** Effect payload for ECCM: counters enemy ECM by restoring a fraction
 *  (`trackingRestore`, 0..1) of this ship's own weapon tracking / missile lock
 *  that an enemy `EcmEffect` would otherwise strip away. */
export const EccmEffect = z.object({
  kind: z.literal("eccm"),
  trackingRestore: zeroToOne,
});
export type EccmEffect = z.infer<typeof EccmEffect>;

/** Effect payload for a decoy launcher: on a `cooldown`, emits `decoyCount`
 *  false contacts that enemies may target and fire at for `duration` ticks.
 *  Each decoy has `decoyHp` so point-defence and weapons can clear them. */
export const DecoyEffect = z.object({
  kind: z.literal("decoy"),
  decoyCount: z.number().int().min(1),
  duration: z.number().int().min(1),
  cooldown: z.number().int().min(0),
  decoyHp: z.number().min(0),
});
export type DecoyEffect = z.infer<typeof DecoyEffect>;

/** Effect payload for a command/coordination aura: buffs friendly ships within
 *  `radius` world units, adding `accuracyBonus` to their effective tracking/hit
 *  and `rangeBonus` (both 0..1 fractions) to their weapon range. A module
 *  carrying this effect is typically also flagged `command`. */
export const CommandAuraEffect = z.object({
  kind: z.literal("commandAura"),
  radius: z.number().min(0),
  accuracyBonus: zeroToOne,
  rangeBonus: zeroToOne,
});
export type CommandAuraEffect = z.infer<typeof CommandAuraEffect>;

/** Effect payload for a hangar / carrier bay: launches up to `droneCount`
 *  autonomous drones (replaced on a `launchCooldown` as they die), each a small
 *  combatant with `droneHp`, `droneDamage`, `droneRange` and `droneSpeed`.
 *  `droneLifetime`, when set, expires a drone after that many ticks; omitted
 *  means the drone persists until destroyed. */
export const HangarEffect = z.object({
  kind: z.literal("hangar"),
  droneCount: z.number().int().min(1),
  launchCooldown: z.number().int().min(0),
  droneHp: z.number().min(0),
  droneDamage: z.number().min(0),
  droneRange: z.number().min(0),
  droneSpeed: z.number().min(0),
  droneLifetime: z.number().int().min(1).optional(),
});
export type HangarEffect = z.infer<typeof HangarEffect>;

/** Effect payload for a mine layer: deploys up to `mineCount` static proximity
 *  mines (laid on a `layCooldown`), each dealing `mineDamage` within
 *  `mineRadius` once it has finished its `armingDelay`. */
export const MineLayerEffect = z.object({
  kind: z.literal("mineLayer"),
  mineCount: z.number().int().min(1),
  mineDamage: z.number().min(0),
  mineRadius: z.number().min(0),
  layCooldown: z.number().int().min(0),
  armingDelay: z.number().int().min(0),
});
export type MineLayerEffect = z.infer<typeof MineLayerEffect>;

/** Effect payload for a boarding launcher: on a `cooldown`, fires `podCount`
 *  pods carrying `troops` at an enemy within `range`. A pod that reaches its
 *  target disables enemy modules (proportional to `troops`) on contact. */
export const BoardingEffect = z.object({
  kind: z.literal("boarding"),
  podCount: z.number().int().min(1),
  troops: z.number().int().min(1),
  range: z.number().min(0),
  cooldown: z.number().int().min(0),
});
export type BoardingEffect = z.infer<typeof BoardingEffect>;

/**
 * Discriminated union of all module effects. New module kinds extend this.
 */
export const ModuleEffect = z.discriminatedUnion("kind", [
  WeaponEffect,
  ShieldEffect,
  EngineEffect,
  PowerPlantEffect,
  CrewEffect,
  PointDefenseEffect,
  RepairEffect,
  HullEffect,
  MagazineEffect,
  SensorEffect,
  CommsEffect,
  RcsEffect,
  ReactionWheelEffect,
  BlinkEffect,
  AfterburnerEffect,
  OverchargeEffect,
  CloakEffect,
  SignatureEffect,
  EcmEffect,
  EccmEffect,
  DecoyEffect,
  CommandAuraEffect,
  HangarEffect,
  MineLayerEffect,
  BoardingEffect,
]);
export type ModuleEffect = z.infer<typeof ModuleEffect>;

/**
 * A module as it appears in the catalog: a fixed, shareable definition.
 * Ship designs reference modules by id; the catalog is bundled with the app
 * and versioned with it, so it is never stored per-design.
 *
 * `faction` identifies which race's part set this module belongs to. A valid
 * design uses modules (and hull tiles) from exactly one faction.
 */
export const ModuleDefinition = z.object({
  id: EntityId,
  name: z.string().min(1),
  description: z.string(),
  faction: z.string().min(1),
  category: z.enum(["weapon", "defence", "propulsion", "system", "crew"]),
  mass: z.number().min(0),
  cost: z.number().min(0),
  /** Electrical power this module draws to operate, in watts (joules per second),
   *  on the same SI scale as a reactor's `output`. The resource step builds a
   *  power-sink terminal from this figure each tick, so a reactor's output must
   *  cover the summed draw of the modules it feeds. Always >= 0; supply comes from
   *  a `power` effect. */
  powerDraw: z.number().min(0),
  /** Crew required to operate this module (always >= 0). Supply comes from the effect. */
  crewRequired: z.number().min(0),
  effect: ModuleEffect,
  techLevel: z.number().int().min(1).max(5),
  /**
   * Whether this module serves as the ship's bridge / command module. A ship
   * needs at least one alive command module to coordinate its weapons; destroy
   * every command module and the ship can no longer fire. Optional for backward
   * compatibility — modules that omit it are not command modules.
   */
  command: z.boolean().optional(),
  /**
   * Marks a module as a point-defence weapon. The engine already identifies
   * point-defence modules by `effect.kind === "pointDefense"`; this flag is a
   * redundant authoring hint for catalog tools that want to group PD modules
   * without inspecting the effect payload. Optional for backward compatibility
   * — modules whose effect is not point-defence should leave it false.
   */
  pointDefense: z.boolean().optional(),
  /**
   * Optional directional shield arc in radians. When present (and less than 2π)
   * this shield module only protects the ship against hits coming from within
   * `shieldFacing ± shieldArc/2`. When absent or 2π, the shield is omnidirectional
   * (covers the full sphere), preserving the default behaviour for existing
   * shield modules.
   */
  shieldArc: z.number().min(0).max(Math.PI * 2).optional(),
  /** Direction the shield points, in radians. Only meaningful when shieldArc is
   *  set and less than 2π. Default 0 (pointing along the ship's +x). */
  shieldFacing: z.number().optional(),
});
export type ModuleDefinition = z.infer<typeof ModuleDefinition>;
