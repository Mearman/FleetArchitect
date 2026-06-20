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
 * Camera state. `zoom` multiplies the auto-fit scale (1 = whole battle visible).
 * `panX`/`panY` shift the focus point in world units away from the battle centre.
 * `followId` pins the focus to a ship's live position each frame; while set,
 * `panX`/`panY` are ignored (re-derived to keep the ship centred). A manual pan
 * clears `followId`.
 */
export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
  followId: string | null;
}

export const DEFAULT_CAMERA: Camera = { zoom: 1, panX: 0, panY: 0, followId: null };

/**
 * The resolved world-to-display mapping for one draw, given the canvas size,
 * the battle bounds, and the camera. `scale` is the fit scale times zoom;
 * `centreX`/`centreY` is the world point mapped to the canvas centre.
 */
export interface Transform {
  scale: number;
  centreX: number;
  centreY: number;
  width: number;
  height: number;
  sx: (wx: number) => number;
  sy: (wy: number) => number;
}

/** The auto-fit scale that makes the whole battle fit the canvas at zoom = 1. */
export function fitScale(width: number, height: number, bounds: Bounds): number {
  const rangeX = Math.max(bounds.maxX - bounds.minX, 1);
  const rangeY = Math.max(bounds.maxY - bounds.minY, 1);
  return Math.min((width - CAMERA_PAD * 2) / rangeX, (height - CAMERA_PAD * 2) / rangeY);
}

/**
 * Resolve the draw transform. When the camera is following a ship the focus is
 * that ship's current position; otherwise it is the battle centre shifted by the
 * pan offset. The focus world point is mapped to the canvas centre and the scale
 * is the fit scale times the camera zoom.
 */
export function resolveTransform(
  width: number,
  height: number,
  bounds: Bounds,
  camera: Camera,
  followPos: { x: number; y: number } | undefined,
): Transform {
  const scale = fitScale(width, height, bounds) * camera.zoom;
  const worldCentreX = (bounds.minX + bounds.maxX) / 2;
  const worldCentreY = (bounds.minY + bounds.maxY) / 2;
  const centreX = followPos !== undefined ? followPos.x : worldCentreX + camera.panX;
  const centreY = followPos !== undefined ? followPos.y : worldCentreY + camera.panY;
  const sx = (wx: number) => width / 2 + (wx - centreX) * scale;
  const sy = (wy: number) => height / 2 + (wy - centreY) * scale;
  return { scale, centreX, centreY, width, height, sx, sy };
}

/** Screen pixel -> world coordinate, the inverse of a Transform's sx/sy. */
export function screenToWorld(t: Transform, px: number, py: number): { x: number; y: number } {
  return {
    x: t.centreX + (px - t.width / 2) / t.scale,
    y: t.centreY + (py - t.height / 2) / t.scale,
  };
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
