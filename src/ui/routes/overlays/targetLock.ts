import { SIDE_COLOUR } from "@/ui/routes/battleConstants";
import type { OverlayCtx, OverlayDef } from "./types";

/** Stroke width of a target-lock line, in display pixels. Kept thin so the
 *  overlay reads as a faint sight-line rather than a solid beam. */
const TARGET_LOCK_WIDTH = 1;

/** Alpha of a target-lock line. Subtle so the overlay does not dominate. */
const TARGET_LOCK_ALPHA = 0.35;

/**
 * Target-lock lines: for each in-scope ship with a live targetId, draw a thin
 * side-coloured line from the ship to its target. Only draws to alive targets;
 * a dead target has no lock to show. Side colours mirror BattleRoute's
 * attacker/defender palette (SIDE_COLOUR) so allegiance stays legible.
 */
export function drawTargetLock(c: OverlayCtx): void {
  const { ctx, frame, t, inScope } = c;
  // Index alive ships by instanceId for O(1) target lookup. Only alive ships
  // can be a lock target — a dead target has no lock to render.
  const alive = new Map<string, { x: number; y: number }>();
  for (const s of frame.ships) {
    if (s.alive) {
      alive.set(s.instanceId, { x: s.x, y: s.y });
    }
  }

  ctx.save();
  ctx.lineWidth = TARGET_LOCK_WIDTH;
  ctx.globalAlpha = TARGET_LOCK_ALPHA;
  ctx.setLineDash([]);

  for (const ship of frame.ships) {
    if (!inScope(ship)) continue;
    if (ship.targetId === undefined) continue;
    const target = alive.get(ship.targetId);
    if (target === undefined) continue;
    ctx.strokeStyle = SIDE_COLOUR[ship.side];
    const a = t.project(ship.x, ship.y);
    const b = t.project(target.x, target.y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Overlay definition: target-lock lines drawn above the ship layer. */
export const targetLock: OverlayDef = {
  id: "target-lock",
  label: "Target lock",
  defaultOn: true,
  defaultScope: "all",
  draw: drawTargetLock,
};
