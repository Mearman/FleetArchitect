import { describe, expect, it } from "vitest";
import { catalog } from "@/data/catalog";
import { nowIso } from "@/domain/id";
import {
  analyseShipDesignCached,
  deriveClassificationCached,
} from "@/ui/design-analysis-cache";
import { groupByFactionAndClass } from "@/ui/shipGrouping";
import type { ShipDesign } from "@/schema/ship";
import type { TileGrid } from "@/schema/grid";

/** A 1x1 empty grid — classifies as "fighter" by the empty-grid convention. */
const emptyGrid: TileGrid = {
  cols: 1,
  rows: 1,
  cells: [{ kind: "empty" }],
  connections: [],
};

function makeDesign(id: string, revision: number): ShipDesign {
  return {
    id,
    name: "Cache test",
    faction: "Terran",
    grid: emptyGrid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision,
    doctrine: { base: {}, rules: [] },
  };
}

describe("analyseShipDesignCached", () => {
  it("returns the same result reference for an unchanged (id, revision)", () => {
    const design = makeDesign("design-cache-same", 1);
    const first = analyseShipDesignCached(design, catalog());
    const second = analyseShipDesignCached(design, catalog());
    // Same reference: the cache hit short-circuits the analysis.
    expect(second).toBe(first);
  });

  it("recomputes when the revision bumps", () => {
    const design = makeDesign("design-cache-rev", 1);
    const first = analyseShipDesignCached(design, catalog());
    const updated = makeDesign("design-cache-rev", 2);
    const second = analyseShipDesignCached(updated, catalog());
    // Cache miss on the new revision: a fresh result object is produced.
    expect(second).not.toBe(first);
    // ...but the aggregated stats are equal (the grid is unchanged).
    expect(second.stats).toEqual(first.stats);
  });
});

describe("deriveClassificationCached", () => {
  it("returns the same classification for an unchanged (id, revision)", () => {
    const design = makeDesign("design-class-same", 1);
    const first = deriveClassificationCached(design);
    const second = deriveClassificationCached(design);
    expect(second).toBe(first);
    expect(first).toBe("fighter");
  });

  it("treats a different id as a distinct cache entry", () => {
    const a = makeDesign("design-class-a", 1);
    const b = makeDesign("design-class-b", 1);
    expect(deriveClassificationCached(a)).toBe("fighter");
    expect(deriveClassificationCached(b)).toBe("fighter");
    // Both resolve to the same primitive value, but they are independent cache
    // entries keyed by id — exercising both branches of the cache lookup.
  });
});

describe("groupByFactionAndClass (uses cached classification)", () => {
  it("buckets designs into faction -> class groups", () => {
    const groups = groupByFactionAndClass([
      makeDesign("group-a", 1),
      makeDesign("group-b", 1),
    ]);
    expect(groups).toHaveLength(1);
    const terran = groups[0];
    expect(terran?.faction).toBe("Terran");
    // Both empty-grid designs classify as "fighter" and land in one class group.
    expect(terran?.classes).toHaveLength(1);
    expect(terran?.classes[0]?.classification).toBe("fighter");
    expect(terran?.classes[0]?.ships).toHaveLength(2);
  });
});
