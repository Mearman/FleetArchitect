import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Trackpad pinch-to-zoom over a scrollable (`overflow: auto`) viewport. Two
 * fingers scroll the viewport natively (pan); a pinch arrives in Chrome as a
 * `ctrl`+wheel event, which the browser would otherwise hijack as page zoom, so
 * we intercept it (a non-passive listener so `preventDefault` takes) and adjust
 * the caller's zoom about the cursor. To keep the point under the cursor fixed
 * we record the target scroll and re-apply it after the new scale has laid out.
 *
 * @returns a ref to attach to the scroll viewport element.
 */
export function usePinchZoom(
  setZoom: (update: (z: number) => number) => void,
  min: number,
  max: number,
  zoom: number,
): RefObject<HTMLDivElement | null> {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const vp = viewportRef.current;
    if (vp === null) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return; // plain two-finger scroll -> native pan
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const contentX = vp.scrollLeft + offsetX;
      const contentY = vp.scrollTop + offsetY;
      const factor = Math.exp(-e.deltaY * 0.01);
      setZoom((z) => {
        const nz = Math.max(min, Math.min(max, z * factor));
        const ratio = nz / z;
        pendingScroll.current = {
          x: contentX * ratio - offsetX,
          y: contentY * ratio - offsetY,
        };
        return nz;
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      vp.removeEventListener("wheel", onWheel);
    };
  }, [setZoom, min, max]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (vp !== null && pendingScroll.current !== null) {
      vp.scrollLeft = pendingScroll.current.x;
      vp.scrollTop = pendingScroll.current.y;
      pendingScroll.current = null;
    }
  }, [zoom]);

  return viewportRef;
}
