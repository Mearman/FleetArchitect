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

  // Collect each in-scope alive ship's current position and side colour, keyed
  // by instanceId. Ships not in scope / dead have no trail to draw.
  const live = new Map<
    string,
    { x: number; y: number; colour: string }
  >();
  for (const ship of frame.ships) {
    if (!inScope(ship) || !ship.alive) continue;
    live.set(ship.instanceId, {
      x: ship.x,
      y: ship.y,
      colour: ship.side === "attacker" ? "#ff6b5a" : "#5ab0ff",
    });
  }
  if (live.size === 0) {
    ctx.restore();
    return;
  }

  // For each in-scope ship, accumulate the trail of past alive positions.
  // trails[instanceId] is ordered newest-first (index 0 = tick-1, the most
  // recent past position). A null entry marks "stop collecting for this ship":
  // once a ship is missing or dead in some historical frame, older positions
  // are not contiguous with its current wake and must not be drawn (mirrors
  // the original per-ship `break`).
  const trails = new Map<string, Array<{ x: number; y: number }>>();
  const stopped = new Set<string>();
  const firstIdx = Math.max(0, tick - TRAIL_LENGTH);
  for (let i = tick - 1; i >= firstIdx; i--) {
    const f = frames[i];
    if (f === undefined) break;
    // Build ONE per-frame index of {x, y, alive} so each in-scope ship is an
    // O(1) lookup rather than a frame.ships scan — mirrors damagePulse /
    // targetLock. Building the map is O(frame.ships); lookup is O(1) per
    // in-scope ship, so the overlay is O(in-scope × TRAIL_LENGTH + Σ
    // frame.ships) instead of quadratic in (in-scope × TRAIL_LENGTH ×
    // frame.ships).
    const frameIndex = new Map<
      string,
      { x: number; y: number; alive: boolean }
    >();
    for (const s of f.ships) {
      frameIndex.set(s.instanceId, { x: s.x, y: s.y, alive: s.alive });
    }
    for (const id of live.keys()) {
      if (stopped.has(id)) continue;
      const past = frameIndex.get(id);
      if (past === undefined || !past.alive) {
        stopped.add(id);
        continue;
      }
      let trail = trails.get(id);
      if (trail === undefined) {
        trail = [];
        trails.set(id, trail);
      }
      trail.push({ x: past.x, y: past.y });
    }
  }

  // Stroke each ship's trail: segment-by-segment so each segment carries its
  // own alpha. The newest segment (between trail[0] and the ship itself) is
  // most opaque; the oldest fades toward 0. Walk a sliding pair so the type
  // system narrows cleanly under noUncheckedIndexedAccess.
  for (const [id, ship] of live) {
    const trail = trails.get(id);
    if (trail === undefined || trail.length === 0) continue;
    ctx.strokeStyle = ship.colour;
    const segCount = trail.length;
    let toX = ship.x;
    let toY = ship.y;
    for (let i = 0; i < segCount; i++) {
      const from = trail[i];
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
