import type { ModuleDefinitionInput } from "@/schema/module";
import {
  beamWeaponMass,
  deflectorMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  magazineMass,
  reactorMass,
  shieldMass,
} from "../physics";
import {
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
  ANTIMATTER_POWER_DENSITY_W_PER_M3,
  BEAM_POWER_W,
  BEAM_RANGE_M,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
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
import {
  CRYSTAL_BEAM_DENSITY,
  CRYSTAL_ENGINE_DENSITY,
  CRYSTAL_REACTOR_DENSITY,
  CRYSTAL_SHIELD_DENSITY,
  CRYSTAL_WEAPON_DENSITY,
  CRYSTAL_ANTIMATTER_OUTPUT_W,
} from "./crystalline";

// ---------------------------------------------------------------------------
// Crystalline Concord capital multi-cell modules.
//
// The single-cell catalogue in `crystalline.ts` spans fighter → frigate →
// cruiser capability on one cell each. The modules here are the multi-cell
// capital variants: each occupies a polyomino footprint and re-anchors its
// capability at a multiple of the single-cell band. The CAPITAL weapons (the
// prism array, the heavy spinal lance) carry the capital-array damage fold
// (×50) baked into their anchor so per-shot damage derives purely from
// `beamDamageJoules` / `kineticDamageJoules`; the frigate- and cruiser-grade
// lines (twin prism, tri-prism lance) are re-anchored at their labelled grade
// with NO capital fold, so a frigate/cruiser hull can feed them from its
// existing reactors. Their mass still traces to the SAME physics-layer helpers
// (`beamWeaponMass`, `kineticWeaponMass`, `engineMass`, `reactorMass`,
// `shieldMass`, `deflectorMass`) applied to these heavier anchors, with the
// SAME Crystalline-specific densities exported from `crystalline.ts`, so a
// stronger capital module is proportionally heavier — by physics, not by a
// size class.
//
// Isolated from `crystalline.ts` so that file stays under the per-file
// max-lines guard (mirroring the `terran.ts` / `terran-capital.ts` split). The
// catalog index (`data/catalog/index.ts`) concatenates these onto
// `crystallineModules`; preset designs import `CRYSTALLINE_FOOTPRINTS` to
// install matching `covers` back-pointers via `coverFootprint`
// (`data/presets/tokens.ts`).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capital anchors.
//
// Each constant is a multiple of an existing single-cell band (the prism
// beam, the spinal lance, the medium shield, the quantum lattice core's
// output, the crystal drive, etc.). The capital weapons (prism array, heavy
// spinal lance) bake the capital-array damage fold (×50) into their anchor so
// per-shot energy derives purely from the physics helpers; the frigate- and
// cruiser-grade lines (twin prism, tri-prism lance) omit that fold and re-anchor
// at their labelled grade. Capability scales visibly across the fighter →
// capital span and mass follows from the physics helpers, never hand-tuned.
// ---------------------------------------------------------------------------

/** Prism Array sustained beam power (W) — the two crystals fire in concert
 *  (2× the prism beam's pulse band) at the capital-array damage fold (×50), so
 *  the per-shot energy derives purely from `beamDamageJoules`. Mass and
 *  powerDraw scale with this anchor. */
const PRISM_ARRAY_POWER_W = 2 * 50 * BEAM_POWER_W.pulse;
/** Prism Array refire / dwell (s) — the prism beam's fast-cycling thermal
 *  band (the two emitters share a common cycle). */
const PRISM_ARRAY_COOLDOWN = cooldownTicks(1.0);

/** Heavy Spinal Lance sustained beam power (W) — three crystals in series (3×
 *  the spinal lance band) at the capital-array damage fold (×50), the heaviest
 *  Concord beam. A slow 7 s thermal cycle dumps the per-shot energy derived
 *  purely from `beamDamageJoules`. */
const HEAVY_SPINAL_POWER_W = 3 * 50 * BEAM_POWER_W.lance;
/** Heavy Spinal Lance thermal cycle (s) — the spinal lance's long emitter-
 *  recovery dwell, shared by the heavier three-crystal line. */
const HEAVY_SPINAL_COOLDOWN = cooldownTicks(7);

/** Heavy Shard Cannon round mass (kg) — the railgun band at the capital-array
 *  damage fold (×50), a 500 kg crystal slug far heavier than the resonance
 *  cannon's fighter-class lobbed shard. Per-shot kinetic energy derives purely
 *  from `kineticDamageJoules`. */
const HEAVY_SHARD_MASS_KG = 50 * PROJECTILE_MASS_KG.railgun;
/** Heavy Shard Cannon muzzle velocity (m/s) — the railgun band (8 km/s). */
const HEAVY_SHARD_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.railgun;
/** Heavy Shard Cannon load cycle (s) — the railgun band's capacitor recharge. */
const HEAVY_SHARD_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.railgun);

/** Adaptive Bastion capacity (J) — 4× the adaptive shield Mk I (medium), a
 *  1.6 GJ capital projector lattice. */
const BASTION_CAPACITY_J = 4 * SHIELD_CAPACITY_J.medium;
/** Adaptive Bastion recharge (W) — 4× the medium shield's recharge, the grid
 *  draw to rebuild a 1.6 GJ field. */
const BASTION_RECHARGE_W = 4 * SHIELD_RECHARGE_W.medium;

/** Resonance Bulwark Array capacity (kg·m/s) — 2× the Mk I (medium) deflector's
 *  momentum screen. */
const BULWARK_ARRAY_CAPACITY_KG_MPS = 2 * DEFLECTOR_CAPACITY_KG_MPS.medium;
/** Resonance Bulwark Array recharge (kg·m/s per s) — 2× the Mk I (medium)
 *  deflector's rebuild rate. */
const BULWARK_ARRAY_RECHARGE_KG_MPS = 2 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.medium;

/** Quantum Spire output (W) — 3× the quantum lattice core's 5 GW antimatter
 *  band, the Concord's capital power plant. */
const QUANTUM_SPIRE_OUTPUT_W = 3 * CRYSTAL_ANTIMATTER_OUTPUT_W;

/** Quantum Spire Apex output (W) — 35× the crystal antimatter band (175 GW),
 *  the Concord's apex capital power plant: sized to feed a 150 GW heavy spinal
 *  lance with ~15% margin for shields, drive, and sensors. Re-anchored at the
 *  advanced antimatter power density (3e8 W/m³), the densest band. */
const SPIRE_APEX_OUTPUT_W = 35 * CRYSTAL_ANTIMATTER_OUTPUT_W;

/** Resonance Thruster Array rated thrust (N) — 2× the crystal drive band. */
const THRUSTER_ARRAY_THRUST_N = 2 * driveThrustNewtons("crystal");
/** Resonance Thruster Array power draw (W) — 2× the drive's power-conditioning
 *  load, mirroring the 2× thrust. */
const THRUSTER_ARRAY_POWER_DRAW_W = 2 * MODULE_POWER_DRAW_W.drive;

// ---------------------------------------------------------------------------
// Catalog-expansion anchors — multi-cell variants that close the Crystalline
// Concord's doctrine gaps (repair, point-defence, magazine, frigate twin
// prism, capital 2×2 diamond shield, T-tetromino beam line, plus-shape
// command spire). Each anchor is a named multiple of an existing single-cell
// band, so mass follows from the physics helpers, never hand-tuned.
// ---------------------------------------------------------------------------

/** Twin Prism sustained beam power (W) — two crystals fired in concert at the
 *  disruptor band (2× it), a frigate-grade battery with NO capital fold so a
 *  frigate's power crystal can feed it. Per-shot energy derives purely from
 *  `beamDamageJoules`. */
const TWIN_PRISM_POWER_W = 2 * BEAM_POWER_W.disruptor;
/** Twin Prism refire / dwell (s) — the prism beam's fast 1 s crystal cycle. */
const TWIN_PRISM_COOLDOWN = cooldownTicks(1.0);

/** Tri-Prism Lance sustained beam power (W) — three crystals in series at the
 *  disruptor band (3× it), a cruiser-grade spinal line with NO capital fold so
 *  a cruiser's quantum lattice can feed it. Per-shot energy derives purely
 *  from `beamDamageJoules`. */
const TRI_PRISM_LANCE_POWER_W = 3 * BEAM_POWER_W.disruptor;
/** Tri-Prism Lance thermal cycle (s) — the phase lance's resonant dwell. */
const TRI_PRISM_LANCE_COOLDOWN = cooldownTicks(1.6);

/** Resonance Shard Volley round mass (kg) — a twin shard volley (2× the
 *  heavy-autocannon band) at the capital-array damage fold (×50), heavier than
 *  the single resonance cannon. Per-shot kinetic energy derives purely from
 *  `kineticDamageJoules`. */
const SHARD_VOLLEY_MASS_KG = 2 * 50 * PROJECTILE_MASS_KG.heavyAutocannon;
/** Resonance Shard Volley muzzle velocity (m/s) — the heavy-autocannon band. */
const SHARD_VOLLEY_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.heavyAutocannon;
/** Resonance Shard Volley load cycle (s) — the heavy-autocannon band. */
const SHARD_VOLLEY_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.heavyAutocannon);

/** Refractor Grid power draw (W) — 2× the PD mount's electronics load. */
const REFRACTOR_GRID_POWER_DRAW_W = 2 * MODULE_POWER_DRAW_W.pointDefense;

/** Resonance Mender power draw (W) — a sensor-class electronics load for the
 *  resonance repair array. */
const RESONANCE_MENDER_POWER_DRAW_W = MODULE_POWER_DRAW_W.sensor;

/** Shard Vault power draw (W) — magazine-handling gear. */
const SHARD_VAULT_POWER_DRAW_W = MODULE_POWER_DRAW_W.magazine;

/** Shard Vault stored-round count — a 600-round resonance-shard reserve, the
 *  magazine that feeds the Concord's shard cannons for sustained fire. */
const SHARD_VAULT_ROUNDS = 600;

/** Diamond Bastion capacity (J) — 3× the heavy shield band (1.8 GJ), the
 *  Concord's signature capital diamond projector lattice. */
const DIAMOND_BASTION_CAPACITY_J = 3 * SHIELD_CAPACITY_J.heavy;
/** Diamond Bastion recharge (W) — 3× the heavy shield's recharge rate. */
const DIAMOND_BASTION_RECHARGE_W = 3 * SHIELD_RECHARGE_W.heavy;

/** Resonance Bulwark Bastion capacity (kg·m/s) — 3× the medium deflector band
 *  (1.5e6 kg·m/s), a 2×2 capital momentum screen. */
const BULWARK_BASTION_CAPACITY_KG_MPS = 3 * DEFLECTOR_CAPACITY_KG_MPS.medium;
/** Resonance Bulwark Bastion recharge (kg·m/s per s) — 3× the medium
 *  deflector's rebuild rate. */
const BULWARK_BASTION_RECHARGE_KG_MPS = 3 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.medium;

/** Twin Thruster Cluster rated thrust (N) — 2× the crystal drive band. */
const TWIN_THRUSTER_CLUSTER_THRUST_N = 2 * driveThrustNewtons("crystal");
/** Twin Thruster Cluster power draw (W) — 2× the drive's load. */
const TWIN_THRUSTER_CLUSTER_POWER_DRAW_W = 2 * MODULE_POWER_DRAW_W.drive;

/** Quantum Spire Plus output (W) — 5× the crystal antimatter band (25 GW),
 *  the Concord's capital plus-shape command core. */
const SPIRE_PLUS_OUTPUT_W = 5 * CRYSTAL_ANTIMATTER_OUTPUT_W;

/**
 * Footprint polyominoes for the capital multi-cell modules — each anchored at
 * `{0,0}` (the cell the equipment record lives on) and listed in stable offset
 * order. The module literals below author these on each definition; preset
 * designs import the same shapes to install matching `covers` back-pointers
 * via `coverFootprint` (`data/presets/tokens.ts`), so the catalogue and the
 * design agree on each module's shape without re-authoring it.
 */
export const CRYSTALLINE_FOOTPRINTS = {
  prismArray: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  heavySpinalLance: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  heavyShardCannon: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  adaptiveBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 },
    { dx: 2, dy: 1 },
  ],
  bulwarkArray: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  quantumSpire: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  thrusterArray: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  // --- Catalog-expansion footprints ---
  /** Twin Prism: two focusing crystals side by side (2-line, forward). */
  twinPrism: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Resonance Shard Volley: a twin shard-thrower battery (2-line). */
  resonanceShardVolley: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Tri-Prism Lance: three resonant crystals in series (3-line, spinal). */
  triPrismLance: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  /** Refractor Grid: a paired point-defence crystal facet (2-line). */
  refractorGrid: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Resonance Mender: a three-celled resonance repair cluster (L-tromino). */
  resonanceMender: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** Shard Vault: a dense-packed crystal magazine (2-line). */
  shardVault: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Diamond Bastion: the Concord's signature 2×2 capital shield diamond. */
  diamondBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** Resonance Bulwark Bastion: a 2×2 capital momentum screen. */
  resonanceBulwarkBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** Twin Thruster Cluster: two resonance thrusters in parallel (2-line). */
  twinThrusterCluster: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** Quantum Spire Plus: a five-celled plus-shape command core. */
  spirePlus: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ],
  /** Quantum Spire Apex: a 2×2 capital antimatter command core (the apex
   *  power plant that feeds a heavy spinal lance). */
  spireApex: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
};

/**
 * Crystalline capital multi-cell module definitions — polyomino-footprint
 * variants of the single-cell catalogue. Each occupies the cells its footprint
 * lists (the anchor at `{0,0}` plus its covers); a design installs the anchor
 * as one equipment record and marks each covered cell with a `covers`
 * back-pointer to the anchor (see `coverFootprint` in `data/presets/tokens.ts`).
 * Mass traces to the same physics helpers via the heavier capital anchors
 * above, with the SAME crystal densities the single-cell catalogue uses.
 */
export const crystallineCapitalModules: ModuleDefinitionInput[] = [
  {
    id: "cry-prism-array",
    faction: "Crystalline",
    name: "Prism Array",
    description:
      "Two focusing crystals grown side by side and fired in concert. Doubles the prism beam's pulse-grade output for a modest increase in fitting cost. A 2x1 array (the Concord's prism-array pattern).",
    category: "weapon",
    // mass = beamWeaponMass(3e10, 4200) = 4200 × (3e10 / 4e7) = 3,150,000 kg (~3150 t).
    mass: beamWeaponMass(PRISM_ARRAY_POWER_W, CRYSTAL_BEAM_DENSITY),
    cost: 130,
    // A beam's draw IS its delivered optical power.
    powerDraw: PRISM_ARRAY_POWER_W,
    crewRequired: 2,
    techLevel: 2,
    footprint: CRYSTALLINE_FOOTPRINTS.prismArray,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(PRISM_ARRAY_POWER_W, PRISM_ARRAY_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: PRISM_ARRAY_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.55,
      armourPiercing: 0.05,
      spread: 0,
    },
  },
  {
    id: "cry-spinal-lance-heavy",
    faction: "Crystalline",
    name: "Spinal Resonance Lance Heavy",
    description:
      "Three resonant crystals grown in series along the keel — the heaviest Concord beam, a fixed-forward capital array that deposits a battleship-killing pulse on a long thermal cycle. A 1x3 resonance-lance line.",
    category: "weapon",
    // mass = beamWeaponMass(1.5e11, 4200) = 4200 × (1.5e11 / 4e7) = 15,750,000 kg (~15,750 t).
    mass: beamWeaponMass(HEAVY_SPINAL_POWER_W, CRYSTAL_BEAM_DENSITY),
    cost: 840,
    // A beam's draw IS its delivered optical power.
    powerDraw: HEAVY_SPINAL_POWER_W,
    crewRequired: 3,
    techLevel: 5,
    footprint: CRYSTALLINE_FOOTPRINTS.heavySpinalLance,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(HEAVY_SPINAL_POWER_W, HEAVY_SPINAL_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: HEAVY_SPINAL_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.8,
      armourPiercing: 0.2,
      spread: 0,
      // Fixed spinal mount — no traverse.
      turretArc: 0,
      turretTurnRate: 0,
    },
  },
  {
    id: "cry-shard-cannon-heavy",
    faction: "Crystalline",
    name: "Heavy Shard Cannon",
    description:
      "A three-celled shard battery grown as a bent crystal cluster, hurling a railgun-grade slug for when a beam's line of sight is unwanted and a fighter-class lobbed round would not suffice. Uses a higher capability band than the 1-cell resonance cannon (3 kg / 5 km/s); mass follows the capability derivation. An L-tromino crystal facet.",
    category: "weapon",
    // 500 kg @ 8 km/s. Muzzle energy ½·500·8000² = 1.6e10 J (16 GJ).
    // mass = kineticWeaponMass(500, 8000, 4500) = 4500 × (1.6e10 / 2e7) = 3,600,000 kg.
    mass: kineticWeaponMass(
      HEAVY_SHARD_MASS_KG,
      HEAVY_SHARD_MUZZLE_MS,
      CRYSTAL_WEAPON_DENSITY,
    ),
    cost: 240,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 2,
    techLevel: 3,
    footprint: CRYSTALLINE_FOOTPRINTS.heavyShardCannon,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(HEAVY_SHARD_MASS_KG, HEAVY_SHARD_MUZZLE_MS),
      range: kineticRangeM(HEAVY_SHARD_MUZZLE_MS),
      cooldown: HEAVY_SHARD_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(HEAVY_SHARD_MUZZLE_MS),
      projectileMass: HEAVY_SHARD_MASS_KG,
      tracking: 1,
      shieldPiercing: 0.4,
      armourPiercing: 0.15,
      spread: 0.03,
      // Ballistic shard: unpowered and unguided.
      powered: false,
      guided: false,
      // Finite magazine: `ammo` (start) AND `ammoCapacity` (crew top-up
      // ceiling) must both be set — omitting `ammo` leaves it at
      // DEFAULT_WEAPON_AMMO (effectively unlimited). Capacity 100 (>= 60) so a
      // crew ammo-run dispatches while rounds remain, keeping the gun firing
      // through the haul cycle. Fed by a Shard Vault.
      ammo: 100,
      ammoCapacity: 100,
    },
  },
  {
    id: "cry-adaptive-bastion",
    faction: "Crystalline",
    name: "Adaptive Bastion",
    description:
      "A four-celled adaptive shield grown as an offset crystal lattice — the Concord's strongest bulwark, with capacity and a recovery ramp beyond any single emitter. An S-zigzag crystalline shard (offset rows).",
    category: "defence",
    // mass = shieldMass(1.6e9, 3000) = 3000 × (1.6e9 / 1.3e7) ≈ 369,231 kg.
    mass: shieldMass(BASTION_CAPACITY_J, CRYSTAL_SHIELD_DENSITY),
    cost: 440,
    // A shield's draw IS its recharge wattage.
    powerDraw: BASTION_RECHARGE_W,
    crewRequired: 2,
    techLevel: 4,
    footprint: CRYSTALLINE_FOOTPRINTS.adaptiveBastion,
    effect: {
      kind: "shield",
      capacity: BASTION_CAPACITY_J,
      rechargeRate: BASTION_RECHARGE_W,
      rechargeDelay: 65,
      adaptiveRampRate: 0.06,
    },
  },
  {
    id: "cry-resonance-bulwark-array",
    faction: "Crystalline",
    name: "Resonance Bulwark Array",
    description:
      "A paired resonance-bulwark projector. Two crystal momentum screens grown in parallel arrest twice the momentum of a single emitter, sized between the Mk I medium and Mk II heavy deflectors. A 2x1 array.",
    category: "defence",
    // mass = deflectorMass(1e6, 3000) = 3000 × (1e6 / 1.5e4) = 200,000 kg.
    mass: deflectorMass(
      BULWARK_ARRAY_CAPACITY_KG_MPS,
      CRYSTAL_SHIELD_DENSITY,
    ),
    cost: 220,
    // A deflector's draw IS its momentum-rebuild rate.
    powerDraw: BULWARK_ARRAY_RECHARGE_KG_MPS,
    crewRequired: 2,
    techLevel: 3,
    footprint: CRYSTALLINE_FOOTPRINTS.bulwarkArray,
    effect: {
      kind: "deflector",
      capacity: BULWARK_ARRAY_CAPACITY_KG_MPS,
      rechargeRate: BULWARK_ARRAY_RECHARGE_KG_MPS,
      rechargeDelay: 55,
    },
  },
  {
    id: "cry-quantum-spire",
    faction: "Crystalline",
    name: "Quantum Lattice Spire",
    description:
      "A three-celled antimatter spire grown along the keel — the Concord's capital power plant, feeding the heaviest spinal arrays and full adaptive-bastion fits from one resonant core. A 1x3 resonance line; command module.",
    category: "system",
    // 15 GW @ 2e8 W/m³ (antimatter density), crystal containment.
    // mass = reactorMass(1.5e10, 2e8, 5000) = 5000 × 75 = 375,000 kg.
    mass: reactorMass(
      QUANTUM_SPIRE_OUTPUT_W,
      ANTIMATTER_POWER_DENSITY_W_PER_M3,
      CRYSTAL_REACTOR_DENSITY,
    ),
    cost: 810,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 5,
    footprint: CRYSTALLINE_FOOTPRINTS.quantumSpire,
    effect: { kind: "power", output: QUANTUM_SPIRE_OUTPUT_W },
    command: true,
  },
  {
    id: "cry-thruster-array",
    faction: "Crystalline",
    name: "Resonance Thruster Array",
    description:
      "Two resonance thrusters grown in parallel. The Concord still repositions by blinking, but a paired array claws back some straight-line thrust. A 2x1 array; power draw 2x MODULE_POWER_DRAW_W.drive.",
    category: "propulsion",
    // mass = engineMass(96000, 3500) = 3500 × (96000 / 5000) = 67,200 kg.
    mass: engineMass(THRUSTER_ARRAY_THRUST_N, CRYSTAL_ENGINE_DENSITY),
    cost: 100,
    powerDraw: THRUSTER_ARRAY_POWER_DRAW_W,
    crewRequired: 0,
    techLevel: 2,
    footprint: CRYSTALLINE_FOOTPRINTS.thrusterArray,
    effect: { kind: "engine", thrust: THRUSTER_ARRAY_THRUST_N },
  },
  // --- Catalog-expansion modules (doctrine-gap fillers) ---
  {
    id: "cry-twin-prism",
    faction: "Crystalline",
    name: "Twin Prism",
    description:
      "Two focusing crystals fired in concert at the disruptor band, one step above the single prism beam's pulse. A frigate-grade 2-cell twin-prism battery — the Concord's line skirmisher upgrade, feedable by a frigate's power crystal. A 2x1 array.",
    category: "weapon",
    // mass = beamWeaponMass(9e8, 4200) = 4200 × (9e8 / 4e7) = 94,500 kg (~94.5 t).
    mass: beamWeaponMass(TWIN_PRISM_POWER_W, CRYSTAL_BEAM_DENSITY),
    cost: 200,
    // A beam's draw IS its delivered optical power.
    powerDraw: TWIN_PRISM_POWER_W,
    crewRequired: 2,
    techLevel: 2,
    footprint: CRYSTALLINE_FOOTPRINTS.twinPrism,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(TWIN_PRISM_POWER_W, TWIN_PRISM_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: TWIN_PRISM_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.6,
      armourPiercing: 0.1,
      spread: 0,
    },
  },
  {
    id: "cry-resonance-shard-volley",
    faction: "Crystalline",
    name: "Resonance Shard Volley",
    description:
      "A twin shard-thrower battery hurling two heavy-autocannon-grade crystal slugs in volley — the kinetic upgrade for when a beam's line of sight is unwanted. Uses a heavier band than the single resonance cannon. A 2x1 array.",
    category: "weapon",
    // 300 kg @ 5 km/s. Muzzle energy ½·300·5000² = 3.75e9 J (3.75 GJ).
    // mass = kineticWeaponMass(300, 5000, 4500) = 4500 × (3.75e9 / 2e7) = 843,750 kg.
    mass: kineticWeaponMass(
      SHARD_VOLLEY_MASS_KG,
      SHARD_VOLLEY_MUZZLE_MS,
      CRYSTAL_WEAPON_DENSITY,
    ),
    cost: 130,
    powerDraw: MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 1,
    techLevel: 2,
    footprint: CRYSTALLINE_FOOTPRINTS.resonanceShardVolley,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(SHARD_VOLLEY_MASS_KG, SHARD_VOLLEY_MUZZLE_MS),
      range: kineticRangeM(SHARD_VOLLEY_MUZZLE_MS),
      cooldown: SHARD_VOLLEY_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(SHARD_VOLLEY_MUZZLE_MS),
      projectileMass: SHARD_VOLLEY_MASS_KG,
      tracking: 1,
      shieldPiercing: 0.4,
      armourPiercing: 0.15,
      spread: 0.03,
      // Ballistic shard: unpowered and unguided.
      powered: false,
      guided: false,
      // Finite magazine: `ammo` (start) AND `ammoCapacity` (crew top-up
      // ceiling) must both be set — omitting `ammo` leaves it at
      // DEFAULT_WEAPON_AMMO (effectively unlimited). Capacity 100 (>= 60) so a
      // crew ammo-run dispatches while rounds remain, keeping the battery
      // firing through the haul cycle. Fed by a Shard Vault.
      ammo: 100,
      ammoCapacity: 100,
    },
  },
  {
    id: "cry-tri-prism-lance",
    faction: "Crystalline",
    name: "Tri-Prism Lance",
    description:
      "Three resonant crystals grown in series — a cruiser-grade spinal beam that deposits three times the disruptor band's sustained power on the phase lance's resonant cycle, feedable by a cruiser's quantum lattice. A 1x3 resonance line.",
    category: "weapon",
    // mass = beamWeaponMass(1.35e9, 4200) = 4200 × (1.35e9 / 4e7) = 141,750 kg (~141.75 t).
    mass: beamWeaponMass(TRI_PRISM_LANCE_POWER_W, CRYSTAL_BEAM_DENSITY),
    cost: 400,
    // A beam's draw IS its delivered optical power.
    powerDraw: TRI_PRISM_LANCE_POWER_W,
    crewRequired: 3,
    techLevel: 3,
    footprint: CRYSTALLINE_FOOTPRINTS.triPrismLance,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(TRI_PRISM_LANCE_POWER_W, TRI_PRISM_LANCE_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: TRI_PRISM_LANCE_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.7,
      armourPiercing: 0.15,
      spread: 0,
    },
  },
  {
    id: "cry-refractor-grid",
    faction: "Crystalline",
    name: "Refractor Grid",
    description:
      "A paired crystal point-defence facet — the Concord's first dedicated interceptor grid, refracting incoming ordnance into harm. Closes the point-defence doctrine gap. A 2x1 array.",
    category: "defence",
    // Sized as a small fraction of the crystal drive (a compact refractor
    // facet, not a full mechanism): 2 × engineMass(crystal) × 0.12.
    mass: 2 * (engineMass(driveThrustNewtons("crystal"), CRYSTAL_ENGINE_DENSITY) * 0.12),
    cost: 140,
    powerDraw: REFRACTOR_GRID_POWER_DRAW_W,
    crewRequired: 1,
    techLevel: 2,
    footprint: CRYSTALLINE_FOOTPRINTS.refractorGrid,
    effect: {
      kind: "pointDefense",
      damage: 18,
      range: 110,
      cooldown: 7,
      hitChance: 0.45,
      tracking: 1.8,
    },
  },
  {
    id: "cry-resonance-mender",
    faction: "Crystalline",
    name: "Resonance Mender",
    description:
      "A three-celled resonance repair cluster — the crystal analogue of a repair bay, channelling resonant energy through damaged lattices to re-grow them mid-fight. Closes the repair doctrine gap. An L-tromino crystal facet.",
    category: "defence",
    // Sized as a fraction of the crystal drive (a compact resonance repair
    // emitter): 3 × engineMass(crystal) × 0.25.
    mass: 3 * (engineMass(driveThrustNewtons("crystal"), CRYSTAL_ENGINE_DENSITY) * 0.25),
    cost: 170,
    powerDraw: RESONANCE_MENDER_POWER_DRAW_W,
    crewRequired: 1,
    techLevel: 2,
    footprint: CRYSTALLINE_FOOTPRINTS.resonanceMender,
    effect: {
      kind: "repair",
      repairRate: 5,
    },
  },
  {
    id: "cry-shard-vault",
    faction: "Crystalline",
    name: "Shard Vault",
    description:
      "A dense-packed crystal magazine storing 600 resonance shards for sustained shard-cannon fire. Closes the magazine doctrine gap — crystal shards are crystal-mechanism mass, so the vault masses at the weapon density. A 2x1 bay.",
    category: "system",
    // mass = magazineMass(600, 4500) = 4500 × (600 / 30) = 90,000 kg.
    mass: magazineMass(SHARD_VAULT_ROUNDS, CRYSTAL_WEAPON_DENSITY),
    cost: 130,
    powerDraw: SHARD_VAULT_POWER_DRAW_W,
    crewRequired: 1,
    techLevel: 2,
    footprint: CRYSTALLINE_FOOTPRINTS.shardVault,
    effect: {
      kind: "magazine",
      ammoStored: SHARD_VAULT_ROUNDS,
    },
  },
  {
    id: "cry-diamond-bastion",
    faction: "Crystalline",
    name: "Diamond Bastion",
    description:
      "The Concord's signature capital shield — a 2×2 diamond of adaptive projectors with triple the heavy shield's capacity and a steep recovery ramp. The strongest bulwark in the fleet. A 2x2 diamond (their signature shape).",
    category: "defence",
    // mass = shieldMass(1.8e9, 3000) = 3000 × (1.8e9 / 1.3e7) ≈ 415,385 kg.
    mass: shieldMass(DIAMOND_BASTION_CAPACITY_J, CRYSTAL_SHIELD_DENSITY),
    cost: 700,
    // A shield's draw IS its recharge wattage.
    powerDraw: DIAMOND_BASTION_RECHARGE_W,
    crewRequired: 3,
    techLevel: 5,
    footprint: CRYSTALLINE_FOOTPRINTS.diamondBastion,
    effect: {
      kind: "shield",
      capacity: DIAMOND_BASTION_CAPACITY_J,
      rechargeRate: DIAMOND_BASTION_RECHARGE_W,
      rechargeDelay: 65,
      adaptiveRampRate: 0.06,
    },
  },
  {
    id: "cry-resonance-bulwark-bastion",
    faction: "Crystalline",
    name: "Resonance Bulwark Bastion",
    description:
      "A 2×2 capital momentum screen — three times the Mk I medium deflector's arrest capacity, grown as a resonant crystal block. Stops capital-grade kinetics cold. A 2x2 block.",
    category: "defence",
    // mass = deflectorMass(1.5e6, 3000) = 3000 × (1.5e6 / 1.5e4) = 300,000 kg.
    mass: deflectorMass(BULWARK_BASTION_CAPACITY_KG_MPS, CRYSTAL_SHIELD_DENSITY),
    cost: 360,
    // A deflector's draw IS its momentum-rebuild rate.
    powerDraw: BULWARK_BASTION_RECHARGE_KG_MPS,
    crewRequired: 2,
    techLevel: 4,
    footprint: CRYSTALLINE_FOOTPRINTS.resonanceBulwarkBastion,
    effect: {
      kind: "deflector",
      capacity: BULWARK_BASTION_CAPACITY_KG_MPS,
      rechargeRate: BULWARK_BASTION_RECHARGE_KG_MPS,
      rechargeDelay: 55,
    },
  },
  {
    id: "cry-twin-thruster-cluster",
    faction: "Crystalline",
    name: "Twin Thruster Cluster",
    description:
      "Two resonance thrusters grown in parallel with gimballed nozzles. The Concord still repositions by blinking, but a gimballed pair adds straight-line authority and a measure of vectorable torque. A 2x1 array.",
    category: "propulsion",
    // mass = engineMass(96000, 3500) = 3500 × (96000 / 5000) = 67,200 kg.
    mass: engineMass(TWIN_THRUSTER_CLUSTER_THRUST_N, CRYSTAL_ENGINE_DENSITY),
    cost: 95,
    powerDraw: TWIN_THRUSTER_CLUSTER_POWER_DRAW_W,
    crewRequired: 0,
    techLevel: 2,
    footprint: CRYSTALLINE_FOOTPRINTS.twinThrusterCluster,
    effect: {
      kind: "engine",
      thrust: TWIN_THRUSTER_CLUSTER_THRUST_N,
      gimbalArc: Math.PI / 8,
    },
  },
  {
    id: "cry-spire-plus",
    faction: "Crystalline",
    name: "Quantum Spire Plus",
    description:
      "A five-celled plus-shape antimatter spire — the Concord's capital command core, feeding spinal arrays, diamond bastions, and full blink-cloak fits simultaneously from one resonant heart. A plus-shaped cross-roads core; command module.",
    category: "system",
    // 25 GW @ 2e8 W/m³ (antimatter density), crystal containment.
    // mass = reactorMass(2.5e10, 2e8, 5000) = 5000 × 125 = 625,000 kg.
    mass: reactorMass(
      SPIRE_PLUS_OUTPUT_W,
      ANTIMATTER_POWER_DENSITY_W_PER_M3,
      CRYSTAL_REACTOR_DENSITY,
    ),
    cost: 1200,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 5,
    footprint: CRYSTALLINE_FOOTPRINTS.spirePlus,
    effect: { kind: "power", output: SPIRE_PLUS_OUTPUT_W },
    command: true,
  },
  {
    id: "cry-spire-apex",
    faction: "Crystalline",
    name: "Quantum Spire Apex",
    description:
      "A 2×2 antimatter spire grown as the Concord's apex capital power plant — the resonant heart that feeds a heavy spinal lance (150 GW) with margin for shields, drive, and sensors simultaneously. A 2×2 capital command core; command module.",
    category: "system",
    // 175 GW @ 3e8 W/m³ (advanced antimatter density — the densest band), crystal
    // containment. Sized for a 150 GW heavy spinal lance + ~15% margin.
    // mass = reactorMass(1.75e11, 3e8, 5000) = 5000 × (1.75e11 / 3e8)
    //   = 5000 × 583.33 ≈ 2,916,667 kg (~2917 t).
    mass: reactorMass(
      SPIRE_APEX_OUTPUT_W,
      ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
      CRYSTAL_REACTOR_DENSITY,
    ),
    cost: 1500,
    powerDraw: 0,
    crewRequired: 3,
    techLevel: 5,
    footprint: CRYSTALLINE_FOOTPRINTS.spireApex,
    effect: { kind: "power", output: SPIRE_APEX_OUTPUT_W },
    command: true,
  },
];
