import { describe, expect, it } from "vitest";
import type { GridCell, SolidCell } from "@/schema/grid";
import {
  applyCellBrush,
  applyEdgeBrush,
  isEdgeBrush,
} from "./designerGrid";
import type { Brush } from "./designerConstants";

/** Type guard narrowing a GridCell to a SolidCell. */
function isSolid(cell: GridCell | null): cell is SolidCell {
  return cell !== null && cell.kind === "solid";
}

/** A bare substrate cell with all-open edges, the designer's default deck cell
 *  minus the deck surface. */
const BARE_SUBSTRATE: SolidCell = {
  kind: "solid",
  substrate: true,
  surface: "bare",
  edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} },
};

const DECK_SUBSTRATE: SolidCell = {
  ...BARE_SUBSTRATE,
  surface: "deck",
};

const ARMOR_SUBSTRATE: SolidCell = {
  kind: "solid",
  substrate: true,
  surface: "armor",
  edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} },
};

const EMPTY: GridCell = { kind: "empty" };

describe("applyCellBrush", () => {
  it("empty brush clears any cell to empty", () => {
    expect(applyCellBrush({ kind: "empty" }, DECK_SUBSTRATE)).toEqual({
      kind: "empty",
    });
    expect(applyCellBrush({ kind: "empty" }, EMPTY)).toEqual({ kind: "empty" });
  });

  it("substrate-deck paints a fresh deck cell with open edges", () => {
    const next = applyCellBrush({ kind: "substrate-deck" }, EMPTY);
    expect(next).toEqual(DECK_SUBSTRATE);
  });

  it("substrate-armor seals every edge by default", () => {
    const next = applyCellBrush({ kind: "substrate-armor" }, EMPTY);
    expect(next).toEqual(ARMOR_SUBSTRATE);
  });

  it("add-surface deck resurfaces a substrate cell without touching edges", () => {
    const next = applyCellBrush(
      { kind: "add-surface", surface: "deck" },
      BARE_SUBSTRATE,
    );
    expect(next).toEqual(DECK_SUBSTRATE);
  });

  it("add-surface armor strips equipment (schema forbids armor equipment)", () => {
    const withEquipment: SolidCell = {
      ...DECK_SUBSTRATE,
      equipment: { moduleId: "mod-reactor-fusion", facing: 0 },
    };
    const next = applyCellBrush(
      { kind: "add-surface", surface: "armor" },
      withEquipment,
    );
    expect(next).toEqual(ARMOR_SUBSTRATE);
  });

  it("add-surface is a no-op on an empty cell (no substrate to resurface)", () => {
    expect(
      applyCellBrush({ kind: "add-surface", surface: "deck" }, EMPTY),
    ).toBeNull();
  });

  it("remove-surface strips the surface, leaving bare substrate", () => {
    const next = applyCellBrush({ kind: "remove-surface" }, DECK_SUBSTRATE);
    expect(next).toEqual(BARE_SUBSTRATE);
  });

  it("equipment brush mounts on a deck cell", () => {
    const next = applyCellBrush(
      { kind: "equipment", moduleId: "mod-reactor-fusion" },
      DECK_SUBSTRATE,
    );
    expect(next).toEqual({
      ...DECK_SUBSTRATE,
      equipment: { moduleId: "mod-reactor-fusion", facing: 0 },
    });
  });

  it("equipment brush is rejected on armor (schema refine)", () => {
    expect(
      applyCellBrush(
        { kind: "equipment", moduleId: "mod-reactor-fusion" },
        ARMOR_SUBSTRATE,
      ),
    ).toBeNull();
  });

  it("equipment brush is rejected on empty (no substrate)", () => {
    expect(
      applyCellBrush(
        { kind: "equipment", moduleId: "mod-reactor-fusion" },
        EMPTY,
      ),
    ).toBeNull();
  });
});

describe("applyEdgeBrush", () => {
  it("edge-wall toggles open to wall and back", () => {
    const walled = applyEdgeBrush({ kind: "edge-wall" }, DECK_SUBSTRATE, "n");
    expect(isSolid(walled)).toBe(true);
    if (!isSolid(walled)) return;
    expect(walled.edges.n).toBe("wall");
    const reopened = applyEdgeBrush({ kind: "edge-wall" }, walled, "n");
    expect(isSolid(reopened)).toBe(true);
    if (!isSolid(reopened)) return;
    expect(reopened.edges.n).toBe("open");
  });

  it("edge-door creates a closed door (airtight default)", () => {
    const doored = applyEdgeBrush({ kind: "edge-door" }, DECK_SUBSTRATE, "e");
    expect(isSolid(doored)).toBe(true);
    if (!isSolid(doored)) return;
    expect(doored.edges.e).toBe("door");
    expect(doored.edges.doorStates.e).toBe("closed");
  });

  it("edge-door on an existing door cycles closed -> open -> closed", () => {
    let cell: GridCell | null = DECK_SUBSTRATE;
    cell = applyEdgeBrush({ kind: "edge-door" }, cell, "s");
    expect(isSolid(cell) && cell.edges.doorStates.s).toBe("closed");
    cell = applyEdgeBrush(
      { kind: "edge-door" },
      isSolid(cell) ? cell : DECK_SUBSTRATE,
      "s",
    );
    expect(isSolid(cell) && cell.edges.doorStates.s).toBe("open");
    cell = applyEdgeBrush(
      { kind: "edge-door" },
      isSolid(cell) ? cell : DECK_SUBSTRATE,
      "s",
    );
    expect(isSolid(cell) && cell.edges.doorStates.s).toBe("closed");
  });

  it("doorStates key is absent on non-door edges (schema invariant)", () => {
    const result = applyEdgeBrush({ kind: "edge-door" }, DECK_SUBSTRATE, "n");
    expect(isSolid(result)).toBe(true);
    if (!isSolid(result)) return;
    expect(result.edges.doorStates.n).toBe("closed");
    expect(result.edges.doorStates.e).toBeUndefined();
    expect(result.edges.doorStates.s).toBeUndefined();
    expect(result.edges.doorStates.w).toBeUndefined();
  });

  it("collapsing a door to wall removes its doorState", () => {
    let cell: GridCell | null = applyEdgeBrush(
      { kind: "edge-door" },
      DECK_SUBSTRATE,
      "n",
    );
    cell = applyEdgeBrush(
      { kind: "edge-wall" },
      isSolid(cell) ? cell : DECK_SUBSTRATE,
      "n",
    );
    expect(isSolid(cell) && cell.edges.n).toBe("wall");
    expect(isSolid(cell) && cell.edges.doorStates.n).toBeUndefined();
  });

  it("is a no-op on an empty cell (no edges to toggle)", () => {
    expect(applyEdgeBrush({ kind: "edge-wall" }, EMPTY, "n")).toBeNull();
    expect(applyEdgeBrush({ kind: "edge-door" }, EMPTY, "n")).toBeNull();
  });
});

describe("isEdgeBrush", () => {
  it("returns true only for edge brushes", () => {
    const cases: [Brush, boolean][] = [
      [{ kind: "empty" }, false],
      [{ kind: "substrate-deck" }, false],
      [{ kind: "add-surface", surface: "deck" }, false],
      [{ kind: "remove-surface" }, false],
      [{ kind: "equipment", moduleId: "x" }, false],
      [{ kind: "edge-wall" }, true],
      [{ kind: "edge-door" }, true],
    ];
    for (const [brush, expected] of cases) {
      expect(isEdgeBrush(brush)).toBe(expected);
    }
  });
});
