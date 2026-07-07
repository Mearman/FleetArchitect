import type { ModuleDefinitionInput } from "@/schema/module";
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
  FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
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
export const WEAPON_DENSITY = 2800;
/** Shield projector density (kg/m³): scavenged field generators. */
export const SHIELD_DENSITY = 1500;
/** Engine density (kg/m³): salvaged nozzles, lighter. */
export const ENGINE_DENSITY = 2500;
/** Reactor core + shielding density (kg/m³): patched-together containment. */
export const REACTOR_DENSITY = 3000;
/** Crew quarters density (kg/m³): cramped berths, mostly air. */
export const CREW_DENSITY = 700;
/** Magazine density (kg/m³): ordnance stores in scrap bays. */
export const MAGAZINE_DENSITY = 4000;
/** Sensor / comms / stealth density (kg/m³): scavenged electronics. */
export const SENSOR_DENSITY = 1200;

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
export const SWARM_MISSILE_WARHEAD_J = 8e7;
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
// Broadside swarm-rack ordnance anchors.
//
// The broadside swarm rack is a twin-rail launcher throwing a heavier swarm
// missile perpendicular to the ship's heading. Its body sits one band above
// the swarm's 1 kg (the heavyAutocannon 3 kg) for a 120 MJ warhead, sharing
// the swarm's cruise and feed cadence.
// ---------------------------------------------------------------------------

/** Broadside missile body mass (kg) — DERIVED from a heavyAutocannon-class
 *  guided round (3 kg), a heavier broadside body than the swarm's 1 kg. */
const BROADSIDE_MISSILE_MASS_KG = PROJECTILE_MASS_KG.heavyAutocannon;
/** Broadside missile cruise velocity (m/s) — matches the swarm's autocannon/2
 *  band: a fast light missile compatible with the swarm rack's feed. */
const BROADSIDE_MISSILE_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon / 2;
/** Broadside swarm-rack warhead yield (J) — 6 GJ capital-class saturation
 *  warhead, between the swarm's 80 MJ and the raider's 300 MJ scaled to the
 *  twin-rail capital mount. */
const BROADSIDE_MISSILE_WARHEAD_J = 6e9;
/** Broadside missile finite-burn motor — DERIVED from the missile burn-time
 *  band (same cruise/burn as the swarm missile). */
const BROADSIDE_MISSILE_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  BROADSIDE_MISSILE_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.missile,
);
const BROADSIDE_MISSILE_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.missile);
/** Broadside swarm-rack salvo interval (s) — a twin-rail recycles at the
 *  swarm's ~1.7 s cadence. */
const BROADSIDE_MISSILE_COOLDOWN = cooldownTicks(50 / 30);

/** Heavy raid-cannon round mass (kg) — 50× the heavyAutocannon band (3 kg),
 *  a heavier capital-scale slug on the same fast heavy-autocannon muzzle.
 *  Local to this module so the shared `PROJECTILE_MASS_KG.heavyAutocannon`
 *  anchor is untouched; mass and damage re-derive from this anchor too. */
const HEAVY_RAID_MASS_KG = 50 * PROJECTILE_MASS_KG.heavyAutocannon;

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
/** Overdrive reactor output target (~2.4 GW) — 2× the salvaged single's 1.2 GW
 *  at the advanced-fusion density band, a hot-running dual-core command node. */
const REACTOR_OVERDRIVE_OUTPUT_W = 2.4e9;

// ---------------------------------------------------------------------------
// Propulsion: Corsair raider drives — fast and agile.
// ---------------------------------------------------------------------------

const raiderThrustN = driveThrustNewtons("raider");
/** Raid drive bank rated thrust (N) — twin raider drives, 2× the single's 54 kN
 *  at the same exhaust velocity and agility. */
const RAID_DRIVE_BANK_THRUST_N = 2 * raiderThrustN;

// ---------------------------------------------------------------------------
// Corsair Reavers modules — capability-derived.
//
// Each module's mass traces to its capability via the physics-layer functions
// (`kineticWeaponMass`, `reactorMass`, `engineMass`, `shieldMass`,
// `magazineMass`, `crewMass`). Capability anchors span a fighter→capital range
// via the broadened menus in `combat-scale.ts`, so mass scales with capability
// across the whole span.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capital multi-cell footprints — each a 1×2 line anchored at {0,0}. Preset
// designs import these to install matching `covers` back-pointers via
// `mountMultiCell` (`data/presets/tokens.ts`), so the catalogue and the design
// agree on each module's shape without re-authoring it.
// ---------------------------------------------------------------------------
const CORSAIR_LINE_2 = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
];
export const CORSAIR_FOOTPRINTS = {
  broadsideSwarmRack: CORSAIR_LINE_2,
  heavyRaidCannon: CORSAIR_LINE_2,
  scramblerArray: CORSAIR_LINE_2,
  raiderScreenArray: CORSAIR_LINE_2,
  raidDriveBank: CORSAIR_LINE_2,
  overdriveReactor: CORSAIR_LINE_2,
};

export const corsairModules: ModuleDefinitionInput[] = [
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
      // Capacity 60 -> 80 so a crew haul (SIM.ammoRunAmount = 60) dispatches
      // before the rack is bone-dry. `ammo` mirrors it (start full).
      ammo: 80,
      ammoCapacity: 80,
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
      ammo: 80,
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
  // --- Capital multi-cell variants (2-cell polyomino footprints) ---
  // Each occupies a 1×2 line; mass traces to the same physics helpers at a
  // heavier/doubled capability anchor. Preset designs import the matching
  // `CORSAIR_FOOTPRINTS` shape to install `covers` back-pointers.
  {
    id: "cor-broadside-swarm-rack",
    faction: "Corsair",
    name: "Broadside Swarm Rack",
    description: "A twin-rail broadside launcher throwing a heavy swarm of light missiles perpendicular to the ship's heading. The Reaver raid-strafe weapon — saturate a target's point defence on the pass, then break contact.",
    category: "weapon",
    // Twin-rail broadside launcher: heavier 3 kg body at the autocannon band
    // (the swarm's feed), 0.8 launcher fraction matching the swarm rack.
    // mass = 2800 × (½·3·4000² / 2e7) × 0.8 = 2,688 kg (~2.7 t).
    mass: kineticWeaponMass(BROADSIDE_MISSILE_MASS_KG, MUZZLE_VELOCITY_M_PER_S.autocannon, WEAPON_DENSITY) * 0.8,
    cost: 130,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 2,
    footprint: CORSAIR_FOOTPRINTS.broadsideSwarmRack,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: BROADSIDE_MISSILE_WARHEAD_J,
      range: MISSILE_RANGE_M,
      cooldown: BROADSIDE_MISSILE_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(BROADSIDE_MISSILE_CRUISE_MS),
      projectileMass: BROADSIDE_MISSILE_MASS_KG,
      tracking: 3.5,
      shieldPiercing: 0.1,
      armourPiercing: 0.3,
      spread: 0.6,
      // Broadside mount: narrow turret arc (π/3), slower turn rate (0.06).
      // The mount facing (π/2) is authored on the grid token.
      turretArc: Math.PI / 3,
      turretTurnRate: 0.06,
      powered: true,
      guided: true,
      thrust: BROADSIDE_MISSILE_THRUST_M_PER_S2,
      burnTicks: BROADSIDE_MISSILE_BURN_TICKS,
      ammo: 140,
      ammoCapacity: 140,
    },
  },
  {
    id: "cor-heavy-raid-cannon",
    faction: "Corsair",
    name: "Heavy Raid Cannon",
    description: "A two-cell heavy autocannon built from salvaged frigate guns. Heavier round, longer reach, harder hit than the raid cannon — for finishing what the missiles strip. Damage and mass scale together at the heavyAutocannon band.",
    category: "weapon",
    // 150 kg @ 5 km/s (50× the heavyAutocannon band, one band above the raid
    // cannon's 1 kg @ 4 km/s). Muzzle energy ½·150·5000² = 1.875 GJ; range
    // 5 km/s × 3 s = 15 km. mass = 2800 × (1.875e9 / 2e7) = 262,500 kg
    // (~263 t).
    mass: kineticWeaponMass(HEAVY_RAID_MASS_KG, MUZZLE_VELOCITY_M_PER_S.heavyAutocannon, WEAPON_DENSITY),
    cost: 70,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 2,
    techLevel: 2,
    footprint: CORSAIR_FOOTPRINTS.heavyRaidCannon,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(HEAVY_RAID_MASS_KG, MUZZLE_VELOCITY_M_PER_S.heavyAutocannon),
      range: kineticRangeM(MUZZLE_VELOCITY_M_PER_S.heavyAutocannon),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.heavyAutocannon),
      projectileSpeed: projectileSpeedMPerTick(MUZZLE_VELOCITY_M_PER_S.heavyAutocannon),
      projectileMass: HEAVY_RAID_MASS_KG,
      tracking: 1.0,
      shieldPiercing: 0.15,
      armourPiercing: 0.3,
      spread: 0.05,
      // Ballistic slug: unpowered and unguided, like the raid cannon.
      powered: false,
      guided: false,
    },
  },
  {
    id: "cor-scrambler-array",
    faction: "Corsair",
    name: "ECM Scrambler Array",
    description: "A two-cell jammer array with a wider aperture. Strips more tracking from incoming guided fire and breaks missile lock more often — the Reaver answer to a missile-heavy defender covering the target.",
    category: "defence",
    // Two-cell array: 2× the single scrambler's sensor-density jammer stack.
    // mass = 2 × (1200 × (54000 / 5000) × 0.15) = 3,888 kg (~3.9 t).
    mass: 2 * engineMass(raiderThrustN, SENSOR_DENSITY) * 0.15,
    cost: 95,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 2,
    techLevel: 2,
    footprint: CORSAIR_FOOTPRINTS.scramblerArray,
    effect: {
      kind: "ecm",
      trackingReduction: 0.75,
      lockBreakChance: 0.25,
    },
  },
  {
    id: "cor-raider-screen-array",
    faction: "Corsair",
    name: "Raider Screen Array",
    description: "A two-cell shield projector folding two screens into a frigate-grade bubble. Steps up to the medium shield band — enough front-loaded soak to survive the opening exchange of an ambush before the missiles land.",
    category: "defence",
    // Medium shield band (400 MJ, 2× the single's 200 MJ) at the Corsair shield
    // density. mass = 1500 × (4e8 / 1.3e7) = 46,154 kg (~46 t).
    mass: shieldMass(SHIELD_CAPACITY_J.medium, SHIELD_DENSITY),
    cost: 70,
    powerDraw: SHIELD_RECHARGE_W.medium,
    crewRequired: 0,
    techLevel: 2,
    footprint: CORSAIR_FOOTPRINTS.raiderScreenArray,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.medium,
      rechargeRate: SHIELD_RECHARGE_W.medium,
      rechargeDelay: 70,
    },
  },
  {
    id: "cor-raid-drive-bank",
    faction: "Corsair",
    name: "Raid Drive Bank",
    description: "A twin-nozzle raider drive bank. Double the thrust of the single raid drive at the same exhaust velocity and agility — for closing to missile range in a hurry or breaking contact when the volley is spent.",
    category: "propulsion",
    // Twin raider drives: 108 kN (2 × 54 kN) at the light Corsair engine
    // density. mass = 2500 × (108000 / 5000) = 54,000 kg (~54 t).
    mass: engineMass(RAID_DRIVE_BANK_THRUST_N, ENGINE_DENSITY),
    cost: 56,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 2,
    footprint: CORSAIR_FOOTPRINTS.raidDriveBank,
    effect: { kind: "engine", thrust: RAID_DRIVE_BANK_THRUST_N },
  },
  {
    id: "cor-overdrive-reactor",
    faction: "Corsair",
    name: "Overdrive Reactor",
    description: "A hot-running dual-core reactor pushing advanced-fusion density. More watts per kilogram than the salvaged single-core — the over-tuned power plant a blink-and-cloak raider needs to keep every system lit through the ambush. Serves as the ship's command node.",
    category: "system",
    // 2.4 GW @ 6e7 W/m³ (advanced-fusion density, 2× the single's 1.2 GW at a
    // denser core). mass = 3000 × (2.4e9 / 6e7) = 120,000 kg (~120 t).
    mass: reactorMass(REACTOR_OVERDRIVE_OUTPUT_W, FUSION_ADVANCED_POWER_DENSITY_W_PER_M3, REACTOR_DENSITY),
    cost: 110,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 3,
    footprint: CORSAIR_FOOTPRINTS.overdriveReactor,
    effect: { kind: "power", output: REACTOR_OVERDRIVE_OUTPUT_W },
    command: true,
  },
];

