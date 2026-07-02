import { describe, expect, it } from "vitest";
import { catalog, layerMaterials, modules } from "@/data/catalog";
import { createCatalog } from "@/domain/catalog";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import { growArmourHull, padGrid } from "@/domain/hull-armour";
import { cellCoverageFractions } from "@/domain/hull-outline";
import type { CellEdges, GridCell, TileGrid } from "@/schema/grid";
import type { ModuleDefinition } from "@/schema/module";
import type { ShipDesign } from "@/schema/ship";

/** All-open edges for deck cells in test fixtures. */
const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

/** Authoring helper: parse a one-string-per-row ASCII map into a TileGrid.
 *  `.` empty, `#` armor surface, `~` deck corridor, `L` pulse laser,
 *  `R` railgun, `F` fusion reactor (command), `C` crew quarters,
 *  `G` munitions magazine — enough tokens to build the fixtures below.
 *
 *  Every equipment token sits on a deck cell (all-open edges) so crew can
 *  reach every station through the walkable surface. */
const TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "solid", substrate: true, surface: "armor", edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} } },
  "~": { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
  "L": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-pulse-laser", facing: 0 } },
  "R": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-railgun", facing: 0 } },
  "F": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-reactor-fusion", facing: 0 } },
  "C": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-crew-quarters", facing: 0 } },
  "G": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-munitions-magazine", facing: 0 } },
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
  return { cols, rows: rows.length, cells, connections: [] };
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
    doctrine: { base: {}, rules: [] },
  };
}

// ---------------------------------------------------------------------------
// Extra module definitions for sensor/comms tests.
// ---------------------------------------------------------------------------

const sensorModuleDef: ModuleDefinition = {
  id: "test-sensor-array",
  faction: "Terran",
  name: "Sensor Array",
  description: "Test sensor module.",
  category: "system",
  mass: 4,
  cost: 50,
  powerDraw: 4,
  crewRequired: 0,
  techLevel: 1,
  effect: { kind: "sensor", sensorType: "omni", arc: Math.PI, bearing: 0, detectionRange: 200, nebulaImmune: false },
};

/** Omni-directional comms unit — no crew needed, no bearing concern. */
const commsOmniDef: ModuleDefinition = {
  id: "test-comms-omni",
  faction: "Terran",
  name: "Omni Comms",
  description: "Test omni comms module.",
  category: "system",
  mass: 3,
  cost: 40,
  powerDraw: 3,
  crewRequired: 0,
  techLevel: 1,
  effect: {
    kind: "comms",
    commsType: "omni",
    range: 500,
    arc: Math.PI,
    bearing: 0,
    channel: 0,
    bandwidth: 4,
  },
};

/** Dish comms unit — requires crew and has a directional bearing. */
const commsDishDef: ModuleDefinition = {
  id: "test-comms-dish",
  faction: "Terran",
  name: "Comms Dish",
  description: "Test dish comms module.",
  category: "system",
  mass: 6,
  cost: 70,
  powerDraw: 5,
  crewRequired: 2,
  techLevel: 2,
  effect: {
    kind: "comms",
    commsType: "dish",
    range: 1000,
    arc: 0.2,
    bearing: 0,
    channel: 1,
    bandwidth: 8,
  },
};

/** A test catalog that extends the bundled catalog with sensor/comms modules. */
function extendedCatalog() {
  return createCatalog(
    [...modules, sensorModuleDef, commsOmniDef, commsDishDef],
    layerMaterials,
  );
}

function sensorCommsGrid(rows: readonly string[]): TileGrid {
  const EXTENDED_TOKENS: Record<string, GridCell> = {
    ".": { kind: "empty" },
    "#": { kind: "solid", substrate: true, surface: "armor", edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} } },
    "~": { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
    "F": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-reactor-fusion", facing: 0 } },
    "C": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-crew-quarters", facing: 0 } },
    "S": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "test-sensor-array", facing: 0 } },
    "O": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "test-comms-omni", facing: 0 } },
    "D": { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "test-comms-dish", facing: 0 } },
  };
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      const cell = EXTENDED_TOKENS[ch];
      if (cell === undefined) throw new Error(`bad token in sensorCommsGrid: ${ch}`);
      cells.push(cell);
    }
  }
  return { cols, rows: rows.length, cells, connections: [] };
}

describe("analyseShipDesign", () => {
  it("flags an empty grid as invalid", () => {
    const { valid, faults } = analyseShipDesign(design(grid(["."])), catalog());
    expect(valid).toBe(false);
    expect(faults.some((f) => f.kind === "empty")).toBe(true);
  });

  it("validates a fully supplied armed fighter and sums cost", () => {
    // Pulse laser + fusion reactor (command + power) + crew quarters, all
    // edge-connected in a row on deck cells.
    const { valid, stats, faults } = analyseShipDesign(
      design(grid(["LFC"])),
      catalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    expect(stats.weapons).toHaveLength(1);
    expect(stats.powerNet).toBeGreaterThanOrEqual(0);
    expect(stats.crewNet).toBeGreaterThanOrEqual(0);
    // pulse laser(55) + fusion reactor(80) + crew quarters(30)
    expect(stats.cost).toBe(55 + 80 + 30);
  });

  it("flags a power and crew deficit for a lone weapon with no reactor", () => {
    const { valid, faults } = analyseShipDesign(design(grid(["L"])), catalog());
    expect(valid).toBe(false);
    const kinds = faults.map((f) => f.kind);
    expect(kinds).toContain("powerDeficit");
    expect(kinds).toContain("crewDeficit");
    expect(kinds).toContain("noCommand");
  });

  it("flags a design with no command module", () => {
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

  it("sums structure across substrate + surface layers per solid cell", () => {
    // A single authored armour cell: chamfer-only growth adds nothing (no 3-of-4
    // corner), so the grown grid is that one cell. Its structure is the cell's
    // substrate + armour HP scaled by its coverage fraction inside the bevelled
    // outline — confirming both the substrate and the surface layer contribute.
    const d = design(grid(["#"]));
    const { stats } = analyseShipDesign(d, catalog());
    const cat = catalog();
    const substrate = cat.substrateMaterial("Terran");
    const armor = cat.armorMaterial("Terran");
    expect(substrate).toBeDefined();
    expect(armor).toBeDefined();
    const grown = growArmourHull(padGrid(d.grid, 1));
    const cov = cellCoverageFractions(grown);
    const i = grown.cells.findIndex((c) => c.kind === "solid");
    const expected = ((substrate?.hp ?? 0) + (armor?.hp ?? 0)) * (cov[i] ?? 0);
    expect(stats.structure).toBe(expected);
  });

  // ---------------------------------------------------------------------------
  // Reachability faults (Phase D)
  // ---------------------------------------------------------------------------

  it("does not flag noAmmoSource when a railgun has a magazine on the same connected ship", () => {
    const { valid, faults } = analyseShipDesign(
      design(grid(["FCRG"])),
      catalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("noAmmoSource");
    expect(valid, JSON.stringify(faults)).toBe(true);
  });

  it("flags noAmmoSource when a railgun has no magazine anywhere on the ship", () => {
    const { faults } = analyseShipDesign(
      design(grid(["FCR"])),
      catalog(),
    );
    const ammoFaults = faults.filter((f) => f.kind === "noAmmoSource");
    expect(ammoFaults.length).toBeGreaterThan(0);
  });

  it("does not flag noAmmoSource for a pulse laser (unlimited ammo)", () => {
    const { faults } = analyseShipDesign(
      design(grid(["FCL"])),
      catalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("noAmmoSource");
  });

  it("does not flag unreachableStation when no crew quarters exist", () => {
    const { faults } = analyseShipDesign(
      design(grid(["FL"])),
      catalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("unreachableStation");
    expect(faults.some((f) => f.kind === "crewDeficit")).toBe(true);
  });

  it("does not flag unreachableStation when crew quarters can reach all crewed stations", () => {
    // F (command) + C (quarters) + L (laser). All deck cells, connected.
    const { faults } = analyseShipDesign(
      design(grid(["FCL"])),
      catalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("unreachableStation");
  });

  it("flags unreachableStation when an armor cell seals a crewed station off from quarters", () => {
    // Layout: C ~ # L — the armor cell '#' between the deck corridor and the
    // laser blocks the crew path (armor's wall edges are impermeable). The
    // ship is substrate-connected (so isConnected4 passes and the
    // reachability check runs), but the walkable graph is severed.
    // F (command) placed to keep the design otherwise valid.
    const { faults } = analyseShipDesign(
      design(grid(["FC~#L"])),
      catalog(),
    );
    expect(faults.some((f) => f.kind === "unreachableStation")).toBe(true);
  });

  it("accepts a ship with deck corridor cells and counts them in the occupied mass", () => {
    const { valid, faults } = analyseShipDesign(
      design(grid(["FC~RG"])),
      catalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("noAmmoSource");
    expect(valid, JSON.stringify(faults)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Warning-level faults: sensors and comms (Phase D)
  // ---------------------------------------------------------------------------

  it("noSensors: a valid design without a sensor module produces a warning but stays valid", () => {
    const { valid, faults } = analyseShipDesign(
      design(sensorCommsGrid(["FC"])),
      extendedCatalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    const sensorFaults = faults.filter((f) => f.kind === "noSensors");
    expect(sensorFaults).toHaveLength(1);
    expect(sensorFaults[0]?.severity).toBe("warning");
  });

  it("noSensors: a design with a sensor module does NOT produce a noSensors fault", () => {
    const { faults } = analyseShipDesign(
      design(sensorCommsGrid(["FSC"])),
      extendedCatalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("noSensors");
  });

  it("noRelay: a design with exactly one comms unit produces a warning but stays valid", () => {
    const { valid, faults } = analyseShipDesign(
      design(sensorCommsGrid(["FOSC"])),
      extendedCatalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    const relayFaults = faults.filter((f) => f.kind === "noRelay");
    expect(relayFaults).toHaveLength(1);
    expect(relayFaults[0]?.severity).toBe("warning");
  });

  it("noRelay: two comms units does NOT produce a noRelay fault", () => {
    const { faults } = analyseShipDesign(
      design(sensorCommsGrid(["FOOSC"])),
      extendedCatalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("noRelay");
  });

  it("commsIsland: a comms unit whose channel is not shared by any other unit on the ship produces a warning", () => {
    const { valid, faults } = analyseShipDesign(
      design(sensorCommsGrid(["FOSC"])),
      extendedCatalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    const islandFaults = faults.filter((f) => f.kind === "commsIsland");
    expect(islandFaults).toHaveLength(1);
    expect(islandFaults[0]?.severity).toBe("warning");
  });

  it("commsIsland: two comms units on the same channel does NOT produce a commsIsland fault", () => {
    const { faults } = analyseShipDesign(
      design(sensorCommsGrid(["FOOSC"])),
      extendedCatalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("commsIsland");
  });

  it("unmannedAimUnit: a dish comms unit with no reachable crew quarters produces a warning", () => {
    // Layout: F C ~ # D S — armor cell seals the dish off from crew quarters.
    // The ship is substrate-connected, but the walkable graph is severed so the
    // dish's cell is unreachable from quarters → unmannedAimUnit fires.
    const { faults } = analyseShipDesign(
      design(sensorCommsGrid(["FC~#DS"])),
      extendedCatalog(),
    );
    expect(faults.some((f) => f.kind === "unmannedAimUnit")).toBe(true);
  });

  it("unmannedAimUnit: a dish comms unit with crew required but no crew quarters produces crewDeficit, not unmannedAimUnit", () => {
    const { faults } = analyseShipDesign(
      design(sensorCommsGrid(["FDS"])),
      extendedCatalog(),
    );
    expect(faults.map((f) => f.kind)).not.toContain("unmannedAimUnit");
    expect(faults.some((f) => f.kind === "crewDeficit")).toBe(true);
  });

  it("warning-level faults do not affect valid: a design with only warning faults is valid", () => {
    const { valid, faults } = analyseShipDesign(
      design(sensorCommsGrid(["FC"])),
      extendedCatalog(),
    );
    const errorFaults = faults.filter((f) => f.severity === "error");
    const warnFaults = faults.filter((f) => f.severity === "warning");
    expect(errorFaults).toHaveLength(0);
    expect(warnFaults.length).toBeGreaterThan(0);
    expect(valid).toBe(true);
  });

  it("warning-level faults carry severity: warning, never error", () => {
    const { faults } = analyseShipDesign(
      design(sensorCommsGrid(["FOOSC"])),
      extendedCatalog(),
    );
    const warningKinds = new Set(["noSensors", "commsIsland", "unmannedAimUnit", "noRelay"]);
    for (const fault of faults) {
      if (warningKinds.has(fault.kind)) {
        expect(fault.severity).toBe("warning");
      }
    }
  });
});
