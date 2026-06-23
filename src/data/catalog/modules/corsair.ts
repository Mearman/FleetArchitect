import type { ModuleDefinition } from "@/schema/module";
import {
  driveThrustNewtons,
  moduleMass,
} from "../physics";
import {
  FUSION_REACTOR_OUTPUT_W,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  PROJECTILE_MASS_KG,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  kineticDamageJoules,
  projectileSpeedMPerTick,
} from "../combat-scale";

// ---------------------------------------------------------------------------
// Weapon damage and projectile speed are DERIVED from the combat-scale anchors
// (`../combat-scale.ts`): kinetic `damage` = ½·m·v² via `kineticDamageJoules`,
// `projectileSpeed` = `projectileSpeedMPerTick(muzzleVelocity)` (the m/s →
// m/tick boundary). Missiles carry an authored warhead yield (J) plus a body
// mass / cruise velocity. The Corsairs raid with light, fast ordnance: homing
// missiles and a fighter-class finisher cannon.
// ---------------------------------------------------------------------------

/** Corsair raid-cannon round: a fighter-class autocannon slug (`autocannon`
 *  banding in `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S`). */
const RAID_CANNON_MASS_KG = PROJECTILE_MASS_KG.autocannon;
const RAID_CANNON_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;
/** Corsair raider-missile body mass (kg) — DERIVED from a frigate-class guided
 *  round (`railgun` banding). */
const RAIDER_MISSILE_MASS_KG = PROJECTILE_MASS_KG.railgun;
/** Raider-missile cruise velocity (m/s) — DERIVED as a fraction of a railgun
 *  muzzle velocity. */
const RAIDER_MISSILE_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.railgun / 4;
/** Corsair raider-missile warhead yield (J) — authored catalogue content: a
 *  frigate-class missile sized below a Terran missile, trading yield for refire
 *  and tracking. */
const RAIDER_MISSILE_WARHEAD_J = 3e8;
/** Corsair swarm-missile body mass (kg) — DERIVED from a fighter-class guided
 *  round (`autocannon` banding): a light saturation missile. */
const SWARM_MISSILE_MASS_KG = PROJECTILE_MASS_KG.autocannon;
/** Swarm-missile cruise velocity (m/s) — DERIVED as a fraction of an autocannon
 *  muzzle velocity. */
const SWARM_MISSILE_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon / 2;
/** Corsair swarm-missile warhead yield (J) — authored catalogue content: a
 *  light saturation warhead, lowest per-hit yield, fired in volleys. */
const SWARM_MISSILE_WARHEAD_J = 8e7;

  // ---------------------------------------------------------------------------
  // Corsair Reavers modules — welded junk-hull raiders built to strike and
  // vanish. They favour high-tracking missiles, approach under cloak, blink in
  // to unleash a volley, and jam or board anything that survives. Afterburners
  // and the most agile engines in the catalogue make them slippery. Trade-offs:
  // thin armour, weak shields, finite missile magazines that run dry, and
  // everything falls apart if point defences shred the volley. Counters:
  // Synthetic point-defence nets annihilate their missiles and drones; ECCM
  // strips their jamming; Foundry flak chews up their swarm.
  //
  // Masses are in kilograms (see `../physics.ts`); thrust in Newtons.
  // ---------------------------------------------------------------------------

const raiderThrustN = driveThrustNewtons("raider");

export const corsairModules: ModuleDefinition[] = [
  // --- Weapons: missiles and a light finisher cannon ---
  {
    id: "cor-raider-missile",
    faction: "Corsair",
    name: "Raider Missile Rack",
    description: "Homing missiles with excellent tracking on a fast refire. The Reavers' primary armament — punishing if the volley lands.",
    category: "weapon",
    mass: moduleMass("mediumWeapon"),
    cost: 75,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: RAIDER_MISSILE_WARHEAD_J,
      range: 520,
      cooldown: 70,
      projectileSpeed: projectileSpeedMPerTick(RAIDER_MISSILE_CRUISE_MS),
      projectileMass: RAIDER_MISSILE_MASS_KG,
      tracking: 3,
      shieldPiercing: 0.1,
      armourPiercing: 0.3,
      spread: 0.2,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.07,
      ammoCapacity: 60,
    },
  },
  {
    id: "cor-swarm-missile",
    faction: "Corsair",
    name: "Swarm Launcher",
    description: "A multi-cell launcher firing a spread of light homing missiles. Lower per-hit damage but saturates point defences and overwhelms a single target.",
    category: "weapon",
    mass: moduleMass("mediumWeapon"),
    cost: 110,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: SWARM_MISSILE_WARHEAD_J,
      range: 460,
      cooldown: 50,
      projectileSpeed: projectileSpeedMPerTick(SWARM_MISSILE_CRUISE_MS),
      projectileMass: SWARM_MISSILE_MASS_KG,
      tracking: 3.5,
      shieldPiercing: 0.1,
      armourPiercing: 0.2,
      spread: 0.6,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.08,
      ammoCapacity: 80,
    },
  },
  {
    id: "cor-raid-cannon",
    faction: "Corsair",
    name: "Raid Cannon",
    description: "A light, fast autocannon for finishing off targets the missiles have stripped. Cheap and punchy for its size.",
    category: "weapon",
    mass: moduleMass("lightWeapon"),
    cost: 45,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(RAID_CANNON_MASS_KG, RAID_CANNON_MUZZLE_MS),
      range: 300,
      cooldown: 30,
      projectileSpeed: projectileSpeedMPerTick(RAID_CANNON_MUZZLE_MS),
      projectileMass: RAID_CANNON_MASS_KG,
      tracking: 1.2,
      shieldPiercing: 0.15,
      armourPiercing: 0.25,
      spread: 0.05,
    },
  },
  // --- Defence: thin scrap armour, a scrambler, a light shield ---
  {
    id: "cor-scrambler",
    faction: "Corsair",
    name: "ECM Scrambler",
    description: "Jams incoming guided fire, stripping missile tracking and occasionally breaking lock entirely. The Reavers' answer to being shot back at.",
    category: "defence",
    mass: moduleMass("shield"),
    cost: 80,
    // An active jammer draws sensor-class electronics power.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "ecm",
      trackingReduction: 0.6,
      lockBreakChance: 0.15,
    },
  },
  {
    id: "cor-raider-shield",
    faction: "Corsair",
    name: "Raider Screen",
    description: "A small, light shield generator — just enough to survive the opening exchange before the missiles land.",
    category: "defence",
    mass: moduleMass("shield"),
    cost: 55,
    // A shield's draw IS its recharge wattage.
    powerDraw: SHIELD_RECHARGE_W.light,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.light,
      rechargeRate: SHIELD_RECHARGE_W.light,
      rechargeDelay: 70,
    },
  },
  // --- Propulsion: the most agile engines in the catalogue, plus afterburner + blink ---
  {
    id: "cor-raider-engine",
    faction: "Corsair",
    name: "Raid Drive",
    description: "A hot, over-tuned thruster. The best thrust and turn rate of any baseline engine — Reavers live on agility.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 45,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: raiderThrustN },
  },
  {
    id: "cor-afterburner",
    faction: "Corsair",
    name: "Afterburner",
    description: "Dumps fuel for a burst of thrust and turn when the raid demands closing or escaping. Reaver signature.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 70,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "afterburner",
      thrustBoost: 1.8,
      turnBoost: 1.5,
      duration: 50,
      cooldown: 150,
    },
  },
  {
    id: "cor-blink-drive",
    faction: "Corsair",
    name: "Raid Blink Drive",
    description: "A short-range blink to close on a target under cloak or break contact when the volley is spent. The centrepiece of a Reaver ambush.",
    category: "propulsion",
    mass: moduleMass("engine"),
    cost: 120,
    // A folding drive draws its power-conditioning load like a thruster.
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 1,
    techLevel: 3,
    effect: {
      kind: "blink",
      mode: "tactical",
      jumpRange: 260,
      cooldown: 70,
    },
  },
  // --- System: reactor, crew, magazine ---
  {
    id: "cor-reactor",
    faction: "Corsair",
    name: "Salvaged Reactor",
    description: "A patched-together power plant feeding the racks and drives; the ship's command node.",
    category: "system",
    mass: moduleMass("reactor"),
    cost: 75,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 1,
    effect: { kind: "power", output: FUSION_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "cor-crew-quarters",
    faction: "Corsair",
    name: "Reaver Quarters",
    description: "Cramped berths for a small raiding crew.",
    category: "crew",
    mass: moduleMass("crew"),
    cost: 28,
    powerDraw: MODULE_POWER_DRAW_W.crew,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "crew", capacity: 6 },
  },
  {
    id: "cor-magazine",
    faction: "Corsair",
    name: "Missile Magazine",
    description: "Stores missile munitions. Reavers carry finite volleys — a magazine extends a raid before the racks run dry.",
    category: "system",
    mass: moduleMass("magazine"),
    cost: 50,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "magazine", ammoStored: 280 },
  },
  // --- Stealth + signature tech: the ambush kit ---
  {
    id: "cor-cloak",
    faction: "Corsair",
    name: "Raid Cloak",
    description: "Hides the ship from enemy acquisition while it closes — until it fires. The opening move of every Reaver ambush.",
    category: "system",
    mass: moduleMass("shield"),
    cost: 95,
    // An active stealth field draws sensor-class electronics power.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "cloak",
      decloakTicks: 35,
    },
  },
  {
    id: "cor-signature-damper",
    faction: "Corsair",
    name: "Emission Dampener",
    description: "Shrinks the range at which enemies can detect the ship, complementing the cloak on the approach.",
    category: "system",
    mass: moduleMass("sensor"),
    cost: 55,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "signature",
      acquisitionMultiplier: 0.55,
    },
  },
  // --- Boarding + mines: the ambush payoff ---
  {
    id: "cor-boarding-pod",
    faction: "Corsair",
    name: "Boarding Pod Launcher",
    description: "Fires pods of Reaver marines that home in and disable a target's systems on contact. The brutal payoff of a successful ambush.",
    category: "weapon",
    mass: moduleMass("mediumWeapon"),
    cost: 105,
    // A pod launcher draws its handling/launch load, like an ordnance launcher.
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 1,
    techLevel: 3,
    effect: {
      kind: "boarding",
      podCount: 2,
      troops: 2,
      range: 360,
      cooldown: 220,
    },
  },
  {
    id: "cor-mine-layer",
    faction: "Corsair",
    name: "Raid Mine Layer",
    description: "Drops a small minefield across a withdrawal lane, punishing anything that pursues a fleeing raider.",
    category: "weapon",
    mass: moduleMass("mediumWeapon"),
    cost: 80,
    // A mine layer draws its handling/arming load, like an ordnance launcher.
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "mineLayer",
      mineCount: 3,
      mineDamage: 55,
      mineRadius: 60,
      layCooldown: 200,
      armingDelay: 15,
    },
  },
  {
    id: "cor-decoy-launcher",
    faction: "Corsair",
    name: "Holo Decoy Launcher",
    description: "Spits out holographic duplicates that soak up defensive fire while the real raiders strike. A Reaver's escape hatch when the ambush goes sideways.",
    category: "defence",
    mass: moduleMass("shield"),
    cost: 75,
    // A decoy projector draws sensor-class electronics power.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "decoy",
      decoyCount: 4,
      duration: 200,
      cooldown: 260,
      decoyHp: 45,
    },
  },
];
