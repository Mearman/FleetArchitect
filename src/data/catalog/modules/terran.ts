import type { ModuleDefinitionInput } from "@/schema/module";
import {
  beamWeaponMass,
  crewMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  magazineMass,
  reactorMass,
  shieldMass,
  deflectorMass,
} from "../physics";
import {
  ACTIVE_SENSOR_EMISSION_SCALE,
  ANTIMATTER_POWER_DENSITY_W_PER_M3,
  BEAM_POWER_W,
  BEAM_RANGE_M,
  FUSION_POWER_DENSITY_W_PER_M3,
  KM_DETECTION_RANGE_SCALE,
  MISSILE_RANGE_M,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  ORDNANCE_BURN_TIME_S,
  PROJECTILE_MASS_KG,
  RCS_TORQUE_N_M,
  REACTION_WHEEL_TORQUE_N_M,
  RELOAD_THERMAL_TIME_S,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  TORPEDO_RANGE_M,
  beamDamageJoules,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";
import { poweredMotorBurnTicks, poweredMotorThrustMPerS2 } from "../ordnance-motor";
import {
  SENSOR_OMNI_ARC,
  SENSOR_DIRECTIONAL_ARC,
  SENSOR_WIDE_ARC,
  SENSOR_DISH_ARC,
} from "../sensor-arcs";

// ---------------------------------------------------------------------------
// Terran modules — conventional human technology.
//
// Every module's mass is DERIVED from its capability via the physics-layer
// mass functions in `../physics.ts`:
//
//  - kinetic weapon mass  = `kineticWeaponMass(projectileMass, muzzleVelocity)`
//    from the round's muzzle kinetic energy (½·m·v²);
//  - beam weapon mass    = `beamWeaponMass(beamPower)` from sustained optical
//    power (emitter + cooling stack);
//  - reactor mass        = `reactorMass(output, powerDensity)` from electrical
//    output and the core's volumetric power density;
//  - engine mass         = `engineMass(thrust)` from rated thrust;
//  - shield mass         = `shieldMass(capacity)` from field capacity;
//  - magazine mass       = `magazineMass(ammoStored)` from stored round count;
//  - crew mass           = `crewMass(capacity)` from berth count.
//
// There are NO mount restrictions and NO size classes: any ship can mount any
// module. Validity is emergent from the ship's own power/crew/mass/connectivity
// balance (`stats.ts`), not from an arbitrary size rule.
//
// Masses are in kilograms. Thrust is in Newtons. Range is in metres (world
// coordinates). Power output and module power draw are in watts. Crew values
// are unit-free counts.
//
// The module list, id, name, role, and category are preserved from the
// legacy catalogue; ONLY the capability values and the mass derivation
// change. Stale class-band references are retired.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Beam cooldowns (seconds) and their tick conversions.
//
// A beam fires once every `cooldown` ticks; the energy one shot deposits is its
// sustained power over that inter-shot dwell (`beamDamageJoules`). A faster-
// cycling beam therefore deposits less per shot but fires more often, and a
// slow heavy lance deposits a large pulse on a long cooldown — so beam DPS
// (its `beamPower` in watts) is directly comparable, in joules per second,
// against a kinetic salvo regardless of refire rate.
// ---------------------------------------------------------------------------

/** Pulse laser refire / dwell (s): a fast-cycling point-defence-grade beam. */
const PULSE_LASER_COOLDOWN = cooldownTicks(1);
/** Railgun capacitor-recharge interval (s) between shots. */
const RAILGUN_COOLDOWN = cooldownTicks(3.2);
/** Missile-rack reload interval (s) from the magazine. */
const MISSILE_RACK_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.missile);
/** Plasma-torpedo tube reload interval (s) — the slowest Terran weapon. */
const TORPEDO_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.torpedo);

// ---------------------------------------------------------------------------
// Kinetic-weapon local anchors.
//
// Each Terran kinetic weapon picks a (projectileMass, muzzleVelocity) pairing
// from the broadened `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S` menus
// in `combat-scale.ts`, then its mass, damage, range, projectile speed, and
// cooldown are all DERIVED from those two numbers — never hand-tuned.
// ---------------------------------------------------------------------------

/** Terran railgun slug: a frigate-class electromagnetic round (`railgun`
 *  banding in `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S`). */
const RAILGUN_MASS_KG = PROJECTILE_MASS_KG.railgun;
const RAILGUN_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.railgun;
/** Terran missile body mass (kg) — DERIVED from a frigate-scale guided round,
 *  the same banding a railgun slug uses, since both are frigate ordnance. */
const MISSILE_MASS_KG = PROJECTILE_MASS_KG.railgun;
/** Missile cruise velocity (m/s) — DERIVED as a fraction of a railgun muzzle
 *  velocity: a powered guided round is slower than a launched slug. */
const MISSILE_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.railgun / 4;
/** Terran missile warhead yield (J) — authored catalogue content: a shaped
 *  chemical/plasma warhead sized to a frigate-class railgun salvo (~hundreds of
 *  MJ) so a missile and a slug are comparably decisive against GJ armour. */
const MISSILE_WARHEAD_J = 4e8;
/** Terran torpedo body mass (kg) — DERIVED from a capital-class round (`driver`
 *  banding): a torpedo is the heaviest ordnance a Terran ship carries. */
const TORPEDO_MASS_KG = PROJECTILE_MASS_KG.driver;
/** Torpedo cruise velocity (m/s) — DERIVED as a fraction of a mass-driver
 *  muzzle velocity: a heavy torpedo is the slowest round in flight. */
const TORPEDO_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.driver / 8;
/**
 * Terran missile finite-burn motor — DERIVED from the same ordnance anchors
 * `range` uses (`ORDNANCE_BURN_TIME_S`). A missile is powered+guided: it
 * launches slow and accelerates to cruise over its burn. Thrust is the
 * spawn→cruise gap over the burn time (`poweredMotorThrustMPerS2`); `burnTicks`
 * is the burn in ticks (`poweredMotorBurnTicks`). For a Terran missile
 * (cruise 2000 m/s, 40 s burn): thrust = 0.6 × 2000 / 40 = 30 m/s², burn
 * 1200 ticks.
 */
const MISSILE_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  MISSILE_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.missile,
);
const MISSILE_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.missile);
/**
 * Terran torpedo finite-burn motor — the heavy short-burn band. For a Terran
 * torpedo (cruise 1250 m/s, 8 s burn): thrust = 0.6 × 1250 / 8 ≈ 93.75 m/s²,
 * burn 240 ticks.
 */
const TORPEDO_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  TORPEDO_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.torpedo,
);
const TORPEDO_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.torpedo);
/** Terran plasma-torpedo warhead yield (J) — authored catalogue content: a
 *  capital-grade matter-plasma warhead, ~GJ, the heaviest single Terran hit. */
const TORPEDO_WARHEAD_J = 1.5e9;

// ---------------------------------------------------------------------------
// Reactor output targets and their derived masses.
//
// A reactor's mass is `reactorMass(output, powerDensity) = density ×
// (output / powerDensity)`. A denser core is proportionally smaller and
// lighter for the same output — by physics, not by a size class.
// ---------------------------------------------------------------------------

/** Standard fusion reactor output target (~1.5 GW) — the legacy frigate band. */
const REACTOR_FUSION_OUTPUT_W = 1.5e9;
/** Standard antimatter reactor output target (~5 GW) — a capital core. */
const REACTOR_ANTIMATTER_OUTPUT_W = 5e9;

// ---------------------------------------------------------------------------
// Terran modules — 24 entries, capability-derived.
//
// The module list preserves the legacy id, name, role, and category of each
// entry; ONLY the capability values and the mass derivation change. Mass now
// traces to the module's actual capability via the physics-layer functions
// (`kineticWeaponMass`, `beamWeaponMass`, `reactorMass`, `engineMass`,
// `shieldMass`, `magazineMass`, `crewMass`).
//
// To span a realistic fighter→capital range while keeping 24 modules, the
// capability values of several entries have been re-anchored to the
// broadened menus in `combat-scale.ts` (a PD pulse at 1e8 W, a disruptor at
// 4.5e8 W, a heavy autocannon at 5 km/s, a capital mass driver at 10 km/s,
// an advanced fusion core at 3 GW, an advanced antimatter core at 12 GW, a
// 16-berth crew block, etc.) — so a frigate railgun and a capital driver no
// longer converge on a single "mediumWeapon" band, and mass scales with
// capability across the whole span.
// ---------------------------------------------------------------------------

export const terranModules: ModuleDefinitionInput[] = [
  // --- Weapons ---
  {
    id: "mod-pulse-laser",
    faction: "Terran",
    name: "Pulse Laser",
    description: "Fast, reliable hitscan beam. Cheap and accurate, but low per-hit damage.",
    category: "weapon",
    // Pulse laser: sustained beam power 3e8 W. Mass derived from the broadened
    // beam menu — beamWeaponMass(3e8) = 2500 × (3e8 / 4e7) = 187,500 kg (~188 t).
    // This is now a frigate-scale pulse (up from the legacy ~20 t lightWeapon band),
    // matching the heavier emitter + cooling stack a 300 MW beam needs.
    mass: beamWeaponMass(BEAM_POWER_W.pulse),
    cost: 55,
    // A beam's draw IS its delivered optical power — the grid power it converts
    // straight into the energy it deposits on target.
    powerDraw: BEAM_POWER_W.pulse,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.pulse, PULSE_LASER_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: PULSE_LASER_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.1,
      armourPiercing: 0.2,
      spread: 0,
    },
  },
  {
    id: "mod-railgun",
    faction: "Terran",
    name: "Railgun Turret",
    description: "High-velocity kinetic slug on a powered mount that tracks across a wide arc. Strong range and armour penetration, slow refire.",
    category: "weapon",
    // Railgun: 10 kg @ 8 km/s. Muzzle energy ½·10·8000² = 320 MJ.
    // mass = kineticWeaponMass(10, 8000) = 3500 × (3.2e8 / 2e7) = 56,000 kg (~56 t).
    mass: kineticWeaponMass(RAILGUN_MASS_KG, RAILGUN_MUZZLE_MS),
    cost: 90,
    // A railgun draws the power to recharge its capacitor bank and run its rails.
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(RAILGUN_MASS_KG, RAILGUN_MUZZLE_MS),
      range: kineticRangeM(RAILGUN_MUZZLE_MS),
      cooldown: RAILGUN_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(RAILGUN_MUZZLE_MS),
      projectileMass: RAILGUN_MASS_KG,
      tracking: 0.5,
      shieldPiercing: 0.35,
      armourPiercing: 0.5,
      spread: 0.02,
      // Ballistic slug: unpowered and unguided. `tracking > 0` is the turret slewing, not the round curving.
      powered: false,
      guided: false,
      // A 90° (±π/2) turret that slews briskly to bear on its target.
      turretArc: Math.PI / 2,
      turretTurnRate: 0.08,
      // Finite magazine: `ammo` (start count) AND `ammoCapacity` (crew top-up ceiling) must both be set — omitting `ammo` defaults it to DEFAULT_WEAPON_AMMO.
      ammo: 200,
      ammoCapacity: 200,
    },
  },
  {
    id: "mod-missile-rack",
    faction: "Terran",
    name: "Missile Turret",
    description: "Homing missiles on a fully-rotating launcher that can engage targets in any direction. Great damage, easily defeated by point defences.",
    category: "weapon",
    // Missile body mass is the same band as a railgun slug (a frigate guided
    // round). The ordnance mechanism mass is scaled from the same kinetic
    // energy derivation, then adjusted for the bus envelope.
    mass: kineticWeaponMass(MISSILE_MASS_KG, MUZZLE_VELOCITY_M_PER_S.railgun) * 0.6,
    cost: 110,
    // A missile launcher draws only its autoloader/handling power — the round
    // carries its own energy — so far less than a kinetic gun.
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: MISSILE_WARHEAD_J,
      range: MISSILE_RANGE_M,
      cooldown: MISSILE_RACK_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(MISSILE_CRUISE_MS),
      projectileMass: MISSILE_MASS_KG,
      tracking: 2.5,
      shieldPiercing: 0.15,
      armourPiercing: 0.3,
      spread: 0.4,
      // Powered guided ordnance: a slow launch accelerated to cruise over the
      // motor burn, then a homing coast.
      powered: true,
      guided: true,
      thrust: MISSILE_THRUST_M_PER_S2,
      burnTicks: MISSILE_BURN_TICKS,
      // A full 360° launcher (±π) that slews slowly.
      turretArc: Math.PI,
      turretTurnRate: 0.05,
      ammo: 140,
      ammoCapacity: 140,
    },
  },
  {
    id: "mod-plasma-torpedo",
    faction: "Terran",
    name: "Plasma Torpedo",
    description: "Slow, devastating torpedo. Bypasses some shields and melts armour.",
    category: "weapon",
    // Torpedo body mass from the `driver` banding (capital ordnance).
    mass: kineticWeaponMass(TORPEDO_MASS_KG, MUZZLE_VELOCITY_M_PER_S.driver) * 0.5,
    cost: 180,
    // A torpedo tube draws its loader/handling power; the warhead carries its own
    // energy, so like the missile rack it is an ordnance-class draw.
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 3,
    effect: {
      kind: "weapon",
      weaponType: "torpedo",
      damage: TORPEDO_WARHEAD_J,
      range: TORPEDO_RANGE_M,
      cooldown: TORPEDO_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(TORPEDO_CRUISE_MS),
      projectileMass: TORPEDO_MASS_KG,
      tracking: 1,
      shieldPiercing: 0.45,
      armourPiercing: 0.4,
      spread: 0.05,
      // Powered guided ordnance: a heavy short-burn motor sprinting to cruise.
      powered: true,
      guided: true,
      thrust: TORPEDO_THRUST_M_PER_S2,
      burnTicks: TORPEDO_BURN_TICKS,
      ammo: 90,
      ammoCapacity: 90,
    },
  },
  // --- Defence: shields ---
  {
    id: "mod-shield-mk1",
    faction: "Terran",
    name: "Deflector Shield Mk I",
    description: "Regenerating energy shield. Absorbs hits before they reach the hull.",
    category: "defence",
    // Deflector Mk I: 200 MJ field (light band); mass ≈ 31 t.
    mass: shieldMass(SHIELD_CAPACITY_J.light),
    cost: 70,
    // A shield's draw IS its recharge wattage, so rebuilding the field competes
    // with the weapons and drive for reactor output.
    powerDraw: SHIELD_RECHARGE_W.light,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.light,
      rechargeRate: SHIELD_RECHARGE_W.light,
      rechargeDelay: 120,
    },
  },
  {
    id: "mod-shield-mk2",
    faction: "Terran",
    name: "Deflector Shield Mk II",
    description: "Heavy shield array with greater capacity and faster recharge.",
    category: "defence",
    // Deflector Mk II: 600 MJ field (the legacy `heavy` band) — re-anchored
    // from the old 400 MJ medium to span a heavier capital range.
    // mass = shieldMass(6e8) = 2000 × (6e8 / 1.3e7) ≈ 92,308 kg (~92 t).
    mass: shieldMass(SHIELD_CAPACITY_J.heavy),
    cost: 150,
    // Heavier array: draw equals its recharge wattage (the heavy band).
    powerDraw: SHIELD_RECHARGE_W.heavy,
    crewRequired: 2,
    techLevel: 3,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.heavy,
      rechargeRate: SHIELD_RECHARGE_W.heavy,
      rechargeDelay: 150,
    },
  },
  // --- Defence: deflectors (momentum screens; kg·m/s capacity) ---
  {
    id: "mod-deflector-mk1",
    faction: "Terran",
    name: "Deflector Screen Mk I",
    description: "Momentum screen. Arrests kinetic rounds and rams before they reach the hull.",
    category: "defence",
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.light),
    cost: 70,
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.light,
    crewRequired: 1,
    techLevel: 1,
    effect: { kind: "deflector", capacity: DEFLECTOR_CAPACITY_KG_MPS.light, rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.light, rechargeDelay: 120 },
  },
  {
    id: "mod-deflector-mk2",
    faction: "Terran",
    name: "Deflector Screen Mk II",
    description: "Heavy momentum screen with greater capacity. Stops capital-grade kinetics.",
    category: "defence",
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.heavy),
    cost: 150,
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy,
    crewRequired: 2,
    techLevel: 3,
    effect: { kind: "deflector", capacity: DEFLECTOR_CAPACITY_KG_MPS.heavy, rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy, rechargeDelay: 150 },
  },
  // --- Defence: armour ---    // --- Propulsion ---
  {
    id: "mod-engine-ion",
    faction: "Terran",
    name: "Ion Drive",
    description: "Efficient thruster for basic mobility.",
    category: "propulsion",
    // Ion drive: rated thrust 45 kN.
    // mass = engineMass(45000) = 3000 × (45000 / 5000) = 27,000 kg (~27 t).
    mass: engineMass(driveThrustNewtons("ion")),
    cost: 30,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: driveThrustNewtons("ion") },
  },
  {
    id: "mod-engine-plasma",
    faction: "Terran",
    name: "Plasma Drive",
    description: "High-thrust engine for fast, agile ships.",
    category: "propulsion",
    // Plasma drive: rated thrust 120 kN.
    // mass = engineMass(120000) = 3000 × (120000 / 5000) = 72,000 kg (~72 t).
    mass: engineMass(driveThrustNewtons("plasma")),
    cost: 70,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "engine", thrust: driveThrustNewtons("plasma"), gimbalArc: Math.PI / 6 },
  },
  {
    id: "mod-rcs-thrusters",
    faction: "Terran",
    name: "Manoeuvring Thrusters",
    description: "Reaction-control jets for precise attitude adjustment. Produces torque without forward thrust.",
    category: "propulsion",
    // RCS ring: a small fraction of the ion drive's mass (it is a jet ring, not
    // a main engine).
    mass: engineMass(driveThrustNewtons("ion")) * 0.15,
    cost: 35,
    powerDraw: MODULE_POWER_DRAW_W.attitude,
    crewRequired: 0,
    techLevel: 1,
    // DERIVED from RCS_TORQUE_N_M (combat-scale.ts): the slew spec
    // (MAX_TURN_RATE / SLEW_TIME) applied to a frigate-band reference hull's
    // moment of inertia, so a frigate reaches max turn rate in the slew time.
    effect: { kind: "rcs", torque: RCS_TORQUE_N_M },
  },
  {
    id: "mod-reaction-wheel",
    faction: "Terran",
    name: "Reaction Wheel",
    description: "Spinning mechanical gyroscope for attitude control. Provides torque through momentum exchange with the ship.",
    category: "propulsion",
    // Reaction wheel: heavier than RCS (a real spinning rotor), lighter than
    // a main engine. Sized as a small fraction of a plasma drive.
    mass: engineMass(driveThrustNewtons("plasma")) * 0.2,
    cost: 45,
    powerDraw: MODULE_POWER_DRAW_W.attitude,
    crewRequired: 0,
    techLevel: 2,
    // DERIVED from REACTION_WHEEL_TORQUE_N_M (combat-scale.ts): the slew spec
    // applied to a heavy-frigate / light-cruiser reference hull's moment of
    // inertia — the heavier, more powerful momentum-exchange rotor.
    effect: { kind: "reactionWheel", torque: REACTION_WHEEL_TORQUE_N_M },
  },
  // --- System: power ---
  {
    id: "mod-reactor-fusion",
    faction: "Terran",
    name: "Fusion Reactor",
    description: "Supplies power to the rest of the ship's modules.",
    category: "system",
    // Standard fusion: 1.5 GW output @ 5e7 W/m³ (legacy frigate band).
    // mass = reactorMass(1.5e9, 5e7) = 4000 × (1.5e9 / 5e7) = 120,000 kg (~120 t).
    mass: reactorMass(REACTOR_FUSION_OUTPUT_W, FUSION_POWER_DENSITY_W_PER_M3),
    cost: 80,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 1,
    effect: { kind: "power", output: REACTOR_FUSION_OUTPUT_W },
    command: true,
  },
  {
    id: "mod-reactor-antimatter",
    faction: "Terran",
    name: "Antimatter Core",
    description: "Compact, enormous power output for energy-hungry designs.",
    category: "system",
    // Standard antimatter: 5 GW output @ 2e8 W/m³ (legacy capital band).
    // mass = reactorMass(5e9, 2e8) = 4000 × (5e9 / 2e8) = 100,000 kg (~100 t).
    mass: reactorMass(REACTOR_ANTIMATTER_OUTPUT_W, ANTIMATTER_POWER_DENSITY_W_PER_M3),
    cost: 180,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 3,
    effect: { kind: "power", output: REACTOR_ANTIMATTER_OUTPUT_W },
    command: true,
  },
  // --- Crew ---
  {
    id: "mod-crew-quarters",
    faction: "Terran",
    name: "Crew Quarters",
    description: "Habitation and life support, increasing the crew a ship can sustain.",
    category: "crew",
    // 8 berths: crewMass(8) = 800 × (8 × 12) = 76,800 kg (~77 t).
    mass: crewMass(8),
    cost: 30,
    powerDraw: MODULE_POWER_DRAW_W.crew,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "crew", capacity: 8 },
  },
  {
    id: "mod-munitions-magazine",
    faction: "Terran",
    name: "Munitions Magazine",
    description: "Stores ammunition for heavy weapons. Crew will haul rounds to weapons needing resupply.",
    category: "system",
    // 1200 rounds: magazineMass(1200) = 5000 × (1200 / 30) = 200,000 kg (~200 t).
    mass: magazineMass(1200),
    cost: 50,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "magazine", ammoStored: 1200 },
  },
  // --- System: sensors (directional, mirroring the comms family) ---
  // Sensors project a detection cone (a sector of half-arc `arc` about their
  // world bearing) rather than a scalar radius. `bearing: 0` mounts the cone
  // forward (+x). Detection ranges are banded against the km-scale weapon reaches
  // (an omni ~30 km is shorter than the guns, a directional ~60 km reaches outside
  // most weapon envelopes, a dish ~90 km out-ranges every weapon for genuine early
  // warning): each authored band figure is lifted to the km scale by
  // `KM_DETECTION_RANGE_SCALE`, and an active sensor's `emitStrength` by
  // `ACTIVE_SENSOR_EMISSION_SCALE` so going active stays as loud relative to the
  // (now km-scale) hull ambient as before.
  //
  // Sensor masses are not capability-derived (a sensor's mass is dominated by
  // its array panel and electronics, not by its detection range). They are
  // sized as a small fraction of a drive (an ion drive is a convenient proxy
  // for a few-cubic-metre electronic subsystem).
  {
    id: "mod-sensor-passive",
    faction: "Terran",
    name: "Passive Array",
    description: "Cheap all-round electromagnetic listeners. Silent and crewless — modest detection in every direction without drawing power.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.1,
    cost: 35,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "sensor",
      sensorType: "omni",
      // All-round: arc spans the full half-circle each side (effectively 360°),
      // so the cone is a full circle. Short reach, just outside the visual circle.
      arc: SENSOR_OMNI_ARC,
      detectionRange: 320 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      nebulaImmune: false,
      mode: "passive",
      passiveBands: ["thermal", "radar"],
      gain: 1.0,
    },
  },
  {
    id: "mod-sensor-directional",
    faction: "Terran",
    name: "Directional Scanner",
    description: "Fixed-sector active radar. Sweeps a medium-long forward cone — far better reach than the passive array, but only where it is pointed.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.12,
    cost: 70,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "sensor",
      sensorType: "directional",
      // ~29° half-arc forward cone; reaches just past missile range.
      arc: SENSOR_DIRECTIONAL_ARC,
      detectionRange: 600 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      nebulaImmune: false,
      mode: "active",
      sweepRate: 0.08,
      emitStrength: 500 * ACTIVE_SENSOR_EMISSION_SCALE,
      gain: 2.0,
    },
  },
  {
    id: "mod-sensor-longrange",
    faction: "Terran",
    name: "Long-Range Dish",
    description: "Narrow high-gain dish that out-ranges every weapon. Spots threats long before they can fire, but needs an operator to hold the scan and only sees a tight forward cone.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.18,
    cost: 90,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "sensor",
      sensorType: "dish",
      // ~11° half-arc, very long reach — genuine early warning straight ahead.
      arc: SENSOR_DISH_ARC,
      detectionRange: 900 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      nebulaImmune: false,
      mode: "active",
      sweepRate: 0.03,
      emitStrength: 1200 * ACTIVE_SENSOR_EMISSION_SCALE,
      gain: 5.0,
    },
  },
  {
    id: "mod-sensor-variable",
    faction: "Terran",
    name: "AESA Sensor Suite",
    description: "Electronically steerable phased-array sensor. Trade arc for range on the fly — a wide short-range sweep or a narrow long-range stare.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.2,
    cost: 135,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "sensor",
      sensorType: "variable",
      // Default mid-values; the sim interpolates min/max when steering. A longer
      // range narrows the arc (maxArc at minRange, minArc at maxRange).
      detectionRange: 480 * KM_DETECTION_RANGE_SCALE,
      arc: 0.4,
      bearing: 0,
      nebulaImmune: false,
      minRange: 300 * KM_DETECTION_RANGE_SCALE,
      maxRange: 720 * KM_DETECTION_RANGE_SCALE,
      minArc: 0.15,
      maxArc: 0.6,
      mode: "active",
      sweepRate: 0.12,
      emitStrength: 800 * ACTIVE_SENSOR_EMISSION_SCALE,
      gain: 3.0,
    },
  },
  {
    id: "mod-sensor-gravimetric",
    faction: "Terran",
    name: "Gravimetric Imager",
    description: "Reads mass-distortion signatures through gas clouds in a wide arc. Unaffected by nebulae that blind conventional radar.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.15,
    cost: 140,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 1,
    techLevel: 3,
    effect: {
      kind: "sensor",
      sensorType: "directional",
      // Wide forward cone, nebula-immune — the distinguishing property is seeing
      // through gas, not raw reach.
      arc: SENSOR_WIDE_ARC,
      detectionRange: 700 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      nebulaImmune: true,
      mode: "active",
      sweepRate: 0.06,
      emitStrength: 900 * ACTIVE_SENSOR_EMISSION_SCALE,
      gain: 2.5,
    },
  },

  // --- System: communications ---
  // Comms ranges are lifted to the km combat scale by `KM_DETECTION_RANGE_SCALE`
  // in lockstep with sensor reach, so the squad-net / relay banding holds at the
  // new engagement distances (an omni for local chatter, a dish/laser for relay).
  {
    id: "mod-comms-omni",
    faction: "Terran",
    name: "Omni Transceiver",
    description: "Short-range omnidirectional radio. No crew needed; every ship in the fleet should carry one as a squad-net backbone.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.08,
    cost: 20,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "comms",
      commsType: "omni",
      // Omni arc spans the full hemisphere each side — effectively 360°.
      arc: Math.PI,
      range: 180 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      channel: 0,
      // Low bandwidth: suitable for status pings, not data relay.
      bandwidth: 4,
    },
  },
  {
    id: "mod-comms-directional",
    faction: "Terran",
    name: "Directional Antenna",
    description: "Fixed-sector medium-range link. Better bandwidth than omni at the cost of a narrower field; good for ships that hold formation.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.1,
    cost: 45,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "comms",
      commsType: "directional",
      // ~34° half-arc — a reasonably narrow forward sector.
      arc: 0.6,
      range: 320 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      channel: 0,
      bandwidth: 6,
    },
  },
  {
    id: "mod-comms-dish",
    faction: "Terran",
    name: "Steerable Relay Dish",
    description: "Narrow motorised dish that tracks a designated relay contact. High bandwidth; requires an operator to aim and hold the lock.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.16,
    cost: 80,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "comms",
      commsType: "dish",
      // ~14° half-arc — tightly steerable beam.
      arc: 0.25,
      range: 520 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      channel: 0,
      bandwidth: 10,
    },
  },
  {
    id: "mod-comms-laser",
    faction: "Terran",
    name: "Laser Backbone Link",
    description: "Collimated laser point-to-point link. Extremely high bandwidth and eavesdrop-resistant; demands a skilled operator to maintain alignment.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.14,
    cost: 110,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 1,
    techLevel: 3,
    effect: {
      kind: "comms",
      commsType: "laser",
      // Near-zero arc: effectively a point link.
      arc: 0.12,
      range: 600 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      channel: 0,
      bandwidth: 16,
    },
  },
  {
    id: "mod-comms-variable",
    faction: "Terran",
    name: "AESA Comms Suite",
    description: "Electronically steerable phased-array transceiver. Adjustable range and arc let it switch between local net and long-haul relay roles.",
    category: "system",
    mass: engineMass(driveThrustNewtons("ion")) * 0.18,
    cost: 130,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "comms",
      commsType: "variable",
      // Default to mid-values; the sim will use min/max when steering.
      range: 340 * KM_DETECTION_RANGE_SCALE,
      arc: 0.5,
      bearing: 0,
      channel: 0,
      bandwidth: 8,
      // Electronically steerable bounds.
      minRange: 200 * KM_DETECTION_RANGE_SCALE,
      maxRange: 480 * KM_DETECTION_RANGE_SCALE,
      // Wider arc = short range mode; narrower arc = long-haul relay mode.
      minArc: 0.15,
      maxArc: 0.5,
    },
  },
];
