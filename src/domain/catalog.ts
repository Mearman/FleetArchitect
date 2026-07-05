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
  // Validate every module's polyomino footprint at load: {0,0} present, no
  // duplicate offsets, 4-connected. A malformed footprint is a catalog-authoring
  // bug; throw here so it fails loudly instead of producing a module that
  // renders/places wrong. (All single-cell modules carry [{0,0}] and pass.)
  for (const m of modules) {
    validateFootprint(m.id, m.footprint);
  }
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

/**
 * Validate a polyomino footprint: `{0,0}` present (the anchor offset), no
 * duplicate offsets, and 4-connected (every offset reachable from `{0,0}` by
 * edge-adjacent steps through other offsets — diagonal-only links are not a
 * polyomino). Throws on a malformed footprint so a catalog-authoring bug fails
 * at load rather than producing a module that doesn't render or place correctly.
 */
function validateFootprint(
  moduleId: string,
  footprint: ReadonlyArray<{ dx: number; dy: number }>,
): void {
  if (!footprint.some((o) => o.dx === 0 && o.dy === 0)) {
    throw new Error(`catalog: module "${moduleId}" footprint missing the {0,0} anchor offset`);
  }
  const keys = footprint.map((o) => `${o.dx},${o.dy}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`catalog: module "${moduleId}" footprint has a duplicate offset`);
  }
  // 4-connected: flood-fill from {0,0} through edge-adjacent offsets; every
  // offset must be reachable, else the shape is split or diagonal-only-linked.
  const offsetSet = new Set(keys);
  const reached = new Set<string>(["0,0"]);
  const queue: string[] = ["0,0"];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const parts = cur.split(",");
    const cx = Number(parts[0]);
    const cy = Number(parts[1]);
    for (const n of [
      { dx: cx + 1, dy: cy },
      { dx: cx - 1, dy: cy },
      { dx: cx, dy: cy + 1 },
      { dx: cx, dy: cy - 1 },
    ]) {
      const k = `${n.dx},${n.dy}`;
      if (offsetSet.has(k) && !reached.has(k)) {
        reached.add(k);
        queue.push(k);
      }
    }
  }
  if (reached.size !== offsetSet.size) {
    throw new Error(`catalog: module "${moduleId}" footprint is not 4-connected`);
  }
}
