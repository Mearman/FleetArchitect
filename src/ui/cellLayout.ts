/**
 * Render-time reconstruction of ship cells from the slim per-tick snapshot plus
 * the once-per-battle static descriptor. The battle frames carry only DYNAMIC
 * cell state (hp, alive, doorStates, manned, ammo, charge, turretAngle),
 * INDEX-MATCHED to the static layout (both s.modules order); the cell's static
 * layout (kind, ship-local offset, max HP, surface) lives once on the
 * {@link ShipDescriptor}, keyed by `slotId`. This module joins the two so the
 * renderer can draw each cell at its world position — derived from the ship pose
 * and the static offset — without the layout being re-serialised every frame.
 *
 * Pure: every function returns fresh values and never mutates its inputs.
 */

import { CELL_SIZE } from "@/domain/grid";
import type { ShipCellLayout, ShipDescriptor, ShipSnapshot } from "@/schema/battle";

/** A lookup from ship instance id to its static descriptor. */
export type DescriptorMap = ReadonlyMap<string, ShipDescriptor>;

/**
 * A cell ready to draw: its static layout (offset, kind, max HP, surface, turret
 * presence) merged with its dynamic state for this frame. Dynamic fields are
 * absent when the snapshot omitted them (e.g. a crewless or ammo-less cell).
 */
export interface RenderCell {
  slotId: string;
  /** Ship-local centre offset (design coordinates). */
  ox: number;
  oy: number;
  kind: ShipCellLayout["kind"];
  maxHp: number;
  surface: ShipCellLayout["surface"];
  maxSurfaceHp: number | undefined;
  hasTurret: boolean;
  /** Static per-edge kinds (wall/door/open) for bulkhead rendering. Undefined
   *  on descriptors recorded before edges were threaded through. Optional so
   *  existing RenderCell consumers need not supply it until they render edges. */
  edges?: { n: string; e: string; s: string; w: string };
  // Dynamic state for this frame.
  hp: number;
  alive: boolean;
  surfaceHp: number | undefined;
  turretAngle: number | undefined;
  manned: boolean | undefined;
  ammo: number | undefined;
  charge: number | undefined;
}

/**
 * Merge a ship's per-tick typed-array cell state with its static layout, in the
 * descriptor's cell order. Returns undefined when the ship has no descriptor
 * cells or no per-tick cell state (a legacy aggregated ship, or a phantom),
 * signalling the caller to fall back to its non-cell rendering path.
 *
 * The typed arrays and the static layout are both emitted in s.modules order,
 * so they are INDEX-MATCHED: cellHp[i] corresponds to ShipCellLayout.cells[i].
 * This walks them in lockstep by index (no slotId-keyed lookup). The shorter of
 * the array length and the layout length bounds the walk.
 *
 * Reads each typed array positionally, resolving sentinel values back to the
 * optional-field semantics downstream consumers expect: NaN in turretAngle /
 * charge becomes `undefined`; -1 in ammo becomes `undefined`.
 */
/**
 * As {@link renderCells}, but writes into a caller-supplied `buffer` and REUSES
 * the `RenderCell` objects already in it (updating their fields in place) instead
 * of allocating a fresh array of fresh objects every call. For the per-frame
 * battle draw loop, which rebuilds every ship's cells every rAF — the buffer,
 * held in a ref keyed by instance id, allocates only on the first frame (or when
 * a ship's cell count grows) and is otherwise allocation-free. `renderCells`
 * (below) is the fresh-allocating thin wrapper for non-hot callers.
 */
export function renderCellsInto(
  buffer: RenderCell[],
  ship: ShipSnapshot,
  descriptor: ShipDescriptor | undefined,
): RenderCell[] | undefined {
  const cells = ship.cells;
  const layout = descriptor?.cells;
  if (cells === undefined || layout === undefined) {
    buffer.length = 0;
    return undefined;
  }
  const n = Math.min(cells.cellHp.length, layout.length);
  let out = 0;
  for (let i = 0; i < n; i += 1) {
    const l = layout[i];
    if (l === undefined) continue;
    const turretAngle = cells.cellTurretAngle?.[i];
    const mannedRaw = cells.cellManned?.[i];
    const ammoRaw = cells.cellAmmo?.[i];
    const charge = cells.cellCharge?.[i];
    // Resolve every field once, then either push a new object (first frame / a
    // grown ship) or overwrite the reused object's fields in place.
    const slotId = l.slotId;
    const ox = l.ox;
    const oy = l.oy;
    const kind = l.kind;
    const maxHp = l.maxHp;
    const surface = l.surface;
    const maxSurfaceHp = l.maxSurfaceHp;
    const hasTurret = l.hasTurret === true;
    // Static edge kinds: undefined on legacy descriptors that predate the field.
    const edges = l.edges;
    const hp = cells.cellHp[i] ?? 0;
    const alive = (cells.cellAlive[i] ?? 0) !== 0;
    const surfaceHp = cells.cellSurfaceHp[i];
    const turretAngleResolved =
      turretAngle !== undefined && Number.isNaN(turretAngle) ? undefined : turretAngle;
    const manned = mannedRaw === undefined ? undefined : mannedRaw !== 0;
    const ammo = ammoRaw === undefined || ammoRaw < 0 ? undefined : ammoRaw;
    const chargeResolved = charge !== undefined && Number.isNaN(charge) ? undefined : charge;
    const existing = buffer[out];
    if (existing === undefined) {
      buffer.push({
        slotId,
        ox,
        oy,
        kind,
        maxHp,
        surface,
        maxSurfaceHp,
        hasTurret,
        edges,
        hp,
        alive,
        surfaceHp,
        turretAngle: turretAngleResolved,
        manned,
        ammo,
        charge: chargeResolved,
      });
    } else {
      existing.slotId = slotId;
      existing.ox = ox;
      existing.oy = oy;
      existing.kind = kind;
      existing.maxHp = maxHp;
      existing.surface = surface;
      existing.maxSurfaceHp = maxSurfaceHp;
      existing.hasTurret = hasTurret;
      existing.edges = edges;
      existing.hp = hp;
      existing.alive = alive;
      existing.surfaceHp = surfaceHp;
      existing.turretAngle = turretAngleResolved;
      existing.manned = manned;
      existing.ammo = ammo;
      existing.charge = chargeResolved;
    }
    out += 1;
  }
  buffer.length = out;
  return buffer;
}

export function renderCells(
  ship: ShipSnapshot,
  descriptor: ShipDescriptor | undefined,
): RenderCell[] | undefined {
  return renderCellsInto([], ship, descriptor);
}

/**
 * The world-space hull radius of a ship: the farthest cell-centre distance plus
 * one cell, derived purely from the static layout. Returns undefined when the
 * descriptor carries no cells, so callers apply their own small fixed fallback.
 */
export function hullRadiusWorld(descriptor: ShipDescriptor | undefined): number | undefined {
  const layout = descriptor?.cells;
  if (layout === undefined || layout.length === 0) return undefined;
  let maxDistSq = 0;
  for (const l of layout) {
    const d = l.ox * l.ox + l.oy * l.oy;
    if (d > maxDistSq) maxDistSq = d;
  }
  return Math.sqrt(maxDistSq) + CELL_SIZE;
}
