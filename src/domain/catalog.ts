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
  /** Modules belonging to the given faction only. */
  modulesForFaction(faction: string): readonly ModuleDefinition[];
  /** Faction-unaware hull tile lookup (first faction's variant wins). Prefer
   *  `hullTileFor` when the design's faction is known. */
  hullTile(type: HullTileType): HullTileDefinition | undefined;
  /** Faction-aware hull tile lookup: returns the tile variant for the given
   *  faction and type, or `undefined` if no such combination exists. */
  hullTileFor(faction: string, type: HullTileType): HullTileDefinition | undefined;
  allHullTiles(): readonly HullTileDefinition[];
  /** Hull tiles belonging to the given faction only. */
  hullTilesForFaction(faction: string): readonly HullTileDefinition[];
  /** The distinct faction names present in the catalog. */
  factions(): readonly string[];
}

export function createCatalog(
  modules: readonly ModuleDefinition[],
  hullTiles: readonly HullTileDefinition[],
): Catalog {
  const moduleMap = new Map(modules.map((m) => [m.id, m]));
  // Hull tiles are keyed by (faction, type) because each faction has its own
  // variant of block/edge/corner/strut with different stats.
  const hullTileMap = new Map(hullTiles.map((t) => [`${t.faction}:${t.type}`, t]));
  // Legacy single-key map for faction-unaware callers: first definition wins
  // per type (Terran is always first in the bundled catalog data).
  const hullTileByType = new Map(
    [...hullTiles].reverse().map((t) => [t.type, t]),
  );

  const factionSet: Set<string> = new Set([
    ...modules.map((m) => m.faction),
    ...hullTiles.map((t) => t.faction),
  ]);
  const factionList = [...factionSet].sort();

  return {
    module: (id) => moduleMap.get(id),
    allModules: () => modules,
    modulesForFaction: (faction) => modules.filter((m) => m.faction === faction),
    hullTile: (type) => hullTileByType.get(type),
    hullTileFor: (faction, type) => hullTileMap.get(`${faction}:${type}`),
    allHullTiles: () => hullTiles,
    hullTilesForFaction: (faction) => hullTiles.filter((t) => t.faction === faction),
    factions: () => factionList,
  };
}
