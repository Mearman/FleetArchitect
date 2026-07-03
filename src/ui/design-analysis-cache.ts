/**
 * Per-design analysis cache, keyed on `(id, revision)`. Mirrors the
 * `parseDesignCached` pattern in `src/storage/db.ts`.
 *
 * A `useLiveQuery` over the ships table re-fires its querier on every write to
 * the observed table and returns a fresh top-level array (the `.map()` in
 * `makeShipRepository.list` allocates a new array even though unchanged rows
 * return the same parsed object reference via `parseDesignCached`). That fresh
 * array reference defeats the `useMemo` in `FleetBuilderRoute` (whose dep is
 * the array identity), so without this cache every roster write would re-run
 * `analyseShipDesign` and `deriveClassification` across ALL designs.
 *
 * Keying on `(id, revision)` means only designs whose revision actually bumped
 * re-analyse; the rest return the cached result and the `useMemo` degrades to
 * O(changed designs) instead of O(all designs). The catalog is a process-wide
 * singleton (`catalog()`), so it is a stable input and does not need to be part
 * of the key. Save paths bump `revision` on every content change, so a matching
 * revision is a guarantee the design is byte-identical to the cached analysis.
 *
 * Session-scoped: a deploy reloads the page and drops both maps. Returning the
 * same result object reference for an unchanged `(id, revision)` is intended
 * (React child memoisation benefits) and safe because analyses are treated as
 * immutable.
 */
import { analyseShipDesign } from "@/domain/stats";
import type { ShipDesignAnalysis } from "@/domain/stats";
import { deriveClassification } from "@/domain/grid";
import type { Catalog } from "@/domain/catalog";
import type { ShipClassification } from "@/schema/armor";
import type { ShipDesign } from "@/schema/ship";

interface CacheEntry<T> {
  revision: number;
  result: T;
}

const analysisCache = new Map<string, CacheEntry<ShipDesignAnalysis>>();
const classificationCache = new Map<string, CacheEntry<ShipClassification>>();

/**
 * Analyse a design through the revision cache (hit → skip the analysis). At the
 * UI layer every design has been parsed through `parseDesignRecord`, so
 * `revision` is always a valid number; a mismatch means the design changed and
 * the analysis is recomputed.
 */
export function analyseShipDesignCached(
  design: ShipDesign,
  catalog: Catalog,
): ShipDesignAnalysis {
  const cached = analysisCache.get(design.id);
  if (cached !== undefined && cached.revision === design.revision) {
    return cached.result;
  }
  const result = analyseShipDesign(design, catalog);
  analysisCache.set(design.id, { revision: design.revision, result });
  return result;
}

/**
 * Classify a design through the revision cache (hit → skip the derivation).
 * Wraps the grid-based `deriveClassification` so callers that hold a
 * `ShipDesign` can benefit from the `(id, revision)` key.
 */
export function deriveClassificationCached(
  design: ShipDesign,
): ShipClassification {
  const cached = classificationCache.get(design.id);
  if (cached !== undefined && cached.revision === design.revision) {
    return cached.result;
  }
  const result = deriveClassification(design.grid);
  classificationCache.set(design.id, { revision: design.revision, result });
  return result;
}
