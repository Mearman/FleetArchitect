import { CELL_SIZE } from "@/domain/grid";
import type { OverlayCtx, OverlayDef } from "./types";

/** Stroke width of the focus ring, in display pixels. */
const FOCUS_RING_WIDTH = 2;

/** Alpha of the focus ring on the followed (active) ship. */
const FOCUS_ACTIVE_ALPHA = 0.9;

/** Alpha of the focus ring on non-followed in-scope ships. */
const FOCUS_FAINT_ALPHA = 0.18;

/** Small fixed radius fallback for ships with no module data, in display pixels. */
const FALLBACK_RADIUS_PX = 11;

/**
 * Draw a ring around each in-scope, alive ship. The followed ship gets a bright
 * solid ring; other in-scope ships get a faint ring. Ring radius is derived
 * from the farthest module distance (matching BattleRoute's hullRadiusPx logic),
 * falling back to a small fixed radius when module data is absent.
 */
function drawFocusRing(c: OverlayCtx): void {
  const { ctx, frame, t, inScope, followId } = c;

  ctx.save();
  ctx.setLineDash([]);

  for (const ship of frame.ships) {
    if (!inScope(ship)) continue;
    if (!ship.alive) continue;

    const px = t.sx(ship.x);
    const py = t.sy(ship.y);

    // Derive ring radius from farthest module distance (same logic as
    // BattleRoute's hullRadiusPx), falling back to a small fixed radius.
    let radiusPx = FALLBACK_RADIUS_PX;
    if (ship.modules !== undefined && ship.modules.length > 0) {
      let maxDistSq = 0;
      for (const m of ship.modules) {
        const d = m.x * m.x + m.y * m.y;
        if (d > maxDistSq) maxDistSq = d;
      }
      radiusPx = (Math.sqrt(maxDistSq) + CELL_SIZE) * t.scale + 3;
    }

    const isFollowed = ship.instanceId === followId;
    const colour = ship.side === "attacker" ? "#ff6b5a" : "#5ab0ff";
    ctx.strokeStyle = colour;
    ctx.lineWidth = isFollowed ? FOCUS_RING_WIDTH : 1;
    ctx.globalAlpha = isFollowed ? FOCUS_ACTIVE_ALPHA : FOCUS_FAINT_ALPHA;
    ctx.beginPath();
    ctx.arc(px, py, radiusPx + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/** Focus ring overlay: highlights the in-scope ship(s) with a ring. */
export const focusRing: OverlayDef = {
  id: "focus-ring",
  label: "Focus ring",
  defaultOn: false,
  defaultScope: "active",
  draw: drawFocusRing,
};
