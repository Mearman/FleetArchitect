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
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  PROJECTILE_MASS_KG,
  RELOAD_THERMAL_TIME_S,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";
import {
  ENGINE_DENSITY,
  MAGAZINE_DENSITY,
  REACTOR_DENSITY,
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

/** Siege cannon heavy round mass (kg) — the `superDriver` band (120 kg), the
 *  heaviest projectile menu entry: a 120 kg super-driver slug. */
const SIEGE_CANNON_HEAVY_MASS_KG = PROJECTILE_MASS_KG.superDriver;
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
      "A four-cell capital coilgun throwing a 120 kg super-driver slug at 12 km/s. The barrel assembly fills a 2×2 bulkhead and the recoil cracks plating on anything smaller than a dreadnought — the Foundry's heaviest alpha strike.",
    category: "weapon",
    // 120 kg @ 12 km/s (superDriver band). Muzzle energy ½·120·12000² = 8.64 GJ.
    // mass = kineticWeaponMass(120, 12000, 6000)
    //      = 6000 × (8.64e9 / 2e7) = 2,592,000 kg (~2,592 t) — ~9.6× the 1-cell
    // heavy cannon for the higher capability anchor band.
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
];
