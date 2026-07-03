/**
 * Pure bucketing of ship designs into ordered faction -> class groups for the
 * grouped ship browser. Classification is derived from the design grid via
 * {@link deriveClassificationCached} (a per-(id, revision) cache over the
 * underlying domain classification); class order follows the {@link ShipClassification}
 * enum (fighter, frigate, cruiser, dreadnought); factions are ordered
 * alphabetically. Empty groups are omitted and ships within a class are sorted
 * by name. No side effects, no DOM, no storage.
 */
import { deriveClassificationCached } from "@/ui/design-analysis-cache";
import { ShipClassification } from "@/schema/armor";
import type { ShipDesign } from "@/schema/ship";

/** A class bucket within a faction: the classification and its member ships. */
export interface ClassGroup {
  classification: ShipClassification;
  ships: ShipDesign[];
}

/** A faction bucket: the faction name and its non-empty class groups. */
export interface FactionGroup {
  faction: string;
  classes: ClassGroup[];
}

/**
 * Group designs into ordered faction -> class buckets. Factions are sorted
 * alphabetically; within each faction, classes follow the canonical
 * fighter/frigate/cruiser/dreadnought order; ships within a class are sorted by
 * name. Empty class groups and empty factions are not emitted.
 */
export function groupByFactionAndClass(
  designs: readonly ShipDesign[],
): FactionGroup[] {
  const byFaction = new Map<string, Map<ShipClassification, ShipDesign[]>>();
  for (const design of designs) {
    const classification = deriveClassificationCached(design);
    let classes = byFaction.get(design.faction);
    if (classes === undefined) {
      classes = new Map();
      byFaction.set(design.faction, classes);
    }
    const ships = classes.get(classification);
    if (ships === undefined) {
      classes.set(classification, [design]);
    } else {
      ships.push(design);
    }
  }

  const factionNames = [...byFaction.keys()].sort((a, b) => a.localeCompare(b));
  const result: FactionGroup[] = [];
  for (const faction of factionNames) {
    const classes = byFaction.get(faction);
    if (classes === undefined) continue;
    const classGroups: ClassGroup[] = [];
    for (const classification of ShipClassification.options) {
      const ships = classes.get(classification);
      if (ships === undefined) continue;
      ships.sort((a, b) => a.name.localeCompare(b.name));
      classGroups.push({ classification, ships });
    }
    if (classGroups.length > 0) {
      result.push({ faction, classes: classGroups });
    }
  }
  return result;
}
