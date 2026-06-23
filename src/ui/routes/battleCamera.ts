import { CELL_SIZE } from "@/domain/grid";
import type { BattleFrame } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import { hullRadiusWorld } from "@/ui/cellLayout";

/** Inner-edge padding (display px) kept around the battle at fit zoom (zoom = 1). */
export const CAMERA_PAD = 40;

/** Camera clamp: how far in/out the wheel can zoom relative to the auto-fit scale. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 12;

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Camera state.
 *
 * `autoFit` is the mode the camera starts a battle in: each frame the view is
 * re-fitted to the bounding box of the *live* ships, so the camera tracks the
 * action as the fleets close, spread, and thin out. While set, the manual fields
 * are ignored. Zooming or panning breaks out of it (clears `autoFit`); the zoom
 * badge restores it.
 *
 * The manual fields are absolute, not relative to a whole-battle fit — that
 * matters because in a spread-out battle (e.g. ships flung wide by a black
 * hole) the live-ships view is a much tighter scale than the whole-battle fit,
 * far beyond what a fit-multiplier in `[ZOOM_MIN, ZOOM_MAX]` could express:
 *  - `baseScale` is the display px-per-world-unit captured at the moment of
 *    breaking out (the auto-fit scale then), so the manual view picks up exactly
 *    where the auto-fit left off.
 *  - `zoom` multiplies `baseScale` (1 at break-out — the readout reads 100%
 *    there); the wheel and +/- clamp it to `[ZOOM_MIN, ZOOM_MAX]` of the break-
 *    out baseline.
 *  - `centreX`/`centreY` are the world point at the canvas centre.
 *  - `followId` pins the centre to a ship's live position each frame.
 */
export interface Camera {
  autoFit: boolean;
  zoom: number;
  baseScale: number;
  centreX: number;
  centreY: number;
  followId: string | null;
}

export const DEFAULT_CAMERA: Camera = {
  autoFit: true,
  zoom: 1,
  baseScale: 1,
  centreX: 0,
  centreY: 0,
  followId: null,
};

/**
 * How world coordinates map onto the screen plane, independent of scale/centre.
 * `flat` is the top-down identity; `isometric` (added later) tilts the plane. The
 * caller picks the mode; `makeTransform` composes it with scale + centre.
 *
 *  - `project`   maps a world-space delta (relative to the camera centre) to a
 *    screen-space delta (before scale).
 *  - `unproject` is its exact inverse, for screen -> world hit-testing.
 *  - `depth`     is the back-to-front draw-order key for a world delta.
 */
export type ProjectionMode = "flat" | "isometric";

export interface Projection {
  mode: ProjectionMode;
  project: (dx: number, dy: number) => { x: number; y: number };
  unproject: (sx: number, sy: number) => { x: number; y: number };
  depth: (dx: number, dy: number) => number;
}

/** Top-down identity projection: screen delta equals world delta, depth is y. */
export const FLAT_PROJECTION: Projection = {
  mode: "flat",
  project: (dx, dy) => ({ x: dx, y: dy }),
  unproject: (sx, sy) => ({ x: sx, y: sy }),
  depth: (_dx, dy) => dy,
};

/**
 * The resolved world-to-display mapping for one draw. `scale` is display
 * px-per-world-unit; `centreX`/`centreY` is the world point mapped to the canvas
 * centre; `projection` is the world->screen plane mapping.
 *
 * `project(wx, wy)` maps a world point to a screen point through the projection.
 * `sx`/`sy` are the per-axis equivalents — valid only for an axis-separable
 * projection (the flat one); isometric callers must use `project`, where screen-x
 * depends on both world coords.
 */
export interface Transform {
  scale: number;
  centreX: number;
  centreY: number;
  width: number;
  height: number;
  projection: Projection;
  project: (wx: number, wy: number) => { x: number; y: number };
  sx: (wx: number) => number;
  sy: (wy: number) => number;
}

/** The auto-fit scale that makes the whole battle fit the canvas at zoom = 1. */
export function fitScale(width: number, height: number, bounds: Bounds): number {
  const rangeX = Math.max(bounds.maxX - bounds.minX, 1);
  const rangeY = Math.max(bounds.maxY - bounds.minY, 1);
  return Math.min((width - CAMERA_PAD * 2) / rangeX, (height - CAMERA_PAD * 2) / rangeY);
}

/** Build a Transform from an absolute scale, world centre, and projection
 *  (defaulting to the flat top-down mapping). */
export function makeTransform(
  width: number,
  height: number,
  scale: number,
  centreX: number,
  centreY: number,
  projection: Projection = FLAT_PROJECTION,
): Transform {
  const project = (wx: number, wy: number) => {
    const d = projection.project(wx - centreX, wy - centreY);
    return { x: width / 2 + d.x * scale, y: height / 2 + d.y * scale };
  };
  const sx = (wx: number) => project(wx, centreY).x;
  const sy = (wy: number) => project(centreX, wy).y;
  return { scale, centreX, centreY, width, height, projection, project, sx, sy };
}

/** Centre of a bounds box. */
function boundsCentre(b: Bounds): { x: number; y: number } {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Extra world-space margin around the live-ships box so ships are framed with
 *  breathing room rather than pinned to the canvas edge. A fraction of the box
 *  plus a fixed few cells (so a lone ship is not zoomed in absurdly far). */
const LIVE_FIT_MARGIN_FRACTION = 0.12;
const LIVE_FIT_MARGIN_CELLS = 6;

/**
 * The bounding box of the frame's live ships, each expanded by its hull radius,
 * or `null` when no ship is alive (e.g. the final frame of a wipe). Drives the
 * auto-fit camera so the view tracks the surviving fleets each tick.
 */
export function liveShipsBounds(
  frame: BattleFrame,
  descriptors: DescriptorMap,
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const s of frame.ships) {
    if (!s.alive) continue;
    const r = hullRadiusWorld(descriptors.get(s.instanceId)) ?? CELL_SIZE * 2;
    minX = Math.min(minX, s.x - r);
    maxX = Math.max(maxX, s.x + r);
    minY = Math.min(minY, s.y - r);
    maxY = Math.max(maxY, s.y + r);
    any = true;
  }
  return any ? { minX, maxX, minY, maxY } : null;
}

/** Pad a live-ships box with the framing margin. */
function padLiveBounds(b: Bounds): Bounds {
  const padX = (b.maxX - b.minX) * LIVE_FIT_MARGIN_FRACTION + CELL_SIZE * LIVE_FIT_MARGIN_CELLS;
  const padY = (b.maxY - b.minY) * LIVE_FIT_MARGIN_FRACTION + CELL_SIZE * LIVE_FIT_MARGIN_CELLS;
  return {
    minX: b.minX - padX,
    maxX: b.maxX + padX,
    minY: b.minY - padY,
    maxY: b.maxY + padY,
  };
}

/**
 * Resolve the draw transform for a frame, honouring the camera's `autoFit` mode.
 * When auto-fitting, the transform frames this frame's live ships (falling back
 * to the whole-battle bounds only if no ship is alive). Otherwise it is the
 * manual absolute-scale transform: `baseScale * zoom`, centred on the followed
 * ship's live position or the stored centre. Used by both the draw loop and the
 * pointer-math so clicks/zoom resolve against exactly what is on screen.
 */
export function resolveViewTransform(
  width: number,
  height: number,
  staticBounds: Bounds,
  camera: Camera,
  frame: BattleFrame,
  descriptors: DescriptorMap,
): Transform {
  if (camera.autoFit) {
    const live = liveShipsBounds(frame, descriptors);
    const box = live !== null ? padLiveBounds(live) : staticBounds;
    const c = boundsCentre(box);
    return makeTransform(width, height, fitScale(width, height, box), c.x, c.y);
  }
  const followPos =
    camera.followId !== null
      ? frame.ships.find((s) => s.instanceId === camera.followId)
      : undefined;
  const scale = camera.baseScale * camera.zoom;
  const centreX = followPos !== undefined ? followPos.x : camera.centreX;
  const centreY = followPos !== undefined ? followPos.y : camera.centreY;
  return makeTransform(width, height, scale, centreX, centreY);
}

/**
 * The manual camera that reproduces the given resolved transform: the current
 * scale becomes the `baseScale` (so `zoom` starts at 1 = 100%) and the current
 * centre is captured. Used to break out of auto-fit continuously — the manual
 * view picks up exactly where the auto-fit left off.
 */
export function manualCameraFrom(t: Transform): Camera {
  return {
    autoFit: false,
    zoom: 1,
    baseScale: t.scale,
    centreX: t.centreX,
    centreY: t.centreY,
    followId: null,
  };
}

/** Screen pixel -> world coordinate, the exact inverse of a Transform's
 *  projection (so it is correct for both flat and isometric). */
export function screenToWorld(t: Transform, px: number, py: number): { x: number; y: number } {
  const d = t.projection.unproject((px - t.width / 2) / t.scale, (py - t.height / 2) / t.scale);
  return { x: t.centreX + d.x, y: t.centreY + d.y };
}

/** Clamp a zoom value to the camera's allowed range. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * A ship's world-space pick radius (its hull extent plus the cell size). Derived
 * from the static cell layout in the ship's descriptor; falls back to a small
 * fixed radius when the ship has no cell data (a legacy aggregated ship or a
 * phantom).
 */
function shipPickRadius(descriptors: DescriptorMap, instanceId: string): number {
  const r = hullRadiusWorld(descriptors.get(instanceId));
  return r ?? CELL_SIZE * 2;
}

/**
 * Hit-test a click (in world coordinates) against the frame's living ships,
 * returning the nearest ship whose pick radius contains the point, or undefined.
 * The descriptor map supplies each ship's static cell layout to size its pick
 * radius (the frames no longer carry cell positions).
 */
export function pickShipAt(
  frame: BattleFrame,
  world: { x: number; y: number },
  descriptors: DescriptorMap,
): BattleFrame["ships"][number] | undefined {
  let best: BattleFrame["ships"][number] | undefined;
  let bestDistSq = Infinity;
  for (const s of frame.ships) {
    if (!s.alive) continue;
    const dx = s.x - world.x;
    const dy = s.y - world.y;
    const distSq = dx * dx + dy * dy;
    const r = shipPickRadius(descriptors, s.instanceId);
    if (distSq <= r * r && distSq < bestDistSq) {
      best = s;
      bestDistSq = distSq;
    }
  }
  return best;
}
