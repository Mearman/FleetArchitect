import type { ModuleDefinitionInput } from "@/schema/module";
import {
  deflectorMass,
  engineMass,
  kineticWeaponMass,
  magazineMass,
  reactorMass,
} from "../physics";
import {
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  ORDNANCE_BURN_TIME_S,
  PROJECTILE_MASS_KG,
  RELOAD_THERMAL_TIME_S,
  TORPEDO_RANGE_M,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";
import {
  poweredMotorBurnTicks,
  poweredMotorThrustMPerS2,
} from "../ordnance-motor";
import {
  ENGINE_DENSITY,
  HEAVY_PLASMA_DRIVE_THRUST_N,
  MAGAZINE_DENSITY,
  REACTOR_DENSITY,
  REACTOR_FUSION_OUTPUT_W,
  SIEGE_PLASMA_WARHEAD_J,
  TORPEDO_WARHEAD_J,
  WEAPON_DENSITY,
} from "./foundry";

// ---------------------------------------------------------------------------
// Foundry capital multi-cell modules.
//
// The single-cell catalogue in `foundry.ts` spans fighter → frigate → cruiser
// capability on one cell each. The modules here are the multi-cell capital
// variants: each occupies a polyomino footprint (2-4 cells) and re-anchors its
// capability at a multiple of the single-cell band (a 120 kg super-driver slug,
// a triple heavy-plasma drive train, a 12 GW advanced-antimatter cross-section
// core, an 800-round magazine bunker, a 4× heavy deflector bastion, a twin
// repair bay). Their mass still traces to the SAME physics-layer helpers
// (`kineticWeaponMass`, `engineMass`, `reactorMass`, `magazineMass`,
// `deflectorMass`) applied to these heavier anchors, so a stronger capital
// module is proportionally heavier — by physics, not by a size class.
//
// Isolated from `foundry.ts` so that file stays under the per-file max-lines
// guard (mirroring the `terran.ts` / `terran-capital.ts` split). The catalog
// index (`data/catalog/index.ts`) concatenates these onto `foundryModules`;
// preset designs import `FOUNDRY_FOOTPRINTS` to install matching `covers`
// back-pointers via `coverFootprint` (`data/presets/tokens.ts`). The Foundry
// material densities (WEAPON_DENSITY etc.) are imported from `foundry.ts` so
// the multi-cell variants share the single-cell catalogue's forged-composite
// material — no drift.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capital anchors.
//
// Each constant is a multiple of an existing single-cell band (the super-driver
// round, 3× the heavy-plasma drive, advanced antimatter density, 2× the
// magazine, 4× the heavy deflector, 2× the repair rate), so capability scales
// visibly across the fighter → capital span and mass follows from the physics
// helpers, never hand-tuned.
// ---------------------------------------------------------------------------

/** Siege cannon heavy round mass (kg) — 50× the `superDriver` band (6,000 kg),
 *  folding the catalogue's former `× 50` per-shot damage scalar into the
 *  physics anchor so damage, range-band mass, and recoil all scale together. */
const SIEGE_CANNON_HEAVY_MASS_KG = 50 * PROJECTILE_MASS_KG.superDriver;
/** Siege cannon heavy muzzle velocity (m/s) — the `superDriver` band (12 km/s),
 *  the fastest muzzle menu entry. */
const SIEGE_CANNON_HEAVY_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.superDriver;
/** Siege cannon heavy load cycle (s) — the `superDriver` band, the slowest
 *  kinetic refire. */
const SIEGE_CANNON_HEAVY_COOLDOWN = cooldownTicks(
  RELOAD_THERMAL_TIME_S.superDriver,
);

/** Forge drive rated thrust (N) — 3× the heavyPlasma drive band (3 × 160 kN),
 *  three ganged heavy-plasma nozzles on one drive train. */
const FORGE_DRIVE_THRUST_N = 3 * 160_000;

/** Cross-section core output target (~12 GW) — a capital command core at the
 *  advanced antimatter density band, feeding siege cannons and bulwark
 *  bastions simultaneously. 2.4× the Industrial Core's output for 1.6× its
 *  mass (denser core). */
const CROSS_CORE_OUTPUT_W = 1.2e10;

/** Shell magazine bunker stored round count — 2× the standard shell magazine
 *  (800 vs 400), behind armoured blast doors. */
const MAGAZINE_BUNKER_ROUNDS = 800;

/** Bulwark bastion capacity (kg·m/s) — 4× the heavy deflector band, four heavy
 *  momentum screens ganged into one forged bastion. */
const BULWARK_BASTION_CAPACITY_KG_MPS = 4 * DEFLECTOR_CAPACITY_KG_MPS.heavy;
/** Bulwark bastion recharge (kg·m/s per s) — 4× the heavy deflector band. */
const BULWARK_BASTION_RECHARGE_KG_MPS_PER_S =
  4 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy;

/** Damage control bastion repair rate (HP/tick) — 2× the standard damage
 *  control bay's rate (12 vs 6), double the welder headcount. */
const REPAIR_BASTION_RATE = 12;

// ---------------------------------------------------------------------------
// Catalog-expansion anchors.
//
// Each is a multiple of an existing single-cell band so the twin / broadening
// variants scale visibly across the frigate → capital span, with mass still
// traced to the SAME physics helpers. Foundry has NO shields and NO beams —
// only kinetics, plasma, torpedoes, repair, flak, deflectors, reactors,
// magazines, and drives.
// ---------------------------------------------------------------------------

/** Twin autocannon round (kg) — the `gauss` band (20 kg), one band above the
 *  single autocannon's `heavyAutocannon` (3 kg): a frigate-grade twin battery. */
const TWIN_AUTOCANNON_MASS_KG = PROJECTILE_MASS_KG.gauss;
/** Twin autocannon muzzle (m/s) — the `gauss` band (9.5 km/s). */
const TWIN_AUTOCANNON_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.gauss;

/** Gauss turret bank round (kg) — 2× the `gauss` band (40 kg), a traversing
 *  cruiser-grade twin coilgun. */
const GAUSS_TURRET_BANK_MASS_KG = 2 * PROJECTILE_MASS_KG.gauss;
/** Gauss turret bank muzzle (m/s) — the `gauss` band (9.5 km/s). */
const GAUSS_TURRET_BANK_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.gauss;

/** Twin siege mortar bolt body (kg) — 2× the `driver` band (100 kg), the
 *  Foundry's apex 2×2 alpha-strike battery. */
const TWIN_SIEGE_MORTAR_MASS_KG = 2 * PROJECTILE_MASS_KG.driver;
/** Twin siege mortar muzzle (m/s) — `driver / 5`, a lobbed plasma bolt. */
const TWIN_SIEGE_MORTAR_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.driver / 5;
/** Twin siege mortar warhead (J) — 2× the single siege-plasma band (3.6 GJ). */
const TWIN_SIEGE_MORTAR_WARHEAD_J = 2 * SIEGE_PLASMA_WARHEAD_J;

/** Twin torpedo body (kg) — 2× the `driver` band (100 kg). */
const TWIN_TORPEDO_MASS_KG = 2 * PROJECTILE_MASS_KG.driver;
/** Twin torpedo cruise (m/s) — `driver / 8`, the slowest round in flight. */
const TWIN_TORPEDO_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.driver / 8;
/** Twin torpedo warhead (J) — 2× the single torpedo band (2.4 GJ). */
const TWIN_TORPEDO_WARHEAD_J = 2 * TORPEDO_WARHEAD_J;
/** Twin torpedo finite-burn motor — DERIVED from the torpedo burn-time band,
 *  matching the single torpedo tube's motor derivation. */
const TWIN_TORPEDO_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  TWIN_TORPEDO_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.torpedo,
);
const TWIN_TORPEDO_BURN_TICKS = poweredMotorBurnTicks(
  ORDNANCE_BURN_TIME_S.torpedo,
);

/** Bulwark screen bank capacity (kg·m/s) — 3× the heavy deflector band, three
 *  ganged heavy momentum screens along a 1×3 capital line. */
const BULWARK_SCREEN_CAPACITY_KG_MPS = 3 * DEFLECTOR_CAPACITY_KG_MPS.heavy;
/** Bulwark screen bank recharge (kg·m/s per s) — 3× the heavy deflector band. */
const BULWARK_SCREEN_RECHARGE_KG_MPS_PER_S =
  3 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy;

/** Plus-section forge core output (~7.5 GW) — 5× the standard fusion band at
 *  the advanced-fusion power density; a capital command cross-section. */
const PLUS_FORGE_CORE_OUTPUT_W = 5 * REACTOR_FUSION_OUTPUT_W;

/** Heavy magazine bunker round count — 4× the standard shell magazine (1600
 *  vs 400), a 2×2 blast-door reserve feeding a dreadnought battery. */
const MAGAZINE_BUNKER_HEAVY_ROUNDS = 1600;

/** Twin grav drive thrust (N) — 2× the heavy-plasma band (320 kN), a two-cell
 *  capital drive train. */
const TWIN_GRAV_DRIVE_THRUST_N = 2 * HEAVY_PLASMA_DRIVE_THRUST_N;

/**
 * Footprint polyominoes for the capital multi-cell modules — each anchored at
 * `{0,0}` (the cell the equipment record lives on) and listed in stable offset
 * order. The module literals below author these on each definition; preset
 * designs import the same shapes to install matching `covers` back-pointers
 * via `coverFootprint` (`data/presets/tokens.ts`), so the catalogue and the
 * design agree on each module's shape without re-authoring it.
 */
export const FOUNDRY_FOOTPRINTS = {
  /** 2×2 block — a four-cell capital coilgun bulkhead. */
  siegeCannonHeavy: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** 1×3 line — three ganged nozzles along the ship's long axis. */
  forgeDrive: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  /** T-tetromino — centre spine plus left/right containment and one cooling
   *  arm, separating containment vessel from radiator deck. */
  crossSectionCore: [
    { dx: 0, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** 1×2 line — a two-cell blast-door bunker. */
  magazineBunker: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 2×2 block — four ganged heavy momentum screens. */
  bulwarkBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** 1×2 line — a two-cell robotic welder bay. */
  repairBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  // --- Catalog-expansion multi-cell modules (twin / broadening variants). ---
  /** 1×2 line — a two-cell twin autocannon battery (frigate broadside). */
  twinAutocannon: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 1×2 line — a two-cell gauss turret bank (cruiser traverse mount). */
  gaussTurretBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 2×2 block — a four-cell twin siege mortar (capital alpha strike). */
  twinSiegeMortar: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** 1×2 line — a two-cell torpedo bank (frigate alpha strike). */
  twinTorpedoBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 2×2 block — a four-cell flak bunker (capital point defence). */
  flakBunker: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** L-tromino — a three-cell repair lathe (lighter per cell than the bastion). */
  repairLathe: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** 1×3 line — a three-cell bulwark screen bank (capital momentum screen). */
  bulwarkScreenBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  /** Plus-shape — a five-cell command reactor cross (advanced-fusion core). */
  plusForgeCore: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ],
  /** 2×2 block — a four-cell heavy magazine bunker (1600-round reserve). */
  magazineBunkerHeavy: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** 1×2 line — a two-cell twin grav drive (capital propulsion). */
  twinGravDrive: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
};

/**
 * Foundry capital multi-cell module definitions — polyomino-footprint variants
 * of the single-cell catalogue. Each occupies the cells its footprint lists
 * (the anchor at `{0,0}` plus its covers); a design installs the anchor as one
 * equipment record and marks each covered cell with a `covers` back-pointer to
 * the anchor (see `coverFootprint` in `data/presets/tokens.ts`). Mass traces to
 * the same physics helpers via the heavier capital anchors above.
 */
export const foundryCapitalModules: ModuleDefinitionInput[] = [
  {
    id: "fnd-siege-cannon-heavy",
    faction: "Foundry",
    name: "Siege Cannon Heavy",
    description:
      "A four-cell capital coilgun throwing a 6,000 kg super-driver shot at 12 km/s — fifty times the singleton super-driver slug, folded into the round so the gun's mass and recoil rise with its punch. The barrel assembly fills a 2×2 bulkhead and the recoil cracks plating on anything smaller than a dreadnought — the Foundry's heaviest alpha strike.",
    category: "weapon",
    // 6,000 kg @ 12 km/s (50× the superDriver band). Muzzle energy
    // ½·6000·12000² = 432 GJ.
    // mass = kineticWeaponMass(6000, 12000, 6000)
    //      = 6000 × (4.32e11 / 2e7) = 129,600,000 kg (~129,600 t) — the former
    //      `× 50` per-shot damage scalar folded into the round mass, so the
    //      gun scales with its punch rather than inflating damage alone.
    mass: kineticWeaponMass(
      SIEGE_CANNON_HEAVY_MASS_KG,
      SIEGE_CANNON_HEAVY_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 420,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 4,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.siegeCannonHeavy,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(
        SIEGE_CANNON_HEAVY_MASS_KG,
        SIEGE_CANNON_HEAVY_MUZZLE_MS,
      ),
      range: kineticRangeM(SIEGE_CANNON_HEAVY_MUZZLE_MS),
      cooldown: SIEGE_CANNON_HEAVY_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(SIEGE_CANNON_HEAVY_MUZZLE_MS),
      projectileMass: SIEGE_CANNON_HEAVY_MASS_KG,
      tracking: 0.3,
      shieldPiercing: 0.2,
      armourPiercing: 0.75,
      spread: 0.05,
      // Ballistic slug: unpowered and unguided. Fixed capital mount (no turret).
      powered: false,
      guided: false,
      // Finite magazine: `ammo` (start) AND `ammoCapacity` (crew top-up
      // ceiling) must both be set — omitting `ammo` leaves it at
      // DEFAULT_WEAPON_AMMO (effectively unlimited).
      ammo: 60,
      ammoCapacity: 60,
    },
  },
  {
    id: "fnd-forge-drive",
    faction: "Foundry",
    name: "Forge Drive",
    description:
      "Three heavy plasma nozzles ganged along a single 1×3 thrust-train — a capital-scale fusion torch that can actually shift a dreadnought slab, unlike the singleton grav drive, at the cost of a three-cell engine bay and the crew to mind it. Exactly 3× the grav drive's mass and thrust.",
    category: "propulsion",
    // 480 kN thrust (3 × heavyPlasma 160 kN).
    // mass = engineMass(480000, 4500) = 4500 × (480000 / 5000) = 432,000 kg
    // (~432 t) — exactly 3× the grav drive's 144 t.
    mass: engineMass(FORGE_DRIVE_THRUST_N, ENGINE_DENSITY),
    cost: 210,
    // 3× the drive power-conditioning load of a singleton grav drive.
    powerDraw: 3 * MODULE_POWER_DRAW_W.drive,
    crewRequired: 2,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.forgeDrive,
    effect: { kind: "engine", thrust: FORGE_DRIVE_THRUST_N },
  },
  {
    id: "fnd-cross-section-core",
    faction: "Foundry",
    name: "Cross-Section Core",
    description:
      "A four-cell advanced-antimatter core laid out in a forged T-section — an engineering cross-section (centre spine plus one cooling arm) that separates the containment vessel from its radiator deck so a single hit cannot take both down. A capital command node. Uses the advanced antimatter density band: 2.4× the Industrial Core's output for 1.6× its mass.",
    category: "system",
    // 12 GW @ 3e8 W/m³ (advanced antimatter density).
    // mass = reactorMass(1.2e10, 3e8, 6000) = 6000 × (1.2e10 / 3e8) = 240,000 kg
    // (~240 t) — 1.6× the Industrial Core's 150 t for 2.4× its output.
    mass: reactorMass(
      CROSS_CORE_OUTPUT_W,
      ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
      REACTOR_DENSITY,
    ),
    cost: 380,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 4,
    footprint: FOUNDRY_FOOTPRINTS.crossSectionCore,
    effect: { kind: "power", output: CROSS_CORE_OUTPUT_W },
    command: true,
  },
  {
    id: "fnd-magazine-bunker",
    faction: "Foundry",
    name: "Shell Magazine Bunker",
    description:
      "A two-cell blast-door magazine bunker — double the rounds of the standard shell magazine, behind armoured blast doors that contain a cook-off to the cells it sits on rather than letting it gut the ship. Exactly 2× the standard magazine's mass and stored round count.",
    category: "system",
    // 800 rounds (2× the standard 400-round magazine).
    // mass = magazineMass(800, 6500) = 6500 × (800 / 30) ≈ 173,333 kg (~173 t)
    // — exactly 2× the standard magazine's 87 t.
    mass: magazineMass(MAGAZINE_BUNKER_ROUNDS, MAGAZINE_DENSITY),
    cost: 95,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 2,
    footprint: FOUNDRY_FOOTPRINTS.magazineBunker,
    effect: { kind: "magazine", ammoStored: MAGAZINE_BUNKER_ROUNDS },
  },
  {
    id: "fnd-bulwark-bastion",
    faction: "Foundry",
    name: "Bulwark Bastion",
    description:
      "A four-cell deflector array — four heavy momentum screens ganged into a single forged bastion that arrests capital mass-driver rounds which would punch clean through bulk armour. The screen a Foundry dreadnought hides behind. Exactly 4× the bulwark deflector's mass and capacity.",
    category: "defence",
    // 8e6 kg·m/s capacity (4× the heavy deflector's 2e6).
    // mass = deflectorMass(8e6) = 2000 × (8e6 / 1.5e4) ≈ 1,066,667 kg (~1,067 t)
    // — exactly 4× the bulwark deflector's 267 t.
    mass: deflectorMass(BULWARK_BASTION_CAPACITY_KG_MPS),
    cost: 280,
    // A deflector's draw IS its momentum-rebuild rate (catalogue convention).
    powerDraw: BULWARK_BASTION_RECHARGE_KG_MPS_PER_S,
    crewRequired: 2,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.bulwarkBastion,
    effect: {
      kind: "deflector",
      capacity: BULWARK_BASTION_CAPACITY_KG_MPS,
      rechargeRate: BULWARK_BASTION_RECHARGE_KG_MPS_PER_S,
      rechargeDelay: 140,
    },
  },
  {
    id: "fnd-repair-bastion",
    faction: "Foundry",
    name: "Damage Control Bastion",
    description:
      "A two-cell robotic welder bay — double the welder headcount of the standard damage-control bay, a dreadnought's way of staying in a slugging match long after a smaller ship would have folded. Exactly 2× the repair bay's mass and repair rate.",
    category: "defence",
    // 2× the standard repair bay's derived volume at the forged weapon density.
    // mass = 2 × 72,000 = 144,000 kg (~144 t) — exactly 2× the repair bay's 72 t.
    mass: 144_000,
    cost: 180,
    // 2× the sensor-class housekeeping load of the standard repair bay.
    powerDraw: 2 * MODULE_POWER_DRAW_W.sensor,
    crewRequired: 2,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.repairBastion,
    effect: { kind: "repair", repairRate: REPAIR_BASTION_RATE },
  },
  // --- Catalog-expansion multi-cell modules (twin / broadening variants). ---
  {
    id: "fnd-twin-autocannon",
    faction: "Foundry",
    name: "Twin Autocannon",
    description:
      "Two rotary autocannons ganged on a frigate broadside mount — a 2-cell battery one band above the workhorse, throwing gauss-class slugs at 9.5 km/s. The Foundry's answer to a frigate that needs to out-slug its weight class.",
    category: "weapon",
    // gauss band (20 kg @ 9.5 km/s), one band above the single autocannon's
    // heavyAutocannon. muzzleEnergy = ½·20·9500² = 902.5 MJ; mass =
    // 6000 × (902.5e6 / 2e7) = 270,750 kg (~271 t).
    mass: kineticWeaponMass(
      TWIN_AUTOCANNON_MASS_KG,
      TWIN_AUTOCANNON_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 160,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 2,
    techLevel: 2,
    footprint: FOUNDRY_FOOTPRINTS.twinAutocannon,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(
        TWIN_AUTOCANNON_MASS_KG,
        TWIN_AUTOCANNON_MUZZLE_MS,
      ),
      range: kineticRangeM(TWIN_AUTOCANNON_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.gauss),
      projectileSpeed: projectileSpeedMPerTick(TWIN_AUTOCANNON_MUZZLE_MS),
      projectileMass: TWIN_AUTOCANNON_MASS_KG,
      tracking: 0.5,
      shieldPiercing: 0.15,
      armourPiercing: 0.55,
      spread: 0.04,
      // Ballistic slug: unpowered and unguided. Fixed twin broadside mount.
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
    id: "fnd-gauss-turret-bank",
    faction: "Foundry",
    name: "Gauss Turret Bank",
    description:
      "A traversing twin coilgun bank — two gauss barrels on a cruiser-grade π/3 arc mount, throwing 40 kg of combined coilgun slug per salvo. Sustains the broadside a single heavy cannon cannot.",
    category: "weapon",
    // 2× gauss band (40 kg @ 9.5 km/s) on a traversing mount.
    // muzzleEnergy = ½·40·9500² = 1.805 GJ; mass = 6000 × (1.805e9 / 2e7)
    // = 541,500 kg (~542 t) — 2× the single heavy cannon's 271 t.
    mass: kineticWeaponMass(
      GAUSS_TURRET_BANK_MASS_KG,
      GAUSS_TURRET_BANK_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 280,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 3,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.gaussTurretBank,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(
        GAUSS_TURRET_BANK_MASS_KG,
        GAUSS_TURRET_BANK_MUZZLE_MS,
      ),
      range: kineticRangeM(GAUSS_TURRET_BANK_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.gauss),
      projectileSpeed: projectileSpeedMPerTick(GAUSS_TURRET_BANK_MUZZLE_MS),
      projectileMass: GAUSS_TURRET_BANK_MASS_KG,
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
    id: "fnd-twin-siege-mortar",
    faction: "Foundry",
    name: "Twin Siege Mortar",
    description:
      "The Foundry's apex alpha strike — a 2×2 twin plasma mortar battery throwing two 50 kg driver-class bolts at once, each a 1.8 GJ matter-plasma warhead. The recoil cracks a cruiser's keel; on a dreadnought it is the opening salvo of a slugging match.",
    category: "weapon",
    // 2× driver band (100 kg total @ driver/5 lob). Mass derived from muzzle
    // energy at the dense forged-composite weapon density.
    // muzzleEnergy = ½·100·2000² = 200 MJ; mass = 6000 × (200e6 / 2e7)
    // = 60,000 kg (~60 t) — 2× the single siege plasma's 30 t.
    mass: kineticWeaponMass(
      TWIN_SIEGE_MORTAR_MASS_KG,
      TWIN_SIEGE_MORTAR_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 430,
    // Two plasma mortars each generate and contain their bolt with grid power.
    powerDraw: 2 * MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 4,
    techLevel: 4,
    footprint: FOUNDRY_FOOTPRINTS.twinSiegeMortar,
    effect: {
      kind: "weapon",
      weaponType: "plasma",
      damage: TWIN_SIEGE_MORTAR_WARHEAD_J,
      range: kineticRangeM(TWIN_SIEGE_MORTAR_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.driver),
      projectileSpeed: projectileSpeedMPerTick(TWIN_SIEGE_MORTAR_MUZZLE_MS),
      projectileMass: TWIN_SIEGE_MORTAR_MASS_KG,
      tracking: 0.3,
      shieldPiercing: 0.2,
      armourPiercing: 0.7,
      spread: 0.06,
      // Self-luminous hot bolt: unpowered and unguided.
      powered: false,
      guided: false,
      // Retuned 40 -> 80 and `ammo` set full, so a crew haul
      // (SIM.ammoRunAmount = 60) dispatches before the mortar is bone-dry.
      ammo: 80,
      ammoCapacity: 80,
    },
  },
  {
    id: "fnd-twin-torpedo-bank",
    faction: "Foundry",
    name: "Twin Torpedo Bank",
    description:
      "Two armour-cracking torpedoes ganged on a frigate bank — a 2-cell alpha strike that puts capital-grade ordnance on a hull small enough to sprint into range. Each torpedo is a 1.2 GJ warhead on a short-legged sprint motor.",
    category: "weapon",
    // 2× driver band body (100 kg @ driver/8 cruise). Mass derived from the
    // torpedo body's kinetic-energy-equivalent at the forged weapon density.
    // muzzleEnergy-equivalent = ½·100·1250² ≈ 78 MJ; mass =
    // 6000 × (78e6 / 2e7) = 23,438 kg (~23 t) — 2× the single torpedo's 12 t.
    mass: kineticWeaponMass(
      TWIN_TORPEDO_MASS_KG,
      TWIN_TORPEDO_CRUISE_MS,
      WEAPON_DENSITY,
    ),
    cost: 280,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 3,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.twinTorpedoBank,
    effect: {
      kind: "weapon",
      weaponType: "torpedo",
      damage: TWIN_TORPEDO_WARHEAD_J,
      range: TORPEDO_RANGE_M,
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.torpedo),
      projectileSpeed: projectileSpeedMPerTick(TWIN_TORPEDO_CRUISE_MS),
      projectileMass: TWIN_TORPEDO_MASS_KG,
      tracking: 0.8,
      shieldPiercing: 0.25,
      armourPiercing: 0.65,
      spread: 0.05,
      // Powered guided ordnance: heavy short-burn motors sprinting to cruise.
      powered: true,
      guided: true,
      thrust: TWIN_TORPEDO_THRUST_M_PER_S2,
      burnTicks: TWIN_TORPEDO_BURN_TICKS,
      // Retuned 30 -> 80 and `ammo` set full, so a crew haul
      // (SIM.ammoRunAmount = 60) dispatches before the bank is bone-dry.
      ammo: 80,
      ammoCapacity: 80,
    },
  },
  {
    id: "fnd-flak-bunker",
    faction: "Foundry",
    name: "Flak Bunker",
    description:
      "A 2×2 capital point-defence bunker — four ganged flak turrets behind forged blast walls, shredding ordnance across every approach vector. With no shields to hide behind, a Foundry cruiser or dreadnought screens itself with this instead.",
    category: "defence",
    // 4× the single flak battery's derived volume at the forged weapon density.
    // mass = 4 × 48,000 = 192,000 kg (~192 t) — 4× the single flak battery.
    mass: 192_000,
    cost: 280,
    // Four PD turrets each draw the single-battery housekeeping load.
    powerDraw: 4 * MODULE_POWER_DRAW_W.pointDefense,
    crewRequired: 3,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.flakBunker,
    effect: {
      kind: "pointDefense",
      damage: 24,
      range: 140,
      cooldown: 7,
      hitChance: 0.55,
      tracking: 2.2,
    },
    pointDefense: true,
  },
  {
    id: "fnd-repair-lathe",
    faction: "Foundry",
    name: "Repair Lathe",
    description:
      "A three-cell L-tromino of robotic welder arms — lighter per cell than the Damage Control Bastion but spread across more deck, a cruiser's way of knitting plating shut alongside its bastion. Adds independent repair capacity without doubling the bastion's headcount.",
    category: "defence",
    // 1.5× the standard repair bay's derived mass (three cells of lighter
    // welder lathe). mass = 1.5 × 72,000 = 108,000 kg (~108 t).
    mass: 108_000,
    cost: 200,
    // A repair lathe draws a small housekeeping load, like a sensor array.
    powerDraw: MODULE_POWER_DRAW_W.sensor,
    crewRequired: 2,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.repairLathe,
    effect: { kind: "repair", repairRate: 10 },
  },
  {
    id: "fnd-bulwark-screen-bank",
    faction: "Foundry",
    name: "Bulwark Screen Bank",
    description:
      "Three heavy momentum screens ganged along a 1×3 capital line — the Foundry's bulwark deflector scaled to dreadnought coverage, arresting mass-driver rounds that would punch through bulk armour. Exactly 3× the bulwark deflector's mass and capacity.",
    category: "defence",
    // 6e6 kg·m/s capacity (3× the heavy deflector's 2e6).
    // mass = deflectorMass(6e6) = 2000 × (6e6 / 1.5e4) = 800,000 kg (~800 t)
    // — exactly 3× the bulwark deflector's 267 t.
    mass: deflectorMass(BULWARK_SCREEN_CAPACITY_KG_MPS),
    cost: 430,
    // A deflector's draw IS its momentum-rebuild rate (catalogue convention).
    powerDraw: BULWARK_SCREEN_RECHARGE_KG_MPS_PER_S,
    crewRequired: 2,
    techLevel: 4,
    footprint: FOUNDRY_FOOTPRINTS.bulwarkScreenBank,
    effect: {
      kind: "deflector",
      capacity: BULWARK_SCREEN_CAPACITY_KG_MPS,
      rechargeRate: BULWARK_SCREEN_RECHARGE_KG_MPS_PER_S,
      rechargeDelay: 140,
    },
  },
  {
    id: "fnd-plus-forge-core",
    faction: "Foundry",
    name: "Plus-Section Forge Core",
    description:
      "A five-cell advanced-fusion command core laid out as a forged plus-section — 7.5 GW at the advanced-fusion density band, a cross-roads core that feeds siege mortars and bulwark screens simultaneously. Sits alongside an antimatter heart as a capital's redundant command node.",
    category: "system",
    // 7.5 GW @ 2e8 W/m³ (advanced fusion density).
    // mass = reactorMass(7.5e9, 2e8, 6000) = 6000 × (7.5e9 / 2e8) = 225,000 kg
    // (~225 t).
    mass: reactorMass(
      PLUS_FORGE_CORE_OUTPUT_W,
      FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
      REACTOR_DENSITY,
    ),
    cost: 470,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 4,
    footprint: FOUNDRY_FOOTPRINTS.plusForgeCore,
    effect: { kind: "power", output: PLUS_FORGE_CORE_OUTPUT_W },
    command: true,
  },
  {
    id: "fnd-magazine-bunker-heavy",
    faction: "Foundry",
    name: "Heavy Magazine Bunker",
    description:
      "A 2×2 blast-door magazine bunker — 1600 rounds (4× the standard shell magazine), behind armoured blast walls that contain a cook-off to the cells it sits on. Feeds a dreadnought's twin siege mortars and gauss banks through a long slugging match.",
    category: "system",
    // 1600 rounds (4× the standard 400-round magazine).
    // mass = magazineMass(1600, 6500) = 6500 × (1600 / 30) ≈ 346,667 kg (~347 t)
    // — 4× the standard magazine's 87 t.
    mass: magazineMass(MAGAZINE_BUNKER_HEAVY_ROUNDS, MAGAZINE_DENSITY),
    cost: 200,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.magazineBunkerHeavy,
    effect: { kind: "magazine", ammoStored: MAGAZINE_BUNKER_HEAVY_ROUNDS },
  },
  {
    id: "fnd-twin-grav-drive",
    faction: "Foundry",
    name: "Twin Grav Drive",
    description:
      "Two heavy-plasma grav drives ganged on a 2-cell capital train — 320 kN of thrust, double the singleton grav drive, for a dreadnought that needs to actually close range. Still sluggish by any other faction's standard.",
    category: "propulsion",
    // 2× heavyPlasma thrust (2 × 160 kN = 320 kN). Mass derived from thrust at
    // the forged engine density.
    // mass = 4500 × (320000 / 5000) = 288,000 kg (~288 t) — 2× the grav drive.
    mass: engineMass(TWIN_GRAV_DRIVE_THRUST_N, ENGINE_DENSITY),
    cost: 150,
    powerDraw: 2 * MODULE_POWER_DRAW_W.drive,
    crewRequired: 2,
    techLevel: 3,
    footprint: FOUNDRY_FOOTPRINTS.twinGravDrive,
    effect: { kind: "engine", thrust: TWIN_GRAV_DRIVE_THRUST_N },
  },
];
