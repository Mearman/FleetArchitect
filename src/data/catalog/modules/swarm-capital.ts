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
      damage: kineticDamageJoules(SPORE_BATTERY_MASS_KG, SPORE_BATTERY_MUZZLE_MS),
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
      damage: beamDamageJoules(ACID_BANK_POWER_W, ACID_BANK_COOLDOWN),
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
      damage: kineticDamageJoules(BLOOM_CANNON_MASS_KG, BLOOM_CANNON_MUZZLE_MS),
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
];
