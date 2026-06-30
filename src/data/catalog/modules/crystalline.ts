import type { ModuleDefinition } from "@/schema/module";
import {
  beamWeaponMass,
  crewMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  reactorMass,
  shieldMass,
  deflectorMass,
} from "../physics";
import {
  BEAM_POWER_W,
  BEAM_RANGE_M,
  FUSION_POWER_DENSITY_W_PER_M3,
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
import { SENSOR_OMNI_ARC } from "../sensor-arcs";

// ---------------------------------------------------------------------------
// Crystalline Concord modules — grown-crystal faction.
//
// Every module's mass is DERIVED from its capability via the physics-layer
// mass functions in `../physics.ts`, with Crystalline-specific densities that
// reflect their heavy crystal matrices (~4500 kg/m³ bulk):
//
//  - beam weapon mass = `beamWeaponMass(power, CRYSTAL_BEAM_DENSITY)` from
//    sustained optical power (emitter + cooling stack);
//  - kinetic weapon mass = `kineticWeaponMass(m, v, CRYSTAL_WEAPON_DENSITY)`
//    from muzzle kinetic energy (½·m·v²);
//  - reactor mass = `reactorMass(output, powerDensity, CRYSTAL_REACTOR_DENSITY)`
//    from electrical output and the core's volumetric power density;
//  - engine mass = `engineMass(thrust, CRYSTAL_ENGINE_DENSITY)` from rated thrust;
//  - shield mass = `shieldMass(capacity, CRYSTAL_SHIELD_DENSITY)` from field
//    capacity;
//  - crew mass = `crewMass(capacity, CRYSTAL_CREW_DENSITY)` from berth count.
//
// Crystalline modules are DENSER than Terran equivalents because of the heavy
// crystal matrices: weapon turrets are bulky crystal mechanisms, shields are
// crystal field generators, reactors are crystal-contained, and crew habitats
// are dense crystal life-sustaining shells. A Crystalline module weighs more
// than a Terran one of the same capability.
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
// Crystalline densities (kg/m³).
//
// The `density` parameter is the LAST argument of each mass function. These
// are higher than the Terran defaults because Crystalline tech is built around
// heavy crystal matrices rather than fabricated metal.
// ---------------------------------------------------------------------------

/** Crystal weapon/turret density (kg/m³): bulky crystal mechanisms. */
const CRYSTAL_WEAPON_DENSITY = 4500;
/** Crystal beam weapon density (kg/m³): heavy crystal emitter + cooling. */
const CRYSTAL_BEAM_DENSITY = 4200;
/** Crystal shield generator density (kg/m³): crystal field projectors. */
const CRYSTAL_SHIELD_DENSITY = 3000;
/** Crystal engine/nozzle density (kg/m³): crystal thrust assemblies. */
const CRYSTAL_ENGINE_DENSITY = 3500;
/** Crystal reactor containment density (kg/m³): dense crystal shielding. */
const CRYSTAL_REACTOR_DENSITY = 5000;
/** Crystal crew habitat density (kg/m³): dense crystal life-sustaining shell. */
const CRYSTAL_CREW_DENSITY = 2500;

// ---------------------------------------------------------------------------
// Beam cooldowns (seconds) and their tick conversions.
//
// A beam fires once every `cooldown` ticks; the energy one shot deposits is its
// sustained power over that inter-shot dwell (`beamDamageJoules`). A faster-
// cycling beam deposits less per shot but fires more often, and a slow lance
// deposits a large pulse on a long cooldown — so beam DPS (its `beamPower` in
// watts) is directly comparable against a kinetic salvo regardless of refire.
//
// Crystalline beams run slightly slower than Terran equivalents: crystal
// emitters are bulkier and need longer thermal recovery between shots.
// ---------------------------------------------------------------------------

/** Prism Beam refire / dwell (s): a fast-cycling pulse-grade crystal beam. */
const PRISM_BEAM_COOLDOWN = cooldownTicks(1.0);
/** Phase Lance dwell (s): a sustained frigate-grade resonant crystal beam. */
const PHASE_LANCE_COOLDOWN = cooldownTicks(1.6);
/** Spinal Resonance Lance dwell (s): a long thermal-recovery capital weapon. */
const SPINAL_LANCE_COOLDOWN = cooldownTicks(7);

// ---------------------------------------------------------------------------
// Kinetic-weapon local anchors.
//
// The Crystalline Concord fields only one kinetic: a lobbed resonance shard.
// It uses a heavy-autocannon-scale projectile — a chunk of crystal hurled at
// fighter-skirmish speed for when a beam's line of sight is unwanted.
// ---------------------------------------------------------------------------

/** Resonance shard: a fighter-class lobbed crystal round. */
const SHARD_MASS_KG = PROJECTILE_MASS_KG.heavyAutocannon;
const SHARD_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.heavyAutocannon;

// ---------------------------------------------------------------------------
// Reactor output targets.
//
// Crystalline reactors use the broader fusion / antimatter power-density menu.
// Output = powerDensity × moduleVolume(reactor=30) or moduleVolume(reactorCompact=25).
// ---------------------------------------------------------------------------

/** Standard crystal fusion reactor: 5e7 W/m³ × 30 m³ = 1.5 GW. */
const CRYSTAL_FUSION_OUTPUT_W = 1.5e9;
/** Capital crystal antimatter reactor: 2e8 W/m³ × 25 m³ = 5 GW. */
const CRYSTAL_ANTIMATTER_OUTPUT_W = 5e9;

// ---------------------------------------------------------------------------
// Crystalline Concord modules.
//
// The module list preserves the legacy id, name, role, and category of each
// entry; ONLY the capability values and the mass derivation change. Mass now
// traces to the module's actual capability via the physics-layer functions,
// with Crystalline-specific densities making each module heavier than its
// Terran equivalent.
//
// The Crystalline Concord is a beam-heavy faction: three beam weapons from
// fighter pulse to capital lance, one lobbed kinetic for line-of-sight breaks,
// two adaptive shields (their signature), sluggish thrusters plus the blink
// drive that defines them, two reactors, sparse crew, an overcharger, and the
// phase-cloak + signature-damper stealth suite.
// ---------------------------------------------------------------------------

export const crystallineModules: ModuleDefinition[] = [
  // --- Weapons (hitscan beams, high shield-pierce, low armour-pierce) ---
  {
    id: "cry-prism-beam",
    faction: "Crystalline",
    name: "Prism Beam",
    description: "Coherent light beam split through a focusing crystal. Long range, fast refire, chews through shields.",
    category: "weapon",
    // Prism Beam: sustained beam power 3e8 W (pulse band). Mass derived from
    // the broadened beam menu with crystal density:
    // beamWeaponMass(3e8, 4200) = 4200 × (3e8 / 4e7) = 31,500 kg (~32 t).
    mass: beamWeaponMass(BEAM_POWER_W.pulse, CRYSTAL_BEAM_DENSITY),
    cost: 65,
    // A beam's draw IS its delivered optical power.
    powerDraw: BEAM_POWER_W.pulse,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.pulse, PRISM_BEAM_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: PRISM_BEAM_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.55,
      armourPiercing: 0.05,
      spread: 0,
    },
  },
  {
    id: "cry-phase-lance",
    faction: "Crystalline",
    name: "Phase Lance",
    description: "Sustained resonant beam. Excellent range and shield penetration, mediocre against bare armour.",
    category: "weapon",
    // Phase Lance: sustained beam power 4.5e8 W (disruptor band), a frigate
    // anti-shield beam. Mass derived with crystal density:
    // beamWeaponMass(4.5e8, 4200) = 4200 × (4.5e8 / 4e7) = 47,250 kg (~47 t).
    mass: beamWeaponMass(BEAM_POWER_W.disruptor, CRYSTAL_BEAM_DENSITY),
    cost: 140,
    powerDraw: BEAM_POWER_W.disruptor,
    crewRequired: 2,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.disruptor, PHASE_LANCE_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: PHASE_LANCE_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.7,
      armourPiercing: 0.1,
      spread: 0,
    },
  },
  {
    id: "cry-spinal-lance",
    faction: "Crystalline",
    name: "Spinal Resonance Lance",
    description: "A fixed-forward capital weapon: the entire prow is a focusing array. Devastating shield-bypassing damage on a long cooldown, but it only fires dead ahead.",
    category: "weapon",
    // Spinal Resonance Lance: sustained beam power 1e9 W (lance band), the
    // capital spinal weapon. Mass derived with crystal density:
    // beamWeaponMass(1e9, 4200) = 4200 × (1e9 / 4e7) = 105,000 kg (~105 t).
    mass: beamWeaponMass(BEAM_POWER_W.lance, CRYSTAL_BEAM_DENSITY),
    cost: 280,
    powerDraw: BEAM_POWER_W.lance,
    crewRequired: 3,
    techLevel: 4,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.lance, SPINAL_LANCE_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: SPINAL_LANCE_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.8,
      armourPiercing: 0.2,
      spread: 0,
      // Fixed spinal mount — no traverse.
      turretArc: 0,
      turretTurnRate: 0,
    },
  },
  {
    id: "cry-resonance-cannon",
    faction: "Crystalline",
    name: "Resonance Cannon",
    description: "Lobbed shard of coherent crystal. A projectile option for when a beam's line of sight is unwanted; unlimited ammunition.",
    category: "weapon",
    // Resonance Cannon: a fighter-class lobbed crystal shard. Uses the
    // heavy-autocannon band (3 kg, 5 km/s) for a heavy fighter/light frigate
    // round. Mass derived with crystal density:
    // kineticWeaponMass(3, 5000, 4500) = 4500 × (½·3·5000² / 2e7)
    //   = 4500 × (3.75e6 / 2e7) = 4500 × 0.1875 = 843.75 kg (~844 kg).
    mass: kineticWeaponMass(SHARD_MASS_KG, SHARD_MUZZLE_MS, CRYSTAL_WEAPON_DENSITY),
    cost: 80,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(SHARD_MASS_KG, SHARD_MUZZLE_MS),
      range: kineticRangeM(SHARD_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.heavyAutocannon),
      projectileSpeed: projectileSpeedMPerTick(SHARD_MUZZLE_MS),
      projectileMass: SHARD_MASS_KG,
      tracking: 1,
      shieldPiercing: 0.4,
      armourPiercing: 0.15,
      spread: 0.03,
      // Ballistic shard: unpowered and unguided.
      powered: false,
      guided: false,
    },
  },
  // --- Defence: adaptive shields (their signature), thin crystal plate ---
  {
    id: "cry-adaptive-shield-mk1",
    faction: "Crystalline",
    name: "Adaptive Bulwark Mk I",
    description: "A shield whose recharge ramps up the longer it goes untouched, recovering from a salvo far faster than a conventional deflector.",
    category: "defence",
    // Adaptive Bulwark Mk I: medium shield (4e8 J). Mass derived with crystal
    // density: shieldMass(4e8, 3000) = 3000 × (4e8 / 1.3e7) ≈ 92,308 kg
    // (~92 t). Heavier than Terran equivalent due to crystal field generators.
    mass: shieldMass(SHIELD_CAPACITY_J.medium, CRYSTAL_SHIELD_DENSITY),
    cost: 110,
    // A shield's draw IS its recharge wattage.
    powerDraw: SHIELD_RECHARGE_W.medium,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.medium,
      rechargeRate: SHIELD_RECHARGE_W.medium,
      rechargeDelay: 55,
      adaptiveRampRate: 0.04,
    },
  },
  {
    id: "cry-adaptive-shield-mk2",
    faction: "Crystalline",
    name: "Adaptive Bulwark Mk II",
    description: "Capital adaptive shield: huge capacity and a steep recovery ramp, the Concord's defining protection.",
    category: "defence",
    // Adaptive Bulwark Mk II: heavy shield (6e8 J). Mass derived with crystal
    // density: shieldMass(6e8, 3000) = 3000 × (6e8 / 1.3e7) ≈ 138,462 kg
    // (~138 t). The Concord's signature module — massive and pricey.
    mass: shieldMass(SHIELD_CAPACITY_J.heavy, CRYSTAL_SHIELD_DENSITY),
    cost: 240,
    powerDraw: SHIELD_RECHARGE_W.heavy,
    crewRequired: 2,
    techLevel: 4,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.heavy,
      rechargeRate: SHIELD_RECHARGE_W.heavy,
      rechargeDelay: 65,
      adaptiveRampRate: 0.06,
    },
  },
  // --- Defence: deflectors (momentum screens; crystal density, no ramp) ---
  {
    id: "cry-resonance-bulwark-mk1",
    faction: "Crystalline",
    name: "Resonance Bulwark Mk I",
    description: "Crystal momentum screen. Resonant lattice arrests kinetic rounds and rams.",
    category: "defence",
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.medium, CRYSTAL_SHIELD_DENSITY),
    cost: 110,
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.medium,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "deflector",
      capacity: DEFLECTOR_CAPACITY_KG_MPS.medium,
      rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.medium,
      rechargeDelay: 55,
    },
  },
  {
    id: "cry-resonance-bulwark-mk2",
    faction: "Crystalline",
    name: "Resonance Bulwark Mk II",
    description: "Capital crystal momentum screen. Stops capital-grade kinetics cold.",
    category: "defence",
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.heavy, CRYSTAL_SHIELD_DENSITY),
    cost: 240,
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy,
    crewRequired: 2,
    techLevel: 4,
    effect: {
      kind: "deflector",
      capacity: DEFLECTOR_CAPACITY_KG_MPS.heavy,
      rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy,
      rechargeDelay: 65,
    },
  },
  // --- Propulsion: sluggish engines, plus the blink drive that defines them ---
  {
    id: "cry-thruster",
    faction: "Crystalline",
    name: "Resonance Thruster",
    description: "A ponderous photon drive. Adequate, but the Concord repositions by blinking rather than thrusting.",
    category: "propulsion",
    // Resonance Thruster: crystal drive rated at 48,000 N. Mass derived with
    // crystal density: engineMass(48000, 3500) = 3500 × (48000 / 5000)
    //   = 3500 × 9.6 = 33,600 kg (~34 t).
    mass: engineMass(driveThrustNewtons("crystal"), CRYSTAL_ENGINE_DENSITY),
    cost: 50,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: driveThrustNewtons("crystal") },
  },
  {
    id: "cry-blink-drive",
    faction: "Crystalline",
    name: "Phase Blink Drive",
    description: "Folds the ship a short distance toward its target (or away when retreating). The Concord's signature mobility, far outclassing its thrusters.",
    category: "propulsion",
    // Phase Blink Drive: a specialised folding mechanism. Sized as a fraction of
    // the crystal drive's mass (it is a compact fold generator, not a main
    // engine). Mass = engineMass(crystal) × 0.4 = 33,600 × 0.4 ≈ 13,440 kg.
    mass: engineMass(driveThrustNewtons("crystal"), CRYSTAL_ENGINE_DENSITY) * 0.4,
    cost: 150,
    // A folding drive draws its power-conditioning load like a thruster.
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 1,
    techLevel: 3,
    effect: {
      kind: "blink",
      mode: "tactical",
      jumpRange: 220,
      cooldown: 80,
    },
  },
  // --- System: high-output reactors, sparse crew, overcharger ---
  {
    id: "cry-power-crystal",
    faction: "Crystalline",
    name: "Power Crystal",
    description: "A grown energy core. High output for its size to feed the Concord's power-hungry beams and shields; serves as the command node.",
    category: "system",
    // Power Crystal: standard fusion at 1.5 GW output, 5e7 W/m³. Mass derived
    // with crystal density:
    // reactorMass(1.5e9, 5e7, 5000) = 5000 × (1.5e9 / 5e7) = 150,000 kg
    // (~150 t). Denser crystal containment makes it heavier than Terran.
    mass: reactorMass(CRYSTAL_FUSION_OUTPUT_W, FUSION_POWER_DENSITY_W_PER_M3, CRYSTAL_REACTOR_DENSITY),
    cost: 120,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "power", output: CRYSTAL_FUSION_OUTPUT_W },
    command: true,
  },
  {
    id: "cry-quantum-lattice",
    faction: "Crystalline",
    name: "Quantum Lattice Core",
    description: "A capital resonance reactor. Enormous output to drive spinal lances and full adaptive-shield arrays.",
    category: "system",
    // Quantum Lattice Core: antimatter at 5 GW output, 2e8 W/m³. Mass derived
    // with crystal density:
    // reactorMass(5e9, 2e8, 5000) = 5000 × (5e9 / 2e8) = 125,000 kg
    // (~125 t). Smaller core than fusion but heavier shielding.
    mass: reactorMass(CRYSTAL_ANTIMATTER_OUTPUT_W, 2e8, CRYSTAL_REACTOR_DENSITY),
    cost: 270,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 4,
    effect: { kind: "power", output: CRYSTAL_ANTIMATTER_OUTPUT_W },
    command: true,
  },
  {
    id: "cry-resonator-core",
    faction: "Crystalline",
    name: "Resonator Core",
    description: "Sparse crew housing — the Concord need few minds aboard, but some are required to tend the focusing arrays.",
    category: "crew",
    // Resonator Core: 5 berths. Mass derived with crystal density:
    // crewMass(5, 2500) = 2500 × (5 × 12) = 150,000 kg (~150 t).
    // Crystal habitat is dense — heavier than Terran crew quarters.
    mass: crewMass(5, CRYSTAL_CREW_DENSITY),
    cost: 45,
    powerDraw: MODULE_POWER_DRAW_W.crew,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "crew", capacity: 5 },
  },
  {
    id: "cry-overcharger",
    faction: "Crystalline",
    name: "Resonance Overcharger",
    description: "Briefly surges the ship's power ceiling, keeping arrays online through a brownout at the cost of a recharge gap.",
    category: "system",
    // Resonance Overcharger: a power-conditioning module. Sized as a fraction of
    // the fusion reactor's mass (it is a capacitor/surge unit, not a full core).
    // Mass = reactorMass(fusion) × 0.35 = 150,000 × 0.35 = 52,500 kg.
    mass: reactorMass(CRYSTAL_FUSION_OUTPUT_W, FUSION_POWER_DENSITY_W_PER_M3, CRYSTAL_REACTOR_DENSITY) * 0.35,
    cost: 95,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 3,
    effect: {
      kind: "overcharge",
      powerSurge: 30,
      duration: 60,
      cooldown: 200,
    },
  },
  {
    id: "cry-resonance-sensor",
    faction: "Crystalline",
    name: "Resonance Sensor",
    description: "A grown crystal resonance array. Listens in every direction for the faint harmonics of drives and shields — the Concord's silent all-round awareness.",
    category: "system",
    // Resonance Sensor: an omni passive array. A sensor's mass is dominated by
    // its array panel and electronics, not by its detection range, so like the
    // Terran passive array it is sized as a small fraction of a drive. Crystal
    // variant uses the crystal drive: engineMass(crystal) × 0.1.
    mass: engineMass(driveThrustNewtons("crystal"), CRYSTAL_ENGINE_DENSITY) * 0.1,
    cost: 40,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "sensor",
      sensorType: "omni",
      arc: SENSOR_OMNI_ARC,
      detectionRange: 320 * KM_DETECTION_RANGE_SCALE,
      bearing: 0,
      nebulaImmune: false,
      mode: "passive",
      passiveBands: ["thermal", "radar"],
      gain: 1.0,
    },
  },
  // --- Stealth: phase-cloak + signature dampening ---
  {
    id: "cry-phase-cloak",
    faction: "Crystalline",
    name: "Phase Cloak",
    description: "Shifts the crystal hull out of phase so enemies cannot acquire it — until it fires. Pairs with the blink drive for hit-and-run strikes.",
    category: "system",
    // Phase Cloak: an active stealth field generator. Sized as a fraction of
    // the crystal drive's mass (it is a compact phase-shift emitter).
    // Mass = engineMass(crystal) × 0.25 = 33,600 × 0.25 = 8,400 kg.
    mass: engineMass(driveThrustNewtons("crystal"), CRYSTAL_ENGINE_DENSITY) * 0.25,
    cost: 130,
    // An active stealth field draws sensor-class electronics power.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 1,
    techLevel: 3,
    effect: {
      kind: "cloak",
      decloakTicks: 40,
    },
  },
  {
    id: "cry-signature-damper",
    faction: "Crystalline",
    name: "Signature Damper",
    description: "Always-on field that shrinks the range at which enemies can detect the ship, complementing the phase-cloak.",
    category: "system",
    // Signature Damper: a low-power emitter array. Sized as a smaller fraction
    // of the crystal drive's mass.
    // Mass = engineMass(crystal) × 0.15 = 33,600 × 0.15 = 5,040 kg.
    mass: engineMass(driveThrustNewtons("crystal"), CRYSTAL_ENGINE_DENSITY) * 0.15,
    cost: 75,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "signature",
      acquisitionMultiplier: 0.6,
    },
  },
];
