import type { LayerMaterial } from "@/schema/armor";
import {
  armorMass,
  deckMass,
  scaffoldMass,
} from "./physics";

/**
 * Per-faction layer materials for the layered-cell model. Each faction has
 * three layers — `scaffold` (the structural connectivity base of every built
 * cell), `deck` (the airtight crew floor, walkable, equipment-placeable), and
 * `armor` (the solid impassable plate, high HP/mass, no equipment).
 *
 * `mass` is in real SI kilograms, derived from the physical anchors in
 * `./physics.ts` as `arealDensity × CELL_AREA_M2` (areal density itself being
 * `materialDensity × effectiveThickness`, with a void fill factor for truss
 * layers). See `physics.ts` for the per-faction areal densities.
 *
 * `hp` is in damage points (the engine's current damage unit). Phase 5
 * unifies damage in joules as
 * `materialDensity × cellArea × plateThickness × specificDestructionEnergy`;
 * until then the values below are authored catalogue content representing the
 * layer's structural tolerance, tuned so a typical weapon salvo destroys
 * armor over a few clean hits. The relative ordering is preserved from the
 * pre-SI values (Foundry heaviest, Crystalline lightest).
 *
 * `damageReduction` — fraction of incoming damage absorbed before it reaches
 * the cell; meaningful only on `armor`.
 */
export const layerMaterialData: LayerMaterial[] = [
  // Terran — ferro-steel construction (ρ ≈ 7850 kg/m³).
  {
    layer: "scaffold",
    faction: "Terran",
    hp: 25,
    damageReduction: 0,
    mass: scaffoldMass("Terran"),
  },
  {
    layer: "deck",
    faction: "Terran",
    hp: 25,
    damageReduction: 0,
    mass: deckMass("Terran"),
  },
  {
    layer: "armor",
    faction: "Terran",
    hp: 70,
    damageReduction: 0.35,
    mass: armorMass("Terran"),
  },
  // Swarm — bio-chitin plating (ρ ≈ 1100 kg/m³): lighter than Terran steel,
  // more HP per unit mass (resilient organic lattice).
  {
    layer: "scaffold",
    faction: "Swarm",
    hp: 30,
    damageReduction: 0,
    mass: scaffoldMass("Swarm"),
  },
  {
    layer: "deck",
    faction: "Swarm",
    hp: 30,
    damageReduction: 0,
    mass: deckMass("Swarm"),
  },
  {
    layer: "armor",
    faction: "Swarm",
    hp: 100,
    damageReduction: 0.3,
    mass: armorMass("Swarm"),
  },
  // Crystalline Concord — grown crystal lattices (ρ ≈ 4500 kg/m³): very
  // light and energy-conductive but brittle.
  {
    layer: "scaffold",
    faction: "Crystalline",
    hp: 16,
    damageReduction: 0,
    mass: scaffoldMass("Crystalline"),
  },
  {
    layer: "deck",
    faction: "Crystalline",
    hp: 16,
    damageReduction: 0,
    mass: deckMass("Crystalline"),
  },
  {
    layer: "armor",
    faction: "Crystalline",
    hp: 50,
    damageReduction: 0.15,
    mass: armorMass("Crystalline"),
  },
  // Foundry Combine — furnace-forged composite plate (ρ ≈ 8500 kg/m³):
  // heaviest and toughest.
  {
    layer: "scaffold",
    faction: "Foundry",
    hp: 46,
    damageReduction: 0,
    mass: scaffoldMass("Foundry"),
  },
  {
    layer: "deck",
    faction: "Foundry",
    hp: 46,
    damageReduction: 0,
    mass: deckMass("Foundry"),
  },
  {
    layer: "armor",
    faction: "Foundry",
    hp: 200,
    damageReduction: 0.5,
    mass: armorMass("Foundry"),
    reactiveReduction: 0.5,
    reactiveWindow: 90,
  },
  // Corsair Reavers — scavenged junk-hulls (ρ ≈ 3500 kg/m³): light and fast
  // but thin.
  {
    layer: "scaffold",
    faction: "Corsair",
    hp: 20,
    damageReduction: 0,
    mass: scaffoldMass("Corsair"),
  },
  {
    layer: "deck",
    faction: "Corsair",
    hp: 20,
    damageReduction: 0,
    mass: deckMass("Corsair"),
  },
  {
    layer: "armor",
    faction: "Corsair",
    hp: 60,
    damageReduction: 0.2,
    mass: armorMass("Corsair"),
  },
  // Synthetic Collective — precision-machined modular frames (ρ ≈ 6500 kg/m³).
  {
    layer: "scaffold",
    faction: "Synthetic",
    hp: 26,
    damageReduction: 0,
    mass: scaffoldMass("Synthetic"),
  },
  {
    layer: "deck",
    faction: "Synthetic",
    hp: 26,
    damageReduction: 0,
    mass: deckMass("Synthetic"),
  },
  {
    layer: "armor",
    faction: "Synthetic",
    hp: 90,
    damageReduction: 0.3,
    mass: armorMass("Synthetic"),
  },
];
