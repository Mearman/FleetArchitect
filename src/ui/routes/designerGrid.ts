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
import {
  doorEast,
  doorNorth,
  doorSouth,
  doorWest,
  edgeEast,
  edgeNorth,
  edgeSouth,
  edgeWest,
} from "./ShipDesignerRoute.css";

/** Resolve the CSS class that positions an edge indicator on the given side.
 *  Kept here (not in the .css.ts file) because vanilla-extract requires .css.ts
 *  files to export only plain serialisable values — no functions. */
export function edgePositionClass(
  kind: "wall" | "door",
  dir: "n" | "e" | "s" | "w",
): string {
  if (kind === "wall") {
    if (dir === "n") return edgeNorth;
    if (dir === "e") return edgeEast;
    if (dir === "s") return edgeSouth;
    return edgeWest;
  }
  if (dir === "n") return doorNorth;
  if (dir === "e") return doorEast;
  if (dir === "s") return doorSouth;
  return doorWest;
}

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
    substrate: true,
    surface: "deck",
    edges: OPEN_EDGES,
    equipment: { moduleId: "mod-reactor-fusion", facing: 0 },
  };
  return { cols, rows, cells, connections: [] };
}

/** Bounding box of the built (non-empty) cells, or null if the grid is empty. */
export function builtBounds(
  grid: TileGrid,
): { minCol: number; maxCol: number; minRow: number; maxRow: number } | null {
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      if (grid.cells[r * grid.cols + c]?.kind === "empty") continue;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
    }
  }
  if (maxCol < minCol) return null;
  return { minCol, maxCol, minRow, maxRow };
}

/**
 * Resize a grid to at least `targetCols` x `targetRows` (never smaller than its
 * built content) with the built cells centred and the rest padded empty. Returns
 * the new grid and the (dx, dy) coordinate shift applied to existing cells so a
 * caller can remap a selection. Connections are shifted too. Centred padding is
 * transparent to gameplay: empty cells contribute no mass/stats, and keeping the
 * occupied region centred keeps the combat outline and centre-of-mass put.
 */
export function fitGridCentered(
  grid: TileGrid,
  targetCols: number,
  targetRows: number,
): { grid: TileGrid; dx: number; dy: number } {
  const b = builtBounds(grid);
  const cw = b ? b.maxCol - b.minCol + 1 : 1;
  const ch = b ? b.maxRow - b.minRow + 1 : 1;
  const cols = Math.max(targetCols, cw);
  const rows = Math.max(targetRows, ch);
  const dx = Math.floor((cols - cw) / 2) - (b ? b.minCol : 0);
  const dy = Math.floor((rows - ch) / 2) - (b ? b.minRow : 0);
  const cells: GridCell[] = Array.from({ length: cols * rows }, () => ({
    kind: "empty",
  }));
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const cell = grid.cells[r * grid.cols + c];
      if (cell !== undefined && cell.kind !== "empty") {
        cells[(r + dy) * cols + (c + dx)] = cell;
      }
    }
  }
  const connections = grid.connections.map((cn) => ({
    from: { col: cn.from.col + dx, row: cn.from.row + dy },
    to: { col: cn.to.col + dx, row: cn.to.row + dy },
    resource: cn.resource,
  }));
  return { grid: { cols, rows, cells, connections }, dx, dy };
}

/** Centre (half-cell precision) and extent of the built content, in cell units.
 *  Used to position the board so the ship stays centred as the grid resizes on
 *  zoom, and to bound panning to the content's edges. Falls back to the grid
 *  centre with a 1x1 extent when nothing is built. */
export function contentBox(grid: TileGrid): {
  centreCol: number;
  centreRow: number;
  cols: number;
  rows: number;
} {
  const b = builtBounds(grid);
  if (b === null) {
    return { centreCol: grid.cols / 2, centreRow: grid.rows / 2, cols: 1, rows: 1 };
  }
  return {
    centreCol: (b.minCol + b.maxCol + 1) / 2,
    centreRow: (b.minRow + b.maxRow + 1) / 2,
    cols: b.maxCol - b.minCol + 1,
    rows: b.maxRow - b.minRow + 1,
  };
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

/** Build a fresh solid cell for a `substrate-<surface>` brush. */
function freshSolidCell(surface: SurfaceKind): SolidCell {
  return {
    kind: "solid",
    substrate: true,
    surface,
    edges: surface === "armor" ? WALL_EDGES : OPEN_EDGES,
  };
}

/**
 * Apply a whole-cell brush (`empty`, `substrate-*`, `equipment`) to the cell at
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
    case "substrate-bare":
      return freshSolidCell("bare");
    case "substrate-deck":
      return freshSolidCell("deck");
    case "substrate-armor":
      return freshSolidCell("armor");
    case "equipment":
      // Equipment is only legal on a bare/deck substrate cell. Armor and empty
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
      // Removing the surface leaves a bare substrate frame. Equipment on a bare
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
    case "substrate-bare":
      return "substrate (bare)";
    case "substrate-deck":
      return "substrate (deck)";
    case "substrate-armor":
      return "substrate (armor)";
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
