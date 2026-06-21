import type { OverlayCtx, OverlayDef } from "./types";
import { SIDE_COLOUR } from "@/ui/routes/battleConstants";
import {
  isSectorCoverage,
  sectorAngles,
} from "@/ui/routes/battleFog";

/** Stroke width of a sensor coverage outline, in display pixels. */
const COVERAGE_STROKE_WIDTH = 1.5;

/** Alpha of the sensor coverage outline — legible but not loud. */
const COVERAGE_STROKE_ALPHA = 0.3;

/**
 * Draw sensor coverage geometry as outlines only (stroke, no fill). Unlike the
 * fog-of-war renderer this does not draw the fog shroud, so the coverage shapes
 * are readable in open space even when fog is off. Tinted by cluster side.
 */
function drawSensorCoverage(c: OverlayCtx): void {
  const { ctx, frame, t } = c;

  if (frame.awareness === undefined) return;

  ctx.save();
  ctx.lineWidth = COVERAGE_STROKE_WIDTH;
  ctx.globalAlpha = COVERAGE_STROKE_ALPHA;
  ctx.setLineDash([]);

  for (const cluster of frame.awareness.clusters) {
    ctx.strokeStyle = SIDE_COLOUR[cluster.side];

    for (const cov of cluster.coverage) {
      const px = t.sx(cov.x);
      const py = t.sy(cov.y);
      const rPx = cov.r * t.scale;

      ctx.beginPath();
      if (isSectorCoverage(cov)) {
        const { start, end } = sectorAngles(cov.bearing, cov.arc);
        ctx.moveTo(px, py);
        ctx.arc(px, py, rPx, start, end);
        ctx.closePath();
      } else {
        ctx.arc(px, py, rPx, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Sensor coverage overlay: renders per-ship sensor reach. */
export const sensorCoverage: OverlayDef = {
  id: "sensor-coverage",
  label: "Sensor coverage",
  defaultOn: false,
  defaultScope: "all",
  draw: drawSensorCoverage,
};
