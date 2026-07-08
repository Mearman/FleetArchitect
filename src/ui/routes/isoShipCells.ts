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
import {
  DOOR_COLOUR,
  ISO_WALL_STROKE_FRACTION,
  WALL_COLOUR,
} from "./battleConstants";

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

/**
 * Each compass edge maps to the index of its top-face corner: the edge spans
 * `top[index] -> top[(index + 1) % 4]`, matching the counter-clockwise corner
 * order. Used to stroke the static wall/door edges along the projected top face.
 */
const EDGE_DIRS: ReadonlyArray<"n" | "e" | "s" | "w"> = ["n", "e", "s", "w"];
const EDGE_TO_CORNER: Readonly<Record<"n" | "e" | "s" | "w", number>> = {
  n: 0,
  e: 1,
  s: 2,
  w: 3,
};

/**
 * The screen geometry of one extruded cell: the projected ground quad, the
 * raised top quad, the projected centre, and the screen-space rise `zS`. The
 * quad/centre slots are mutable {@link Pt} objects owned by the caller and
 * rewritten in place by {@link isoCellBox} each call, so a single CellBox is
 * allocated once and reused across every cell of every ship of every frame
 * (see {@link drawIsoShipCells}'s `boxScratch` parameter) — the per-rAF iso
 * path allocates no geometry once warmed. The arithmetic is identical to the
 * allocating form; only the destination of each projected point differs.
 */
export interface CellBox {
  ground: Pt[];
  top: Pt[];
  centre: Pt;
  zS: number;
}

/**
 * Allocate a fresh CellBox with 4 ground and 4 top Pt slots. Held by the caller
 * (the draw loop keeps one in a ref) and passed to {@link isoCellBox} as the
 * `into` scratch every call, mirroring the pooled {@link IsoCellDepth} buffer.
 */
export function makeCellBox(): CellBox {
  return {
    ground: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    top: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    centre: { x: 0, y: 0 },
    zS: 0,
  };
}

/**
 * Project one cell into an extruded box, writing into the caller-owned `into`
 * scratch (returned for chaining). `projectInto` writes the projected screen
 * point into its `out` argument — the battle transform's allocation-free
 * `t.projectInto`, rather than the allocating `t.project` — so no Pt is
 * allocated per corner; `cosF`/`sinF` orient the ship; `(ox, oy)` is the cell's
 * local centre; `heightCells` is its extrusion height in cell units; `scale` is
 * screen pixels per world unit. The top quad is the ground quad lifted straight
 * up the screen by `zS = heightCells · CELL_SIZE · scale`, so a taller cell
 * rises further — the property the isometric silhouette depends on. Pure and
 * deterministic — identical arithmetic in identical order to the allocating
 * form — so the geometry is unit-tested without a canvas; only the destination
 * of each point differs.
 */
export function isoCellBox(
  projectInto: (out: Pt, wx: number, wy: number) => Pt,
  into: CellBox,
  cosF: number,
  sinF: number,
  shipX: number,
  shipY: number,
  ox: number,
  oy: number,
  heightCells: number,
  scale: number,
): CellBox {
  const { ground, top, centre } = into;
  let i = 0;
  for (const [dx, dy] of LOCAL_CORNERS) {
    const lx = ox + dx;
    const ly = oy + dy;
    const g = ground[i];
    if (g !== undefined) {
      projectInto(g, shipX + (lx * cosF - ly * sinF), shipY + (lx * sinF + ly * cosF));
    }
    i += 1;
  }
  projectInto(centre, shipX + (ox * cosF - oy * sinF), shipY + (ox * sinF + oy * cosF));
  const zS = heightCells * CELL_SIZE * scale;
  for (let j = 0; j < 4; j += 1) {
    const g = ground[j];
    const tj = top[j];
    if (g !== undefined && tj !== undefined) {
      tj.x = g.x;
      tj.y = g.y - zS;
    }
  }
  into.zS = zS;
  return into;
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

/**
 * Multiply each channel of a #rrggbb colour by `f` (0..1) to shade a face.
 * Deterministic on `(hex, f)`, and the iso draw path re-derives the same few
 * (module colour × fixed factor) combinations up to four times per cell per
 * frame, so the parsed-and-rebuilt result is memoised: the first call for a
 * given pair parses and caches, subsequent calls are a single Map lookup. The
 * output string is byte-identical to the uncached form, so rendered colours are
 * unchanged.
 */
const shadeCache = new Map<string, string>();
function shade(hex: string, f: number): string {
  if (hex.length !== 7 || hex.charCodeAt(0) !== 35) return hex;
  const key = `${hex}|${f}`;
  const cached = shadeCache.get(key);
  if (cached !== undefined) return cached;
  const r = Math.round(Number.parseInt(hex.slice(1, 3), 16) * f);
  const g = Math.round(Number.parseInt(hex.slice(3, 5), 16) * f);
  const b = Math.round(Number.parseInt(hex.slice(5, 7), 16) * f);
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  const out = `#${h(r)}${h(g)}${h(b)}`;
  shadeCache.set(key, out);
  return out;
}

/**
 * Encode a cell's integer grid offset as a single number for O(1) set membership
 * without per-cell string allocation. Cells sit on a 1 m grid (CELL_SIZE = 1),
 * so offsets are integers in a bounded range (|ox|, |oy| well under 2^15 even
 * for a dreadnought); the offset shifts negative grid coords into a positive
 * range so the pair packs into one safe-integer key.
 */
const CELL_KEY_OFFSET = 1 << 15;
function cellKey(ox: number, oy: number): number {
  return (ox + CELL_KEY_OFFSET) * (2 * CELL_KEY_OFFSET) + (oy + CELL_KEY_OFFSET);
}

/**
 * Memoised set of every present cell offset for a given hull outline. The
 * outline array is identity-stable per descriptor (descriptor.outline is read
 * off the cached descriptor each frame), and the cell offsets are the same
 * function of that descriptor, so the set is built once per topology and reused
 * across frames — driving the boundary-only bevel clip in {@link drawIsoShipCells}.
 */
const presentCellsForOutline = new WeakMap<
  ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
  Set<number>
>();

/**
 * Pooled scratch for the per-cell extruded-box projection: its ground/top/centre
 * Pt slots are rewritten in place each cell by {@link isoCellBox} (via the
 * transform's allocation-free `projectInto`), so the per-rAF iso path allocates
 * no geometry once warmed. Module-level because the scratch is purely internal
 * to {@link drawIsoShipCells} — the caller never reads it back (unlike the `out`
 * buffer) — and the rAF draw loop is single-threaded and sequential, so each
 * cell fully consumes the scratch into canvas commands before the next
 * overwrites it.
 */
const isoCellBoxScratch: CellBox = makeCellBox();

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
 *
 * The per-cell geometry is projected into a module-level pooled {@link CellBox}
 * scratch ({@link isoCellBoxScratch}) via the transform's allocation-free
 * `projectInto`, so each cell, ship, and frame reuses the same ground/top/centre
 * Pt slots — the scratch is purely internal (consumed into canvas commands
 * before the next cell overwrites it) and the rAF draw loop is single-threaded
 * and sequential. The bevel clip is applied only to boundary cells (those with
 * an incomplete orthogonal neighbourhood): for a fully interior cell the
 * bevelled outline clip is provably a no-op (its side-face quads sit strictly
 * inside the hull outline), so the per-cell save/clip/restore triple is skipped
 * for them.
 */
export function drawIsoShipCells(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  s: { x: number; y: number; facing: number },
  cells: readonly RenderCell[],
  base: string,
  isStarved: (cell: RenderCell) => boolean,
  out: IsoCellDepth[],
  outline?: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
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

  // Body-only clip: clip the SIDE walls (the hull silhouette) to the bevelled
  // hull outline so armour corners read as a 45° bevel, but leave the TOP faces
  // unclipped so tall modules (sensors, turrets) are not truncated. The outline
  // DATA arriving here is already the bevelled render outline (computeHullOutline
  // via the descriptor), so we clip directly — no further chamfer. A
  // ground-footprint clip around the whole draw would crop those raised tops; a
  // true prism silhouette (front edges at ground, back edges lifted per-cell) is
  // the fully-correct fix but disproportionate here. Project each vertex with
  // the same ship-pose used for the cells. Per-cell save/clip/restore (below,
  // boundary cells only) keeps the back-to-front painter order intact. Trade: a
  // slight "deck overhang" where a top face cantilevers past a bevelled wall.
  // Render-only.
  let clipPath: Path2D | undefined;
  let present: Set<number> | undefined;
  if (outline !== undefined && outline.length > 0) {
    clipPath = new Path2D();
    for (const loop of outline) {
      if (loop.length === 0) continue;
      let first = true;
      for (const v of loop) {
        const wx = s.x + (v.x * cosF - v.y * sinF);
        const wy = s.y + (v.x * sinF + v.y * cosF);
        const p = t.project(wx, wy);
        if (first) {
          clipPath.moveTo(p.x, p.y);
          first = false;
        } else {
          clipPath.lineTo(p.x, p.y);
        }
      }
      clipPath.closePath();
    }
    // Set of present cell offsets for this outline, memoised on the outline
    // array (identity-stable per descriptor). Used below to identify boundary
    // cells (incomplete orthogonal neighbourhood) — the only cells whose side
    // faces the bevel clip can actually bite, so interior cells skip the
    // save/clip/restore triple entirely.
    present = presentCellsForOutline.get(outline);
    if (present === undefined) {
      present = new Set<number>();
      for (const m of cells) present.add(cellKey(m.ox, m.oy));
      presentCellsForOutline.set(outline, present);
    }
  }

  for (const { m } of out) {
    const app = appearanceOf(m.kind);
    const { ground, top, centre, zS } = isoCellBox(
      t.projectInto,
      isoCellBoxScratch,
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
    // shading for a lit-from-one-side read. Clipped to the chamfered silhouette
    // for boundary cells only (an edge exposed on the hull perimeter) so armour
    // corners bevel; the top face below stays unclipped. An interior cell's
    // side-face quads sit strictly inside the bevelled outline, so the evenodd
    // clip is a no-op for them and the save/clip/restore is skipped.
    let interior = true;
    if (present !== undefined) {
      interior =
        present.has(cellKey(m.ox + CELL_SIZE, m.oy)) &&
        present.has(cellKey(m.ox - CELL_SIZE, m.oy)) &&
        present.has(cellKey(m.ox, m.oy + CELL_SIZE)) &&
        present.has(cellKey(m.ox, m.oy - CELL_SIZE));
    }
    if (clipPath !== undefined && !interior) {
      ctx.save();
      ctx.clip(clipPath, "evenodd");
    }
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
    if (clipPath !== undefined && !interior) {
      ctx.restore();
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

    // Static cell edges: walls and doors stroked along their projected top-face
    // edges so bulkheads and doorways read at a glance. n/e/s/w map to the
    // corner pairs 0->1, 1->2, 2->3, 3->0. Old descriptors carry no `edges`,
    // so there is nothing to draw.
    const edges = m.edges;
    if (edges !== undefined) {
      ctx.lineWidth = Math.max(0.5, ISO_WALL_STROKE_FRACTION * CELL_SIZE * scale);
      for (const dir of EDGE_DIRS) {
        const kind = edges[dir];
        if (kind !== "wall" && kind !== "door") continue;
        const i = EDGE_TO_CORNER[dir];
        const a = top[i];
        const b = top[(i + 1) % 4];
        if (a === undefined || b === undefined) continue;
        ctx.strokeStyle = kind === "door" ? DOOR_COLOUR : WALL_COLOUR;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

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
    } else if (cellPx > 12 && m.glyph !== false) {
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
