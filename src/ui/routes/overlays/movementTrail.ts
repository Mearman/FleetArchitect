import type { OverlayDef } from "./types";

/** Movement trail overlay: draws recent positions behind in-scope ships. Stub —
 *  the contract (OverlayCtx) is what matters; later agents fill the draw body. */
export const movementTrail: OverlayDef = {
  id: "movement-trail",
  label: "Movement trail",
  defaultOn: false,
  defaultScope: "active",
  draw: () => {},
};
