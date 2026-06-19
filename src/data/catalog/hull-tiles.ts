import type { HullTileDefinition } from "@/schema/hull";

/**
 * Bundled hull tile definitions, grouped by faction. Each entry is validated
 * against the schema at load time in `index.ts`. Tiles are plain data; a larger
 * catalogue is pure content and can be expanded without touching engine or UI
 * code.
 *
 * Scale notes for the simulation engine: cell positions derive from the grid
 * (see `cellToLocal`).
 */

// ---------------------------------------------------------------------------
// Terran hull tiles — robust ferro-steel construction, solid mass and HP.
// ---------------------------------------------------------------------------
export const hullTileData: HullTileDefinition[] = [
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
  // Crystalline Concord hull tiles — grown crystal lattices: very light and
  // energy-conductive but brittle, shattering under kinetic hits. The lowest
  // HP-per-mass of any faction; they survive through shields, not structure.
  { type: "block",  faction: "Crystalline", name: "Crystal Matrix",   mass: 3, hp: 38 },
  { type: "edge",   faction: "Crystalline", name: "Crystal Facet",    mass: 2, hp: 28 },
  { type: "corner", faction: "Crystalline", name: "Crystal Vertex",   mass: 2, hp: 22 },
  { type: "strut",  faction: "Crystalline", name: "Crystal Filament", mass: 1, hp: 16 },
  // Foundry Combine hull tiles — furnace-forged composite plate: the heaviest,
  // toughest structure in the catalogue. Foundry ships are slow slabs that win
  // on raw hull HP and armour reduction, not agility or shields.
  { type: "block",  faction: "Foundry", name: "Bastion Plate",   mass: 9, hp: 110 },
  { type: "edge",   faction: "Foundry", name: "Bastion Frame",   mass: 6, hp: 82 },
  { type: "corner", faction: "Foundry", name: "Bastion Brace",   mass: 4, hp: 62 },
  { type: "strut",  faction: "Foundry", name: "Bastion Rib",     mass: 3, hp: 46 },
  // Corsair Reavers hull tiles — scavenged junk-hulls welded into sharp,
  // asymmetric raiders: light and fast but thin, built to strike and run.
  { type: "block",  faction: "Corsair", name: "Scrap Bulkhead",  mass: 4, hp: 48 },
  { type: "edge",   faction: "Corsair", name: "Scrap Frame",     mass: 3, hp: 36 },
  { type: "corner", faction: "Corsair", name: "Scrap Spike",     mass: 2, hp: 28 },
  { type: "strut",  faction: "Corsair", name: "Scrap Spar",      mass: 1, hp: 20 },
  // Synthetic Collective hull tiles — precision-machined modular frames:
  // moderate mass and HP, engineered for clean integration and hardwiring
  // rather than brute toughness.
  { type: "block",  faction: "Synthetic", name: "Composite Frame",   mass: 5, hp: 64 },
  { type: "edge",   faction: "Synthetic", name: "Composite Girder",  mass: 4, hp: 48 },
  { type: "corner", faction: "Synthetic", name: "Composite Node",    mass: 2, hp: 38 },
  { type: "strut",  faction: "Synthetic", name: "Composite Truss",   mass: 1, hp: 26 },
];
