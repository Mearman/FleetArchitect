import { Fleet } from "@/schema/fleet";
import { ShipDesign } from "@/schema/ship";

import { fleetData } from "@/data/presets/fleets";
import { designData } from "@/data/presets/designs";

export const presetDesigns: readonly ShipDesign[] = designData.map((d) =>
  ShipDesign.parse(d),
);
export const presetFleets: readonly Fleet[] = fleetData.map((f) => Fleet.parse(f));
