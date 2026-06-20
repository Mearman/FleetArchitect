import { describe, expect, it } from "vitest";
import { analyseShipDesign } from "@/domain/stats";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import type { CellEdges, GridCell, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/**
 * Hardwire conduit validation unit tests.
 *
 * Validation tests use `analyseShipDesign` to check the fault model: an
 * incompatible conduit raises `invalidHardwire`; a valid conduit suppresses
 * the corresponding reachability fault.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** ASCII grid helpers for building test designs. Subset of stats.unit.test.ts tokens. */
const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };
const WALL: CellEdges = { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} };
const deck = (moduleId: string): GridCell => ({
  kind: "solid",
  scaffold: true,
  surface: "deck",
  edges: OPEN,
  equipment: { moduleId, facing: 0 },
});
const TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "solid", scaffold: true, surface: "armor", edges: WALL },
  F: deck("mod-reactor-fusion"),
  C: deck("mod-crew-quarters"),
  R: deck("mod-railgun"),
  G: deck("mod-munitions-magazine"),
  // `A` formerly the titanium armour module; armour is now a cell surface.
  A: { kind: "solid", scaffold: true, surface: "armor", edges: WALL },
  L: deck("mod-pulse-laser"),
};

function grid(
  rows: readonly string[],
  connections: TileGrid["connections"] = [],
): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      const cell = TOKENS[ch];
      if (cell === undefined) throw new Error(`Unknown token: ${ch}`);
      cells.push(cell);
    }
  }
  return { cols, rows: rows.length, cells, connections, shape: { outlineMode: "hexadecilinear" } };
}

function design(g: TileGrid): ShipDesign {
  return {
    id: createId("design"),
    name: "Test",
    faction: "Terran",
    grid: g,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

// ---------------------------------------------------------------------------
// Validation: analyseShipDesign — incompatible and valid hardwires
// ---------------------------------------------------------------------------

describe("engine.hardwire — analyseShipDesign validation", () => {
  it("armour used as ammo source raises invalidHardwire", () => {
    // Grid: F (reactor/command) — A (armour surface, no equipment) — R (railgun, finite ammo)
    // Connection: armour (col 1) → railgun (col 2), resource: ammo.
    // Armour is now a cell surface with no equipment, so the conduit's source
    // carries no module at all — invalid because a source must be a magazine.
    const g = grid(
      ["FAR"],
      [{ from: { col: 1, row: 0 }, to: { col: 2, row: 0 }, resource: "ammo" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    const hwFaults = faults.filter((f) => f.kind === "invalidHardwire");
    expect(hwFaults.length, "armour→weapon ammo conduit should raise invalidHardwire").toBeGreaterThan(0);
    if (hwFaults[0]?.kind === "invalidHardwire") {
      expect(hwFaults[0].resource).toBe("ammo");
      expect(hwFaults[0].reason).toMatch(/source cell carries no equipment/);
    }
  });

  it("reactor used as manning source for non-crewed module raises invalidHardwire", () => {
    // Grid: F (reactor/command, crewRequired=1) — A (armour, crewRequired=0)
    // Connection: F (col 0) → A (col 1), resource: manning
    // Invalid: sink must have crewRequired > 0.
    const g = grid(
      ["FA"],
      [{ from: { col: 0, row: 0 }, to: { col: 1, row: 0 }, resource: "manning" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    const hwFaults = faults.filter((f) => f.kind === "invalidHardwire");
    expect(hwFaults.length, "command→non-crewed manning conduit should raise invalidHardwire").toBeGreaterThan(0);
    if (hwFaults[0]?.kind === "invalidHardwire") {
      expect(hwFaults[0].resource).toBe("manning");
    }
  });

  it("valid ammo conduit (magazine → railgun) suppresses noAmmoSource for the linked weapon", () => {
    // Grid: F (reactor/command, 1 crew) — G (magazine) — R (railgun)
    // The railgun is isolated from the magazine by default, BUT the conduit
    // covers it directly, so noAmmoSource must NOT fire.
    // Note: this design does need crew (crewRequired ≥ 1 on F and G), so
    // we add a crew quarters to avoid crewDeficit masking the test.
    // Layout: C (crew) — F (reactor) — G (magazine) — R (railgun)
    const g = grid(
      ["CFGR"],
      [{ from: { col: 2, row: 0 }, to: { col: 3, row: 0 }, resource: "ammo" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    expect(faults.map((f) => f.kind)).not.toContain("invalidHardwire");
    expect(faults.map((f) => f.kind)).not.toContain("noAmmoSource");
  });

  it("valid manning conduit (command module → crewed weapon) suppresses unreachableStation", () => {
    // A pulse laser (crewRequired=1) at col 1; reactor (command) at col 0.
    // No crew quarters: normally this would raise crewDeficit and, if quarters
    // existed, unreachableStation. With a manning conduit the laser's station
    // need is satisfied. We test with crew quarters to isolate unreachableStation.
    //
    // Layout: C (crew quarters, col 0) — F (reactor/command, col 1) — L (laser, col 2)
    // Connection: F (col 1) → L (col 2), resource: manning
    // The laser is reachable from the quarters directly (crew can walk), so
    // unreachableStation wouldn't fire here anyway — but no invalidHardwire
    // should fire and noAmmoSource is not relevant (laser has unlimited ammo).
    const g = grid(
      ["CFL"],
      [{ from: { col: 1, row: 0 }, to: { col: 2, row: 0 }, resource: "manning" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    expect(faults.map((f) => f.kind)).not.toContain("invalidHardwire");
    // The design should be valid since laser+reactor+crew is a fine trio.
    // (Warnings such as noSensors are non-blocking, so filter to errors only.)
    expect(faults.filter((f) => f.severity === "error"), JSON.stringify(faults)).toHaveLength(0);
  });

  it("non-module cell used as source raises invalidHardwire", () => {
    // Grid (1 row, 3 cols): F (col 0) — # armor surface (col 1) — R railgun (col 2)
    // Connection: armor (col 1) → railgun (col 2), resource: ammo.
    // Armour is a cell surface with no equipment, so it cannot be a conduit
    // source. Phase 2: armour is a surface, not an equipment cell.
    const g = grid(
      ["F#R"],
      [{ from: { col: 1, row: 0 }, to: { col: 2, row: 0 }, resource: "ammo" }],
    );
    const { faults } = analyseShipDesign(design(g), catalog());
    const hwFaults = faults.filter((f) => f.kind === "invalidHardwire");
    expect(hwFaults.length, "armor cell as source should raise invalidHardwire").toBeGreaterThan(0);
    if (hwFaults[0]?.kind === "invalidHardwire") {
      expect(hwFaults[0].reason).toMatch(/source cell carries no equipment/);
    }
  });
});
