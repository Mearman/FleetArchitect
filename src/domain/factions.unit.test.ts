import { describe, expect, it } from "vitest";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { GridCell, HullTileType, TileGrid } from "@/schema/grid";
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
  return { cols, rows: rows.length, cells, connections: [] };
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

// ---------------------------------------------------------------------------
// Six-faction catalogue completeness (factions update)
// ---------------------------------------------------------------------------

describe("catalogue faction completeness", () => {
  const EXPECTED_FACTIONS: string[] = ["Terran", "Swarm", "Crystalline", "Foundry", "Corsair", "Synthetic"];
  const TILES: readonly HullTileType[] = ["block", "edge", "corner", "strut"];

  it("reports all six factions", () => {
    const factions = new Set(catalog().factions());
    for (const f of EXPECTED_FACTIONS) {
      expect(factions.has(f), `missing faction ${f}`).toBe(true);
    }
  });

  it("every module id is unique across the whole catalogue", () => {
    const ids = catalog().allModules().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const faction of EXPECTED_FACTIONS) {
    it(`${faction} has a command module, an engine, a weapon, and all four hull tiles`, () => {
      const mods = catalog().modulesForFaction(faction);
      expect(mods.some((m) => m.command === true), `${faction} needs a command module`).toBe(true);
      expect(mods.some((m) => m.effect.kind === "engine"), `${faction} needs an engine`).toBe(true);
      expect(mods.some((m) => m.effect.kind === "weapon"), `${faction} needs a weapon`).toBe(true);
      for (const tile of TILES) {
        expect(
          catalog().hullTileFor(faction, tile),
          `${faction} missing ${tile} hull tile`,
        ).toBeDefined();
      }
    });

    it(`${faction} can build a valid ship from its own parts`, () => {
      // Assemble the smallest valid ship from this faction's parts: a command
      // module, an engine, a weapon, and a crew module / magazine as needed.
      // Prefer a weapon without a finite magazine so no ammo source is required;
      // if every weapon needs ammo, add the faction's magazine too.
      const mods = catalog().modulesForFaction(faction);
      const command = mods.find((m) => m.command === true);
      const engine = mods.find((m) => m.effect.kind === "engine");
      const weapon =
        mods.find((m) => m.effect.kind === "weapon" && m.effect.ammoCapacity === undefined) ??
        mods.find((m) => m.effect.kind === "weapon");
      const crew = mods.find((m) => m.effect.kind === "crew");
      const magazine = mods.find((m) => m.effect.kind === "magazine");
      if (command === undefined || engine === undefined || weapon === undefined) {
        throw new Error(`${faction} missing a command/engine/weapon module`);
      }
      // Lay modules out left-to-right (a 4-connected row), engines facing aft.
      const cells: GridCell[] = [
        { kind: "module", moduleId: command.id, facing: 0 },
        { kind: "module", moduleId: weapon.id, facing: 0 },
        { kind: "module", moduleId: engine.id, facing: Math.PI },
      ];
      const weaponNeedsAmmo =
        weapon.effect.kind === "weapon" && weapon.effect.ammoCapacity !== undefined;
      if (weaponNeedsAmmo) {
        if (magazine === undefined) {
          throw new Error(`${faction} weapon needs ammo but has no magazine`);
        }
        cells.push({ kind: "module", moduleId: magazine.id, facing: 0 });
      }
      const placedDefs = cells
        .filter((c): c is Extract<GridCell, { kind: "module" }> => c.kind === "module")
        .map((c) => mods.find((m) => m.id === c.moduleId))
        .filter((m): m is NonNullable<typeof m> => m !== undefined);
      const crewRequired = placedDefs.reduce((s, m) => s + m.crewRequired, 0);
      if (crewRequired > 0) {
        if (crew === undefined) {
          throw new Error(`${faction} needs crew but has no crew module`);
        }
        cells.push({ kind: "module", moduleId: crew.id, facing: 0 });
      }
      const grid: TileGrid = { cols: cells.length, rows: 1, cells, connections: [] };
      const { valid, faults } = analyseShipDesign(design(faction, grid), catalog());
      expect(valid, `${faction} minimal ship invalid: ${JSON.stringify(faults)}`).toBe(true);
    });
  }
});
