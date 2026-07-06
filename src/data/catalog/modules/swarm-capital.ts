import type { ModuleDefinitionInput } from "@/schema/module";
import {
  beamWeaponMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  magazineMass,
  reactorMass,
  deflectorMass,
} from "../physics";
import {
  BEAM_POWER_W,
  BEAM_RANGE_M,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  FUSION_COMPACT_POWER_DENSITY_W_PER_M3,
  MISSILE_RANGE_M,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  PROJECTILE_MASS_KG,
  RELOAD_THERMAL_TIME_S,
  beamDamageJoules,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
} from "../combat-scale";
import {
  STING_BURN_TICKS,
  STING_CRUISE_MS,
  STING_LAUNCHER_COOLDOWN,
  STING_THRUST_M_PER_S2,
  STING_WARHEAD_J,
  SWARM_BEAM_DENSITY_KG_PER_M3,
  SWARM_ENGINE_DENSITY_KG_PER_M3,
  SWARM_MAGAZINE_DENSITY_KG_PER_M3,
  SWARM_REACTOR_DENSITY_KG_PER_M3,
  SWARM_WEAPON_DENSITY_KG_PER_M3,
} from "./swarm";

// ---------------------------------------------------------------------------
// Swarm capital multi-cell modules.
//
// The single-cell catalogue in `swarm.ts` spans fighter → frigate → cruiser
// capability on one cell each. The modules here are the multi-cell capital
// variants: each occupies a polyomino footprint and re-anchors its capability
// at a multiple of the single-cell band (a 4-cell bloom cannon, a 3-cell acid
// bank, a 3.6 GW metabolic heart, a 4-cell tentacle drive mass, a heavy
// barkweave carapace). Their mass still traces to the SAME physics-layer
// helpers (`kineticWeaponMass`, `beamWeaponMass`, `engineMass`, `reactorMass`,
// `magazineMass`, `deflectorMass`) applied to these heavier anchors at the
// Swarm bio-organic densities re-exported from `swarm.ts`, so a stronger
// capital module is proportionally heavier — by physics, not by a size class.
//
// Isolated from `swarm.ts` so that file stays under the per-file max-lines
// guard (mirroring the `terran.ts` / `terran-capital.ts` split). The catalog
// index (`data/catalog/index.ts`) concatenates these onto `swarmModules`;
// preset designs import `SWARM_FOOTPRINTS` to install matching `covers`
// back-pointers via `coverFootprint` (`data/presets/tokens.ts`).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capital anchors.
//
// Each constant is a multiple of an existing single-cell Swarm band (2× the
// spore round, 3× the acid gland power, 3× the compact-fusion ganglion, 4×
// the lightPlasma drive), so capability scales visibly across the
// fighter → capital span and mass follows from the physics helpers, never
// hand-tuned.
// ---------------------------------------------------------------------------

/** Spore battery projectile mass (kg) — 2× the spore round (the autocannon
 *  banding), the same muzzle so a twin-chambered gland doubles the weight of
 *  fire for the same launch energy per round. */
const SPORE_BATTERY_MASS_KG = 2 * PROJECTILE_MASS_KG.autocannon;
/** Spore battery muzzle velocity (m/s) — the autocannon band (4 km/s). */
const SPORE_BATTERY_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;
/** Spore battery cyclic interval (s) — matches the single spore launcher. */
const SPORE_BATTERY_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.autocannon);

/** Acid bank sustained beam power (W) — 3× the acid sprayer's pdPulse band,
 *  feeding three converging nozzles from one enlarged corrosive reservoir. */
const ACID_BANK_POWER_W = 3 * BEAM_POWER_W.pdPulse;
/** Acid bank bio-chemical recharge (s) — the same fast gland cycle as the acid
 *  sprayer; the larger reservoir sustains a heavier jet on the same rhythm. */
const ACID_BANK_COOLDOWN = cooldownTicks(0.7);

/** Bloom cannon projectile mass (kg) — the heavyAutocannon band (3 kg), a dense
 *  spore-mass at capital scale. */
const BLOOM_CANNON_MASS_KG = PROJECTILE_MASS_KG.heavyAutocannon;
/** Bloom cannon muzzle velocity (m/s) — the heavyAutocannon band (5 km/s). */
const BLOOM_CANNON_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.heavyAutocannon;
/** Bloom cannon load cycle (s) — the heavyAutocannon thermal-recovery band. */
const BLOOM_CANNON_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.heavyAutocannon);

/** Metabolic heart output (W) — 3× the compact-fusion ganglion (1.2 GW), the
 *  mid-band Swarm reactor between the ganglion and the 5 GW antimatter core. */
const METABOLIC_HEART_OUTPUT_W = 3 * 1.2e9;

/** Tentacle drive mass thrust (N) — 4× the lightPlasma band, four muscular jet
 *  organs co-ordinated as a 2×2 capital drive cluster. */
const TENTACLE_DRIVE_THRUST_N = 4 * driveThrustNewtons("lightPlasma");

/** Ammon vault round reserve — 2× the ammon sac's 250, two linked fermentation
 *  chambers. */
const AMMON_VAULT_ROUNDS = 2 * 250;

// ---------------------------------------------------------------------------
// Catalogue-expansion anchors (fighter-grade 2-cell lines through capital
// plus-shapes). Each is a multiple of an existing single-cell Swarm band, so
// capability scales visibly across the fighter → capital span and mass follows
// from the SAME physics helpers at Swarm bio-organic densities — no hand-tuned
// literals. Imported sting anchors (STING_*) carry the neural-sting's authored
// warhead, cruise velocity and motor derivation so the twin-sting launcher
// tracks the single-cell sting without duplicating its authored 6e7 J warhead.
// ---------------------------------------------------------------------------

/** Ion-drive thrust proxy for small organic subsystems (a spawner bay, a blink
 *  sac) — the same anchor `swarm.ts` uses for sensors/comms/PD fractions. */
const SWARM_ION_THRUST_N = driveThrustNewtons("ion");

/** Acid dripper bio-gland recharge (s): the same fast 0.7 s cycle as the acid
 *  sprayer, feeding two converging nozzles from one enlarged corrosive gland. */
const ACID_DRIPPER_COOLDOWN = cooldownTicks(0.7);

/** Bile mortar projectile mass (kg) — the gauss band (20 kg), a dense lobbed
 *  spore-mass at cruiser scale. */
const BILE_MORTAR_MASS_KG = PROJECTILE_MASS_KG.gauss;
/** Bile mortar muzzle velocity (m/s) — half the gauss band (a lobbed, arcing
 *  bio-mortar round, slower than a straight-launched slug). */
const BILE_MORTAR_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.gauss / 2;
/** Bile mortar load cycle (s) — the gauss thermal-recovery band. */
const BILE_MORTAR_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.gauss);

/** Radial metabolic heart output (W) — 5× the compact-fusion ganglion (6 GW),
 *  a plus-section command core between the metabolic heart and the antimatter
 *  metabolic core. */
const PLUS_METABOLIC_HEART_OUTPUT_W = 5 * 1.2e9;

/** Heavy flagellum mass thrust (N) — 4× the plasma band, four muscular jet
 *  organs co-ordinated as a 2×2 capital drive cluster (above the tentacle
 *  drive's lightPlasma banding). */
const HEAVY_FLAGELLUM_THRUST_N = 4 * driveThrustNewtons("plasma");

/** Ammon cyst round reserve — 3× the ammon sac's 250, three lobed fermentation
 *  chambers (the crewed capital magazine line). */
const AMMON_CYST_ROUNDS = 3 * 250;

/**
 * Footprint polyominoes for the capital multi-cell modules — each anchored at
 * `{0,0}` (the cell the equipment record lives on) and listed in stable offset
 * order. The module literals below author these on each definition; preset
 * designs import the same shapes to install matching `covers` back-pointers
 * via `coverFootprint` (`data/presets/tokens.ts`), so the catalogue and the
 * design agree on each module's shape without re-authoring it.
 */
export const SWARM_FOOTPRINTS = {
  sporeBattery: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  acidBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  bloomCannon: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  metabolicHeart: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 },
  ],
  tentacleDriveMass: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  barkweaveCarapace: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  ammonVault: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  // --- Catalogue-expansion polyominoes (fighter-grade 2-cell lines through
  // capital plus-shapes and 2x2 blobs). Each anchors at {0,0}; negative offsets
  // reach into the previous coarse block, so the mount plan must keep that
  // neighbour solid. See designs-swarm.ts for the matching mountMultiCell
  // anchors. ---
  /** Twin sting launcher: 2-cell horizontal gland (frigate grade). */
  twinStingLauncher: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Acid dripper: 2-cell corrosive beam (frigate grade). */
  acidDripper: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Bile mortar: L-tromino slow-lob heavy kinetic (cruiser grade). */
  bileMortar: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** Spore-mine organ: 2-cell mine-laying gland. */
  sporeMineOrgan: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Spore-drone spawner: 2x2 bloated brood bay (capital grade). */
  sporeDroneSpawner: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** Phase-blink sac: 2-cell tactical-jump organ. */
  blinkSac: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Bulwark carapace: 3-cell ridged momentum screen (capital grade). */
  bulwarkCarapace: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  /** Ammon cyst: L-tromino extended ammunition reservoir (crewed). */
  ammonCyst: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** Radial metabolic heart: plus-shape compound command reactor (capital). */
  plusMetabolicHeart: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ],
  /** Heavy flagellum mass: 2x2 capital drive cluster. */
  heavyFlagellumMass: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
};

/**
 * Swarm capital multi-cell module definitions — polyomino-footprint variants of
 * the single-cell catalogue. Each occupies the cells its footprint lists (the
 * anchor at `{0,0}` plus its covers); a design installs the anchor as one
 * equipment record and marks each covered cell with a `covers` back-pointer to
 * the anchor (see `coverFootprint` in `data/presets/tokens.ts`). Mass traces to
 * the same physics helpers via the heavier capital anchors above at Swarm
 * bio-organic densities. Like every Swarm weapon these are bio-autonomous:
 * crewRequired 0, except the ammon vault (the one Swarm module line that is
 * crewed, scaling crew with cells).
 */
export const swarmCapitalModules: ModuleDefinitionInput[] = [
  {
    id: "swm-spore-battery",
    faction: "Swarm",
    name: "Spore Battery",
    description:
      "Twin-chambered spore gland feeding a shared cyclic launcher. Two fermentation lobes double the weight of fire of a single spore gun for a modest increase in bulk — the Swarm's lightest multi-cell kinetic. Bio-autonomous (no crew, like every Swarm weapon).",
    category: "weapon",
    // 2 kg @ 4 km/s. Muzzle energy ½·2·4000² = 16 MJ.
    // mass = kineticWeaponMass(2, 4000, 2200) = 2200 × (16e6 / 2e7) = 1760 kg.
    mass: kineticWeaponMass(
      SPORE_BATTERY_MASS_KG,
      SPORE_BATTERY_MUZZLE_MS,
      SWARM_WEAPON_DENSITY_KG_PER_M3,
    ),
    cost: 80,
    // Two chambers draw twice the single spore launcher's kinetic draw.
    powerDraw: 2 * MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 2,
    footprint: SWARM_FOOTPRINTS.sporeBattery,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(SPORE_BATTERY_MASS_KG, SPORE_BATTERY_MUZZLE_MS) * 50,
      range: kineticRangeM(SPORE_BATTERY_MUZZLE_MS),
      cooldown: SPORE_BATTERY_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(SPORE_BATTERY_MUZZLE_MS),
      projectileMass: SPORE_BATTERY_MASS_KG,
      tracking: 0.8,
      shieldPiercing: 0.15,
      armourPiercing: 0,
      spread: 0.12,
      // Ballistic spore burst: unpowered and unguided.
      powered: false,
      guided: false,
    },
  },
  {
    id: "swm-acid-bank",
    faction: "Swarm",
    name: "Acid Bank",
    description:
      "A lobed corrosive reservoir feeding three converging spray nozzles, grown in an L-shape so each nozzle covers a distinct firing arc. The enlarged acid volume sustains a heavier corrosive jet that strips armour far faster than a single sprayer; the bio-chemical gland keeps the Swarm's fast recharge cycle.",
    category: "weapon",
    // 3× the pdPulse band = 3e8 W. mass = beamWeaponMass(3e8, 1800) = 1800 × 7.5 = 13,500 kg.
    mass: beamWeaponMass(ACID_BANK_POWER_W, SWARM_BEAM_DENSITY_KG_PER_M3),
    cost: 155,
    // A beam's draw IS its delivered optical power.
    powerDraw: ACID_BANK_POWER_W,
    crewRequired: 0,
    techLevel: 2,
    footprint: SWARM_FOOTPRINTS.acidBank,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(ACID_BANK_POWER_W, ACID_BANK_COOLDOWN) * 50,
      range: BEAM_RANGE_M,
      cooldown: ACID_BANK_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0,
      armourPiercing: 0.45,
      spread: 0,
    },
  },
  {
    id: "swm-bloom-cannon",
    faction: "Swarm",
    name: "Bloom Cannon",
    description:
      "A four-chambered bio-cannon grown around a chitin-lined bore. It launches a dense spore-mass at capital scale using the heavyAutocannon band (3 kg @ 5000 m/s) — the Swarm's answer to a cruiser's main battery, slow-cycling but devastating per hit. Mass and damage both derive from the same muzzle-energy figure, so the capital scaling is physical, not tuned.",
    category: "weapon",
    // 3 kg @ 5 km/s. Muzzle energy ½·3·5000² = 37.5 MJ.
    // mass = kineticWeaponMass(3, 5000, 2200) = 2200 × (37.5e6 / 2e7) = 4125 kg.
    mass: kineticWeaponMass(
      BLOOM_CANNON_MASS_KG,
      BLOOM_CANNON_MUZZLE_MS,
      SWARM_WEAPON_DENSITY_KG_PER_M3,
    ),
    cost: 170,
    // Four chambers draw four times the single kinetic draw.
    powerDraw: 4 * MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 3,
    footprint: SWARM_FOOTPRINTS.bloomCannon,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(BLOOM_CANNON_MASS_KG, BLOOM_CANNON_MUZZLE_MS) * 50,
      range: kineticRangeM(BLOOM_CANNON_MUZZLE_MS),
      cooldown: BLOOM_CANNON_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(BLOOM_CANNON_MUZZLE_MS),
      projectileMass: BLOOM_CANNON_MASS_KG,
      tracking: 0.8,
      shieldPiercing: 0.2,
      armourPiercing: 0.1,
      spread: 0.1,
      // Ballistic spore-mass: unpowered and unguided.
      powered: false,
      guided: false,
    },
  },
  {
    id: "swm-metabolic-heart",
    faction: "Swarm",
    name: "Metabolic Heart",
    description:
      "A compound bio-reactor of three fusion-heated digestive lobes. It amplifies the hive's metabolic output well beyond a single ganglion, feeding the energy-hungry weapons of a capital bio-form. Like the existing Swarm reactors it doubles as a command node.",
    category: "system",
    // 3.6 GW @ 4e7 W/m³ (compact-fusion density), bio-organic containment.
    // mass = reactorMass(3.6e9, 4e7, 2500) = 2500 × 90 = 225,000 kg.
    mass: reactorMass(
      METABOLIC_HEART_OUTPUT_W,
      FUSION_COMPACT_POWER_DENSITY_W_PER_M3,
      SWARM_REACTOR_DENSITY_KG_PER_M3,
    ),
    cost: 140,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 2,
    footprint: SWARM_FOOTPRINTS.metabolicHeart,
    effect: { kind: "power", output: METABOLIC_HEART_OUTPUT_W },
    command: true,
  },
  {
    id: "swm-tentacle-drive-mass",
    faction: "Swarm",
    name: "Tentacle Drive Mass",
    description:
      "A dense 2×2 cluster of four muscular jet organs. Co-ordinated contraction cycles deliver capital-scale thrust, driving the largest bio-forms through space with unsettling speed. Gimbals like the pulse-jet organ, so a heavy bio-hull can still vector its thrust.",
    category: "propulsion",
    // 4× lightPlasma = 320 kN. mass = engineMass(320000, 2000) = 2000 × 64 = 128,000 kg.
    mass: engineMass(TENTACLE_DRIVE_THRUST_N, SWARM_ENGINE_DENSITY_KG_PER_M3),
    cost: 130,
    // Four organs draw four times the single drive's conditioning load.
    powerDraw: 4 * MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 3,
    footprint: SWARM_FOOTPRINTS.tentacleDriveMass,
    effect: {
      kind: "engine",
      thrust: TENTACLE_DRIVE_THRUST_N,
      gimbalArc: Math.PI / 8,
    },
  },
  {
    id: "swm-barkweave-carapace",
    faction: "Swarm",
    name: "Barkweave Carapace",
    description:
      "A long ridged deflector plate of woven bio-crystal grown as three layered carapace segments. Together they project a reinforced momentum screen that arrests heavy kinetic strikes across a broad arc — the Swarm's living answer to a mass-driver salvo, scaling the existing carapace screen up to the heavy deflector band.",
    category: "defence",
    // Heavy deflector band: 2e6 kg·m/s. mass = deflectorMass(2e6) = 2000 × (2e6 / 1.5e4) ≈ 266,667 kg.
    mass: deflectorMass(DEFLECTOR_CAPACITY_KG_MPS.heavy),
    cost: 150,
    // A deflector's draw IS its momentum-rebuild rate (mirrors swm-carapace-screen).
    powerDraw: DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy,
    crewRequired: 0,
    techLevel: 2,
    footprint: SWARM_FOOTPRINTS.barkweaveCarapace,
    effect: {
      kind: "deflector",
      capacity: DEFLECTOR_CAPACITY_KG_MPS.heavy,
      rechargeRate: DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy,
      rechargeDelay: 100,
    },
  },
  {
    id: "swm-ammon-vault",
    faction: "Swarm",
    name: "Ammon Vault",
    description:
      "An extended bio-organic ammunition reservoir. Two linked fermentation chambers double the round reserve of an ammon sac, with a second crew member to haul the harvested spore-clusters to hungry weapons. The one Swarm multi-cell module that scales crew, since only the magazine line is crewed in the existing catalogue.",
    category: "system",
    // 500 rounds. mass = magazineMass(500, 3500) = 3500 × (500 / 30) ≈ 58,333 kg.
    mass: magazineMass(AMMON_VAULT_ROUNDS, SWARM_MAGAZINE_DENSITY_KG_PER_M3),
    cost: 110,
    // Two chambers draw twice the single magazine's handling load.
    powerDraw: 2 * MODULE_POWER_DRAW_W.magazine,
    crewRequired: 2,
    techLevel: 2,
    footprint: SWARM_FOOTPRINTS.ammonVault,
    effect: { kind: "magazine", ammoStored: AMMON_VAULT_ROUNDS },
  },

  // ===========================================================================
  // Catalogue expansion — bio-thematic multi-cell variants spanning
  // fighter-grade 2-cell lines through capital plus-shapes and 2x2 blobs.
  // Each mass traces to the SAME physics helpers at Swarm bio-organic
  // densities, applied to a named multiple of an existing single-cell band.
  // Swarm weapons stay bio-autonomous (crewRequired 0); only the ammon cyst
  // (the magazine line) scales crew, mirroring the single-cell ammon sac.
  // ===========================================================================

  {
    id: "swm-twin-sting-launcher",
    faction: "Swarm",
    name: "Twin Sting Launcher",
    description:
      "A paired neural-sting gland — two bio-electric tendrils fed from a shared launcher node. It doubles the weight of homing fire of a single sting for a modest bulk increase, the Swarm's frigate-grade multi-cell ordnance. Bio-autonomous (no crew, like every Swarm weapon).",
    category: "weapon",
    // mass = 2 × kineticWeaponMass(autocannon band) × 0.7 (matching the single
    // sting's organic-bus envelope fraction): two chambers, one launcher node.
    mass:
      2 *
      kineticWeaponMass(
        PROJECTILE_MASS_KG.autocannon,
        MUZZLE_VELOCITY_M_PER_S.autocannon,
        SWARM_WEAPON_DENSITY_KG_PER_M3,
      ) *
      0.7,
    cost: 130,
    // Two chambers draw twice the single sting launcher's handling load.
    powerDraw: 2 * MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 2,
    footprint: SWARM_FOOTPRINTS.twinStingLauncher,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: 2 * STING_WARHEAD_J,
      range: MISSILE_RANGE_M,
      cooldown: STING_LAUNCHER_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(STING_CRUISE_MS),
      projectileMass: PROJECTILE_MASS_KG.autocannon,
      tracking: 3.5,
      shieldPiercing: 0.1,
      armourPiercing: 0.2,
      spread: 0.05,
      // Powered guided bio-electric tendril: same motor as the single sting.
      powered: true,
      guided: true,
      thrust: STING_THRUST_M_PER_S2,
      burnTicks: STING_BURN_TICKS,
    },
  },
  {
    id: "swm-acid-dripper",
    faction: "Swarm",
    name: "Acid Dripper",
    description:
      "An enlarged corrosive gland feeding two converging spray nozzles. The heavier acid volume sustains a beam one band above the acid sprayer's, dissolving armour far faster than a single sprayer while keeping the bio-chemical gland's fast recharge cycle.",
    category: "weapon",
    // pulse band = 3e8 W (3× the acid sprayer's pdPulse).
    // mass = beamWeaponMass(3e8, 1800) = 1800 × 7.5 = 13,500 kg.
    mass: beamWeaponMass(BEAM_POWER_W.pulse, SWARM_BEAM_DENSITY_KG_PER_M3),
    cost: 100,
    // A beam's draw IS its delivered optical power.
    powerDraw: BEAM_POWER_W.pulse,
    crewRequired: 0,
    techLevel: 1,
    footprint: SWARM_FOOTPRINTS.acidDripper,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(BEAM_POWER_W.pulse, ACID_DRIPPER_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: ACID_DRIPPER_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0,
      armourPiercing: 0.45,
      spread: 0,
    },
  },
  {
    id: "swm-bile-mortar",
    faction: "Swarm",
    name: "Bile Mortar",
    description:
      "A lobbed bio-mortar grown in an L-shaped cluster of three digestive sacs. It fires a dense gauss-band spore-mass (20 kg) on a slow, arcing trajectory — the Swarm's cruiser-grade heavy kinetic, slow-cycling but devastating per hit. Mass and damage both derive from the same muzzle-energy figure, so the scaling is physical, not tuned.",
    category: "weapon",
    // 20 kg @ 4.75 km/s (gauss/2, a lobbed arc). Muzzle energy ½·20·4750² = 225 MJ.
    // mass = kineticWeaponMass(20, 4750, 2200) = 2200 × (225e6 / 2e7) = 24,750 kg.
    mass: kineticWeaponMass(
      BILE_MORTAR_MASS_KG,
      BILE_MORTAR_MUZZLE_MS,
      SWARM_WEAPON_DENSITY_KG_PER_M3,
    ),
    cost: 140,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 3,
    footprint: SWARM_FOOTPRINTS.bileMortar,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(BILE_MORTAR_MASS_KG, BILE_MORTAR_MUZZLE_MS),
      range: kineticRangeM(BILE_MORTAR_MUZZLE_MS),
      cooldown: BILE_MORTAR_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(BILE_MORTAR_MUZZLE_MS),
      projectileMass: BILE_MORTAR_MASS_KG,
      tracking: 0.8,
      shieldPiercing: 0.15,
      armourPiercing: 0.1,
      spread: 0.12,
      // Ballistic lobbed spore-mass: unpowered and unguided.
      powered: false,
      guided: false,
    },
  },
  {
    id: "swm-spore-mine-organ",
    faction: "Swarm",
    name: "Spore-Mine Organ",
    description:
      "A bio-mine layering gland grown as two linked chambers. It seeds the Swarm's living proximity mines — static spore clusters that detonate when a hull drifts within their blast radius. The Swarm has no other mine layer; this organ opens area-denial as a new doctrine angle. Bio-autonomous (no crew).",
    category: "weapon",
    // mass = kineticWeaponMass(autocannon band) × 1.2 (a mine organ is a denser
    // launch mechanism than a spore gun, scaling the autocannon envelope up).
    mass:
      kineticWeaponMass(
        PROJECTILE_MASS_KG.autocannon,
        MUZZLE_VELOCITY_M_PER_S.autocannon,
        SWARM_WEAPON_DENSITY_KG_PER_M3,
      ) * 1.2,
    cost: 100,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 2,
    footprint: SWARM_FOOTPRINTS.sporeMineOrgan,
    effect: {
      kind: "mineLayer",
      mineCount: 6,
      mineDamage: 60,
      mineRadius: 80,
      layCooldown: 200,
      armingDelay: 12,
    },
  },
  {
    id: "swm-spore-drone-spawner",
    faction: "Swarm",
    name: "Spore-Drone Spawner",
    description:
      "A bloated 2×2 brood bay that grows and launches autonomous spore-drones — tiny living combatants that swarm a target. Each drone is fragile but fast; the bay replaces losses on a short cycle. A new doctrine angle for the Swarm, turning a capital bio-form into a carrier. Bio-autonomous (no crew).",
    category: "weapon",
    // mass = 4 × (engineMass(ion thrust, Swarm engine density) × 0.3): four
    // fabrication + launch cells, each a small fraction of a bio-engine.
    mass:
      4 *
      (engineMass(SWARM_ION_THRUST_N, SWARM_ENGINE_DENSITY_KG_PER_M3) * 0.3),
    cost: 160,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 3,
    footprint: SWARM_FOOTPRINTS.sporeDroneSpawner,
    effect: {
      kind: "hangar",
      droneCount: 6,
      launchCooldown: 80,
      droneHp: 35,
      droneDamage: 4,
      droneRange: 80,
      droneSpeed: 6,
    },
  },
  {
    id: "swm-blink-sac",
    faction: "Swarm",
    name: "Phase-Blink Sac",
    description:
      "A two-cell organ that folds space across a short tactical range, teleporting the host bio-form to a new position on a short cooldown. The Swarm has no other blink drive; this sac gives a hive-cluster a sudden reposition it could not otherwise manage. Bio-autonomous (no crew).",
    category: "propulsion",
    // mass = 2 × (engineMass(ion thrust, Swarm engine density) × 0.25): two
    // phase-fold cells, each a fraction of a bio-engine (a membrane, not a
    // mechanism).
    mass:
      2 *
      (engineMass(SWARM_ION_THRUST_N, SWARM_ENGINE_DENSITY_KG_PER_M3) * 0.25),
    cost: 140,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 3,
    footprint: SWARM_FOOTPRINTS.blinkSac,
    effect: {
      kind: "blink",
      mode: "tactical",
      jumpRange: 240,
      cooldown: 70,
    },
  },
  {
    id: "swm-bulwark-carapace",
    faction: "Swarm",
    name: "Bulwark Carapace",
    description:
      "A long ridged deflector plate of woven bio-crystal grown as three layered carapace segments. Together they project a reinforced momentum screen at twice the heavy deflector band — the Swarm's capital-grade answer to a mass-driver salvo, scaling the barkweave carapace up to a true bulwark. Bio-autonomous (no crew).",
    category: "defence",
    // 2× heavy deflector band = 4e6 kg·m/s.
    // mass = deflectorMass(4e6) = 2000 × (4e6 / 1.5e4) ≈ 533,333 kg.
    mass: deflectorMass(2 * DEFLECTOR_CAPACITY_KG_MPS.heavy),
    cost: 170,
    // A deflector's draw IS its momentum-rebuild rate (mirrors the single
    // carapace screen, doubled for the two extra cells).
    powerDraw: 2 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy,
    crewRequired: 0,
    techLevel: 3,
    footprint: SWARM_FOOTPRINTS.bulwarkCarapace,
    effect: {
      kind: "deflector",
      capacity: 2 * DEFLECTOR_CAPACITY_KG_MPS.heavy,
      rechargeRate: 2 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.heavy,
      rechargeDelay: 100,
    },
  },
  {
    id: "swm-ammon-cyst",
    faction: "Swarm",
    name: "Ammon Cyst",
    description:
      "An extended bio-organic ammunition reservoir grown as three lobed fermentation chambers. It triples the round reserve of an ammon sac, with two extra crew to haul the harvested spore-clusters to hungry weapons. The crewed capital sibling of the ammon vault — the one Swarm multi-cell line that scales crew.",
    category: "system",
    // 750 rounds. mass = magazineMass(750, 3500) = 3500 × (750 / 30) = 87,500 kg.
    mass: magazineMass(AMMON_CYST_ROUNDS, SWARM_MAGAZINE_DENSITY_KG_PER_M3),
    cost: 130,
    // Three chambers draw three times the single magazine's handling load.
    powerDraw: 3 * MODULE_POWER_DRAW_W.magazine,
    crewRequired: 3,
    techLevel: 3,
    footprint: SWARM_FOOTPRINTS.ammonCyst,
    effect: { kind: "magazine", ammoStored: AMMON_CYST_ROUNDS },
  },
  {
    id: "swm-plus-metabolic-heart",
    faction: "Swarm",
    name: "Radial Metabolic Heart",
    description:
      "A plus-section compound bio-reactor of five fusion-heated digestive lobes arranged around a central node. It amplifies the hive's metabolic output to 6 GW — between the metabolic heart and the antimatter metabolic core — feeding the energy-hungry weapons of the largest bio-forms. Like every Swarm reactor it doubles as a command node.",
    category: "system",
    // 6 GW @ 4e7 W/m³ (compact-fusion density), bio-organic containment.
    // mass = reactorMass(6e9, 4e7, 2500) = 2500 × 150 = 375,000 kg.
    mass: reactorMass(
      PLUS_METABOLIC_HEART_OUTPUT_W,
      FUSION_COMPACT_POWER_DENSITY_W_PER_M3,
      SWARM_REACTOR_DENSITY_KG_PER_M3,
    ),
    cost: 170,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 4,
    footprint: SWARM_FOOTPRINTS.plusMetabolicHeart,
    effect: { kind: "power", output: PLUS_METABOLIC_HEART_OUTPUT_W },
    command: true,
  },
  {
    id: "swm-heavy-flagellum-mass",
    faction: "Swarm",
    name: "Heavy Flagellum Mass",
    description:
      "A dense 2×2 cluster of four heavy plasma-flagellum organs. Co-ordinated contraction cycles deliver capital-scale thrust well above the tentacle drive's lightPlasma banding, driving the largest bio-forms through space with unsettling speed. Gimbals like the pulse-jet organ, so a heavy bio-hull can still vector its thrust.",
    category: "propulsion",
    // 4× plasma = 480 kN. mass = engineMass(480000, 2000) = 2000 × 96 = 192,000 kg.
    mass: engineMass(HEAVY_FLAGELLUM_THRUST_N, SWARM_ENGINE_DENSITY_KG_PER_M3),
    cost: 140,
    // Four organs draw four times the single drive's conditioning load.
    powerDraw: 4 * MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 3,
    footprint: SWARM_FOOTPRINTS.heavyFlagellumMass,
    effect: {
      kind: "engine",
      thrust: HEAVY_FLAGELLUM_THRUST_N,
      gimbalArc: Math.PI / 8,
    },
  },
];
