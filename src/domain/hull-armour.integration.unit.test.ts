/**
 * Integration tests: verify that growArmourHull + padGrid are wired into
 * analyseShipDesign so that auto-derived armour cells contribute mass and HP
 * without being present in the saved design.
 */
import { describe, expect, it } from "vitest";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { CellEdges, GridCell, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/** All-wall edges: an armour plate is sealed on every side. */
const WALL: CellEdges = { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} };

/**
 * Build a 3×3 grid with a single ARMOUR cell at the centre (1,1). Only armour
 * seeds growth, so after padGrid(1) + growArmourHull the four orthogonal
 * neighbours of (2,2) in the 5×5 padded grid become grown armour cells, and the
 * four diagonal corners of that ring fill too — 1 authored + 4 ortho + 4 corners
 * = 9 armour cells total. The 8 grown cells are produced by the auto-grow, not
 * present in the saved design.
 */
function singleCellDesign(): ShipDesign {
  const cells: GridCell[] = [
    { kind: "empty" }, { kind: "empty" }, { kind: "empty" },
    { kind: "empty" },
    { kind: "solid", substrate: true, surface: "armor", edges: WALL },
    { kind: "empty" },
    { kind: "empty" }, { kind: "empty" }, { kind: "empty" },
  ];
  const grid: TileGrid = { cols: 3, rows: 3, cells, connections: [] };
  return {
    id: createId("design"),
    name: "Armour integration test",
    faction: "Terran",
    grid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    shipStance: "balanced",
    crewPriority: "combat",
    rules: [],
  };
}

describe("hull-armour integration: analyseShipDesign includes auto-derived armour", () => {
  it("produces more total structure (HP) than a bare single-cell design", () => {
    const design = singleCellDesign();
    const { stats } = analyseShipDesign(design, catalog());

    // After padGrid(1) + growArmourHull the grown grid is 5×5: the single
    // authored armour cell at (2,2) seeds armour on its 4 orthogonal neighbours
    // — (1,2), (3,2), (2,1), (2,3) — and the 4 diagonal corners of that ring,
    // for 9 armour cells total. Without growth the ship would be the one authored
    // armour cell. Assert the grown total exceeds that single-cell HP (derived
    // from the catalog, no magic number).
    const cat = catalog();
    const substrate = cat.substrateMaterial("Terran");
    const armor = cat.armorMaterial("Terran");
    if (substrate === undefined || armor === undefined) {
      throw new Error("Terran layer materials missing from catalog");
    }
    const oneArmourCell = substrate.hp + armor.hp;
    expect(stats.structure).toBeGreaterThan(oneArmourCell);
  });

  it("produces more total mass than a bare single-cell design", () => {
    const design = singleCellDesign();
    const { stats } = analyseShipDesign(design, catalog());

    // The single authored armour cell and each of the 8 grown armour cells
    // contribute substrate + armor mass (exact values depend on physics.ts
    // anchors). Assert the total mass exceeds the single-cell-only mass by at
    // least 1 kg (armour is significantly heavier).
    // We derive the bare-cell mass from the catalog directly so no magic number.
    const cat = catalog();
    const substrate = cat.substrateMaterial("Terran");
    const armor = cat.armorMaterial("Terran");
    if (substrate === undefined || armor === undefined) {
      throw new Error("Terran layer materials missing from catalog");
    }
    const oneArmourCell = substrate.mass + armor.mass;
    expect(stats.mass).toBeGreaterThan(oneArmourCell);
  });

  it("structure matches explicitly pre-grown design", () => {
    // Both paths should compute the same structure total: analyseShipDesign on
    // the raw design (internal growth) vs. analyseShipDesign on the pre-grown
    // design (growth has already been applied, internal growth is a no-op for
    // cells that are already armour, but DOES pad again — so we cannot use the
    // pre-grown design directly as it would be double-padded).
    //
    // Instead, assert that analyseShipDesign on the raw design produces the
    // known correct total computed by reasoning over the catalog.
    const design = singleCellDesign();
    const { stats } = analyseShipDesign(design, catalog());

    const cat = catalog();
    const substrate = cat.substrateMaterial("Terran");
    const armor = cat.armorMaterial("Terran");
    if (substrate === undefined || armor === undefined) {
      throw new Error("Terran layer materials missing from catalog");
    }
    // 9 armour cells (1 authored + 4 ortho + 4 corners), but the 4 corner cells
    // are chamfered to half their visible area so they carry half HP: 5 full +
    // 4 half = 7 cell-equivalents, each substrate + armor HP.
    const expected = 7 * (substrate.hp + armor.hp);
    expect(stats.structure).toBe(expected);
    // Layer mass scales by coverage the same way (no equipment in this design):
    // 7 cell-equivalents of substrate + armor mass.
    const expectedMass = 7 * (substrate.mass + armor.mass);
    expect(stats.mass).toBe(expectedMass);
  });

  it("is deterministic: two calls on the same design return identical structure", () => {
    const design = singleCellDesign();
    const { stats: a } = analyseShipDesign(design, catalog());
    const { stats: b } = analyseShipDesign(design, catalog());
    expect(a.structure).toBe(b.structure);
    expect(a.mass).toBe(b.mass);
  });
});
