import type { LayerMaterial } from "@/schema/armor";
import type { ModuleDefinition } from "@/schema/module";
import type { EntityId } from "@/schema/primitives";

/**
 * Read-only lookup over the bundled module and per-faction layer-material
 * catalog. The catalog is static and ships with the app, so ship grids
 * reference modules by id and surface cells by their layer kind + faction
 * rather than embedding their stats.
 */
export interface Catalog {
  module(id: EntityId): ModuleDefinition | undefined;
  allModules(): readonly ModuleDefinition[];
  /** Modules belonging to the given faction only. */
  modulesForFaction(faction: string): readonly ModuleDefinition[];
  /** The layer material for the given faction + layer, or undefined. */
  layerMaterial(faction: string, layer: LayerMaterial["layer"]): LayerMaterial | undefined;
  /** Convenience: the faction's armor material. */
  armorMaterial(faction: string): LayerMaterial | undefined;
  /** Convenience: the faction's substrate material. */
  substrateMaterial(faction: string): LayerMaterial | undefined;
  /** Convenience: the faction's deck material. */
  deckMaterial(faction: string): LayerMaterial | undefined;
  /** All layer materials in the catalog. */
  allLayerMaterials(): readonly LayerMaterial[];
  /** The distinct faction names present in the catalog. */
  factions(): readonly string[];
}

export function createCatalog(
  modules: readonly ModuleDefinition[],
  layerMaterials: readonly LayerMaterial[],
): Catalog {
  const moduleMap = new Map(modules.map((m) => [m.id, m]));
  const layerMap = new Map(
    layerMaterials.map((m) => [`${m.faction}:${m.layer}`, m]),
  );
  const layerBy = (faction: string, layer: LayerMaterial["layer"]): LayerMaterial | undefined =>
    layerMap.get(`${faction}:${layer}`);

  const factionSet: Set<string> = new Set([
    ...modules.map((m) => m.faction),
    ...layerMaterials.map((m) => m.faction),
  ]);
  const factionList = [...factionSet].sort();

  return {
    module: (id) => moduleMap.get(id),
    allModules: () => modules,
    modulesForFaction: (faction) => modules.filter((m) => m.faction === faction),
    layerMaterial: layerBy,
    armorMaterial: (faction) => layerBy(faction, "armor"),
    substrateMaterial: (faction) => layerBy(faction, "substrate"),
    deckMaterial: (faction) => layerBy(faction, "deck"),
    allLayerMaterials: () => layerMaterials,
    factions: () => factionList,
  };
}
