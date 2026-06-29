import type { Transform } from "./battleCamera";
import { screenToWorld } from "./battleCamera";
import { BASE_PANEL, BASE_VOID } from "@/ui/theme/tokens";

/** Grid spacing in world units for the parallax background grid. */
const GRID_WORLD_SPACING = 100;

/** World spacing of the starfield lattice, metres. One star sits in each cell at
 *  a deterministic offset, so the field is fixed in world space (it pans and
 *  zooms with the camera) rather than being distributed across the battle bounds
 *  — distributing across bounds made every star shift and stretch while the
 *  bounds grew during buffering. */
const STAR_CELL_WORLD = 70;

/** Caps so a zoomed-far-out view does not iterate a huge lattice. The grid
 *  stops drawing past this many lines per axis; the starfield stops past this
 *  many DRAWN stars (STAR_CELL_CAP) or this many iterated cells
 *  (STAR_CELL_MAX_ITER). */
const GRID_LINE_CAP = 240;
/** Maximum starfield cells to iterate per frame. Past this the starfield is
 *  not drawn, bounding the per-cell hash cost. Set high (2 M ≈ a 140 km view at
 *  70 m pitch) because the hash is now a cheap integer mix, not a sin — so the
 *  realistic full zoom-out (the camera's 0.25× framing floor ≈ a few hundred
 *  thousand cells) iterates in ~1 ms and the stars stay visible at any zoom. */
const STAR_CELL_MAX_ITER = 2_000_000;
/** Maximum stars DRAWN per frame. The fixed lattice is density-thinned (each
 *  star draws iff its visibility hash passes a threshold) so the drawn count
 *  stays under this — uniform thinning, no regular grid, stars never move. */
const STAR_CELL_CAP = 2400;
/** Fraction of the visible visibility-hash range over which a star's alpha
 *  ramps (smoothstep) as the density threshold sweeps across it on zoom — stars
 *  fade in/out organically instead of popping. RELATIVE to the density (not an
 *  absolute band): the brightest stars (hash well below the threshold) stay
 *  full-brightness at ANY zoom, and only the threshold-near fraction fades. An
 *  absolute band crushed every star to near-zero alpha at low density (full
 *  zoom-out), hiding the field. */
const STAR_FADE_FRAC = 0.3;

/** Deterministic unit float for lattice cell (ix, iy), variant k. A cheap
 *  integer bit-mixing hash (avalanche finaliser, no trig) rather than the
 *  sin-based `hash01`: the starfield iterates this per visible cell, and a
 *  sin-free hash lets a large zoomed-out view (hundreds of thousands of cells)
 *  iterate in ~1 ms so stars stay on screen at any zoom. Same (ix, iy, k) →
 *  same value, so each star is still pinned to a fixed world position. */
function cellHash(ix: number, iy: number, k: number): number {
  let h = Math.imul(ix | 0, 73856093) ^ Math.imul(iy | 0, 19349663) ^ Math.imul(k | 0, 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Vertical base gradient, cached across frames. It depends only on the canvas
// height, so it is rebuilt only on resize (and on a canvas remount, which yields
// a fresh context). Recreating a linear gradient every frame is needless setup.
let baseGradientCache: {
  ctx: CanvasRenderingContext2D;
  height: number;
  grad: CanvasGradient;
} | null = null;

function baseGradient(ctx: CanvasRenderingContext2D, height: number): CanvasGradient {
  if (
    baseGradientCache !== null &&
    baseGradientCache.ctx === ctx &&
    baseGradientCache.height === height
  ) {
    return baseGradientCache.grad;
  }
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, BASE_PANEL);
  grad.addColorStop(1, BASE_VOID);
  baseGradientCache = { ctx, height, grad };
  return grad;
}

/**
 * Draw the canvas backdrop beneath everything else: a vertical base gradient,
 * a world-space grid, and a deterministic starfield. Both the grid and the
 * starfield live on fixed world lattices covering the visible region, so they
 * stay put in world space (parallaxing with the camera) instead of being keyed
 * to the battle bounds — which grow as frames stream in, and would otherwise
 * make the whole backdrop drift and stretch while the simulation buffers. The
 * starfield uses hash01 (a pure integer→unit float hash) rather than
 * Math.random/Date.now so replays stay byte-identical.
 *
 * Grid and stars are placed through the transform's projection, so they tilt
 * with the isometric view (each gridline is drawn as a projected segment along
 * the screen diagonal) and stay axis-aligned under the flat view.
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: Transform,
): void {
  // 1. Base gradient — prevents the page background from bleeding through.
  ctx.fillStyle = baseGradient(ctx, height);
  ctx.fillRect(0, 0, width, height);

  // Visible world rectangle for the current transform. Under a tilted
  // projection the on-screen rectangle maps to a diamond in world space, so the
  // world extent is the bounding box of the four unprojected screen corners
  // (for the flat projection this collapses to the plain centre ± half-extent).
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [cx, cy] of corners) {
    const w = screenToWorld(t, cx, cy);
    left = Math.min(left, w.x);
    right = Math.max(right, w.x);
    top = Math.min(top, w.y);
    bottom = Math.max(bottom, w.y);
  }

  // 2. World grid on a fixed lattice — lines at fixed world positions, so they
  //    never move as the bounds grow. Each gridline is drawn as a projected
  //    segment between its two endpoints on the visible world rect, so it runs
  //    along the screen diagonal under the isometric projection (and stays
  //    axis-aligned under the flat one). Skipped when zoomed so far out the
  //    lines would crowd into a haze.
  const gx0 = Math.floor(left / GRID_WORLD_SPACING);
  const gx1 = Math.ceil(right / GRID_WORLD_SPACING);
  const gy0 = Math.floor(top / GRID_WORLD_SPACING);
  const gy1 = Math.ceil(bottom / GRID_WORLD_SPACING);
  if (gx1 - gx0 <= GRID_LINE_CAP && gy1 - gy0 <= GRID_LINE_CAP) {
    ctx.save();
    ctx.strokeStyle = "rgba(28,38,32,0.25)";
    ctx.lineWidth = 1;
    // Accumulate every gridline of each axis into one Path2D and stroke it
    // once, rather than issuing a separate beginPath/stroke per line (up to
    // ~480 strokes otherwise). The endpoints are still projected per line —
    // only the stroke submission is batched.
    const xGrid = new Path2D();
    for (let i = gx0; i <= gx1; i += 1) {
      const wx = i * GRID_WORLD_SPACING;
      const a = t.project(wx, top);
      const b = t.project(wx, bottom);
      xGrid.moveTo(a.x, a.y);
      xGrid.lineTo(b.x, b.y);
    }
    const yGrid = new Path2D();
    for (let i = gy0; i <= gy1; i += 1) {
      const wy = i * GRID_WORLD_SPACING;
      const a = t.project(left, wy);
      const b = t.project(right, wy);
      yGrid.moveTo(a.x, a.y);
      yGrid.lineTo(b.x, b.y);
    }
    ctx.stroke(xGrid);
    ctx.stroke(yGrid);
    ctx.restore();
  }

  // 3. Starfield on a FIXED world lattice covering the visible rect. One star
  //    per 70 m cell at a hashed offset, pinned to world space — it never
  //    reshuffles on zoom (and buffering never moves a star). To cap the drawn
  //    count when zoomed out the lattice is DENSITY-THINNED: each star draws
  //    iff its fixed visibility hash passes a density threshold, so the visible
  //    subset is a uniform random sample — NOT a regular sublattice, so no grid
  //    pattern emerges — and each drawn star stays at its fixed lattice position
  //    (stars never move on zoom; only the fraction drawn changes). Past an
  //    extreme zoom-out the starfield is skipped (sub-pixel noise + it bounds
  //    the per-cell hash iteration).
  const cell = STAR_CELL_WORLD;
  const sx0 = Math.floor(left / cell);
  const sx1 = Math.ceil(right / cell);
  const sy0 = Math.floor(top / cell);
  const sy1 = Math.ceil(bottom / cell);
  const cellCount = (sx1 - sx0 + 1) * (sy1 - sy0 + 1);
  if (cellCount <= STAR_CELL_MAX_ITER) {
    // Draw a cell's star iff its visibility hash passes the density — a uniform
    // random thinning whose drawn count is ≈ cellCount × density ≤ STAR_CELL_CAP.
    const density = Math.min(1, STAR_CELL_CAP / cellCount);
    ctx.save();
    ctx.fillStyle = "rgba(201,212,196,1)";
    for (let ix = sx0; ix <= sx1; ix += 1) {
      for (let iy = sy0; iy <= sy1; iy += 1) {
        // Organic fade: a star's alpha ramps (smoothstep) as the zoom-dependent
        // density threshold sweeps across its fixed visibility hash — stars fade
        // in on zoom-in and out on zoom-out instead of popping at the threshold.
        const visHash = cellHash(ix, iy, 4);
        // Relative fade band (a fraction of the density range): the brightest
        // stars stay full at any zoom; only the threshold-near fraction fades.
        const fadeRange = density * STAR_FADE_FRAC;
        let fade = fadeRange > 0 ? (density - visHash) / fadeRange : 1;
        if (fade <= 0) continue;
        if (fade > 1) fade = 1;
        const fadeMul = fade * fade * (3 - 2 * fade);
        const wx = (ix + cellHash(ix, iy, 0)) * cell;
        const wy = (iy + cellHash(ix, iy, 1)) * cell;
        const sp = t.project(wx, wy);
        if (sp.x < 0 || sp.x > width || sp.y < 0 || sp.y > height) continue;
        ctx.globalAlpha = (0.3 + cellHash(ix, iy, 2) * 0.6) * fadeMul;
        const radius = 0.8 + cellHash(ix, iy, 3) * 0.7;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
