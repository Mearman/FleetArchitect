import { computeOccluders } from "@/domain/occluders";
import type { BattleAnomaly } from "@/schema/battle";
import { CELL_SIZE } from "@/domain/grid";
import { PHOSPHOR_AMBER } from "@/ui/theme/tokens";
import type { Bounds, Transform } from "./battleCamera";
import { pathWorldCircle, withWorldTransform } from "./battleProject";

/**
 * Render constants that MIRROR the engine's SIM values in
 * src/domain/simulation/engine.ts. They are duplicated here on purpose so the
 * UI stays decoupled from the engine (it imports no engine internals). If the
 * engine's black-hole geometry changes, update these to match:
 *   SIM.blackHoleLethalRadius = 24  (instant-death zone radius, world units)
 *   SIM.blackHoleTidalRadius  = 48  (tidal-damage zone radius, world units)
 */
const BLACK_HOLE_LETHAL_RADIUS = 24;
const BLACK_HOLE_TIDAL_RADIUS = 48;

/** Magenta tidal ring stroke for the black hole's outer danger zone. */
const BH_TIDAL_STROKE = "rgba(255,43,214,0.45)";
/** Magenta-violet glow falling off from the lethal edge into the tidal zone. */
const BH_GLOW_START = "rgba(180,60,200,0.35)";
/** Deep magenta base tint across the nebula battlefield. */
const NEBULA_BASE_TINT = "rgba(140,0,160,0.10)";
/** Magenta blob gradient start for nebula texture. */
const NEBULA_BLOB_START = "rgba(200,60,220,0.14)";
/** Minimum asteroid shade alpha. */
const ASTEROID_ALPHA_BASE = 0.35;
/** Asteroid shade alpha variation range. */
const ASTEROID_ALPHA_RANGE = 0.3;

/**
 * A tiny deterministic hash mapping an integer index to a pseudo-random unit
 * float in [0, 1). Used so scattered features (asteroids, nebula blobs) have
 * fixed positions that never jitter between redraws — no Math.random in render.
 */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Draw the active anomaly in world space, beneath the ships.
 *
 * @param seed  The battle seed, forwarded to computeOccluders for asteroid
 *              field placement so the rendered rocks exactly match the engine's
 *              line-of-sight occluders (single source of truth).
 */
export function drawAnomaly(
  ctx: CanvasRenderingContext2D,
  anomaly: BattleAnomaly,
  t: Transform,
  bounds: Bounds,
  seed: number,
): void {
  if (anomaly === "none") return;
  if (anomaly === "blackHole") {
    drawBlackHole(ctx, t);
    return;
  }
  if (anomaly === "nebula") {
    drawNebula(ctx, t, bounds);
    return;
  }
  drawAsteroidField(ctx, t, seed);
}

function drawBlackHole(ctx: CanvasRenderingContext2D, t: Transform): void {
  // Centred at the world origin. Everything is drawn in world units so the rings
  // and glow tilt into ellipses on the battle plane under iso. The lethal/tidal
  // radii are world distances; the glow gradient is filled inside a world-space
  // transform so the radial falloff is squashed into the same ellipse.
  const lethalPx = BLACK_HOLE_LETHAL_RADIUS * t.scale;

  ctx.save();

  // Dashed tidal-danger ring at the tidal radius.
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = BH_TIDAL_STROKE;
  ctx.lineWidth = 1.5;
  pathWorldCircle(ctx, t, 0, 0, BLACK_HOLE_TIDAL_RADIUS);
  ctx.stroke();
  ctx.setLineDash([]);

  // Outer glow falling off from the lethal edge into the tidal zone, drawn in a
  // world-space frame so the gradient becomes an iso ellipse.
  withWorldTransform(ctx, t, 0, 0, () => {
    const glow = ctx.createRadialGradient(
      0,
      0,
      BLACK_HOLE_LETHAL_RADIUS,
      0,
      0,
      BLACK_HOLE_TIDAL_RADIUS,
    );
    glow.addColorStop(0, BH_GLOW_START);
    glow.addColorStop(1, "rgba(180,60,200,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, BLACK_HOLE_TIDAL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  });

  // Bright accretion ring at the lethal edge (stroke width stays in pixels).
  ctx.strokeStyle = PHOSPHOR_AMBER;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = Math.max(2, lethalPx * 0.18);
  pathWorldCircle(ctx, t, 0, 0, BLACK_HOLE_LETHAL_RADIUS);
  ctx.stroke();

  // Event-horizon disc: solid black sized to the lethal radius.
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";
  pathWorldCircle(ctx, t, 0, 0, BLACK_HOLE_LETHAL_RADIUS);
  ctx.fill();

  ctx.restore();
}

function drawNebula(ctx: CanvasRenderingContext2D, t: Transform, bounds: Bounds): void {
  ctx.save();

  // Base purple tint across the whole battlefield, clipped to the world rect so
  // it does not bleed into the letterbox margins.
  const nc = [
    t.project(bounds.minX, bounds.minY),
    t.project(bounds.maxX, bounds.minY),
    t.project(bounds.minX, bounds.maxY),
    t.project(bounds.maxX, bounds.maxY),
  ];
  const x0 = Math.min(...nc.map((p) => p.x));
  const y0 = Math.min(...nc.map((p) => p.y));
  const x1 = Math.max(...nc.map((p) => p.x));
  const y1 = Math.max(...nc.map((p) => p.y));
  ctx.fillStyle = NEBULA_BASE_TINT;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  // A handful of soft radial blobs at deterministic positions for texture.
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const blobCount = 7;
  for (let i = 0; i < blobCount; i += 1) {
    const wx = bounds.minX + hash01(i * 2 + 1) * rangeX;
    const wy = bounds.minY + hash01(i * 2 + 2) * rangeY;
    // Blob radius in world units (a fraction of the smaller field dimension), so
    // the soft blob tilts into an ellipse and scales with the view.
    const radiusW = (0.12 + hash01(i + 17) * 0.12) * Math.min(rangeX, rangeY);
    withWorldTransform(ctx, t, wx, wy, () => {
      const blob = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusW);
      blob.addColorStop(0, NEBULA_BLOB_START);
      blob.addColorStop(1, "rgba(200,60,220,0)");
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(0, 0, radiusW, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.restore();
}

/**
 * Draw the asteroid field using the canonical occluder discs from
 * computeOccluders. This guarantees the rocks the player sees are exactly the
 * discs the engine uses for line-of-sight occlusion — a single source of truth.
 *
 * Previously this function invented its own scatter via hash01; that is now
 * replaced by the occluder module so visual and physics representations agree.
 */
function drawAsteroidField(ctx: CanvasRenderingContext2D, t: Transform, seed: number): void {
  ctx.save();

  const discs = computeOccluders("asteroidField", seed);
  for (let i = 0; i < discs.length; i += 1) {
    const disc = discs[i];
    if (disc === undefined) continue;
    // World radius (the occluder's own extent), floored so distant rocks stay
    // visible. Drawn as a world circle so each rock tilts into an ellipse.
    const rW = Math.max(CELL_SIZE * 0.3, disc.r);
    // Deterministic shade: use hash01 over the disc index so appearance is
    // stable between redraws. The index is stable since computeOccluders
    // always returns the same ordered array for a given (anomaly, seed).
    const shade = ASTEROID_ALPHA_BASE + hash01(i + 91) * ASTEROID_ALPHA_RANGE;
    ctx.fillStyle = `rgba(150,150,160,${shade})`;
    pathWorldCircle(ctx, t, disc.x, disc.y, rW);
    ctx.fill();
    // A darker rim for a touch of relief (CHROME_BORDER at alpha 0.5).
    ctx.strokeStyle = "rgba(28,38,32,0.5)";
    ctx.lineWidth = 1;
    pathWorldCircle(ctx, t, disc.x, disc.y, rW);
    ctx.stroke();
  }

  ctx.restore();
}
