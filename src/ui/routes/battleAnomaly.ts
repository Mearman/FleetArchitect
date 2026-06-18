import type { BattleAnomaly } from "@/schema/battle";
import type { Bounds, Transform } from "./battleCamera";

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

/**
 * A tiny deterministic hash mapping an integer index to a pseudo-random unit
 * float in [0, 1). Used so scattered features (asteroids, nebula blobs) have
 * fixed positions that never jitter between redraws — no Math.random in render.
 */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Draw the active anomaly in world space, beneath the ships. */
export function drawAnomaly(
  ctx: CanvasRenderingContext2D,
  anomaly: BattleAnomaly,
  t: Transform,
  bounds: Bounds,
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
  drawAsteroidField(ctx, t, bounds);
}

function drawBlackHole(ctx: CanvasRenderingContext2D, t: Transform): void {
  const cx = t.sx(0);
  const cy = t.sy(0);
  const lethalPx = BLACK_HOLE_LETHAL_RADIUS * t.scale;
  const tidalPx = BLACK_HOLE_TIDAL_RADIUS * t.scale;

  ctx.save();

  // Dashed tidal-danger ring at the tidal radius.
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(180,120,255,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, tidalPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Outer glow falling off from the lethal edge into the tidal zone.
  const glow = ctx.createRadialGradient(cx, cy, lethalPx, cx, cy, tidalPx);
  glow.addColorStop(0, "rgba(120,60,200,0.35)");
  glow.addColorStop(1, "rgba(120,60,200,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, tidalPx, 0, Math.PI * 2);
  ctx.fill();

  // Bright accretion ring at the lethal edge.
  ctx.strokeStyle = "rgba(255,210,140,0.95)";
  ctx.lineWidth = Math.max(2, lethalPx * 0.18);
  ctx.beginPath();
  ctx.arc(cx, cy, lethalPx, 0, Math.PI * 2);
  ctx.stroke();

  // Event-horizon disc: solid black sized to the lethal radius.
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, lethalPx), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawNebula(ctx: CanvasRenderingContext2D, t: Transform, bounds: Bounds): void {
  ctx.save();

  // Base purple tint across the whole battlefield, clipped to the world rect so
  // it does not bleed into the letterbox margins.
  const x0 = t.sx(bounds.minX);
  const y0 = t.sy(bounds.minY);
  const x1 = t.sx(bounds.maxX);
  const y1 = t.sy(bounds.maxY);
  ctx.fillStyle = "rgba(120,70,180,0.12)";
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  // A handful of soft radial blobs at deterministic positions for texture.
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const blobCount = 7;
  for (let i = 0; i < blobCount; i += 1) {
    const wx = bounds.minX + hash01(i * 2 + 1) * rangeX;
    const wy = bounds.minY + hash01(i * 2 + 2) * rangeY;
    const radiusPx = (0.12 + hash01(i + 17) * 0.12) * Math.min(rangeX, rangeY) * t.scale;
    const px = t.sx(wx);
    const py = t.sy(wy);
    const blob = ctx.createRadialGradient(px, py, 0, px, py, radiusPx);
    blob.addColorStop(0, "rgba(170,110,230,0.16)");
    blob.addColorStop(1, "rgba(170,110,230,0)");
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawAsteroidField(ctx: CanvasRenderingContext2D, t: Transform, bounds: Bounds): void {
  ctx.save();

  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const rockCount = 60;
  for (let i = 0; i < rockCount; i += 1) {
    const wx = bounds.minX + hash01(i * 3 + 1) * rangeX;
    const wy = bounds.minY + hash01(i * 3 + 2) * rangeY;
    // World-unit radius scaled to display; floored so distant rocks stay visible.
    const rPx = Math.max(1.5, (2 + hash01(i * 3 + 3) * 4) * t.scale);
    const px = t.sx(wx);
    const py = t.sy(wy);
    const shade = 0.35 + hash01(i + 91) * 0.3;
    ctx.fillStyle = `rgba(150,150,160,${shade})`;
    ctx.beginPath();
    ctx.arc(px, py, rPx, 0, Math.PI * 2);
    ctx.fill();
    // A darker rim for a touch of relief.
    ctx.strokeStyle = "rgba(40,40,48,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, rPx, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
