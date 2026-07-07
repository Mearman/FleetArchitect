import type { ModuleDefinitionInput } from "@/schema/module";
import {
  beamWeaponMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  magazineMass,
  reactorMass,
  shieldMass,
} from "../physics";
import {
  BEAM_POWER_W,
  BEAM_RANGE_M,
  FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
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
import {
  ENGINE_DENSITY,
  MAGAZINE_DENSITY,
  REACTOR_DENSITY,
  SENSOR_DENSITY,
  SHIELD_DENSITY,
  SWARM_MISSILE_WARHEAD_J,
  WEAPON_DENSITY,
} from "./corsair";

// ---------------------------------------------------------------------------
// Corsair Reavers capital multi-cell modules.
//
// The single-cell catalogue in `corsair.ts` spans fighter → frigate → cruiser
// capability, with its existing 1×2 capital variants (broadside swarm rack,
// heavy raid cannon, scrambler array, raider screen array, raid drive bank,
// overdrive reactor) authored at the bottom of that file. The modules here
// BROADEN the Corsair shape vocabulary beyond the all-1×2 lines it has used so
// far: L-trominoes, 2×2 blocks, a plus-shape, and a 1×3 line — filling the
// doctrine gaps a raider fleet hits at capital scale (no beam, no hangar, no
// plus-shape jammer, no triple-drive, no deep magazine vault).
//
// Each module's mass still traces to the SAME physics-layer helpers
// (`kineticWeaponMass`, `beamWeaponMass`, `engineMass`, `shieldMass`,
// `magazineMass`) applied to a heavier/doubled capability anchor, so a stronger
// capital module is proportionally heavier — by physics, not by a size class.
// The Corsair material densities (WEAPON_DENSITY etc.) are imported from
// `corsair.ts` so the multi-cell variants share the single-cell catalogue's
// scavenged-junk material — no drift.
//
// Isolated into its own file so `corsair.ts` stays under the per-file max-lines
// guard (mirroring the `terran.ts` / `terran-capital.ts` split). Preset designs
// import `CORSAIR_CAPITAL_FOOTPRINTS` to install matching `covers` back-pointers
// via `mountMultiCell` (`data/presets/tokens.ts`).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capital anchors.
//
// Each constant is a multiple of an existing single-cell band (a 3-cell heavy
// swarm rack, a triple raider drive, a 4-cell light-shield bastion, a 3-cell
// magazine vault), so capability scales visibly across the fighter → capital
// span and mass follows from the physics helpers, never hand-tuned.
// ---------------------------------------------------------------------------

/** Raider drive rated thrust (N) — re-derived from the same `driveThrustNewtons`
 *  anchor the single-cell `corsair.ts` uses, so the multi-cell drive variants
 *  share the raid drive's exhaust velocity and agility. */
const raiderThrustN = driveThrustNewtons("raider");

/** Salvaged beam-emitter density (kg/m³) — a mid-density ~2500 kg/m³ for a
 *  salvaged pulse cutter: heavier than a precision emitter, lighter than a
 *  forged one. The first Corsair beam weapon is jury-rigged, not built. */
const SALVAGED_EMITTER_DENSITY = 2500;

/** Salvage cutter refire (ticks) — a salvaged pulse emitter on a ~1.2 s cycle,
 *  slightly slower than a Terran pulse laser's 1 s cool. */
const SALVAGE_CUTTER_COOLDOWN = cooldownTicks(1.2);

/** Salvage cutter sustained beam power (W) — the capital-grade sustained power
 *  of a salvaged pulse emitter, sized so a two-cell cutter's per-shot pulse
 *  lands in the capital band on its 1.2 s cycle. Local to this module so the
 *  shared `BEAM_POWER_W.pulse` anchor (the single-cell pulse band) is
 *  untouched; the cutter's mass and powerDraw re-derive from this anchor too. */
const SALVAGE_CUTTER_POWER_W = 50 * BEAM_POWER_W.pulse;

/** Raider core output target (~25 GW) — the capital-grade reactor a Galleon
 *  needs to feed a 15 GW salvage cutter with comfortable headroom for the
 *  shield recharge, drives, and sensors a capital hull runs alongside its
 *  main battery. Sized ~10× the overdrive reactor's 2.4 GW at the same
 *  advanced-fusion density band, so mass scales visibly across the
 *  frigate → capital span. */
const RAIDER_CORE_OUTPUT_W = 2.5e10;

// --- K2 Heavy Swarm Rack ordnance anchors (L-tromino, 3 cells) -------------

/** Heavy swarm-missile body mass (kg) — the heavyAutocannon band (3 kg), one
 *  band above the swarm's 1 kg, a heavier saturation body for the triple-rail
 *  rack. */
const HEAVY_SWARM_MASS_KG = PROJECTILE_MASS_KG.heavyAutocannon;
/** Heavy swarm-missile cruise velocity (m/s) — autocannon/2, matching the
 *  swarm rack's feed cadence. */
const HEAVY_SWARM_CRUISE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon / 2;
/** Heavy swarm-missile warhead yield (J) — 150× the swarm's 80 MJ, a heavier
 *  saturation warhead fired in volleys of three rails. */
const HEAVY_SWARM_WARHEAD_J = 150 * SWARM_MISSILE_WARHEAD_J;
/** Heavy swarm-missile finite-burn motor — DERIVED from the missile burn-time
 *  band (same cruise/burn as the swarm missile). */
const HEAVY_SWARM_THRUST_M_PER_S2 = poweredMotorThrustMPerS2(
  HEAVY_SWARM_CRUISE_MS,
  ORDNANCE_BURN_TIME_S.missile,
);
const HEAVY_SWARM_BURN_TICKS = poweredMotorBurnTicks(ORDNANCE_BURN_TIME_S.missile);
/** Heavy swarm-rack salvo interval (ticks) — a triple-rail recycles at the
 *  swarm's ~1.7 s cadence. */
const HEAVY_SWARM_COOLDOWN = cooldownTicks(50 / 30);
/** Heavy swarm-rack stored rounds — a 3-cell rack's reserve, scaling the
 *  broadside's 140 rounds by the extra rail. */
const HEAVY_SWARM_AMMO_CAPACITY = 180;

// --- K3 Twin Raid Cannon anchors (1×2 line, 2 cells) -----------------------

/** Twin raid-cannon round mass (kg) — 100× the raid cannon's 1 kg autocannon
 *  band, two ganged capital-scale barrels firing a paired slug. */
const TWIN_RAID_MASS_KG = 100 * PROJECTILE_MASS_KG.autocannon;
/** Twin raid-cannon muzzle velocity (m/s) — the autocannon band, matching the
 *  raid cannon's fast light slug. */
const TWIN_RAID_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;

// --- K5 Raider Shield Bastion anchors (2×2 block, 4 cells) -----------------

/** Raider shield-bastion capacity (J) — 4× the light shield's 200 MJ, four
 *  scavenged projectors folded into a frigate-grade bubble. */
const RAIDER_BASTION_CAPACITY_J = 4 * SHIELD_CAPACITY_J.light;
/** Raider shield-bastion recharge (W) — 4× the light shield's recharge. */
const RAIDER_BASTION_RECHARGE_W = 4 * SHIELD_RECHARGE_W.light;

// --- K7 Triple Raid Drive anchors (1×3 line, 3 cells) ----------------------

/** Triple raid-drive rated thrust (N) — 3× the raider drive's thrust, three
 *  ganged nozzles on one drive train. */
const TRIPLE_DRIVE_THRUST_N = 3 * raiderThrustN;

// --- K8 Salvage Magazine Vault anchors (L-tromino, 3 cells) ----------------

/** Salvage magazine vault stored rounds — 3× the standard missile magazine's
 *  280 rounds, a three-lobed deep reserve for a sustained raid. */
const SALVAGE_VAULT_ROUNDS = 3 * 280;

/**
 * Footprint polyominoes for the Corsair capital multi-cell modules — each
 * anchored at `{0,0}` (the cell the equipment record lives on) and listed in
 * stable offset order. The module literals below author these on each
 * definition; preset designs import the same shapes to install matching
 * `covers` back-pointers via `mountMultiCell` (`data/presets/tokens.ts`), so
 * the catalogue and the design agree on each module's shape without
 * re-authoring it.
 *
 * Distinct from `CORSAIR_FOOTPRINTS` in `corsair.ts` (the existing 1×2 capital
 * variants) so the two sets do not collide as this file grows.
 */
export const CORSAIR_CAPITAL_FOOTPRINTS = {
  /** 1×2 line — a two-cell salvaged beam emitter. */
  salvageCutter: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** L-tromino — a three-rail broadside launcher. */
  heavySwarmRack: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** 1×2 line — two ganged raid-cannon barrels. */
  twinRaidCannon: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 2×2 block — a four-cell jury-rigged drone bay. */
  droneSpawner: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** 2×2 block — four scavenged shield projectors. */
  raiderShieldBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** Plus-shape — a wide-aperture five-cell jammer hub. */
  plusScramblerHub: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ],
  /** 1×3 line — three ganged raid drives along the stern. */
  raiderDriveTriple: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  /** L-tromino — a three-lobed deep magazine vault. */
  salvageMagazineVault: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** 2×2 block — a four-cell advanced-fusion capital reactor. */
  raiderCore: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
};

/**
 * Corsair capital multi-cell module definitions — polyomino-footprint variants
 * that broaden the Corsair shape vocabulary beyond the all-1×2 lines in
 * `corsair.ts`. Each occupies the cells its footprint lists (the anchor at
 * `{0,0}` plus its covers); a design installs the anchor as one equipment
 * record and marks each covered cell with a `covers` back-pointer to the
 * anchor (see `mountMultiCell` in `data/presets/tokens.ts`). Mass traces to
 * the same physics helpers via the heavier capital anchors above.
 *
 * Capital weapons use heavier capability anchors than their single-cell
 * cousins (a heavier round, a higher sustained beam power, a larger warhead),
 * so a polyomino weapon hits proportionally harder per shot — mass and damage
 * scale together by physics, both folded into the same anchor.
 */
export const corsairCapitalModules: ModuleDefinitionInput[] = [
  {
    id: "cor-salvage-cutter",
    faction: "Corsair",
    name: "Salvage Cutter Beam",
    description:
      "A two-cell salvaged pulse cutter — the first beam weapon the Reavers ever fielded, bolted together from a stripped-down disruptor and a scavenged cooling jacket. Cuts through plating to gut the modules underneath; a raider's answer to a target that still has hull when the missiles run dry.",
    category: "weapon",
    // Salvaged pulse emitter at the capital cutter band (1.5e10 W), massed at a
    // mid salvaged-emitter density between a precision and a forged stack.
    // mass = 2500 × (1.5e10 / 4e7) = 937,500 kg (~938 t).
    mass: beamWeaponMass(SALVAGE_CUTTER_POWER_W, SALVAGED_EMITTER_DENSITY),
    cost: 110,
    // A beam's draw IS its delivered optical power.
    powerDraw: SALVAGE_CUTTER_POWER_W,
    crewRequired: 1,
    techLevel: 2,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.salvageCutter,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(SALVAGE_CUTTER_POWER_W, SALVAGE_CUTTER_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: SALVAGE_CUTTER_COOLDOWN,
      // Hitscan beam: no projectile.
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.3,
      armourPiercing: 0.3,
      spread: 0,
    },
  },
  {
    id: "cor-heavy-swarm-rack",
    faction: "Corsair",
    name: "Heavy Swarm Rack",
    description:
      "A three-rail broadside launcher throwing a heavier swarm of light missiles in a staggered volley. The L-tromino rack the Warbringer hides in its broadside — saturate a cruiser's point defence on the pass, then break contact before the return fire lands.",
    category: "weapon",
    // 3 kg body at the autocannon-band cruise (the swarm's feed), 1.5× launcher
    // fraction scaling the single swarm rack's 0.8 jury-rig factor.
    // mass = kineticWeaponMass(3, 4000, 2800) × 1.5
    //      = 2800 × (½·3·4000² / 2e7) × 1.5 = 5,040 kg (~5 t).
    mass:
      kineticWeaponMass(
        HEAVY_SWARM_MASS_KG,
        MUZZLE_VELOCITY_M_PER_S.autocannon,
        WEAPON_DENSITY,
      ) * 1.5,
    cost: 170,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 3,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.heavySwarmRack,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: HEAVY_SWARM_WARHEAD_J,
      range: MISSILE_RANGE_M,
      cooldown: HEAVY_SWARM_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(HEAVY_SWARM_CRUISE_MS),
      projectileMass: HEAVY_SWARM_MASS_KG,
      tracking: 3.5,
      shieldPiercing: 0.1,
      armourPiercing: 0.3,
      spread: 0.6,
      // Broadside mount: narrow turret arc (π/3), slower turn rate (0.06).
      turretArc: Math.PI / 3,
      turretTurnRate: 0.06,
      powered: true,
      guided: true,
      thrust: HEAVY_SWARM_THRUST_M_PER_S2,
      burnTicks: HEAVY_SWARM_BURN_TICKS,
      // Finite magazine: `ammo` start count mirrors `ammoCapacity` so the
      // heavy rack begins full and the crew-haul economy refills it as it fires.
      ammo: HEAVY_SWARM_AMMO_CAPACITY,
      ammoCapacity: HEAVY_SWARM_AMMO_CAPACITY,
    },
  },
  {
    id: "cor-twin-raid-cannon",
    faction: "Corsair",
    name: "Twin Raid Cannon",
    description:
      "Two ganged raid-cannon barrels on one mount — double the round mass of the single raid cannon at the same fast muzzle, for finishing what the missiles strip when a single barrel isn't enough. Cheap, punchy, and small enough to mount on a fighter.",
    category: "weapon",
    // 100 kg @ 4 km/s (100× the raid cannon's 1 kg autocannon band). Muzzle
    // energy ½·100·4000² = 800 MJ; mass = 2800 × (8e8 / 2e7) = 112,000 kg
    // (~112 t).
    mass: kineticWeaponMass(TWIN_RAID_MASS_KG, TWIN_RAID_MUZZLE_MS, WEAPON_DENSITY),
    cost: 90,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 2,
    techLevel: 2,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.twinRaidCannon,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(TWIN_RAID_MASS_KG, TWIN_RAID_MUZZLE_MS),
      range: kineticRangeM(TWIN_RAID_MUZZLE_MS),
      cooldown: cooldownTicks(RELOAD_THERMAL_TIME_S.autocannon),
      projectileSpeed: projectileSpeedMPerTick(TWIN_RAID_MUZZLE_MS),
      projectileMass: TWIN_RAID_MASS_KG,
      tracking: 1.2,
      shieldPiercing: 0.15,
      armourPiercing: 0.25,
      spread: 0.05,
      // Ballistic slug: unpowered and unguided, like the raid cannon.
      powered: false,
      guided: false,
    },
  },
  {
    id: "cor-drone-spawner",
    faction: "Corsair",
    name: "Drone Spawner",
    description:
      "A four-cell jury-rigged fabrication and launch bay spitting a swarm of disposable combat drones. The Reavers' first carrier capability — stolen drone schematics welded into a scavenger hull, put into space before the lines close to overload a defender's point defence.",
    category: "weapon",
    // Four cells of jury-rigged fabrication: four times a single drone bay's
    // derived autocannon-class kinetic mass at an 0.8 jury-rig fraction.
    // mass = 4 × (kineticWeaponMass(1, 4000, 2800) × 0.8)
    //      = 4 × (2800 × (8e6 / 2e7) × 0.8) = 3,584 kg (~3.6 t).
    mass:
      4 *
      (kineticWeaponMass(
        PROJECTILE_MASS_KG.autocannon,
        MUZZLE_VELOCITY_M_PER_S.autocannon,
        WEAPON_DENSITY,
      ) *
        0.8),
    cost: 220,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 2,
    techLevel: 3,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.droneSpawner,
    effect: {
      kind: "hangar",
      droneCount: 8,
      launchCooldown: 80,
      droneHp: 30,
      droneDamage: 200,
      droneRange: 80,
      droneSpeed: 6,
    },
  },
  {
    id: "cor-raider-shield-bastion",
    faction: "Corsair",
    name: "Raider Shield Bastion",
    description:
      "A four-cell shield projector folding four scavenged screens into a 2×2 bastion — a frigate-grade bubble that steps the raider screen up to capital soak. Enough front-loaded protection to survive the opening exchange of a dreadnought ambush before the torpedoes land.",
    category: "defence",
    // 4× the light shield's 200 MJ capacity (800 MJ) at the Corsair shield
    // density. mass = 1500 × (8e8 / 1.3e7) = 92,308 kg (~92 t).
    mass: shieldMass(RAIDER_BASTION_CAPACITY_J, SHIELD_DENSITY),
    cost: 180,
    // A shield's draw IS its recharge wattage; four projectors draw 4×.
    powerDraw: RAIDER_BASTION_RECHARGE_W,
    crewRequired: 0,
    techLevel: 3,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.raiderShieldBastion,
    effect: {
      kind: "shield",
      capacity: RAIDER_BASTION_CAPACITY_J,
      rechargeRate: RAIDER_BASTION_RECHARGE_W,
      rechargeDelay: 70,
    },
  },
  {
    id: "cor-plus-scrambler-hub",
    faction: "Corsair",
    name: "Plus Scrambler Hub",
    description:
      "A wide-aperture five-cell jammer hub laid out in a plus — a capital ECM cross-roads that strips nearly all the tracking from incoming guided fire and breaks missile lock better than one in three times. The Reaver answer to a missile-heavy dreadnought covering the target.",
    category: "defence",
    // Five cells of the scrambler's sensor-density jammer stack.
    // mass = 5 × (1200 × (54000 / 5000) × 0.15) = 9,720 kg (~9.7 t).
    mass: 5 * engineMass(raiderThrustN, SENSOR_DENSITY) * 0.15,
    cost: 220,
    powerDraw: 5 * MODULE_POWER_DRAW_W.sensor,
    crewRequired: 3,
    techLevel: 4,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.plusScramblerHub,
    effect: {
      kind: "ecm",
      trackingReduction: 0.85,
      lockBreakChance: 0.35,
    },
  },
  {
    id: "cor-raider-drive-triple",
    faction: "Corsair",
    name: "Triple Raid Drive",
    description:
      "Three raider drives ganged along a 1×3 thrust-train — capital-scale agility for a hull that still wants to close to missile range in a hurry and break contact when the volley is spent. Exactly 3× the raid drive bank's thrust at the same exhaust velocity.",
    category: "propulsion",
    // 162 kN thrust (3 × 54 kN) at the light Corsair engine density.
    // mass = 2500 × (162000 / 5000) = 81,000 kg (~81 t).
    mass: engineMass(TRIPLE_DRIVE_THRUST_N, ENGINE_DENSITY),
    cost: 90,
    powerDraw: 3 * MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 3,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.raiderDriveTriple,
    effect: { kind: "engine", thrust: TRIPLE_DRIVE_THRUST_N },
  },
  {
    id: "cor-salvage-magazine-vault",
    faction: "Corsair",
    name: "Salvage Magazine Vault",
    description:
      "A three-lobed deep magazine vault — triple the missile reserve of the standard magazine, packed into a scavenger L-tromino bay behind blast doors. Lets a dreadnought sustain a raid long after a single magazine would have run dry.",
    category: "system",
    // 840 rounds (3 × 280) at the Corsair magazine density.
    // mass = 4000 × (840 / 30) = 112,000 kg (~112 t).
    mass: magazineMass(SALVAGE_VAULT_ROUNDS, MAGAZINE_DENSITY),
    cost: 100,
    powerDraw: MODULE_POWER_DRAW_W.magazine,
    crewRequired: 2,
    techLevel: 3,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.salvageMagazineVault,
    effect: { kind: "magazine", ammoStored: SALVAGE_VAULT_ROUNDS },
  },
  {
    id: "cor-raider-core",
    faction: "Corsair",
    name: "Raider Core",
    description:
      "A four-cell advanced-fusion command reactor — the salvaged heart of a Galleon, bolted together from stripped cruiser cores and over-tuned to push the advanced-fusion density band past anything a frigate reactor can sink. Sized to light a 15 GW salvage cutter with headroom for shields, drives, and sensors; without it, the cutter's draw would black out the hull the moment it fired.",
    category: "system",
    // 25 GW @ 6e7 W/m³ (advanced-fusion density, ~10× the overdrive reactor's
    // 2.4 GW output at the same band). The reactor's mass traces to its output
    // via reactorMass — a denser core is proportionally lighter for the same
    // watts, but a capital reactor is still thousands of tonnes.
    // mass = reactorMass(2.5e10, 6e7, 3000) = 3000 × (2.5e10 / 6e7) = 1,250,000 kg
    // (~1250 t) — heavy, but mass is not fault-gated; only power, crew, and
    // cost are checked.
    mass: reactorMass(
      RAIDER_CORE_OUTPUT_W,
      FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
      REACTOR_DENSITY,
    ),
    cost: 200,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 4,
    footprint: CORSAIR_CAPITAL_FOOTPRINTS.raiderCore,
    effect: { kind: "power", output: RAIDER_CORE_OUTPUT_W },
  },
];
