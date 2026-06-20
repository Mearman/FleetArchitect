import type { EdgeKind, SolidCell, TileGrid } from "@/schema/grid";
import { cellColour, cellLabel } from "./designerGrid";
import {
  breachOverlay,
  cellInner,
  edgeDoorClosed,
  edgeDoorOpen,
  edgePositionClass,
  edgeWall,
  facingTick,
  gridBoard,
  gridCell as gridCellClass,
} from "./ShipDesignerRoute.css";

/** Cells belonging to a breached (non-airtight) compartment. Drawn as a Set
 *  of `"col,row"` keys so the board can render the breach overlay without
 *  re-running the flood-fill each render. */
export type BreachSet = ReadonlySet<string>;

/** One rendered edge of a solid cell, with its kind and direction. */
interface RenderedEdge {
  dir: "n" | "e" | "s" | "w";
  kind: EdgeKind;
  doorOpen: boolean;
}

/** Extract the non-open edges of a solid cell for rendering. Open edges are
 *  implicit (no bar); walls and doors get an indicator. Door open/closed is
 *  read off the doorState. */
function renderedEdges(cell: SolidCell): RenderedEdge[] {
  const dirs: ("n" | "e" | "s" | "w")[] = ["n", "e", "s", "w"];
  const out: RenderedEdge[] = [];
  for (const dir of dirs) {
    const kind = cell.edges[dir];
    if (kind === "open") continue;
    out.push({
      dir,
      kind,
      doorOpen: kind === "door" && cell.edges.doorStates[dir] === "open",
    });
  }
  return out;
}

export function GridBoard({
  grid,
  selected,
  breached,
  showAirtightness,
  onPaint,
  onEdge,
}: {
  grid: TileGrid;
  selected: { col: number; row: number } | null;
  /** Cells in breached compartments; only consulted when
   *  `showAirtightness` is true. */
  breached: BreachSet;
  showAirtightness: boolean;
  /** Paint the whole cell at (col, row). Called for a cell-body click. */
  onPaint: (col: number, row: number) => void;
  /** Paint the edge of the cell at (col, row) on the given side. Called for an
   *  edge-indicator click. */
  onEdge: (col: number, row: number, dir: "n" | "e" | "s" | "w") => void;
}) {
  return (
    <div
      className={gridBoard}
      style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}
    >
      {grid.cells.map((cell, idx) => {
        const col = idx % grid.cols;
        const row = Math.floor(idx / grid.cols);
        const isSelected =
          selected !== null && selected.col === col && selected.row === row;
        const isBreached =
          showAirtightness && breached.has(`${col},${row}`);
        const edges =
          cell.kind === "solid" ? renderedEdges(cell) : [];
        return (
          <button
            key={`${col}-${row}`}
            type="button"
            className={`${gridCellClass} ${isBreached ? breachOverlay : ""}`}
            onClick={() => onPaint(col, row)}
            style={{
              background: cellColour(cell),
              outline: isSelected ? "2px solid #ffd86e" : "none",
            }}
            aria-label={`cell ${col},${row}`}
          >
            {/* Edge indicators. stopPropagation so a click on the bar fires
                onEdge, not onPaint (the cell-body handler). */}
            {edges.map(({ dir, kind, doorOpen }) => {
              const cls =
                kind === "wall"
                  ? `${edgeWall} ${edgePositionClass("wall", dir)}`
                  : doorOpen
                    ? `${edgeDoorOpen} ${edgePositionClass("door", dir)}`
                    : `${edgeDoorClosed} ${edgePositionClass("door", dir)}`;
              return (
                <span
                  key={dir}
                  className={cls}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdge(col, row, dir);
                  }}
                  aria-label={`${dir} edge ${kind}`}
                />
              );
            })}
            <span className={cellInner}>
              {cell.kind === "solid" && cell.equipment !== undefined ? (
                <span
                  className={facingTick}
                  style={{
                    transform: `rotate(${cell.equipment.facing + Math.PI / 2}rad)`,
                  }}
                />
              ) : null}
              {cellLabel(cell)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
