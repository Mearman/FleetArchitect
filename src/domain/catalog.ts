import type { HullDefinition } from "@/schema/hull";
import type { ModuleDefinition } from "@/schema/module";
import type { EntityId } from "@/schema/primitives";

/**
 * Read-only lookup over the bundled module and hull catalog. The catalog is
 * static and ships with the app, so ship designs and fleets reference entries
 * by id rather than embedding them.
 */
export interface Catalog {
  hull(id: EntityId): HullDefinition | undefined;
  module(id: EntityId): ModuleDefinition | undefined;
  allHulls(): readonly HullDefinition[];
  allModules(): readonly ModuleDefinition[];
}

export function createCatalog(
  hulls: readonly HullDefinition[],
  modules: readonly ModuleDefinition[],
): Catalog {
  const hullMap = new Map(hulls.map((h) => [h.id, h]));
  const moduleMap = new Map(modules.map((m) => [m.id, m]));
  return {
    hull: (id) => hullMap.get(id),
    module: (id) => moduleMap.get(id),
    allHulls: () => hulls,
    allModules: () => modules,
  };
}
