/**
 * Static ship-sprite cache (W5b renderer LOD). A ship's alive cells are tinted
 * by two fixed colours (the module-kind colour and the side/faction accent) that
 * change only when the ship's alive-cell set changes (a cell dies) or its base
 * colour changes. Re-drawing every cell as two `fillRect`s per frame is the
 * single hottest cost on a thousand-cell hull, so we rasterise the alive-cell
 * layer once into an offscreen canvas in ship-local pixel space and blit it per
 * frame transformed by the ship pose. The sprite is re-rasterised only when the
 * alive-cell set or base colour changes; the cheap, frequently-changing dynamic
 * bits (starvation dimming, dead-cell crosses, turret barrels, crew dots, hull
 * outline) are drawn fresh on top each frame, exactly as before — so the visible
 * result is identical to drawing every cell live.
 *
 * The sprite is drawn at a FIXED resolution (`SPRITE_CELL_PX` pixels per grid
 * cell) at the ship's canonical facing (0). The per-frame blit applies the live
 * world-to-display scale and the ship's facing, so zoom and rotation never
 * invalidate the cache — only topology and colour do.
 */
import { CELL_SIZE } from "@/domain/grid";
import type { RenderCell } from "@/ui/cellLayout";
import { MODULE_COLOUR } from "./battleConstants";
import { glyphPath2D } from "@/ui/render/moduleGlyphs";
import { appearanceOf } from "@/ui/render/moduleAppearance";

/** Pixels per grid cell in the rasterised sprite. Chosen well above the largest
 *  on-screen cell size so a zoomed-in capital ship's baked cells never look soft
 *  when blitted; the blit downscales for normal zoom. */
const SPRITE_CELL_PX = 16;

/** Sprite-space pixels per world unit: the sprite draws `CELL_SIZE` world units
 *  as `SPRITE_CELL_PX` pixels. The per-frame blit divides the live display scale
 *  by this to map sprite pixels to display pixels. */
export const SPRITE_PX_PER_WORLD = SPRITE_CELL_PX / CELL_SIZE;

/**
 * A rasterised static cell layer for one ship. `canvas` holds the baked alive
 * cells; `originX/originY` are the sprite-pixel coordinates of the ship's local
 * origin (cell offset 0,0) within the canvas, so the blit can line the sprite up
 * with the ship centre. `key` is the cache validity token: the alive-cell
 * fingerprint combined with the base colour. `aliveSlots` is the set of slot ids
 * baked into the sprite, so the per-frame overlay knows which cells the sprite
 * already painted (and therefore must be knocked out and redrawn when starved).
 */
export interface ShipSprite {
  canvas: HTMLCanvasElement;
  originX: number;
  originY: number;
  key: string;
  aliveSlots: ReadonlySet<string>;
}

/** A drawing surface plus its 2D context. */
interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function createSurface(width: number, height: number): Surface | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return undefined;
  return { canvas, ctx };
}

/**
 * A stable cache token for a ship's static sprite: the set of alive slot ids and
 * the base colour. The slot ids are sorted so the token is independent of cell
 * array order, and a single cell death (which removes a slot) always moves it.
 * Joining ids with a separator that cannot appear in a slot id keeps the token
 * unambiguous.
 */
export function spriteKey(cells: readonly RenderCell[], base: string): string {
  const alive: string[] = [];
  for (const c of cells) {
    if (c.alive) alive.push(c.slotId);
  }
  alive.sort();
  return `${base}|${alive.join(",")}`;
}

/**
 * Rasterise a ship's alive cells into an offscreen sprite at the canonical
 * facing. Each alive cell is drawn exactly as the live path draws an alive,
 * non-starved cell: the module-kind colour at full opacity, then the side/accent
 * colour as a faint inset over it. Starvation dimming, dead cells, crosses,
 * turret barrels, crew, and the outline are NOT baked — they are dynamic and
 * drawn per frame on top of the blitted sprite.
 *
 * Returns undefined when there are no alive cells to bake or the offscreen
 * context is unavailable, signalling the caller to fall back to the live path.
 */
export function rasteriseShipSprite(
  cells: readonly RenderCell[],
  base: string,
  key: string,
  outline?: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
): ShipSprite | undefined {
  // Bounding box over alive cell centres, in cell offsets (world units).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const aliveSlots = new Set<string>();
  for (const c of cells) {
    if (!c.alive) continue;
    aliveSlots.add(c.slotId);
    if (c.ox < minX) minX = c.ox;
    if (c.ox > maxX) maxX = c.ox;
    if (c.oy < minY) minY = c.oy;
    if (c.oy > maxY) maxY = c.oy;
  }
  if (aliveSlots.size === 0) return undefined;

  // Sprite spans the cell-centre box expanded by half a cell on every side (a
  // cell is drawn centred on its offset), in sprite pixels.
  const half = SPRITE_CELL_PX / 2;
  const originX = -minX * SPRITE_PX_PER_WORLD + half;
  const originY = -minY * SPRITE_PX_PER_WORLD + half;
  const width = Math.ceil((maxX - minX) * SPRITE_PX_PER_WORLD + SPRITE_CELL_PX);
  const height = Math.ceil((maxY - minY) * SPRITE_PX_PER_WORLD + SPRITE_CELL_PX);

  const surface = createSurface(width, height);
  if (surface === undefined) return undefined;
  const { ctx } = surface;

  // Clip the baked cells to the chamfered outline so armour corners do not
  // poke past the bevel. The outline vertices are in ship-local metres, the
  // SAME origin and scale as the cell offsets, so they map into sprite pixels
  // with the same originX/originY and SPRITE_PX_PER_WORLD as the cells.
  // evenodd correctly handles multiple loops and holes.
  if (outline !== undefined && outline.length > 0) {
    const path = new Path2D();
    for (const loop of outline) {
      if (loop.length === 0) continue;
      const first = loop[0];
      if (first === undefined) continue;
      path.moveTo(originX + first.x * SPRITE_PX_PER_WORLD, originY + first.y * SPRITE_PX_PER_WORLD);
      for (let i = 1; i < loop.length; i += 1) {
        const v = loop[i];
        if (v === undefined) continue;
        path.lineTo(originX + v.x * SPRITE_PX_PER_WORLD, originY + v.y * SPRITE_PX_PER_WORLD);
      }
      path.closePath();
    }
    ctx.clip(path, "evenodd");
  }

  for (const c of cells) {
    if (!c.alive) continue;
    const colour = MODULE_COLOUR[c.kind];
    if (colour === undefined) continue;
    const cx = originX + c.ox * SPRITE_PX_PER_WORLD;
    const cy = originY + c.oy * SPRITE_PX_PER_WORLD;
    const left = cx - half;
    const top = cy - half;
    // Module-kind colour at full opacity (the alive, non-starved appearance).
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.fillRect(left, top, SPRITE_CELL_PX, SPRITE_CELL_PX);
    // Faint side/accent inset over it.
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = base;
    ctx.fillRect(left, top, SPRITE_CELL_PX, SPRITE_CELL_PX);
    // Glyph: bake the module's mark (a static function of kind) so the blit
    // carries it — no per-frame save/translate/scale/stroke per cell.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(SPRITE_CELL_PX, SPRITE_CELL_PX);
    ctx.globalAlpha = 0.78;
    ctx.strokeStyle = "rgba(8, 10, 8, 1)";
    ctx.lineWidth = 0.08;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(glyphPath2D(appearanceOf(c.kind).glyph));
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  return { canvas: surface.canvas, originX, originY, key, aliveSlots };
}
