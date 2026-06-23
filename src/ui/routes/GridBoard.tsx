import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef } from "react";
import type { EdgeKind, SolidCell, TileGrid } from "@/schema/grid";
import { PHOSPHOR_GREEN } from "@/ui/theme/tokens";
import { CELL_SIZE } from "@/domain/grid";
import { computeHullOutline } from "@/domain/hull-outline";
import { cellColour, cellGlyph, cellLabel, edgePositionClass } from "./designerGrid";
import { GLYPH_PATHS } from "@/ui/render/moduleGlyphs";
import {
  breachOverlay,
  cellInner,
  edgeDoorClosed,
  edgeDoorOpen,
  edgeWall,
  facingTick,
  gridBoard,
  gridCell as gridCellClass,
  gridSelection,
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

/** True 2:1 isometric tilt for the designer board. The CSS matrix maps a local
 *  board point (px, relative to the centred transform-origin) to screen:
 *  matrix(A, B, -A, B, 0, 0) i.e. x' = A(x - y), y' = B(x + y). Painting inverts
 *  it (see `cellAtPointer`): x = sx/(2A) + sy/(2B), y = -sx/(2A) + sy/(2B). */
const ISO_A = 0.8;
const ISO_B = ISO_A / 2;
const ISO_TRANSFORM = `matrix(${ISO_A}, ${ISO_B}, ${-ISO_A}, ${ISO_B}, 0, 0)`;

export function GridBoard({
  grid,
  selected,
  breached,
  showAirtightness,
  view,
  onPaint,
  onEdge,
}: {
  grid: TileGrid;
  selected: { col: number; row: number } | null;
  /** Cells in breached compartments; only consulted when
   *  `showAirtightness` is true. */
  breached: BreachSet;
  showAirtightness: boolean;
  /** Flat top-down ("2d") or isometric 2.5D ("iso") rendering + hit-testing. */
  view: "2d" | "iso";
  /** Paint the whole cell at (col, row). Called for a cell-body click. */
  onPaint: (col: number, row: number) => void;
  /** Paint the edge of the cell at (col, row) on the given side. Called for an
   *  edge-indicator click. */
  onEdge: (col: number, row: number, dir: "n" | "e" | "s" | "w") => void;
}) {
  /** True while the pointer is held down inside the board — enables
   *  drag-to-paint. */
  const isPainting = useRef(false);
  /** The last cell painted in the current stroke, so a drag paints each cell
   *  once as the pointer crosses it. */
  const lastPainted = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Octilinear hull outline (grown one cell over exposed deck walls, every
  // corner bevelled to a 45-degree facet — no right angles). Rendered as an SVG
  // overlay so the editor previews the ship's silhouette. The outline vertices
  // are in centred ship-local metres; converting back to lattice cell units
  // (origin top-left) gives `v / CELL_SIZE + cols/2` in x and `+ rows/2` in y.
  // The overlay SVG uses a `0 0 cols rows` viewBox stretched over the grid
  // (preserveAspectRatio none), so cell units map straight onto the rendered
  // board without measuring pixel sizes. Recomputed only when the grid changes.
  const outlineLoops = useMemo(() => {
    const loops = computeHullOutline(grid);
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
      lastPainted.current = null;
    }
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  /** Map viewport client coords to a grid cell, or null if outside the board. */
  function cellAtPointer(
    clientX: number,
    clientY: number,
  ): { col: number; row: number } | null {
    const node = boardRef.current;
    if (node === null) return null;
    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;

    let fracX: number;
    let fracY: number;
    if (view === "iso") {
      // The board carries ISO_TRANSFORM around its centred origin, so its
      // visual AABB (`r`) is the tilted diamond — its centre is the board
      // centre (the origin is fixed by the linear map). offsetWidth/Height are
      // the untransformed layout px. Invert the iso matrix on the screen delta
      // from centre to recover the local board point, then normalise to [0,1).
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      if (w === 0 || h === 0) return null;
      const dx = clientX - (r.left + r.width / 2);
      const dy = clientY - (r.top + r.height / 2);
      const localX = dx / (2 * ISO_A) + dy / (2 * ISO_B);
      const localY = -dx / (2 * ISO_A) + dy / (2 * ISO_B);
      fracX = (w / 2 + localX) / w;
      fracY = (h / 2 + localY) / h;
    } else {
      fracX = (clientX - r.left) / r.width;
      fracY = (clientY - r.top) / r.height;
    }

    const col = Math.floor(fracX * grid.cols);
    const row = Math.floor(fracY * grid.rows);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
    return { col, row };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const c = cellAtPointer(e.clientX, e.clientY);
    if (c === null) return;
    isPainting.current = true;
    lastPainted.current = `${c.col},${c.row}`;
    onPaint(c.col, c.row);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!isPainting.current) return;
    const c = cellAtPointer(e.clientX, e.clientY);
    if (c === null) return;
    const key = `${c.col},${c.row}`;
    if (key === lastPainted.current) return;
    lastPainted.current = key;
    onPaint(c.col, c.row);
  }

  // Only the built (non-empty) cells become DOM nodes; the empty grid is a
  // background pattern and paints are hit-tested by coordinate, so a large
  // grid stays cheap to render.
  const builtCells: { col: number; row: number; cell: SolidCell }[] = [];
  for (let idx = 0; idx < grid.cells.length; idx += 1) {
    const cell = grid.cells[idx];
    if (cell === undefined || cell.kind !== "solid") continue;
    builtCells.push({ col: idx % grid.cols, row: Math.floor(idx / grid.cols), cell });
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div
        ref={boardRef}
        className={gridBoard}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        style={{
          gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
          gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
          // Pin the board's aspect to the grid so cells stay square and the
          // overlay SVG (preserveAspectRatio="none", viewBox 0 0 cols rows)
          // maps one unit to one cell on both axes — keeping the hull in sync.
          aspectRatio: `${grid.cols} / ${grid.rows}`,
          // 2.5D: tilt the whole board into the iso plane about its centre.
          // Painting inverts this same matrix in cellAtPointer.
          transform: view === "iso" ? ISO_TRANSFORM : undefined,
          transformOrigin: "center",
        }}
      >
        {builtCells.map(({ col, row, cell }) => {
          const isBreached = showAirtightness && breached.has(`${col},${row}`);
          const edges = renderedEdges(cell);
          return (
            <div
              key={`${col}-${row}`}
              className={`${gridCellClass} ${isBreached ? breachOverlay : ""}`}
              style={{
                gridColumn: col + 1,
                gridRow: row + 1,
                background: cellColour(cell),
              }}
              aria-label={`cell ${col},${row}`}
            >
              {/* Edge indicators. stopPropagation so a click on the bar fires
                  onEdge, not onPaint (gated by the active brush in the parent). */}
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
                {cell.equipment !== undefined ? (
                  <span
                    className={facingTick}
                    style={{
                      transform: `rotate(${cell.equipment.facing + Math.PI / 2}rad)`,
                    }}
                  />
                ) : null}
                {(() => {
                  const glyph = cellGlyph(cell);
                  if (glyph === null) return cellLabel(cell);
                  // The shared module glyph, engraved on the cell. Authored in a
                  // centred unit box, so a viewBox of (-0.5 -0.5 1 1) maps it to
                  // the cell; non-scaling stroke keeps it crisp at any zoom.
                  return (
                    <svg
                      viewBox="-0.5 -0.5 1 1"
                      width="72%"
                      height="72%"
                      fill="none"
                      stroke="rgba(8, 10, 8, 0.78)"
                      strokeWidth={0.09}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d={GLYPH_PATHS[glyph]} />
                    </svg>
                  );
                })()}
              </span>
            </div>
          );
        })}
        {selected !== null ? (
          <div
            className={gridSelection}
            style={{ gridColumn: selected.col + 1, gridRow: selected.row + 1 }}
            aria-hidden="true"
          />
        ) : null}
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
            overflow: "visible",
            pointerEvents: "none",
            // Match the board's iso tilt so the hull silhouette stays aligned.
            transform: view === "iso" ? ISO_TRANSFORM : undefined,
            transformOrigin: "center",
          }}
          aria-hidden="true"
        >
          {outlineLoops.map((points, i) => (
            <polygon
              key={i}
              points={points}
              fill="none"
              stroke={PHOSPHOR_GREEN}
              strokeWidth={1.5}
              strokeOpacity={0.85}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}
