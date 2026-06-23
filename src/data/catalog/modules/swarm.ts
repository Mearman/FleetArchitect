import type { ModuleDefinition } from "@/schema/module";
import {
  driveThrustNewtons,
  moduleMass,
} from "../physics";
import {
  ANTIMATTER_REACTOR_OUTPUT_W,
  BEAM_POWER_W,
  BEAM_RANGE_M,
  FUSION_REACTOR_OUTPUT_W,
  KM_DETECTION_RANGE_SCALE,
  MISSILE_RANGE_M,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  PROJECTILE_MASS_KG,
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
//  - a beam weapon's per-tick `damage` is `beamDamageJoules(beamPower, cooldown)`
//    (power × inter-shot dwell), and it is hitscan (`projectileSpeed: 0`);
//  - a missile / neural-sting carries an authored warhead yield (joules) and a
//    body mass / cruise velocity for momentum and flight, authored locally with a
//    "DERIVED from" note naming the real quantity.
//
// `range` is DERIVED per weapon type from the combat-scale anchors:
//  - a beam reaches `BEAM_RANGE_M` (√3 · Rayleigh reference ≈ 52 km);
//  - a kinetic gun reaches `kineticRangeM(muzzleVelocity)` (muzzle × time-of-
//    flight budget — autocannon ≈ 12 km);
//  - a missile / neural-sting reaches `MISSILE_RANGE_M` (cruise Δv × burn time
//    ≈ 80 km).
// `cooldown` is DERIVED as `cooldownTicks(reloadSeconds)` — the real refire
// mechanism interval in seconds × TICKS_PER_SECOND. A beam's cooldown is
// computed once and fed to both `cooldown` and `beamDamageJoules` so damage and
// dwell stay consistent. The Swarm's bio-weapons are the lightest class:
// fighter-scale spore rounds and a point-defence-grade acid beam.
// ---------------------------------------------------------------------------

/** Swarm spore round: a fighter-class organic projectile (`autocannon` banding
 *  in `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S`), the lightest kinetic
 *  round in the catalogue. */
const SPORE_MASS_KG = PROJECTILE_MASS_KG.autocannon;
const SPORE_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;
/** Swarm neural-sting body mass (kg) — DERIVED from a fighter-class guided
 *  round (`autocannon` banding): a light bio-electric tendril, not a heavy
 *  warhead. */
const STING_MASS_KG = PROJECTILE_MASS_KG.autocannon;
/** Neural-sting cruise velocity (m/s) — DERIVED as a fraction of an autocannon
 *  muzzle velocity: a powered homing tendril is slower than a launched slug. */
const STING_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon / 2;
/** Swarm neural-sting warhead yield (J) — authored catalogue content: a light
 *  bio-electric charge, sized below a frigate missile so the Swarm trades raw
 *  per-hit yield for fast refire and tracking. */
const STING_WARHEAD_J = 6e7;

/** Acid-sprayer capacitor/gland recharge interval (s) — thermal recovery of the
 *  bio-chemical reservoir between sprays. */
const ACID_SPRAYER_COOLDOWN = cooldownTicks(0.83);
/** Spore-launcher cyclic bio-feed interval (s) — the organic loading cycle
 *  between bursts; fast refire is the Swarm's kinetic advantage. */
const SPORE_LAUNCHER_COOLDOWN = cooldownTicks(0.6);
/** Neural-sting launch-node reload interval (s) — the hive-mind regeneration
 *  cycle between guided tendril launches. */
const STING_LAUNCHER_COOLDOWN = cooldownTicks(3.0);

  // ---------------------------------------------------------------------------
  // Swarm modules — bio-organic alien technology. The Swarm uses living ships
  // grown rather than built: lighter, faster-firing but lower raw damage;
  // bio-regeneration instead of mechanical shields; neural ganglia as command
  // nodes; metabolic bio-reactors instead of fusion plants.
  //
  // Masses are in kilograms (see `../physics.ts`); thrust in Newtons.
  // ---------------------------------------------------------------------------

const bioThrustN = driveThrustNewtons("bio");
const bioPulseThrustN = bioThrustN * 2;

export const swarmModules: ModuleDefinition[] = [
  // --- Weapons ---
  {
    id: "swm-spore-launcher",
    faction: "Swarm",
    name: "Spore Launcher",
    description: "Rapid-fire organic spore bursts. Low individual damage but very fast refire and high spread.",
    category: "weapon",
    mass: moduleMass("lightWeapon"),
    cost: 35,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(SPORE_MASS_KG, SPORE_MUZZLE_MS),
      range: kineticRangeM(SPORE_MUZZLE_MS),
      cooldown: SPORE_LAUNCHER_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(SPORE_MUZZLE_MS),
      projectileMass: SPORE_MASS_KG,
      tracking: 0.8,
      shieldPiercing: 0.15,
      armourPiercing: 0,
      spread: 0.12,
    },
  },
  {
    id: "swm-acid-sprayer",
    faction: "Swarm",
    name: "Acid Sprayer",
    description: "Hitscan corrosive jet. Short range but dissolves armour plating rapidly.",
    category: "weapon",
    mass: moduleMass("lightWeapon"),
    cost: 55,
    // A beam's draw IS its delivered optical power.
    powerDraw: BEAM_POWER_W.pulse,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.pulse, ACID_SPRAYER_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: ACID_SPRAYER_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0,
      armourPiercing: 0.45,
      spread: 0,
    },
  },
  {
    id: "swm-neural-sting",
    faction: "Swarm",
    name: "Neural Sting",
    description: "Bio-electric homing tendril. Moderate damage with excellent tracking.",
    category: "weapon",
    mass: moduleMass("mediumWeapon"),
    cost: 80,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: STING_WARHEAD_J,
      range: MISSILE_RANGE_M,
      cooldown: STING_LAUNCHER_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(STING_CRUISE_MS),
      projectileMass: STING_MASS_KG,
      tracking: 3.5,
      shieldPiercing: 0.1,
      armourPiercing: 0.2,
      spread: 0.05,
    },
  },
  // --- Defence: bio-regen instead of shields ---
  {
    id: "swm-regen-membrane",
    faction: "Swarm",
    name: "Regeneration Membrane",
    description: "Living hull membrane that rapidly knits damage back together.",
    category: "defence",
    mass: moduleMass("shield"),
    cost: 65,
    // A repair organ draws a small housekeeping load, like a sensor array.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "repair",
      repairRate: 4,
    },
  },
  {
    id: "swm-spore-cloud",
    faction: "Swarm",
    name: "Spore Cloud Emitter",
    description: "Releases a dense cloud of microscopic organisms that intercept incoming fire.",
    category: "defence",
    mass: moduleMass("pointDefense"),
    cost: 90,
    powerDraw: MODULE_POWER_DRAW_W.pointDefense,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "pointDefense",
      damage: 8,
      range: 100,
      cooldown: 10,
      hitChance: 0.35,
      tracking: 1.5,
    },
    pointDefense: true,
  },  // --- Propulsion ---
  {
    id: "swm-flagellum-drive",
    faction: "Swarm",
    name: "Flagellum Drive",
    description: "Biological jet propulsion. Light and fast with excellent manoeuvrability.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 28,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: bioThrustN },
  },
  {
    id: "swm-pulse-jet",
    faction: "Swarm",
    name: "Pulse Jet Organ",
    description: "High-output muscular jet for rapid bursts of speed.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 60,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "engine", thrust: bioPulseThrustN, gimbalArc: Math.PI / 8 },
  },
  {
    id: "swm-pseudopod-cluster",
    faction: "Swarm",
    name: "Pseudopod Cluster",
    description: "Organic tentacle jets for precision manoeuvring. Produces torque without forward thrust.",
    category: "propulsion",
    mass: moduleMass("rcs"),
    cost: 32,
    powerDraw: MODULE_POWER_DRAW_W.attitude,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "rcs", torque: 12_000_000 },
  },
  {
    id: "swm-gyral-organ",
    faction: "Swarm",
    name: "Gyral Organ",
    description: "Living spinning organ for attitude control. Provides torque through momentum exchange with the ship's bio-core.",
    category: "propulsion",
    mass: moduleMass("reactionWheel"),
    cost: 48,
    powerDraw: MODULE_POWER_DRAW_W.attitude,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "reactionWheel", torque: 9_000_000 },
  },
  // --- System: neural command / bio-power ---
  {
    id: "swm-neural-ganglion",
    faction: "Swarm",
    name: "Neural Ganglion",
    description: "Distributed nerve cluster that co-ordinates the ship's organic systems and acts as its command node.",
    category: "system",
    mass: moduleMass("reactor"),
    cost: 70,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "power", output: FUSION_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "swm-metabolic-core",
    faction: "Swarm",
    name: "Metabolic Core",
    description: "Central bio-reactor organ converting raw biomass into usable energy.",
    category: "system",
    mass: moduleMass("reactorCompact"),
    cost: 160,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 3,
    effect: { kind: "power", output: ANTIMATTER_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "swm-ammon-sac",
    faction: "Swarm",
    name: "Ammon Sac",
    description: "Bio-organic ammunition reservoir producing and storing organic projectile clusters. Crew distribute harvested rounds to weapons.",
    category: "system",
    mass: moduleMass("magazine"),
    cost: 55,
    powerDraw: MODULE_POWER_DRAW_W.magazine,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "magazine", ammoStored: 250 },
  },

  // --- Swarm system: bio-sensors (directional, mirroring the Terran family) ---
  {
    id: "swm-electro-membrane",
    faction: "Swarm",
    name: "Electro-Receptor Membrane",
    description: "Passive skin of piezoelectric cilia sensing pressure waves and fields from every direction. No metabolic cost; always alert all-round.",
    category: "system",
    mass: moduleMass("sensor"),
    cost: 30,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "sensor",
      sensorType: "omni",
      // All-round awareness, like the Terran Passive Array. Short reach, just
      // outside the local hive-sense horizon (~32 km at km scale).
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
    id: "swm-chemosensor-organ",
    faction: "Swarm",
    name: "Chemosensor Palp",
    description: "Forward chemoreceptor palp tuned to drive-exhaust traces. Sweeps a medium-long cone ahead of the hunter; crewless, but only sees where it faces.",
    category: "system",
    mass: moduleMass("sensor"),
    cost: 75,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "sensor",
      sensorType: "directional",
      arc: SENSOR_DIRECTIONAL_ARC,
      detectionRange: 600 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      nebulaImmune: false,
      mode: "passive",
      passiveBands: ["thermal", "chemical"],
      gain: 1.5,
    },
  },
  {
    id: "swm-chemosensor-organ-long",
    faction: "Swarm",
    name: "Chemosensor Organ",
    description: "Elongated long-range chemoreceptor cluster. A narrow forward stare that out-ranges every weapon — the hive's autonomous early-warning organ.",
    category: "system",
    mass: moduleMass("sensor"),
    cost: 95,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "sensor",
      sensorType: "dish",
      // Narrow, very long reach — the Swarm pays no crew (autonomous bio-organ).
      // ~86 km at km scale, out-ranging every weapon for genuine early warning.
      arc: SENSOR_DISH_ARC,
      detectionRange: 860 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      nebulaImmune: false,
      mode: "passive",
      passiveBands: ["thermal", "chemical"],
      gain: 4.0,
    },
  },
  {
    id: "swm-gravitic-node",
    faction: "Swarm",
    name: "Gravitic Sensing Node",
    description: "Dense bio-mineral node that resonates with gravitational gradients across a wide arc — reads mass through nebula gas as easily as clear space.",
    category: "system",
    mass: moduleMass("sensor"),
    cost: 130,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "sensor",
      sensorType: "directional",
      // Wide nebula-immune cone; the Swarm trades raw range for autonomy (~70 km).
      arc: SENSOR_WIDE_ARC,
      detectionRange: 700 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      nebulaImmune: true,
      mode: "passive",
      passiveBands: ["gravitational"],
      gain: 2.0,
    },
  },

  // --- Swarm system: bio-comms ---
  {
    id: "swm-pheromone-net",
    faction: "Swarm",
    name: "Pheromone Net",
    description: "Diffuse cloud of chemical signals readable by nearby hive-kin. Short-range omnidirectional awareness; costs nothing to run.",
    category: "system",
    mass: moduleMass("comms"),
    cost: 18,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "comms",
      commsType: "omni",
      arc: Math.PI,
      range: 180 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      channel: 0,
      bandwidth: 4,
    },
  },
  {
    id: "swm-neural-relay",
    faction: "Swarm",
    name: "Neural Relay Filament",
    description: "Directional bio-electric discharge projected along a preferred axis. Stronger range than pheromones; the hive uses it for coordinated strike commands.",
    category: "system",
    mass: moduleMass("comms"),
    cost: 42,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "comms",
      commsType: "directional",
      arc: 0.6,
      range: 320 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      channel: 0,
      bandwidth: 6,
    },
  },
  {
    id: "swm-synapse-dish",
    faction: "Swarm",
    name: "Synapse Focus Organ",
    description: "A crystallised neuronal cluster that concentrates bio-electric emissions into a narrow steerable beam. High bandwidth; must be consciously aimed by the ship-mind.",
    category: "system",
    mass: moduleMass("comms"),
    cost: 78,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "comms",
      commsType: "dish",
      arc: 0.25,
      range: 520 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      channel: 0,
      bandwidth: 10,
    },
  },
  {
    id: "swm-biolaser-spine",
    faction: "Swarm",
    name: "Biolaser Spine",
    description: "Coherent living photophore array that fires tightly collimated pulses of bioluminescence. Point-to-point backbone for the hive's highest-priority signals.",
    category: "system",
    mass: moduleMass("comms"),
    cost: 105,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "comms",
      commsType: "laser",
      arc: 0.12,
      range: 600 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      channel: 0,
      bandwidth: 16,
    },
  },
  {
    id: "swm-variable-synapse",
    faction: "Swarm",
    name: "Variable Synapse Web",
    description: "A web of adaptable neural threads that reconfigure their geometry to broaden for local chatter or narrow into a long-range data lance.",
    category: "system",
    mass: moduleMass("comms"),
    cost: 120,
    powerDraw: MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 3,
    effect: {
      kind: "comms",
      commsType: "variable",
      range: 340 * KM_DETECTION_RANGE_SCALE,
      arc: 0.5,
      bearing: 0,
      channel: 0,
      bandwidth: 8,
      minRange: 200 * KM_DETECTION_RANGE_SCALE,
      maxRange: 480 * KM_DETECTION_RANGE_SCALE,
      minArc: 0.15,
      maxArc: 0.5,
    },
  },
];
