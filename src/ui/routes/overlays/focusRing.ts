import { hullRadiusWorld } from "@/ui/cellLayout";
import { PHOSPHOR_GREEN } from "@/ui/theme/tokens";
import { pathWorldCircle } from "@/ui/routes/battleProject";
import type { OverlayCtx, OverlayDef } from "./types";

/** Stroke width of the focus ring on the followed ship, in display pixels. */
const FOCUS_RING_WIDTH = 2;

/** Stroke width of the faint ring on non-followed in-scope ships, in display
 *  pixels. Thin so the dashed outline reads as a subtle marker. */
const FAINT_RING_WIDTH = 1;

/** Dash pattern for the faint ring. Dashed so it is visually distinct from
 *  BattleRoute's solid side-outline ring (same radius band, side colour) that
 *  would otherwise swallow a solid faint stroke. */
const FAINT_RING_DASH: readonly [number, number] = [4, 3];

/** Alpha of the focus ring on the followed (active) ship. */
const FOCUS_ACTIVE_ALPHA = 0.9;

/** Alpha of the faint ring on non-followed in-scope ships. Kept low so the
 *  followed ship remains the clear focal point. */
const FOCUS_FAINT_ALPHA = 0.4;

/** Colour of the faint ring on non-followed in-scope ships. White reads
 *  against both the attacker red and defender blue side-outline rings drawn
 *  by BattleRoute at the same radius, which a side-coloured faint ring would
 *  blend into and vanish. */
const FAINT_RING_COLOUR = "#ffffff";

/** Small fixed radius fallback for ships with no module data, in display pixels. */
const FALLBACK_RADIUS_PX = 11;

/**
 * Draw a ring around each in-scope, alive ship. The followed ship gets a bright
 * solid ring; other in-scope ships get a faint ring. Ring radius is derived
 * from the farthest module distance (matching BattleRoute's hullRadiusPx logic),
 * falling back to a small fixed radius when module data is absent.
 */
function drawFocusRing(c: OverlayCtx): void {
  const { ctx, frame, t, inScope, followId, descriptors } = c;

  ctx.save();
  ctx.setLineDash([]);

  for (const ship of frame.ships) {
    if (!inScope(ship)) continue;
    if (!ship.alive) continue;

    const { x: px, y: py } = t.project(ship.x, ship.y);

    // Derive ring radius from the farthest cell distance (same logic as
    // BattleRoute's side-outline ring), falling back to a small fixed radius.
    // The cell extent comes from the ship's static descriptor.
    const hullRadius = hullRadiusWorld(descriptors.get(ship.instanceId));

    const isFollowed = ship.instanceId === followId;
    if (isFollowed) {
      // Followed ship: bright solid phosphor-green ring (the friendly/focus
      // channel), sitting just outside BattleRoute's side-outline ring.
      ctx.strokeStyle = PHOSPHOR_GREEN;
      ctx.lineWidth = FOCUS_RING_WIDTH;
      ctx.globalAlpha = FOCUS_ACTIVE_ALPHA;
      ctx.setLineDash([]);
    } else {
      // Non-followed in-scope ship: thin dashed white ring so it reads against
      // BattleRoute's solid side-coloured outline at the same radius (which a
      // side-coloured solid faint ring would be invisible against).
      ctx.strokeStyle = FAINT_RING_COLOUR;
      ctx.lineWidth = FAINT_RING_WIDTH;
      ctx.globalAlpha = FOCUS_FAINT_ALPHA;
      ctx.setLineDash([...FAINT_RING_DASH]);
    }
    ctx.beginPath();
    if (hullRadius !== undefined) {
      // hull + 3px cell gap + 4px ring offset; the pixel gaps mapped to world
      // units so the ring tilts into an ellipse on the ship plane under iso.
      pathWorldCircle(ctx, t, ship.x, ship.y, hullRadius + 7 / t.scale);
    } else {
      ctx.arc(px, py, FALLBACK_RADIUS_PX + 4, 0, Math.PI * 2);
    }
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
