/**
 * Render-time reconstruction of ship cells from the slim per-tick snapshot plus
 * the once-per-battle static descriptor. The battle frames carry only DYNAMIC
 * cell state (hp, alive, doorStates, manned, ammo, charge, turretAngle), keyed
 * by `slotId`; the cell's static layout (kind, ship-local offset, max HP,
 * surface) lives once on the {@link ShipDescriptor}. This module joins the two so
 * the renderer can draw each cell at its world position — derived from the ship
 * pose and the static offset — without the layout being re-serialised every
 * frame.
 *
 * Pure: every function returns fresh values and never mutates its inputs.
 */

import { CELL_SIZE } from "@/domain/grid";
import type {
  CellState,
  ShipCellLayout,
  ShipDescriptor,
  ShipSnapshot,
} from "@/schema/battle";

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
  // Dynamic state for this frame.
  hp: number;
  alive: boolean;
  surfaceHp: number | undefined;
  turretAngle: number | undefined;
  manned: boolean | undefined;
  ammo: number | undefined;
  charge: number | undefined;
  doorStates: CellState["doorStates"];
}

/**
 * Merge a ship's slim per-tick cell states with its static layout, in the
 * descriptor's cell order. Returns undefined when the ship has no descriptor
 * cells or no per-tick cell state (a legacy aggregated ship, or a phantom),
 * signalling the caller to fall back to its non-cell rendering path.
 *
 * A dynamic state with no matching static layout slot is skipped (it cannot be
 * positioned); a static slot with no dynamic state this frame is skipped (it is
 * not part of the live hull this tick).
 */
export function renderCells(
  ship: ShipSnapshot,
  descriptor: ShipDescriptor | undefined,
): RenderCell[] | undefined {
  const cells = ship.cells;
  const layout = descriptor?.cells;
  if (cells === undefined || layout === undefined) return undefined;

  const stateBySlot = new Map<string, CellState>();
  for (const c of cells) stateBySlot.set(c.slotId, c);

  const merged: RenderCell[] = [];
  for (const l of layout) {
    const state = stateBySlot.get(l.slotId);
    if (state === undefined) continue;
    merged.push({
      slotId: l.slotId,
      ox: l.ox,
      oy: l.oy,
      kind: l.kind,
      maxHp: l.maxHp,
      surface: l.surface,
      maxSurfaceHp: l.maxSurfaceHp,
      hasTurret: l.hasTurret === true,
      hp: state.hp,
      alive: state.alive,
      surfaceHp: state.surfaceHp,
      turretAngle: state.turretAngle,
      manned: state.manned,
      ammo: state.ammo,
      charge: state.charge,
      doorStates: state.doorStates,
    });
  }
  return merged;
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
