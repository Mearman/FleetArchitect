import type { OverlayDef } from "./types";
import { targetLock } from "./targetLock";
import { focusRing } from "./focusRing";
import { sensorCoverage } from "./sensorCoverage";
import { movementTrail } from "./movementTrail";
import { damagePulse } from "./damagePulse";

export type { OverlayCtx, OverlayDef, OverlayScope } from "./types";

/**
 * Registry of all battle overlays, in a stable display order. Under-ship
 * overlays (focus ring, sensor coverage, movement trail) are drawn before the
 * ship loop; over-ship overlays (target lock, damage pulse) after it. BattleRoute
 * partitions this list by id to decide layering — see UNDER_SHIP_IDS below.
 */
export const OVERLAYS: readonly OverlayDef[] = [
  focusRing,
  sensorCoverage,
  movementTrail,
  targetLock,
  damagePulse,
];

/** Overlay ids drawn beneath the ship layer (before the ship loop). */
export const UNDER_SHIP_IDS: ReadonlySet<string> = new Set([
  focusRing.id,
  sensorCoverage.id,
  movementTrail.id,
]);

/** Overlay ids drawn above the ship layer (after the ship loop). */
export const OVER_SHIP_IDS: ReadonlySet<string> = new Set([
  targetLock.id,
  damagePulse.id,
]);
