import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Trackpad pinch-to-zoom over a scrollable (`overflow: auto`) viewport. Two
 * fingers scroll the viewport natively (pan); a pinch arrives in Chrome as a
 * `ctrl`+wheel event, which the browser would otherwise hijack as page zoom, so
 * we intercept it (a non-passive listener so `preventDefault` takes) and adjust
 * the caller's zoom about the cursor. To keep the point under the cursor fixed
 * we record the target scroll and re-apply it after the new scale has laid out.
 *
 * Returns a *callback ref*: the viewport may mount after the consumer's first
 * render (e.g. behind a loading state), and a callback ref re-runs attach/detach
 * exactly when the node appears — a plain ref-object effect would attach once
 * against a null node and never retry. The node is held in a ref for the
 * scroll-position writes (the sanctioned mutable handle) and mirrored into state
 * only to re-trigger the listener effect when it mounts.
 *
 * @returns a callback ref to attach to the scroll viewport element.
 */
export function usePinchZoom(
  setZoom: (update: (z: number) => number) => void,
  min: number,
  max: number,
  zoom: number,
): (node: HTMLDivElement | null) => void {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState<HTMLDivElement | null>(null);
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);

  const attach = useCallback((node: HTMLDivElement | null) => {
    elRef.current = node;
    setMounted(node);
  }, []);

  useEffect(() => {
    const node = elRef.current;
    if (node === null) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return; // plain two-finger scroll -> native pan
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const contentX = node.scrollLeft + offsetX;
      const contentY = node.scrollTop + offsetY;
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
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
    };
  }, [mounted, setZoom, min, max]);

  useLayoutEffect(() => {
    const node = elRef.current;
    const pending = pendingScroll.current;
    if (node !== null && pending !== null) {
      node.scrollLeft = pending.x;
      node.scrollTop = pending.y;
      pendingScroll.current = null;
    }
  }, [zoom]);

  return attach;
}
