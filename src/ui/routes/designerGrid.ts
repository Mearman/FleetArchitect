import { catalog } from "@/data/catalog";
import type { CellEdges, GridCell, TileGrid } from "@/schema/grid";
import {
  type Brush,
  type WorkingDesign,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_DIM,
} from "./designerConstants";

/** All-open edges for cells painted by the designer. Edge toggles (walls and
 *  doors) are a Phase 8 concern; presets author their edges directly in the
 *  token maps. */
const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/** All-wall edges for armor cells painted by the designer: an armor cell is
 *  itself the barrier on every side. */
const WALL_EDGES: CellEdges = {
  n: "wall",
  e: "wall",
  s: "wall",
  w: "wall",
  doorStates: {},
};

/** A blank grid of the given size, with a fusion reactor (the command module)
 *  on a deck cell in the centre so a fresh design starts from something that
 *  can grow into a valid ship. */
export function blankGrid(cols: number, rows: number): TileGrid {
  const cells: GridCell[] = Array.from({ length: cols * rows }, () => ({
    kind: "empty",
  }));
  const centre = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  cells[centre] = {
    kind: "solid",
    scaffold: true,
    surface: "deck",
    edges: OPEN_EDGES,
    equipment: { moduleId: "mod-reactor-fusion", facing: 0 },
  };
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

/** Display colour per cell. The surface tints the cell; an equipment tint
 *  overlays it so a weapon on a deck cell is distinguishable from a bare
 *  corridor. Sensor and comms modules get distinct hues. */
export function cellColour(cell: GridCell): string {
  if (cell.kind === "empty") return "transparent";
  if (cell.kind !== "solid") return "transparent";
  switch (cell.surface) {
    case "armor":
      return "#8794b8"; // steel-blue: the protective shell
    case "bare":
      return "#5a5f73"; // muted grey: framing only
    case "deck": {
      if (cell.equipment === undefined) {
        // Warm amber-tan: walkable interior corridor.
        return "#c9a84c";
      }
      const mod = catalog().module(cell.equipment.moduleId);
      if (mod?.effect.kind === "sensor") return "#4ecb9e"; // teal-green
      if (mod?.effect.kind === "comms") return "#b87fff"; // purple
      return "#6ea8ff"; // default equipment
    }
  }
}

/** Short label drawn inside a cell. Equipment cells use the module name's
 *  initial; sensor/comms get distinct letters; bare cells get "/" (the
 *  legacy strut token); empty armour cells get "#". */
export function cellLabel(cell: GridCell): string {
  if (cell.kind === "empty") return "";
  if (cell.kind !== "solid") return "";
  switch (cell.surface) {
    case "armor":
      return "#";
    case "bare":
      return "/";
    case "deck": {
      if (cell.equipment === undefined) return "~";
      const mod = catalog().module(cell.equipment.moduleId);
      if (mod === undefined) return "?";
      if (mod.effect.kind === "sensor") return "S";
      if (mod.effect.kind === "comms") return "K";
      return mod.name.charAt(0).toUpperCase();
    }
  }
}

/** Convert the active brush to the cell it paints. */
export function brushToCell(brush: Brush): GridCell {
  switch (brush.kind) {
    case "empty":
      return { kind: "empty" };
    case "scaffold-bare":
      return { kind: "solid", scaffold: true, surface: "bare", edges: OPEN_EDGES };
    case "scaffold-deck":
      return { kind: "solid", scaffold: true, surface: "deck", edges: OPEN_EDGES };
    case "scaffold-armor":
      return { kind: "solid", scaffold: true, surface: "armor", edges: WALL_EDGES };
    case "equipment":
      return {
        kind: "solid",
        scaffold: true,
        surface: "deck",
        edges: OPEN_EDGES,
        equipment: { moduleId: brush.moduleId, facing: 0 },
      };
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
  switch (brush.kind) {
    case "empty":
      return "empty";
    case "scaffold-bare":
      return "scaffold (bare)";
    case "scaffold-deck":
      return "scaffold (deck)";
    case "scaffold-armor":
      return "scaffold (armor)";
    case "equipment":
      return catalog().module(brush.moduleId)?.name ?? "equipment";
  }
}
