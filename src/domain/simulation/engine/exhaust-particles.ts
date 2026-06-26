// Exhaust-plume particles: the visible "energetic material" a firing engine
// throws into space. Each particle is real transported matter — a position, a
// velocity (the exhaust velocity, in the exhaust direction), and an energy it
// radiates as it cools. Driven up by tests in
// `engine.exhaust-particles.unit.test.ts`, smallest behaviour first.

/**
 * Radiative cooling timescale for an exhaust particle, seconds. A parcel of hot
 * propellant radiates its heat away as it expands into vacuum; over this
 * timescale its energy (and so its glow) fades to 1/e. Authored: a plume reads
 * as a bright stream near the nozzle fading to nothing a couple of seconds back.
 */
export const EXHAUST_COOLING_TIMESCALE_S = 2;

/**
 * One exhaust particle: a small parcel of hot, fast propellant moving through
 * space. `energy` is what it radiates (it dims as it cools); `vx`/`vy` carry it
 * away from the nozzle at the exhaust velocity.
 */
export interface ExhaustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  /** Seconds since emission; the lifetime cull signal (energy decays
   *  asymptotically, so age bounds how long a parcel is kept). */
  age: number;
}

/**
 * Advance one exhaust particle by `dt`: it transports at its velocity (the
 * defining behaviour — material leaves the source, it does not pool). Pure:
 * returns a fresh particle, input untouched, so the step is deterministic.
 */
export function stepExhaustParticle(
  p: ExhaustParticle,
  dt: number,
): ExhaustParticle {
  return {
    ...p,
    x: p.x + p.vx * dt,
    y: p.y + p.vy * dt,
    // Cool as it radiates: energy fades over the cooling timescale.
    energy: p.energy * Math.exp(-dt / EXHAUST_COOLING_TIMESCALE_S),
    age: p.age + dt,
  };
}

/**
 * Emit exhaust particles for one firing nozzle over `dt`. Each particle leaves
 * the nozzle at the exhaust speed in the exhaust direction, carrying the jet
 * energy deposited this tick (what it will radiate as it cools).
 */
export function emitExhaustParticles(args: {
  nozzleX: number;
  nozzleY: number;
  dirX: number;
  dirY: number;
  exhaustSpeed: number;
  throttle: number;
  jetPower: number;
  dt: number;
}): ExhaustParticle[] {
  if (args.throttle <= 0) return [];
  return [
    {
      x: args.nozzleX,
      y: args.nozzleY,
      vx: args.dirX * args.exhaustSpeed,
      vy: args.dirY * args.exhaustSpeed,
      energy: args.jetPower * args.dt,
      age: 0,
    },
  ];
}

/**
 * Particle lifetime, seconds. A parcel is kept until it has cooled to ~5 % of
 * its emitted energy (3 cooling timescales: exp(-3) ≈ 0.05), then culled so the
 * live set stays bounded. Energy decays asymptotically, so age — not energy —
 * is the clean cull signal.
 */
export const EXHAUST_PARTICLE_LIFETIME_S = 3 * EXHAUST_COOLING_TIMESCALE_S;

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

/**
 * Spacing of particles sampled along a beam channel, metres. Dense enough that
 * the rendered blobs read as a continuous glowing line.
 */
export const BEAM_CHANNEL_SAMPLE_STEP_M = 100;

/**
 * Emit particles along a beam's source-to-target channel. A beam is hitscan:
 * its ionised channel glows WHERE THE BEAM IS, so the particles sit on the line
 * (stationary) and decay, rather than streaming off like exhaust. Sampled at
 * {@link BEAM_CHANNEL_SAMPLE_STEP_M} so a long strike reads as a continuous
 * channel, a short one as a single hot spot.
 */
export function emitBeamChannelParticles(args: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  beamPower: number;
  dt: number;
}): ExhaustParticle[] {
  const dx = args.targetX - args.sourceX;
  const dy = args.targetY - args.sourceY;
  const len = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(len / BEAM_CHANNEL_SAMPLE_STEP_M));
  const out: ExhaustParticle[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    out.push({
      x: args.sourceX + dx * t,
      y: args.sourceY + dy * t,
      vx: 0,
      vy: 0,
      energy: args.beamPower * args.dt,
      age: 0,
    });
  }
  return out;
}

/**
 * Emit the wake a projectile leaves at its current position: the medium a fast
 * round just punched through, heated and glowing. Near-stationary (the medium
 * does not carry the round's velocity) and low-energy; deposited each tick at
 * the round's position, so a moving round leaves a fading trail of wakes.
 */
export function emitProjectileWakeParticles(args: {
  x: number;
  y: number;
  wakePower: number;
  dt: number;
}): ExhaustParticle[] {
  return [
    {
      x: args.x,
      y: args.y,
      vx: 0,
      vy: 0,
      energy: args.wakePower * args.dt,
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
 * sharing the strike's energy, then cool as they fly out.
 */
export function emitImpactBurstParticles(args: {
  x: number;
  y: number;
  energy: number;
  dt: number;
}): ExhaustParticle[] {
  const n = IMPACT_BURST_PARTICLE_COUNT;
  const perParticle = (args.energy * args.dt) / n;
  const out: ExhaustParticle[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2;
    out.push({
      x: args.x,
      y: args.y,
      vx: Math.cos(angle) * IMPACT_BURST_SPEED_M_PER_S,
      vy: Math.sin(angle) * IMPACT_BURST_SPEED_M_PER_S,
      energy: perParticle,
      age: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-tick gather (the engine ticks this once, in fixed order, for determinism)
// ---------------------------------------------------------------------------

/** Beam-channel glow power proxy, W. `SimBeam` carries no power field, so the
 *  channel uses a constant intensity tuned for a clear glowing line. */
export const BEAM_CHANNEL_POWER_W = 1e6;

/** Projectile-wake glow power proxy, W. A wake is faint; a small constant. */
export const PROJECTILE_WAKE_POWER_W = 1e3;

/** One firing nozzle's exhaust, extracted from a SimShip engine module. Fields
 *  mirror {@link emitExhaustParticles} (minus `dt`, supplied by the gather). */
export interface ParticleThrusterSource {
  nozzleX: number;
  nozzleY: number;
  dirX: number;
  dirY: number;
  exhaustSpeed: number;
  throttle: number;
  jetPower: number;
}

/** One active beam's channel, extracted from a SimBeam. */
export interface ParticleBeamSource {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

/** One projectile's wake sample, extracted from a SimProjectile. */
export interface ParticleProjectileSource {
  x: number;
  y: number;
}

/** One impact/strike point, extracted from a beam target or projectile hit. */
export interface ParticleImpactSource {
  x: number;
  y: number;
  energy: number;
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
    out.push(...emitBeamChannelParticles({ ...b, beamPower: BEAM_CHANNEL_POWER_W, dt }));
  }
  for (const p of sources.projectiles) {
    out.push(...emitProjectileWakeParticles({ ...p, wakePower: PROJECTILE_WAKE_POWER_W, dt }));
  }
  for (const i of sources.impacts) {
    out.push(...emitImpactBurstParticles({ ...i, dt }));
  }
  return out;
}
