import type { FormationTemplate } from "@/schema/formation-template";
import type { Storage } from "@/storage/contract";

/**
 * Load every stored formation template into a `ReadonlyMap` keyed by id — the
 * shape {@link expandTemplates} consumes. This is the single edge helper shared
 * by battle-start (where a fleet's `template` nodes are inlined before resolve)
 * and by the fleet-builder preview (Phase H), so both paths read the template
 * catalogue the same way.
 *
 * Edge responsibility only. The pure expansion lives in `expandTemplates`; this
 * function does the one I/O read (through the {@link Storage} contract, never
 * the Dexie adapter directly) and hands the result to the caller. Domain logic
 * depends on the storage contract, not the runtime, so a future remote adapter
 * drops in without touching battle-start or the expander.
 *
 * Determinism. The map is rebuilt from storage on each call, so two calls in
 * the same tick see the same contents; `expandTemplates` is a pure function of
 * `(fleet, templateTable)`, so given the same stored templates the expanded
 * tree — and therefore the resolved fleet and the battle cache key — is stable.
 */
export async function loadTemplateTable(
  storage: Storage,
): Promise<ReadonlyMap<string, FormationTemplate>> {
  const templates = await storage.formationTemplates.list();
  const map = new Map<string, FormationTemplate>();
  for (const template of templates) {
    map.set(template.id, template);
  }
  return map;
}
