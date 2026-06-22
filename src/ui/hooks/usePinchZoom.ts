import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Trackpad pinch-to-zoom over a scrollable (`overflow: auto`) viewport, plus a
 * `zoomByStep` for button controls. Two fingers scroll the viewport natively
 * (pan); a pinch arrives in Chrome as a `ctrl`+wheel event, which the browser
 * would otherwise hijack as page zoom, so we intercept it (a non-passive
 * listener so `preventDefault` takes) and zoom about the cursor. Buttons zoom
 * about the viewport centre. Either way the anchor point stays fixed: we record
 * the target scroll and re-apply it after the new scale has laid out (otherwise
 * the content would grow from the layout's top-left corner).
 *
 * Returns a *callback ref* (the viewport may mount behind a loading state, and a
 * callback ref re-runs attach/detach when the node appears), the viewport's
 * measured size, and `zoomByStep`.
 */
export function usePinchZoom(
  setZoom: (update: (z: number) => number) => void,
  min: number,
  max: number,
  zoom: number,
): {
  ref: (node: HTMLDivElement | null) => void;
  width: number;
  height: number;
  zoomByStep: (delta: number) => void;
} {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);

  const attach = useCallback((node: HTMLDivElement | null) => {
    elRef.current = node;
    setMounted(node);
  }, []);

  // Zoom keeping the content point under (anchorX, anchorY) — viewport-relative
  // client coords — fixed. Records the post-scale scroll for the layout effect.
  const zoomAbout = useCallback(
    (computeNext: (z: number) => number, anchorX: number, anchorY: number) => {
      const node = elRef.current;
      if (node === null) return;
      const rect = node.getBoundingClientRect();
      const offsetX = anchorX - rect.left;
      const offsetY = anchorY - rect.top;
      const contentX = node.scrollLeft + offsetX;
      const contentY = node.scrollTop + offsetY;
      setZoom((z) => {
        const nz = Math.max(min, Math.min(max, computeNext(z)));
        const ratio = nz / z;
        pendingScroll.current = {
          x: contentX * ratio - offsetX,
          y: contentY * ratio - offsetY,
        };
        return nz;
      });
    },
    [setZoom, min, max],
  );

  const zoomByStep = useCallback(
    (delta: number) => {
      const node = elRef.current;
      if (node === null) return;
      const rect = node.getBoundingClientRect();
      zoomAbout((z) => z + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    [zoomAbout],
  );

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
      zoomAbout((z) => z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    mounted.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      mounted.removeEventListener("wheel", onWheel);
    };
  }, [mounted, zoomAbout]);

  useLayoutEffect(() => {
    const node = elRef.current;
    const pending = pendingScroll.current;
    if (node !== null && pending !== null) {
      node.scrollLeft = pending.x;
      node.scrollTop = pending.y;
      pendingScroll.current = null;
    }
  }, [zoom]);

  return { ref: attach, width: size.width, height: size.height, zoomByStep };
}
