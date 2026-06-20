import { catalog } from "@/data/catalog";
import type {
  CellEdges,
  DoorState,
  EdgeKind,
  GridCell,
  SolidCell,
  SurfaceKind,
  TileGrid,
} from "@/schema/grid";
import {
  type Brush,
  type WorkingDesign,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_DIM,
} from "./designerConstants";

/** All-open edges for cells painted by the designer when no edge brush is
 *  active. Walls and doors are added afterwards via the edge brushes. */
const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/** All-wall edges for armor cells painted by the designer: an armor cell is
 *  itself the barrier on every side, so its perimeter is sealed by default.
 *  The schema does not forbid an open edge on armor, but a sealed perimeter is
 *  the structurally sensible default (the armor is the wall). */
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
    source: "user",
    shipStance: "balanced",
    crewPriority: "combat",
    rules: [],
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

/** Build a fresh solid cell for a `scaffold-<surface>` brush. */
function freshSolidCell(surface: SurfaceKind): SolidCell {
  return {
    kind: "solid",
    scaffold: true,
    surface,
    edges: surface === "armor" ? WALL_EDGES : OPEN_EDGES,
  };
}

/**
 * Apply a whole-cell brush (`empty`, `scaffold-*`, `equipment`) to the cell at
 * (col, row), returning the replacement cell or `null` if the brush does not
 * apply (e.g. equipment on armor). Pure: returns a new cell, does not mutate.
 */
export function applyCellBrush(
  brush: Brush,
  prev: GridCell,
): GridCell | null {
  switch (brush.kind) {
    case "empty":
      return { kind: "empty" };
    case "scaffold-bare":
      return freshSolidCell("bare");
    case "scaffold-deck":
      return freshSolidCell("deck");
    case "scaffold-armor":
      return freshSolidCell("armor");
    case "equipment":
      // Equipment is only legal on a bare/deck scaffold cell. Armor and empty
      // reject the placement; the user must first paint a deck/bare surface.
      if (prev.kind !== "solid" || prev.surface === "armor") return null;
      return {
        ...prev,
        equipment: { moduleId: brush.moduleId, facing: 0 },
      };
    case "add-surface": {
      if (prev.kind !== "solid") return null;
      // Armor strips equipment (the schema refine forbids equipment on armor).
      const stripEquipment = brush.surface === "armor";
      return {
        ...prev,
        surface: brush.surface,
        edges: brush.surface === "armor" ? WALL_EDGES : prev.edges,
        equipment: stripEquipment ? undefined : prev.equipment,
      };
    }
    case "remove-surface": {
      if (prev.kind !== "solid") return null;
      // Removing the surface leaves a bare scaffold frame. Equipment on a bare
      // cell is legal (the schema allows equipment on bare/deck), so we keep it.
      return { ...prev, surface: "bare" };
    }
    // Edge brushes are handled by applyEdgeBrush; they never reach here.
    case "edge-wall":
    case "edge-door":
      return null;
  }
}

/** Toggle one edge of a cell between two kinds, preserving the doorState
 *  invariant (a state is present exactly on door edges). Returns a new cell
 *  with the edge updated, or `null` if the cell is not solid. */
function withEdge(
  cell: GridCell,
  dir: "n" | "e" | "s" | "w",
  kind: EdgeKind,
): GridCell | null {
  if (cell.kind !== "solid") return null;
  const edges: CellEdges = { ...cell.edges, [dir]: kind };
  const doorStates = { ...cell.edges.doorStates };
  if (kind === "door") {
    // New door defaults to closed (airtight barrier). The user opens it with a
    // second click on the door edge.
    doorStates[dir] = "closed" satisfies DoorState;
  } else {
    delete doorStates[dir];
  }
  edges.doorStates = doorStates;
  return { ...cell, edges };
}

/** Cycle a door edge's state between closed and open. Returns a new cell or
 *  `null` if the cell is not solid or the edge is not a door. */
function cycleDoorState(
  cell: GridCell,
  dir: "n" | "e" | "s" | "w",
): GridCell | null {
  if (cell.kind !== "solid") return null;
  if (cell.edges[dir] !== "door") return null;
  const current = cell.edges.doorStates[dir];
  const next: DoorState = current === "open" ? "closed" : "open";
  const doorStates = { ...cell.edges.doorStates, [dir]: next };
  return { ...cell, edges: { ...cell.edges, doorStates } };
}

/**
 * Apply an edge brush to the cell at (col, row) on the edge facing `dir`.
 *
 *  - `edge-wall` toggles the edge between `wall` and `open` (a closed door
 *     becomes a wall, an open door becomes a wall).
 *  - `edge-door` toggles between `door` (defaulting to closed) and `open`. A
 *     second click on an existing door cycles its state closed ↔ open.
 *
 * Returns the replacement cell, or `null` if the cell is not solid (edges only
 * exist on solid cells — an empty cell has no edges to toggle).
 */
export function applyEdgeBrush(
  brush: { kind: "edge-wall" } | { kind: "edge-door" },
  cell: GridCell,
  dir: "n" | "e" | "s" | "w",
): GridCell | null {
  if (cell.kind !== "solid") return null;
  const current = cell.edges[dir];
  if (brush.kind === "edge-wall") {
    // Toggle: wall ↔ open. Doors collapse to wall on the way through.
    return withEdge(cell, dir, current === "wall" ? "open" : "wall");
  }
  // edge-door
  if (current === "door") {
    // Cycle door state closed ↔ open.
    return cycleDoorState(cell, dir);
  }
  // Not a door yet: make it one (closed).
  return withEdge(cell, dir, "door");
}

/** Is this brush an edge brush (operates on edges, not whole cells)? */
export function isEdgeBrush(
  brush: Brush,
): brush is { kind: "edge-wall" } | { kind: "edge-door" } {
  return brush.kind === "edge-wall" || brush.kind === "edge-door";
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
    case "add-surface":
      return `add ${brush.surface}`;
    case "remove-surface":
      return "remove surface";
    case "edge-wall":
      return "wall";
    case "edge-door":
      return "door";
    case "equipment":
      return catalog().module(brush.moduleId)?.name ?? "equipment";
  }
}
