/**
 * Physical anchors for the combat economy — the realistic-scale quantities the
 * catalogue's weapon ranges, projectile speeds, cooldowns, beam damage, reactor
 * power and attitude-control torque are DERIVED from in later phases. This is
 * the combat-economy sibling of `physics.ts` (which anchors mass and thrust):
 * the engine is already SI internally (watts/joules in `power.ts`, real
 * relativistic joules in collision damage), so grounding combat is a matter of
 * re-authoring the catalogue from named anchors rather than rewriting the
 * engine. Every constant here names the real-world quantity it represents and
 * carries the formula the later derivations apply; nothing consumes these yet.
 *
 * ## Unit model
 *
 * - **Length** is metres. Combat happens at kilometre scale — guns reach tens
 *   of kilometres, projectiles fly at kilometres per second — so the anchors
 *   below are in metres and metres-per-second, and the catalogue stores them in
 *   the field's own consumed unit (see the m/tick note).
 * - **Time** is seconds. A reload or thermal-recovery interval is authored in
 *   seconds and converted to engine ticks at the fixed simulation rate
 *   `TICKS_PER_SECOND` (`src/domain/simulation/types.ts`): `cooldownTicks =
 *   seconds × TICKS_PER_SECOND`.
 * - **The m/tick boundary.** Two engine fields are consumed raw per tick, not
 *   per second: a weapon's `projectileSpeed` (added to a round's position each
 *   tick) and a shield's per-tick recharge. An anchor authored in SI
 *   (m/s, W) must therefore be stored divided by `TICKS_PER_SECOND` at the
 *   catalogue/schema boundary — `v_SI / TPS` m/tick, `power_SI / TPS` J/tick —
 *   or it would run a factor of `TPS` too fast. The anchors here are the SI
 *   values; the per-tick conversion is the later phase's responsibility.
 * - **Energy** is joules, **power** is watts. A kinetic round's damage is its
 *   muzzle kinetic energy `½·m·v²`; a beam's per-tick damage is its power times
 *   the dwell time of one tick, `beamPower × (1 / TICKS_PER_SECOND)`.
 *
 * ## The combat-scale picture
 *
 * Anchored here, these produce: armour cells of order gigajoules (see
 * `SPECIFIC_DESTRUCTION_ENERGY` in `physics.ts`), kinetic salvos of megajoules
 * to gigajoules, beams of hundreds of megajoules per tick, weapon reach of tens
 * of kilometres, and an attitude slew watchable over a couple of seconds — so a
 * hit and the armour it strikes are in one physical unit and a battle resolves
 * in a realistic number of seconds.
 */

import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import type { WeaponType } from "@/schema/module";
import {
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
  ANTIMATTER_POWER_DENSITY_W_PER_M3,
  FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
  FUSION_COMPACT_POWER_DENSITY_W_PER_M3,
  FUSION_POWER_DENSITY_W_PER_M3,
  moduleVolume,
  specificDestructionEnergy,
} from "./physics";

// Re-export reactor power-density bands so catalogue modules can import them
// from this leaf (which also anchors FUSION_REACTOR_OUTPUT_W).
export {
  ANTIMATTER_ADVANCED_POWER_DENSITY_W_PER_M3,
  ANTIMATTER_POWER_DENSITY_W_PER_M3,
  FUSION_ADVANCED_POWER_DENSITY_W_PER_M3,
  FUSION_COMPACT_POWER_DENSITY_W_PER_M3,
  FUSION_POWER_DENSITY_W_PER_M3,
};

// ---------------------------------------------------------------------------
// Engagement reference range and weapon-range derivations (metres).
// ---------------------------------------------------------------------------

/**
 * The reference engagement range (metres) the combat economy is sized around —
 * the distance at which two capital ships are expected to open fire and trade
 * decisive blows. Set to tens of kilometres: at this scale a kinetic round's
 * flight time and a beam's diffraction-limited reach both fall out naturally
 * (see `MAX_TOF_S` and `BEAM_RAYLEIGH_REFERENCE_M`), and a sensorless ship is
 * myopic against it while a sensor-equipped one reaches across it. The other
 * range anchors band around this central figure.
 */
export const ENGAGEMENT_REFERENCE_RANGE_M = 40_000;

// ---------------------------------------------------------------------------
// The km-combat detection rescale (Phase 3). Sensor detection ranges, comms
// ranges and active-sensor EM emission powers were authored at the pre-km
// few-hundred-metre scale (banded against the old ~hundreds-of-metres weapon
// ranges). Two named lift factors carry every one of them up to the km combat
// scale in lockstep, so the banding (omni < weapon reach < dish) is preserved
// and a sensor still extends sight past a sensorless ship's ~5 km naked eye.
// ---------------------------------------------------------------------------

/**
 * The factor by which the legacy sub-km sensor `detectionRange` and comms `range`
 * figures are lifted to the km combat scale. The pre-km catalogue banded these
 * against ~hundreds-of-metres weapon ranges (an omni ~300 m, a dish ~900 m); the
 * weapon-range re-grounding lifts weapon reach ~100× (to tens of km), so the
 * detection / comms ranges lift by the same factor to keep their banding intact —
 * a sensor still out-reaches the guns it spots for. With this an omni lands at
 * ~30 km, a directional ~60 km, a dish ~90 km, spanning the ~30-120 km detection
 * band against the new ~12-52 km weapon reaches. Applied to every catalogue
 * sensor `detectionRange`, sensor `min`/`maxRange`, and comms `range`.
 */
export const KM_DETECTION_RANGE_SCALE = 100;

/**
 * The factor by which an active sensor's EM emit strength is lifted to the km
 * combat scale. An active sensor's `emitStrength` adds to the hull's ambient
 * self-emission (`EM_HULL_AMBIENT_EMISSION`, `engine/config.ts`), so a radar-
 * blaring ship is easier to detect. That ambient is anchored to `4·PI · R² ·
 * floor` and its reference radius R rose from the pre-km 140 m to the km-combat
 * 5000 m, lifting the ambient by `(5000 / 140)²`. The active emit strength is
 * lifted by the SAME ratio so going active stays as loud RELATIVE to the hull
 * ambient as before the rescale (otherwise a fixed-magnitude emit would vanish
 * against the ~1300× larger ambient and active mode would stop mattering).
 * Restated as a self-contained ratio rather than imported from the engine config
 * (which imports from this leaf — a back-import would cycle); it MUST track the
 * `VISUAL_LOS_REFERENCE_M` lift in `engine/config.ts`.
 */
export const ACTIVE_SENSOR_EMISSION_SCALE = (5000 / 140) * (5000 / 140);

/**
 * Maximum kinetic-weapon time of flight (seconds) — the longest a fired round
 * stays useful before the firing solution goes stale against a manoeuvring
 * target. A kinetic weapon's reach is DERIVED as `muzzleVelocity × MAX_TOF_S`,
 * so a faster gun reaches further for the same time-of-flight budget: at ~3 s a
 * 4-10 km/s muzzle velocity gives a 12-30 km reach, bracketing the engagement
 * reference range. This is the `t` in `range = v · t`.
 */
export const MAX_TOF_S = 3;

/**
 * The diffraction-limited reference distance (metres) for a beam weapon — the
 * Rayleigh range at which a focused beam's spot has spread to twice its waist
 * area and its on-target intensity has fallen to the threshold the weapon is
 * effective to. A beam's reach is DERIVED as `√3 · BEAM_RAYLEIGH_REFERENCE_M`
 * (the distance at which the beam intensity drops to a quarter, i.e. the spot
 * radius has doubled), giving a reach of order the engagement reference range.
 * Re-anchoring this one figure rescales every beam weapon's reach in lockstep.
 */
export const BEAM_RAYLEIGH_REFERENCE_M = 30_000;

/**
 * Beam weapon reach (metres) — DERIVED as `√3 · BEAM_RAYLEIGH_REFERENCE_M`, the
 * range at which a focused beam's on-target intensity has fallen to a quarter of
 * its muzzle value (the spot radius has doubled, so the area is four times
 * larger). The engine's `beamDamageFactor` (`intensityFalloff`, `optics.ts`)
 * evaluates to `1 / (1 + (z/z_R)²) = 1 / (1 + 3) = 0.25` at exactly this range,
 * so a beam at its catalogue `range` still lands a meaningful quarter-strength
 * hit while a point-blank shot lands full strength. With the ~30 km Rayleigh
 * reference this is ~52 km — the longest reach in the catalogue, fitting a
 * directed-energy weapon that out-ranges kinetics. THE single derivation every
 * beam weapon's `range` field is authored from, so re-anchoring the reference
 * rescales every beam in lockstep.
 */
export const BEAM_RANGE_M = Math.sqrt(3) * BEAM_RAYLEIGH_REFERENCE_M;

// ---------------------------------------------------------------------------
// Kinetic-weapon muzzle velocities (metres per second).
//
// A kinetic round's speed is its launcher's muzzle velocity. Stored in the
// catalogue as m/tick (`v / TICKS_PER_SECOND`) because `projectileSpeed` is
// consumed raw per tick, but authored here in SI. The kinetic damage of a hit
// is its muzzle kinetic energy `½·m·v²`, so a faster, heavier round hits harder
// AND reaches further (`v × MAX_TOF_S`) for free.
// ---------------------------------------------------------------------------

// Muzzle velocity (m/s) for each kinetic-weapon class — the speed a round
// leaves the launcher. Sets both kinetic energy (`½·m·v²`) and reach
// (`v × MAX_TOF_S`). The broadened menu spans fighter PD → capital super-driver
// so factions can field light + heavy kinetics without converging on a band,
// and `kineticWeaponMass(m, v)` gives each a distinct installed mass.
export const MUZZLE_VELOCITY_M_PER_S = {
  /** Point-defence autocannon: a small fast-cyclic chemical gun, the lowest
   *  muzzle speed (a fighter-scale PD mount cycles faster than it flies). */
  pdAutocannon: 3_000,
  /** Autocannon: cyclic chemical gun, fastest fire rate, low muzzle speed. */
  autocannon: 4_000,
  /** Heavy autocannon: a frigate-scale cyclic gun, slower but harder-hitting. */
  heavyAutocannon: 5_000,
  /** Railgun: electromagnetic rail launcher, capacitor-fed, high muzzle speed. */
  railgun: 8_000,
  /** Gauss cannon: a mid-band coilgun, between railgun and driver. */
  gauss: 9_500,
  /** Mass driver: heavy coilgun, high muzzle speed and round mass. */
  driver: 10_000,
  /** Super-heavy driver: a capital coilgun, the highest muzzle speed. */
  superDriver: 12_000,
};

// Projectile mass (kg) per kinetic-weapon class. Banded so `½·m·v²` lands the
// round's kinetic energy in the intended fighter→capital band. Recoil and hit
// impulse consume the round's mass, so this band keeps momentum consistent.
export const PROJECTILE_MASS_KG = {
  pdAutocannon: 0.3,
  autocannon: 1,
  heavyAutocannon: 3,
  railgun: 10,
  gauss: 20,
  driver: 50,
  superDriver: 120,
};

/**
 * Kinetic damage (joules) of one round — its muzzle kinetic energy
 * `½·projectileMass·muzzleVelocity²`. The single derivation a kinetic weapon's
 * `damage` field is authored from, so a heavier or faster round hits harder by
 * physics rather than by a hand-tuned literal. With the class anchors above this
 * lands a fighter autocannon round at ~8 MJ (`½·1·4000²`), a frigate railgun
 * slug at ~320 MJ (`½·10·8000²`), and a capital mass-driver round at ~2.5 GJ
 * (`½·50·10000²`) — so a capital round drops a multi-gigajoule armour cell
 * (`SPECIFIC_DESTRUCTION_ENERGY`, `physics.ts`) in a couple of clean hits while a
 * fighter round chips it.
 */
export function kineticDamageJoules(
  projectileMassKg: number,
  muzzleVelocityMs: number,
): number {
  return 0.5 * projectileMassKg * muzzleVelocityMs * muzzleVelocityMs;
}

/**
 * Kinetic weapon reach (metres) — DERIVED as `muzzleVelocity × MAX_TOF_S`, the
 * distance a fired round covers within the time-of-flight budget before the
 * firing solution against a manoeuvring target goes stale. THE single derivation
 * a kinetic weapon's `range` field is authored from, so a faster gun reaches
 * further for the same time-of-flight: an autocannon (4 km/s) reaches ~12 km, a
 * railgun (8 km/s) ~24 km, a mass driver (10 km/s) ~30 km — all bracketing the
 * engagement reference range and sitting below a beam's longer optical reach.
 */
export function kineticRangeM(muzzleVelocityMs: number): number {
  return muzzleVelocityMs * MAX_TOF_S;
}

// ---------------------------------------------------------------------------
// Guided-ordnance reach (metres): a missile or torpedo coasts under its own
// motor, so its reach is the distance its propellant budget can drive it —
// `cruiseDeltaV × burnSeconds` — not a time-of-flight against a ballistic
// round. Banded by ordnance class: a missile is a long-reach, PD-interceptable
// strike weapon; a torpedo is a heavy, short-legged hull-breaker.
// ---------------------------------------------------------------------------

/**
 * Cruise delta-v (m/s) a guided round's motor delivers over its powered flight —
 * the propellant velocity budget that, times the burn time, sets its reach. A
 * missile carries a long-burn sustainer (a high reach); a torpedo carries a
 * heavier warhead on a shorter, harder-driving motor (a shorter reach). Not the
 * round's `projectileSpeed` (its per-tick cruise velocity, authored separately):
 * this is the integrated velocity budget the motor can spend reaching out.
 */
export const ORDNANCE_CRUISE_DELTA_V_M_PER_S = {
  /** Missile: a light sustainer motor, the longest powered reach. */
  missile: 2_000,
  /** Torpedo: a heavy short-burn motor, a much shorter powered reach. */
  torpedo: 1_500,
};

/**
 * Powered burn time (seconds) of a guided round's motor — how long it drives
 * under power before it coasts. A missile sustains for the better part of a
 * minute (long reach); a torpedo burns briefly and heavily (short reach). The
 * reach is `cruiseDeltaV × burnSeconds` (see {@link ordnanceRangeM}).
 */
export const ORDNANCE_BURN_TIME_S = {
  /** Missile: a long sustainer burn → `2000 × 40` ≈ 80 km reach. */
  missile: 40,
  /** Torpedo: a short heavy burn → `1500 × 8` ≈ 12 km reach. */
  torpedo: 8,
};

/**
 * Guided-ordnance reach (metres) — DERIVED as `cruiseDeltaV × burnSeconds`, the
 * distance a missile or torpedo's motor can drive it within its propellant
 * budget. THE single derivation a missile / torpedo `range` field is authored
 * from: a missile (`2000 × 40` ≈ 80 km) reaches far past every gun, so it is
 * the long-range opener a point-defence screen must whittle down in flight; a
 * torpedo (`1500 × 8` ≈ 12 km) is a short-legged heavy hitter that must be
 * brought close. Re-banding a class's delta-v or burn rescales its reach.
 */
export function ordnanceRangeM(
  cruiseDeltaVMs: number,
  burnSeconds: number,
): number {
  return cruiseDeltaVMs * burnSeconds;
}

/** Missile reach (metres): the long-sustainer ordnance band, ~80 km. */
export const MISSILE_RANGE_M = ordnanceRangeM(
  ORDNANCE_CRUISE_DELTA_V_M_PER_S.missile,
  ORDNANCE_BURN_TIME_S.missile,
);

/** Torpedo reach (metres): the short-heavy-burn ordnance band, ~12 km. */
export const TORPEDO_RANGE_M = ordnanceRangeM(
  ORDNANCE_CRUISE_DELTA_V_M_PER_S.torpedo,
  ORDNANCE_BURN_TIME_S.torpedo,
);
// Finite-burn motor derivation lives in `./ordnance-motor` (extracted for the cap).
// Convert an SI reload/thermal interval to integer cooldown ticks:
// `Math.round(seconds × TICKS_PER_SECOND)`. Rounded to the nearest tick because
// `cooldown` is an integer count (the schema enforces `z.number().int()`).
export function cooldownTicks(reloadSeconds: number): number {
  return Math.round(reloadSeconds * TICKS_PER_SECOND);
}

/**
 * Beam damage (joules) per shot — `beamPower(W) × dwellSeconds`, the optical
 * power on target times the time the beam dwells on it between shots. THE beam
 * derivation a beam weapon's `damage` field is authored from. The engine fires a
 * beam once every `cooldown` ticks (a beam is a cooldown-gated weapon, not a
 * continuous-per-tick deposit), so the energy one shot deposits is the power
 * integrated over that whole inter-shot interval: `dwellSeconds =
 * cooldownTicks / TICKS_PER_SECOND`. A faster-cycling beam therefore deposits
 * less per shot but fires more often, and a slow heavy lance deposits a large
 * pulse on a long cooldown — so beam DPS (`power`) is directly comparable, in
 * joules per second, against a kinetic salvo regardless of refire rate. The
 * engine then scales this by the range-dependent `beamDamageFactor`.
 *
 * With the class powers in {@link BEAM_POWER_W} and the catalogue cooldowns this
 * lands a pulse laser at ~300 MJ/shot on a one-second cycle and a capital lance
 * in the multi-gigajoule-per-shot band on its long cooldown — carving the
 * gigajoule armour above over a watchable number of seconds while a fighter
 * pulse chips lighter targets.
 */
export function beamDamageJoules(
  beamPowerW: number,
  cooldownTicks: number,
): number {
  return beamPowerW * (cooldownTicks / TICKS_PER_SECOND);
}

/**
 * Convert a muzzle velocity authored in SI metres-per-second into the
 * metres-per-tick value the engine consumes raw for `projectileSpeed`. THE
 * unit-boundary fix: `projectileSpeed` is added to a round's position every tick
 * (not every second), so a value authored straight in m/s would fly the round
 * `TICKS_PER_SECOND`× too fast. The catalogue authors muzzle velocity in m/s and
 * stores `v_SI / TICKS_PER_SECOND` through this helper, keeping the SI anchor
 * visible while the stored field is in the engine's per-tick unit.
 */
export function projectileSpeedMPerTick(muzzleVelocityMs: number): number {
  return muzzleVelocityMs / TICKS_PER_SECOND;
}

// ---------------------------------------------------------------------------
// Reload / thermal-recovery intervals (seconds).
//
// A weapon's cooldown is the real mechanism that gates its next shot: a
// capacitor recharge, a cyclic feed interval, a magazine reload, a thermal
// recovery, or a beam emitter thermal cycle. Authored in seconds; the
// catalogue converts to engine ticks as `seconds × TICKS_PER_SECOND`.
// ---------------------------------------------------------------------------

// Reload / thermal-recovery interval (s) per weapon class — the time its
// limiting mechanism needs before it can fire again. DERIVED into cooldown
// ticks as `seconds × TPS`.
export const RELOAD_THERMAL_TIME_S = {
  /** PD autocannon: a small fast-cyclic mount, the fastest refire. */
  pdAutocannon: 0.15,
  /** Autocannon: cyclic feed, sub-second between rounds. */
  autocannon: 0.27,
  /** Heavy autocannon: a slower cyclic mount, between autocannon and railgun. */
  heavyAutocannon: 0.5,
  /** Railgun: capacitor-bank recharge between shots. */
  railgun: 3.2,
  /** Gauss cannon: a mid-band coilgun, between railgun and driver. */
  gauss: 4.5,
  /** Mass driver: a heavy coilgun, slow capital refire. */
  driver: 6,
  /** Super-heavy driver: the slowest kinetic, a capital coilgun load cycle. */
  superDriver: 8,
  /** Missile rack: launch-rail reload from the magazine. */
  missile: 3,
  /** Torpedo tube: the slowest reload, a heavy ordnance load cycle. */
  torpedo: 5,
};

// ---------------------------------------------------------------------------
// Beam-weapon powers (watts).
//
// A beam weapon kills by dwell: it fires once every `cooldown` ticks (a beam is
// a cooldown-gated weapon, not a continuous-per-tick deposit), and the energy one
// shot deposits is its delivered optical power integrated over that inter-shot
// dwell, `beamPower × (cooldown / TICKS_PER_SECOND)` (see `beamDamageJoules`),
// before the range-dependent `beamDamageFactor`. The power below is therefore the
// beam's SUSTAINED DPS rating in watts; the per-shot pulse size falls out of it
// and the weapon's cooldown. Authored in watts so beam DPS is directly
// comparable against a kinetic salvo: a capital lance's DPS lands beside a
// capital mass-driver's (driver round ~2.5 GJ on a ~3.2 s reload ≈ ~780 MW DPS),
// so a few hundred megawatts to ~1 GW spans the classes.
// ---------------------------------------------------------------------------

// Sustained delivered beam power (W) per class — the beam's DPS rating. The
// per-shot energy is `power × (cooldown / TPS)`; a fast pulse deposits a small
// pulse often, a slow lance a large one on a long cooldown. The broadened menu
// spans PD pulse → capital lance, and `beamWeaponMass(power)` gives each a
// proportionally larger, heavier emitter + cooling stack.
export const BEAM_POWER_W = {
  /** PD pulse: a light point-defence-grade beam, the lowest DPS. */
  pdPulse: 1e8,
  /** Pulse laser: light point-defence-grade beam, low DPS. */
  pulse: 3e8,
  /** Disruptor: a frigate anti-shield beam, between pulse and beam. */
  disruptor: 4.5e8,
  /** Beam laser: a frigate-grade sustained beam, mid DPS. */
  beam: 6e8,
  /** Heavy lance: a cruiser-grade energy weapon, between beam and lance. */
  heavyLance: 8e8,
  /** Capital lance: the heaviest energy weapon, the highest DPS (~1 GW), beside
   *  a capital mass-driver's sustained kinetic DPS. */
  lance: 1e9,
};

// ---------------------------------------------------------------------------
// Reactor power density (watts per cubic metre).
//
// Reactor output is `powerDensity × moduleVolume`. The volumetric power
// densities themselves live with the other module-mass anchors in `physics.ts`
// (`FUSION_POWER_DENSITY_W_PER_M3`, `ANTIMATTER_POWER_DENSITY_W_PER_M3`); the
// intent is recorded here as part of the combat economy so the link between a
// reactor's gigawatt output and the weapons it must feed is visible in one
// place. The combat-economy consequence: a reactor's gigawatt output must cover
// the summed watt draw of its beams, drives, and shield recharge, which is the
// "shields vs guns" power tension this phase introduces.
// ---------------------------------------------------------------------------

/**
 * Electrical output (watts) of a fusion reactor module — DERIVED as the fusion
 * core's volumetric power density times the reactor module's physical envelope:
 * `FUSION_POWER_DENSITY_W_PER_M3 × MODULE_VOLUME_M3.reactor` (`physics.ts`). With
 * the authored anchors (`5e7 W/m³ × 30 m³`) this is ~1.5 GW — the energy budget a
 * frigate-to-cruiser needs to run a railgun's capacitor, a fusion-torch drive and
 * a shield's recharge at once. No hand-tuned "power unit" literal: a reactor's
 * output traces straight to its core density and its module volume, so it can be
 * compared in watts against the draws below.
 */
export const FUSION_REACTOR_OUTPUT_W =
  FUSION_POWER_DENSITY_W_PER_M3 * moduleVolume("reactor");

/**
 * Electrical output (watts) of an antimatter reactor module — DERIVED as the
 * antimatter core's volumetric power density times the compact reactor module's
 * envelope: `ANTIMATTER_POWER_DENSITY_W_PER_M3 × MODULE_VOLUME_M3.reactorCompact`
 * (`physics.ts`). With the anchors (`2e8 W/m³ × 25 m³`) this is ~5 GW — several
 * times a fusion reactor's output from a smaller, heavier-shielded core, the
 * supply an energy-weapon capital ship (a gigawatt lance plus drive and shields)
 * needs. The denser core is why an antimatter ship can feed a capital lance that a
 * single fusion reactor only just covers.
 */
export const ANTIMATTER_REACTOR_OUTPUT_W =
  ANTIMATTER_POWER_DENSITY_W_PER_M3 * moduleVolume("reactorCompact");

// ---------------------------------------------------------------------------
// Reactor waste heat and radiator sizing (thermal re-grounding).
//
// A reactor's electrical output is not free: the conversion is imperfect, so the
// fraction of the released power that does NOT become usable electricity is dumped
// into the hull as waste heat, which the radiators must shed to space. The
// thermal field (`engine/thermal.ts`) sheds heat by Stefan-Boltzmann radiation
// from the radiator cells; at steady state a radiator cell settles at
// `T = (P_waste / (ε·σ·A))^(1/4)`, INDEPENDENT of heat capacity. Survival below
// the `SIM.overheatThresholdK` (1500 K) material limit is therefore a balance of
// two named anchors: how much waste heat a reactor produces
// ({@link REACTOR_THERMAL_EFFICIENCY}) and how much effective radiating area a
// radiator cell deploys ({@link RADIATOR_FIN_AREA_FACTOR}).
//
// Before this re-grounding the resource step injected the reactor's FULL
// electrical output as the heat source, which is wrong twice over: it is the
// electricity, not the waste, and at gigawatts it drove a 2 m²/cell radiator past
// 1500 K on the first tick (every reactor died instantly). Injecting the real
// waste heat and giving radiators a realistic deployed-fin area fixes both: an
// undamaged reactor-equipped ship reaches a steady state comfortably below
// 1500 K, while a combat heat spike (a damaged reactor that loses radiator cells,
// or future weapon-heat deposition) still drives a cell over the threshold and
// triggers the overheat death — overheat stays possible, it is no longer
// automatic.
// ---------------------------------------------------------------------------

// Reactor thermal efficiency η (0–1): the fraction of released power that
// becomes usable electricity; the remainder `output × (1/η − 1)` is waste heat
// the radiators must shed. 0.85 is the high end of the direct-conversion band
// (the in-universe reactor decelerates charged fusion products electrostatically,
// sidestepping the Carnot limit) — chosen so a fusion reactor's waste heat
// (~265 MW at 1.5 GW) is within what a realistically-deployed radiator can
// shed below the 1500 K material limit.
export const REACTOR_THERMAL_EFFICIENCY = 0.85;

// Waste heat (W) a reactor dumps into the hull: `output × (1/η − 1)`. This is
// the figure the resource step injects as the reactor cell's thermal source.
export function reactorWasteHeatWatts(outputWatts: number): number {
  return outputWatts * (1 / REACTOR_THERMAL_EFFICIENCY - 1);
}

// Deployed-fin effective-area amplification factor (dimensionless) for a
// radiator cell: how many times its bare 1 m² footprint a deployed radiator
// unfolds (a real spacecraft radiator is a large folded fin array, not a flat
// hull patch). 800× lands a fusion reactor's waste-heat cell at ~1340 K — below
// the 1500 K material limit with margin — while a combat heat spike that
// destroys radiator cells still crosses the threshold and triggers overheat.
export const RADIATOR_FIN_AREA_FACTOR = 800;

// ---------------------------------------------------------------------------
// Module power draws (watts).
//
// A powered module spends watts off the grid each tick it operates; the engine's
// resource step builds a power-sink terminal from each module's `powerDraw`, so a
// reactor's output (above) must cover the summed draw of the modules it feeds.
// Each draw is authored as the real electrical demand of that mechanism's class,
// in watts, so "shields vs guns vs drive" is a competition for real reactor watts
// rather than abstract power points. A beam weapon is the special case: its draw
// IS its delivered optical power (`BEAM_POWER_W`), because the beam converts grid
// power straight into the energy it deposits on target.
// ---------------------------------------------------------------------------

/**
 * Electrical power draw (watts) for the non-beam powered-module classes — the
 * grid demand each mechanism places while operating. A kinetic launcher draws the
 * power to recharge its capacitor bank or run its autoloader; a drive draws its
 * power-conditioning and magnetic-nozzle load; attitude control, sensors, comms,
 * crew life-support and a magazine's handling gear each draw their own much
 * smaller load. Beam weapons are NOT listed here — a beam's draw is its delivered
 * optical power {@link BEAM_POWER_W}, applied directly in the catalogue. Sized so a
 * reactor (~1.5 GW fusion, ~5 GW antimatter) comfortably covers a conventional
 * fit while an all-energy-weapon capital design pushes a single fusion reactor to
 * its limit — the intended power tension.
 */
export const MODULE_POWER_DRAW_W = {
  /** Kinetic launcher (railgun / autocannon / mass driver): capacitor recharge
   *  and rail current — the dominant non-beam draw, ~100 MW. */
  kineticWeapon: 1e8,
  /** Missile / torpedo launcher: autoloader and launch-rail handling, far less
   *  than a kinetic gun (the round carries its own energy), ~10 MW. */
  ordnanceWeapon: 1e7,
  /** Point-defence mount: a small fast turret, ~5 MW. */
  pointDefense: 5e6,
  /** Drive: power conditioning and magnetic-nozzle load, ~5 MW. */
  drive: 5e6,
  /** Attitude control (RCS / reaction wheel): small actuators, ~1 MW. */
  attitude: 1e6,
  /** Sensor array: transmit/receive electronics, ~2 MW. */
  sensor: 2e6,
  /** Comms transceiver: link electronics, ~1 MW. */
  comms: 1e6,
  /** Crew life support: habitat power, ~0.5 MW. */
  crew: 5e5,
  /** Magazine handling gear: ~0.5 MW. */
  magazine: 5e5,
};

/**
 * Seconds of peak draw a powered module's local capacitor holds — the reserve
 * that sizes {@link LOCAL_CHARGE_BUFFER_J}. A buffer-sizing duration (the
 * rate/epsilon category): one second is comfortably more than the single tick a
 * weapon needs to fire, a believable capacitor ride-through.
 */
export const LOCAL_CAPACITOR_RESERVE_S = 1;

/**
 * Capacity (joules) of a powered module's local charge buffer — DERIVED as the
 * heaviest single module draw (a capital lance's {@link BEAM_POWER_W}.lance
 * watts) over {@link LOCAL_CAPACITOR_RESERVE_S}: `BEAM_POWER_W.lance ×
 * LOCAL_CAPACITOR_RESERVE_S`. The per-module sibling of the ship-wide power
 * buffer (`POWER_BUFFER_RESERVE_S`, `resource-step.ts`); sizing it from the
 * heaviest draw guarantees the buffer holds at least one tick of any weapon's
 * draw, so a fully-wired weapon can always fire. The engine consumes `powerDraw
 * × dt` joules per tick against it (`crew.ts`).
 */
export const LOCAL_CHARGE_BUFFER_J =
  BEAM_POWER_W.lance * LOCAL_CAPACITOR_RESERVE_S;

// ---------------------------------------------------------------------------
// Shield energetics (joules of capacity, watts of recharge).
//
// A shield is an energy store: its `capacity` is the joules it can absorb before
// collapsing, and its `rechargeRate` is the watts it draws to rebuild that store.
// Both are now real SI, on the same joule scale as the weapon damage that hits it
// and the cell HP behind it, so a shield soaks a realistic number of salvos and
// rebuilds over a watchable time. Crucially the recharge wattage is also the
// shield's grid draw (the catalogue sets the module's `powerDraw` to its
// `rechargeRate`), so a shield's recovery competes with the weapons and drive for
// reactor output — the "shields vs guns" tension. The engine adds the recharge as
// `rechargeRate / TICKS_PER_SECOND` joules per tick (watts → joules-per-tick at
// the per-tick boundary), so a watt-rated recharge regenerates at the correct
// real rate rather than TPS× too fast.
// ---------------------------------------------------------------------------

// Shield capacity (J) per class — the energy the projector absorbs before the
// field collapses. Banded so a hit drains a realistic share of the field; on
// the same joule scale as the armour behind it, so shields buy time rather than
// trivially soaking or popping.
export const SHIELD_CAPACITY_J = {
  /** Point-defence bubble: the smallest field, a fighter-scale pop-up. */
  pd: 8e7,
  /** Light deflector: the smallest proper field, ~200 MJ. */
  light: 2e8,
  /** Medium shield: a frigate-grade array, ~400 MJ. */
  medium: 4e8,
  /** Heavy shield: a cruiser-grade array, the broadest mid-tier field. */
  heavy: 6e8,
  /** Capital array: the largest field, ~1 GJ. */
  capital: 1e9,
};

// Shield recharge power (W) per class — the grid power the projector draws to
// rebuild its field. The catalogue sets a shield module's `powerDraw` to this
// figure, so shield recovery competes with weapons and drive for reactor watts.
// The engine converts to J/tick as `rechargeRate / TICKS_PER_SECOND`.
export const SHIELD_RECHARGE_W = {
  /** PD bubble: ~8 MW — a ~10 s rebuild of its ~80 MJ field. */
  pd: 8e6,
  /** Light deflector: ~20 MW — a ~10 s rebuild of its ~200 MJ field. */
  light: 2e7,
  /** Medium shield: ~40 MW — a ~10 s rebuild of its ~400 MJ field. */
  medium: 4e7,
  /** Heavy shield: ~60 MW — a ~10 s rebuild of its ~600 MJ field. */
  heavy: 6e7,
  /** Capital array: ~100 MW — a ~10 s rebuild of its ~1 GJ field. */
  capital: 1e8,
};

// Deflector capacity (kg·m/s) per class — the momentum screen arrests this much
// before collapsing. Sized against a railgun slug's momentum
// (PROJECTILE_MASS_KG.railgun × MUZZLE_VELOCITY_M_PER_S.railgun = 80 000) so a
// field absorbs a few such hits; on the same kg·m/s scale as the kinetics it stops.
export const DEFLECTOR_CAPACITY_KG_MPS = {
  pd: 1e5, light: 2.5e5, medium: 5e5, heavy: 1e6, capital: 2e6,
};
// Deflector recharge (kg·m/s per second) — the projector's momentum-rebuild rate
// (~capacity/10, a 10 s rebuild mirroring shields). The engine converts to per-tick.
export const DEFLECTOR_RECHARGE_KG_MPS_PER_S = {
  pd: 1e4, light: 2.5e4, medium: 5e4, heavy: 1e5, capital: 2e5,
};
/** Default deflector-piercing per weapon type (torpedoes punch; others mostly caught). */
export const DEFLECTOR_PIERCING_DEFAULT: Record<WeaponType, number> = { beam: 0, cannon: 0.1, missile: 0.1, torpedo: 0.3, plasma: 0.1 };

// ---------------------------------------------------------------------------
// Attitude-control slew spec (radians per second, seconds, newton-metres).
//
// A ship's attitude-control torque is DERIVED from how fast it must be able to
// turn, not authored as a round literal: `τ = (MAX_TURN_RATE_RAD_PER_S /
// ATTITUDE_SLEW_TIME_S) × representativeMoI`, where the moment of inertia is
// already the real `Σ m·r²`. The angular acceleration `MAX_TURN_RATE /
// SLEW_TIME` times a representative MoI yields the torque a reaction wheel or
// RCS ring must produce.
// ---------------------------------------------------------------------------

/**
 * The maximum attitude turn rate (radians per second) a ship is specified to
 * reach — the top of its rotational speed envelope. Set to a fraction of a
 * radian per second (~0.2 rad/s, ~11°/s) so a capital ship swings to bear over
 * a couple of seconds rather than snapping instantly. The `ω` in the slew spec:
 * with {@link ATTITUDE_SLEW_TIME_S} it fixes the angular acceleration the
 * attitude torque must deliver.
 */
export const MAX_TURN_RATE_RAD_PER_S = 0.2;

/**
 * The time (seconds) a ship is specified to take to spin up from rest to its
 * maximum turn rate — the slew time. With {@link MAX_TURN_RATE_RAD_PER_S} this
 * sets the required angular acceleration `α = ω / t`, and the attitude torque is
 * `τ = α × representativeMoI`. Set to a couple of seconds so the turn is a
 * watchable manoeuvre, not an instantaneous snap.
 */
export const ATTITUDE_SLEW_TIME_S = 2;

/**
 * The angular acceleration (rad/s²) the attitude-control system must deliver to
 * meet the slew spec — DERIVED as `MAX_TURN_RATE_RAD_PER_S / ATTITUDE_SLEW_TIME_S`.
 * The attitude torque for a given ship is this acceleration times that ship's
 * real moment of inertia (`Σ m·r²`), so heavier or larger ships need
 * proportionally more torque to hit the same slew spec — the equivalence the
 * derivation enforces, rather than a single hand-tuned torque literal.
 */
export const ATTITUDE_ANGULAR_ACCEL_RAD_PER_S2 =
  MAX_TURN_RATE_RAD_PER_S / ATTITUDE_SLEW_TIME_S;

// ---------------------------------------------------------------------------
// Representative reference hulls and attitude-control torque (newton-metres).
//
// Each attitude module (an RCS jet ring, a reaction wheel) is a single
// general-purpose module, so each carries ONE torque value, DERIVED from the
// slew spec above and the moment of inertia of a representative reference hull:
// `τ = ATTITUDE_ANGULAR_ACCEL_RAD_PER_S2 × I_ref`. The reference hull is a
// uniform thin slab of the tier's characteristic footprint and a representative
// combat areal density, so its in-plane MoI is `(1/12) · M · (L² + W²)` — the
// closed-form twin of the engine's cell-by-cell `Σ m·r²`
// (`recomputeAggregates`, `engine/physics.ts`). An RCS ring is sized against a
// frigate-band reference; a reaction wheel against a heavy-frigate / light-
// cruiser reference. Both land in the ~5e7-1e8 N·m band, the wheel above the
// RCS (correct ordering), and a reference-tier ship reaches
// MAX_TURN_RATE_RAD_PER_S in ~ATTITUDE_SLEW_TIME_S.

/**
 * Representative combat areal density (kg/m²) of a fully-built warship hull —
 * the mean mass per unit deck area used to size a reference hull's MoI. Every
 * cell carries the substrate truss (~100 kg/m²), a deck plate (~120 kg/m²) and,
 * on the exterior, a solid armour plate (~800 kg/m²): ~1020 kg/m² in structural
 * layers alone, plus a dense module (reactor, weapon, magazine) averaging well
 * over a tonne per cell. 2500 kg/m² is the mean over a hull that is mostly
 * armour plate and dense machinery, anchoring `M = arealDensity × L × W`.
 */
const COMBAT_HULL_AREAL_DENSITY_KG_PER_M2 = 2500;

/**
 * Moment of inertia (kg·m²) of a representative uniform-slab reference hull —
 * DERIVED as `(1/12) · M · (L² + W²)` for mass
 * `M = COMBAT_HULL_AREAL_DENSITY_KG_PER_M2 × L × W`. The closed-form twin of
 * the engine's cell-by-cell `Σ m·r²`, so an attitude module's torque traces to
 * a real inertia rather than a round literal.
 */
export function representativeMomentOfInertia(
  hullLengthM: number,
  hullBeamM: number,
): number {
  const mass =
    COMBAT_HULL_AREAL_DENSITY_KG_PER_M2 * hullLengthM * hullBeamM;
  return (mass * (hullLengthM * hullLengthM + hullBeamM * hullBeamM)) / 12;
}

/**
 * Attitude-control torque (N·m) DERIVED from the slew spec and a reference
 * hull's MoI: `τ = ATTITUDE_ANGULAR_ACCEL_RAD_PER_S2 × I_ref`. THE derivation an
 * RCS or reaction-wheel `torque` field is authored from. A ship of the reference
 * hull reaches {@link MAX_TURN_RATE_RAD_PER_S} in ~{@link ATTITUDE_SLEW_TIME_S}.
 */
export function attitudeTorqueNewtonMetres(
  hullLengthM: number,
  hullBeamM: number,
): number {
  return (
    ATTITUDE_ANGULAR_ACCEL_RAD_PER_S2 *
    representativeMomentOfInertia(hullLengthM, hullBeamM)
  );
}

/**
 * RCS (reaction-control jet ring) torque (N·m) — DERIVED from the slew spec
 * against a frigate-band reference hull (60 m × 12 m): ~5.6e7 N·m
 * (`0.1 × 5.6e8 kg·m²`). THE derivation an RCS module's `torque` field.
 */
export const RCS_TORQUE_N_M = attitudeTorqueNewtonMetres(60, 12);

/**
 * Reaction-wheel torque (N·m) — DERIVED from the slew spec against a heavy-
 * frigate / light-cruiser reference hull (70 m × 14 m): ~1.0e8 N·m
 * (`0.1 × 1.04e9 kg·m²`), above the RCS torque (correct ordering). THE
 * derivation a reaction-wheel module's `torque` field.
 */
export const REACTION_WHEEL_TORQUE_N_M = attitudeTorqueNewtonMetres(70, 14);

// ---------------------------------------------------------------------------
// Secondary-blast and interior-barrier energies (joules).
//
// Now that cell HP and weapon damage are real joules, the engine's own secondary
// energies — a magazine cook-off, a wall/door stopping a penetrating round — must
// be on the same gigajoule scale or they read as zero against GJ armour. Each is
// DERIVED from a named real quantity: a stored round's own energy, or the
// destruction energy of the barrier's mass.
// ---------------------------------------------------------------------------

/**
 * Blast energy (joules) released per stored round when a magazine cooks off —
 * DERIVED as the kinetic energy of one frigate-class round it stores
 * (`kineticDamageJoules(railgun mass, railgun muzzle)`, ~320 MJ). A magazine
 * detonation is the sympathetic ignition of its rounds, so each contributes its
 * own muzzle energy; a full magazine going up is then a multi-gigajoule
 * secondary explosion that wrecks the cells around it, on the same joule scale as
 * the armour it neighbours. The engine multiplies this by the rounds stored at
 * the moment the magazine dies.
 */
export const MAGAZINE_ROUND_YIELD_J = kineticDamageJoules(
  PROJECTILE_MASS_KG.railgun,
  MUZZLE_VELOCITY_M_PER_S.railgun,
);

/**
 * Mass (kg) of the steel an interior bulkhead presents across one cell face — a
 * thin internal partition, far lighter than an exterior armour plate. Anchored
 * to a representative 2 cm steel partition (`ρ_steel ≈ 7850 kg/m³ × 0.02 m`)
 * over one 1 m² cell face: ~157 kg. Authored catalogue content (the partition
 * thickness); used only to derive the wall/door stopping energies below.
 */
const INTERIOR_BULKHEAD_MASS_KG = 7850 * 0.02;

/**
 * Stopping energy (joules) a solid wall edge absorbs from a penetrating round —
 * DERIVED as the destruction energy of the interior bulkhead it presents,
 * `INTERIOR_BULKHEAD_MASS_KG × SPECIFIC_DESTRUCTION_ENERGY.Terran` (steel
 * J/kg), ~940 MJ. A round must spend this much energy to punch through an
 * internal wall before it can reach the cell behind, so an interior partition
 * meaningfully shields a deeper cell on the same gigajoule scale as the rounds
 * and armour around it.
 */
export const WALL_STOPPING_J =
  INTERIOR_BULKHEAD_MASS_KG * specificDestructionEnergy("Terran");

/**
 * Stopping energy (joules) a closed door edge absorbs — DERIVED as a fraction
 * of the wall stopping energy: a door is a thinner, weaker barrier than a solid
 * bulkhead. Set to a third of the wall value so a door slows a penetrating round
 * but stops far less of it than a full wall, preserving the wall-stronger-than-
 * door ordering the engine's penetration model relies on.
 */
export const DOOR_STOPPING_J = WALL_STOPPING_J / 3;
