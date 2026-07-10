import { computeOccluders } from "@/domain/occluders";
import { hasAnomaly } from "@/domain/anomaly";
import type { BattleAnomalyKind } from "@/schema/battle";
import { CELL_SIZE } from "@/domain/grid";
import {
  BLACK_HOLE_SCHWARZSCHILD_RADIUS_M,
  BLACK_HOLE_TIDAL_RADIUS_M,
} from "@/domain/black-hole";
import { PHOSPHOR_AMBER } from "@/ui/theme/tokens";
import type { Bounds, Transform } from "./battleCamera";
import { pathWorldCircle, withWorldTransform } from "./battleProject";

/**
 * Black-hole geometry the renderer draws, read from the shared pure-domain leaf
 * `@/domain/black-hole` — the same lethal (event-horizon) and tidal radii the
 * engine's `SIM.blackHoleLethalRadius` / `SIM.blackHoleTidalRadius` and the
 * occluder module derive from. Importing the leaf (rather than mirroring bare
 * literals) keeps the UI decoupled from engine internals while guaranteeing the
 * rendered rings match the engine's geometry from a single source of truth.
 */
const BLACK_HOLE_LETHAL_RADIUS = BLACK_HOLE_SCHWARZSCHILD_RADIUS_M;
const BLACK_HOLE_TIDAL_RADIUS = BLACK_HOLE_TIDAL_RADIUS_M;

/** Magenta tidal ring stroke for the black hole's outer danger zone. */
const BH_TIDAL_STROKE = "rgba(255,43,214,0.45)";
/** Magenta-violet glow falling off from the lethal edge into the tidal zone. */
const BH_GLOW_START = "rgba(180,60,200,0.35)";
/** Transparent outer edge of the glow, fading fully out at the tidal ring. */
const BH_GLOW_END = "rgba(180,60,200,0)";
/** Deep magenta base tint across the nebula battlefield. */
const NEBULA_BASE_TINT = "rgba(140,0,160,0.10)";
/** Magenta blob gradient start for nebula texture. */
const NEBULA_BLOB_START = "rgba(200,60,220,0.14)";
/** Transparent outer edge of a nebula blob. */
const NEBULA_BLOB_END = "rgba(200,60,220,0)";
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
 * Cached radial-gradient helper for the anomaly layer. `createRadialGradient` is
 * a relatively expensive Canvas 2D call, and the black-hole glow plus the
 * nebula's blobs rebuild identical gradients every rAF; this memoises them by
 * their world-space parameters so a steady view pays only a `Map.get` per blob.
 *
 * Per MDN, gradient coordinates are global — painted in the coordinate space
 * current at fill time, not fixed at creation — so a gradient built once with a
 * given circle and stop list renders identically on every frame it is reused:
 * the per-frame world transform applied by `withWorldTransform` is what maps it
 * to screen. The map is held under a context-identity guard so a canvas remount
 * (a fresh context) drops the stale entry rather than reusing a gradient bound
 * to the old context — mirroring the cached-gradient pattern in
 * `battleBackdrop.ts`.
 */
let radialGradientCache: {
  ctx: CanvasRenderingContext2D;
  map: Map<string, CanvasGradient>;
} | null = null;

/** A colour stop: gradient offset paired with a CSS colour string. */
type RadialColourStop = readonly [number, string];

function cachedRadialGradient(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  stops: readonly RadialColourStop[],
): CanvasGradient {
  // Key on the full circle geometry plus every stop (offset and colour) so two
  // visually distinct gradients never share an entry. Template literals
  // serialise the numbers losslessly (shortest round-trip), so equal parameters
  // — e.g. the deterministic per-blob radius — always collide.
  let stopsKey = "";
  for (const [offset, colour] of stops) {
    stopsKey += `${offset}|${colour};`;
  }
  const key = `${cx},${cy},${r0},${r1}|${stopsKey}`;
  if (radialGradientCache === null || radialGradientCache.ctx !== ctx) {
    radialGradientCache = { ctx, map: new Map() };
  }
  // Bind the narrowed map to a local so the non-null narrowing survives the
  // createRadialGradient call below (a module-level let is widened across any
  // call, so the unaliased field access would type as possibly-null).
  const map = radialGradientCache.map;
  const hit = map.get(key);
  if (hit !== undefined) return hit;
  const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  for (const [offset, colour] of stops) {
    grad.addColorStop(offset, colour);
  }
  map.set(key, grad);
  return grad;
}

/**
 * Draw the active anomalies in world space, beneath the ships. All selected
 * anomalies draw together (combinable): a black hole, a nebula, and an
 * asteroid field can all be present at once.
 *
 * @param seed  The battle seed, forwarded to computeOccluders for asteroid
 *              field placement so the rendered rocks exactly match the engine's
 *              line-of-sight occluders (single source of truth).
 */
export function drawAnomaly(
  ctx: CanvasRenderingContext2D,
  anomalies: readonly BattleAnomalyKind[],
  t: Transform,
  bounds: Bounds,
  seed: number,
): void {
  if (hasAnomaly(anomalies, "blackHole")) {
    drawBlackHole(ctx, t);
  }
  if (hasAnomaly(anomalies, "nebula")) {
    drawNebula(ctx, t, bounds);
  }
  if (hasAnomaly(anomalies, "asteroidField")) {
    drawAsteroidField(ctx, t, seed);
  }
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
    const glow = cachedRadialGradient(
      ctx,
      0,
      0,
      BLACK_HOLE_LETHAL_RADIUS,
      BLACK_HOLE_TIDAL_RADIUS,
      [
        [0, BH_GLOW_START],
        [1, BH_GLOW_END],
      ],
    );
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
      const blob = cachedRadialGradient(ctx, 0, 0, 0, radiusW, [
        [0, NEBULA_BLOB_START],
        [1, NEBULA_BLOB_END],
      ]);
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
function drawAsteroidField(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  seed: number,
): void {
  ctx.save();

  // Render only the asteroid discs. The black-hole disc (if a black hole is also
  // active) is drawn by drawBlackHole, not as a rock here.
  const discs = computeOccluders(["asteroidField"], seed);
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
