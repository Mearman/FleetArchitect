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
import type { CellStateArrays, ShipCellLayout, ShipDescriptor, ShipSnapshot } from "@/schema/battle";

/** A lookup from ship instance id to its static descriptor. */
export type DescriptorMap = ReadonlyMap<string, ShipDescriptor>;

/** The live door states for one cell, keyed by direction. Absent edges have no
 *  door. Reconstructed from the four door typed arrays by renderCells. */
export interface RenderDoorStates {
  n?: "open" | "closed";
  e?: "open" | "closed";
  s?: "open" | "closed";
  w?: "open" | "closed";
}

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
  // Dynamic state for this frame.
  hp: number;
  alive: boolean;
  surfaceHp: number | undefined;
  turretAngle: number | undefined;
  manned: boolean | undefined;
  ammo: number | undefined;
  charge: number | undefined;
  doorStates: RenderDoorStates | undefined;
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
 * charge becomes `undefined`; -1 in ammo becomes `undefined`; door Uint8Array
 * values (0=none, 1=open, 2=closed) are reconstructed into a RenderDoorStates
 * object.
 */
export function renderCells(
  ship: ShipSnapshot,
  descriptor: ShipDescriptor | undefined,
): RenderCell[] | undefined {
  const cells = ship.cells;
  const layout = descriptor?.cells;
  if (cells === undefined || layout === undefined) return undefined;

  const n = Math.min(cells.cellHp.length, layout.length);
  const merged: RenderCell[] = [];
  for (let i = 0; i < n; i += 1) {
    const l = layout[i];
    if (l === undefined) continue;
    const turretAngle = cells.cellTurretAngle?.[i];
    const mannedRaw = cells.cellManned?.[i];
    const ammoRaw = cells.cellAmmo?.[i];
    const charge = cells.cellCharge?.[i];
    merged.push({
      slotId: l.slotId,
      ox: l.ox,
      oy: l.oy,
      kind: l.kind,
      maxHp: l.maxHp,
      surface: l.surface,
      maxSurfaceHp: l.maxSurfaceHp,
      hasTurret: l.hasTurret === true,
      hp: cells.cellHp[i] ?? 0,
      alive: (cells.cellAlive[i] ?? 0) !== 0,
      surfaceHp: cells.cellSurfaceHp[i],
      turretAngle: turretAngle !== undefined && Number.isNaN(turretAngle) ? undefined : turretAngle,
      manned: mannedRaw === undefined ? undefined : mannedRaw !== 0,
      ammo: ammoRaw === undefined || ammoRaw < 0 ? undefined : ammoRaw,
      charge: charge !== undefined && Number.isNaN(charge) ? undefined : charge,
      doorStates: readDoorStates(cells, i),
    });
  }
  return merged;
}

/**
 * Reconstruct the per-cell door-states object from the four door typed arrays
 * at index `i`. Returns undefined when the ship carries no door arrays.
 */
function readDoorStates(cells: CellStateArrays, i: number): RenderDoorStates | undefined {
  const n = cells.cellDoorN;
  if (n === undefined) return undefined;
  const e = cells.cellDoorE;
  const s = cells.cellDoorS;
  const w = cells.cellDoorW;
  const result: RenderDoorStates = {};
  const nv = n[i];
  if (nv !== undefined && nv !== 0) result.n = nv === 1 ? "open" : "closed";
  const ev = e?.[i];
  if (ev !== undefined && ev !== 0) result.e = ev === 1 ? "open" : "closed";
  const sv = s?.[i];
  if (sv !== undefined && sv !== 0) result.s = sv === 1 ? "open" : "closed";
  const wv = w?.[i];
  if (wv !== undefined && wv !== 0) result.w = wv === 1 ? "open" : "closed";
  return result;
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
