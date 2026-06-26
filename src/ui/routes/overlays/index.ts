import type { OverlayDef } from "./types";
import { targetLock } from "./targetLock";
import { focusRing } from "./focusRing";
import { movementTrail } from "./movementTrail";
import { damagePulse } from "./damagePulse";
import { sensorPulse } from "./sensorPulse";
import { atmosphereBreach } from "./atmosphereBreach";
import { boardingDebris } from "./boardingDebris";
import { mediumGlow } from "./mediumGlow";

export type { OverlayCtx, OverlayDef, OverlayScope } from "./types";

/**
 * Registry of all battle overlays, in a stable display order. Under-ship
 * overlays (focus ring, movement trail, atmosphere/breach, medium glow) are
 * drawn before the ship loop; over-ship overlays (target lock, damage pulse,
 * sensor pulse, boarding/debris) after it.
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
];

/** Overlay ids drawn beneath the ship layer (before the ship loop). */
export const UNDER_SHIP_IDS: ReadonlySet<string> = new Set([
  mediumGlow.id,
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
