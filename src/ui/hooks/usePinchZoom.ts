import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Trackpad pinch-to-zoom over a scrollable (`overflow: auto`) viewport, plus a
 * `zoomByStep` for button controls and a `centre` helper. A pinch arrives in
 * Chrome as a `ctrl`+wheel event, which the browser would otherwise hijack as
 * page zoom, so we intercept it (a non-passive listener so `preventDefault`
 * takes) and adjust the zoom; a plain two-finger scroll falls through to native
 * panning.
 *
 * Zoom here changes the grid's cell pitch, and the caller resizes the grid to
 * keep it covering the viewport at that pitch — so the board stays roughly
 * viewport-sized rather than scaling in pixels. Cursor-anchoring would be wrong
 * for that (there is nothing to scroll towards), so zoom simply re-centres the
 * board via `centre`, which the caller calls after each zoom/resize so a
 * cell-count change keeps the content pinned to the viewport centre.
 *
 * Returns a *callback ref* (the viewport may mount behind a loading state, and a
 * callback ref re-runs attach/detach when the node appears), the viewport's
 * measured size, `zoomByStep`, and `centre`.
 */
export function usePinchZoom(
  setZoom: (update: (z: number) => number) => void,
  min: number,
  max: number,
): {
  ref: (node: HTMLDivElement | null) => void;
  width: number;
  height: number;
  zoomByStep: (delta: number) => void;
  centre: () => void;
} {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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

  // Scroll the (viewport-covering) board so its centre sits at the viewport
  // centre. With the board sized to cover the viewport there is always enough
  // scroll range for this, so the content stays put across a cell-count change.
  const centre = useCallback(() => {
    const node = elRef.current;
    if (node === null) return;
    node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
    node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
  }, []);

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
      if (!e.ctrlKey) return; // plain two-finger scroll -> native pan
      e.preventDefault();
      setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.01)));
    };
    mounted.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      mounted.removeEventListener("wheel", onWheel);
    };
  }, [mounted, setZoom, clamp]);

  return { ref: attach, width: size.width, height: size.height, zoomByStep, centre };
}
