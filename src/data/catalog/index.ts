import { createCatalog, type Catalog } from "@/domain/catalog";
import { HullTileDefinition } from "@/schema/hull";
import { ModuleDefinition } from "@/schema/module";

import { hullTileData } from "./hull-tiles";
import { terranModules } from "./modules/terran";
import { swarmModules } from "./modules/swarm";
import { crystallineModules } from "./modules/crystalline";
import { foundryModules } from "./modules/foundry";
import { corsairModules } from "./modules/corsair";
import { syntheticModules } from "./modules/synthetic";

/**
 * The bundled starter catalog. Hull tiles and modules are authored as plain
 * objects and validated against the schema at load time, so a malformed entry
 * fails loudly rather than producing a broken ship. A larger catalog is pure
 * content and can be expanded without touching engine or UI code.
 *
 * Scale notes for the simulation engine: `range` is in "battle units"; `thrust`
 * is acceleration per tick; `cooldown` is ticks between shots.
 *
 * Each entry carries a `faction` field: parts from different factions cannot
 * be mixed on a single ship design.
 */

// Faction arrays are concatenated in the original catalogue order: Terran,
// Swarm, Crystalline, Foundry, Corsair, Synthetic.
const moduleData: ModuleDefinition[] = [
  ...terranModules,
  ...swarmModules,
  ...crystallineModules,
  ...foundryModules,
  ...corsairModules,
  ...syntheticModules,
];

export const hullTiles: readonly HullTileDefinition[] = hullTileData.map((tile) =>
  HullTileDefinition.parse(tile),
);
export const modules: readonly ModuleDefinition[] = moduleData.map((mod) =>
  ModuleDefinition.parse(mod),
);

let catalogSingleton: Catalog | undefined;

/** Process-wide catalog singleton over the bundled data. */
export function catalog(): Catalog {
  if (catalogSingleton === undefined) {
    catalogSingleton = createCatalog(modules, hullTiles);
  }
  return catalogSingleton;
}
