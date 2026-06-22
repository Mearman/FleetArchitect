import { useEffect, useMemo, useRef } from "react";
import type { ShipDesign } from "@/schema/ship";
import { designSprite } from "@/ui/shipThumbnail";

interface ShipThumbnailProps {
  design: ShipDesign;
  /** Square box edge in CSS pixels the sprite is letterboxed into. */
  size?: number;
  /** Optional accent for the empty-placeholder frame; defaults to a neutral hue. */
  accent?: string;
}

/** Default square edge for a thumbnail, in CSS pixels. */
const DEFAULT_SIZE = 96;

/** Placeholder frame colour when a design has no bakeable sprite. */
const PLACEHOLDER_ACCENT = "#4a4f55";

/**
 * Blit a design's baked battle sprite into a fixed-size, DPR-aware canvas,
 * scaled to fit while preserving aspect (letterboxed). The sprite is memoised by
 * the design's identity and revision so a browser full of cards re-bakes only
 * when a design actually changes. Renders an empty placeholder box when the
 * design has no sprite to draw.
 */
export function ShipThumbnail({ design, size = DEFAULT_SIZE, accent }: ShipThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The sprite depends only on the design's content; designs are immutable per
  // revision (a content change yields a fresh record with a bumped revision), so
  // keying the bake on the design reference re-bakes exactly when it changes.
  const sprite = useMemo(() => designSprite(design), [design]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const dpr = window.devicePixelRatio;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (sprite === undefined) return;

    // Letterbox the sprite into the square box, preserving aspect.
    const box = size * dpr;
    const scale = Math.min(box / sprite.width, box / sprite.height);
    const drawW = sprite.width * scale;
    const drawH = sprite.height * scale;
    const dx = (box - drawW) / 2;
    const dy = (box - drawH) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite.canvas, dx, dy, drawW, drawH);
  }, [sprite, size]);

  if (sprite === undefined) {
    return (
      <div
        style={{
          width: size,
          height: size,
          border: `1px solid ${accent === undefined ? PLACEHOLDER_ACCENT : accent}`,
          opacity: 0.4,
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: "block" }}
      aria-hidden="true"
    />
  );
}
