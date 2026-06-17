import { createCatalog, type Catalog } from "@/domain/catalog";
import { HullTileDefinition } from "@/schema/hull";
import { ModuleDefinition } from "@/schema/module";

/**
 * The bundled starter catalog. Hull tiles and modules are authored as plain
 * objects and validated against the schema at load time, so a malformed entry
 * fails loudly rather than producing a broken ship. A larger catalog is pure
 * content and can be expanded without touching engine or UI code.
 *
 * Scale notes for the simulation engine: cell positions derive from the grid
 * (see `cellToLocal`) and `range` is in "battle units"; `thrust` is
 * acceleration per tick; `cooldown` is ticks between shots.
 *
 * Each entry carries a `faction` field: parts from different factions cannot
 * be mixed on a single ship design.
 */

// ---------------------------------------------------------------------------
// Terran hull tiles — robust ferro-steel construction, solid mass and HP.
// ---------------------------------------------------------------------------
const hullTileData: HullTileDefinition[] = [
  { type: "block",  faction: "Terran", name: "Hull Block",   mass: 6, hp: 60 },
  { type: "edge",   faction: "Terran", name: "Hull Edge",    mass: 4, hp: 45 },
  { type: "corner", faction: "Terran", name: "Hull Corner",  mass: 3, hp: 35 },
  { type: "strut",  faction: "Terran", name: "Hull Strut",   mass: 2, hp: 25 },
  // Swarm hull tiles — chitin-lattice bio-plating: lighter than Terran steel
  // but with proportionally more HP per unit of mass, reflecting the organic
  // self-sealing matrix.
  { type: "block",  faction: "Swarm", name: "Chitin Carapace",  mass: 4, hp: 70 },
  { type: "edge",   faction: "Swarm", name: "Chitin Plate",     mass: 3, hp: 52 },
  { type: "corner", faction: "Swarm", name: "Chitin Spur",      mass: 2, hp: 40 },
  { type: "strut",  faction: "Swarm", name: "Chitin Filament",  mass: 1, hp: 30 },
];

// ---------------------------------------------------------------------------
// Terran modules — conventional human technology.
// ---------------------------------------------------------------------------
const moduleData: ModuleDefinition[] = [
  // --- Weapons ---
  {
    id: "mod-pulse-laser",
    faction: "Terran",
    name: "Pulse Laser",
    description: "Fast, reliable hitscan beam. Cheap and accurate, but low per-hit damage.",
    category: "weapon",
    mass: 4,
    cost: 40,
    powerDraw: 6,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: 6,
      range: 320,
      cooldown: 30,
      projectileSpeed: 0,
      tracking: 0,
      shieldPiercing: 0,
      armourPiercing: 0.1,
      spread: 0,
    },
  },
  {
    id: "mod-railgun",
    faction: "Terran",
    name: "Railgun",
    description: "High-velocity kinetic slug. Strong range and armour penetration, slow refire.",
    category: "weapon",
    mass: 12,
    cost: 90,
    powerDraw: 12,
    crewRequired: 2,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: 22,
      range: 480,
      cooldown: 90,
      projectileSpeed: 8,
      tracking: 0.5,
      shieldPiercing: 0.2,
      armourPiercing: 0.5,
      spread: 0.02,
    },
  },
  {
    id: "mod-missile-rack",
    faction: "Terran",
    name: "Missile Rack",
    description: "Homing missiles that track their target. Great damage, easily defeated by point defences.",
    category: "weapon",
    mass: 14,
    cost: 110,
    powerDraw: 8,
    crewRequired: 2,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: 30,
      range: 560,
      cooldown: 140,
      projectileSpeed: 4,
      tracking: 2.5,
      shieldPiercing: 0,
      armourPiercing: 0.3,
      spread: 0.4,
    },
  },
  {
    id: "mod-plasma-torpedo",
    faction: "Terran",
    name: "Plasma Torpedo",
    description: "Slow, devastating torpedo. Bypasses some shields and melts armour.",
    category: "weapon",
    mass: 20,
    cost: 180,
    powerDraw: 16,
    crewRequired: 3,
    techLevel: 3,
    effect: {
      kind: "weapon",
      weaponType: "torpedo",
      damage: 70,
      range: 420,
      cooldown: 220,
      projectileSpeed: 2.5,
      tracking: 1,
      shieldPiercing: 0.3,
      armourPiercing: 0.4,
      spread: 0.05,
    },
  },
  // --- Defence: shields ---
  {
    id: "mod-shield-mk1",
    faction: "Terran",
    name: "Deflector Shield Mk I",
    description: "Regenerating energy shield. Absorbs hits before they reach the hull.",
    category: "defence",
    mass: 6,
    cost: 70,
    powerDraw: 6,
    crewRequired: 1,
    techLevel: 1,
    effect: {
      kind: "shield",
      capacity: 120,
      rechargeRate: 1.2,
      rechargeDelay: 60,
    },
  },
  {
    id: "mod-shield-mk2",
    faction: "Terran",
    name: "Deflector Shield Mk II",
    description: "Heavy shield array with greater capacity and faster recharge.",
    category: "defence",
    mass: 10,
    cost: 150,
    powerDraw: 12,
    crewRequired: 2,
    techLevel: 3,
    effect: {
      kind: "shield",
      capacity: 260,
      rechargeRate: 2.4,
      rechargeDelay: 70,
    },
  },
  // --- Defence: armour ---
  {
    id: "mod-armour-titanium",
    faction: "Terran",
    name: "Titanium Plating",
    description: "Adds hull structure and shaves a quarter off incoming hull damage.",
    category: "defence",
    mass: 16,
    cost: 40,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "armour",
      hitpoints: 80,
      damageReduction: 0.25,
    },
  },
  {
    id: "mod-armour-ablative",
    faction: "Terran",
    name: "Ablative Hull",
    description: "Dense reactive plating. Lots of structure and heavy damage reduction.",
    category: "defence",
    mass: 30,
    cost: 90,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "armour",
      hitpoints: 160,
      damageReduction: 0.45,
    },
  },
  // --- Propulsion ---
  {
    id: "mod-engine-ion",
    faction: "Terran",
    name: "Ion Drive",
    description: "Efficient thruster for basic mobility.",
    category: "propulsion",
    mass: 4,
    cost: 30,
    powerDraw: 4,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: 0.5, turnRate: 0.04 },
  },
  {
    id: "mod-engine-plasma",
    faction: "Terran",
    name: "Plasma Drive",
    description: "High-thrust engine for fast, agile ships.",
    category: "propulsion",
    mass: 8,
    cost: 70,
    powerDraw: 8,
    crewRequired: 1,
    techLevel: 2,
    effect: { kind: "engine", thrust: 0.9, turnRate: 0.06 },
  },
  // --- System: power ---
  {
    id: "mod-reactor-fusion",
    faction: "Terran",
    name: "Fusion Reactor",
    description: "Supplies power to the rest of the ship's modules.",
    category: "system",
    mass: 10,
    cost: 80,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 1,
    effect: { kind: "power", output: 40 },
    command: true,
  },
  {
    id: "mod-reactor-antimatter",
    faction: "Terran",
    name: "Antimatter Core",
    description: "Compact, enormous power output for energy-hungry designs.",
    category: "system",
    mass: 16,
    cost: 180,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 3,
    effect: { kind: "power", output: 90 },
    command: true,
  },
  // --- Crew ---
  {
    id: "mod-crew-quarters",
    faction: "Terran",
    name: "Crew Quarters",
    description: "Habitation and life support, increasing the crew a ship can sustain.",
    category: "crew",
    mass: 6,
    cost: 30,
    powerDraw: 2,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "crew", capacity: 8 },
  },

  // ---------------------------------------------------------------------------
  // Swarm modules — bio-organic alien technology. The Swarm uses living ships
  // grown rather than built: lighter, faster-firing but lower raw damage;
  // bio-regeneration instead of mechanical shields; neural ganglia as command
  // nodes; metabolic bio-reactors instead of fusion plants.
  // ---------------------------------------------------------------------------

  // --- Weapons ---
  {
    id: "swm-spore-launcher",
    faction: "Swarm",
    name: "Spore Launcher",
    description: "Rapid-fire organic spore bursts. Low individual damage but very fast refire and high spread.",
    category: "weapon",
    mass: 3,
    cost: 35,
    powerDraw: 3,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "cannon",
      damage: 4,
      range: 260,
      cooldown: 18,
      projectileSpeed: 6,
      tracking: 0.8,
      shieldPiercing: 0.15,
      armourPiercing: 0,
      spread: 0.12,
    },
  },
  {
    id: "swm-acid-sprayer",
    faction: "Swarm",
    name: "Acid Sprayer",
    description: "Hitscan corrosive jet. Short range but dissolves armour plating rapidly.",
    category: "weapon",
    mass: 5,
    cost: 55,
    powerDraw: 5,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "weapon",
      weaponType: "beam",
      damage: 8,
      range: 180,
      cooldown: 25,
      projectileSpeed: 0,
      tracking: 0,
      shieldPiercing: 0,
      armourPiercing: 0.45,
      spread: 0,
    },
  },
  {
    id: "swm-neural-sting",
    faction: "Swarm",
    name: "Neural Sting",
    description: "Bio-electric homing tendril. Moderate damage with excellent tracking.",
    category: "weapon",
    mass: 8,
    cost: 80,
    powerDraw: 7,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "weapon",
      weaponType: "missile",
      damage: 18,
      range: 440,
      cooldown: 90,
      projectileSpeed: 5,
      tracking: 3.5,
      shieldPiercing: 0.1,
      armourPiercing: 0.2,
      spread: 0.05,
    },
  },
  // --- Defence: bio-regen instead of shields ---
  {
    id: "swm-regen-membrane",
    faction: "Swarm",
    name: "Regeneration Membrane",
    description: "Living hull membrane that rapidly knits damage back together.",
    category: "defence",
    mass: 5,
    cost: 65,
    powerDraw: 4,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "repair",
      repairRate: 4,
    },
  },
  {
    id: "swm-spore-cloud",
    faction: "Swarm",
    name: "Spore Cloud Emitter",
    description: "Releases a dense cloud of microscopic organisms that intercept incoming fire.",
    category: "defence",
    mass: 7,
    cost: 90,
    powerDraw: 5,
    crewRequired: 0,
    techLevel: 2,
    effect: {
      kind: "pointDefense",
      damage: 8,
      range: 100,
      cooldown: 10,
      hitChance: 0.35,
      tracking: 1.5,
    },
    pointDefense: true,
  },
  {
    id: "swm-carapace-plating",
    faction: "Swarm",
    name: "Carapace Plating",
    description: "Thickened bio-armour that absorbs incoming kinetic impacts.",
    category: "defence",
    mass: 12,
    cost: 45,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 1,
    effect: {
      kind: "armour",
      hitpoints: 100,
      damageReduction: 0.3,
    },
  },
  // --- Propulsion ---
  {
    id: "swm-flagellum-drive",
    faction: "Swarm",
    name: "Flagellum Drive",
    description: "Biological jet propulsion. Light and fast with excellent manoeuvrability.",
    category: "propulsion",
    mass: 3,
    cost: 28,
    powerDraw: 2,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "engine", thrust: 0.65, turnRate: 0.07 },
  },
  {
    id: "swm-pulse-jet",
    faction: "Swarm",
    name: "Pulse Jet Organ",
    description: "High-output muscular jet for rapid bursts of speed.",
    category: "propulsion",
    mass: 6,
    cost: 60,
    powerDraw: 6,
    crewRequired: 0,
    techLevel: 2,
    effect: { kind: "engine", thrust: 1.1, turnRate: 0.05 },
  },
  // --- System: neural command / bio-power ---
  {
    id: "swm-neural-ganglion",
    faction: "Swarm",
    name: "Neural Ganglion",
    description: "Distributed nerve cluster that co-ordinates the ship's organic systems and acts as its command node.",
    category: "system",
    mass: 6,
    cost: 70,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "power", output: 30 },
    command: true,
  },
  {
    id: "swm-metabolic-core",
    faction: "Swarm",
    name: "Metabolic Core",
    description: "Central bio-reactor organ converting raw biomass into usable energy.",
    category: "system",
    mass: 12,
    cost: 160,
    powerDraw: 0,
    crewRequired: 0,
    techLevel: 3,
    effect: { kind: "power", output: 75 },
    command: true,
  },
];

export const hullTiles: readonly HullTileDefinition[] = hullTileData.map((tile) =>
  HullTileDefinition.parse(tile),
);
export const modules: readonly ModuleDefinition[] = moduleData.map((mod) =>
  ModuleDefinition.parse(mod),
);

let catalogSingleton: Catalog | undefined;

/** Process-wide catalog singleton over the bundled data. */
export function catalog(): Catalog {
  if (catalogSingleton === undefined) {
    catalogSingleton = createCatalog(modules, hullTiles);
  }
  return catalogSingleton;
}
