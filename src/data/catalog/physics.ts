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
 *   masses (`substrate` + optional `deck` or `armor`) plus any equipment; each
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
 * effective thickness. Framed layers (substrate, deck) use a fill factor that
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
 * Areal density (kg/m²) for each faction's substrate layer — the structural
 * connectivity base of every built cell. A substrate is a truss frame: mostly
 * void, so its effective density is `materialDensity × frameThickness ×
 * fillFraction`. The values below are the resulting areal densities after
 * that product, recorded per faction.
 *
 * Anchor: a steel truss (`ρ = 7850 kg/m³`) at `0.30 m` frame depth and `~3%`
 * fill is `7850 × 0.30 × 0.03 ≈ 70.65 kg/m²`; Terran is set to `100 kg/m²`
 * to account for the cross-bracing and hardpoints a combat substrate carries
 * beyond a bare truss. Each other faction scales from its material density
 * relative to steel, with small adjustments for structural style.
 */
export const SUBSTRATE_AREAL_DENSITY: Record<string, number> = {
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
 * Per-cell mass (kg) of a faction's substrate layer.
 * `SUBSTRATE_AREAL_DENSITY[faction] × CELL_AREA_M2`.
 */
export function substrateMass(faction: string): number {
  const density = SUBSTRATE_AREAL_DENSITY[faction];
  if (density === undefined) {
    throw new Error(`no substrate areal density for faction "${faction}"`);
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
 * Rated thrust (Newtons) of each drive class at full throttle — the primary
 * authored drive spec. A drive's data sheet quotes its thrust, not its
 * propellant flow: thrust is what the manufacturer rates and what each engine
 * module's `effect.thrust` carries, so it is the anchor here and the mass flow
 * below is DERIVED from it (the inverse of the previous arrangement, where the
 * flow was the authored literal and the thrust fell out of it).
 *
 * Each figure is sized to the drive's class: a fusion-torch plasma drive is the
 * highest-thrust unit a ship-cell-sized nozzle mounts, an ion drive the lowest,
 * with the faction drives banded between. These are the `F` in the rocket
 * equation `F = ṁ · vₑ`; pairing each with its {@link EXHAUST_VELOCITY_M_PER_S}
 * fixes the propellant flow {@link PROPELLANT_MASS_FLOW_KG_PER_S} as `F / vₑ`.
 */
export const DRIVE_THRUST_NEWTONS = {
  /** Ion drive: efficient but low-thrust electrostatic drive. */
  ion: 45_000,
  /** Light plasma drive: a compact fusion-torch, the entry high-thrust band. */
  lightPlasma: 80_000,
  /** Plasma drive: fusion-torch class, the standard high-thrust band. */
  plasma: 120_000,
  /** Heavy plasma drive: a capital-scale fusion-torch, the highest thrust. */
  heavyPlasma: 160_000,
  /** Bio-organic drive (Swarm): high mass-flow, modest exhaust velocity. */
  bio: 60_000,
  /** Crystal resonant drive (Crystalline): high-Isp, mid thrust. */
  crystal: 48_000,
  /** Foundry thermal drive: brute-force, high thrust at low Isp. */
  thermal: 60_000,
  /** Corsair raider drive: scavenged fusion, mid-high thrust. */
  raider: 54_000,
  /** Synthetic precision drive: balanced electromagnetic drive. */
  precision: 60_000,
};

/**
 * Propellant mass flow rate (kg/s) for each drive class — the `ṁ` in the
 * rocket equation `F = ṁ · vₑ`, DERIVED from the rated thrust and exhaust
 * velocity by inverting that equation: `ṁ = F / vₑ`. A drive that produces
 * thrust `F` while expelling propellant at effective exhaust velocity `vₑ`
 * must, by conservation of momentum, throw mass overboard at exactly this rate.
 * No longer a back-solved literal: it falls out of the two named drive specs,
 * and the resource step's own per-second burn rate (`thrust / vₑ`) recovers the
 * same figure independently, so the catalogue and the engine agree by physics.
 */
export const PROPELLANT_MASS_FLOW_KG_PER_S: Record<
  keyof typeof DRIVE_THRUST_NEWTONS,
  number
> = {
  ion: DRIVE_THRUST_NEWTONS.ion / EXHAUST_VELOCITY_M_PER_S.ion,
  lightPlasma:
    DRIVE_THRUST_NEWTONS.lightPlasma / EXHAUST_VELOCITY_M_PER_S.plasma,
  plasma: DRIVE_THRUST_NEWTONS.plasma / EXHAUST_VELOCITY_M_PER_S.plasma,
  heavyPlasma:
    DRIVE_THRUST_NEWTONS.heavyPlasma / EXHAUST_VELOCITY_M_PER_S.plasma,
  bio: DRIVE_THRUST_NEWTONS.bio / EXHAUST_VELOCITY_M_PER_S.bio,
  crystal: DRIVE_THRUST_NEWTONS.crystal / EXHAUST_VELOCITY_M_PER_S.crystal,
  thermal: DRIVE_THRUST_NEWTONS.thermal / EXHAUST_VELOCITY_M_PER_S.thermal,
  raider: DRIVE_THRUST_NEWTONS.raider / EXHAUST_VELOCITY_M_PER_S.raider,
  precision:
    DRIVE_THRUST_NEWTONS.precision / EXHAUST_VELOCITY_M_PER_S.precision,
};

/**
 * Thrust (Newtons) of a drive class, used by the catalogue to set each engine
 * module's `effect.thrust` in N. Returns the rated thrust spec directly; the
 * rocket equation `F = ṁ · vₑ` still holds because the propellant flow above is
 * derived as `ṁ = F / vₑ`, so `ṁ · vₑ` reproduces this `F` exactly.
 */
export function driveThrustNewtons(
  drive: keyof typeof DRIVE_THRUST_NEWTONS,
): number {
  const thrust = DRIVE_THRUST_NEWTONS[drive];
  if (thrust === undefined) {
    throw new Error(`no rated thrust for drive "${String(drive)}"`);
  }
  return thrust;
}

// ---------------------------------------------------------------------------
// Module mass derivations (kilograms).
//
// A module is a discrete mechanism (turret / reactor / tank) placed ON a cell,
// not a solid block filling it. Its mass is `meanDensity × moduleVolume`,
// where `moduleVolume` is the physical envelope of the installed equipment
// (independent of cell area) and `meanDensity` is the mean density of the
// assembled mechanism. The cell carries the layer masses (substrate + deck/
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
  // Defence — deflector projector (momentum screen): same class as a shield.
  deflector: 2000,
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
 * Physical envelope volume (m³) of a module class. Throws if the class is
 * unknown rather than substituting a default, so a missing entry surfaces as a
 * loud failure at the call site (mirrors {@link moduleMass}). Used both for the
 * module's installed mass and, for a reactor, for its electrical output
 * (`powerDensity × moduleVolume`).
 */
export function moduleVolume(classKey: keyof typeof MODULE_VOLUME_M3): number {
  const volume = MODULE_VOLUME_M3[classKey];
  if (volume === undefined) {
    throw new Error(`no module volume for class "${String(classKey)}"`);
  }
  return volume;
}

/**
 * Mean density (kg/m³) of a module class — the typed accessor for
 * {@link MODULE_DENSITY}, throwing on an unknown class so a typo surfaces at
 * the call site (mirrors {@link moduleVolume}). Used for the default density
 * arguments of the capability-derived mass functions below.
 */
export function moduleDensity(classKey: keyof typeof MODULE_DENSITY): number {
  const density = MODULE_DENSITY[classKey];
  if (density === undefined) {
    throw new Error(`no module density for class "${String(classKey)}"`);
  }
  return density;
}

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

// ---------------------------------------------------------------------------
// Reactor power-density bands (watts per cubic metre).
//
// Reactor output is `powerDensity × moduleVolume`. The volumetric power
// densities themselves live here with the other module-mass anchors; the
// combat-scale layer (`combat-scale.ts`) records the derived output constants
// (`FUSION_REACTOR_OUTPUT_W`, `ANTIMATTER_REACTOR_OUTPUT_W`) for catalogue
// derivations. A reactor's mass is then DERIVED from its output via
// `reactorMass(output, powerDensity)` below, so a denser core is proportionally
// smaller and lighter for the same output — by physics, not by a size class.
//
// The menu is broader than the two legacy densities: a compact fusion core is
// less dense than a standard fusion core (a smaller, lighter, lower-output
// variant), and an advanced antimatter core is denser than the legacy band.
// ---------------------------------------------------------------------------

/** Standard fusion core power density (W/m³) — the legacy band. */
export const FUSION_POWER_DENSITY_W_PER_M3 = 5e7;
/** Compact fusion core power density (W/m³) — a smaller, lighter variant. */
export const FUSION_COMPACT_POWER_DENSITY_W_PER_M3 = 4e7;
/** Advanced fusion core power density (W/m³) — a high-output variant. */
export const FUSION_ADVANCED_POWER_DENSITY_W_PER_M3 = 6e7;
/** Standard antimatter core power density (W/m³) — the legacy band. */
export const ANTIMATTER_POWER_DENSITY_W_PER_M3 = 2e8;
/** Advanced antimatter core power density (W/m³) — a high-output variant. */
export const ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3 = 3e8;

// ---------------------------------------------------------------------------
// Capability-derived module mass (kilograms) — proportional and non-arbitrary.
//
// The fixed `MODULE_VOLUME_M3` bands above give every module of a class the
// same envelope regardless of what it actually does, so a fighter autocannon
// and a capital mass-driver both weigh the same "mediumWeapon" 56 t. The
// derivations below retire that: a module's volume (and thus its mass) follows
// from its authored capability via a per-category physical specific-rating, so
// mass = `meanDensity × (capability / specificRating)`. A stronger module is
// proportionally larger and heavier; a weaker one smaller and lighter — by
// physics, not by an assigned class. There is no size/mount field and no mount
// restriction: any ship may mount any module, and whether it works is decided
// by the ship's own power/crew/mass/connectivity balance (`stats.ts`), not by a
// size rule.
//
// The specific ratings are calibrated to the existing capability/mass points
// (e.g. a 320 MJ railgun ≈ 56 t) so the migration is roughly mass-neutral
// there; realistic variation then comes from authoring modules across a real
// fighter→capital span of capabilities rather than converging on one band.
// ---------------------------------------------------------------------------

/**
 * Volumetric muzzle-energy density of a kinetic-weapon mechanism (capacitor
 * bank + barrel + breech), in J/m³. A frigate railgun stores ~320 MJ of muzzle
 * energy in a ~16 m³ envelope → ~2e7 J/m³. THE anchor a kinetic weapon's
 * installed mass is derived from: a 2.5 GJ capital driver is proportionally a
 * ~125 m³, ~500 t mechanism; an 8 MJ fighter autocannon a ~0.4 m³, ~1 t one.
 */
export const KINETIC_WEAPON_ENERGY_DENSITY_J_PER_M3 = 2e7;

/**
 * Volumetric sustained-power density of a beam weapon (emitter + optics +
 * cooling), in W/m³. A pulse beam delivers ~3e8 W from an ~8 m³ envelope →
 * ~4e7 W/m³. THE anchor a beam weapon's installed mass is derived from: a 1 GW
 * capital lance is proportionally a ~25 m³, ~100 t mechanism.
 */
export const BEAM_WEAPON_POWER_DENSITY_W_PER_M3 = 4e7;

/**
 * Volumetric thrust density of a drive (nozzle + power-conditioning envelope),
 * in N/m³. A plasma drive's ~120 kN sits in a ~25 m³ envelope → ~5e3 N/m³. THE
 * anchor an engine's installed mass is derived from: thrust sizing, independent
 * of exhaust velocity (which sets propellant flow, not dry mass).
 */
export const ENGINE_THRUST_DENSITY_N_PER_M3 = 5e3;

/**
 * Volumetric energy density of a shield projector (field generator + emitters),
 * in J/m³. A light deflector's ~200 MJ field sits in a ~15 m³ envelope →
 * ~1.3e7 J/m³. THE anchor a shield's installed mass is derived from: a 600 MJ
 * capital array is proportionally a ~46 m³, ~92 t mechanism.
 */
export const SHIELD_ENERGY_DENSITY_J_PER_M3 = 1.3e7;

/**
 * Volumetric momentum-storage density of a deflector projector (field generator
 * + emitters), in kg·m/s per m³. THE anchor a deflector's installed mass is
 * derived from, mirroring the shield energy density so a deflector masses
 * comparably to a shield of equivalent tier.
 */
export const DEFLECTOR_MOMENTUM_DENSITY_KG_MPS_PER_M3 = 1.5e4;

/**
 * Volumetric storage density of a magazine (stored rounds per m³ of ordnance
 * bay). ~30 rounds/m³ gives a 1200-round frigate magazine a ~40 m³ envelope
 * (matching the legacy band) and a 250-round fighter store a ~8 m³ one. THE
 * anchor a magazine's installed mass is derived from.
 */
export const MAGAZINE_ROUNDS_PER_M3 = 30;

/**
 * Habitable volume per crew berth (m³). ~12 m³/berth gives an 8-berth quarters
 * block a ~96 m³ envelope (mostly air, hence the low `crew` density). THE
 * anchor crew-quarters mass is derived from.
 */
export const CREW_VOLUME_PER_BERTH_M3 = 12;

/**
 * Installed mass (kg) of a kinetic weapon, DERIVED from its muzzle kinetic
 * energy `½·m·v²`: `density × (muzzleEnergy / KINETIC_WEAPON_ENERGY_DENSITY)`.
 * A heavier or faster round is proportionally a heavier gun, so damage, range
 * (via muzzle), and mass all rise together.
 */
export function kineticWeaponMass(
  projectileMassKg: number,
  muzzleVelocityMs: number,
  densityKgPerM3: number = moduleDensity("mediumWeapon"),
): number {
  const muzzleEnergyJ =
    0.5 * projectileMassKg * muzzleVelocityMs * muzzleVelocityMs;
  return (
    densityKgPerM3 * (muzzleEnergyJ / KINETIC_WEAPON_ENERGY_DENSITY_J_PER_M3)
  );
}

/**
 * Installed mass (kg) of a beam weapon, DERIVED from its sustained beam power:
 * `density × (beamPower / BEAM_WEAPON_POWER_DENSITY)`. A higher-power beam is
 * proportionally a larger, heavier emitter + cooling stack.
 */
export function beamWeaponMass(
  beamPowerW: number,
  densityKgPerM3: number = moduleDensity("lightWeapon"),
): number {
  return densityKgPerM3 * (beamPowerW / BEAM_WEAPON_POWER_DENSITY_W_PER_M3);
}

/**
 * Installed mass (kg) of a reactor, DERIVED from its electrical output:
 * `density × (output / powerDensity)`. This is the inverse of the output
 * derivation (`output = powerDensity × volume`), so a reactor's mass traces to
 * its core power-density and the output it must deliver.
 */
export function reactorMass(
  outputW: number,
  powerDensityWPerM3: number,
  densityKgPerM3: number = moduleDensity("reactor"),
): number {
  return densityKgPerM3 * (outputW / powerDensityWPerM3);
}

/**
 * Installed mass (kg) of an engine, DERIVED from its rated thrust:
 * `density × (thrust / ENGINE_THRUST_DENSITY)`. A higher-thrust drive is a
 * proportionally larger nozzle + power-conditioning stack.
 */
export function engineMass(
  thrustN: number,
  densityKgPerM3: number = moduleDensity("engine"),
): number {
  return densityKgPerM3 * (thrustN / ENGINE_THRUST_DENSITY_N_PER_M3);
}

/**
 * Installed mass (kg) of a shield projector, DERIVED from its field capacity:
 * `density × (capacity / SHIELD_ENERGY_DENSITY)`. A stronger field is a
 * proportionally larger generator + emitter array.
 */
export function shieldMass(
  capacityJ: number,
  densityKgPerM3: number = moduleDensity("shield"),
): number {
  return densityKgPerM3 * (capacityJ / SHIELD_ENERGY_DENSITY_J_PER_M3);
}

/**
 * Installed mass (kg) of a deflector projector, DERIVED from its field capacity:
 * `density × (capacity / DEFLECTOR_MOMENTUM_DENSITY)` — the momentum-screen
 * analogue of `shieldMass`, so a deflector masses comparably to a shield of the
 * same tier.
 */
export function deflectorMass(
  capacityKgMps: number,
  densityKgPerM3: number = moduleDensity("deflector"),
): number {
  return densityKgPerM3 * (capacityKgMps / DEFLECTOR_MOMENTUM_DENSITY_KG_MPS_PER_M3);
}

/**
 * Installed mass (kg) of a magazine, DERIVED from its stored round count:
 * `density × (rounds / MAGAZINE_ROUNDS_PER_M3)`. A larger store is a
 * proportionally larger ordnance bay.
 */
export function magazineMass(
  ammoStored: number,
  densityKgPerM3: number = moduleDensity("magazine"),
): number {
  return densityKgPerM3 * (ammoStored / MAGAZINE_ROUNDS_PER_M3);
}

/**
 * Installed mass (kg) of crew quarters, DERIVED from berth capacity:
 * `density × (capacity × CREW_VOLUME_PER_BERTH)`. A larger crew needs a
 * proportionally larger habitable volume (mostly air, hence the low density).
 */
export function crewMass(
  capacity: number,
  densityKgPerM3: number = moduleDensity("crew"),
): number {
  return densityKgPerM3 * (capacity * CREW_VOLUME_PER_BERTH_M3);
}

// ---------------------------------------------------------------------------
// Specific destruction energy (joules per kilogram).
//
// The energy a damaging hit must deposit per kilogram of a material to take
// that mass out of the fight — spall, fracture, melt, and vaporise it past the
// point of load-bearing integrity. Combined with a layer's already-real mass
// (`arealDensity × CELL_AREA_M2`) this gives a cell's hit-point pool in joules:
// `cellHP_J = layerMass(kg) × specificDestructionEnergy(J/kg)`. Because weapon
// damage is re-authored as real joules (kinetic ½·m·v², beam power × dwell), a
// hit and the armour it strikes are then in the same physical unit, and "armour
// falls in a few clean hits" becomes a property of real energy budgets rather
// than abstract damage points. Not yet consumed — later phases derive cell HP
// from these.
//
// The per-material figures are representative enthalpies-of-destruction (the
// spall/melt/vaporisation energy a mixed structural material absorbs before it
// stops holding load), in the few-MJ/kg band typical of metals and composites:
// a tougher alloy soaks more joules per kilogram than a brittle crystal.
// ---------------------------------------------------------------------------

/**
 * Specific destruction energy (J/kg) for each faction's hull material — the
 * energy per kilogram a hit must deposit to destroy that mass. Keyed by faction
 * to match the per-faction layer materials in `./layer-materials.ts`; each
 * value names the real material it represents.
 *
 *  - Terran ferro-steel: 6e6 J/kg — a steel-class alloy's spall-and-melt
 *    enthalpy (latent + sensible heat to vaporisation is a few MJ/kg for iron).
 *  - Swarm bio-chitin: 4e6 J/kg — a tough but lighter organic lattice, less
 *    energy per kilogram to fracture than steel.
 *  - Crystalline grown crystal: 2e6 J/kg — brittle; shatters at the lowest
 *    energy per kilogram of the six (a crack propagates cheaply).
 *  - Foundry forged composite: 8e6 J/kg — the toughest, a tungsten-rich forged
 *    plate that soaks the most energy per kilogram before failing.
 *  - Corsair scavenged scrap: 3e6 J/kg — mixed reclaimed metal, weak per
 *    kilogram (voids and bad welds give way early).
 *  - Synthetic machined alloy: 5e6 J/kg — a clean titanium-class alloy, mid-pack.
 */
export const SPECIFIC_DESTRUCTION_ENERGY: Record<string, number> = {
  Terran: 6e6,
  Swarm: 4e6,
  Crystalline: 2e6,
  Foundry: 8e6,
  Corsair: 3e6,
  Synthetic: 5e6,
};

/**
 * Specific destruction energy (J/kg) for a faction's hull material.
 * Throws if the faction is unknown rather than substituting a default, so a
 * missing entry surfaces as a loud failure at the call site.
 */
export function specificDestructionEnergy(faction: string): number {
  const energy = SPECIFIC_DESTRUCTION_ENERGY[faction];
  if (energy === undefined) {
    throw new Error(
      `no specific destruction energy for faction "${faction}"`,
    );
  }
  return energy;
}

/**
 * Fraction of a material's full destruction energy that a FRAMED layer (a
 * substrate truss or a thin deck plate) absorbs before it fails — the
 * structural-failure fraction. A solid armour plate is destroyed by melting and
 * spalling its whole mass (the full specific destruction energy), but a truss
 * frame or a thin pressure deck loses load-bearing integrity by buckling and
 * tearing at far less energy than it would take to melt the same mass: the
 * member fails structurally long before it vaporises. Set to a quarter — a
 * representative ratio of buckling/tearing energy to full melt-and-spall energy
 * for a thin-walled structural member — so a framed cell's hit-point pool is a
 * realistic fraction of the solid-plate value, and a structure cell falls to a
 * clean kinetic hit or beam shot while solid armour still takes a few. Authored
 * catalogue content (the failure-energy ratio); applied only to framed layers.
 */
export const STRUCTURAL_FAILURE_FRACTION = 0.25;

/**
 * Hit-point pool (joules) of a faction's substrate layer — DERIVED as
 * `substrateMass(kg) × specificDestructionEnergy(faction)(J/kg) ×
 * STRUCTURAL_FAILURE_FRACTION`. The substrate is a truss frame, so it fails
 * structurally (buckling/tearing) at a fraction of the energy needed to melt its
 * mass — the framed-layer reduction below. The layer mass already traces to real
 * areal density and cell area, so a cell's HP is a real energy budget in the same
 * joule unit as weapon damage rather than an authored point literal. With the
 * catalogue's masses and specific energies this lands substrate/deck cells in the
 * tens-to-low-hundreds of megajoules (a clean kinetic hit or beam shot drops one)
 * and solid armour cells at ~1-9 GJ (Foundry heaviest, Crystalline lightest, a
 * few hits each).
 */
export function substrateHpJoules(faction: string): number {
  return (
    substrateMass(faction) *
    specificDestructionEnergy(faction) *
    STRUCTURAL_FAILURE_FRACTION
  );
}

/** Hit-point pool (joules) of a faction's deck layer — a thin pressure deck, a
 *  framed layer like the substrate; see {@link substrateHpJoules}. */
export function deckHpJoules(faction: string): number {
  return (
    deckMass(faction) *
    specificDestructionEnergy(faction) *
    STRUCTURAL_FAILURE_FRACTION
  );
}

/** Hit-point pool (joules) of a faction's armour layer — a solid plate destroyed
 *  by melting/spalling its whole mass, so it absorbs the FULL specific
 *  destruction energy (no framed-layer reduction); see {@link substrateHpJoules}. */
export function armorHpJoules(faction: string): number {
  return armorMass(faction) * specificDestructionEnergy(faction);
}

// ---------------------------------------------------------------------------
// Reactor power density (watts per cubic metre).
//
// A reactor's electrical output is its core's volumetric power density times the
// reactor module's physical envelope: `output_W = powerDensity × MODULE_VOLUME_M3`.
// Pairing a per-reactor-class power density with the already-real module volume
// (`MODULE_VOLUME_M3`) makes reactor output a derived SI quantity (watts) rather
// than an abstract "power unit", so it can be compared directly against weapon
// joules and drive watts once power is re-authored. Not yet consumed — later
// phases derive reactor output from these.
//
// The densities are far above any present-day fission plant: a compact
// advanced-fusion core and an antimatter core are the in-universe energy sources
// that make a ship-cell-sized reactor produce gigawatts, the licence the setting
// takes for fast manoeuvring and energy weapons. The two figures band the well's
// two reactor classes — a fusion vessel and a denser antimatter core.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Specific heat capacity (joules per kilogram per kelvin).
//
// How much energy one kilogram of a faction's hull material must absorb to rise
// one kelvin. Combined with a cell's already-real mass (`arealDensity ×
// CELL_AREA_M2` for each layer, plus the installed module mass) this gives the
// cell's thermal heat capacity in joules per kelvin:
// `cellHeatCapacity_J_per_K = cellMass(kg) × specificHeat(J/(kg·K))`. The
// thermal transport field (`engine/thermal.ts`) needs this to convert a heat
// SOURCE in watts and a radiative boundary flux in watts into a temperature
// rate in kelvin per second — `dT/dt = P(W) / C(J/K)` — rather than assuming an
// implicit unit heat capacity. With real reactor waste heat now in gigawatts,
// the heat capacity is what fixes the integration transient: a heavy reactor
// cell (its installed mass dominates) heats by only tens of kelvin per second,
// not the ~50 M K/tick spike a unit heat capacity produced. The steady-state
// temperature is independent of heat capacity (it is fixed by the radiative
// balance `P = ε·σ·A·T⁴`), so this term governs the transient and numerical
// stability, not survival; survival is set by the radiator area and waste heat.
//
// The per-material figures are representative specific heats (J/(kg·K)) of the
// real material each faction's hull is built from.
// ---------------------------------------------------------------------------

/**
 * Specific heat capacity (J/(kg·K)) for each faction's hull material — the
 * energy per kilogram per kelvin the material absorbs as it heats. Keyed by
 * faction to match the per-faction layer materials; each value names the real
 * material it represents.
 *
 *  - Terran ferro-steel: ~490 J/(kg·K) — the specific heat of structural steel.
 *  - Swarm bio-chitin: ~1500 J/(kg·K) — a wet organic lattice (close to chitin/
 *    keratin, well above metals because of its water and polymer content).
 *  - Crystalline grown crystal: ~700 J/(kg·K) — a quartz-class grown crystal.
 *  - Foundry forged-tungsten composite: ~140 J/(kg·K) — tungsten-rich, the
 *    lowest specific heat of the six (heavy metals heat with little energy).
 *  - Corsair scrap-aluminium: ~900 J/(kg·K) — reclaimed aluminium-class scrap.
 *  - Synthetic alloy-titanium: ~520 J/(kg·K) — a machined titanium-class alloy.
 */
export const SPECIFIC_HEAT_J_PER_KG_K: Record<string, number> = {
  Terran: 490,
  Swarm: 1500,
  Crystalline: 700,
  Foundry: 140,
  Corsair: 900,
  Synthetic: 520,
};

/**
 * Specific heat capacity (J/(kg·K)) for a faction's hull material. Throws if the
 * faction is unknown rather than substituting a default, so a missing entry
 * surfaces as a loud failure at the call site (mirrors
 * {@link specificDestructionEnergy}).
 */
export function specificHeat(faction: string): number {
  const c = SPECIFIC_HEAT_J_PER_KG_K[faction];
  if (c === undefined) {
    throw new Error(`no specific heat for faction "${faction}"`);
  }
  return c;
}
