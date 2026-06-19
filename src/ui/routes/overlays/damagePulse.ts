import type { OverlayDef } from "./types";

/** Damage pulse overlay: flashes ships that recently took damage. Stub — the
 *  contract (OverlayCtx) is what matters; later agents fill the draw body. */
export const damagePulse: OverlayDef = {
  id: "damage-pulse",
  label: "Damage pulse",
  defaultOn: false,
  defaultScope: "all",
  draw: () => {},
};
