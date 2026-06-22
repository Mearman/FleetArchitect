import type { z } from "zod";
import type { ShipDesign } from "./ship";
import { isAllOpenEdges } from "./grid";

/**
 * The serialisation-facing shape of a `ShipDesign`: structurally identical to a
 * parsed design except that solid cells may omit `edges` (parse refills the
 * all-open default). This is the `z.input` side of `ShipDesign` — exactly what
 * `ShipDesign.parse` accepts — so a value of this type round-trips back to a
 * full `ShipDesign` on read.
 */
export type SerializedShipDesign = z.input<typeof ShipDesign>;

/**
 * Return a deep copy of `design` whose solid cells OMIT the `edges` key whenever
 * it is the all-open default (every edge `open` and no door states). The input
 * is never mutated. This is the single source of truth for "strip default edges
 * before persisting or encoding"; the runtime model keeps full edges because
 * `ShipDesign.parse` refills the default on the way back in.
 */
export function compactDesignForSerialization(
  design: ShipDesign,
): SerializedShipDesign {
  const copy = structuredClone(design);
  const cells = copy.grid.cells.map((cell) => {
    if (cell.kind !== "solid") return cell;
    if (!isAllOpenEdges(cell.edges)) return cell;
    // Rebuild the cell without the `edges` key; parse refills the default.
    return {
      kind: cell.kind,
      substrate: cell.substrate,
      surface: cell.surface,
      ...(cell.equipment === undefined ? {} : { equipment: cell.equipment }),
    };
  });
  return { ...copy, grid: { ...copy.grid, cells } };
}
