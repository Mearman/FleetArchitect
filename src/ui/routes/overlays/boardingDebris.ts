import { CELL_SIZE } from "@/domain/grid";
import { pathWorldCircle } from "@/ui/routes/battleProject";
import type { OverlayCtx, OverlayDef } from "./types";

/** Fill colour for a debris fragment polygon. */
const DEBRIS_FILL = "#8a8090";

/** Stroke colour for a debris fragment polygon. */
const DEBRIS_STROKE = "#c0b8c8";

/** Fill colour for a salvageable debris fragment. */
const SALVAGE_FILL = "#b09a40";

/** Radius of the yellow salvage-indicator dot, in world units (about two-fifths
 *  of a cell), so it tilts and scales with the view. */
const SALVAGE_DOT_RADIUS = CELL_SIZE * 0.4;

/** Alpha for debris fragments — faint so they don't drown the main battle. */
const DEBRIS_ALPHA = 0.65;

/** Minimum world radius of a debris fragment so distant rocks stay visible. */
const DEBRIS_MIN_WORLD = CELL_SIZE * 0.3;

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
    // World radius of the fragment, floored so tiny rocks stay visible. Drawn in
    // world space so the diamond and salvage dot tilt and scale with the view.
    const rW = Math.max(DEBRIS_MIN_WORLD, d.radius);

    // Draw as a rotated square (diamond) for a rough, rocky look, projecting each
    // world vertex so it sits on the tilted plane under iso.
    const isSalvageable = d.salvageable === true;
    ctx.globalAlpha = DEBRIS_ALPHA;
    ctx.fillStyle = isSalvageable ? SALVAGE_FILL : DEBRIS_FILL;
    ctx.strokeStyle = DEBRIS_STROKE;
    ctx.lineWidth = 0.5;

    const top = t.project(d.x, d.y - rW);
    const right = t.project(d.x + rW * 0.7, d.y);
    const bottom = t.project(d.x, d.y + rW);
    const left = t.project(d.x - rW * 0.7, d.y);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(left.x, left.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (isSalvageable) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffe066";
      pathWorldCircle(ctx, t, d.x, d.y, SALVAGE_DOT_RADIUS);
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
