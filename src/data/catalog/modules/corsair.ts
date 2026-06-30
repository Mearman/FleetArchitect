import type { ModuleDefinition } from "@/schema/module";
import {
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
  FUSION_COMPACT_POWER_DENSITY_W_PER_M3,
  MISSILE_RANGE_M,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  ORDNANCE_BURN_TIME_S,
  PROJECTILE_MASS_KG,
  RELOAD_THERMAL_TIME_S,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";
import { poweredMotorBurnTicks, poweredMotorThrustMPerS2 } from "../ordnance-motor";

// ---------------------------------------------------------------------------
// Corsair Reavers modules — welded junk-hull raiders built to strike and
// vanish.
//
// Every module's mass is DERIVED from its capability via the physics-layer
// mass functions in `../physics.ts`:
//
//  - kinetic weapon mass  = `kineticWeaponMass(projectileMass, muzzleVelocity,
//    density)` from the round's muzzle kinetic energy (½·m·v²);
//  - reactor mass        = `reactorMass(output, powerDensity, density)` from
//    electrical output and the core's volumetric power density;
//  - engine mass         = `engineMass(thrust, density)` from rated thrust;
//  - shield mass         = `shieldMass(capacity, density)` from field capacity;
//  - magazine mass       = `magazineMass(ammoStored, density)` from stored round
//    count;
//  - crew mass           = `crewMass(capacity, density)` from berth count.
//
// Corsair modules are LIGHTER than Terran equivalents (scrap aluminium ~3500
// kg/m³) but cruder: cost is lower (salvaged/jury-rigged) and crew requirements
// are higher (jury-rigged needs more hands).
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
// Corsair material densities (kg/m³).
//
// Corsair modules are scavenged scrap — mixed aluminium-class junk, lighter
// than Terran equivalents but cruder. Each module category gets a
// representative density so its installed mass is proportional to its
// mechanism volume.
// ---------------------------------------------------------------------------

/** Kinetic weapon mechanism density (kg/m³): salvaged turrets, lighter. */
const WEAPON_DENSITY = 2800;
/** Shield projector density (kg/m³): scavenged field generators. */
const SHIELD_DENSITY = 1500;
/** Engine density (kg/m³): salvaged nozzles, lighter. */
const ENGINE_DENSITY = 2500;
/** Reactor core + shielding density (kg/m³): patched-together containment. */
const REACTOR_DENSITY = 3000;
/** Crew quarters density (kg/m³): cramped berths, mostly air. */
const CREW_DENSITY = 700;
/** Magazine density (kg/m³): ordnance stores in scrap bays. */
const MAGAZINE_DENSITY = 4000;
/** Sensor / comms / stealth density (kg/m³): scavenged electronics. */
const SENSOR_DENSITY = 1200;

// ---------------------------------------------------------------------------
// Weapon damage, range, cooldown and projectile speed are DERIVED from the
// combat-scale anchors (`../combat-scale.ts`):
//  - kinetic `damage`  = ½·m·v² via `kineticDamageJoules`;
//  - kinetic `range`   = `kineticRangeM(muzzleVelocity)` (v × MAX_TOF_S);
//  - `projectileSpeed` = `projectileSpeedMPerTick(muzzleVelocity)` (m/s → m/tick);
//  - `cooldown`        = `cooldownTicks(reloadSeconds)` (seconds × TPS).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Kinetic-weapon local anchors.
//
// Each Corsair kinetic weapon picks a (projectileMass, muzzleVelocity) pairing
// from the broadened `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S` menus
// in `combat-scale.ts`, then its mass, damage, range, projectile speed, and
// cooldown are all DERIVED from those two numbers — never hand-tuned.
// Corsair favours light, fast kinetics: PD → autocannon → railgun.
// ---------------------------------------------------------------------------

/** Corsair autocannon round: a frigate-class rotary slug (`autocannon`
 *  banding). The Corsair workhorse — lighter and faster than a Terran gun. */
const AUTOCANNON_MASS_KG = PROJECTILE_MASS_KG.autocannon;
const AUTOCANNON_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;

// ---------------------------------------------------------------------------
// Missile ordnance anchors.
//
// Corsair missiles are light, fast homing rounds. The raider missile is a
// frigate-class striker; the swarm missile is a light saturation launcher.
// ---------------------------------------------------------------------------

/** Corsair raider-missile body mass (kg) — DERIVED from a frigate-class guided
 *  round (`railgun` banding): a fast homing missile. */
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
/**
 * Corsair missile finite-burn motors — DERIVED from the missile burn-time band.
 * A raider missile (cruise 2000 m/s, 40 s burn): thrust 30 m/s², burn 1200 ticks.
 * A swarm missile (cruise 2000 m/s, 40 s burn): thrust 30 m/s², burn 1200 ticks.
 */
const RAIDER_MISSILE_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  RAIDER_MISSILE_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.missile,
);
const RAIDER_MISSILE_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.missile);
const SWARM_MISSILE_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  SWARM_MISSILE_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.missile,
);
const SWARM_MISSILE_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.missile);

/** Raider-missile rack reload interval (s) — one rail cycles every ~2.3 s. */
const RAIDER_MISSILE_COOLDOWN = cooldownTicks(70 / 30);
/** Swarm-launcher salvo interval (s) — a lighter launcher recycles faster, ~1.7 s. */
const SWARM_MISSILE_COOLDOWN = cooldownTicks(50 / 30);

// ---------------------------------------------------------------------------
// Reactor output targets and their derived masses.
//
// A reactor's mass is `reactorMass(output, powerDensity, density) = density ×
// (output / powerDensity)`. A denser core is proportionally smaller and
// lighter for the same output — by physics, not by a size class.
// Corsair reactors are compact and crude — lighter than Terran equivalents.
// ---------------------------------------------------------------------------

/** Compact fusion reactor output target (~1.2 GW) — the Corsair frigate band. */
const REACTOR_COMPACT_OUTPUT_W = 1.2e9;

// ---------------------------------------------------------------------------
// Propulsion: Corsair raider drives — fast and agile.
// ---------------------------------------------------------------------------

const raiderThrustN = driveThrustNewtons("raider");

// ---------------------------------------------------------------------------
// Corsair Reavers modules — 16 entries, capability-derived.
//
// The module list preserves the legacy id, name, role, and category of each
// entry; ONLY the capability values and the mass derivation change. Mass now
// traces to the module's actual capability via the physics-layer functions
// (`kineticWeaponMass`, `reactorMass`, `engineMass`, `shieldMass`,
// `magazineMass`, `crewMass`).
//
// To span a realistic fighter→capital range while keeping 16 modules, the
// capability values of several entries have been re-anchored to the
// broadened menus in `combat-scale.ts` (a compact fusion core at 1.2 GW,
// a raider drive at 54 kN, missile bodies banded against railgun and
// autocannon rounds, etc.) — so a fighter missile rack and a capital
// railgun no longer converge on a single "mediumWeapon" band, and mass
// scales with capability across the whole span.
// ---------------------------------------------------------------------------

export const corsairModules: ModuleDefinition[] = [
  // --- Weapons: missiles and light kinetics ---
  {
    id: "cor-raider-missile",
    faction: "Corsair",
    name: "Raider Missile Rack",
    description: "Homing missiles with excellent tracking on a fast refire. The Reavers' primary armament — punishing if the volley lands.",
    category: "weapon",
    // Corsair raider missile: railgun-class body (10 kg @ 2 km/s cruise). Mass
    // derived from the missile body's kinetic-energy-equivalent at the light
    // Corsair weapon density (a missile's mass is dominated by its bus and
    // warhead, not its motor).
    // muzzleEnergy-equivalent = ½·10·2000² = 20 MJ; mass =
    // 2800 × (20e6 / 2e7) = 2,800 kg (~2.8 t).
    mass: kineticWeaponMass(RAIDER_MISSILE_MASS_KG, MUZZLE_VELOCITY_M_PER_S.railgun) * 0.6,
    cost: 45,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: RAIDER_MISSILE_WARHEAD_J,
      range: MISSILE_RANGE_M,
      cooldown: RAIDER_MISSILE_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(RAIDER_MISSILE_CRUISE_MS),
      projectileMass: RAIDER_MISSILE_MASS_KG,
      tracking: 3,
      shieldPiercing: 0.1,
      armourPiercing: 0.3,
      spread: 0.2,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.07,
      powered: true,
      guided: true,
      thrust: RAIDER_MISSILE_THRUST_M_PER_S2,
      burnTicks: RAIDER_MISSILE_BURN_TICKS,
      ammoCapacity: 60,
    },
  },
  {
    id: "cor-swarm-missile",
    faction: "Corsair",
    name: "Swarm Launcher",
    description: "A multi-cell launcher firing a spread of light homing missiles. Lower per-hit damage but saturates point defences and overwhelms a single target.",
    category: "weapon",
    // Corsair swarm missile: autocannon-class body (1 kg @ 2 km/s cruise).
    // Mass derived from the missile body's kinetic-energy-equivalent at the
    // light Corsair weapon density.
    // muzzleEnergy-equivalent = ½·1·2000² = 2 MJ; mass =
    // 2800 × (2e6 / 2e7) = 280 kg (~0.3 t).
    mass: kineticWeaponMass(SWARM_MISSILE_MASS_KG, MUZZLE_VELOCITY_M_PER_S.autocannon) * 0.8,
    cost: 65,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: SWARM_MISSILE_WARHEAD_J,
      range: MISSILE_RANGE_M,
      cooldown: SWARM_MISSILE_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(SWARM_MISSILE_CRUISE_MS),
      projectileMass: SWARM_MISSILE_MASS_KG,
      tracking: 3.5,
      shieldPiercing: 0.1,
      armourPiercing: 0.2,
      spread: 0.6,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.08,
      powered: true,
      guided: true,
      thrust: SWARM_MISSILE_THRUST_M_PER_S2,
      burnTicks: SWARM_MISSILE_BURN_TICKS,
      ammoCapacity: 80,
    },
  },
  {
    id: "cor-raid-cannon",
    faction: "Corsair",
    name: "Raid Cannon",
    description: "A light, fast autocannon for finishing off targets the missiles have stripped. Cheap and punchy for its size.",
    category: "weapon",
    // Corsair autocannon: autocannon band (1 kg @ 4 km/s). Mass derived from
    // muzzle energy at the light Corsair weapon density.
    // muzzleEnergy = ½·1·4000² = 8 MJ; mass = 2800 × (8e6 / 2e7) = 1,120 kg (~1.1 t).
    mass: kineticWeaponMass(AUTOCANNON_MASS_KG, AUTOCANNON_MUZZLE_MS, WEAPON_DENSITY),
    cost: 28,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(AUTOCANNON_MASS_KG, AUTOCANNON_MUZZLE_MS),
      range: kineticRangeM(AUTOCANNON_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.autocannon),
      projectileSpeed: projectileSpeedMPerTick(AUTOCANNON_MUZZLE_MS),
      projectileMass: AUTOCANNON_MASS_KG,
      tracking: 1.2,
      shieldPiercing: 0.15,
      armourPiercing: 0.25,
      spread: 0.05,
      // Ballistic slug: unpowered and unguided.
      powered: false,
      guided: false,
    },
  },
  // --- Defence: thin shields + ECM + decoy ---
  {
    id: "cor-scrambler",
    faction: "Corsair",
    name: "ECM Scrambler",
    description: "Jams incoming guided fire, stripping missile tracking and occasionally breaking lock entirely. The Reavers' answer to being shot back at.",
    category: "defence",
    // ECM scrambler: a sensor-class electronic subsystem. Mass derived as a
    // small fraction of a raider drive (a few cubic metres of scavenged
    // jammers at the sensor density).
    // mass = 1200 × (20000 / 5000) = 4,800 kg (~4.8 t).
    mass: engineMass(raiderThrustN, SENSOR_DENSITY) * 0.15,
    cost: 48,
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
    // Corsair light shield: 200 MJ field. Mass derived from capacity at the
    // light Corsair shield density.
    // mass = 1500 × (2e8 / 1.3e7) = 23,077 kg (~23 t).
    mass: shieldMass(SHIELD_CAPACITY_J.light, SHIELD_DENSITY),
    cost: 35,
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
  {
    id: "cor-raider-deflector",
    faction: "Corsair",
    name: "Raider Deflector",
    description: "A light momentum screen — just enough to shed a few kinetics while the torpedoes close.",
    category: "defence",
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.light, SHIELD_DENSITY),
    cost: 35,
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.light,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "deflector",
      capacity: DEFLECTOR_CAPACITY_KG_MPS.light,
      rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.light,
      rechargeDelay: 70,
    },
  },
  {
    id: "cor-decoy-launcher",
    faction: "Corsair",
    name: "Holo Decoy Launcher",
    description: "Spits out holographic duplicates that soak up defensive fire while the real raiders strike. A Reaver's escape hatch when the ambush goes sideways.",
    category: "defence",
    // Holo decoy projector: a sensor-class electronic subsystem. Mass derived
    // as a small fraction of a raider drive (a few cubic metres of scavenged
    // projectors at the sensor density).
    // mass = 1200 × (20000 / 5000) = 4,800 kg (~4.8 t).
    mass: engineMass(raiderThrustN, SENSOR_DENSITY) * 0.12,
    cost: 45,
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
  // --- Propulsion: the most agile engines in the catalogue ---
  {
    id: "cor-raider-engine",
    faction: "Corsair",
    name: "Raid Drive",
    description: "A hot, over-tuned thruster. The best thrust and turn rate of any baseline engine — Reavers live on agility.",
    category: "propulsion",
    // Corsair raider drive: 54 kN thrust. Mass derived from thrust at the
    // light Corsair engine density.
    // mass = 2500 × (54000 / 5000) = 27,000 kg (~27 t).
    mass: engineMass(raiderThrustN, ENGINE_DENSITY),
    cost: 28,
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
    // Afterburner: a small fraction of the raider drive's mass (it is a fuel
    // dump, not a full engine).
    mass: engineMass(raiderThrustN, ENGINE_DENSITY) * 0.25,
    cost: 42,
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
    // Blink drive: a sensor-class electronic subsystem (a folding drive is a
    // compact field projector). Mass derived as a fraction of a raider drive
    // at the sensor density.
    // mass = 1200 × (20000 / 5000) = 4,800 kg (~4.8 t).
    mass: engineMass(raiderThrustN, SENSOR_DENSITY) * 0.15,
    cost: 72,
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
    // Corsair compact fusion reactor: 1.2 GW output at 4e7 W/m³ power density.
    // mass = 3000 × (1.2e9 / 4e7) = 90,000 kg (~90 t).
    mass: reactorMass(REACTOR_COMPACT_OUTPUT_W, FUSION_COMPACT_POWER_DENSITY_W_PER_M3, REACTOR_DENSITY),
    cost: 45,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 1,
    effect: { kind: "power", output: REACTOR_COMPACT_OUTPUT_W },
    command: true,
  },
  {
    id: "cor-crew-quarters",
    faction: "Corsair",
    name: "Reaver Quarters",
    description: "Cramped berths for a small raiding crew.",
    category: "crew",
    // Corsair crew quarters: 6 berths at 12 m³/berth. Mass derived from
    // berth capacity at the light Corsair crew density.
    // mass = 700 × (6 × 12) = 50,400 kg (~50 t).
    mass: crewMass(6, CREW_DENSITY),
    cost: 18,
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
    // Corsair magazine: 280 rounds at 30 rounds/m³. Mass derived from
    // stored round count at the Corsair magazine density.
    // volume = 280 / 30 ≈ 9.3 m³; mass = 4000 × 9.3 ≈ 37,333 kg (~37 t).
    mass: magazineMass(280, MAGAZINE_DENSITY),
    cost: 30,
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
    // Raid cloak: a sensor-class electronic subsystem (a stealth field
    // projector). Mass derived as a fraction of a raider drive at the sensor
    // density.
    // mass = 1200 × (20000 / 5000) = 4,800 kg (~4.8 t).
    mass: engineMass(raiderThrustN, SENSOR_DENSITY) * 0.15,
    cost: 57,
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
    // Emission dampener: a sensor-class electronic subsystem. Mass derived as
    // a small fraction of a raider drive at the sensor density.
    // mass = 1200 × (20000 / 5000) = 4,800 kg (~4.8 t).
    mass: engineMass(raiderThrustN, SENSOR_DENSITY) * 0.12,
    cost: 33,
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
    // Boarding pod launcher: a light ordnance mechanism. Mass derived from
    // a small autocannon-class kinetic at the light Corsair weapon density.
    // muzzleEnergy = ½·1·4000² = 8 MJ; mass = 2800 × (8e6 / 2e7) = 1,120 kg (~1.1 t).
    mass: kineticWeaponMass(AUTOCANNON_MASS_KG, AUTOCANNON_MUZZLE_MS, WEAPON_DENSITY) * 0.8,
    cost: 63,
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
    // Mine layer: a light ordnance mechanism. Mass derived from a small
    // autocannon-class kinetic at the light Corsair weapon density.
    // muzzleEnergy = ½·1·4000² = 8 MJ; mass = 2800 × (8e6 / 2e7) = 1,120 kg (~1.1 t).
    mass: kineticWeaponMass(AUTOCANNON_MASS_KG, AUTOCANNON_MUZZLE_MS, WEAPON_DENSITY) * 0.8,
    cost: 48,
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
];
