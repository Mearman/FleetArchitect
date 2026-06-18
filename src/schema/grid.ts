import { z } from "zod";
import { EntityId } from "./primitives";

/**
 * A ship is an authoritative 2D tile grid. Every cell is one of three kinds:
 * empty space, a structural hull tile, or an installed module. The grid is the
 * single source of truth for a ship's shape, mass, connectivity, and the
 * position of every module — there is no separate slot list and no hull id.
 */

/** The structural hull-tile shapes. Each carries its own mass and hp via the
 *  catalog (see HullTileType in the hull schema); the grid cell only records
 *  which shape sits in the cell so the renderer can draw it and the engine can
 *  anchor break-apart on it. */
export const HullTileType = z.enum(["corner", "edge", "strut", "block"]);
export type HullTileType = z.infer<typeof HullTileType>;

/** An empty cell: open space inside the grid's bounding box. */
export const EmptyCell = z.object({
  kind: z.literal("empty"),
});
export type EmptyCell = z.infer<typeof EmptyCell>;

/** A structural hull cell carrying one of the hull-tile shapes. */
export const HullCell = z.object({
  kind: z.literal("hull"),
  tile: HullTileType,
});
export type HullCell = z.infer<typeof HullCell>;

/**
 * A cell occupied by an installed module. `moduleId` references the bundled
 * catalog; `facing` is the module's mount direction in radians, ship-local
 * (0 = along +x, i.e. forward). Weapons fire along it and engines thrust along
 * it, exactly as the old per-slot facing did.
 *
 * The optional per-instance comms/sensor fields are only meaningful for cells
 * whose module has a CommsEffect or SensorEffect; they are absent on all other
 * cell kinds so existing grids parse unchanged.
 */
export const ModuleCell = z.object({
  kind: z.literal("module"),
  moduleId: EntityId,
  facing: z.number(),
  /** Per-instance logical channel override for comms modules. */
  channel: z.number().int().min(0).optional(),
  /** Per-instance fixed-facing bearing override for comms modules (radians). */
  commsBearing: z.number().optional(),
  /** Per-instance range setting for variable-type comms modules (world units). */
  commsRange: z.number().optional(),
});
export type ModuleCell = z.infer<typeof ModuleCell>;

/**
 * A walkable interior decking cell. Floor tiles are solid — they have mass and
 * HP like a light structural plate — but provide no module function. They are
 * dedicated corridor and crew-quarters space that crew can walk through to reach
 * stations. Hull and module cells are also walkable; `floor` is the explicit
 * interior-decking kind that a designer paints to build corridors.
 */
export const FloorCell = z.object({
  kind: z.literal("floor"),
});
export type FloorCell = z.infer<typeof FloorCell>;

/** Discriminated union over the cell kinds. New cell kinds extend this. */
export const GridCell = z.discriminatedUnion("kind", [
  EmptyCell,
  HullCell,
  ModuleCell,
  FloorCell,
]);
export type GridCell = z.infer<typeof GridCell>;

/**
 * A rectangular tile grid. `cells` is a flat, row-major array of length
 * `cols * rows`: the cell at (col, row) lives at index `row * cols + col`,
 * with col increasing left-to-right (+x) and row increasing top-to-bottom
 * (+y). Dimensions are integers of at least 1, and the cell count is validated
 * to equal `cols * rows` so a malformed grid fails loudly at parse time.
 */
export const TileGrid = z
  .object({
    cols: z.number().int().min(1),
    rows: z.number().int().min(1),
    cells: z.array(GridCell),
  })
  .refine((g) => g.cells.length === g.cols * g.rows, {
    message: "cells length must equal cols * rows",
    path: ["cells"],
  });
export type TileGrid = z.infer<typeof TileGrid>;
