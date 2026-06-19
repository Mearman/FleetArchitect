import type { LayerMaterial } from "@/schema/armor";

/**
 * Per-faction layer materials for the layered-cell model. Each faction has
 * three layers — `scaffold` (the structural connectivity base of every built
 * cell), `deck` (the airtight crew floor, walkable, equipment-placeable), and
 * `armor` (the solid impassable plate, high HP/mass, no equipment).
 *
 * All values are authored catalogue content documented as the physical
 * quantities they represent:
 *
 *  - `mass`  — per-cell mass. Authored as
 *              `materialDensity * cellArea * plateThickness`; recorded as the
 *              resulting value per faction.
 *  - `hp`    — energy to destroy one cell of this layer. Authored as
 *              `materialDensity * cellArea * plateThickness *
 *              specificDestructionEnergy`; recorded as the resulting value.
 *  - `damageReduction` — fraction of incoming damage absorbed before it
 *              reaches the cell; meaningful only on `armor`.
 *
 * Sources (ported verbatim from the retired ArmourEffect modules and the
 * retired HullTileDefinition strut/floor values, so the catalogue's balance
 * is preserved exactly):
 *
 *  - `armor`  per faction: the heaviest of the faction's retired armour
 *             modules. Terran ← `mod-armour-ablative` (mass 30, hp 70,
 *             damageReduction 0.35); Foundry ← `fnd-bulkhead` (mass 28,
 *             hp 200, damageReduction 0.5) with the reactive fields from
 *             `fnd-reactive-armour` (reactiveReduction 0.5, window 90);
 *             other factions ← their single armour module.
 *  - `scaffold` per faction: the retired `strut` hull-tile values (the
 *             lowest-mass, lowest-HP structural tile — now the base layer of
 *             every built cell).
 *  - `deck`   per faction: the retired `strut` hull-tile values (deck is a
 *             thin structural surface like a strut — walkable, modest mass
 *             and HP). The retired `floor` cell carried no mass/HP, so this
 *             gives deck cells a small but non-zero contribution where there
 *             was none before; the difference is bounded by the number of
 *             dedicated deck corridors in a design.
 */
export const layerMaterialData: LayerMaterial[] = [
  // Terran — ferro-steel construction.
  {
    layer: "scaffold",
    faction: "Terran",
    hp: 25,
    damageReduction: 0,
    mass: 2,
  },
  {
    layer: "deck",
    faction: "Terran",
    hp: 25,
    damageReduction: 0,
    mass: 2,
  },
  {
    layer: "armor",
    faction: "Terran",
    hp: 70,
    damageReduction: 0.35,
    mass: 30,
  },
  // Swarm — chitin-lattice bio-plating: lighter than Terran steel, more HP
  // per unit mass.
  {
    layer: "scaffold",
    faction: "Swarm",
    hp: 30,
    damageReduction: 0,
    mass: 1,
  },
  {
    layer: "deck",
    faction: "Swarm",
    hp: 30,
    damageReduction: 0,
    mass: 1,
  },
  {
    layer: "armor",
    faction: "Swarm",
    hp: 100,
    damageReduction: 0.3,
    mass: 12,
  },
  // Crystalline Concord — grown crystal lattices: very light and
  // energy-conductive but brittle.
  {
    layer: "scaffold",
    faction: "Crystalline",
    hp: 16,
    damageReduction: 0,
    mass: 1,
  },
  {
    layer: "deck",
    faction: "Crystalline",
    hp: 16,
    damageReduction: 0,
    mass: 1,
  },
  {
    layer: "armor",
    faction: "Crystalline",
    hp: 50,
    damageReduction: 0.15,
    mass: 10,
  },
  // Foundry Combine — furnace-forged composite plate: heaviest and toughest.
  {
    layer: "scaffold",
    faction: "Foundry",
    hp: 46,
    damageReduction: 0,
    mass: 3,
  },
  {
    layer: "deck",
    faction: "Foundry",
    hp: 46,
    damageReduction: 0,
    mass: 3,
  },
  {
    layer: "armor",
    faction: "Foundry",
    hp: 200,
    damageReduction: 0.5,
    mass: 28,
    reactiveReduction: 0.5,
    reactiveWindow: 90,
  },
  // Corsair Reavers — scavenged junk-hulls: light and fast but thin.
  {
    layer: "scaffold",
    faction: "Corsair",
    hp: 20,
    damageReduction: 0,
    mass: 1,
  },
  {
    layer: "deck",
    faction: "Corsair",
    hp: 20,
    damageReduction: 0,
    mass: 1,
  },
  {
    layer: "armor",
    faction: "Corsair",
    hp: 60,
    damageReduction: 0.2,
    mass: 10,
  },
  // Synthetic Collective — precision-machined modular frames.
  {
    layer: "scaffold",
    faction: "Synthetic",
    hp: 26,
    damageReduction: 0,
    mass: 1,
  },
  {
    layer: "deck",
    faction: "Synthetic",
    hp: 26,
    damageReduction: 0,
    mass: 1,
  },
  {
    layer: "armor",
    faction: "Synthetic",
    hp: 90,
    damageReduction: 0.3,
    mass: 14,
  },
];
