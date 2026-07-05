import type { ModuleDefinitionInput } from "@/schema/module";
import {
  beamWeaponMass,
  deflectorMass,
  driveThrustNewtons,
  engineMass,
  kineticWeaponMass,
  reactorMass,
  shieldMass,
} from "../physics";
import {
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
// capability at a multiple of the single-cell band (a 6 GW prism array, a
// 3 GW heavy spinal lance, a railgun-grade heavy shard cannon, a 1.6 GJ
// adaptive bastion, a paired resonance bulwark, a 15 GW quantum spire, a
// 96 kN resonance thruster array). Their mass still traces to the SAME
// physics-layer helpers (`beamWeaponMass`, `kineticWeaponMass`, `engineMass`,
// `reactorMass`, `shieldMass`, `deflectorMass`) applied to these heavier
// anchors, with the SAME Crystalline-specific densities exported from
// `crystalline.ts`, so a stronger capital module is proportionally heavier —
// by physics, not by a size class.
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
// Each constant is a multiple of an existing single-cell band (2× the prism
// beam, 3× the spinal lance, 4× the medium shield, 3× the quantum lattice
// core's output, 2× the crystal drive, etc.), so capability scales visibly
// across the fighter → capital span and mass follows from the physics helpers,
// never hand-tuned.
// ---------------------------------------------------------------------------

/** Prism Array sustained beam power (W) — 2× the prism beam's pulse band. The
 *  two crystals fire in concert, so the array's pulse deposits 6e8 J on the
 *  prism beam's fast 1 s cycle. */
const PRISM_ARRAY_POWER_W = 2 * BEAM_POWER_W.pulse;
/** Prism Array refire / dwell (s) — the prism beam's fast-cycling thermal
 *  band (the two emitters share a common cycle). */
const PRISM_ARRAY_COOLDOWN = cooldownTicks(1.0);

/** Heavy Spinal Lance sustained beam power (W) — 3× the spinal lance band, the
 *  heaviest Concord beam. A slow 7 s thermal cycle dumps a 21 GJ pulse
 *  (`beamDamageJoules(HEAVY_SPINAL_POWER_W, HEAVY_SPINAL_COOLDOWN)`). */
const HEAVY_SPINAL_POWER_W = 3 * BEAM_POWER_W.lance;
/** Heavy Spinal Lance thermal cycle (s) — the spinal lance's long emitter-
 *  recovery dwell, shared by the heavier three-crystal line. */
const HEAVY_SPINAL_COOLDOWN = cooldownTicks(7);

/** Heavy Shard Cannon round mass (kg) — the railgun band (10 kg), a heavier
 *  crystal slug than the resonance cannon's fighter-class lobbed shard. */
const HEAVY_SHARD_MASS_KG = PROJECTILE_MASS_KG.railgun;
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

/** Resonance Thruster Array rated thrust (N) — 2× the crystal drive band. */
const THRUSTER_ARRAY_THRUST_N = 2 * driveThrustNewtons("crystal");
/** Resonance Thruster Array power draw (W) — 2× the drive's power-conditioning
 *  load, mirroring the 2× thrust. */
const THRUSTER_ARRAY_POWER_DRAW_W = 2 * MODULE_POWER_DRAW_W.drive;

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
    // mass = beamWeaponMass(6e8, 4200) = 4200 × (6e8 / 4e7) = 63,000 kg (~63 t).
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
    // mass = beamWeaponMass(3e9, 4200) = 4200 × (3e9 / 4e7) = 315,000 kg (~315 t).
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
    // 10 kg @ 8 km/s. Muzzle energy ½·10·8000² = 3.2 GJ.
    // mass = kineticWeaponMass(10, 8000, 4500) = 4500 × (3.2e8 / 2e7) = 72,000 kg.
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
];
