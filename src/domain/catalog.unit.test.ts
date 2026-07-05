import { describe, expect, it } from "vitest";
import { createCatalog } from "@/domain/catalog";
import { layerMaterialData } from "@/data/catalog/layer-materials";
import { modules } from "@/data/catalog";
import { ModuleDefinition } from "@/schema/module";

/**
 * Catalog footprint validation: `createCatalog` throws on a malformed polyomino
 * footprint so a catalog-authoring bug fails loudly at load. The checks: `{0,0}`
 * present (the anchor offset), no duplicate offsets, and 4-connected (every
 * offset reachable from `{0,0}` by edge-adjacent steps). A valid single-cell
 * `[{0,0}]` and any well-formed polyomino pass.
 */

const base = modules.find((m) => m.id === "mod-pulse-laser");
if (base === undefined) throw new Error("catalog.unit.test: mod-pulse-laser not found");

/** A module literal with the given footprint, valid apart from that override. */
function moduleWith(footprint: { dx: number; dy: number }[]) {
  return ModuleDefinition.parse({ ...base, id: "test-footprint", footprint });
}

describe("createCatalog — footprint validation", () => {
  it("accepts a single-cell footprint [{0,0}]", () => {
    expect(() => createCatalog([moduleWith([{ dx: 0, dy: 0 }])], layerMaterialData)).not.toThrow();
  });

  it("accepts a valid 4-connected polyomino", () => {
    expect(() =>
      createCatalog(
        [moduleWith([{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }])],
        layerMaterialData,
      ),
    ).not.toThrow();
  });

  it("throws when the {0,0} anchor offset is missing", () => {
    expect(() => createCatalog([moduleWith([{ dx: 1, dy: 0 }])], layerMaterialData)).toThrow();
  });

  it("throws on a duplicate offset", () => {
    expect(() =>
      createCatalog(
        [moduleWith([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }])],
        layerMaterialData,
      ),
    ).toThrow();
  });

  it("throws on a diagonal-only (not 4-connected) footprint", () => {
    expect(() =>
      createCatalog([moduleWith([{ dx: 0, dy: 0 }, { dx: 1, dy: 1 }])], layerMaterialData),
    ).toThrow();
  });

  it("throws on a split footprint (two disconnected cells)", () => {
    expect(() =>
      createCatalog(
        [moduleWith([{ dx: 0, dy: 0 }, { dx: 5, dy: 5 }])],
        layerMaterialData,
      ),
    ).toThrow();
  });
});
