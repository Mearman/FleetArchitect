import { describe, expect, it } from "vitest";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { GridCell, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

function makeGrid(rows: readonly string[], tokens: Record<string, GridCell>): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      const cell = tokens[ch];
      if (cell === undefined) throw new Error(`bad token "${ch}"`);
      cells.push(cell);
    }
  }
  return { cols, rows: rows.length, cells };
}

const TERRAN: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "L": { kind: "module", moduleId: "mod-pulse-laser", facing: 0 },
  "F": { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
  "C": { kind: "module", moduleId: "mod-crew-quarters", facing: 0 },
};

const SWARM: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "p": { kind: "module", moduleId: "swm-spore-launcher", facing: 0 },
  "g": { kind: "module", moduleId: "swm-neural-ganglion", facing: 0 },
  "j": { kind: "module", moduleId: "swm-flagellum-drive", facing: Math.PI },
};

function design(faction: string, g: TileGrid): ShipDesign {
  return {
    id: createId("design"),
    name: "Test",
    faction,
    grid: g,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Catalog faction filtering
// ---------------------------------------------------------------------------

describe("catalog faction filtering", () => {
  it("returns only Terran modules for Terran", () => {
    const mods = catalog().modulesForFaction("Terran");
    expect(mods.length).toBeGreaterThan(0);
    for (const m of mods) {
      expect(m.faction).toBe("Terran");
    }
  });

  it("returns only Swarm modules for Swarm", () => {
    const mods = catalog().modulesForFaction("Swarm");
    expect(mods.length).toBeGreaterThan(0);
    for (const m of mods) {
      expect(m.faction).toBe("Swarm");
    }
  });

  it("Terran and Swarm module sets are disjoint by id", () => {
    const terranIds = new Set(catalog().modulesForFaction("Terran").map((m) => m.id));
    const swarmIds = new Set(catalog().modulesForFaction("Swarm").map((m) => m.id));
    for (const id of swarmIds) {
      expect(terranIds.has(id)).toBe(false);
    }
  });

  it("reports both Terran and Swarm as factions", () => {
    const factions = catalog().factions();
    expect(factions).toContain("Terran");
    expect(factions).toContain("Swarm");
  });

  it("returns Swarm hull tiles for Swarm via hullTilesForFaction", () => {
    const tiles = catalog().hullTilesForFaction("Swarm");
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.faction).toBe("Swarm");
    }
  });

  it("Swarm block tile has different stats from Terran block tile", () => {
    const terranBlock = catalog().hullTileFor("Terran", "block");
    const swarmBlock = catalog().hullTileFor("Swarm", "block");
    expect(terranBlock).toBeDefined();
    expect(swarmBlock).toBeDefined();
    // Swarm block is lighter but has more HP
    if (terranBlock !== undefined && swarmBlock !== undefined) {
      expect(swarmBlock.mass).toBeLessThan(terranBlock.mass);
      expect(swarmBlock.hp).toBeGreaterThan(terranBlock.hp);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-faction validation
// ---------------------------------------------------------------------------

describe("cross-faction design validation", () => {
  it("a pure Terran design is valid", () => {
    const { valid, faults } = analyseShipDesign(
      design("Terran", makeGrid(["LFC"], TERRAN)),
      catalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    expect(faults.some((f) => f.kind === "crossFaction")).toBe(false);
  });

  it("a pure Swarm design is valid", () => {
    const { valid, faults } = analyseShipDesign(
      design("Swarm", makeGrid(["jpg"], SWARM)),
      catalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    expect(faults.some((f) => f.kind === "crossFaction")).toBe(false);
  });

  it("a design declared Terran but containing a Swarm module is flagged crossFaction", () => {
    // Mix: Terran reactor + Swarm spore launcher. The grid is declared Terran.
    const mixedTokens: Record<string, GridCell> = {
      ...TERRAN,
      "p": { kind: "module", moduleId: "swm-spore-launcher", facing: 0 },
    };
    const g = makeGrid(["Fp"], mixedTokens);
    const { valid, faults } = analyseShipDesign(design("Terran", g), catalog());
    expect(valid).toBe(false);
    const cf = faults.find((f) => f.kind === "crossFaction");
    expect(cf).toBeDefined();
    if (cf?.kind === "crossFaction") {
      expect(cf.expected).toBe("Terran");
      expect(cf.found).toContain("Swarm");
    }
  });

  it("a design declared Swarm but containing a Terran module is flagged crossFaction", () => {
    const mixedTokens: Record<string, GridCell> = {
      ...SWARM,
      "F": { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
    };
    const g = makeGrid(["gF"], mixedTokens);
    const { valid, faults } = analyseShipDesign(design("Swarm", g), catalog());
    expect(valid).toBe(false);
    const cf = faults.find((f) => f.kind === "crossFaction");
    expect(cf).toBeDefined();
    if (cf?.kind === "crossFaction") {
      expect(cf.expected).toBe("Swarm");
      expect(cf.found).toContain("Terran");
    }
  });

  it("crossFaction fault names the wrong factions found, not the correct one", () => {
    const mixedTokens: Record<string, GridCell> = {
      "F": { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
      "p": { kind: "module", moduleId: "swm-spore-launcher", facing: 0 },
    };
    const { faults } = analyseShipDesign(
      design("Terran", makeGrid(["Fp"], mixedTokens)),
      catalog(),
    );
    const cf = faults.find((f) => f.kind === "crossFaction");
    if (cf?.kind === "crossFaction") {
      // `found` must not include the expected faction
      expect(cf.found).not.toContain("Terran");
    }
  });
});

// ---------------------------------------------------------------------------
// Swarm hull tiles use Swarm stats in mass calculation
// ---------------------------------------------------------------------------

describe("faction-specific hull tile stats", () => {
  it("Swarm design with block hull uses Swarm block mass, not Terran mass", () => {
    // A Swarm design with one hull block + neural ganglion.
    const swarmTokens: Record<string, GridCell> = {
      "#": { kind: "hull", tile: "block" },
      "g": { kind: "module", moduleId: "swm-neural-ganglion", facing: 0 },
    };
    const { stats: swarmStats } = analyseShipDesign(
      design("Swarm", makeGrid(["#g"], swarmTokens)),
      catalog(),
    );

    const terranTokens: Record<string, GridCell> = {
      "#": { kind: "hull", tile: "block" },
      "F": { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
    };
    const { stats: terranStats } = analyseShipDesign(
      design("Terran", makeGrid(["#F"], terranTokens)),
      catalog(),
    );

    // Swarm block (mass 4) + neural ganglion (mass 6) = 10
    // Terran block (mass 6) + fusion reactor (mass 10) = 16
    expect(swarmStats.mass).toBeLessThan(terranStats.mass);
  });
});
