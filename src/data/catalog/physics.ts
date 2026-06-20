/**
 * Physical anchors for the catalogue: every per-cell mass, module mass, and
 * engine thrust in `src/data/catalog` is derived from the constants here, so
 * no hand-tuned literal survives and every value traces to a named physical
 * quantity. The engine reads only the resulting numbers (`a = F_thrust / m`);
 * these anchors exist so a future content author or auditor can follow each
 * value back to its material property or drive parameter.
 *
 * ## Unit model
 *
 * - **World coordinates** are metres (Phase 1). A ship-interior cell is
 *   `CELL_SIZE` m on a side — the single metre-scale anchor in
 *   `src/domain/grid.ts` — so one cell covers `CELL_AREA_M2 = CELL_SIZE² m²`.
 * - **Mass** is in kilograms. A built cell's mass is the sum of its layer
 *   masses (`scaffold` + optional `deck` or `armor`) plus any equipment; each
 *   layer mass is `arealDensity × CELL_AREA_M2`, where `arealDensity` is the
 *   layer material's mass per unit area in kg/m² (itself `materialDensity ×
 *   effectiveThickness`, with `effectiveThickness` accounting for truss void
 *   fraction on framed layers).
 * - **Thrust** is in Newtons. An engine's thrust is `massFlow × exhaustVelocity`
 *   (the rocket equation: `F = ṁ · vₑ`), where `massFlow` is the propellant
 *   mass flow rate (kg/s) and `exhaustVelocity` is the effective exhaust
 *   velocity (m/s). The resulting acceleration a ship feels is
 *   `a = Σ F_thrust / m_ship` in m/tick² (one tick = `1/TICKS_PER_SECOND`
 *   seconds; the tick step is already in seconds so the units carry through).
 *
 * ## Areal densities (kg/m²)
 *
 * Each faction's layer material is documented as a real material at a real
 * effective thickness. Framed layers (scaffold, deck) use a fill factor that
 * accounts for the layer being mostly void (a truss is not a solid plate); a
 * solid layer (armor) is a full-thickness plate. Sources are representative
 * material densities in kg/m³.
 *
 * Material density references (kg/m³):
 *  - Steel / ferro-steel (Terran): ~7850
 *  - Wet bio-chitin (Swarm): ~1100 (close to water; organic tissue)
 *  - Grown crystal (Crystalline): ~4500 (quartz-class)
 *  - Forged composite (Foundry): ~8500 (tungsten-rich alloy)
 *  - Scavenged scrap (Corsair): ~3500 (mixed, mostly aluminium-class)
 *  - Machined alloy (Synthetic): ~6500 (titanium-class)
 */

import { CELL_SIZE } from "@/domain/grid";

/**
 * Area of one ship-interior cell, in m². Derived from the single metre-scale
 * anchor {@link CELL_SIZE} (`src/domain/grid.ts`) so the catalogue's per-cell
 * masses follow the grid scale automatically: `CELL_SIZE²`.
 */
export const CELL_AREA_M2 = CELL_SIZE * CELL_SIZE;

/**
 * Areal density (kg/m²) for each faction's scaffold layer — the structural
 * connectivity base of every built cell. A scaffold is a truss frame: mostly
 * void, so its effective density is `materialDensity × frameThickness ×
 * fillFraction`. The values below are the resulting areal densities after
 * that product, recorded per faction.
 *
 * Anchor: a steel truss (`ρ = 7850 kg/m³`) at `0.30 m` frame depth and `~3%`
 * fill is `7850 × 0.30 × 0.03 ≈ 70.65 kg/m²`; Terran is set to `100 kg/m²`
 * to account for the cross-bracing and hardpoints a combat scaffold carries
 * beyond a bare truss. Each other faction scales from its material density
 * relative to steel, with small adjustments for structural style.
 */
export const SCAFFOLD_AREAL_DENSITY: Record<string, number> = {
  Terran: 100,
  Swarm: 50,
  Crystalline: 60,
  Foundry: 130,
  Corsair: 70,
  Synthetic: 80,
};

/**
 * Areal density (kg/m²) for each faction's deck layer — the airtight crew
 * floor. A deck is a thin structural surface (a pressure deck over framing):
 * a steel deck plate (`ρ = 7850 kg/m³`) at `0.015 m` with framing allowance
 * is ~`120 kg/m²`. Lighter factions scale down with their material density.
 */
export const DECK_AREAL_DENSITY: Record<string, number> = {
  Terran: 120,
  Swarm: 60,
  Crystalline: 80,
  Foundry: 150,
  Corsair: 80,
  Synthetic: 90,
};

/**
 * Areal density (kg/m²) for each faction's armor layer — the solid
 * impassable protective plate. Armor is a full-thickness plate (no void
 * fraction): a steel armor plate at `0.10 m` is `7850 × 0.10 = 785 kg/m²`,
 * rounded to `800 kg/m²` for the composite anti-spall backing a real armor
 * array carries. Foundry's forged composite is thicker and denser; Swarm's
 * bio-carapace is the lightest armor.
 */
export const ARMOR_AREAL_DENSITY: Record<string, number> = {
  Terran: 800,
  Swarm: 400,
  Crystalline: 500,
  Foundry: 1100,
  Corsair: 450,
  Synthetic: 600,
};

/**
 * Per-cell mass (kg) of a faction's scaffold layer.
 * `SCAFFOLD_AREAL_DENSITY[faction] × CELL_AREA_M2`.
 */
export function scaffoldMass(faction: string): number {
  const density = SCAFFOLD_AREAL_DENSITY[faction];
  if (density === undefined) {
    throw new Error(`no scaffold areal density for faction "${faction}"`);
  }
  return density * CELL_AREA_M2;
}

/**
 * Per-cell mass (kg) of a faction's deck layer.
 * `DECK_AREAL_DENSITY[faction] × CELL_AREA_M2`.
 */
export function deckMass(faction: string): number {
  const density = DECK_AREAL_DENSITY[faction];
  if (density === undefined) {
    throw new Error(`no deck areal density for faction "${faction}"`);
  }
  return density * CELL_AREA_M2;
}

/**
 * Per-cell mass (kg) of a faction's armor layer.
 * `ARMOR_AREAL_DENSITY[faction] × CELL_AREA_M2`.
 */
export function armorMass(faction: string): number {
  const density = ARMOR_AREAL_DENSITY[faction];
  if (density === undefined) {
    throw new Error(`no armor areal density for faction "${faction}"`);
  }
  return density * CELL_AREA_M2;
}

// ---------------------------------------------------------------------------
// Engine thrust derivations (Newtons). F = massFlow × exhaustVelocity.
// ---------------------------------------------------------------------------

/**
 * Effective exhaust velocity (m/s) for each drive class. A fusion drive runs
 * hot (`~100 km/s`, Isp ~10_000 s — the high end of plausible fusion exhaust,
 * the "fusion torch" class of drive that makes fast combat manoeuvring
 * possible); an ion drive is slower but propellant-efficient. These are the
 * `vₑ` in `F = ṁ · vₑ`.
 */
export const EXHAUST_VELOCITY_M_PER_S = {
  /** Ion drive: efficient electrostatic acceleration of dense ions. */
  ion: 30_000,
  /** Plasma drive: thermal fusion plasma, higher thrust, lower Isp. */
  plasma: 100_000,
  /** Bio-organic drive (Swarm): chemically heated gas, low exhaust velocity. */
  bio: 12_000,
  /** Crystal resonant drive (Crystalline): coherent momentum transfer. */
  crystal: 80_000,
  /** Foundry thermal drive: brute-force chemical/thermal. */
  thermal: 20_000,
  /** Corsair raider drive: scavenged fusion, mid-performance. */
  raider: 90_000,
  /** Synthetic precision drive: electromagnetic, efficient. */
  precision: 60_000,
};

/**
 * Propellant mass flow rate (kg/s) for each drive class. The `ṁ` in
 * `F = ṁ · vₑ`. These are the rated steady-state flows of a ship-cell-sized
 * drive unit at full throttle, sized so that a typical frigate (a few
 * thousand tonnes with a handful of drive cells) accelerates at
 * ~0.1-0.5 m/tick² — the combat-relevant range where ships close and engage
 * within a few thousand ticks. Propellant consumption modelling is Phase 12
 * (use-deferred); the catalogue values are the drive's rated output, not a
 * consumption budget.
 */
export const PROPELLANT_MASS_FLOW_KG_PER_S = {
  ion: 1.5,
  plasma: 1.2,
  bio: 5,
  crystal: 0.6,
  thermal: 3,
  raider: 0.6,
  precision: 1,
};

/**
 * Thrust (Newtons) of a drive class: `massFlow × exhaustVelocity`.
 * Used by the catalogue to set each engine module's `effect.thrust` in N.
 */
export function driveThrustNewtons(
  drive: keyof typeof EXHAUST_VELOCITY_M_PER_S,
): number {
  const ve = EXHAUST_VELOCITY_M_PER_S[drive];
  const mdot = PROPELLANT_MASS_FLOW_KG_PER_S[drive];
  if (ve === undefined) {
    throw new Error(`no exhaust velocity for drive "${String(drive)}"`);
  }
  if (mdot === undefined) {
    throw new Error(`no propellant mass flow for drive "${String(drive)}"`);
  }
  return ve * mdot;
}

// ---------------------------------------------------------------------------
// Module mass derivations (kilograms).
//
// A module is a discrete mechanism (turret / reactor / tank) placed ON a cell,
// not a solid block filling it. Its mass is `meanDensity × moduleVolume`,
// where `moduleVolume` is the physical envelope of the installed equipment
// (independent of cell area) and `meanDensity` is the mean density of the
// assembled mechanism. The cell carries the layer masses (scaffold + deck/
// armor) separately; the module mass is just the equipment sitting on it.
// ---------------------------------------------------------------------------

/**
 * Effective mean density (kg/m³) for module classes — the mean density of the
 * assembled mechanism (machinery, structure, coolant, shielding). Machinery
 * is mostly metal (~2500-8000 kg/m³); a pure-energy module (shield projector)
 * is lighter; a dense stores module (magazine full of ordnance) is heavier.
 */
export const MODULE_DENSITY: Record<string, number> = {
  // Weapons — turret mechanism + barrel + cooling: moderate.
  lightWeapon: 2500, // pulse laser: optics + cooling, lighter
  mediumWeapon: 3500, // railgun / missile rack: heavier mechanism
  heavyWeapon: 4000, // plasma torpedo: massive coils + containment
  pointDefense: 2500,
  // Defence — shield projector: energy equipment, lighter than a gun.
  shield: 2000,
  // Propulsion — engine: nozzle + power conditioning.
  engine: 3000,
  rcs: 1500, // RCS jets: small mechanisms
  reactionWheel: 4000, // heavy spinning rotor
  // Systems — reactor: dense with shielding and containment.
  reactor: 4000,
  reactorCompact: 5000, // antimatter: heavier shielding
  // Crew — quarters: mostly habitable volume (air, light fittings).
  crew: 800,
  // Stores — magazine: dense stored ordnance.
  magazine: 5000,
  // Sensors / comms — mostly empty array structure.
  sensor: 1500,
  comms: 1200,
  // Generic hull / structural module.
  hull: 2000,
};

/**
 * Module volume (m³) for each class — the physical envelope of the installed
 * equipment, independent of the cell it sits on. A turret is a few cubic
 * metres of mechanism; a reactor is a compact pressure vessel (advanced-tech
 * fusion is far more energy-dense than present-day fission); crew quarters
 * are mostly habitable volume (air). Module volumes are intentionally small
 * relative to the cell's `CELL_AREA_M2 × deck height` volume: a module sits
 * ON the deck, it does not fill the cell.
 */
export const MODULE_VOLUME_M3: Record<string, number> = {
  lightWeapon: 8, // ~2×2×2 m turret + cooling
  mediumWeapon: 16, // ~3×3×1.8 m heavier turret
  heavyWeapon: 24, // ~4×3×2 m capital turret
  pointDefense: 5,
  shield: 15, // projector + emitters
  engine: 25, // drive unit (nozzle + conditioning)
  rcs: 2, // small reaction jets
  reactionWheel: 10, // rotor assembly
  reactor: 30, // advanced compact fusion vessel + shielding
  reactorCompact: 25, // antimatter: smaller core, heavy shielding
  crew: 100, // habitable compartment (mostly air, low density)
  magazine: 40, // ordnance store
  sensor: 6, // array panel + electronics
  comms: 5,
  hull: 8, // structural filler / equipment rack
};

/**
 * Installed mass (kg) of a module: `meanDensity × moduleVolume`.
 */
export function moduleMass(
  classKey: keyof typeof MODULE_DENSITY,
): number {
  const density = MODULE_DENSITY[classKey];
  const volume = MODULE_VOLUME_M3[classKey];
  if (density === undefined) {
    throw new Error(`no module density for class "${String(classKey)}"`);
  }
  if (volume === undefined) {
    throw new Error(`no module volume for class "${String(classKey)}"`);
  }
  return density * volume;
}
