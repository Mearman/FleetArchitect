import type { OverlayCtx, OverlayDef } from "./types";

/** Number of discrete frames to trace back from the current tick when building
 *  a ship's breadcrumb trail. Kept small so the overlay stays O(in-scope × N)
 *  per draw; large enough to show a readable wake behind a moving ship. */
const TRAIL_LENGTH = 20;

/** Stroke width of a trail segment, in display pixels. Thin so trails read as
 *  faint wakes rather than solid lines. */
const TRAIL_WIDTH = 1.5;

/** Alpha at the most recent end of the trail (newest position). Older segments
 *  fade linearly toward 0. */
const TRAIL_ALPHA_MAX = 0.5;

/**
 * Movement trail: draws a fading breadcrumb polyline behind each in-scope alive
 * ship, in that ship's side colour. Walks the discrete frame history backward
 * from the current tick, collecting (x, y) positions; the newest end is most
 * opaque and the oldest fades to nothing. Frames are discrete sim ticks (not
 * interpolated), so each collected position is exact.
 */
export function drawMovementTrail(c: OverlayCtx): void {
  const { ctx, frame, t, tick, frames, inScope } = c;
  // No history to trace into: either nothing has been recorded or the cursor
  // is at the very first frame.
  if (frames.length === 0 || tick <= 0) return;

  ctx.save();
  ctx.lineWidth = TRAIL_WIDTH;
  ctx.setLineDash([]);

  for (const ship of frame.ships) {
    if (!inScope(ship) || !ship.alive) continue;
    const colour = ship.side === "attacker" ? "#ff6b5a" : "#5ab0ff";

    // Walk backward through discrete frames, collecting alive positions for
    // this ship. Start at `tick - 1` since the current tick's position is the
    // ship itself (no segment to draw from it yet).
    const points: Array<{ x: number; y: number }> = [];
    const firstIdx = Math.max(0, tick - TRAIL_LENGTH);
    for (let i = tick - 1; i >= firstIdx; i--) {
      const f = frames[i];
      if (f === undefined) break;
      const past = f.ships.find((s) => s.instanceId === ship.instanceId);
      if (past === undefined || !past.alive) break;
      points.push({ x: past.x, y: past.y });
    }
    if (points.length === 0) continue;

    // Stroke segment-by-segment so each segment can carry its own alpha: the
    // newest segment (between points[0] and the ship) is most opaque, the
    // oldest fades to 0. points[0] is the newest collected position. Walk a
    // sliding pair so the type system narrows cleanly under
    // noUncheckedIndexedAccess.
    ctx.strokeStyle = colour;
    const segCount = points.length;
    // Anchor the newest end at the ship itself, then walk older positions.
    let toX = ship.x;
    let toY = ship.y;
    for (let i = 0; i < segCount; i++) {
      const from = points[i];
      if (from === undefined) break;
      // Linear fade: segment i=0 (newest) at TRAIL_ALPHA_MAX, last at ~0.
      const fade = 1 - i / segCount;
      ctx.globalAlpha = TRAIL_ALPHA_MAX * fade;
      ctx.beginPath();
      ctx.moveTo(t.sx(from.x), t.sy(from.y));
      ctx.lineTo(t.sx(toX), t.sy(toY));
      ctx.stroke();
      toX = from.x;
      toY = from.y;
    }
  }
  ctx.restore();
}

/** Overlay definition: movement-trail breadcrumbs drawn above the ship layer. */
export const movementTrail: OverlayDef = {
  id: "movement-trail",
  label: "Movement trail",
  defaultOn: false,
  defaultScope: "active",
  draw: drawMovementTrail,
};
