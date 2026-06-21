import type { OverlayCtx, OverlayDef } from "./types";

/** Fill colour for a debris fragment polygon. */
const DEBRIS_FILL = "#8a8090";

/** Stroke colour for a debris fragment polygon. */
const DEBRIS_STROKE = "#c0b8c8";

/** Fill colour for a salvageable debris fragment. */
const SALVAGE_FILL = "#b09a40";

/** Radius of the yellow salvage-indicator dot, in display pixels. */
const SALVAGE_DOT_RADIUS = 2.5;

/** Alpha for debris fragments — faint so they don't drown the main battle. */
const DEBRIS_ALPHA = 0.65;

/** Minimum display radius of a debris fragment before it is clamped. */
const DEBRIS_MIN_PX = 1.5;

/** Maximum display radius so a massive hull fragment doesn't cover the screen. */
const DEBRIS_MAX_PX = 16;

/**
 * Boarding/debris overlay: renders drifting wreckage fragments from
 * frame.debris. Each fragment is drawn as a small polygon (a rotated square
 * scaled by its radius), with salvageable fragments marked by a yellow dot.
 *
 * Nothing is drawn if frame.debris is absent or empty.
 */
function drawBoardingDebris(c: OverlayCtx): void {
  const { ctx, frame, t } = c;

  if (frame.debris === undefined || frame.debris.length === 0) return;

  ctx.save();
  ctx.setLineDash([]);

  for (const d of frame.debris) {
    const px = t.sx(d.x);
    const py = t.sy(d.y);
    const rPx = Math.max(DEBRIS_MIN_PX, Math.min(DEBRIS_MAX_PX, d.radius * t.scale));

    // Draw as a rotated square (diamond) for a rough, rocky look.
    const isSalvageable = d.salvageable === true;
    ctx.globalAlpha = DEBRIS_ALPHA;
    ctx.fillStyle = isSalvageable ? SALVAGE_FILL : DEBRIS_FILL;
    ctx.strokeStyle = DEBRIS_STROKE;
    ctx.lineWidth = 0.5;

    ctx.beginPath();
    ctx.moveTo(px, py - rPx);
    ctx.lineTo(px + rPx * 0.7, py);
    ctx.lineTo(px, py + rPx);
    ctx.lineTo(px - rPx * 0.7, py);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (isSalvageable) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffe066";
      ctx.beginPath();
      ctx.arc(px, py, SALVAGE_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/** Boarding/debris overlay: drifting wreckage fragments, salvageable ones
 *  marked with a yellow dot. */
export const boardingDebris: OverlayDef = {
  id: "boarding-debris",
  label: "Debris and salvage",
  defaultOn: false,
  defaultScope: "all",
  draw: drawBoardingDebris,
};
