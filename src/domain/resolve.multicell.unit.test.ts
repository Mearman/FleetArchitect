import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { analyseShipDesign } from "@/domain/stats";
import { createCatalog } from "@/domain/catalog";
import { layerMaterials, modules } from "@/data/catalog";
import { ModuleDefinition } from "@/schema/module";
import { nowIso } from "@/domain/id";
import { flatFormation } from "@/schema/formation";
import type { Fleet } from "@/schema/fleet";
import type { CellEdges, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/**
 * Multi-cell (polyomino) module resolution. Proves the engine infrastructure
 * added in Phase 2 of the polyomino design: a 2-cell module resolves to ONE
 * functioning SimModule (the anchor carrying the effect) plus ONE inert
 * structural SimModule for the covered cell — not two copies of the weapon. The
 * anchor alone carries the module's mass and effect; the covered cell renders
 * in the module's colour (`kind` label) but behaves as hull.
 */

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

/** A 2-cell variant of the bundled pulse-laser: same effect, but a horizontal
 *  polyomino footprint covering two cells (`{0,0}` anchor + `{1,0}` cover). */
const bundledLaser = modules.find((m) => m.id === "mod-pulse-laser");
if (bundledLaser === undefined) {
  throw new Error("resolve.multicell.unit.test: bundled mod-pulse-laser not found");
}
const twoCellLaser = ModuleDefinition.parse({
  ...bundledLaser,
  id: "test-2cell-pulse-laser",
  footprint: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }],
});

/** A catalog that extends the bundled set with the 2-cell test laser. */
function multicellCatalog() {
  return createCatalog([...modules, twoCellLaser], layerMaterials);
}

/** A 2-cell ship: the anchor (col 0) carries the 2-cell laser; the cover
 *  cell (col 1) carries a `covers` back-pointer to the anchor. Both cells are
 *  deck so crew could reach them. */
function twoCellDesign(): ShipDesign {
  const grid: TileGrid = {
    cols: 2,
    rows: 1,
    cells: [
      {
        kind: "solid",
        substrate: true,
        surface: "deck",
        edges: OPEN,
        equipment: { moduleId: "test-2cell-pulse-laser", facing: 0 },
      },
      {
        kind: "solid",
        substrate: true,
        surface: "deck",
        edges: OPEN,
        equipment: {
          facing: 0,
          covers: { moduleId: "test-2cell-pulse-laser", anchorCol: 0, anchorRow: 0 },
        },
      },
    ],
    connections: [],
  };
  return {
    id: "d-multicell",
    name: "Polyomino",
    faction: "Terran",
    grid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    doctrine: { base: {}, rules: [] },
  };
}

function fleet(): Fleet {
  return {
    id: "f-multicell",
    name: "F",
    faction: "Terran",
    formation: flatFormation([
      { designId: "d-multicell", position: { x: -100, y: 0 }, facing: 0 },
    ]),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

describe("resolveFleetToCombatShips (multi-cell module)", () => {
  it("resolves a 2-cell weapon to ONE weapon SimModule at the anchor", () => {
    const designs = new Map([["d-multicell", twoCellDesign()]]);
    const [ship] = resolveFleetToCombatShips(
      fleet(),
      designs,
      multicellCatalog(),
      "attacker",
    );
    expect(ship).toBeDefined();
    if (ship === undefined) return;
    const resolved = ship.modules ?? [];

    // Exactly one SimModule carries the weapon effect — the anchor. The
    // covered cell does not duplicate the weapon.
    const weapons = resolved.filter((m) => m.effect.kind === "weapon");
    expect(weapons, "a 2-cell weapon must resolve to exactly one weapon SimModule").toHaveLength(1);

    // padGrid shifts the authored grid by +1 on each axis, so the anchor
    // (authored at col 0, row 0) lands at col 1, row 1 in the grown grid.
    const [weapon] = weapons;
    if (weapon === undefined) return;
    expect(weapon.col).toBe(1);
    expect(weapon.row).toBe(1);
    expect(weapon.moduleId).toBe("test-2cell-pulse-laser");
  });

  it("resolves the covered cell to an inert hull-effect SimModule labelled with the anchor's kind", () => {
    const designs = new Map([["d-multicell", twoCellDesign()]]);
    const [ship] = resolveFleetToCombatShips(
      fleet(),
      designs,
      multicellCatalog(),
      "attacker",
    );
    if (ship === undefined) return;
    const resolved = ship.modules ?? [];

    // The covered cell sits at grown-grid col 2, row 1 (padGrid shifts +1).
    const covered = resolved.find((m) => m.col === 2 && m.row === 1);
    expect(covered, "covered cell must resolve to a SimModule").toBeDefined();
    if (covered === undefined) return;
    // Inert: the engine treats it as structure.
    expect(covered.effect.kind).toBe("hull");
    expect(covered.powerDraw).toBe(0);
    expect(covered.crewRequired).toBe(0);
    // But its `kind` label is the anchor module's kind so the renderer paints
    // it in the module's colour, and its `moduleId` keys the cover link.
    expect(covered.kind).toBe("weapon");
    expect(covered.moduleId).toBe("test-2cell-pulse-laser");
  });

  it("adds the module's mass exactly once (at the anchor), not once per covered cell", () => {
    const designs = new Map([["d-multicell", twoCellDesign()]]);
    const [ship] = resolveFleetToCombatShips(
      fleet(),
      designs,
      multicellCatalog(),
      "attacker",
    );
    if (ship === undefined) return;
    const resolved = ship.modules ?? [];

    // The covered cell's mass must be layer-only (substrate + surface); it
    // must NOT include the module's mass. The anchor carries the module mass.
    const substrate = multicellCatalog().substrateMaterial("Terran");
    if (substrate === undefined) return;
    const covered = resolved.find((m) => m.col === 2 && m.row === 1);
    if (covered === undefined) return;
    // A 1x1 deck cell at full coverage: layer mass = substrate + deck material.
    // The covered cell's mass must equal that layer mass — no module mass.
    const deck = multicellCatalog().deckMaterial("Terran");
    if (deck === undefined) return;
    expect(covered.mass).toBeCloseTo(substrate.mass + deck.mass, 9);

    // Sanity: the anchor's mass exceeds the layer mass by exactly the module's mass.
    const anchor = resolved.find((m) => m.col === 1 && m.row === 1);
    if (anchor === undefined) return;
    expect(anchor.mass).toBeCloseTo(twoCellLaser.mass + substrate.mass + deck.mass, 9);
  });

  it("counts the 2-cell weapon as ONE weapon in stats (not two)", () => {
    const cat = multicellCatalog();
    const { stats, faults } = analyseShipDesign(twoCellDesign(), cat);
    // The 2-cell laser has no reactor on this design, so faults are expected;
    // we only assert the weapon count here.
    expect(stats.weapons).toHaveLength(1);
    // The fault list should not include any unknown-module or footprint fault
    // for the test laser — it resolves cleanly.
    expect(faults.some((f) => f.kind === "unknownModule")).toBe(false);
    expect(faults.some((f) => f.kind === "invalidFootprint")).toBe(false);
  });
});

describe("analyseShipDesign polyomino fit validation", () => {
  it("faults a 2-cell module whose cover back-pointer names the wrong anchor coordinate", () => {
    // The cover at col 1 points back at (5, 5) — a coordinate that is not the
    // anchor at (0, 0). resolve would silently degrade this cover to inert
    // structure (it reads only covers.moduleId, not the coordinate); the design
    // validator must flag the broken back-pointer so a malformed polyomino
    // surfaces as a build fault instead.
    const grid: TileGrid = {
      cols: 2,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "test-2cell-pulse-laser", facing: 0 },
        },
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: {
            facing: 0,
            covers: { moduleId: "test-2cell-pulse-laser", anchorCol: 5, anchorRow: 5 },
          },
        },
      ],
      connections: [],
    };
    const design: ShipDesign = { ...twoCellDesign(), grid };
    const { faults } = analyseShipDesign(design, multicellCatalog());
    expect(faults.some((f) => f.kind === "invalidFootprint")).toBe(true);
  });

  it("faults a 2-cell module whose covered offset cell is missing (no cover installed)", () => {
    // The anchor claims a 2-cell footprint, but the offset cell carries no
    // equipment at all — the cover was never installed (the shape of a
    // half-authored or corrupted polyomino).
    const grid: TileGrid = {
      cols: 2,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "test-2cell-pulse-laser", facing: 0 },
        },
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
        },
      ],
      connections: [],
    };
    const design: ShipDesign = { ...twoCellDesign(), grid };
    const { faults } = analyseShipDesign(design, multicellCatalog());
    expect(faults.some((f) => f.kind === "invalidFootprint")).toBe(true);
  });

  it("flags an orphaned cover whose anchor cell is gone (backward check)", () => {
    // A cover at col 0 points at an anchor at (5, 5) — out of bounds. The
    // forward pass never sees it (no anchor yields it); the backward pass must
    // flag the orphan so it doesn't silently degrade to inert structure.
    const grid: TileGrid = {
      cols: 2,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: {
            facing: 0,
            covers: { moduleId: "test-2cell-pulse-laser", anchorCol: 5, anchorRow: 5 },
          },
        },
        { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
      ],
      connections: [],
    };
    const design: ShipDesign = { ...twoCellDesign(), grid };
    const { faults } = analyseShipDesign(design, multicellCatalog());
    expect(faults.some((f) => f.kind === "invalidFootprint")).toBe(true);
  });

  it("flags a cover whose anchor holds a different module (backward check)", () => {
    // Cover at (0,0) points at (1,0), which holds the reactor — a real cell, but
    // not the cover's module. The anchor exists but the moduleId disagrees.
    const grid: TileGrid = {
      cols: 2,
      rows: 2,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: {
            facing: 0,
            covers: { moduleId: "test-2cell-pulse-laser", anchorCol: 1, anchorRow: 0 },
          },
        },
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "mod-reactor-fusion", facing: 0 },
        },
        { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
        { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
      ],
      connections: [],
    };
    const design: ShipDesign = { ...twoCellDesign(), grid };
    const { faults } = analyseShipDesign(design, multicellCatalog());
    expect(faults.some((f) => f.kind === "invalidFootprint")).toBe(true);
  });
});
