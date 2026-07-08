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
 * The live plume as fixed-capacity parallel {@link Float64Array}s, updated IN
 * PLACE each tick. A particle is the six doubles at index `i` across `x`/`y`/
 * `vx`/`vy`/`intensity`/`age`; `[0, count)` is the live set and `count` replaces
 * `array.length` as the live bound. Stepping mutates the slots directly
 * (`x[i] += vx[i] * dt`) and compacts dead parcels with a forward write pointer
 * (order-preserving — survivors keep their relative order, which the frame
 * digest hashes), so the per-tick hot path allocates nothing for the surviving
 * set: no per-particle object spread, no fresh array, no `concat`/`slice`. Only
 * the tick's NEW emissions (a small per-source list) cross the object boundary
 * before being copied into the tail. Capacity is {@link MAX_LIVE_PARTICLES}.
 */
export interface ParticleStore {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly intensity: Float64Array;
  readonly age: Float64Array;
  /** Live particle count; the live set is slots `[0, count)`. */
  count: number;
}

/** Allocate an empty store at {@link MAX_LIVE_PARTICLES} capacity. */
export function createParticleStore(): ParticleStore {
  return {
    x: new Float64Array(MAX_LIVE_PARTICLES),
    y: new Float64Array(MAX_LIVE_PARTICLES),
    vx: new Float64Array(MAX_LIVE_PARTICLES),
    vy: new Float64Array(MAX_LIVE_PARTICLES),
    intensity: new Float64Array(MAX_LIVE_PARTICLES),
    age: new Float64Array(MAX_LIVE_PARTICLES),
    count: 0,
  };
}

/**
 * Build a store from plain particles (the checkpoint-restore boundary: a stored
 * checkpoint carries plain `{x,y,vx,vy,intensity,age}` records). Copies up to
 * {@link MAX_LIVE_PARTICLES} in iteration order — matching the prior
 * `slice(-MAX)` cap that was applied every tick before any capture, so the
 * restored live set is identical to what a running battle would have carried
 * into the same tick.
 */
export function particleStoreFromParticles(
  particles: readonly ExhaustParticle[],
): ParticleStore {
  const store = createParticleStore();
  const n = Math.min(particles.length, MAX_LIVE_PARTICLES);
  for (let i = 0; i < n; i += 1) {
    const p = particles[i];
    if (p === undefined) break;
    store.x[i] = p.x;
    store.y[i] = p.y;
    store.vx[i] = p.vx;
    store.vy[i] = p.vy;
    store.intensity[i] = p.intensity;
    store.age[i] = p.age;
  }
  store.count = n;
  return store;
}

/**
 * Materialise the live set as plain particles (the checkpoint-capture and
 * snapshot boundaries: both store and replay plain `{x,y,vx,vy,intensity,age}`
 * records). Iterates `[0, count)` in order so the result carries the live set
 * in its current iteration order — the order the frame digest hashes.
 */
export function particlesFromStore(store: ParticleStore): ExhaustParticle[] {
  const out: ExhaustParticle[] = [];
  for (let i = 0; i < store.count; i += 1) {
    out.push({
      x: store.x[i] ?? 0,
      y: store.y[i] ?? 0,
      vx: store.vx[i] ?? 0,
      vy: store.vy[i] ?? 0,
      intensity: store.intensity[i] ?? 0,
      age: store.age[i] ?? 0,
    });
  }
  return out;
}

/**
 * Advance every live particle by `dt` IN PLACE and cull those past their
 * lifetime, compacting survivors with a forward write pointer. A survivor at
 * read slot `r` is written to slot `w` (where `w <= r`, so the write never
 * clobbers an unread slot), preserving the survivors' relative order — the
 * order the frame digest hashes, so the compaction is byte-identical to the
 * prior "push survivors into a fresh array in order". `count` becomes the
 * survivor count. Same physics as the prior per-particle step: transport at
 * velocity, cool over the radiative timescale, age by `dt`; cull on the STEPPED
 * age (mirroring the prior `stepped.age < lifetime` check).
 */
export function stepParticleStore(store: ParticleStore, dt: number): void {
  const { x, y, vx, vy, intensity, age } = store;
  // Cool as it radiates: intensity fades over the cooling timescale. Computed
  // once per tick (dt is constant across the live set).
  const cooling = Math.exp(-dt / EXHAUST_COOLING_TIMESCALE_S);
  let w = 0;
  for (let r = 0; r < store.count; r += 1) {
    // Slots in [0, count) are always live (written before read), so the
    // `?? 0` narrows `noUncheckedIndexedAccess`'s `number | undefined` without
    // supplying a runtime default — the 0 never fires. Same convention as the
    // medium stepper's `rho[cell] ?? 0`.
    const xr = x[r] ?? 0;
    const yr = y[r] ?? 0;
    const vxr = vx[r] ?? 0;
    const vyr = vy[r] ?? 0;
    const ir = intensity[r] ?? 0;
    const ar = age[r] ?? 0;
    const na = ar + dt;
    if (na < EXHAUST_PARTICLE_LIFETIME_S) {
      x[w] = xr + vxr * dt;
      y[w] = yr + vyr * dt;
      vx[w] = vxr;
      vy[w] = vyr;
      intensity[w] = ir * cooling;
      age[w] = na;
      w += 1;
    }
  }
  store.count = w;
}

/**
 * Append one tick's new emissions to the store, dropping the OLDEST parcels when
 * the result would exceed capacity — byte-identical to the prior
 * `survivors.concat(emissions).slice(-MAX_LIVE_PARTICLES)`. The prior step left
 * `[0, count)` holding the survivors in order; this concatenates `emissions` at
 * the tail and, when over capacity, drops from the FRONT (the oldest survivors
 * first, then the oldest emissions in the degenerate `emissions > capacity`
 * case) via `copyWithin` — a stable in-place shift that preserves every kept
 * particle's relative order. New emissions always land at the tail.
 */
export function appendParticles(
  store: ParticleStore,
  emissions: readonly ExhaustParticle[],
): void {
  const { x, y, vx, vy, intensity, age } = store;
  const survivorCount = store.count;
  const emissionCount = emissions.length;
  const total = survivorCount + emissionCount;
  if (total <= MAX_LIVE_PARTICLES) {
    // Room for every emission: write them straight into the tail.
    let w = survivorCount;
    for (let i = 0; i < emissionCount; i += 1) {
      const p = emissions[i];
      if (p === undefined) break;
      x[w] = p.x;
      y[w] = p.y;
      vx[w] = p.vx;
      vy[w] = p.vy;
      intensity[w] = p.intensity;
      age[w] = p.age;
      w += 1;
    }
    store.count = w;
    return;
  }
  // Over capacity: drop the oldest `total - MAX` from the FRONT of the
  // conceptual `survivors ++ emissions` stream. Drops fall on survivors first
  // (they precede the emissions), then on the oldest emissions.
  const dropFront = total - MAX_LIVE_PARTICLES;
  const dropSurvivors = Math.min(dropFront, survivorCount);
  if (dropSurvivors > 0) {
    // Shift the kept survivors to the front (a stable memmove; the duplicated
    // tail beyond the new count is never read).
    x.copyWithin(0, dropSurvivors, survivorCount);
    y.copyWithin(0, dropSurvivors, survivorCount);
    vx.copyWithin(0, dropSurvivors, survivorCount);
    vy.copyWithin(0, dropSurvivors, survivorCount);
    intensity.copyWithin(0, dropSurvivors, survivorCount);
    age.copyWithin(0, dropSurvivors, survivorCount);
  }
  const keptSurvivors = survivorCount - dropSurvivors;
  const dropEmissions = dropFront - dropSurvivors;
  let w = keptSurvivors;
  for (let i = dropEmissions; i < emissionCount; i += 1) {
    const p = emissions[i];
    if (p === undefined) break;
    x[w] = p.x;
    y[w] = p.y;
    vx[w] = p.vx;
    vy[w] = p.vy;
    intensity[w] = p.intensity;
    age[w] = p.age;
    w += 1;
  }
  store.count = w;
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
  const out: ExhaustParticle[] = [];
  pushExhaustParticles(
    out,
    args.nozzleX,
    args.nozzleY,
    args.dirX,
    args.dirY,
    args.exhaustSpeed,
    args.throttle,
    args.energyJ,
  );
  return out;
}

/**
 * The emission core behind {@link emitExhaustParticles}: pushes the firing
 * nozzle's parcel(s) straight into `out` instead of allocating and returning a
 * throwaway array. Hot callers (the per-tick gather) share one running `out`
 * across every source. Identical arithmetic and field order to the prior
 * returned-array form — byte-identical output, no intermediate array.
 */
export function pushExhaustParticles(
  out: ExhaustParticle[],
  nozzleX: number,
  nozzleY: number,
  dirX: number,
  dirY: number,
  exhaustSpeed: number,
  throttle: number,
  energyJ: number,
): void {
  if (throttle <= 0) return;
  out.push({
    x: nozzleX,
    y: nozzleY,
    vx: dirX * exhaustSpeed,
    vy: dirY * exhaustSpeed,
    intensity: particleIntensityFromEnergy(energyJ, EXHAUST_ENERGY_HALFSAT_J),
    age: 0,
  });
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
  const out: ExhaustParticle[] = [];
  pushBeamChannelParticles(
    out,
    args.sourceX,
    args.sourceY,
    args.targetX,
    args.targetY,
    args.energyJ,
  );
  return out;
}

/**
 * The emission core behind {@link emitBeamChannelParticles}: pushes the channel
 * sample parcels straight into `out`. Same sampling, arithmetic, and order as
 * the prior returned-array form — byte-identical output, no throwaway array.
 */
export function pushBeamChannelParticles(
  out: ExhaustParticle[],
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  energyJ: number,
): void {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(len / BEAM_CHANNEL_SAMPLE_STEP_M));
  const intensity = particleIntensityFromEnergy(energyJ, BEAM_ENERGY_HALFSAT_J);
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    out.push({
      x: sourceX + dx * t,
      y: sourceY + dy * t,
      vx: 0,
      vy: 0,
      intensity,
      age: 0,
    });
  }
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
  const out: ExhaustParticle[] = [];
  pushProjectileWakeParticles(out, args.x, args.y, args.energyJ);
  return out;
}

/**
 * The emission core behind {@link emitProjectileWakeParticles}: pushes the wake
 * parcel straight into `out`. Identical arithmetic to the prior returned-array
 * form — byte-identical output, no throwaway array.
 */
export function pushProjectileWakeParticles(
  out: ExhaustParticle[],
  x: number,
  y: number,
  energyJ: number,
): void {
  out.push({
    x,
    y,
    vx: 0,
    vy: 0,
    intensity: particleIntensityFromEnergy(energyJ, WAKE_ENERGY_HALFSAT_J),
    age: 0,
  });
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
  const out: ExhaustParticle[] = [];
  pushImpactBurstParticles(out, args.x, args.y, args.energyJ);
  return out;
}

/**
 * The emission core behind {@link emitImpactBurstParticles}: pushes the radial
 * burst parcels straight into `out`. Identical angles, speed, and order to the
 * prior returned-array form — byte-identical output, no throwaway array.
 */
export function pushImpactBurstParticles(
  out: ExhaustParticle[],
  x: number,
  y: number,
  energyJ: number,
): void {
  const n = IMPACT_BURST_PARTICLE_COUNT;
  const intensity = particleIntensityFromEnergy(energyJ, IMPACT_ENERGY_HALFSAT_J);
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2;
    out.push({
      x,
      y,
      vx: Math.cos(angle) * IMPACT_BURST_SPEED_M_PER_S,
      vy: Math.sin(angle) * IMPACT_BURST_SPEED_M_PER_S,
      intensity,
      age: 0,
    });
  }
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
