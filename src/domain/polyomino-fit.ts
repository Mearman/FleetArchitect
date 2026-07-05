import { placedModules } from "@/domain/grid";
import type { Catalog } from "@/domain/catalog";
import type { DesignFault } from "@/domain/stats";
import type { EntityId } from "@/schema/primitives";
import type { ShipDesign } from "@/schema/ship";
import type { TileGrid } from "@/schema/grid";

/**
 * Polyomino (multi-cell module) fit validation: the integrity check for the
 * multi-cell data model, complementary to `analyseShipDesign`'s other
 * relationship faults (`unknownModule`, `invalidHardwire`, `crossFaction`).
 *
 * Every non-anchor offset of an anchor's footprint must land on a solid,
 * equipment-placeable cell whose `covers` back-pointer names that anchor —
 * matching BOTH the module id AND the anchor coordinate. resolve reads only
 * `covers.moduleId` (not the coordinate) and silently degrades a malformed cover
 * to inert structure; this validator is the one place the full back-pointer is
 * checked, so a broken polyomino surfaces as a build fault instead of being
 * hidden by that graceful degradation.
 *
 * Operates on the AUTHORED design grid: `covers.anchorCol/anchorRow` are
 * authored-grid coordinates, and the grown grid (armour auto-derivation) shifts
 * every cell by +1, so the coordinate match must be checked at authored
 * positions. Returns one fault per bad offset so a malformed placement reports
 * every cell that does not agree. A 1-cell module (the `[{0,0}]` default every
 * existing module carries) has no non-zero offsets, so legacy designs produce no
 * faults — the check is a backward-compatible no-op for the single-cell fleet.
 */
export function polyominoFitFaults(design: ShipDesign, catalog: Catalog): DesignFault[] {
  const faults: DesignFault[] = [];
  const grid = design.grid;
  for (const { col, row, moduleId } of placedModules(grid)) {
    const moduleDef = catalog.module(moduleId);
    // An unknown module is reported by `unknownModule` in analyseShipDesign;
    // skip it here rather than faulting twice.
    if (moduleDef === undefined) continue;
    for (const offset of moduleDef.footprint) {
      if (offset.dx === 0 && offset.dy === 0) continue;
      const reason = footprintOffsetFault(
        grid,
        col + offset.dx,
        row + offset.dy,
        moduleId,
        col,
        row,
      );
      if (reason !== undefined) {
        faults.push({ kind: "invalidFootprint", severity: "error", col, row, moduleId, reason });
      }
    }
  }
  return faults;
}

/**
 * Check one polyomino offset: the target cell (anchor plus a non-zero offset)
 * must be a solid, non-armour cell carrying a `covers` back-pointer that names
 * this anchor. Returns undefined when the offset is sound, or a fault reason.
 */
function footprintOffsetFault(
  grid: TileGrid,
  targetCol: number,
  targetRow: number,
  anchorModuleId: EntityId,
  anchorCol: number,
  anchorRow: number,
): string | undefined {
  if (targetCol < 0 || targetCol >= grid.cols || targetRow < 0 || targetRow >= grid.rows) {
    return "footprint offset out of bounds";
  }
  const target = grid.cells[targetRow * grid.cols + targetCol];
  if (target === undefined || target.kind !== "solid") {
    return "footprint offset cell not solid";
  }
  if (target.surface === "armor") {
    return "footprint offset cell is armour";
  }
  const covers = target.equipment?.covers;
  if (
    covers === undefined ||
    covers.moduleId !== anchorModuleId ||
    covers.anchorCol !== anchorCol ||
    covers.anchorRow !== anchorRow
  ) {
    return "footprint offset cell cover back-pointer mismatch";
  }
  return undefined;
}
