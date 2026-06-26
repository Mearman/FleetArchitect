import type { OverlayDef } from "./types";
import { targetLock } from "./targetLock";
import { focusRing } from "./focusRing";
import { movementTrail } from "./movementTrail";
import { damagePulse } from "./damagePulse";
import { sensorPulse } from "./sensorPulse";
import { atmosphereBreach } from "./atmosphereBreach";
import { boardingDebris } from "./boardingDebris";
import { mediumGlow } from "./mediumGlow";
import { mediumTrails } from "./mediumTrails";

export type { OverlayCtx, OverlayDef, OverlayScope } from "./types";

/**
 * Registry of all battle overlays, in a stable display order. Under-ship
 * overlays (focus ring, movement trail, atmosphere/breach) are drawn
 * before the ship loop; over-ship overlays (target lock, damage pulse,
 * sensor pulse, boarding/debris) after it. BattleRoute partitions this list by
 * id to decide layering — see UNDER_SHIP_IDS below.
 */
export const OVERLAYS: readonly OverlayDef[] = [
  focusRing,
  atmosphereBreach,
  movementTrail,
  targetLock,
  damagePulse,
  sensorPulse,
  boardingDebris,
  mediumGlow,
  mediumTrails,
];

/** Overlay ids drawn beneath the ship layer (before the ship loop).
 *  `mediumTrails` is registered beneath the ships so each exhaust/plume streak
 *  sits under its hull — the ship reads as the streak's source, with the bright
 *  end emerging from the engine position. It is ordered after `mediumGlow` so
 *  the fine streaks paint over the broad ambient haze (streaks on top of glow). */
export const UNDER_SHIP_IDS: ReadonlySet<string> = new Set([
  mediumGlow.id,
  mediumTrails.id,
  focusRing.id,
  atmosphereBreach.id,
  movementTrail.id,
]);

/** Overlay ids drawn above the ship layer (after the ship loop). */
export const OVER_SHIP_IDS: ReadonlySet<string> = new Set([
  targetLock.id,
  damagePulse.id,
  sensorPulse.id,
  boardingDebris.id,
]);
