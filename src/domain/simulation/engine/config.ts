/**
 * Tunable gameplay constants and the per-battle projectile id counter.
 *
 * Leaf module: holds `SIM` (the tunable feel constants), `CREW_HP`, the real
 * speed-of-light anchors, and the single piece of module-level mutable state
 * (`projectileCounter`), which `index.ts` resets at the start of each
 * `simulateBattle` call.
 *
 * ## Unit model and the "grounded constant" rule
 *
 * World coordinates are **metres**. Ship-interior cells are `CELL_SIZE = 12 m`
 * (`src/domain/grid.ts`). Every value below is one of:
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
 * The **black-hole** `SIM.*` (`blackHoleStrength`, the lethal/tidal radii, the
 * tidal-damage scale, `blackHoleAvoid`) are the one remaining group whose
 * grounding is deferred — they are re-derived from an authored mass via
 * `r_s = 2GM/c^2` and the real tidal field `2GM·r/R^3` in Phase 4, when the
 * body list, GR dilation, and lensing arrive together and the lethal radius
 * becomes a real Schwarzschild radius rather than an arena-scale softening.
 * They carry a `[Phase 4]` tag in their comments until then.
 */

import { TICKS_PER_SECOND } from "@/domain/simulation/types";

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

/** Deterministic per-battle projectile id counter. Reset at the start of each
 *  `simulateBattle` call; incremented in spawn order so two same-seed runs
 *  produce identical ids. Used by the snapshot → interpolation path to match
 *  projectiles across consecutive frames for smooth sub-tick rendering. */
let projectileCounter = 0;

/** Reset the per-battle projectile id counter to zero. Called once at the top of
 *  `simulateBattle` so each run starts ids at 0 regardless of prior runs. */
export function resetProjectileCounter(): void {
  projectileCounter = 0;
}

/** Claim the next projectile id in spawn order, returning the `proj-<n>` form
 *  the snapshot path matches across frames. Increments the counter so the next
 *  call yields the next id — byte-identical to the original
 *  `\`proj-${projectileCounter++}\`` expression. */
export function claimProjectileId(): string {
  const id = `proj-${projectileCounter}`;
  projectileCounter += 1;
  return id;
}

/** Tunable gameplay constants. All "feel" lives here as named values. */
export const SIM = {
  /**
   * Half-angle (radians) either side of a ship's facing within which its
   * weapons may fire. ~1.2 rad ≈ 69°, a generous forward arc. An explicit
   * mount-spec epsilon (the weapon-class traverse window) — not a physics
   * quantity.
   */
  firingArc: 1.2,
  /**
   * Distance (metres) forward of a ship's centre where projectiles spawn.
   * Derived from the ship's hull geometry: a weapon fires from its muzzle,
   * which sits one cell outboard of the ship's leading edge so the round
   * clears the hull before any collision test. At `CELL_SIZE = 12 m`, half a
   * cell (`CELL_SIZE / 2 = 6 m`) is the muzzle clearance for a weapon on the
   * forward centreline — authored catalogue content representing the physical
   * muzzle-to-centre distance.
   */
  muzzleOffset: 6,
  /**
   * [Phase 9 — EM-awareness grounding pending] Fallback engagement range
   * (metres) for ships with no weapons: the distance an unarmed ship holds
   * from its target. Phase 9 replaces this with a derivation from the ambient
   * EM field × receiver threshold; until then it is authored catalogue content
   * representing the effective reach of a baseline sensor-free contact.
   */
  defaultRange: 220,
  /** Fraction of its max weapon range a ship tries to keep from its target. */
  rangeFraction: {
    short: 0.3,
    medium: 0.55,
    long: 0.85,
  },
  /** Multiplier applied to the desired range based on engagement stance. */
  stanceRangeFactor: {
    aggressive: 0.8,
    balanced: 1.0,
    defensive: 1.15,
    evasive: 1.4,
  },
  /**
   * [Phase 4 — GR grounding pending] Black-hole gravity. `blackHoleStrength`
   * is the G·M product: the gravitational acceleration at distance r is
   * `GM / r^2`, directed toward the centre. Applied as a force to velocity
   * (not a position teleport) so momentum is preserved and the equivalence
   * principle holds — heavy and light ships accelerate the same. The
   * acceleration is softened to zero at the lethal radius to avoid a
   * singularity.
   *
   * Grounding (Phase 4): this becomes a real `GM = G · M_body` for an
   * authored body mass `M_body` carried on the body list, and the lethal
   * radius becomes the real Schwarzschild radius `r_s = 2GM/c^2`. The value
   * here is an arena-scale softening chosen so a ship at the deployment line
   * (~360 m) feels a gentle pull while one inside the lethal zone is destroyed;
   * it is tagged `[Phase 4]` and re-derived then. Cited as authored catalogue
   * content in the interim.
   */
  blackHoleStrength: 5000,
  /** [Phase 4] Inside this radius a ship is torn apart. Becomes `r_s = 2GM/c^2`
   *  when the body mass is authored. Authored catalogue content in the interim. */
  blackHoleLethalRadius: 24,
  /** [Phase 4] Per-tick structural damage at the centre of the well. Authored
   *  catalogue content; becomes the real tidal-acceleration damage
   *  `2GM·r_body / R^3` × hull structural tolerance when GR lands. */
  blackHoleLethalDamage: 12,
  /**
   * [Phase 4] Outside the lethal radius but inside this zone, a ship takes
   * damage proportional to 1/r^3 — the leading-order tidal force across a
   * body of finite size ("spaghettification"). Becomes the Roche-limit radius
   * derived from the real tidal field vs hull structural tolerance in Phase 4.
   */
  blackHoleTidalRadius: 48,
  /** [Phase 4] Coefficient for the 1/r^3 tidal damage. Becomes
   *  `2GM · r_body · k_hull` (real tidal acceleration × hull tolerance) in
   *  Phase 4. Authored catalogue content in the interim. */
  blackHoleTidalDamageScale: 200000,
  /**
   * Nebula shield-regeneration attenuation. A nebula is a gas cloud whose
   * particles scatter and absorb electromagnetic energy; a ship's shield
   * projector couples to the local EM field, so a denser gas weakens recharge.
   * Phase 9 replaces this with the real per-metre absorption coefficient
   * (Beer-Lambert: `exp(-α·d)` integrated over the path) and the range factor
   * falls out of the integral. Until then this is the equilibrium attenuation
   * factor a typical nebula imposes — authored catalogue content representing
   * a moderate-density ionised cloud (roughly the visual extinction of a
   * bright nebula at visible wavelengths).
   */
  nebulaRegenFactor: 0.5,
  /**
   * Nebula projectile-tracking attenuation. Homing weapons steer by EM return;
   * nebula gas scatters that return, lengthening the effective sensor path and
   * cutting the lock quality. Same physical origin as `nebulaRegenFactor`
   * (per-metre absorption); Phase 9 derives both from one absorption
   * coefficient. Authored catalogue content in the interim, equal to the
   * regen factor because both are the same path-attenuation effect.
   */
  nebulaTrackingFactor: 0.5,
  /**
   * Adaptive-shield ceiling (factions update). A shield with an `adaptiveRampRate`
   * recharges ever faster the longer it goes untouched — its effective rate is the
   * base rate times `1 + rampRate * ticksUntouched`. This caps that multiplier so
   * a shield left alone indefinitely tops out at this multiple of its base rate
   * rather than ramping without bound. 3 means "at most triple the base recharge".
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
   */
  blackHoleAvoid: {
    /**
     * Outer edge of the avoidance field as a multiple of the tidal radius.
     * Beyond `safetyMargin * blackHoleTidalRadius` from the centre the
     * avoidance weight is zero — the ship is considered clear and ignores the
     * hole entirely, preserving open-space combat behaviour. 1.5 gives a
     * comfortable buffer outside the damaging tidal zone so a ship begins
     * arcing away before it starts taking tidal damage.
     */
    safetyMargin: 1.5,
    /**
     * Minimum avoidance weight applied the instant a ship crosses inside the
     * safety margin, so the steering bias is felt immediately at the edge
     * rather than fading in from zero (a zero-at-the-edge ramp lets a fast
     * ship punch through before the bias grows). The weight then ramps from
     * this floor up to 1 as the ship nears the lethal radius.
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
   * Each anomaly is exclusive, so these never compound.
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
   */
  angularDeadband: 0.01,
  /**
   * Mass of a single spawned projectile, in the same mass units as ship
   * modules. Derived from the physical projectile: `mass = density × volume`.
   * A kinetic slug of a dense metal (depleted-uranium / tungsten-alloy class,
   * representative density ~19_000 kg/m³) of the small calibre a fighter or
   * frigate mounts — a cylinder a few centimetres across and ~10 cm long.
   * The engine's mass unit is not yet SI (the catalogue is re-authored in kg
   * in Phase 14), so the value below is the authored catalogue figure for that
   * slug in the current unit system; the recoil a firing ship feels is
   * `m_p · v_p / M_ship` and the impulse a target absorbs on hit is the same.
   * A small fixed projectile mass keeps recoil visible (a stationary ship
   * firing a fast round kicks backward) without destabilising the movement
   * model for slow, heavy projectiles like torpedoes.
   */
  projectileMass: 0.5,
  /**
   * Per-PD-module per-tick chance of intercepting a single in-range missile
   * or torpedo. Multiple PD modules stack their chances (1 - (1-p)^n) but
   * the cumulative chance is capped here so a screen of PD modules can never
   * be a 100% certainty.
   */
  pdHitChancePerModule: 0.4,
  /** Upper bound on the stacked PD intercept probability per projectile. */
  pdMaxStackedChance: 0.95,
  /**
   * Rounds a crew member carries per ammo-run from a magazine to a dry weapon.
   * One trip tops a weapon up by at most this much (and never beyond the
   * weapon's `ammoCapacity`), and drains the magazine's store by the amount
   * actually carried.
   */
  ammoRunAmount: 60,
  /**
   * Charge packets a crew member carries per power-run from a reactor to a
   * starved module. Each packet refills the sink module's local charge buffer
   * by this much (capped at the buffer ceiling).
   */
  powerRunAmount: 60,
  /**
   * Ceiling on a powered module's local charge buffer. Crew top it up from a
   * reactor; the module spends `powerDraw` from it each tick it operates. A
   * module whose buffer hits zero goes idle until a crew power-run refills it.
   */
  chargeBufferMax: 120,
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
   */
  powerWiringRadius: 7,
  /**
   * [Phase 9 — EM-awareness grounding pending] Innate visual line-of-sight
   * radius (metres) every ship has before any sensor module extends it — the
   * baseline omnidirectional receiver (sensor-free sight). Phase 9 derives
   * this from the ambient EM field × receiver threshold; until then it is
   * authored catalogue content representing the effective range of a
   * quiescent ship's passive receiver against a reflecting target. Kept below
   * typical weapon ranges so a fleet without dedicated sensors is genuinely
   * myopic and must close to engage.
   */
  visualLosRadius: 140,
  /**
   * [Phase 9 — EM-awareness grounding pending] Multiplier applied to the
   * non-immune part of a ship's effective sensor radius inside a nebula. Same
   * physical origin as the regen / tracking factors (per-metre absorption);
   * Phase 9 derives all three from one Beer-Lambert coefficient.
   * `nebulaImmune` sensor bonuses bypass this entirely. Authored catalogue
   * content in the interim.
   */
  nebulaSensorFactor: 0.5,
  /**
   * Weight on enemy cost in the awareness threat score
   * `threat = -dist + threatCostWeight * cost`. Small, so distance dominates
   * (a near contact is the more pressing threat), but a far, very expensive
   * capital still ranks above a near, cheap fighter — exactly the prioritisation
   * a relay's bounded bandwidth should forward first. Distances run to a few
   * hundred world units and costs to a few hundred points, so a weight of ~0.01
   * makes one cost point worth ~0.01 world units of nearness.
   */
  threatCostWeight: 0.01,
  /**
   * Ticks a ghost contact survives after its target leaves sensor coverage.
   * The observer keeps engaging the last-known position until this counts down
   * to zero, modelling tracking memory / dead reckoning. 60 ticks is ~2 s at
   * 30 ticks/s — long enough to keep firing through a brief occlusion, short
   * enough that a ship that has truly slipped away stops drawing fire.
   */
  ghostFadeTicks: 60,
  /**
   * Hard upper bound on the number of candidate comms unit pairs processed per
   * side per tick. Comms pairing is O(n^2) in comms units; on a pathologically
   * large fleet this caps the work. Candidate pairs are processed in canonical
   * sorted order and any beyond the budget are dropped (with a single
   * `console.warn` per run per side), so the result stays deterministic even
   * when the cap fires. Sized far above any realistic fleet's comms-unit count.
   */
  maxCommsPairs: 20000,
  /**
   * [Phase 9 — EM-awareness grounding pending] Base passive acquisition radius
   * (metres): the reference range at which a ship with no sensor uplift acquires
   * an enemy carrying a stealth signature. It is the multiplicand the target's
   * `SignatureEffect.acquisitionMultiplier` shrinks, and the range a sensor's
   * `pierceCloak` flag is measured against — not a hard map bound. A NON-STEALTH
   * enemy (no cloak and no signature module) is acquired regardless of distance,
   * so this value never gates ordinary targeting: existing fleets see exactly
   * the same candidate sets as before. It only takes effect once a target
   * carries a signature module (its range shrinks to `baseAcquireRange *
   * acquisitionMultiplier`) or a cloak. Phase 9 derives this from ambient-EM ×
   * threshold; until then it is authored catalogue content, sized comfortably
   * beyond the deployment span plus battle drift so a signature-equipped ship
   * at the far edge is still acquirable until its multiplier pulls the range in.
   */
  baseAcquireRange: 2000,
  /**
   * Spacing (metres) between mines in a single mine-layer batch. Derived from
   * the mine's lethal radius: a mine's blast is effective out to roughly one
   * cell radius, so adjacent mines in a ring are placed one `CELL_SIZE` apart
   * (`CELL_SIZE = 12 m`) — close enough that their lethal radii overlap into a
   * continuous belt, far enough apart that one mine's trigger does not
   * sympathetic-detonate its neighbour. Authored catalogue content
   * representing the mine payload's lethal radius. No rng: each mine's offset
   * is a pure function of its index within the batch.
   */
  mineRingSpacing: 12,
  /**
   * Speed (metres per tick) of a boarding pod in flight toward its target.
   * A pod is a small assault craft; its speed is the catalogue figure for a
   * short-range breaching pod's drive. Authored catalogue content representing
   * the pod's physical drive output. A pod homes on its target each tick,
   * stepping this far along the bearing to the target's current position
   * (clamped so it never overshoots). Pure function of positions — no rng.
   */
  boardingPodSpeed: 6,
  /**
   * Collision radius (metres) of a launched drone — a small, fighter-sized
   * craft. Derived from the drone's payload size: a drone carries a weapon
   * and minimal propulsion, fitting within roughly one cell's footprint
   * (`CELL_SIZE = 12 m`), so `CELL_SIZE * 0.75 = 9 m` is its collision disc.
   * Authored catalogue content representing the drone's physical size.
   */
  droneRadius: 9,
  /**
   * Collision radius (metres) of a decoy — a plausible ship-sized contact. A
   * decoy mimics a real ship's radar cross-section, so its effective radius is
   * that of a small frigate: `CELL_SIZE * 4/3 = 16 m`. Authored catalogue
   * content representing the decoy's imitated signature size.
   */
  decoyRadius: 16,
  /**
   * Lifetime (ticks) for a drone whose hangar sets no explicit lifetime. A
   * drone carries propellant and power for a finite endurance; the default is
   * the catalogue endurance for a long-loiter combat drone, long enough that
   * it persists for the whole battle unless shot down. Authored catalogue
   * content (a rate / endurance spec).
   */
  droneDefaultLifetime: 4000,
};

/** Closing speed (world-units per tick) below which the translation controller
 *  considers the ship "arrived" on its desired bearing and stops fine-tuning.
 *  The one numerical settle epsilon in the movement model — every other
 *  quantity is kinematics over actual thrust and mass (`a = thrust / mass`,
 *  `vMax = sqrt(2·a·d)`, `dBrake = v² / (2·a)`), the ships' actual engine force
 *  vectors, and the existing `SIM.angularDeadband` heading band. No speed cap,
 *  no damping, no hand-tuned thresholds. */
export const ARRIVAL_CLOSING_SPEED_MPS = 0.05;

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
