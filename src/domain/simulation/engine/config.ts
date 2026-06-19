/**
 * Tunable gameplay constants and the per-battle projectile id counter.
 *
 * Leaf module: no sibling imports. Holds `SIM` (the tunable feel constants),
 * `CREW_HP`, and the single piece of module-level mutable state
 * (`projectileCounter`), which `index.ts` resets at the start of each
 * `simulateBattle` call.
 */

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
  /** Half-angle (radians) either side of a ship's facing within which its
   *  weapons may fire. ~1.2 rad ≈ 69°, a generous forward arc. */
  firingArc: 1.2,
  /** Units forward of a ship's centre where projectiles spawn. */
  muzzleOffset: 6,
  /** Fallback engagement range (battle units) for ships with no weapons. */
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
   * Black-hole gravity. `blackHoleStrength` is the G·M product: the
   * gravitational acceleration at distance r is `strength / r^2`,
   * directed toward the centre. Applied as a force to velocity (not
   * a position teleport) so momentum is preserved and the
   * equivalence principle holds — heavy and light ships accelerate
   * the same. The acceleration is softened to zero at the lethal
   * radius to avoid a singularity.
   */
  blackHoleStrength: 5000,
  /** Inside this radius a ship is torn apart by tidal forces. */
  blackHoleLethalRadius: 24,
  /** Per-tick structural damage at the centre of the well. */
  blackHoleLethalDamage: 12,
  /**
   * Outside the lethal radius but inside this zone, a ship takes
   * damage proportional to 1/r^3 — the leading-order tidal force
   * across a body of finite size. "Spaghettification".
   */
  blackHoleTidalRadius: 48,
  /** Coefficient for the 1/r^3 tidal damage; tuned so the tidal edge
   *  shreds a typical ship in a handful of ticks. */
  blackHoleTidalDamageScale: 200000,
  /** Nebula dampens shield regeneration and projectile tracking. */
  nebulaRegenFactor: 0.5,
  nebulaTrackingFactor: 0.5,
  /**
   * Adaptive-shield ceiling (factions update). A shield with an `adaptiveRampRate`
   * recharges ever faster the longer it goes untouched — its effective rate is the
   * base rate times `1 + rampRate * ticksUntouched`. This caps that multiplier so
   * a shield left alone indefinitely tops out at this multiple of its base rate
   * rather than ramping without bound. 3 means "at most triple the base recharge".
   */
  adaptiveShieldMaxMultiple: 3,
  /** Per-tick chance an asteroid field destroys a passing projectile. */
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
   * Per-tick multiplicative drag on linear and angular velocity. A small drag
   * is a gameplay compromise: real space is frictionless (ships would coast
   * forever), but unbounded drift makes battles unreadable. 0.97 ≈ 0.5 s
   * half-life at 30 ticks/s — momentum is felt, but ships settle.
   */
  linearDamping: 0.97,
  /**
   * Per-tick multiplicative drag on angular velocity — the rotational analogue
   * of `linearDamping`, and like it a deliberate small non-physical bleed: real
   * space is frictionless, so a torqued ship would otherwise spin forever, and
   * the attitude controller's braking only lands angVel exactly on zero in the
   * continuous limit. Close to 1 so a real tumble still reads as momentum (the
   * controller, not damping, does the deliberate braking) while a settled ship
   * cannot jitter forever on residual spin from off-centre thruster torque or a
   * collision kick. There is NO maximum angular speed — this only decays spin,
   * it never caps it.
   */
  angularDamping: 0.98,
  /**
   * Heading error (radians) within which the attitude controller commands no
   * turn — the ship is considered on aim. ~0.6°, below visual notice, so
   * off-centre thruster torque or a residual fraction of a degree cannot make
   * the controller chatter the turn command around a settled heading.
   */
  angularDeadband: 0.01,
  /**
   * Mass of a single spawned projectile, in the same mass units as ship
   * modules. The recoil a firing ship feels is `m_p * v_p / M_ship` and
   * the impulse a target absorbs on hit is the same — a small fixed
   * projectile mass keeps the recoil visible (a stationary ship firing a
   * fast round kicks backward) without destabilising the movement model
   * for slow, heavy projectiles like torpedoes.
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
   * Innate visual line-of-sight radius (world units) every ship has before any
   * sensor module extends it. A ship with no sensor arrays can still see an
   * enemy that drifts inside this radius (the Mk-1 eyeball / short-range
   * passives), but nothing further. Sensor modules add their `detectionRange`
   * on top. Tuned below typical weapon ranges so a fleet without dedicated
   * sensors is genuinely myopic and must close to engage.
   */
  visualLosRadius: 140,
  /**
   * Multiplier applied to the non-immune part of a ship's effective sensor
   * radius inside a nebula. Matches the other nebula attenuation factors
   * (`nebulaRegenFactor`, `nebulaTrackingFactor`): the gas halves passive
   * detection range. `nebulaImmune` sensor bonuses bypass this entirely.
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
   * Base passive acquisition radius (world units): the reference range at which a
   * ship with no sensor uplift acquires an enemy carrying a stealth signature.
   * It is the multiplicand the target's `SignatureEffect.acquisitionMultiplier`
   * shrinks, and the range a sensor's `pierceCloak` flag is measured against —
   * not a hard map bound. A NON-STEALTH enemy (no cloak and no signature module)
   * is acquired regardless of distance, so this value never gates ordinary
   * targeting: existing fleets see exactly the same candidate sets as before
   * (determinism fixtures rely on this). It only takes effect once a target
   * carries a signature module (its range shrinks to `baseAcquireRange *
   * acquisitionMultiplier`) or a cloak (a pierce-cloak sensor must be within
   * this range, extended by its own `detectionRange`, to see it). The value is
   * comfortably larger than the deployment span (`2 * DEPLOY.edgeInset = 720`)
   * plus battle drift, so a signature-equipped ship at the far edge is still
   * acquirable until its multiplier pulls the range in.
   */
  baseAcquireRange: 2000,
  /**
   * Spacing (world units) between mines in a single mine-layer batch. The first
   * mine of a batch drops on the laying ship's centre; subsequent mines step out
   * in a deterministic ring at radii that are integer multiples of this spacing,
   * so a multi-mine batch is spread out rather than stacked on one point. No rng:
   * each mine's offset is a pure function of its index within the batch.
   */
  mineRingSpacing: 12,
  /**
   * Speed (world units per tick) of a boarding pod in flight toward its target.
   * A pod homes on its target each tick, stepping this far along the bearing to
   * the target's current position (clamped so it never overshoots). Pure
   * function of positions — no rng.
   */
  boardingPodSpeed: 6,
  /** Collision radius (world units) of a launched drone — small, fighter-sized. */
  droneRadius: 9,
  /** Collision radius (world units) of a decoy — a plausible ship-sized contact. */
  decoyRadius: 16,
  /** Lifetime (ticks) for a drone whose hangar sets no explicit lifetime: long
   *  enough that a drone persists for the whole battle unless shot down. */
  droneDefaultLifetime: 4000,
};

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
