import type { HullTileDefinition } from "@/schema/hull";
import type { HullTileType } from "@/schema/grid";
import type { ModuleDefinition } from "@/schema/module";
import type { EntityId } from "@/schema/primitives";

/**
 * Read-only lookup over the bundled module and hull-tile catalog. The catalog
 * is static and ships with the app, so ship grids reference modules by id and
 * hull cells by tile type rather than embedding their stats.
 */
export interface Catalog {
  module(id: EntityId): ModuleDefinition | undefined;
  allModules(): readonly ModuleDefinition[];
  hullTile(type: HullTileType): HullTileDefinition | undefined;
  allHullTiles(): readonly HullTileDefinition[];
}

export function createCatalog(
  modules: readonly ModuleDefinition[],
  hullTiles: readonly HullTileDefinition[],
): Catalog {
  const moduleMap = new Map(modules.map((m) => [m.id, m]));
  const hullTileMap = new Map(hullTiles.map((t) => [t.type, t]));
  return {
    module: (id) => moduleMap.get(id),
    allModules: () => modules,
    hullTile: (type) => hullTileMap.get(type),
    allHullTiles: () => hullTiles,
  };
}
