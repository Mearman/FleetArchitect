import { describe, expect, it } from "vitest";
import { CellKind } from "@/schema/battle";
import { MODULE_APPEARANCE, appearanceOf } from "./moduleAppearance";
import { GLYPH_PATHS } from "./moduleGlyphs";

describe("moduleAppearance", () => {
  it("covers every CellKind (no invisible cell)", () => {
    for (const kind of CellKind.options) {
      expect(MODULE_APPEARANCE[kind], `missing appearance for ${kind}`).toBeDefined();
    }
    // And nothing extra: the table's keys are exactly the schema's kinds.
    expect(Object.keys(MODULE_APPEARANCE).sort()).toEqual([...CellKind.options].sort());
  });

  it("every appearance references a glyph that exists", () => {
    for (const kind of CellKind.options) {
      const glyph = MODULE_APPEARANCE[kind].glyph;
      expect(GLYPH_PATHS[glyph], `glyph "${glyph}" for ${kind} has no path`).toBeDefined();
    }
  });

  it("extrusion heights are positive and at most one cell tall", () => {
    for (const kind of CellKind.options) {
      const h = MODULE_APPEARANCE[kind].height;
      expect(h, `height for ${kind}`).toBeGreaterThan(0);
      expect(h, `height for ${kind}`).toBeLessThanOrEqual(1);
    }
  });

  it("structural cells sit lower than the systems they house", () => {
    // The whole point of variable height: a turret/mast must out-rise the hull
    // it stands on, or the silhouette gives no information.
    expect(MODULE_APPEARANCE.weapon.height).toBeGreaterThan(MODULE_APPEARANCE.hull.height);
    expect(MODULE_APPEARANCE.sensor.height).toBeGreaterThan(MODULE_APPEARANCE.armour.height);
  });

  it("appearanceOf validates the kind and falls back to hull for an unknown string", () => {
    expect(appearanceOf("weapon")).toBe(MODULE_APPEARANCE.weapon);
    expect(appearanceOf("not-a-real-kind")).toBe(MODULE_APPEARANCE.hull);
  });
});
