import type { TileGrid } from "@/schema/grid";
import { cellColour, cellLabel } from "./designerGrid";
import {
  cellInner,
  facingTick,
  gridBoard,
  gridCell as gridCellClass,
} from "./ShipDesignerRoute.css";

export function GridBoard({
  grid,
  selected,
  onPaint,
}: {
  grid: TileGrid;
  selected: { col: number; row: number } | null;
  onPaint: (col: number, row: number) => void;
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
        return (
          <button
            key={`${col}-${row}`}
            type="button"
            className={gridCellClass}
            onClick={() => onPaint(col, row)}
            style={{
              background: cellColour(cell),
              outline: isSelected ? "2px solid #ffd86e" : "none",
            }}
            aria-label={`cell ${col},${row}`}
          >
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
