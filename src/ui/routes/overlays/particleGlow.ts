import { fxGainFor, paletteSample, readFxLevel } from "./mediumShared";
import type { BattleFrame, ParticleSnapshot } from "@/schema/battle";
import type { OverlayCtx, OverlayDef } from "./types";

// ---------------------------------------------------------------------------
// Weapon-source particle glow: the visible transferred material (foveated)
// ---------------------------------------------------------------------------
//
// Draws the live exhaust/plume particles the deterministic engine ticks into
// BattleFrame.particles — engine exhaust streams, beam ionisation channels,
// projectile wakes, and impact ejecta. Each particle is real moving material
// that radiates as it cools, so the glow reads as emerging from the weapons
// (a stream leaving a thrusting engine, a flash at a strike point) rather than
// a field layered on top. Where the particles actually are is what shines.
//
// Each particle is a fresh radial gradient, so a weapon-heavy battle (up to
// MAX_LIVE_PARTICLES) is expensive. To stay affordable the rendered DENSITY is
// content-adaptive: full where the particle-energy field has high local spatial
// VARIANCE — the transitions the eye keys on (cluster edges, a plume's leading
// edge, fresh impacts, beam channels) — and sparse where it is uniform (flat
// cloud interiors, empty space), where overlapping blobs still read as a
// continuous glow even when most are dropped. Density is decided per cell of a
// coarse screen grid; within a cell the survivors are chosen by a stable
// per-particle key, so a region thins smoothly as it goes uniform without
// individuals popping in and out.
//
// Drawn beneath the ship layer so hulls sit on top of their own exhaust.

/** Display radius of a particle's glow blob, pixels at full intensity. Scales
 *  down with intensity so a cooling parcel shrinks as it dims. */
const PARTICLE_RADIUS_PX = 7;

/** Particles dimmer than this are skipped, bounding the paint count. */
const PARTICLE_DRAW_THRESHOLD = 0.02;

// ---------------------------------------------------------------------------
// Foveated density: keep particles where the energy field VARIES
// ---------------------------------------------------------------------------
//
// The canvas is divided into a GRID_CELLS × GRID_CELLS grid (one cell per
// screen region). Each cell's ENERGY is the sum of its particles' intensities;
// each cell's KEEP PROBABILITY is driven by the spatial VARIANCE of that energy
// over its 3×3 neighbourhood (high where energy transitions — the structure the
// eye reads — low where it is uniform), normalised by the frame's max so the
// threshold adapts to how busy the scene is. Particles in low-variance cells are
// subsampled away; the survivors are chosen by a stable per-particle key
// (particleKeepKey), so the thinning is steady rather than flickery. Off-screen
// particles are culled entirely.

/** Grid resolution per screen axis. Coarse enough that the variance is stable,
 *  fine enough to localise transitions. */
const GRID_CELLS = 32;
const GRID_SIZE = GRID_CELLS * GRID_CELLS;

/** Minimum keep probability — in the most uniform/empty cells. Overlapping blobs
 *  there still read as a continuous glow, so most can be dropped. */
const FOVEA_FLOOR = 0.15;

/** Normalised-variance ramp endpoints: at/below VAR_LOW → floor, at/above
 *  VAR_HIGH → full density, linear between. */
const VAR_LOW = 0.08;
const VAR_HIGH = 0.35;

/** Below this max variance the whole field is treated as uniform (no transitions
 *  to preserve) and thinned to the floor everywhere. */
const VARIANCE_EPS = 1e-9;

/** Per-frame scratch, indexed `cj * GRID_CELLS + ci`. `energyGrid` holds cell
 *  energy during pass 1 (zeroed each draw); `keepProbGrid` holds cell
 *  keep-probability during pass 2 (fully overwritten). Reused across frames. */
const energyGrid = new Float64Array(GRID_SIZE);
const keepProbGrid = new Float64Array(GRID_SIZE);

/**
 * Deterministic [0, 1) keep-key for one particle, hashed from its
 * lifetime-stable invariants: the exact spawn point `(x − vx·age, y − vy·age)`
 * — velocity is constant (`stepExhaustParticle` transports ballistically, with
 * no drag), so this is an exact invariant that never changes across the
 * particle's life — plus its velocity `(vx, vy)`. Distinct emissions have
 * distinct spawn points/velocities (one particle per nozzle per tick; beam
 * samples spaced along the line; impact-burst siblings share a spawn but differ
 * in velocity), so no two particles share a key. The result: the subsample is
 * flicker-free (a survivor stays one until its cell's keep-probability drops
 * below its key) and free of clumping, while remaining a pure function of
 * per-frame state (scrub-consistent).
 */
function particleKeepKey(
  x: number,
  y: number,
  vx: number,
  vy: number,
  age: number,
): number {
  const spawnX = Math.round(x - vx * age) | 0;
  const spawnY = Math.round(y - vy * age) | 0;
  const ux = Math.round(vx) | 0;
  const uy = Math.round(vy) | 0;
  let h = Math.imul(spawnX ^ ux, 374761393);
  h = Math.imul(h ^ spawnY, 668265263);
  h = Math.imul(h ^ uy, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Resolve the live particle set for `tick` from the discrete frame history: the
 * most recent emission at-or-before this tick. Particles are subsampled in the
 * snapshot (every RESOURCE_EVERY ticks) so a long battle does not exhaust the
 * heap, and the renderer holds the most recent emission between subsamples (as
 * the medium overlay does) so the glow stays continuous. Pure function of
 * (frames, tick) — deterministic, scrub-safe in both directions.
 */
function resolveParticles(
  frames: readonly BattleFrame[],
  tick: number,
): ParticleSnapshot[] | undefined {
  const start = Math.min(Math.max(0, Math.floor(tick)), frames.length - 1);
  for (let i = start; i >= 0; i -= 1) {
    const f = frames[i];
    if (f === undefined) continue;
    if (f.particles !== undefined && f.particles.length > 0) return f.particles;
  }
  return undefined;
}

/**
 * Particle glow: one additive radial-gradient blob per live particle that
 * survives the energy-variance density filter, coloured by the shared hot palette
 * at its (FX-scaled) intensity and sized by it, so a fresh parcel reads bright
 * and large and a cooling one dim and small. See the file header for the
 * foveated-density rationale.
 */
function drawParticleGlow(c: OverlayCtx): void {
  const { ctx, t, tick, frames } = c;

  const fx = readFxLevel();
  if (fx === "off") return;
  const fxGain = fxGainFor(fx);

  // Particles are subsampled in the snapshot (every RESOURCE_EVERY ticks); the
  // interpolated `frame` also strips them on half-ticks. Resolve the nearest
  // emission so the glow renders every rAF without flicker.
  const particles = resolveParticles(frames, tick);
  if (particles === undefined || particles.length === 0) return;

  const width = t.width;
  const height = t.height;
  const cellW = width / GRID_CELLS;
  const cellH = height / GRID_CELLS;

  // Pass 1 — bin on-screen, above-threshold particles into the energy grid and
  // stash their screen position, intensity, cell, and stable keep-key for pass 2.
  // Off-screen particles are culled here: they would otherwise waste a fresh
  // radial gradient + fill entirely outside the canvas.
  energyGrid.fill(0);
  const visible: {
    sx: number;
    sy: number;
    intensity: number;
    cell: number;
    key: number;
  }[] = [];
  const screen = { x: 0, y: 0 };
  for (const p of particles) {
    const intensity = Math.max(0, Math.min(1, p.intensity * fxGain));
    if (intensity < PARTICLE_DRAW_THRESHOLD) continue;
    t.projectInto(screen, p.x, p.y);
    const sx = screen.x;
    const sy = screen.y;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
    const ci = Math.floor(sx / cellW);
    const cj = Math.floor(sy / cellH);
    const cell = cj * GRID_CELLS + ci;
    energyGrid[cell] = energyGrid[cell]! + intensity;
    visible.push({
      sx,
      sy,
      intensity,
      cell,
      key: particleKeepKey(p.x, p.y, p.vx, p.vy, p.age),
    });
  }
  if (visible.length === 0) return;

  // Per-cell spatial variance of energy over the clamped 3×3 neighbourhood, then
  // a keep-probability per cell. Normalised by the frame's max variance so the
  // ramp adapts to how busy the scene is.
  let vMax = 0;
  for (let cj = 0; cj < GRID_CELLS; cj += 1) {
    const j0 = cj > 0 ? cj - 1 : 0;
    const j1 = cj < GRID_CELLS - 1 ? cj + 1 : cj;
    for (let ci = 0; ci < GRID_CELLS; ci += 1) {
      const i0 = ci > 0 ? ci - 1 : 0;
      const i1 = ci < GRID_CELLS - 1 ? ci + 1 : ci;
      let sum = 0;
      let sumSq = 0;
      for (let nj = j0; nj <= j1; nj += 1) {
        for (let ni = i0; ni <= i1; ni += 1) {
          const e = energyGrid[nj * GRID_CELLS + ni]!;
          sum += e;
          sumSq += e * e;
        }
      }
      const n = (j1 - j0 + 1) * (i1 - i0 + 1);
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      keepProbGrid[cj * GRID_CELLS + ci] = variance;
      if (variance > vMax) vMax = variance;
    }
  }
  if (vMax < VARIANCE_EPS) {
    // Uniform field — no transitions to preserve; thin to the floor everywhere.
    keepProbGrid.fill(FOVEA_FLOOR);
  } else {
    const span = VAR_HIGH - VAR_LOW;
    for (let k = 0; k < GRID_SIZE; k += 1) {
      const nv = keepProbGrid[k]! / vMax;
      const ramp = nv <= VAR_LOW ? 0 : nv >= VAR_HIGH ? 1 : (nv - VAR_LOW) / span;
      keepProbGrid[k] = FOVEA_FLOOR + (1 - FOVEA_FLOOR) * ramp;
    }
  }

  // Pass 2 — render the survivors. A particle is kept iff its stable key is below
  // its cell's keep-probability, so a region thins smoothly as it becomes uniform
  // and re-densifies as structure appears, without individuals popping.
  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive: glow brightens space

  for (const v of visible) {
    if (v.key >= keepProbGrid[v.cell]!) continue;
    const [r, g, b] = paletteSample(v.intensity);
    const radius = PARTICLE_RADIUS_PX * (0.4 + 0.6 * v.intensity);
    const alphaCore = Math.min(1, v.intensity * 1.2);

    const grad = ctx.createRadialGradient(v.sx, v.sy, 0, v.sx, v.sy, radius);
    grad.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${alphaCore})`);
    grad.addColorStop(0.5, `rgba(${r | 0},${g | 0},${b | 0},${v.intensity * 0.4})`);
    grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(v.sx, v.sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Overlay definition: weapon-source particle glow (exhaust, plumes, channels,
 *  impacts), drawn beneath the ship layer. On by default so strikes and exhaust
 *  are visible — the broad medium glow is too coarse (500 m/cell) to resolve
 *  them. FX-gated (off/reduced/full) and the live set is capped
 *  (MAX_LIVE_PARTICLES), so the cost is bounded. */
export const particleGlow: OverlayDef = {
  id: "particle-glow",
  label: "Weapon particles (exhaust / plumes / impacts)",
  defaultOn: true,
  defaultScope: "all",
  draw: drawParticleGlow,
};
