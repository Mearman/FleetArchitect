import { useCallback, useEffect, useRef, useState } from "react";

/** Pan headroom beyond the content's half-extent, in cells: the grown hull
 *  overhangs the ship by ~1 cell, plus 1 grid square of margin. The pan limit
 *  lets that outer edge reach the centre of the viewport. */
const PAN_MARGIN_CELLS = 2;

interface PinchZoomOptions {
  setZoom: (update: (z: number) => number) => void;
  /** Zoom clamp range. */
  min: number;
  max: number;
  /** Current zoomed cell pitch in px (the nominal pitch times the zoom). */
  cellPx: number;
  /** The board grid's dimensions. The board is pinned to its own centre, which
   *  is stable across paints (only a zoom/viewport re-fit changes grid dims), so
   *  editing the ship never slides it out from under the cursor. The fit effect
   *  keeps the built content centred in the grid, so the ship stays visually
   *  centred too. */
  grid: { cols: number; rows: number };
  /** Built-content extent in cell units — bounds panning so the ship's edge can
   *  reach the viewport centre. */
  contentExtent: { cols: number; rows: number };
}

/**
 * Trackpad pinch-to-zoom and two-finger panning over the grid viewport, plus a
 * `zoomByStep` for button controls. A pinch arrives in Chrome as a `ctrl`+wheel
 * event (which the browser would otherwise hijack as page zoom), a plain
 * two-finger scroll as a wheel without `ctrl`; we intercept both with a
 * non-passive listener so `preventDefault` takes, mapping the former to zoom and
 * the latter to a pan offset.
 *
 * The viewport clips rather than scrolls: the caller sizes the grid to cover the
 * viewport at the current cell pitch, and this hook returns `boardTx`/`boardTy`,
 * a transform that pins the board centre to the viewport centre plus the pan
 * offset. Pan is clamped so the content edge — plus the hull overhang and a
 * square of margin — can reach the viewport centre but no further. It is all
 * computed each render from the measured viewport, so it never lags or wobbles
 * as the grid resizes.
 *
 * Returns a *callback ref* (the viewport may mount behind a loading state, and a
 * callback ref re-runs attach/detach when the node appears), the viewport's
 * measured size, `zoomByStep`, the centring transform, and `resetPan`.
 */
export function usePinchZoom({
  setZoom,
  min,
  max,
  cellPx,
  grid,
  contentExtent,
}: PinchZoomOptions): {
  ref: (node: HTMLDivElement | null) => void;
  width: number;
  height: number;
  zoomByStep: (delta: number) => void;
  boardTx: number;
  boardTy: number;
  resetPan: () => void;
} {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const attach = useCallback((node: HTMLDivElement | null) => {
    elRef.current = node;
    setMounted(node);
  }, []);

  const clamp = useCallback(
    (z: number) => Math.max(min, Math.min(max, z)),
    [min, max],
  );

  const zoomByStep = useCallback(
    (delta: number) => {
      setZoom((z) => clamp(z + delta));
    },
    [setZoom, clamp],
  );

  const resetPan = useCallback(() => setPan({ x: 0, y: 0 }), []);

  // Pan limit: bring the content edge (+ hull overhang + a square of margin) to
  // the viewport centre. Independent of viewport size. Mirrored to a ref so the
  // wheel listener clamps against the live limit without re-attaching on zoom.
  const panLimitX = (contentExtent.cols / 2 + PAN_MARGIN_CELLS) * cellPx;
  const panLimitY = (contentExtent.rows / 2 + PAN_MARGIN_CELLS) * cellPx;
  const panLimitRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    panLimitRef.current = { x: panLimitX, y: panLimitY };
  }, [panLimitX, panLimitY]);

  useEffect(() => {
    if (mounted === null) return;
    const measure = (): void =>
      setSize({ width: mounted.clientWidth, height: mounted.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(mounted);
    return () => {
      ro.disconnect();
    };
  }, [mounted]);

  useEffect(() => {
    if (mounted === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey) {
        setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.01)));
        return;
      }
      const lim = panLimitRef.current;
      setPan((p) => ({
        x: Math.max(-lim.x, Math.min(lim.x, p.x - e.deltaX)),
        y: Math.max(-lim.y, Math.min(lim.y, p.y - e.deltaY)),
      }));
    };
    mounted.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      mounted.removeEventListener("wheel", onWheel);
    };
  }, [mounted, setZoom, clamp]);

  // Clamp the stored pan to the current limit (it can fall out of range when a
  // zoom-out shrinks the limit) and position the board.
  const clampedPanX = Math.max(-panLimitX, Math.min(panLimitX, pan.x));
  const clampedPanY = Math.max(-panLimitY, Math.min(panLimitY, pan.y));
  // Pin the board's own centre (grid.cols/2, grid.rows/2) to the viewport centre
  // plus the pan offset. Keying off the grid centre — not the live content centre
  // — means a paint that extends the bounding box no longer slides the board; the
  // fit effect already keeps the content centred in the grid, so the ship stays put.
  const boardTx =
    size.width > 0
      ? size.width / 2 - (grid.cols / 2) * cellPx + clampedPanX
      : 0;
  const boardTy =
    size.height > 0
      ? size.height / 2 - (grid.rows / 2) * cellPx + clampedPanY
      : 0;

  return {
    ref: attach,
    width: size.width,
    height: size.height,
    zoomByStep,
    boardTx,
    boardTy,
    resetPan,
  };
}
