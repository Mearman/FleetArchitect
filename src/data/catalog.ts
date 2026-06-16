import { createCatalog, type Catalog } from "@/domain/catalog";
import { HullDefinition } from "@/schema/hull";
import { ModuleDefinition } from "@/schema/module";

/**
 * The bundled starter catalog. Hulls and modules are authored as plain objects
 * and validated against the schema at load time, so a malformed entry fails
 * loudly rather than producing a broken ship. A larger catalog is pure content
 * and can be expanded without touching engine or UI code.
 *
 * Scale notes for the simulation engine: positions and `range` are in "battle
 * units"; `thrust` is acceleration per tick; `cooldown` is ticks between shots.
 */

const hullData: HullDefinition[] = [
  {
    id: "hull-wasp",
    name: "Wasp Interceptor",
    faction: "Terran",
    classification: "fighter",
    massCapacity: 22,
    baseCost: 60,
    baseStructure: 70,
    baseSpeed: 0.9,
    baseTurnRate: 0.12,
    slots: [
      { id: "wasp-weapon-1", type: "weapon", position: { x: 14, y: 0 } },
      { id: "wasp-general-1", type: "general", position: { x: 0, y: -3 } },
      { id: "wasp-engine-1", type: "engine", position: { x: -9, y: 0 } },
      { id: "wasp-system-1", type: "system", position: { x: 2, y: 6 } },
    ],
    shape: {
      outline: [
        { x: 16, y: 0 },
        { x: -10, y: -9 },
        { x: -5, y: 0 },
        { x: -10, y: 9 },
      ],
    },
  },
  {
    id: "hull-vanguard",
    name: "Vanguard Frigate",
    faction: "Terran",
    classification: "frigate",
    massCapacity: 80,
    baseCost: 220,
    baseStructure: 240,
    baseSpeed: 0.5,
    baseTurnRate: 0.06,
    slots: [
      { id: "vanguard-weapon-1", type: "weapon", position: { x: 24, y: 0 } },
      { id: "vanguard-weapon-2", type: "weapon", position: { x: 18, y: -8 } },
      { id: "vanguard-weapon-3", type: "weapon", position: { x: 18, y: 8 } },
      { id: "vanguard-general-1", type: "general", position: { x: 0, y: -6 } },
      { id: "vanguard-general-2", type: "general", position: { x: 0, y: 6 } },
      { id: "vanguard-engine-1", type: "engine", position: { x: -20, y: -6 } },
      { id: "vanguard-engine-2", type: "engine", position: { x: -20, y: 6 } },
      { id: "vanguard-system-1", type: "system", position: { x: 10, y: 0 } },
      { id: "vanguard-system-2", type: "system", position: { x: -10, y: 0 } },
    ],
    shape: {
      outline: [
        { x: 28, y: 0 },
        { x: 8, y: -15 },
        { x: -22, y: -13 },
        { x: -26, y: 0 },
        { x: -22, y: 13 },
        { x: 8, y: 15 },
      ],
    },
  },
  {
    id: "hull-leviathan",
    name: "Leviathan Cruiser",
    faction: "Terran",
    classification: "cruiser",
    massCapacity: 200,
    baseCost: 600,
    baseStructure: 640,
    baseSpeed: 0.28,
    baseTurnRate: 0.03,
    slots: [
      { id: "lev-weapon-1", type: "weapon", position: { x: 40, y: 0 } },
      { id: "lev-weapon-2", type: "weapon", position: { x: 30, y: -10 } },
      { id: "lev-weapon-3", type: "weapon", position: { x: 30, y: 10 } },
      { id: "lev-weapon-4", type: "weapon", position: { x: 18, y: -15 } },
      { id: "lev-weapon-5", type: "weapon", position: { x: 18, y: 15 } },
      { id: "lev-weapon-6", type: "weapon", position: { x: 6, y: 0 } },
      { id: "lev-general-1", type: "general", position: { x: -8, y: -10 } },
      { id: "lev-general-2", type: "general", position: { x: -8, y: 10 } },
      { id: "lev-general-3", type: "general", position: { x: 0, y: 0 } },
      { id: "lev-general-4", type: "general", position: { x: -20, y: 0 } },
      { id: "lev-engine-1", type: "engine", position: { x: -32, y: -12 } },
      { id: "lev-engine-2", type: "engine", position: { x: -32, y: 0 } },
      { id: "lev-engine-3", type: "engine", position: { x: -32, y: 12 } },
      { id: "lev-system-1", type: "system", position: { x: 24, y: 0 } },
      { id: "lev-system-2", type: "system", position: { x: 12, y: -6 } },
      { id: "lev-system-3", type: "system", position: { x: 12, y: 6 } },
    ],
    shape: {
      outline: [
        { x: 44, y: 0 },
        { x: 18, y: -21 },
        { x: -34, y: -21 },
        { x: -42, y: 0 },
        { x: -34, y: 21 },
        { x: 18, y: 21 },
      ],
    },
  },
];

const moduleData: ModuleDefinition[] = [
  // --- Weapons ---
  {
    id: "mod-pulse-laser",
    name: "Pulse Laser",
    description: "Fast, reliable hitscan beam. Cheap and accurate, but low per-hit damage.",
    category: "weapon",
    slotType: "weapon",
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
    name: "Railgun",
    description: "High-velocity kinetic slug. Strong range and armour penetration, slow refire.",
    category: "weapon",
    slotType: "weapon",
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
    name: "Missile Rack",
    description: "Homing missiles that track their target. Great damage, easily defeated by point defences.",
    category: "weapon",
    slotType: "weapon",
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
    name: "Plasma Torpedo",
    description: "Slow, devastating torpedo. Bypasses some shields and melts armour.",
    category: "weapon",
    slotType: "weapon",
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
    slotType: "general",
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
    slotType: "general",
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
    slotType: "general",
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
    slotType: "general",
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
    slotType: "engine",
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
    slotType: "engine",
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
    slotType: "system",
    mass: 10,
    cost: 80,
    powerDraw: 0,
    crewRequired: 1,
    techLevel: 1,
    effect: { kind: "power", output: 40 },
  },
  {
    id: "mod-reactor-antimatter",
    name: "Antimatter Core",
    description: "Compact, enormous power output for energy-hungry designs.",
    category: "system",
    slotType: "system",
    mass: 16,
    cost: 180,
    powerDraw: 0,
    crewRequired: 2,
    techLevel: 3,
    effect: { kind: "power", output: 90 },
  },
  // --- Crew ---
  {
    id: "mod-crew-quarters",
    name: "Crew Quarters",
    description: "Habitation and life support, increasing the crew a ship can sustain.",
    category: "crew",
    slotType: "general",
    mass: 6,
    cost: 30,
    powerDraw: 2,
    crewRequired: 0,
    techLevel: 1,
    effect: { kind: "crew", capacity: 8 },
  },
];

export const hulls: readonly HullDefinition[] = hullData.map((hull) =>
  HullDefinition.parse(hull),
);
export const modules: readonly ModuleDefinition[] = moduleData.map((mod) =>
  ModuleDefinition.parse(mod),
);

let catalogSingleton: Catalog | undefined;

/** Process-wide catalog singleton over the bundled data. */
export function catalog(): Catalog {
  if (catalogSingleton === undefined) {
    catalogSingleton = createCatalog(hulls, modules);
  }
  return catalogSingleton;
}
