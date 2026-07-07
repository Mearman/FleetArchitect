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
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
  BEAM_POWER_W,
  BEAM_RANGE_M,
  FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
  KM_DETECTION_RANGE_SCALE,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  PROJECTILE_MASS_KG,
  RELOAD_THERMAL_TIME_S,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  beamDamageJoules,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";

// ---------------------------------------------------------------------------
// Synthetic Collective modules — machine intelligences in precision-machined
// alloy hulls.
//
// Every module's mass is DERIVED from its capability via the physics-layer
// mass functions in `../physics.ts`:
//
//  - kinetic weapon mass  = `kineticWeaponMass(projectileMass, muzzleVelocity,
//    density)` from the round's muzzle kinetic energy (½·m·v²);
//  - beam weapon mass    = `beamWeaponMass(beamPower, density)` from the
//    beam's sustained optical power;
//  - reactor mass        = `reactorMass(output, powerDensity, density)` from
//    electrical output and the core's volumetric power density;
//  - engine mass         = `engineMass(thrust, density)` from rated thrust;
//  - shield mass         = `shieldMass(capacity, density)` from field capacity;
//  - magazine mass       = `magazineMass(ammoStored, density)` from stored round
//    count;
//  - crew mass           = `crewMass(capacity, density)` from berth count.
//
// Synthetic modules are mid-density (machined alloy ~6500 kg/m³) and very
// efficient: crew requirements are the LOWEST in the game (automation) and
// tech levels are the HIGHEST (precision engineering). Cost is moderate —
// cheaper than Terran (automated manufacturing) but not as cheap as Corsair.
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
// Synthetic material densities (kg/m³).
//
// Synthetic modules are machined titanium-class alloy (~6500 kg/m³), precise
// and mid-density between Crystalline light and Foundry dense. Each module
// category gets a representative density so its installed mass is proportional
// to its mechanism volume.
// ---------------------------------------------------------------------------

/** Kinetic weapon mechanism density (kg/m³): precision turret + barrel + cooling. */
export const WEAPON_DENSITY = 4200;
/** Beam weapon emitter density (kg/m³): precision optics + cooling. */
export const BEAM_DENSITY = 3500;
/** Shield projector density (kg/m³): field generator + emitters. */
export const SHIELD_DENSITY = 2500;
/** Engine density (kg/m³): precision nozzle + power conditioning. */
export const ENGINE_DENSITY = 3500;
/** Reactor core + shielding density (kg/m³): precision containment. */
export const REACTOR_DENSITY = 5000;
/** Crew quarters density (kg/m³): server racks, dense (machine "crew" is hardware). */
const CREW_DENSITY = 2000;
/** Magazine density (kg/m³): ordnance stores precision-packed. */
const MAGAZINE_DENSITY = 4500;

// ---------------------------------------------------------------------------
// Weapon damage, range, cooldown and projectile speed are DERIVED from the
// combat-scale anchors (`../combat-scale.ts`):
//
//  - kinetic `damage`  = ½·m·v² via `kineticDamageJoules`;
//  - kinetic `range`   = `kineticRangeM(muzzleVelocity)` (v × MAX_TOF_S);
//  - beam `damage`    = `beamDamageJoules(power, cooldown)`;
//  - `projectileSpeed` = `projectileSpeedMPerTick(muzzleVelocity)` (m/s → m/tick);
//  - `cooldown`        = `cooldownTicks(reloadSeconds)` (seconds × TPS).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Kinetic-weapon local anchors.
//
// Each Synthetic kinetic weapon picks a (projectileMass, muzzleVelocity) pairing
// from the `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S` menus in
// `combat-scale.ts`, then its mass, damage, range, projectile speed, and
// cooldown are all DERIVED from those two numbers. Synthetic favours precision
// beams and efficient drives — one accurate fighter cannon, one heavy frigate
// railgun, one capital coilgun.
// ---------------------------------------------------------------------------

/** Synthetic targeting-cannon round: a fighter-class precision slug
 *  (`autocannon` banding). */
const PRECISE_CANNON_MASS_KG = PROJECTILE_MASS_KG.autocannon;
const PRECISE_CANNON_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;
/** Synthetic coilgun round: a frigate-class electromagnetic slug (`railgun`
 *  banding). */
const COILGUN_MASS_KG = PROJECTILE_MASS_KG.railgun;
const COILGUN_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.railgun;
// ---------------------------------------------------------------------------
// Beam-weapon local anchor.
//
// Synthetic specialises in a precision PD-grade pulse cutter beam.
// ---------------------------------------------------------------------------

/** Cutter Lance beam pulse power (W): a short-range sustained cutter beam. */
const CUTTER_LANCE_POWER_W = BEAM_POWER_W.pulse;

// ---------------------------------------------------------------------------
// Reactor output targets.
//
// Synthetic reactors use advanced high-density cores — an advanced fusion
// reactor (high output, frigate-to-cruiser) and an advanced antimatter core
// (capital).
// ---------------------------------------------------------------------------

/** Advanced fusion reactor output target (~1.8 GW). */
const FUSION_ADVANCED_OUTPUT_W =
  FUSION_ADVANCED_POWER_DENSITY_W_PER_M3 * 30;
/** Advanced antimatter reactor output target (~7.5 GW). */
const ANTIMATTER_ADVANCED_OUTPUT_W =
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3 * 25;

// ---------------------------------------------------------------------------
// Propulsion: Synthetic precision drives.
// ---------------------------------------------------------------------------

const precisionThrustN = driveThrustNewtons("precision");

// ---------------------------------------------------------------------------
// Cooldown local anchors.
// ---------------------------------------------------------------------------

/** Targeting-cannon cyclic-feed interval (s): a fast-cycling precision gun. */
const PRECISE_CANNON_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.autocannon);
/** Coilgun capacitor-recharge interval (s) between shots. */
const COILGUN_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.railgun);
/** Cutter Lance beam dwell / thermal-recovery interval (s). */
const CUTTER_LANCE_COOLDOWN = cooldownTicks(0.6);

// ---------------------------------------------------------------------------
// Synthetic Collective modules — 15 entries, capability-derived.
//
// The module list preserves the legacy id, name, role, and category of each
// entry; ONLY the capability values and the mass derivation change. Mass now
// traces to the module's actual capability via the physics-layer functions
// (`kineticWeaponMass`, `beamWeaponMass`, `reactorMass`, `engineMass`,
// `shieldMass`, `magazineMass`, `crewMass`).
//
// To span a realistic fighter->capital range while keeping 15 modules, the
// capability values of several entries have been re-anchored to the
// broadened menus in `combat-scale.ts` — so a fighter targeting cannon and
// a capital gauss driver no longer converge on a single "mediumWeapon" band,
// and mass scales with capability across the whole span.
// ---------------------------------------------------------------------------

export const syntheticModules: ModuleDefinitionInput[] = [
  // --- Weapons: accurate kinetics and precision beams ---
  {
    id: "syn-precise-cannon",
    faction: "Synthetic",
    name: "Targeting Cannon",
    description: "A computer-aimed cannon with tight spread and high tracking. Low per-hit damage but it lands almost every shot.",
    category: "weapon",
    // Synthetic targeting cannon: autocannon band (1 kg @ 4 km/s). Mass
    // derived from muzzle energy at the mid-density machined-alloy weapon
    // density. muzzleEnergy = ½·1·4000² = 8 MJ; mass =
    // 4200 × (8e6 / 2e7) = 1,680 kg (~1.7 t).
    mass: kineticWeaponMass(
      PRECISE_CANNON_MASS_KG,
      PRECISE_CANNON_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 55,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(PRECISE_CANNON_MASS_KG, PRECISE_CANNON_MUZZLE_MS),
      range: kineticRangeM(PRECISE_CANNON_MUZZLE_MS),
      cooldown: PRECISE_CANNON_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(PRECISE_CANNON_MUZZLE_MS),
      projectileMass: PRECISE_CANNON_MASS_KG,
      tracking: 1.6,
      shieldPiercing: 0.15,
      armourPiercing: 0.3,
      spread: 0.01,
      // Ballistic slug: unpowered and unguided.
      powered: false,
      guided: false,
      // Finite magazine: `ammo` (start count) AND `ammoCapacity` (conduit top-up
      // ceiling) must both be set — omitting `ammo` defaults it to DEFAULT_WEAPON_AMMO.
      ammo: 220,
      ammoCapacity: 220,
    },
  },
  {
    id: "syn-railgun",
    faction: "Synthetic",
    name: "Coilgun",
    description: "A magnetically accelerated slug with superb accuracy and armour-penetration on a traversing mount. The Collective's heavy punch.",
    category: "weapon",
    // Synthetic coilgun: railgun band (10 kg @ 8 km/s). Mass derived from
    // muzzle energy at mid-density machined-alloy weapon density.
    // muzzleEnergy = ½·10·8000² = 320 MJ; mass =
    // 4200 × (320e6 / 2e7) = 67,200 kg (~67 t).
    mass: kineticWeaponMass(COILGUN_MASS_KG, COILGUN_MUZZLE_MS, WEAPON_DENSITY),
    cost: 125,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(COILGUN_MASS_KG, COILGUN_MUZZLE_MS),
      range: kineticRangeM(COILGUN_MUZZLE_MS),
      cooldown: COILGUN_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(COILGUN_MUZZLE_MS),
      projectileMass: COILGUN_MASS_KG,
      tracking: 1.2,
      shieldPiercing: 0.25,
      armourPiercing: 0.6,
      spread: 0.005,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.07,
      // Ballistic slug: unpowered and unguided.
      powered: false,
      guided: false,
      ammo: 120,
      ammoCapacity: 120,
    },
  },
  {
    id: "syn-beam-lance",
    faction: "Synthetic",
    name: "Cutter Lance",
    description: "A short-range sustained beam for stripping shields and drones at close quarters. Accurate, unlimited ammunition, modest damage.",
    category: "weapon",
    // Synthetic cutter lance: pulse-band (300 MW) beam. Mass derived from
    // beam power at the light precision emitter density.
    // mass = 3500 × (3e8 / 4e7) = 26,250 kg (~26 t).
    mass: beamWeaponMass(CUTTER_LANCE_POWER_W, BEAM_DENSITY),
    cost: 70,
    // A beam's draw IS its delivered optical power.
    powerDraw: CUTTER_LANCE_POWER_W,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(CUTTER_LANCE_POWER_W, CUTTER_LANCE_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: CUTTER_LANCE_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.45,
      armourPiercing: 0.1,
      spread: 0,
    },
  },
  // --- Defence: dense point defence (their signature), modest shields ---
  {
    id: "syn-pd-array",
    faction: "Synthetic",
    name: "Interceptor Array",
    description: "A dense, accurate point-defence network that shreds incoming missiles, torpedoes and boarding pods. The Collective's defining screen.",
    category: "defence",
    // Synthetic interceptor array: a dense sensor-guided PD mechanism.
    // Volume ~ 8 m³ of turret + electronics at sensor density.
    // mass = 2000 × 8 = 16,000 kg (~16 t).
    mass: 16_000,
    cost: 95,
    powerDraw: MODULE_POWER_DRAW_W.pointDefense,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "pointDefense",
      damage: 14,
      range: 130,
      cooldown: 6,
      hitChance: 0.6,
      tracking: 2.4,
    },
    pointDefense: true,
  },
  {
    id: "syn-screen-shield",
    faction: "Synthetic",
    name: "Grid Shield",
    description: "A moderate regenerating shield. Not the Collective's strength, but enough to buy the point-defence net time to work.",
    category: "defence",
    // Synthetic light shield: 200 MJ field. Mass derived from shield capacity
    // at the Synthetic shield density.
    // mass = 2500 × (2e8 / 1.3e7) = 38,462 kg (~38 t).
    mass: shieldMass(SHIELD_CAPACITY_J.light, SHIELD_DENSITY),
    cost: 85,
    // A shield's draw IS its recharge wattage.
    powerDraw: SHIELD_RECHARGE_W.light,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.light,
      rechargeRate: SHIELD_RECHARGE_W.light,
      rechargeDelay: 60,
    },
  },
  {
    id: "syn-grid-deflector",
    faction: "Synthetic",
    name: "Grid Deflector",
    description: "A moderate momentum screen. Protects the point-defence net from kinetic strikes.",
    category: "defence",
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.light, SHIELD_DENSITY),
    cost: 85,
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.light,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "deflector",
      capacity: DEFLECTOR_CAPACITY_KG_MPS.light,
      rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.light,
      rechargeDelay: 60,
    },
  },
  // --- Propulsion: efficient, average engines ---
  {
    id: "syn-thruster",
    faction: "Synthetic",
    name: "Ion Thruster",
    description: "A clean, efficient drive. Unremarkable thrust and turn — the Collective meets its foes rather than chasing them.",
    category: "propulsion",
    // Synthetic precision drive: 60 kN thrust. Mass derived from thrust at
    // the mid-density machined-alloy engine density.
    // mass = 3500 × (60000 / 5000) = 42,000 kg (~42 t).
    mass: engineMass(precisionThrustN, ENGINE_DENSITY),
    cost: 45,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "engine", thrust: precisionThrustN },
  },
  // --- System: high-output reactors, minimal crew, magazine ---
  {
    id: "syn-processor",
    faction: "Synthetic",
    name: "Command Processor",
    description: "The ship's AI core and power plant in one. High output and no crew needed to run it — the command node of a hardwired hull.",
    category: "system",
    // Synthetic advanced fusion reactor: 1.8 GW output at 6e7 W/m³ power
    // density. Mass derived from output and power density at the precision
    // reactor density.
    // mass = 5000 × (1.8e9 / 6e7) = 150,000 kg (~150 t).
    mass: reactorMass(
      FUSION_ADVANCED_OUTPUT_W,
      FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
      REACTOR_DENSITY,
    ),
    cost: 105,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 3,
    effect: { kind: "power", output: FUSION_ADVANCED_OUTPUT_W },
    command: true,
  },
  {
    id: "syn-quantum-core",
    faction: "Synthetic",
    name: "Quantum Core",
    description: "A capital AI core. Vast output to run interceptor arrays and coilguns across a dreadnought with no crew.",
    category: "system",
    // Synthetic advanced antimatter reactor: 7.5 GW output at 3e8 W/m³ power
    // density. Mass derived from output at the precision reactor density.
    // mass = 5000 × (7.5e9 / 3e8) = 125,000 kg (~125 t).
    mass: reactorMass(
      ANTIMATTER_ADVANCED_OUTPUT_W,
      ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
      REACTOR_DENSITY,
    ),
    cost: 210,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 5,
    effect: { kind: "power", output: ANTIMATTER_ADVANCED_OUTPUT_W },
    command: true,
  },
  {
    id: "syn-crew-node",
    faction: "Synthetic",
    name: "Maintenance Node",
    description: "Spare berths for the few organic or drone technicians a hardwired hull still needs for physical repairs.",
    category: "crew",
    // Synthetic crew node: 1 berth at 12 m³/berth (machine crew is a single
    // technician supervising automation). Mass derived from berth capacity
    // at the dense server-rack crew density (machine crew is dense).
    // mass = 2000 × (1 × 12) = 24,000 kg (~24 t).
    mass: crewMass(1, CREW_DENSITY),
    cost: 25,
    powerDraw: MODULE_POWER_DRAW_W.crew,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "crew", capacity: 1 },
  },
  {
    id: "syn-magazine",
    faction: "Synthetic",
    name: "Slug Reservoir",
    description: "Stores coilgun and cannon munitions, fed to the guns over the hardwired link.",
    category: "system",
    // Synthetic magazine: 180 rounds at 30 rounds/m³. Mass derived from
    // stored round count at the precision-packed magazine density.
    // volume = 180 / 30 = 6 m³; mass = 4500 × 6 = 27,000 kg (~27 t).
    mass: magazineMass(180, MAGAZINE_DENSITY),
    cost: 50,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "magazine", ammoStored: 180 },
  },
  // --- Sensors, ECCM, command aura: the network signature ---
  {
    id: "syn-sensor-array",
    faction: "Synthetic",
    name: "Active Sensor Array",
    description: "Extends the ship's detection range and actively pierces cloak — the Collective's answer to stealth raiders, revealing what others cannot see.",
    category: "system",
    // Synthetic sensor array: dense electronics + optics. Mass derived from
    // a representative sensor volume at the dense sensor density.
    // Volume ~ 8 m³; mass = 2000 × 8 = 16,000 kg (~16 t).
    mass: 16_000,
    cost: 90,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "sensor",
      sensorType: "omni",
      detectionRange: 600 * KM_DETECTION_RANGE_SCALE,
      arc: Math.PI,
      bearing: 0,
      nebulaImmune: true,
      pierceCloak: true,
      mode: "active",
      sweepRate: 0.15,
      emitStrength: 1000 * ACTIVE_SENSOR_EMISSION_SCALE,
      gain: 2.0,
    },
  },
  {
    id: "syn-eccm",
    faction: "Synthetic",
    name: "ECCM Suite",
    description: "Restores tracking and lock stripped by enemy jamming. The Collective's networks cut through a Reaver scrambler.",
    category: "system",
    // Synthetic ECCM: dense electronics suite.
    // Volume ~ 6 m³; mass = 2000 × 6 = 12,000 kg (~12 t).
    mass: 12_000,
    cost: 75,
    // An ECCM suite draws sensor-class electronics power.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "eccm",
      trackingRestore: 0.7,
    },
  },
  {
    id: "syn-coordination-aura",
    faction: "Synthetic",
    name: "Coordination Node",
    description: "Shares targeting solutions with nearby allies, extending their range and accuracy. A coordinator flagship turns a fleet into a single weapon.",
    category: "system",
    // Synthetic coordination node: fleet datalink hub.
    // Volume ~ 10 m³; mass = 2000 × 10 = 20,000 kg (~20 t).
    mass: 20_000,
    cost: 110,
    // A coordination node draws comms-class link electronics power.
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 4,
    effect: {
      kind: "commandAura",
      radius: 420,
      accuracyBonus: 0.3,
      rangeBonus: 0.15,
    },
  },
  {
    id: "syn-drone-hangar",
    faction: "Synthetic",
    name: "Drone Hangar",
    description: "Builds and launches autonomous combat drones that swarm the nearest enemy. The Collective's signature.",
    category: "weapon",
    // Synthetic drone hangar: precision fabrication + launch mechanism.
    // Volume ~ 20 m³ at weapon density; mass = 4200 × 20 = 84,000 kg.
    mass: 84_000,
    cost: 150,
    // A drone hangar draws its fabrication and launch-handling load.
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 4,
    effect: {
      kind: "hangar",
      droneCount: 4,
      launchCooldown: 90,
      droneHp: 40,
      droneDamage: 5,
      droneRange: 90,
      droneSpeed: 5,
    },
  },
  {
    id: "syn-decoy-launcher",
    faction: "Synthetic",
    name: "Decoy Launcher",
    description: "Emits false contacts that draw enemy fire away from the fleet's real ships, then expire. Pairs with the interceptor array to exhaust an attacker's volley.",
    category: "defence",
    // Synthetic decoy launcher: precision electronics + projector.
    // Volume ~ 8 m³; mass = 2000 × 8 = 16,000 kg (~16 t).
    mass: 16_000,
    cost: 90,
    // A decoy projector draws sensor-class electronics power.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "decoy",
      decoyCount: 3,
      duration: 240,
      cooldown: 300,
      decoyHp: 60,
    },
  },
];
