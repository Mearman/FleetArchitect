import { type Fleet } from "@/schema/fleet";
import { parseFleetRecord } from "@/schema/fleet-normalise";
import { type ShipDesign } from "@/schema/ship";
import { parseDesignRecord } from "@/schema/ship-normalise";

import { fleetData } from "@/data/presets/fleets";
import { designData } from "@/data/presets/designs";

export const presetDesigns: readonly ShipDesign[] = designData.map((d) =>
  parseDesignRecord(d),
);
export const presetFleets: readonly Fleet[] = fleetData.map((f) =>
  parseFleetRecord(f),
);
