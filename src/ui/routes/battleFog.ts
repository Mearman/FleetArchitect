import type { AwarenessSnapshot } from "@/schema/battle";
import type { Bounds, Transform } from "./battleCamera";

// ---------------------------------------------------------------------------
// Colour and style constants (named so magic numbers never appear inline)
// ---------------------------------------------------------------------------

/**
 * Opacity of the fog layer before coverage discs are cut out of it.
 * 0 = transparent (no fog), 1 = fully opaque black. 0.45 gives a clearly
 * visible shroud without making uncovered space illegible.
 */
const FOG_ALPHA = 0.45;

/** Fill colour of the fog shroud. Near-black with a deep-blue tint. */
const FOG_COLOUR = "rgba(10,12,28,1)";

/**
 * Maximum hue-jitter applied to a cluster's side colour to distinguish clusters
 * on the same team. ±HUE_JITTER degrees are applied based on a stable hash of
 * the cluster id. 40° keeps clusters clearly distinguishable while staying warm/
 * cool enough to read allegiance at a glance.
 */
const HUE_JITTER_DEG = 40;

/** Base hue of the attacker side colour (#ff6b5a ≈ 6° red). */
const ATTACKER_HUE = 6;
/** Base saturation of the attacker side colour (%)  */
const ATTACKER_SAT = 100;
/** Base lightness of the attacker side colour (%) */
const ATTACKER_LIT = 68;

/** Base hue of the defender side colour (#5ab0ff ≈ 211° blue). */
const DEFENDER_HUE = 211;
/** Base saturation of the defender side colour (%) */
const DEFENDER_SAT = 100;
/** Base lightness of the defender side colour (%) */
const DEFENDER_LIT = 67;

/** Stroke width of the cluster perimeter outline, in display pixels. */
const CLUSTER_PERIMETER_WIDTH = 2;

/** Alpha of the cluster perimeter stroke (a semi-transparent overlay). */
const CLUSTER_PERIMETER_ALPHA = 0.7;

/** Stroke width of a standard RF/omni comms link line, in display pixels. */
const LINK_RF_WIDTH = 1;

/** Alpha of an RF/omni comms link line. */
const LINK_RF_ALPHA = 0.35;

/** Dash pattern for an RF/omni comms link [dash, gap] in pixels. */
const LINK_RF_DASH: [number, number] = [4, 4];

/** Stroke width of a laser/directional comms link line, in display pixels. */
const LINK_LASER_WIDTH = 1.5;

/** Alpha of a laser/directional comms link line. */
const LINK_LASER_ALPHA = 0.75;

/** Colour of a laser comms link (bright cyan). */
const LINK_LASER_COLOUR = "#40e0ff";

/** Colour of an RF/omni comms link (attenuated white). */
const LINK_RF_COLOUR = "rgba(200,220,255,1)";

/**
 * Maximum ghost-contact opacity. Ghosts fade from GHOST_MAX_ALPHA down to 0
 * as ticksLeft approaches 0. At ticksLeft = GHOST_FADE_TICKS the ghost is at
 * full opacity; below that it fades linearly.
 */
const GHOST_MAX_ALPHA = 0.55;

/**
 * Number of ticks over which a ghost fades from full to zero opacity.
 * Chosen to give ~2 seconds of fade at 30 ticks/second.
 */
const GHOST_FADE_TICKS = 60;

/** Radius of a ghost contact marker in display pixels (before scale). */
const GHOST_MARKER_RADIUS_PX = 5;

/** Colour of a ghost marker (dim yellow). */
const GHOST_MARKER_COLOUR = "rgba(255,230,140,1)";

/**
 * Length of the dish/antenna indicator line in world units. A short tick from
 * the ship centre showing where the antenna is pointed. Kept short (12 wu) so
 * it does not dominate the display but is legible when zoomed.
 */
const DISH_LINE_WORLD_UNITS = 12;

/** Colour of the dish aim indicator. */
const DISH_LINE_COLOUR = "rgba(160,210,255,0.7)";

/** Width of the dish aim indicator line, in display pixels. */
const DISH_LINE_WIDTH = 1;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * A tiny deterministic hash mapping a string to a float in [0, 1).
 * Uses a djb2-style accumulation so cluster ids (arbitrary strings) produce
 * stable, well-distributed values without requiring a seed.
 */
export function hashStringUnit(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // djb2: h = h * 33 XOR char
    h = ((h << 5) + h) ^ (s.charCodeAt(i) & 0xff);
    h = h >>> 0; // keep as unsigned 32-bit
  }
  return h / 4294967296;
}

/**
 * Return an HSL colour string for a cluster perimeter, jittered from the
 * base side colour by a deterministic amount derived from the cluster id.
 */
function clusterColour(
  side: "attacker" | "defender",
  clusterId: string,
  alpha: number,
): string {
  const jitter = (hashStringUnit(clusterId) - 0.5) * 2 * HUE_JITTER_DEG;
  const baseHue = side === "attacker" ? ATTACKER_HUE : DEFENDER_HUE;
  const sat = side === "attacker" ? ATTACKER_SAT : DEFENDER_SAT;
  const lit = side === "attacker" ? ATTACKER_LIT : DEFENDER_LIT;
  const hue = ((baseHue + jitter) % 360 + 360) % 360;
  return `hsla(${hue.toFixed(1)},${sat}%,${lit}%,${alpha})`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ship screen-position map passed in for link and dish-indicator rendering.
 * Keys are ship instanceIds; values are the interpolated screen positions
 * (already run through t.sx / t.sy — ie display-pixel coords).
 */
export type ShipScreenPositions = ReadonlyMap<string, { x: number; y: number }>;

/**
 * Draw the fog-of-war and sensor-awareness overlay onto the canvas.
 *
 * Layering within this function (back to front):
 *   1. Fog shroud (dark overlay over the whole battle bounds)
 *   2. Coverage discs cut out of the fog (globalCompositeOperation = "destination-out")
 *   3. Cluster perimeter strokes (drawn after restoring compositing)
 *   4. Comms links
 *   5. Ghost contacts
 *   6. Dish aim indicators
 *
 * @param ctx         Canvas 2D context (already scaled for DPR by caller).
 * @param awareness   The AwarenessSnapshot for this frame, or undefined — when
 *                    undefined the function is a guaranteed no-op.
 * @param t           World-to-screen transform from resolveTransform.
 * @param bounds      World-space battle bounds (used to size the fog rect).
 * @param shipPos     Map of instanceId → screen-pixel position of each ship, for
 *                    link and dish indicators. Pass an empty map when unavailable.
 */
export function drawFogAndAwareness(
  ctx: CanvasRenderingContext2D,
  awareness: AwarenessSnapshot | undefined,
  t: Transform,
  bounds: Bounds,
  shipPos: ShipScreenPositions,
): void {
  // Single guard: absent awareness → nothing to draw. No further defensive
  // branches — if awareness is present we render it as given.
  if (awareness === undefined) return;

  const x0 = t.sx(bounds.minX);
  const y0 = t.sy(bounds.minY);
  const x1 = t.sx(bounds.maxX);
  const y1 = t.sy(bounds.maxY);
  const w = x1 - x0;
  const h = y1 - y0;

  // -------------------------------------------------------------------------
  // 1+2. Fog shroud with coverage cutouts
  // -------------------------------------------------------------------------
  // We draw into an isolated layer (ctx.save with globalCompositeOperation) so
  // the "destination-out" cutout only erases our own fog layer, not the ships
  // and anomaly drawn underneath.
  ctx.save();

  // Draw fog into a temporary compositing layer by setting globalAlpha, then
  // use a clipping rectangle to keep the effect inside the battle bounds.
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();

  // Fog fill.
  ctx.globalAlpha = FOG_ALPHA;
  ctx.fillStyle = FOG_COLOUR;
  ctx.fillRect(x0, y0, w, h);

  // Cut coverage discs out of the fog so covered space reads as clear.
  // "destination-out" makes new draws erase existing pixels proportional to
  // their alpha; a fully-opaque disc punches a clean hole.
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  for (const cluster of awareness.clusters) {
    for (const disc of cluster.coverage) {
      const px = t.sx(disc.x);
      const py = t.sy(disc.y);
      const rPx = disc.r * t.scale;
      ctx.beginPath();
      ctx.arc(px, py, rPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore(); // restores compositeOperation and clipping

  // -------------------------------------------------------------------------
  // 3. Cluster perimeter strokes
  // -------------------------------------------------------------------------
  // Stroke each coverage disc with a side+cluster-specific colour.
  ctx.save();
  for (const cluster of awareness.clusters) {
    const strokeColour = clusterColour(cluster.side, cluster.id, CLUSTER_PERIMETER_ALPHA);
    ctx.strokeStyle = strokeColour;
    ctx.lineWidth = CLUSTER_PERIMETER_WIDTH;
    ctx.setLineDash([]);
    for (const disc of cluster.coverage) {
      const px = t.sx(disc.x);
      const py = t.sy(disc.y);
      const rPx = disc.r * t.scale;
      ctx.beginPath();
      ctx.arc(px, py, rPx, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  // -------------------------------------------------------------------------
  // 4. Comms links
  // -------------------------------------------------------------------------
  ctx.save();
  for (const link of awareness.links) {
    const aPos = shipPos.get(link.aId);
    const bPos = shipPos.get(link.bId);
    if (aPos === undefined || bPos === undefined) continue;

    const isLaser = link.type === "laser";
    if (isLaser) {
      ctx.strokeStyle = LINK_LASER_COLOUR;
      ctx.lineWidth = LINK_LASER_WIDTH;
      ctx.globalAlpha = LINK_LASER_ALPHA;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = LINK_RF_COLOUR;
      ctx.lineWidth = LINK_RF_WIDTH;
      ctx.globalAlpha = LINK_RF_ALPHA;
      ctx.setLineDash(LINK_RF_DASH);
    }

    ctx.beginPath();
    ctx.moveTo(aPos.x, aPos.y);
    ctx.lineTo(bPos.x, bPos.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // -------------------------------------------------------------------------
  // 5. Ghost contacts
  // -------------------------------------------------------------------------
  ctx.save();
  for (const ghost of awareness.ghosts) {
    const px = t.sx(ghost.x);
    const py = t.sy(ghost.y);
    // Fade linearly: full at GHOST_FADE_TICKS remaining, zero at 0.
    const fadeFraction = Math.min(1, ghost.ticksLeft / GHOST_FADE_TICKS);
    ctx.globalAlpha = fadeFraction * GHOST_MAX_ALPHA;
    ctx.fillStyle = GHOST_MARKER_COLOUR;
    ctx.beginPath();
    ctx.arc(px, py, GHOST_MARKER_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
    // A faint ring to mark it as "last known", not a confirmed contact.
    ctx.strokeStyle = GHOST_MARKER_COLOUR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(px, py, GHOST_MARKER_RADIUS_PX * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // -------------------------------------------------------------------------
  // 6. Dish / antenna aim indicators
  // -------------------------------------------------------------------------
  ctx.save();
  ctx.strokeStyle = DISH_LINE_COLOUR;
  ctx.lineWidth = DISH_LINE_WIDTH;
  for (const da of awareness.dishAngles) {
    const shipScreenPos = shipPos.get(da.shipId);
    if (shipScreenPos === undefined) continue;
    // Convert world-unit length to screen pixels.
    const lineEndX = shipScreenPos.x + Math.cos(da.angle) * DISH_LINE_WORLD_UNITS * t.scale;
    const lineEndY = shipScreenPos.y + Math.sin(da.angle) * DISH_LINE_WORLD_UNITS * t.scale;
    ctx.beginPath();
    ctx.moveTo(shipScreenPos.x, shipScreenPos.y);
    ctx.lineTo(lineEndX, lineEndY);
    ctx.stroke();
  }
  ctx.restore();
}
