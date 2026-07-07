import type { ModuleDefinitionInput } from "@/schema/module";
import {
  crewMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  magazineMass,
  reactorMass,
  deflectorMass,
} from "../physics";
import {
  ANTIMATTER_POWER_DENSITY_W_PER_M3,
  FUSION_POWER_DENSITY_W_PER_M3,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  ORDNANCE_BURN_TIME_S,
  PROJECTILE_MASS_KG,
  RELOAD_THERMAL_TIME_S,
  TORPEDO_RANGE_M,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";
import { poweredMotorBurnTicks, poweredMotorThrustMPerS2 } from "../ordnance-motor";

// ---------------------------------------------------------------------------
// Foundry Combine modules — furnace-forged war machines.
//
// Every module's mass is DERIVED from its capability via the physics-layer
// mass functions in `../physics.ts`:
//
//  - kinetic weapon mass  = `kineticWeaponMass(projectileMass, muzzleVelocity,
//    density)` from the round's muzzle kinetic energy (½·m·v²);
//  - reactor mass        = `reactorMass(output, powerDensity, density)` from
//    electrical output and the core's volumetric power density;
//  - engine mass         = `engineMass(thrust, density)` from rated thrust;
//  - magazine mass       = `magazineMass(ammoStored, density)` from stored round
//    count;
//  - crew mass           = `crewMass(capacity, density)` from berth count.
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
// Foundry material densities (kg/m³).
//
// Foundry modules are forged composite — tungsten-rich alloy, the densest in
// the catalogue. Each module category gets a representative density so its
// installed mass is proportional to its mechanism volume.
// ---------------------------------------------------------------------------

/** Kinetic weapon mechanism density (kg/m³): forged turret + barrel + cooling. */
export const WEAPON_DENSITY = 6000;
/** Reactor core + shielding density (kg/m³): forged composite pressure vessel. */
export const REACTOR_DENSITY = 6000;
/** Engine density (kg/m³): heavy nozzle + power conditioning. */
export const ENGINE_DENSITY = 4500;
/** Crew quarters density (kg/m³): spartan habitation, mostly air. */
export const CREW_DENSITY = 3500;
/** Magazine density (kg/m³): dense ordnance stores in forged bays. */
export const MAGAZINE_DENSITY = 6500;

// ---------------------------------------------------------------------------
// Weapon damage, range, cooldown and projectile speed are DERIVED from the
// combat-scale anchors (`../combat-scale.ts`):
//  - kinetic `damage`  = ½·m·v² via `kineticDamageJoules`
//  - kinetic `range`   = `kineticRangeM(muzzleVelocity)` (v × MAX_TOF_S)
//  - torpedo `range`   = `TORPEDO_RANGE_M` (cruise Δv × motor burn time)
//  - `projectileSpeed` = `projectileSpeedMPerTick(muzzleVelocity)` (m/s → m/tick)
//  - `cooldown`        = `cooldownTicks(reloadSeconds)` (seconds × TPS)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Kinetic-weapon local anchors.
//
// Each Foundry kinetic weapon picks a (projectileMass, muzzleVelocity) pairing
// from the broadened `PROJECTILE_MASS_KG` / `MUZZLE_VELOCITY_M_PER_S` menus
// in `combat-scale.ts`, then its mass, damage, range, projectile speed, and
// cooldown are all DERIVED from those two numbers — never hand-tuned.
// Foundry favours heavy kinetics: PD → gauss → driver spanning the whole menu.
// ---------------------------------------------------------------------------

/** Foundry autocannon round: a frigate-class rotary slug (`heavyAutocannon`
 *  banding). The Foundry workhorse — heavier and slower than a PD mount. */
const AUTOCANNON_MASS_KG = PROJECTILE_MASS_KG.heavyAutocannon;
const AUTOCANNON_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.heavyAutocannon;
/** Foundry gauss cannon round: a mid-band coilgun (`gauss` banding) — the
 *  heaviest Foundry cannon, between autocannon and driver. */
const GAUSS_MASS_KG = PROJECTILE_MASS_KG.gauss;
const GAUSS_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.gauss;

// ---------------------------------------------------------------------------
// Siege-plasma and torpedo ordnance anchors.
//
// The Foundry's siege ordnance are capital-class launchers. Siege plasma is a
// slow lobbed bolt; the torpedo is a short-legged armour-cracker. Both use
// the heaviest projectile bands.
// ---------------------------------------------------------------------------

/** Foundry siege-plasma bolt body mass (kg) — DERIVED from a capital-class
 *  round (`driver` banding): a heavy magnetically-bottled plasma slug. */
const SIEGE_PLASMA_MASS_KG = PROJECTILE_MASS_KG.driver;
/** Siege-plasma muzzle velocity (m/s) — DERIVED as a fraction of a mass-driver
 *  velocity: a lobbed plasma bolt is slow. */
const SIEGE_PLASMA_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.driver / 5;
/** Foundry siege-plasma warhead yield (J) — authored catalogue content: a
 *  capital matter-plasma bolt, ~GJ, the Foundry's signature alpha strike.
 *  Re-exported so the multi-cell capital variants in `foundry-capital.ts` can
 *  gang multiples of the same warhead without re-authoring the band. */
export const SIEGE_PLASMA_WARHEAD_J = 1.8e9;
/** Foundry torpedo body mass (kg) — DERIVED from a capital-class round
 *  (`driver` banding): a heavy armour-cracking torpedo. */
const TORPEDO_MASS_KG = PROJECTILE_MASS_KG.driver;
/** Torpedo cruise velocity (m/s) — DERIVED as a fraction of a mass-driver
 *  velocity: a heavy torpedo is the slowest round in flight. */
const TORPEDO_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.driver / 8;
/** Foundry torpedo warhead yield (J) — authored catalogue content: a heavy
 *  armour-cracking warhead, ~GJ. Re-exported for the multi-cell capital
 *  torpedo bank in `foundry-capital.ts`. */
export const TORPEDO_WARHEAD_J = 1.2e9;
/**
 * Foundry torpedo finite-burn motor — DERIVED from `ORDNANCE_BURN_TIME_S.torpedo`
 * (the short heavy-burn band). For a Foundry torpedo (cruise 1250 m/s, 8 s
 * burn): thrust ≈ 93.75 m/s², burn 240 ticks.
 */
const TORPEDO_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  TORPEDO_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.torpedo,
);
const TORPEDO_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.torpedo);

// ---------------------------------------------------------------------------
// Reactor output targets and their derived masses.
//
// A reactor's mass is `reactorMass(output, powerDensity, density) = density ×
// (output / powerDensity)`. A denser core is proportionally smaller and
// lighter for the same output — by physics, not by a size class.
// Foundry reactors are big, dense, and powerful — the best in the catalogue.
// ---------------------------------------------------------------------------

/** Standard fusion reactor output target (~1.5 GW) — the legacy frigate band.
 *  Re-exported so the plus-section forge core in `foundry-capital.ts` can
 *  anchor at 5× this band. */
export const REACTOR_FUSION_OUTPUT_W = 1.5e9;
/** Standard antimatter reactor output target (~5 GW) — a capital core feeding
 *  a capital lance and multiple repair bays. */
const REACTOR_ANTIMATTER_OUTPUT_W = 5e9;

// ---------------------------------------------------------------------------
// Propulsion: Foundry thermal drives, deliberately slow.
// ---------------------------------------------------------------------------

const thermalThrustN = driveThrustNewtons("thermal");
/** Re-exported so the twin grav drive in `foundry-capital.ts` can anchor at
 *  2× this band. */
export const HEAVY_PLASMA_DRIVE_THRUST_N = driveThrustNewtons("heavyPlasma");

// ---------------------------------------------------------------------------
// Foundry Combine modules — 13 entries, capability-derived.
//
// The module list preserves the legacy id, name, role, and category of each
// entry; ONLY the capability values and the mass derivation change. Mass now
// traces to the module's actual capability via the physics-layer functions
// (`kineticWeaponMass`, `reactorMass`, `engineMass`,
// `magazineMass`, `crewMass`).
//
// To span a realistic fighter→capital range while keeping 13 modules, the
// capability values of several entries have been re-anchored to the
// broadened menus in `combat-scale.ts` (a heavy autocannon at 5 km/s, a
// gauss cannon at 9.5 km/s, an advanced antimatter core at 5 GW, a heavy
// plasma drive at 160 kN) — so a fighter autocannon and a capital driver
// no longer converge on a single "mediumWeapon" band, and mass scales with
// capability across the whole span.
// ---------------------------------------------------------------------------

export const foundryModules: ModuleDefinitionInput[] = [
  // --- Weapons: slow, heavy, armour-piercing ---
  {
    id: "fnd-autocannon",
    faction: "Foundry",
    name: "Autocannon",
    description: "Reliable rotary cannon. Moderate damage and armour-pierce on a brisk refire; the workhorse of a Foundry broadside.",
    category: "weapon",
    // Foundry autocannon: heavyAutocannon band (3 kg @ 5 km/s). Mass derived
    // from muzzle energy at the dense forged-composite weapon density.
    // muzzleEnergy = ½·3·5000² = 37.5 MJ; mass = 6000 × (37.5e6 / 2e7)
    // = 11,250 kg (~11 t).
    mass: kineticWeaponMass(
      AUTOCANNON_MASS_KG,
      AUTOCANNON_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 65,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(AUTOCANNON_MASS_KG, AUTOCANNON_MUZZLE_MS),
      range: kineticRangeM(AUTOCANNON_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.heavyAutocannon),
      projectileSpeed: projectileSpeedMPerTick(AUTOCANNON_MUZZLE_MS),
      projectileMass: AUTOCANNON_MASS_KG,
      tracking: 0.6,
      shieldPiercing: 0.1,
      armourPiercing: 0.4,
      spread: 0.04,
      // Ballistic slug: unpowered and unguided.
      powered: false,
      guided: false,
      // Finite magazine: `ammo` (start) AND `ammoCapacity` (crew top-up
      // ceiling) must both be set — omitting `ammo` leaves it at
      // DEFAULT_WEAPON_AMMO (effectively unlimited).
      ammo: 200,
      ammoCapacity: 200,
    },
  },
  {
    id: "fnd-heavy-cannon",
    faction: "Foundry",
    name: "Heavy Cannon",
    description: "A massive kinetic gun on a traversing mount. High per-hit damage and strong armour-penetration, slow to reload.",
    category: "weapon",
    // Foundry gauss cannon: gauss band (20 kg @ 9.5 km/s). Mass derived from
    // muzzle energy at the dense forged-composite weapon density.
    // muzzleEnergy = ½·20·9500² = 902.5 MJ; mass = 6000 × (902.5e6 / 2e7)
    // = 270,750 kg (~271 t).
    mass: kineticWeaponMass(GAUSS_MASS_KG, GAUSS_MUZZLE_MS, WEAPON_DENSITY),
    cost: 130,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 2,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(GAUSS_MASS_KG, GAUSS_MUZZLE_MS),
      range: kineticRangeM(GAUSS_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.gauss),
      projectileSpeed: projectileSpeedMPerTick(GAUSS_MUZZLE_MS),
      projectileMass: GAUSS_MASS_KG,
      tracking: 0.4,
      shieldPiercing: 0.15,
      armourPiercing: 0.6,
      spread: 0.03,
      turretArc: Math.PI / 3,
      turretTurnRate: 0.04,
      // Ballistic slug: unpowered and unguided.
      powered: false,
      guided: false,
      // Finite magazine: `ammo` (start) AND `ammoCapacity` (crew top-up
      // ceiling) must both be set — omitting `ammo` leaves it at
      // DEFAULT_WEAPON_AMMO (effectively unlimited).
      ammo: 120,
      ammoCapacity: 120,
    },
  },
  {
    id: "fnd-siege-plasma",
    faction: "Foundry",
    name: "Siege Plasma Mortar",
    description: "Lobs a slow, devastating plasma bolt that melts through armour. The Foundry's signature capital weapon — short-ranged but brutal up close.",
    category: "weapon",
    // Foundry siege plasma: driver-class bolt body (50 kg @ 2 km/s lob).
    // Mass derived from muzzle energy at the dense forged-composite weapon
    // density. muzzleEnergy = ½·50·2000² = 100 MJ; mass =
    // 6000 × (100e6 / 2e7) = 30,000 kg (~30 t).
    mass: kineticWeaponMass(
      SIEGE_PLASMA_MASS_KG,
      SIEGE_PLASMA_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 220,
    // A plasma mortar generates and contains its bolt with grid power, like a
    // kinetic launcher's capacitor.
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 3,
    techLevel: 3,
    effect: {
      kind: "weapon",
      weaponType: "plasma",
      damage: SIEGE_PLASMA_WARHEAD_J,
      range: kineticRangeM(SIEGE_PLASMA_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.driver),
      projectileSpeed: projectileSpeedMPerTick(SIEGE_PLASMA_MUZZLE_MS),
      projectileMass: SIEGE_PLASMA_MASS_KG,
      tracking: 0.3,
      shieldPiercing: 0.2,
      armourPiercing: 0.7,
      spread: 0.06,
      // Self-luminous hot bolt: unpowered and unguided. Its glow is a renderer
      // effect on the hot bolt, not a motor plume.
      powered: false,
      guided: false,
      // Retuned 40 -> 80 and `ammo` set full, so a crew haul
      // (SIM.ammoRunAmount = 60) dispatches before the mortar is bone-dry.
      ammo: 80,
      ammoCapacity: 80,
    },
  },
  {
    id: "fnd-torpedo-tube",
    faction: "Foundry",
    name: "Armour-Cracking Torpedo",
    description: "A heavy torpedo built to punch through plate. Long range and excellent armour-penetration, but point defences can shoot it down.",
    category: "weapon",
    // Foundry torpedo: driver-class body (50 kg @ 1.25 km/s cruise). Mass
    // derived from the torpedo body's kinetic-energy-equivalent at the dense
    // forged-composite weapon density (a torpedo's mass is dominated by its
    // armour and warhead, not its motor).
    // muzzleEnergy-equivalent = ½·50·1250² ≈ 39 MJ; mass =
    // 6000 × (39e6 / 2e7) = 11,719 kg (~12 t).
    mass: kineticWeaponMass(
      TORPEDO_MASS_KG,
      TORPEDO_CRUISE_MS,
      WEAPON_DENSITY,
    ),
    cost: 150,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "torpedo",
      damage: TORPEDO_WARHEAD_J,
      range: TORPEDO_RANGE_M,
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.torpedo),
      projectileSpeed: projectileSpeedMPerTick(TORPEDO_CRUISE_MS),
      projectileMass: TORPEDO_MASS_KG,
      tracking: 0.8,
      shieldPiercing: 0.25,
      armourPiercing: 0.65,
      spread: 0.05,
      // Powered guided ordnance: a heavy short-burn motor sprinting to cruise.
      powered: true,
      guided: true,
      thrust: TORPEDO_THRUST_M_PER_S2,
      burnTicks: TORPEDO_BURN_TICKS,
      // Retuned 30 -> 80 and `ammo` set full, so a crew haul
      // (SIM.ammoRunAmount = 60) dispatches before the tube is bone-dry.
      ammo: 80,
      ammoCapacity: 80,
    },
  },
  // --- Defence: reactive + bulk armour, repair, flak — NO shields ---
  {
    id: "fnd-repair-bay",
    faction: "Foundry",
    name: "Damage Control Bay",
    description: "Robotic welders that knit destroyed plating back together each tick, keeping a Foundry ship in a slugging match long after others would fold.",
    category: "defence",
    // Foundry repair bay: a dense forged-composite mechanism. Mass derived
    // from a representative repair-bay capability (a few cubic metres of
    // robotic welders + spares at the dense weapon density).
    // Volume ≈ 12 m³; mass = 6000 × 12 ≈ 72,000 kg (~72 t).
    mass: 72_000,
    cost: 95,
    // A repair bay draws a small housekeeping load, like a sensor array.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "repair",
      repairRate: 6,
    },
  },
  {
    id: "fnd-flak-battery",
    faction: "Foundry",
    name: "Flak Battery",
    description: "With no shields to hide behind, the Foundry screens itself with flak that shreds incoming missiles and torpedoes.",
    category: "defence",
    // Foundry flak battery: a dense PD turret mechanism. Mass derived from
    // a representative flak turret volume at the dense weapon density.
    // Volume ≈ 8 m³; mass = 6000 × 8 ≈ 48,000 kg (~48 t).
    mass: 48_000,
    cost: 85,
    powerDraw: MODULE_POWER_DRAW_W.pointDefense,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "pointDefense",
      damage: 14,
      range: 110,
      cooldown: 8,
      hitChance: 0.45,
      tracking: 1.8,
    },
    pointDefense: true,
  },
  {
    id: "fnd-bulwark-deflector",
    faction: "Foundry",
    name: "Bulwark Deflector",
    description: "A heavy forged momentum screen. The Foundry's answer to mass-driver rounds — arrests kinetic strikes that would punch through bulk armour.",
    category: "defence",
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.heavy),
    cost: 130,
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy,
    crewRequired: 1,
    techLevel: 3,
    effect: { kind: "deflector", capacity: DEFLECTOR_CAPACITY_KG_MPS.heavy, rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy, rechargeDelay: 140 },
  },
  // --- Propulsion: deliberately slow ---
  {
    id: "fnd-thruster",
    faction: "Foundry",
    name: "Industrial Thruster",
    description: "A heavy-duty drive that can barely shift a Foundry slab. The Combine accepts being slow in exchange for being unkillable.",
    category: "propulsion",
    // Foundry thermal drive: 60 kN thrust. Mass derived from thrust at the
    // dense forged-composite engine density.
    // mass = 4500 × (60000 / 5000) = 54,000 kg (~54 t).
    mass: engineMass(thermalThrustN, ENGINE_DENSITY),
    cost: 35,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: thermalThrustN },
  },
  {
    id: "fnd-grav-drive",
    faction: "Foundry",
    name: "Gravimetric Drive",
    description: "A bigger drive for capitals. Still sluggish by any other faction's standard, but enough to bring a dreadnought into range.",
    category: "propulsion",
    // Foundry heavy plasma drive: 160 kN thrust. Mass derived from thrust at
    // the dense forged-composite engine density.
    // mass = 4500 × (160000 / 5000) = 144,000 kg (~144 t).
    mass: engineMass(HEAVY_PLASMA_DRIVE_THRUST_N, ENGINE_DENSITY),
    cost: 75,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "engine", thrust: HEAVY_PLASMA_DRIVE_THRUST_N },
  },
  // --- System: reactors, crew barracks, magazine ---
  {
    id: "fnd-reactor-mk1",
    faction: "Foundry",
    name: "Forge Reactor",
    description: "A rugged fission plant feeding the guns and repair bays; the ship's command node.",
    category: "system",
    // Foundry fusion reactor: 1.5 GW output at 5e7 W/m³ power density.
    // mass = 6000 × (1.5e9 / 5e7) = 180,000 kg (~180 t).
    mass: reactorMass(
      REACTOR_FUSION_OUTPUT_W,
      FUSION_POWER_DENSITY_W_PER_M3,
      REACTOR_DENSITY,
    ),
    cost: 85,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 1,
    effect: { kind: "power", output: REACTOR_FUSION_OUTPUT_W },
    command: true,
  },
  {
    id: "fnd-reactor-mk2",
    faction: "Foundry",
    name: "Industrial Core",
    description: "A capital power plant for dreadnoughts running siege plasma and multiple repair bays.",
    category: "system",
    // Foundry antimatter reactor: 5 GW output at 2e8 W/m³ power density.
    // mass = 6000 × (5e9 / 2e8) = 150,000 kg (~150 t).
    mass: reactorMass(
      REACTOR_ANTIMATTER_OUTPUT_W,
      ANTIMATTER_POWER_DENSITY_W_PER_M3,
      REACTOR_DENSITY,
    ),
    cost: 190,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 3,
    effect: { kind: "power", output: REACTOR_ANTIMATTER_OUTPUT_W },
    command: true,
  },
  {
    id: "fnd-crew-barracks",
    faction: "Foundry",
    name: "Crew Barracks",
    description: "Spartan habitation. Foundry ships are designed to be hardwired so a small crew can run a capital, but some hands are still needed.",
    category: "crew",
    // Foundry crew barracks: 6 berths at 12 m³/berth. Mass derived from
    // berth capacity at the spartan crew density.
    // mass = 3500 × (6 × 12) = 252,000 kg (~252 t).
    mass: crewMass(6, CREW_DENSITY),
    cost: 30,
    powerDraw: MODULE_POWER_DRAW_W.crew,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "crew", capacity: 6 },
  },
  {
    id: "fnd-magazine",
    faction: "Foundry",
    name: "Shell Magazine",
    description: "Stores heavy munitions for the cannons, mortars and torpedo tubes. Crew haul shells to the guns.",
    category: "system",
    // Foundry magazine: 400 rounds at 30 rounds/m³. Mass derived from
    // stored round count at the dense forged-composite magazine density.
    // volume = 400 / 30 ≈ 13.3 m³; mass = 6500 × 13.3 ≈ 86,667 kg (~87 t).
    mass: magazineMass(400, MAGAZINE_DENSITY),
    cost: 50,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "magazine", ammoStored: 400 },
  },
  // --- Area denial: the mine layer ---
  {
    id: "fnd-mine-layer",
    faction: "Foundry",
    name: "Proximity Mine Layer",
    description: "Drops armed minefields to deny approach. Pairs with the Foundry's lack of mobility — let the enemy come to the mines.",
    category: "weapon",
    // Foundry mine layer: a dense forged-composite handling mechanism.
    // Volume ≈ 16 m³; mass = 6000 × 16 ≈ 96,000 kg (~96 t).
    mass: 96_000,
    cost: 110,
    // A mine layer draws its handling/arming load, like an ordnance launcher.
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 1,
    techLevel: 2,
    effect: {
      kind: "mineLayer",
      mineCount: 4,
      mineDamage: 70,
      mineRadius: 70,
      layCooldown: 240,
      armingDelay: 20,
    },
  },
];
