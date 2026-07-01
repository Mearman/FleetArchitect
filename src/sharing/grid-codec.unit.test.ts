import { describe, expect, it } from "vitest";

import { modules } from "@/data/catalog";
import { presetDesigns } from "@/data/presets";
import { TileGrid } from "@/schema/grid";

import { decodeGrid, encodeGrid } from "./grid-codec";

/** Encode then decode, asserting an exact round-trip against the parsed grid. */
function assertRoundTrip(grid: TileGrid): void {
  const restored = decodeGrid(encodeGrid(grid));
  expect(restored).toEqual(grid);
}

describe("grid-codec round-trip", () => {
  it("round-trips every preset design grid exactly", () => {
    expect(presetDesigns.length).toBeGreaterThan(0);
    for (const design of presetDesigns) {
      assertRoundTrip(design.grid);
    }
  });

  it("round-trips walls, open and closed doors, and armor surfaces", () => {
    // A 2x2 grid. The first cell carries a wall to the north and a door to the
    // east (open); the second an armor surface; the third a closed door south;
    // the fourth is empty.
    const grid = TileGrid.parse({
      cols: 2,
      rows: 2,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: {
            n: "wall",
            e: "door",
            s: "open",
            w: "open",
            doorStates: { e: "open" },
          },
        },
        { kind: "solid", substrate: true, surface: "armor" },
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: {
            n: "open",
            e: "open",
            s: "door",
            w: "wall",
            doorStates: { s: "closed" },
          },
        },
        { kind: "empty" },
      ],
    });
    assertRoundTrip(grid);
  });

  it("round-trips equipment with all five optional fields as distinct non-round floats", () => {
    const moduleId = modules[0]?.id;
    expect(moduleId).toBeDefined();
    if (moduleId === undefined) return;

    const grid = TileGrid.parse({
      cols: 1,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          equipment: {
            moduleId,
            facing: 1.2345678901234567,
            channel: 7,
            commsBearing: -0.9876543210987654,
            commsRange: 123.45678901234567,
            sensorBearing: 2.7182818284590455,
            sensorRangeSetting: 987.6543210987654,
          },
        },
      ],
    });

    const restored = decodeGrid(encodeGrid(grid));
    expect(restored).toEqual(grid);

    // The exact float values must survive untouched (byte-identical replay).
    const cell = restored.cells[0];
    expect(cell?.kind).toBe("solid");
    if (cell?.kind !== "solid" || cell.equipment === undefined) {
      throw new Error("expected a solid cell with equipment");
    }
    expect(cell.equipment.facing).toBe(1.2345678901234567);
    expect(cell.equipment.channel).toBe(7);
    expect(cell.equipment.commsBearing).toBe(-0.9876543210987654);
    expect(cell.equipment.commsRange).toBe(123.45678901234567);
    expect(cell.equipment.sensorBearing).toBe(2.7182818284590455);
    expect(cell.equipment.sensorRangeSetting).toBe(987.6543210987654);
  });

  it("round-trips a grid carrying a hardwire connection", () => {
    const moduleId = modules[0]?.id;
    expect(moduleId).toBeDefined();
    if (moduleId === undefined) return;

    const grid = TileGrid.parse({
      cols: 2,
      rows: 1,
      cells: [
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          equipment: { moduleId, facing: 0 },
        },
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          equipment: { moduleId, facing: 0 },
        },
      ],
      connections: [
        {
          from: { col: 0, row: 0 },
          to: { col: 1, row: 0 },
          resource: "power",
        },
      ],
    });
    assertRoundTrip(grid);
  });

  it("rejects an unknown codec version", () => {
    const bytes = encodeGrid(
      TileGrid.parse({
        cols: 1,
        rows: 1,
        cells: [{ kind: "solid", substrate: true, surface: "bare" }],
      }),
    );
    const corrupt = Uint8Array.from(bytes);
    corrupt[0] = 99;
    expect(() => decodeGrid(corrupt)).toThrow(/unsupported codec version/);
  });

  it("rejects an oversized grid (DoS guard on attacker-controlled dimensions)", () => {
    // Craft a buffer whose cols/rows varints exceed the per-dimension ceiling,
    // before any cell data. A crafted share must not be able to force a huge
    // allocation by lying about the grid dimensions.
    const varint = (v: number): number[] => {
      const out: number[] = [];
      do {
        let b = v & 0x7f;
        v = Math.floor(v / 128);
        if (v > 0) b |= 0x80;
        out.push(b);
      } while (v > 0);
      return out;
    };
    const real = encodeGrid(
      TileGrid.parse({
        cols: 1,
        rows: 1,
        cells: [{ kind: "solid", substrate: true, surface: "bare" }],
      }),
    );
    const version = real[0];
    if (version === undefined) throw new Error("encoded grid has no version byte");
    const oversized = new Uint8Array([version, ...varint(100_000), ...varint(1)]);
    expect(() => decodeGrid(oversized)).toThrow(/exceed|too large/i);
  });
});
