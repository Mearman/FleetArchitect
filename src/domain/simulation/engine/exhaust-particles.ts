// Exhaust/plume particles: the visible "energetic material" a firing weapon
// throws into space — engine exhaust, a beam's ionised channel, a projectile
// wake, impact ejecta. Each particle is real transported matter (a position, a
// velocity, a glow intensity) that moves and dims as it cools. The renderer
// draws the live set as glow; where the particles actually are is what shines.
// Driven up by tests in `engine.exhaust-particles.unit.test.ts`.

/** Radiative cooling timescale, seconds. A parcel's glow fades to 1/e over this
 *  time as it radiates its heat into vacuum. Authored: a plume reads bright near
 *  the source, fading to nothing a couple of seconds back. */
export const EXHAUST_COOLING_TIMESCALE_S = 2;

/** Half-saturation energy per source, Joules: the real emitted energy at which a
 *  fresh parcel glows at intensity 0.5 on the saturating curve below. Set per
 *  source because the physical energies are ~6 orders of magnitude apart (a
 *  thruster's per-tick jet energy ~2e7–3e8 J, beam/impact damage per hit
 *  ~1e7–1.6e9 J, projectile kinetic energy ~8e6–8.6e9 J) — a single half-sat
 *  could not put both a thruster and a wake in a legible brightness range.
 *  Starting anchors derived from catalogue magnitudes; a later stage tunes them
 *  visually. */
export const EXHAUST_ENERGY_HALFSAT_J = 5e7;
export const BEAM_ENERGY_HALFSAT_J = 3e8;
export const WAKE_ENERGY_HALFSAT_J = 5e7;
export const IMPACT_ENERGY_HALFSAT_J = 3e8;

/**
 * Map a source's real emitted energy (Joules) to a normalised [0, 1] glow
 * intensity via a saturating (Michaelis–Menten-style) response,
 * `energyJ / (energyJ + halfSatJ)` — the same eps/(eps + halfSat) shape as
 * `mediumCellIntensity`, minus the density/gain terms (applied later, in the
 * renderer). Each source passes its own `halfSatJ` so sources whose real
 * energies span several orders of magnitude (a thruster's jet power vs a wake's
 * kinetic energy) both land in a legible range: at `energyJ === halfSatJ` the
 * intensity is 0.5, tending to 1 as energy grows and to 0 as it vanishes. Pure.
 */
export function particleIntensityFromEnergy(energyJ: number, halfSatJ: number): number {
  if (energyJ <= 0) return 0;
  return energyJ / (energyJ + halfSatJ);
}

/**
 * One particle: a parcel of glowing material moving through space. `intensity`
 * is its normalised glow (dims as it cools); `vx`/`vy` carry it at the source's
 * velocity (exhaust streams, impact ejecta flies out, beam/wake sit still);
 * `age` is the lifetime cull signal.
 */
export interface ExhaustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Normalised glow intensity [0, 1]; decays with cooling. */
  intensity: number;
  /** Seconds since emission; the lifetime cull signal. */
  age: number;
}

/**
 * Advance one particle by `dt`: it transports at its velocity (the defining
 * behaviour — material leaves the source, it does not pool), cools (intensity
 * fades), and ages. Pure: returns a fresh particle, input untouched.
 */
export function stepExhaustParticle(
  p: ExhaustParticle,
  dt: number,
): ExhaustParticle {
  return {
    ...p,
    x: p.x + p.vx * dt,
    y: p.y + p.vy * dt,
    // Cool as it radiates: intensity fades over the cooling timescale.
    intensity: p.intensity * Math.exp(-dt / EXHAUST_COOLING_TIMESCALE_S),
    age: p.age + dt,
  };
}

/**
 * Emit exhaust particles for one firing nozzle over `dt`. Each particle leaves
 * the nozzle at the exhaust speed in the exhaust direction. Intensity is driven
 * by `energyJ`, the parcel's real jet energy (throttle is already baked into
 * that energy by the caller, so it is NOT reapplied here); the throttle gate
 * means a non-firing engine emits nothing.
 */
export function emitExhaustParticles(args: {
  nozzleX: number;
  nozzleY: number;
  dirX: number;
  dirY: number;
  exhaustSpeed: number;
  throttle: number;
  energyJ: number;
  dt: number;
}): ExhaustParticle[] {
  if (args.throttle <= 0) return [];
  return [
    {
      x: args.nozzleX,
      y: args.nozzleY,
      vx: args.dirX * args.exhaustSpeed,
      vy: args.dirY * args.exhaustSpeed,
      intensity: particleIntensityFromEnergy(args.energyJ, EXHAUST_ENERGY_HALFSAT_J),
      age: 0,
    },
  ];
}

/**
 * Particle lifetime, seconds. A parcel is kept until its glow has faded to ~5 %
 * (3 cooling timescales: exp(-3) ≈ 0.05), then culled so the live set stays
 * bounded. Intensity decays asymptotically, so age — not intensity — is the
 * clean cull signal.
 */
export const EXHAUST_PARTICLE_LIFETIME_S = 3 * EXHAUST_COOLING_TIMESCALE_S;

/**
 * Cap on the live particle count, bounding memory for long battles. The snapshot
 * stores the live set per subsampled frame; without a cap, a long weapon-heavy
 * battle accumulates so many particles (sustained thrusters, beam channels,
 * impact bursts every tick) that frames × count exhausts the heap. When the cap
 * is exceeded the OLDEST parcels are dropped (the dim tail of cooling plumes;
 * the bright fresh heads near each weapon are kept), so the bound is
 * deterministic — slice from the end in fixed gather order.
 */
export const MAX_LIVE_PARTICLES = 1000;

/**
 * Step every particle (transport + cool + age) and cull those past their
 * lifetime. Pure: returns a fresh array, input untouched. The engine calls this
 * over the whole live plume each tick, then concatenates the tick's new
 * emissions.
 */
export function stepExhaustParticles(
  particles: readonly ExhaustParticle[],
  dt: number,
): ExhaustParticle[] {
  const out: ExhaustParticle[] = [];
  for (const p of particles) {
    const stepped = stepExhaustParticle(p, dt);
    if (stepped.age < EXHAUST_PARTICLE_LIFETIME_S) out.push(stepped);
  }
  return out;
}

/** Spacing of particles sampled along a beam channel, metres. Dense enough that
 *  the rendered blobs read as a continuous glowing line. */
export const BEAM_CHANNEL_SAMPLE_STEP_M = 100;

/**
 * Emit particles along a beam's source-to-target channel. A beam is hitscan:
 * its ionised channel glows WHERE THE BEAM IS, so the particles sit on the line
 * (stationary) and cool, rather than streaming off like exhaust. Sampled at
 * {@link BEAM_CHANNEL_SAMPLE_STEP_M} so a long strike reads as a continuous
 * channel, a short one as a single hot spot.
 */
export function emitBeamChannelParticles(args: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  energyJ: number;
  dt: number;
}): ExhaustParticle[] {
  const dx = args.targetX - args.sourceX;
  const dy = args.targetY - args.sourceY;
  const len = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(len / BEAM_CHANNEL_SAMPLE_STEP_M));
  const intensity = particleIntensityFromEnergy(args.energyJ, BEAM_ENERGY_HALFSAT_J);
  const out: ExhaustParticle[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    out.push({
      x: args.sourceX + dx * t,
      y: args.sourceY + dy * t,
      vx: 0,
      vy: 0,
      intensity,
      age: 0,
    });
  }
  return out;
}

/**
 * Emit the wake a projectile leaves at its current position: the medium a fast
 * round just punched through, heated and glowing. Near-stationary (the medium
 * does not carry the round's velocity) and faint; deposited each tick at the
 * round's position, so a moving round leaves a fading trail of wakes.
 */
export function emitProjectileWakeParticles(args: {
  x: number;
  y: number;
  energyJ: number;
  dt: number;
}): ExhaustParticle[] {
  return [
    {
      x: args.x,
      y: args.y,
      vx: 0,
      vy: 0,
      intensity: particleIntensityFromEnergy(args.energyJ, WAKE_ENERGY_HALFSAT_J),
      age: 0,
    },
  ];
}

/** Number of particles in an impact burst. Enough to read as a radial flash. */
export const IMPACT_BURST_PARTICLE_COUNT = 8;

/** Speed at which impact ejecta flies outward, m·s⁻¹. Authored: hot fragments
 *  thrown from a strike, faster than a wake but slower than exhaust. */
export const IMPACT_BURST_SPEED_M_PER_S = 800;

/**
 * Emit an impact burst: when a beam or projectile strikes, hot ejecta radiates
 * outward from the strike point. The particles spread at evenly spaced angles
 * (deterministic — fixed angles, no RNG) at {@link IMPACT_BURST_SPEED_M_PER_S},
 * then cool as they fly out.
 */
export function emitImpactBurstParticles(args: {
  x: number;
  y: number;
  energyJ: number;
  dt: number;
}): ExhaustParticle[] {
  const n = IMPACT_BURST_PARTICLE_COUNT;
  const intensity = particleIntensityFromEnergy(args.energyJ, IMPACT_ENERGY_HALFSAT_J);
  const out: ExhaustParticle[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2;
    out.push({
      x: args.x,
      y: args.y,
      vx: Math.cos(angle) * IMPACT_BURST_SPEED_M_PER_S,
      vy: Math.sin(angle) * IMPACT_BURST_SPEED_M_PER_S,
      intensity,
      age: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-tick gather (the engine ticks this once, in fixed order, for determinism)
// ---------------------------------------------------------------------------

/** One firing nozzle's exhaust, extracted from a SimShip engine module. Fields
 *  mirror {@link emitExhaustParticles} (minus `dt`, supplied by the gather). */
export interface ParticleThrusterSource {
  nozzleX: number;
  nozzleY: number;
  dirX: number;
  dirY: number;
  exhaustSpeed: number;
  throttle: number;
  /** Real per-tick jet energy, Joules (throttle already baked in). */
  energyJ: number;
}

/** One active beam's channel, extracted from a SimBeam. */
export interface ParticleBeamSource {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  /** Real beam energy applied this strike, Joules (SimBeam.damageJ). */
  energyJ: number;
}

/** One projectile's wake sample, extracted from a SimProjectile. */
export interface ParticleProjectileSource {
  x: number;
  y: number;
  /** Round's kinetic energy, Joules (½·m·v²). */
  energyJ: number;
}

/** One impact/strike point, extracted from a beam target or projectile hit. */
export interface ParticleImpactSource {
  x: number;
  y: number;
  /** Real energy dumped at the strike point, Joules (SimBeam.damageJ). */
  energyJ: number;
}

/** The tick's particle sources: the engine extracts these slim structs from the
 *  SimShip/SimBeam/SimProjectile state in fixed order, then the gather emits. */
export interface ParticleSources {
  thrusters: readonly ParticleThrusterSource[];
  beams: readonly ParticleBeamSource[];
  projectiles: readonly ParticleProjectileSource[];
  impacts: readonly ParticleImpactSource[];
}

/**
 * Gather one tick's new particles from every weapon source, concatenated in
 * fixed order (thrusters, then beams, then projectile wakes, then impact
 * bursts) so the result is deterministic — no RNG, array order only. Pure: the
 * engine extracts the sources from live state each tick and passes them in.
 */
export function gatherParticles(
  sources: ParticleSources,
  dt: number,
): ExhaustParticle[] {
  const out: ExhaustParticle[] = [];
  for (const t of sources.thrusters) {
    out.push(...emitExhaustParticles({ ...t, dt }));
  }
  for (const b of sources.beams) {
    out.push(...emitBeamChannelParticles({ ...b, dt }));
  }
  for (const p of sources.projectiles) {
    out.push(...emitProjectileWakeParticles({ ...p, dt }));
  }
  for (const i of sources.impacts) {
    out.push(...emitImpactBurstParticles({ ...i, dt }));
  }
  return out;
}
