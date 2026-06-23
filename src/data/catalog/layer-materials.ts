import type { LayerMaterial } from "@/schema/armor";
import {
  armorHpJoules,
  armorMass,
  deckHpJoules,
  deckMass,
  substrateHpJoules,
  substrateMass,
} from "./physics";

/**
 * Per-faction layer materials for the layered-cell model. Each faction has
 * three layers — `substrate` (the structural connectivity base of every built
 * cell), `deck` (the airtight crew floor, walkable, equipment-placeable), and
 * `armor` (the solid impassable plate, high HP/mass, no equipment).
 *
 * `mass` is in real SI kilograms, derived from the physical anchors in
 * `./physics.ts` as `arealDensity × CELL_AREA_M2` (areal density itself being
 * `materialDensity × effectiveThickness`, with a void fill factor for truss
 * layers). See `physics.ts` for the per-faction areal densities.
 *
 * `hp` is in real joules, DERIVED from the same physical anchors as the cell's
 * mass: `layerMass(kg) × specificDestructionEnergy(faction)(J/kg)` (see
 * `substrateHpJoules` / `deckHpJoules` / `armorHpJoules` in `./physics.ts`). A
 * cell's hit-point pool is therefore a real energy budget — the energy a
 * damaging hit must deposit to destroy that mass — in the SAME joule unit as
 * weapon damage (kinetic `½·m·v²`, beam power × dwell, both authored from
 * `./combat-scale.ts`). With the catalogue's masses and specific energies this
 * lands armour cells at ~1-9 GJ and substrate/deck cells sub-GJ, preserving the
 * pre-SI relative ordering (Foundry heaviest, Crystalline lightest) because both
 * the areal density and the specific destruction energy rank that way.
 *
 * `damageReduction` — fraction of incoming damage absorbed before it reaches
 * the cell; meaningful only on `armor`. Dimensionless, unchanged by the unit
 * rescale. `reactiveReduction` / `reactiveWindow` (Foundry) are likewise a
 * dimensionless fraction and a tick count.
 */
export const layerMaterialData: LayerMaterial[] = [
  // Terran — ferro-steel construction (ρ ≈ 7850 kg/m³).
  {
    layer: "substrate",
    faction: "Terran",
    hp: substrateHpJoules("Terran"),
    damageReduction: 0,
    mass: substrateMass("Terran"),
  },
  {
    layer: "deck",
    faction: "Terran",
    hp: deckHpJoules("Terran"),
    damageReduction: 0,
    mass: deckMass("Terran"),
  },
  {
    layer: "armor",
    faction: "Terran",
    hp: armorHpJoules("Terran"),
    damageReduction: 0.35,
    mass: armorMass("Terran"),
  },
  // Swarm — bio-chitin plating (ρ ≈ 1100 kg/m³): lighter than Terran steel,
  // more HP per unit mass (resilient organic lattice).
  {
    layer: "substrate",
    faction: "Swarm",
    hp: substrateHpJoules("Swarm"),
    damageReduction: 0,
    mass: substrateMass("Swarm"),
  },
  {
    layer: "deck",
    faction: "Swarm",
    hp: deckHpJoules("Swarm"),
    damageReduction: 0,
    mass: deckMass("Swarm"),
  },
  {
    layer: "armor",
    faction: "Swarm",
    hp: armorHpJoules("Swarm"),
    damageReduction: 0.3,
    mass: armorMass("Swarm"),
  },
  // Crystalline Concord — grown crystal lattices (ρ ≈ 4500 kg/m³): very
  // light and energy-conductive but brittle.
  {
    layer: "substrate",
    faction: "Crystalline",
    hp: substrateHpJoules("Crystalline"),
    damageReduction: 0,
    mass: substrateMass("Crystalline"),
  },
  {
    layer: "deck",
    faction: "Crystalline",
    hp: deckHpJoules("Crystalline"),
    damageReduction: 0,
    mass: deckMass("Crystalline"),
  },
  {
    layer: "armor",
    faction: "Crystalline",
    hp: armorHpJoules("Crystalline"),
    damageReduction: 0.15,
    mass: armorMass("Crystalline"),
  },
  // Foundry Combine — furnace-forged composite plate (ρ ≈ 8500 kg/m³):
  // heaviest and toughest.
  {
    layer: "substrate",
    faction: "Foundry",
    hp: substrateHpJoules("Foundry"),
    damageReduction: 0,
    mass: substrateMass("Foundry"),
  },
  {
    layer: "deck",
    faction: "Foundry",
    hp: deckHpJoules("Foundry"),
    damageReduction: 0,
    mass: deckMass("Foundry"),
  },
  {
    layer: "armor",
    faction: "Foundry",
    hp: armorHpJoules("Foundry"),
    damageReduction: 0.5,
    mass: armorMass("Foundry"),
    reactiveReduction: 0.5,
    reactiveWindow: 90,
  },
  // Corsair Reavers — scavenged junk-hulls (ρ ≈ 3500 kg/m³): light and fast
  // but thin.
  {
    layer: "substrate",
    faction: "Corsair",
    hp: substrateHpJoules("Corsair"),
    damageReduction: 0,
    mass: substrateMass("Corsair"),
  },
  {
    layer: "deck",
    faction: "Corsair",
    hp: deckHpJoules("Corsair"),
    damageReduction: 0,
    mass: deckMass("Corsair"),
  },
  {
    layer: "armor",
    faction: "Corsair",
    hp: armorHpJoules("Corsair"),
    damageReduction: 0.2,
    mass: armorMass("Corsair"),
  },
  // Synthetic Collective — precision-machined modular frames (ρ ≈ 6500 kg/m³).
  {
    layer: "substrate",
    faction: "Synthetic",
    hp: substrateHpJoules("Synthetic"),
    damageReduction: 0,
    mass: substrateMass("Synthetic"),
  },
  {
    layer: "deck",
    faction: "Synthetic",
    hp: deckHpJoules("Synthetic"),
    damageReduction: 0,
    mass: deckMass("Synthetic"),
  },
  {
    layer: "armor",
    faction: "Synthetic",
    hp: armorHpJoules("Synthetic"),
    damageReduction: 0.3,
    mass: armorMass("Synthetic"),
  },
];
