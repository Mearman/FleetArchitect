/**
 * Per-stance tactical doctrine tables (authored catalogue content). A ship's
 * effective {@link ShipStance} — its base stance, or an `aiStance` override set
 * by a `setStance` rule — drives two engagement choices through these tables:
 *
 *  - `STANCE_RANGE_FACTOR`: the multiplier on the desired stand-off range, so an
 *    aggressive stance fights close and a sniper stance holds long;
 *  - `STANCE_TARGET_DISTANCE_BIAS`: a signed near(+)/far(−) target preference
 *    blended into the target score, so an aggressive stance prefers the nearest
 *    enemy and a defensive/sniper stance prefers a more distant one.
 *
 * Both are keyed by every {@link ShipStance} value, so the lookup is total and
 * needs no fallback. A `balanced` (and default) stance carries the neutral
 * values (range factor 1, distance bias 0), so a rule-less default-stance ship
 * behaves byte-identically to before stance was wired into movement/targeting.
 *
 * These live in their own leaf — separate from the bulk `SIM` constants in
 * `config.ts` — because they form a single cohesive doctrine group and keep the
 * config module within its size budget. `SIM` re-exports them as
 * `SIM.stanceRangeFactor` / `SIM.stanceTargetDistanceBias` so existing readers
 * are unchanged.
 */

import type { ShipStance } from "@/schema/ai";

/**
 * Multiplier applied to the desired engagement range per stance. A stance's
 * tactical preference for closeness (< 1) or distance (> 1).
 */
export const STANCE_RANGE_FACTOR: Record<ShipStance, number> = {
  aggressive: 0.8,
  balanced: 1.0,
  defensive: 1.15,
  evasive: 1.4,
  interceptor: 0.6,
  escort: 1.0,
  sniper: 2.0,
  hold: 1.0,
  retreat: 2.5,
};

/**
 * Signed preference for engaging NEAR (positive) vs FAR (negative) targets, in
 * [-1, 1]. Blended into the target score by `scoreEnemy` (which documents the
 * blend). 0 contributes nothing, so a `balanced`/default stance targets exactly
 * as before.
 */
export const STANCE_TARGET_DISTANCE_BIAS: Record<ShipStance, number> = {
  aggressive: 0.4,
  balanced: 0,
  defensive: -0.4,
  evasive: -0.4,
  interceptor: 0.5,
  escort: 0,
  sniper: -0.6,
  hold: 0,
  retreat: 0,
};
