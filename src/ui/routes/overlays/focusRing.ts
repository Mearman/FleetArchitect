import type { OverlayDef } from "./types";

/** Focus ring overlay: highlights the in-scope ship(s) with a ring. Stub — the
 *  contract (OverlayCtx) is what matters; later agents fill the draw body. */
export const focusRing: OverlayDef = {
  id: "focus-ring",
  label: "Focus ring",
  defaultOn: false,
  defaultScope: "active",
  draw: () => {},
};
