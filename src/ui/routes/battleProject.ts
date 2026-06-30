import type { Transform } from "./battleCamera";

/**
 * World-space drawing helpers that honour the transform's projection, so the
 * battle's overlay/fog/anomaly layers tilt correctly under the isometric view
 * (and stay axis-aligned under the flat one). The battle draw loop historically
 * drew these in screen space via `t.sx`/`t.sy`, which are only valid for the flat
 * projection (screen-x depends on both world axes under iso). These helpers go
 * through `t.project` instead.
 *
 * Circles and arcs are traced as projected line segments rather than `ctx.arc`:
 * a world circle is an ellipse under iso, and sampling-then-projecting renders the
 * correct shape for any projection while keeping the stroke width uniform (the
 * path is built in screen space, so the line is not scaled by the projection).
 */

/** Default number of segments for a full circle; arcs scale down by their span. */
const CIRCLE_SEGMENTS = 64;

/**
 * Append a world arc (centre `cx,cy`, world radius `r`, swept from `a0` to `a1`
 * in world radians) to the current path as projected segments. The caller owns
 * `beginPath`/`fill`/`stroke`. For a filled sector, `moveTo` the projected centre
 * first, then call this, then `closePath`.
 */
export function appendWorldArc(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  cx: number,
  cy: number,
  r: number,
  a0 = 0,
  a1 = Math.PI * 2,
  segments = CIRCLE_SEGMENTS,
): void {
  const span = Math.abs(a1 - a0);
  const n = Math.max(6, Math.ceil((segments * span) / (Math.PI * 2)));
  // One reusable scratch per arc (not per segment) — appendWorldArc is the
  // hottest projection site (~65 segments/arc), so this avoids ~65 allocations
  // per arc per frame.
  const p = { x: 0, y: 0 };
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    t.projectInto(p, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
}

/**
 * Run `draw` with the canvas transformed so that drawing in world-unit deltas
 * around (cx, cy) lands on screen under the active projection — a unit circle
 * becomes the projected ellipse. Use for radial gradients (which can't be traced
 * as explicit world arcs). Inside `draw`, all coordinates, radii and stroke
 * widths are in WORLD units (so they scale and tilt with the view); a radial
 * gradient built here is squashed into the iso plane by the transform.
 */
export function withWorldTransform(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  cx: number,
  cy: number,
  draw: () => void,
): void {
  const o = t.project(cx, cy);
  const ex = t.project(cx + 1, cy);
  const ey = t.project(cx, cy + 1);
  ctx.save();
  ctx.transform(ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y);
  draw();
  ctx.restore();
}

/** Begin and trace a full world circle as a closed projected loop. */
export function pathWorldCircle(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  cx: number,
  cy: number,
  r: number,
  segments = CIRCLE_SEGMENTS,
): void {
  ctx.beginPath();
  appendWorldArc(ctx, t, cx, cy, r, 0, Math.PI * 2, segments);
  ctx.closePath();
}

/**
 * Begin and trace a world sector (a filled/stroked wedge): projected centre, out
 * to the arc, swept `a0..a1`, and closed back to the centre.
 */
export function pathWorldSector(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  segments = CIRCLE_SEGMENTS,
): void {
  const centre = t.project(cx, cy);
  ctx.beginPath();
  ctx.moveTo(centre.x, centre.y);
  appendWorldArc(ctx, t, cx, cy, r, a0, a1, segments);
  ctx.closePath();
}
