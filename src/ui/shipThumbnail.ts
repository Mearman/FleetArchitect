/**
 * Bake a ship design into a single offscreen sprite canvas, reusing the exact
 * battle-renderer rasterisation path so a thumbnail looks identical to the ship
 * in combat. Pure aside from the offscreen canvas it allocates: it derives the
 * per-cell layout from the design via {@link designCellLayout} (the single
 * source of truth for cell kind/offset/HP), maps each cell to a fully-alive
 * {@link RenderCell}, and rasterises with {@link rasteriseShipSprite}.
 */
import { catalog } from "@/data/catalog";
import { designCellLayout } from "@/domain/resolve";
import type { ShipDesign } from "@/schema/ship";
import type { RenderCell } from "@/ui/cellLayout";
import { FACTION_PALETTE } from "@/ui/routes/battleConstants";
import { rasteriseShipSprite, spriteKey } from "@/ui/routes/shipSprite";

/** Neutral accent used when a design's faction has no palette entry. */
const DEFAULT_ACCENT = "#9aa0a6";

/** The baked sprite canvas for a ship design, with its pixel dimensions. */
export interface DesignSprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Rasterise a ship design into one offscreen canvas. Returns undefined when the
 * design has no alive cells to bake or no offscreen 2D context is available
 * (the same conditions under which {@link rasteriseShipSprite} declines).
 */
export function designSprite(design: ShipDesign): DesignSprite | undefined {
  const cells: RenderCell[] = designCellLayout(design, catalog()).map((cell) => ({
    slotId: cell.slotId,
    ox: cell.ox,
    oy: cell.oy,
    kind: cell.kind,
    maxHp: cell.maxHp,
    surface: "bare",
    maxSurfaceHp: undefined,
    hasTurret: false,
    hp: cell.maxHp,
    alive: true,
    surfaceHp: undefined,
    turretAngle: undefined,
    manned: undefined,
    ammo: undefined,
    charge: undefined,
  }));

  const palette = FACTION_PALETTE[design.faction];
  const base = palette === undefined ? DEFAULT_ACCENT : palette.accent;
  const key = spriteKey(cells, base);
  const sprite = rasteriseShipSprite(cells, base, key);
  if (sprite === undefined) return undefined;
  return {
    canvas: sprite.canvas,
    width: sprite.canvas.width,
    height: sprite.canvas.height,
  };
}
