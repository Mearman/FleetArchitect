import type { ModuleDefinitionInput } from "@/schema/module";
import {
  beamWeaponMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  magazineMass,
  reactorMass,
  deflectorMass,
} from "../physics";
import {
  ANTIMATTER_POWER_DENSITY_W_PER_M3,
  BEAM_POWER_W,
  BEAM_RANGE_M,
  FUSION_COMPACT_POWER_DENSITY_W_PER_M3,
  KM_DETECTION_RANGE_SCALE,
  MISSILE_RANGE_M,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  ORDNANCE_BURN_TIME_S,
  PROJECTILE_MASS_KG,
  RCS_TORQUE_N_M,
  REACTION_WHEEL_TORQUE_N_M,
  RELOAD_THERMAL_TIME_S,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
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
// Swarm modules — bio-organic alien technology.
//
// Every module's mass is DERIVED from its capability via the physics-layer
// mass functions in `../physics.ts`, using Swarm bio-organic material densities
// that are LOWER than Terran (wet bio-chitin ~1100 kg/m³ vs steel ~7850):
//
//  - kinetic weapon mass  = `kineticWeaponMass(m, v, 2200)` from muzzle energy
//    and organic turret mechanism density (lighter than metal);
//  - beam weapon mass    = `beamWeaponMass(power, 1800)` from beam power and
//    organic emitter density;
//  - reactor mass        = `reactorMass(output, powerDensity, 2500)` from
//    electrical output, core power density, and bio-organic containment;
//  - engine mass         = `engineMass(thrust, 2000)` from rated thrust and
//    bio-nozzle density;
//  - magazine mass       = `magazineMass(ammoStored, 3500)` from round count and
//    organic ordnance density;
//  - crew mass           = `crewMass(capacity, 600)` from berth count and water-
//    rich tissue density.
//  - sensor / comms mass = `engineMass(ionThrust, 1500)` fraction (organic
//    array panel + electronics).
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
// Swarm bio-organic material densities (kg/m³).
//
// Wet bio-chitin is close to water in density (~1100 kg/m³); organic tissue
// mechanisms are correspondingly lighter than metal across every category.
// ---------------------------------------------------------------------------

/** Organic turret mechanism density: wet bio-chitin muscle and chitin. */
export const SWARM_WEAPON_DENSITY_KG_PER_M3 = 2200;
/** Organic emitter/cooling density for beam weapons. */
export const SWARM_BEAM_DENSITY_KG_PER_M3 = 1800;
/** Bio-organic reactor containment density (lighter than Terran shielding). */
export const SWARM_REACTOR_DENSITY_KG_PER_M3 = 2500;
/** Bio-organic nozzle and jet density. */
export const SWARM_ENGINE_DENSITY_KG_PER_M3 = 2000;
/** Organic ordnance density (chitin-shelled rounds, lighter than metal). */
export const SWARM_MAGAZINE_DENSITY_KG_PER_M3 = 3500;
/** Organic sensor / comms array density (wet tissue, light electronics). */
const SWARM_ARRAY_DENSITY_KG_PER_M3 = 1500;
/** Organic electronics for comms (slightly denser than sensors). */
const SWARM_COMMS_DENSITY_KG_PER_M3 = 1200;
/** Ion-drive thrusting mass as a proxy for small organic subsystems. */
const SWARM_ION_THRUST_N = driveThrustNewtons("ion");

// ---------------------------------------------------------------------------
// Beam cooldowns (seconds) and their tick conversions.
//
// A beam fires once every `cooldown` ticks; the energy one shot deposits is its
// sustained power over that inter-shot dwell (`beamDamageJoules`). The Swarm's
// bio-chemical beam runs a faster cycle than a Terran pulse — the acid gland
// recharges quickly.
// ---------------------------------------------------------------------------

/** Acid-sprayer bio-gland recharge (s): a fast-cycling fighter-scale beam. */
const ACID_SPRAYER_COOLDOWN = cooldownTicks(0.7);

// ---------------------------------------------------------------------------
// Kinetic-weapon local anchors.
//
// Each Swarm kinetic weapon picks a (projectileMass, muzzleVelocity) pairing
// from the broadened `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S` menus
// in `combat-scale.ts`, then its mass, damage, range, projectile speed, and
// cooldown are all DERIVED from those two numbers — never hand-tuned.
// ---------------------------------------------------------------------------

/** Spore round: a fighter-class organic projectile (`autocannon` banding). */
const SPORE_MASS_KG = PROJECTILE_MASS_KG.autocannon;
const SPORE_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;
/** Spore-launcher cyclic bio-feed interval (s): fast refire is the Swarm's
 *  kinetic advantage. */
const SPORE_LAUNCHER_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.autocannon);

// ---------------------------------------------------------------------------
// Neural-sting local anchors.
//
// A neural-sting is a bio-electric homing tendril: frigate-scale ordnance that
// trades raw per-hit yield for fast refire and excellent tracking.
// ---------------------------------------------------------------------------

/** Neural-sting body mass (kg) — DERIVED from a frigate-scale guided round
 *  (the `autocannon` banding): a light bio-electric tendril, not a heavy
 *  warhead. */
const STING_MASS_KG = PROJECTILE_MASS_KG.autocannon;
/** Neural-sting cruise velocity (m/s) — DERIVED as a fraction of an autocannon
 *  muzzle velocity: a powered homing tendril is slower than a launched slug. */
const STING_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon / 2;
/** Neural-sting warhead yield (J) — authored catalogue content: a light
 *  bio-electric charge, sized below a frigate missile so the Swarm trades raw
 *  per-hit yield for fast refire and tracking. */
const STING_WARHEAD_J = 6e7;
/** Neural-sting launch-node reload interval (s): the hive-mind regeneration
 *  cycle between guided tendril launches. */
const STING_LAUNCHER_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.missile);
/**
 * Neural-sting finite-burn motor — DERIVED from the missile burn-time band.
 * A bio-electric tendril is powered+guided: it launches slow and accelerates
 * to cruise over its burn. For a neural-sting (cruise 2000 m/s, 40 s burn):
 * thrust 30 m/s², burn 1200 ticks.
 */
const STING_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  STING_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.missile,
);
const STING_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.missile);

// ---------------------------------------------------------------------------
// Reactor output targets and their derived masses.
//
// A reactor's mass is `reactorMass(output, powerDensity, swarmDensity)`. A
// denser core is proportionally smaller and lighter for the same output — by
// physics, not by a size class.
// ---------------------------------------------------------------------------

/** Compact fusion output target (~1.2 GW) — the Swarm frigate band. */
const REACTOR_FUSION_COMPACT_OUTPUT_W = 1.2e9;
/** Antimatter output target (~5 GW) — a Swarm capital core. */
const REACTOR_ANTIMATTER_OUTPUT_W = 5e9;

// ---------------------------------------------------------------------------
// Swarm modules — 21 entries, capability-derived.
//
// The module list preserves the legacy id, name, role, and category of each
// entry; ONLY the capability values and the mass derivation change. Mass now
// traces to the module's actual capability via the physics-layer functions
// (`kineticWeaponMass`, `beamWeaponMass`, `reactorMass`, `engineMass`,
// `magazineMass`, `crewMass`), using Swarm bio-organic densities.
// ---------------------------------------------------------------------------

export const swarmModules: ModuleDefinitionInput[] = [
  // --- Weapons ---
  {
    id: "swm-spore-launcher",
    faction: "Swarm",
    name: "Spore Launcher",
    description: "Rapid-fire organic spore bursts. Low individual damage but very fast refire and high spread.",
    category: "weapon",
    // Spore round: 1 kg @ 4 km/s. Muzzle energy ½·1·4000² = 8 MJ.
    // mass = kineticWeaponMass(1, 4000, 2200) = 2200 × (8e6 / 2e7) = 880 kg.
    // A fighter-scale organic spore gun is light — the Swarm's kinetic advantage.
    mass: kineticWeaponMass(SPORE_MASS_KG, SPORE_MUZZLE_MS, SWARM_WEAPON_DENSITY_KG_PER_M3),
    cost: 35,
    // A kinetic launcher draws capacitor/autoloader power.
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
      // Ballistic spore burst: unpowered and unguided.
      powered: false,
      guided: false,
    },
  },
  {
    id: "swm-acid-sprayer",
    faction: "Swarm",
    name: "Acid Sprayer",
    description: "Hitscan corrosive jet. Short range but dissolves armour plating rapidly.",
    category: "weapon",
    // Acid sprayer: sustained beam power 1e8 W (pdPulse band, the lightest beam).
    // mass = beamWeaponMass(1e8, 1800) = 1800 × (1e8 / 4e7) = 450 kg.
    // A fighter-scale bio-chemical gland is light — the Swarm's beam advantage.
    mass: beamWeaponMass(BEAM_POWER_W.pdPulse, SWARM_BEAM_DENSITY_KG_PER_M3),
    cost: 55,
    // A beam's draw IS its delivered optical power.
    powerDraw: BEAM_POWER_W.pdPulse,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.pdPulse, ACID_SPRAYER_COOLDOWN),
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
    // Neural-sting body mass is the same band as a spore round (fighter guided
    // ordnance). The launcher mechanism mass is scaled from the same kinetic
    // energy derivation, then adjusted for the organic bus envelope.
    mass: kineticWeaponMass(STING_MASS_KG, SPORE_MUZZLE_MS, SWARM_WEAPON_DENSITY_KG_PER_M3) * 0.7,
    cost: 80,
    // A missile launcher draws only its autoloader/handling power.
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
      // Powered guided bio-electric tendril: launches slow, accelerates to cruise.
      powered: true,
      guided: true,
      thrust: STING_THRUST_M_PER_S2,
      burnTicks: STING_BURN_TICKS,
    },
  },
  // --- Defence: bio-regen instead of shields ---
  {
    id: "swm-regen-membrane",
    faction: "Swarm",
    name: "Regeneration Membrane",
    description: "Living hull membrane that rapidly knits damage back together.",
    category: "defence",
    // A repair organ is a mass of living tissue. Sized as a small fraction of a
    // bio-engine (it is a membrane, not a mechanism). The Swarm does not use
    // shield projectors — this is a living repair function.
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_ENGINE_DENSITY_KG_PER_M3) * 0.25,
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
    // Spore cloud emitter: a point-defence bio-organ. Sized as a fraction of a
    // bio-engine (it is a small dispersal mechanism, not a main drive).
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_ENGINE_DENSITY_KG_PER_M3) * 0.2,
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
  },
  {
    id: "swm-carapace-screen",
    faction: "Swarm",
    name: "Carapace Screen",
    description: "A dense organic membrane that arrests kinetic strikes — the Swarm's living answer to mass-driver rounds.",
    category: "defence",
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.light),
    cost: 55,
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.light,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "deflector", capacity: DEFLECTOR_CAPACITY_KG_MPS.light, rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.light, rechargeDelay: 100 },
  },
  // --- Propulsion ---
  {
    id: "swm-flagellum-drive",
    faction: "Swarm",
    name: "Flagellum Drive",
    description: "Biological jet propulsion. Light and fast with excellent manoeuvrability.",
    category: "propulsion",
    // Flagellum drive: rated thrust 80 kN (lightPlasma band — a frigate-scale
    // bio-jet). mass = engineMass(80000, 2000) = 2000 × (80000 / 5000) = 32,000 kg.
    mass: engineMass(driveThrustNewtons("lightPlasma"), SWARM_ENGINE_DENSITY_KG_PER_M3),
    cost: 28,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: driveThrustNewtons("lightPlasma") },
  },
  {
    id: "swm-pulse-jet",
    faction: "Swarm",
    name: "Pulse Jet Organ",
    description: "High-output muscular jet for rapid bursts of speed.",
    category: "propulsion",
    // Pulse jet organ: rated thrust 120 kN (plasma band — a cruiser-scale bio-jet).
    // mass = engineMass(120000, 2000) = 2000 × (120000 / 5000) = 48,000 kg.
    mass: engineMass(driveThrustNewtons("plasma"), SWARM_ENGINE_DENSITY_KG_PER_M3),
    cost: 60,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "engine", thrust: driveThrustNewtons("plasma"), gimbalArc: Math.PI / 8 },
  },
  {
    id: "swm-pseudopod-cluster",
    faction: "Swarm",
    name: "Pseudopod Cluster",
    description: "Organic tentacle jets for precision manoeuvring. Produces torque without forward thrust.",
    category: "propulsion",
    // Pseudopod cluster: a small RCS jet ring. Sized as a fraction of a bio-engine.
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_ENGINE_DENSITY_KG_PER_M3) * 0.15,
    cost: 32,
    powerDraw: MODULE_POWER_DRAW_W.attitude,
    crewRequired: 0,
    techLevel: 1,
    // DERIVED from RCS_TORQUE_N_M (combat-scale.ts): the slew spec
    // (MAX_TURN_RATE / SLEW_TIME) applied to a frigate-band reference hull's
    // moment of inertia, so a frigate reaches max turn rate in the slew time.
    effect: { kind: "rcs", torque: RCS_TORQUE_N_M },
  },
  {
    id: "swm-gyral-organ",
    faction: "Swarm",
    name: "Gyral Organ",
    description: "Living spinning organ for attitude control. Provides torque through momentum exchange with the ship's bio-core.",
    category: "propulsion",
    // Gyral organ: a reaction wheel analogue. Heavier than RCS (a real spinning
    // rotor), lighter than a main engine.
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_ENGINE_DENSITY_KG_PER_M3) * 0.2,
    cost: 48,
    powerDraw: MODULE_POWER_DRAW_W.attitude,
    crewRequired: 0,
    techLevel: 2,
    // DERIVED from REACTION_WHEEL_TORQUE_N_M (combat-scale.ts): the slew spec
    // applied to a heavy-frigate / light-cruiser reference hull's moment of
    // inertia — the heavier, more powerful momentum-exchange rotor.
    effect: { kind: "reactionWheel", torque: REACTION_WHEEL_TORQUE_N_M },
  },
  // --- System: neural command / bio-power ---
  {
    id: "swm-neural-ganglion",
    faction: "Swarm",
    name: "Neural Ganglion",
    description: "Distributed nerve cluster that co-ordinates the ship's organic systems and acts as its command node.",
    category: "system",
    // Compact fusion: 1.2 GW output @ 4e7 W/m³ (the compact fusion band).
    // mass = reactorMass(1.2e9, 4e7, 2500) = 2500 × (1.2e9 / 4e7) = 75,000 kg.
    mass: reactorMass(
      REACTOR_FUSION_COMPACT_OUTPUT_W,
      FUSION_COMPACT_POWER_DENSITY_W_PER_M3,
      SWARM_REACTOR_DENSITY_KG_PER_M3,
    ),
    cost: 70,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "power", output: REACTOR_FUSION_COMPACT_OUTPUT_W },
    command: true,
  },
  {
    id: "swm-metabolic-core",
    faction: "Swarm",
    name: "Metabolic Core",
    description: "Central bio-reactor organ converting raw biomass into usable energy.",
    category: "system",
    // Standard antimatter: 5 GW output @ 2e8 W/m³ (capital band).
    // mass = reactorMass(5e9, 2e8, 2500) = 2500 × (5e9 / 2e8) = 62,500 kg.
    mass: reactorMass(
      REACTOR_ANTIMATTER_OUTPUT_W,
      ANTIMATTER_POWER_DENSITY_W_PER_M3,
      SWARM_REACTOR_DENSITY_KG_PER_M3,
    ),
    cost: 160,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 3,
    effect: { kind: "power", output: REACTOR_ANTIMATTER_OUTPUT_W },
    command: true,
  },
  {
    id: "swm-ammon-sac",
    faction: "Swarm",
    name: "Ammon Sac",
    description: "Bio-organic ammunition reservoir producing and storing organic projectile clusters. Crew distribute harvested rounds to weapons.",
    category: "system",
    // 250 rounds: magazineMass(250, 3500) = 3500 × (250 / 30) ≈ 29,167 kg.
    mass: magazineMass(250, SWARM_MAGAZINE_DENSITY_KG_PER_M3),
    cost: 55,
    powerDraw: MODULE_POWER_DRAW_W.magazine,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "magazine", ammoStored: 250 },
  },

  // --- Swarm system: bio-sensors (directional, mirroring the Terran family) ---
  // Sensor masses are not capability-derived (a sensor's mass is dominated by
  // its array panel and electronics, not by its detection range). They are
  // sized as a small fraction of a bio-engine (an ion drive is a convenient
  // proxy for a few-cubic-metre organic electronic subsystem).
  {
    id: "swm-electro-membrane",
    faction: "Swarm",
    name: "Electro-Receptor Membrane",
    description: "Passive skin of piezoelectric cilia sensing pressure waves and fields from every direction. No metabolic cost; always alert all-round.",
    category: "system",
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_ARRAY_DENSITY_KG_PER_M3) * 0.1,
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
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_ARRAY_DENSITY_KG_PER_M3) * 0.12,
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
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_ARRAY_DENSITY_KG_PER_M3) * 0.18,
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
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_ARRAY_DENSITY_KG_PER_M3) * 0.15,
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
  // Comms ranges are lifted to the km combat scale by `KM_DETECTION_RANGE_SCALE`
  // in lockstep with sensor reach, so the squad-net / relay banding holds at the
  // new engagement distances (an omni for local chatter, a dish/laser for relay).
  {
    id: "swm-pheromone-net",
    faction: "Swarm",
    name: "Pheromone Net",
    description: "Diffuse cloud of chemical signals readable by nearby hive-kin. Short-range omnidirectional awareness; costs nothing to run.",
    category: "system",
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_COMMS_DENSITY_KG_PER_M3) * 0.08,
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
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_COMMS_DENSITY_KG_PER_M3) * 0.1,
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
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_COMMS_DENSITY_KG_PER_M3) * 0.16,
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
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_COMMS_DENSITY_KG_PER_M3) * 0.14,
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
    mass: engineMass(SWARM_ION_THRUST_N, SWARM_COMMS_DENSITY_KG_PER_M3) * 0.18,
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
