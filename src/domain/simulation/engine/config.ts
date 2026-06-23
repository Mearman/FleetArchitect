/**
 * Tunable gameplay constants and the per-battle projectile id counter.
 *
 * Leaf module: holds `SIM` (the tunable feel constants), `CREW_HP`, and the real
 * speed-of-light anchors. The one piece of module-level mutable state — the
 * projectile id counter — lives in `projectile-id.ts` and is re-exported here so
 * callers keep importing `claimProjectileId`/`resetProjectileCounter` (and the
 * new checkpoint get/set) from `./config` unchanged.
 *
 * ## Unit model and the "grounded constant" rule
 *
 * World coordinates are **metres**. Ship-interior cells are `CELL_SIZE` m
 * (`src/domain/grid.ts`, the single metre-scale anchor, now 1 m per cell).
 * Every value below is one of:
 *
 *  1. a **real physical constant** (`SPEED_OF_LIGHT_M_PER_S`, the gravitational
 *     constant G documented in the derivation comments);
 *  2. a **formula over named anchors** (a radius derived from a payload size,
 *     a Poisson rate from a density × cross-section × path);
 *  3. **authored catalogue content** — the engine's per-cell masses, thrusts,
 *     and weapon ranges are not yet in SI units (that lands in Phase 14, when
 *     the catalogue is re-authored in kg / N / m); until then the derivation
 *     comments cite the real-world analogue the authored value represents;
 *  4. an **explicit unit / rate / epsilon** (tick rate, settle bands, TTLs) —
 *     documented as such.
 *
 * No hand-tuned magic literal survives: each `SIM.*` carries a derivation
 * comment naming its anchor. The Phase 15 audit greps for any that does not.
 *
 * The **black-hole** constants are grounded in the Schwarzschild relation
 * `r_s = 2·G·M / c^2` (see `arena-physics.ts`): the lethal radius IS the
 * event-horizon radius `r_s`, and `blackHoleStrength` is the `G·M` derived from
 * it as `G·M = r_s · c_arena^2 / 2` rather than a hand-tuned literal — the well
 * takes its place on the gravitational body list alongside the ships (N13). The
 * `c` of the relation is the arena gravitational signal speed (a sub-km
 * gameplay mechanic), not the relativistic `c`. The tidal radius and tidal-
 * damage scale remain arena-scale softenings of the singularity, re-derived from
 * the real tidal field `2GM·r/R^3` in Phase 14, when the SI catalogue lands.
 */

import { CELL_SIZE } from "@/domain/grid";
import { LOCAL_CHARGE_BUFFER_J } from "@/data/catalog/combat-scale";
import { BLACK_HOLE_TIDAL_RADIUS_M } from "@/domain/black-hole";
import { BASE_ACQUIRE_RANGE_M, VISUAL_LOS_RADIUS_M } from "./em-anchors";
import {
  BLACK_HOLE_GM_ARENA,
  BLACK_HOLE_LETHAL_DAMAGE_J,
  BLACK_HOLE_MASS_ARENA,
  BLACK_HOLE_SCHWARZSCHILD_RADIUS_M,
  BLACK_HOLE_TIDAL_DAMAGE_SCALE,
  GRAVITY_CONSTANT_ARENA,
  NEBULA_EM_TRANSMITTANCE,
  NEBULA_SENSOR_TRANSMITTANCE,
} from "@/domain/simulation/engine/arena-physics";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import {
  DOOR_STOPPING_J,
  MAGAZINE_ROUND_YIELD_J,
  WALL_STOPPING_J,
} from "@/data/catalog/combat-scale";
import {
  STANCE_RANGE_FACTOR,
  STANCE_TARGET_DISTANCE_BIAS,
} from "./stance-doctrine";

// Re-export so the engine (movement.ts) keeps importing `GRAVITY_CONSTANT_ARENA`
// from `./config` unchanged; the value is now derived in `arena-physics.ts`.
export { GRAVITY_CONSTANT_ARENA };

/**
 * Speed of light in vacuum, metres per second. The CODATA exact value. The
 * single physical constant the whole light-lag / relativistic edifice hangs
 * off; every sensor pulse, emission, reflection, order, and (from Phase 3) the
 * relativistic momentum cap propagate at this speed.
 */
export const SPEED_OF_LIGHT_M_PER_S = 299_792_458;

/**
 * Distance light travels in one simulation tick, in metres. Derived from the
 * real c and the canonical tick rate; not independently tunable. At
 * `TICKS_PER_SECOND = 30` this is ~9_993_082 m/tick, so a light-second is
 * ~30 ticks and a battle across ~1e9 m (a few light-seconds) takes a few
 * hundred ticks for light alone to cross — the foundation Phase 8/9 builds
 * light-lagged awareness on.
 */
export const SPEED_OF_LIGHT_M_PER_TICK =
  SPEED_OF_LIGHT_M_PER_S / TICKS_PER_SECOND;

/**
 * Cruise velocity (metres per second) of a breaching pod's drive — the real
 * speed a boarding pod flies toward its target. Authored catalogue content (a
 * short-range assault-craft drive output); converted to the engine's per-tick
 * unit as `/ TICKS_PER_SECOND` for `SIM.boardingPodSpeed`. ~500 m/s: fast enough
 * to cross the km-scale gaps boarding spans in the new combat geometry, far
 * slower than a km/s gun round.
 */
const BOARDING_POD_CRUISE_M_PER_S = 500;

/**
 * Minimum relative impact speed (metres per second) below which a debris-fragment
 * contact is treated as a near-stationary nudge and skipped for kinetic-energy
 * transfer. Authored catalogue content (an impact-significance threshold);
 * converted to per-tick as `/ TICKS_PER_SECOND` for `SIM.debrisMinRelSpeed`.
 * ~150 m/s: sized to the hundreds-of-m/s relative speeds of km/s combat so a
 * genuine glancing impact counts while a fragment drifting with a ship does not.
 */
const DEBRIS_MIN_REL_SPEED_M_PER_S = 150;

/**
 * Arrival closing-speed tolerance (metres per second): the real closing speed
 * below which the translation controller treats a ship as "arrived" on its
 * desired bearing and stops fine-tuning. Authored catalogue content (a
 * positioning settle tolerance); converted to the engine's per-tick world unit
 * as `/ TICKS_PER_SECOND` for {@link ARRIVAL_CLOSING_SPEED_MPS}. ~1 m/s: a tight
 * "stopped" band that holds even against the larger peak closing speeds of
 * km-scale approaches without the controller chattering around a settled hold.
 */
const ARRIVAL_CLOSING_SPEED_TOLERANCE_M_PER_S = 1;

// The per-battle projectile id counter (the one piece of module-level mutable
// state) lives in its own leaf; re-exported here so callers keep importing it
// from `./config` unchanged.
export {
  claimProjectileId,
  getProjectileCounter,
  resetProjectileCounter,
  setProjectileCounter,
} from "./projectile-id";

/** Tunable gameplay constants. All "feel" lives here as named values. */
export const SIM = {
  /**
   * Half-angle (radians) either side of a ship's facing within which its
   * weapons may fire. ~1.2 rad ≈ 69°, a generous forward arc. An explicit
   * mount-spec epsilon (the weapon-class traverse window) — not a physics
   * quantity.
   *
   * Classification: unit-spec-rate-epsilon (a weapon-mount traverse spec).
   */
  firingArc: 1.2,
  /**
   * Distance (metres) forward of a ship's centre where projectiles spawn.
   * Derived from the ship's hull geometry: a weapon fires from its muzzle,
   * which sits one cell outboard of the ship's leading edge so the round
   * clears the hull before any collision test. Half a cell (`CELL_SIZE / 2`)
   * is the muzzle clearance for a weapon on the forward centreline — authored
   * catalogue content representing the physical muzzle-to-centre distance, and
   * it follows the cell scale automatically.
   *
   * Classification: derived-by-formula (`CELL_SIZE / 2`); the anchor is
   * authored catalogue content (muzzle-to-centre geometry).
   */
  muzzleOffset: CELL_SIZE / 2,
  /**
   * Fallback engagement range (metres) for ships with no weapons: the distance
   * an unarmed ship holds from its target. Grounded (Phase 9) in the EM
   * reception model: an unarmed ship has no weapon reach to stand off by, so it
   * holds at the range its own baseline receiver can keep a continuous fix — the
   * innate visual radius `visualLosRadius` — extended by the half-cell muzzle
   * clearance (`CELL_SIZE / 2`) so it parks just outside contact. The reach is
   * dominated by the EM-grounded visual radius and the muzzle term follows the
   * cell scale; both derive from named anchors, with no authored literal.
   *
   * Classification: derived-by-formula (`visualLosRadius + CELL_SIZE / 2`); the
   * anchors are the EM-grounded visual radius and the authored muzzle clearance.
   */
  defaultRange: VISUAL_LOS_RADIUS_M + CELL_SIZE / 2,
  /**
   * Fraction of its max weapon range a ship tries to keep from its target, per
   * range band. The fractions are a tactical doctrine (short / medium / long
   * stand-off), not a physics quantity.
   *
   * Classification: authored catalogue content (tactical doctrine per stance).
   */
  rangeFraction: {
    short: 0.3,
    medium: 0.55,
    long: 0.85,
  },
  /**
   * Desired-range multiplier per stance (closeness vs distance), authored in
   * `stance-doctrine.ts`. Classification: authored catalogue content (stance doctrine).
   */
  stanceRangeFactor: STANCE_RANGE_FACTOR,
  /**
   * Signed near/far target preference per stance, blended by `scoreEnemy`; authored
   * in `stance-doctrine.ts`. Classification: authored catalogue content (targeting doctrine).
   */
  stanceTargetDistanceBias: STANCE_TARGET_DISTANCE_BIAS,
  /**
   * The black hole's mass in arena-mass units — the body property that grounds
   * the well. The gravitational body list carries the hole as a body of this
   * mass, and it gravitates by `G·M / r^2` exactly like a ship does, just far
   * more massively. Derived (not authored): `M = G·M / G`, the Schwarzschild-
   * derived {@link BLACK_HOLE_GM_ARENA} over the arena gravitational constant.
   *
   * Classification: derived-by-formula (`BLACK_HOLE_GM_ARENA /
   * GRAVITY_CONSTANT_ARENA`, the mass recovered from the well's `G·M` and `G`).
   */
  blackHoleMass: BLACK_HOLE_MASS_ARENA,
  /**
   * Black-hole gravity strength: the `G·M` product for the hole, so the
   * gravitational acceleration at distance r is `GM / r^2`, directed toward the
   * centre. Applied as a force to velocity (not a position teleport) so momentum
   * is preserved and the equivalence principle holds — heavy and light ships
   * accelerate the same. The acceleration is softened to zero at the lethal
   * radius to avoid a singularity. Derived from the Schwarzschild relation
   * `G·M = r_s · c_arena^2 / 2` ({@link BLACK_HOLE_GM_ARENA}) — traceable to the
   * well's event-horizon radius and arena gravitational signal speed, not a
   * hand-tuned literal; the same value the N-body field, lensing, redshift, and
   * GR dilation all read.
   *
   * Classification: derived-by-formula (`BLACK_HOLE_GM_ARENA`, a Schwarzschild-
   * derived `G·M = r_s · c_arena^2 / 2`).
   */
  blackHoleStrength: BLACK_HOLE_GM_ARENA,
  /**
   * Inside this radius a ship is torn apart — the event horizon, taken literally
   * as the black hole's Schwarzschild radius {@link
   * BLACK_HOLE_SCHWARZSCHILD_RADIUS_M} (`r_s`). A ship within `r_s` has crossed
   * the horizon and is destroyed; it is also the softening radius the `1/r^2`
   * pull is clamped at so the singularity at the centre stays finite. The well's
   * `G·M` is derived FROM this radius via `G·M = r_s · c_arena^2 / 2`, so the
   * horizon and the pull share one Schwarzschild relation.
   *
   * Classification: derived-by-formula (the Schwarzschild radius
   * `BLACK_HOLE_SCHWARZSCHILD_RADIUS_M`; the well's `G·M` derives from it).
   */
  blackHoleLethalRadius: BLACK_HOLE_SCHWARZSCHILD_RADIUS_M,
  /**
   * Per-tick structural damage (joules) at the centre of the well — instant
   * destruction for a ship that has crossed the event horizon. DERIVED from the
   * tidal damage scale evaluated at the horizon and amplified to guarantee any
   * ship's total structure is exceeded in a single tick; see
   * {@link BLACK_HOLE_LETHAL_DAMAGE_J}.
   *
   * Classification: derived-by-formula (tidal damage at the horizon
   * `2·GM·r_body·k_hull / r_s³` × guaranteed-kill multiplier; G·M traces to the
   * Schwarzschild relation, k_hull to the specific destruction energy anchor).
   */
  blackHoleLethalDamage: BLACK_HOLE_LETHAL_DAMAGE_J,
  /**
   * Outside the lethal radius but inside this zone, a ship takes damage
   * proportional to 1/r^3 — the leading-order tidal force across a body of
   * finite size ("spaghettification"). Read from the shared pure-domain leaf
   * {@link BLACK_HOLE_TIDAL_RADIUS_M} (`@/domain/black-hole`), itself a fixed
   * multiple of the event-horizon radius, so the engine, occluder module, and
   * renderer share one black-hole geometry.
   *
   * Classification: derived-by-formula (`BLACK_HOLE_TIDAL_RADIUS_M`, a fixed
   * multiple of the Schwarzschild radius; the engine, occluder module, and
   * renderer all read the same leaf).
   */
  blackHoleTidalRadius: BLACK_HOLE_TIDAL_RADIUS_M,
  /**
   * Coefficient for the 1/r^3 tidal damage (joules × metres³). DERIVED as
   * `2 · GM · r_body · k_hull` — the real tidal acceleration `2GM·r_body/R³`
   * times the hull tolerance factor (specific destruction energy ×
   * representative cell mass), so the per-tick damage `scale / R³` is in real
   * joules against GJ-scale hulls. See {@link BLACK_HOLE_TIDAL_DAMAGE_SCALE}.
   *
   * Classification: derived-by-formula (`2 · GM · r_body · k_hull`; GM traces
   * to the Schwarzschild relation, r_body to a representative ship half-length,
   * k_hull to the specific destruction energy × cell mass anchor).
   */
  blackHoleTidalDamageScale: BLACK_HOLE_TIDAL_DAMAGE_SCALE,
  /**
   * Nebula shield-regeneration attenuation. A nebula is a gas cloud whose
   * particles scatter and absorb electromagnetic energy; a ship's shield
   * projector couples to the local EM field, so a denser gas weakens recharge.
   * Derived from the Beer-Lambert law: the fraction of EM coupling surviving a
   * combat-engagement path through the cloud, `exp(-μ_EM · d)` ≈ 0.70, computed
   * as {@link NEBULA_EM_TRANSMITTANCE} in `arena-physics.ts`. The attenuation
   * now falls out of a real per-metre coefficient rather than a hand-picked 0.5.
   *
   * Classification: derived-by-formula (Beer-Lambert `exp(-μ_EM · d)` over the
   * one-way EM coefficient and the engagement path).
   */
  nebulaRegenFactor: NEBULA_EM_TRANSMITTANCE,
  /**
   * Nebula projectile-tracking attenuation. Homing weapons steer by EM return;
   * nebula gas scatters that return, cutting the lock quality. Same physical
   * origin as `nebulaRegenFactor` — one-way EM coupling through the cloud — so it
   * is the same Beer-Lambert transmittance `exp(-μ_EM · d)` over the EM
   * coefficient and the engagement path (~0.70), not a separate hand-picked
   * value.
   *
   * Classification: derived-by-formula (Beer-Lambert `exp(-μ_EM · d)`, the same
   * one-way EM transmittance as `nebulaRegenFactor`).
   */
  nebulaTrackingFactor: NEBULA_EM_TRANSMITTANCE,
  /**
   * Adaptive-shield ceiling (factions update). A shield with an `adaptiveRampRate`
   * recharges ever faster the longer it goes untouched — its effective rate is the
   * base rate times `1 + rampRate * ticksUntouched`. This caps that multiplier so
   * a shield left alone indefinitely tops out at this multiple of its base rate
   * rather than ramping without bound. 3 means "at most triple the base recharge".
   *
   * Classification: unit-spec-rate-epsilon (a spec ceiling on an authored
   * shield-module ramp rate).
   */
  adaptiveShieldMaxMultiple: 3,
  /**
   * Per-tick probability an asteroid field destroys a passing projectile. A real
   * asteroid field's interception rate is a Poisson process:
   * `P_destroy per tick = 1 - exp(-n · σ · v · dt)`, where `n` is the asteroid
   * number density, `σ` is the projectile's geometric cross-section, `v` its
   * speed, and `dt` one tick. For the small `n · σ · v · dt` of a sparse belt
   * this linearises to `n · σ · v · dt`. The authored value below is the rate
   * for a representative dense belt against a typical projectile cross-section
   * moving one tick at catalogue projectile speed — authored catalogue content
   * (the belt's number density is an authored scenario property). Phase 9/12
   * wires the live Poisson form from per-field density data.
   *
   * Classification: derived-by-formula (`1 - exp(-n·σ·v·dt)` ≈ `n·σ·v·dt` for
   * small rate); the anchors (`n`, `σ`, `v`) are authored catalogue content
   * until Phase 9/12 supplies live per-field density.
   */
  asteroidDeflectChance: 0.01,
  /**
   * Black-hole avoidance steering. A ship reads the well at the origin and
   * blends a heading that points directly AWAY from it into its normal
   * target-seeking heading, weighted by how deep inside a safety margin it
   * sits. Outside the margin the weight is zero, so a ship clear of the hole
   * fights exactly as it would with no anomaly; well inside the lethal radius
   * the weight saturates at 1 and the ship steers purely to escape. Between
   * the two it interpolates linearly, so a ship grazing the danger zone arcs
   * around it rather than ploughing through.
   *
   * Classification: authored catalogue content (a steering-blend spec; the
   * sub-keys `safetyMargin` and `edgeWeight` carry their own classification).
   */
  blackHoleAvoid: {
    /**
     * Outer edge of the avoidance field as a multiple of the tidal radius.
     * Beyond `safetyMargin * blackHoleTidalRadius` from the centre the
     * avoidance weight is zero — the ship is considered clear and ignores the
     * hole entirely, preserving open-space combat behaviour. 1.5 gives a
     * comfortable buffer outside the damaging tidal zone so a ship begins
     * arcing away before it starts taking tidal damage.
     *
     * Classification: derived-by-formula (a multiple of `blackHoleTidalRadius`,
     * itself authored catalogue content pending Phase 4).
     */
    safetyMargin: 1.5,
    /**
     * Minimum avoidance weight applied the instant a ship crosses inside the
     * safety margin, so the steering bias is felt immediately at the edge
     * rather than fading in from zero (a zero-at-the-edge ramp lets a fast
     * ship punch through before the bias grows). The weight then ramps from
     * this floor up to 1 as the ship nears the lethal radius.
     *
     * Classification: unit-spec-rate-epsilon (a steering-blend floor spec).
     */
    edgeWeight: 0.35,
  },
  /**
   * Desired-range multipliers (<1) applied when an anomaly punishes
   * time-of-flight, so ships close in to where their shots actually land.
   *  - Nebula halves projectile tracking, gutting homing weapons at range, so
   *    ships fight noticeably closer.
   *  - An asteroid field destroys a fraction of in-flight rounds each tick, so
   *    a shorter flight time means fewer shots lost — a more modest pull-in.
   * Anomalies combine, so these compound when more than one is active.
   *
   * Classification: authored catalogue content (tactical doctrine per anomaly;
   * Phase 9 derives these from the per-metre absorption / Poisson-loss models).
   */
  anomalyRangeFactor: {
    nebula: 0.6,
    asteroidField: 0.8,
  },
  /**
   * Heading error (radians) within which the attitude controller commands no
   * turn — the ship is considered on aim. ~0.6°, below visual notice, so
   * off-centre thruster torque or a residual fraction of a degree cannot make
   * the controller chatter the turn command around a settled heading. Also the
   * arrival tolerance for the translation controller: a ship with closing
   * speed at or below `ARRIVAL_CLOSING_SPEED_MPS` and heading error within this
   * band snaps to rest.
   *
   * Classification: unit-spec-rate-epsilon (a settle epsilon for the attitude
   * and translation controllers).
   */
  angularDeadband: 0.01,
  /**
   * Per-PD-module per-tick chance of intercepting a single in-range missile
   * or torpedo. Multiple PD modules stack their chances (1 - (1-p)^n) but
   * the cumulative chance is capped here so a screen of PD modules can never
   * be a 100% certainty.
   *
   * Classification: authored catalogue content (a PD-module accuracy figure).
   */
  pdHitChancePerModule: 0.4,
  /**
   * Upper bound on the stacked PD intercept probability per projectile.
   *
   * Classification: unit-spec-rate-epsilon (a spec ceiling on the PD stacking
   * model, so no screen is ever a certainty).
   */
  pdMaxStackedChance: 0.95,
  /**
   * Rounds a crew member carries per ammo-run from a magazine to a dry weapon.
   * One trip tops a weapon up by at most this much (and never beyond the
   * weapon's `ammoCapacity`), and drains the magazine's store by the amount
   * actually carried.
   *
   * Classification: authored catalogue content (a crew carrying-capacity
   * figure).
   */
  ammoRunAmount: 60,
  /**
   * Energy (joules) a crew member carries per power-run to a starved module —
   * half the local buffer ceiling, so a run is a meaningful top-up.
   * Classification: derived-by-formula (`LOCAL_CHARGE_BUFFER_J / 2`).
   */
  powerRunAmount: LOCAL_CHARGE_BUFFER_J / 2,
  /**
   * Capacity (joules) of a powered module's local charge buffer — a per-module
   * capacitor. Crew (or passive wiring) refill it; the module spends `powerDraw
   * × dt` joules per operating tick (`crew.ts`). DERIVED from the heaviest module
   * draw over the capacitor reserve (`LOCAL_CHARGE_BUFFER_J`, `combat-scale.ts`),
   * so the buffer holds a tick of any weapon's draw and a wired weapon can fire —
   * the unit-coherent replacement for the old abstract `120`-unit ceiling, which
   * at watt-scale `powerDraw` drained below zero in one tick, disabling every gun.
   * Classification: derived-by-formula (`LOCAL_CHARGE_BUFFER_J`).
   */
  chargeBufferMax: LOCAL_CHARGE_BUFFER_J,
  /**
   * Passive wiring reach, in cells of walkable path distance from a reactor.
   * A power-drawing module within this many alive cells of an alive reactor is
   * hard-wired to the grid and refills its buffer for free each tick; modules
   * beyond it are off the grid and depend on crew hauling charge from a
   * reactor. Small, compact ships (reactor beside the guns) are fully wired and
   * need no power crew; sprawling capitals have outlying stations that only
   * crew can keep fed, which is the whole point of crewed interiors. Tuned so a
   * typical capital's prow weapons sit within reach of a central reactor without
   * a permanent charge-haul — distant wings still sometimes need a run, but the
   * battery is not permanently starved.
   *
   * Classification: authored catalogue content (a passive-wiring reach spec in
   * walkable-cell path distance).
   */
  powerWiringRadius: 7,
  /**
   * Innate visual line-of-sight radius (metres) every ship has before any sensor
   * module extends it — the baseline omnidirectional receiver (sensor-free
   * sight). Grounded (Phase 9) in the EM reception model: it is the
   * continuous-emission range at which a quiescent hull's ambient self-emission
   * (`EM_HULL_AMBIENT_EMISSION`) is received at exactly the noise floor by a
   * sensor-free receiver — `continuousRange(ambient, floor, 1)`, evaluated as
   * `VISUAL_LOS_RADIUS_M` above. The radius now FALLS OUT of the inverse-square
   * physics rather than being hand-picked; the ambient emission is anchored to
   * keep it below typical weapon ranges so a sensorless fleet is genuinely
   * myopic and must close to engage.
   *
   * Classification: derived-by-formula (inverse-square `continuousRange` over
   * the authored ambient emission and the receiver noise floor).
   */
  visualLosRadius: VISUAL_LOS_RADIUS_M,
  /**
   * Multiplier applied to the non-immune part of a ship's effective sensor
   * radius inside a nebula. A sensor return is the most strongly attenuated
   * channel — it is scattered twice, out to the target and back — so it uses the
   * higher sensor Beer-Lambert coefficient (double the one-way EM coefficient).
   * The factor is the transmittance `exp(-μ_sensor · d)` ≈ 0.50 over the
   * engagement path, computed as {@link NEBULA_SENSOR_TRANSMITTANCE} in
   * `arena-physics.ts`. `nebulaImmune` sensor bonuses bypass this entirely.
   * Derived from a real per-metre coefficient rather than a hand-picked 0.5.
   *
   * Classification: derived-by-formula (Beer-Lambert `exp(-μ_sensor · d)` over
   * the two-way sensor coefficient and the engagement path).
   */
  nebulaSensorFactor: NEBULA_SENSOR_TRANSMITTANCE,
  /**
   * Weight on enemy cost in the awareness threat score
   * `threat = -dist + threatCostWeight * cost`. Small, so distance dominates
   * (a near contact is the more pressing threat), but a far, very expensive
   * capital still ranks above a near, cheap fighter — exactly the prioritisation
   * a relay's bounded bandwidth should forward first. Re-grounded for km combat
   * (Phase 3): distances now run to tens of thousands of world units (weapon
   * reach is tens of km) while costs stay a few hundred catalogue points, so the
   * weight is cut ~100× from the pre-km 0.01 to keep one cost point worth ~0.01
   * of the NEW distance scale (~one metre of nearness per cost point at km
   * ranges); the relative distance-vs-cost balance is preserved across the
   * rescale rather than letting cost swamp distance now that distances are 100×
   * larger.
   *
   * Classification: unit-spec-rate-epsilon (a scoring weight that normalises
   * two authored scales — world distance and catalogue cost points).
   */
  threatCostWeight: 0.0001,
  /**
   * Ticks a ghost contact survives after its target leaves sensor coverage.
   * The observer keeps engaging the last-known position until this counts down
   * to zero, modelling tracking memory / dead reckoning. 60 ticks is ~2 s at
   * 30 ticks/s — long enough to keep firing through a brief occlusion, short
   * enough that a ship that has truly slipped away stops drawing fire.
   *
   * Classification: unit-spec-rate-epsilon (a tracking-memory TTL in ticks).
   */
  ghostFadeTicks: 60,
  /**
   * Hard upper bound on the number of candidate comms unit pairs processed per
   * side per tick. Comms pairing is O(n^2) in comms units; on a pathologically
   * large fleet this caps the work. Candidate pairs are processed in canonical
   * sorted order and any beyond the budget are dropped (with a single
   * `console.warn` per run per side), so the result stays deterministic even
   * when the cap fires. Sized far above any realistic fleet's comms-unit count.
   *
   * Classification: unit-spec-rate-epsilon (a deterministic-work performance
   * budget; not a physics quantity).
   */
  maxCommsPairs: 20000,
  /**
   * Base passive acquisition radius (metres): the reference range at which a
   * ship with no sensor uplift acquires an enemy carrying a stealth signature.
   * It is the multiplicand the target's `SignatureEffect.acquisitionMultiplier`
   * shrinks, and the range a sensor's `pierceCloak` flag is measured against —
   * not a hard map bound. A NON-STEALTH enemy (no cloak and no signature module)
   * is acquired regardless of distance, so this value never gates ordinary
   * targeting: existing fleets see exactly the same candidate sets as before. It
   * only takes effect once a target carries a signature module (its range
   * shrinks to `baseAcquireRange * acquisitionMultiplier`) or a cloak. Grounded
   * (Phase 9) in the EM reception model: the continuous-emission range at which a
   * stealth-relevant target's reference emission (`EM_ACQUIRE_REFERENCE_EMISSION`)
   * is received at the noise floor — `continuousRange(reference, floor, 1)`,
   * evaluated as `BASE_ACQUIRE_RANGE_M` above. The reference emission is anchored
   * so the range lands comfortably beyond the deployment span plus battle drift.
   *
   * Classification: derived-by-formula (inverse-square `continuousRange` over
   * the authored acquisition-reference emission and the receiver noise floor).
   */
  baseAcquireRange: BASE_ACQUIRE_RANGE_M,
  /**
   * Spacing (metres) between mines in a single mine-layer batch. Derived from
   * the mine's lethal radius: a mine's blast is effective out to roughly one
   * cell radius, so adjacent mines in a ring are placed one `CELL_SIZE` apart
   * — close enough that their lethal radii overlap into a continuous belt, far
   * enough apart that one mine's trigger does not sympathetic-detonate its
   * neighbour. Authored catalogue content representing the mine payload's
   * lethal radius. No rng: each mine's offset is a pure function of its index
   * within the batch.
   *
   * Classification: derived-by-formula (`CELL_SIZE`); the anchor (mine lethal
   * radius ≈ one cell) is authored catalogue content.
   */
  mineRingSpacing: CELL_SIZE,
  /**
   * Speed (metres per tick) of a boarding pod in flight toward its target —
   * DERIVED from a real breaching-pod cruise velocity at the m/s → m/tick
   * boundary: `BOARDING_POD_CRUISE_M_PER_S / TICKS_PER_SECOND`. A pod homes on
   * its target each tick, stepping this far along the bearing to the target's
   * current position (clamped so it never overshoots). Re-grounded for km combat
   * (Phase 3): the pre-km 6 m/tick (180 m/s) could not cross the km-scale gaps
   * boarding now spans, so the cruise is authored as a real ~500 m/s pod drive
   * (`16.7 m/tick`) so a pod actually reaches a target tens of km out within the
   * boarding launcher's reach. Pure function of positions — no rng.
   *
   * Classification: derived-by-formula (`BOARDING_POD_CRUISE_M_PER_S /
   * TICKS_PER_SECOND`); the anchor is an authored breaching-pod cruise velocity.
   */
  boardingPodSpeed: BOARDING_POD_CRUISE_M_PER_S / TICKS_PER_SECOND,
  /**
   * Collision radius (metres) of a launched drone — a small, fighter-sized
   * craft. Derived from the drone's payload size: a drone carries a weapon
   * and minimal propulsion, fitting within roughly one cell's footprint, so
   * `CELL_SIZE * 0.75` is its collision disc. Authored catalogue content
   * representing the drone's physical size.
   *
   * Classification: derived-by-formula (`CELL_SIZE * 0.75`); the anchor
   * (drone ≈ one cell footprint) is authored catalogue content.
   */
  droneRadius: CELL_SIZE * 0.75,
  /**
   * Collision radius (metres) of a decoy — a plausible ship-sized contact. A
   * decoy mimics a real ship's radar cross-section, so its effective radius is
   * that of a small frigate: `CELL_SIZE * 4 / 3`. Authored catalogue content
   * representing the decoy's imitated signature size.
   *
   * Classification: derived-by-formula (`CELL_SIZE * 4 / 3`); the anchor
   * (decoy ≈ small-frigate signature) is authored catalogue content.
   */
  decoyRadius: (CELL_SIZE * 4) / 3,
  /**
   * Lifetime (ticks) for a drone whose hangar sets no explicit lifetime. A
   * drone carries propellant and power for a finite endurance; the default is
   * the catalogue endurance for a long-loiter combat drone, long enough that
   * it persists for the whole battle unless shot down. Authored catalogue
   * content (a rate / endurance spec).
   *
   * Classification: unit-spec-rate-epsilon (a drone endurance spec in ticks;
   * Phase 14 supplies propellant / `Isp` for a real Δv budget).
   */
  droneDefaultLifetime: 4000,
  /**
   * Explosive chain reactions (realism overhaul, Phase 4). When a volatile
   * module is destroyed it detonates, dealing radial damage to the other alive
   * modules on the SAME ship with linear falloff to a blast radius. HP is in the
   * same energy-equivalent units as weapon damage, so the yields below are in
   * those units too — sized to be meaningful but survivable, not annihilating.
   *
   * Classification: authored catalogue content
   */
  chainReaction: {
    /**
     * Reactor (`power`) blast yield as a fraction of the plant's `output`. A
     * tiny fraction of the reactor's rated output is released as a structural
     * shockwave — enough to wreck adjacent cells, far short of vaporising the
     * ship. Multiplied by `effect.output`.
     */
    reactorYieldFraction: 0.001,
    /**
     * Magazine blast yield per stored round, in joules — DERIVED as the kinetic
     * energy of one frigate-class round a magazine stores
     * ({@link MAGAZINE_ROUND_YIELD_J}, `½·m·v²` ≈ 320 MJ). A magazine cook-off
     * is the sympathetic ignition of its rounds, so each releases its own muzzle
     * energy; a full magazine going up is then a multi-gigajoule secondary
     * explosion on the same joule scale as the GJ armour around it, while an
     * empty one barely pops. Multiplied by the module's `ammoStored` at the
     * moment it dies. Re-grounded from the pre-SI authored 500 to real joules in
     * Phase 1 (HP and weapon damage are now joules).
     *
     * Classification: derived-by-formula (`MAGAZINE_ROUND_YIELD_J`, the kinetic
     * energy `½·m·v²` of one stored frigate-class round).
     */
    magazineYieldPerRound: MAGAZINE_ROUND_YIELD_J,
    /**
     * Blast radius (world units) within which an exploding module damages its
     * neighbours. Damage falls off linearly from the full yield at the blast
     * centre to zero at this radius. Two cells across (`CELL_SIZE * 2`), so a
     * module's blast reaches its immediate neighbours with the linear falloff
     * and fades out one cell beyond — geometry that follows the cell scale.
     *
     * Classification: derived-by-formula (`CELL_SIZE * 2`); the anchor (a blast
     * reaching the adjacent ring of cells) is authored catalogue content.
     */
    radius: CELL_SIZE * 2,
  },
  /**
   * Kinetic ship-ship collision damage (realism overhaul, Phase 4). The
   * fraction of a collision's kinetic energy converted into structural damage,
   * split across the contact-side modules of each ship. The rest is taken up by
   * the elastic restitution impulse (handled separately by the collision step).
   * KE is the relativistic `(γ − 1) * reducedMass * c²`, which reduces to the
   * Newtonian `0.5 * reducedMass * v²` at sub-light speeds and stays finite at
   * the speed limit. In the same energy-equivalent units as module HP, so a fast
   * heavy ram is devastating and a gentle nudge is negligible.
   *
   * Classification: authored catalogue content
   */
  collisionDamageFraction: 0.3,

  /**
   * [Phase 12 — overheat] Cell temperature (kelvin) above which a module suffers
   * thermal/structural failure and is destroyed. The thermal transport field
   * carries each cell's temperature in kelvin (`resource-step.ts`); when a cell
   * exceeds this the resource step kills the module through the same death path
   * battle damage uses (substrate and surface HP to zero, `alive` cleared), so the
   * downstream effects — break-apart, airtightness venting, and a next-tick chain
   * reaction for a volatile cell — all follow. 1500 K is the engineering failure
   * point for aluminium-alloy structure and silicon electronics: aluminium melts
   * at ~933 K and loses most strength well below that, and semiconductor
   * junctions fail by ~400-600 K, so a cell held at 1500 K has lost both its
   * structure and its systems. A radiator-equipped, quiescent ship never
   * approaches this (radiators hold cells near cabin temperature), so an
   * undamaged design is unaffected.
   *
   * Classification: authored catalogue content (a material/electronics thermal
   * failure point in kelvin; Phase 14 may refine per-module from the SI catalogue).
   */
  overheatThresholdK: 1500,

  /**
   * [Phase 12 — debris] Fraction of a destroyed ship's structural mass that
   * survives as a single trackable wreckage fragment. A real hull break-up
   * scatters its mass across a spectrum of fragment sizes, most of them dust and
   * shrapnel below any broad-phase tracking bound; the sim coalesces the
   * trackable remainder into one drifting body per kill. Around half the mass
   * persisting as coherent wreckage (the rest vaporised, ejected as fine
   * particles, or lost to the blast) is the conventional hypervelocity-impact
   * coarse-fragment estimate; the fragment then keeps the parent's momentum
   * exactly (Newton's first law) and drifts frictionlessly.
   *
   * Classification: authored catalogue content
   */
  debrisMassFraction: 0.5,

  /**
   * [Phase 12 — debris kinetic hazard] Fraction of the kinetic energy a
   * debris fragment transfers to a ship on bounding-disc overlap that is
   * converted into structural damage. The same energy-equivalent units as
   * `collisionDamageFraction`; set lower than the ship-ship value because a
   * debris fragment is diffuse wreckage rather than a solid ram, so the energy
   * couples less efficiently to the hull structure.
   *
   * Classification: authored catalogue content
   */
  debrisCollisionDamageFraction: 0.1,

  /**
   * [Phase 12 — debris kinetic hazard] Minimum relative speed (world m/tick)
   * between a debris fragment and a ship for a kinetic-energy transfer to be
   * applied — DERIVED from a real impact-speed threshold at the m/s → m/tick
   * boundary: `DEBRIS_MIN_REL_SPEED_M_PER_S / TICKS_PER_SECOND`. Contacts below
   * this are near-stationary nudges (the debris is drifting with the ship or is
   * essentially at rest relative to it) and are ignored to avoid applying
   * vanishingly small damage values that accumulate over many ticks without
   * physical justification. Re-grounded for km combat (Phase 3): relative speeds
   * now reach the hundreds-of-m/s scale of km/s combat, so the threshold is
   * authored as a real ~150 m/s minimum impact speed (`5 m/tick`) rather than the
   * pre-km 10 m/tick that, against the larger km/s closing speeds, would let too
   * many genuine glancing impacts through.
   *
   * Classification: derived-by-formula (`DEBRIS_MIN_REL_SPEED_M_PER_S /
   * TICKS_PER_SECOND`); the anchor is an authored minimum impact-speed threshold.
   */
  debrisMinRelSpeed: DEBRIS_MIN_REL_SPEED_M_PER_S / TICKS_PER_SECOND,
  /**
   * Stopping energy (joules) a solid wall edge absorbs from a penetrating round
   * — DERIVED as the destruction energy of the interior bulkhead it presents
   * ({@link WALL_STOPPING_J}, `bulkheadMass × steel J/kg` ≈ 940 MJ). A round must
   * spend this much to punch through an internal wall before reaching the cell
   * behind. Re-grounded from the pre-SI authored 25 to real joules in Phase 1.
   *
   * Classification: derived-by-formula (`WALL_STOPPING_J`, the destruction energy
   * `bulkheadMass × specificDestructionEnergy` of an interior partition).
   */
  wallStopping: WALL_STOPPING_J,
  /**
   * Stopping energy (joules) a closed door absorbs; open doors absorb zero —
   * DERIVED as a fraction of the wall value ({@link DOOR_STOPPING_J}, a third of
   * `wallStopping`): a door is a thinner, weaker barrier than a solid bulkhead.
   * Re-grounded from the pre-SI authored 8 to real joules in Phase 1.
   *
   * Classification: derived-by-formula (`DOOR_STOPPING_J`, a fraction of the
   * wall stopping energy).
   */
  doorStopping: DOOR_STOPPING_J,
  /** Blast-energy fraction (0–1) transmitting through a wall edge. Classification: authored catalogue content. */
  wallBlastAttenuation: 0.1,
  /** Blast-energy fraction transmitting through a closed door edge. Classification: authored catalogue content. */
  doorBlastAttenuation: 0.5,
  /** Blast-energy fraction transmitting through an open door edge (near-free passage). Classification: authored catalogue content. */
  doorOpenBlastAttenuation: 0.92,
};

/** Closing speed (world-units per tick) below which the translation controller
 *  considers the ship "arrived" on its desired bearing and stops fine-tuning.
 *  DERIVED from a real arrival tolerance at the m/s → m/tick boundary
 *  (`ARRIVAL_CLOSING_SPEED_TOLERANCE_M_PER_S / TICKS_PER_SECOND`) rather than a
 *  hand-tuned per-tick literal, re-grounded for km combat (Phase 3) so the
 *  "stopped" band tracks real arrival speed. The one numerical settle epsilon in
 *  the movement model — every other quantity is kinematics over actual thrust and
 *  mass (`a = thrust / mass`, `vMax = sqrt(2·a·d)`, `dBrake = v² / (2·a)`), the
 *  ships' actual engine force vectors, and the existing `SIM.angularDeadband`
 *  heading band. No speed cap, no damping, no hand-tuned thresholds. */
export const ARRIVAL_CLOSING_SPEED_MPS =
  ARRIVAL_CLOSING_SPEED_TOLERANCE_M_PER_S / TICKS_PER_SECOND;

/** Max heading error (radians) at which the main engine may fire. A ship still
 *  turning onto its commanded heading would otherwise thrust along the
 *  intermediate headings and inject lateral velocity that, with no damping,
 *  compounds into a drift — so the engine waits until the ship is within this
 *  band of the heading before firing (RCS/reaction wheels still turn the ship).
 *  PI/4 is the band at which thrust is still >= ~70% along the heading
 *  (cos(PI/4)); beyond it the lateral component dominates. A settle epsilon in
 *  the same category as `angularDeadband` and `ARRIVAL_CLOSING_SPEED_MPS`. */
export const THRUST_ALIGNMENT_RAD = Math.PI / 4;

/** Starting hit points of a freshly spawned crew member. */
export const CREW_HP = 10;

/** Sentinel stored in the crew path cache for a (from, to) pair the A* proved
 *  has no 4-connected route. Distinct from a cached path array (always truthy)
 *  and from a genuine cache miss (the key is absent), so `findCrewPath` can tell
 *  "not yet searched" from "searched and unreachable" without a second lookup.
 *
 *  Lives in the config leaf (rather than `crew-pathfinding.ts`) because the
 *  `SimShip.pathCache` type in `types.ts` references `typeof UNREACHABLE`, and
 *  keeping it in the leaf avoids a types.ts -> crew-pathfinding.ts cycle. */
export const UNREACHABLE = Symbol("crew-path-unreachable");
