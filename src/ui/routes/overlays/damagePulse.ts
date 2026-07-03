import { CELL_SIZE } from "@/domain/grid";
import { NEON_MAGENTA } from "@/ui/theme/tokens";
import { pathWorldCircle } from "@/ui/routes/battleProject";
import type { OverlayCtx, OverlayDef } from "./types";
import { shipIndexFor } from "./shipIndex";

/** Colour of a damage pulse ring. Neon magenta — the weapons/damage channel —
 *  so a hit reads instantly even against a busy battlefield. */
const DAMAGE_COLOUR = NEON_MAGENTA;

/** Alpha of a damage pulse ring. Moderate so the pulse does not dominate the
 *  ship beneath it. */
const DAMAGE_ALPHA = 0.55;

/** Stroke width of a damage pulse ring, in display pixels. */
const DAMAGE_WIDTH = 2;

/** Radius (in world units) at the small end of a hit — a cell and a half — so
 *  the pulse is spatial: it tilts into an ellipse under iso and scales with the
 *  view. Maps to the smallest structure loss that still registers a pulse. */
const RADIUS_MIN = CELL_SIZE * 1.5;

/** Upper clamp on pulse radius (world units) so a single huge hit does not swamp
 *  the field. */
const RADIUS_MAX = CELL_SIZE * 12;

/** World units of radius added per point of structure lost. Sized so a typical
 *  small-arms hit lands near `RADIUS_MIN` and a heavy hit approaches
 *  `RADIUS_MAX`. */
const RADIUS_PER_HP = CELL_SIZE * 0.25;

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

  // Shared per-frame id→ship index for the PREVIOUS frame (built once per frame
  // identity — the cache is keyed on the frame object, so it serves any frame,
  // not just the current one). Only ships present in the previous frame can
  // have a meaningful delta.
  const prevShips = shipIndexFor(prev);

  ctx.save();
  ctx.strokeStyle = DAMAGE_COLOUR;
  ctx.lineWidth = DAMAGE_WIDTH;
  ctx.setLineDash([]);
  ctx.globalAlpha = DAMAGE_ALPHA;

  for (const ship of frame.ships) {
    if (!inScope(ship) || !ship.alive) continue;
    const before = prevShips.get(ship.instanceId)?.structure;
    if (before === undefined) continue;
    const delta = before - ship.structure;
    if (delta <= 0) continue;

    const radius = Math.min(RADIUS_MAX, RADIUS_MIN + delta * RADIUS_PER_HP);
    // Brighten with magnitude: heavier hits push alpha above the baseline up
    // toward fully opaque.
    ctx.globalAlpha = Math.min(1, DAMAGE_ALPHA + delta * ALPHA_PER_HP);
    pathWorldCircle(ctx, t, ship.x, ship.y, radius);
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
