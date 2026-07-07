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
  ACTIVE_SENSOR_EMISSION_SCALE,
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
  BEAM_POWER_W,
  BEAM_RANGE_M,
  DEFLECTOR_CAPACITY_KG_MPS,
  DEFLECTOR_RECHARGE_KG_MPS_PER_S,
  KM_DETECTION_RANGE_SCALE,
  MODULE_POWER_DRAW_W,
  MUZZLE_VELOCITY_M_PER_S,
  PROJECTILE_MASS_KG,
  SHIELD_CAPACITY_J,
  SHIELD_RECHARGE_W,
  beamDamageJoules,
  cooldownTicks,
  kineticDamageJoules,
  kineticRangeM,
  projectileSpeedMPerTick,
  RELOAD_THERMAL_TIME_S,
} from "../combat-scale";
import { SENSOR_OMNI_ARC } from "../sensor-arcs";
import {
  BEAM_DENSITY,
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

/** Coilgun bank round mass (kg) — the capital-band coilgun round (1000 kg),
 *  fifty times the gauss band, folding the capital per-shot damage scalar into
 *  the anchor so damage derives purely from muzzle energy. */
const COILGUN_BANK_MASS_KG = 50 * PROJECTILE_MASS_KG.gauss;
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

// ---------------------------------------------------------------------------
// Expansion anchors — frigate/cruiser/capital multi-cell variants spanning
// roles the single-cell catalogue and the original capital set leave open.
// Each anchor is a named multiple of an existing capability band, so mass
// follows from the SAME physics helpers — no hand-tuned literals.
// ---------------------------------------------------------------------------

/** Twin cutter sustained beam power (W) — one band above the single Cutter
 *  Lance's pulse (BEAM_POWER_W.beam, 600 MW sustained). A cruiser-grade beam
 *  battery (the Collective's cruiser line fields it on the Network Hub, a 66 m
 *  cruiser), so the anchor carries no capital scalar: this one sustained-power
 *  figure drives mass, powerDraw AND damage, exactly like the single Cutter
 *  Lance one band below. A cruiser grid physically cannot field the tens of
 *  gigawatts a capital-fold would draw, so the weapon is re-anchored at its
 *  labelled grade rather than folded. */
const TWIN_CUTTER_POWER_W = BEAM_POWER_W.beam;
/** Twin cutter beam dwell / thermal-recovery interval — same as the single
 *  Cutter Lance (0.6 s). */
const TWIN_CUTTER_COOLDOWN = cooldownTicks(0.6);

/** Targeting bank round mass (kg) — the capital-band targeting round (100 kg),
 *  fifty times the twin-cannon's 2 kg autocannon slug, folding the capital
 *  per-shot damage scalar into the anchor. */
const TARGETING_BANK_MASS_KG = 100 * PROJECTILE_MASS_KG.autocannon;
/** Targeting bank muzzle velocity (m/s) — the autocannon band (4 km/s). */
const TARGETING_BANK_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.autocannon;
/** Targeting bank cyclic-feed interval — the autocannon band's reload. */
const TARGETING_BANK_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.autocannon);

/** Tetromino coilgun round mass (kg) — the capital-band three-barrel round
 *  (1500 kg), three railgun slugs' throw weight on a T-shaped mount with the
 *  capital damage scalar folded in, 1.5× the 2-cell Coilgun Bank's per-shot
 *  mass to match the 3-vs-2 barrel ratio. */
const TETROMINO_COILGUN_MASS_KG = 150 * PROJECTILE_MASS_KG.railgun;
/** Tetromino coilgun muzzle velocity (m/s) — the railgun band (8 km/s). */
const TETROMINO_COILGUN_MUZZLE_MS = MUZZLE_VELOCITY_M_PER_S.railgun;
/** Tetromino coilgun load cycle — the railgun band's capacitor recharge. */
const TETROMINO_COILGUN_COOLDOWN = cooldownTicks(RELOAD_THERMAL_TIME_S.railgun);

/** Precision drive thrust (N) — the `precision` drive class the single Ion
 *  Thruster uses (60 kN). Imported locally for the blink-drive mass fraction. */
const PRECISION_THRUST_N = driveThrustNewtons("precision");
/** Twin ion-thruster bank thrust (N) — 2× the precision drive, two ganged
 *  nozzles on the Ion Drive Bank. */
const TWIN_ION_THRUST_N = 2 * PRECISION_THRUST_N;

/** Mine-drone layer mass (kg) — three cells of precision emplacement, each 0.8×
 *  a single Targeting Cannon's derived mechanism mass. */
const MINE_DRONE_LAYER_MASS =
  3 * (kineticWeaponMass(
    PROJECTILE_MASS_KG.autocannon,
    MUZZLE_VELOCITY_M_PER_S.autocannon,
    WEAPON_DENSITY,
  ) * 0.8);

/** Tactical blink mass (kg) — two cells of phase-shift coils, each 0.2× a
 *  single precision-drive mechanism (a blink sac is a fraction of a real
 *  engine's throw weight). */
const TACTICAL_BLINK_MASS = 2 * (engineMass(PRECISION_THRUST_N, ENGINE_DENSITY) * 0.2);

/** ECCM bastion mass (kg) — four cells of dense electronics at the single
 *  ECCM Suite's derived 12,000 kg per cell. */
const ECCM_BASTION_MASS = 4 * 12_000;

/** Sensor bastion mass (kg) — three cells of dense optics at the single Active
 *  Sensor Array's derived 16,000 kg per cell. */
const SENSOR_BASTION_MASS = 3 * 16_000;

/** Drone launch deck mass (kg) — three cells of fabrication + launch mechanism
 *  at the single Drone Hangar's derived 84,000 kg per cell. */
const DRONE_LAUNCH_DECK_MASS = 3 * 84_000;

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
  // --- Expansion footprints ---
  /** 1×2 line — twin sustained cutter beams on a common emitter. */
  twinCutter: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 1×2 line — twin precision cannons on a traversing bank. */
  targetingBank: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** T-tetromino — three coilgun barrels on a traversing mount (centre + east
   *  + west barrels and a south feed). */
  tetrominoCoilgun: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** L-tromino — three cells of precision mine emplacement. */
  mineDroneLayer: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** 1×2 line — twin phase-shift coils for a tactical blink. */
  tacticalBlink: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  /** 2×2 block — four cells of ECCM electronics. */
  eccmBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** L-tromino — three cells of dense active-sensor optics. */
  sensorBastion: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  /** 2×2 block — four cells of capital momentum-screen projectors. */
  phalanxDeflector: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ],
  /** 1×3 line — three ganged fabrication + launch cells for a drone swarm. */
  droneLaunchDeck: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
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
    // 1000 kg @ 8 km/s (capital-band gauss mass, railgun muzzle). Muzzle energy
    // ½·1000·8000² = 32 GJ. Mass derived from muzzle energy at the mid-density
    // machined-alloy weapon density.
    // mass = 4200 × (3.2e10 / 2e7) = 6,720,000 kg (~6720 t) — fifty times the
    // single coilgun's 134,400 kg, matching the folded damage scalar.
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
      damage: kineticDamageJoules(COILGUN_BANK_MASS_KG, COILGUN_BANK_MUZZLE_MS),
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
      ammo: 240,
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
      droneDamage: 250,
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
    mass: engineMass(TWIN_ION_THRUST_N, ENGINE_DENSITY),
    cost: 90,
    // Two nozzles draw twice the single drive's power-conditioning load.
    powerDraw: 2 * MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 2,
    footprint: SYNTHETIC_FOOTPRINTS.thrusterBank,
    effect: { kind: "engine", thrust: TWIN_ION_THRUST_N },
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
      damage: 36,
      range: 160,
      cooldown: 6,
      hitChance: 0.7,
      tracking: 2.6,
    },
    pointDefense: true,
  },
  // --- Expansion modules: frigate/cruiser/capital multi-cell variants ---
  {
    id: "syn-twin-cutter",
    faction: "Synthetic",
    name: "Twin Cutter",
    description:
      "Twin sustained cutter beams on a common emitter mounting. One band above the single Cutter Lance's pulse — a 2×1 battery the Collective's cruiser line brings to bear for stripping shields and drones.",
    category: "weapon",
    // 600 MW sustained beam (BEAM_POWER_W.beam, one band above the cutter
    // lance's 300 MW pulse). Mass derived from beam power at the precision
    // emitter density.
    // mass = 3500 × (6e8 / 4e7) = 52,500 kg (~53 t).
    mass: beamWeaponMass(TWIN_CUTTER_POWER_W, BEAM_DENSITY),
    cost: 140,
    // A beam's draw IS its delivered optical power.
    powerDraw: TWIN_CUTTER_POWER_W,
    crewRequired: 0,
    techLevel: 3,
    footprint: SYNTHETIC_FOOTPRINTS.twinCutter,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: beamDamageJoules(TWIN_CUTTER_POWER_W, TWIN_CUTTER_COOLDOWN),
      range: BEAM_RANGE_M,
      cooldown: TWIN_CUTTER_COOLDOWN,
      projectileSpeed: 0,
      projectileMass: 0,
      tracking: 0,
      shieldPiercing: 0.5,
      armourPiercing: 0.15,
      spread: 0,
    },
  },
  {
    id: "syn-targeting-bank",
    faction: "Synthetic",
    name: "Targeting Bank",
    description:
      "Twin precision cannons on a traversing bank. Twice the throw weight of the single Targeting Cannon at the same muzzle velocity and a tighter tracking cluster — the Collective's frigate-grade kinetic upgrade.",
    category: "weapon",
    // 100 kg @ 4 km/s (capital-band autocannon mass). Mass derived from muzzle
    // energy at the mid-density machined-alloy weapon density.
    // mass = 4200 × (8e8 / 2e7) = 168,000 kg (~168 t).
    mass: kineticWeaponMass(
      TARGETING_BANK_MASS_KG,
      TARGETING_BANK_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 110,
    // Two barrels draw twice the single cannon's capacitor-recharge load.
    powerDraw: 2 * MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 2,
    footprint: SYNTHETIC_FOOTPRINTS.targetingBank,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(TARGETING_BANK_MASS_KG, TARGETING_BANK_MUZZLE_MS),
      range: kineticRangeM(TARGETING_BANK_MUZZLE_MS),
      cooldown: TARGETING_BANK_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(TARGETING_BANK_MUZZLE_MS),
      projectileMass: TARGETING_BANK_MASS_KG,
      tracking: 1.8,
      shieldPiercing: 0.2,
      armourPiercing: 0.35,
      spread: 0.008,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.07,
      powered: false,
      guided: false,
      ammo: 440,
      ammoCapacity: 440,
    },
  },
  {
    id: "syn-tetromino-coilgun",
    faction: "Synthetic",
    name: "Tetromino Coilgun",
    description:
      "A T-shaped three-barrel coilgun array. One more barrel over the Coilgun Bank on a traversing mount, tripling the dreadnought's alpha strike with the same electromagnetic reach.",
    category: "weapon",
    // 1500 kg @ 8 km/s (three railgun slugs on a T-shaped three-barrel mount,
    // capital damage scalar folded in — 1.5× the 2-cell Coilgun Bank's per-shot
    // mass). Mass derived from muzzle energy at the mid-density machined-alloy
    // weapon density.
    // mass = 4200 × (4.8e10 / 2e7) = 10,080,000 kg (~10080 t).
    mass: kineticWeaponMass(
      TETROMINO_COILGUN_MASS_KG,
      TETROMINO_COILGUN_MUZZLE_MS,
      WEAPON_DENSITY,
    ),
    cost: 280,
    // Three barrels draw three times the single coilgun's capacitor load.
    powerDraw: 3 * MODULE_POWER_DRAW_W.kineticWeapon,
    crewRequired: 0,
    techLevel: 4,
    footprint: SYNTHETIC_FOOTPRINTS.tetrominoCoilgun,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: kineticDamageJoules(TETROMINO_COILGUN_MASS_KG, TETROMINO_COILGUN_MUZZLE_MS),
      range: kineticRangeM(TETROMINO_COILGUN_MUZZLE_MS),
      cooldown: TETROMINO_COILGUN_COOLDOWN,
      projectileSpeed: projectileSpeedMPerTick(TETROMINO_COILGUN_MUZZLE_MS),
      projectileMass: TETROMINO_COILGUN_MASS_KG,
      tracking: 1.3,
      shieldPiercing: 0.3,
      armourPiercing: 0.65,
      spread: 0.005,
      turretArc: Math.PI / 2,
      turretTurnRate: 0.07,
      powered: false,
      guided: false,
      ammo: 360,
      ammoCapacity: 360,
    },
  },
  {
    id: "syn-mine-drone-layer",
    faction: "Synthetic",
    name: "Mine-Drone Layer",
    description:
      "An L-shaped three-cell mine-emplacement bay. Precision-laid proximity mines the Collective drops in an enemy's path — a role the single-cell catalogue leaves open.",
    category: "weapon",
    // Three cells of precision emplacement mechanism, each 0.8× a single
    // Targeting Cannon's derived mechanism mass.
    mass: MINE_DRONE_LAYER_MASS,
    cost: 200,
    powerDraw: MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 3,
    footprint: SYNTHETIC_FOOTPRINTS.mineDroneLayer,
    effect: {
      kind: "mineLayer",
      mineCount: 8,
      mineDamage: 60,
      mineRadius: 90,
      layCooldown: 180,
      armingDelay: 10,
    },
  },
  {
    id: "syn-tactical-blink",
    faction: "Synthetic",
    name: "Tactical Blink Drive",
    description:
      "A 2×1 phase-shift coil bank that teleports the hull a short distance on a short cooldown. The Collective's first blink drive — a combat reposition the single-cell catalogue does not field.",
    category: "propulsion",
    // Two cells of phase-shift coils, each 0.2× a single precision-drive
    // mechanism (a blink coil is a fraction of a real engine's throw weight).
    mass: TACTICAL_BLINK_MASS,
    cost: 150,
    powerDraw: MODULE_POWER_DRAW_W.drive,
    crewRequired: 0,
    techLevel: 3,
    footprint: SYNTHETIC_FOOTPRINTS.tacticalBlink,
    effect: {
      kind: "blink",
      mode: "tactical",
      jumpRange: 200,
      cooldown: 60,
    },
  },
  {
    id: "syn-eccm-bastion",
    faction: "Synthetic",
    name: "ECCM Bastion",
    description:
      "A 2×2 block of four ECCM suites. Capital-grade counter-jamming that nearly fully restores weapon tracking and missile lock stripped by enemy ECM — a role the single-cell suite only partially covers.",
    category: "system",
    // Four cells of dense electronics at the single ECCM Suite's derived
    // 12,000 kg per cell.
    // mass = 4 × 12,000 = 48,000 kg (~48 t).
    mass: ECCM_BASTION_MASS,
    cost: 240,
    // Four cells draw four times the single suite's sensor-class load.
    powerDraw: 4 * MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 4,
    footprint: SYNTHETIC_FOOTPRINTS.eccmBastion,
    effect: {
      kind: "eccm",
      trackingRestore: 0.9,
    },
  },
  {
    id: "syn-sensor-bastion",
    faction: "Synthetic",
    name: "Sensor Bastion",
    description:
      "An L-tromino of three dense active-sensor arrays. Wider detection range and the same cloak-piercing active sweep the Collective uses to catch stealth raiders — a capital-grade upgrade over the single array.",
    category: "system",
    // Three cells of dense optics + electronics at the single Active Sensor
    // Array's derived 16,000 kg per cell.
    // mass = 3 × 16,000 = 48,000 kg (~48 t).
    mass: SENSOR_BASTION_MASS,
    cost: 240,
    // Three cells draw three times the single array's sensor-class load.
    powerDraw: 3 * MODULE_POWER_DRAW_W.sensor,
    crewRequired: 0,
    techLevel: 4,
    footprint: SYNTHETIC_FOOTPRINTS.sensorBastion,
    effect: {
      kind: "sensor",
      sensorType: "omni",
      detectionRange: 1.5 * 600 * KM_DETECTION_RANGE_SCALE,
      arc: SENSOR_OMNI_ARC,
      bearing: 0,
      nebulaImmune: true,
      pierceCloak: true,
      mode: "active",
      sweepRate: 0.15,
      emitStrength: 1000 * ACTIVE_SENSOR_EMISSION_SCALE,
      gain: 3.0,
    },
  },
  {
    id: "syn-phalanx-deflector",
    faction: "Synthetic",
    name: "Phalanx Deflector",
    description:
      "A 2×2 block of four capital momentum-screen projectors. Arrests three times the single Grid Deflector's impulse before collapsing, buying the point-defence net the time it needs to exhaust an attacker's volley.",
    category: "defence",
    // Three times the single Grid Deflector's light-band momentum capacity.
    // Mass derived from momentum capacity at the Synthetic shield density.
    mass: deflectorMass(3 * DEFLECTOR_CAPACITY_KG_MPS.light, SHIELD_DENSITY),
    cost: 240,
    // Three cells of projector draw three times the single deflector's
    // recharge wattage.
    powerDraw: 3 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.light,
    crewRequired: 0,
    techLevel: 4,
    footprint: SYNTHETIC_FOOTPRINTS.phalanxDeflector,
    effect: {
      kind: "deflector",
      capacity: 3 * DEFLECTOR_CAPACITY_KG_MPS.light,
      rechargeRate: 3 * DEFLECTOR_RECHARGE_KG_MPS_PER_S.light,
      rechargeDelay: 60,
    },
  },
  {
    id: "syn-drone-launch-deck",
    faction: "Synthetic",
    name: "Drone Launch Deck",
    description:
      "A 1×3 fabrication and launch deck. Three cells of precision manufacturing feed a twelve-drone swarm the Collective's flagship puts into space before the lines close — the heaviest drone capability in the catalogue.",
    category: "weapon",
    // Three cells of fabrication + launch mechanism at the single Drone
    // Hangar's derived 84,000 kg per cell.
    // mass = 3 × 84,000 = 252,000 kg (~252 t).
    mass: DRONE_LAUNCH_DECK_MASS,
    cost: 450,
    // Three cells draw three times the single hangar's ordnance-handling load.
    powerDraw: 3 * MODULE_POWER_DRAW_W.ordnanceWeapon,
    crewRequired: 0,
    techLevel: 5,
    footprint: SYNTHETIC_FOOTPRINTS.droneLaunchDeck,
    effect: {
      kind: "hangar",
      droneCount: 12,
      launchCooldown: 70,
      droneHp: 45,
      droneDamage: 250,
      droneRange: 100,
      droneSpeed: 5,
    },
  },
];
