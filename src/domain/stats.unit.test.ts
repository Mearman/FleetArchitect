import { describe, expect, it } from "vitest";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { GridCell, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/** Authoring helper: parse a one-string-per-row ASCII map into a TileGrid.
 *  `.` empty, `#` hull block, `L` pulse laser, `F` fusion reactor (command),
 *  `C` crew quarters — enough tokens to build the fixtures below. */
const TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "L": { kind: "module", moduleId: "mod-pulse-laser", facing: 0 },
  "F": { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
  "C": { kind: "module", moduleId: "mod-crew-quarters", facing: 0 },
};

function grid(rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      const cell = TOKENS[ch];
      if (cell === undefined) throw new Error(`bad token ${ch}`);
      cells.push(cell);
    }
  }
  return { cols, rows: rows.length, cells };
}

function design(g: TileGrid): ShipDesign {
  return {
    id: createId("design"),
    name: "Test",
    faction: "Terran",
    grid: g,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

describe("analyseShipDesign", () => {
  it("flags an empty grid as invalid", () => {
    const { valid, faults } = analyseShipDesign(design(grid(["."])), catalog());
    expect(valid).toBe(false);
    expect(faults.some((f) => f.kind === "empty")).toBe(true);
  });

  it("validates a fully supplied armed fighter and sums cost", () => {
    // Pulse laser + fusion reactor (command + power) + crew quarters, all
    // edge-connected in a row.
    const { valid, stats, faults } = analyseShipDesign(
      design(grid(["LFC"])),
      catalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    expect(stats.weapons).toHaveLength(1);
    expect(stats.powerNet).toBeGreaterThanOrEqual(0);
    expect(stats.crewNet).toBeGreaterThanOrEqual(0);
    // pulse laser(40) + fusion reactor(80) + crew quarters(30)
    expect(stats.cost).toBe(40 + 80 + 30);
  });

  it("flags a power and crew deficit for a lone weapon with no reactor", () => {
    // A single pulse laser: no power, no command module, no crew supply.
    const { valid, faults } = analyseShipDesign(design(grid(["L"])), catalog());
    expect(valid).toBe(false);
    const kinds = faults.map((f) => f.kind);
    expect(kinds).toContain("powerDeficit");
    expect(kinds).toContain("crewDeficit");
    expect(kinds).toContain("noCommand");
  });

  it("flags a design with no command module", () => {
    // Crew quarters keep crew positive, but nothing is a command module, and
    // there's no power supply.
    const { valid, faults } = analyseShipDesign(design(grid(["#C"])), catalog());
    expect(valid).toBe(false);
    expect(faults.some((f) => f.kind === "noCommand")).toBe(true);
  });

  it("flags a disconnected grid", () => {
    // Two occupied cells with an empty gap between them: not 4-connected.
    const { valid, faults } = analyseShipDesign(design(grid(["F.L"])), catalog());
    expect(valid).toBe(false);
    expect(faults.some((f) => f.kind === "disconnected")).toBe(true);
  });

  it("derives a mass budget that scales with the occupied-cell count", () => {
    const small = analyseShipDesign(design(grid(["LFC"])), catalog());
    const big = analyseShipDesign(design(grid(["LFC", "L#C"])), catalog());
    expect(big.stats.massCapacity).toBeGreaterThan(small.stats.massCapacity);
  });
});
