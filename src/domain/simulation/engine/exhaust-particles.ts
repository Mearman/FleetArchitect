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
