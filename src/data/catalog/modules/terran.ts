import type { ModuleDefinition } from "@/schema/module";
import {
  driveThrustNewtons,
  moduleMass,
} from "../physics";
import {
  ACTIVE_SENSOR_EMISSION_SCALE,
  ANTIMATTER_REACTOR_OUTPUT_W,
  BEAM_POWER_W,
  BEAM_RANGE_M,
  FUSION_REACTOR_OUTPUT_W,
  KM_DETECTION_RANGE_SCALE,
  MISSILE_RANGE_M,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  PROJECTILE_MASS_KG,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  TORPEDO_RANGE_M,
  beamDamageJoules,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";
import {
  SENSOR_OMNI_ARC,
  SENSOR_DIRECTIONAL_ARC,
  SENSOR_WIDE_ARC,
  SENSOR_DISH_ARC,
} from "../sensor-arcs";

// ---------------------------------------------------------------------------
// Weapon damage and projectile speed are DERIVED from the combat-scale anchors
// (`../combat-scale.ts`), not authored as point literals:
//
//  - a kinetic weapon's `damage` is its round's muzzle kinetic energy
//    `kineticDamageJoules(projectileMass, muzzleVelocity)` (½·m·v²), and its
//    `projectileSpeed` is `projectileSpeedMPerTick(muzzleVelocity)` (the m/s →
//    m/tick boundary, so a round authored in km/s does not fly TPS× too fast);
//  - a beam weapon's per-tick `damage` is `beamDamageJoules(beamPower)`
//    (power × one-tick dwell), and it is hitscan (`projectileSpeed: 0`);
//  - a missile / torpedo carries an authored warhead yield (joules) and a body
//    mass / cruise velocity for momentum and flight, authored locally with a
//    "DERIVED from" note naming the real quantity.
//
// `range` is DERIVED per weapon type from the combat-scale anchors:
//  - a beam reaches `BEAM_RANGE_M` (√3 · Rayleigh reference ≈ 52 km);
//  - a kinetic gun reaches `kineticRangeM(muzzleVelocity)` (muzzle × time-of-
//    flight budget);
//  - a missile / torpedo reaches `MISSILE_RANGE_M` / `TORPEDO_RANGE_M`
//    (cruise Δv × motor burn time).
// `cooldown` is DERIVED as `cooldownTicks(reloadSeconds)` — the real refire
// mechanism interval (a capacitor recharge, a cyclic feed, a magazine reload, a
// beam dwell/thermal recovery) in seconds × TICKS_PER_SECOND. The reload-second
// value is authored catalogue content per weapon (its mechanism's cycle time),
// the same way muzzle velocity is; the tick conversion is the derivation. A
// beam's per-shot energy is its power over that same cooldown dwell, so the
// cooldown is computed once and fed to both `cooldown` and `beamDamageJoules`.
// ---------------------------------------------------------------------------

/** Pulse-laser refire / dwell (s): a fast-cycling point-defence-grade beam. */
const PULSE_LASER_COOLDOWN = cooldownTicks(1);
/** Railgun capacitor-recharge interval (s) between shots. */
const RAILGUN_COOLDOWN = cooldownTicks(2);
/** Missile-rack reload interval (s) from the magazine. */
const MISSILE_RACK_COOLDOWN = cooldownTicks(3.3);
/** Plasma-torpedo tube reload interval (s) — the slowest Terran weapon. */
const TORPEDO_COOLDOWN = cooldownTicks(4.7);

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
/** Terran plasma-torpedo warhead yield (J) — authored catalogue content: a
 *  capital-grade matter-plasma warhead, ~GJ, the heaviest single Terran hit. */
const TORPEDO_WARHEAD_J = 1.5e9;

// ---------------------------------------------------------------------------
// Terran modules — conventional human technology.
//
// Masses are in kilograms, derived from `moduleMass` in `../physics.ts`
// (`meanDensity × moduleVolume`). Thrust is in Newtons, derived from
// `driveThrustNewtons` (`massFlow × exhaustVelocity`). Range is in metres
// (world coordinates). Power output and module power draw are in watts, DERIVED
// from the combat-scale anchors: a reactor's output is its core's power density
// times its module volume (`FUSION_REACTOR_OUTPUT_W` / `ANTIMATTER_REACTOR_OUTPUT_W`),
// a beam weapon's draw is its delivered optical power (`BEAM_POWER_W`), a shield's
// draw is its recharge wattage (`SHIELD_RECHARGE_W`, so rebuilding the field
// competes for reactor watts), and every other powered module draws its class
// figure (`MODULE_POWER_DRAW_W`). Crew values are unit-free counts.
// ---------------------------------------------------------------------------
const ionThrustN = driveThrustNewtons("ion");
const plasmaThrustN = driveThrustNewtons("plasma");

export const terranModules: ModuleDefinition[] = [
  // --- Weapons ---
  {
    id: "mod-pulse-laser",
    faction: "Terran",
    name: "Pulse Laser",
    description: "Fast, reliable hitscan beam. Cheap and accurate, but low per-hit damage.",
    category: "weapon",
    mass: moduleMass("lightWeapon"),
    cost: 40,
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
      shieldPiercing: 0,
      armourPiercing: 0.1,
      spread: 0,
    },
  },
  {
    id: "mod-railgun",
    faction: "Terran",
    name: "Railgun Turret",
    description: "High-velocity kinetic slug on a powered mount that tracks across a wide arc. Strong range and armour penetration, slow refire.",
    category: "weapon",
    mass: moduleMass("mediumWeapon"),
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
      // A 90° (±π/2) turret that slews briskly to bear on its target.
      turretArc: Math.PI / 2,
      turretTurnRate: 0.08,
      /** Railgun needs finite ammo resupply. */
      ammoCapacity: 200,
    },
  },
  {
    id: "mod-missile-rack",
    faction: "Terran",
    name: "Missile Turret",
    description: "Homing missiles on a fully-rotating launcher that can engage targets in any direction. Great damage, easily defeated by point defences.",
    category: "weapon",
    mass: moduleMass("mediumWeapon"),
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
      // A full 360° launcher (±π) that slews slowly.
      turretArc: Math.PI,
      turretTurnRate: 0.05,
      /** Missiles need finite ammo resupply. */
      ammoCapacity: 140,
    },
  },
  {
    id: "mod-plasma-torpedo",
    faction: "Terran",
    name: "Plasma Torpedo",
    description: "Slow, devastating torpedo. Bypasses some shields and melts armour.",
    category: "weapon",
    mass: moduleMass("heavyWeapon"),
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
      /** Torpedoes need finite ammo resupply. */
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
    mass: moduleMass("shield"),
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
    mass: moduleMass("shield"),
    cost: 150,
    // Heavier array: draw equals its recharge wattage (the medium band).
    powerDraw: SHIELD_RECHARGE_W.medium,
    crewRequired: 2,
    techLevel: 3,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.medium,
      rechargeRate: SHIELD_RECHARGE_W.medium,
      rechargeDelay: 150,
    },
  },
  // --- Defence: armour ---    // --- Propulsion ---
  {
    id: "mod-engine-ion",
    faction: "Terran",
    name: "Ion Drive",
    description: "Efficient thruster for basic mobility.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 30,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: ionThrustN },
  },
  {
    id: "mod-engine-plasma",
    faction: "Terran",
    name: "Plasma Drive",
    description: "High-thrust engine for fast, agile ships.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 70,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "engine", thrust: plasmaThrustN, gimbalArc: Math.PI / 6 },
  },
  {
    id: "mod-rcs-thrusters",
    faction: "Terran",
    name: "Manoeuvring Thrusters",
    description: "Reaction-control jets for precise attitude adjustment. Produces torque without forward thrust.",
    category: "propulsion",
    mass: moduleMass("rcs"),
    cost: 35,
    powerDraw: MODULE_POWER_DRAW_W.attitude,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "rcs", torque: 10_000_000 },
  },
  {
    id: "mod-reaction-wheel",
    faction: "Terran",
    name: "Reaction Wheel",
    description: "Spinning mechanical gyroscope for attitude control. Provides torque through momentum exchange with the ship.",
    category: "propulsion",
    mass: moduleMass("reactionWheel"),
    cost: 45,
    powerDraw: MODULE_POWER_DRAW_W.attitude,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "reactionWheel", torque: 8_000_000 },
  },
  // --- System: power ---
  {
    id: "mod-reactor-fusion",
    faction: "Terran",
    name: "Fusion Reactor",
    description: "Supplies power to the rest of the ship's modules.",
    category: "system",
    mass: moduleMass("reactor"),
    cost: 80,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 1,
    effect: { kind: "power", output: FUSION_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "mod-reactor-antimatter",
    faction: "Terran",
    name: "Antimatter Core",
    description: "Compact, enormous power output for energy-hungry designs.",
    category: "system",
    mass: moduleMass("reactorCompact"),
    cost: 180,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 3,
    effect: { kind: "power", output: ANTIMATTER_REACTOR_OUTPUT_W },
    command: true,
  },
  // --- Crew ---
  {
    id: "mod-crew-quarters",
    faction: "Terran",
    name: "Crew Quarters",
    description: "Habitation and life support, increasing the crew a ship can sustain.",
    category: "crew",
    mass: moduleMass("crew"),
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
    mass: moduleMass("magazine"),
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
  {
    id: "mod-sensor-passive",
    faction: "Terran",
    name: "Passive Array",
    description: "Cheap all-round electromagnetic listeners. Silent and crewless — modest detection in every direction without drawing power.",
    category: "system",
    mass: moduleMass("sensor"),
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
    mass: moduleMass("sensor"),
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
    mass: moduleMass("sensor"),
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
    mass: moduleMass("sensor"),
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
    mass: moduleMass("sensor"),
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
    mass: moduleMass("comms"),
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
    mass: moduleMass("comms"),
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
    mass: moduleMass("comms"),
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
    mass: moduleMass("comms"),
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
    mass: moduleMass("comms"),
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
