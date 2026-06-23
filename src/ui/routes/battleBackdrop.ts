import { hash01 } from "./battleAnomaly";
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

/** Caps so a zoomed-far-out view does not iterate a huge lattice: the grid stops
 *  drawing past this many lines per axis, and the starfield lattice is coarsened
 *  (cell size doubled) until it fits this many cells. */
const GRID_LINE_CAP = 240;
const STAR_CELL_CAP = 2400;

/** Deterministic unit float for lattice cell (ix, iy), variant k. */
function cellHash(ix: number, iy: number, k: number): number {
  return hash01((ix * 73856093) ^ (iy * 19349663) ^ (k * 83492791));
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
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, BASE_PANEL);
  grad.addColorStop(1, BASE_VOID);
  ctx.fillStyle = grad;
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
    // Constant-x lines run from (x, top) to (x, bottom) in world space.
    for (let i = gx0; i <= gx1; i += 1) {
      const wx = i * GRID_WORLD_SPACING;
      const a = t.project(wx, top);
      const b = t.project(wx, bottom);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // Constant-y lines run from (left, y) to (right, y) in world space.
    for (let i = gy0; i <= gy1; i += 1) {
      const wy = i * GRID_WORLD_SPACING;
      const a = t.project(left, wy);
      const b = t.project(right, wy);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 3. Starfield on a fixed world lattice covering the visible rect. One star
  //    per cell at a hashed offset; coarsened when a zoomed-out view would span
  //    too many cells. Fixed in world space, so buffering never moves a star.
  let cell = STAR_CELL_WORLD;
  let sx0 = Math.floor(left / cell);
  let sx1 = Math.ceil(right / cell);
  let sy0 = Math.floor(top / cell);
  let sy1 = Math.ceil(bottom / cell);
  while ((sx1 - sx0 + 1) * (sy1 - sy0 + 1) > STAR_CELL_CAP) {
    cell *= 2;
    sx0 = Math.floor(left / cell);
    sx1 = Math.ceil(right / cell);
    sy0 = Math.floor(top / cell);
    sy1 = Math.ceil(bottom / cell);
  }
  ctx.save();
  ctx.fillStyle = "rgba(201,212,196,1)";
  for (let ix = sx0; ix <= sx1; ix += 1) {
    for (let iy = sy0; iy <= sy1; iy += 1) {
      const wx = (ix + cellHash(ix, iy, 0)) * cell;
      const wy = (iy + cellHash(ix, iy, 1)) * cell;
      const sp = t.project(wx, wy);
      const px = sp.x;
      const py = sp.y;
      if (px < 0 || px > width || py < 0 || py > height) continue;
      ctx.globalAlpha = 0.3 + cellHash(ix, iy, 2) * 0.6;
      const radius = 0.8 + cellHash(ix, iy, 3) * 0.7;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
