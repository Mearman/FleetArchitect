import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { interpolateFrame } from "@/ui/interpolateFrame";
import {
  clampZoom,
  DEFAULT_CAMERA,
  pickShipAt,
  resolveTransform,
  screenToWorld,
} from "./battleCamera";
import type { Bounds, Camera } from "./battleCamera";
import type { BattleFrame } from "@/schema/battle";
import { DEFAULT_BOUNDS } from "./battleConstants";

/**
 * Props for {@link useBattleCamera}. The canvas and camera refs are created by
 * the route (which needs the canvas ref for the JSX `ref` prop and the camera
 * ref for the draw loop) and passed in, so the hook does not return a ref
 * object — only state and callbacks. The hook also needs the playback clock
 * (for resolving the current frame when converting pointer coordinates to world
 * space), the frames accumulator (read by the rAF loop and pointer handlers),
 * and the running raw world bounds (the padded transform is derived from them).
 */
export interface UseBattleCameraProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  cameraRef: React.RefObject<Camera>;
  playbackTimeRef: React.RefObject<number>;
  framesRef: React.RefObject<BattleFrame[]>;
  rawBounds: Bounds | null;
  hasFrames: boolean;
}

/**
 * Camera, canvas sizing, and pointer handling for the BattleRoute. Owns the
 * canvas backing-store sizing, the camera state (zoom/pan/follow), the padded
 * view bounds memo, and the wheel/drag/click input handlers. The canvas element
 * ref and the camera ref mirror are route-level (passed in) so the JSX `ref`
 * prop and the draw loop can read them without the hook returning a ref object.
 *
 * The rAF draw loop reads `cameraRef` directly so it does not need `camera` in
 * its dependency list; pointer handlers read it via the same ref.
 */
export function useBattleCamera({
  canvasRef,
  cameraRef,
  playbackTimeRef,
  framesRef,
  rawBounds,
  hasFrames,
}: UseBattleCameraProps) {
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  /**
   * Camera state drives the world-to-display transform. `zoom` multiplies the
   * auto-fit scale; `panX`/`panY` shift the focus; `followId` pins the focus to
   * a ship. Kept in a ref as well so the rAF draw loop reads the live camera
   * without the effect needing `camera` in its dependency list (which would
   * restart the loop and reset the frame clock on every wheel tick or drag).
   */
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  // Mirror the live camera into a ref so the rAF draw loop and pointer handlers
  // read the current value without `camera` in their dependency lists. Synced in
  // an effect (never during render) per the react-hooks/refs rule.
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera, cameraRef]);

  // Padded view bounds, derived from the running min/max accumulated in the
  // onFrames handler. Recomputed whenever the raw extent grows (a fresh
  // `rawBounds` object), so the camera expands as the battle spreads instead of
  // being computed once over all frames. Same 8% + 40 padding as the original
  // all-frames pass.
  const bounds = useMemo<Bounds>(() => {
    if (rawBounds === null || !Number.isFinite(rawBounds.minX)) return DEFAULT_BOUNDS;
    const padX = (rawBounds.maxX - rawBounds.minX) * 0.08 + 40;
    const padY = (rawBounds.maxY - rawBounds.minY) * 0.08 + 40;
    return {
      minX: rawBounds.minX - padX,
      maxX: rawBounds.maxX + padX,
      minY: rawBounds.minY - padY,
      maxY: rawBounds.maxY + padY,
    };
  }, [rawBounds]);

  // Keep the canvas backing store matched to its CSS display size, with a DPR
  // multiplier for crisp lines. Without this the backing is the HTML default
  // 300x150 regardless of how big the canvas renders, and the browser scales
  // that tiny bitmap up to fill the box — a blurry smear. The effect depends
  // on `hasFrames` so it (re)runs when the canvas first mounts as the first
  // streamed batch lands.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const setBacking = () => {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw === 0 || ch === 0) return;
      const desiredW = cw * dpr;
      const desiredH = ch * dpr;
      // Only resize the backing when it actually changed — assigning to
      // canvas.width clears the bitmap, so guarding avoids a blank flash
      // when a new battle reuses the same-sized canvas element.
      if (canvas.width !== desiredW) canvas.width = desiredW;
      if (canvas.height !== desiredH) canvas.height = desiredH;
    };
    setBacking();
    const observer = new ResizeObserver(() => {
      setBacking();
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw === 0 || ch === 0) return;
      setCanvasSize({ width: cw, height: ch });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasFrames, canvasRef]);

  /** Pointer-drag state for panning, tracked in a ref to avoid re-renders. */
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * Resolve the transform exactly as `drawFrame` does, for pointer-space
   * conversions in the input handlers. Returns undefined when there is nothing
   * to draw or the canvas has no size yet.
   */
  const currentTransform = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || framesRef.current.length === 0) return undefined;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return undefined;
    const cam = cameraRef.current;
    const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
    const frame = interpolateFrame(framesRef.current, fractionalTick);
    const followPos =
      cam.followId !== null ? frame.ships.find((s) => s.instanceId === cam.followId) : undefined;
    return { t: resolveTransform(width, height, bounds, cam, followPos), frame };
  }, [bounds, canvasRef, cameraRef, framesRef, playbackTimeRef]);

  /** Canvas-relative pointer position from a pointer event. */
  const pointerPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  // Wheel-to-zoom is attached as a NON-passive native listener (not a React
  // onWheel prop): React registers wheel handlers as passive, so a synthetic
  // handler cannot call preventDefault, and the page would scroll while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !hasFrames) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const resolved = currentTransform();
      if (resolved === undefined) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const before = screenToWorld(resolved.t, px, py);
      setCamera((cam) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nextZoom = clampZoom(cam.zoom * factor);
        if (nextZoom === cam.zoom) return cam;
        // While following, keep the ship centred (zoom toward it, not the
        // cursor). Otherwise zoom toward the cursor: keep the world point under
        // it fixed by deriving the pan that maps `before` back to the cursor.
        if (cam.followId !== null) return { ...cam, zoom: nextZoom };
        const worldCentreX = (bounds.minX + bounds.maxX) / 2;
        const worldCentreY = (bounds.minY + bounds.maxY) / 2;
        const ratio = cam.zoom / nextZoom;
        const newCentreX = before.x - (before.x - resolved.t.centreX) * ratio;
        const newCentreY = before.y - (before.y - resolved.t.centreY) * ratio;
        return {
          ...cam,
          zoom: nextZoom,
          panX: newCentreX - worldCentreX,
          panY: newCentreY - worldCentreY,
        };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [hasFrames, currentTransform, bounds, canvasRef]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { px, py } = pointerPos(e);
    dragRef.current = { pointerId: e.pointerId, startX: px, startY: py, moved: false };
  }, []);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== e.pointerId) return;
      const resolved = currentTransform();
      if (resolved === undefined) return;
      const { px, py } = pointerPos(e);
      const dxPx = px - drag.startX;
      const dyPx = py - drag.startY;
      if (!drag.moved && Math.hypot(dxPx, dyPx) < 4) return;
      drag.moved = true;
      setDragging(true);
      drag.startX = px;
      drag.startY = py;
      // Convert the pixel delta to a world delta and shift the focus. Dragging
      // releases any follow lock so the player can free-look.
      const worldDx = dxPx / resolved.t.scale;
      const worldDy = dyPx / resolved.t.scale;
      setCamera((cam) => {
        const base = cam.followId !== null
          ? { panX: resolved.t.centreX - (bounds.minX + bounds.maxX) / 2, panY: resolved.t.centreY - (bounds.minY + bounds.maxY) / 2 }
          : { panX: cam.panX, panY: cam.panY };
        return {
          ...cam,
          followId: null,
          panX: base.panX - worldDx,
          panY: base.panY - worldDy,
        };
      });
    },
    [currentTransform, bounds],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (drag === null || drag.moved) return;
      // A click without drag: pick a ship to follow, or clear follow on empty space.
      const resolved = currentTransform();
      if (resolved === undefined) return;
      const { px, py } = pointerPos(e);
      const world = screenToWorld(resolved.t, px, py);
      const hit = pickShipAt(resolved.frame, world);
      setCamera((cam) => ({ ...cam, followId: hit?.instanceId ?? null }));
    },
    [currentTransform],
  );

  const resetCamera = useCallback(() => setCamera(DEFAULT_CAMERA), []);

  return {
    canvasSize,
    camera,
    setCamera,
    bounds,
    dragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    resetCamera,
    clampZoom,
  };
}
