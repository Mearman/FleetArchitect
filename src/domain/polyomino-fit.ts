import { footprint, placedModules } from "@/domain/grid";
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
  // Backward pass: every covered cell's anchor must exist and hold the named
  // module. The forward pass above validates cover content for anchors that
  // exist; this catches ORPHANED covers — a cover whose anchor cell is gone or
  // holds a different module (a crafted share URL, or an editor edit that left a
  // cover behind). Without it, resolve silently degrades the orphan to inert
  // structure. Reported at the cover cell's coordinate.
  for (const { col, row } of footprint(grid)) {
    const cell = grid.cells[row * grid.cols + col];
    if (cell === undefined || cell.kind !== "solid") continue;
    const covers = cell.equipment?.covers;
    if (covers === undefined) continue;
    const reason = coverAnchorFault(grid, covers.anchorCol, covers.anchorRow, covers.moduleId);
    if (reason !== undefined) {
      faults.push({ kind: "invalidFootprint", severity: "error", col, row, moduleId: covers.moduleId, reason });
    }
  }
  return faults;
}

/**
 * Check one covered cell's back-pointer: the anchor at `(anchorCol, anchorRow)`
 * must be a solid cell carrying `moduleId`. Returns undefined when sound, or a
 * fault reason. Catches orphaned covers (anchor erased) and mismatched ones
 * (anchor holds a different module).
 */
function coverAnchorFault(
  grid: TileGrid,
  anchorCol: number,
  anchorRow: number,
  moduleId: EntityId,
): string | undefined {
  if (anchorCol < 0 || anchorCol >= grid.cols || anchorRow < 0 || anchorRow >= grid.rows) {
    return "covered cell anchor out of bounds";
  }
  const anchor = grid.cells[anchorRow * grid.cols + anchorCol];
  if (anchor === undefined || anchor.kind !== "solid") {
    return "covered cell anchor not solid";
  }
  if (anchor.equipment?.moduleId !== moduleId) {
    return "covered cell anchor module mismatch";
  }
  return undefined;
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
