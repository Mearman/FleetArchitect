import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { catalog } from "@/data/catalog";
import type { CellEquipment } from "@/schema/grid";
import type { EntityId } from "@/schema/primitives";
import type { ModuleDefinition } from "@/schema/module";
import type { Brush, WorkingDesign } from "./designerConstants";
import {
  applyCellBrush,
  applyEdgeBrush,
  eraseModule,
  isDestructiveToModule,
  isEdgeBrush,
  isMultiCellPart,
  placeModule,
} from "./designerGrid";

/** A grid coordinate, used for the selected cell and the hover ghost. */
export interface CellCoord {
  col: number;
  row: number;
}

/**
 * Owns the designer's brush, selection, and hover state plus the paint/erase
 * handlers that mutate the working grid. Extracted from `ShipDesignerRoute` so
 * the route stays under the per-file line guard and the brush logic — now
 * multi-cell aware — sits in one testable unit.
 *
 * Paint dispatches four ways:
 *  - `equipment` places a polyomino atomically via `placeModule` (anchor +
 *    covers, blocked on misfit so no orphan is ever created).
 *  - `empty` erases via `eraseModule` — a multi-cell part takes its whole
 *    module with it.
 *  - a destructive single-cell brush (`substrate-*`, `add-surface` armour) on a
 *    multi-cell part first erases the whole module, then paints the freed cell.
 *  - anything else paints one cell as before.
 */
export function useDesignerBrush(
  setWorking: Dispatch<SetStateAction<WorkingDesign>>,
  readOnly: boolean,
): {
  brush: Brush;
  setBrush: Dispatch<SetStateAction<Brush>>;
  selected: CellCoord | null;
  setSelected: Dispatch<SetStateAction<CellCoord | null>>;
  hovered: CellCoord | null;
  setHovered: Dispatch<SetStateAction<CellCoord | null>>;
  rotation: number;
  cycleRotation: () => void;
  paint: (col: number, row: number) => void;
  paintEdge: (col: number, row: number, dir: "n" | "e" | "s" | "w") => void;
  updateSelectedEquipment: (patch: Partial<CellEquipment>) => void;
} {
  const [brush, setBrush] = useState<Brush>({ kind: "substrate-deck" });
  const [selected, setSelected] = useState<CellCoord | null>(null);
  const [hovered, setHovered] = useState<CellCoord | null>(null);
  const [rotation, setRotation] = useState(0);

  const resolve = (id: EntityId): ModuleDefinition | undefined => catalog().module(id);

  /** Cycle the multi-cell footprint rotation: 0 → 1 → 2 → 3 → 0 (CW). */
  function cycleRotation() {
    setRotation((r) => (r + 1) % 4);
  }

  /** Paint a whole cell with the active cell-brush (multi-cell aware). */
  function paint(col: number, row: number) {
    if (readOnly || isEdgeBrush(brush)) return;
    setWorking((prev) => {
      const grid = prev.grid;
      if (brush.kind === "equipment") {
        const def = catalog().module(brush.moduleId);
        if (def === undefined) return prev;
        const next = placeModule(grid, col, row, def, rotation);
        return next === grid ? prev : { ...prev, grid: next };
      }
      if (brush.kind === "empty") {
        const next = eraseModule(grid, col, row, resolve);
        return next === grid ? prev : { ...prev, grid: next };
      }
      // A destructive single-cell brush on a multi-cell part would orphan the
      // module's covers, so erase the whole module first, then paint the freed
      // cell. Non-destructive brushes and plain cells paint one cell as before.
      const baseGrid =
        isDestructiveToModule(brush) && isMultiCellPart(grid, col, row, resolve)
          ? eraseModule(grid, col, row, resolve)
          : grid;
      const idx = row * baseGrid.cols + col;
      const cells = baseGrid.cells.slice();
      const prevCell = cells[idx];
      if (prevCell === undefined) return prev;
      const next = applyCellBrush(brush, prevCell);
      if (next === null) return prev;
      cells[idx] = next;
      return { ...prev, grid: { ...baseGrid, cells } };
    });
    setSelected({ col, row });
  }

  /** Paint an edge of the cell at (col, row) on side `dir`. */
  function paintEdge(col: number, row: number, dir: "n" | "e" | "s" | "w") {
    if (readOnly || !isEdgeBrush(brush)) return;
    setWorking((prev) => {
      const idx = row * prev.grid.cols + col;
      const cells = prev.grid.cells.slice();
      const prevCell = cells[idx];
      if (prevCell === undefined) return prev;
      const next = applyEdgeBrush(brush, prevCell, dir);
      if (next === null) return prev;
      cells[idx] = next;
      return { ...prev, grid: { ...prev.grid, cells } };
    });
    setSelected({ col, row });
  }

  /** Patch the equipment of the selected anchor cell (facing, comms/sensor).
   *  No-op when nothing is selected, the design is read-only, or the selected
   *  cell is a covered cell of a multi-cell module (it has no `moduleId` of its
   *  own and inherits its config from its anchor). */
  function updateSelectedEquipment(patch: Partial<CellEquipment>) {
    if (selected === null || readOnly) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (
        cell === undefined ||
        cell.kind !== "solid" ||
        cell.equipment === undefined ||
        cell.equipment.moduleId === undefined
      ) {
        return prev;
      }
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, ...patch } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  return {
    brush,
    setBrush,
    selected,
    setSelected,
    hovered,
    setHovered,
    rotation,
    cycleRotation,
    paint,
    paintEdge,
    updateSelectedEquipment,
  };
}
