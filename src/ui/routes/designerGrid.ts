import { catalog } from "@/data/catalog";
import type { GridCell, TileGrid } from "@/schema/grid";
import {
  type Brush,
  type WorkingDesign,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_DIM,
} from "./designerConstants";

/** A blank grid of the given size, with a fusion reactor (the command module)
 *  in the centre so a fresh design starts from something that can grow into a
 *  valid ship. */
export function blankGrid(cols: number, rows: number): TileGrid {
  const cells: GridCell[] = Array.from({ length: cols * rows }, () => ({
    kind: "empty",
  }));
  const centre = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  cells[centre] = { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 };
  return { cols, rows, cells, connections: [], shape: { outlineMode: "hexadecilinear" } };
}

export function blankDesign(): WorkingDesign {
  return {
    id: null,
    createdAt: null,
    name: "",
    faction: "Terran",
    grid: blankGrid(DEFAULT_COLS, DEFAULT_ROWS),
  };
}

/** Display colour per cell kind for the board. Sensor and comms modules get
 *  distinct colours so they stand out from generic modules at a glance. */
export function cellColour(cell: GridCell): string {
  switch (cell.kind) {
    case "empty":
      return "transparent";
    case "hull":
      return "#8794b8";
    case "module": {
      const mod = catalog().module(cell.moduleId);
      if (mod?.effect.kind === "sensor") return "#4ecb9e";   // teal-green
      if (mod?.effect.kind === "comms")  return "#b87fff";   // purple
      return "#6ea8ff";
    }
    case "floor":
      // Warm amber-tan: visually distinct from the steel-blue hull and the
      // bright-blue module, clearly readable at small cell sizes.
      return "#c9a84c";
  }
}

/** Short label drawn inside a cell. Sensor cells get "S", comms cells get
 *  "K" (for communications) to distinguish them from generic module cells. */
export function cellLabel(cell: GridCell): string {
  if (cell.kind === "empty") return "";
  if (cell.kind === "hull") return cell.tile.charAt(0).toUpperCase();
  if (cell.kind === "floor") return "~";
  const mod = catalog().module(cell.moduleId);
  if (mod === undefined) return "?";
  if (mod.effect.kind === "sensor") return "S";
  if (mod.effect.kind === "comms") return "K";
  return mod.name.charAt(0).toUpperCase();
}

/** Convert the active brush to the cell it paints. */
export function brushToCell(brush: Brush): GridCell {
  switch (brush.kind) {
    case "empty":
      return { kind: "empty" };
    case "hull":
      return { kind: "hull", tile: brush.tile };
    case "module":
      return { kind: "module", moduleId: brush.moduleId, facing: 0 };
    case "floor":
      return { kind: "floor" };
  }
}

/** Clamp a NumberInput value (which may be a string while typing) to a valid
 *  integer dimension, falling back to the previous value on a blank field. */
export function clampDim(value: string | number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_DIM);
}

export function brushLabel(brush: Brush): string {
  if (brush.kind === "module") {
    return catalog().module(brush.moduleId)?.name ?? "module";
  }
  if (brush.kind === "hull") return `hull (${brush.tile})`;
  if (brush.kind === "floor") return "floor / corridor";
  return "empty";
}
