import type { ModuleDefinition } from "@/schema/module";
import {
  driveThrustNewtons,
  moduleMass,
} from "../physics";
import {
  ANTIMATTER_REACTOR_OUTPUT_W,
  BEAM_POWER_W,
  FUSION_REACTOR_OUTPUT_W,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  PROJECTILE_MASS_KG,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  beamDamageJoules,
  kineticDamageJoules,
  projectileSpeedMPerTick,
} from "../combat-scale";

// ---------------------------------------------------------------------------
// Weapon damage and projectile speed are DERIVED from the combat-scale anchors
// (`../combat-scale.ts`): kinetic `damage` = ½·m·v² via `kineticDamageJoules`,
// beam `damage` = power × one-tick dwell via `beamDamageJoules`, and
// `projectileSpeed` = `projectileSpeedMPerTick(muzzleVelocity)`. The Collective
// field accurate kinetics — a fighter targeting cannon and a frigate coilgun —
// and a pulse-grade close-range cutter beam.
// ---------------------------------------------------------------------------

/** Synthetic targeting-cannon round: a fighter-class precision slug
 *  (`autocannon` banding in `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S`). */
const PRECISE_CANNON_MASS_KG = PROJECTILE_MASS_KG.autocannon;
const PRECISE_CANNON_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;
/** Synthetic coilgun round: a frigate-class electromagnetic slug (`railgun`
 *  banding). */
const COILGUN_MASS_KG = PROJECTILE_MASS_KG.railgun;
const COILGUN_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.railgun;

  // ---------------------------------------------------------------------------
  // Synthetic Collective modules — machine intelligences in precision-machined
  // hulls. The Collective fights as a co-ordinated network: dense point-defence
  // that shreds missiles, drones and boarding pods; accurate cannons that rarely
  // miss; sensors that strip enemy cloak; and ECCM that defeats jamming. Their
  // ships are designed to be hardwired so an AI core runs them with almost no
  // crew, and command auras let a coordinator buff the whole fleet. (Carrier
  // hangars and decoy launchers join this set once the drone/decoy engine
  // behaviour lands.) Trade-offs: mediocre raw alpha and middling speed, so they
  // struggle in a sustained brawl against heavy armour or long-range beams.
  // Counters: Foundry siege plasma overwhelms their modest shields; Crystalline
  // beams outrange and out-pierce their cannons.
  //
  // Masses are in kilograms (see `../physics.ts`); thrust in Newtons.
  // ---------------------------------------------------------------------------

const precisionThrustN = driveThrustNewtons("precision");

export const syntheticModules: ModuleDefinition[] = [
  // --- Weapons: accurate cannons and a heavy railgun ---
  {
    id: "syn-precise-cannon",
    faction: "Synthetic",
    name: "Targeting Cannon",
    description: "A computer-aimed cannon with tight spread and high tracking. Low per-hit damage but it lands almost every shot.",
    category: "weapon",
    mass: moduleMass("lightWeapon"),
    cost: 60,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(PRECISE_CANNON_MASS_KG, PRECISE_CANNON_MUZZLE_MS),
      range: 380,
      cooldown: 35,
      projectileSpeed: projectileSpeedMPerTick(PRECISE_CANNON_MUZZLE_MS),
      projectileMass: PRECISE_CANNON_MASS_KG,
      tracking: 1.6,
      shieldPiercing: 0.15,
      armourPiercing: 0.3,
      spread: 0.01,
      ammoCapacity: 220,
    },
  },
  {
    id: "syn-railgun",
    faction: "Synthetic",
    name: "Coilgun",
    description: "A magnetically accelerated slug with superb accuracy and armour-penetration on a traversing mount. The Collective's heavy punch.",
    category: "weapon",
    mass: moduleMass("mediumWeapon"),
    cost: 130,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(COILGUN_MASS_KG, COILGUN_MUZZLE_MS),
      range: 520,
      cooldown: 100,
      projectileSpeed: projectileSpeedMPerTick(COILGUN_MUZZLE_MS),
      projectileMass: COILGUN_MASS_KG,
      tracking: 1.2,
      shieldPiercing: 0.25,
      armourPiercing: 0.6,
      spread: 0.005,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.07,
      ammoCapacity: 120,
    },
  },
  {
    id: "syn-beam-lance",
    faction: "Synthetic",
    name: "Cutter Lance",
    description: "A short-range sustained beam for stripping shields and drones at close quarters. Accurate, unlimited ammunition, modest damage.",
    category: "weapon",
    mass: moduleMass("lightWeapon"),
    cost: 65,
    // A beam's draw IS its delivered optical power.
    powerDraw: BEAM_POWER_W.pulse,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.pulse, 20),
      range: 300,
      cooldown: 20,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.45,
      armourPiercing: 0.1,
      spread: 0,
    },
  },
  // --- Defence: dense point defence (their signature), modest shields, frame ---
  {
    id: "syn-pd-array",
    faction: "Synthetic",
    name: "Interceptor Array",
    description: "A dense, accurate point-defence network that shreds incoming missiles, torpedoes and boarding pods. The Collective's defining screen.",
    category: "defence",
    mass: moduleMass("pointDefense"),
    cost: 95,
    powerDraw: MODULE_POWER_DRAW_W.pointDefense,
    crewRequired: 0,
    techLevel: 2,
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
    mass: moduleMass("shield"),
    cost: 75,
    // A shield's draw IS its recharge wattage, so rebuilding the field competes
    // with the weapons and drive for reactor output. The Grid Shield is a modest
    // light-band field.
    powerDraw: SHIELD_RECHARGE_W.light,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.light,
      rechargeRate: SHIELD_RECHARGE_W.light,
      rechargeDelay: 60,
    },
  },  // --- Propulsion: efficient, average engines ---
  {
    id: "syn-thruster",
    faction: "Synthetic",
    name: "Ion Thruster",
    description: "A clean, efficient drive. Unremarkable thrust and turn — the Collective meets its foes rather than chasing them.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 38,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: precisionThrustN },
  },
  // --- System: high-output processors (command), minimal crew, magazine ---
  {
    id: "syn-processor",
    faction: "Synthetic",
    name: "Command Processor",
    description: "The ship's AI core and power plant in one. High output and no crew needed to run it — the command node of a hardwired hull.",
    category: "system",
    mass: moduleMass("reactor"),
    cost: 95,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "power", output: FUSION_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "syn-quantum-core",
    faction: "Synthetic",
    name: "Quantum Core",
    description: "A capital AI core. Vast output to run interceptor arrays and coilguns across a dreadnought with no crew.",
    category: "system",
    mass: moduleMass("reactorCompact"),
    cost: 210,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 4,
    effect: { kind: "power", output: ANTIMATTER_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "syn-crew-node",
    faction: "Synthetic",
    name: "Maintenance Node",
    description: "Spare berths for the few organic or drone technicians a hardwired hull still needs for physical repairs.",
    category: "crew",
    mass: moduleMass("crew"),
    cost: 25,
    powerDraw: MODULE_POWER_DRAW_W.crew,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "crew", capacity: 4 },
  },
  {
    id: "syn-magazine",
    faction: "Synthetic",
    name: "Slug Reservoir",
    description: "Stores coilgun and cannon munitions, fed to the guns over the hardwired link.",
    category: "system",
    mass: moduleMass("magazine"),
    cost: 50,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "magazine", ammoStored: 320 },
  },
  // --- Sensors, ECCM, command aura: the network signature ---
  {
    id: "syn-sensor-array",
    faction: "Synthetic",
    name: "Active Sensor Array",
    description: "Extends the ship's detection range and actively pierces cloak — the Collective's answer to stealth raiders, revealing what others cannot see.",
    category: "system",
    mass: moduleMass("sensor"),
    cost: 90,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "sensor",
      sensorType: "omni",
      detectionRange: 600,
      arc: Math.PI,
      bearing: 0,
      nebulaImmune: true,
      pierceCloak: true,
      mode: "active",
      sweepRate: 0.15,
      emitStrength: 1000,
      gain: 2.0,
    },
  },
  {
    id: "syn-eccm",
    faction: "Synthetic",
    name: "ECCM Suite",
    description: "Restores tracking and lock stripped by enemy jamming. The Collective's networks cut through a Reaver scrambler.",
    category: "system",
    mass: moduleMass("sensor"),
    cost: 75,
    // An ECCM suite draws sensor-class electronics power.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
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
    mass: moduleMass("shield"),
    cost: 110,
    // A coordination node shares targeting solutions over the fleet datalink, so
    // it draws comms-class link electronics power.
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 3,
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
    description: "Builds and launches autonomous combat drones that swarm the nearest enemy. The Collective's signature — a carrier that fights with a cloud of disposable craft.",
    category: "weapon",
    mass: moduleMass("heavyWeapon"),
    cost: 150,
    // A drone hangar draws its fabrication and launch-handling load, like an
    // ordnance launcher.
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 3,
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
    mass: moduleMass("pointDefense"),
    cost: 90,
    // A decoy projector draws sensor-class electronics power.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "decoy",
      decoyCount: 3,
      duration: 240,
      cooldown: 300,
      decoyHp: 60,
    },
  },
];
