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
// (`../combat-scale.ts`): beam `damage` = power × one-tick dwell via
// `beamDamageJoules`, kinetic `damage` = ½·m·v² via `kineticDamageJoules`, and
// `projectileSpeed` = `projectileSpeedMPerTick(muzzleVelocity)`. The
// Crystalline arm almost entirely with beams: a pulse-grade prism, a
// frigate-grade phase lance, and a capital spinal lance, plus one lobbed kinetic
// resonance shard for when a beam's line of sight is unwanted.
// ---------------------------------------------------------------------------

/** Crystalline resonance shard: a fighter-class lobbed kinetic round
 *  (`autocannon` banding in `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S`). */
const SHARD_MASS_KG = PROJECTILE_MASS_KG.autocannon;
const SHARD_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;

  // Crystalline Concord modules — energy beings in grown-crystal hulls. They
  // fight at range with hitscan beams that punch shields, behind the strongest
  // regenerating adaptive shields in the catalogue, and reposition with blink
  // drives while phase-cloaked. The trade-offs are severe: brittle crystal hulls
  // (lowest structure), power-hungry everything, eye-watering cost, and sluggish
  // conventional engines. Counters: heavy armour-piercing alpha (Foundry) cracks
  // their thin hull under the shields; sensor nets deny the cloak.
  //
  // Masses are in kilograms (see `../physics.ts`); thrust in Newtons.
  // ---------------------------------------------------------------------------

const crystalThrustN = driveThrustNewtons("crystal");

export const crystallineModules: ModuleDefinition[] = [
  // --- Weapons (hitscan beams, high shield-pierce, low armour-pierce) ---
  {
    id: "cry-prism-beam",
    faction: "Crystalline",
    name: "Prism Beam",
    description: "Coherent light beam split through a focusing crystal. Long range, fast refire, chews through shields.",
    category: "weapon",
    mass: moduleMass("lightWeapon"),
    cost: 55,
    // A beam's draw IS its delivered optical power.
    powerDraw: BEAM_POWER_W.pulse,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.pulse, 24),
      range: 420,
      cooldown: 24,
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
    mass: moduleMass("mediumWeapon"),
    cost: 120,
    powerDraw: BEAM_POWER_W.beam,
    crewRequired: 2,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.beam, 40),
      range: 560,
      cooldown: 40,
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
    mass: moduleMass("heavyWeapon"),
    cost: 240,
    powerDraw: BEAM_POWER_W.lance,
    crewRequired: 3,
    techLevel: 4,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.lance, 180),
      range: 640,
      cooldown: 180,
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
    description: "Lobbed shard of coherent energy. A projectile option for when a beam's line of sight is unwanted; unlimited ammunition.",
    category: "weapon",
    mass: moduleMass("lightWeapon"),
    cost: 70,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(SHARD_MASS_KG, SHARD_MUZZLE_MS),
      range: 380,
      cooldown: 60,
      projectileSpeed: projectileSpeedMPerTick(SHARD_MUZZLE_MS),
      projectileMass: SHARD_MASS_KG,
      tracking: 1,
      shieldPiercing: 0.4,
      armourPiercing: 0.15,
      spread: 0.03,
    },
  },
  // --- Defence: adaptive shields (their signature), thin crystal plate ---
  {
    id: "cry-adaptive-shield-mk1",
    faction: "Crystalline",
    name: "Adaptive Bulwark Mk I",
    description: "A shield whose recharge ramps up the longer it goes untouched, recovering from a salvo far faster than a conventional deflector.",
    category: "defence",
    mass: moduleMass("shield"),
    cost: 90,
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
    mass: moduleMass("shield"),
    cost: 200,
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
  },  // --- Propulsion: sluggish engines, plus the blink drive that defines them ---
  {
    id: "cry-thruster",
    faction: "Crystalline",
    name: "Resonance Thruster",
    description: "A ponderous photon drive. Adequate, but the Concord repositions by blinking rather than thrusting.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 40,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: crystalThrustN },
  },
  {
    id: "cry-blink-drive",
    faction: "Crystalline",
    name: "Phase Blink Drive",
    description: "Folds the ship a short distance toward its target (or away when retreating). The Concord's signature mobility, far outclassing its thrusters.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 130,
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
    mass: moduleMass("reactor"),
    cost: 100,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "power", output: FUSION_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "cry-quantum-lattice",
    faction: "Crystalline",
    name: "Quantum Lattice Core",
    description: "A capital resonance reactor. Enormous output to drive spinal lances and full adaptive-shield arrays.",
    category: "system",
    mass: moduleMass("reactorCompact"),
    cost: 230,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 4,
    effect: { kind: "power", output: ANTIMATTER_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "cry-resonator-core",
    faction: "Crystalline",
    name: "Resonator Core",
    description: "Sparse crew housing — the Concord need few minds aboard, but some are required to tend the focusing arrays.",
    category: "crew",
    mass: moduleMass("crew"),
    cost: 35,
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
    mass: moduleMass("shield"),
    cost: 80,
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
  // --- Stealth: phase-cloak + signature dampening ---
  {
    id: "cry-phase-cloak",
    faction: "Crystalline",
    name: "Phase Cloak",
    description: "Shifts the crystal hull out of phase so enemies cannot acquire it — until it fires. Pairs with the blink drive for hit-and-run strikes.",
    category: "system",
    mass: moduleMass("shield"),
    cost: 110,
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
    mass: moduleMass("sensor"),
    cost: 60,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "signature",
      acquisitionMultiplier: 0.6,
    },
  },
];
