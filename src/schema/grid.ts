import { z } from "zod";
import { EntityId } from "./primitives";

/**
 * A ship is an authoritative 2D tile grid of layered cells: every built cell is
 * substrate (the structural connectivity base) carrying an optional surface
 * (bare / deck / armor), per-edge walls or doors, and at most one equipment
 * module. The grid is the single source of truth for a ship's shape, mass,
 * connectivity, and the position of every module.
 */

// ---------------------------------------------------------------------------
// Edge / door / surface vocabulary.
// ---------------------------------------------------------------------------

/** The state of one of a cell's four edges: open space, a wall, or a door. */
export const EdgeKind = z.enum(["open", "wall", "door"]);
export type EdgeKind = z.infer<typeof EdgeKind>;

/** The state of a door edge: open (passable but leaks air) or closed
 *  (airtight barrier, blocks movement). */
export const DoorState = z.enum(["open", "closed"]);
export type DoorState = z.infer<typeof DoorState>;

/** The surface layered on a cell's substrate.
 *  - `bare`   — framing only; not walkable; equipment-placeable.
 *  - `deck`   — airtight crew floor; walkable; equipment-placeable.
 *  - `armor`  — solid, impassable plate; not walkable; no equipment. */
export const SurfaceKind = z.enum(["bare", "deck", "armor"]);
export type SurfaceKind = z.infer<typeof SurfaceKind>;

/**
 * Per-edge record for a cell. `doorStates` is keyed by direction; a state is
 * present exactly on edges whose kind is `door` (enforced by `SolidCell`'s
 * refine) and absent on every other edge. The default is an empty object so a
 * cell authored without doors parses without naming the field.
 */
export const CellEdges = z.object({
  n: EdgeKind,
  e: EdgeKind,
  s: EdgeKind,
  w: EdgeKind,
  doorStates: z
    .object({
      n: DoorState.optional(),
      e: DoorState.optional(),
      s: DoorState.optional(),
      w: DoorState.optional(),
    })
    .default({}),
});
export type CellEdges = z.infer<typeof CellEdges>;

/**
 * Equipment carried on a solid cell (at most one per cell). Replaces the old
 * `ModuleCell`. Carries the per-instance comms/sensor override fields verbatim
 * so resolve's existing per-instance logic ports with no semantic change.
 */
export const CellEquipment = z.object({
  moduleId: EntityId,
  facing: z.number(),
  /** Per-instance logical channel override for comms modules. */
  channel: z.number().int().min(0).optional(),
  /** Per-instance fixed-bearing bearing override for comms modules (radians). */
  commsBearing: z.number().optional(),
  /** Per-instance range setting for variable-type comms modules (world units). */
  commsRange: z.number().optional(),
  /** Per-instance fixed-bearing override for directional/dish sensor
   *  modules (radians). */
  sensorBearing: z.number().optional(),
  /** Per-instance range setting for variable-type sensor modules (world units). */
  sensorRangeSetting: z.number().optional(),
});
export type CellEquipment = z.infer<typeof CellEquipment>;

// ---------------------------------------------------------------------------
// Grid cells.
// ---------------------------------------------------------------------------

/** Absent from the ship. */
export const EmptyCell = z.object({ kind: z.literal("empty") });
export type EmptyCell = z.infer<typeof EmptyCell>;

/**
 * A built cell. Every built cell has substrate (the structural connectivity
 * base; break-apart follows 4-connected substrate adjacency). `surface` layers
 * on the substrate: `bare` (framing only, not walkable), `deck` (airtight crew
 * floor, walkable, equipment-placeable), or `armor` (impassable solid, high
 * HP/mass, no equipment). `edges` govern crew movement and airtightness
 * between deck cells. `equipment` is optional and only legal on `bare`/`deck`
 * (enforced by refine).
 */
export const SolidCell = z
  .object({
    kind: z.literal("solid"),
    /** Every built cell carries substrate; the literal collapses the type and
     *  prevents a meaningless `substrate: false` state. */
    substrate: z.literal(true),
    surface: SurfaceKind,
    edges: CellEdges,
    equipment: CellEquipment.optional(),
  })
  .refine((c) => c.surface !== "armor" || c.equipment === undefined, {
    message: "armor cells cannot carry equipment",
    path: ["equipment"],
  })
  .refine(
    (c) => {
      // doorState must be present exactly on door edges, absent on others.
      const dirs: readonly ("n" | "e" | "s" | "w")[] = ["n", "e", "s", "w"];
      for (const dir of dirs) {
        const isDoor = c.edges[dir] === "door";
        const hasState = c.edges.doorStates[dir] !== undefined;
        if (isDoor !== hasState) return false;
      }
      return true;
    },
    {
      message: "doorStates must be present exactly on door edges",
      path: ["edges"],
    },
  );
export type SolidCell = z.infer<typeof SolidCell>;

/**
 * Migrate a legacy cell whose structural-base field was named `scaffold` to the
 * current `substrate`. Persisted designs and shared URLs created before the
 * rename carry `scaffold: true`; this maps it on parse so they still load. The
 * extra `scaffold` key is dropped by the object schema's default key-stripping.
 */
function migrateLegacySubstrate(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return v;
  if ("substrate" in v || !("scaffold" in v)) return v;
  return { ...v, substrate: v.scaffold };
}

/** Discriminated union over the cell kinds. New cell kinds extend this. */
export const GridCell = z.preprocess(
  migrateLegacySubstrate,
  z.discriminatedUnion("kind", [EmptyCell, SolidCell]),
);
export type GridCell = z.infer<typeof GridCell>;

// ---------------------------------------------------------------------------
// Hardwires, coordinates, outline metadata, the tile grid.
// ---------------------------------------------------------------------------

/** A resource a hardwire conduit can carry directly between two equipment
 *  cells, removing the crew need for the linked sink at the cost of a fixed,
 *  severable one-to-one link:
 *   - "ammo"    — a magazine feeds a finite-ammo weapon with zero latency.
 *   - "power"   — a reactor wires a power-drawing module at any distance.
 *   - "manning" — a command/control node mans a station with no crew present.
 */
export const HardwireResource = z.enum(["ammo", "power", "manning"]);
export type HardwireResource = z.infer<typeof HardwireResource>;

/** Integer grid coordinate of a cell, used to address hardwire endpoints. */
export const CellCoord = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
});
export type CellCoord = z.infer<typeof CellCoord>;

/**
 * A hardwire conduit between two equipment cells. `from` is the resource
 * source (magazine / reactor / command), `to` the consumer sink. Source/sink
 * module compatibility is checked by the design validator, not the schema; the
 * schema only guarantees the endpoints are distinct and in bounds.
 */
export const Connection = z.object({
  from: CellCoord,
  to: CellCoord,
  resource: HardwireResource,
});
export type Connection = z.infer<typeof Connection>;

/**
 * A rectangular tile grid. `cells` is a flat, row-major array of length
 * `cols * rows`: the cell at (col, row) lives at index `row * cols + col`,
 * with col increasing left-to-right (+x) and row increasing top-to-bottom
 * (+y). Dimensions are integers of at least 1, and the cell count is
 * validated to equal `cols * rows` so a malformed grid fails loudly at parse
 * time.
 *
 * `connections` are hardwire conduits between equipment cells; it defaults to
 * an empty array so grids authored before hardwiring parse unchanged. The hull
 * outline is always traced octilinearly (`src/domain/outline.ts`), so there is
 * no per-grid outline setting; a legacy `shape` field on older persisted grids
 * is simply ignored on parse.
 */
export const TileGrid = z
  .object({
    cols: z.number().int().min(1),
    rows: z.number().int().min(1),
    cells: z.array(GridCell),
    connections: z.array(Connection).default([]),
  })
  .refine((g) => g.cells.length === g.cols * g.rows, {
    message: "cells length must equal cols * rows",
    path: ["cells"],
  })
  .refine(
    (g) =>
      g.connections.every(
        (c) =>
          c.from.col < g.cols &&
          c.from.row < g.rows &&
          c.to.col < g.cols &&
          c.to.row < g.rows &&
          !(c.from.col === c.to.col && c.from.row === c.to.row),
      ),
    {
      message: "connection endpoints must be distinct and within the grid",
      path: ["connections"],
    },
  );
export type TileGrid = z.infer<typeof TileGrid>;
