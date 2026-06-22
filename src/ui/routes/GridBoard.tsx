import { useEffect, useMemo, useRef } from "react";
import type { EdgeKind, SolidCell, TileGrid } from "@/schema/grid";
import { PHOSPHOR_GREEN } from "@/ui/theme/tokens";
import { CELL_SIZE } from "@/domain/grid";
import { computeOutline, extractShell } from "@/domain/outline";
import { cellColour, cellLabel, edgePositionClass } from "./designerGrid";
import {
  breachOverlay,
  cellInner,
  edgeDoorClosed,
  edgeDoorOpen,
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
  /** True while the pointer is held down inside the board — enables
   *  drag-to-paint by calling onPaint as the pointer enters each cell. */
  const isPainting = useRef(false);

  // Chamfered hull outline, traced around the protective shell (armour cells +
  // wall/door edges). Rendered as an SVG overlay so the editor previews the same
  // smoothed silhouette the battle draws. The outline vertices are in centred
  // ship-local metres; converting back to lattice cell units (origin top-left)
  // gives `v / CELL_SIZE + cols/2` in x and `+ rows/2` in y. The overlay SVG
  // uses a `0 0 cols rows` viewBox stretched over the grid (preserveAspectRatio
  // none), so cell units map straight onto the rendered board without measuring
  // pixel sizes. Recomputed only when the grid changes.
  const outlineLoops = useMemo(() => {
    const loops = computeOutline(extractShell(grid));
    return loops
      .filter((loop) => loop.length >= 2)
      .map((loop) =>
        loop
          .map(
            (v) =>
              `${v.x / CELL_SIZE + grid.cols / 2},${v.y / CELL_SIZE + grid.rows / 2}`,
          )
          .join(" "),
      );
  }, [grid]);

  useEffect(() => {
    function handlePointerUp() {
      isPainting.current = false;
    }
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%" }}>
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
            onPointerDown={() => {
              isPainting.current = true;
              onPaint(col, row);
            }}
            onPointerEnter={() => {
              if (isPainting.current) onPaint(col, row);
            }}
            style={{
              background: cellColour(cell),
              outline: isSelected ? `2px solid ${PHOSPHOR_GREEN}` : "none",
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
                <button
                  key={dir}
                  type="button"
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
      {outlineLoops.length > 0 ? (
        <svg
          viewBox={`0 0 ${grid.cols} ${grid.rows}`}
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          {outlineLoops.map((points, i) => (
            <polygon
              key={i}
              points={points}
              fill="none"
              stroke={PHOSPHOR_GREEN}
              strokeWidth={0.12}
              strokeOpacity={0.85}
              strokeLinejoin="round"
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}
