import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
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
  gridGhostFit,
  gridGhostMiss,
  gridOverlay,
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
  cellPx,
  dragPaints,
  ghost,
  onPaint,
  onEdge,
  onMoveCursor,
  onHover,
  onRotate,
}: {
  grid: TileGrid;
  selected: { col: number; row: number } | null;
  /** Cells in breached compartments; only consulted when
   *  `showAirtightness` is true. */
  breached: BreachSet;
  showAirtightness: boolean;
  /** Flat top-down ("2d") or isometric 2.5D ("iso") rendering + hit-testing. */
  view: "2d" | "iso";
  /** Current zoomed cell pitch in px — sizes the grid-line overlay so its lines
   *  track the cell boundaries at every zoom. */
  cellPx: number;
  /** Whether drag-paint fires `onPaint` on pointer-move. Suppressed for
   *  multi-cell equipment brushes so a drag stroke cannot stamp overlapping
   *  polyominoes; single-cell modules and other brushes keep drag-paint. */
  dragPaints: boolean;
  /** Placement preview ghost: the cells the active equipment module would
   *  occupy, coloured green (fits) or red (blocked). Null hides the ghost. */
  ghost: { cells: { col: number; row: number }[]; fits: boolean } | null;
  /** Paint the whole cell at (col, row). Called for a cell-body click. */
  onPaint: (col: number, row: number) => void;
  /** Paint the edge of the cell at (col, row) on the given side. Called for an
   *  edge-indicator click. */
  onEdge: (col: number, row: number, dir: "n" | "e" | "s" | "w") => void;
  /** Move the keyboard cursor to (col, row). Called for arrow-key navigation. */
  onMoveCursor: (col: number, row: number) => void;
  /** Report the cell under the pointer (for the placement ghost), or null when
   *  the pointer leaves the board. */
  onHover: (coord: { col: number; row: number } | null) => void;
  /** Rotate the active multi-cell footprint (R key). No-op when no equipment brush. */
  onRotate?: () => void;
}) {
  /** True while the pointer is held down inside the board — enables
   *  drag-to-paint. */
  const isPainting = useRef(false);
  /** The last cell painted in the current stroke, so a drag paints each cell
   *  once as the pointer crosses it. */
  const lastPainted = useRef<string | null>(null);
  /** The last cell reported via onHover, so hover only fires one setState per
   *  cell crossed — not one per pointermove. Mirrors lastPainted; without it,
   *  each move builds a fresh `{col,row}` and forces a full-grid re-render even
   *  when the hovered cell is unchanged. */
  const lastHovered = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Octilinear hull outline (grown one cell over exposed deck walls, every
  // corner bevelled to a 45-degree facet — no right angles). Rendered as an SVG
  // overlay so the editor previews the ship's silhouette, and used as a clip
  // path so the built cells conform to the bevelled hull silhouette instead of
  // poking past the diagonal facets as full squares. The outline vertices are
  // in centred ship-local metres; converting back to lattice cell units (origin
  // top-left) gives `v / CELL_SIZE + cols/2` in x and `+ rows/2` in y. The
  // overlay SVG uses a `0 0 cols rows` viewBox stretched over the grid
  // (preserveAspectRatio none), so cell units map straight onto the rendered
  // board without measuring pixel sizes. Recomputed only when the grid changes.
  const outlinePoints = useMemo(() => {
    const loops = computeHullOutline(grid);
    return loops
      .filter((loop) => loop.length >= 2)
      .map((loop) =>
        loop.map((v) => ({
          x: v.x / CELL_SIZE + grid.cols / 2,
          y: v.y / CELL_SIZE + grid.rows / 2,
        })),
      );
  }, [grid]);

  // Polygon point strings for the stroke overlay (one space-separated "x,y"
  // list per loop, in cell units).
  const outlineLoops = useMemo(
    () =>
      outlinePoints.map((loop) =>
        loop.map((p) => `${p.x},${p.y}`).join(" "),
      ),
    [outlinePoints],
  );

  // Path `d` for the cell clip, normalised to [0,1] objectBoundingBox units so
  // it scales with the board. All loops are joined into a single path with
  // even-odd winding (the clipPath carries clip-rule="evenodd"), keeping holes
  // open and the outer hull solid.
  const outlineClipPath = useMemo(() => {
    if (outlinePoints.length === 0) return "";
    const parts: string[] = [];
    for (const loop of outlinePoints) {
      for (let i = 0; i < loop.length; i += 1) {
        const p = loop[i];
        if (p === undefined) continue;
        const nx = p.x / grid.cols;
        const ny = p.y / grid.rows;
        parts.push(i === 0 ? `M ${nx} ${ny}` : `L ${nx} ${ny}`);
      }
      parts.push("Z");
    }
    return parts.join(" ");
  }, [outlinePoints, grid.cols, grid.rows]);

  // Stable, unique id for the clipPath so multiple boards on one page cannot
  // collide.
  const rawClipId = useId();
  const clipId = `hull-clip-${rawClipId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

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
    const c = cellAtPointer(e.clientX, e.clientY);
    if (c === null) return;
    const key = `${c.col},${c.row}`;
    // Hover fires on every move (with or without the button) so the placement
    // ghost tracks the pointer, but we dedupe by cell so jitter within one
    // cell does not re-render the whole grid (mirrors the paint guard below).
    if (key !== lastHovered.current) {
      lastHovered.current = key;
      onHover(c);
    }
    if (!isPainting.current || !dragPaints) return;
    if (key === lastPainted.current) return;
    lastPainted.current = key;
    onPaint(c.col, c.row);
  }

  function handlePointerLeave() {
    lastHovered.current = null;
    onHover(null);
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

  /** Keyboard navigation: arrow keys move the cursor (clamped to grid bounds),
   *  Enter/Space paint the cell under the cursor. Opens the grid to keyboard and
   *  screen-reader users — the pointer path is unchanged. */
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (selected === null) {
      onMoveCursor(0, 0);
      return;
    }
    const { col, row } = selected;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        onMoveCursor(Math.max(0, col - 1), row);
        break;
      case "ArrowRight":
        e.preventDefault();
        onMoveCursor(Math.min(grid.cols - 1, col + 1), row);
        break;
      case "ArrowUp":
        e.preventDefault();
        onMoveCursor(col, Math.max(0, row - 1));
        break;
      case "ArrowDown":
        e.preventDefault();
        onMoveCursor(col, Math.min(grid.rows - 1, row + 1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onPaint(col, row);
        break;
      case "r":
      case "R":
        e.preventDefault();
        onRotate?.();
        break;
      default:
        break;
    }
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {/* Hidden SVG defining the hull clipPath. Zero layout footprint; the
          clipPath is referenced by url(#clipId) on the grid board below.
          objectBoundingBox units keep it resolution-independent. */}
      {outlineClipPath !== "" ? (
        <svg
          width={0}
          height={0}
          aria-hidden="true"
          style={{ position: "absolute", pointerEvents: "none" }}
        >
          <clipPath
            id={clipId}
            clipPathUnits="objectBoundingBox"
            clipRule="evenodd"
          >
            <path d={outlineClipPath} />
          </clipPath>
        </svg>
      ) : null}
      {/* Grid-line overlay: fills the board area and carries the same iso
          transform as the board (centred origin), so the cell boundary lines
          tilt with the cells in 2.5D. Not hull-clipped — the clipPath lives on
          the board — so empty cells still show the grid. Earlier sibling of the
          board (both positioned) so opaque built cells paint over it. */}
      <div
        className={gridOverlay}
        style={{
          backgroundSize: `${cellPx}px ${cellPx}px`,
          transform: view === "iso" ? ISO_TRANSFORM : undefined,
          transformOrigin: "center",
        }}
      />
      <div
        ref={boardRef}
        className={gridBoard}
        role="application"
        tabIndex={0}
        aria-label="Ship hull grid — arrow keys to move, Enter to paint"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{
          gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
          gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
          // Pin the board's aspect to the grid so cells stay square and the
          // overlay SVG (preserveAspectRatio="none", viewBox 0 0 cols rows)
          // maps one unit to one cell on both axes — keeping the hull in sync.
          aspectRatio: `${grid.cols} / ${grid.rows}`,
          // Crop the built cells to the chamfered hull outline so they conform
          // to the bevelled silhouette instead of poking past the diagonal
          // facets as full squares. Applied in local space before the iso
          // transform, so it tilts correctly in iso view.
          clipPath: outlineClipPath !== "" ? `url(#${clipId})` : undefined,
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
                    ? `${edgeWall.join(" ")} ${edgePositionClass("wall", dir)}`
                    : doorOpen
                      ? `${edgeDoorOpen.join(" ")} ${edgePositionClass("door", dir)}`
                      : `${edgeDoorClosed.join(" ")} ${edgePositionClass("door", dir)}`;
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
                {cell.equipment?.moduleId !== undefined ? (
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
        {/* Placement preview ghost: one tile per footprint cell, green when the
            module fits at the hovered anchor, red when blocked. Mirrors the
            selection overlay's grid positioning and tilts with the board. */}
        {ghost !== null
          ? ghost.cells.map((cell, i) => (
              <div
                key={`ghost-${i}`}
                className={ghost.fits ? gridGhostFit : gridGhostMiss}
                style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
                aria-hidden="true"
              />
            ))
          : null}
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
