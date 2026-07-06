import type { ModuleDefinitionInput } from "@/schema/module";
import { engineMass, kineticWeaponMass, reactorMass, shieldMass } from "../physics";
import {
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
  MODULE_POWER_DRAW_W,
  PROJECTILE_MASS_KG,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
  RELOAD_THERMAL_TIME_S,
} from "../combat-scale";
import {
  ENGINE_DENSITY,
  REACTOR_DENSITY,
  SHIELD_DENSITY,
  WEAPON_DENSITY,
} from "./synthetic";

// ---------------------------------------------------------------------------
// Synthetic Collective capital multi-cell modules.
//
// The single-cell catalogue in `synthetic.ts` spans fighter → frigate → cruiser
// capability on one cell each. The modules here are the multi-cell capital
// variants: each occupies a polyomino footprint (2-5 cells) and re-anchors its
// capability at a multiple of the single-cell band — a twin coilgun bank, a
// 2×2 heavy drone hangar, a plus-shape coordination hub, a 1×3 ganged quantum
// core array, a plus-shape capital shield projector, a twin ion drive bank, and
// a 2×1 interceptor grid. Their mass still traces to the SAME physics-layer
// helpers (`kineticWeaponMass`, `engineMass`, `reactorMass`, `shieldMass`) or to
// an explicit multiple of the single-cell catalogue's derived mass, so a
// stronger capital module is proportionally heavier — by physics, not by a
// size class.
//
// Isolated from `synthetic.ts` so that file stays under the per-file max-lines
// guard (mirroring the `foundry.ts` / `foundry-capital.ts` split). The catalog
// index (`data/catalog/index.ts`) concatenates these onto `syntheticModules`;
// preset designs import `SYNTHETIC_FOOTPRINTS` to install matching `covers`
// back-pointers via `coverFootprint` (`data/presets/tokens.ts`). The Synthetic
// material densities (WEAPON_DENSITY etc.) are imported from `synthetic.ts` so
// the multi-cell variants share the single-cell catalogue's machined-alloy
// material — no drift.
//
// Synthetic capital modules stay crewless (the Collective's automation signature)
// and keep the highest tech levels, exactly like the single-cell catalogue.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capital anchors.
//
// Each constant is a multiple of an existing single-cell band — twice the
// coilgun's throw weight (a 20 kg gauss slug at the same 8 km/s muzzle), four
// times the drone hangar's swarm, three times the quantum core's output, five
// times the coordination node's datalink cells, the capital-band shield field,
// twice the ion thruster's thrust, twice the interceptor array's density — so
// capability scales visibly across the fighter → capital span and mass follows
// from the physics helpers, never hand-tuned.
// ---------------------------------------------------------------------------

/** Coilgun bank round mass (kg) — the `gauss` band (20 kg), twice the single
 *  coilgun's 10 kg railgun slug, doubling muzzle energy at the same velocity. */
const COILGUN_BANK_MASS_KG = PROJECTILE_MASS_KG.gauss;
/** Coilgun bank muzzle velocity (m/s) — the railgun band (8 km/s), unchanged
 *  from the single coilgun so the bank keeps the same reach and projectile
 *  speed while throwing twice the mass per salvo. */
const COILGUN_BANK_MUZZLE_MS = 8_000;
/** Coilgun bank load cycle (s) — the railgun band's 3.2 s capacitor recharge. */
const COILGUN_BANK_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.railgun);

/** Heavy drone hangar swarm size — four times the single hangar's 4-drone
 *  swarm (16 drones), four cells of fabrication feeding one launch deck. */
const HEAVY_HANGAR_DRONE_COUNT = 16;

/** Coordination hub fleet-datalink radius (m) — a plus-shape hub's wider
 *  reach, ~1.7× the single Coordination Node's 420 m radius. */
const COORDINATION_HUB_RADIUS = 700;

/** Quantum core array output target (~22.5 GW) — three ganged advanced
 *  antimatter cores at the same density, three times the single Quantum
 *  Core's 7.5 GW output; a capital AI core that runs a dreadnought alone. */
const QUANTUM_CORE_ARRAY_OUTPUT_W = 2.25e10;

/** Heavy drone hangar mass (kg) — four times the single Drone Hangar's derived
 *  84,000 kg fabrication + launch mechanism (four cells of precision
 *  manufacturing). */
const HEAVY_HANGAR_MASS = 4 * 84_000;
/** Coordination hub mass (kg) — five times the single Coordination Node's
 *  derived 20,000 kg datalink hub (a plus shape of five cells). */
const COORDINATION_HUB_MASS = 5 * 20_000;
/** Interceptor grid mass (kg) — twice the single Interceptor Array's derived
 *  16,000 kg turret + electronics mechanism (two cells of the Collective's
 *  defining screen). */
const INTERCEPTOR_GRID_MASS = 2 * 16_000;

/**
 * Footprint polyominoes for the capital multi-cell modules — each anchored at
 * `{0,0}` (the cell the equipment record lives on) and listed in stable offset
 * order. The module literals below author these on each definition; preset
 * designs import the same shapes to install matching `covers` back-pointers
 * via `coverFootprint` (`data/presets/tokens.ts`), so the catalogue and the
 * design agree on each module's shape without re-authoring it.
 */
export const SYNTHETIC_FOOTPRINTS = {
  /** 1×2 line — twin coilgun barrels on a traversing mount. */
  coilgunBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 2×2 block — a four-cell fabrication and launch deck. */
  droneHangarHeavy: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** Plus shape — a five-cell fleet datalink hub. */
  coordinationHub: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ],
  /** 1×3 line — three ganged advanced antimatter cores along one axis. */
  quantumCoreHeavy: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  /** Plus shape — a five-cell capital shield projector. */
  shieldHub: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ],
  /** 1×2 line — twin ion thrusters on a common mounting. */
  thrusterBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 1×2 line — a dense two-cell point-defence network. */
  interceptorGrid: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
};

/**
 * Synthetic Collective capital multi-cell module definitions — polyomino-
 * footprint variants of the single-cell catalogue. Each occupies the cells its
 * footprint lists (the anchor at `{0,0}` plus its covers); a design installs
 * the anchor as one equipment record and marks each covered cell with a
 * `covers` back-pointer to the anchor (see `coverFootprint` in
 * `data/presets/tokens.ts`). Mass traces to the same physics helpers via the
 * heavier capital anchors above.
 */
export const syntheticCapitalModules: ModuleDefinitionInput[] = [
  {
    id: "syn-coilgun-bank",
    faction: "Synthetic",
    name: "Coilgun Bank",
    description:
      "Twin coilgun barrels on a traversing mount. Same reach as the single coilgun (muzzle velocity unchanged) but twice the throw weight per salvo — a 2×1 bank of Synthetic electromagnetic slugs a frigate line brings to bear.",
    category: "weapon",
    // 20 kg @ 8 km/s (gauss mass, railgun muzzle). Muzzle energy
    // ½·20·8000² = 640 MJ, twice the single coilgun's 320 MJ. Mass derived
    // from muzzle energy at the mid-density machined-alloy weapon density.
    // mass = 4200 × (6.4e8 / 2e7) = 134,400 kg (~134 t) — twice the single
    // coilgun's 67,200 kg.
    mass: kineticWeaponMass(
      COILGUN_BANK_MASS_KG,
      COILGUN_BANK_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 250,
    // Two barrels draw twice the capacitor-recharge load of one coilgun.
    powerDraw: 2 * MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 3,
    footprint: SYNTHETIC_FOOTPRINTS.coilgunBank,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(COILGUN_BANK_MASS_KG, COILGUN_BANK_MUZZLE_MS) * 50,
      range: kineticRangeM(COILGUN_BANK_MUZZLE_MS),
      cooldown: COILGUN_BANK_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(COILGUN_BANK_MUZZLE_MS),
      projectileMass: COILGUN_BANK_MASS_KG,
      tracking: 1.2,
      shieldPiercing: 0.25,
      armourPiercing: 0.6,
      spread: 0.005,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.07,
      // Ballistic slug: unpowered and unguided.
      powered: false,
      guided: false,
      ammoCapacity: 240,
    },
  },
  {
    id: "syn-drone-hangar-heavy",
    faction: "Synthetic",
    name: "Heavy Drone Hangar",
    description:
      "A 2×2 fabrication and launch deck for autonomous combat drones. Four cells of precision manufacturing feed a sixteen-drone swarm the Collective's flagship puts into space before the lines close.",
    category: "weapon",
    // Four cells of fabrication + launch mechanism: four times the single
    // Drone Hangar's derived 84,000 kg mass.
    // mass = 4 × 84,000 = 336,000 kg (~336 t).
    mass: HEAVY_HANGAR_MASS,
    cost: 600,
    // Four cells draw four times the single hangar's ordnance-handling load.
    powerDraw: 4 * MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 4,
    footprint: SYNTHETIC_FOOTPRINTS.droneHangarHeavy,
    effect: {
      kind: "hangar",
      droneCount: HEAVY_HANGAR_DRONE_COUNT,
      launchCooldown: 90,
      droneHp: 40,
      droneDamage: 5 * 50,
      droneRange: 90,
      droneSpeed: 5,
    },
  },
  {
    id: "syn-coordination-hub",
    faction: "Synthetic",
    name: "Coordination Hub",
    description:
      "A plus-shape fleet datalink hub. Five cells of comms and processing share targeting solutions across a wider radius, turning a coordinator dreadnought's entire formation into one weapon.",
    category: "system",
    // Five cells of comms + processing: five times the single Coordination
    // Node's derived 20,000 kg mass.
    // mass = 5 × 20,000 = 100,000 kg (~100 t).
    mass: COORDINATION_HUB_MASS,
    cost: 400,
    // Five cells draw five times the single node's comms-class link load.
    powerDraw: 5 * MODULE_POWER_DRAW_W.comms,
    crewRequired: 0,
    techLevel: 5,
    footprint: SYNTHETIC_FOOTPRINTS.coordinationHub,
    effect: {
      kind: "commandAura",
      radius: COORDINATION_HUB_RADIUS,
      accuracyBonus: 0.5,
      rangeBonus: 0.25,
    },
  },
  {
    id: "syn-quantum-core-heavy",
    faction: "Synthetic",
    name: "Quantum Core Array",
    description:
      "A 1×3 line of advanced antimatter cores ganged into one capital AI core. Vast output to run interceptor grids, coilgun banks and drone swarms across a dreadnought with no crew.",
    category: "system",
    // 22.5 GW @ 3e8 W/m³ (advanced antimatter density), three times the
    // single Quantum Core's 7.5 GW at the same density. Mass derived from
    // output and power density at the precision reactor density.
    // mass = 5000 × (2.25e10 / 3e8) = 375,000 kg (~375 t) — three times the
    // single Quantum Core's 125,000 kg.
    mass: reactorMass(
      QUANTUM_CORE_ARRAY_OUTPUT_W,
      ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
      REACTOR_DENSITY,
    ),
    cost: 630,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 5,
    footprint: SYNTHETIC_FOOTPRINTS.quantumCoreHeavy,
    effect: { kind: "power", output: QUANTUM_CORE_ARRAY_OUTPUT_W },
    command: true,
  },
  {
    id: "syn-shield-hub",
    faction: "Synthetic",
    name: "Phalanx Shield Hub",
    description:
      "A plus-shape capital-grade shield projector. Five emitter cells around the anchor generate a gigajoule field that buys the point-defence net the time it needs to exhaust an attacker's volley.",
    category: "defence",
    // 1 GJ capital-band field (5× the single Grid Shield's 200 MJ). Mass
    // derived from field capacity at the Synthetic shield density.
    // mass = 2500 × (1e9 / 1.3e7) ≈ 192,308 kg (~192 t).
    mass: shieldMass(SHIELD_CAPACITY_J.capital, SHIELD_DENSITY),
    cost: 425,
    // A shield's draw IS its recharge wattage.
    powerDraw: SHIELD_RECHARGE_W.capital,
    crewRequired: 0,
    techLevel: 4,
    footprint: SYNTHETIC_FOOTPRINTS.shieldHub,
    effect: {
      kind: "shield",
      capacity: SHIELD_CAPACITY_J.capital,
      rechargeRate: SHIELD_RECHARGE_W.capital,
      rechargeDelay: 60,
    },
  },
  {
    id: "syn-thruster-bank",
    faction: "Synthetic",
    name: "Ion Drive Bank",
    description:
      "Twin ion thrusters on a common mounting. The Collective meets its foes rather than chasing them, but a 2×1 bank doubles the precision drive's clean, efficient thrust for a heavier hull.",
    category: "propulsion",
    // 120 kN thrust (2 × the single Ion Thruster's 60 kN precision drive).
    // Mass derived from thrust at the mid-density machined-alloy engine
    // density.
    // mass = 3500 × (120000 / 5000) = 84,000 kg (~84 t) — twice the single
    // Ion Thruster's 42,000 kg.
    mass: engineMass(120_000, ENGINE_DENSITY),
    cost: 90,
    // Two nozzles draw twice the single drive's power-conditioning load.
    powerDraw: 2 * MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 2,
    footprint: SYNTHETIC_FOOTPRINTS.thrusterBank,
    effect: { kind: "engine", thrust: 120_000 },
  },
  {
    id: "syn-interceptor-grid",
    faction: "Synthetic",
    name: "Interceptor Grid",
    description:
      "A 2×1 dense sensor-guided point-defence network. Two cells of turret and electronics double the Collective's defining screen, shredding incoming missiles and torpedoes across a wider arc.",
    category: "defence",
    // Two cells of turret + electronics: twice the single Interceptor Array's
    // derived 16,000 kg mass.
    // mass = 2 × 16,000 = 32,000 kg (~32 t).
    mass: INTERCEPTOR_GRID_MASS,
    cost: 190,
    // Two cells draw twice the single array's point-defence load.
    powerDraw: 2 * MODULE_POWER_DRAW_W.pointDefense,
    crewRequired: 0,
    techLevel: 3,
    footprint: SYNTHETIC_FOOTPRINTS.interceptorGrid,
    effect: {
      kind: "pointDefense",
      damage: 28 * 50,
      range: 160,
      cooldown: 6,
      hitChance: 0.7,
      tracking: 2.6,
    },
    pointDefense: true,
  },
];
