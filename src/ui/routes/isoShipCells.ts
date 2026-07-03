/**
 * Isometric ship rendering: each cell drawn as an extruded box — a lit top face
 * in the module's colour, two shaded side faces, and the module's glyph engraved
 * on the top — so a ship reads as a built 3-D object whose components are
 * distinguishable by silhouette as well as colour. Per-kind height (from
 * {@link MODULE_APPEARANCE}) makes turrets and sensor masts stand proud of the
 * hull plating they sit on.
 *
 * The flat 2-D battle view keeps the cached-sprite fast path in useBattleCanvas;
 * this extruded path runs only in the isometric view, where the projection has
 * no z-axis and the boxes must therefore be drawn live in screen space with a
 * vertical screen offset for height, painter-sorted back-to-front. Cells are
 * drawn in screen pixels (the canvas is at the device-pixel transform), so this
 * does NOT run inside useBattleCanvas's composed cell matrix.
 */

import { CELL_SIZE } from "@/domain/grid";
import type { RenderCell } from "@/ui/cellLayout";
import { appearanceOf } from "@/ui/render/moduleAppearance";
import { glyphPath2D } from "@/ui/render/moduleGlyphs";
import type { Transform } from "./battleCamera";

export interface Pt {
  x: number;
  y: number;
}

/** Local (ship-frame) corners of a unit cell, counter-clockwise. */
const HALF = CELL_SIZE / 2;
const LOCAL_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-HALF, -HALF],
  [HALF, -HALF],
  [HALF, HALF],
  [-HALF, HALF],
];

/** The screen geometry of one extruded cell: the projected ground quad, the
 *  raised top quad, the projected centre, and the screen-space rise `zS`. */
export interface CellBox {
  ground: Pt[];
  top: Pt[];
  centre: Pt;
  zS: number;
}

/**
 * Project one cell into an extruded box. `project` maps a world point to a screen
 * point (the battle transform's `project`, or the designer's board projection);
 * `cosF`/`sinF` orient the ship; `(ox, oy)` is the cell's local centre;
 * `heightCells` is its extrusion height in cell units; `scale` is screen pixels
 * per world unit. The top quad is the ground quad lifted straight up the screen
 * by `zS = heightCells · CELL_SIZE · scale`, so a taller cell rises further —
 * the property the isometric silhouette depends on. Pure and deterministic, so
 * the geometry is unit-tested without a canvas.
 */
export function isoCellBox(
  project: (wx: number, wy: number) => Pt,
  cosF: number,
  sinF: number,
  shipX: number,
  shipY: number,
  ox: number,
  oy: number,
  heightCells: number,
  scale: number,
): CellBox {
  const ground = LOCAL_CORNERS.map(([dx, dy]) => {
    const lx = ox + dx;
    const ly = oy + dy;
    return project(shipX + (lx * cosF - ly * sinF), shipY + (lx * sinF + ly * cosF));
  });
  const centre = project(shipX + (ox * cosF - oy * sinF), shipY + (ox * sinF + oy * cosF));
  const zS = heightCells * CELL_SIZE * scale;
  const top = ground.map((c) => ({ x: c.x, y: c.y - zS }));
  return { ground, top, centre, zS };
}

/**
 * A render cell paired with its projected screen depth, used to painter-sort the
 * isometric extruded-cell draw back-to-front. The wrapper objects are pooled in
 * a caller-owned buffer (see {@link drawIsoShipCells}'s `out` parameter) and
 * reused across frames, so only the first frame per ship pays any allocation —
 * mirroring the ship-level {@link orderShipsForRenderInto} pattern.
 */
export interface IsoCellDepth {
  m: RenderCell;
  depth: number;
}

/** Multiply each channel of a #rrggbb colour by `f` (0..1) to shade a face. */
function shade(hex: string, f: number): string {
  if (hex.length !== 7 || hex.charCodeAt(0) !== 35) return hex;
  const r = Math.round(Number.parseInt(hex.slice(1, 3), 16) * f);
  const g = Math.round(Number.parseInt(hex.slice(3, 5), 16) * f);
  const b = Math.round(Number.parseInt(hex.slice(5, 7), 16) * f);
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Draw one ship's cells as extruded isometric boxes. `cells` are this frame's
 * render cells; `s` is the ship pose; `base` is the faction/side accent tint;
 * `isStarved` flags supply-starved cells for dimming.
 *
 * `out` is a caller-owned, reusable {@link IsoCellDepth} buffer used to
 * painter-sort the cells back-to-front. Its wrapper objects are mutated in place
 * and reused across frames (the length is reset each call so no stale entries
 * survive), so the per-rAF hot path allocates nothing once warmed — mirroring
 * the ship-level {@link orderShipsForRenderInto}. Same comparator and cell set as
 * the prior `.map().sort()`, so the visual permutation is identical.
 */
export function drawIsoShipCells(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  s: { x: number; y: number; facing: number },
  cells: readonly RenderCell[],
  base: string,
  isStarved: (cell: RenderCell) => boolean,
  out: IsoCellDepth[],
): void {
  const cosF = Math.cos(s.facing);
  const sinF = Math.sin(s.facing);
  const scale = t.scale;

  // Back-to-front by the projection's depth of each cell centre, so nearer cells
  // overpaint farther ones (painter's algorithm for the heightfield). Fill the
  // pooled buffer in place (reusing wrapper objects where the slot already
  // exists) then sort in place; only the first frame per ship allocates.
  let n = 0;
  for (const m of cells) {
    const wx = s.x + (m.ox * cosF - m.oy * sinF);
    const wy = s.y + (m.ox * sinF + m.oy * cosF);
    const depth = t.projection.depth(wx, wy);
    const slot = out[n];
    if (slot === undefined) {
      out[n] = { m, depth };
    } else {
      slot.m = m;
      slot.depth = depth;
    }
    n += 1;
  }
  out.length = n;
  out.sort((a, b) => a.depth - b.depth);

  for (const { m } of out) {
    const app = appearanceOf(m.kind);
    const { ground, top, centre, zS } = isoCellBox(
      t.project,
      cosF,
      sinF,
      s.x,
      s.y,
      m.ox,
      m.oy,
      app.height,
      scale,
    );

    const dead = !m.alive;
    const starved = !dead && isStarved(m);
    const topColour = dead ? shade(app.colour, 0.32) : app.colour;
    ctx.globalAlpha = dead ? 0.5 : starved ? 0.55 : 1;

    // Side faces: only the two front edges (whose midpoint sits below the cell
    // centre on screen) are visible. The left/right pair gets slightly different
    // shading for a lit-from-one-side read.
    for (let i = 0; i < 4; i += 1) {
      const a = ground[i];
      const b = ground[(i + 1) % 4];
      const ta = top[i];
      const tb = top[(i + 1) % 4];
      if (a === undefined || b === undefined || ta === undefined || tb === undefined) continue;
      const midY = (a.y + b.y) / 2;
      if (midY <= centre.y) continue; // a back/top edge — hidden
      const midX = (a.x + b.x) / 2;
      ctx.fillStyle = shade(topColour, midX < centre.x ? 0.62 : 0.46);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(tb.x, tb.y);
      ctx.lineTo(ta.x, ta.y);
      ctx.closePath();
      ctx.fill();
    }

    // Top face.
    const t0 = top[0];
    const t1 = top[1];
    const t2 = top[2];
    const t3 = top[3];
    if (t0 === undefined || t1 === undefined || t2 === undefined || t3 === undefined) continue;
    ctx.fillStyle = topColour;
    ctx.beginPath();
    ctx.moveTo(t0.x, t0.y);
    ctx.lineTo(t1.x, t1.y);
    ctx.lineTo(t2.x, t2.y);
    ctx.lineTo(t3.x, t3.y);
    ctx.closePath();
    ctx.fill();
    // Faint allegiance tint + a crisp top edge.
    ctx.globalAlpha = (dead ? 0.5 : 1) * 0.18;
    ctx.fillStyle = base;
    ctx.fill();
    ctx.globalAlpha = dead ? 0.5 : 1;
    ctx.strokeStyle = shade(topColour, 0.4);
    ctx.lineWidth = Math.max(0.5, 0.06 * CELL_SIZE * scale);
    ctx.stroke();

    // Cell too small to carry a legible glyph — skip the engraving.
    const cellPx = CELL_SIZE * scale;
    if (dead) {
      // A dead cell: an X across the top face instead of its glyph.
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = Math.max(0.6, 0.05 * cellPx);
      ctx.beginPath();
      ctx.moveTo(t0.x, t0.y);
      ctx.lineTo(t2.x, t2.y);
      ctx.moveTo(t1.x, t1.y);
      ctx.lineTo(t3.x, t3.y);
      ctx.stroke();
    } else if (cellPx > 12) {
      drawTopGlyph(ctx, app.glyph, top);
      // Turret barrel from the top-face centre, raised to the cell top.
      if (m.turretAngle !== undefined) {
        const wa = m.turretAngle + s.facing;
        const tip = t.project(
          s.x + (m.ox * cosF - m.oy * sinF) + Math.cos(wa) * CELL_SIZE,
          s.y + (m.ox * sinF + m.oy * cosF) + Math.sin(wa) * CELL_SIZE,
        );
        const cTop: Pt = { x: centre.x, y: centre.y - zS };
        ctx.strokeStyle = app.colour;
        ctx.lineWidth = Math.max(1, 0.1 * cellPx);
        ctx.beginPath();
        ctx.moveTo(cTop.x, cTop.y);
        ctx.lineTo(tip.x, tip.y - zS);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Engrave a glyph on the parallelogram top face. The face's two edge vectors
 * form a basis that maps the glyph's centred unit box onto the tilted top, so
 * the mark sits flat on the cell as the iso tilt would show it.
 */
function drawTopGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: Parameters<typeof glyphPath2D>[0],
  top: Pt[],
): void {
  const t0 = top[0];
  const t1 = top[1];
  const t2 = top[2];
  const t3 = top[3];
  if (t0 === undefined || t1 === undefined || t2 === undefined || t3 === undefined) return;
  // Edge-vector basis (averaged opposite edges) and the face centre.
  const ex = { x: (t1.x - t0.x + (t2.x - t3.x)) / 2, y: (t1.y - t0.y + (t2.y - t3.y)) / 2 };
  const ey = { x: (t3.x - t0.x + (t2.x - t1.x)) / 2, y: (t3.y - t0.y + (t2.y - t1.y)) / 2 };
  const cx = (t0.x + t1.x + t2.x + t3.x) / 4;
  const cy = (t0.y + t1.y + t2.y + t3.y) / 4;
  ctx.save();
  // Map glyph unit-box coords (gx,gy) -> centre + gx*ex + gy*ey.
  ctx.transform(ex.x, ex.y, ey.x, ey.y, cx, cy);
  ctx.strokeStyle = "rgba(8, 10, 8, 0.8)";
  // Line width is in glyph units (the box spans ~1 unit), so 0.08 reads as ~8%
  // of the cell once the edge-vector basis scales it onto the face.
  ctx.lineWidth = 0.08;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(glyphPath2D(glyph));
  ctx.restore();
}
