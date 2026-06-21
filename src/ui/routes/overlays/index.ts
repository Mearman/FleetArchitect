import type { OverlayDef } from "./types";
import { targetLock } from "./targetLock";
import { focusRing } from "./focusRing";
import { sensorCoverage } from "./sensorCoverage";
import { movementTrail } from "./movementTrail";
import { damagePulse } from "./damagePulse";
import { sensorPulse } from "./sensorPulse";
import { atmosphereBreach } from "./atmosphereBreach";
import { boardingDebris } from "./boardingDebris";

export type { OverlayCtx, OverlayDef, OverlayScope } from "./types";

/**
 * Registry of all battle overlays, in a stable display order. Under-ship
 * overlays (focus ring, sensor coverage, movement trail, atmosphere/breach) are
 * drawn before the ship loop; over-ship overlays (target lock, damage pulse,
 * sensor pulses, boarding/debris) after it. BattleRoute partitions this list by
 * id to decide layering — see UNDER_SHIP_IDS below.
 */
export const OVERLAYS: readonly OverlayDef[] = [
  focusRing,
  sensorCoverage,
  atmosphereBreach,
  movementTrail,
  targetLock,
  damagePulse,
  sensorPulse,
  boardingDebris,
];

/** Overlay ids drawn beneath the ship layer (before the ship loop). */
export const UNDER_SHIP_IDS: ReadonlySet<string> = new Set([
  focusRing.id,
  sensorCoverage.id,
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
