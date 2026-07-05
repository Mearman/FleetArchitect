import { createCatalog, type Catalog } from "@/domain/catalog";
import { LayerMaterial } from "@/schema/armor";
import { ModuleDefinition, type ModuleDefinitionInput } from "@/schema/module";

import { layerMaterialData } from "./layer-materials";
import { terranModules } from "./modules/terran";
import { terranCapitalModules } from "./modules/terran-capital";
import { swarmModules } from "./modules/swarm";
import { swarmCapitalModules } from "./modules/swarm-capital";
import { crystallineModules } from "./modules/crystalline";
import { crystallineCapitalModules } from "./modules/crystalline-capital";
import { foundryModules } from "./modules/foundry";
import { foundryCapitalModules } from "./modules/foundry-capital";
import { corsairModules } from "./modules/corsair";
import { syntheticModules } from "./modules/synthetic";
import { syntheticCapitalModules } from "./modules/synthetic-capital";

/**
 * The bundled starter catalog. Layer materials and modules are authored as
 * plain objects and validated against the schema at load time, so a malformed
 * entry fails loudly rather than producing a broken ship. A larger catalog is
 * pure content and can be expanded without touching engine or UI code.
 *
 * Scale notes for the simulation engine: `range` is in "battle units"; `thrust`
 * is acceleration per tick; `cooldown` is ticks between shots.
 *
 * Each entry carries a `faction` field: parts from different factions cannot
 * be mixed on a single ship design.
 */

// Faction arrays are concatenated in the original catalogue order: Terran,
// Swarm, Crystalline, Foundry, Corsair, Synthetic.
const moduleData: ModuleDefinitionInput[] = [
  ...terranModules,
  ...terranCapitalModules,
  ...swarmModules,
  ...swarmCapitalModules,
  ...crystallineModules,
  ...crystallineCapitalModules,
  ...foundryModules,
  ...foundryCapitalModules,
  ...corsairModules,
  ...syntheticModules,
  ...syntheticCapitalModules,
];

export const layerMaterials: readonly LayerMaterial[] = layerMaterialData.map((m) =>
  LayerMaterial.parse(m),
);
export const modules: readonly ModuleDefinition[] = moduleData.map((mod) =>
  ModuleDefinition.parse(mod),
);

let catalogSingleton: Catalog | undefined;

/** Process-wide catalog singleton over the bundled data. */
export function catalog(): Catalog {
  if (catalogSingleton === undefined) {
    catalogSingleton = createCatalog(modules, layerMaterials);
  }
  return catalogSingleton;
}
