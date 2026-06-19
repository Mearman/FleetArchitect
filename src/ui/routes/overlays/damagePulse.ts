import type { OverlayCtx, OverlayDef } from "./types";

/** Colour of a damage pulse ring. Hot orange-red so a hit reads instantly even
 *  against a busy battlefield. */
const DAMAGE_COLOUR = "#ff5a5a";

/** Alpha of a damage pulse ring. Moderate so the pulse does not dominate the
 *  ship beneath it. */
const DAMAGE_ALPHA = 0.55;

/** Stroke width of a damage pulse ring, in display pixels. */
const DAMAGE_WIDTH = 2;

/** Radius (in screen pixels) at the small end of a hit. Maps to the smallest
 *  structure loss that still registers a pulse. */
const RADIUS_MIN = 6;

/** Upper clamp on pulse radius so a single huge hit does not cover the screen. */
const RADIUS_MAX = 40;

/** Scale factor converting a structure-delta into screen-pixel radius. Sized so
 *  a typical small-arms hit lands near `RADIUS_MIN` and a heavy hit approaches
 *  `RADIUS_MAX`. */
const RADIUS_PER_HP = 0.8;

/** Additional alpha per point of structure lost, layered on top of
 *  `DAMAGE_ALPHA` so heavier hits brighten toward fully opaque. */
const ALPHA_PER_HP = 0.02;

/**
 * Damage pulse: for each in-scope alive ship that lost structure between the
 * previous discrete tick and the current one, draws an expanding ring centred
 * on the ship whose radius grows with the damage delta. A bigger hit draws a
 * bigger, brighter ring. Uses the discrete frame history directly, so deltas
 * are exact (no interpolation error).
 */
export function drawDamagePulse(c: OverlayCtx): void {
  const { ctx, frame, t, tick, frames, inScope } = c;
  if (tick <= 0) return;

  const prev = frames[tick - 1];
  if (prev === undefined) return;

  // Index previous-frame structure by instance id for O(1) lookup. Only ships
  // present in the previous frame can have a meaningful delta.
  const prevStructure = new Map<string, number>();
  for (const s of prev.ships) {
    prevStructure.set(s.instanceId, s.structure);
  }

  ctx.save();
  ctx.strokeStyle = DAMAGE_COLOUR;
  ctx.lineWidth = DAMAGE_WIDTH;
  ctx.setLineDash([]);
  ctx.globalAlpha = DAMAGE_ALPHA;

  for (const ship of frame.ships) {
    if (!inScope(ship) || !ship.alive) continue;
    const before = prevStructure.get(ship.instanceId);
    if (before === undefined) continue;
    const delta = before - ship.structure;
    if (delta <= 0) continue;

    const radius = Math.min(RADIUS_MAX, RADIUS_MIN + delta * RADIUS_PER_HP);
    // Brighten with magnitude: heavier hits push alpha above the baseline up
    // toward fully opaque.
    ctx.globalAlpha = Math.min(1, DAMAGE_ALPHA + delta * ALPHA_PER_HP);
    ctx.beginPath();
    ctx.arc(t.sx(ship.x), t.sy(ship.y), radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Overlay definition: damage-pulse rings drawn above the ship layer. */
export const damagePulse: OverlayDef = {
  id: "damage-pulse",
  label: "Damage pulse",
  defaultOn: false,
  defaultScope: "all",
  draw: drawDamagePulse,
};
