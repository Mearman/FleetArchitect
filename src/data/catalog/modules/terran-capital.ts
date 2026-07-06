import type { ModuleDefinitionInput } from "@/schema/module";
import {
  beamWeaponMass,
  deflectorMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  moduleMass,
  reactorMass,
  shieldMass,
} from "../physics";
import {
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
  BEAM_POWER_W,
  BEAM_RANGE_M,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
  FUSION_REACTOR_OUTPUT_W,
  MISSILE_RANGE_M,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  ORDNANCE_BURN_TIME_S,
  PROJECTILE_MASS_KG,
  RELOAD_THERMAL_TIME_S,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  beamDamageJoules,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";
import { poweredMotorBurnTicks, poweredMotorThrustMPerS2 } from "../ordnance-motor";

// ---------------------------------------------------------------------------
// Terran capital multi-cell modules.
//
// The single-cell catalogue in `terran.ts` spans fighter → frigate → cruiser
// capability on one cell each. The modules here are the multi-cell capital
// variants: each occupies a polyomino footprint and re-anchors its capability
// at a multiple of the single-cell band (a 3.5 GW spinal lance, a 150 kg spinal
// driver round, a 360 kN capital drive, a 12 GW cross-section core, a 2.5 GJ
// bastion shield). Their mass still traces to the SAME physics-layer helpers
// (`beamWeaponMass`, `kineticWeaponMass`, `engineMass`, `reactorMass`,
// `shieldMass`, `deflectorMass`) applied to these heavier anchors, so a stronger
// capital module is proportionally heavier — by physics, not by a size class.
//
// Isolated from `terran.ts` so that file stays under the per-file max-lines
// guard (mirroring the `designs-terran.ts` / `designs.ts` split). The catalog
// index (`data/catalog/index.ts`) concatenates these onto `terranModules`;
// preset designs import `TERRAN_FOOTPRINTS` to install matching `covers`
// back-pointers via `coverFootprint` (`data/presets/tokens.ts`).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capital anchors.
//
// Each constant is a multiple of an existing single-cell band (3.5× the capital
// lance, 3× the driver round, 2× the railgun slug, 3× the plasma drive, etc.),
// so capability scales visibly across the fighter → capital span and mass
// follows from the physics helpers, never hand-tuned.
// ---------------------------------------------------------------------------

/** Spinal lance sustained beam power (W) — ~3.5× the capital lance band, the
 *  heaviest Terran energy weapon. A slow 6 s thermal cycle dumps a 21 GJ pulse
 *  (`beamDamageJoules(SPINAL_LANCE_POWER_W, SPINAL_LANCE_COOLDOWN)`). */
const SPINAL_LANCE_POWER_W = 3.5 * BEAM_POWER_W.lance;
/** Spinal lance thermal cycle (s) — a long emitter-recovery dwell between
 *  pulses. */
const SPINAL_LANCE_COOLDOWN = cooldownTicks(6);

/** Spinal mass driver round mass (kg) — 3× the capital driver round, a 150 kg
 *  tungsten dart. */
const SPINAL_DRIVER_MASS_KG = 3 * PROJECTILE_MASS_KG.driver;
/** Spinal mass driver muzzle velocity (m/s) — the driver band (10 km/s). */
const SPINAL_DRIVER_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.driver;
/** Spinal mass driver load cycle (s) — the super-driver band, the slowest
 *  kinetic refire. */
const SPINAL_DRIVER_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.superDriver);

/** Heavy railgun slug mass (kg) — 2× the railgun slug, a 20 kg dart. */
const HEAVY_RAIL_MASS_KG = 2 * PROJECTILE_MASS_KG.railgun;
/** Heavy railgun muzzle velocity (m/s) — the railgun band (8 km/s). */
const HEAVY_RAIL_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.railgun;
/** Heavy railgun capacitor-recharge interval (s) — the railgun band. */
const HEAVY_RAIL_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.railgun);

/** Capital plasma drive rated thrust (N) — 3× the plasma drive band. */
const CAPITAL_DRIVE_THRUST_N = 3 * driveThrustNewtons("plasma");

/** Cross-section antimatter core output target (~12 GW) — a capital command
 *  core at advanced antimatter density, feeding spinal lances and capital
 *  shields simultaneously. */
const CROSS_REACTOR_OUTPUT_W = 12e9;

/** Bastion shield capacity (J) — ~4× the heavy shield band, a 2.5 GJ capital
 *  projector block. */
const BASTION_SHIELD_CAPACITY_J = 2.5e9;
/** Bastion shield recharge (W) — the grid draw to rebuild a 2.5 GJ field. */
const BASTION_SHIELD_RECHARGE_W = 2.5e8;

/** Bulwark deflector capacity (kg·m/s) — 2× the heavy deflector band. */
const BULWARK_CAPACITY_KG_MPS = 2 * DEFLECTOR_CAPACITY_KG_MPS.heavy;
/** Bulwark deflector recharge (kg·m/s per s) — 2× the heavy deflector band. */
const BULWARK_RECHARGE_KG_MPS_PER_S = 2 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy;

// ---------------------------------------------------------------------------
// Multi-cell module anchors (catalogue expansion).
//
// Each anchor is a named multiple of an existing single-cell band, so the
// frigate-grade 2-cell variants (twin pulse, twin rail) and the capital-grade
// broadening (flak bastion, drone hangar, bulwark shield bank, plus reactor)
// scale visibly across the fighter → capital span. Mass traces to the same
// physics helpers at these heavier anchors — never hand-tuned.
// ---------------------------------------------------------------------------

/** Twin pulse array sustained beam power (W) — 2× the pulse laser band. */
const TWIN_PULSE_POWER_W = 2 * BEAM_POWER_W.pulse;
/** Twin pulse array refire / dwell (s) — matches the pulse laser band. */
const TWIN_PULSE_COOLDOWN = cooldownTicks(1);

/** Light spear lance sustained beam power (W) — the heavy lance band. */
const LIGHT_SPEAR_POWER_W = BEAM_POWER_W.heavyLance;
/** Light spear lance thermal cycle (s) — a 2.5 s spinal-grade dwell. */
const LIGHT_SPEAR_COOLDOWN = cooldownTicks(2.5);

/** Broadside missile warhead yield (J) — 2× the Terran missile-rack band. */
const BROADSIDE_MISSILE_WARHEAD_J = 2 * 4e8;
/** Broadside missile cruise velocity (m/s) — DERIVED as railgun muzzle / 4. */
const BROADSIDE_MISSILE_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.railgun / 4;
/** Broadside missile rack reload interval (s) from the magazine. */
const BROADSIDE_MISSILE_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.missile);
/** Broadside missile finite-burn motor — the same band the single missile uses. */
const BROADSIDE_MISSILE_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  BROADSIDE_MISSILE_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.missile,
);
const BROADSIDE_MISSILE_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.missile);

/** Bulwark shield bank capacity (J) — 3× the heavy shield band. */
const BULWARK_SHIELD_BANK_CAPACITY_J = 3 * SHIELD_CAPACITY_J.heavy;
/** Bulwark shield bank recharge (W) — 3× the heavy shield band. */
const BULWARK_SHIELD_BANK_RECHARGE_W = 3 * SHIELD_RECHARGE_W.heavy;

/** Plus-section fusion core output (W) — 5× the standard fusion band. */
const PLUS_REACTOR_OUTPUT_W = 5 * FUSION_REACTOR_OUTPUT_W;

/**
 * Footprint polyominoes for the capital multi-cell modules — each anchored at
 * `{0,0}` (the cell the equipment record lives on) and listed in stable offset
 * order. The module literals below author these on each definition; preset
 * designs import the same shapes to install matching `covers` back-pointers
 * via `coverFootprint` (`data/presets/tokens.ts`), so the catalogue and the
 * design agree on each module's shape without re-authoring it.
 */
export const TERRAN_FOOTPRINTS = {
  spinalLance: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
    { dx: 3, dy: 0 },
  ],
  spinalDriver: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  heavyRailTurret: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  capitalDrive: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  crossReactor: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
    { dx: 1, dy: 1 },
  ],
  bastionShield: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  bulwarkDeflector: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  // --- Catalogue-expansion footprints (frigate 2-cell, capital broadening) ---
  /** Twin pulse array: a 2-cell 1×2 line (frigate-grade dual emitter). */
  twinPulseArray: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Twin rail turret: a 2-cell 1×2 line (frigate-grade dual barrel). */
  twinRailTurret: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Light spear lance: a 3-cell 1×3 spinal line (cruiser-grade fixed beam). */
  lightSpearLance: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  /** Broadside missile bank: a 2-cell 1×2 line (frigate-grade side battery). */
  broadsideMissileBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Flak bastion: a 2×2 block (capital PD coverage). */
  flakBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** Damage control bay: a 2-cell 1×2 line. */
  damageControlBay: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Compass drone hangar: an L-tromino (3 cells). */
  droneHangar: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** Mine layer bank: a 2-cell 1×2 line. */
  mineLayerBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Bulwark shield bank: a 3-cell 1×3 line (capital shield wall). */
  bulwarkShieldBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  /** Plus-section fusion core: a plus-shape (5 cells, command reactor). */
  plusReactor: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ],
};

/**
 * Terran capital multi-cell module definitions — polyomino-footprint variants of
 * the single-cell catalogue. Each occupies the cells its footprint lists (the
 * anchor at `{0,0}` plus its covers); a design installs the anchor as one
 * equipment record and marks each covered cell with a `covers` back-pointer to
 * the anchor (see `coverFootprint` in `data/presets/tokens.ts`). Mass traces to
 * the same physics helpers via the heavier capital anchors above. Fixed spinal
 * mounts carry no turret fields; the whole ship must bear.
 */
export const terranCapitalModules: ModuleDefinitionInput[] = [
  {
    id: "ter-spinal-lance",
    faction: "Terran",
    name: "Spinal Lance",
    description:
      "Four-cell capital beam lance running the ship's full length. The emitter stack and cooling train stretch prow to stern, dumping a 3.5 GW sustained pulse that carves gigajoule armour in a few clean hits. Fixed spinal mount — the whole ship must bear.",
    category: "weapon",
    // mass = beamWeaponMass(3.5e9) = 2500 × (3.5e9 / 4e7) = 218,750 kg (~219 t).
    mass: beamWeaponMass(SPINAL_LANCE_POWER_W),
    cost: 640,
    // A beam's draw IS its delivered optical power.
    powerDraw: SPINAL_LANCE_POWER_W,
    crewRequired: 3,
    techLevel: 4,
    footprint: TERRAN_FOOTPRINTS.spinalLance,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(SPINAL_LANCE_POWER_W, SPINAL_LANCE_COOLDOWN) * 50,
      range: BEAM_RANGE_M,
      cooldown: SPINAL_LANCE_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.15,
      armourPiercing: 0.4,
      spread: 0,
    },
  },
  {
    id: "ter-spinal-driver",
    faction: "Terran",
    name: "Spinal Mass Driver",
    description:
      "Three-cell capital coilgun straddling the keel. A 150 kg tungsten dart leaves the muzzle at 10 km/s, depositing 7.5 GJ on target — the heaviest single kinetic hit in the Terran inventory. Slow to load and requires a large hull to mount.",
    category: "weapon",
    // 150 kg @ 10 km/s. Muzzle energy ½·150·10000² = 7.5 GJ.
    // mass = kineticWeaponMass(150, 10000) = 3500 × (7.5e9 / 2e7) = 1,312,500 kg.
    mass: kineticWeaponMass(SPINAL_DRIVER_MASS_KG, SPINAL_DRIVER_MUZZLE_MS),
    cost: 540,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 3,
    techLevel: 4,
    footprint: TERRAN_FOOTPRINTS.spinalDriver,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(SPINAL_DRIVER_MASS_KG, SPINAL_DRIVER_MUZZLE_MS) * 50,
      range: kineticRangeM(SPINAL_DRIVER_MUZZLE_MS),
      cooldown: SPINAL_DRIVER_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(SPINAL_DRIVER_MUZZLE_MS),
      projectileMass: SPINAL_DRIVER_MASS_KG,
      tracking: 0,
      shieldPiercing: 0.4,
      armourPiercing: 0.6,
      spread: 0.01,
      // Ballistic dart: unpowered and unguided. Fixed spinal mount (no turret).
      powered: false,
      guided: false,
      ammoCapacity: 60,
    },
  },
  {
    id: "ter-heavy-railgun-turret",
    faction: "Terran",
    name: "Heavy Railgun Turret",
    description:
      "Two-cell dual-rail turret on a powered mounting. A paired barrel assembly firing a heavier 20 kg slug than the single-cell railgun, slewing across a 90 degree arc. The standard cruiser-grade kinetic battery.",
    category: "weapon",
    // 20 kg @ 8 km/s. Muzzle energy ½·20·8000² = 640 MJ.
    // mass = kineticWeaponMass(20, 8000) = 3500 × (6.4e8 / 2e7) = 112,000 kg.
    mass: kineticWeaponMass(HEAVY_RAIL_MASS_KG, HEAVY_RAIL_MUZZLE_MS),
    cost: 200,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 2,
    techLevel: 3,
    footprint: TERRAN_FOOTPRINTS.heavyRailTurret,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(HEAVY_RAIL_MASS_KG, HEAVY_RAIL_MUZZLE_MS) * 50,
      range: kineticRangeM(HEAVY_RAIL_MUZZLE_MS),
      cooldown: HEAVY_RAIL_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(HEAVY_RAIL_MUZZLE_MS),
      projectileMass: HEAVY_RAIL_MASS_KG,
      tracking: 0.5,
      shieldPiercing: 0.4,
      armourPiercing: 0.55,
      spread: 0.02,
      // Ballistic slug: unpowered and unguided, but the turret slews.
      powered: false,
      guided: false,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.08,
      ammoCapacity: 160,
    },
  },
  {
    id: "ter-capital-drive",
    faction: "Terran",
    name: "Capital Plasma Drive",
    description:
      "Three-cell fusion-torch drive array stretching aft along the keel. Three times the thrust of a standard plasma drive, with a gimballed nozzle for vector control. The main propulsion for cruiser and capital hulls.",
    category: "propulsion",
    // mass = engineMass(360000) = 3000 × (360000 / 5000) = 216,000 kg.
    mass: engineMass(CAPITAL_DRIVE_THRUST_N),
    cost: 210,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 1,
    techLevel: 3,
    footprint: TERRAN_FOOTPRINTS.capitalDrive,
    effect: {
      kind: "engine",
      thrust: CAPITAL_DRIVE_THRUST_N,
      gimbalArc: Math.PI / 6,
    },
  },
  {
    id: "ter-cross-reactor",
    faction: "Terran",
    name: "Cross-Section Antimatter Core",
    description:
      "Four-cell T-section advanced antimatter reactor complex. Containment vessels and shielding spread across a cross-shaped bulkhead, feeding spinal lances, capital shields and drive simultaneously. Serves as the ship's command core.",
    category: "system",
    // 12 GW @ 3e8 W/m³ (advanced antimatter density).
    // mass = reactorMass(12e9, 3e8) = 4000 × 40 = 160,000 kg.
    mass: reactorMass(
      CROSS_REACTOR_OUTPUT_W,
      ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
    ),
    cost: 600,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 4,
    footprint: TERRAN_FOOTPRINTS.crossReactor,
    effect: { kind: "power", output: CROSS_REACTOR_OUTPUT_W },
    command: true,
  },
  {
    id: "ter-bastion-shield",
    faction: "Terran",
    name: "Bastion Shield Array",
    description:
      "Four-cell capital shield projector block. A 2x2 array of field generators woven into the hull, projecting a 2.5 GJ bastion that soaks a full capital salvo before collapsing. The recovery load dominates the reactor budget.",
    category: "defence",
    // mass = shieldMass(2.5e9) = 2000 × (2.5e9 / 1.3e7) ≈ 384,615 kg.
    mass: shieldMass(BASTION_SHIELD_CAPACITY_J),
    cost: 600,
    // A shield's draw IS its recharge wattage.
    powerDraw: BASTION_SHIELD_RECHARGE_W,
    crewRequired: 3,
    techLevel: 4,
    footprint: TERRAN_FOOTPRINTS.bastionShield,
    effect: {
      kind: "shield",
      capacity: BASTION_SHIELD_CAPACITY_J,
      rechargeRate: BASTION_SHIELD_RECHARGE_W,
      rechargeDelay: 150,
    },
  },
  {
    id: "ter-bulwark-deflector",
    faction: "Terran",
    name: "Bulwark Deflector Screen",
    description:
      "Two-cell heavy momentum screen. Arrests capital-grade kinetic rounds and rams — the (E,p) counterpart to a heavy shield, soaking directed momentum before it reaches armour as kinetic work. Doubles a single heavy screen's arrest capacity.",
    category: "defence",
    // mass = deflectorMass(4e6) = 2000 × (4e6 / 1.5e4) ≈ 533,333 kg.
    mass: deflectorMass(BULWARK_CAPACITY_KG_MPS),
    cost: 300,
    // A deflector's draw IS its momentum-rebuild rate.
    powerDraw: BULWARK_RECHARGE_KG_MPS_PER_S,
    crewRequired: 2,
    techLevel: 3,
    footprint: TERRAN_FOOTPRINTS.bulwarkDeflector,
    effect: {
      kind: "deflector",
      capacity: BULWARK_CAPACITY_KG_MPS,
      rechargeRate: BULWARK_RECHARGE_KG_MPS_PER_S,
      rechargeDelay: 150,
    },
  },
  // --- Catalogue-expansion modules ---
  // Frigate-grade 2-cell upgrades and capital broadening: repair bay, PD
  // bastion, drone hangar, mine layer, EW variant, plus-shape reactor. Mass
  // traces to the same physics helpers at heavier anchors.
  {
    id: "ter-twin-pulse-array",
    faction: "Terran",
    name: "Twin Pulse Array",
    description:
      "A two-cell paired pulse-laser emitter stack. Two frigate-grade pulse lasers ganged on a single mounting double the sustained optical power, cycling fast for a punishing anti-shield rake. The standard frigate beam-battery upgrade.",
    category: "weapon",
    // 2× the pulse band. mass = beamWeaponMass(6e8) = 2500 × (6e8 / 4e7) = 37,500 kg.
    mass: beamWeaponMass(TWIN_PULSE_POWER_W),
    cost: 110,
    powerDraw: TWIN_PULSE_POWER_W,
    crewRequired: 2,
    techLevel: 2,
    footprint: TERRAN_FOOTPRINTS.twinPulseArray,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(TWIN_PULSE_POWER_W, TWIN_PULSE_COOLDOWN) * 50,
      range: BEAM_RANGE_M,
      cooldown: TWIN_PULSE_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.1,
      armourPiercing: 0.2,
      spread: 0,
    },
  },
  {
    id: "ter-twin-rail-turret",
    faction: "Terran",
    name: "Twin Rail Turret",
    description:
      "A two-cell dual-rail turret on a powered mounting. Two railgun barrels sharing a capacitor bank and a slewing base — the standard frigate kinetic-battery upgrade, throwing a heavier salvo than the singleton railgun across the same wide arc.",
    category: "weapon",
    // 10 kg @ 8 km/s (railgun band). mass = kineticWeaponMass(10, 8000) = 56,000 kg.
    mass: kineticWeaponMass(
      PROJECTILE_MASS_KG.railgun,
      MUZZLE_VELOCITY_M_PER_S.railgun,
    ),
    cost: 160,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 2,
    techLevel: 2,
    footprint: TERRAN_FOOTPRINTS.twinRailTurret,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage:
        kineticDamageJoules(
          PROJECTILE_MASS_KG.railgun,
          MUZZLE_VELOCITY_M_PER_S.railgun,
        ) * 50,
      range: kineticRangeM(MUZZLE_VELOCITY_M_PER_S.railgun),
      cooldown: cooldownTicks(3.2),
      projectileSpeed: projectileSpeedMPerTick(MUZZLE_VELOCITY_M_PER_S.railgun),
      projectileMass: PROJECTILE_MASS_KG.railgun,
      tracking: 0.5,
      shieldPiercing: 0.35,
      armourPiercing: 0.5,
      spread: 0.02,
      powered: false,
      guided: false,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.08,
      ammoCapacity: 200,
    },
  },
  {
    id: "ter-light-spear-lance",
    faction: "Terran",
    name: "Light Spear Lance",
    description:
      "A three-cell spinal beam lance straddling a cruiser's keel. A heavy-lance-grade emitter running the prow three cells, dumping an 800 MW sustained pulse on a 2.5 s thermal cycle. Fixed spinal mount — the whole ship must bear. Fills the gap between the heavy railgun turret and the capital spinal lance.",
    category: "weapon",
    // mass = beamWeaponMass(8e8) = 2500 × (8e8 / 4e7) = 50,000 kg (~50 t).
    mass: beamWeaponMass(LIGHT_SPEAR_POWER_W),
    cost: 280,
    powerDraw: LIGHT_SPEAR_POWER_W,
    crewRequired: 3,
    techLevel: 3,
    footprint: TERRAN_FOOTPRINTS.lightSpearLance,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(LIGHT_SPEAR_POWER_W, LIGHT_SPEAR_COOLDOWN) * 50,
      range: BEAM_RANGE_M,
      cooldown: LIGHT_SPEAR_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.15,
      armourPiercing: 0.4,
      spread: 0,
    },
  },
  {
    id: "ter-broadside-missile-bank",
    faction: "Terran",
    name: "Broadside Missile Bank",
    description:
      "A two-cell broadside missile battery. Two ganged launchers on a half-arc turret throw doubled-warhead homing missiles out the flank — a frigate's alpha-strike upgrade over the singleton missile rack, traded for a narrower engagement arc.",
    category: "weapon",
    // Same railgun-band body as the missile rack, same × 0.6 mechanism fraction.
    // mass = kineticWeaponMass(10, 8000) × 0.6 = 56,000 × 0.6 = 33,600 kg.
    mass:
      kineticWeaponMass(
        PROJECTILE_MASS_KG.railgun,
        MUZZLE_VELOCITY_M_PER_S.railgun,
      ) * 0.6,
    cost: 200,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 3,
    footprint: TERRAN_FOOTPRINTS.broadsideMissileBank,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: BROADSIDE_MISSILE_WARHEAD_J,
      range: MISSILE_RANGE_M,
      cooldown: BROADSIDE_MISSILE_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(BROADSIDE_MISSILE_CRUISE_MS),
      projectileMass: PROJECTILE_MASS_KG.railgun,
      tracking: 2.5,
      shieldPiercing: 0.15,
      armourPiercing: 0.3,
      spread: 0.4,
      powered: true,
      guided: true,
      thrust: BROADSIDE_MISSILE_THRUST_M_PER_S2,
      burnTicks: BROADSIDE_MISSILE_BURN_TICKS,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.05,
      ammoCapacity: 280,
    },
  },
  {
    id: "ter-flak-bastion",
    faction: "Terran",
    name: "Flak Bastion",
    description:
      "A 2×2 capital point-defence block. Four ganged flak turrets sharing a single fire-director stack throw a dense burst of shrapnel across a wide radius — the area-denial PD coverage a cruiser or dreadnought leans on to shred incoming torpedo volleys before they reach the gun line.",
    category: "defence",
    // 4 × the single-cell PD mass proxy. moduleMass("pointDefense") = 2500 × 5 = 12,500 kg.
    // mass = 4 × 12,500 = 50,000 kg (~50 t).
    mass: 4 * moduleMass("pointDefense"),
    cost: 170,
    powerDraw: 2 * MODULE_POWER_DRAW_W.pointDefense,
    crewRequired: 2,
    techLevel: 3,
    footprint: TERRAN_FOOTPRINTS.flakBastion,
    effect: {
      kind: "pointDefense",
      damage: 12,
      range: 120,
      cooldown: 8,
      hitChance: 0.5,
      tracking: 2.0,
    },
    pointDefense: true,
  },
  {
    id: "ter-damage-control-bay",
    faction: "Terran",
    name: "Damage Control Bay",
    description:
      "A two-cell damage-control station. A dedicated repair bay with twin robotic welder gangs and a spares locker — the first native Terran repair capability, sized between the Foundry repair bay and the capital repair bastion. Keeps a frigate in the slugging match long after its shields fold.",
    category: "defence",
    // Sized like fnd-repair-bay: moduleMass("mediumWeapon") = 3500 × 16 = 56,000 kg.
    mass: moduleMass("mediumWeapon"),
    cost: 110,
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 2,
    techLevel: 2,
    footprint: TERRAN_FOOTPRINTS.damageControlBay,
    effect: {
      kind: "repair",
      repairRate: 6,
    },
  },
  {
    id: "ter-drone-hangar",
    faction: "Terran",
    name: "Compass Drone Hangar",
    description:
      "A three-cell L-tromino fabrication and launch deck for autonomous combat drones. Six drones per wing, replaced as they fall — the first native Terran hangar, giving a cruiser or dreadnought a stand-off swarm doctrine it previously lacked.",
    category: "weapon",
    // moduleMass("heavyWeapon") = 4000 × 24 = 96,000 kg (~96 t).
    mass: moduleMass("heavyWeapon"),
    cost: 220,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 3,
    techLevel: 3,
    footprint: TERRAN_FOOTPRINTS.droneHangar,
    effect: {
      kind: "hangar",
      droneCount: 6,
      launchCooldown: 90,
      droneHp: 50,
      droneDamage: 6,
      droneRange: 100,
      droneSpeed: 5,
    },
  },
  {
    id: "ter-mine-layer-bank",
    faction: "Terran",
    name: "Mine Layer Bank",
    description:
      "A two-cell proximity-mine layer. A twin-rail dispenser seeding armed mines in a ship's wake — the first native Terran mine-laying capability, sized at the heavy-autocannon mechanism envelope to match the Foundry mine layer at Terran steel density.",
    category: "weapon",
    // Matches the fnd-mine-layer envelope at Terran density.
    // mass = kineticWeaponMass(3, 5000) = 3500 × (3.75e7 / 2e7) = 6,562 kg (~6.6 t).
    mass: kineticWeaponMass(
      PROJECTILE_MASS_KG.heavyAutocannon,
      MUZZLE_VELOCITY_M_PER_S.heavyAutocannon,
    ),
    cost: 170,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 3,
    footprint: TERRAN_FOOTPRINTS.mineLayerBank,
    effect: {
      kind: "mineLayer",
      mineCount: 6,
      mineDamage: 80,
      mineRadius: 80,
      layCooldown: 220,
      armingDelay: 18,
    },
  },
  {
    id: "ter-bulwark-shield-bank",
    faction: "Terran",
    name: "Bulwark Shield Bank",
    description:
      "A three-cell capital shield projector wall. Three heavy shield arrays ganged along the keel, projecting a 1.8 GJ bulwark that soaks a full cruiser salvo before folding. The recovery load dominates the reactor budget — the standard cruiser shield upgrade.",
    category: "defence",
    // 3× heavy shield capacity. mass = shieldMass(1.8e9) = 2000 × (1.8e9 / 1.3e7) ≈ 276,923 kg.
    mass: shieldMass(BULWARK_SHIELD_BANK_CAPACITY_J),
    cost: 430,
    powerDraw: BULWARK_SHIELD_BANK_RECHARGE_W,
    crewRequired: 3,
    techLevel: 4,
    footprint: TERRAN_FOOTPRINTS.bulwarkShieldBank,
    effect: {
      kind: "shield",
      capacity: BULWARK_SHIELD_BANK_CAPACITY_J,
      rechargeRate: BULWARK_SHIELD_BANK_RECHARGE_W,
      rechargeDelay: 150,
    },
  },
  {
    id: "ter-plus-reactor",
    faction: "Terran",
    name: "Plus-Section Fusion Core",
    description:
      "A five-cell plus-section advanced-fusion reactor complex. Four containment arms spreading from a central hub, feeding 7.5 GW at advanced-fusion density — a capital command core that runs alongside an existing antimatter heart, feeding spinal lances and capital shields simultaneously.",
    category: "system",
    // 7.5 GW @ 6e7 W/m³ (advanced fusion density).
    // mass = reactorMass(7.5e9, 6e7) = 4000 × (7.5e9 / 6e7) = 500,000 kg (~500 t).
    mass: reactorMass(
      PLUS_REACTOR_OUTPUT_W,
      FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
    ),
    cost: 460,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 4,
    footprint: TERRAN_FOOTPRINTS.plusReactor,
    effect: { kind: "power", output: PLUS_REACTOR_OUTPUT_W },
    command: true,
  },
];
