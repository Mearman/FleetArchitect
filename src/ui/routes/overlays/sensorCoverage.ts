import type { OverlayDef } from "./types";

/** Sensor coverage overlay: renders per-ship sensor reach. Stub — the contract
 *  (OverlayCtx) is what matters; later agents fill the draw body. */
export const sensorCoverage: OverlayDef = {
  id: "sensor-coverage",
  label: "Sensor coverage",
  defaultOn: false,
  defaultScope: "all",
  draw: () => {},
};
