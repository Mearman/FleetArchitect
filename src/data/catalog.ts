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
 */

const hullTileData: HullTileDefinition[] = [
  { type: "block", name: "Hull Block", mass: 6, hp: 60 },
  { type: "edge", name: "Hull Edge", mass: 4, hp: 45 },
  { type: "corner", name: "Hull Corner", mass: 3, hp: 35 },
  { type: "strut", name: "Hull Strut", mass: 2, hp: 25 },
];

const moduleData: ModuleDefinition[] = [
  // --- Weapons ---
  {
    id: "mod-pulse-laser",
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
    name: "Railgun Turret",
    description: "High-velocity kinetic slug on a powered mount that tracks across a wide arc. Strong range and armour penetration, slow refire.",
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
      // A 90° (±π/2) turret that slews briskly to bear on its target.
      turretArc: Math.PI / 2,
      turretTurnRate: 0.08,
    },
  },
  {
    id: "mod-missile-rack",
    name: "Missile Turret",
    description: "Homing missiles on a fully-rotating launcher that can engage targets in any direction. Great damage, easily defeated by point defences.",
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
      // A full 360° launcher (±π) that slews slowly.
      turretArc: Math.PI,
      turretTurnRate: 0.05,
    },
  },
  {
    id: "mod-plasma-torpedo",
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
